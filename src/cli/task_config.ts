import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { APP_HOME } from '../config.js';

/** Agent-owned instructions. Limits and progress are interpreted by the SOP. */
export type TaskConfig = {
  job: string;
  scope?: 'collect' | 'recommend' | 'search' | 'view-only';
  resultsFile?: string;
  ledgerDir?: string;
  [key: string]: unknown;
};

export function taskConfigPath(): string | null {
  return process.env.BOSS_TASK_CONFIG?.trim() || null;
}

export async function loadTaskConfig(file: string): Promise<TaskConfig> {
  if (!isAbsolute(file)) throw new Error('BOSS_TASK_CONFIG 必须是任务 JSON 的绝对路径');
  let value: unknown;
  try {
    value = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`任务 JSON 不可读或格式错误：${file}；${String(error)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`任务 JSON 必须是对象：${file}`);
  const task = value as TaskConfig;
  if (typeof task.job !== 'string' || !task.job.trim()) throw new Error(`任务 JSON 缺少非空 job：${file}`);
  if (task.scope !== undefined && !['collect', 'recommend', 'search', 'view-only'].includes(task.scope)) {
    throw new Error(`任务 scope 无效：${file}`);
  }
  for (const key of ['resultsFile', 'ledgerDir'] as const) {
    if (task[key] !== undefined && (typeof task[key] !== 'string' || !isAbsolute(task[key]))) {
      throw new Error(`任务 ${key} 必须是绝对路径：${file}`);
    }
  }
  return task;
}

export async function readTaskConfig(): Promise<TaskConfig | null> {
  const file = taskConfigPath();
  return file ? loadTaskConfig(file) : null;
}

export function taskResultsFile(task: TaskConfig | null): string {
  if (task?.resultsFile) return task.resultsFile;
  const name = task ? createHash('sha256').update(task.job).digest('hex') : 'commands';
  return join(APP_HOME, 'results', `${name}.jsonl`);
}

export async function checkTaskConfig() {
  const task = await readTaskConfig();
  if (!task) throw new Error('请将 BOSS_TASK_CONFIG 指向任务 JSON');
  return { task, resultsFile: taskResultsFile(task) };
}
