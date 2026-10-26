import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {STATUS_SCRIPT,matchesStatus} from '../dist/toolset/check.js';

test('DOM snapshot separates incoming acceptance from outgoing requests and never changes DOM',async()=>{
 const browser=await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
 try {
  const page=await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request',r=>void r.abort());
  await page.setContent(`<div class="geek-item selected" data-id="id1"><span class="geek-name">测试</span></div><div class="base-info-single-container"><span class="name-box">测试</span></div><div id="boss-chat-editor-input" contenteditable="true"></div><div class="chat-message-list"><div class="message-item"><div class="item-friend"><div class="message-card-top-title">对方希望发送附件简历</div><div class="message-card-buttons"><button class="card-btn">同意</button></div></div></div></div>`);
  const before=await page.content();
  let s={...await page.evaluate(STATUS_SCRIPT),pageType:'chat'};
  assert.equal(s.resumeRequest,true);assert.equal(s.resumeReceived,false);assert.deepEqual(s.messages,[]);
  assert.equal(matchesStatus(s,{state:'resume-request',name:'测试',dataId:'id1'}),true);
  assert.equal(await page.content(),before);
  await page.evaluate(`document.querySelector('.card-btn').disabled=true`);
  assert.equal((await page.evaluate(STATUS_SCRIPT)).resumeRequest,false);
  await page.setContent(`<div class="chat-message-list"><div class="message-item"><div class="item-myself"><div class="text"><span>方便发一份你的简历过来吗？</span></div></div></div></div>`);
  s=await page.evaluate(STATUS_SCRIPT);assert.equal(s.resumeRequest,false);assert.equal(s.resumeReceived,false);assert.equal(s.messages.length,1);
  await page.setContent(`<div class="chat-message-list"><div class="message-item"><div class="item-friend"><i class="resume-icon"></i><div class="message-card-top-title">简历.pdf</div></div></div></div>`);
  s=await page.evaluate(STATUS_SCRIPT);assert.equal(s.resumeRequest,false);assert.equal(s.resumeReceived,true);
 }finally{await browser.close();}
});
