import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { captureResumeByWheel, resumeReadingDelayMs, resumeScrollIntervalMs, stitchResumeTiles } from '../dist/common/resume_scroll_capture.js';

test('fractional DPR uses actual scale and captured bottom extent; corrupted overlaps and missing bottoms still fail', () => {
  const scale = 1.25, width = 863, height = 890, totalHeight = 3967;
  const whole = new PNG({ width, height: totalHeight });
  for (let y = 0; y < totalHeight; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    whole.data[at] = (y * 19 + x * 7) % 251;
    whole.data[at + 1] = (y * 31) % 251;
    whole.data[at + 2] = (x * 11) % 251;
    whole.data[at + 3] = 255;
  }
  const tiles = [0, 462.4, 925.6, 1388.8, 1851.2, 2314.4, 2461.6].map(top => {
    const image = new PNG({ width, height });
    PNG.bitblt(whole, image, 0, Math.round(top * scale), width, height, 0, 0);
    return { top, image };
  });
  const result = PNG.sync.read(stitchResumeTiles(tiles, 690, 712, 3174, scale));
  assert.equal(result.height, totalHeight);
  assert.deepEqual(result.data, whole.data, 'every captured pixel is retained once');
  assert.throws(() => stitchResumeTiles(tiles, 690, 712, 3174, width / 690), /重叠校验失败/);
  assert.throws(() => stitchResumeTiles(tiles.slice(0, -1), 690, 712, 3174, scale), /未覆盖到底部/);
  tiles[1].image.data.fill(0);
  assert.throws(() => stitchResumeTiles(tiles, 690, 712, 3174, scale), /重叠校验失败/);
});

test('reading and segment delays include their specified endpoints', () => {
  assert.equal(resumeReadingDelayMs(() => 0), 2000);
  assert.equal(resumeReadingDelayMs(() => 1 - Number.EPSILON), 10000);
  assert.equal(resumeScrollIntervalMs(() => 0), 500);
  assert.equal(resumeScrollIntervalMs(() => 1 - Number.EPSILON), 3000);
});

for (const pageName of ['recommend', 'search']) test(`${pageName} capture pauses between wheel segments, retains pulse pacing, restores scroll and writes a complete image`, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'boss-capture-timing-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Run the actual capture loop with virtual waits and a deterministic scroll surface.
  let now = 0, top = 0;
  const events = [];
  // Record requested waits separately from the wall clock.
  t.mock.method(globalThis, 'setTimeout', (callback, ms) => {
    events.push({ kind: 'wait', ms }); now += ms; queueMicrotask(callback); return 0;
  });
  t.mock.method(Math, 'random', () => 0);
  const metrics = () => ({ x: 0, y: 0, width: 100, height: 100, top, total: 300,
    obstructionMessages: ['element=DIV.status;position=fixed'] });
  const warnings = [];
  t.mock.method(console, 'error', message => warnings.push(message));
  const root = { boundingBox: async () => ({ x: 0, y: 0, width: 100, height: 100 }) };
  const handle = { asElement: () => root, dispose: async () => {} };
  const parent = {
    evaluateHandle: async () => ({ asElement: () => null, dispose: async () => {} }),
    evaluate: async script => script.startsWith('delete') ? undefined : ({ x: 0, y: 0 }),
  };
  const frame = {
    evaluateHandle: async () => handle,
    evaluate: async script => {
      if (script.startsWith('delete')) return undefined;
      assert.ok(now >= 2000, 'opening overlay must not be checked before initial reading pause');
      return metrics();
    },
  };
  const iframe = { frame: parent, contentFrame: async () => frame,
    boundingBox: async () => ({ x: 0, y: 0, width: 100, height: 100 }) };
  const page = {
    url: () => 'https://www.zhipin.com/web/chat/' + pageName,
    evaluate: async () => ({ width: 100, height: 100, x: 0, y: 0, pixelRatio: 1, scale: 1 }),
    mouse: {
      move: async () => { events.push({ kind: 'segment', now }); },
      wheel: async ({ deltaY }) => { events.push({ kind: 'pulse', now }); top = Math.max(0, Math.min(200, top + deltaY)); },
    },
    screenshot: async options => {
      assert.equal(options.clip, undefined);
      assert.equal(options.fullPage, false);
      assert.equal(options.captureBeyondViewport, false);
      const image = new PNG({ width: 100, height: 100 });
      image.data.fill(255);
      events.push({ kind: 'screenshot', top });
      return PNG.sync.write(image);
    },
  };
  const file = path.join(dir, 'resume.png');
  await captureResumeByWheel(page, iframe, file);
  assert.equal(warnings.length, 1, 'same obstruction is reported once per capture');
  assert.match(warnings[0], /在线简历.*继续截图.*element=DIV.status/);
  assert.ok(warnings[0].includes('page=/web/chat/' + pageName));
  assert.ok(Math.abs(top) <= 0.5, 'original position restored within capture tolerance');
  assert.equal(PNG.sync.read(await readFile(file)).height, 300);
  const firstPulse = events.findIndex(event => event.kind === 'pulse');
  assert.ok(events.slice(0, firstPulse).some(event => event.kind === 'wait' && event.ms === 2000));
  const segments = events.filter(event => event.kind === 'segment');
  const intervals = events.filter(event => event.kind === 'wait' && event.ms === 500);
  assert.ok(segments.length >= 4, 'exercise multiple capture and restore segments');
  assert.equal(intervals.length, segments.length - 1);
  for (let i = 1; i < events.length; i++) {
    if (events[i].kind === 'segment' && events.slice(0, i).some(event => event.kind === 'segment')) {
      assert.deepEqual(events[i - 1], { kind: 'wait', ms: 500 });
    }
    if (events[i - 1].kind === 'pulse') assert.deepEqual(events[i], { kind: 'wait', ms: 16 });
  }
});

const closingEvents = [];
let captureError;
mock.module('../dist/browser/timing.js', { namedExports: {
  sleepRandom: async (min, max) => { closingEvents.push(['wait', min, max]); },
} });
mock.module('../dist/common/resume_scroll_capture.js', { namedExports: {
  captureResumeByWheel: async () => { closingEvents.push(['capture']); if (captureError) throw captureError; },
} });
const { captureCResumeIframeToFile } = await import('../dist/common/c_resume_capture.js');

test('successful capture waits 1000–5050ms before closing; failed capture never closes as success', async () => {
  const iframe = { boundingBox: async () => ({ width: 100, height: 100 }), contentFrame: async () => null,
    dispose: async () => {} };
  let closed = false, keepOpen = false;
  const frame = {
    $: async () => iframe,
    evaluate: async script => {
      if (script.includes('function hasCResumeIframe')) {
        closingEvents.push(['close']);
        if (keepOpen) return false;
        const result = !closed; closed = true; return result;
      }
      return !closed;
    },
  };
  const page = { frames: () => [frame] };
  closingEvents.length = 0;
  await captureCResumeIframeToFile(page, 'unused');
  assert.deepEqual(closingEvents.slice(0, 3), [['capture'], ['wait', 1000, 5050], ['close']]);
  captureError = new Error('overlap mismatch');
  closed = false;
  closingEvents.length = 0;
  await assert.rejects(captureCResumeIframeToFile(page, 'unused'), /overlap mismatch/);
  assert.deepEqual(closingEvents, [['capture']]);
  captureError = undefined;
  keepOpen = true;
  await assert.rejects(captureCResumeIframeToFile(page, 'unused'), /关闭后在线简历弹层仍可见/);
});
