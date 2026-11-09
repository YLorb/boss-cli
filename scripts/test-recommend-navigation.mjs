import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
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
const { selectRecommendJob: selectJob } = await import('../dist/toolset/recommend.js');
const selectRecommendJob = async (...args) => (await selectJob(...args)).label;
const {recommendJobKey,recommendJobQuery}=await import('../dist/toolset/recommend_job.js');
const {matchesStatus}=await import('../dist/toolset/check.js');
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
  await assert.rejects(selectRecommendJob({page:()=>new EventEmitter(),evaluate:async () => ++checks === 1 ? '当前岗位' : false}, '其他岗位', true), /未找到岗位下拉入口/);
  assert.equal(checks, 2);
  const salaryFrame={evaluate:async()=> 'LLM 推理网关 _ 深圳 15-30K'};
  assert.equal(await selectRecommendJob(salaryFrame,'LLM 推理网关 _ 深圳',true),'LLM 推理网关 _ 深圳 15-30K');
  assert.equal(await selectRecommendJob(salaryFrame,'LLM 推理网关 _ 深圳 20-40K',true),'LLM 推理网关 _ 深圳 15-30K');
  assert.notEqual(recommendJobKey('全栈开发 _ 深圳 15-30K'),recommendJobKey('全栈开发 _ 西安 15-30K'));
  assert.equal(recommendJobQuery('LLM 推理网关 / 计费平台工程师（Bifrost） _ 深圳 15-30K'),'LLM 推理网关 / 计费平台工程师（Bifrost）');
  assert.equal(matchesStatus({pageType:'recommend',recommendJob:'全栈开发 _ 深圳 15-30K'},{page:'recommend',job:'全栈开发 _ 深圳'}),true);
  assert.equal(matchesStatus({pageType:'recommend',recommendJob:'全栈开发 _ 深圳 15-30K'},{page:'recommend',job:'全栈开发 _ 西安'}),false);
});

test('top navigation and recommendation frame detachment stop selection with distinct diagnostics', async () => {
  for (const [event, message] of [['framedetached', /推荐 iframe 已分离/], ['framenavigated', /顶层页面导航/]]) {
    const page = new EventEmitter();
    const main = {};
    page.mainFrame = () => main;
    let reads = 0;
    const frame = {page: () => page, evaluate: async () => {
      if (++reads === 1) return '当前岗位';
      page.emit(event, event === 'framedetached' ? frame : main);
      throw Error('context destroyed');
    }};
    await assert.rejects(selectRecommendJob(frame, '目标岗位', true), message);
    assert.equal(reads, 2);
    assert.equal(page.listenerCount(event), 0);
  }
});

test('job-click frame replacement is confirmed read-only; navigation boundaries remain enforced', async t => {
  for (const scenario of [
    {name:'iframe navigation destroys click response',events:['framenavigated']},
    {name:'iframe detachment destroys click response',events:['framedetached']},
    {name:'iframe navigation followed by replacement',events:['framenavigated','framedetached']},
    {name:'top navigation during click',events:['top'],error:/顶层页面导航/},
    {name:'top navigation during confirmation',events:['framedetached'],confirmNavigation:true,error:/顶层页面导航/},
    {name:'iframe navigation before click',before:'framenavigated',error:/推荐 iframe 导航/},
    {name:'iframe detachment before click',before:'framedetached',error:/推荐 iframe 已分离/},
    {name:'replacement job does not match',events:['framedetached'],label:'错误岗位',error:/推荐岗位与目标不符/},
    {name:'confirmation times out',events:['framedetached'],timeout:true,error:/SIM_CONFIRM_TIMEOUT/},
    {name:'unrelated click error',clickError:'SIM_CLICK_FAILURE',error:/SIM_CLICK_FAILURE/},
  ]) await t.test(scenario.name,async()=>{
    const page=new EventEmitter(),main={},updated={parentFrame:()=>main,evaluate:async()=>scenario.label??'目标岗位'};
    page.mainFrame=()=>main;
    let reads=0,waits=0,clicks=0,confirmations=0,disposed=0;
    const frame={page:()=>page,evaluate:async()=>{
      switch(++reads){
        case 1:return '当前岗位';
        case 2:return true; // Open dropdown.
        case 3:return true; // Set job query.
        case 4:return {ok:true,label:'目标岗位',changed:true};
        case 5:
          clicks++;
          for(const event of scenario.events??[])page.emit(event==='top'?'framenavigated':event,event==='top'?main:frame);
          throw Error(scenario.clickError??'Execution context was destroyed, most likely because of a navigation.');
        default:throw Error('Unexpected access to original frame after click');
      }
    },waitForFunction:async()=>{
      if(++waits===2&&scenario.before)page.emit(scenario.before,frame);
    }};
    page.waitForFunction=async()=>{
      confirmations++;
      if(scenario.confirmNavigation)page.emit('framenavigated',main);
      if(scenario.timeout)throw Error('SIM_CONFIRM_TIMEOUT');
      return {asElement:()=>({contentFrame:async()=>updated}),dispose:async()=>{disposed++;}};
    };
    if(scenario.error)await assert.rejects(selectJob(frame,'目标岗位',true),scenario.error);
    else{
      const result=await selectJob(frame,'目标岗位',true);
      assert.equal(result.label,'目标岗位');assert.equal(result.frame,updated);
    }
    assert.equal(clicks,scenario.before?0:1,'selection must never be replayed');
    assert.equal(confirmations,scenario.before||scenario.events?.includes('top')||scenario.clickError?0:1);
    assert.equal(disposed,confirmations&&!scenario.timeout?1:0);
    assert.equal(page.listenerCount('framenavigated'),0);
    assert.equal(page.listenerCount('framedetached'),0);
  });
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
  const page=new EventEmitter(), main={};
  page.mainFrame=()=>main;
  function row(text){const el=new HTMLElement(text);el.querySelector=()=>({textContent:text});el.click=()=>{selected++;label=text;open=false;page.emit('framedetached',frame);};return el;}
  let rows=[row('行政专员助理'),row('行政专员')];
  const context={HTMLElement,HTMLInputElement,Event:class {},getComputedStyle:()=>({display:'block',visibility:'visible'}),document:{
    querySelector:sel=>sel.includes('ui-dropmenu-label')?host:sel==='.job-selecter-options'?dropdown:sel.includes('chat-job-search')?input:new HTMLElement(),
    querySelectorAll:()=>rows,
  }};
  context.window=context;
  const frame={page:()=>page,evaluate:async script=>vm.runInNewContext(script,context),waitForFunction:async script=>{
    assert.equal(vm.runInNewContext(script,context),true,'wait must evaluate a boolean, not return a function');
  }};
  const updated={parentFrame:()=>main,evaluate:async()=>label};
  const iframe={contentDocument:{location:{origin:'https://www.zhipin.com',pathname:'/web/frame/recommend/'},
    querySelectorAll:()=>[{textContent:label,getClientRects:()=>[{}]}],querySelector:()=>({})}};
  page.waitForFunction=async script=>{
    assert.equal(vm.runInNewContext(script,{document:{querySelectorAll:()=>[iframe]},location:iframe.contentDocument.location}),iframe);
    return {asElement:()=>({contentFrame:async()=>updated}),dispose:async()=>{}};
  };
  const result=await selectJob(frame,'行政专员',true);
  assert.equal(result.label,'行政专员');assert.equal(result.frame,updated);
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
  await assert.rejects(selectRecommendJob(frame,'行政'),/ambiguous/);
  assert.equal(selected,2);
  rows=[row('全栈开发 _ 深圳 15-30K'),row('全栈开发 _ 西安 15-30K')];
  assert.equal(await selectRecommendJob(frame,'全栈开发 _ 深圳',true),'全栈开发 _ 深圳 15-30K');
  assert.equal(input.value,'全栈开发');assert.equal(selected,3);
  await assert.rejects(selectRecommendJob(frame,'全栈开发',true),/ambiguous/);
  assert.equal(selected,3);
  rows=[row('后训练平台工程师 _ 深圳 35-60K')];
  assert.equal(await selectRecommendJob(frame,'后训练平台工程师',true),'后训练平台工程师 _ 深圳 35-60K');
  assert.equal(selected,4);
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
