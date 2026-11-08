// 统一任务配置：本轮任务的唯一声明入口（岗位、范围、permit 引用、停止条件）。
// 仅在设置 BOSS_TASK_CONFIG 时参与校验；未设置时不影响其它命令（task-check 除外）。
// 这是编排级任务声明，不是系统级权限隔离。
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { loadPermit, type PermitDoc } from './permit.js';

export type TaskScope = 'collect' | 'recommend' | 'search' | 'view-only';
export type TaskStop = {
  observeLimit?: number;
  contactLimit?: number;
  deadline?: string;
  maxConsecutiveFailures?: number;
};
export type TaskConfig = {
  schemaVersion: 1;
  job: string;
  scope: TaskScope;
  permit: string;
  stop: TaskStop;
};

export function taskConfigPath(): string | null {
  const raw = process.env.BOSS_TASK_CONFIG?.trim();
  return raw ? raw : null;
}

function validateStop(value: unknown): asserts value is TaskStop {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('task.stop 必须是对象。');
  }
  const stop = value as Record<string, unknown>;
  for (const key of ['observeLimit', 'contactLimit', 'maxConsecutiveFailures']) {
    const n = stop[key];
    if (n !== undefined && (!Number.isInteger(n) || (n as number) <= 0)) {
      throw new Error(`task.stop.${key} 必须是正整数。`);
    }
  }
  if (stop.deadline !== undefined) {
    if (typeof stop.deadline !== 'string' || !Number.isFinite(Date.parse(stop.deadline))) {
      throw new Error('task.stop.deadline 必须是可解析的时间字符串。');
    }
  }
}

function validateTaskConfig(value: unknown): asserts value is TaskConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('任务配置必须是对象。');
  }
  const t = value as Partial<TaskConfig>;
  if (t.schemaVersion !== 1) throw new Error('任务配置 schemaVersion 必须为 1。');
  if (typeof t.job !== 'string' || !t.job.trim()) throw new Error('任务配置 job 必须是非空字符串。');
  if (t.scope !== 'collect' && t.scope !== 'recommend' && t.scope !== 'search' && t.scope !== 'view-only') {
    throw new Error('任务配置 scope 必须是 collect/recommend/search/view-only。');
  }
  if (typeof t.permit !== 'string' || !t.permit.trim() || !isAbsolute(t.permit)) {
    throw new Error('任务配置 permit 必须是指向 permit 文件的绝对路径。');
  }
  validateStop(t.stop);
}

export async function loadTaskConfig(path: string): Promise<TaskConfig> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`任务配置文件不可读：${path}；${error instanceof Error ? error.message : String(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`任务配置文件无效 JSON：${path}；${error instanceof Error ? error.message : String(error)}`);
  }
  validateTaskConfig(value);
  return value as TaskConfig;
}

/**
 * task-check 核心：读取并校验任务配置 + 其引用的 permit，返回报告。
 * 交叉校验：permit 若声明了 job/entry，必须与任务配置一致（fail-closed）。
 */
export async function checkTaskConfig(): Promise<{
  task: TaskConfig;
  permit: PermitDoc;
  permitFile: string;
}> {
  const path = taskConfigPath();
  if (!path) throw new Error('未设置 BOSS_TASK_CONFIG；请在启动前指向任务配置文件。');
  const task = await loadTaskConfig(path);
  let permit: PermitDoc;
  try {
    permit = await loadPermit(task.permit);
  } catch (error) {
    throw new Error(`任务配置引用的 permit 无效：${task.permit}；${error instanceof Error ? error.message : String(error)}`);
  }
  if (permit.job !== undefined && permit.job !== task.job) {
    throw new Error(`任务配置 job 与 permit.job 不一致：${task.job} / ${permit.job}`);
  }
  if (permit.entry !== undefined && permit.entry !== task.scope) {
    throw new Error(`任务配置 scope 与 permit.entry 不一致：${task.scope} / ${permit.entry}`);
  }
  return { task, permit, permitFile: task.permit };
}