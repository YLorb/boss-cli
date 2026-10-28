import type { Page } from 'puppeteer-core';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { C_RESUME_IFRAME_SELECTOR, closeCResumePanel } from '../common/c_resume_capture.js';

function bossPath(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname !== 'www.zhipin.com') throw new Error(`不是 BOSS 页面：${url}`);
  return parsed.pathname;
}

const LIST_PATHS = new Set(['/web/chat/recommend', '/web/chat/search', '/web/chat/aiform', '/web/chat/index']);

export function validatePreviousUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://www.zhipin.com' || parsed.username || parsed.password || !LIST_PATHS.has(parsed.pathname)) {
    throw new Error('返回目标必须为 https://www.zhipin.com 下已知列表的完整 URL');
  }
}

/** Explicit one-step history return. Never called as an exception recovery path. */
export async function backToPreviousPage(page: Page, expectedUrl: string) {
  validatePreviousUrl(expectedUrl);
  const beforeUrl = page.url();
  const current = new URL(beforeUrl);
  if (current.origin !== 'https://www.zhipin.com' || current.username || current.password ||
      !(LIST_PATHS.has(current.pathname) || current.pathname === '/web/chat/business/mine' ||
        /^\/web\/frame\/c-resume(?:\/|$)/.test(current.pathname))) {
    throw new Error(`当前页面不允许历史返回（登录、验证或未知页面必须停止）：${beforeUrl}`);
  }
  if (await hasOnlineResumePanel(page)) throw new Error('在线简历弹层仍打开，请显式使用 back --if-open；不转为历史返回');
  const session = await page.createCDPSession();
  try {
    const history = await session.send('Page.getNavigationHistory');
    const entry = history.entries[history.currentIndex];
    const previous = history.entries[history.currentIndex - 1];
    if (!entry || entry.url !== beforeUrl || !previous || previous.url !== expectedUrl || previous.url === beforeUrl) {
      throw new Error(`前一条历史与返回目标不符或没有不同页面：expected=${expectedUrl}；previous=${previous?.url ?? 'none'}`);
    }
    // Re-read immediately before mutation to reject a concurrent history change.
    const latest = await session.send('Page.getNavigationHistory');
    if (page.url() !== beforeUrl || latest.currentIndex !== history.currentIndex ||
        latest.entries[latest.currentIndex]?.id !== entry.id || latest.entries[latest.currentIndex - 1]?.id !== previous.id ||
        latest.entries[latest.currentIndex - 1]?.url !== expectedUrl) throw new Error('返回前浏览器历史已变化，停止');
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    const after = await session.send('Page.getNavigationHistory');
    if (page.url() !== expectedUrl || after.currentIndex !== history.currentIndex - 1 ||
        after.entries[after.currentIndex]?.id !== previous.id || after.entries[after.currentIndex]?.url !== expectedUrl) {
      throw new Error(`返回结果核验失败，不再返回或重试：expected=${expectedUrl}；actual=${page.url()}`);
    }
    return { action: 'history-back', steps: 1, beforeUrl, url: page.url() };
  } finally { await session.detach(); }
}

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

export async function runBack(check = false, json = false, previousUrl?: string): Promise<string> {
  if (previousUrl !== undefined) validatePreviousUrl(previousUrl);
  return withBossSessionPage(async page => {
    const result = previousUrl === undefined ? await backFromOnlineResume(page, check) : await backToPreviousPage(page, previousUrl);
    return json ? JSON.stringify(result) : `返回：${result.action}；当前页面：${result.url}`;
  }, { ensureChatShell: false, ensureMenuList: false });
}
