import assert from 'node:assert/strict';
import { test, mock } from 'node:test';

let url='https://www.zhipin.com/web/chat/recommend', focused=0;
const page={isClosed:()=>false,url:()=>url,evaluate:async()=> 'visible',bringToFront:async()=>{focused++;}};
mock.module('../dist/browser/browser_session.js',{namedExports:{
  ensureBrowserSession:async()=>{},getBrowserRef:()=>({}),getPageRef:()=>page,setSessionPage:()=>{},
}});
mock.module('../dist/common/boss_page_guards.js',{namedExports:{installBossPageGuards:async()=>{}}});
mock.module('../dist/common/boss_session_lock.js',{namedExports:{withBossSessionLock:async fn=>fn()}});
const {withBossSessionPage}=await import('../dist/common/boss_session_page.js');

test('context destruction is exposed after one attempt without refocusing a visible page',async()=>{
  let actions=0;
  await assert.rejects(withBossSessionPage(async()=>{actions++;throw new Error('Execution context was destroyed');},{ensureMenuList:false}),/Execution context was destroyed/);
  assert.equal(actions,1);assert.equal(focused,0);
});
test('unexpected page stops before business callback instead of navigating to chat',async()=>{
  url='https://www.zhipin.com/web/frame/c-resume/123';
  let actions=0;
  await assert.rejects(withBossSessionPage(async()=>{actions++;},{ensureMenuList:false}),/不会自动导航/);
  assert.equal(actions,0);
});
