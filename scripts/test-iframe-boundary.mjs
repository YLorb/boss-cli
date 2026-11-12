import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {directResumeFrame,ResumeFrameOpenError} from '../dist/common/resume_frame_locator.js';

/**
 * 沙箱里必须有真正的 HTMLElement：可见判据用 `el instanceof HTMLElement` 做首道过滤，
 * 直接在 vm 里跑真实脚本却没有该构造器时，任何用例都会 ReferenceError（而不是测到逻辑）。
 */
function sandbox(){
  const ctx={window:{innerHeight:800},document:{body:{},querySelectorAll:()=>[]},
    getComputedStyle:()=>({display:'block',visibility:'visible'})};
  runInNewContext('class HTMLElement {}\nglobalThis.HTMLElement = HTMLElement;',ctx);
  return ctx;
}

/** panels: 每项描述一个 .resume-middle-wrap；layer 对应它所属的 .dialog-wrap 类名。 */
function fixture({panels=[{frames:[{src:'/web/frame/c-resume/x',tag:'only'}],layer:'active'}],
  content='ready',wrongParent=false,failure=null}={}){
  let queries=0,disposed=0,attachments=0;
  const ctx=sandbox();
  const make=({width=100,height=100,src=null,tag=null,children=[],layer=null}={})=>{
    const node=new ctx.HTMLElement();
    node.__tag=tag;
    node.getBoundingClientRect=()=>({width,height,top:0,left:0});
    node.getAttribute=name=>name==='src'?src:null;
    node.querySelectorAll=()=>children;
    node.closest=selector=>{
      // 可见判据用组合选择器（返回外层弹窗，需有 rect）；层级判定单独取 '.dialog-wrap'。
      if(String(selector).trim()!=='.dialog-wrap'||layer===null)return null;
      return {classList:{contains:name=>String(layer).split(/\s+/).includes(name)}};
    };
    node.parentElement=null;
    return node;
  };
  const panelNodes=panels.map(p=>make({layer:p.layer??'active',width:p.width??100,
    children:(p.frames??[]).map(f=>make({src:f.src,tag:f.tag,width:f.width??100}))}));
  ctx.document.querySelectorAll=selector=>String(selector).includes('resume-middle-wrap')?panelNodes:[];
  const host={evaluateHandle:async script=>{
    queries++;assert.equal(typeof script,'string');
    const node=runInNewContext(script,ctx);
    const dispose=async()=>{disposed++;};
    return {dispose,asElement:()=>node?{dispose,contentFrame:async()=>{
      if(failure)throw failure;
      attachments++;
      return content==='null'||(content==='late'&&attachments===1)?null:{detached:content==='detached',tag:node.__tag,parentFrame:()=>wrongParent?{}:host};
    }}:null};
  }};
  return {host,counts:()=>({queries,disposed})};
}

for(const options of [{panels:[]},{panels:[{frames:[]}]},{panels:[{frames:[{src:'/web/frame/c-resume/x',width:0}]}]}])
  test(`missing or invisible resume iframe returns no target: ${JSON.stringify(options)}`,async()=>{
    const f=fixture(options);assert.equal(await directResumeFrame(f.host),null);
    assert.deepEqual(f.counts(),{queries:1,disposed:1});
  });

// 回归：一次打开失败留下的空面板 / 非简历 iframe 面板，不得让后续候选人连带失败。
for(const options of [
  {panels:[{frames:[],layer:'deactive'},{frames:[{src:'/web/frame/c-resume/x',tag:'live'}],layer:'active'}]},
  {panels:[{frames:[{src:'about:blank'}],layer:'deactive'},{frames:[],layer:'deactive'},{frames:[{src:'/web/frame/c-resume/x',tag:'live'}],layer:'active'}]},
]) test(`stale panels without a live resume are ignored: ${JSON.stringify(options.panels.length)} panels`,async()=>{
  const f=fixture(options);
  const frame=await directResumeFrame(f.host);
  assert.ok(frame,'应定位到唯一一份可见简历');
  assert.equal(frame.tag,'live');
  assert.deepEqual(f.counts(),{queries:1,disposed:1});
});

test('different dialog classes cannot resolve two live resumes',async()=>{
  const f=fixture({panels:[
    {frames:[{src:'/web/frame/c-resume/x',tag:'stale'}],layer:'dialog-wrap deactive'},
    {frames:[{src:'/web/frame/c-resume/x',tag:'current'}],layer:'dialog-wrap active'},
  ]});
  await assert.rejects(directResumeFrame(f.host),/不唯一/);
  assert.deepEqual(f.counts(),{queries:1,disposed:0});
});

test('two live resumes both in active layers is ambiguous and stops',async()=>{
  const f=fixture({panels:[
    {frames:[{src:'/web/frame/c-resume/x',tag:'a'}],layer:'dialog-wrap active'},
    {frames:[{src:'/web/frame/c-resume/x',tag:'b'}],layer:'dialog-wrap active'},
  ]});
  await assert.rejects(directResumeFrame(f.host),/不唯一/);
  assert.equal(f.counts().queries,1);
});

test('two live resumes without any dialog layer are ambiguous and stop',async()=>{
  const f=fixture({panels:[
    {frames:[{src:'/web/frame/c-resume/x',tag:'a'}],layer:null},
    {frames:[{src:'/web/frame/c-resume/x',tag:'b'}],layer:null},
  ]});
  await assert.rejects(directResumeFrame(f.host),/不唯一/);
  assert.equal(f.counts().queries,1);
});

test('several live iframes inside one panel are ambiguous',async()=>{
  const f=fixture({panels:[{frames:[{src:'/web/frame/c-resume/x',tag:'first'},{src:'/web/frame/c-resume/x',tag:'last'}],layer:'active'}]});
  await assert.rejects(directResumeFrame(f.host),/不唯一/);
  assert.equal(f.counts().queries,1);
});

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

test('late attachment of the same element waits without looking up a different panel', async () => {
  const f = fixture({ content: 'late' });
  const result = await directResumeFrame(f.host, 500);
  assert.equal(result.tag, 'only');
  assert.deepEqual(f.counts(), { queries: 1, disposed: 1 });
});
