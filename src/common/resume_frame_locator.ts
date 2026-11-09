import type { ElementHandle, Frame } from 'puppeteer-core';
import { VISIBLE_BOX_FN, LIVE_RESUME_FRAME_FN } from './resume_dom_predicates.js';

export class ResumeFrameOpenError extends Error {}

/** 只读诊断：BOSS_CLI_TRACE 时输出面板/iframe 的几何事实，帮助判断 live 判据为何不通过。 */
const DIAG_SCRIPT = `(() => {
  const sel='iframe[src*="c-resume"]';
  const box=e=>{const r=e.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),left:Math.round(r.left)};};
  const dialogOf=e=>e.closest('.boss-popup__wrapper, .boss-dialog__wrapper, [class*="resume-common-dia"], .dialog-wrap');
  const panels=[...document.querySelectorAll('.resume-middle-wrap')].map(e=>{
    const d=dialogOf(e);const layer=e.closest('.dialog-wrap');
    return {box:box(e),dialog:d?box(d):null,layer:layer?layer.className:null,vh:window.innerHeight,
      display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility,cls:e.className};});
  const frames=[...document.querySelectorAll(sel)].map(e=>{const d=dialogOf(e);return {box:box(e),dialog:d?box(d):null,src:(e.getAttribute('src')||'').slice(0,40)};});
  return JSON.stringify({panels,frames});})()`;

async function traceDiag(host: Frame): Promise<void> {
  if (!process.env.BOSS_CLI_TRACE) return;
  try {
    const raw = (await host.evaluate(DIAG_SCRIPT)) as string;
    process.stderr.write(`[frame-diag] ${raw}\n`);
  } catch (error) {
    process.stderr.write(`[frame-diag] failed ${String(error)}\n`);
  }
}

/** The caller supplies the verified host; never enumerate unrelated frames. */
export async function directResumeHandle(host: Frame): Promise<ElementHandle<Element> | null> {
  const handle = await host.evaluateHandle(`(() => {
    const visible=${VISIBLE_BOX_FN};
    const isResumeFrame=${LIVE_RESUME_FRAME_FN};
    const panels=[...document.querySelectorAll('.resume-middle-wrap')].filter(visible);
    if(!panels.length)return null;
    // 只有「面板里真的挂着可见简历 iframe」才算候选：失败残留下来的空面板不能参与判定，
    // 否则一次打开失败就会让后续每一次 preview 都误报「面板不唯一」。
    const live=[];
    for(const panel of panels){
      const frames=[...panel.querySelectorAll('iframe[src*="c-resume"]')].filter(isResumeFrame);
      if(frames.length)live.push({panel,frame:frames[frames.length-1]});
    }
    if(!live.length)return null;
    if(live.length>1){
      // 叠层时只有最上层弹窗是 active，其余是历史失败留下的 deactive 层；
      // 两者的几何完全一致，只能靠所属 .dialog-wrap 的层级状态区分。
      const active=live.filter(x=>{
        const layer=x.panel.closest('.dialog-wrap');
        return layer&&layer.classList.contains('active')&&!layer.classList.contains('deactive');
      });
      if(active.length===1)return active[0].frame;
      throw Error('在线简历面板不唯一（同时存在 '+live.length+' 份可见简历），停止操作以免截错人');
    }
    return live[0].frame;  })()`);
  const element=handle.asElement() as ElementHandle<Element> | null;
  if(!element){await handle.dispose();await traceDiag(host);}
  return element;
}

export async function directResumeFrame(host: Frame): Promise<Frame | null> {
  const handle=await directResumeHandle(host);
  if(!handle)return null;
  try {
    const frame=await handle.contentFrame();
    if(!frame || frame.detached)throw new ResumeFrameOpenError('目标简历Frame尚未就绪或已失效');
    if(frame.parentFrame()!==host)throw Error('目标简历Frame不属于已核验宿主');
    return frame;
  } catch(error) {
    if(error instanceof Error && /detached Frame|frame got detached/i.test(error.message))
      throw new ResumeFrameOpenError(`目标Frame定位失败：${error.message}`,{cause:error});
    throw error;
  } finally {await handle.dispose();}
}
