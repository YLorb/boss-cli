import type { Frame, Page } from 'puppeteer-core';
import { ResumeFrameOpenError } from '../common/resume_frame_locator.js';
import { RESUME_IDENTITY_SCRIPT } from './recommend_identity.js';

// Keep every query filter, including city; pagination and rendered rows are dynamic.
export const SEARCH_RESUME_CONDITIONS_SCRIPT=`(() => {
 const roots=[...document.querySelectorAll('.search-container')].map(e=>e.__vue__).filter(v=>v?.$options?.name==='SearchCandidatesIndex');
 if(roots.length!==1)throw Error('搜索列表组件缺失或不唯一');
 const root=roots[0];
 if(root.isInitPage$!==false)throw Error('搜索条件仍在初始化，禁止重开简历');
 if(!root.params$||typeof root.params$!=='object'||Array.isArray(root.params$))throw Error('搜索条件参数缺失或格式不符');
 const params=Object.fromEntries(Object.keys(root.params$).filter(key=>key!=='page').sort().map(key=>[key,root.params$[key]]));
 return JSON.stringify({keyword:document.querySelector('.search-input')?.value,params,job:document.querySelector('.search-current-job')?.textContent?.trim()});
})()`;

export function closeSearchResumeScript(id:string):string {return `(() => {
 const identity=${RESUME_IDENTITY_SCRIPT};
 if(identity.geekId!==${JSON.stringify(id)}||identity.resumeId!==${JSON.stringify(id)})throw Error('关闭简历前身份不符，停止恢复');
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const panel=[...document.querySelectorAll('.resume-middle-wrap')].filter(visible)[0];
 const dialog=panel.closest('.dialog-lib-resume,.boss-popup__wrapper,.boss-dialog__wrapper,.dialog-container,.dialog-wrap');
 if(!dialog)throw Error('目标简历关闭容器无法唯一定位');
 const buttons=[...dialog.querySelectorAll('.close-btn,.boss-popup__close,.boss-dialog__close,.drawer-close,.icon-close,.btn-quxiao')].filter(visible);
 if(buttons.length!==1)throw Error('目标简历关闭按钮不唯一：'+buttons.length);
 const button=buttons[0],r=button.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
 if(button.matches('[disabled],[aria-disabled="true"]')||getComputedStyle(button).pointerEvents==='none'||x<0||y<0||x>=innerWidth||y>=innerHeight||!hit||(hit!==button&&!button.contains(hit)))throw Error('目标简历关闭按钮不可用或被遮挡');
 button.click();return {clicked:true};
})()`;}

/** Explicit user opt-in; only an opening failure permits one close/reopen. */
export async function withSearchResumeRecovery<T>(page:Page,search:Frame,id:string,attempt:()=>Promise<T>) {
 const url=page.url(),conditions=await search.evaluate(SEARCH_RESUME_CONDITIONS_SCRIPT);
 let navigated=false;
 const onNavigation=(frame:Frame)=>{if(frame===page.mainFrame())navigated=true;};
 page.on('framenavigated',onNavigation);
 const verify=async()=>{
  if(navigated||page.url()!==url||search.detached)throw Error('简历恢复期间页面导航或搜索Frame失效，停止');
  if(await search.evaluate(SEARCH_RESUME_CONDITIONS_SCRIPT)!==conditions)throw Error('简历恢复期间搜索筛选条件变化，停止（比较关键词、岗位及除page外的全部搜索参数）');
 };
 try {
  try {const result=await attempt();await verify();return {result,recovery:{attempted:false}};}
  catch(error) {
   if(!(error instanceof ResumeFrameOpenError))throw error;
   const firstError=error.message;
   console.error('[boss-cli][resume-recovery] '+JSON.stringify({stage:'open-failed',candidateId:id,error:firstError}));
   await verify();
   await page.evaluate(closeSearchResumeScript(id));
   console.error('[boss-cli][resume-recovery] '+JSON.stringify({stage:'close-clicked',candidateId:id}));
   const closed=await page.waitForFunction(`(() => ![...document.querySelectorAll('.resume-middle-wrap')].some(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>8&&r.height>8&&s.visibility!=='hidden'&&s.display!=='none';}))()`,{timeout:5000,polling:100});
   await closed.dispose();
   await verify();
   try {
    const result=await attempt();await verify();
    return {result,recovery:{attempted:true,closed:true,reopened:true,firstError}};
   }catch(second){throw new Error(`目标简历重开一次后失败，停止：candidateId=${id}；first=${firstError}；second=${second instanceof Error?second.message:String(second)}`,{cause:second});}
  }
 }finally {page.off('framenavigated',onNavigation);}
}
