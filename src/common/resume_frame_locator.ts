import type { ElementHandle, Frame } from 'puppeteer-core';

export class ResumeFrameOpenError extends Error {}

/** The caller supplies the verified host; never enumerate unrelated frames. */
export async function directResumeHandle(host: Frame): Promise<ElementHandle<Element> | null> {
  const handle = await host.evaluateHandle(`(() => {
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>8&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden';};
    const panels=[...document.querySelectorAll('.resume-middle-wrap')].filter(visible);
    if(panels.length>1)throw Error('可见简历面板不唯一：'+panels.length);
    if(!panels.length)return null;
    const frames=[...panels[0].querySelectorAll('iframe[src*="c-resume"]')].filter(visible);
    if(frames.length>1)throw Error('简历面板与iframe关联不唯一');
    return frames[0]||null;
  })()`);
  const element=handle.asElement() as ElementHandle<Element> | null;
  if(!element)await handle.dispose();
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
