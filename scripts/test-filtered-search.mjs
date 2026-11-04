import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import puppeteer from 'puppeteer-core';

let page;
mock.module('../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:fn=>fn(page)}});
const {runNormalSearch,runSearchControl}=await import('../dist/toolset/normal-search.js');

test('city, job, keyword and one search click keep the requested city after a job resets it',async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
  try {
    page=await browser.newPage();
    await page.setRequestInterception(true);
    let searches=0, mainLoads=0;
    const form='<div class="search-container"><div class="city-wrap"><span class="city-label">上海</span><div class="search-city-kw"><input></div><div class="city-box searching" hidden><div class="search-result-item">深圳</div></div></div><div class="search-job-list-C"><span class="search-current-job">不限职位</span><ul hidden><li ka="search_select_job"><span class="job-name">训练工程师</span></li></ul></div><input class="search-input"><button class="icon-search">搜索</button></div><div class="empty-tips">暂无结果</div>';
    page.on('request',r=>{
      const u=new URL(r.url());
      if(u.pathname.endsWith('/geeks.json')){
        searches++;
        return void r.respond({status:200,contentType:'application/json',body:'{"code":0,"zpData":{"geeks":[]}}'});
      }
      const main=u.pathname==='/web/chat/search';
      if(main)mainLoads++;
      void r.respond({status:200,contentType:'text/html;charset=utf-8',body:main?'<iframe name="searchFrame" src="/web/frame/search"></iframe>':form});
    });
    await page.goto('https://www.zhipin.com/web/chat/search');
    const frame=page.frames().find(f=>f!==page.mainFrame());
    await frame.evaluate(`(() => {
      const q=s=>document.querySelector(s), p={city:'31',cityName:'上海',jobId:'',keywords:'',page:1};
      q('.search-container').__vue__={$options:{name:'SearchCandidatesIndex'},loadding$:false,isInitPage$:false,params$:p,renderList$:[]};
      window.steps=[];
      q('.search-city-kw input').oninput=()=>{q('.city-box').hidden=false;};
      q('.search-result-item').onclick=()=>{window.steps.push('city');q('.city-box').hidden=true;q('.city-label').textContent=p.cityName='深圳';p.city='44';};
      q('.search-current-job').onclick=()=>{q('ul').hidden=false;};
      q('li').onclick=()=>{window.steps.push('job');q('ul').hidden=true;q('.search-current-job').textContent='训练工程师';p.jobId='j';q('.city-label').textContent=p.cityName='上海';p.city='31';};
      q('.search-input').oninput=()=>window.steps.push('input');
      q('button').onclick=()=>{window.steps.push('search');p.keywords=q('.search-input').value;fetch('/wapi/zpitem/web/boss/search/geeks.json?'+new URLSearchParams(p));};
    })()`);
    const result=JSON.parse(await runNormalSearch('SFT',true,{city:'深圳',job:'训练工程师'}));
    assert.deepEqual(result,{keyword:'SFT',city:'深圳',job:'训练工程师',candidates:[]});
    assert.deepEqual(await frame.evaluate('window.steps'),['city','job','city','input','search']);
    assert.equal(searches,1);assert.equal(mainLoads,1);
    for(const control of [{action:'city',value:'深圳'},{action:'job',value:'训练工程师'},{action:'keyword',value:'字节、京东、腾讯、阿里'}]){
      const step=JSON.parse(await runSearchControl(control,true));
      assert.equal(step.submitted,false);
      assert.equal(searches,1);
    }
    const submitted=JSON.parse(await runSearchControl({action:'submit'},true));
    assert.equal(submitted.keyword,'字节、京东、腾讯、阿里');
    assert.equal(submitted.submitted,true);
    assert.equal(searches,2);
    const jobOnly=JSON.parse(await runNormalSearch(undefined,true,{job:'训练工程师'}));
    assert.equal(jobOnly.job,'训练工程师');
    assert.equal(searches,2);
    await frame.evaluate("document.querySelector('li').after(document.querySelector('li').cloneNode(true))");
    await assert.rejects(runNormalSearch('SFT',true,{city:'深圳',job:'训练工程师'}),/未唯一匹配/);
    assert.equal(searches,2);
  } finally {await browser.close();}
});
