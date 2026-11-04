import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import puppeteer from 'puppeteer-core';
import { installBossPageGuards } from '../dist/common/boss_page_guards.js';

test('two Node clients share one guard per document; new documents install independently', async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  });
  const child = async phase => promisify(execFile)(process.execPath, ['--input-type=module','-e', `
    import puppeteer from 'puppeteer-core';
    import assert from 'node:assert/strict';
    import {installBossPageGuards} from './dist/common/boss_page_guards.js';
    const browser=await puppeteer.connect({browserWSEndpoint:process.argv[1]});
    try {
      const page=(await browser.pages()).find(p=>p.url()==='data:text/html,guard-test');
      await Promise.all([installBossPageGuards(page),installBossPageGuards(page)]);
      const refs='[Function.prototype.toString,console.log,history.go]';
      if(process.argv[2]==='first') await page.evaluate('window.firstGuardRefs='+refs);
      else {
        assert.ok(await page.evaluate(refs+'.every((fn,i)=>fn===window.firstGuardRefs[i])'));
        await page.goto('data:text/html,new-document');
        assert.match(await page.evaluate("document[Symbol.for('boss-cli.page-guard')]"),/^v1:/);
      }
    } finally {await browser.disconnect();}
  `, browser.wsEndpoint(), phase], {windowsHide:true, timeout:30000});
  try {
    const page = await browser.newPage();
    await page.goto('data:text/html,guard-test');
    await child('first');
    await child('second');
    const broken = await browser.newPage();
    await broken.goto('data:text/html,incomplete');
    await broken.evaluate("Object.defineProperty(Function.prototype,'toString',{configurable:false,writable:false})");
    await assert.rejects(installBossPageGuards(broken), /安装失败/);
    assert.equal(await broken.evaluate("document[Symbol.for('boss-cli.page-guard')]"), 'installing');
  } finally { await browser.close(); }
});
