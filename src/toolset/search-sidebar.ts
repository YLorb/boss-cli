import { withGuardedReadOnlyPage } from './check.js';

/** Bounded semantic sidebar read; no DOM writes, component calls, clicks or requests. */
export const SEARCH_SIDEBAR_SCRIPT = `(() => {
 const norm=v=>(v??'').replace(/\\s+/g,' ').trim();
 const visible=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const labels=Array.from(document.querySelectorAll('*')).filter(e=>visible(e)&&norm(e.textContent)==='我的订阅'&&!Array.from(e.children).some(c=>visible(c)&&norm(c.textContent)==='我的订阅'));
 if(labels.length!==1)throw new Error('搜索侧栏“我的订阅”标题缺失或不唯一：'+labels.length);
 let root=labels[0].parentElement;
 while(root&&root!==document.body&&root!==document.documentElement&&!norm(root.textContent).includes('搜索畅聊卡'))root=root.parentElement;
 if(!root||root===document.body||root===document.documentElement)throw new Error('无法唯一限定搜索侧栏：订阅标题与畅聊卡未处于独立容器');
 if(root.querySelector('.geek-info-card'))throw new Error('搜索侧栏范围包含候选人列表，拒绝读取');
 const elements=Array.from(root.querySelectorAll('*')).filter(visible);
 if(elements.length>250)throw new Error('搜索侧栏结构超出250个元素上限：'+elements.length);
 const describe=e=>({tag:e.tagName,className:e.getAttribute('class')??'',text:norm(e.innerText),role:e.getAttribute('role'),href:e.getAttribute('href'),cursor:getComputedStyle(e).cursor,disabled:e.matches(':disabled,[disabled],[aria-disabled="true"]')});
 const text=root.innerText.trim();
 if(!text||text.length>12000)throw new Error('搜索侧栏文字为空或超出12000字符上限：'+text.length);
 const keyword=document.querySelector('.search-input');
 const job=document.querySelector('.search-current-job');
 if(!keyword||!job)throw new Error('搜索条件控件缺失，无法记录读取上下文');
 return {keyword:keyword.value,job:norm(job.textContent),sidebar:{...describe(root),text},elements:elements.map(describe)};
})()`;

export async function runSearchSidebar():Promise<string>{
 return withGuardedReadOnlyPage(page=>{
  const u=new URL(page.url());
  if(u.hostname!=='www.zhipin.com'||u.pathname.replace(/\/+$/,'')!=='/web/chat/search')throw new Error('search-sidebar 仅允许当前常规搜索页；不自动导航：'+page.url());
 },async page=>{
  const url=page.url();
  const frames=page.frames().filter(frame=>{
   const u=new URL(frame.url());
   return u.hostname==='www.zhipin.com'&&u.pathname.replace(/\/+$/,'')==='/web/frame/search';
  });
  if(frames.length!==1)throw new Error('搜索目标 frame 缺失或不唯一：'+frames.length);
  const result=await frames[0]!.evaluate(SEARCH_SIDEBAR_SCRIPT) as Record<string,unknown>;
  if(page.url()!==url)throw new Error('侧栏读取期间主页面发生变化，结果不提交');
  return JSON.stringify({url,readOnly:true,guarded:true,...result});
 });
}
