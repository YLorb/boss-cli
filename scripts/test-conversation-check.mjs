import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

let listCalls = 0;
mock.module('../dist/toolset/list.js', { namedExports: {
  ensureChatListReady: async () => { listCalls++; },
  selectChatCategory: async () => { listCalls++; },
} });
const { openConversationByTarget, readSelectedConversation } = await import('../dist/toolset/target_chat.js');

test('readonly conversation checks work across CLI processes without global state or re-clicks', async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => void request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: `
      <div class="user-list" style="width:400px;height:300px">
        <div class="geek-item" data-id="123-0" style="height:50px"><span class="geek-name">甲</span></div>
        <div class="geek-item" data-id="456-0" style="height:50px"><span class="geek-name">乙</span></div>
      </div><div class="base-info-single-container"><span class="name-box"></span></div>` }));
    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.evaluate(`(() => {
      window.chatClicks = 0;
      document.querySelectorAll('.geek-item').forEach(row => row.addEventListener('click', () => {
        window.chatClicks++;
        document.querySelectorAll('.geek-item').forEach(el => el.classList.remove('selected'));
        row.classList.add('selected');
        document.querySelector('.name-box').textContent = row.querySelector('.geek-name').textContent;
      }));
    })()`);
    assert.equal((await readSelectedConversation(page)).count, 0);
    await openConversationByTarget(page, { name: '甲', dataId: '123-0' }, true);
    assert.equal((await readSelectedConversation(page)).dataId, '123-0');
    assert.equal(listCalls, 1);
    await openConversationByTarget(page, { name: '甲', dataId: '123-0' }, true);
    assert.equal(listCalls, 1);
    assert.equal(await page.evaluate('window.chatClicks'), 1);
    await assert.rejects(openConversationByTarget(page, { name: '错误姓名', dataId: '123-0' }, true), /身份校验失败/);
    assert.equal(listCalls, 1);

    // A fresh Node process reads current DOM without storing state or clicking any row.
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import puppeteer from 'puppeteer-core';
      import { readSelectedConversation } from './dist/toolset/target_chat.js';
      const b = await puppeteer.connect({ browserWSEndpoint: process.argv[1], defaultViewport: null });
      try { const p = (await b.pages()).find(p => p.url().includes('/web/chat/index'));
        process.stdout.write(JSON.stringify(await readSelectedConversation(p)));
      } finally { await b.disconnect(); }
    `, browser.wsEndpoint()], { encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout).dataId, '123-0');
    assert.equal(await page.evaluate("'__bossCliConversationState' in window"), false);
    assert.equal(await page.evaluate('window.chatClicks'), 1);

    await page.click('[data-id="456-0"]');
    assert.equal((await readSelectedConversation(page)).dataId, '456-0');
    await openConversationByTarget(page, { name: '乙', dataId: '456-0' }, true);
    assert.equal(listCalls, 1);
    await openConversationByTarget(page, { name: '乙', dataId: '456-0' });
    assert.equal(listCalls, 2); // No flag preserves explicit full positioning.
    await page.evaluate("document.querySelector('.name-box').textContent = '错误详情'");
    await assert.rejects(openConversationByTarget(page, { name: '乙', dataId: '456-0' }, true), /身份校验失败/);
    assert.equal(listCalls, 2);
    await page.evaluate("document.querySelector('[data-id=\"123-0\"]').classList.add('selected')");
    await assert.rejects(openConversationByTarget(page, { name: '乙', dataId: '456-0' }, true), /选中行数量异常/);
    assert.equal(listCalls, 2);
    await page.goto('https://www.zhipin.com/web/chat/index');
    assert.equal((await readSelectedConversation(page)).count, 0);
  } finally { await browser.close(); }
});
