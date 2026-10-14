import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import vm from 'node:vm';

let scenario = {};
let disconnected = 0;
const visibleElement = { getClientRects: () => [1], textContent: '账号' };
mock.module('puppeteer-core', { defaultExport: { connect: async () => {
  if (scenario.connectionError) throw new Error('connection refused');
  return {
    waitForTarget: async predicate => {
      if (scenario.noTab) throw new Error('No BOSS target');
      assert.equal(predicate({ type: () => 'page', url: () => 'https://www.zhipin.com.evil.test/' }), false);
      assert.equal(predicate({ type: () => 'page', url: () => scenario.url }), true);
      return { page: async () => ({ evaluate: async script => {
        if (scenario.detached) throw new Error('detached Frame');
        assert.equal(typeof script, 'string');
        return vm.runInNewContext(script, {
          location: new URL(scenario.url),
          getComputedStyle: () => ({ visibility: 'visible' }),
          document: {
            querySelector: () => scenario.shell ? visibleElement : null,
            querySelectorAll: selector => selector.startsWith('header,') ? [] : [],
          },
        });
      } }) };
    },
    disconnect: async () => { disconnected++; },
  };
} } });
const { runCheckLogin } = await import('../dist/toolset/check_login.js');
const { executeCommand } = await import('../dist/cli/cliRouter.js');

test('CLI distinguishes visible workspace, login page, verification page and missing evidence', async () => {
  for (const [path, shell, status, loggedIn] of [
    ['/web/chat/index', true, 'logged-in', true],
    ['/web/user/', false, 'logged-out', false],
    ['/web/user/safe/verify', false, 'unknown', null],
    ['/web/passport/zp/verify.html', true, 'unknown', null],
    ['/web/chat/index', false, 'unknown', null],
    ['/', false, 'unknown', null],
  ]) {
    scenario = { url: `https://www.zhipin.com${path}`, shell };
    const before = disconnected;
    assert.deepEqual(JSON.parse(await executeCommand(['--check-login', '--json'])), { status, loggedIn, url: scenario.url });
    assert.equal(disconnected, before + 1);
  }
});

test('connection, missing-tab and detached-frame failures are errors, not logged-out', async () => {
  for (const kind of ['connectionError', 'noTab', 'detached']) {
    scenario = { url: 'https://www.zhipin.com/web/chat/index', [kind]: true };
    const before = disconnected;
    await assert.rejects(runCheckLogin(true));
    assert.equal(disconnected, before + (kind === 'connectionError' ? 0 : 1));
  }
});

test('text output and invalid flags', async () => {
  scenario = { url: 'https://www.zhipin.com/web/user/' };
  assert.match(await executeCommand(['--check-login']), /^未登录\n/);
  await assert.rejects(executeCommand(['--check-login', 'extra']), /用法/);
});
