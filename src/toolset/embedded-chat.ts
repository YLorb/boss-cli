import { runCheck } from './check.js';
import type { Page } from 'puppeteer-core';
import { CHAT_INPUT_TEXT_READER } from '../common/chat_input_text.js';
import { selectAllModifierKey } from '../browser/index.js';
import { withBossSessionPage } from '../common/boss_session_page.js';

export type EmbeddedTarget = { name: string; candidateId: string; job: string };
export type EmbeddedState = {
  name: string; candidateId: string; job: string; conversationId: string;
  friendId: number; editorId: string; rootFriendId: number;
  editable: boolean; sendDisabled: boolean;
  messages: Array<{ id: string; text: string; self: boolean; toId: number; visible: boolean }>;
};
export const EMBEDDED_STATE_SCRIPT = `(() => {
  const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const roots=Array.from(document.querySelectorAll('.chat-global-conversation')).filter(visible);
  if(roots.length!==1) throw new Error('可见内嵌会话数量异常：'+roots.length);
  const root=roots[0];
  const cards=Array.from(root.querySelectorAll('.bosschat-chat-global-card')).filter(visible);
  const editors=Array.from(root.querySelectorAll('#boss-chat-global-input')).filter(visible);
  if(cards.length!==1||editors.length!==1) throw new Error('内嵌会话卡片或输入框不唯一');
  const c=cards[0].__vue__?.$props?.conversation;
  const editor=editors[0], host=editor.closest('.conversation-global-editor');
  if(!c||!host?.__vue__) throw new Error('内嵌会话身份组件未就绪');
  return {name:c.name,candidateId:c.encryptUid,job:c.toPosition,conversationId:c.uniqueId,
    friendId:c.friendId,rootFriendId:root.__vue__?.$props?.friendId,editorId:host.__vue__.$props.uniqueId,
    editable:editor.isContentEditable&&!editor.matches('[aria-disabled="true"],[disabled]'),
    sendDisabled:host.__vue__.$data.disabled,
    messages:Array.from(root.querySelectorAll('.message-item')).map(el=>{
      const m=el.__vue__?.$props?.message;
      const norm=v=>(v||'').replace(/\\s+/g,' ').trim();
      return {id:String(m?.mid||''),text:m?.text||'',self:m?.isSelf===true,toId:m?.toId,visible:visible(el)&&!!norm(m?.text)&&norm(el.innerText).includes(norm(m?.text))};
    })};
})()`;
export function validateEmbeddedState(state: EmbeddedState, target: EmbeddedTarget): void {
  if(!target.name?.trim()||!target.candidateId?.trim()||!target.job?.trim()) throw new Error('内嵌会话必须提供姓名、candidate-id和job');
  if(state.name!==target.name||state.candidateId!==target.candidateId||state.job!==target.job||
    !state.conversationId||state.editorId!==state.conversationId||!state.friendId||state.rootFriendId!==state.friendId)
    throw new Error('内嵌会话身份/岗位校验失败：'+JSON.stringify({expected:target,actual:{name:state.name,candidateId:state.candidateId,job:state.job,conversationId:state.conversationId,editorId:state.editorId}}));
}
export async function readEmbeddedState(page: Page): Promise<EmbeddedState> {
  if(new URL(page.url()).pathname!=='/web/chat/search') throw new Error('内嵌聊天只支持当前搜索页，不自动跳转');
  return await page.evaluate(EMBEDDED_STATE_SCRIPT) as EmbeddedState;
}
export async function assertEmbeddedConversation(page: Page, target: EmbeddedTarget): Promise<EmbeddedState> {
  const state=await readEmbeddedState(page); validateEmbeddedState(state,target);return state;
}
export async function inspectEmbeddedChat(): Promise<string> {
  return withBossSessionPage(async page=>JSON.stringify({status:'diagnostic-only',identityVerified:false,...await readEmbeddedState(page)}),{ensureChatShell:false,ensureMenuList:false});
}
export async function checkEmbeddedChat(target: EmbeddedTarget): Promise<string> {
  return runCheck({page:'search',state:'conversation',embedded:true,...target});
}

/** Same-window send; never navigates, contacts, or falls back to the independent chat page. */
export async function sendEmbeddedChat(target: EmbeddedTarget, rawText: string, check=false): Promise<string> {
  const text=rawText.replace(/\r\n/g,'\n').trim();
  if(!text) throw new Error('消息正文不能为空');
  if(check) return runCheck({page:'search',state:'send-ready',embedded:true,...target,text});
  return withBossSessionPage(async page=>{
    const before=await assertEmbeddedConversation(page,target);
    if(!before.editable) throw new Error('内嵌输入框不可编辑，未发送');
    if(before.messages.some(m=>m.self&&m.text.replace(/\r\n/g,'\n').trim()===text))
      return JSON.stringify({status:'already-visible',target,sent:false});
    const readInput=`(() => { const read=${CHAT_INPUT_TEXT_READER};return read(document.querySelector('#boss-chat-global-input'));})()`;
    if(String(await page.evaluate(readInput)).trim()) throw new Error('内嵌输入框已有草稿，停止以避免覆盖');
    const input=await page.$('#boss-chat-global-input');
    if(!input) throw new Error('内嵌输入框消失');
    await page.bringToFront();
    await input.click();
    await assertEmbeddedConversation(page,target);
    const cdp=await page.createCDPSession();
    try {
      await cdp.send('Browser.setPermission',{permission:{name:'clipboard-write',allowWithoutSanitization:false},setting:'granted',origin:new URL(page.url()).origin});
      await page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(text)})`);
    } finally {await cdp.detach();}
    await assertEmbeddedConversation(page,target);
    await input.click();
    if(String(await page.evaluate(readInput)).trim()) throw new Error('粘贴前发现内嵌输入框已有草稿，停止');
    const mod=selectAllModifierKey();
    await page.keyboard.down(mod);
    try {await page.keyboard.press('KeyV');} finally {await page.keyboard.up(mod);}
    await page.waitForFunction(`(${readInput}).replace(/\\r\\n/g,'\\n').trim()===${JSON.stringify(text)}`,{timeout:5000});
    const ready=await assertEmbeddedConversation(page,target);
    if(!ready.editable||ready.sendDisabled) throw new Error('内嵌发送被页面禁用，已输入但未发送');
    await page.keyboard.press('Enter');
    const previous=before.messages.map(m=>m.id);
    await page.waitForFunction(`(() => {
      const s=${EMBEDDED_STATE_SCRIPT};
      if(s.candidateId!==${JSON.stringify(target.candidateId)}||s.name!==${JSON.stringify(target.name)}||s.job!==${JSON.stringify(target.job)}||s.editorId!==s.conversationId||s.friendId!==s.rootFriendId)
        throw new Error('发送后内嵌会话身份变化，禁止重试');
      return s.messages.some(m=>m.id&&m.self&&m.visible&&m.toId===s.friendId&&!${JSON.stringify(previous)}.includes(m.id)&&m.text.replace(/\\r\\n/g,'\\n').trim()===${JSON.stringify(text)});
    })()`,{timeout:15000});
    const after=await assertEmbeddedConversation(page,target);
    return JSON.stringify({status:'message-visible',sent:true,target,conversationId:after.conversationId,text,
      messageIds:after.messages.filter(m=>m.self&&!previous.includes(m.id)&&m.text.replace(/\r\n/g,'\n').trim()===text).map(m=>m.id)});
  },{ensureChatShell:false,ensureMenuList:false});
}
