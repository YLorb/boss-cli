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
  verifyFlowNotReplayed,
  verifyFlowNotPaused,
  pauseFlow,
  clearFlowPause,
  consecutiveActionFailures,
  flowWatch,
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
    await assert.rejects(() => verifyFlowNotReplayed(path, 'id-A', '张三', 'greet'), FlowLockError);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('continuation: greet intent without result and greet-unknown-then-back are needs-verify', () => {
  const state = {
    version: 1,
    open: null,
    decided: { 'id-A': { verdict: 'fit', at: 't' }, 'id-B': { verdict: 'fit', at: 't' } },
    journal: [
      { candidateId: 'id-A', name: '张三', action: 'greet', phase: 'intent', at: 't' },
      { candidateId: 'id-B', name: '李四', action: 'greet', phase: 'intent', at: 't' },
      { candidateId: 'id-B', name: '李四', action: 'greet', phase: 'result', result: 'unknown', at: 't' },
      { candidateId: 'id-B', name: '李四', action: 'back', phase: 'result', result: 'success', at: 't' },
    ],
  };
  const report = deriveFlowContinuation(state);
  const a = report.candidates.find(c => c.candidateId === 'id-A');
  const b = report.candidates.find(c => c.candidateId === 'id-B');
  assert.equal(a.state, 'needs-verify'); // intent 无 result（中断）
  assert.equal(a.next, 'verify-greet');
  assert.equal(b.state, 'needs-verify'); // unknown 后 back success 仍需核验
  assert.equal(b.next, 'verify-greet');
});

test('re-open same candidate clears old decide and is not done', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-reopen-'));
  const path = join(dir, 'flow.json');
  try {
    await acquireFlowOpen(path, 'id-A', '张三');            // 第一次打开
    await recordFlowDecision(path, 'id-A', 'fit');          // 评估 fit
    await releaseFlowOpen(path);                            // 返回
    await recordJournalResult(path, 'id-A', '张三', 'back', 'success'); // 旧 back success
    await acquireFlowOpen(path, 'id-A', '张三');            // 重新打开（fresh 清旧 fit）
    await assert.rejects(() => verifyFlowDecided(path, 'id-A', '张三'), FlowLockError); // 旧 fit 不再被接受
    const report = deriveFlowContinuation(JSON.parse(readFileSync(path, 'utf8')));
    assert.equal(report.open.candidateId, 'id-A');
    assert.equal(report.open.state, 'continue');            // 不是 done
    assert.equal(report.open.next, 'decide');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pause gates candidate actions until resume', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-pause-'));
  const path = join(dir, 'flow.json');
  try {
    await pauseFlow(path, 'OCR服务错误');
    await assert.rejects(() => verifyFlowNotPaused(path), FlowLockError);
    await clearFlowPause(path);
    await verifyFlowNotPaused(path); // 恢复后不抛
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('consecutiveActionFailures counts trailing failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-consec-'));
  const path = join(dir, 'flow.json');
  try {
    await recordJournalIntent(path, 'id-A', '张三', 'preview');
    await recordJournalResult(path, 'id-A', '张三', 'preview', 'failed');
    await recordJournalIntent(path, 'id-A', '张三', 'preview');
    await recordJournalResult(path, 'id-A', '张三', 'preview', 'failed');
    assert.equal(await consecutiveActionFailures(path, 'preview'), 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('flowWatch reports paused and stalled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-watch-'));
  const path = join(dir, 'flow.json');
  try {
    await pauseFlow(path, 'OCR服务错误');
    assert.equal((await flowWatch(path)).state, 'paused');
    await clearFlowPause(path);
    assert.equal((await flowWatch(path, 1000)).state, 'ok');
    const old = new Date(Date.now() - 10_000).toISOString();
    await writeFile(path, JSON.stringify({ version: 1, open: null, decided: {}, journal: [], paused: null, lastProgressAt: old }), 'utf8');
    assert.equal((await flowWatch(path, 1000)).state, 'stalled');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('continuation: greet success but send unknown is needs-verify', () => {
  const state = {
    version: 1, open: null, decided: {},
    journal: [
      { candidateId: 'id-A', name: '张三', action: 'greet', phase: 'result', result: 'success', at: 't' },
      { candidateId: 'id-A', name: '张三', action: 'send', phase: 'result', result: 'unknown', at: 't' },
    ],
  };
  const report = deriveFlowContinuation(state);
  const a = report.candidates.find(c => c.candidateId === 'id-A');
  assert.equal(a.state, 'needs-verify');
  assert.equal(a.next, 'verify-send');
});

test('continuation: confirm-contact intent without result is needs-verify', () => {
  const state = {
    version: 1, open: null, decided: { 'id-A': { verdict: 'fit', at: 't' } },
    journal: [
      { candidateId: 'id-A', name: '张三', action: 'greet', phase: 'result', result: 'success', at: 't' },
      { candidateId: 'id-A', name: '张三', action: 'confirm-contact', phase: 'intent', at: 't' },
    ],
  };
  const report = deriveFlowContinuation(state);
  const a = report.candidates.find(c => c.candidateId === 'id-A');
  assert.equal(a.state, 'needs-verify');
  assert.equal(a.next, 'verify-confirm-contact');
});

test('flowWatch reports not-started when file missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-watch-missing-'));
  const path = join(dir, 'flow.json');
  try {
    assert.equal((await flowWatch(path)).state, 'not-started');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('continuation: confirm-contact success is done', () => {
  const state = {
    version: 1, open: null, decided: {},
    journal: [
      { candidateId: 'id-A', name: '张三', action: 'confirm-contact', phase: 'result', result: 'success', at: 't' },
    ],
  };
  const report = deriveFlowContinuation(state);
  const a = report.candidates.find(c => c.candidateId === 'id-A');
  assert.equal(a.state, 'done');
});

test('continuation: preview failed without open suggests preview', () => {
  const state = {
    version: 1, open: null, decided: {},
    journal: [
      { candidateId: 'id-A', name: '张三', action: 'preview', phase: 'intent', at: 't' },
      { candidateId: 'id-A', name: '张三', action: 'preview', phase: 'result', result: 'failed', at: 't' },
    ],
  };
  const report = deriveFlowContinuation(state);
  const a = report.candidates.find(c => c.candidateId === 'id-A');
  assert.equal(a.state, 'continue');
  assert.equal(a.next, 'preview');
});

test('replay: send unknown blocks re-send', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-send-replay-'));
  const path = join(dir, 'flow.json');
  try {
    await recordJournalIntent(path, 'id-A', '张三', 'send');
    await recordJournalResult(path, 'id-A', '张三', 'send', 'unknown');
    await assert.rejects(() => verifyFlowNotReplayed(path, 'id-A', '张三', 'send'), FlowLockError);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('replay: confirm-contact success blocks re-greet', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-confirm-replay-'));
  const path = join(dir, 'flow.json');
  try {
    await recordJournalIntent(path, 'id-A', '张三', 'confirm-contact');
    await recordJournalResult(path, 'id-A', '张三', 'confirm-contact', 'success');
    await assert.rejects(() => verifyFlowNotReplayed(path, 'id-A', '张三', 'greet'), FlowLockError);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
