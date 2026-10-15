import type { Page } from 'puppeteer-core';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { C_RESUME_IFRAME_SELECTOR, closeCResumePanel } from '../common/c_resume_capture.js';

function bossPath(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname !== 'www.zhipin.com') throw new Error(`不是 BOSS 页面：${url}`);
  return parsed.pathname;
}

const LIST_PATHS = new Set(['/web/chat/recommend', '/web/chat/search', '/web/chat/aiform', '/web/chat/index']);

export async function hasOnlineResumePanel(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const visible = await frame.evaluate(`(() => Array.from(document.querySelectorAll(${JSON.stringify(C_RESUME_IFRAME_SELECTOR)})).some(el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 8 && r.height > 8 && s.visibility !== 'hidden' && s.display !== 'none';
    }))()`);
    if (visible) return true;
  }
  return false;
}

/** State chooses one action. Never use history as a fallback after a failed panel close. */
export async function backFromOnlineResume(page: Page, check: boolean) {
  const beforeUrl = page.url();
  const path = bossPath(beforeUrl);
  if (/^\/web\/frame\/c-resume(?:\/|$)/.test(path)) {
    const session = await page.createCDPSession();
    try {
      const history = await session.send('Page.getNavigationHistory');
      const previous = history.entries[history.currentIndex - 1];
      if (!previous || !LIST_PATHS.has(bossPath(previous.url))) {
        throw new Error('在线简历前一条历史不是已知 BOSS 列表，停止回退');
      }
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 });
      if (page.url() !== previous.url) throw new Error(`历史回退目标不符：expected=${previous.url}；actual=${page.url()}`);
      return { action: 'history-back', beforeUrl, url: page.url() };
    } finally { await session.detach(); }
  }
  if (!LIST_PATHS.has(path)) throw new Error(`当前不是已知列表或在线简历页面，不执行回退：${beforeUrl}`);
  if (await hasOnlineResumePanel(page)) {
    await closeCResumePanel(page);
    if (await hasOnlineResumePanel(page)) throw new Error('关闭在线简历失败：弹层仍可见；不执行历史回退');
    if (page.url() !== beforeUrl) throw new Error(`关闭在线简历时页面意外导航：${page.url()}`);
    return { action: 'close-panel', beforeUrl, url: page.url() };
  }
  if (!check) throw new Error('当前未打开在线简历，不执行历史回退');
  return { action: 'noop', beforeUrl, url: page.url(), reason: 'not-in-online-resume' };
}

export async function runBack(check = false, json = false): Promise<string> {
  return withBossSessionPage(async page => {
    const result = await backFromOnlineResume(page, check);
    return json ? JSON.stringify(result) : `在线简历返回：${result.action}；当前页面：${result.url}`;
  }, { ensureChatShell: false, ensureMenuList: false });
}
