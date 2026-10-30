import test,{mock} from 'node:test';import assert from 'node:assert/strict';import puppeteer from 'puppeteer-core';
mock.module('../dist/browser/index.js',{namedExports:{JOB_SEARCH_ACTION_GAP_MS:{min:0,max:0},JOB_SELECT_ACTION_GAP_MS:{min:0,max:0},RESUME_PREVIEW_OPEN_GAP_MS:{min:0,max:0},sleepRandom:async()=>{}}});
const {readRecommendList,openRecommendResumePreview,clickGreet}=await import('../dist/toolset/recommend.js');
const {readRecommendCandidateId,assertRecommendResumeIdentity}=await import('../dist/toolset/recommend_identity.js');
const {STATUS_SCRIPT,matchesStatus}=await import('../dist/toolset/check.js');
test('recommendation canonical roots, exact name/ID, component identity and optional experience',async()=>{
 const browser=await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
 try{
  const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>void r.abort());
  async function setup(rows){
   await page.setContent('<ul class="card-list"></ul>');
   await page.evaluate(`(()=>{window.opens=0;window.greets=0;for(const x of ${JSON.stringify(rows)}){const li=document.createElement('li');li.className='card-item';li.innerHTML='<div class="candidate-card-wrap"><div class="card-inner"><div class="name-wrap"><span class="name"></span></div></div><div class="button-chat-wrap"><button class="btn btn-greet">打招呼</button></div><div class="work-exps"><div class="timeline-item"><div class="content">云服务公司 Go</div></div></div><div class="edu-exps"><div class="timeline-item"><div class="content">测试大学 计算机</div></div></div></div>';const c=li.firstChild,inner=c.querySelector('.card-inner');inner.setAttribute('data-geekid',x.id);c.querySelector('.name').textContent=x.name;inner.__vue__={$props:{geekInfo:{geekName:x.componentName??x.name,encryptGeekId:x.componentId??x.id}}};inner.onclick=()=>window.opens++;c.querySelector('button').onclick=()=>window.greets++;if(x.noExperience){c.querySelector('.work-exps').remove();c.querySelector('.edu-exps').remove()}document.querySelector('ul').append(li)}})()`);
  }
  await setup([{name:'陈成',id:'a'},{name:'陈东成',id:'b'}]);
  const rows=await readRecommendList(page);assert.equal(rows.length,2);assert.deepEqual(rows[0].education,['测试大学 计算机']);assert.deepEqual(rows[0].work,['云服务公司 Go']);
  assert.equal(await readRecommendCandidateId(page,'陈成'),'a');await openRecommendResumePreview(page,'陈成','a');assert.equal(await page.evaluate('window.opens'),1);
  await assert.rejects(openRecommendResumePreview(page,'陈','a'),/不唯一/);await assert.rejects(clickGreet(page,'陈','a'),/不唯一/);
  await assert.rejects(openRecommendResumePreview(page,'陈成','wrong'),/不唯一/);assert.equal(await page.evaluate('window.greets'),0);
  await setup([{name:'陈成',id:'a'},{name:'陈成',id:'b'}]);
  await assert.rejects(openRecommendResumePreview(page,'陈成'),/不唯一/);await assert.rejects(clickGreet(page,'陈成'),/不唯一/);
  assert.equal(await page.evaluate('window.opens+window.greets'),0);
  assert.equal(await readRecommendCandidateId(page,'陈成','b'),'b');await clickGreet(page,'陈成','b');assert.equal(await page.evaluate('window.greets'),1);
  await setup([{name:'陈成',id:'a'},{name:'其他',id:'a'}]);await assert.rejects(readRecommendCandidateId(page,'陈成','a'),/ID重复/);
  for(const x of [{name:'陈成',id:''},{name:'陈成',id:'a',componentId:'b'},{name:'陈成',id:'a',componentName:'其他'}]){await setup([x]);await assert.rejects(openRecommendResumePreview(page,'陈成'),/缺失|不符/);assert.equal(await page.evaluate('window.opens'),0);}
  await setup([{name:'陈成',id:'a',noExperience:true}]);assert.deepEqual((await readRecommendList(page))[0].education,[]);await openRecommendResumePreview(page,'陈成','a');assert.equal(await page.evaluate('window.opens'),1);
  const state=await page.evaluate(STATUS_SCRIPT);const s={...state,pageType:'recommend',cards:state.recommendCards,recommendJob:'岗位'};
  assert.equal(matchesStatus(s,{page:'recommend',name:'陈成',candidateId:'a',state:'contact-ready',job:'岗位'}),true);
  assert.equal(matchesStatus({...s,resume:true,resumeId:'a',resumeInfoId:'a',contactText:'打招呼',contactUsable:true},{name:'陈成',candidateId:'a',state:'contact-ready'}),false);
  s.cards.push({...s.cards[0]});assert.equal(matchesStatus(s,{name:'陈成',candidateId:'a',state:'contact-ready'}),false);
  await page.setContent('<div class="resume-middle-wrap"><iframe src="https://www.zhipin.com/web/frame/c-resume/test"></iframe><div class="resume-right-side"><div class="resume-simple-box"></div></div></div>');
  await page.evaluate(`document.querySelector('.resume-simple-box').__vue__={$props:{dataSource:{encryptGeekId:'a'},personInfo:{encryptGeekId:'a'}}}`);
  await assertRecommendResumeIdentity(page,'a');await assert.rejects(assertRecommendResumeIdentity(page,'b'),/ID核验失败/);
  await page.evaluate(`document.querySelector('.resume-simple-box').__vue__.$props.personInfo.encryptGeekId='other'`);await assert.rejects(assertRecommendResumeIdentity(page,'a'),/ID核验失败/);
  // Recommendation resumes live inside the list frame, not the outer chat page.
  await page.setContent('<iframe id="recommend" srcdoc="<div></div>"></iframe>');
  const host=await page.$('#recommend');const recommendation=await host.contentFrame();await host.dispose();
  await recommendation.evaluate(`document.body.innerHTML='<div class="resume-middle-wrap"><iframe src="https://www.zhipin.com/web/frame/c-resume/test"></iframe><div class="resume-right-side"><div class="resume-simple-box"></div></div></div>';document.querySelector('.resume-simple-box').__vue__={$props:{dataSource:{encryptGeekId:'a'},personInfo:{encryptGeekId:'a'}}}`);
  await assert.rejects(assertRecommendResumeIdentity(page,'a'),/可见简历面板不唯一：0/);
  await assertRecommendResumeIdentity(recommendation,'a');
  await recommendation.evaluate(`document.querySelector('.resume-simple-box').__vue__.$props.personInfo.encryptGeekId='b'`);
  await assert.rejects(assertRecommendResumeIdentity(recommendation,'a'),/ID核验失败/);
  await recommendation.evaluate(`document.querySelector('.resume-simple-box').__vue__={$props:{geekInfo:{encryptGeekId:'a'},resumeInfo:{encryptGeekId:'a'}}}`);
  await assert.rejects(assertRecommendResumeIdentity(recommendation,'a'),/ID核验失败/);
 }finally{await browser.close()}
});
