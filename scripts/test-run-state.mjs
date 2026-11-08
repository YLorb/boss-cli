import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateRunId, initRun, runStateFile } from '../dist/cli/run_state.js';

async function setupTask(t, dir) {
  const permitFile = join(dir, 'permit.json');
  await writeFile(permitFile, JSON.stringify({ schemaVersion: 1, job: '岗位 A', entry: 'collect', allowed: { send: [] } }));
  const taskFile = join(dir, 'task.json');
  await writeFile(taskFile, JSON.stringify({
    schemaVersion: 1, job: '岗位 A', scope: 'collect', permit: permitFile,
    stop: { observeLimit: 20, contactLimit: 5, deadline: '2026-11-08T19:00:00Z', maxConsecutiveFailures: 3 },
  }));
  const prev = process.env.BOSS_TASK_CONFIG;
  process.env.BOSS_TASK_CONFIG = taskFile;
  t.after(() => { process.env.BOSS_TASK_CONFIG = prev; });
  return { permitFile, taskFile };
}

test('generateRunId: deterministic job-hash prefix + timestamp', () => {
  const a = generateRunId('岗位 A', new Date('2026-11-08T11:22:33Z'));
  const b = generateRunId('岗位 A', new Date('2026-11-08T11:22:33Z'));
  const c = generateRunId('岗位 B', new Date('2026-11-08T11:22:33Z'));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-f0-9]{12}-/);
});

test('initRun: writes run state file binding permit/flow-state/ledger/version/stop', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { permitFile } = await setupTask(t, dir);
  const run = await initRun();
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
  const saved = JSON.parse(await readFile(runStateFile(run.runId), 'utf8'));
  assert.equal(saved.runId, run.runId);
});

test('initRun: task config scope mismatch fails before writing run file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const permitFile = join(dir, 'permit.json');
  await writeFile(permitFile, JSON.stringify({ schemaVersion: 1, job: '岗位 A', entry: 'collect', allowed: {} }));
  const taskFile = join(dir, 'task.json');
  await writeFile(taskFile, JSON.stringify({ schemaVersion: 1, job: '岗位 A', scope: 'search', permit: permitFile, stop: {} }));
  const prev = process.env.BOSS_TASK_CONFIG;
  process.env.BOSS_TASK_CONFIG = taskFile;
  t.after(() => { process.env.BOSS_TASK_CONFIG = prev; });
  await assert.rejects(() => initRun(), /scope.*不一致/);
});