import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import puppeteer from 'puppeteer-core';

let paywall = null;
mock.module('../dist/common/boss_paywall_popup.js', { namedExports: {
  describeBossPaywallPopupIfPresent: async () => paywall,
  waitForCResumeIframeOrPaywall: async () => 'iframe',
  closeBossPaywallPopupIfPresent: async () => { throw new Error('must not close'); },
} });
const { openSearchResumeOnly } = await import('../dist/toolset/open-search-resume.js');
const { selectSearchContactJob } = await import('../dist/toolset/search-contact-job.js');
const { greetNormalSearch } = await import('../dist/toolset/search-greet.js');
const { STATUS_SCRIPT, matchesStatus } = await import('../dist/toolset/check.js');

test('search greeting verifies identity, checks without clicking and never retries uncertain actions', async t => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => void request.respond({status:200,contentType:'text/html',body:'<html></html>'}));
    const frame = page.mainFrame();
    const card = (name='n**', button='立即沟通(30/196)') => `<div class="geek-info-card">
      <span class="name-label">${name}</span>
      <button onclick="window.clicks=(window.clicks||0)+1;this.textContent='继续沟通'">${button}</button></div>`;
    const reset = async html => { await page.setContent(html); await page.evaluate(`(() => {
      window.clicks=0;
      for(const el of document.querySelectorAll('.geek-info-card')) el.__vue__={$props:{geek:{geekCard:{name:el.querySelector('.name-label').textContent,encryptGeekId:'candidate-1'}}}};
    })()`); };
    await t.test('list check is read-only, real action clicks exactly once and repeated action is a no-op', async () => {
      await reset(card() + '<button onclick="window.wrong=true">立即沟通</button>');
      assert.equal((await greetNormalSearch(page,frame,'n**',true)).status,'ready');
      assert.equal(await page.evaluate('window.clicks'),0);
      assert.equal((await greetNormalSearch(page,frame,'n**')).status,'contact-confirmed');
      assert.equal((await greetNormalSearch(page,frame,'n**')).status,'already-contacted');
      assert.equal(await page.evaluate('window.clicks'),1);
      assert.equal(await page.evaluate('window.wrong'),undefined);
    });
    await t.test('duplicate names, disabled, hidden, covered and purchase buttons stop before click', async () => {
      await reset(card()+card());
      await assert.rejects(greetNormalSearch(page,frame,'n**'), /姓名不唯一/);
      for (const html of [
        card().replace('<button ', '<button disabled '),
        card().replace('<button ', '<button style="display:none" '),
        card()+'<div style="position:fixed;inset:0;background:white"></div>',
        card('n**','联系Ta'),
      ]) {
        await reset(html);
        await assert.rejects(greetNormalSearch(page,frame,'n**'));
        assert.equal(await page.evaluate('window.clicks'),0);
      }
    });
    await t.test('duplicate names use exact candidate ID, mismatch never clicks', async () => {
      await reset(card()+card());
      await page.evaluate("document.querySelectorAll('.geek-info-card')[1].__vue__.$props.geek.geekCard.encryptGeekId='candidate-2'");
      assert.equal((await greetNormalSearch(page,frame,'n**',true,false,'candidate-2')).candidateId,'candidate-2');
      assert.equal(await page.evaluate('window.clicks'),0);
      await assert.rejects(greetNormalSearch(page,frame,'n**',false,false,'missing'));
      await assert.rejects(greetNormalSearch(page,frame,'wrong',false,false,'candidate-2'));
      assert.equal(await page.evaluate('window.clicks'),0);
      assert.equal((await greetNormalSearch(page,frame,'n**',false,false,'candidate-2')).status,'contact-confirmed');
      assert.equal(await page.evaluate("document.querySelectorAll('.geek-info-card')[0].querySelector('button').textContent"),'立即沟通(30/196)');
      assert.equal(await page.evaluate('window.clicks'),1);
      const {openNormalSearchResumePreview}=await import('../dist/toolset/normal-search.js');
      await page.evaluate("document.querySelectorAll('.name-label').forEach((e,i)=>e.onclick=()=>window.opened=i)");
      await openNormalSearchResumePreview(frame,'n**','candidate-2');
      assert.equal(await page.evaluate('window.opened'),1);
      await assert.rejects(openNormalSearchResumePreview(frame,'n**','missing'));
    });
    await t.test('paywall blocks without dismissing it', async () => {
      await reset(card());
      await assert.rejects(greetNormalSearch(page,frame,'n**',false,true),/candidate-id/);
      paywall='页面出现付费弹层';
      await assert.rejects(greetNormalSearch(page,frame,'n**'),/付费弹层/);
      assert.equal(await page.evaluate('window.clicks'),0); paywall=null;
    });
    await t.test('no confirmation is an explicit uncertain result with exactly one click', async () => {
      await reset(card().replace("this.textContent='继续沟通'",'void 0'));
      const original = frame.waitForFunction.bind(frame);
      frame.waitForFunction = (script, options) => original(script,{...options,timeout:50});
      try { await assert.rejects(greetNormalSearch(page,frame,'n**'),/已点击一次.*禁止自动重试/); }
      finally { frame.waitForFunction = original; }
      assert.equal(await page.evaluate('window.clicks'),1);
    });
    const panelHtml = `<div class="resume-middle-wrap"><div class="resume-center-side">
      <iframe style="width:300px;height:100px" src="https://fixture.invalid/web/frame/c-resume/?source=search"></iframe>
      </div><div class="resume-right-side"><div class="resume-simple-box"><button onclick="window.clicks++;this.textContent='继续沟通'">立即沟通(30/75)</button></div></div></div>`;
    const bindPanel = async () => page.evaluate(`(() => {
      document.querySelector('.resume-simple-box').__vue__={$props:{geekInfo:{encryptGeekId:'candidate-1'},resumeInfo:{encryptGeekId:'candidate-1'}}};
    })()`);
    await t.test('observed search card label supports read-only check and one verified contact', async () => {
      const panel = panelHtml.replace('立即沟通(30/75)', '搜索畅聊卡(2/25)');
      await reset(card()+panel); await bindPanel();
      const criteria={state:'contact-ready',name:'n**',candidateId:'candidate-1'};
      const status={...await page.evaluate(STATUS_SCRIPT),pageType:'search'};
      assert.equal(status.contactText,'搜索畅聊卡(2/25)');
      assert.equal(matchesStatus(status,criteria),true);
      assert.equal((await greetNormalSearch(page,frame,'n**',true,false,'candidate-1')).clicked,false);
      assert.equal(await page.evaluate('window.clicks'),0);
      assert.equal((await greetNormalSearch(page,frame,'n**',false,false,'candidate-1')).status,'contact-confirmed');
      assert.equal((await greetNormalSearch(page,frame,'n**',false,false,'candidate-1')).status,'already-contacted');
      assert.equal(await page.evaluate('window.clicks'),1);
      for(const html of [panel.replace('<button ', '<button disabled '),panel.replace('搜索畅聊卡(2/25)','购买搜索畅聊卡(2/25)'),panel.replace('搜索畅聊卡(2/25)','搜索畅聊卡')]) {
        await reset(card()+html); await bindPanel();
        assert.equal(matchesStatus({...await page.evaluate(STATUS_SCRIPT),pageType:'search'},criteria),false);
        await assert.rejects(greetNormalSearch(page,frame,'n**',false,false,'candidate-1'));
        assert.equal(await page.evaluate('window.clicks'),0);
      }
      await reset(card()+panel); await bindPanel();
      await page.evaluate("document.querySelector('.resume-simple-box').__vue__.$props.resumeInfo.encryptGeekId='wrong'");
      assert.equal(matchesStatus({...await page.evaluate(STATUS_SCRIPT),pageType:'search'},criteria),false);
      await assert.rejects(greetNormalSearch(page,frame,'n**',false,false,'candidate-1'),/ID/);
      assert.equal(await page.evaluate('window.clicks'),0);
    });
    await t.test('Canvas resume uses only its parent operation box and verifies both IDs', async () => {
      await reset(card()+panelHtml+'<button onclick="window.wrong=true">立即沟通</button>');
      await bindPanel();
      const resume=await (await page.$('iframe')).contentFrame();
      await resume.setContent('<canvas id="resume" width="300" height="100"></canvas>');
      const before=await greetNormalSearch(page,frame,'n**',true);
      assert.equal(before.source,'search-resume');assert.equal(before.identityVerified,true);
      assert.equal(before.candidateId,'candidate-1');assert.equal(before.clicked,false);
      assert.equal(await page.evaluate('window.clicks'),0);
      for(const prop of ['geekInfo','resumeInfo']) {
        await page.evaluate(`document.querySelector('.resume-simple-box').__vue__.$props.${prop}.encryptGeekId='other'`);
        await assert.rejects(greetNormalSearch(page,frame,'n**',true),/ID/);
        await bindPanel();
      }
      await page.evaluate(`document.querySelector('.geek-info-card').__vue__.$props.geek.geekCard.encryptGeekId=''`);
      await assert.rejects(greetNormalSearch(page,frame,'n**',true),/ID/);
      await page.evaluate(`document.querySelector('.geek-info-card').__vue__.$props.geek.geekCard.encryptGeekId='candidate-1'`);
      await page.evaluate(`document.body.insertAdjacentHTML('beforeend','<div id="cover" style="position:fixed;inset:0;background:white"></div>')`);
      await assert.rejects(greetNormalSearch(page,frame,'n**',true),/遮挡/);
      await page.evaluate(`document.querySelector('#cover').remove()`);
      assert.equal((await greetNormalSearch(page,frame,'n**')).status,'contact-confirmed');
      assert.equal(await page.evaluate('window.clicks'),1);
      assert.equal(await page.evaluate('window.wrong'),undefined);
      assert.equal((await page.$$('iframe')).length,1);
      await page.evaluate(`document.querySelector('.geek-info-card').remove()`);
      await assert.rejects(greetNormalSearch(page,frame,'n**',false,true,'wrong'),/ID/);
      assert.equal((await greetNormalSearch(page,frame,'n**',true,true,'candidate-1')).clicked,false);
      assert.equal((await greetNormalSearch(page,frame,'n**',false,true,'candidate-1')).status,'continue-clicked');
      assert.equal(await page.evaluate('window.clicks'),2);

    });
    await t.test('duplicate panel, missing component and disconnected iframe fail closed', async () => {
      await reset(card()+panelHtml+panelHtml);await bindPanel();
      await assert.rejects(greetNormalSearch(page,frame,'n**',true),/多个在线简历/);
      await reset(card()+panelHtml);
      await assert.rejects(greetNormalSearch(page,frame,'n**',true),/ID/);
      await bindPanel();
      await page.evaluate(`document.body.appendChild(document.querySelector('iframe'))`);
      await assert.rejects(greetNormalSearch(page,frame,'n**',true),/关联不唯一/);
      assert.equal(await page.evaluate('window.clicks'),0);
    });
    await t.test('open-only reuses a Canvas resume with verified ID and no clicks', async () => {
      await page.goto('https://www.zhipin.com/web/chat/search');
      await reset('<iframe name="searchFrame" style="width:600px;height:150px" src="https://fixture.invalid/web/frame/search"></iframe>'+panelHtml);
      const search=await (await page.$('iframe[name="searchFrame"]')).contentFrame();
      await search.setContent('<div class="search-container"></div><input class="search-input"><div class="geek-list-wrap">'+card()+'</div>');
      await search.evaluate(`document.querySelector('.geek-info-card').__vue__={$props:{geek:{geekCard:{name:'n**',encryptGeekId:'candidate-1'}}}}`);
      await search.evaluate(`document.querySelector('.search-container').__vue__={$options:{name:'SearchCandidatesIndex'},loadding$:false,isInitPage$:false,params$:{keywords:'',jobId:'job',page:1},renderList$:[document.querySelector('.geek-info-card').__vue__.$props.geek]}`);
      await bindPanel();
      const resume=await (await page.$('iframe[src*="c-resume"]')).contentFrame();
      await resume.setContent('<canvas id="resume" width="300" height="100"></canvas>');
      const result=await openSearchResumeOnly(page,'n**');
      assert.equal(result.reused,true);assert.equal(result.identityVerified,true);
      assert.equal(result.screenshot,false);assert.equal(result.closed,false);
      assert.equal(result.controls[0].text,'立即沟通(30/75)');
      assert.equal(await page.evaluate('window.clicks'),0);
      await page.evaluate(`document.querySelector('.resume-simple-box').__vue__.$props.resumeInfo.encryptGeekId='other'`);
      await assert.rejects(openSearchResumeOnly(page,'n**'),/ID/);
    });
    await t.test('contact job selection verifies identity, selects exact job and never submits', async () => {
      await reset(card()+panelHtml+`<div class="common-job-list-dialog"><ul class="select-list">
        <li class="active"><h3>其他岗位</h3></li>
        <li onclick="this.parentElement.querySelector('.active').classList.remove('active');this.classList.add('active');window.jobClicks=(window.jobClicks||0)+1"><h3>大模型推理加速专家</h3></li>
        </ul><div class="footer"><button onclick="window.submitted=true;document.querySelector('.resume-simple-box button').textContent='继续沟通';this.closest('.common-job-list-dialog').remove()">立即沟通</button></div></div>`);
      await bindPanel();
      assert.equal((await selectSearchContactJob(page,frame,'n**','大模型推理加速专家',true)).clicked,false);
      assert.equal(await page.evaluate('window.jobClicks'),undefined);
      await assert.rejects(selectSearchContactJob(page,frame,'n**','推理加速',false),/唯一匹配/);
      const result=await selectSearchContactJob(page,frame,'n**','大模型推理加速专家',false);
      assert.equal(result.selected,true);assert.equal(result.clicked,true);
      assert.equal((await selectSearchContactJob(page,frame,'n**','大模型推理加速专家',false)).clicked,false);
      assert.equal(await page.evaluate('window.jobClicks'),1);
      assert.equal(await page.evaluate('window.submitted'),undefined);
      await page.evaluate(`document.querySelector('.resume-simple-box').__vue__.$props.geekInfo.encryptGeekId='wrong'`);
      await assert.rejects(selectSearchContactJob(page,frame,'n**','大模型推理加速专家',false),/ID 不符/);
      await bindPanel();
      assert.equal((await selectSearchContactJob(page,frame,'n**','大模型推理加速专家',true,true)).status,'confirmation-ready');
      assert.equal(await page.evaluate('window.submitted'),undefined);
      await page.evaluate(`document.querySelector('.select-list li.active').classList.remove('active')`);
      await assert.rejects(selectSearchContactJob(page,frame,'n**','大模型推理加速专家',false,true),/已选中/);
      await page.evaluate(`document.querySelector('.select-list li:last-child').classList.add('active')`);
      const confirmed=await selectSearchContactJob(page,frame,'n**','大模型推理加速专家',false,true);
      assert.equal(confirmed.contactConfirmed,true);
      assert.equal(await page.evaluate('window.submitted'),true);
      await assert.rejects(selectSearchContactJob(page,frame,'n**','大模型推理加速专家',false,true),/选择弹层/);

    });
  } finally { await browser.close(); }
});
