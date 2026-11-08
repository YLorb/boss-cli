import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  setPhase,
  currentPhase,
  assertPermittedPhase,
  phaseStatePath,
  isPhaseDenied,
  PhaseDeniedError,
} from '../dist/cli/phase_state.js';

async function setup(t, phases) {
  const dir = await mkdtemp(join(tmpdir(), 'phase-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const taskFile = join(dir, 'task.json');
  await writeFile(taskFile, JSON.stringify({
    schemaVersion: 1, job: '岗位 A', scope: 'collect', permit: join(dir, 'permit.json'),
    stop: {},
    phases: phases ?? [
      { name: 'collect', allowed: { collect: [], list: [], chat: [], probe: [] } },
      { name: 'recommend', allowed: { recommend: [], preview: [], greet: [], decide: [] } },
    ],
  }));
  const phaseFile = join(dir, 'phase.json');
  const prevTask = process.env.BOSS_TASK_CONFIG;
  const prevPhase = process.env.BOSS_PHASE_STATE;
  process.env.BOSS_TASK_CONFIG = taskFile;
  process.env.BOSS_PHASE_STATE = phaseFile;
  t.after(() => {
    process.env.BOSS_TASK_CONFIG = prevTask;
    process.env.BOSS_PHASE_STATE = prevPhase;
  });
  return { phaseFile };
}

test('setPhase: validates phase name and writes state file', async t => {
  const { phaseFile } = await setup(t);
  const state = await setPhase('collect');
  assert.equal(state.phase, 'collect');
  assert.equal(await currentPhase(), 'collect');
  assert.equal(JSON.parse(await readFile(phaseFile, 'utf8')).phase, 'collect');
  await assert.rejects(() => setPhase('unknown'), PhaseDeniedError);
  await assert.rejects(() => setPhase('unknown'), /可用阶段/);
});

test('assertPermittedPhase: current phase whitelist enforced', async t => {
  await setup(t);
  await setPhase('collect');
  await assertPermittedPhase('list', ['list']); // collect 阶段允许 list
  await assertPermittedPhase('chat', ['chat', '张三']);
  await assert.rejects(() => assertPermittedPhase('greet', ['greet', '张三']), PhaseDeniedError); // recommend 阶段才允许
  await assert.rejects(() => assertPermittedPhase('greet', ['greet']), /阶段 collect 未授权/);
});

test('assertPermittedPhase: phase switch changes whitelist', async t => {
  await setup(t);
  await setPhase('collect');
  await assert.rejects(() => assertPermittedPhase('greet', ['greet']), PhaseDeniedError);
  await setPhase('recommend');
  await assertPermittedPhase('greet', ['greet', '张三']);
  await assert.rejects(() => assertPermittedPhase('list', ['list']), PhaseDeniedError);
});

test('assertPermittedPhase: not initialized fails closed', async t => {
  await setup(t);
  await assert.rejects(() => assertPermittedPhase('list', ['list']), /未初始化/);
});

test('assertPermittedPhase: disabled when env unset', async () => {
  const prev = process.env.BOSS_PHASE_STATE;
  delete process.env.BOSS_PHASE_STATE;
  try {
    assert.equal(phaseStatePath(), null);
    await assertPermittedPhase('greet', ['greet']); // 不抛
  } finally {
    if (prev === undefined) delete process.env.BOSS_PHASE_STATE;
    else process.env.BOSS_PHASE_STATE = prev;
  }
});

test('isPhaseDenied: matches by name', () => {
  const e = new PhaseDeniedError('x');
  assert.equal(isPhaseDenied(e), true);
  assert.equal(isPhaseDenied(new Error('x')), false);
});