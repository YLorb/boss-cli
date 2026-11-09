import { withBossSessionPage } from '../common/boss_session_page.js';
import { recommendTargetScript } from './recommend_identity.js';
import { recommendJobKey } from './recommend_job.js';
import { readEmbeddedState, validateEmbeddedState } from './embedded-chat.js';

export type RecommendChatTarget = { name: string; candidateId: string; job: string; recommendJob: string };
const visible = `e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';}`;
const rootCount = `Array.from(document.querySelectorAll('.chat-global-conversation')).filter(${visible}).length`;

/** Loading is pending; any populated identity conflict is terminal, even during loading. */
function readinessScript(target: RecommendChatTarget, url: string): string {
  return `(() => {
    if(location.href!==${JSON.stringify(url)})return {error:'打开后页面发生导航，停止且不重试'};
    const visible=${visible},missing=v=>v==null||v==='';
    const roots=[...document.querySelectorAll('.chat-global-conversation')].filter(visible);
    if(roots.length>1)return {error:'可见内嵌会话数量异常：'+roots.length};
    if(!roots.length)return {pending:['root']};
    const root=roots[0],cards=[...root.querySelectorAll('.bosschat-chat-global-card')].filter(visible),editors=[...root.querySelectorAll('#boss-chat-global-input')].filter(visible);
    if(cards.length>1||editors.length>1)return {error:'内嵌会话卡片或输入框不唯一'};
    const c=cards[0]?.__vue__?.$props?.conversation,host=editors[0]?.closest('.conversation-global-editor')?.__vue__;
    const s={name:c?.name,candidateId:c?.encryptUid,job:c?.toPosition,conversationId:c?.uniqueId,friendId:c?.friendId,rootFriendId:root.__vue__?.$props?.friendId,editorId:host?.$props?.uniqueId};
    const conflicts=[];
    if(!missing(s.candidateId)&&s.candidateId!==${JSON.stringify(target.candidateId)})conflicts.push('candidateId');
    if(!missing(s.job)&&s.job!==${JSON.stringify(target.job)})conflicts.push('job');
    if(!missing(s.editorId)&&!missing(s.conversationId)&&s.editorId!==s.conversationId)conflicts.push('editorId');
    if(!missing(s.rootFriendId)&&!missing(s.friendId)&&s.rootFriendId!==s.friendId)conflicts.push('rootFriendId');
    if(!missing(s.friendId)&&!s.friendId)conflicts.push('friendId');
    if(conflicts.length)return {error:'打开的内嵌会话身份／岗位不符：'+conflicts.map(function(k){var a=JSON.stringify(s[k]);var e=k==='job'?JSON.stringify(${JSON.stringify(target.job)}):(k==='candidateId'?JSON.stringify(${JSON.stringify(target.candidateId)}):'');return e?k+'（期望 '+e+'，实际 '+a+'）':k+'（实际 '+a+'）';}).join('；')+'，禁止发送'};
    const pending=Object.keys(s).filter(k=>missing(s[k])||(k==='name'&&!String(s[k]).trim()));
    return pending.length?{pending}:{opened:true};
  })()`;
}

/** Open only an existing contact from its recommendation card. Never greet or navigate. */
export async function openRecommendChat(target: RecommendChatTarget): Promise<string> {
  if(Object.values(target).some(value=>!value.trim())) throw new Error('推荐聊天必须提供姓名、candidate-id、job和recommend-job');
  return withBossSessionPage(async page=>{
    const url=page.url(), parsed=new URL(url);
    if(parsed.origin!=='https://www.zhipin.com'||parsed.pathname!=='/web/chat/recommend')
      throw new Error('推荐聊天要求当前已在 BOSS 推荐页，不自动导航');
    const hosts=await page.$$('iframe[name="recommendFrame"]');
    if(hosts.length!==1) throw new Error('推荐 iframe 缺失或不唯一');
    const frame=await hosts[0].contentFrame();
    if(!frame||new URL(frame.url()).origin!==parsed.origin||new URL(frame.url()).pathname.replace(/\/+$/,'')!=='/web/frame/recommend')
      throw new Error('推荐 iframe 来源不符');
    const frameUrl=frame.url();
    let navigated=false;
    const onNavigation=(changed:unknown)=>{if(changed===page.mainFrame()||changed===frame)navigated=true;};
    page.on('framenavigated',onNavigation);
    const jobScript=`(() => {
      const visible=${visible};
      const labels=[...document.querySelectorAll('.job-selecter-wrap .ui-dropmenu-label')].filter(visible);
      if(labels.length!==1)throw Error('推荐岗位标签不唯一');
      return labels[0].textContent.replace(/\\s+/g,' ').trim();
    })()`;
    try {
    const initialJob=await frame.evaluate(jobScript) as string;
    const guard=async()=>{
      if(navigated||page.url()!==url||frame.url()!==frameUrl)throw new Error('推荐聊天期间页面发生导航，停止且不重试');
      if(await frame.evaluate(jobScript)!==initialJob)throw new Error('推荐聊天期间岗位变化，停止');
    };
      if(recommendJobKey(initialJob)!==recommendJobKey(target.recommendJob))throw new Error(`推荐岗位不符：expected=${target.recommendJob}；actual=${initialJob}`);
      await guard();
      const count=await page.evaluate(`(${rootCount})`) as number;
      if(count>1)throw new Error('可见内嵌会话数量异常：'+count);
      let clicked=false;
      if(count===0) {
        await frame.evaluate(`(() => {
          const visible=${visible}, url=${JSON.stringify(url)}, frameUrl=${JSON.stringify(frameUrl)};
          if(location.href!==frameUrl||top.location.href!==url)throw Error('打开前页面发生导航，未点击');
          if([...top.document.querySelectorAll('.chat-global-conversation,.resume-middle-wrap')].some(visible)||[...document.querySelectorAll('.resume-middle-wrap')].some(visible))
            throw Error('已有聊天或简历遮挡，未点击');
          const labels=[...document.querySelectorAll('.job-selecter-wrap .ui-dropmenu-label')].filter(visible);
          if(labels.length!==1||labels[0].textContent.replace(/\\s+/g,' ').trim()!==${JSON.stringify(initialJob)})throw Error('打开前推荐岗位变化，未点击');
          const {card}=${recommendTargetScript(target.name,target.candidateId)};
          const buttons=[...card.querySelectorAll('.button-chat-wrap button')].filter(visible);
          const norm=e=>e.textContent.replace(/\\s+/g,' ').trim();
          if(buttons.some(e=>norm(e)==='打招呼'))throw Error('候选人仍是打招呼状态，禁止重复触达');
          const next=buttons.filter(e=>['继续聊','继续沟通'].includes(norm(e)));
          if(next.length!==1)throw Error('同人继续聊按钮缺失或不唯一，未点击');
          const button=next[0];
          if(button.matches(':disabled,[disabled],[aria-disabled="true"]')||/disabled|forbid|ban/i.test(button.className)||getComputedStyle(button).pointerEvents==='none'||button.closest('form'))
            throw Error('继续聊按钮不可用，未点击');
          button.scrollIntoView({block:'center',inline:'nearest'});
          const r=button.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
          const host=window.frameElement,hr=host?.getBoundingClientRect(),outer=hr&&top.document.elementFromPoint(hr.left+host.clientLeft+x,hr.top+host.clientTop+y);
          if(!hit||(hit!==button&&!button.contains(hit))||outer!==host||x<0||y<0||x>=innerWidth||y>=innerHeight)
            throw Error('继续聊按钮或推荐 iframe 被遮挡／视口外，未点击');
          button.click();
        })()`);
        clicked=true;
        const probe=readinessScript(target,url);
        let handle;
        try {
          handle=await page.waitForFunction(`(() => {const result=${probe};return result.pending?false:result;})()`,{timeout:5000});
        } catch(error) {
          if(!(error instanceof Error)||error.name!=='TimeoutError')throw error;
          let diagnostic:unknown;
          try {diagnostic=await page.evaluate(probe);}
          catch(readError){diagnostic={diagnosticError:String(readError)};}
          throw new Error('内嵌会话在 5000ms 内未就绪；超时后只读快照='+JSON.stringify(diagnostic));
        }
        try {const result=await handle.jsonValue() as {error?:string};if(result.error)throw new Error(result.error);}
        finally {await handle.dispose();}
      }
      await guard();
      const state=await readEmbeddedState(page);
      // Display names may become unmasked; the encrypted candidate ID and exact job must not change.
      if(!state.name?.trim())throw new Error('内嵌实际姓名缺失');
      const actualTarget={name:state.name,candidateId:target.candidateId,job:target.job};
      validateEmbeddedState(state,actualTarget);
      await guard();
      return JSON.stringify({status:clicked?'embedded-opened':'embedded-already-open',clicked,identityVerified:true,
        target:actualTarget,cardName:target.name,recommendJob:initialJob,conversationId:state.conversationId});
    } catch(error) {
      throw new Error(`推荐继续聊失败 candidateId=${target.candidateId}；${error instanceof Error?error.message:String(error)}；不得重试触达或发送`);
    } finally {page.off('framenavigated',onNavigation);}
  },{ensureChatShell:false,ensureMenuList:false});
}
