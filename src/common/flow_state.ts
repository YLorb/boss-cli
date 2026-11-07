// 逐人闭环锁：搜索/推荐流程中，同一时刻只能有一个"已打开、尚未决策"的候选人。
// 仅在设置 BOSS_FLOW_STATE（状态文件绝对路径）时启用；未设置则行为不变。
// 这是编排级护栏，不是系统级权限隔离。
import { readFile, rename, writeFile, mkdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export type FlowOpen = { candidateId: string; name: string; openedAt: string };
export type FlowDecision = { verdict: 'fit' | 'not-fit' | 'unknown'; at: string };
export type JournalAction = 'preview' | 'greet' | 'back' | 'decide' | 'send' | 'confirm-contact' | 'select-job';
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
export type FlowPause = { reason: string; at: string };
export type FlowState = {
  version: 1;
  open: FlowOpen | null;
  decided: Record<string, FlowDecision>;
  journal: JournalEntry[];
  paused: FlowPause | null;
  lastProgressAt: string | null;
};
export type ContinuationState = 'done' | 'continue' | 'needs-verify';
export type ContinuationCandidate = {
  candidateId: string;
  name: string;
  state: ContinuationState;
  next?: string;
};
export type ContinuationReport = {
  open: ContinuationCandidate | null;
  candidates: ContinuationCandidate[];
};
export type WatchState = 'ok' | 'paused' | 'stalled' | 'not-started';
export type WatchReport = {
  state: WatchState;
  paused: FlowPause | null;
  lastProgressAt: string | null;
  idleMs: number | null;
};

export const DEFAULT_STALL_MS = 2 * 60 * 1000;

/** 从 BOSS_FLOW_STALL_MS 读取停滞阈值，默认 2 分钟。 */
export function stallThresholdMs(): number {
  const raw = process.env.BOSS_FLOW_STALL_MS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALL_MS;
}

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
    const actions = ['preview', 'greet', 'back', 'decide', 'send', 'confirm-contact', 'select-job'];
    for (const e of state.journal as Partial<JournalEntry>[]) {
      if (!e || typeof e !== 'object' || typeof e.candidateId !== 'string' ||
          typeof e.name !== 'string' || !actions.includes(e.action ?? '') ||
          !['intent', 'result'].includes(e.phase ?? '') || typeof e.at !== 'string') {
        throw new FlowLockError('流程状态 journal 记录无效。');
      }
      if (e.phase === 'result' && !['success', 'failed', 'unknown'].includes(e.result ?? '')) {
        throw new FlowLockError('流程状态 journal result 无效。');
      }
    }
  }
  if (state.paused !== undefined && state.paused !== null) {
    const p = state.paused as Partial<FlowPause>;
    if (typeof p !== 'object' || typeof p.reason !== 'string' || !p.reason.trim() || typeof p.at !== 'string') {
      throw new FlowLockError('流程状态 paused 字段无效。');
    }
  }
}

async function readFlowState(path: string): Promise<FlowState> {
  try {
    const raw = await readFile(path, 'utf8');
    const value: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
    validateFlowState(value);
    const s = value as Partial<FlowState>;
    return {
      version: 1,
      open: s.open ?? null,
      decided: s.decided ?? {},
      journal: s.journal ?? [],
      paused: s.paused ?? null,
      lastProgressAt: s.lastProgressAt ?? null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, open: null, decided: {}, journal: [], paused: null, lastProgressAt: null };
    }
    if (error instanceof FlowLockError) throw error;
    throw new FlowLockError(`流程状态文件损坏：${path}；${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeFlowState(path: string, state: FlowState): Promise<void> {
  validateFlowState(state);
  const next: FlowState = { ...state, lastProgressAt: new Date().toISOString() };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
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

/** preview 成功打开后落锁：记录当前打开且未决策的候选人；fresh=true 表示重新查看，清除该候选人旧 decide。 */
export async function acquireFlowOpen(path: string, candidateId: string, name: string, fresh = true): Promise<void> {
  const state = await readFlowState(path);
  if (state.open && state.open.candidateId !== candidateId) {
    throw new FlowLockError(`候选人 ${state.open.name}（${state.open.candidateId}）已打开未决策，不能记录为 ${name}（${candidateId}）。`);
  }
  const decided = fresh
    ? Object.fromEntries(Object.entries(state.decided).filter(([id]) => id !== candidateId))
    : state.decided;
  await writeFlowState(path, { version: 1, open: { candidateId, name, openedAt: new Date().toISOString() }, decided, journal: state.journal, paused: state.paused, lastProgressAt: state.lastProgressAt });
}

/** greet/back 成功后解锁。 */
export async function releaseFlowOpen(path: string): Promise<void> {
  const state = await readFlowState(path);
  if (!state.open) return;
  await writeFlowState(path, { version: 1, open: null, decided: state.decided, journal: state.journal, paused: state.paused, lastProgressAt: state.lastProgressAt });
}

/** 记录当前打开候选人的评估结论（评估先于触达的决策记录）。 */
export async function recordFlowDecision(path: string, candidateId: string, verdict: FlowDecision['verdict']): Promise<void> {
  const state = await readFlowState(path);
  if (!state.open || state.open.candidateId !== candidateId) {
    throw new FlowLockError(`decide 只能针对当前已打开的候选人：${state.open ? `${state.open.name}（${state.open.candidateId}）` : '当前无已打开候选人'}；目标 ${candidateId}。`);
  }
  await writeFlowState(path, { version: 1, open: state.open, decided: { ...state.decided, [candidateId]: { verdict, at: new Date().toISOString() } }, journal: state.journal, paused: state.paused, lastProgressAt: state.lastProgressAt });
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
  await writeFlowState(path, { version: 1, open: state.open, decided: state.decided, journal: [...state.journal, entry], paused: state.paused, lastProgressAt: state.lastProgressAt });
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
  await writeFlowState(path, { version: 1, open: state.open, decided: state.decided, journal: [...state.journal, entry], paused: state.paused, lastProgressAt: state.lastProgressAt });
}

/** 必须暂停：记录 round 级暂停原因。 */
export async function pauseFlow(path: string, reason: string): Promise<void> {
  if (!reason || !reason.trim()) throw new FlowLockError('暂停原因不能为空。');
  const state = await readFlowState(path);
  await writeFlowState(path, { ...state, paused: { reason: reason.trim(), at: new Date().toISOString() } });
}

/** 人工确认后恢复。 */
export async function clearFlowPause(path: string): Promise<void> {
  const state = await readFlowState(path);
  await writeFlowState(path, { ...state, paused: null });
}

/** 动作前核验：已暂停则拒绝一切候选人动作。 */
export async function verifyFlowNotPaused(path: string): Promise<void> {
  const state = await readFlowState(path);
  if (state.paused) {
    throw new FlowLockError(`流程已暂停：${state.paused.reason}；请人工处理后 flow-resume 再继续。`);
  }
}

/** 同一候选人同一动作只允许发起一次（结果未知不得重放）。 */
export async function verifyFlowNotReplayed(path: string, candidateId: string, name: string, action: JournalAction): Promise<void> {
  const state = await readFlowState(path);
  const prior = state.journal.find(e => e.candidateId === candidateId && e.action === action);
  if (prior) {
    const detail = prior.phase === 'intent' ? '意图已记录' : `结果=${prior.result}`;
    throw new FlowLockError(`候选人 ${name}（${candidateId}）本轮已发起过 ${action}（${detail}），禁止重复；结果未知不得重放，请核验后再决定。`);
  }
}

/** 统计末尾连续同动作的失败次数（用于自动暂停判定）。 */
export async function consecutiveActionFailures(path: string, action: JournalAction): Promise<number> {
  const state = await readFlowState(path);
  let count = 0;
  for (let i = state.journal.length - 1; i >= 0; i--) {
    const e = state.journal[i];
    if (e.action !== action) break;
    if (e.phase === 'result' && e.result === 'failed') count++;
    else if (e.phase === 'result') break;
  }
  return count;
}

/** 从流程状态确定性推导每个候选人的接续状态（done/continue/needs-verify）。 */
export function deriveFlowContinuation(state: FlowState): ContinuationReport {
  const names = new Map<string, string>();
  for (const e of state.journal) if (e.name) names.set(e.candidateId, e.name);
  if (state.open) names.set(state.open.candidateId, state.open.name);
  for (const id of Object.keys(state.decided)) if (!names.has(id)) names.set(id, id);

  const lastResult = new Map<string, Map<JournalAction, JournalEntry>>();
  for (const e of state.journal) {
    if (e.phase !== 'result') continue;
    if (!lastResult.has(e.candidateId)) lastResult.set(e.candidateId, new Map());
    lastResult.get(e.candidateId)!.set(e.action, e);
  }

  const sideEffects: JournalAction[] = ['greet', 'send', 'confirm-contact', 'select-job'];
  const classify = (id: string): ContinuationCandidate => {
    const name = names.get(id) ?? id;
    const r = lastResult.get(id);
    const decided = state.decided[id];
    const isOpen = state.open?.candidateId === id;
    // 任一副作用动作失败/未知/有意图无结果（中断）→ 需核验；优先级最高，且不受 open 影响。
    for (const action of sideEffects) {
      const resultEntry = r?.get(action);
      const intentEntry = state.journal.some(e => e.candidateId === id && e.action === action && e.phase === 'intent');
      if ((resultEntry && (resultEntry.result === 'failed' || resultEntry.result === 'unknown')) || (intentEntry && !resultEntry)) {
        return { candidateId: id, name, state: 'needs-verify', next: `verify-${action}` };
      }
    }
    // 无未决副作用：已关闭（非当前打开）的候选人才可能 done。
    if (!isOpen) {
      if (r?.get('greet')?.result === 'success') return { candidateId: id, name, state: 'done' };
      if (r?.get('back')?.result === 'success') return { candidateId: id, name, state: 'done' };
    }
    if (decided?.verdict === 'fit') return { candidateId: id, name, state: 'continue', next: 'greet' };
    if (decided && (decided.verdict === 'not-fit' || decided.verdict === 'unknown')) return { candidateId: id, name, state: 'continue', next: 'back' };
    return { candidateId: id, name, state: 'continue', next: 'decide' };
  };

  const candidates = [...names.keys()].map(classify);
  const openId = state.open?.candidateId;
  const open = openId ? candidates.find(c => c.candidateId === openId) ?? null : null;
  return { open, candidates };
}

/** 读取并推导接续状态。 */
export async function flowStatus(path: string): Promise<ContinuationReport> {
  const state = await readFlowState(path);
  return deriveFlowContinuation(state);
}

/** 独立停滞监测：区分 ok / paused / stalled（idle 超过阈值）。 */
export async function flowWatch(path: string, thresholdMs = stallThresholdMs()): Promise<WatchReport> {
  const state = await readFlowState(path);
  const idleMs = state.lastProgressAt ? Date.now() - Date.parse(state.lastProgressAt) : null;
  let st: WatchState;
  if (state.paused) st = 'paused';
  else if (state.lastProgressAt === null) st = 'not-started';
  else if (idleMs !== null && idleMs > thresholdMs) st = 'stalled';
  else st = 'ok';
  return { state: st, paused: state.paused, lastProgressAt: state.lastProgressAt, idleMs };
}
