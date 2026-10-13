import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import puppeteer from 'puppeteer-core';

mock.module('../dist/browser/index.js', { namedExports: {
  LIST_FILTER_GAP_MS: { min: 0, max: 0 },
  LIST_MIN_BEFORE_EMPTY_OK_MS: 0,
  LIST_POLL_MS: { min: 0, max: 0 },
  sleepRandom: async () => {},
} });
const { ensureChatListReady } = await import('../dist/toolset/list.js');

test('list preparation switches category before filtering and clicks each changed control once', async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => void request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: `
      <div class="label-list"><div class="chat-label-item" title="全部">全部</div>
      <div class="chat-label-item selected" title="沟通中">沟通中</div></div>
      <div class="chat-message-filter-left"><span>全部</span><span class="selected">未读</span></div>
      <div class="geek-item">候选人</div>` }));
    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.evaluate(`(() => {
      window.clicks = [];
      document.querySelectorAll('.chat-label-item').forEach(el => el.onclick = () => {
        window.clicks.push('category:' + el.title);
        document.querySelectorAll('.chat-label-item').forEach(row => row.classList.remove('selected'));
        el.classList.add('selected');
      });
      document.querySelectorAll('.chat-message-filter-left span').forEach(el => el.onclick = () => {
        window.clicks.push('filter:' + el.textContent);
        document.querySelectorAll('.chat-message-filter-left span').forEach(row => row.classList.remove('selected'));
        el.classList.add('selected');
      });
    })()`);
    await ensureChatListReady(page, 'all', 'all');
    assert.deepEqual(await page.evaluate('window.clicks'), ['category:全部', 'filter:全部']);
    await ensureChatListReady(page, 'all', 'all');
    assert.deepEqual(await page.evaluate('window.clicks'), ['category:全部', 'filter:全部']);
    await ensureChatListReady(page, 'unread');
    assert.deepEqual(await page.evaluate('window.clicks'), ['category:全部', 'filter:全部', 'filter:未读']);
  } finally { await browser.close(); }
});
