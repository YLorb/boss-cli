// 逐人闭环锁：搜索/推荐流程中，同一时刻只能有一个"已打开、尚未决策"的候选人。
// 仅在设置 BOSS_FLOW_STATE（状态文件绝对路径）时启用；未设置则行为不变。
// 这是编排级护栏，不是系统级权限隔离。
import { readFile, rename, writeFile, mkdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export type FlowOpen = { candidateId: string; name: string; openedAt: string };
export type FlowDecision = { verdict: 'fit' | 'not-fit' | 'unknown'; at: string };
export type JournalAction = 'preview' | 'greet' | 'back' | 'decide';
export type JournalResult = 'success' | 'failed' | 'unknown';
export type JournalEntry = {
  candidateId: string;
  name: string;
  action: JournalAction;
  phase: 'intent' | 'result';
  result?: JournalResult;
  error?: string;
  evidence?: Record<string, string>;
  at: string;
};
export type FlowState = {
  version: 1;
  open: FlowOpen | null;
  decided: Record<string, FlowDecision>;
  journal: JournalEntry[];
};

export class FlowLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowLockError';
  }
}

export function flowStatePath(): string | null {
  const raw = process.env.BOSS_FLOW_STATE?.trim();
  return raw ? raw : null;
}

export function isFlowLockEnabled(): boolean {
  return flowStatePath() !== null;
}

function validateFlowState(value: unknown): asserts value is FlowState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FlowLockError('流程状态文件必须是对象。');
  const state = value as Partial<FlowState>;
  if (state.version !== 1) throw new FlowLockError('流程状态 version 必须为 1。');
  if (state.open !== undefined && state.open !== null) {
    const o = state.open as Partial<FlowOpen>;
    if (typeof o !== 'object' || typeof o.candidateId !== 'string' || !o.candidateId.trim() ||
        typeof o.name !== 'string' || !o.name.trim() || typeof o.openedAt !== 'string') {
      throw new FlowLockError('流程状态 open 字段无效：需要 candidateId、name、openedAt。');
    }
  }
  if (state.decided !== undefined && state.decided !== null) {
    const decided = state.decided as Record<string, Partial<FlowDecision>>;
    if (typeof decided !== 'object' || Array.isArray(decided)) throw new FlowLockError('流程状态 decided 字段无效。');
    for (const [id, d] of Object.entries(decided)) {
      if (!id.trim() || !d || typeof d !== 'object' ||
          !['fit', 'not-fit', 'unknown'].includes(d.verdict ?? '') || typeof d.at !== 'string') {
        throw new FlowLockError(`流程状态 decided 记录无效：${id}`);
      }
    }
  }
  if (state.journal !== undefined) {
    if (!Array.isArray(state.journal)) throw new FlowLockError('流程状态 journal 字段无效。');
    for (const e of state.journal as Partial<JournalEntry>[]) {
      if (!e || typeof e !== 'object' || typeof e.candidateId !== 'string' ||
          typeof e.name !== 'string' || !['preview', 'greet', 'back', 'decide'].includes(e.action ?? '') ||
          !['intent', 'result'].includes(e.phase ?? '') || typeof e.at !== 'string') {
        throw new FlowLockError('流程状态 journal 记录无效。');
      }
      if (e.phase === 'result' && !['success', 'failed', 'unknown'].includes(e.result ?? '')) {
        throw new FlowLockError('流程状态 journal result 无效。');
      }
    }
  }
}

async function readFlowState(path: string): Promise<FlowState> {
  try {
    const raw = await readFile(path, 'utf8');
    const value: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
    validateFlowState(value);
    const s = value as { open?: FlowOpen | null; decided?: Record<string, FlowDecision>; journal?: JournalEntry[] };
    return { version: 1, open: s.open ?? null, decided: s.decided ?? {}, journal: s.journal ?? [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, open: null, decided: {}, journal: [] };
    if (error instanceof FlowLockError) throw error;
    throw new FlowLockError(`流程状态文件损坏：${path}；${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeFlowState(path: string, state: FlowState): Promise<void> {
  validateFlowState(state);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  try { await rename(temporary, path); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}

/** 打开/联系目标前核验：已有其他候选人打开且未决策则拒绝，不写文件、不碰浏览器。 */
export async function verifyFlowCandidate(path: string, candidateId: string, name: string): Promise<void> {
  const state = await readFlowState(path);
  if (state.open && state.open.candidateId !== candidateId) {
    throw new FlowLockError(`候选人 ${state.open.name}（${state.open.candidateId}）已打开未决策：不合适请先 back，合适请先 greet，之后才能处理 ${name}（${candidateId}）。`);
  }
}

/** preview 成功打开后落锁：记录当前打开且未决策的候选人。 */
export async function acquireFlowOpen(path: string, candidateId: string, name: string): Promise<void> {
  const state = await readFlowState(path);
  if (state.open && state.open.candidateId !== candidateId) {
    throw new FlowLockError(`候选人 ${state.open.name}（${state.open.candidateId}）已打开未决策，不能记录为 ${name}（${candidateId}）。`);
  }
  await writeFlowState(path, { version: 1, open: { candidateId, name, openedAt: new Date().toISOString() }, decided: state.decided, journal: state.journal });
}

/** greet/back 成功后解锁。 */
export async function releaseFlowOpen(path: string): Promise<void> {
  const state = await readFlowState(path);
  if (!state.open) return;
  await writeFlowState(path, { version: 1, open: null, decided: state.decided, journal: state.journal });
}

/** 记录当前打开候选人的评估结论（评估先于触达的决策记录）。 */
export async function recordFlowDecision(path: string, candidateId: string, verdict: FlowDecision['verdict']): Promise<void> {
  const state = await readFlowState(path);
  if (!state.open || state.open.candidateId !== candidateId) {
    throw new FlowLockError(`decide 只能针对当前已打开的候选人：${state.open ? `${state.open.name}（${state.open.candidateId}）` : '当前无已打开候选人'}；目标 ${candidateId}。`);
  }
  await writeFlowState(path, { version: 1, open: state.open, decided: { ...state.decided, [candidateId]: { verdict, at: new Date().toISOString() } }, journal: state.journal });
}

/** 触达前核验：该候选人必须已评估为 fit，否则拒绝（评估先于触达）。 */
export async function verifyFlowDecided(path: string, candidateId: string, name: string): Promise<void> {
  const state = await readFlowState(path);
  const d = state.decided[candidateId];
  if (!d || d.verdict !== 'fit') {
    const reason = !d ? '尚未评估' : d.verdict === 'not-fit' ? '已评估为不合适' : '评估结果待确认';
    throw new FlowLockError(`候选人 ${name}（${candidateId}）${reason}，不能联系；${!d ? '请先评估并用 decide 记录结论' : '请 back 后继续下一位'}。`);
  }
}

/** 读取当前打开候选人（无则 null）。 */
export async function readFlowOpen(path: string): Promise<FlowOpen | null> {
  const state = await readFlowState(path);
  return state.open;
}

/** 动作前记录意图。 */
export async function recordJournalIntent(path: string, candidateId: string, name: string, action: JournalAction): Promise<void> {
  const state = await readFlowState(path);
  const entry: JournalEntry = { candidateId, name, action, phase: 'intent', at: new Date().toISOString() };
  await writeFlowState(path, { version: 1, open: state.open, decided: state.decided, journal: [...state.journal, entry] });
}

/** 动作后记录成功/失败/结果未知，并关联证据。 */
export async function recordJournalResult(
  path: string,
  candidateId: string,
  name: string,
  action: JournalAction,
  result: JournalResult,
  error?: string,
  evidence?: Record<string, string>,
): Promise<void> {
  const state = await readFlowState(path);
  const entry: JournalEntry = { candidateId, name, action, phase: 'result', result, at: new Date().toISOString() };
  if (error) entry.error = error;
  if (evidence) entry.evidence = evidence;
  await writeFlowState(path, { version: 1, open: state.open, decided: state.decided, journal: [...state.journal, entry] });
}
