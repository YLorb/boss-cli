import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import vm from 'node:vm';
import { PNG } from 'pngjs';

mock.module('../dist/browser/index.js', { namedExports: {
  JOB_SEARCH_ACTION_GAP_MS: {min:0,max:0}, JOB_SELECT_ACTION_GAP_MS: {min:0,max:0},
  RESUME_PREVIEW_OPEN_GAP_MS: {min:0,max:0}, sleepRandom:async()=>{},
} });
mock.module('../dist/common/boss_session_page.js', { namedExports: { withBossSessionPage: async fn => fn({}) } });
let panel = false, closes = 0, stuck = false;
mock.module('../dist/common/c_resume_capture.js', { namedExports: {
  C_RESUME_IFRAME_SELECTOR: 'iframe[src*="c-resume"]',
  closeCResumePanel: async () => { closes++; if (!stuck) panel = false; },
} });
const { backFromOnlineResume } = await import('../dist/toolset/back.js');
const { selectRecommendJob } = await import('../dist/toolset/recommend.js');
const { captureVisibleRegion } = await import('../dist/common/resume_scroll_capture.js');

test('same complete job never clicks or waits, with default, false or true mode', async () => {
  let reads = 0;
  const frame = { evaluate: async script => {
    reads++;
    return vm.runInNewContext(script, { document: { querySelector: () => ({textContent:'行政专员 【深圳】'}) } });
  }};
  assert.equal(await selectRecommendJob(frame, '行政专员【深圳】'), '行政专员 【深圳】');
  assert.equal(await selectRecommendJob(frame, '行政专员【深圳】', false), '行政专员 【深圳】');
  assert.equal(await selectRecommendJob(frame, '行政专员【深圳】', true), '行政专员 【深圳】');
  assert.equal(reads, 3);
  let checks = 0;
  await assert.rejects(selectRecommendJob({evaluate:async () => ++checks === 1 ? '当前岗位' : false}, '其他岗位', true), /未找到岗位下拉入口/);
  assert.equal(checks, 2);
});

test('different jobs select once; partial current-job matches only close dropdown; exact duplicates fail', async () => {
  let label='旧岗位', clicks=0, selected=0, open=false;
  class HTMLElement {
    constructor(text='') { this.textContent=text; }
    getBoundingClientRect(){return {width:100,height:100};}
    scrollIntoView(){}
    click(){clicks++;}
  }
  class HTMLInputElement extends HTMLElement { focus(){} dispatchEvent(){} }
  const host=new HTMLElement(); Object.defineProperty(host,'textContent',{get:()=>label});
  host.click=()=>{clicks++;open=!open;};
  const input=new HTMLInputElement();
  const dropdown=new HTMLElement();dropdown.querySelector=()=>input;
  dropdown.getBoundingClientRect=()=>({width:open?100:0,height:open?100:0});
  function row(text){const el=new HTMLElement(text);el.querySelector=()=>({textContent:text});el.click=()=>{selected++;label=text;open=false;};return el;}
  let rows=[row('行政专员助理'),row('行政专员')];
  const context={HTMLElement,HTMLInputElement,Event:class {},getComputedStyle:()=>({display:'block',visibility:'visible'}),document:{
    querySelector:sel=>sel.includes('ui-dropmenu-label')?host:sel==='.job-selecter-options'?dropdown:sel.includes('chat-job-search')?input:new HTMLElement(),
    querySelectorAll:()=>rows,
  }};
  context.window=context;
  const frame={evaluate:async script=>vm.runInNewContext(script,context),waitForFunction:async script=>{
    assert.equal(vm.runInNewContext(script,context),true,'wait must evaluate a boolean, not return a function');
  }};
  assert.equal(await selectRecommendJob(frame,'行政专员',true),'行政专员');
  assert.equal(clicks,1);assert.equal(selected,1);
  rows=[row('行政专员')];
  assert.equal(await selectRecommendJob(frame,'行政'),'行政专员');
  assert.equal(selected,1);assert.equal(open,false);
  rows=[row('研发工程师')];
  assert.equal(await selectRecommendJob(frame,'研发'),'研发工程师');
  assert.equal(selected,2);
  label='旧岗位';rows=[row('行政专员'),row('行政专员')];
  await assert.rejects(selectRecommendJob(frame,'行政专员',true),/ambiguous/);
  assert.equal(selected,2);
});

test('back closes a panel; checked list is a no-op; close failure never triggers history', async () => {
  const page = {url:()=>'https://www.zhipin.com/web/chat/recommend', frames:()=>[{evaluate:async()=>panel}]};
  panel = false; closes = 0;
  assert.equal((await backFromOnlineResume(page,true)).action, 'noop');
  assert.equal(closes,0);
  await assert.rejects(backFromOnlineResume(page,false), /未打开在线简历/);
  panel = true;
  assert.equal((await backFromOnlineResume(page,true)).action, 'close-panel');
  panel = true; stuck = true;
  await assert.rejects(backFromOnlineResume(page,true), /弹层仍可见/);
  stuck = false; panel = false;
});

test('standalone resume only goes back once to a verified BOSS list', async () => {
  let url='https://www.zhipin.com/web/frame/c-resume/123', previous='https://www.zhipin.com/web/chat/recommend', backs=0, detached=0;
  const page = {url:()=>url, goBack:async()=>{backs++;url=previous;}, createCDPSession:async()=>({
    send:async()=>({currentIndex:1,entries:[{url:previous},{url}]}), detach:async()=>{detached++;},
  })};
  assert.equal((await backFromOnlineResume(page,true)).action,'history-back');
  assert.equal(backs,1); assert.equal(detached,1);
  url='https://www.zhipin.com/web/frame/c-resume/123'; previous='https://www.zhipin.com/web/user/';
  await assert.rejects(backFromOnlineResume(page,true), /前一条历史不是/);
  assert.equal(backs,1); assert.equal(detached,2);
});

test('viewport screenshots crop locally at fractional DPR without browser clipping or resize', async () => {
  const source = new PNG({width:300,height:150});
  for(let y=0;y<150;y++)for(let x=0;x<300;x++) {const i=(y*300+x)*4;source.data[i]=x%256;source.data[i+1]=y;source.data[i+3]=255;}
  const page={evaluate:async()=>({width:200,height:100,x:0,y:0,scale:1.5}),screenshot:async options=>{
    assert.equal(options.clip,undefined); assert.equal(options.fullPage,false); assert.equal(options.captureBeyondViewport,false);
    return PNG.sync.write(source);
  }};
  const result=await captureVisibleRegion(page,{x:20,y:10,width:100,height:60},1.5);
  assert.equal(result.width,150);assert.equal(result.height,90);
  assert.equal(result.data[0],30);assert.equal(result.data[1],15);
  await assert.rejects(captureVisibleRegion(page,{x:180,y:10,width:100,height:60},1.5), /裁剪边界异常/);
});
