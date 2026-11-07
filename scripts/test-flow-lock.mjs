import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireFlowOpen,
  verifyFlowCandidate,
  releaseFlowOpen,
  recordFlowDecision,
  verifyFlowDecided,
  FlowLockError,
  flowStatePath,
} from '../dist/common/flow_state.js';

test('flow lock: acquire → verify same ok → verify different denied → release', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-lock-'));
  const path = join(dir, 'flow.json');
  process.env.BOSS_FLOW_STATE = path;
  try {
    assert.equal(flowStatePath(), path);
    await acquireFlowOpen(path, 'id-A', '张三');
    await verifyFlowCandidate(path, 'id-A', '张三'); // 同一人复用，不拒绝
    await assert.rejects(() => verifyFlowCandidate(path, 'id-B', '李四'), FlowLockError);
    await releaseFlowOpen(path);
    await verifyFlowCandidate(path, 'id-B', '李四'); // 解锁后可处理下一人
  } finally {
    delete process.env.BOSS_FLOW_STATE;
    await rm(dir, { recursive: true, force: true });
  }
});

test('flow lock: missing state file starts empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-lock-'));
  const path = join(dir, 'flow.json');
  await verifyFlowCandidate(path, 'id-A', '张三'); // 不抛
  await rm(dir, { recursive: true, force: true });
});

test('flow lock: corrupt state file fails closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-lock-'));
  const path = join(dir, 'flow.json');
  await writeFile(path, '{ not valid json', 'utf8');
  await assert.rejects(() => verifyFlowCandidate(path, 'id-A', '张三'), FlowLockError);
  await rm(dir, { recursive: true, force: true });
});

test('evaluate-before-contact: only decide fit unlocks greet', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-decide-'));
  const path = join(dir, 'flow.json');
  try {
    await acquireFlowOpen(path, 'id-A', '张三');
    await assert.rejects(() => verifyFlowDecided(path, 'id-A', '张三'), FlowLockError); // 未评估
    await recordFlowDecision(path, 'id-A', 'unknown');
    await assert.rejects(() => verifyFlowDecided(path, 'id-A', '张三'), FlowLockError); // unknown
    await recordFlowDecision(path, 'id-A', 'not-fit');
    await assert.rejects(() => verifyFlowDecided(path, 'id-A', '张三'), FlowLockError); // not-fit
    await recordFlowDecision(path, 'id-A', 'fit');
    await verifyFlowDecided(path, 'id-A', '张三'); // fit 放行
    await releaseFlowOpen(path);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('decide requires the currently-open candidate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-decide2-'));
  const path = join(dir, 'flow.json');
  try {
    await acquireFlowOpen(path, 'id-A', '张三');
    await assert.rejects(() => recordFlowDecision(path, 'id-B', 'fit'), FlowLockError);
    await releaseFlowOpen(path);
    await assert.rejects(() => recordFlowDecision(path, 'id-A', 'fit'), FlowLockError);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
