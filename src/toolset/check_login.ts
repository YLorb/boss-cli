import puppeteer from 'puppeteer-core';
import { REMOTE_DEBUGGING_PORT } from '../browser/cdp_browser.js';

export type LoginCheck = { status: 'logged-in' | 'logged-out' | 'unknown'; loggedIn: boolean | null; url: string };

/** Read existing tabs only: no launch, navigation, page guards, or shared-session changes. */
export async function runCheckLogin(json = false): Promise<string> {
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${REMOTE_DEBUGGING_PORT}`,
    defaultViewport: null,
    protocolTimeout: 10_000,
  });
  try {
    const target = await browser.waitForTarget(t => {
      if (t.type() !== 'page') return false;
      try { return new URL(t.url()).hostname === 'www.zhipin.com'; } catch { return false; }
    }, { timeout: 5_000 });
    const page = await target.page();
    if (!page) throw new Error('BOSS 标签页不可用，无法检查登录状态。');
    const result = await page.evaluate(`(() => {
      const url = location.href;
      const path = location.pathname;
      const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      if (location.hostname !== 'www.zhipin.com') return { status: 'unknown', loggedIn: null, url };
      if (/\\/(?:safe|passport|common)\\//.test(path)) return { status: 'unknown', loggedIn: null, url };
      if (/^\\/web\\/user(?:\\/|$)/.test(path)) return { status: 'logged-out', loggedIn: false, url };
      const roots = Array.from(document.querySelectorAll('header, .nav-header, .nav-wrap, .top-header, #header, .header, .navbar, .nav-user'));
      const loginCta = roots.some(root => visible(root) && Array.from(root.querySelectorAll('a,button')).some(el => visible(el) && /^(我要登录|登录|登录\\/注册)$/.test((el.textContent || '').trim())));
      if (loginCta) return { status: 'logged-out', loggedIn: false, url };
      const shell = /^\\/web\\/chat(?:\\/|$)/.test(path) && visible(document.querySelector('.menu-list'));
      const account = Array.from(document.querySelectorAll('.nav-user .name, .nav-user-name, .header .user-name, header .user-name, a[href*="logout"], a[href*="signout"]')).some(el => visible(el) && !!(el.textContent || '').trim());
      return shell || account ? { status: 'logged-in', loggedIn: true, url } : { status: 'unknown', loggedIn: null, url };
    })()`) as LoginCheck;
    if(result.loggedIn===null) throw new Error('无法判断登录状态：'+result.url);
    return JSON.stringify(result.loggedIn);
  } finally {
    await browser.disconnect();
  }
}
