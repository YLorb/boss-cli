import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
let page;
mock.module('../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:async(fn,opts)=>{assert.deepEqual(opts,{ensureChatShell:false,ensureMenuList:false});return fn(page);}}});
const {sendEmbeddedChat,validateEmbeddedState,EMBEDDED_STATE_SCRIPT}=await import('../dist/toolset/embedded-chat.js');
const {CHAT_INPUT_TEXT_READER}=await import('../dist/common/chat_input_text.js');
const target={name:'测试',candidateId:'encrypted-1',job:'测试岗位'};
const base=()=>({...target,conversationId:'11-0',editorId:'11-0',friendId:11,rootFriendId:11,editable:true,sendDisabled:true,messages:[]});
function setup({draft='',disabled=false,mismatch=false,messageId='new'}={}){
 let state=base(), input=draft,clipboard='',enters=0,pastes=0;
 if(mismatch)state.candidateId='other';
 const read=`(() => { const read=${CHAT_INPUT_TEXT_READER};return read(document.querySelector('#boss-chat-global-input'));})()`;
 page={bringToFront:async()=>{},url:()=> 'https://www.zhipin.com/web/chat/search',
 evaluate:async s=>{if(s===EMBEDDED_STATE_SCRIPT)return structuredClone(state);if(s===read)return input;
 return runInNewContext(s,{navigator:{clipboard:{writeText:t=>{clipboard=t;}}}});},
 $:async()=>({click:async()=>{}}),createCDPSession:async()=>({send:async()=>{},detach:async()=>{}}),
 keyboard:{down:async()=>{},up:async()=>{},press:async k=>{if(k==='KeyV'){pastes++;input=clipboard;state.sendDisabled=disabled;}if(k==='Enter'){enters++;state.messages.push({id:messageId,self:true,toId:11,text:input,visible:true});input='';}}},
 waitForFunction:async s=>{const value=runInNewContext(s.replaceAll(EMBEDDED_STATE_SCRIPT,JSON.stringify(state)).replaceAll(read,JSON.stringify(input)));assert.equal(value,true);}};
 return ()=>({enters,pastes,state});
}
test('identity requires candidate, exact name/job, editor and root association',()=>{
 for(const key of ['name','candidateId','job','conversationId','editorId','rootFriendId'])assert.throws(()=>validateEmbeddedState({...base(),[key]:'bad'},target));
 validateEmbeddedState(base(),target);
});
test('readonly check and identity failure never type or send',async()=>{
 let result=setup();assert.equal(JSON.parse(await sendEmbeddedChat(target,'hello',true)).status,'ready');assert.equal(result().pastes,0);
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
 await assert.rejects(sendEmbeddedChat(target,'hello'));
 assert.equal(result().enters,1);
});
test('CLI embedded check routes read-only and rejects missing identity/side-effect flags',async()=>{
 const result=setup();
 const answer=JSON.parse(await executeCommand(['chat','测试','--embedded','--check','--candidate-id','encrypted-1','--job','测试岗位','--json']));
 assert.equal(answer.identityVerified,true);assert.equal(result().pastes,0);
 const ready=JSON.parse(await executeCommand(['send','--embedded','--check','--name','测试','--candidate-id','encrypted-1','--job','测试岗位','--text','消息','--json']));
 assert.equal(ready.status,'ready');assert.equal(result().pastes,0);
 await assert.rejects(executeCommand(['send','--embedded','--name','测试','--text','消息']),/candidate-id/);
 await assert.rejects(executeCommand(['send','--embedded','--name','测试','--candidate-id','encrypted-1','--job','测试岗位','--text','消息','--request-resume']),/candidate-id/);
});
