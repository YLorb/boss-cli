import type { Page } from 'puppeteer-core';

function blankPointScript(point: {x:number;y:number} | null): string {
  return `(() => {
    if (location.hostname !== 'www.zhipin.com' || location.pathname !== '/web/chat/index') throw Error('收集简历退出要求仍在沟通页');
    const visible = el => el instanceof HTMLElement && el.getClientRects().length>0 && getComputedStyle(el).visibility!=='hidden';
    const one = selector => {
      const nodes=[...document.querySelectorAll(selector)].filter(visible);
      if(nodes.length!==1) throw Error('简历退出定位不唯一：'+selector);
      return nodes[0];
    };
    const iframe=one('iframe[src*="c-resume"]');
    const sidebar=one('.menu-list'), list=one('.chat-user');
    const a=sidebar.getBoundingClientRect(), b=list.getBoundingClientRect(), c=iframe.getBoundingClientRect();
    const rect={left:Math.max(0,a.right)+12,right:Math.min(innerWidth,b.left,c.left)-12,
      top:Math.max(0,b.top,c.top)+12,bottom:Math.min(innerHeight,b.bottom,c.bottom)-12};
    if(rect.right-rect.left<8 || rect.bottom-rect.top<8) throw Error('简历左侧安全空白区域不足');
    const point=${JSON.stringify(point)} ?? {x:rect.left+Math.random()*(rect.right-rect.left),y:rect.top+Math.random()*(rect.bottom-rect.top)};
    if(point.x<rect.left || point.x>rect.right || point.y<rect.top || point.y>rect.bottom) throw Error('简历退出前布局已变化');
    const hit=document.elementFromPoint(point.x,point.y);
    if(!hit || hit===document.body || hit===document.documentElement || !hit.contains(iframe) || hit.contains(sidebar) ||
      hit.closest('a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable],.geek-item'))
      throw Error('简历空白点击点未命中当前简历背景');
    const draft=document.querySelector('#boss-chat-editor-input');
    if((draft?.textContent||'').trim()) throw Error('存在未发送草稿，停止退出简历');
    const selected=[...document.querySelectorAll('.geek-item.selected')].map(el=>el.getAttribute('data-id'));
    if(selected.length!==1 || !selected[0]) throw Error('当前收集会话身份不唯一');
    return {...point,rect,selected,src:iframe.getAttribute('src'),job:document.querySelector('.chat-top-job .ui-dropmenu-label')?.textContent?.trim()};
  })()`;
}

/** Single background click after a successful chat resume capture. No retry. */
export async function closeChatResumeByBlankClick(page: Page): Promise<void> {
  const url=page.url();
  const point=await page.evaluate(blankPointScript(null)) as {x:number;y:number;selected:string[];job:string};
  await page.mouse.move(point.x,point.y);
  const checked=await page.evaluate(blankPointScript({x:point.x,y:point.y}));
  if(page.url()!==url || JSON.stringify(checked)!==JSON.stringify(point)) throw Error('简历退出前身份或页面已变化');
  await page.mouse.click(point.x,point.y);
  await page.waitForFunction(`![...document.querySelectorAll('iframe[src*="c-resume"]')].some(el=>el.getClientRects().length>0 && getComputedStyle(el).visibility!=='hidden')`,{timeout:5000})
    .catch(error=>{throw Error('已点击一次简历左侧空白，但未确认退出：'+error.message);});
  const after=await page.evaluate(`JSON.stringify({selected:[...document.querySelectorAll('.geek-item.selected')].map(el=>el.getAttribute('data-id')),job:document.querySelector('.chat-top-job .ui-dropmenu-label')?.textContent?.trim()})`);
  if(page.url()!==url || after!==JSON.stringify({selected:point.selected,job:point.job})) throw Error('退出简历后页面、会话或岗位已变化');
}
