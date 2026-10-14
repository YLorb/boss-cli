import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import vm from 'node:vm';
mock.module('../dist/browser/index.js', { namedExports: {
  SIDEBAR_NAV_AFTER_CLICK_MS: { min: 0, max: 0 },
  sleepRandom: async () => {},
} });
const { clickBossSidebarMenuToPath } = await import('../dist/common/boss_sidebar_nav.js');

test('sidebar string scripts execute the click and verify the resulting pathname', async () => {
  let clicks = 0;
  const location = { pathname: '/web/chat/recommend' };
  class HTMLElement {
    getAttribute() { return '/web/chat/job/list'; }
    scrollIntoView() {}
    click() { clicks++; location.pathname = '/web/chat/job/list'; }
  }
  const context = { HTMLElement, document: { querySelectorAll: () => [new HTMLElement()] }, window: { location } };
  const page = {
    evaluate: async script => vm.runInNewContext(script, context),
    waitForFunction: async script => assert.equal(vm.runInNewContext(script, context), true),
  };
  await clickBossSidebarMenuToPath(page, '职位管理', '/web/chat/job/list');
  assert.equal(clicks, 1);
});

test('session waits for the initial page target before enumerating existing tabs', async () => {
  let ready = false;
  let created = 0;
  const page = { isClosed: () => false, url: () => 'https://www.zhipin.com/web/chat/index' };
  const browser = {
    connected: true,
    once() {},
    waitForTarget: async predicate => {
      const target = { type: () => 'page', page: async () => { ready = true; return page; } };
      assert.equal(predicate(target), true);
      return target;
    },
    pages: async () => ready ? [page] : [],
    newPage: async () => { created++; return page; },
  };
  mock.module('../dist/browser/cdp_browser.js', { namedExports: {
    connectBrowser: async () => browser,
    clearSpawnedChromeProcessRef: () => {},
  } });
  mock.module('../dist/common/boss_page_guards.js', { namedExports: {
    installBossBrowserPageGuards: async () => assert.equal(ready, true),
    installBossPageGuards: async () => {},
  } });
  const { ensureBrowserSession, getPageRef } = await import('../dist/browser/browser_session.js');
  await ensureBrowserSession();
  assert.equal(getPageRef(), page);
  assert.equal(created, 0);
});
