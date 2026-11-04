import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
let page,sessions=0;
mock.module('../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:async(fn,opts)=>{
  assert.deepEqual(opts,{ensureChatShell:false,ensureMenuList:false});sessions++;return fn(page);
}}});
const {favoriteResume}=await import('../dist/toolset/favorite.js');
const {executeCommand}=await import('../dist/cli/cliRouter.js');
const args=['favorite','--candidate-id','candidate-1','--json'];

test('favorite uses one scoped click and never toggles an existing favorite off',async t=>{
 const browser=await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
 try {
  page=await browser.newPage();await page.setViewport({width:1100,height:850});
  await page.setRequestInterception(true);
  page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<html><body></body></html>'}));
  async function setup(recommend=false,options={}){
   await page.goto('https://www.zhipin.com/web/chat/'+(recommend?'recommend':'search'));
   let host=page;
   if(recommend){
    await page.setContent('<iframe name="recommendFrame" src="/web/frame/recommend/" style="width:800px;height:700px;border:0"></iframe>');
    host=await (await page.$('iframe')).contentFrame();
   }
   await host.setContent('<style>.like-icon-and-text{width:90px;height:80px;cursor:pointer}.like-icon{width:24px;height:24px}.btn-text{height:30px}.resume-middle-wrap{width:500px;height:450px}</style><div class="like-icon-and-text" id="outside">收藏</div><div class="resume-middle-wrap"><iframe src="/web/frame/c-resume/fixture" style="width:200px;height:80px"></iframe><div class="resume-right-side"><div class="resume-simple-box"><div class="operation-button-list"><div class="like-icon-and-text"><div class="like-icon"></div><div class="btn-text">收藏</div></div></div></div></div></div>');
   await host.evaluate(`(() => {
    const opts=${JSON.stringify(options)},recommend=${recommend};window.clicks=0;window.outsideClicks=0;
    const box=document.querySelector('.resume-simple-box'),button=box.querySelector('.like-icon-and-text'),icon=button.querySelector('.like-icon'),label=button.querySelector('.btn-text');
    const detail={encryptGeekId:opts.wrongId?'other':'candidate-1'},card={encryptGeekId:'candidate-1'};
    const handler=()=>{},owner={$options:{name:'ResumeRoot'},resumeInfo:detail,handleInterested:handler,isLikeLoading:false};
    const vm={$parent:{$parent:owner},$props:{...(recommend?{dataSource:card,personInfo:detail}:{geekInfo:card,resumeInfo:detail}),handleInterested:handler},alreadyInterested:0};box.__vue__=vm;
    if(opts.missingOwner)vm.$parent=null;
    if(opts.wrongOwnerId)owner.resumeInfo={encryptGeekId:'other'};
    if(opts.wrongHandler)owner.handleInterested=()=>{};
    if(opts.duplicateOwner)owner.$parent={...owner};
    if(opts.unknownBusy)delete owner.isLikeLoading;
    if(opts.badBusy)owner.isLikeLoading='false';
    window.setFavorite=value=>{vm.alreadyInterested=value;label.textContent=value?'已收藏':'收藏';icon.classList.toggle('like-icon-active',!!value);};
    window.setFavorite(opts.existing?1:0);
    if(opts.badLabel)label.textContent='收藏';
    if(opts.badIcon)icon.classList.add('like-icon-active');
    if(opts.unknownState)delete vm.alreadyInterested;
    if(opts.busy)owner.isLikeLoading=true;
    if(opts.disabled)button.setAttribute('aria-disabled','true');
    if(opts.duplicate)button.parentElement.appendChild(button.cloneNode(true));
    if(opts.offscreen){box.style='width:500px;height:300px';button.style='position:absolute;left:2000px';}
    if(opts.noPanel)document.querySelector('.resume-middle-wrap').remove();
    if(opts.blocked){const cover=document.createElement('div');cover.style='position:fixed;inset:0;z-index:99';document.body.appendChild(cover);}
    document.querySelector('#outside').onclick=()=>window.outsideClicks++;
    button.onclick=()=>{window.clicks++;if(opts.navigate){history.replaceState({},'','/web/chat/index');return;}if(opts.changeId){detail.encryptGeekId='other';return;}if(opts.stall)return;owner.isLikeLoading=true;setTimeout(()=>{window.setFavorite(1);owner.isLikeLoading=false;},60);};
   })()`);
   if(options.parentOverlay)await page.evaluate("(() => {const e=document.createElement('div');e.style='position:fixed;inset:0;z-index:100';document.body.appendChild(e);})()");
   return host;
  }
  for(const recommend of [false,true]){
   await t.test((recommend?'recommend':'search')+' read-only, favorite once, repeat skips',async()=>{
    const host=await setup(recommend),url=page.url();
    const check=JSON.parse(await executeCommand([...args,'--check']));
    assert.equal(await host.evaluate("typeof document.querySelector('.resume-simple-box').__vue__.isLikeLoading"),'undefined');
    assert.equal(check.busy,false);
    assert.equal(check.status,'not-favorited');assert.equal(check.checkOnly,true);assert.equal(await host.evaluate('window.clicks'),0);
    const result=JSON.parse(await executeCommand(args));assert.equal(result.status,'favorited');assert.equal(result.clicked,true);assert.equal(result.favorited,true);
    assert.equal(result.coordinateSpace,recommend?'recommend-frame':'main-document');
    assert.equal(JSON.parse(await executeCommand(args)).status,'already-favorited');
    assert.equal(await host.evaluate('window.clicks'),1);assert.equal(await host.evaluate('window.outsideClicks'),0);assert.equal(page.url(),url);
   });
   await t.test('state rechecked after separate precheck '+recommend,async()=>{
    const host=await setup(recommend);await executeCommand([...args,'--check']);await host.evaluate('window.setFavorite(1)');
    const result=JSON.parse(await executeCommand(args));assert.equal(result.status,'already-favorited');assert.equal(result.clicked,false);assert.equal(await host.evaluate('window.clicks'),0);
   });
  }
  for(const recommend of [false,true])await t.test('parent request in progress is reported by check '+recommend,async()=>{
   const host=await setup(recommend,{busy:true});
   assert.equal(JSON.parse(await executeCommand([...args,'--check'])).busy,true);
   await assert.rejects(executeCommand(args),/正在进行/);
   assert.equal(await host.evaluate('window.clicks'),0);
  });
  for(const [opts,pattern] of [
   [{missingOwner:true},/关联不唯一/],[{wrongHandler:true},/关联不唯一/],
   [{duplicateOwner:true},/关联不唯一/],[{wrongOwnerId:true},/组件候选人 ID/],
   [{unknownBusy:true},/请求状态缺失/],[{badBusy:true},/请求状态缺失/],
  ])await t.test('invalid request owner fails both precheck and click '+JSON.stringify(opts),async()=>{
   const host=await setup(false,opts);
   await assert.rejects(executeCommand([...args,'--check']),pattern);
   await assert.rejects(executeCommand(args),pattern);
   assert.equal(await host.evaluate('window.clicks'),0);
  });
  for(const [name,opts,pattern] of [
   ['wrong candidate',{wrongId:true},/双 ID/],['missing panel',{noPanel:true},/范围不唯一/],
   ['duplicate button',{duplicate:true},/范围不唯一/],['label conflict',{existing:true,badLabel:true},/不一致/],
   ['icon conflict',{badIcon:true},/不一致/],['unknown state',{unknownState:true},/状态缺失/],
   ['in flight',{busy:true},/正在进行/],['disabled',{disabled:true},/不可用/],
   ['covered',{blocked:true},/遮挡/],['outside viewport',{offscreen:true},/视口外/],
  ])await t.test(name+' stops with no click',async()=>{
   const host=await setup(false,opts);await assert.rejects(favoriteResume('candidate-1'),pattern);assert.equal(await host.evaluate('window.clicks+window.outsideClicks'),0);
  });
  await t.test('recommend iframe covered by main-document overlay does not click',async()=>{
   const host=await setup(true,{parentOverlay:true});await assert.rejects(favoriteResume('candidate-1'),/iframe 被遮挡/);assert.equal(await host.evaluate('window.clicks'),0);
  });
  for(const [name,opts,pattern] of [['timeout',{stall:true},/5000ms/],['navigation',{navigate:true},/导航/],['identity changes',{changeId:true},/双 ID/]])await t.test(name+' after click stops, no retry',async()=>{
   const host=await setup(false,opts);await assert.rejects(favoriteResume('candidate-1'),pattern);assert.equal(await host.evaluate('window.clicks'),1);
  });
  await t.test('wrong page and malformed CLI options never click',async()=>{
   await setup();const before=sessions;
   for(const input of [['favorite'],[...args,'--cancel'],[...args,'--name','姓名'],['favorite','--candidate-id',' ']])await assert.rejects(executeCommand(input));
   assert.equal(sessions,before);
   await page.goto('https://www.zhipin.com/web/chat/index');await assert.rejects(favoriteResume('candidate-1'),/仅支持/);
  });
 }finally{await browser.close();}
});
