import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { searchChatCandidate } from '../dist/toolset/chat_search.js';
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
  for (const args of [[], ['黄子佳','--check'], ['黄子佳','--index','1'], ['黄子佳','--job']]) {
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
    async function setup(matches, {draft='', actualId='123-0', groups=0} = {}) {
      await page.setContent(`<div class="chat-top-job"><div class="ui-dropmenu-label">岗位A</div><ul class="ui-dropmenu-list" hidden><li>全部职位</li></ul></div><div class="chat-search-btn">搜索</div><div class="chat-top-search" hidden><input class="search-input" placeholder="搜索姓名/群聊"><div class="geek-search-list"><ul></ul></div></div><div class="base-info-single-container"><span class="name-box">旧会话</span><div class="position-item"><span class="position-name">目标岗位</span></div></div><div class="chat-message-list"><div class="message-item"><div class="item-friend"><div class="text"><span>测试消息</span></div></div></div></div><div class="geek-item-wrap"><div class="geek-item" data-id="123-0"><span class="geek-name">黄子佳</span><span class="source-job">目标岗位</span></div></div>`);
      await page.evaluate(`(() => {
        window.clicks=0; window.jobClicks=0; window.inputEvents=0;window.wheelEvents=0;
        window.addEventListener('wheel',()=>window.wheelEvents++);
        const label=document.querySelector('.ui-dropmenu-label'), menu=document.querySelector('.ui-dropmenu-list'),root=document.querySelector('.chat-top-search'),input=root.querySelector('input'),ul=root.querySelector('ul');
        label.onclick=()=>menu.hidden=false;
        menu.querySelector('li').onclick=()=>{window.jobClicks++;label.textContent='全部职位';menu.hidden=true;};
        document.querySelector('.chat-search-btn').onclick=()=>root.hidden=false;
        root.__vue__={searchList:[],searchGroupList:[],content:${JSON.stringify(draft)},showSearchResult:false};
        input.value=${JSON.stringify(draft)};
        input.oninput=()=>{ window.inputEvents++; root.__vue__.content=input.value; setTimeout(()=>{
          const matches=${JSON.stringify(matches)};root.__vue__.searchList=matches;root.__vue__.searchGroupList=Array(${groups}).fill({});root.__vue__.showSearchResult=matches.length+${groups};
          for(const [i,m] of matches.entries()) {
            const li=document.createElement('li');li.innerHTML='<span class="content-text"></span>';li.querySelector('span').textContent=m.name+'_公司'+i;
            if(i>0)li.style.display='none';
            li.onclick=()=>{window.clicks++;document.querySelector('.geek-item')?.remove();const row=document.createElement('div');row.className='geek-item selected';row.setAttribute('data-id',${JSON.stringify(actualId)});row.innerHTML='<span class="geek-name">黄子佳</span>';document.body.append(row);document.querySelector('.name-box').textContent='黄子佳';root.hidden=true;};ul.append(li);
          }
        },20);};
      })()`);
    }
    const unique=[{name:'黄子佳',uniqueId:'123-0'}];
    await setup(unique);
    const result=await searchChatCandidate(page,{name:'黄子佳',job:'目标岗位',dataId:'123-0'},700);
    assert.equal(result.status,'opened');assert.equal(result.dataId,'123-0');
    assert.deepEqual(await page.evaluate('[window.clicks,window.jobClicks,window.inputEvents]'),[1,1,1]);
    await setup(unique);
    assert.equal(JSON.parse(await runOpenCandidateChat(page,'黄子佳',false,true)).dataId,'123-0');
    assert.equal(await page.evaluate('window.wheelEvents'),0);
    await setup(unique);
    await openConversationByTarget(page,{name:'黄子佳',dataId:'123-0'});
    assert.deepEqual(await page.evaluate('[window.clicks,window.inputEvents,window.wheelEvents]'),[1,1,0]);
    await setup(unique);
    assert.equal(JSON.parse(await runOpenCandidateChatByIndex(page,{index:1,filter:'unread',expectedName:'黄子佳',json:true})).dataId,'123-0');
    assert.equal(listPreparations,1);
    assert.deepEqual(await page.evaluate('[window.clicks,window.inputEvents,window.wheelEvents]'),[1,1,0]);
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
    }
    await setup([...unique,{name:'黄子佳',uniqueId:'456-0'}]);
    const duplicate=await searchChatCandidate(page,{name:'黄子佳',dataId:'123-0'},700);
    assert.equal(duplicate.status,'needs-confirmation');assert.equal(duplicate.matches.length,2);
    assert.equal(await page.evaluate('window.clicks'),0);
    await setup(unique,{groups:1});
    assert.equal((await searchChatCandidate(page,{name:'黄子佳'},700)).status,'needs-confirmation');
    assert.equal(await page.evaluate('window.clicks'),0);
    await setup(unique,{draft:'已有内容'});
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳'},700),/已有输入/);
    assert.equal(await page.evaluate('window.inputEvents'),0);
    await setup([]);
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳'},100),/无匹配或结果尚未就绪/);
    assert.equal(await page.evaluate('window.clicks'),0);
    await setup(unique,{actualId:'错误ID'});
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳'},150),/已点击.*禁止重试/);
    assert.equal(await page.evaluate('window.clicks'),1);
    await setup(unique);
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳',job:'错误岗位'},700),/岗位不符/);
    await page.goto('https://www.zhipin.com/web/chat/search');
    await assert.rejects(searchChatCandidate(page,{name:'黄子佳'},100),/必须已在沟通页/);
  } finally { await browser.close(); }
});
