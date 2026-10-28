import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

let activePage, locked = false, guards = 0;
mock.module('../dist/browser/browser_session.js', { namedExports: {
  ensureBrowserSession: async () => { assert.ok(locked); }, getBrowserRef: () => ({}),
  getPageRef: () => activePage, setSessionPage: p => { activePage = p; },
}});
mock.module('../dist/common/boss_session_lock.js', { namedExports: { withBossSessionLock: async fn => {
  assert.equal(locked, false); locked = true;
  try { return await fn(); } finally { locked = false; }
}}});
mock.module('../dist/common/boss_page_guards.js', { namedExports: { installBossPageGuards: async () => { assert.ok(locked); guards++; } }});
mock.module('../dist/browser/index.js', { namedExports: { RESUME_PREVIEW_OPEN_GAP_MS: { min: 0, max: 0 }, sleepRandom: async () => {} } });
mock.module('../dist/common/c_resume_capture.js', { namedExports: {
  C_RESUME_IFRAME_SELECTOR: 'iframe[src*="c-resume"]', closeCResumePanel: async () => { throw Error('unexpected panel close'); },
}});
const { runSearchMore, expandSearchPool, parseSearchMoreArgs } = await import('../dist/toolset/search-more.js');
const { runBack, backToPreviousPage } = await import('../dist/toolset/back.js');

const options = { maxScrolls: 3, maxCandidates: 10, timeoutMs: 1000 };
const card = (id, name = id) => ({ geekCard: { encryptGeekId: id, lid: 'lid-' + id, name } });
function fixture(batches = [[card('b')]], mode = '') {
  let url = 'https://www.zhipin.com/web/chat/search', scrolls = 0, top = 0;
  let data = [card('a')];
  const state = { $options: { name: 'SearchCandidatesIndex' }, loadding$: false, isInitPage$: false,
    params$: { keywords: 'Agent', jobId: 'job', page: 1 }, renderList$: data };
  class Input { value = 'Agent'; }
  const input = new Input();
  const page = new EventEmitter();
  const root = { clientHeight: 100, scrollHeight: 1000, get scrollTop() { return top; }, set scrollTop(value) {
    scrolls++; top = value;
    if (mode === 'no-response') return;
    const next = state.params$.page + 1;
    const req = { frame: () => frame, url: () => `https://www.zhipin.com/wapi/zpitem/web/boss/search/geeks.json?keywords=Agent&jobId=job&page=${mode === 'wrong-page' ? 1 : next}`,
      failure: () => ({ errorText: 'net::ERR_ABORTED' }) };
    page.emit('request', req);
    if (mode === 'duplicate-request') page.emit('request', req);
    if (mode === 'request-failed') { page.emit('requestfailed', req); return; }
    const batch = batches[scrolls - 1] ?? [];
    if (mode !== 'stale-dom') {
      const merged = new Map(data.map(c => [c.geekCard.encryptGeekId, c]));
      batch.forEach(c => merged.set(c.geekCard.encryptGeekId, c));
      data = [...merged.values()]; state.renderList$ = data;
      state.params$.page = next; root.scrollHeight += 1000;
    }
    if (mode === 'changed-query') input.value = 'changed';
    if (mode === 'changed-url') url = 'https://www.zhipin.com/web/chat/recommend';
    page.emit('response', { request: () => req, ok: () => mode !== 'http-error', status: () => 403,
      json: async () => ({ code: mode === 'api-error' ? 5003 : 0, zpData: { geeks: batch } }) });
  }};
  const document = {
    visibilityState: 'visible', scrollingElement: root,
    querySelector: s => s === '.search-input' ? input : null,
    querySelectorAll: s => {
      if (s === '.search-container') return [{ __vue__: state }];
      if (s !== '.geek-info-card') return [];
      return data.map(c => ({ __vue__: { $props: { geek: c } }, querySelectorAll: () => [],
        querySelector: sel => sel === '.name-label' ? { textContent: c.geekCard.name } : null }));
    },
  };
  const sandbox = { document, HTMLInputElement: Input };
  const evaluate = async script => {
    assert.equal(typeof script, 'string');
    return JSON.parse(JSON.stringify(vm.runInNewContext(script, sandbox)) ?? 'null');
  };
  const frame = { page: () => page, url: () => 'https://www.zhipin.com/web/frame/search/', evaluate,
    waitForFunction: async script => { if (!await evaluate(script)) throw Error('page predicate timeout'); } };
  Object.assign(page, { isClosed: () => false, url: () => url, frames: () => [frame], evaluate,
    waitForSelector: async () => ({ contentFrame: async () => frame }),
    goto: () => { throw Error('forbidden goto'); }, reload: () => { throw Error('forbidden reload'); },
    goBack: () => { throw Error('unexpected back'); },
  });
  activePage = page;
  return { page, state, input, root, scrolls: () => scrolls, setUrl: value => { url = value; } };
}

test('required bounded parameters reject missing, unknown, duplicate, noninteger and over-limit values', () => {
  assert.deepEqual(parseSearchMoreArgs(['--max-scrolls=2', '--max-candidates', '40']), { maxScrolls: 2, maxCandidates: 40, timeoutMs: 10000 });
  for (const args of [[], ['--max-scrolls', '1'], ['--max-scrolls', '21', '--max-candidates', '10'],
    ['--max-scrolls', '2.5', '--max-candidates', '10'], ['--max-scrolls', '2', '--max-candidates', '501'],
    ['--max-scrolls', '1', '--max-scrolls', '2', '--max-candidates', '10'], ['--reload'],
    ['--max-scrolls', '1', '--max-candidates', '10', '--timeout-ms', '0']]) assert.throws(() => parseSearchMoreArgs(args));
});

test('public runner holds the existing lock, installs guards, deduplicates IDs and stops on confirmed empty response', async () => {
  const f = fixture([[card('a'), card('b')], []]); const oldGuards = guards;
  const r = JSON.parse(await runSearchMore(options, true));
  assert.deepEqual(r.candidates.map(c => c.candidateId), ['a', 'b']);
  assert.equal(r.addedCount, 1); assert.equal(r.scrolls, 2); assert.equal(r.stopReason, 'empty-response');
  assert.equal(f.scrolls(), 2); assert.equal(guards, oldGuards + 1); assert.equal(locked, false);
  for (const event of ['request', 'response', 'requestfailed']) assert.equal(f.page.listenerCount(event), 0);
});

test('candidate cap includes starting cards and never scrolls after cap; batched excess is not returned', async () => {
  let f = fixture();
  let r = await expandSearchPool(f.page, { ...options, maxCandidates: 1 });
  assert.equal(f.scrolls(), 0); assert.equal(r.stopReason, 'max-candidates');
  f = fixture([[card('b'), card('c'), card('d')]]);
  r = await expandSearchPool(f.page, { ...options, maxCandidates: 2 });
  assert.equal(f.scrolls(), 1); assert.equal(r.candidates.length, 2); assert.equal(r.stopReason, 'max-candidates');
});

test('scroll cap and successful responses with only already seen IDs terminate without another scroll', async () => {
  let f = fixture([[card('b')], [card('c')]]);
  let r = await expandSearchPool(f.page, { ...options, maxScrolls: 1 });
  assert.equal(r.stopReason, 'max-scrolls'); assert.equal(f.scrolls(), 1);
  f = fixture([[card('a')]]); r = await expandSearchPool(f.page, options);
  assert.equal(r.stopReason, 'no-new-candidates'); assert.equal(f.scrolls(), 1);
});

test('network/API failures, changed conditions, wrong/duplicate requests and stale DOM stop after one attempt', async () => {
  for (const mode of ['http-error', 'api-error', 'request-failed', 'changed-query', 'changed-url', 'wrong-page', 'duplicate-request', 'stale-dom']) {
    const f = fixture([[card('b')]], mode);
    await assert.rejects(expandSearchPool(f.page, options), /搜索扩池失败/);
    assert.equal(f.scrolls(), 1, mode);
    for (const event of ['request', 'response', 'requestfailed']) assert.equal(f.page.listenerCount(event), 0, mode);
  }
});

test('no request is a timeout error, never an invented end-of-results or retry', async () => {
  const f = fixture([], 'no-response');
  await assert.rejects(expandSearchPool(f.page, options), /等待超时/);
  assert.equal(f.scrolls(), 1); assert.equal(f.page.listenerCount('request'), 0);
});

test('missing or ambiguous identities, identity changes, wrong page and unsupported scroll layout fail closed', async () => {
  let f = fixture([[card('a', 'different')]]);
  await assert.rejects(expandSearchPool(f.page, options), /姓名变化/);
  f = fixture(); f.state.renderList$[0].geekCard.encryptGeekId = '';
  await assert.rejects(expandSearchPool(f.page, options), /ID/); assert.equal(f.scrolls(), 0);
  f = fixture(); f.state.renderList$.push(card('a'));
  await assert.rejects(expandSearchPool(f.page, options), /重复/); assert.equal(f.scrolls(), 0);
  f = fixture(); f.setUrl('https://www.zhipin.com.evil.test/web/chat/search');
  await assert.rejects(expandSearchPool(f.page, options), /当前常规搜索页/); assert.equal(f.scrolls(), 0);
  f = fixture(); f.root.scrollHeight = 100;
  await assert.rejects(expandSearchPool(f.page, options), /没有可执行/); assert.equal(f.scrolls(), 0);
});

function historyFixture(mode = '') {
  const expected = 'https://www.zhipin.com/web/chat/search?from=test';
  let url = 'https://www.zhipin.com/web/chat/business/mine', index = 1, backs = 0, detached = 0, reads = 0;
  const entries = [{ id: 10, url: expected }, { id: 11, url }];
  const page = { isClosed: () => false, evaluate: async () => 'visible', frames: () => [], url: () => url,
    createCDPSession: async () => ({ send: async method => {
      assert.equal(method, 'Page.getNavigationHistory'); reads++;
      if (mode === 'race' && reads === 2) return { currentIndex: 0, entries };
      return { currentIndex: index, entries };
    }, detach: async () => { detached++; } }),
    goBack: async () => {
      backs++; if (mode === 'timeout') throw Error('back timeout');
      url = mode === 'redirect' ? 'https://www.zhipin.com/web/user/' : expected;
      index = mode === 'no-history-change' ? 1 : 0;
    }, goto: () => { throw Error('forbidden goto'); }, reload: () => { throw Error('forbidden reload'); },
  };
  activePage = page;
  return { page, expected, entries, backs: () => backs, detached: () => detached, setUrl: u => { url = u; } };
}

test('explicit back shares session lock and guards, uses one goBack and verifies history entry and exact URL', async () => {
  const f = historyFixture(); const before = guards;
  const r = JSON.parse(await runBack(false, true, f.expected));
  assert.equal(r.steps, 1); assert.equal(r.url, f.expected); assert.equal(f.backs(), 1); assert.equal(f.detached(), 1);
  assert.equal(guards, before + 1); assert.equal(locked, false);
});

test('untrusted target, wrong previous entry, same URL, verification page, history races and open panel stop before back', async () => {
  for (const setup of [
    f => { f.expected = 'https://evil.test/web/chat/search'; },
    f => { f.expected = 'https://www.zhipin.com/web/user/safe/verify'; },
    f => { f.entries[0].url = 'https://www.zhipin.com/web/chat/index'; },
    f => { f.setUrl(f.expected); f.entries[1].url = f.expected; },
    f => { f.setUrl('https://www.zhipin.com/web/user/safe/verify'); },
    f => { f.page.frames = () => [{ evaluate: async () => true }]; },
  ]) {
    const f = historyFixture(); setup(f);
    await assert.rejects(backToPreviousPage(f.page, f.expected)); assert.equal(f.backs(), 0);
  }
  const f = historyFixture('race'); await assert.rejects(backToPreviousPage(f.page, f.expected), /历史已变化/);
  assert.equal(f.backs(), 0); assert.equal(f.detached(), 1);
});

test('back timeout, redirected destination and unchanged history are errors with no second attempt', async () => {
  for (const mode of ['timeout', 'redirect', 'no-history-change']) {
    const f = historyFixture(mode); await assert.rejects(backToPreviousPage(f.page, f.expected));
    assert.equal(f.backs(), 1); assert.equal(f.detached(), 1);
  }
});
