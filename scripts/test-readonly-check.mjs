import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
let snapshot,url='https://www.zhipin.com/web/chat/index',reads=0,disconnects=0,fail=false,pagesCount=1,frameUrl='https://www.zhipin.com/web/frame/search';
const page={url:()=>url,evaluate:async()=>{reads++;if(fail)throw new Error('detached');return structuredClone(snapshot);},frames:()=>[{url:()=>frameUrl,evaluate:async()=>structuredClone(snapshot)}]};
mock.module('puppeteer-core',{defaultExport:{connect:async()=>({pages:async()=>Array(pagesCount).fill(page),disconnect:async()=>{disconnects++;}})}});
const {runCheck,runStatus,matchesStatus}=await import('../dist/toolset/check.js');
const {executeCommand}=await import('../dist/cli/cliRouter.js');
function reset(){url='https://www.zhipin.com/web/chat/index';fail=false;pagesCount=1;snapshot={resume:false,resumeId:'',resumeInfoId:'',embedded:false,embeddedIdentity:null,conversation:{name:'测试',detailName:'测试',dataId:'id1'},editable:true,draft:'',messages:[],cards:[],searchJob:'岗位',chatJob:'岗位',keyword:'Agent',contactText:'',contactUsable:false,selectedJob:null,resumeReceived:true,resumeRequest:true};}
test('page/state checks return booleans and never use navigation or business APIs',async()=>{
 reset();assert.equal(await runCheck({page:'chat'}),'true');assert.equal(await runCheck({page:'search'}),'false');
 for(const cmd of [
 ['send','--name','测试','--data-id','id1','--text','你好','--check','--json'],
 ['accept-resume','测试','--data-id','id1','--check','--json'],
 ['download-resume','测试','--data-id','id1','--check','--json'],
 ['chat','测试','--check','--json'],
 ['check','--page','chat','--name','测试','--data-id','id1','--json']]) assert.equal(await executeCommand(cmd),'true');
 snapshot.conversation.dataId='other';assert.equal(await executeCommand(['send','--name','测试','--data-id','id1','--text','你好','--check']),'false');
 snapshot.messages=['你好'];snapshot.conversation.dataId='id1';assert.equal(await executeCommand(['send','--name','测试','--data-id','id1','--text','你好','--check']),'false');
 assert.equal(await runCheck({page:'chat',state:'message-visible',name:'测试',dataId:'id1',text:'你好'}),'true');
 snapshot.messages=[];snapshot.draft='draft';assert.equal(await runCheck({page:'chat',state:'send-ready',text:'你好'}),'false');
});
test('search ID, resume, job and embedded checks never click or type',async()=>{
 reset();url='https://www.zhipin.com/web/chat/search';snapshot.resume=true;snapshot.resumeId=snapshot.resumeInfoId='c1';snapshot.contactText='立即沟通(1/10)';snapshot.contactUsable=true;snapshot.cards=[{name:'测试',componentName:'测试',candidateId:'c1'},{name:'测试',componentName:'测试',candidateId:'c2'}];
 assert.equal(await executeCommand(['greet','测试','--candidate-id','c1','--check','--json']),'true');
 assert.equal(await executeCommand(['greet','测试','--check','--json']),'false');
 assert.equal(await executeCommand(['back','--check-in_online_resume','--json']),'true');
 snapshot.selectedJob='岗位';assert.equal(await executeCommand(['greet','测试','--candidate-id','c1','--select-job','岗位','--check']),'true');
 snapshot.embedded=true;snapshot.embeddedIdentity={name:'测试',candidateId:'c1',job:'岗位',conversationId:'x',editorId:'x',friendId:1,rootFriendId:1};
 assert.equal(await executeCommand(['chat','测试','--embedded','--check','--candidate-id','c1','--job','岗位']),'true');
 assert.equal(await executeCommand(['send','--embedded','--check','--name','测试','--candidate-id','c1','--job','岗位','--text','你好']),'true');
 snapshot.embeddedIdentity.editorId='other';assert.equal(await executeCommand(['send','--embedded','--check','--name','测试','--candidate-id','c1','--job','岗位','--text','你好']),'false');
});
test('status returns info; errors remain errors, never false; disconnects on failure',async()=>{
 reset();assert.equal(JSON.parse(await runStatus()).pageType,'chat');
 url='https://www.zhipin.com/web/frame/c-resume/test';assert.equal(await executeCommand(['back','--check-in_online_resume']),'true');reset();assert.equal(await executeCommand(['back','--check-in_online_resume']),'false');
 const before=disconnects;fail=true;await assert.rejects(runCheck({page:'chat'}),/detached/);assert.equal(disconnects,before+1);
 reset();pagesCount=2;await assert.rejects(runCheck({page:'chat'}),/唯一/);
 reset();const count=reads;for(const args of [['check'],['check','--page','typo'],['check','--state','send-ready'],['check','--page','chat','--refresh'],['status','--page','chat']])await assert.rejects(executeCommand(args));assert.equal(reads,count);
});
test('pure comparison uses supplied expectations, never assumes a match',()=>{
 reset();const s={...snapshot,pageType:'chat',overlayType:null};assert.equal(matchesStatus(s,{page:'chat',job:'other'}),false);assert.equal(matchesStatus(s,{overlay:'online-resume'}),false);assert.equal(matchesStatus(s,{state:'resume-received',name:'other',dataId:'id1'}),false);
});

test('status matches search and recommend iframe paths with or without a trailing slash',async()=>{
 for(const kind of ['search','recommend'])for(const slash of ['','/']){
  reset();url='https://www.zhipin.com/web/chat/'+kind;frameUrl='https://www.zhipin.com/web/frame/'+kind+slash+'?source=test';snapshot.recommendJob='推荐岗位';
  const result=JSON.parse(await runStatus());assert.equal(result.pageType,kind);assert.equal(result.searchJob,kind==='recommend'?'推荐岗位':'岗位');
 }
 frameUrl='https://www.zhipin.com/web/frame/search';reset();
});
