import type { ElementHandle, Frame } from 'puppeteer-core';
import { VISIBLE_BOX_FN, LIVE_RESUME_FRAME_FN } from './resume_dom_predicates.js';

export class ResumeFrameOpenError extends Error {}

/** 只读诊断：BOSS_CLI_TRACE 时输出面板/iframe 的几何事实，帮助判断 live 判据为何不通过。 */
const DIAG_SCRIPT = `(() => {
  const sel='iframe[src*="c-resume"]';
  const box=e=>{const r=e.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),left:Math.round(r.left)};};
  const dialogOf=e=>e.closest('.boss-popup__wrapper, .boss-dialog__wrapper, [class*="resume-common-dia"], .dialog-wrap');
  const panels=[...document.querySelectorAll('.resume-middle-wrap')].map(e=>{
    const d=dialogOf(e);return {box:box(e),dialog:d?box(d):null,vh:window.innerHeight,
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
    if(panels.length>1)throw Error('可见简历面板不唯一：'+panels.length);
    if(!panels.length)return null;
    const frames=[...panels[0].querySelectorAll('iframe[src*="c-resume"]')].filter(isResumeFrame);
    if(frames.length>1)throw Error('简历面板与iframe关联不唯一');
    return frames[frames.length-1]||null;  })()`);
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
