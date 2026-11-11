import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock, test } from 'node:test';
import vm from 'node:vm';

let activePage;
mock.module('../dist/common/boss_session_page.js', {
  namedExports: { withBossSessionPage: async callback => callback(activePage) },
});
const { runNormalSearch, runSearchControl } = await import('../dist/toolset/normal-search.js');
const { assertFormalCommand } = await import('../dist/cli/formal_arguments.js');

function setup(labels, { withButton = true } = {}) {
  const events = [];
  const page = new EventEmitter();
  let menuOpen = false;
  let job = '当前岗位';
  const model = {
    $options: { name: 'SearchCandidatesIndex' }, loadding$: false, isInitPage$: false,
    params$: { jobId: 'original', cityName: '', city: '', keywords: '原关键词', page: 1 },
    renderList$: [],
  };
  const element = (textContent = '') => ({
    textContent, getClientRects: () => [{}], getAttribute: () => null, matches: () => false,
  });
  class HTMLInputElement {
    value = '原关键词';
    focus() {}
    getClientRects() { return [{}]; }
    dispatchEvent(event) {
      if (event.type === 'input') events.push(['keyword', this.value]);
    }
  }
  const input = new HTMLInputElement();
  const cityInput = { ...element(), value: '', click() {}, dispatchEvent() {} };
  const city = { ...element('深圳'), click() {
    events.push(['city', '深圳']);
    Object.assign(model.params$, { cityName: '深圳', city: '101280600' });
  }};
  const opener = { ...element(), get textContent() { return job; }, click() { menuOpen = !menuOpen; } };
  const rows = labels.map((label, index) => ({
    ...element(label), classList: { contains: () => false }, querySelector: () => null,
    click() {
      events.push(['job', label]);
      job = label;
      menuOpen = false;
      model.params$.jobId = 'job-' + index;
      input.value = '';
    },
  }));
  const button = { ...element('搜索'), click() {
    events.push(['submit', input.value]);
    const params = new URLSearchParams({ jobId: model.params$.jobId, page: '1' });
    if (model.params$.city) params.set('city', model.params$.city);
    if (input.value) params.set('keywords', input.value);
    model.params$.keywords = input.value || undefined;
    const request = { frame: () => frame, url: () => 'https://fixture.invalid/wapi/zpitem/web/boss/search/geeks.json?' + params };
    page.emit('request', request);
    page.emit('response', { request: () => request, ok: () => true, json: async () => ({ code: 0, zpData: { geeks: [] } }) });
  }};
  const document = {
    querySelectorAll(selector) {
      if (selector === '.search-container') return [{ __vue__: model }];
      if (selector === '.search-input') return [input];
      if (selector === '.empty-tips') return [element()];
      if (selector.endsWith('.search-current-job')) return [opener];
      if (selector.includes('search_select_job')) return menuOpen ? rows : [];
      if (selector.endsWith('.search-result-item')) return [city];
      if (selector.startsWith('button,')) return withButton ? [button] : [];
      return [];
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
  };
  const context = vm.createContext({
    document, HTMLInputElement, Event: class { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ visibility: 'visible' }),
  });
  const frame = {
    page: () => page,
    url: () => 'https://fixture.invalid/web/frame/search/',
    evaluate: async script => vm.runInContext(script, context),
    waitForFunction: async script => assert.ok(vm.runInContext(script, context), script),
    $$: async () => [{
      click: async () => {},
      evaluate: async fn => vm.runInContext('(' + fn.toString() + ')(cityInput)', context),
    }],
  };
  context.cityInput = cityInput;
  page.url = () => 'https://www.zhipin.com/web/chat/search';
  page.waitForSelector = async () => ({ contentFrame: async () => frame });
  page.keyboard = { type: async value => { cityInput.value = value; } };
  activePage = page;
  return events;
}

test('job selection prefers an exact match and accepts a unique prefix without selecting a city', async () => {
  for (const labels of [['后训练平台工程师', '后训练平台'], ['后训练平台工程师', '其他岗位']]) {
    const events = setup(labels);
    const result = JSON.parse(await runSearchControl({ action: 'job', value: '后训练平台' }, true));
    const expected = labels.includes('后训练平台') ? '后训练平台' : '后训练平台工程师';
    assert.equal(result.job, expected);
    assert.equal(result.city, '');
    assert.deepEqual(events, [['job', expected]]);
  }
});

test('ambiguous or unmatched jobs return options and leave the search unsubmitted', async () => {
  for (const [labels, reason] of [
    [['后训练平台工程师', '后训练平台负责人'], 'ambiguous'],
    [['后训练平台', '后训练平台'], 'ambiguous'],
    [['其他岗位'], 'not-found'],
  ]) {
    const events = setup(labels);
    const result = JSON.parse(await runNormalSearch('新关键词', true, { job: '后训练平台' }));
    assert.equal(result.status, 'needs-confirmation');
    assert.equal(result.submitted, false);
    assert.equal(result.reason, reason);
    assert.deepEqual(result.options, labels);
    assert.deepEqual(events, []);
    assert.equal(result.candidates, undefined);
  }
});

test('combined search sets the specified city, selects the job, clears the keyword, then clicks once', async () => {
  const events = setup(['后训练平台工程师']);
  const result = JSON.parse(await runNormalSearch('', true, { city: '深圳', job: '后训练平台' }));
  assert.deepEqual(events, [['city', '深圳'], ['job', '后训练平台工程师'], ['keyword', ''], ['submit', '']]);
  assert.equal(result.keyword, '');
  assert.equal(result.job, '后训练平台工程师');
  assert.deepEqual(result.candidates, []);
});

test('split submit allows empty city and keyword and uses a single search click', async () => {
  const events = setup(['后训练平台工程师']);
  await runSearchControl({ action: 'city', value: '' }, true);
  await runSearchControl({ action: 'job', value: '后训练平台' }, true);
  await runSearchControl({ action: 'keyword', value: '' }, true);
  const result = JSON.parse(await runSearchControl({ action: 'submit' }, true));
  assert.deepEqual(events, [['job', '后训练平台工程师'], ['keyword', ''], ['submit', '']]);
  assert.equal(result.submitted, true);
  assert.equal(result.city, '');
});

test('missing search button exposes the failure without submitting', async () => {
  const events = setup(['后训练平台工程师'], { withButton: false });
  await assert.rejects(runSearchControl({ action: 'submit' }, true), /搜索按钮缺失或不唯一/);
  assert.deepEqual(events, []);
});

test('formal search allows empty values in split and combined forms', () => {
  for (const args of [
    ['--city', ''], ['--keyword', ''], ['--job', '后训练平台'],
    ['', '--job', '后训练平台'], ['--city', '', '--job', '后训练平台'],
    ['关键词', '--job', '后训练平台'], ['--submit'],
  ]) assert.doesNotThrow(() => assertFormalCommand(['search', ...args, '--json']));
  assert.throws(() => assertFormalCommand(['search', '--job', '', '--json']));
});
