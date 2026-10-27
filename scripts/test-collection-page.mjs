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
const {INVENTORY_STATE_SCRIPT}=await import('../dist/toolset/chat_inventory.js');

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
      <div class="chat-user"><div class="user-container"><div class="user-list b-scroll-stable" style="width:400px;height:300px;overflow:auto">
        <div class="geek-item" data-id="123"><span class="geek-name">测试甲</span><span class="source-job">岗位 A</span></div>
        <div class="geek-item" data-id="456"><span class="geek-name">测试乙</span><span class="source-job">岗位 B</span></div>
        <p class="load-tips">没有更多了</p>
      </div></div></div>` }));
    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.evaluate(`document.querySelector('.chat-user').__vue__={loading$:0,hasMore$:false,list$:[{uniqueId:'123'},{uniqueId:'456'}],topList$:[]}`);
    assert.equal(await page.$('.chat-global-list .user-list'),null,'real main-chat layout has no embedded-chat wrapper');
    const result = JSON.parse(await runFullCandidateInventory());
    assert.equal(result.category, 'all');
    assert.equal(result.filter, 'all');
    assert.deepEqual(result.candidates.map(row => row.dataId), ['123', '456']);
    assert.ok(result.candidates.every(row => row.unreadCount === 0));
    await page.evaluate("document.querySelector('.load-tips').remove()");
    await assert.rejects(runFullCandidateInventory(), /结束标志/);
  } finally { await browser.close(); }
});

test('inventory state rejects unknown/ambiguous structure and requires actual completion',async()=>{
 const browser=await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
 try {
  const p=await browser.newPage();
  const setup=async()=>{
   await p.setContent('<div class="chat-user" style="height:250px;width:350px"><div class="user-container"><div class="user-list" style="height:200px;width:350px;overflow:auto"><div class="geek-item" data-id="1">row</div><p class="load-tips">没有更多了</p></div></div></div>');
   await p.evaluate(`document.querySelector('.chat-user').__vue__={loading$:0,hasMore$:false,list$:[{uniqueId:'1'}],topList$:[]}`);
  };
  await setup();assert.equal((await p.evaluate(INVENTORY_STATE_SCRIPT)).end,true);
  await p.evaluate(`document.querySelector('.chat-user').__vue__.hasMore$=true`);
  assert.equal((await p.evaluate(INVENTORY_STATE_SCRIPT)).end,false,'footer text alone is not completion');
  await p.evaluate(`document.querySelector('.chat-user').__vue__.loading$=2`);
  assert.equal((await p.evaluate(INVENTORY_STATE_SCRIPT)).loading,true);
  await setup();await p.evaluate(`document.querySelector('.load-tips').classList.add('active')`);
  assert.equal((await p.evaluate(INVENTORY_STATE_SCRIPT)).end,false);
  await setup();await p.evaluate(`document.querySelector('.geek-item').style.height='900px'`);
  assert.equal((await p.evaluate(INVENTORY_STATE_SCRIPT)).end,false,'must reach bottom');
  await setup();await p.evaluate(`document.querySelector('.user-container').append(document.querySelector('.user-list').cloneNode(true))`);
  await assert.rejects(p.evaluate(INVENTORY_STATE_SCRIPT),/容器缺失或不唯一.*context/);
  await setup();await p.evaluate(`document.querySelector('.chat-user').__vue__={}`);
  await assert.rejects(p.evaluate(INVENTORY_STATE_SCRIPT),/加载状态缺失/);
  await setup();await p.evaluate(`document.querySelector('.user-list').remove()`);
  await assert.rejects(p.evaluate(INVENTORY_STATE_SCRIPT),/容器缺失/);
  await p.evaluate(`document.querySelector('.chat-user').__vue__.list$=[];document.querySelector('.user-container').innerHTML='<div class="common-no-data">暂无牛人</div>'`);
  assert.equal((await p.evaluate(INVENTORY_STATE_SCRIPT)).empty,true);
  await p.evaluate(`document.querySelector('.chat-user').__vue__.hasMore$=true`);
  await assert.rejects(p.evaluate(INVENTORY_STATE_SCRIPT),/零结果未确认/);
 }finally{await browser.close()}
});

test('inventory waits for next-page load and refuses incomplete virtual rows',async()=>{
 const browser=await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
 try {
  page=await browser.newPage();await page.setRequestInterception(true);
  page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<html></html>'}));
  await page.goto('https://www.zhipin.com/web/chat/index');
  await page.setContent('<div class="label-list"><span class="chat-label-item selected" title="全部">全部</span></div><div class="chat-message-filter-left"><span class="active">全部</span><span>未读</span></div><div class="chat-user"><div class="user-container"><div class="user-list" style="height:250px;width:400px;overflow:auto"><section></section><p class="load-tips">加载更多</p></div></div></div>');
  await page.evaluate(`(()=>{
   const v={loading$:0,hasMore$:true,list$:[],topList$:[]};document.querySelector('.chat-user').__vue__=v;
   const add=(start,end)=>{for(let i=start;i<=end;i++){v.list$.push({uniqueId:String(i)});const row=document.createElement('div');row.className='geek-item';row.dataset.id=String(i);row.style.height='80px';row.innerHTML='<span class="geek-name">测试'+i+'</span><span class="source-job">岗位 A</span>';document.querySelector('section').append(row)}};
   add(1,7);window.loads=0;const list=document.querySelector('.user-list');list.scrollTop=80;
   list.onscroll=()=>{if(list.scrollTop+list.clientHeight>=list.scrollHeight-2&&v.hasMore$&&v.loading$===0){window.loads++;v.loading$=2;setTimeout(()=>{add(8,12);v.hasMore$=false;v.loading$=0;document.querySelector('.load-tips').textContent='没有更多了'},120)}};
  })()`);
  const result=JSON.parse(await runFullCandidateInventory());
  assert.equal(result.candidates.length,12);assert.equal(await page.evaluate('window.loads'),1);
  await page.evaluate(`document.querySelector('.chat-user').__vue__.topList$.push({uniqueId:'hidden-pinned'})`);
  await assert.rejects(runFullCandidateInventory(),/缺少 1 个已加载会话/);
  await assert.rejects(runFullCandidateInventory(()=>true),/已停止/);
 }finally{await browser.close()}
});
