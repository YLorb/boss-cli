import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';
import {readSelectedConversation,assertSelectedConversation} from '../dist/toolset/target_chat.js';

test('readonly identity checks survive a fresh process and never search, click or scroll',async()=>{
  const browser=await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
  try {
    const page=await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request',r=>void r.respond({status:200,contentType:'text/html; charset=utf-8',body:'<div class="geek-item selected" data-id="123-0"><span class="geek-name">甲</span></div><div class="base-info-single-container"><span class="name-box">甲</span></div>'}));
    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.evaluate("(() => {window.clicks=0;window.wheels=0;document.addEventListener('click',()=>window.clicks++);document.addEventListener('wheel',()=>window.wheels++);})()");
    await assertSelectedConversation(page,{name:'甲',dataId:'123-0'});
    assert.equal((await readSelectedConversation(page)).dataId,'123-0');
    await assert.rejects(assertSelectedConversation(page,{name:'错名',dataId:'123-0'}),/身份校验失败/);
    const child=spawnSync(process.execPath,['--input-type=module','-e',`
      import puppeteer from 'puppeteer-core';
      import {readSelectedConversation} from './dist/toolset/target_chat.js';
      const b=await puppeteer.connect({browserWSEndpoint:process.argv[1],defaultViewport:null});
      try {const p=(await b.pages()).find(p=>p.url().includes('/web/chat/index'));console.log(JSON.stringify(await readSelectedConversation(p)));} finally {b.disconnect();}
    `,browser.wsEndpoint()],{encoding:'utf8',timeout:15000});
    assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).dataId,'123-0');
    assert.deepEqual(await page.evaluate('[window.clicks,window.wheels]'),[0,0]);
    await page.evaluate("document.querySelector('.name-box').textContent='错误详情'");
    await assert.rejects(assertSelectedConversation(page,{name:'甲',dataId:'123-0'}),/身份校验失败/);
    await page.evaluate("document.body.append(document.querySelector('.geek-item').cloneNode(true))");
    await assert.rejects(assertSelectedConversation(page,{name:'甲',dataId:'123-0'}),/选中行数 2/);
  } finally {await browser.close();}
});
