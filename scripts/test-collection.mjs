import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Ledger } from '../dist/collection/ledger.js';
import { CollectionRunner } from '../dist/collection/runner.js';
import { runCommandProcess, AttachmentTimeoutError } from '../dist/cli/command_process.js';

async function directory(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'boss-collection-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const candidate = { dataId: '123', name: '测试甲' };
const probe = (target = candidate) => ({ ...target, attachment: 'NOT_OBSERVED', attachmentName: null,
  request: 'NOT_OBSERVED', requestEvidence: [], scope: 'loaded-messages', download: null });

test('reading is durable before activation; seven fields change only in memory until stop', async t => {
  const ledger = await Ledger.load(await directory(t), '岗位 A');
  assert.equal(JSON.parse(await readFile(ledger.file, 'utf8')).header.reading, true);
  ledger.add(candidate);
  ledger.decide('123', 'PASS');
  assert.equal(JSON.parse(await readFile(ledger.file, 'utf8')).candidates.length, 0);
  await ledger.stop();
  const saved = JSON.parse(await readFile(ledger.file, 'utf8'));
  assert.equal('reading' in saved.header, false);
  assert.equal(saved.candidates[0].decision, 'PASS');
  assert.equal(Object.keys(saved.candidates[0]).length, 7);
});

test('full job names retain city isolation and reject concurrent ownership', async t => {
  const dir = await directory(t);
  const first = await Ledger.load(dir, '全栈软件开发工程师 _ 深圳');
  await assert.rejects(Ledger.load(dir, '全栈软件开发工程师 _ 深圳'), /正在使用/);
  const second = await Ledger.load(dir, '全栈软件开发工程师 _ 西安');
  assert.notEqual(first.file, second.file);
  first.add(candidate);
  await first.stop();
  await second.stop();
  assert.equal(JSON.parse(await readFile(second.file, 'utf8')).candidates.length, 0);
});

test('failed screening removes the JSON entry including existing RECHECK records', async t => {
  const ledger = await Ledger.load(await directory(t), '岗位 A');
  ledger.add(candidate);
  ledger.recordFailure('123', new AttachmentTimeoutError('probe', 15_000));
  ledger.decide('123', 'FAIL');
  await ledger.stop();
  assert.deepEqual(JSON.parse(await readFile(ledger.file, 'utf8')).candidates, []);
});

test('timeout preserves decision and seven fields, does not retry in later ordinary rounds', async t => {
  const ledger = await Ledger.load(await directory(t), '岗位 A');
  ledger.add(candidate);
  ledger.decide('123', 'PASS');
  let calls = 0;
  const runner = new CollectionRunner(ledger, async args => {
    calls++;
    assert.equal(args[0], 'probe-resume');
    throw new AttachmentTimeoutError(args.join(' '), 15_000);
  });
  await runner.round('round');
  await runner.round('round');
  assert.equal(calls, 1);
  assert.equal(ledger.get('123').status, 'RECHECK');
  assert.equal(ledger.get('123').decision, 'PASS');
  assert.equal(Object.keys(ledger.get('123')).length, 7);
  assert.throws(() => ledger.decide('123', 'PASS'), /先复查/);
  await runner.round('recheck');
  assert.equal(calls, 2);
  assert.equal(ledger.get('123').status, 'RECHECK');
  await ledger.stop();
});

test('explicit recheck needs no unread list, reads once and preserves prior completed progress', async t => {
  const ledger = await Ledger.load(await directory(t), '岗位 A');
  ledger.add(candidate);
  ledger.decide('123', 'PASS');
  const download = { path: 'test.pdf', sha256: 'abc', bytes: 10 };
  ledger.recordProbe('123', { ...probe(), attachment: 'RECEIVED', attachmentName: 'test.pdf',
    request: 'SENT', requestEvidence: ['方便发一份你的简历过来吗？'], download });
  ledger.recordFailure('123', new Error('interrupted'));
  const calls = [];
  const runner = new CollectionRunner(ledger, async args => { calls.push(args); return JSON.stringify(probe()); });
  await runner.round('recheck');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes('--download'), false);
  assert.deepEqual(ledger.get('123').attachment.probe.download, download);
  assert.equal(ledger.get('123').attachment.probe.request, 'SENT');
  assert.equal(ledger.get('123').status, 'DOWNLOADED');
  await runner.round('round');
  assert.equal(calls.length, 1);
  await ledger.stop();
});

test('dirty startup blocks rounds; full reconciliation merges lost candidates only for its job', async t => {
  const dir = await directory(t);
  let ledger = await Ledger.load(dir, '岗位 A');
  ledger.add(candidate);
  await ledger.stop();
  ledger = await Ledger.load(dir, '岗位 A');
  ledger.add({ dataId: 'lost', name: '内存新增' });
  await ledger.abandon();
  ledger = await Ledger.load(dir, '岗位 A');
  assert.equal(ledger.recoveryRequired, true);
  const calls = [];
  const runner = new CollectionRunner(ledger, async args => {
    calls.push(args);
    return JSON.stringify(probe({ name: args[1], dataId: args[3] }));
  });
  await assert.rejects(runner.round('round'), /全量逐项对账/);
  await assert.rejects(runner.round('recheck'), /全量逐项对账/);
  await runner.round('reconcile', [{ ...candidate, job: '岗位 A' },
    { dataId: 'lost', name: '内存新增', job: '岗位 A' }, { dataId: 'other', name: '另一岗位', job: '岗位 B' }]);
  assert.equal(calls.length, 2);
  assert.equal(ledger.recoveryRequired, false);
  assert.deepEqual(ledger.entries().map(row => row.dataId), ['123', 'lost']);
  await ledger.stop();
});

test('incomplete reconciliation remains mandatory even after a requested stop and restart', async t => {
  const dir = await directory(t);
  let ledger = await Ledger.load(dir, '岗位 A');
  ledger.add(candidate);
  await ledger.stop();
  ledger = await Ledger.load(dir, '岗位 A');
  await ledger.abandon();
  ledger = await Ledger.load(dir, '岗位 A');
  const runner = new CollectionRunner(ledger, async () => { throw new AttachmentTimeoutError('probe', 15_000); });
  await assert.rejects(runner.round('reconcile', []), /未完成/);
  await ledger.stop();
  ledger = await Ledger.load(dir, '岗位 A');
  assert.equal(ledger.recoveryRequired, true);
  await ledger.stop();
});

test('ambiguous candidate pauses the round without advancing or changing the ledger', async t => {
  const ledger = await Ledger.load(await directory(t), '岗位 A');
  ledger.add(candidate); ledger.add({dataId:'456',name:'测试乙'});
  const before = structuredClone(ledger.entries());
  let calls=0;
  const runner = new CollectionRunner(ledger,async()=>{
    calls++;
    const error=new Error('重名，等待用户确认');error.name='CandidateSelectionRequired';throw error;
  });
  await assert.rejects(runner.round('round'),/重名/);
  assert.equal(calls,1);
  assert.deepEqual(ledger.entries(),before);
  await ledger.stop();
});

test('unexpected command error is exposed, records RECHECK, and stops this round', async t => {
  const ledger = await Ledger.load(await directory(t), '岗位 A');
  ledger.add(candidate);
  ledger.add({ dataId: '456', name: '测试乙' });
  let calls = 0;
  const runner = new CollectionRunner(ledger, async () => { calls++; throw new Error('identity mismatch'); });
  await assert.rejects(runner.round('round'), /identity mismatch/);
  assert.equal(calls, 1);
  assert.equal(ledger.get('123').status, 'RECHECK');
  await ledger.stop();
});

test('stop requested during a candidate waits for completion and skips subsequent candidates', async t => {
  const ledger = await Ledger.load(await directory(t), '岗位 A');
  ledger.add(candidate);
  ledger.add({ dataId: '456', name: '测试乙' });
  let calls = 0;
  const runner = new CollectionRunner(ledger, async () => {
    calls++;
    runner.stopRequested = true;
    return JSON.stringify(probe());
  });
  await runner.round('round');
  assert.equal(calls, 1);
  await ledger.stop();
});

test('supervisor waits for worker exit, kills hangs, and exposes abnormal exits', async t => {
  const dir = await directory(t);
  const worker = path.join(dir, 'worker.mjs');
  const pidFile = path.join(dir, 'pid');
  await writeFile(worker, `import { writeFileSync } from 'node:fs';
    if (process.argv[2] === 'hang') { writeFileSync(process.argv[3], String(process.pid)); setInterval(()=>{}, 1000); }
    else if (process.argv[2] === 'crash') process.exit(7);
    else { process.send({text:'done'}); setTimeout(()=>process.exit(0), 200); }
  `);
  const start = Date.now();
  assert.equal(await runCommandProcess(['success'], 3000, pathToFileURL(worker)), 'done');
  assert.ok(Date.now() - start >= 200);
  await assert.rejects(runCommandProcess(['hang', pidFile], 700, pathToFileURL(worker)), AttachmentTimeoutError);
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  await assert.rejects(runCommandProcess(['crash'], 3000, pathToFileURL(worker)), /异常退出/);
});

test('real collect CLI persists an explicit stop; EOF preserves reading for recovery', async t => {
  const dir = await directory(t);
  async function session(job, explicitStop) {
    const child = spawn(process.execPath, ['dist/cli/index.js', 'collect', '--job', job, '--ledger-dir', dir],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const closed = new Promise(resolve => child.once('close', code => resolve(code)));
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    const started = JSON.parse((await lines.next()).value);
    child.stdin.write(JSON.stringify({ op: 'add', job, ...candidate }) + '\n');
    assert.equal(JSON.parse((await lines.next()).value).ok, true);
    if (explicitStop) {
      child.stdin.write('{"op":"stop"}\n');
      assert.equal(JSON.parse((await lines.next()).value).event, 'stopped');
    }
    child.stdin.end();
    assert.equal(await closed, explicitStop ? 0 : 1, stderr);
    return JSON.parse(await readFile(started.file, 'utf8'));
  }
  const stopped = await session('岗位 A', true);
  assert.equal(stopped.candidates.length, 1);
  assert.equal(stopped.header.reading, undefined);
  const abandoned = await session('岗位 B', false);
  assert.equal(abandoned.candidates.length, 0);
  assert.equal(abandoned.header.reading, true);
});
