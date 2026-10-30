import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {closeChatResumeByBlankClick} from '../dist/common/resume_chat_close.js';

test('chat resume exits with one trusted background click, rejects blockers and changed identity',async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
  try {
    const page=await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<html><body>fixture</body></html>'}));
    await page.goto('https://www.zhipin.com/web/chat/index');
    const setup=async()=>{
      await page.setContent(`<div class="menu-list" style="position:fixed;left:0;top:0;width:100px;height:100vh"></div>
        <div class="chat-user" style="position:fixed;left:180px;top:60px;width:300px;height:500px">
        <div class="chat-top-job"><span class="ui-dropmenu-label">岗位A</span></div><div class="geek-item selected" data-id="a"></div></div>
        <div id="backdrop" style="position:fixed;left:100px;right:0;top:0;bottom:0"><iframe src="/web/frame/c-resume/a" style="position:fixed;left:300px;top:60px;width:400px;height:500px"></iframe></div>`);
      await page.evaluate(`(() => {window.clicks=0;document.querySelector('#backdrop').onclick=e=>{
        if(e.target.id!=='backdrop')return;window.clicks++;window.trusted=e.isTrusted;
        document.querySelector('#backdrop').remove();
        if(window.changeIdentity)document.querySelector('.geek-item').setAttribute('data-id','other');
      }})()`);
    };
    await setup();await closeChatResumeByBlankClick(page);
    assert.equal(await page.evaluate('window.clicks'),1);assert.equal(await page.evaluate('window.trusted'),true);
    await setup();
    await page.evaluate(`(()=>{const b=document.createElement('button');b.style='position:fixed;inset:0;z-index:100';document.body.append(b)})()`);
    await assert.rejects(closeChatResumeByBlankClick(page),/未命中当前简历背景/);
    assert.equal(await page.evaluate('window.clicks'),0);
    await setup();await page.evaluate(`document.querySelector('.menu-list').style.width='175px'`);
    await assert.rejects(closeChatResumeByBlankClick(page),/安全空白区域不足/);
    assert.equal(await page.evaluate('window.clicks'),0);
    await setup();await page.evaluate('window.changeIdentity=true');
    await assert.rejects(closeChatResumeByBlankClick(page),/会话或岗位已变化/);
    assert.equal(await page.evaluate('window.clicks'),1);
  } finally {await browser.close();}
});
