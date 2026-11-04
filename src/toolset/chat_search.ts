import type { Page } from 'puppeteer-core';
import { sleepRandom } from '../browser/timing.js';
import { isBossChatIndexUrl } from '../common/auth.js';
import { assertSelectedConversation, readSelectedConversation } from './conversation_identity.js';
import { ChatSearchFailure, type ChatSearchFailureDetails } from '../common/chat_search_failure.js';
import { captureChatSearchDiagnostics, chatSearchTimeoutMs } from './chat_search_diagnostics.js';
import { CHAT_SEARCH_MATCH_SCRIPT, type ChatSearchMatch } from './chat_search_match.js';

export type ChatSearchOptions = { name: string; dataId?: string; job?: string; info?: string };
type Match = ChatSearchMatch;
type SearchState = { keyword: string; content: string; groups: number; count: number; matches: Match[]; resultSignal: boolean | number; ready: boolean; emptyCompleted: boolean };
export class CandidateSelectionRequired extends Error {
  constructor(readonly result: { name: string; matches: Match[]; groupCount: number; reason: string }) {
    super(`${result.reason}；${JSON.stringify(result)}`);
    this.name = 'CandidateSelectionRequired';
  }
}
export class CandidateNotFound extends Error {
  constructor(readonly result: { name: string; info?: string; status: 'not-found'; clicked: false }) {
    super(`昵称搜索已完成，无匹配候选人：${JSON.stringify(result)}`);
    this.name = 'CandidateNotFound';
  }
}

/** Business callers must stop before reading, sending or downloading on ambiguity. */
export async function requireChatSearch(page: Page, options: ChatSearchOptions) {
  const result = await searchChatCandidate(page, options);
  if (result.status === 'needs-confirmation') throw new CandidateSelectionRequired(result);
  if (result.status === 'not-found') throw new CandidateNotFound(result);
  return result;
}
const visible = `(e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none'`;
// Read all component results, including rows hidden behind “查看更多”. Never invoke component methods.
const resultsScript = `(() => {
  const roots = [...document.querySelectorAll('.chat-top-search')].filter(${visible});
  if (roots.length !== 1) throw Error('沟通搜索框缺失或不唯一');
  const root = roots[0], vm = root.__vue__, input = root.querySelector('input.search-input');
  if (!vm || !Array.isArray(vm.searchList) || !Array.isArray(vm.searchGroupList)) throw Error('沟通搜索组件结构不符，无法确认完整结果');
  const rows = [...root.querySelectorAll('.geek-search-list li')];
  return { keyword: input?.value, content: vm.content, groups: vm.searchGroupList.length,
    matches: vm.searchList.map((x,i) => ${CHAT_SEARCH_MATCH_SCRIPT}(x, rows[i])),
    count: rows.length, resultSignal: vm.showSearchResult,
    ready: Boolean(vm.showSearchResult), emptyCompleted: vm.showSearchResult === 0 };
})()`;

export async function clearChatSearch(page: Page, keyword: string, timeout = 5000) {
  const url = page.url();
  if (!isBossChatIndexUrl(url) || !keyword.trim()) throw Error('清空搜索需要在沟通页提供当前非空搜索词');
  await page.evaluate(`(() => {
    if (location.href !== ${JSON.stringify(url)}) throw Error('清空前页面已变化');
    const visible = ${visible};
    const state = ${resultsScript};
    if (state.keyword !== ${JSON.stringify(keyword)} || state.content !== ${JSON.stringify(keyword)}) throw Error('当前搜索词与 --expect-keyword 不符，停止清空');
    if ((!state.ready && !state.emptyCompleted) || state.count !== state.matches.length) throw Error('搜索结果尚未就绪，停止清空');
    const root = [...document.querySelectorAll('.chat-top-search')].find(visible);
    const buttons = [...root.querySelectorAll('.boss-svg.search-close')].filter(visible);
    if (root.__vue__.showClose !== true || buttons.length !== 1) throw Error('搜索框清空按钮缺失或不唯一');
    const button = buttons[0], rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (!hit || !button.contains(hit)) throw Error('搜索框清空按钮不可点击或被遮挡');
    button.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
  })()`);
  try {
    await page.waitForFunction(`(() => {
      if (location.href !== ${JSON.stringify(url)}) throw Error('清空后页面已变化');
      const visible = ${visible};
      const roots = [...document.querySelectorAll('.chat-top-search')];
      if (!roots.length) return [...document.querySelectorAll('.chat-search-btn')].filter(visible).length === 1;
      if (roots.length !== 1) return false;
      const root = roots[0], vm = root.__vue__;
      return root.querySelector('input.search-input')?.value === '' && vm?.content === '' &&
        vm.searchList?.length === 0 && vm.searchGroupList?.length === 0 && vm.showSearchResult === false &&
        !root.querySelector('.geek-search-list li');
    })()`, {timeout});
  } catch (cause) {
    throw new Error(`已点击一次清空，未核验搜索框复位：keyword=${keyword}；${String(cause)}`, {cause});
  }
  return {status:'cleared', keyword, clicked:true};
}

export async function searchChatCandidate(page: Page, options: ChatSearchOptions, timeout = chatSearchTimeoutMs()) {
  const name = options.name.trim();
  if (!name || (options.dataId !== undefined && !options.dataId.trim()) || (options.job !== undefined && !options.job.trim()) || (options.info !== undefined && !options.info.trim())) throw Error('候选人昵称及提供的比较标准不能为空');
  if (!isBossChatIndexUrl(page.url())) throw Error(`chat-search 必须已在沟通页 /web/chat/index；当前=${page.url()}`);
  const context: Omit<ChatSearchFailureDetails, 'diagnostics'> = { stage: 'open-search', timeoutMs: timeout, name, expectedDataId: options.dataId, expectedInfo: options.info, clickState: 'not-attempted', locationVerified: false };
  const infoCondition = options.info === undefined ? '' : ` && x.info === ${JSON.stringify(options.info)}`;
  // 已知会话ID时参与筛选：同名同公司的多条会话按 uniqueId 唯一命中，避免误判为重名而中断。
  const dataIdCondition = options.dataId === undefined ? '' : ` && x.uniqueId === ${JSON.stringify(options.dataId.trim())}`;
  const matchingScript = `s.matches.filter(x => x.name === ${JSON.stringify(name)}${infoCondition}${dataIdCondition})`;
  try {
    context.stage = 'open-search';
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
    if (initial.keyword || initial.content || initial.matches.length || initial.groups) throw Error('沟通搜索已有输入或结果，请先核对现场并显式清空；不覆盖或复用旧搜索');
    // BOSS initializes this marker to boolean false, then sets a numeric result count
    // in the search callback. Never confuse initial false with a completed numeric zero.
    if (initial.resultSignal !== false) throw Error('搜索完成标记不是初始false，无法区分旧结果与本次查询，请先清空搜索');
    // One input event prevents intermediate pinyin/partial-name requests and stale result reuse.
    context.stage = 'input-search';
    await page.evaluate(`(() => {
      const inputs = [...document.querySelectorAll('.chat-top-search input.search-input')].filter(${visible});
      if (inputs.length !== 1 || inputs[0].value) throw Error('输入前搜索框状态已变化');
      const input = inputs[0];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(name)});
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    context.stage = 'wait-search-results';
      await page.waitForFunction(`(() => {
        const s = ${resultsScript};
        return s.keyword === ${JSON.stringify(name)} && s.content === ${JSON.stringify(name)} && s.count === s.matches.length &&
          ((s.ready && (s.count > 0 || s.groups > 0)) || (s.emptyCompleted && s.count === 0 && s.groups === 0));
      })()`, { timeout });
    const { state, matches } = await page.evaluate(`(() => {
      const s = ${resultsScript};
      return { state: s, matches: ${matchingScript} };
    })()`) as { state: SearchState; matches: Match[] };
    if (state.keyword !== name || state.content !== name || state.count !== state.matches.length) throw Error('搜索结果与当前查询不一致');
    const evidence = { info: options.info, searchMatches: state.matches };
    if (matches.length === 0 && state.groups === 0) {
      let reason = 'search-empty';
      if (state.matches.length) {
        const sameName = state.matches.filter(x => x.name === name);
        reason = 'name-no-match';
        if (sameName.length) {
          const idMatches = !options.dataId || sameName.some(x => x.uniqueId === options.dataId!.trim());
          reason = idMatches ? 'info-no-match' : 'data-id-no-match';
        }
      }
      return { status: 'not-found' as const, clicked: false as const, name, matches: [], groupCount: 0, ...evidence, reason };
    }
    if (matches.length !== 1 || state.groups > 0) {
      return { status: 'needs-confirmation' as const, clicked: false, name, matches, groupCount: state.groups, ...evidence, reason: '重名或多个可能匹配项，等待用户手动确认或进一步指令' };
    }
    const match = matches[0]!;
    if (match.name !== name || !match.uniqueId || !match.label) throw Error(`搜索唯一结果身份不完整或昵称不符：${JSON.stringify(match)}`);
    if (options.dataId && match.uniqueId !== options.dataId.trim()) throw Error(`搜索结果会话ID不符：expected=${options.dataId}；actual=${match.uniqueId}`);
    context.stage = 'click-result';
    context.expectedDataId = match.uniqueId;
    const searchUrl = page.url();
    await sleepRandom(500, 1000);
    context.clickState = 'attempted';
    await page.evaluate(`(() => {
      if (location.href !== ${JSON.stringify(searchUrl)}) throw Error('等待期间沟通页已变化，停止点击');
      const s = ${resultsScript};
      const matches = ${matchingScript};
      if (!s.ready || s.keyword !== ${JSON.stringify(name)} || s.content !== ${JSON.stringify(name)} || s.groups || s.count !== s.matches.length || matches.length !== 1 || JSON.stringify(matches[0]) !== ${JSON.stringify(JSON.stringify(match))}) throw Error('点击前搜索身份或结果数量已变化');
      const rows = [...document.querySelectorAll('.chat-top-search .geek-search-list li')];
      const row = rows[s.matches.indexOf(matches[0])];
      if (!(${visible})(row)) throw Error('唯一搜索结果不可见，停止；不展开或改选其他结果');
      row.click();
    })()`);
    context.clickState = 'returned';
    const identityScript = `(() => {
      const rows = [...document.querySelectorAll('.geek-item.selected')];
      const norm = x => (x || '').replace(/\\s+/g,' ').trim();
      return rows.length === 1 && rows[0].getAttribute('data-id') === ${JSON.stringify(match.uniqueId)} && norm(rows[0].querySelector('.geek-name')?.textContent) === ${JSON.stringify(name)} && norm(document.querySelector('.base-info-single-container .name-box')?.textContent) === ${JSON.stringify(name)};
    })()`;
    context.stage = 'wait-candidate-identity';
    await page.waitForFunction(identityScript, { timeout });
    context.stage = 'verify-candidate';
    await assertSelectedConversation(page, {name, dataId:match.uniqueId});
    const conversation = await readSelectedConversation(page);
    const job = await page.evaluate(`(() => document.querySelector('.base-info-single-container .position-item .position-name')?.textContent.trim() || '')()`) as string;
    if ((options.dataId && conversation.dataId !== options.dataId.trim()) || (options.job && job !== options.job.trim())) throw Error(`会话ID或岗位不符：actual=${conversation.dataId} / ${job}`);
    context.locationVerified = true;
    context.verifiedConversation = {name, dataId:conversation.dataId, job};
    context.stage = 'verify-final-identity';
    if (!isBossChatIndexUrl(page.url())) throw Error('定位后已离开沟通页：' + page.url());
    await assertSelectedConversation(page, { name, dataId: match.uniqueId });
    return { status: 'opened' as const, clicked: true, name, dataId: conversation.dataId, job, match, ...evidence };
  } catch (error) {
    throw new ChatSearchFailure({...context, diagnostics: await captureChatSearchDiagnostics(page)}, error);
  }
}
