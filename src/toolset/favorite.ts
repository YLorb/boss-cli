import type { Frame, Page } from 'puppeteer-core';
import { withBossSessionPage } from '../common/boss_session_page.js';

type FavoriteContext = { candidateId: string; pageUrl: string; hostUrl: string; recommend: boolean };
type FavoriteReceipt = { status: string; clicked: boolean; favorited: boolean; busy: boolean; identityVerified: true; candidateId: string; rect: {x:number;y:number;width:number;height:number} };

/** One known resume toolbar; no selector fallback, component method or API request. */
function favoriteScript(context: FavoriteContext, click: boolean): string {
  return `(() => {
    const expected=${JSON.stringify(context)};
    if(location.href!==expected.hostUrl||top.location.href!==expected.pageUrl)throw Error('收藏期间页面导航，停止');
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
    const unique=(selector,root)=>{const nodes=[...root.querySelectorAll(selector)].filter(visible);if(nodes.length!==1)throw Error('收藏控件范围不唯一：'+selector+' count='+nodes.length);return nodes[0];};
    if(expected.recommend&&[...top.document.querySelectorAll('.resume-middle-wrap')].some(visible))throw Error('推荐页主文档出现非预期简历面板');
    const panel=unique('.resume-middle-wrap',document),box=unique('.resume-right-side .resume-simple-box',panel);
    const resumeFrame=unique('iframe[src*="c-resume"]',panel),resumeUrl=new URL(resumeFrame.src);
    if(resumeUrl.origin!=='https://www.zhipin.com'||!resumeUrl.pathname.startsWith('/web/frame/c-resume/'))throw Error('简历 iframe 来源不符');
    const vm=box.__vue__,props=vm?.$props;
    const card=props?.[expected.recommend?'dataSource':'geekInfo'],resume=props?.[expected.recommend?'personInfo':'resumeInfo'];
    if(card?.encryptGeekId!==expected.candidateId||resume?.encryptGeekId!==expected.candidateId)throw Error('收藏候选人双 ID 核验失败');
    const button=unique('.operation-button-list .like-icon-and-text',box);
    const label=unique('.btn-text',button).textContent.trim(),icon=unique('.like-icon',button);
    const component=vm.alreadyInterested;
    if(![0,1,false,true].includes(component))throw Error('收藏组件状态缺失或未知');
    const favorited=component===1||component===true;
    if(label!==(favorited?'已收藏':'收藏')||icon.classList.contains('like-icon-active')!==favorited)throw Error('收藏文案、图标与组件状态不一致');
    // ResumeSimple receives the handler as a prop; ResumeRoot owns its loading state.
    const handler=props.handleInterested,owners=[],seen=new Set();
    if(typeof handler!=='function')throw Error('收藏处理函数关联缺失');
    for(let owner=vm.$parent;owner;owner=owner.$parent){
      if(seen.has(owner))throw Error('收藏组件父级关联循环');
      seen.add(owner);
      if(owner.$options?.name==='ResumeRoot'&&owner.handleInterested===handler)owners.push(owner);
    }
    if(owners.length!==1)throw Error('收藏请求组件关联不唯一：count='+owners.length);
    const owner=owners[0];
    if(owner.resumeInfo?.encryptGeekId!==expected.candidateId)throw Error('收藏请求组件候选人 ID 不符');
    if(typeof owner.isLikeLoading!=='boolean')throw Error('收藏请求状态缺失或未知：component=ResumeRoot type='+typeof owner.isLikeLoading);
    const busy=owner.isLikeLoading,r=button.getBoundingClientRect();
    const result={status:favorited?'already-favorited':'not-favorited',clicked:false,favorited,busy,identityVerified:true,candidateId:expected.candidateId,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
    if(!${JSON.stringify(click)})return result;
    if(busy)throw Error('收藏请求正在进行，未点击');
    // A second invocation must never toggle an existing favorite off.
    if(favorited)return result;
    if(button.matches(':disabled,[disabled],[aria-disabled="true"]')||/disabled|forbid|ban/i.test(button.className)||getComputedStyle(button).pointerEvents==='none')throw Error('收藏按钮不可用，未点击');
    const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
    if(x<0||y<0||x>=innerWidth||y>=innerHeight||!hit||(hit!==button&&!button.contains(hit)))throw Error('收藏按钮在视口外或被遮挡，未点击');
    if(expected.recommend){
      const frame=window.frameElement,fr=frame?.getBoundingClientRect();
      if(!frame||!fr)throw Error('推荐 iframe 关联缺失，未点击');
      const sx=fr.left+frame.clientLeft+x,sy=fr.top+frame.clientTop+y;
      if(sx<0||sy<0||sx>=top.innerWidth||sy>=top.innerHeight||top.document.elementFromPoint(sx,sy)!==frame)throw Error('推荐 iframe 被遮挡或在视口外，未点击');
    }
    button.click();return {...result,status:'favorite-clicked',clicked:true};
  })()`;
}

/** Explicit, current-resume-only favorite operation. Never unfavorites or opens a resume. */
export async function favoriteResume(candidateId: string, check = false): Promise<string> {
  if(!candidateId.trim())throw Error('favorite 必须提供当前简历 candidate-id');
  return withBossSessionPage(async page=>{
    const pageUrl=page.url(),url=new URL(pageUrl);
    if(url.origin!=='https://www.zhipin.com'||!['/web/chat/search','/web/chat/recommend'].includes(url.pathname))throw Error('favorite 仅支持当前搜索／推荐页已打开的简历，不自动导航');
    const recommend=url.pathname==='/web/chat/recommend';
    let host: Page|Frame=page;
    if(recommend){
      const elements=await page.$$('iframe[name="recommendFrame"]');
      if(elements.length!==1)throw Error('推荐 iframe 缺失或不唯一');
      const frame=await elements[0]!.contentFrame();
      if(!frame||frame.parentFrame()!==page.mainFrame())throw Error('推荐 iframe 父页面关联不符');
      const frameUrl=new URL(frame.url());
      if(frameUrl.origin!==url.origin||frameUrl.pathname.replace(/\/+$/,'')!=='/web/frame/recommend')throw Error('推荐 iframe 来源不符');
      host=frame;
    }
    const context={candidateId:candidateId.trim(),pageUrl,hostUrl:host.url(),recommend};
    let navigated=false,stage='precheck',clicked=false;
    const onNavigation=(frame:Frame)=>{if(frame===page.mainFrame()||frame===host)navigated=true;};
    const guard=()=>{if(navigated||page.url()!==pageUrl||host.url()!==context.hostUrl)throw Error('收藏期间页面导航，停止');};
    page.on('framenavigated',onNavigation);
    try {
      guard();
      stage=check?'check':'atomic-check-and-click';
      const result=await host.evaluate(favoriteScript(context,!check)) as FavoriteReceipt;
      clicked=result.clicked;
      guard();
      if(check||!clicked)return JSON.stringify({...result,checkOnly:check,page:recommend?'recommend':'search',coordinateSpace:recommend?'recommend-frame':'main-document'});
      stage='confirm';
      const handle=await host.waitForFunction(`(() => {
        try {const result=${favoriteScript(context,false)};return result.favorited&&!result.busy?result:false;}
        catch(error){return {error:error.message};}
      })()`,{timeout:5000});
      try {const result=await handle.jsonValue() as FavoriteReceipt&{error?:string};if(result.error)throw Error(result.error);}
      finally {await handle.dispose();}
      guard();
      const after=await host.evaluate(favoriteScript(context,false)) as FavoriteReceipt;
      guard();
      if(!after.favorited||after.busy)throw Error('收藏确认后状态变化');
      return JSON.stringify({...after,status:'favorited',clicked:true,checkOnly:false,page:recommend?'recommend':'search',coordinateSpace:recommend?'recommend-frame':'main-document'});
    }catch(error){
      throw Error(`收藏失败 candidateId=${context.candidateId} stage=${stage} clicked=${clicked}；${error instanceof Error?error.message:String(error)}；原子点击阶段异常时动作可能未确认，不自动重试、不取消收藏`);
    }finally{page.off('framenavigated',onNavigation);}
  },{ensureChatShell:false,ensureMenuList:false});
}
