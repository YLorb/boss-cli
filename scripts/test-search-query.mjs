import test from 'node:test';import assert from 'node:assert/strict';import puppeteer from 'puppeteer-core';
import {submitSearchQuery,responseCards,searchMatchesEvidenceScript} from '../dist/toolset/search_query.js';
test('search response schema cannot turn errors or missing identities into zero results',()=>{
 assert.deepEqual(responseCards({code:0,zpData:{geeks:[]}}),[]);
 for(const p of [{code:1,message:'error'},{code:0,zpData:{}},{code:0,zpData:{geeks:[{geekCard:{encryptGeekId:'a'}}]}},{code:0,zpData:{geeks:[{geekCard:{encryptGeekId:'a',lid:'x'}},{geekCard:{encryptGeekId:'a',lid:'y'}}]}}])assert.throws(()=>responseCards(p));
});
test('query waits for its response and rendered IDs/lids, handles zero/errors and never retries',async()=>{
 const browser=await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
 try{
  const page=await browser.newPage();let payload,requests=0;
  await page.setRequestInterception(true);page.on('request',r=>{
   if(new URL(r.url()).pathname.includes('geeks.json')){requests++;void r.respond({status:200,contentType:'application/json',body:JSON.stringify(payload)});}
   else void r.respond({status:200,contentType:'text/html',body:'<html></html>'});
  });
  await page.goto('https://www.zhipin.com/web/frame/search/');const frame=page.mainFrame();
  async function setup(geeks){payload={code:0,zpData:{geeks}};requests=0;await page.setContent('<div class="search-container"></div><input class="search-input"><ul></ul>');await page.evaluate(`(()=>{const v={$options:{name:'SearchCandidatesIndex'},loadding$:false,isInitPage$:false,params$:{keywords:'old',jobId:'job',page:1},renderList$:[{geekCard:{encryptGeekId:'old',lid:'old-lid'}}]};document.querySelector('.search-container').__vue__=v;window.render=rows=>{v.renderList$=rows;document.querySelector('ul').replaceChildren();for(const x of rows){const li=document.createElement('li');li.className='geek-info-card';li.__vue__={$props:{geek:x}};document.querySelector('ul').append(li)}};window.render(v.renderList$)})()`);}
  const submit=(delay=80,render=true)=>async()=>{await page.evaluate(`(()=>{const v=document.querySelector('.search-container').__vue__;v.loadding$=true;v.params$.keywords='new';document.querySelector('input').value='new';fetch('/wapi/zpitem/web/boss/search/geeks.json?keywords=new&jobId=job&page=1').then(r=>r.json()).then(p=>{setTimeout(()=>{v.loadding$=false;if(${render}&&p.code===0)window.render(p.zpData.geeks)},${delay})})})()`)};
  await setup([{geekCard:{encryptGeekId:'a',lid:'new-lid'}}]);const started=Date.now();const e=await submitSearchQuery(frame,'new',submit(180),1500);assert.ok(Date.now()-started>=150);assert.deepEqual(e.cards,[{id:'a',lid:'new-lid'}]);assert.equal(requests,1);
  assert.equal(await page.evaluate(searchMatchesEvidenceScript(e)),true);
  await page.evaluate(`document.querySelector('.search-container').__vue__.params$.keywords='changed'`);assert.equal(await page.evaluate(searchMatchesEvidenceScript(e)),false);
  await setup([]);const empty=await submitSearchQuery(frame,'new',submit(),1000);assert.deepEqual(empty.cards,[]);assert.equal(requests,1);
  await setup([{geekCard:{encryptGeekId:'old',lid:'NEW-query'}}]);await assert.rejects(submitSearchQuery(frame,'new',submit(1,false),200),/Waiting failed/);assert.equal(requests,1);
  await setup([]);payload={code:5003,message:'rate limit'};await assert.rejects(submitSearchQuery(frame,'new',submit(),1000),/code=5003/);assert.equal(requests,1);
  await setup([]);await assert.rejects(submitSearchQuery(frame,'new',async()=>{},120),/matchedRequests=0/);assert.equal(requests,0);
  await setup([]);await page.evaluate(`document.querySelector('.search-container').__vue__.loadding$=true`);await assert.rejects(submitSearchQuery(frame,'new',submit(),120),/仍在加载/);assert.equal(requests,0);
  assert.equal(page.listenerCount('response'),0);assert.equal(page.listenerCount('requestfailed'),0);
 }finally{await browser.close()}
});
