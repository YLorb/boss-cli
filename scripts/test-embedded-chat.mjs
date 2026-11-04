import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
let page;
mock.module('../dist/toolset/contact-notice.js',{namedExports:{dismissContactNotice:async()=>{throw Error('embedded chat must not dismiss contact notices');}}});
mock.module('../dist/toolset/check.js',{namedExports:{runCheck:async()=> 'true',runStatus:async()=> '{}',withGuardedReadOnlyPage:async()=>{throw Error('unexpected sidebar read');}}});
mock.module('../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:async(fn,opts)=>{assert.deepEqual(opts,{ensureChatShell:false,ensureMenuList:false});return fn(page);}}});
const {sendEmbeddedChat,validateEmbeddedState,EMBEDDED_STATE_SCRIPT}=await import('../dist/toolset/embedded-chat.js');
const {CHAT_INPUT_TEXT_READER}=await import('../dist/common/chat_input_text.js');
const {jsonError}=await import('../dist/cli/output.js');
const target={name:'测试',candidateId:'encrypted-1',job:'测试岗位'};
const base=()=>({...target,conversationId:'11-0',editorId:'11-0',friendId:11,rootFriendId:11,editable:true,sendDisabled:true,messages:[]});
function setup({draft='',disabled=false,mismatch=false,messageId='new',messageOverrides={},diagnosticFailure=false,changeOnPaste,changeOnEnter}={}){
 let currentUrl='https://www.zhipin.com/web/chat/search';let state=base(), input=draft,clipboard='',enters=0,pastes=0;
 if(mismatch)state.candidateId='other';
 const read=`(() => { const read=${CHAT_INPUT_TEXT_READER};return read(document.querySelector('#boss-chat-global-input'));})()`;
 page={on:()=>{},off:()=>{},mainFrame:()=>page,bringToFront:async()=>{},url:()=>currentUrl,
 evaluate:async s=>{if(s===EMBEDDED_STATE_SCRIPT){if(enters&&diagnosticFailure)throw Error('diagnostic read unavailable');return structuredClone(state);}if(s===read)return input;if(s.includes("内嵌输入焦点"))return;
 return runInNewContext(s,{navigator:{clipboard:{writeText:t=>{clipboard=t;}}}});},
 $:async()=>({click:async()=>{}}),createCDPSession:async()=>({send:async()=>{},detach:async()=>{}}),
 keyboard:{down:async()=>{},up:async()=>{},press:async k=>{if(k==='KeyV'){pastes++;input=clipboard;state.sendDisabled=disabled;if(changeOnPaste==='identity'){state.conversationId=state.editorId='other';}if(changeOnPaste==='navigation')currentUrl='https://www.zhipin.com/web/chat/index';}if(k==='Enter'){enters++;if(changeOnEnter==='identity'){state.conversationId=state.editorId='other';}if(changeOnEnter==='navigation')currentUrl='https://www.zhipin.com/web/chat/index';state.messages.push({id:messageId,self:true,toId:11,text:input,visible:true,...messageOverrides});input='';}}},
 waitForFunction:async s=>{const value=runInNewContext(s.replaceAll(EMBEDDED_STATE_SCRIPT,JSON.stringify(state)).replaceAll(read,JSON.stringify(input)),{location:{href:page.url()}});if(!value){const error=Error('Waiting failed: 15000ms exceeded');error.name='TimeoutError';throw error;}return {jsonValue:async()=>value,dispose:async()=>{}};}};
 return ()=>({enters,pastes,state});
}
test('identity requires candidate, exact name/job, editor and root association',()=>{
 for(const key of ['name','candidateId','job','conversationId','editorId','rootFriendId'])assert.throws(()=>validateEmbeddedState({...base(),[key]:'bad'},target));
 validateEmbeddedState(base(),target);
});
test('readonly check and identity failure never type or send',async()=>{
 let result=setup();assert.equal(JSON.parse(await sendEmbeddedChat(target,'hello',true)),true);assert.equal(result().pastes,0);
 result=setup({mismatch:true});await assert.rejects(sendEmbeddedChat(target,'hello'),/校验失败/);assert.equal(result().enters,0);
});
test('preserves drafts and respects send disable after paste',async()=>{
 let result=setup({draft:'draft'});await assert.rejects(sendEmbeddedChat(target,'hello'),/草稿/);assert.equal(result().pastes,0);
 result=setup({disabled:true});await assert.rejects(sendEmbeddedChat(target,'hello'),/禁用/);assert.equal(result().enters,0);
});
test('multiline message once, verifies new self message and deduplicates',async()=>{
 const result=setup();const text='你好，关注到你的经历。\n公司介绍 Token / MaaS。\n方便聊聊吗？';
 assert.equal(JSON.parse(await sendEmbeddedChat(target,text)).status,'message-visible');assert.equal(result().state.messages[0].text,text);assert.equal(result().enters,1);
 assert.equal(JSON.parse(await sendEmbeddedChat(target,text)).status,'already-visible');assert.equal(result().enters,1);
});
const {executeCommand}=await import('../dist/cli/cliRouter.js');
test('missing message ID cannot confirm successful send or trigger a retry',async()=>{
 const result=setup({messageId:''});
 await assert.rejects(sendEmbeddedChat(target,'hello'),error=>{
   assert.equal(error.name,'EmbeddedSendUnconfirmedError');assert.equal(error.details.diagnostic.messages[0].hasId,false);
   assert.deepEqual(JSON.parse(jsonError('send',error)).error.details,error.details);
   assert.equal(error.details.cause.name,'TimeoutError');return true;
 });
 assert.equal(result().enters,1);
});

for(const [overrides,field] of [[{toId:'11'},'recipientMatches'],[{visible:false},'visible'],[{text:'different'},'exactText'],[{self:false},'self']])test('unconfirmed send explains failed '+field+' without relaxing confirmation',async()=>{
 const result=setup({messageOverrides:overrides});
 await assert.rejects(sendEmbeddedChat(target,'hello'),error=>{
   assert.equal(error.details.outcome,'unconfirmed');assert.equal(error.details.sendAttempted,true);assert.equal(error.details.retryAllowed,false);
   assert.equal(error.details.diagnostic.messages[0][field],false);
   assert.equal(error.details.diagnostic.identityMatches,true);
   return true;
 });assert.equal(result().enters,1);
});
test('failed read-only diagnosis preserves the original timeout and no-resend receipt',async()=>{
 const result=setup({messageId:'',diagnosticFailure:true});
 await assert.rejects(sendEmbeddedChat(target,'hello'),error=>{
   assert.equal(error.details.cause.name,'TimeoutError');assert.equal(error.details.diagnostic.diagnosticError,'diagnostic read unavailable');
   return true;
 });assert.equal(result().enters,1);
});
test('CLI embedded check routes read-only and rejects missing identity/side-effect flags',async()=>{
 const result=setup();
 const answer=JSON.parse(await executeCommand(['chat','测试','--embedded','--check','--candidate-id','encrypted-1','--job','测试岗位','--json']));
 assert.equal(answer,true);assert.equal(result().pastes,0);
 const ready=JSON.parse(await executeCommand(['send','--embedded','--check','--name','测试','--candidate-id','encrypted-1','--job','测试岗位','--text','消息','--json']));
 assert.equal(ready,true);assert.equal(result().pastes,0);
 await assert.rejects(executeCommand(['send','--embedded','--name','测试','--text','消息']),/candidate-id/);
 await assert.rejects(executeCommand(['send','--embedded','--name','测试','--candidate-id','encrypted-1','--job','测试岗位','--text','消息','--request-resume']),/candidate-id/);
});

for(const phase of ['changeOnPaste','changeOnEnter'])for(const change of ['identity','navigation'])test(phase+' '+change+' stops without resend',async()=>{
  const result=setup({[phase]:change});
  await assert.rejects(sendEmbeddedChat(target,'消息3'));
  assert.equal(result().enters,phase==='changeOnPaste'?0:1);
});
