import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { RESUME_SCROLL_METRICS_SCRIPT } from '../dist/common/resume_scroll_capture.js';

function fixture(position = 'fixed', { hidden = false, behind = false, overflow = false } = {}) {
  const root = {
    isConnected: true, clientWidth: 778, clientHeight: 960,
    scrollWidth: overflow ? 800 : 778, scrollHeight: 3000, scrollTop: 0,
    getBoundingClientRect: () => ({ x: 0, y: 0 }),
  };
  const node = {
    tagName: 'DIV', className: '', contains: () => false,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 778, height: 960,
      left: 0, right: 778, top: 0, bottom: 960 }),
  };
  return { URL, root, innerWidth: 778, innerHeight: 960,
    document: { scrollingElement: root, querySelectorAll: () => [node],
      elementFromPoint: () => behind ? root : node },
    getComputedStyle: () => ({ position, visibility: hidden ? 'hidden' : 'visible', display: 'block', opacity: '1' }),
  };
}

function read(url, context = fixture()) {
  return runInNewContext(`${RESUME_SCROLL_METRICS_SCRIPT}(root, ${JSON.stringify(url)})`, context);
}

test('recommend fixed/sticky overlays become diagnostics, with geometry intact', () => {
  for (const position of ['fixed', 'sticky']) {
    for (const suffix of ['', '/?from=test']) {
      const metrics = read('https://www.zhipin.com/web/chat/recommend' + suffix, fixture(position));
      assert.equal(metrics.obstructionMessages.length, 1);
      assert.match(metrics.obstructionMessages[0], new RegExp(`position=${position}`));
      assert.equal(metrics.width, 778);
      assert.equal(metrics.height, 960);
      assert.equal(metrics.total, 3000);
    }
  }
});

test('search, chat, deep search and other origins still reject fixed/sticky obstructions', () => {
  for (const url of [
    'https://www.zhipin.com/web/chat/search',
    'https://www.zhipin.com/web/chat/index',
    'https://www.zhipin.com/web/chat/aiform',
    'https://www.zhipin.com/web/chat/recommend-other',
    'https://example.com/web/chat/recommend',
  ]) for (const position of ['fixed', 'sticky']) {
    assert.throws(() => read(url, fixture(position)), /固定\/吸顶元素遮挡截图区域，停止拼接/);
  }
});

test('invisible or behind-content elements do not report an obstruction', () => {
  for (const options of [{ hidden: true }, { behind: true }]) {
    assert.equal(read('https://www.zhipin.com/web/chat/search', fixture('fixed', options)).obstructionMessages.length, 0);
  }
});

test('recommend exception does not relax overflow or viewport bounds checks', () => {
  const url = 'https://www.zhipin.com/web/chat/recommend';
  assert.throws(() => read(url, fixture('fixed', { overflow: true })), /横向溢出/);
  const context = fixture();
  context.innerHeight = 900;
  assert.throws(() => read(url, context), /未完整显示/);
});
