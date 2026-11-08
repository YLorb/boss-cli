// 阶段校验：本轮任务按声明顺序分阶段推进，当前阶段只放行该阶段声明的命令。
// 阶段定义来自 task config 的 phases；当前阶段记录在 BOSS_PHASE_STATE 指向的文件。
// 仅在 BOSS_PHASE_STATE 设置且 task config 声明了 phases 时启用；否则不拦截。
import { readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { loadTaskConfig, taskConfigPath, type Phase } from './task_config.js';
import { resolveAction } from './permit.js';

export type PhaseState = { version: 1; phase: string; at: string };

export class PhaseDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhaseDeniedError';
  }
}

export function phaseStatePath(): string | null {
  const raw = process.env.BOSS_PHASE_STATE?.trim();
  return raw ? raw : null;
}

/** 阶段校验永不拦截的命令：阶段控制本身 + 只读诊断/检查。 */
const PHASE_ALWAYS_ALLOWED = new Set([
  'phase-set', 'phase-status',
  'status', 'check', 'search-sidebar', '--check-login', 'flow-status', 'spec-list', 'task-check', 'task-init',
  'help', 'version', 'version-check',
]);

export function isPhaseEnabled(): boolean {
  return phaseStatePath() !== null;
}

export function isPhaseDenied(error: unknown): boolean {
  return error instanceof Error && error.name === 'PhaseDeniedError';
}

async function readPhaseState(path: string): Promise<PhaseState | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new PhaseDeniedError(`阶段状态文件不可读：${path}；${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const value: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('阶段状态必须是对象。');
    const s = value as Partial<PhaseState>;
    if (s.version !== 1) throw new Error('阶段状态 version 必须为 1。');
    if (typeof s.phase !== 'string' || !s.phase.trim()) throw new Error('阶段状态 phase 必须是非空字符串。');
    if (typeof s.at !== 'string' || !Number.isFinite(Date.parse(s.at))) throw new Error('阶段状态 at 必须是时间字符串。');
    return { version: 1, phase: s.phase, at: s.at };
  } catch (error) {
    throw new PhaseDeniedError(`阶段状态文件无效：${path}；${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writePhaseState(path: string, state: PhaseState): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', 'utf8');
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/** 读当前阶段名；未初始化返回 null。 */
export async function currentPhase(): Promise<string | null> {
  const path = phaseStatePath();
  if (!path) return null;
  const state = await readPhaseState(path);
  return state?.phase ?? null;
}

/** phase-set 命令核心：校验阶段名存在，写入当前阶段。 */
export async function setPhase(name: string): Promise<PhaseState> {
  const path = phaseStatePath();
  if (!path) throw new PhaseDeniedError('未设置 BOSS_PHASE_STATE；请先指向阶段状态文件。');
  const taskPath = taskConfigPath();
  if (!taskPath) throw new PhaseDeniedError('未设置 BOSS_TASK_CONFIG；阶段定义来自任务配置。');
  const task = await loadTaskConfig(taskPath);
  if (!task.phases || task.phases.length === 0) throw new PhaseDeniedError('任务配置未声明 phases，无法进行阶段校验。');
  const names = task.phases.map(p => p.name);
  if (!names.includes(name)) {
    throw new PhaseDeniedError(`阶段未声明：${name}；可用阶段：${names.join(', ')}。`);
  }
  const state: PhaseState = { version: 1, phase: name, at: new Date().toISOString() };
  await writePhaseState(path, state);
  return state;
}

/** 阶段级白名单校验：动作执行前调用。当前阶段未放行该命令则拒绝（fail-closed）。 */
export async function assertPermittedPhase(normalizedCmd: string, argv: string[]): Promise<void> {
  const path = phaseStatePath();
  if (!path) return;
  if (PHASE_ALWAYS_ALLOWED.has(normalizedCmd)) return;
  const state = await readPhaseState(path);
  if (!state) throw new PhaseDeniedError('阶段状态未初始化：请先执行 boss phase-set --phase <阶段名>。');
  const taskPath = taskConfigPath();
  if (!taskPath) throw new PhaseDeniedError('未设置 BOSS_TASK_CONFIG；阶段定义来自任务配置。');
  const task = await loadTaskConfig(taskPath);
  const phase: Phase | undefined = task.phases?.find(p => p.name === state.phase);
  if (!phase) throw new PhaseDeniedError(`当前阶段未在任务配置中声明：${state.phase}。`);
  const variants = phase.allowed[normalizedCmd];
  if (variants === undefined) {
    throw new PhaseDeniedError(`命令 ${normalizedCmd} 在阶段 ${state.phase} 未授权；该阶段允许：${Object.keys(phase.allowed).join(', ') || '(无)'}。`);
  }
  if (variants.length === 0) return; // 命令名级放行
  if (normalizedCmd === 'action') {
    const action = resolveAction(argv);
    if (action !== null && variants.includes(action)) return;
    throw new PhaseDeniedError(`action 子动作 ${action ?? '(无法解析)'} 在阶段 ${state.phase} 未授权；允许：${variants.join(', ')}。`);
  }
  throw new PhaseDeniedError(`命令 ${normalizedCmd} 使用了变体白名单，但仅 action 支持子动作粒度；请改用空数组。`);
}