import { withBossSessionPage } from '../common/boss_session_page.js';
import { readStatus, matchesStatus } from './check.js';

type NoticeTarget = {name:string;candidateId:string;job:string};
// Observed success-only dialog. Other purchase, confirmation or quota dialogs are not accepted.
export const CONTACT_NOTICE_PATTERN = '^使用成功已为您发起沟通并索要简历/微信/电话(?:注：该牛人已开通虚拟电话，可直接电话联系该牛人)?查看对话关闭$';
export function dismissContactNoticeScript(target:NoticeTarget):string {
  return `(() => {
    if(location.hostname!=='www.zhipin.com'||location.pathname!=='/web/chat/search') throw new Error('关闭提示需要当前 BOSS 搜索页');
    const norm=v=>(v||'').replace(/\\s+/g,' ').trim();
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
    const panels=Array.from(document.querySelectorAll('.resume-middle-wrap')).filter(visible);
    if(panels.length!==1) throw new Error('关闭提示前简历数量不唯一');
    const boxes=Array.from(panels[0].querySelectorAll('.resume-right-side .resume-simple-box')).filter(visible);
    const props=boxes[0]?.__vue__?.$props,id=${JSON.stringify(target.candidateId)};
    if(boxes.length!==1||!id||props?.geekInfo?.encryptGeekId!==id||props?.resumeInfo?.encryptGeekId!==id)
      throw new Error('关闭提示前候选人 ID 变化或缺失');
    const contacts=Array.from(boxes[0].querySelectorAll('button,a,[role="button"],.btn-getcontact,.btn-greet')).filter(e=>visible(e)&&norm(e.textContent)==='继续沟通');
    if(contacts.length!==1) throw new Error('未确认联系成功，不能关闭使用提示');
    const notices=Array.from(document.querySelectorAll('.dialog-wrap.active')).filter(e=>visible(e)&&new RegExp(${JSON.stringify(CONTACT_NOTICE_PATTERN)}).test((e.textContent||'').replace(/\\s+/g,'')));
    if(notices.length!==1) throw new Error('已知畅聊卡使用成功提示缺失或不唯一：'+notices.length);
    const buttons=Array.from(notices[0].querySelectorAll('.boss-dialog__footer .boss-dialog__button')).filter(e=>visible(e)&&norm(e.textContent)==='关闭');
    if(buttons.length!==1) throw new Error('使用成功提示的关闭控件不唯一');
    const button=buttons[0],r=button.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
    if(button.matches('[disabled],[aria-disabled="true"]')||/disabled|forbid|ban/i.test(button.className)||getComputedStyle(button).pointerEvents==='none') throw new Error('提示关闭控件不可用');
    if(x<0||y<0||x>=innerWidth||y>=innerHeight||!hit||(hit!==button&&!button.contains(hit))) throw new Error('提示关闭控件在视口外或被遮挡');
    button.click();return {clicked:true};
  })()`;
}

export async function dismissContactNotice(target:NoticeTarget):Promise<string> {
  if(!target.name?.trim()||!target.candidateId?.trim()||!target.job?.trim()) throw new Error('关闭使用提示需要姓名、candidate-id和job');
  return withBossSessionPage(async page=>{
    const before=await readStatus(page);
    if(!matchesStatus(before,{page:'search',state:'contacted',...target})) throw new Error('关闭使用提示前身份、岗位或已联系状态不符');
    await page.evaluate(dismissContactNoticeScript(target));
    const handle=await page.waitForFunction(`(() => {
      if(location.href!==${JSON.stringify(before.url)}) return {error:'关闭使用提示后发生导航，停止且不重试'};
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
      return !Array.from(document.querySelectorAll('.dialog-wrap.active')).some(e=>visible(e)&&new RegExp(${JSON.stringify(CONTACT_NOTICE_PATTERN)}).test((e.textContent||'').replace(/\\s+/g,'')))&&{closed:true};
    })()`,{timeout:5000});
    try {const result=await handle.jsonValue() as {error?:string};if(result.error)throw new Error(result.error);}
    finally {await handle.dispose();}
    const after=await readStatus(page);
    if(after.url!==before.url||after.resumeId!==target.candidateId||after.resumeInfoId!==target.candidateId||after.searchJob!==target.job||after.keyword!==before.keyword||after.contactText!=='继续沟通')
      throw new Error('使用提示已点击关闭，但页面、简历或搜索条件变化，停止且不重试');
    return JSON.stringify({status:'contact-notice-dismissed',clicked:true,target,contactConfirmed:true});
  },{ensureChatShell:false,ensureMenuList:false});
}
