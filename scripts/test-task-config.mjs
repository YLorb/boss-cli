import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTaskConfig, checkTaskConfig, taskConfigPath } from '../dist/cli/task_config.js';

async function writePermit(dir) {
  const file = join(dir, 'permit.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1, job: '岗位 A', entry: 'collect', allowed: { send: [] } }));
  return file;
}

async function writeTask(dir, overrides = {}) {
  const file = join(dir, 'task.json');
  const doc = { schemaVersion: 1, job: '岗位 A', scope: 'collect', permit: await writePermit(dir), stop: {}, ...overrides };
  await writeFile(file, JSON.stringify(doc));
  return { file, doc };
}

test('loadTaskConfig: valid config loads and cross-checks permit', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'task-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { file } = await writeTask(dir);
  const task = await loadTaskConfig(file);
  assert.equal(task.job, '岗位 A');
  assert.equal(task.scope, 'collect');
});

test('checkTaskConfig: returns task + permit report', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'task-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { file } = await writeTask(dir);
  const prev = process.env.BOSS_TASK_CONFIG;
  process.env.BOSS_TASK_CONFIG = file;
  t.after(() => { process.env.BOSS_TASK_CONFIG = prev; });
  const report = await checkTaskConfig();
  assert.equal(report.task.job, '岗位 A');
  assert.deepEqual(report.permit.allowed, { send: [] });
  assert.equal(report.permitFile, report.task.permit);
});

test('loadTaskConfig: scope/job mismatch with permit fails closed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'task-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // scope 与 permit.entry 不一致
  const { file } = await writeTask(dir, { scope: 'search' });
  const prev = process.env.BOSS_TASK_CONFIG;
  process.env.BOSS_TASK_CONFIG = file;
  t.after(() => { process.env.BOSS_TASK_CONFIG = prev; });
  await assert.rejects(() => checkTaskConfig(), /scope.*不一致/);
});

test('loadTaskConfig: invalid schema/stop fields fail closed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'task-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const permit = await writePermit(dir);
  const base = { schemaVersion: 1, job: '岗位 A', scope: 'collect', permit, stop: {} };
  const bad = [
    { ...base, schemaVersion: 2 },
    { ...base, scope: 'unknown' },
    { ...base, stop: { observeLimit: 0 } },
    { ...base, stop: { deadline: 'not-a-date' } },
    { ...base, permit: 'relative/permit.json' },
  ];
  for (const doc of bad) {
    const file = join(dir, `bad-${Math.random().toString(36).slice(2)}.json`);
    await writeFile(file, JSON.stringify(doc));
    await assert.rejects(() => loadTaskConfig(file));
  }
});

test('taskConfigPath: returns null when env unset', () => {
  const prev = process.env.BOSS_TASK_CONFIG;
  delete process.env.BOSS_TASK_CONFIG;
  try {
    assert.equal(taskConfigPath(), null);
  } finally {
    if (prev === undefined) delete process.env.BOSS_TASK_CONFIG;
    else process.env.BOSS_TASK_CONFIG = prev;
  }
});