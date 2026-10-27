import type { ElementHandle, Page } from 'puppeteer-core';
import { PNG } from 'pngjs';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { traceResumeCapture } from './resume_capture_trace.js';

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const MAX_PIXELS = 80_000_000;

/** One reading pause after opening the resume, before any capture scrolling. */
export function resumeReadingDelayMs(random = Math.random): number {
  return 2_000 + Math.floor(random() * 8_001);
}

/** Reading interval between complete scroll segments, not between wheel pulses. */
export function resumeScrollIntervalMs(random = Math.random): number {
  return 500 + Math.floor(random() * 2_501);
}

// One scroll surface only. Ambiguous/nested scrolling must be diagnosed, not guessed.
export const RESUME_SCROLL_ROOT_SCRIPT = `(() => {
  const doc = document.scrollingElement;
  const roots = Array.from(document.querySelectorAll('*')).filter(el => {
    if (el === doc) return false;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return s.visibility !== 'hidden' && r.width > 100 && r.height > 100 && el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(s.overflowY);
  });
  if (doc.scrollHeight > doc.clientHeight + 1) roots.push(doc);
  if (roots.length > 1) throw new Error('在线简历存在多个滚动容器，无法确认完整截图范围');
  return roots.length === 1 ? roots[0] : doc;
})()`;

export const RESUME_SCROLL_METRICS_SCRIPT = `((el, sourceUrl) => {
  const source = new URL(sourceUrl);
  const warnOnFixedOverlay = source.origin === 'https://www.zhipin.com' &&
    ['/web/chat/recommend', '/web/chat/search'].includes(source.pathname.replace(/\\/+$/, ''));
  const obstructionMessages = [];
  if (!el.isConnected) throw new Error('在线简历滚动容器已被替换');
  const documentRoot = el === document.scrollingElement;
  const r = el.getBoundingClientRect();
  const x = documentRoot ? 0 : r.x + el.clientLeft;
  const y = documentRoot ? 0 : r.y + el.clientTop;
  const width = el.clientWidth, height = el.clientHeight;
  if (el.scrollWidth > width + 1) throw new Error('在线简历存在横向溢出，无法确认完整截图');
  if (x < 0 || y < 0 || x + width > innerWidth + 1 || y + height > innerHeight + 1)
    throw new Error('在线简历滚动区域未完整显示在 iframe 内');
  for (const node of document.querySelectorAll('*')) {
    if (node === el || node.contains(el)) continue;
    const s = getComputedStyle(node);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    const b = node.getBoundingClientRect();
    if (s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0 && b.width > 0 && b.height > 0 &&
        b.right > x && b.left < x + width && b.bottom > y && b.top < y + height) {
      const hit = document.elementFromPoint((Math.max(x,b.left)+Math.min(x+width,b.right))/2,
        (Math.max(y,b.top)+Math.min(y+height,b.bottom))/2);
      if (hit && (node === hit || node.contains(hit))) {
        const detail = 'element=' + node.tagName + '.' + node.className + '；position=' + s.position + '；rect=' + JSON.stringify({x:b.x,y:b.y,width:b.width,height:b.height});
        if (!warnOnFixedOverlay) throw new Error('在线简历有固定/吸顶元素遮挡截图区域，停止拼接；' + detail);
        obstructionMessages.push(detail);
      }
    }
  }
  return { x, y, width, height, top: el.scrollTop, total: el.scrollHeight, obstructionMessages };
})`;

type Metrics = { x: number; y: number; width: number; height: number; top: number; total: number };
export type ResumeTile = { top: number; image: PNG };

/** Randomized acceleration/deceleration, with an exact total wheel distance. */
export function wheelDeltas(distance: number, random = Math.random): number[] {
  const count = 10 + Math.floor(random() * 7);
  const weights = Array.from({ length: count }, (_, i) =>
    Math.sin(Math.PI * (i + 1) / (count + 1)) * (0.85 + random() * 0.3));
  const sum = weights.reduce((a, b) => a + b, 0);
  const deltas = weights.map(w => distance * w / sum);
  deltas[count - 1] += distance - deltas.reduce((a, b) => a + b, 0);
  return deltas;
}

/** Verify overlapping pixels before removing duplicates; never silently bridge a gap. */
export function stitchResumeTiles(tiles: ResumeTile[], cssWidth: number, cssHeight: number, total: number, scale: number): Buffer {
  if (!tiles.length || Math.abs(tiles[0].top) > 0.5) throw new Error('简历截图缺少顶部');
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('简历截图像素缩放比例无效');
  const width = tiles[0].image.width;
  if (Math.abs(width - cssWidth * scale) > 1) throw new Error('简历截图宽度与实际像素缩放不一致');
  const last = tiles[tiles.length - 1];
  if (Math.abs(last.top + cssHeight - total) > 1) throw new Error('简历截图未覆盖到底部');
  // clientHeight/scrollHeight are integer CSS pixels. Use the measured final tile
  // extent once the bottom is verified, rather than inventing a rounded extra row.
  const height = Math.round(last.top * scale) + last.image.height;
  if (width * height > MAX_PIXELS) throw new Error('简历截图超过像素上限');
  const output = new PNG({ width, height });
  let covered = 0;
  for (const { top, image } of tiles) {
    const start = Math.round(top * scale);
    if (image.width !== width || Math.abs(image.height - cssHeight * scale) > 1)
      throw new Error('简历截图尺寸在滚动过程中发生变化');
    if (start > covered || (covered && start + image.height <= covered))
      throw new Error(`简历截图存在缺口或滚动未前进：top=${top}, start=${start}, covered=${covered}, tileHeight=${image.height}, scale=${scale}`);
    const overlap = covered - start;
    if (covered && overlap < Math.min(32, image.height / 4)) throw new Error('简历截图重叠区域不足');
    if (overlap > 0) {
      let different = 0, samples = 0;
      // Compare 5x5 area averages: fractional DPR scrolling changes text antialiasing
      // even at the correct physical-pixel offset. Retain positional/content checks.
      let absoluteDifference = 0;
      for (let y = 3; y + 5 < overlap - 3; y += 5) for (let x = 3; x + 5 < width - 3; x += 5) {
        for (let c = 0; c < 3; c++) {
          let a = 0, b = 0;
          for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) {
            a += output.data[((start + y + dy) * width + x + dx) * 4 + c];
            b += image.data[((y + dy) * width + x + dx) * 4 + c];
          }
          const difference = Math.abs(a - b) / 25;
          samples++; absoluteDifference += difference; if (difference > 20) different++;
        }
      }
      traceResumeCapture('overlap', { top, start, overlap, scale, differentRatio: different / samples, meanDifference: absoluteDifference / samples });
      if (samples && (different / samples > 0.015 || absoluteDifference / samples > 2)) throw new Error(`简历截图重叠校验失败：内容变化、遮挡或位置不一致；top=${top}；scale=${scale}；differentRatio=${different / samples}；meanDifference=${absoluteDifference / samples}`);
    }
    const end = Math.min(height, start + image.height);
    image.data.copy(output.data, covered * width * 4, overlap * width * 4, (end - start) * width * 4);
    covered = end;
  }
  if (covered !== height) throw new Error('简历截图未覆盖到底部');
  return PNG.sync.write(output);
}

/** Retain the iframe header/footer and surrounding information once, outside the scrolling body. */
export function composeResumeFrame(shell: PNG, body: PNG, x: number, y: number, visibleHeight: number): Buffer {
  const extra = body.height - visibleHeight;
  if (extra < 0 || x < 0 || y < 0 || x + body.width > shell.width || y + visibleHeight > shell.height)
    throw new Error('简历拼接区域与 iframe 尺寸不一致');
  const height = shell.height + extra;
  if (shell.width * height > MAX_PIXELS) throw new Error('完整简历截图超过像素上限');
  const output = new PNG({ width: shell.width, height });
  output.data.fill(255);
  const bottom = y + visibleHeight;
  PNG.bitblt(shell, output, 0, 0, shell.width, bottom, 0, 0);
  if (bottom < shell.height) PNG.bitblt(shell, output, 0, bottom, shell.width, shell.height - bottom, 0, bottom + extra);
  PNG.bitblt(body, output, 0, 0, body.width, body.height, x, y);
  return PNG.sync.write(output);
}

/** Capture only the current viewport; crop locally without a browser clip override. */
export async function captureVisibleRegion(page: Page, clip: { x: number; y: number; width: number; height: number }, scale: number): Promise<PNG> {
  const viewport = await page.evaluate('({width:innerWidth,height:innerHeight,x:scrollX,y:scrollY,scale:devicePixelRatio})') as {width:number;height:number;x:number;y:number;scale:number};
  if (viewport.scale !== scale) throw new Error('截图期间像素缩放发生变化');
  const image = PNG.sync.read(Buffer.from(await page.screenshot({ type: 'png', fullPage: false, captureBeyondViewport: false })));
  const x = Math.round((clip.x - viewport.x) * scale), y = Math.round((clip.y - viewport.y) * scale);
  const width = Math.round(clip.width * scale), height = Math.round(clip.height * scale);
  if (Math.abs(image.width - viewport.width * scale) > 1 || Math.abs(image.height - viewport.height * scale) > 1 ||
      x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > image.width || y + height > image.height)
    throw new Error('当前视口截图尺寸或裁剪边界异常');
  const after = await page.evaluate('({width:innerWidth,height:innerHeight,x:scrollX,y:scrollY,scale:devicePixelRatio})');
  if (JSON.stringify(viewport) !== JSON.stringify(after)) throw new Error('截图期间主页面视口或滚动位置变化');
  const cropped = new PNG({ width, height });
  PNG.bitblt(image, cropped, x, y, width, height, 0, 0);
  return cropped;
}

export async function captureResumeByWheel(page: Page, iframe: ElementHandle<Element>, path: string): Promise<void> {
  const frame = await iframe.contentFrame();
  if (!frame) throw new Error('无法读取在线简历 iframe 的滚动信息');
  // BOSS may size c-resume to its content and scroll its parent dialog instead.
  // Select the actual scroll surface before capture; never retry with a different mechanism.
  const parentFrame = iframe.frame;
  const key = JSON.stringify('__bossResumeCapture_' + randomUUID().replaceAll('-', ''));
  const iframeScript = `(() => {
    const items = Array.from(document.querySelectorAll('iframe[src*="c-resume"]')).filter(el => {
      const r = el.getBoundingClientRect(); return r.width > 8 && r.height > 8;
    });
    if (items.length !== 1) throw new Error('可见在线简历 iframe 数量异常');
    return items[0];
  })()`;
  const outerHandle = await parentFrame.evaluateHandle(`globalThis[${key}] = ((el) => {
    const roots = [];
    for (let node = el.parentElement; node; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (/auto|scroll/.test(s.overflowY) && node.scrollHeight > node.clientHeight + 1) roots.push(node);
    }
    if (roots.length > 1) throw new Error('在线简历外层有多个滚动容器');
    return roots.length === 1 ? roots[0] : null;
  })(${iframeScript})`);
  const outer = outerHandle.asElement() as ElementHandle<Element> | null;
  if (!outer) { await outerHandle.dispose(); await parentFrame.evaluate(`delete globalThis[${key}]`); }
  const rootFrame = outer ? parentFrame : frame;
  const rootHandle = outer ? outerHandle : await frame.evaluateHandle(`globalThis[${key}] = ${RESUME_SCROLL_ROOT_SCRIPT}`);
  const root = rootHandle.asElement() as ElementHandle<Element> | null;
  if (!root) { await rootHandle.dispose(); throw new Error('未找到在线简历滚动容器'); }
  const reportedObstructions = new Set<string>();
  const read = async (): Promise<Metrics> => {
    const sourceUrl = page.url();
    const { obstructionMessages, ...metrics } = await rootFrame.evaluate(
      `${RESUME_SCROLL_METRICS_SCRIPT}(globalThis[${key}], ${JSON.stringify(sourceUrl)})`,
    ) as Metrics & { obstructionMessages: string[] };
    for (const detail of obstructionMessages) {
      if (reportedObstructions.has(detail)) continue;
      reportedObstructions.add(detail);
      // Warnings remain visible even without tracing, and never contaminate JSON stdout.
      console.error('[boss-cli][resume] 在线简历检测到固定/吸顶元素，继续截图并保留完整性校验；page=' + new URL(sourceUrl).pathname + '；' + detail);
    }
    return metrics;
  };
  let original: Metrics | undefined;
  let initialBox: { x: number; y: number; width: number; height: number } | undefined;
  const stable = async (): Promise<Metrics> => {
    let previous = await read(), unchanged = 0;
    for (let i = 0; i < 30; i++) {
      await pause(100);
      const current = await read();
      unchanged = JSON.stringify(current) === JSON.stringify(previous) ? unchanged + 1 : 0;
      if (unchanged >= 3) return current;
      previous = current;
    }
    throw new Error('在线简历滚动或布局持续变化，未能稳定');
  };
  const geometry = async (m: Metrics) => {
    const box = await (outer ? root : iframe).boundingBox();
    if (!box) throw new Error('在线简历 iframe 不可见');
    const border = await (outer ? rootFrame : parentFrame).evaluate(`((el) => ({ x: el.clientLeft, y: el.clientTop }))(${outer ? `globalThis[${key}]` : iframeScript})`) as { x: number; y: number };
    const clip = { x: box.x + border.x + (outer ? 0 : m.x), y: box.y + border.y + (outer ? 0 : m.y), width: m.width, height: m.height };
    const viewport = await page.evaluate('({ width: innerWidth, height: innerHeight, x: scrollX, y: scrollY })') as { width: number; height: number; x: number; y: number };
    if (viewport.x || viewport.y || clip.x < 0 || clip.y < 0 || clip.x + clip.width > viewport.width || clip.y + clip.height > viewport.height)
      throw new Error('在线简历截图区域超出当前视口，请调整窗口后重试');
    if (initialBox && JSON.stringify(initialBox) !== JSON.stringify(clip)) throw new Error('在线简历截图区域位置或尺寸发生变化');
    initialBox = clip;
    return clip;
  };
  const wheel = async (distance: number, m: Metrics) => {
    const clip = await geometry(m);
    await page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2);
    for (const deltaY of wheelDeltas(distance)) {
      await page.mouse.wheel({ deltaY });
      await pause(16 + Math.floor(Math.random() * 17));
    }
    return stable();
  };
  let hasScrolled = false;
  const scrollSegment = async (distance: number, m: Metrics) => {
    if (hasScrolled) {
      const waitMs = resumeScrollIntervalMs(), started = performance.now();
      traceResumeCapture('segment-wait-start', { waitMs });
      await pause(waitMs);
      traceResumeCapture('segment-wait-end', { elapsedMs: Math.round(performance.now() - started) });
    }
    hasScrolled = true;
    traceResumeCapture('segment-start', { top: m.top, distance });
    const result = await wheel(distance, m);
    traceResumeCapture('segment-end', { top: result.top });
    return result;
  };
  const moveTo = async (target: number) => {
    let m = await stable();
    for (let i = 0; Math.abs(m.top - target) > 0.5 && i < 100; i++) {
      const before = m.top;
      m = await scrollSegment(Math.sign(target - m.top) * Math.min(Math.abs(target - m.top), m.height * 0.65), m);
      if (Math.abs(m.top - before) < 0.5) throw new Error(`在线简历滚轮无响应：当前位置=${m.top}，目标=${target}`);
    }
    if (Math.abs(m.top - target) > 0.5) throw new Error(`在线简历未滚动至目标位置：${target}`);
    return m;
  };
  let failure: unknown;
  let result: Buffer | undefined;
  try {
    const waitMs = resumeReadingDelayMs(), started = performance.now();
    traceResumeCapture('reading-wait-start', { waitMs, scrollSurface: outer ? 'outer' : 'iframe' });
    await pause(waitMs);
    traceResumeCapture('reading-wait-end', { elapsedMs: Math.round(performance.now() - started) });
    // Do not classify an opening/loading overlay as a capture obstruction before
    // the promised initial reading pause. Persistent obstructions still fail.
    original = await stable();
    let m = await moveTo(0);
    const bodyClip = await geometry(m);
    const frameBox = await iframe.boundingBox();
    if (!frameBox) throw new Error('在线简历 iframe 不可见');
    if (outer) {
      const inner = await frame.evaluate('({height:innerHeight, width:innerWidth, total:document.scrollingElement.scrollHeight})') as {height:number;width:number;total:number};
      if (inner.total > inner.height + 1 || Math.abs(frameBox.x - bodyClip.x) > 1 || Math.abs(frameBox.y - bodyClip.y) > 1 ||
          Math.abs(frameBox.width - bodyClip.width) > 1 || Math.abs(frameBox.height - m.total) > 1)
        throw new Error('在线简历外层滚动区域与完整 iframe 边界不一致');
    }
    const viewport = await page.evaluate('({ width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio })') as { width: number; height: number; pixelRatio: number };
    if (!outer && (frameBox.x < 0 || frameBox.y < 0 || frameBox.x + frameBox.width > viewport.width || frameBox.y + frameBox.height > viewport.height))
      throw new Error('在线简历 iframe 未完整显示，无法保留顶部和底部信息');
    const shellBox = outer ? bodyClip : frameBox;
    const scale = viewport.pixelRatio;
    const shell = await captureVisibleRegion(page, shellBox, scale);
    if (!Number.isFinite(scale) || scale <= 0 || Math.abs(shell.width - shellBox.width * scale) > 1 || Math.abs(shell.height - shellBox.height * scale) > 1)
      throw new Error('简历截图尺寸与浏览器像素缩放不一致');
    traceResumeCapture('pixel-scale', { scale, cssWidth: shellBox.width, imageWidth: shell.width });
    const insetX = Math.round((bodyClip.x - shellBox.x) * scale), insetY = Math.round((bodyClip.y - shellBox.y) * scale);
    const tiles: ResumeTile[] = [];
    let complete = false, pixels = 0;
    for (let i = 0; i < 100; i++) {
      const clip = await geometry(m);
      const image = outer && i === 0 ? shell : await captureVisibleRegion(page, clip, scale);
      const after = await read();
      if (JSON.stringify(m) !== JSON.stringify(after)) throw new Error('截图期间在线简历发生滚动或布局变化');
      pixels += image.width * image.height;
      if (pixels > MAX_PIXELS) throw new Error('简历分屏截图超过像素预算');
      tiles.push({ top: m.top, image });
      traceResumeCapture('tile', { index: i, top: m.top, height: m.height, total: m.total });
      if (Math.abs(m.top + m.height - m.total) <= 1) {
        await pause(750);
        const bottom = await stable();
        if (JSON.stringify(bottom) === JSON.stringify(m)) { complete = true; break; }
        throw new Error('到达底部后简历内容仍在变化，请待加载完成后重试');
      }
      const before = m;
      m = await scrollSegment(Math.min(m.height * 0.65, m.total - m.height - m.top), m);
      if (m.top <= before.top + 0.5) throw new Error('在线简历滚轮无响应，停止截图');
      if (m.total !== before.total) throw new Error('简历高度在滚动时变化，请待加载完成后重试');
    }
    if (!complete) throw new Error('在线简历超过 100 屏，未确认到底，停止截图');
    const body = PNG.sync.read(stitchResumeTiles(tiles, m.width, m.height, m.total, scale));
    result = composeResumeFrame(shell, body, insetX, insetY, tiles[0].image.height);
  } catch (error) { failure = error; }
  try {
    if (original) await moveTo(original.top);
  } catch (error) {
    failure = failure ? new AggregateError([failure, error], `简历截图失败：${String(failure)}；滚动位置恢复失败：${String(error)}`) : error;
  } finally { await rootHandle.dispose(); await rootFrame.evaluate(`delete globalThis[${key}]`); }
  if (failure) throw failure;
  if (!result) throw new Error('简历截图没有生成有效拼接结果');
  // Restore before writing: failures must not leave a purportedly complete result.
  await writeFile(path, result, { flag: 'wx' });
  traceResumeCapture('file-written', { bytes: result.length, restoredTop: original?.top });
}
