// Explicit opt-in: reuse an existing browser, create and close only local fixture tabs.
// BOSS_TEST_CDP_URL=http://127.0.0.1:53470 node scripts/test-resume-cdp.mjs
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { captureResumeByWheel } from '../dist/common/resume_scroll_capture.js';

if (!process.env.BOSS_TEST_CDP_URL) throw new Error('Set BOSS_TEST_CDP_URL explicitly; this test never launches a browser.');
const browser = await puppeteer.connect({browserURL:process.env.BOSS_TEST_CDP_URL,defaultViewport:null});
const dir = await mkdtemp(join(tmpdir(),'boss-resume-cdp-'));
try {
  for (const outer of [true,false]) {
    const page = await browser.newPage();
    try {
      await page.setViewport({width:900,height:700,deviceScaleFactor:1.5});
      const content = Array.from({length:40},(_,i)=>`<div class="line" style="height:30px;line-height:30px;background:${i%2?'#fff':'#eee'}">本地回归测试 ${i} — screenshot overlap</div>`).join('');
      const source = `<style>html,body{margin:0;padding:0}::-webkit-scrollbar{width:0;height:0}*{box-sizing:border-box}</style>${outer?content:`<div style="height:320px;overflow-y:auto">${content}</div>`}`;
      const escaped=source.replaceAll('&','&amp;').replaceAll('"','&quot;');
      await page.setContent(`<style>::-webkit-scrollbar{width:0;height:0}body{margin:0}.wrap{margin:20px;width:500px;height:320px;overflow:auto}iframe{display:block;border:0;width:500px;height:${outer?1200:320}px}</style><div class="wrap"><iframe src="/c-resume" srcdoc="${escaped}"></iframe></div>`);
      const iframe=await page.$('iframe');const frame=await iframe.contentFrame();
      await frame.waitForSelector('.line');
      let navigations=0;page.on('framenavigated',()=>navigations++);
      const origin=await page.evaluate('performance.timeOrigin'),viewport=page.viewport();
      const start=Date.now(),wheelTimes=[],wheel=page.mouse.wheel.bind(page.mouse);
      page.mouse.wheel=async args=>{wheelTimes.push(Date.now()-start);return wheel(args);};
      const output=join(dir,outer?'outer.png':'inner.png');
      await captureResumeByWheel(page,iframe,output);
      const png=PNG.sync.read(await readFile(output));
      assert.equal(png.width,750);assert.equal(png.height,1800);
      assert.ok(wheelTimes[0]>=2000,'first wheel must follow the reading pause');
      assert.equal(navigations,0);assert.equal(await page.evaluate('performance.timeOrigin'),origin);
      assert.deepEqual(page.viewport(),viewport);
      const restored=outer?await page.evaluate('document.querySelector(".wrap").scrollTop'):await frame.evaluate('document.querySelector("div").scrollTop');
      assert.equal(restored,0);
      console.log(JSON.stringify({layout:outer?'outer':'inner',dimensions:[png.width,png.height],firstWheelMs:wheelTimes[0],navigations,restored}));
    } finally {if (!page.isClosed()) await page.close();}
  }
} finally {await browser.disconnect();await rm(dir,{recursive:true});}
