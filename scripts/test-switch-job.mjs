import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { parseSwitchJobArgs as parseArgs, switchChatJob } from '../dist/toolset/switch-job.js';

test('reject invalid or ambiguous arguments before connecting', () => {
  for (const args of [[], ['--list', '--job', 'A'], ['--job'], ['--list', '--list'], ['--list', '--category', '全部'], ['--list', '--timeout-ms', 'NaN'], ['--list', '--cdp-url', 'http://example.com:9222']]) assert.throws(() => parseArgs(args));
  assert.equal(parseArgs(['--job', '岗位 _ 深圳']).job, '岗位 _ 深圳');
});

test('isolated DOM: exact job selection, no repeated click, fail closed on ambiguity and missing confirmation', async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => void request.respond({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.setContent(`<div class="chat-top-job"><div class="ui-dropmenu-label">岗位A _ 深圳</div><ul class="ui-dropmenu-list" hidden><li class="active">岗位A _ 深圳</li><li>岗位B _ 深圳</li><li>岗位B _ 上海</li><li>重复</li><li>重复</li><li class="disabled">关闭岗位</li><li>无响应</li></ul></div><button id="contact">联系</button>`);
    // Closed menus retain geometry; open state is the component's CSS class.
    await page.addStyleTag({content:'.ui-dropmenu-list[hidden] { display:block; opacity:0; pointer-events:none; }'});
    await page.evaluate(`(() => {
      const sidebar=document.createElement('div');sidebar.className='menu-list';
      sidebar.style='position:fixed;left:0;top:0;width:100px;height:100vh';document.body.append(sidebar);
      const background=document.createElement('div');background.style='position:fixed;left:100px;right:0;top:0;bottom:0';
      const list=document.createElement('div');list.className='chat-user';list.style='margin:80px 20px 0 80px;height:400px';
      list.append(document.querySelector('.chat-top-job'),document.querySelector('#contact'));
      background.append(list);document.body.append(background);
    })()`);
    await page.evaluate(`(() => {
      window.jobClicks=0; window.contactClicks=0;
      document.querySelector('#contact').onclick=()=>window.contactClicks++;
      const label=document.querySelector('.ui-dropmenu-label'), menu=document.querySelector('ul');
      let selected='岗位A _ 深圳';
      const close=()=>{menu.hidden=true;label.textContent=selected;label.parentElement.classList.remove('ui-dropmenu-visible')};
      label.onclick=()=>{
        if(!menu.hidden)return;
        menu.hidden=false;label.parentElement.classList.add('ui-dropmenu-visible');label.innerHTML='<input class="chat-job-search">';
        const input=label.querySelector('input');input.focus();
      };
      document.addEventListener('click',event=>{if(!label.parentElement.contains(event.target)){window.lastClickTrusted=event.isTrusted;window.blankClicks=(window.blankClicks||0)+1;close()}},true);
      menu.querySelectorAll('li').forEach(el=>el.onclick=()=>{window.jobClicks++;if(el.textContent==='无响应')return;setTimeout(()=>{
        selected=el.textContent;menu.querySelectorAll('li').forEach(item=>item.classList.toggle('active',item===el));close();
      },30)});
    })()`);
    const listed=await switchChatJob(page,{list:true}); assert.equal(listed.options.length,7);
    assert.equal(await page.evaluate('document.querySelector("ul").hidden'),true);
    assert.equal(await page.evaluate('window.jobClicks'),0);
    assert.equal(await page.evaluate('window.blankClicks'),1);
    assert.ok(listed.closeClick.x>=112 && listed.closeClick.x<=168);
    assert.equal(await page.evaluate('window.lastClickTrusted'),true);
    for(const viewport of [{width:1280,height:720,deviceScaleFactor:1},{width:1920,height:1080,deviceScaleFactor:2}]) {
      await page.setViewport(viewport);
      const result=await switchChatJob(page,{list:true});
      assert.ok(result.closeClick.x>=112 && result.closeClick.x<=168);
      assert.ok(result.closeClick.y>=92 && result.closeClick.y<=468);
    }
    const clicksBefore=await page.evaluate('window.blankClicks');
    await page.evaluate(`document.querySelector('.menu-list').style.width='175px'`);
    await assert.rejects(switchChatJob(page,{list:true}),/空白边距不足/);
    await page.evaluate(`document.querySelector('.menu-list').style.width='100px'`);
    await page.evaluate(`(() => {const cover=document.createElement('button');cover.id='cover';cover.style='position:fixed;left:100px;top:80px;width:80px;height:400px;z-index:999';document.body.append(cover)})()`);
    await assert.rejects(switchChatJob(page,{list:true}),/非预期背景或交互控件/);
    assert.equal(await page.evaluate('window.blankClicks'),clicksBefore);
    await page.evaluate(`document.querySelector('#cover').remove()`);
    await switchChatJob(page,{list:true});
    await page.click('.ui-dropmenu-label');
    assert.equal(await page.evaluate('document.querySelector(".ui-dropmenu-label").textContent'),'');
    assert.equal((await switchChatJob(page,{list:true})).before,'岗位A _ 深圳');
    assert.equal(await page.evaluate('document.querySelector("ul").hidden'),true);
    await page.click('.ui-dropmenu-label');
    await page.evaluate(`(() => {
      const input=document.querySelector('input.chat-job-search');
      const handler=input.onblur;input.onblur=null;input.blur();input.onblur=handler;
    })()`);
    assert.equal(await page.evaluate('document.activeElement.tagName'),'BODY');
    assert.equal((await switchChatJob(page,{list:true})).before,'岗位A _ 深圳');
    assert.equal(await page.evaluate('document.querySelector("ul").hidden'),true);
    await page.click('.ui-dropmenu-label');
    await page.type('input.chat-job-search','已有条件');
    await assert.rejects(switchChatJob(page,{list:true}),/已有搜索条件/);
    await page.mouse.click(140,100);
    const result=await switchChatJob(page,{job:'岗位B _ 深圳'}); assert.equal(result.job,'岗位B _ 深圳');
    assert.equal((await switchChatJob(page,{job:'岗位B _ 深圳'})).changed,false);
    assert.equal(await page.evaluate('window.jobClicks'),1);
    for(const job of ['重复','岗位B','关闭岗位']) await assert.rejects(switchChatJob(page,{job,timeoutMs:150}),/唯一匹配|关闭或禁用/);
    assert.equal(await page.evaluate('window.jobClicks'),1);
    await assert.rejects(switchChatJob(page,{job:'无响应',timeoutMs:150}),/岗位切换未确认/);
    assert.equal(await page.evaluate('window.jobClicks'),2);
    assert.equal(await page.evaluate('window.contactClicks'),0);
    await page.setContent('<div id="boss-chat-editor-input">未发送草稿</div>');
    await assert.rejects(switchChatJob(page,{list:true}),/草稿/);
    await page.setContent('<div class="resume-middle-wrap">简历</div>');
    await assert.rejects(switchChatJob(page,{list:true}),/遮挡/);
    await page.goto('https://www.zhipin.com/web/chat/search');
    await assert.rejects(switchChatJob(page,{list:true}),/必须已在沟通页/);
  } finally {await browser.close();}
});
