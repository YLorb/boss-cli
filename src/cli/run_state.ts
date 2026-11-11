// 正式任务持久绑定：岗位账本跨轮共享，flow/phase 每轮独立；损坏记录必须拒绝。
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink, link } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';
import { APP_HOME, RUNS_DIR } from '../config.js';
import { checkTaskConfig, loadTaskConfig, taskConfigPath, canonicalTask, type TaskConfig } from './task_config.js';
import { checkSkillCompatibility } from './skill_compatibility.js';
export type RunState = {
  schemaVersion: 2; runId: string; createdAt: string; taskFile: string; taskHash: string; task: TaskConfig;
  job: string; scope: TaskConfig['scope']; permit: string; permitHash: string; flowState: string; phaseState: string | null; ledgerDir: string;
  cliVersion: string; skillVersion: string; skillDir: string; compatibilityId: string; stop: TaskConfig['stop'];
  /** cliVersion 就地续绑的审计轨迹；只记录构建号变化，不覆盖身份字段。 */
  versionHistory?: Array<{ at: string; from: string; to: string }>;
};
export const CURRENT_RUN_FILE = join(RUNS_DIR, 'current.json');
const RUN_ID = /^[a-f0-9]{12}-\d{8}-\d{6}$/;
let boundRun: RunState | null = null;
export function getBoundRun(): RunState | null { return boundRun; }
export function digest(value: unknown): string { return createHash('sha256').update(canonicalTask(value)).digest('hex'); }
export function generateRunId(job: string, d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${createHash('sha256').update(job).digest('hex').slice(0, 12)}-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
export function runStateFile(id: string): string {
  if (!RUN_ID.test(id)) throw new Error(`非法 runId：${id}`);
  return join(RUNS_DIR, `${id}.json`);
}
export function defaultFlowStateFile(id: string): string { runStateFile(id); return join(RUNS_DIR, `${id}.flow.json`); }
async function jsonFile(file: string): Promise<any> {
  try { return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error(`运行绑定文件不可读或 JSON 损坏：${file}；${String(error)}`); }
}
async function atomicJson(file: string, value: unknown, exclusive = false): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  try { if (exclusive) await link(temporary, file); else await rename(temporary, file); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
function bindings(run: RunState): Record<string, string | undefined> {
  return { BOSS_RUN_ID: run.runId, BOSS_TASK_CONFIG: run.taskFile, BOSS_RUN_PERMIT: run.permit, BOSS_FLOW_STATE: run.flowState, BOSS_PHASE_STATE: run.phaseState ?? undefined, BOSS_LEDGER_DIR: run.ledgerDir };
}
function applyBindings(run: RunState): void {
  for (const [key, value] of Object.entries(bindings(run))) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  boundRun = run;
}
/** 上一轮同岗位运行里已观察过的简历（id + 本地材料），用于 task-init --keep-observed 续用。 */
type CarriedObservation = { observed: string[]; material: Record<string, { image?: string; textPath?: string }> };
const EMPTY_CARRIED: CarriedObservation = Object.freeze({ observed: [], material: {} }) as CarriedObservation;

async function carryOverObservation(job: string): Promise<CarriedObservation> {
  try {
    const previousId = JSON.parse(await readFile(CURRENT_RUN_FILE, 'utf8')).runId;
    if (typeof previousId !== 'string' || !RUN_ID.test(previousId)) return EMPTY_CARRIED;
    const previous = await jsonFile(runStateFile(previousId)) as RunState;
    if (previous.job !== job || !previous.phaseState) return EMPTY_CARRIED;
    const phase = await jsonFile(previous.phaseState) as { observed?: unknown; material?: unknown };
    const observed = Array.isArray(phase.observed) ? phase.observed.filter((x): x is string => typeof x === 'string' && !!x) : [];
    const raw = phase.material && typeof phase.material === 'object' && !Array.isArray(phase.material) ? phase.material as Record<string, { image?: string; textPath?: string }> : {};
    const material: Record<string, { image?: string; textPath?: string }> = {};
    for (const id of observed) if (raw[id] && typeof raw[id] === 'object') material[id] = { ...raw[id] };
    console.error(`--keep-observed：从 ${previousId} 续用 ${observed.length} 条已观察记录（材料 ${Object.keys(material).length} 条）`);
    return { observed, material };
  } catch (error) {
    console.error(`--keep-observed：上一轮状态不可用，按空起重来（${String(error)}）`);
    return EMPTY_CARRIED;
  }
}

export async function initRun(at = new Date(), options: { keepObserved?: boolean } = {}): Promise<RunState> {
  const { task, permit, permitFile } = await checkTaskConfig();
  const taskFile = taskConfigPath()!;
  const compat = await checkSkillCompatibility();
  if (!compat.compatible || !compat.actual.skillVersion || !compat.actual.compatibilityId) throw new Error(`版本不匹配，无法初始化运行实例：${JSON.stringify(compat.actual)}`);
  const runId = generateRunId(task.job, at);
  const carried = options.keepObserved ? await carryOverObservation(task.job) : EMPTY_CARRIED;
  const run: RunState = { schemaVersion: 2, runId, createdAt: at.toISOString(), taskFile, taskHash: digest(task), task, job: task.job, scope: task.scope, permit: permitFile, permitHash: digest(permit), flowState: defaultFlowStateFile(runId), phaseState: join(RUNS_DIR, `${runId}.phase.json`), ledgerDir: task.ledgerDir ?? join(APP_HOME, 'ledgers'), cliVersion: compat.actual.cliVersion, skillVersion: compat.actual.skillVersion, skillDir: compat.skillDir, compatibilityId: compat.actual.compatibilityId, stop: task.stop };
  await mkdir(RUNS_DIR, { recursive: true });
  try { await atomicJson(runStateFile(runId), run, true); } catch (error) { throw new Error(`运行实例创建失败（同岗位同秒不可重复）：${runId}；${String(error)}`); }
  await atomicJson(run.phaseState!, { version: 2, phase: task.phases?.[0].name ?? 'task', at: at.toISOString(), runId, jobVerified: false, targets: task.targets ?? [], frozen: task.targets !== undefined, current: null, material: carried.material, decisions: {}, downloaded: [], downloads:{}, sent: [], contacts: [], observed: carried.observed, pending: null, safeRetries: {}, successes: 0, failures: 0, paused: null });
  await atomicJson(CURRENT_RUN_FILE, { runId, at: at.toISOString() });
  applyBindings(run);
  return run;
}
export async function activateRunBindings(): Promise<RunState | null> {
  let id = process.env.BOSS_RUN_ID?.trim();
  if (!id) {
    let raw: string;
    try { raw = await readFile(CURRENT_RUN_FILE, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { boundRun = null; return null; } throw new Error(`当前运行指针不可读：${CURRENT_RUN_FILE}；${String(error)}`); }
    try { id = JSON.parse(raw).runId; } catch (error) { throw new Error(`当前运行指针损坏：${CURRENT_RUN_FILE}；${String(error)}`); }
  }
  if (typeof id !== 'string' || !RUN_ID.test(id)) throw new Error(`当前运行指针 runId 无效：${String(id)}`);
  const run = await jsonFile(runStateFile(id)) as RunState;
  if (!run || typeof run !== 'object' || Array.isArray(run) || run.schemaVersion !== 2 || run.runId !== id || !run.task || digest(run.task) !== run.taskHash) throw new Error(`运行记录版本或任务快照无效：${id}；请明确重新 task-init。`);
  for (const file of [run.taskFile, run.permit, run.flowState, run.ledgerDir, run.skillDir, ...(run.phaseState ? [run.phaseState] : [])]) if (typeof file !== 'string' || !isAbsolute(file)) throw new Error(`运行绑定路径无效：${id}`);
  const task = await loadTaskConfig(run.taskFile);
  if (digest(task) !== run.taskHash || task.job !== run.job || task.scope !== run.scope || task.permit !== run.permit || digest(task.stop) !== digest(run.stop)) throw new Error(`任务配置已改变或错绑：${id}；请明确重新 task-init。`);
  if (run.flowState !== defaultFlowStateFile(id) || run.phaseState !== join(RUNS_DIR, `${id}.phase.json`) || run.ledgerDir !== (task.ledgerDir ?? join(APP_HOME, 'ledgers')) || generateRunId(task.job, new Date(run.createdAt)) !== id) throw new Error(`运行记录路径/身份错绑：${id}`);
  if (digest(await jsonFile(run.permit)) !== run.permitHash) throw new Error(`permit 已改变：${run.permit}；请明确重新 task-init。`);
  const compat = await checkSkillCompatibility();
  if (!compat.compatible) throw new Error(`运行版本绑定不匹配：${id}；Skill/CLI 自检未通过（${JSON.stringify(compat.actual)}）`);
  // 身份字段（Skill 目录 / Skill 版本 / 兼容协议）不一致 = 换了契约或换了安装位置，必须重新 task-init。
  const identityDrift: string[] = [];
  if (compat.skillDir !== run.skillDir) identityDrift.push(`skillDir 记录=${run.skillDir} 实际=${compat.skillDir}`);
  if (compat.actual.skillVersion !== run.skillVersion) identityDrift.push(`skillVersion 记录=${run.skillVersion} 实际=${compat.actual.skillVersion}`);
  if (compat.actual.compatibilityId !== run.compatibilityId) identityDrift.push(`compatibilityId 记录=${run.compatibilityId} 实际=${compat.actual.compatibilityId}`);
  if (identityDrift.length > 0) throw new Error(`运行版本绑定不匹配：${id}；${identityDrift.join('，')}；请明确重新 task-init。`);
  // 构建号（cliVersion）只是元数据：开发后缀每次 +1 不该作废整轮观察/材料。默认就地续绑并留审计轨迹，
  // 需要严格语义时设 BOSS_STRICT_VERSION_BIND=1 恢复旧行为。
  if (compat.actual.cliVersion !== run.cliVersion) {
    if (process.env.BOSS_STRICT_VERSION_BIND === '1') throw new Error(`运行版本绑定不匹配：${id}；cliVersion 记录=${run.cliVersion} 实际=${compat.actual.cliVersion}（BOSS_STRICT_VERSION_BIND=1 严格模式）`);
    const history = Array.isArray(run.versionHistory) ? run.versionHistory : [];
    history.push({ at: new Date().toISOString(), from: run.cliVersion, to: compat.actual.cliVersion });
    run.cliVersion = compat.actual.cliVersion;
    run.versionHistory = history;
    await atomicJson(runStateFile(id), run);
    console.error(`警告：CLI 版本漂移，已将运行 ${id} 就地续绑到 ${compat.actual.cliVersion}（观察/材料/未决保留）；严格模式设 BOSS_STRICT_VERSION_BIND=1`);
  }
  for (const [key, expected] of Object.entries(bindings(run))) {
    const actual=process.env[key]?.trim();
    const normalize=(s:string)=>process.platform==='win32'?resolve(s).toLowerCase():resolve(s);
    if(actual&&(expected===undefined||(key==='BOSS_RUN_ID'?actual!==expected:normalize(actual)!==normalize(expected))))throw new Error(`运行绑定冲突：${key}=${actual}，本轮要求 ${expected??'(未设置)'}`);
  }
  applyBindings(run);
  return run;
}
