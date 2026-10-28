import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { runInNewContext } from 'node:vm';

let candidateReads, opened, resume, main, search, panelCount, frameCount, boxCount, props, controls;
mock.module('../dist/toolset/normal-search.js', {namedExports:{
  assertNormalSearchPageReadyForPreview: async()=>search,
  openNormalSearchResumePreview: async()=>{ opened++; return true; },
}});
mock.module('../dist/toolset/search-greet.js', {namedExports:{
  visibleResumeFrame: async()=>resume,
  readSearchCandidateId: async()=>candidateReads.shift(),
  greetNormalSearch: async()=>{ throw Error('preview must never depend on contact readiness'); },
}});
mock.module('../dist/common/boss_paywall_popup.js', {namedExports:{
  waitForCResumeIframeOrPaywall: async()=> 'iframe',
  describeBossPaywallPopupIfPresent: async()=>null,
}});
const {openSearchResumeOnly}=await import('../dist/toolset/open-search-resume.js');

function fixture(labels=[]){
  candidateReads=['candidate-1','candidate-1']; opened=0; main={}; search={};
  panelCount=frameCount=boxCount=1;
  props={geekInfo:{encryptGeekId:'candidate-1'},resumeInfo:{encryptGeekId:'candidate-1'}};
  const element=extra=>({getClientRects:()=>[{}],...extra});
  controls=labels.map(textContent=>element({textContent,click(){throw Error('must not click');}}));
  const box=element({get __vue__(){return {$props:props};},querySelectorAll:()=>controls});
  const panel=element({querySelectorAll:selector=>selector.startsWith('iframe')?Array(frameCount).fill(element({})):Array(boxCount).fill(box)});
  resume={parentFrame:()=>main,url:()=> 'https://www.zhipin.com/web/frame/c-resume/',waitForFunction:async script=>assert.equal(typeof script,'string')};
  return {mainFrame:()=>main,url:()=> 'https://www.zhipin.com/web/chat/search',evaluate:async script=>{
    assert.equal(typeof script,'string');
    return runInNewContext(script,{document:{querySelectorAll:()=>Array(panelCount).fill(panel)},getComputedStyle:()=>({display:'block',visibility:'visible'})});
  }};
}

test('preview reuses identified resume without a contact button and never clicks',async()=>{
  const result=await openSearchResumeOnly(fixture(),'n**','candidate-1');
  assert.equal(result.identityVerified,true); assert.equal(result.reused,true);
  assert.equal(result.controls.length,0); assert.equal(opened,0);
});
test('card and unavailable contact labels are informational, not a preview prerequisite',async()=>{
  const result=await openSearchResumeOnly(fixture(['畅聊卡 3/25','联系Ta']),'n**','candidate-1');
  assert.deepEqual(Array.from(result.controls,c=>c.text),['畅聊卡 3/25','联系Ta']); assert.equal(opened,0);
});
test('either missing or mismatched resume identity blocks preview',async()=>{
  for(const field of ['geekInfo','resumeInfo'])for(const value of ['','other']){
    const page=fixture(); props[field].encryptGeekId=value;
    await assert.rejects(openSearchResumeOnly(page,'n**','candidate-1'),/ID/); assert.equal(opened,0);
  }
});
test('ambiguous panel, identity box and iframe association fail closed',async()=>{
  for(const kind of ['panel','frame','box']){
    const page=fixture();
    if(kind==='panel')panelCount=2; if(kind==='frame')frameCount=0; if(kind==='box')boxCount=2;
    await assert.rejects(openSearchResumeOnly(page,'n**','candidate-1'),/不唯一/); assert.equal(opened,0);
  }
});
test('candidate changing after open and wrong iframe parent stop preview',async()=>{
  let page=fixture(); candidateReads=['candidate-1','candidate-2'];
  await assert.rejects(openSearchResumeOnly(page,'n**','candidate-1'),/身份已变化/);
  page=fixture(); resume.parentFrame=()=>({});
  await assert.rejects(openSearchResumeOnly(page,'n**','candidate-1'),/不属于主页面/);
});
