import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  assertPermittedCommand,
  permitFilePath,
  PermitDeniedError,
  resolveAction,
  ALWAYS_ALLOWED,
} from '../dist/cli/permit.js';

async function withPermit(t, doc) {
  const dir = await mkdtemp(join(tmpdir(), 'permit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'permit.json');
  await writeFile(file, JSON.stringify(doc));
  const prev = process.env.BOSS_RUN_PERMIT;
  process.env.BOSS_RUN_PERMIT = file;
  t.after(() => { process.env.BOSS_RUN_PERMIT = prev; });
  return file;
}

test('permit disabled: everything passes', async () => {
  const prev = process.env.BOSS_RUN_PERMIT;
  delete process.env.BOSS_RUN_PERMIT;
  try {
    assert.equal(permitFilePath(), null);
    await assertPermittedCommand('send', ['send', '--text', 'hi']); // 不抛
  } finally {
    if (prev === undefined) delete process.env.BOSS_RUN_PERMIT;
    else process.env.BOSS_RUN_PERMIT = prev;
  }
});

test('permit: ALWAYS_ALLOWED commands pass without declaration', async t => {
  await withPermit(t, { schemaVersion: 1, allowed: {} });
  for (const cmd of ['status', 'check', 'flow-status', 'spec-list']) {
    await assertPermittedCommand(cmd, [cmd]); // 不抛
  }
  assert.ok(ALWAYS_ALLOWED.has('status'));
});

test('permit: declared command passes, undeclared fails-closed', async t => {
  await withPermit(t, { schemaVersion: 1, allowed: { send: [], preview: [] } });
  await assertPermittedCommand('send', ['send', '--text', 'hi']); // 放行
  await assert.rejects(() => assertPermittedCommand('greet', ['greet', '张三']), PermitDeniedError);
});

test('permit: action variant whitelist', async t => {
  await withPermit(t, { schemaVersion: 1, allowed: { action: ['resume'] } });
  await assertPermittedCommand('action', ['action', 'resume']); // 放行
  await assert.rejects(() => assertPermittedCommand('action', ['action', 'not-fit']), PermitDeniedError);
  await assert.rejects(() => assertPermittedCommand('action', ['action', 'wechat']), PermitDeniedError);
});

test('permit: missing/broken permit file fails closed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'permit-broken-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const prev = process.env.BOSS_RUN_PERMIT;
  process.env.BOSS_RUN_PERMIT = join(dir, 'none.json');
  t.after(() => { process.env.BOSS_RUN_PERMIT = prev; });
  await assert.rejects(() => assertPermittedCommand('send', ['send']), /不存在/);
  const file = join(dir, 'bad.json');
  await writeFile(file, '{ not json');
  process.env.BOSS_RUN_PERMIT = file;
  await assert.rejects(() => assertPermittedCommand('send', ['send']), /无效/);
});

test('permit: action option value is not mistaken for sub-action', async t => {
  await withPermit(t, { schemaVersion: 1, allowed: { action: ['resume'] } });
  // `--remark resume` 把 resume 当选项值，实际动作是 not-fit，必须拒绝
  await assert.rejects(() => assertPermittedCommand('action', ['action', '--remark', 'resume', 'not-fit']), PermitDeniedError);
  // 实际动作是 resume 时放行
  await assertPermittedCommand('action', ['action', 'resume']);
});

test('permit: action --type=resume is accepted as actual resume', async t => {
  await withPermit(t, { schemaVersion: 1, allowed: { action: ['resume'] } });
  await assertPermittedCommand('action', ['action', '--type=resume']);
  await assertPermittedCommand('action', ['action', '--type', 'resume']);
  // 别名 ask-resume 规范化为 request-attachment-resume
  await withPermit(t, { schemaVersion: 1, allowed: { action: ['request-attachment-resume'] } });
  await assertPermittedCommand('action', ['action', 'ask-resume']);
});

test('resolveAction: alias and option-value resolution', () => {
  assert.equal(resolveAction(['action', 'resume']), 'resume');
  assert.equal(resolveAction(['action', 'not-fit']), 'not-fit');
  assert.equal(resolveAction(['action', 'ask-resume']), 'request-attachment-resume');
  assert.equal(resolveAction(['action', '--type=resume']), 'resume');
  assert.equal(resolveAction(['action', '--remark', 'resume', 'not-fit']), 'not-fit');
  assert.equal(resolveAction(['action', 'unknown']), null);
});

test('permit: attachment command denial exits with code 2', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'permit-exit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'permit.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1, allowed: { send: [] } }));
  const child = spawn(process.execPath, ['dist/cli/index.js', 'probe-resume', '张三'],
    { env: { ...process.env, BOSS_RUN_PERMIT: file }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(resolve => child.once('close', resolve));
  assert.equal(code, 2, stderr);
});