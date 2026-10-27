import puppeteer from 'puppeteer-core';
import { REMOTE_DEBUGGING_PORT } from '../browser/cdp_browser.js';
import type { Page } from 'puppeteer-core';

export type CheckCriteria = { page?: string; overlay?: string; state?: string; name?: string; dataId?: string; candidateId?: string; job?: string; keyword?: string; text?: string; embedded?: boolean };
export const PAGE_TYPES = ['chat','search','recommend','deep-search','online-resume','positions','login','other'];
export const STATES = ['online-resume-open','conversation','send-ready','message-visible','contact-ready','contacted','job-selected','resume-received','resume-request'];

/** Snapshot only. No component methods, DOM writes, focus, navigation or polling. */
export const STATUS_SCRIPT = `(() => {
 const norm=v=>(v||'').replace(/\\s+/g,' ').trim();
 const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const one=(selector,root=document)=>{const a=Array.from(root.querySelectorAll(selector)).filter(visible);if(a.length>1)throw new Error('状态不唯一：'+selector);return a[0];};
 const panel=one('.resume-middle-wrap');
 const box=panel&&one('.resume-right-side .resume-simple-box',panel);
 const props=box?.__vue__?.$props;
 const chat=one('.chat-global-conversation');
 const card=chat&&one('.bosschat-chat-global-card',chat);
 const c=card?.__vue__?.$props?.conversation;
 const input=chat?one('#boss-chat-global-input',chat):one('#boss-chat-editor-input');
 const host=input?.closest('.conversation-global-editor')?.__vue__;
 const selected=one('.geek-item.selected');
 const detail=norm(document.querySelector('.base-info-single-container .name-box')?.textContent);
 const chatSearchRoot=one('.chat-top-search');
 const chatSearchVm=chatSearchRoot?.__vue__;
 const chatSearch=chatSearchRoot?{keyword:chatSearchRoot.querySelector('input.search-input')?.value,content:chatSearchVm?.content,showSearchResult:chatSearchVm?.showSearchResult,showClose:chatSearchVm?.showClose,matches:chatSearchVm?.searchList?.map(x=>({name:x.name,uniqueId:x.uniqueId})),groupCount:chatSearchVm?.searchGroupList?.length,rows:[...chatSearchRoot.querySelectorAll('.geek-search-list li')].map(e=>norm(e.textContent))}:null;
 const editorText=input?.innerText||input?.textContent||'';
 const buttons=Array.from((box||document).querySelectorAll('button,a,[role="button"],.btn-getcontact,.btn-greet')).filter(visible);
 const contact=buttons.filter(e=>/^(立即沟通|打招呼|继续沟通)(?:[（(]\\s*\\d+\\s*\\/\\s*\\d+\\s*[）)])?$/.test(norm(e.textContent)));
 if(box&&contact.length>1)throw new Error('沟通按钮不唯一');
 const usable=e=>!!e&&!e.matches(':disabled,[disabled],[aria-disabled="true"]')&&!/disabled|forbid|ban/i.test(e.className)&&getComputedStyle(e).pointerEvents!=='none';
 const jobDialog=one('.common-job-list-dialog');
 const activeJob=jobDialog&&one('.select-list > li.active',jobDialog);
 const friends=Array.from(document.querySelectorAll('.chat-message-list .message-item .item-friend'));
 const cards=Array.from(document.querySelectorAll('.geek-info-card')).map(e=>{const g=e.__vue__?.$props?.geek?.geekCard;return {name:norm(e.querySelector('.name-label')?.textContent),candidateId:g?.encryptGeekId||'',componentName:norm(g?.name)};});
 return {
  chatSearch,chatFilterJob:norm(document.querySelector('.chat-top-job .ui-dropmenu-label')?.textContent),
  resume:!!panel,resumeId:props?.geekInfo?.encryptGeekId||'',resumeInfoId:props?.resumeInfo?.encryptGeekId||'',
  embedded:!!chat,embeddedIdentity:c?{name:c.name,candidateId:c.encryptUid,job:c.toPosition,conversationId:c.uniqueId,editorId:host?.$props?.uniqueId,friendId:c.friendId,rootFriendId:chat.__vue__?.$props?.friendId}:null,
  conversation:selected?{name:norm(selected.querySelector('.geek-name')?.textContent),dataId:selected.getAttribute('data-id')||'',detailName:detail}:null,
  editable:!!input&&(input.isContentEditable||input.tagName==='TEXTAREA')&&usable(input),draft:editorText,
  messages:chat?Array.from(chat.querySelectorAll('.message-item')).map(e=>e.__vue__?.$props?.message).filter(m=>m?.isSelf===true).map(m=>m.text||''):Array.from(document.querySelectorAll('.chat-message-list .item-myself .text span')).map(e=>e.innerText||''),
  contactText:box?norm(contact[0]?.textContent):'',contactUsable:!!box&&usable(contact[0]),
  selectedJob:activeJob?norm(activeJob.querySelector('h3')?.textContent):null,
  resumeReceived:friends.some(e=>!!e.querySelector('.resume-icon')),
  resumeRequest:friends.some(e=>norm(e.querySelector('.message-card-top-title')?.textContent).includes('附件简历')&&Array.from(e.querySelectorAll('.message-card-buttons .card-btn')).some(b=>visible(b)&&norm(b.textContent).startsWith('同意')&&usable(b))),
  keyword:document.querySelector('.search-input')?.value??null,searchJob:norm(document.querySelector('.search-current-job')?.textContent),recommendJob:norm(document.querySelector('.job-selecter-wrap .ui-dropmenu-label')?.textContent),chatJob:norm(document.querySelector('.base-info-single-container .position-item .position-name')?.textContent),cards
 };
})()`;
export async function readStatus(page: Page): Promise<any> {
 const url=page.url(), u=new URL(url);
 if(u.hostname!=='www.zhipin.com') throw new Error('当前标签页不是 BOSS');
 const paths:Record<string,string>={'/web/chat/index':'chat','/web/chat/search':'search','/web/chat/recommend':'recommend','/web/chat/aiform':'deep-search','/web/chat/job/list':'positions'};
 const pageType=paths[u.pathname]||(u.pathname.startsWith('/web/frame/c-resume/')?'online-resume':u.pathname.startsWith('/web/user')?'login':'other');
 const info:any=await page.evaluate(STATUS_SCRIPT);
 if(pageType==='search'||pageType==='recommend') {
  const frames=page.frames().filter(f=>new URL(f.url()||'about:blank').pathname.replace(/\/+$/,'')===(pageType==='search'?'/web/frame/search':'/web/frame/recommend'));
  if(frames.length!==1)throw new Error(`${pageType==='recommend'?'推荐':'搜索'} frame 缺失或不唯一，无法读取状态；main=${u.origin+u.pathname}；frames=${JSON.stringify(page.frames().map(f=>{const url=new URL(f.url()||'about:blank');return url.origin+url.pathname;}))}`);
  const search:any=await frames[0]!.evaluate(STATUS_SCRIPT);
  info.keyword=search.keyword;info.searchJob=pageType==='search'?search.searchJob:search.recommendJob;info.cards=search.cards;
 }
 return {url,pageType,overlayType:info.resume?'online-resume':null,...info};
}
export function validateCriteria(c:CheckCriteria):void {
 if(c.page&&!PAGE_TYPES.includes(c.page))throw new Error('未知页面类型：'+c.page);
 if(c.overlay&&!['online-resume','none'].includes(c.overlay))throw new Error('未知弹层类型：'+c.overlay);
 if(c.state==='job-selected'&&!c.job)throw new Error('job-selected 需要 --job');
 if(c.state&&!STATES.includes(c.state))throw new Error('未知状态：'+c.state);
 if(!Object.values(c).some(v=>v!==undefined))throw new Error('check 必须提供比较标准');
 if(['send-ready','message-visible'].includes(c.state||'')&&!c.text?.trim())throw new Error('消息检查需要 --text');
 if(c.dataId&&!c.name)throw new Error('--data-id 需要姓名');
 if(c.candidateId&&!c.name)throw new Error('--candidate-id 需要姓名');
}
export function matchesStatus(s:any,c:CheckCriteria):boolean {
 validateCriteria(c);
 if(c.page&&s.pageType!==c.page)return false;
 if(c.overlay&&(s.overlayType||'none')!==c.overlay)return false;
 if(c.embedded!==undefined&&s.embedded!==c.embedded)return false;
 if(c.keyword!==undefined&&s.keyword!==c.keyword)return false;
 if(!c.name&&!c.dataId&&!c.candidateId&&!c.state&&c.embedded===undefined) return !c.job||(s.pageType==='chat'?s.chatJob:s.searchJob)===c.job;
 let identity=s.conversation,job=s.pageType==='chat'?s.chatJob:s.searchJob;
 if(c.embedded) {
  identity=s.embeddedIdentity;job=identity?.job;
  if(!identity||!identity.conversationId||identity.conversationId!==identity.editorId||!identity.friendId||identity.friendId!==identity.rootFriendId)return false;
 } else if(c.candidateId||(s.resume&&c.name)) {
  const cards=s.cards.filter((x:any)=>x.name===c.name&&(!c.candidateId||x.candidateId===c.candidateId));
  if(cards.length!==1)return false;
  identity=cards[0];
  if(!identity.candidateId||identity.componentName!==identity.name)return false;
  if(s.resume&&(s.resumeId!==identity.candidateId||s.resumeInfoId!==identity.candidateId))return false;
 } else if(identity&&identity.name!==identity.detailName)return false;
 if(c.name&&identity?.name!==c.name)return false;
 if(c.dataId&&identity?.dataId!==c.dataId)return false;
 if(c.candidateId&&identity?.candidateId!==c.candidateId)return false;
 if(c.job&&(c.state==='job-selected'?s.selectedJob:job)!==c.job)return false;
 const norm=(v:string)=>(v||'').replace(/\r\n/g,'\n').trim();
 const seen=c.text!==undefined&&s.messages.some((m:string)=>norm(m)===norm(c.text!));
 switch(c.state){
  case 'online-resume-open':return s.resume||s.pageType==='online-resume';
  case 'conversation':return !!identity&&(c.embedded?s.embedded:s.pageType==='chat');
  case 'send-ready':return !!identity&&s.editable&&!norm(s.draft)&&!seen;
  case 'message-visible':return !!seen;
  case 'contact-ready':return s.resume&&s.contactUsable&&/^(立即沟通|打招呼)/.test(s.contactText);
  case 'contacted':return s.resume&&s.contactText==='继续沟通';
  case 'job-selected':return !!s.selectedJob&&s.selectedJob===c.job;
  case 'resume-received':return s.resumeReceived;
  case 'resume-request':return s.resumeRequest;
  default:return true;
 }
}
/** Separate read-only connection: no shared-session guards or browser launch. */
async function withReadOnlyPage<T>(fn:(page:Page)=>Promise<T>):Promise<T>{
 const browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${REMOTE_DEBUGGING_PORT}`,defaultViewport:null,protocolTimeout:10000});
 try {
  const pages=(await browser.pages()).filter(p=>{try{return new URL(p.url()).hostname==='www.zhipin.com';}catch{return false;}});
  if(pages.length!==1)throw new Error('需要唯一 BOSS 标签页，实际数量：'+pages.length);
  return await fn(pages[0]!);
 } finally {await browser.disconnect();}
}
export async function runCheck(criteria:CheckCriteria):Promise<string>{validateCriteria(criteria);return withReadOnlyPage(async page=>JSON.stringify(matchesStatus(await readStatus(page),criteria)));}
export async function runStatus():Promise<string>{return withReadOnlyPage(async page=>JSON.stringify(await readStatus(page)));}
