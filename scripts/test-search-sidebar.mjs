import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const realPuppeteer=puppeteer;
let events=[],url='https://www.zhipin.com/web/chat/search',frameCount=1,fail=false;
const frame={url:()=> 'https://www.zhipin.com/web/frame/search/',evaluate:async script=>{events.push('read');assert.equal(typeof script,'string');if(fail)throw Error('detached');return {sidebar:{text:'我的订阅'},keyword:'GPU',job:'系统工程师'};}};
const page={url:()=>url,frames:()=>Array(frameCount).fill(frame)};
mock.module('puppeteer-core',{defaultExport:{connect:async()=>{events.push('connect');return {pages:async()=>[page],disconnect:async()=>events.push('disconnect')};}}});
mock.module('../dist/common/boss_page_guards.js',{namedExports:{installBossPageGuards:async()=>events.push('guard')}});
mock.module('../dist/common/boss_session_lock.js',{namedExports:{withBossSessionLock:async fn=>{events.push('lock');try{return await fn();}finally{events.push('unlock');}}}});
const {runSearchSidebar,SEARCH_SIDEBAR_SCRIPT}=await import('../dist/toolset/search-sidebar.js');
test('guarded existing-session read; invalid page/frame and read failures never retry',async()=>{
 assert.equal(JSON.parse(await runSearchSidebar()).guarded,true);
 assert.deepEqual(events,['lock','connect','guard','read','disconnect','unlock']);
 events=[];url='https://www.zhipin.com/web/chat/recommend';
 await assert.rejects(runSearchSidebar(),/仅允许当前常规搜索页/);
 assert.deepEqual(events,['lock','connect','disconnect','unlock']);
 url='https://www.zhipin.com/web/chat/search';frameCount=2;events=[];
 await assert.rejects(runSearchSidebar(),/不唯一/);assert.equal(events.includes('read'),false);
 frameCount=1;fail=true;events=[];await assert.rejects(runSearchSidebar(),/detached/);
 assert.equal(events.filter(x=>x==='read').length,1);assert.equal(events.at(-2),'disconnect');fail=false;
});
test('offline DOM: scoped sidebar, unchanged DOM/conditions, duplicate or missing anchors fail',async()=>{
 const browser=await realPuppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
 try{
  const p=await browser.newPage();await p.setRequestInterception(true);p.on('request',r=>void r.abort());
  const html='<input class="search-input" value="GPU"><span class="search-current-job">系统工程师</span><div class="geek-info-card">候选人不应读取</div><aside><div>搜索畅聊卡 <b>x41</b></div><section><header><span>我的订阅</span></header><article style="cursor:pointer">服务器系统工程师<div>推理、GPU、硬件</div><span>1小时前查看</span></article></section></aside>';
  await p.setContent(html);const before=await p.content();
  const r=await p.evaluate(SEARCH_SIDEBAR_SCRIPT);
  assert.match(r.sidebar.text,/x41/);assert.match(r.sidebar.text,/推理、GPU、硬件/);assert.doesNotMatch(r.sidebar.text,/候选人/);
  assert.equal(r.keyword,'GPU');assert.equal(r.elements.some(e=>e.tag==='ARTICLE'&&e.cursor==='pointer'),true);assert.equal(await p.content(),before);
  await p.setContent(html+'<div>我的订阅</div>');await assert.rejects(p.evaluate(SEARCH_SIDEBAR_SCRIPT),/不唯一/);
  await p.setContent('<div>搜索畅聊卡</div><div>我的订阅</div>');await assert.rejects(p.evaluate(SEARCH_SIDEBAR_SCRIPT),/独立容器/);
  await p.setContent('<div>没有订阅侧栏</div>');await assert.rejects(p.evaluate(SEARCH_SIDEBAR_SCRIPT),/缺失/);
 }finally{await browser.close();}
});
