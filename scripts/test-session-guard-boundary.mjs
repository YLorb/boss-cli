import {test,mock,beforeEach} from 'node:test';
import assert from 'node:assert/strict';

let events,guardError,guardGate,lockError;
const page={isClosed:()=>false,url:()=> 'https://www.zhipin.com/web/chat/index',
  evaluate:async()=> 'visible',bringToFront:async()=>{events.push('focus');}};
mock.module('../dist/browser/browser_session.js',{namedExports:{
  ensureBrowserSession:async()=>{events.push('connect');},getBrowserRef:()=>({}),getPageRef:()=>page,
  setSessionPage:()=>{events.push('select-page');},
}});
mock.module('../dist/common/boss_page_guards.js',{namedExports:{installBossPageGuards:async()=>{
  events.push('guard-start');if(guardGate)await guardGate;if(guardError)throw guardError;events.push('guard-ready');
}}});
mock.module('../dist/common/boss_session_lock.js',{namedExports:{withBossSessionLock:async fn=>{
  events.push('lock');if(lockError)throw lockError;
  try{return await fn();}finally{events.push('unlock');}
}}});
const {withBossSessionPage}=await import('../dist/common/boss_session_page.js');
beforeEach(()=>{events=[];guardError=null;guardGate=null;lockError=null;});
const relaxed={ensureChatShell:false,ensureMenuList:false};
const action=async()=>{events.push('business');return 'done';};

test('disabling shell and menu prechecks does not disable the guard or lock',async()=>{
  assert.equal(await withBossSessionPage(action,relaxed),'done');
  assert.deepEqual(events,['lock','connect','select-page','guard-start','guard-ready','business','unlock']);
});

for(const options of [{},{ensureMenuList:false},relaxed]){
  test(`guard failure blocks business even with precheck options ${JSON.stringify(options)}`,async()=>{
    guardError=new Error('guard installation failed');
    await assert.rejects(withBossSessionPage(action,options),error=>error===guardError);
    assert.equal(events.includes('business'),false);
    assert.equal(events.filter(e=>e==='guard-start').length,1);
    assert.equal(events.filter(e=>e==='connect').length,1);
    assert.equal(events.at(-1),'unlock');
  });
}

test('business waits until guard installation resolves',async()=>{
  let release;guardGate=new Promise(resolve=>{release=resolve;});
  const running=withBossSessionPage(action,relaxed);
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(events.includes('guard-start'));assert.equal(events.includes('business'),false);
  release();await running;
  assert.ok(events.indexOf('guard-ready')<events.indexOf('business'));
});

test('failed session lock prevents connecting, installing or executing an action',async()=>{
  lockError=new Error('session is owned by another process');
  await assert.rejects(withBossSessionPage(action,relaxed),error=>error===lockError);
  assert.deepEqual(events,['lock']);
});

test('business exception after successful installation is exposed once without reconnect or retry',async()=>{
  const error=new Error('Execution context was destroyed');
  await assert.rejects(withBossSessionPage(async()=>{events.push('business');throw error;},relaxed),e=>e===error);
  for(const event of ['lock','connect','guard-start','business','unlock'])assert.equal(events.filter(e=>e===event).length,1);
});
