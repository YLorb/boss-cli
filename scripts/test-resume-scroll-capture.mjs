import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { runInNewContext } from 'node:vm';
import { stitchResumeTiles, composeResumeFrame, wheelDeltas, resumeReadingDelayMs, captureResumeByWheel, RESUME_SCROLL_ROOT_SCRIPT } from '../dist/common/resume_scroll_capture.js';

test('reading delay stays within 2000–10000ms', () => {
  assert.equal(resumeReadingDelayMs(() => 0), 2000);
  assert.equal(resumeReadingDelayMs(() => 0.999999), 10000);
  assert.equal(resumeReadingDelayMs(() => 0.5), 6000);
});

function strip(top, height, width = 120, scale = 1) {
  const png = new PNG({ width: width * scale, height: height * scale });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const at = (y * png.width + x) * 4;
    png.data[at] = (top * scale + y) % 251;
    png.data[at + 1] = x % 251;
    png.data[at + 2] = Math.floor((top * scale + y) / 20) % 251;
    png.data[at + 3] = 255;
  }
  return png;
}

test('stitch preserves every pixel, including partial last screen and DPR 2', () => {
  for (const scale of [1, 2]) {
    const tiles = [0, 100, 150].map(top => ({ top, image: strip(top, 200, 120, scale) }));
    const result = PNG.sync.read(stitchResumeTiles(tiles, 120, 200, 350, scale));
    assert.deepEqual(result.data, strip(0, 350, 120, scale).data);
    assert.deepEqual(PNG.sync.read(stitchResumeTiles([{ top: 0, image: strip(0, 200) }], 120, 200, 200, 1)).data, strip(0, 200).data);
  }
});

test('reject missing top, missing bottom, gaps, duplicate screens and changed overlap', () => {
  const tile = top => ({ top, image: strip(top, 200) });
  assert.throws(() => stitchResumeTiles([tile(10)], 120, 200, 210, 1), /顶部/);
  assert.throws(() => stitchResumeTiles([tile(0)], 120, 200, 350, 1), /底部/);
  assert.throws(() => stitchResumeTiles([tile(0), tile(220)], 120, 200, 420, 1), /缺口/);
  assert.throws(() => stitchResumeTiles([tile(0), tile(0)], 120, 200, 200, 1), /未前进/);
  const corrupt = tile(100); corrupt.image.data.fill(255);
  assert.throws(() => stitchResumeTiles([tile(0), corrupt], 120, 200, 300, 1), /重叠校验失败/);
});

test('preserve iframe header/footer outside inner scroll container', () => {
  const shell = strip(0, 240, 140), body = strip(0, 350);
  const result = PNG.sync.read(composeResumeFrame(shell, body, 10, 20, 200));
  assert.equal(result.height, 390);
  assert.deepEqual(result.data.subarray(0, 140 * 20 * 4), shell.data.subarray(0, 140 * 20 * 4));
  assert.deepEqual(result.data.subarray(140 * 370 * 4), shell.data.subarray(140 * 220 * 4));
  for (let y = 0; y < 350; y++) assert.deepEqual(result.data.subarray(((y + 20) * 140 + 10) * 4, ((y + 20) * 140 + 130) * 4), body.data.subarray(y * 120 * 4, (y + 1) * 120 * 4));
});

test('wheel profiles accelerate/decelerate with randomized shape and exact signed distance', () => {
  for (const distance of [-200, 400]) {
    const a = wheelDeltas(distance, () => 0.2), b = wheelDeltas(distance, () => 0.8);
    assert.ok(Math.abs(a.reduce((sum, n) => sum + n, 0) - distance) < 1e-8);
    assert.ok(a.every(n => Math.sign(n) === Math.sign(distance)));
    assert.ok(Math.abs(a[0]) < Math.abs(a[Math.floor(a.length / 2)]));
    assert.ok(Math.abs(a.at(-1)) < Math.abs(a[Math.floor(a.length / 2)]));
    assert.notDeepEqual(a, b);
  }
});

test('root selection rejects nested/ambiguous scroll surfaces', () => {
  const element = () => ({ scrollHeight: 500, clientHeight: 200, getBoundingClientRect: () => ({ width: 300, height: 200 }) });
  const root = element(); root.scrollHeight = 200;
  const inner = element();
  const context = children => ({ document: { scrollingElement: root, querySelectorAll: () => children }, getComputedStyle: () => ({ overflowY: 'auto' }) });
  assert.equal(runInNewContext(RESUME_SCROLL_ROOT_SCRIPT, context([inner])), inner);
  assert.throws(() => runInNewContext(RESUME_SCROLL_ROOT_SCRIPT, context([inner, element()])), /多个滚动容器/);
});

function mockSurface({ blocked = false, changed = false, outer = false } = {}) {
  let top = 40, shots = 0, disposed = false;
  const events = [], metrics = () => ({ x: 0, y: 0, width: 120, height: 200, top: Math.round(top), total: 350, obstructionMessages: [] });
  const root = { boundingBox: async () => ({x:20,y:20,width:120,height:200}) };
  const frame = { evaluate: async script => script.startsWith('delete ') ? true : outer ? {height:350,width:120,total:350} : metrics(), evaluateHandle: async () => ({ asElement: () => root, dispose: async () => { disposed = true; } }) };
  const parentFrame = {evaluateHandle: async () => ({asElement: () => outer ? root : null,dispose: async () => {if(outer)disposed=true;}}), evaluate: async script => script.includes('clientLeft, y: el.clientTop') ? {x:0,y:0} : script.startsWith('delete ') ? true : metrics()};
  const iframe = { frame: parentFrame, contentFrame: async () => frame, boundingBox: async () => ({ x: 20, y: outer ? 20 - Math.round(top) : 20, width: 120, height: outer ? 350 : 200 }) };
  const page = {
    url: () => 'https://www.zhipin.com/web/chat/search',
    evaluate: async () => ({ width: 500, height: 500, x: 0, y: 0, scale: 1, pixelRatio: 1 }),
    mouse: { move: async (x, y) => { assert.equal(x, 80); assert.equal(y, 120); }, wheel: async ({ deltaY }) => { events.push(deltaY); if (!blocked) top = Math.max(0, Math.min(150, top + deltaY)); } },
    screenshot: async options => {
      assert.equal(options.captureBeyondViewport, false);
      const png = strip(Math.round(top), 200);
      if (changed && shots > 1) png.data.fill(255);
      shots++;
      const viewport = new PNG({ width: 500, height: 500 });
      PNG.bitblt(png, viewport, 0, 0, 120, 200, 20, 20);
      return PNG.sync.write(viewport);
    },
  };
  return { page, iframe, inspect: () => ({ top: Math.round(top), shots, events, disposed }) };
}

test('capture uses wheel only, verifies bottom, restores initial position and writes complete PNG', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'boss-scroll-test-'));
  try {
    const fixture = mockSurface(), path = join(dir, 'complete.png');
    await captureResumeByWheel(fixture.page, fixture.iframe, path);
    assert.deepEqual(PNG.sync.read(await readFile(path)).data, strip(0, 350).data);
    const result = fixture.inspect();
    assert.equal(result.top, 40); assert.equal(result.disposed, true);
    assert.ok(result.shots >= 2); assert.ok(result.events.some(n => n < 0)); assert.ok(result.events.some(n => n > 0));
  } finally { await rm(dir, { recursive: true }); }
});

test('blocked wheel / changed content fail without saving and release handles', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'boss-scroll-test-'));
  try {
    for (const options of [{ blocked: true }, { changed: true }]) {
      const fixture = mockSurface(options), path = join(dir, 'incomplete.png');
      await assert.rejects(captureResumeByWheel(fixture.page, fixture.iframe, path), /滚轮无响应|重叠校验失败/);
      await assert.rejects(access(path));
      assert.equal(fixture.inspect().top, 40); assert.equal(fixture.inspect().disposed, true);
    }
  } finally { await rm(dir, { recursive: true }); }
});

test('content-height iframe uses its outer scroll container and restores it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'boss-scroll-outer-'));
  try {
    const fixture=mockSurface({outer:true}), path=join(dir,'complete.png');
    await captureResumeByWheel(fixture.page, fixture.iframe, path);
    assert.deepEqual(PNG.sync.read(await readFile(path)).data,strip(0,350).data);
    assert.equal(fixture.inspect().top,40);assert.equal(fixture.inspect().disposed,true);
  } finally {await rm(dir,{recursive:true});}
});
