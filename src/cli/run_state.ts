// 统一启动：生成 runId，把 permit / flow-state / 账本目录 / 版本 绑定到本轮运行实例。
// 产物是 ~/.boss-cli/runs/<runId>.json 的只读状态文件；task config 本身不改。
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_HOME, RUNS_DIR, ensureAppDataLayout } from '../config.js';
import { checkTaskConfig, type TaskConfig } from './task_config.js';
import { flowStatePath } from '../common/flow_state.js';
import { COMPATIBILITY } from './skill_compatibility.js';

export type RunState = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  job: string;
  scope: TaskConfig['scope'];
  permit: string;
  flowState: string | null;
  ledgerDir: string;
  cliVersion: string;
  skillVersion: string;
  compatibilityId: string;
  stop: TaskConfig['stop'];
};

function timestampId(d = new Date()): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 确定性 runId：job 哈希前缀 + 秒级时间戳。同 job 同秒重复生成由文件 wx 独占检测。 */
export function generateRunId(job: string, d = new Date()): string {
  return `${createHash('sha256').update(job).digest('hex').slice(0, 12)}-${timestampId(d)}`;
}

export function runStateFile(runId: string): string {
  return join(RUNS_DIR, `${runId}.json`);
}

function validateRunState(value: unknown): asserts value is RunState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('run 状态必须是对象。');
  const r = value as Partial<RunState>;
  if (r.schemaVersion !== 1) throw new Error('run 状态 schemaVersion 必须为 1。');
  if (typeof r.runId !== 'string' || !r.runId.trim()) throw new Error('run 状态 runId 必须是非空字符串。');
  if (typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt))) throw new Error('run 状态 createdAt 必须是时间字符串。');
  if (typeof r.job !== 'string' || !r.job.trim()) throw new Error('run 状态 job 必须是非空字符串。');
  if (typeof r.permit !== 'string' || !r.permit.trim()) throw new Error('run 状态 permit 必须是路径。');
  if (typeof r.ledgerDir !== 'string' || !r.ledgerDir.trim()) throw new Error('run 状态 ledgerDir 必须是路径。');
}

/**
 * task-init 核心：校验 task config 与 permit，生成 runId，原子写入 run 状态文件。
 * 返回绑定结果。文件已存在（同 job 同秒）时失败，不覆盖。
 */
export async function initRun(): Promise<RunState> {
  const { task, permit, permitFile } = await checkTaskConfig();
  ensureAppDataLayout();
  const now = new Date();
  const runId = generateRunId(task.job, now);
  const file = runStateFile(runId);
  const run: RunState = {
    schemaVersion: 1,
    runId,
    createdAt: now.toISOString(),
    job: task.job,
    scope: task.scope,
    permit: permitFile,
    flowState: flowStatePath(),
    ledgerDir: join(APP_HOME, 'ledgers'),
    cliVersion: COMPATIBILITY.cliVersion,
    skillVersion: COMPATIBILITY.skillVersion,
    compatibilityId: COMPATIBILITY.compatibilityId,
    stop: task.stop,
  };
  let handle;
  try {
    handle = await open(file, 'wx');
    await handle.writeFile(JSON.stringify(run, null, 2) + '\n', 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`run 状态文件已存在（同岗位同秒重复启动）：${file}；如需新实例请稍后重试或换岗位。`);
    }
    throw new Error(`写入 run 状态失败：${file}；${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await handle?.close();
  }
  validateRunState(run);
  return run;
}