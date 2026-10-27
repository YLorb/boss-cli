import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import puppeteer from 'puppeteer-core';

let page;
const order = [];
mock.module('../dist/common/boss_session_page.js', { namedExports: {
  withBossSessionPage: async (callback, options) => {
    assert.equal(options, undefined);
    return callback(page);
  },
} });
mock.module('../dist/toolset/target_chat.js', { namedExports: {
  ATTACHMENT_PREVIEW_CONTENT_SELECTOR: '.attachment-iframe',
  openConversationByTarget: async (_page, target) => { order.push(['open', target]); },
  assertSelectedConversation: async (_page, target) => { order.push(['assert', target]); },
  closeAttachmentPreview: async () => {},
} });
const { runProbeTargetResume } = await import('../dist/toolset/attachment.js');
const { runFullCandidateInventory } = await import('../dist/toolset/list.js');

test('probe distinguishes observed attachment and outgoing request from missing evidence', async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    page = await browser.newPage();
    const target = { name: '测试甲', dataId: '123' };
    await page.setContent(`<div class="chat-message-list">
      <div class="message-item"><div class="item-friend"><i class="resume-icon"></i><div class="message-card-top-title">测试.pdf</div></div></div>
      <div class="message-item"><div class="item-myself"><div class="text">方便发一份你的简历过来吗？</div></div></div>
    </div>`);
    const result = JSON.parse(await runProbeTargetResume(target));
    assert.equal(result.attachment, 'RECEIVED');
    assert.equal(result.attachmentName, '测试.pdf');
    assert.equal(result.request, 'SENT');
    await page.evaluate("document.querySelector('.item-myself .text').textContent = '你好，方便发一份你的简历过来吗？'");
    assert.equal(JSON.parse(await runProbeTargetResume(target)).request, 'SENT');
    assert.equal(result.download, null);
    assert.deepEqual(order.slice(-2).map(item => item[0]), ['open', 'assert']);
    await page.setContent(`<div class="chat-message-list"><div class="message-item"><div class="item-friend"><div class="text">方便发一份你的简历过来吗？</div></div></div></div>`);
    const missing = JSON.parse(await runProbeTargetResume(target));
    assert.equal(missing.attachment, 'NOT_OBSERVED');
    assert.equal(missing.request, 'NOT_OBSERVED');
    assert.equal(missing.scope, 'loaded-messages');
    await page.setContent(`<div class="chat-message-list" style="height:100px"><div class="message-item"><div class="item-friend"><i class="resume-icon"></i></div></div></div>`);
    await assert.rejects(runProbeTargetResume(target), /附件卡片缺少名称/);
  } finally { await browser.close(); }
});

test('full inventory starts at all/all, waits for the actual end marker and includes read rows', async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => void request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: `
      <div class="label-list"><span class="chat-label-item selected" title="全部">全部</span></div>
      <div class="chat-message-filter-left"><span class="active">全部</span><span>未读</span></div>
      <div class="chat-global-list"><div class="user-list" style="width:400px;height:300px;overflow:auto">
        <div class="geek-item" data-id="123"><span class="geek-name">测试甲</span><span class="source-job">岗位 A</span></div>
        <div class="geek-item" data-id="456"><span class="geek-name">测试乙</span><span class="source-job">岗位 B</span></div>
        <span class="bottom-text">没有更多了</span>
      </div></div>` }));
    await page.goto('https://www.zhipin.com/web/chat/index');
    const result = JSON.parse(await runFullCandidateInventory());
    assert.equal(result.category, 'all');
    assert.equal(result.filter, 'all');
    assert.deepEqual(result.candidates.map(row => row.dataId), ['123', '456']);
    assert.ok(result.candidates.every(row => row.unreadCount === 0));
    await page.evaluate("document.querySelector('.bottom-text').remove()");
    await assert.rejects(runFullCandidateInventory(), /结束标志/);
  } finally { await browser.close(); }
});
