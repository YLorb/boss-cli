import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
let page;
mock.module('../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:async(fn,opts)=>{assert.deepEqual(opts,{ensureChatShell:false,ensureMenuList:false});return fn(page);}}});
const {dismissContactNotice,dismissContactNoticeScript}=await import('../dist/toolset/contact-notice.js');
const {executeCommand}=await import('../dist/cli/cliRouter.js');
const {readStatus}=await import('../dist/toolset/check.js');
const target={name:'罗**',candidateId:'candidate-1',job:'后训练技术负责人'};
test('contact notice is identity-bound, success-only and single-click',async t=>{
 const browser=await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
 try {
  page=await browser.newPage();await page.setRequestInterception(true);
  page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<html></html>'}));
  await page.goto('https://www.zhipin.com/web/chat/search');
  const setup=async(options={})=>{
   await page.setContent(`<div class="resume-middle-wrap"><div class="resume-right-side"><div class="resume-simple-box"><button>继续沟通</button></div></div></div>
    <iframe src="https://www.zhipin.com/web/frame/search"></iframe>
    <div class="dialog-wrap active" id="notice">使用成功 已为您发起沟通并索要简历/微信/电话注：该牛人已开通虚拟电话，可直接电话联系该牛人<div class="boss-dialog__footer"><span class="boss-dialog__button button-outline">查看对话</span> <span class="boss-dialog__button" id="close">关闭</span></div></div>`);
   await page.evaluate(`(() => {
    const opts=${JSON.stringify(options)};window.closeClicks=0;window.otherClicks=0;
    document.querySelector('.resume-simple-box').__vue__={$props:{geekInfo:{encryptGeekId:'candidate-1'},resumeInfo:{encryptGeekId:'candidate-1'}}};
    document.querySelector('button').onclick=()=>window.otherClicks++;
    document.querySelector('.button-outline').onclick=()=>window.otherClicks++;
    document.querySelector('#close').onclick=()=>{window.closeClicks++;if(!opts.stall)document.querySelector('#notice').remove();};
    if(opts.paid)document.querySelector('#notice').firstChild.textContent='购买畅聊卡 ';
    if(opts.noContact)document.querySelector('button').textContent='立即沟通';
    if(opts.duplicate)document.body.appendChild(document.querySelector('#notice').cloneNode(true));
    if(opts.disabled)document.querySelector('#close').setAttribute('aria-disabled','true');
    if(opts.blocked){const block=document.createElement('div');block.style='position:fixed;inset:0;z-index:999';document.body.appendChild(block);}
   })()`);
   const frame=page.frames().find(f=>f.url().endsWith('/web/frame/search'));
   await frame.setContent('<input class="search-input" value="Post-training"><div class="search-current-job">后训练技术负责人</div><div class="geek-info-card"><span class="name-label">罗**</span></div>');
   await frame.evaluate(`document.querySelector('.geek-info-card').__vue__={$props:{geek:{geekCard:{name:'罗**',encryptGeekId:'candidate-1'}}}}`);
  };
  for(const [label,options,expected] of [
   ['purchase dialog',{paid:true},/已知/],['multiple notices',{duplicate:true},/不唯一/],
   ['disabled',{disabled:true},/不可用/],['blocked',{blocked:true},/遮挡/],['not yet contacted',{noContact:true},/已联系/]
  ])await t.test(label,async()=>{await setup(options);await assert.rejects(dismissContactNotice(target),expected);assert.equal(await page.evaluate('window.closeClicks+window.otherClicks'),0);});
  await t.test('wrong candidate/name/job and changed resume never click',async()=>{
   await setup();for(const key of ['name','candidateId','job'])await assert.rejects(dismissContactNotice({...target,[key]:'wrong'}),/身份/);
   await page.evaluate("document.querySelector('.resume-simple-box').__vue__.$props.resumeInfo.encryptGeekId='changed'");
   await assert.rejects(page.evaluate(dismissContactNoticeScript(target)),/ID/);assert.equal(await page.evaluate('window.closeClicks'),0);
  });
  await t.test('public CLI rejects missing identity and mixed flags',async()=>{
   await setup();for(const args of [[],['罗**','--candidate-id','candidate-1'],['罗**','--candidate-id','candidate-1','--job','后训练技术负责人','--check']])await assert.rejects(executeCommand(['dismiss-contact-notice',...args]));
   assert.equal(await page.evaluate('window.closeClicks'),0);
  });
  await t.test('status is read-only and CLI closes only the success notice',async()=>{
   await setup();const html=await page.content();const state=await readStatus(page);assert.equal(state.contactNotices[0].controls.length,2);assert.equal(await page.content(),html);
   const result=JSON.parse(await executeCommand(['dismiss-contact-notice','罗**','--candidate-id','candidate-1','--job','后训练技术负责人','--json']));
   assert.equal(result.status,'contact-notice-dismissed');assert.equal(await page.evaluate('window.closeClicks'),1);assert.equal(await page.evaluate('window.otherClicks'),0);
   assert.equal((await readStatus(page)).resumeId,target.candidateId);
   await assert.rejects(dismissContactNotice(target),/缺失/);assert.equal(await page.evaluate('window.closeClicks'),1);
  });
  await t.test('timeout reports failure without retry',async()=>{
   await setup({stall:true});await assert.rejects(dismissContactNotice(target),/5000ms/);assert.equal(await page.evaluate('window.closeClicks'),1);
  });
 } finally {await browser.close();}
});
