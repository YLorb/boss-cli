import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// RUNS_DIR 在 config.ts 模块加载时固化，且 ESM 缓存使二次 import 不重新求值。
// 因此在顶层一次性设 BOSS_RUNS_DIR 指向临时目录并 import，所有测试共享该隔离目录。
const runsDir = await mkdtemp(join(tmpdir(), 'run-'));
process.env.BOSS_RUNS_DIR = runsDir;
process.env.BOSS_SKILL_DIR = process.env.BOSS_SKILL_DIR ?? join(process.cwd(), 'skills', 'boss-recruitment');
const runState = await import('../dist/cli/run_state.js');

test.after(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

async function setupTask(t, dir, job = '岗位 A') {
  const permitFile = join(dir, 'permit.json');
  await writeFile(permitFile, JSON.stringify({ schemaVersion: 1, job, entry: 'collect', allowed: { send: [] } }));
  const taskFile = join(dir, 'task.json');
  await writeFile(taskFile, JSON.stringify({
    schemaVersion: 1, job, scope: 'collect', permit: permitFile,
    stop: { observeLimit: 20, contactLimit: 5, deadline: '2026-11-08T19:00:00Z', maxConsecutiveFailures: 3 },
  }));
  const prev = process.env.BOSS_TASK_CONFIG;
  process.env.BOSS_TASK_CONFIG = taskFile;
  t.after(() => { process.env.BOSS_TASK_CONFIG = prev; });
  return { permitFile, taskFile };
}

test('generateRunId: deterministic job-hash prefix + timestamp', () => {
  const a = runState.generateRunId('岗位 A', new Date('2026-11-08T11:22:33Z'));
  const b = runState.generateRunId('岗位 A', new Date('2026-11-08T11:22:33Z'));
  const c = runState.generateRunId('岗位 B', new Date('2026-11-08T11:22:33Z'));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-f0-9]{12}-/);
});

test('initRun: writes run state binding permit/flow-state/ledger/actual-version/stop', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'task-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { permitFile } = await setupTask(t, dir);
  const run = await runState.initRun(new Date('2026-11-08T11:22:33Z'));
  assert.equal(run.job, '岗位 A');
  assert.equal(run.scope, 'collect');
  assert.equal(run.permit, permitFile);
  assert.equal(run.schemaVersion, 1);
  assert.equal(run.stop.observeLimit, 20);
  assert.equal(run.stop.contactLimit, 5);
  assert.equal(run.stop.maxConsecutiveFailures, 3);
  assert.equal(run.stop.deadline, '2026-11-08T19:00:00Z');
  assert.ok(run.ledgerDir.endsWith('ledgers'));
  assert.ok(run.cliVersion && run.skillVersion);
  // flowState 必填：未设 BOSS_FLOW_STATE 时生成确定性默认路径
  assert.ok(run.flowState.endsWith(`${run.runId}.flow.json`));
  const saved = JSON.parse(await readFile(runState.runStateFile(run.runId), 'utf8'));
  assert.equal(saved.runId, run.runId);
  // 不污染真实 runs 目录：run 文件写在隔离的临时 runsDir 下
  assert.ok(runState.runStateFile(run.runId).startsWith(runsDir));
});

test('initRun: task config scope mismatch fails before writing run file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'task-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const permitFile = join(dir, 'permit.json');
  await writeFile(permitFile, JSON.stringify({ schemaVersion: 1, job: '岗位 A', entry: 'collect', allowed: {} }));
  const taskFile = join(dir, 'task.json');
  await writeFile(taskFile, JSON.stringify({ schemaVersion: 1, job: '岗位 A', scope: 'search', permit: permitFile, stop: {} }));
  const prev = process.env.BOSS_TASK_CONFIG;
  process.env.BOSS_TASK_CONFIG = taskFile;
  t.after(() => { process.env.BOSS_TASK_CONFIG = prev; });
  await assert.rejects(() => runState.initRun(new Date('2026-11-08T11:22:34Z')), /scope.*不一致/);
});

test('activateRunBindings: consumes current pointer and fills env', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'task-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { permitFile } = await setupTask(t, dir);
  delete process.env.BOSS_RUN_PERMIT;
  delete process.env.BOSS_FLOW_STATE;
  delete process.env.BOSS_LEDGER_DIR;
  t.after(() => { delete process.env.BOSS_RUN_PERMIT; delete process.env.BOSS_FLOW_STATE; delete process.env.BOSS_LEDGER_DIR; });
  const run = await runState.initRun(new Date('2026-11-08T11:22:35Z'));
  // 清空后重新激活，验证自动填充
  delete process.env.BOSS_RUN_PERMIT;
  delete process.env.BOSS_FLOW_STATE;
  delete process.env.BOSS_LEDGER_DIR;
  const activated = await runState.activateRunBindings();
  assert.equal(activated.runId, run.runId);
  assert.equal(process.env.BOSS_RUN_PERMIT, permitFile);
  assert.equal(process.env.BOSS_FLOW_STATE, run.flowState);
  assert.equal(process.env.BOSS_LEDGER_DIR, run.ledgerDir);
});