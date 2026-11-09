import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const entry = resolve('scripts/resume-analysis-session.mjs');
function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'resume-analysis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const image = Buffer.from('synthetic-test-only');
  const imagePath = join(dir, 'image.png');
  const textPath = join(dir, 'text.txt');
  writeFileSync(imagePath, image);
  writeFileSync(textPath, '测试姓名\n岗位：开发\n城市：深圳\n邮箱：test@example.com\n年限：3年\n本科\nJava\n工作经历\n项目经历\n');
  const receipt = join(dir, 'receipt.json');
  writeFileSync(receipt, JSON.stringify({ status: 'completed', needsReview: false,
    imagePath, textPath, imageSha256: createHash('sha256').update(image).digest('hex'), ...overrides }));
  const output = join(dir, 'result');
  return { dir, output, run: (...args) => spawnSync(process.execPath, [entry, ...args, '--output', output], { encoding: 'utf8' }), receipt };
}
const mapped = { format: 'line-map', profile: [1, 2, 3, 4, 5], education: [6], skills: [7], employment: [8], projects: [[9]], issues: [] };

test('wrapper saves expanded source evidence and refuses overwriting results', t => {
  const f = fixture(t);
  assert.equal(f.run('start', '--receipt', f.receipt).status, 0);
  const finished = f.run('finish', '--result', JSON.stringify(mapped));
  assert.equal(finished.status, 0, finished.stderr);
  const result = JSON.parse(readFileSync(join(f.output, 'agent-result.json')));
  assert.equal(result.name, '测试姓名');
  assert.equal(result.experienceYears, 3);
  assert.deepEqual(result.projects, [[{ line: 9, text: '项目经历' }]]);
  assert.equal(result.mode, 'collect-only');
  assert.equal(JSON.parse(finished.stdout).ocrCalls, 0);
  assert.notEqual(f.run('finish', '--result', JSON.stringify(mapped)).status, 0);
});

test('rejects stale image hashes and review-required OCR', t => {
  for (const overrides of [{ imageSha256: 'wrong' }, { needsReview: true }]) {
    const f = fixture(t, overrides);
    assert.notEqual(f.run('start', '--receipt', f.receipt).status, 0);
  }
});

test('rejects out-of-range evidence instead of fabricating text', t => {
  const f = fixture(t);
  assert.equal(f.run('start', '--receipt', f.receipt).status, 0);
  const failed = f.run('finish', '--result', JSON.stringify({ ...mapped, education: [99] }));
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Invalid evidence line references/);
});

test('screen mode: builds rules and suggested, expands evidence', t => {
  const f = fixture(t);
  const spec = { schemaVersion: 1, job: '测试岗', mustHave: ['三年以上经验'], veto: ['外包'], bonus: ['Go'] };
  const specPath = join(f.dir, 'spec.json');
  writeFileSync(specPath, JSON.stringify(spec));
  assert.equal(f.run('start', '--receipt', f.receipt, '--spec', specPath).status, 0);
  const session = JSON.parse(readFileSync(join(f.output, 'session.json')));
  assert.deepEqual(session.rules.map(x => x.id), ['must-1', 'veto-1', 'bonus-1']);
  assert.equal(session.suggested.email.value, 'test@example.com');
  assert.equal(session.suggested.experienceYears.value, 3);
  const screen = { mode: 'screen', rules: [
    { id: 'must-1', verdict: 'pass', evidence: [5], note: '年限命中' },
    { id: 'veto-1', verdict: 'unknown', evidence: [], note: '未展示' },
    { id: 'bonus-1', verdict: 'fail', evidence: [] },
  ] };
  const finished = f.run('finish', '--result', JSON.stringify(screen));
  assert.equal(finished.status, 0, finished.stderr);
  const result = JSON.parse(readFileSync(join(f.output, 'agent-result.json')));
  assert.equal(result.mode, 'screen');
  assert.deepEqual(result.summary, { pass: 1, fail: 1, unknown: 1 });
  assert.equal(result.rules[0].evidence[0].text, '年限：3年');
  assert.equal(result.rules[1].note, '未展示');
  assert.equal(result.rules[2].note, '');
});

test('screen mode: rejects bad verdict and incomplete coverage', t => {
  const f = fixture(t);
  const spec = { schemaVersion: 1, job: '测试岗', mustHave: ['A'], veto: ['B'], bonus: ['C'] };
  const specPath = join(f.dir, 'spec.json');
  writeFileSync(specPath, JSON.stringify(spec));
  assert.equal(f.run('start', '--receipt', f.receipt, '--spec', specPath).status, 0);
  const badVerdict = { mode: 'screen', rules: [
    { id: 'must-1', verdict: 'maybe', evidence: [], note: '' },
    { id: 'veto-1', verdict: 'unknown', evidence: [], note: '' },
    { id: 'bonus-1', verdict: 'fail', evidence: [], note: '' },
  ] };
  assert.notEqual(f.run('finish', '--result', JSON.stringify(badVerdict)).status, 0);
  const incomplete = { mode: 'screen', rules: [
    { id: 'must-1', verdict: 'pass', evidence: [5], note: '' },
    { id: 'veto-1', verdict: 'unknown', evidence: [], note: '' },
  ] };
  assert.notEqual(f.run('finish', '--result', JSON.stringify(incomplete)).status, 0);
});
