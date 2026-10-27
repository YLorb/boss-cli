import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

let page;
mock.module('../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:async fn=>fn(page)}});
mock.module('../dist/common/ensure_page.js',{namedExports:{ensurePage:async()=>{}}});
mock.module('../dist/browser/index.js',{namedExports:{RESUME_PREVIEW_OPEN_GAP_MS:{min:0,max:0},sleepRandom:async()=>{}}});
const {runNormalSearch}=await import('../dist/toolset/normal-search.js');

function fixture(rejectInput=false) {
  class Input {
    value='';
    focus() {}
    dispatchEvent(event) {if(rejectInput&&event.type==='keyup')this.value='旧词';}
  }
  const input=new Input();
  const sandbox={HTMLInputElement:Input,Event:class {constructor(type){this.type=type;}},KeyboardEvent:class {constructor(type){this.type=type;}},
    document:{querySelector:selector=>selector==='.search-input'?input:selector==='.geek-list-wrap, .card-list'?{}:null,querySelectorAll:()=>[]}};
  const waits=[];
  const frame={url:()=> 'https://www.zhipin.com/web/frame/search',evaluate:async script=>vm.runInNewContext(script,sandbox),
    waitForFunction:async script=>{
      const result=vm.runInNewContext(script,sandbox);
      assert.equal(typeof result,'boolean','wait script must execute its predicate, not return a function');
      waits.push(result);
      if(!result)throw Error('keyword predicate did not match');
    }};
  page={waitForSelector:async()=>({contentFrame:async()=>frame})};
  return {input,waits};
}

test('keyword wait executes an escaped string predicate and returns the observed keyword',async()=>{
  const {input,waits}=fixture();
  const keyword='C++ "平台"';
  const result=JSON.parse(await runNormalSearch(keyword,true));
  assert.equal(input.value,keyword);
  assert.equal(result.keyword,keyword);
  assert.deepEqual(waits,[true,true,true]);
});

test('rejected keyword input stops before reading candidate results',async()=>{
  const {waits}=fixture(true);
  await assert.rejects(runNormalSearch('新词',true),/keyword predicate did not match/);
  assert.deepEqual(waits,[true,false]);
});
