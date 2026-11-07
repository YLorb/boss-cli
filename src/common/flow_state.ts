// 逐人闭环锁：搜索/推荐流程中，同一时刻只能有一个"已打开、尚未决策"的候选人。
// 仅在设置 BOSS_FLOW_STATE（状态文件绝对路径）时启用；未设置则行为不变。
// 这是编排级护栏，不是系统级权限隔离。
import { readFile, rename, writeFile, mkdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export type FlowOpen = { candidateId: string; name: string; openedAt: string };
export type FlowState = { version: 1; open: FlowOpen | null };

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
  if (state.open === undefined || state.open === null) return;
  const o = state.open as Partial<FlowOpen>;
  if (typeof o !== 'object' || typeof o.candidateId !== 'string' || !o.candidateId.trim() ||
      typeof o.name !== 'string' || !o.name.trim() || typeof o.openedAt !== 'string') {
    throw new FlowLockError('流程状态 open 字段无效：需要 candidateId、name、openedAt。');
  }
}

async function readFlowState(path: string): Promise<FlowState> {
  try {
    const raw = await readFile(path, 'utf8');
    const value: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
    validateFlowState(value);
    return value as FlowState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, open: null };
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
  await writeFlowState(path, { version: 1, open: { candidateId, name, openedAt: new Date().toISOString() } });
}

/** greet/back 成功后解锁。 */
export async function releaseFlowOpen(path: string): Promise<void> {
  const state = await readFlowState(path);
  if (!state.open) return;
  await writeFlowState(path, { version: 1, open: null });
}
