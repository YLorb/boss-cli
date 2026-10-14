import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';

const visible = `el => el instanceof HTMLElement && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'`;
const currentScript = `(() => {
  const visible = ${visible};
  const labels = [...document.querySelectorAll('.chat-top-job .ui-dropmenu-label')].filter(visible);
  if (labels.length !== 1) throw Error('可见岗位下拉数量必须为1，实际=' + labels.length);
  return labels[0].textContent.trim();
})()`;

export function parseArgs(args) {
  const options = { list: false, job: null, cdpUrl: 'http://127.0.0.1:53470', timeoutMs: 10000 };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--list', '--job', '--cdp-url', '--timeout-ms'].includes(key) || seen.has(key)) throw Error('未知或重复参数：' + key);
    seen.add(key);
    if (key === '--list') { options.list = true; continue; }
    const value = args[++i];
    if (!value?.trim() || value.startsWith('--')) throw Error('参数缺少值：' + key);
    if (key === '--job') options.job = value.trim();
    if (key === '--cdp-url') options.cdpUrl = value;
    if (key === '--timeout-ms') {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 60000) throw Error('timeout-ms须为1至60000的整数');
      options.timeoutMs = Number(value);
    }
  }
  if (options.list === Boolean(options.job)) throw Error('必须且只能指定 --list 或 --job <实时完整选项文案>');
  const url = new URL(options.cdpUrl);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('cdp-url必须为本机HTTP调试地址');
  return options;
}

/** Operates only the chat job dropdown. No navigation, category switching or retries. */
export async function switchChatJob(page, { list = false, job = null, timeoutMs = 10000 }) {
  const url = new URL(page.url());
  if (url.hostname !== 'www.zhipin.com' || url.pathname !== '/web/chat/index') throw Error('必须已在沟通页 /web/chat/index；当前=' + page.url());
  if (list === Boolean(job)) throw Error('必须且只能列出岗位或指定目标岗位');
  if (job && /关闭|已结束/.test(job)) throw Error('目标岗位关闭或禁用：' + job);
  const before = await page.evaluate(currentScript);
  if (!list && before === job) return { ok: true, changed: false, before, job: before, url: page.url() };
  await page.evaluate(`(() => {
    const visible = ${visible};
    const labels = [...document.querySelectorAll('.chat-top-job .ui-dropmenu-label')].filter(visible);
    if (labels.length !== 1) throw Error('岗位下拉不唯一');
    const options = [...document.querySelectorAll('.chat-top-job .ui-dropmenu-list li')].filter(visible);
    if (!options.length) labels[0].click();
  })()`);
  await page.waitForFunction(`(() => {
    const visible = ${visible};
    return [...document.querySelectorAll('.chat-top-job .ui-dropmenu-list li')].some(visible);
  })()`, { timeout: timeoutMs });
  const options = await page.evaluate(`(() => {
    const visible = ${visible};
    return [...document.querySelectorAll('.chat-top-job .ui-dropmenu-list li')].filter(visible).map(el => ({
      label: el.textContent.trim(),
      unavailable: el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled') || el.classList.contains('disabled') || /关闭|已结束/.test(el.textContent)
    }));
  })()`);
  if (list) return { ok: true, before, options, url: page.url(), note: '仅展开读取下拉，不切换岗位' };
  const matches = options.filter(item => item.label === job);
  if (matches.length !== 1) throw Error(`目标岗位须唯一匹配：job=${job} matches=${matches.length}`);
  if (matches[0].unavailable) throw Error('目标岗位关闭或禁用：' + job);
  await page.evaluate(`(() => {
    const visible = ${visible};
    const matches = [...document.querySelectorAll('.chat-top-job .ui-dropmenu-list li')].filter(el => visible(el) && el.textContent.trim() === ${JSON.stringify(job)});
    if (matches.length !== 1) throw Error('点击前岗位身份发生变化');
    const el = matches[0];
    if (el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled') || el.classList.contains('disabled') || /关闭|已结束/.test(el.textContent)) throw Error('点击前岗位已不可用');
    el.click();
  })()`);
  try {
    await page.waitForFunction(`(${currentScript}) === ${JSON.stringify(job)}`, { timeout: timeoutMs });
  } catch (error) {
    throw Error(`岗位切换未确认：expected=${job} actual=${await page.evaluate(currentScript)}；${error.message}`);
  }
  const after = await page.evaluate(currentScript);
  if (page.url() !== url.href || after !== job) throw Error('岗位切换后页面或岗位发生变化：' + page.url() + ' / ' + after);
  return { ok: true, changed: true, before, job: after, url: page.url() };
}

export async function main(args) {
  const options = parseArgs(args);
  const browser = await puppeteer.connect({ browserURL: options.cdpUrl, defaultViewport: null, protocolTimeout: options.timeoutMs });
  try {
    const pages = (await browser.pages()).filter(page => {
      try { return new URL(page.url()).hostname === 'www.zhipin.com'; } catch { return false; }
    });
    if (pages.length !== 1) throw Error('必须只有一个BOSS标签页，实际=' + pages.length);
    return await switchChatJob(pages[0], options);
  } finally { await browser.disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)))); }
  catch (error) { console.log(JSON.stringify({ ok: false, command: 'switch-job', error: { name: error.name, message: error.message } })); process.exitCode = 1; }
}
