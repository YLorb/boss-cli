import type { Frame, HTTPRequest, HTTPResponse, Page } from 'puppeteer-core';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { hasOnlineResumePanel } from './back.js';
import { assertNormalSearchPageReadyForPreview, readNormalSearchCandidates, type NormalSearchCandidate } from './normal-search.js';
import { SEARCH_STATE_SCRIPT, responseCards } from './search_query.js';

export type SearchMoreOptions = { maxScrolls: number; maxCandidates: number; timeoutMs: number };
type Identity = { id: string; lid: string };
type SearchState = {
  loading: boolean; initializing: boolean; keyword: string;
  params: { keywords: string; jobId: string; page: number };
  rendered: Identity[]; cards: Identity[];
};
const ENDPOINT = '/wapi/zpitem/web/boss/search/geeks.json';

export function parseSearchMoreArgs(args: string[]): SearchMoreOptions {
  const values = new Map<string, number>();
  for (let i = 0; i < args.length; i++) {
    const match = /^--(max-scrolls|max-candidates|timeout-ms)(?:=(.*))?$/.exec(args[i]);
    if (!match || values.has(match[1])) throw new Error('search-more 参数未知或重复；必须提供 --max-scrolls 和 --max-candidates');
    const value = match[2] === undefined ? args[++i] : match[2];
    if (value === undefined || !/^\d+$/.test(value)) throw new Error(`--${match[1]} 需要整数值`);
    values.set(match[1], Number(value));
  }
  const options = { maxScrolls: values.get('max-scrolls')!, maxCandidates: values.get('max-candidates')!, timeoutMs: values.get('timeout-ms') ?? 10000 };
  validateSearchMoreOptions(options);
  return options;
}

export function validateSearchMoreOptions(options: SearchMoreOptions): void {
  for (const [name, value, min, max] of [
    ['max-scrolls', options.maxScrolls, 1, 20],
    ['max-candidates', options.maxCandidates, 1, 500],
    ['timeout-ms', options.timeoutMs, 1000, 15000],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`--${name} 必须为 ${min}–${max} 的整数`);
  }
}

function assertSearchUrl(page: Page, beforeUrl?: string): void {
  const url = new URL(page.url());
  if (url.origin !== 'https://www.zhipin.com' || url.username || url.password ||
      url.pathname.replace(/\/$/, '') !== '/web/chat/search' || (beforeUrl !== undefined && page.url() !== beforeUrl)) {
    throw new Error(`扩池要求保持当前常规搜索页，不导航：${page.url()}`);
  }
}

function validateState(state: SearchState, initial?: SearchState): void {
  if (state.loading !== false || state.initializing !== false) throw new Error('搜索列表仍在加载，停止扩池');
  if (typeof state.keyword !== 'string' || state.keyword !== state.params.keywords || typeof state.params.jobId !== 'string' ||
      !Number.isSafeInteger(state.params.page) || state.params.page < 1) throw new Error('搜索条件或页码缺失／不一致');
  if (initial && (state.keyword !== initial.keyword || state.params.jobId !== initial.params.jobId)) throw new Error('扩池期间关键词或岗位变化，停止');
  if (!Array.isArray(state.cards) || !Array.isArray(state.rendered) || JSON.stringify(state.cards) !== JSON.stringify(state.rendered)) {
    throw new Error('搜索组件与已渲染候选人不一致，停止');
  }
  const ids = new Set<string>();
  for (const card of state.cards) {
    if (typeof card.id !== 'string' || !card.id || typeof card.lid !== 'string' || !card.lid || ids.has(card.id)) {
      throw new Error('当前列表候选人 ID／查询标识缺失或 ID 重复，停止');
    }
    ids.add(card.id);
  }
}

async function snapshot(page: Page, frame: Frame, beforeUrl: string, initial?: SearchState) {
  assertSearchUrl(page, beforeUrl);
  const state = await frame.evaluate(SEARCH_STATE_SCRIPT) as SearchState;
  validateState(state, initial);
  const candidates = await readNormalSearchCandidates(frame);
  const after = await frame.evaluate(SEARCH_STATE_SCRIPT) as SearchState;
  validateState(after, initial);
  if (JSON.stringify(state) !== JSON.stringify(after) ||
      JSON.stringify(candidates.map(c => c.candidateId)) !== JSON.stringify(state.cards.map(c => c.id))) {
    throw new Error('读取扩池快照时列表已变化或身份缺失，停止');
  }
  assertSearchUrl(page, beforeUrl);
  return { state, candidates };
}

/** One scroll in the search iframe's document. Unsupported layouts stop; there is no alternative container. */
function scrollScript(state: SearchState): string {
  return `(() => {
    const s=${SEARCH_STATE_SCRIPT};
    if(JSON.stringify(s)!==${JSON.stringify(JSON.stringify(state))})throw Error('滚动前搜索状态已变化');
    const root=document.scrollingElement;
    if(!root || root.clientHeight<=0 || root.scrollHeight<=root.clientHeight || root.scrollTop>=root.scrollHeight-root.clientHeight-1)
      throw Error('搜索 iframe 文档没有可执行的向下滚动；不改用其他容器或刷新');
    root.scrollTop=root.scrollHeight;
  })()`;
}

/** Observe the UI's next-page request. Never issue an API request or call a component method. */
async function scrollNext(page: Page, frame: Frame, beforeUrl: string, state: SearchState, timeoutMs: number) {
  const nextPage = state.params.page + 1;
  let request: HTTPRequest | undefined;
  let requestCount = 0;
  let violation: Error | undefined;
  let finish!: (value: { cards?: Identity[]; error?: Error }) => void;
  const response = new Promise<{ cards?: Identity[]; error?: Error }>(resolve => { finish = resolve; });
  const stop = (message: string) => { violation = new Error(message); finish({ error: violation }); };
  const onRequest = (req: HTTPRequest) => {
    const url = new URL(req.url());
    if (req.frame() !== frame || url.pathname !== ENDPOINT) return;
    requestCount++;
    if (requestCount !== 1 || url.origin !== 'https://www.zhipin.com' ||
        url.searchParams.get('keywords') !== state.keyword || (url.searchParams.get('jobId') || '') !== state.params.jobId ||
        url.searchParams.get('page') !== String(nextPage)) {
      stop(`扩池请求重复或条件／页码变化：expectedPage=${nextPage}；requests=${requestCount}`);
      return;
    }
    request = req;
  };
  const onResponse = async (res: HTTPResponse) => {
    if (!request || res.request() !== request) return;
    try {
      if (!res.ok()) throw new Error(`扩池请求 HTTP 失败：${res.status()}`);
      finish({ cards: responseCards(await res.json()) });
    } catch (error) { stop(error instanceof Error ? error.message : String(error)); }
  };
  const onFailed = (req: HTTPRequest) => { if (req === request) stop(`扩池请求失败：${req.failure()?.errorText}`); };
  page.on('request', onRequest); page.on('response', onResponse); page.on('requestfailed', onFailed);
  const deadline = Date.now() + timeoutMs;
  const timer = setTimeout(() => stop(`扩池等待超时：page=${nextPage}；requests=${requestCount}；timeoutMs=${timeoutMs}`), timeoutMs);
  try {
    assertSearchUrl(page, beforeUrl);
    if (await hasOnlineResumePanel(page)) throw new Error('在线简历仍打开，停止扩池');
    await frame.evaluate(scrollScript(state));
    const outcome = await response;
    if (outcome.error) throw outcome.error;
    const cards = outcome.cards!;
    const remaining = deadline - Date.now();
    if (violation) throw violation;
    if (remaining <= 0) throw new Error('扩池响应完成后已超时，停止');
    await frame.waitForFunction(`(() => {
      const s=${SEARCH_STATE_SCRIPT};
      if(s.keyword!==${JSON.stringify(state.keyword)} || s.params.keywords!==${JSON.stringify(state.keyword)} ||
        s.params.jobId!==${JSON.stringify(state.params.jobId)})throw Error('扩池期间搜索条件变化');
      return !s.loading && s.initializing===false && s.params.page===${nextPage} &&
        JSON.stringify(s.cards)===JSON.stringify(s.rendered) &&
        ${JSON.stringify(cards)}.every(c=>s.cards.some(x=>x.id===c.id && x.lid===c.lid));
    })()`, { timeout: remaining, polling: 100 });
    const result = await snapshot(page, frame, beforeUrl, state);
    // An empty response must not erase earlier results; nonempty responses may append or virtualize.
    const allowed = new Set([...state.cards, ...cards].map(c => `${c.id}\0${c.lid}`));
    if (result.state.cards.some(c => !allowed.has(`${c.id}\0${c.lid}`)) ||
        (cards.length === 0 && JSON.stringify(result.state.cards) !== JSON.stringify(state.cards))) {
      throw new Error('扩池页面包含未归属本轮响应的结果，停止');
    }
    if (violation) throw violation;
    if (Date.now() > deadline) throw new Error('扩池核验超时，停止');
    return { ...result, responseCount: cards.length };
  } finally {
    clearTimeout(timer);
    page.off('request', onRequest); page.off('response', onResponse); page.off('requestfailed', onFailed);
  }
}

export async function expandSearchPool(page: Page, options: SearchMoreOptions) {
  validateSearchMoreOptions(options);
  assertSearchUrl(page);
  const beforeUrl = page.url();
  if (await hasOnlineResumePanel(page)) throw new Error('请先通过 back --if-open 关闭在线简历，再显式扩池');
  const frame = await assertNormalSearchPageReadyForPreview(page);
  const frameUrl = new URL(frame.url());
  if (frameUrl.origin !== 'https://www.zhipin.com' || frameUrl.pathname.replace(/\/$/, '') !== '/web/frame/search') {
    throw new Error('搜索 iframe 地址不符，停止');
  }
  let current = await snapshot(page, frame, beforeUrl);
  const pool = new Map<string, NormalSearchCandidate>();
  let duplicatesSkipped = 0;
  const add = (candidates: NormalSearchCandidate[]) => {
    for (const candidate of candidates) {
      if (!candidate.candidateId || !candidate.name) throw new Error('扩池候选人 ID 或姓名缺失');
      const previous = pool.get(candidate.candidateId);
      if (previous) {
        if (previous.name !== candidate.name) throw new Error(`同一候选人 ID 姓名变化：${candidate.candidateId}`);
        duplicatesSkipped++;
      } else if (pool.size < options.maxCandidates) pool.set(candidate.candidateId, candidate);
    }
  };
  add(current.candidates);
  const initialCount = pool.size;
  let scrolls = 0;
  let stopReason = 'max-scrolls';
  while (scrolls < options.maxScrolls) {
    if (pool.size >= options.maxCandidates) { stopReason = 'max-candidates'; break; }
    try {
      const next = await scrollNext(page, frame, beforeUrl, current.state, options.timeoutMs);
      scrolls++;
      const beforeCount = pool.size;
      add(next.candidates);
      current = next;
      if (next.responseCount === 0) { stopReason = 'empty-response'; break; }
      if (pool.size >= options.maxCandidates) { stopReason = 'max-candidates'; break; }
      if (pool.size === beforeCount) { stopReason = 'no-new-candidates'; break; }
    } catch (error) {
      throw new Error(`搜索扩池失败，已完成滚动=${scrolls}；已收集=${pool.size}；本次滚动可能已发生，不重试：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { keyword: current.state.keyword, jobId: current.state.params.jobId, ...options, scrolls, initialCount,
    addedCount: pool.size - initialCount, duplicatesSkipped, stopReason, candidates: [...pool.values()] };
}

export async function runSearchMore(options: SearchMoreOptions, json = false): Promise<string> {
  validateSearchMoreOptions(options);
  return withBossSessionPage(async page => {
    const result = await expandSearchPool(page, options);
    return json ? JSON.stringify(result) : `搜索扩池：${result.candidates.length} 人，新增 ${result.addedCount} 人，滚动 ${result.scrolls} 次；停止原因=${result.stopReason}\n` +
      result.candidates.map(c => `${c.name} | ${c.candidateId}`).join('\n');
  }, { ensureChatShell: false, ensureMenuList: false });
}
