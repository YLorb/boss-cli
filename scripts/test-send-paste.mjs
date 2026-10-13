import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import puppeteer from 'puppeteer-core';

let page;
mock.module('../dist/common/boss_session_page.js', { namedExports: {
  withBossSessionPage: async callback => callback(page),
} });
const { runSendChatMessage } = await import('../dist/toolset/send.js');

test('real Chrome paste handles Unicode and multiline text; rejected paste never sends', async (t) => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  });
  try {
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => void request.respond({ status: 200, contentType: 'text/html', body:
      '<textarea id="boss-chat-editor-input"></textarea><div class="chat-message-list"></div>' }));
    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.evaluate(`(() => {
      window.pastes = 0; window.enters = 0; window.rejectPaste = false;
      const editor = document.querySelector('#boss-chat-editor-input');
      editor.addEventListener('paste', event => {
        window.pastes++; if (window.rejectPaste) event.preventDefault();
      });
      editor.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault(); window.enters++;
        const row = document.createElement('div'); row.className = 'item-myself';
        const text = document.createElement('div'); text.className = 'text';
        const span = document.createElement('span'); span.textContent = editor.value;
        text.append(span); row.append(text); document.querySelector('.chat-message-list').append(row);
      });
    })()`);
    const message = '中文“引号”与 emoji 🙏\n第二行  保留双空格';
    let result;
    try { result = JSON.parse(await runSendChatMessage({ text: message, json: true })); }
    catch (error) {
      t.diagnostic(JSON.stringify(await page.evaluate(`({text: document.querySelector('#boss-chat-editor-input').value,
        pastes: window.pastes, enters: window.enters, messages: Array.from(document.querySelectorAll('.text span')).map(el => el.textContent)})`)));
      throw error;
    }
    assert.equal(result.text, message);
    assert.deepEqual(await page.evaluate(`({text: document.querySelector('#boss-chat-editor-input').value,
      pastes: window.pastes, enters: window.enters})`), { text: message, pastes: 1, enters: 1 });
    await page.evaluate('window.rejectPaste = true');
    await assert.rejects(runSendChatMessage({ text: '粘贴失败必须停止' }), /Waiting failed|timeout/i);
    assert.equal(await page.evaluate('window.enters'), 1);
  } finally { await browser.close(); }
});
