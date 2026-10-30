import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
import {directResumeFrame,ResumeFrameOpenError} from '../dist/common/resume_frame_locator.js';
import {withSearchResumeRecovery,closeSearchResumeScript,SEARCH_RESUME_CONDITIONS_SCRIPT} from '../dist/toolset/search-resume-recovery.js';

test('direct locator queries only the verified host and rejects ambiguous/detached targets',async()=>{
  const visible=e=>({getBoundingClientRect:()=>({width:100,height:100}),...e});
  const iframe=visible({}),panel=visible({querySelectorAll:()=>[iframe]});
  let panels=[panel],queries=0,disposed=0;
  const host={evaluateHandle:async script=>{
    queries++;const node=runInNewContext(script,{document:{querySelectorAll:()=>panels},getComputedStyle:()=>({display:'block',visibility:'visible'})});
    return {asElement:()=>node?{contentFrame:async()=>target,dispose:async()=>disposed++}:null,dispose:async()=>disposed++};
  }};
  const target={parentFrame:()=>host,detached:false};
  assert.equal(await directResumeFrame(host),target);assert.equal(queries,1);assert.equal(disposed,1);
  panels=[];assert.equal(await directResumeFrame(host),null);
  panels=[panel,panel];await assert.rejects(directResumeFrame(host),/不唯一/);
  panels=[panel];target.detached=true;await assert.rejects(directResumeFrame(host),ResumeFrameOpenError);
});

function fixture(){
  const page=new EventEmitter(),main={};let value='fixed',closes=0;
  page.url=()=> 'https://www.zhipin.com/web/chat/search';page.mainFrame=()=>main;
  page.evaluate=async()=>{closes++;return {clicked:true};};
  page.waitForFunction=async()=>({dispose:async()=>{}});
  const search={detached:false,evaluate:async()=>value};
  return {page,search,main,setConditions:v=>value=v,closes:()=>closes};
}
function conditionsFixture(){
  const root={$options:{name:'SearchCandidatesIndex'},isInitPage$:false,loadding$:false,params$:{keywords:'GPU 服务器',jobId:'job',city:'深圳',page:1},renderList$:[]};
  const input={value:'GPU 服务器'},job={textContent:'服务器系统工程师'};
  const document={querySelectorAll:()=>[{__vue__:root}],querySelector:s=>s==='.search-input'?input:job};
  return {root,input,job,read:()=>runInNewContext(SEARCH_RESUME_CONDITIONS_SCRIPT,{document})};
}
test('dynamic rows, pagination and background list loading do not change filter identity',async()=>{
  const c=conditionsFixture(),f=fixture();f.search.evaluate=async()=>c.read();
  const before=c.read();let attempts=0;
  const r=await withSearchResumeRecovery(f.page,f.search,'id',async()=>{
    attempts++;c.root.params$.page++;c.root.renderList$.push({geekCard:{encryptGeekId:'new'+attempts}});c.root.loadding$=true;
    if(attempts===1)throw new ResumeFrameOpenError('detached');
    return 'ok';
  });
  assert.equal(c.read(),before);assert.equal(r.result,'ok');assert.equal(attempts,2);assert.equal(f.closes(),1);
});
test('city, job, keyword and other filters still stop; initialization and missing params fail',async()=>{
  for(const change of [c=>c.root.params$.city='上海',c=>c.root.params$.jobId='other',c=>c.input.value='other',c=>c.root.params$.keywords='other',c=>c.job.textContent='other',c=>c.root.params$.degree='本科']){
    const c=conditionsFixture(),f=fixture();f.search.evaluate=async()=>c.read();
    await assert.rejects(withSearchResumeRecovery(f.page,f.search,'id',async()=>{change(c);throw new ResumeFrameOpenError('detached');}),/搜索筛选条件变化/);
    assert.equal(f.closes(),0);
  }
  const c=conditionsFixture();c.root.isInitPage$=true;assert.throws(c.read,/初始化/);
  c.root.isInitPage$=false;c.root.params$=null;assert.throws(c.read,/参数/);
});
test('opening failure permits exactly one guarded close and second attempt, preserves first error',async()=>{
  const f=fixture();let attempts=0;
  const r=await withSearchResumeRecovery(f.page,f.search,'id',async()=>{if(++attempts===1)throw new ResumeFrameOpenError('detached');return 'ok';});
  assert.equal(attempts,2);assert.equal(f.closes(),1);assert.equal(r.recovery.firstError,'detached');assert.equal(r.result,'ok');
  assert.equal(f.page.listenerCount('framenavigated'),0);
});
test('identity errors and changed city/query/navigation stop before close',async()=>{
  for(const kind of ['identity','conditions','navigation']){
    const f=fixture();let attempts=0;
    await assert.rejects(withSearchResumeRecovery(f.page,f.search,'id',async()=>{
      attempts++;if(kind==='identity')throw Error('identity mismatch');
      if(kind==='conditions')f.setConditions('other-city');
      if(kind==='navigation')f.page.emit('framenavigated',f.main);
      throw new ResumeFrameOpenError('detached');
    }));
    assert.equal(attempts,1);assert.equal(f.closes(),0);
  }
});
test('second failure and close failure never cause a third attempt',async()=>{
  let f=fixture(),attempts=0;
  await assert.rejects(withSearchResumeRecovery(f.page,f.search,'id',async()=>{attempts++;throw new ResumeFrameOpenError('detached');}),/重开一次后失败/);
  assert.equal(attempts,2);assert.equal(f.closes(),1);
  f=fixture();attempts=0;f.page.evaluate=async()=>{throw Error('button covered');};
  await assert.rejects(withSearchResumeRecovery(f.page,f.search,'id',async()=>{attempts++;throw new ResumeFrameOpenError('detached');}),/covered/);
  assert.equal(attempts,1);
});
test('guarded close verifies identity, unique visible button and hit-test before one click',()=>{
  let clicks=0,wrongId=false,covered=false,multiple=false;
  const element=e=>({getClientRects:()=>[{}],getBoundingClientRect:()=>({left:10,top:10,width:100,height:100}),...e});
  const button=element({click:()=>clicks++,matches:()=>false,contains:()=>false});
  const box=element({});Object.defineProperty(box,'__vue__',{get(){return {$props:{geekInfo:{encryptGeekId:wrongId?'other':'id'},resumeInfo:{encryptGeekId:'id'}}};}});
  const dialog={querySelectorAll:()=>multiple?[button,button]:[button]};
  const panel=element({querySelectorAll:s=>s.startsWith('iframe')?[element({})]:[box],closest:()=>dialog});
  const run=()=>runInNewContext(closeSearchResumeScript('id'),{document:{querySelectorAll:()=>[panel],elementFromPoint:()=>covered?{}:button},getComputedStyle:()=>({display:'block',visibility:'visible',pointerEvents:'auto'}),innerWidth:1000,innerHeight:1000});
  run();assert.equal(clicks,1);
  wrongId=true;assert.throws(run,/身份/);wrongId=false;
  covered=true;assert.throws(run,/遮挡/);covered=false;
  multiple=true;assert.throws(run,/不唯一/);assert.equal(clicks,1);
});
