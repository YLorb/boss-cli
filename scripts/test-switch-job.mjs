import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { parseArgs, switchChatJob } from './switch-job.mjs';

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
    await page.setContent(`<div class="chat-top-job"><div class="ui-dropmenu-label">岗位A _ 深圳</div><ul class="ui-dropmenu-list" hidden><li>岗位A _ 深圳</li><li>岗位B _ 深圳</li><li>岗位B _ 上海</li><li>重复</li><li>重复</li><li class="disabled">关闭岗位</li><li>无响应</li></ul></div><button id="contact">联系</button>`);
    await page.evaluate(`(() => {
      window.jobClicks=0; window.contactClicks=0;
      document.querySelector('#contact').onclick=()=>window.contactClicks++;
      const label=document.querySelector('.ui-dropmenu-label'), menu=document.querySelector('ul');
      label.onclick=()=>{menu.hidden=false};
      menu.querySelectorAll('li').forEach(el=>el.onclick=()=>{window.jobClicks++;if(el.textContent==='无响应')return;setTimeout(()=>{label.textContent=el.textContent;menu.hidden=true},30)});
    })()`);
    const listed=await switchChatJob(page,{list:true}); assert.equal(listed.options.length,7);
    assert.equal(await page.evaluate('window.jobClicks'),0);
    const result=await switchChatJob(page,{job:'岗位B _ 深圳'}); assert.equal(result.job,'岗位B _ 深圳');
    assert.equal((await switchChatJob(page,{job:'岗位B _ 深圳'})).changed,false);
    assert.equal(await page.evaluate('window.jobClicks'),1);
    for(const job of ['重复','岗位B','关闭岗位']) await assert.rejects(switchChatJob(page,{job,timeoutMs:150}),/唯一匹配|关闭或禁用/);
    assert.equal(await page.evaluate('window.jobClicks'),1);
    await assert.rejects(switchChatJob(page,{job:'无响应',timeoutMs:150}),/岗位切换未确认/);
    assert.equal(await page.evaluate('window.jobClicks'),2);
    assert.equal(await page.evaluate('window.contactClicks'),0);
    await page.goto('https://www.zhipin.com/web/chat/search');
    await assert.rejects(switchChatJob(page,{list:true}),/必须已在沟通页/);
  } finally {await browser.close();}
});
