// 统一启动：生成 runId，把 permit / flow-state / 账本目录 / 实际版本 绑定到本轮运行实例。
// 产物是 ~/.boss-cli/runs/<runId>.json 的只读状态文件 + current.json 指针；
// task config 本身不改。后续命令通过 activateRunBindings 消费绑定。
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile, unlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_HOME, RUNS_DIR, ensureAppDataLayout } from '../config.js';
import { checkTaskConfig, type TaskConfig } from './task_config.js';
import { checkSkillCompatibility } from './skill_compatibility.js';

export type RunState = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  job: string;
  scope: TaskConfig['scope'];
  permit: string;
  flowState: string;
  ledgerDir: string;
  cliVersion: string;
  skillVersion: string;
  compatibilityId: string;
  stop: TaskConfig['stop'];
};

export const CURRENT_RUN_FILE = join(RUNS_DIR, 'current.json');

function timestampId(d = new Date()): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 确定性 runId：job 哈希前缀 + 秒级时间戳。同 job 同秒重复生成由文件独占检测。 */
export function generateRunId(job: string, d = new Date()): string {
  return `${createHash('sha256').update(job).digest('hex').slice(0, 12)}-${timestampId(d)}`;
}

export function runStateFile(runId: string): string {
  return join(RUNS_DIR, `${runId}.json`);
}

/** 若未显式设置 BOSS_FLOW_STATE，则为本轮 run 生成确定性的 flow-state 路径。 */
export function defaultFlowStateFile(runId: string): string {
  return join(RUNS_DIR, `${runId}.flow.json`);
}

function validateRunState(value: unknown): asserts value is RunState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('run 状态必须是对象。');
  const r = value as Partial<RunState>;
  if (r.schemaVersion !== 1) throw new Error('run 状态 schemaVersion 必须为 1。');
  if (typeof r.runId !== 'string' || !r.runId.trim()) throw new Error('run 状态 runId 必须是非空字符串。');
  if (typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt))) throw new Error('run 状态 createdAt 必须是时间字符串。');
  if (typeof r.job !== 'string' || !r.job.trim()) throw new Error('run 状态 job 必须是非空字符串。');
  if (typeof r.permit !== 'string' || !r.permit.trim()) throw new Error('run 状态 permit 必须是路径。');
  if (typeof r.flowState !== 'string' || !r.flowState.trim()) throw new Error('run 状态 flowState 必须是路径。');
  if (typeof r.ledgerDir !== 'string' || !r.ledgerDir.trim()) throw new Error('run 状态 ledgerDir 必须是路径。');
  if (typeof r.cliVersion !== 'string' || !r.cliVersion) throw new Error('run 状态 cliVersion 必须是非空字符串。');
  if (typeof r.skillVersion !== 'string' || !r.skillVersion) throw new Error('run 状态 skillVersion 必须是非空字符串。');
}

/** 原子写：临时文件 + rename；失败保留原文件与临时文件，不留半截目标。 */
async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  try {
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/** 用 link 独占创建文件：先写完整临时文件，再 link 到目标；目标已存在则 link 抛 EEXIST，不覆盖。 */
async function createExclusive(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  try {
    await link(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/**
 * task-init 核心：校验 task config 与 permit、核验实际 Skill 版本，生成 runId，
 * 写入 run 状态文件 + current 指针。返回绑定结果。文件已存在（同 job 同秒）时失败。
 */
export async function initRun(at: Date = new Date()): Promise<RunState> {
  const { task, permit, permitFile } = await checkTaskConfig();
  const compat = await checkSkillCompatibility();
  if (!compat.compatible) {
    throw new Error(`版本不匹配，无法初始化运行实例：${JSON.stringify(compat.actual)} vs ${JSON.stringify(compat.expected)}。请先完成版本确认。`);
  }
  // compatible=true 已保证 skillVersion/compatibilityId 非空（与 COMPATIBILITY 常量相等）。
  const skillVersion = compat.actual.skillVersion;
  const compatibilityId = compat.actual.compatibilityId;
  if (!skillVersion || !compatibilityId) {
    throw new Error('Skill 版本元数据缺失，无法初始化运行实例。');
  }
  ensureAppDataLayout();
  const now = at;
  const runId = generateRunId(task.job, now);
  const file = runStateFile(runId);
  const run: RunState = {
    schemaVersion: 1,
    runId,
    createdAt: now.toISOString(),
    job: task.job,
    scope: task.scope,
    permit: permitFile,
    flowState: process.env.BOSS_FLOW_STATE?.trim() || defaultFlowStateFile(runId),
    ledgerDir: process.env.BOSS_LEDGER_DIR?.trim() || join(APP_HOME, 'ledgers'),
    cliVersion: compat.actual.cliVersion,
    skillVersion,
    compatibilityId,
    stop: task.stop,
  };
  validateRunState(run);
  try {
    await createExclusive(file, run);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`run 状态文件已存在（同岗位同秒重复启动）：${file}；如需新实例请稍后重试或换岗位。`);
    }
    throw new Error(`写入 run 状态失败：${file}；${error instanceof Error ? error.message : String(error)}`);
  }
  // 指针文件：记录当前 runId，供后续命令 activateRunBindings 消费。
  await atomicWriteJson(CURRENT_RUN_FILE, { runId, at: now.toISOString() });
  return run;
}

/**
 * 消费机制：命令入口调用，加载 current 指针指向的 run 状态，把绑定填入进程环境变量
 * （仅在对应 env 未显式设置时），从而自动启用 permit / flow-state / 账本目录。
 */
export async function activateRunBindings(): Promise<RunState | null> {
  let pointer: { runId?: string };
  try {
    pointer = JSON.parse(await readFile(CURRENT_RUN_FILE, 'utf8'));
  } catch {
    return null; // 无 current 指针，未做过 task-init，保持原行为
  }
  const runId = pointer?.runId;
  if (typeof runId !== 'string' || !runId) return null;
  let run: unknown;
  try {
    run = JSON.parse(await readFile(runStateFile(runId), 'utf8'));
  } catch {
    return null;
  }
  validateRunState(run);
  if (!process.env.BOSS_RUN_PERMIT) process.env.BOSS_RUN_PERMIT = run.permit;
  if (!process.env.BOSS_FLOW_STATE) process.env.BOSS_FLOW_STATE = run.flowState;
  if (!process.env.BOSS_LEDGER_DIR) process.env.BOSS_LEDGER_DIR = run.ledgerDir;
  return run;
}