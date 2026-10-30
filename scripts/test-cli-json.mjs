import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { splitJsonFlag } from '../dist/cli/output.js';

const calls = [];
mock.module('../dist/toolset/search-sidebar.js',{namedExports:{runSearchSidebar:async()=>{calls.push({name:'runSearchSidebar',args:[]});return JSON.stringify({readOnly:true,guarded:true});}}});
mock.module('../dist/toolset/contact-notice.js',{namedExports:{dismissContactNotice:async(...args)=>{calls.push({name:'dismissContactNotice',args});return JSON.stringify({status:'contact-notice-dismissed'});}}});
mock.module('../dist/toolset/check.js',{namedExports:{runCheck:async (...args)=>{calls.push({name:'runCheck',args});return 'true';},runStatus:async()=>'{"pageType":"chat"}'}});
const names = ['implChatAction','implChatSearch','implLogin','implListCandidates','implListUnreadCandidates','implOpenChatByIndex','implListPositions','implListPositionsWithOptions','implNormalSearch','implOpenChat','implOpenTargetChat','implAcceptTargetResume','implDownloadTargetResume','implRecommend','implPreview','implRecommendGreet','implSetBaiduCredentials','implBossSearch','implSendMessage'];
mock.module('../dist/toolset/index.js', { namedExports: Object.fromEntries(names.map(name => [name, async (...args) => {
  calls.push({name,args});
  return JSON.stringify({reader:name,args});
}])) });
mock.module('../dist/toolset/back.js', { namedExports: { runBack: async (...args) => { calls.push({name:'runBack',args}); return JSON.stringify({args}); } } });
mock.module('../dist/toolset/search-more.js', { namedExports: {
  parseSearchMoreArgs: args => ({parsedArgs:args}),
  runSearchMore: async (...args) => { calls.push({name:'runSearchMore',args}); return JSON.stringify({args}); },
}});
const { executeCommand } = await import('../dist/cli/cliRouter.js');

test('search sidebar exposes only a read and rejects action parameters',async()=>{
  assert.equal(JSON.parse(await executeCommand(['search-sidebar','--json'])).readOnly,true);
  assert.deepEqual(calls.at(-1),{name:'runSearchSidebar',args:[]});
  const before=calls.length;
  for(const args of [['search-sidebar','--click'],['search-sidebar','1'],['search-sidebar','--job','岗位']])await assert.rejects(executeCommand(args));
  assert.equal(calls.length,before);
});

test('contact notice route requires explicit identity and forwards only its scoped target',async()=>{
  const target={name:'测试',candidateId:'candidate-1',job:'测试岗位'};
  const result=JSON.parse(await executeCommand(['dismiss-contact-notice','测试','--candidate-id','candidate-1','--job','测试岗位','--json']));
  assert.equal(result.status,'contact-notice-dismissed');
  assert.deepEqual(calls.at(-1),{name:'dismissContactNotice',args:[target]});
  const before=calls.length;
  for(const argv of [
    ['dismiss-contact-notice','测试','--job','测试岗位'],
    ['dismiss-contact-notice','测试','--candidate-id','candidate-1','--job','测试岗位','--check'],
    ['dismiss-contact-notice','测试','--candidate-id','candidate-1','--job','测试岗位','--continue-chat'],
  ])await assert.rejects(executeCommand(argv));
  assert.equal(calls.length,before);
});

test('new bounded search and explicit history-back routes forward JSON and reject mixed back flags', async () => {
  await executeCommand(['search-more','--max-scrolls','2','--max-candidates','40','--json']);
  assert.deepEqual(calls.at(-1), {name:'runSearchMore',args:[{parsedArgs:['--max-scrolls','2','--max-candidates','40']},true]});
  const url='https://www.zhipin.com/web/chat/search';
  await executeCommand(['back','--previous','--expect-url',url,'--json']);
  assert.deepEqual(calls.at(-1),{name:'runBack',args:[false,true,url]});
  const before=calls.length;
  for(const args of [['back','--previous'],['back','--expect-url',url],['back','--previous','--if-open','--expect-url',url],
    ['back','--previous','--check-in_online_resume','--expect-url',url],['back','--previous=false','--expect-url',url],
    ['back','--previous','--expect-url',url,'--expect-url',url]]) await assert.rejects(executeCommand(args));
  assert.equal(calls.length,before);
});

test('every business command forwards --json to its reader, including aliases and flag placement', async () => {
  const cases = [
    [['login','--json'],'implLogin',[true]],
    [['chat-search','黄子佳','--data-id','123-0','--job','目标岗位','--json'],'implChatSearch',[{name:'黄子佳',dataId:'123-0',job:'目标岗位'},true]],
    [['chat-search','黄子佳','--data-id','123-0','--info',' 已知公司 ','--json'],'implChatSearch',[{name:'黄子佳',dataId:'123-0',job:undefined,info:' 已知公司 '},true]],
    [['list','--unread','--json'],'implListCandidates',[{unreadOnly:true,chattingOnly:false,json:true}]],
    [['list-candidates','--json','--chatting'],'implListCandidates',[{unreadOnly:false,chattingOnly:true,json:true}]],
    [['chat','--json','测试候选人','--data-id','123'],'implOpenTargetChat',[{name:'测试候选人',dataId:'123'},true]],
    [['chat','测试候选人','--data-id','123','--info','已知公司','--json'],'implOpenTargetChat',[{name:'测试候选人',dataId:'123',info:'已知公司'},true]],
    [['chat','测试候选人','--strict','--json'],'implOpenChat',['测试候选人',true,true]],
    [['chat','--index','2','--unread','--json'],'implOpenChatByIndex',[{index:2,unreadOnly:true,expectedName:undefined,exact:true,json:true}]],
    [['action','remark','--remark','包含换行\n和引号"','--json'],'implChatAction',[{action:'remark',remark:'包含换行\n和引号"',json:true}]],
    [['accept-resume','测试候选人','--data-id','123','--json'],'implAcceptTargetResume',[{name:'测试候选人',dataId:'123'},true,false]],
    [['download-resume','测试候选人','--data-id','123','--json'],'implDownloadTargetResume',[{name:'测试候选人',dataId:'123'},undefined,false]],
    [['send','--text','含引号"与换行\n的消息','--name','测试候选人','--data-id','123','--json'],'implSendMessage',[{text:'含引号"与换行\n的消息',requestResume:false,target:{name:'测试候选人',dataId:'123'},json:true,check:false}]],
    [['download-resume','--check','测试候选人','--data-id','123','--json'],'implDownloadTargetResume',[{name:'测试候选人',dataId:'123'},undefined,true]],
    [['accept-resume','测试候选人','--data-id','123','--check','--json'],'implAcceptTargetResume',[{name:'测试候选人',dataId:'123'},true,true]],
    [['send','--check','--text','测试','--name','测试候选人','--data-id','123','--json'],'implSendMessage',[{text:'测试',requestResume:false,target:{name:'测试候选人',dataId:'123'},json:true,check:true}]],
    [['positions','--json'],'implListPositions',[true]],
    [['jd','测试岗位','--json'],'implListPositionsWithOptions',[{detail:true,name:'测试岗位',json:true}]],
    [['search','--json','评估'],'implNormalSearch',['评估',true]],
    [['recommend','测试岗位','--json'],'implRecommend',['测试岗位',true,false]],
    [['deep-search','--core','Python','--bonus','评测','--json'],'implBossSearch',[{jobKeyword:undefined,coreRequirements:['Python'],bonusRequirements:['评测'],match:false,json:true}]],
    [['preview','测试候选人','--json'],'implPreview',[{candidateTarget:'测试候选人',json:true}]],
    [['greet','测试候选人','--job','测试岗位','--json'],'implRecommendGreet',[{candidateTarget:'测试候选人',jobKeyword:'测试岗位',json:true}]],
  ];
  for (const [argv,name,args] of cases) {
    const result=JSON.parse(await executeCommand(argv));
    assert.equal(result.reader,name);
    assert.deepEqual(calls.at(-1),{name,args});
  }
});

test('info cannot be silently ignored by readonly, index or unsupported commands',async()=>{
  const before=calls.length;
  for(const args of [
    ['chat','候选人','--info','公司'],
    ['chat','候选人','--data-id','id','--info'],
    ['chat','候选人','--data-id','id','--info',' '],
    ['chat','候选人','--data-id','id','--info','公司','--check'],
    ['chat','候选人','--index','1','--info','公司'],
    ['chat-search','候选人','--info',' '],
    ['check','--page','chat','--info','公司'],
  ]) await assert.rejects(executeCommand(args));
  assert.equal(calls.length,before);
});

test('recommend check-job and guarded back parse flags without swallowing positional names', async () => {
  for (const argv of [['recommend','--check-job','测试岗位','--json'], ['recommend','测试岗位','--check-job','--json']]) {
    await executeCommand(argv);
    assert.deepEqual(calls.at(-1), {name:'runCheck',args:[{page:'recommend',job:'测试岗位'}]});
  }
  await executeCommand(['/back','--check-in_online_resume','--json']);
  assert.deepEqual(calls.at(-1), {name:'runCheck',args:[{state:'online-resume-open'}]});
  await assert.rejects(executeCommand(['recommend','--check-job','--json']), /需要岗位完整名称/);
  await assert.rejects(executeCommand(['back','--check-in_online_resume=false']), /布尔开关/);
});

test('greet check forwards a boolean without consuming the candidate name', async () => {
  await executeCommand(['greet','--check','n**','--json']);
  assert.deepEqual(calls.at(-1),{name:'implRecommendGreet',args:[{candidateTarget:'n**',jobKeyword:undefined,json:true,check:true}]});
  await assert.rejects(executeCommand(['greet','n**','--check=true']),/布尔开关/);
});

test('preview open-only forwards its flag and preserves the name', async () => {
  await executeCommand(['preview','n**','--candidate-id','id','--reopen-on-frame-error','--json']);
  assert.deepEqual(calls.at(-1).args,[{candidateTarget:'n**',candidateId:'id',reopenOnFrameError:true,json:true}]);
  await assert.rejects(executeCommand(['preview','n**','--reopen-on-frame-error']),/candidate-id/);
  await assert.rejects(executeCommand(['preview','n**','--candidate-id','id','--reopen-on-frame-error=true']),/布尔开关/);
  await executeCommand(['preview','--open-only','n**','--json']);
  assert.deepEqual(calls.at(-1),{name:'implPreview',args:[{candidateTarget:'n**',json:true,openOnly:true}]});
  await assert.rejects(executeCommand(['preview','n**','--open-only=true']),/布尔开关/);
});

test('literal --json after -- and inside --text=value is not an output flag; text defaults remain', async () => {
  assert.deepEqual(splitJsonFlag(['--text=--json']),{args:['--text=--json'],json:false});
  assert.deepEqual(splitJsonFlag(['--','--json']),{args:['--','--json'],json:false});
  await executeCommand(['list','--unread']);
  assert.equal(calls.at(-1).name,'implListUnreadCandidates');
  await executeCommand(['send','--text=--json']);
  assert.equal(calls.at(-1).args[0].text,'--json');
  assert.equal(calls.at(-1).args[0].json,false);
});

test('invalid JSON commands fail before invoking a business action', async () => {
  const count=calls.length;
  for(const argv of [['chat','--index','0','--json'],['accept-resume','name','--json'],['send','--json'],['action','remark','--json'],['update','--json'],['action','not-fit','--json=false'],['download-resume','name','--data-id','123','--check=true'],['send','--text','测试','--check']]) {
    await assert.rejects(executeCommand(argv));
  }
  assert.equal(calls.length,count);
});

test('real CLI emits a single JSON error with a nonzero exit code and no update notice', () => {
  const result=spawnSync(process.execPath,['dist/cli/index.js','chat','--index','0','--json'],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,1);
  const data=JSON.parse(result.stdout);
  assert.equal(data.ok,false);
  assert.equal(data.command,'chat');
  assert.equal(data.error.name,'CliError');
  assert.match(data.error.message,/从 1 开始/);
  assert.equal(result.stderr,'');
});

let activePage;
mock.module('../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:async callback=>callback(activePage)}});
const {runRecommend}=await import('../dist/toolset/recommend.js');
const {runNormalSearch}=await import('../dist/toolset/normal-search.js');
const {renderOpenedCandidateChat}=await import('../dist/toolset/chat.js');
const {runListOpenPositions}=await import('../dist/toolset/jd.js');
const {runBossSearch}=await import('../dist/toolset/deep-search.js');
const {runSendChatMessage}=await import('../dist/toolset/send.js');
const {runChatActionOnCurrentConversation}=await import('../dist/toolset/action.js');

function framePage(kind,evaluate) {
  const frame={url:()=>`https://www.zhipin.com/web/frame/${kind}`,waitForFunction:async()=>{},evaluate};
  return {url:()=>`https://www.zhipin.com/web/chat/${kind}`,waitForSelector:async()=>({contentFrame:async()=>frame})};
}

test('recommend and search expose original fields, including values omitted by text rendering', async () => {
  const candidate={geekId:'g1',name:'测试',salary:'20-30K',baseInfo:'硕士 / 3年',expect:'深圳',experience:'研发',advantage:'',highlights:['Python','评测','第三项','第四项'],canGreet:true,hasHistoryChat:false,hasViewed:false};
  activePage=framePage('recommend',async script=>script.includes('return cards.map')?[candidate]:'测试岗位');
  assert.deepEqual(JSON.parse(await runRecommend(undefined,true)),{job:'测试岗位',candidates:[candidate]});
  const searchCandidate={name:'测试',active:'今日活跃',labels:[],basicInfo:'硕士',summary:'摘要',tags:['评测'],expectation:'深圳',work:['研发'],education:'大学',reason:'理由',contactText:'获取联系方式'};
  activePage=framePage('search',async script=>script.includes('card-label')?[searchCandidate]:script.includes('.search-input')?'评估':'测试岗位');
  assert.deepEqual(JSON.parse(await runNormalSearch(undefined,true)),{keyword:'评估',job:'测试岗位',candidates:[searchCandidate]});
});

test('chat preserves roles, attachment presence and summary arrays without parsing text', async () => {
  const summary={name:'测试',active:'今日活跃',basicFacts:['硕士','UI文字'],recentExperience:['研发'],communicationPosition:'评估',expectation:'深圳',remark:''};
  const chat={messages:[{time:'10:00',from:'friend',text:'正文含引号"和\n换行'}],hasFriendResumeAttachment:true};
  const page={waitForFunction:async()=>{},evaluate:async script=>script.includes('const lists =')?chat:script.includes('const targetName =')?summary:'row1'};
  assert.deepEqual(JSON.parse(await renderOpenedCandidateChat(page,'测试',true)),{name:'测试',dataId:'row1',summary,...chat});
});

test('JD JSON reuses Markdown cache without browser access or modification', async () => {
  await mkdir(path.resolve('output'),{recursive:true});
  const dir=await mkdtemp(path.resolve('output/jd-json-test-'));
  const file=path.join(dir,'测试岗位.md');
  try {
    const markdown='# 测试岗位\n\n原始 JD 正文\n';
    await writeFile(file,markdown);
    activePage=null;
    assert.deepEqual(JSON.parse(await runListOpenPositions({detail:true,detailName:'测试岗位',projectDir:dir,json:true})),{name:'测试岗位',path:file,markdown,source:'cache'});
    assert.equal(await runListOpenPositions({detail:true,detailName:'测试岗位',projectDir:dir}),markdown);
  }finally{await rm(file);await rmdir(dir);}
});

test('deep-search JSON preserves unknown count and disabled state without triggering match', async () => {
  const form={selectedJob:'测试岗位',coreRequirements:['Python'],bonusRequirements:[],remainingCountText:'',remainingCount:null,matchButtonText:'匹配',matchButtonDisabled:true};
  let reads=0;
  activePage={url:()=> 'https://www.zhipin.com/web/chat/aiform',waitForFunction:async()=>{},evaluate:async()=>{reads++;return form;}};
  assert.deepEqual(JSON.parse(await runBossSearch({json:true})),{matched:false,form});
  assert.equal(reads,1);
});

test('send JSON reports page-confirmed message, preserves text, and does not request resume implicitly', async () => {
  const pressed=[];
  const evaluations=[];
  activePage={url:()=> 'https://www.zhipin.com/web/chat/index',
    $:async selector=>{assert.equal(selector,'#boss-chat-editor-input');return {click:async()=>{}};},
    keyboard:{down:async()=>{},up:async()=>{},press:async key=>pressed.push(key)},
    createCDPSession:async()=>({send:async()=>{},detach:async()=>{}}),
    evaluate:async script=>{evaluations.push(script);return 0;},waitForFunction:async()=>{},
  };
  assert.deepEqual(JSON.parse(await runSendChatMessage({text:'测"试',json:true})),{text:'测"试',target:null,status:'message-visible',requestResume:false});
  assert.ok(evaluations.some(script=>script.includes('navigator.clipboard.writeText')));
  assert.equal(pressed.filter(key=>key==='KeyV').length,1);
  assert.equal(pressed.filter(key=>key==='Enter').length,1);
});

test('accept action JSON is produced only after the received attachment check; handled requests fail', async () => {
  let checks=0;
  let evaluations=0;
  const page={url:()=> 'https://www.zhipin.com/web/chat/index',$:async()=>({}),
    evaluate:async()=> ++evaluations===1?0:{kind:'clicked',which:'agree'},
    waitForFunction:async()=>{checks++;},
  };
  assert.deepEqual(JSON.parse(await runChatActionOnCurrentConversation(page,{action:'agree-resume',json:true})),{action:'agree-resume',kind:'clicked',which:'agree',target:null,attachmentReceived:true});
  assert.equal(checks,1);
  evaluations=0;
  page.evaluate=async()=> ++evaluations===1?0:{kind:'already_handled',which:'agree'};
  await assert.rejects(runChatActionOnCurrentConversation(page,{action:'agree-resume',json:true}),/已经处理/);
  assert.equal(checks,1);
});


test('search contact steps and current-chat check enforce explicit arguments', async () => {
  await executeCommand(['greet','candidate','--select-job','role','--confirm-contact','--check','--json']);
  assert.deepEqual(calls.at(-1),{name:'implRecommendGreet',args:[{candidateTarget:'candidate',jobKeyword:undefined,json:true,check:true,confirmContact:true,selectJob:'role'}]});
  await executeCommand(['greet','candidate','--continue-chat','--candidate-id','id-1','--json']);
  assert.deepEqual(calls.at(-1),{name:'implRecommendGreet',args:[{candidateTarget:'candidate',jobKeyword:undefined,json:true,continueChat:true,candidateId:'id-1'}]});
  await executeCommand(['chat','candidate','--check','--json']);
  assert.deepEqual(calls.at(-1),{name:'implOpenChat',args:['candidate',true,true,true]});
  const count=calls.length;
  for(const args of [
    ['greet','candidate','--confirm-contact'],
    ['greet','candidate','--continue-chat'],
    ['greet','candidate','--candidate-id',''],
    ['greet','candidate','--continue-chat','--candidate-id','id-1','--select-job','role'],
    ['chat','candidate','--check','--index','1'],
  ]) await assert.rejects(executeCommand(args));
  assert.equal(calls.length,count);
});


test('candidate ID routes through preview and initial greet without continue-chat', async()=>{
  await executeCommand(['preview','唐**','--candidate-id','id-2','--json']);
  assert.deepEqual(calls.at(-1),{name:'implPreview',args:[{candidateTarget:'唐**',candidateId:'id-2',json:true}]});
  await executeCommand(['greet','唐**','--candidate-id','id-2','--check','--json']);
  assert.deepEqual(calls.at(-1),{name:'implRecommendGreet',args:[{candidateTarget:'唐**',candidateId:'id-2',jobKeyword:undefined,json:true,check:true}]});
});
