import type { ElementHandle, Frame, Page } from 'puppeteer-core';
import { sleepRandom } from '../browser/timing.js';
import { captureResumeByWheel } from './resume_scroll_capture.js';
import { traceResumeCapture } from './resume_capture_trace.js';
import { directResumeHandle } from './resume_frame_locator.js';
import { closeChatResumeByBlankClick } from './resume_chat_close.js';
import { LIVE_RESUME_FRAME_FN, LIVE_RESUME_FRAME_PICK } from './resume_dom_predicates.js';

/** 在线简历 iframe：`src` 常为相对路径 `/web/frame/c-resume/...`，故用子串匹配 */
export const C_RESUME_IFRAME_SELECTOR =
  'iframe[src*="c-resume"], iframe[src*="frame/c-resume"]' as const;

const CLOSE_C_RESUME_PANEL_SCRIPT = `(() => {
  const sel = ${JSON.stringify(C_RESUME_IFRAME_SELECTOR)};
  function hasCResumeIframe(root) {
    return Array.from(root.querySelectorAll('iframe')).some((iframe) => {
      const src = iframe.getAttribute('src') || '';
      return src.includes('c-resume') || src.includes('frame/c-resume');
    });
  }
  const wraps = Array.from(document.querySelectorAll('.dialog-lib-resume, .boss-popup__wrapper, .boss-dialog__wrapper, .dialog-container'));
  for (var wi = 0; wi < wraps.length; wi++) {
    var w = wraps[wi];
    if (hasCResumeIframe(w)) {
      var c =
        w.querySelector('.close-btn') ||
        w.querySelector('.boss-popup__close') ||
        w.querySelector('.boss-dialog__close') ||
        w.querySelector('.drawer-close') ||
        w.querySelector('.icon-close') ||
        w.querySelector('.btn-quxiao');
      if (c) {
        c.click();
        return true;
      }
    }
  }
  var iframe = document.querySelector(sel);
  var node = iframe ? iframe.parentElement : null;
  for (var i = 0; i < 12 && node; i++) {
    var closeBtn = node.querySelector(
      '.close-btn, .boss-popup__close, .boss-dialog__close, .drawer-close, .icon-close, .btn-quxiao',
    );
    if (closeBtn) {
      closeBtn.click();
      return true;
    }
    node = node.parentElement;
  }
  return false;
})()`;

export const C_RESUME_CLOSE_AFTER_CAPTURE_DELAY_MS = { min: 1_000, max: 5_050 } as const;

const VISIBLE_C_RESUME_IN_FRAME_SCRIPT = `(() => {
  const live = ${LIVE_RESUME_FRAME_FN};
  var frames = Array.from(document.querySelectorAll(${JSON.stringify(C_RESUME_IFRAME_SELECTOR)})).filter(live);
  return frames.length > 0;
})()`;

export async function frameHasVisibleCResumeIframe(frame: Frame): Promise<boolean> {
  try {
    return (await frame.evaluate(VISIBLE_C_RESUME_IN_FRAME_SCRIPT)) as boolean;
  } catch {
    return false;
  }
}

/** 截图文件名安全段（在线简历 / 推荐预览共用） */
export function safeResumeScreenshotFileBase(name: string): string {
  const t = name.replace(/[/\\?%*:|"<>]/g, '_').trim().slice(0, 64);
  return t.length > 0 ? t : 'candidate';
}

/** 关闭含 `c-resume` iframe 的弹层（聊天「在线简历」与推荐「预览」共用）。含 `.boss-popup__close`、`.btn-quxiao`（取消）等。会在主文档与各子 frame 中尝试。 */
export async function closeCResumePanel(page: Page): Promise<void> {
  try {
    for (let round = 0; round < 5; round++) {
      let closedAny = false;
      for (const frame of page.frames()) {
        try {
          const closed = (await frame.evaluate(CLOSE_C_RESUME_PANEL_SCRIPT)) as boolean;
          closedAny = closedAny || closed;
        } catch {
          /* detached / 无权限 */
        }
      }
      if (!closedAny) {
        break;
      }
      await sleepRandom(200, 450);
    }
  } catch {
    /* ignore */
  }
}

/**
 * 在任意 frame（含主 frame、`recommendFrame` 等）中查找已挂载且尺寸可见的 c-resume iframe。
 */
export async function findVisibleCResumeIframeHandle(page: Page, host?: Frame): Promise<ElementHandle<Element> | null> {
  if(host)return directResumeHandle(host);
  for (const frame of page.frames()) {
    try {
      if (!(await frameHasVisibleCResumeIframe(frame))) {
        continue;
      }
      // 必须取“活跃弹层内”的 live iframe：残留弹层(deactive)里的 iframe 仍可见，
      // 用 frame.$ 取第一个匹配会量到已关闭弹层的尺寸。
      // 取“真正在展示”的那份 iframe：失败重试会叠加残留弹层，按 DOM 顺序取最后一个通过几何判据的。
      const handle = await frame.evaluateHandle(LIVE_RESUME_FRAME_PICK);
      const h = handle.asElement() as ElementHandle<Element> | null;
      if (!h) { await handle.dispose(); continue; }
      return h;
    } catch {
      /* detached */
    }
  }
  return null;
}

export async function waitForVisibleCResumeIframeReady(
  page: Page,
  timeoutMs = 6_000,
  host?: Frame,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const iframe = await findVisibleCResumeIframeHandle(page,host);
    if (!iframe) {
      await sleepRandom(100, 180);
      continue;
    }
    try {
      const box = await iframe.boundingBox();
      const contentFrame = await iframe.contentFrame();
      if (box && box.width > 8 && box.height > 8) {
        if (!contentFrame) {
          if(host)throw Error('目标简历Frame未就绪');
          return true;
        }
        try {
          const ready = (await contentFrame.evaluate(`(() => {
            const body = document.body;
            const doc = document.documentElement;
            const readyStateOk = document.readyState === "complete" || document.readyState === "interactive";
            const contentHeight = Math.max(body?.scrollHeight || 0, doc?.scrollHeight || 0);
            return readyStateOk && contentHeight > 100;
          })()`)) as boolean;
          if (ready) {
            return true;
          }
        } catch (error) {
          if(host)throw error;
          return true;
        }
      }
    } finally {
      await iframe.dispose();
    }
    await sleepRandom(100, 180);
  }
  return false;
}

/**
 * 保持视口尺寸，滚动到底逐屏截图；调用方显式指定截图后的停留/退出策略。
 */
export async function captureCResumeIframeToFile(
  page: Page,
  absPath: string,
  options: { host?: Frame; afterCapture: 'keep-open' | 'close-chat-blank' },
): Promise<boolean> {
  const {host,afterCapture}=options;
  if (!['keep-open', 'close-chat-blank'].includes(afterCapture)) throw new Error('必须指定截图后的页面处理方式');
  if (!(await waitForVisibleCResumeIframeReady(page, 2_000,host))) throw new Error('在线简历未就绪');
  const iframe = await findVisibleCResumeIframeHandle(page,host);
  if (!iframe) throw new Error('未找到可见在线简历 iframe');
  let captureError: unknown = null;
  try { await captureResumeByWheel(page, iframe, absPath); }
  catch (error) { captureError = error; }
  finally { await iframe.dispose(); }
  if (captureError) {
    // 截图失败同样要关掉弹层：BOSS 关闭后不清 DOM，不关就会在下次查看时再叠一层，
    // 叠加到 3 层以上后残留弹层会被撑大/移出视口，连锁破坏后续所有人的采集。
    try { await closeCResumePanel(page); } catch { /* 关不掉时保留原始错误，交给上层暂停 */ }
    await sleepRandom(200, 500);
    throw captureError;
  }
  if (afterCapture === 'keep-open') return true;
  const started = performance.now();
  traceResumeCapture('close-wait-start', C_RESUME_CLOSE_AFTER_CAPTURE_DELAY_MS);
  await sleepRandom(C_RESUME_CLOSE_AFTER_CAPTURE_DELAY_MS.min, C_RESUME_CLOSE_AFTER_CAPTURE_DELAY_MS.max);
  traceResumeCapture('close-wait-end', { elapsedMs: Math.round(performance.now() - started) });
  traceResumeCapture('close-start');
  let closeError: unknown = null;
  try { await closeChatResumeByBlankClick(page); }
  catch (error) { closeError = error; }
  if (closeError) {
    // 弹层化布局下 iframe 左侧安全空白已不属于弹窗背景，空白点击无法命中；
    // 先按弹层关闭按钮收一次，仍失败才保留原错误。
    await closeCResumePanel(page);
    await sleepRandom(150, 400);
    const stuck = await findVisibleCResumeIframeHandle(page);
    if (stuck) {
      await stuck.dispose();
      throw new Error(`简历截图已保存：${absPath}；退出失败：${closeError instanceof Error ? closeError.message : String(closeError)}`);
    }
  }
  const remaining = await findVisibleCResumeIframeHandle(page,host);
  if (remaining) {
    await remaining.dispose();
    throw new Error(`简历截图已保存：${absPath}，但关闭后在线简历弹层仍可见`);
  }
  traceResumeCapture('close-end', { visiblePanel: false });
  return true;
}
