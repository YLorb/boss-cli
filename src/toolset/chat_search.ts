import type { Page } from 'puppeteer-core';
import { isBossChatIndexUrl } from '../common/auth.js';
import { readSelectedConversation } from './conversation_identity.js';

export type ChatSearchOptions = { name: string; dataId?: string; job?: string };
type Match = { name: string; label: string; uniqueId: string };
type SearchState = { keyword: string; content: string; groups: number; count: number; matches: Match[] };
export class CandidateSelectionRequired extends Error {
  constructor(readonly result: { name: string; matches: Match[]; groupCount: number; reason: string }) {
    super(`${result.reason}；${JSON.stringify(result)}`);
    this.name = 'CandidateSelectionRequired';
  }
}

/** Business callers must stop before reading, sending or downloading on ambiguity. */
export async function requireChatSearch(page: Page, options: ChatSearchOptions) {
  const result = await searchChatCandidate(page, options);
  if (result.status === 'needs-confirmation') throw new CandidateSelectionRequired(result);
  return result;
}
const visible = `(e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none'`;
const jobScript = `(() => {
  const rows = [...document.querySelectorAll('.chat-top-job .ui-dropmenu-label')].filter(${visible});
  if (rows.length !== 1) throw Error('沟通岗位下拉不唯一');
  return rows[0].textContent.trim();
})()`;

// Read all component results, including rows hidden behind “查看更多”. Never invoke component methods.
const resultsScript = `(() => {
  const roots = [...document.querySelectorAll('.chat-top-search')].filter(${visible});
  if (roots.length !== 1) throw Error('沟通搜索框缺失或不唯一');
  const root = roots[0], vm = root.__vue__, input = root.querySelector('input.search-input');
  if (!vm || !Array.isArray(vm.searchList) || !Array.isArray(vm.searchGroupList)) throw Error('沟通搜索组件结构不符，无法确认完整结果');
  const rows = [...root.querySelectorAll('.geek-search-list li')];
  return { keyword: input?.value, content: vm.content, groups: vm.searchGroupList.length,
    matches: vm.searchList.map((x,i) => ({name:x.name,uniqueId:x.uniqueId,label:rows[i]?.querySelector('.content-text')?.textContent.trim()})),
    count: rows.length, ready: Boolean(vm.showSearchResult) };
})()`;

export async function searchChatCandidate(page: Page, options: ChatSearchOptions, timeout = 10_000) {
  const name = options.name.trim();
  if (!name || (options.dataId !== undefined && !options.dataId.trim()) || (options.job !== undefined && !options.job.trim())) throw Error('候选人昵称及提供的比较标准不能为空');
  if (!isBossChatIndexUrl(page.url())) throw Error(`chat-search 必须已在沟通页 /web/chat/index；当前=${page.url()}`);
  if (await page.evaluate(jobScript) !== '全部职位') {
    await page.evaluate(`(() => {
      const visible = ${visible};
      if (![...document.querySelectorAll('.chat-top-job .ui-dropmenu-list li')].some(visible)) document.querySelector('.chat-top-job .ui-dropmenu-label').click();
    })()`);
    await page.waitForFunction(`(() => [...document.querySelectorAll('.chat-top-job .ui-dropmenu-list li')].some(${visible}))()`, { timeout });
    await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('.chat-top-job .ui-dropmenu-list li')].filter(e => (${visible})(e) && e.textContent.trim() === '全部职位');
      if (rows.length !== 1 || rows[0].matches('[disabled],[aria-disabled="true"],.disabled')) throw Error('全部职位选项缺失、重名或不可用');
      rows[0].click();
    })()`);
    await page.waitForFunction(`(${jobScript}) === '全部职位'`, { timeout });
  }
  await page.evaluate(`(() => {
    const visible = ${visible};
    const inputs = [...document.querySelectorAll('.chat-top-search input.search-input')].filter(visible);
    if (inputs.length > 1) throw Error('搜索输入框不唯一');
    if (inputs.length === 1) return;
    const buttons = [...document.querySelectorAll('.chat-search-btn')].filter(visible);
    if (buttons.length !== 1) throw Error('沟通搜索图标不唯一');
    buttons[0].click();
  })()`);
  await page.waitForSelector('.chat-top-search input.search-input', { visible: true, timeout });
  const initial = await page.evaluate(resultsScript) as SearchState;
  if (initial.keyword || initial.content || initial.matches.length || initial.groups) throw Error('沟通搜索已有输入或结果，请先由用户清空；不覆盖或复用旧搜索');
  // One input event prevents intermediate pinyin/partial-name requests and stale result reuse.
  await page.evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.chat-top-search input.search-input')].filter(${visible});
    if (inputs.length !== 1 || inputs[0].value) throw Error('输入前搜索框状态已变化');
    const input = inputs[0];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(name)});
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  try {
    await page.waitForFunction(`(() => {
      const s = ${resultsScript};
      return s.keyword === ${JSON.stringify(name)} && s.content === ${JSON.stringify(name)} && s.ready && s.count === s.matches.length && (s.count > 0 || s.groups > 0);
    })()`, { timeout });
  } catch (error) {
    throw Error(`沟通昵称搜索未确认：name=${name}；无匹配或结果尚未就绪，不点击、不重试；${String(error)}`);
  }
  const state = await page.evaluate(resultsScript) as SearchState;
  if (state.keyword !== name || state.content !== name || state.count !== state.matches.length) throw Error('搜索结果与当前查询不一致');
  if (state.matches.length !== 1 || state.groups > 0) {
    return { status: 'needs-confirmation' as const, clicked: false, name, matches: state.matches, groupCount: state.groups, reason: '重名或多个可能匹配项，等待用户手动确认或进一步指令' };
  }
  const match = state.matches[0]!;
  if (match.name !== name || !match.uniqueId || !match.label) throw Error(`搜索唯一结果身份不完整或昵称不符：${JSON.stringify(match)}`);
  await page.evaluate(`(() => {
    const s = ${resultsScript};
    if (s.keyword !== ${JSON.stringify(name)} || s.content !== ${JSON.stringify(name)} || s.groups || s.matches.length !== 1 || s.count !== 1 || JSON.stringify(s.matches[0]) !== ${JSON.stringify(JSON.stringify(match))}) throw Error('点击前搜索身份或结果数量已变化');
    const rows = [...document.querySelectorAll('.chat-top-search .geek-search-list li')].filter(${visible});
    if (rows.length !== 1) throw Error('唯一搜索结果不可见');
    rows[0].click();
  })()`);
  try {
    await page.waitForFunction(`(() => {
      const rows = [...document.querySelectorAll('.geek-item.selected')];
      const norm = x => (x || '').replace(/\\s+/g,' ').trim();
      return rows.length === 1 && rows[0].getAttribute('data-id') === ${JSON.stringify(match.uniqueId)} && norm(rows[0].querySelector('.geek-name')?.textContent) === ${JSON.stringify(name)} && norm(document.querySelector('.base-info-single-container .name-box')?.textContent) === ${JSON.stringify(name)};
    })()`, { timeout });
    const conversation = await readSelectedConversation(page);
    const job = await page.evaluate(`(() => document.querySelector('.base-info-single-container .position-item .position-name')?.textContent.trim() || '')()`) as string;
    if (!job || (options.dataId && conversation.dataId !== options.dataId.trim()) || (options.job && job !== options.job.trim())) throw Error(`会话ID或岗位不符：actual=${conversation.dataId} / ${job}`);
    if (!isBossChatIndexUrl(page.url()) || await page.evaluate(jobScript) !== '全部职位') throw Error('定位后页面或全部职位条件发生变化');
    return { status: 'opened' as const, clicked: true, name, dataId: conversation.dataId, job, match };
  } catch (error) {
    throw Error(`已点击唯一搜索结果一次，定位结果未确认，禁止重试：name=${name}；${String(error)}`);
  }
}
