import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {fixture} from './testing/managed-fixture.mjs';
const {initRun,getBoundRun}=await import('../dist/cli/run_state.js');
const calls=[];
const names=['implChatAction','implChatSearch','implClearChatSearch','implLogin','implListCandidates','implListUnreadCandidates','implOpenChatByIndex','implListPositions','implListPositionsWithOptions','implNormalSearch','implSearchControl','implOpenChat','implOpenTargetChat','implAcceptTargetResume','implDownloadTargetResume','implRecommend','implPreview','implRecommendGreet','implSetBaiduCredentials','implBossSearch','implSendMessage'];
mock.module('../dist/toolset/index.js',{namedExports:Object.fromEntries(names.map(name=>[name,async options=>{
 calls.push({name,options});
 if(name==='implPreview')return JSON.stringify({path:'screenshot.png',candidateId:options.candidateId});
 if(name==='implRecommendGreet')return JSON.stringify({status:'contact-confirmed',candidateId:options.candidateId});
 if(name==='implSendMessage')return JSON.stringify({status:'message-visible',text:options.text});
 throw Error('UNSUPPORTED_OFFLINE_TOOL:'+name);
}]))});
const actualCheck=await import('../dist/toolset/check.js');
mock.module('../dist/toolset/check.js',{namedExports:{...actualCheck,runCheck:async()=> 'true',runStatus:async()=>JSON.stringify({chatFilterJob:getBoundRun().job}),withGuardedReadOnlyPage:async()=>{throw Error('REAL_BROWSER_FORBIDDEN');}}});
const actualOcr=await import('../dist/common/resume_ocr.js');
mock.module('../dist/common/resume_ocr.js',{namedExports:{...actualOcr,runResumeOcr:async()=>({status:'completed',textPath:'screenshot.txt'})}});
mock.module('../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:async()=>{throw Error('REAL_BROWSER_FORBIDDEN');}}});
let sessions=0;
mock.module('../dist/collection/session.js',{namedExports:{runCollectionSession:async()=>{sessions++;},syncCollectionReceipt:async()=>{throw Error('Use dedicated receipt integration test');}}});
const {executeCommand,runCli}=await import('../dist/cli/cliRouter.js');
async function setup(overrides={}){const f=await fixture({scope:'recommend',...overrides});await initRun(f.at);calls.length=0;return f;}
const preview=['preview','模拟甲','--candidate-id','id-1','--json'];
test('router rejects unknown identity before mocked tool',async()=>{
 await setup();await executeCommand(['check','--job','测试岗位','--json']);await assert.rejects(()=>executeCommand(['preview','模拟甲','--candidate-id','wrong','--json']),/冻结范围/);assert.equal(calls.length,0);
});
test('router requires OCR then decision then contact before sending',async()=>{
 await setup();await executeCommand(['check','--job','测试岗位','--json']);await executeCommand(preview);
 await assert.rejects(()=>executeCommand(['decide','--candidate-id','id-1','--verdict','fit','--json']),/材料/);
 await executeCommand(['ocr','screenshot.png','--json']);await executeCommand(['decide','--candidate-id','id-1','--verdict','fit','--json']);
 await executeCommand(['greet','模拟甲','--candidate-id','id-1','--json']);
 await executeCommand(['send','--name','模拟甲','--data-id','id-1','--text','已收到简历。','--json']);
 assert.equal(calls.filter(x=>x.name==='implSendMessage').length,1);
 await assert.rejects(()=>executeCommand(['send','--name','模拟甲','--data-id','id-1','--text','已收到简历。','--json']),/禁止重复/);
});
test('new task retains historical send evidence',async()=>{
 await setup({job:'跨轮岗位'});
 const {assertActionHistory,beginAction,finishAction}=await import('../dist/common/action_history.js');
 const attempt=await beginAction('send','id-1','已收到简历。');await finishAction(attempt,'success');
 await setup({job:'跨轮岗位'});
 await assert.rejects(()=>assertActionHistory('send','id-1','已收到简历。'),/历史 send 已成功/);
});
test('collect public entry cannot bypass phase restriction',async()=>{
 await setup({scope:'collect',phases:[{name:'read',allowed:{list:[]}}]});
 const before=sessions;await assert.rejects(()=>runCli(['collect','--job','测试岗位']),/未授权/);assert.equal(sessions,before);
});
test('collect public entry rejects mode or ledger substitution',async()=>{
 const f=await setup({scope:'collect',mode:'collect-only'});await assert.rejects(()=>runCli(['collect','--job','测试岗位','--mode','screen']),/mode.*不匹配/);await assert.rejects(()=>runCli(['collect','--job','测试岗位','--ledger-dir',f.dir]),/账本目录不一致/);
});
test('relative, missing and different-job spec references are rejected',async()=>{
 const {checkTaskConfig}=await import('../dist/cli/task_config.js');
 await fixture({jobSpec:'missing.json'});await assert.rejects(checkTaskConfig,/绝对路径/);
 await fixture({jobSpec:join(process.env.BOSS_APP_HOME,'missing.json')});await assert.rejects(checkTaskConfig,/jobSpec 不可读/);
 const f=await fixture();const spec=join(f.dir,'spec.json');await writeFile(spec,JSON.stringify({schemaVersion:1,job:'另一个岗位'}));await writeFile(f.file,JSON.stringify({...f.task,jobSpec:spec}));await assert.rejects(checkTaskConfig,/不匹配/);
});
test('duplicate option values and literal --check cannot bypass message authorization',async()=>{
 await setup({job:'解析岗位',scope:'collect',mode:'collect-only'});await executeCommand(['check','--job','解析岗位','--json']);
 const base=['send','--name','模拟甲','--data-id','id-1'];
 await assert.rejects(()=>executeCommand([...base,'--text','已收到简历。','--text','未经授权正文','--json']),/话术不一致/);
 await assert.rejects(()=>executeCommand([...base,'--text','未经授权正文','--json','--','--check']),/话术不一致/);
 await assert.rejects(()=>executeCommand([...base,'--data-id','other','--text','已收到简历。','--json']),/冻结范围/);
 assert.equal(calls.filter(x=>x.name==='implSendMessage').length,0);
});
