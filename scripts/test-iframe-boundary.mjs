import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {directResumeFrame,ResumeFrameOpenError} from '../dist/common/resume_frame_locator.js';

function fixture({panels=1,frames=1,hidden=false,content='ready',wrongParent=false,failure=null}={}){
  let queries=0,disposed=0;
  const visible=extra=>({getBoundingClientRect:()=>({width:hidden?0:100,height:100}),...extra});
  const iframe=visible({});const panel=visible({querySelectorAll:()=>Array(frames).fill(iframe)});
  const host={evaluateHandle:async script=>{
    queries++;assert.equal(typeof script,'string');
    const node=runInNewContext(script,{document:{querySelectorAll:()=>Array(panels).fill(panel)},
      getComputedStyle:()=>({display:'block',visibility:'visible'})});
    const dispose=async()=>{disposed++;};
    return {dispose,asElement:()=>node?{dispose,contentFrame:async()=>{
      if(failure)throw failure;
      return content==='null'?null:{detached:content==='detached',parentFrame:()=>wrongParent?{}:host};
    }}:null};
  }};
  return {host,counts:()=>({queries,disposed})};
}
for(const options of [{panels:0},{frames:0},{hidden:true}]){
  test(`missing or invisible resume iframe returns no target: ${JSON.stringify(options)}`,async()=>{
    const f=fixture(options);assert.equal(await directResumeFrame(f.host),null);
    assert.deepEqual(f.counts(),{queries:1,disposed:1});
  });
}
for(const options of [{panels:2},{frames:2}]){
  test(`ambiguous panels/iframes never select the first target: ${JSON.stringify(options)}`,async()=>{
    const f=fixture(options);await assert.rejects(directResumeFrame(f.host),/不唯一/);
    assert.equal(f.counts().queries,1);
  });
}
for(const content of ['null','detached']){
  test(`unready or detached content frame is rejected and handle released: ${content}`,async()=>{
    const f=fixture({content});await assert.rejects(directResumeFrame(f.host),ResumeFrameOpenError);
    assert.deepEqual(f.counts(),{queries:1,disposed:1});
  });
}
test('foreign parent frame is rejected instead of scanning other page frames',async()=>{
  const f=fixture({wrongParent:true});await assert.rejects(directResumeFrame(f.host),/不属于已核验宿主/);
  assert.deepEqual(f.counts(),{queries:1,disposed:1});
});
for(const message of ['frame got detached','Execution context was destroyed']){
  test(`frame lookup exception is exposed without retry: ${message}`,async()=>{
    const f=fixture({failure:new Error(message)});
    await assert.rejects(directResumeFrame(f.host),new RegExp(message));
    assert.deepEqual(f.counts(),{queries:1,disposed:1});
  });
}
