import type { Page } from 'puppeteer-core';
import { CHAT_SEARCH_MATCH_SCRIPT } from './chat_search_match.js';

export function chatSearchTimeoutMs(): number {
  const value = process.env.BOSS_CHAT_SEARCH_TIMEOUT_MS;
  if (value === undefined) return 20_000;
  if (!/^\d+$/.test(value) || Number(value) < 1_000 || Number(value) > 60_000) {
    throw new Error('BOSS_CHAT_SEARCH_TIMEOUT_MS 必须为 1000–60000 的整数毫秒；未设置时为 20000');
  }
  return Number(value);
}

// One readonly snapshot at failure time. No DOM changes, message bodies or full-page dump.
export const CHAT_SEARCH_DIAGNOSTICS_SCRIPT = `(() => {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  const norm = v => (v || '').replace(/\\s+/g, ' ').trim();
  const selectors = ['.chat-top-job .ui-dropmenu-label', '.chat-top-job .ui-dropmenu-list li', '.chat-search-btn', '.chat-top-search', '.chat-top-search input.search-input', '.chat-top-search .geek-search-list li', '.geek-item', '.geek-item.selected', '.base-info-single-container', '.base-info-single-container .name-box', '.base-info-single-container .position-item .position-name'];
  const counts = Object.fromEntries(selectors.map(selector => {
    const nodes = [...document.querySelectorAll(selector)];
    return [selector, {total:nodes.length, visible:nodes.filter(visible).length}];
  }));
  const selected = [...document.querySelectorAll('.geek-item.selected')].map(el => ({dataId:el.getAttribute('data-id'), name:norm(el.querySelector('.geek-name')?.textContent), visible:visible(el)}));
  const details = [...document.querySelectorAll('.base-info-single-container')].map(el => ({name:norm(el.querySelector('.name-box')?.textContent), job:norm(el.querySelector('.position-item .position-name')?.textContent), visible:visible(el)}));
  const jobLabels = [...document.querySelectorAll('.chat-top-job .ui-dropmenu-label')].map(el => ({label:norm(el.textContent), visible:visible(el)}));
  const search = [...document.querySelectorAll('.chat-top-search')].map(el => {
    const vm=el.__vue__, rows=[...el.querySelectorAll('.geek-search-list li')];
    return {visible:visible(el), keyword:el.querySelector('input.search-input')?.value ?? null, content:vm?.content ?? null, resultSignal:vm?.showSearchResult ?? null, ready:vm ? Boolean(vm.showSearchResult) : null,
      matches:Array.isArray(vm?.searchList) ? vm.searchList.map((x,i) => ${CHAT_SEARCH_MATCH_SCRIPT}(x,rows[i])) : null,
      groupCount:Array.isArray(vm?.searchGroupList) ? vm.searchGroupList.length : null};
  });
  return {at:new Date().toISOString(), url:location.origin+location.pathname, readyState:document.readyState, viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}, counts, selected, details, jobLabels, search};
})()`;

export async function captureChatSearchDiagnostics(page: Page): Promise<unknown> {
  try {
    return await page.evaluate(CHAT_SEARCH_DIAGNOSTICS_SCRIPT);
  } catch (error) {
    // Diagnostic failure is explicit and must not replace the original business error.
    return { at: new Date().toISOString(), diagnosticError: error instanceof Error ? error.message : String(error) };
  }
}
