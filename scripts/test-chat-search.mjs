import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { searchChatCandidate } from '../dist/toolset/chat_search.js';
import { STATUS_SCRIPT } from '../dist/toolset/check.js';
import { captureChatSearchDiagnostics } from '../dist/toolset/chat_search_diagnostics.js';
import { spawnSync } from 'node:child_process';
let listPreparations = 0;
let activePage;
mock.module('../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:async callback=>callback(activePage)}});
mock.module('../dist/toolset/list.js', {namedExports:{ensureChatListReady:async()=>{listPreparations++;}}});
const { openConversationByTarget } = await import('../dist/toolset/target_chat.js');
const { runOpenCandidateChat, runOpenCandidateChatByIndex } = await import('../dist/toolset/chat.js');
const {runSendChatMessage} = await import('../dist/toolset/send.js');
const {runAcceptTargetResume,runDownloadTargetResume,runProbeTargetResume} = await import('../dist/toolset/attachment.js');

test('chat-search rejects unsupported options before browser access', () => {
  for (const args of [[], ['黄子佳','--check'], ['黄子佳','--index','1'], ['黄子佳','--job'], ['黄子佳','--keep-current-job']]) {
    const r = spawnSync(process.execPath, ['dist/cli/index.js','chat-search',...args,'--json'], {encoding:'utf8',env:{...process.env,BOSS_DISABLE_UPDATE_CHECK:'1'}});
    assert.notEqual(r.status, 0);
    assert.equal(JSON.parse(r.stdout).ok, false);
  }
});

test('isolated search: unique result, hidden duplicates, drafts, missing result and identity mismatch', async () => {
  const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
  try {
    const page = await browser.newPage();
    activePage = page;
    await page.setRequestInterception(true);
    page.on('request', r => void r.respond({status:200,contentType:'text/html',body:'<html></html>'}));
    await page.goto('https://www.zhipin.com/web/chat/index');
    async function setup(matches, {draft='', actualId='123-0', groups=0, initialJob='岗位A', completed=true, hideAdditional=true} = {}) {
      await page.setContent(`<div class="chat-top-job"><div class="ui-dropmenu-label">岗位A</div><ul class="ui-dropmenu-list" hidden><li>全部职位</li></ul></div><div class="chat-search-btn">搜索</div><div class="chat-top-search" hidden><input class="search-input" placeholder="搜索姓名/群聊"><div class="geek-search-list"><ul></ul></div></div><div class="base-info-single-container"><span class="name-box">旧会话</span><div class="position-item"><span class="position-name">目标岗位</span></div></div><div class="chat-message-list"><div class="message-item"><div class="item-friend"><div class="text"><span>测试消息</span></div></div></div></div><div class="geek-item-wrap"><div class="geek-item" data-id="123-0"><span class="geek-name">黄子佳</span><span class="source-job">目标岗位</span></div></div>`);
      await page.evaluate(`(() => {
        window.clicks=0; window.jobClicks=0; window.inputEvents=0;window.wheelEvents=0;window.jobSelections=[];
        window.addEventListener('wheel',()=>window.wheelEvents++);
        const label=document.querySelector('.ui-dropmenu-label'), menu=document.querySelector('.ui-dropmenu-list'),root=document.querySelector('.chat-top-search'),input=root.querySelector('input'),ul=root.querySelector('ul');
        label.textContent=${JSON.stringify(initialJob)};
        label.onclick=()=>menu.hidden=false;
        const originalItem=document.createElement('li');originalItem.textContent='岗位A';menu.append(originalItem);
        for(const item of menu.querySelectorAll('li'))item.onclick=()=>{
          window.jobClicks++;window.jobSelections.push(item.textContent);menu.hidden=true;
          label.textContent=item.textContent;
        };
        document.querySelector('.chat-search-btn').onclick=()=>root.hidden=false;
        root.__vue__={searchList:[],searchGroupList:[],content:${JSON.stringify(draft)},showSearchResult:false};
        input.value=${JSON.stringify(draft)};
        input.oninput=()=>{ window.inputEvents++; root.__vue__.content=input.value; setTimeout(()=>{
          const matches=${JSON.stringify(matches)};root.__vue__.searchList=matches;root.__vue__.searchGroupList=Array(${groups}).fill({});root.__vue__.showSearchResult=${completed} ? matches.length+${groups} : false;
          for(const [i,m] of matches.entries()) {
            const li=document.createElement('li');li.innerHTML='<span class="content-text"></span>';li.querySelector('span').textContent=m.name+'_公司'+i;
            if(i>0 && ${hideAdditional})li.style.display='none';
            li.onclick=()=>{window.clicks++;window.clickedIndex=i;document.querySelector('.geek-item')?.remove();const row=document.createElement('div');row.className='geek-item selected';row.setAttribute('data-id',${JSON.stringify(actualId)});row.innerHTML='<span class="geek-name">黄子佳</span>';document.body.append(row);document.querySelector('.name-box').textContent='黄子佳';root.hidden=true;};ul.append(li);
          }
        },20);};
      })()`);
    }
    const unique=[{name:'黄子佳',uniqueId:'123-0'}];
    await setup(unique);
    const result=await searchChatCandidate(page,{name:'黄子佳',job:'目标岗位',dataId:'123-0'},700);
    assert.equal(result.status,'opened');assert.equal(result.dataId,'123-0');
    assert.equal(result.match.info,null);assert.equal(result.match.tag,null);
    assert.deepEqual(await page.evaluate('[window.clicks,window.jobClicks,window.inputEvents]'),[1,0,1]);
    assert.deepEqual(await page.evaluate('window.jobSelections'),[]);
    assert.equal(await page.evaluate("document.querySelector('.ui-dropmenu-label').textContent"),'岗位A');
    await setup(unique);
    assert.equal(JSON.parse(await runOpenCandidateChat(page,'黄子佳',false,true)).dataId,'123-0');
    assert.equal(await page.evaluate('window.wheelEvents'),0);
    assert.equal(await page.evaluate("document.querySelector('.ui-dropmenu-label').textContent"),'岗位A');
    // Follow-up operations must reuse the verified conversation, even though the old
    // hidden search input still contains the nickname and must not be searched again.
    await openConversationByTarget(page,{name:'黄子佳',dataId:'123-0'});
    const probe=JSON.parse(await runProbeTargetResume({name:'黄子佳',dataId:'123-0'}));
    assert.equal(probe.dataId,'123-0');
    assert.equal(probe.attachment,'NOT_OBSERVED');
    assert.deepEqual(await page.evaluate('[window.clicks,window.jobClicks,window.inputEvents,window.wheelEvents]'),[1,0,1,0]);
    assert.equal(await page.evaluate("document.querySelector('.ui-dropmenu-label').textContent"),'岗位A');
    await setup(unique);
    await openConversationByTarget(page,{name:'黄子佳',dataId:'123-0'});
    assert.deepEqual(await page.evaluate('[window.clicks,window.inputEvents,window.wheelEvents]'),[1,1,0]);
    assert.equal(await page.evaluate("document.querySelector('.ui-dropmenu-label').textContent"),'岗位A');
    await setup(unique);
    assert.equal(JSON.parse(await runOpenCandidateChatByIndex(page,{index:1,filter:'unread',expectedName:'黄子佳',json:true})).dataId,'123-0');
    assert.equal(listPreparations,1);
    assert.deepEqual(await page.evaluate('[window.clicks,window.inputEvents,window.wheelEvents]'),[1,1,0]);
    assert.equal(await page.evaluate("document.querySelector('.ui-dropmenu-label').textContent"),'岗位A');
    await setup(unique);
    assert.equal((await searchChatCandidate(page,{name:'黄子佳'},700)).status,'opened');
    assert.deepEqual(await page.evaluate('window.jobSelections'),[]);
    assert.equal(await page.evaluate("document.querySelector('.ui-dropmenu-label').textContent"),'岗位A');
    await setup([...unique,{name:'黄子佳',uniqueId:'456-0'}]);
    assert.equal((await searchChatCandidate(page,{name:'黄子佳'},700)).status,'needs-confirmation');
    assert.deepEqual(await page.evaluate('[window.clicks,window.jobClicks]'),[0,0]);
    assert.equal(await page.evaluate("document.querySelector('.ui-dropmenu-label').textContent"),'岗位A');
    await setup(unique);
    await page.evaluate(`document.querySelector('.geek-search-list ul').addEventListener('click',()=>{document.querySelector('.ui-dropmenu-label').textContent='全部职位';})`);
    assert.equal((await searchChatCandidate(page,{name:'黄子佳'},700)).status,'opened');
    assert.equal(await page.evaluate("document.querySelector('.ui-dropmenu-label').textContent"),'全部职位');
    assert.deepEqual(await page.evaluate('[window.clicks,window.jobClicks]'),[1,0]);
    await setup(unique,{initialJob:'全部职位'});
    assert.equal((await searchChatCandidate(page,{name:'黄子佳'},700)).status,'opened');
    assert.equal(await page.evaluate('window.jobClicks'),0);
    for (const locate of [
      () => runOpenCandidateChat(page,'黄子佳',false,true),
      () => openConversationByTarget(page,{name:'黄子佳',dataId:'123-0'}),
      () => runOpenCandidateChatByIndex(page,{index:1,json:true}),
      () => runSendChatMessage({target:{name:'黄子佳',dataId:'123-0'},text:'不能发送此消息'}),
      () => runAcceptTargetResume({name:'黄子佳',dataId:'123-0'}),
      () => runDownloadTargetResume({name:'黄子佳',dataId:'123-0'}),
      () => runProbeTargetResume({name:'黄子佳',dataId:'123-0'}),
    ]) {
      await setup([...unique,{name:'黄子佳',uniqueId:'456-0'}]);
      await assert.rejects(locate(),error=>error.name==='CandidateSelectionRequired' && /等待用户/.test(error.message));
      assert.deepEqual(await page.evaluate('[window.clicks,window.wheelEvents]'),[0,0]);
      assert.deepEqual(await page.evaluate('window.jobSelections'),[]);
      assert.equal(await page.evaluate("document.querySelector('.ui-dropmenu-label').textContent"),'岗位A');
      assert.equal(await page.evaluate("document.querySelector('.search-input').value"),'黄子佳');
    }
    await setup([...unique,{name:'黄子佳',uniqueId:'456-0'}]);
    const duplicate=await searchChatCandidate(page,{name:'黄子佳',dataId:'123-0'},700);
    assert.equal(duplicate.status,'needs-confirmation');assert.equal(duplicate.matches.length,2);
    assert.equal(await page.evaluate('window.clicks'),0);
    assert.deepEqual(await page.evaluate('window.jobSelections'),[]);
    // Company/school descriptions are raw metadata, never inferred from labels.
    // Even identical metadata and a known ID must not bypass ambiguity.
    const enriched=[
      {name:'黄子佳',uniqueId:'123-0',workDesc:'研发_A 公司',exchangeDesc:'已交换简历'},
      {name:'黄子佳',uniqueId:'456-0',workDesc:'研发_A 公司',exchangeDesc:'已交换简历'},
      {name:'黄子佳',uniqueId:'789-0',workDesc:'某大学',exchangeDesc:''},
    ];
    await setup(enriched);
    const enrichedResult=await searchChatCandidate(page,{name:'黄子佳',dataId:'123-0'},700);
    assert.equal(enrichedResult.status,'needs-confirmation');
    assert.deepEqual(enrichedResult.matches.map(x=>[x.info,x.tag]),[
      ['研发_A 公司','已交换简历'],['研发_A 公司','已交换简历'],['某大学',''],
    ]);
    assert.equal(enrichedResult.matches[0].label,'黄子佳_公司0');
    const beforeMetadataReads=await page.content();
    const status=await page.evaluate(STATUS_SCRIPT);
    const diagnostics=await captureChatSearchDiagnostics(page);
    assert.deepEqual(status.chatSearch.matches,enrichedResult.matches);
    assert.deepEqual(diagnostics.search[0].matches,enrichedResult.matches);
    assert.equal(await page.content(),beforeMetadataReads);
    assert.deepEqual(await page.evaluate('[window.clicks,window.jobClicks,window.inputEvents]'),[0,0,1]);
    await setup([enriched[0]]);
    const enrichedOpened=await searchChatCandidate(page,{name:'黄子佳'},700);
    assert.equal(enrichedOpened.status,'opened');
    assert.equal(enrichedOpened.match.info,'研发_A 公司');
    assert.equal(enrichedOpened.match.tag,'已交换简历');
    await setup([{...unique[0],workDesc:{unexpected:'shape'}}]);
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳'},700),/字段类型异常.*workDesc/);
    assert.equal(await page.evaluate('window.clicks'),0);
    const byInfo=[
      {name:'黄子佳',uniqueId:'other-0',workDesc:'其他公司'},
      {name:'黄子佳',uniqueId:'123-0',workDesc:' 已知_公司 ',exchangeDesc:'已获取简历'},
      {name:'黄子佳阳',uniqueId:'partial-0',workDesc:' 已知_公司 '},
    ];
    await setup(byInfo,{hideAdditional:false});
    const locatedByInfo=await searchChatCandidate(page,{name:'黄子佳',dataId:'123-0',info:' 已知_公司 '},700);
    assert.equal(locatedByInfo.status,'opened');
    assert.equal(locatedByInfo.match.uniqueId,'123-0');
    assert.equal(locatedByInfo.searchMatches.length,3);
    assert.equal(await page.evaluate('window.clickedIndex'),1);
    assert.deepEqual(await page.evaluate('[window.clicks,window.jobClicks,window.inputEvents]'),[1,0,1]);
    await setup(byInfo,{hideAdditional:false});
    const noInfoMatch=await searchChatCandidate(page,{name:'黄子佳',info:'已知_公司'},700);
    assert.equal(noInfoMatch.status,'not-found');assert.equal(noInfoMatch.reason,'info-no-match');
    assert.equal(noInfoMatch.searchMatches.length,3);assert.equal(await page.evaluate('window.clicks'),0);
    await setup(byInfo,{hideAdditional:false});
    await assert.rejects(openConversationByTarget(page,{name:'黄子佳',dataId:'123-0',info:'不存在'}),e=>e.name==='CandidateNotFound');
    assert.deepEqual(await page.evaluate('[window.clicks,window.inputEvents]'),[0,1]);
    await setup([byInfo[1],{...byInfo[1],uniqueId:'duplicate-0'}]);
    const sameInfo=await searchChatCandidate(page,{name:'黄子佳',dataId:'123-0',info:' 已知_公司 '},700);
    assert.equal(sameInfo.status,'needs-confirmation');assert.equal(sameInfo.matches.length,2);
    assert.equal(await page.evaluate('window.clicks'),0);
    await setup(byInfo); // the unique matching second row is hidden
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳',info:' 已知_公司 '},700),/不可见/);
    assert.equal(await page.evaluate('window.clicks'),0);
    await setup(byInfo,{hideAdditional:false});
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳',dataId:'wrong-0',info:' 已知_公司 '},700),/会话ID不符/);
    assert.equal(await page.evaluate('window.clicks'),0);
    await setup(byInfo,{hideAdditional:false,groups:1});
    assert.equal((await searchChatCandidate(page,{name:'黄子佳',info:' 已知_公司 '},700)).status,'needs-confirmation');
    assert.equal(await page.evaluate('window.clicks'),0);
    await setup(byInfo,{hideAdditional:false});
    const evaluate=page.evaluate.bind(page);
    page.evaluate=async (script,...args)=>{
      if(typeof script==='string' && script.includes('const matches =')) await evaluate("document.querySelector('.chat-top-search').__vue__.searchList[1].workDesc='已改变'");
      return evaluate(script,...args);
    };
    try {await assert.rejects(searchChatCandidate(page,{name:'黄子佳',info:' 已知_公司 '},700),/点击前搜索身份/);}
    finally {page.evaluate=evaluate;}
    assert.equal(await page.evaluate('window.clicks'),0);
    await setup(unique,{groups:1});
    assert.equal((await searchChatCandidate(page,{name:'黄子佳'},700)).status,'needs-confirmation');
    assert.equal(await page.evaluate('window.clicks'),0);
    await setup(unique,{draft:'已有内容'});
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳'},700),/已有输入/);
    assert.equal(await page.evaluate('window.inputEvents'),0);
    await setup([]);
    const empty=await searchChatCandidate(page,{name:'黄子佳'},700);
    assert.equal(empty.status,'not-found');assert.equal(empty.clicked,false);
    assert.deepEqual(empty.matches,[]);
    assert.deepEqual(await page.evaluate('[window.clicks,window.jobClicks]'),[0,0]);
    await setup([]);
    await assert.rejects(openConversationByTarget(page,{name:'黄子佳',dataId:'123-0'}),error=>error.name==='CandidateNotFound');
    assert.equal(await page.evaluate('window.clicks'),0);
    await setup([]);
    await page.evaluate("document.querySelector('.chat-top-search').__vue__.showSearchResult=0");
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳'},100),/不是初始false/);
    assert.equal(await page.evaluate('window.inputEvents'),0);
    await setup([],{completed:false});
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳'},100),error => {
      assert.equal(error.name,'ChatLocateError');
      assert.equal(error.details.stage,'wait-search-results');
      assert.equal(error.details.clickState,'not-attempted');
      assert.deepEqual(error.details.diagnostics.search[0].matches,[]);
      return true;
    });
    assert.equal(await page.evaluate('window.clicks'),0);
    await setup(unique,{actualId:'错误ID'});
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳'},150),error => {
      assert.equal(error.name,'ChatLocateError');
      assert.equal(error.details.stage,'wait-candidate-identity');
      assert.equal(error.details.locationVerified,false);
      assert.equal(error.details.clickState,'returned');
      assert.equal(error.details.diagnostics.selected[0].dataId,'错误ID');
      assert.equal(error.details.diagnostics.details[0].name,'黄子佳');
      assert.equal(error.details.diagnostics.counts['.geek-item.selected'].total,1);
      return true;
    });
    assert.equal(await page.evaluate('window.clicks'),1);
    await setup(unique);
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳',job:'错误岗位'},700),/岗位不符/);
    assert.deepEqual(await page.evaluate('window.jobSelections'),[]);
    await setup(unique);
    await page.evaluate("document.querySelector('.chat-top-job').hidden=true");
    assert.equal((await searchChatCandidate(page,{name:'黄子佳'},700)).status,'opened');
    assert.deepEqual(await page.evaluate('[window.clicks,window.jobClicks]'),[1,0]);
    await page.goto('https://www.zhipin.com/web/chat/search');
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳'},100),/必须已在沟通页/);
  } finally { await browser.close(); }
});
