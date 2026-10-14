import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import puppeteer from 'puppeteer-core';

let page;
mock.module('../dist/common/boss_session_page.js', { namedExports: {
  withBossSessionPage: async callback => callback(page),
} });
mock.module('../dist/browser/index.js', { namedExports: {
  sleepRandom: async () => {}, SIDEBAR_NAV_AFTER_CLICK_MS: { min: 0, max: 0 },
} });
const { runListOpenPositions, waitForJobRowsReady } = await import('../dist/toolset/jd.js');

test('positions parses complete rows and rejects visible rows with missing titles instead of returning jobs=[]', async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => void request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html></html>' }));
    await page.goto('https://www.zhipin.com/web/chat/job/list');
    const row = `<div class="job-item-container" data-id="test-job">
      <div class="job-title"><div class="job-name">测试工程师</div><div class="job-labels">测试标签</div></div>
      <div class="job-status-wrapper"><span class="status-box">开放中</span></div>
      <div class="job-main-info-wrapper"><div class="info-labels"><span>本科</span><span>深圳</span></div></div>
      <div class="job-about-num-wrapper"><div class="inner-box"><span class="num">12</span><span class="num">3</span><span class="num">4</span></div></div>
    </div>`;
    await page.setContent(`<span class="total-num">共1个职位</span>${row}`);
    const result = JSON.parse(await runListOpenPositions({ json: true }));
    assert.deepEqual(result.jobs, [{ id: 'test-job', title: '测试工程师', label: '测试标签', status: '开放中',
      meta: ['本科', '深圳'], viewed: '12', chatted: '3', interested: '4' }]);
    await page.evaluate("document.querySelector('.job-about-num-wrapper .num').textContent = ''");
    await assert.rejects(runListOpenPositions({ json: true }), /状态或三项统计缺失/);
    await page.evaluate("document.querySelector('.job-about-num-wrapper .num').textContent = '12'");
    await page.evaluate("document.querySelector('.job-title .job-name').remove()");
    await assert.rejects(runListOpenPositions({ json: true }), /第 1 行缺少标题.*不能丢弃该行/);
    await page.setContent('<span class="total-num">共1个职位</span><div>页面结构已变更</div>');
    await assert.rejects(waitForJobRowsReady(page, 50), /未识别职位行，不能据此判定无职位.*main.total="共1个职位"/);
    // Statistics can mount before rows: wait for real rows instead of reporting an empty list.
    await page.evaluate(`setTimeout(() => document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(row)}), 100)`);
    assert.equal((await waitForJobRowsReady(page, 2000)).data.jobs[0].title, '测试工程师');
    // Parent statistics must not mask actual rows inside an iframe.
    await page.setContent('<span class="total-num">共1个职位</span><iframe></iframe>');
    const child = page.frames().find(frame => frame !== page.mainFrame());
    await child.setContent(row);
    assert.equal(JSON.parse(await runListOpenPositions({ json: true })).jobs[0].title, '测试工程师');
    await child.evaluate("document.querySelector('.job-status-wrapper').remove()");
    await assert.rejects(runListOpenPositions({ json: true }), /状态或三项统计缺失/);
  } finally { await browser.close(); }
});
