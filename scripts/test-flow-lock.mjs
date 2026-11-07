import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireFlowOpen,
  verifyFlowCandidate,
  releaseFlowOpen,
  recordFlowDecision,
  verifyFlowDecided,
  recordJournalIntent,
  recordJournalResult,
  deriveFlowContinuation,
  verifyFlowGreetNotReplayed,
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

test('journal records intent then result with evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-journal-'));
  const path = join(dir, 'flow.json');
  try {
    await acquireFlowOpen(path, 'id-A', '张三');
    await recordJournalIntent(path, 'id-A', '张三', 'greet');
    await recordJournalResult(path, 'id-A', '张三', 'greet', 'success');
    await recordJournalResult(path, 'id-A', '张三', 'decide', 'success', undefined, { verdict: 'fit' });
    const state = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(state.journal.length, 3);
    assert.equal(state.journal[0].phase, 'intent');
    assert.equal(state.journal[0].action, 'greet');
    assert.equal(state.journal[1].phase, 'result');
    assert.equal(state.journal[1].result, 'success');
    assert.deepEqual(state.journal[2].evidence, { verdict: 'fit' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('deriveFlowContinuation: done/continue/needs-verify', () => {
  const state = {
    version: 1,
    open: { candidateId: 'id-A', name: '张三', openedAt: 't' },
    decided: { 'id-A': { verdict: 'fit', at: 't' } },
    journal: [
      { candidateId: 'id-B', name: '李四', action: 'greet', phase: 'result', result: 'success', at: 't' },
      { candidateId: 'id-C', name: '王五', action: 'greet', phase: 'result', result: 'unknown', at: 't' },
      { candidateId: 'id-A', name: '张三', action: 'preview', phase: 'result', result: 'success', at: 't' },
    ],
  };
  const report = deriveFlowContinuation(state);
  const a = report.candidates.find(c => c.candidateId === 'id-A');
  const b = report.candidates.find(c => c.candidateId === 'id-B');
  const c = report.candidates.find(c => c.candidateId === 'id-C');
  assert.equal(a.state, 'continue');
  assert.equal(a.next, 'greet');
  assert.equal(b.state, 'done');
  assert.equal(c.state, 'needs-verify');
  assert.equal(report.open.candidateId, 'id-A');
});

test('greet replay guard: second greet denied', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-replay-'));
  const path = join(dir, 'flow.json');
  try {
    await acquireFlowOpen(path, 'id-A', '张三');
    await recordJournalIntent(path, 'id-A', '张三', 'greet');
    await recordJournalResult(path, 'id-A', '张三', 'greet', 'success');
    await assert.rejects(() => verifyFlowGreetNotReplayed(path, 'id-A', '张三'), FlowLockError);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
