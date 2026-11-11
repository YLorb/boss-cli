import { EventEmitter } from 'node:events';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

let version, configError, scope, deadline, pages, page, connects, disconnects, lockBusy, locks;
const chatUrl = 'https://www.zhipin.com/web/chat/index';
const loginUrl = 'https://www.zhipin.com/web/user/';
const versionModule = await import('../dist/cli/skill_compatibility.js');
const configModule = await import('../dist/cli/task_config.js');
mock.module('../dist/cli/skill_compatibility.js', { namedExports: {
  ...versionModule, checkSkillCompatibility: async () => version,
} });
mock.module('../dist/cli/task_config.js', { namedExports: {
  ...configModule,
  checkTaskConfig: async () => {
    if (configError) throw configError;
    return { task: { scope, stop: { deadline } } };
  },
} });
mock.module('../dist/common/boss_session_lock.js', { namedExports: {
  withBossSessionLock: async (action, waitMs) => {
    assert.equal(waitMs, 0);
    locks++;
    if (lockBusy) throw Error('BOSS session busy');
    return action();
  },
} });
mock.module('puppeteer-core', { defaultExport: { connect: async options => {
  assert.equal(options.defaultViewport, null);
  assert.equal(options.protocolTimeout, 10000);
  connects++;
  return {
    pages: async () => pages,
    disconnect: async () => { disconnects++; },
  };
} } });

const opened = [];
mock.module('../dist/toolset/recommend-chat.js', { namedExports: {
  openRecommendChat: async target => { opened.push(target); return '{}'; },
} });
mock.module('../dist/toolset/embedded-chat.js', { namedExports: {
  closeEmbeddedChat: async target => { opened.push(target); return '{}'; },
  inspectEmbeddedChat: async () => { throw Error('unexpected inspect'); },
  checkEmbeddedChat: async () => { throw Error('unexpected check'); },
  sendEmbeddedChat: async () => { throw Error('unexpected send'); },
} });

const { runPreflight } = await import('../dist/cli/preflight.js');
const { executeCommand, runOneCommand } = await import('../dist/cli/cliRouter.js');
const { findCommandSpec, renderCommandHelp } = await import('../dist/cli/command_spec.js');
const { jsonError } = await import('../dist/cli/output.js');

function reset(url = chatUrl, loggedIn = true) {
  version = { compatible: true };
  configError = undefined;
  scope = 'collect';
  deadline = undefined;
  connects = disconnects = locks = 0;
  lockBusy = false;
  page = new EventEmitter();
  const mainFrame = {};
  page.url = () => url;
  page.isClosed = () => false;
  page.mainFrame = () => mainFrame;
  page.evaluate = async script => {
    assert.equal(typeof script, 'string');
    return { loggedIn, url };
  };
  pages = [page];
}

test('preflight uses one existing browser connection and removes its navigation listener', async () => {
  reset();
  assert.deepEqual(await runPreflight(), { status: 'passed', next: { argv: ['task-init', '--json'] } });
  assert.deepEqual([locks, connects, disconnects], [1, 1, 1]);
  assert.equal(page.listenerCount('framenavigated'), 0);
});

test('version, config and deadline failures stop before locking or connecting', async () => {
  reset();
  version = { compatible: false, actual: { cliVersion: 'old' }, expected: { cliVersion: 'new' } };
  const mismatch = await runPreflight();
  assert.equal(mismatch.reason.code, 'VERSION_MISMATCH');
  assert.equal(mismatch.reason.details.actual.cliVersion, 'old');
  version = { compatible: true };
  configError = Error('bad permit');
  assert.equal((await runPreflight()).reason.code, 'TASK_CONFIG_INVALID');
  configError = undefined;
  deadline = '2000-01-01T00:00:00Z';
  assert.match((await runPreflight()).reason.message, /截止/);
  assert.deepEqual([locks, connects], [0, 0]);
});

test('occupied session, tab ambiguity, login, wrong page and navigation fail closed', async () => {
  reset();
  lockBusy = true;
  assert.match((await runPreflight()).reason.message, /busy/);
  assert.equal(connects, 0);
  lockBusy = false;
  pages = [page, page];
  assert.match((await runPreflight()).reason.message, /唯一 BOSS 标签页/);
  assert.equal(disconnects, 1);

  reset(loginUrl, false);
  assert.equal((await runPreflight()).reason.code, 'LOGIN_REQUIRED');
  reset(chatUrl, null);
  assert.equal((await runPreflight()).reason.code, 'LOGIN_STATE_UNKNOWN');
  reset('https://www.zhipin.com/web/chat/recommend');
  assert.equal((await runPreflight()).reason.code, 'PAGE_NOT_READY');
  scope = 'recommend';
  assert.equal((await runPreflight()).status, 'passed');

  reset();
  page.evaluate = async () => {
    page.emit('framenavigated', page.mainFrame());
    return { loggedIn: true, url: chatUrl };
  };
  assert.equal((await runPreflight()).reason.code, 'PAGE_CHANGED');
  assert.equal(page.listenerCount('framenavigated'), 0);
});

test('public preflight emits one JSON result and exit code 2 when blocked', async t => {
  reset(loginUrl, false);
  const output = t.mock.method(console, 'log', () => {});
  const previousCode = process.exitCode;
  try {
    await runOneCommand(['preflight', '--json']);
    assert.equal(process.exitCode, 2);
    assert.equal(output.mock.callCount(), 1);
    assert.equal(JSON.parse(output.mock.calls[0].arguments[0]).reason.code, 'LOGIN_REQUIRED');
  } finally {
    process.exitCode = previousCode;
  }
});

test('chat catalog variants pass the actual parser with the documented required names', async () => {
  const usage = findCommandSpec('chat').usage;
  const values = {
    卡片姓名: 'Synthetic Card', 实际姓名: 'Synthetic Name', ID: 'synthetic',
    岗位与城市: 'Synthetic City', 聊天岗位原文: 'Synthetic Role',
  };
  for (const [variant, option] of [['--recommend --open', ''], ['--embedded', '--close']]) {
    const documented = usage.split(' | ').find(example => example.includes(variant));
    const argv = documented.replace(' [--json]', '').replace('(--check|--close)', option)
      .match(/<[^>]+>|\S+/g).map(token => token.startsWith('<') ? values[token.slice(1, -1)] : token);
    await executeCommand([...argv, '--json']);
  }
  assert.deepEqual(opened.map(target => target.name), [values.卡片姓名, values.实际姓名]);
  assert.ok(renderCommandHelp().includes(usage));

  const incomplete = ['chat', '--embedded', '--close', '--candidate-id', 'synthetic', '--job', 'Synthetic', '--json'];
  await assert.rejects(executeCommand(incomplete), error => {
    assert.equal(JSON.parse(jsonError('chat', error)).error.usage, usage);
    return true;
  });
});
