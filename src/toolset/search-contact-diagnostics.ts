import type { Page } from 'puppeteer-core';

/** Bounded read-only evidence on failed checks; never used to bypass identity verification. */
export async function inspectSearchContactFrames(page: Page, target: string) {
  const frames = page.frames();
  return Promise.all(frames.map(async (frame, index) => {
    const context = { index, parent: frames.indexOf(frame.parentFrame()!),
      framePath: frame.url().split('?')[0], name: frame.name() };
    try {
      const state = await frame.evaluate(`(() => {
        const norm = v => (v || '').replace(/\\s+/g,' ').trim();
        const visible = el => { const r=el.getBoundingClientRect(),s=getComputedStyle(el);
          return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden' && Number(s.opacity)>0; };
        const buttons=Array.from(document.querySelectorAll('button')).filter(el=>visible(el) &&
          /^(立即沟通|打招呼|继续沟通)(?:[（(].*[）)])?$/.test(norm(el.textContent)));
        return {readyState:document.readyState,documentPath:location.pathname,
          candidateMatches:Array.from(document.querySelectorAll('.name-label')).filter(el=>norm(el.textContent)===${JSON.stringify(target)}).length,
          canvasCount:document.querySelectorAll('canvas#resume').length,
          visibleDialogs:Array.from(document.querySelectorAll('.boss-popup__wrapper,.boss-dialog__wrapper'))
            .filter(visible).slice(0,5).map(el=>({className:el.className})),
          contactNodes:buttons.slice(0,8).map(el=>({className:el.className,text:norm(el.textContent),parentClass:el.parentElement?.className}))};
      })()`);
      return { ...context, state };
    } catch (error) {
      return { ...context, inspectionError: error instanceof Error ? error.message : String(error) };
    }
  }));
}
