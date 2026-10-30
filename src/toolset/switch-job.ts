import type { Page } from 'puppeteer-core';
import { withBossSessionPage } from '../common/boss_session_page.js';

export type SwitchJobOptions = { list: boolean; job: string | null; timeoutMs: number };

const visible = `el => el instanceof HTMLElement && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'`;
// uiDropmenu keeps its list mounted; its public CSS class represents open state.
const menuOpenScript = `(() => {
  const menus = [...document.querySelectorAll('.chat-top-job')].filter(${visible});
  if (menus.length !== 1) throw Error('岗位菜单必须唯一');
  return menus[0].classList.contains('ui-dropmenu-visible');
})()`;
const readyScript = `(() => {
  const visible = ${visible};
  if (location.hostname !== 'www.zhipin.com' || location.pathname !== '/web/chat/index') throw Error('选岗期间已离开沟通页');
  const overlays = [...document.querySelectorAll('.resume-middle-wrap, .resume-detail-chat, .chat-global-conversation, iframe[src*="c-resume"]')].filter(visible);
  if (overlays.length) throw Error('存在简历或内嵌会话遮挡，停止选岗');
  const editor = document.querySelector('#boss-chat-editor-input');
  if ((editor?.innerText || editor?.textContent || '').trim()) throw Error('当前会话有草稿，停止选岗并保留草稿');
  return true;
})()`;
const currentScript = `(() => {
  const visible = ${visible};
  const labels = [...document.querySelectorAll('.chat-top-job .ui-dropmenu-label')].filter(visible);
  if (labels.length !== 1) throw Error('可见岗位下拉数量必须为1，实际=' + labels.length);
  const inputs = [...labels[0].querySelectorAll('input.chat-job-search')].filter(visible);
  if (inputs.length) {
    if (inputs.length !== 1 || inputs[0].value.trim()) throw Error('岗位搜索框不唯一或已有搜索条件，停止选岗');
    const selected = [...document.querySelectorAll('.chat-top-job .ui-dropmenu-list li.active')].filter(visible);
    if (selected.length !== 1 || !selected[0].textContent.trim()) throw Error('展开菜单中的当前岗位必须唯一且非空');
    return selected[0].textContent.trim();
  }
  const label = labels[0].textContent.trim();
  if (!label) throw Error('当前岗位标签为空，无法核验');
  return label;
})()`;

// Viewport CSS pixels, never desktop/screenshot coordinates. Use only the left
// gutter explicitly identified by the user; an unsafe sampled point fails.
function gutterScript(point: {x: number; y: number} | null): string {
  return `(() => {
    ${readyScript};
    const visible = ${visible};
    const one = selector => {
      const nodes = [...document.querySelectorAll(selector)].filter(visible);
      if (nodes.length !== 1) throw Error('空白区域定位不唯一：' + selector);
      return nodes[0];
    };
    const sidebar = one('.menu-list'), list = one('.chat-user');
    const a = sidebar.getBoundingClientRect(), b = list.getBoundingClientRect();
    const rect = {left:Math.max(0,a.right)+12, right:Math.min(innerWidth,b.left)-12,
      top:Math.max(0,b.top)+12, bottom:Math.min(innerHeight,b.bottom)-12};
    if (rect.right-rect.left < 8 || rect.bottom-rect.top < 8) throw Error('左侧空白边距不足，停止点击');
    const point = ${JSON.stringify(point)} ?? {x:rect.left+Math.random()*(rect.right-rect.left), y:rect.top+Math.random()*(rect.bottom-rect.top)};
    if (point.x<rect.left || point.x>rect.right || point.y<rect.top || point.y>rect.bottom) throw Error('点击前空白区域布局已变化');
    const hit = document.elementFromPoint(point.x,point.y);
    if (!hit || !hit.contains(list) || hit.contains(sidebar) ||
        hit.closest('a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable],.geek-item,.ui-dropmenu'))
      throw Error('空白点击点命中非预期背景或交互控件，停止点击');
    const selected = [...document.querySelectorAll('.geek-item.selected')].map(el=>el.getAttribute('data-id'));
    return {...point,rect,selected};
  })()`;
}

export function parseSwitchJobArgs(args: string[]): SwitchJobOptions {
  const options = { list: false, job: null, timeoutMs: 10000 } as SwitchJobOptions;
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--list', '--job', '--timeout-ms'].includes(key) || seen.has(key)) throw Error('未知或重复参数：' + key);
    seen.add(key);
    if (key === '--list') { options.list = true; continue; }
    const value = args[++i];
    if (!value?.trim() || value.startsWith('--')) throw Error('参数缺少值：' + key);
    if (key === '--job') options.job = value.trim();
    if (key === '--timeout-ms') {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 60000) throw Error('timeout-ms须为1至60000的整数');
      options.timeoutMs = Number(value);
    }
  }
  if (options.list === Boolean(options.job)) throw Error('必须且只能指定 --list 或 --job <实时完整选项文案>');
  return options;
}

/** Operates only the chat job dropdown. No navigation, category switching or retries. */
export async function switchChatJob(page: Page, { list = false, job = null, timeoutMs = 10000 }: SwitchJobOptions) {
  const url = new URL(page.url());
  if (url.hostname !== 'www.zhipin.com' || url.pathname !== '/web/chat/index') throw Error('必须已在沟通页 /web/chat/index；当前=' + page.url());
  if (list === Boolean(job)) throw Error('必须且只能列出岗位或指定目标岗位');
  if (job && /关闭|已结束/.test(job)) throw Error('目标岗位关闭或禁用：' + job);
  await page.evaluate(readyScript);
  const before = await page.evaluate(currentScript) as string;
  if (!list && before === job) return { ok: true, changed: false, before, job: before, url: page.url() };
  await page.evaluate(`(() => {
    ${readyScript};
    const visible = ${visible};
    const labels = [...document.querySelectorAll('.chat-top-job .ui-dropmenu-label')].filter(visible);
    if (labels.length !== 1) throw Error('岗位下拉不唯一');
    if (!(${menuOpenScript})) labels[0].click();
  })()`);
  await page.waitForFunction(`(() => {
    const visible = ${visible};
    return (${menuOpenScript}) && [...document.querySelectorAll('.chat-top-job .ui-dropmenu-list li')].some(visible);
  })()`, { timeout: timeoutMs }).catch(error => { throw Error('等待岗位菜单展开失败：' + error.message); });
  const options = await page.evaluate(`(() => {
    const visible = ${visible};
    return [...document.querySelectorAll('.chat-top-job .ui-dropmenu-list li')].filter(visible).map(el => ({
      label: el.textContent.trim(),
      unavailable: el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled') || el.classList.contains('disabled') || /关闭|已结束/.test(el.textContent)
    }));
  })()`);
  if (list) {
    const point = await page.evaluate(gutterScript(null)) as {x:number;y:number;rect:unknown;selected:unknown};
    await page.mouse.move(point.x, point.y);
    const checked = await page.evaluate(gutterScript({x:point.x,y:point.y})) as typeof point;
    if (JSON.stringify(checked) !== JSON.stringify(point) || page.url() !== url.href || await page.evaluate(currentScript) !== before)
      throw Error('点击前页面、岗位、会话或布局已变化');
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(`!(${menuOpenScript})`, {timeout:timeoutMs})
      .catch(error => { throw Error('读取岗位后等待菜单收起失败：' + error.message); });
    if (page.url() !== url.href || await page.evaluate(currentScript) !== before) throw Error('列出岗位后页面或岗位已变化');
    const selected = await page.evaluate(`JSON.stringify([...document.querySelectorAll('.geek-item.selected')].map(el=>el.getAttribute('data-id')))`);
    if (selected !== JSON.stringify(point.selected)) throw Error('空白点击后当前会话已变化');
    await page.evaluate(readyScript);
    return { ok: true, changed: false, before, options, url: page.url(), closeClick:point, note: '展开下拉，单次点击左侧随机空白点收起，未切换岗位；非只读命令' };
  }
  const matches = (options as {label: string; unavailable: boolean}[]).filter(item => item.label === job);
  if (matches.length !== 1) throw Error(`目标岗位须唯一匹配：job=${job} matches=${matches.length}`);
  if (matches[0].unavailable) throw Error('目标岗位关闭或禁用：' + job);
  await page.evaluate(`(() => {
    ${readyScript};
    const visible = ${visible};
    const matches = [...document.querySelectorAll('.chat-top-job .ui-dropmenu-list li')].filter(el => visible(el) && el.textContent.trim() === ${JSON.stringify(job)});
    if (matches.length !== 1) throw Error('点击前岗位身份发生变化');
    const el = matches[0];
    if (el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled') || el.classList.contains('disabled') || /关闭|已结束/.test(el.textContent)) throw Error('点击前岗位已不可用');
    el.click();
  })()`);
  try {
    await page.waitForFunction(`(${currentScript}) === ${JSON.stringify(job)}`, { timeout: timeoutMs });
    await page.waitForFunction(`!(${menuOpenScript})`, {timeout:timeoutMs});
  } catch (error) {
    throw Error(`岗位切换未确认：expected=${job} actual=${await page.evaluate(currentScript)}；${error instanceof Error ? error.message : String(error)}`);
  }
  const after = await page.evaluate(currentScript);
  if (page.url() !== url.href || after !== job) throw Error('岗位切换后页面或岗位发生变化：' + page.url() + ' / ' + after);
  return { ok: true, changed: true, before, job: after, url: page.url() };
}


export async function runSwitchJob(options: SwitchJobOptions, json = false): Promise<string> {
  return withBossSessionPage(async page => {
    const result = await switchChatJob(page, options);
    return json ? JSON.stringify(result) : JSON.stringify(result, null, 2);
  });
}
