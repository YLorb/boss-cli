import type { Page } from 'puppeteer-core';
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

export async function searchChatCandidate(page: Page, options: ChatSearchOptions, timeout = chatSearchTimeoutMs()) {
  const name = options.name.trim();
  if (!name || (options.dataId !== undefined && !options.dataId.trim()) || (options.job !== undefined && !options.job.trim()) || (options.info !== undefined && !options.info.trim())) throw Error('候选人昵称及提供的比较标准不能为空');
  if (!isBossChatIndexUrl(page.url())) throw Error(`chat-search 必须已在沟通页 /web/chat/index；当前=${page.url()}`);
  const context: Omit<ChatSearchFailureDetails, 'diagnostics'> = { stage: 'open-search', timeoutMs: timeout, name, expectedDataId: options.dataId, expectedInfo: options.info, clickState: 'not-attempted', locationVerified: false };
  // Only an explicitly supplied, previously observed info enables narrowing.
  // The same predicate is used again immediately before clicking.
  const matchingScript = options.info === undefined ? 's.matches' : `s.matches.filter(x => x.name === ${JSON.stringify(name)} && x.info === ${JSON.stringify(options.info)})`;
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
    if (initial.keyword || initial.content || initial.matches.length || initial.groups) throw Error('沟通搜索已有输入或结果，请先由用户清空；不覆盖或复用旧搜索');
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
    const state = await page.evaluate(resultsScript) as SearchState;
    if (state.keyword !== name || state.content !== name || state.count !== state.matches.length) throw Error('搜索结果与当前查询不一致');
    const matches = options.info === undefined ? state.matches : state.matches.filter(x => x.name === name && x.info === options.info);
    const evidence = { info: options.info, searchMatches: state.matches };
    if (matches.length === 0 && state.groups === 0) {
      return { status: 'not-found' as const, clicked: false as const, name, matches: [], groupCount: 0, ...evidence, reason: state.matches.length ? 'info-no-match' : 'search-empty' };
    }
    if (matches.length !== 1 || state.groups > 0) {
      return { status: 'needs-confirmation' as const, clicked: false, name, matches, groupCount: state.groups, ...evidence, reason: '重名或多个可能匹配项，等待用户手动确认或进一步指令' };
    }
    const match = matches[0]!;
    if (match.name !== name || !match.uniqueId || !match.label) throw Error(`搜索唯一结果身份不完整或昵称不符：${JSON.stringify(match)}`);
    if (options.dataId && match.uniqueId !== options.dataId.trim()) throw Error(`搜索结果会话ID不符：expected=${options.dataId}；actual=${match.uniqueId}`);
    context.stage = 'click-result';
    context.expectedDataId = match.uniqueId;
    context.clickState = 'attempted';
    await page.evaluate(`(() => {
      const s = ${resultsScript};
      const matches = ${matchingScript};
      if (s.keyword !== ${JSON.stringify(name)} || s.content !== ${JSON.stringify(name)} || s.groups || s.count !== s.matches.length || matches.length !== 1 || JSON.stringify(matches[0]) !== ${JSON.stringify(JSON.stringify(match))}) throw Error('点击前搜索身份或结果数量已变化');
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
