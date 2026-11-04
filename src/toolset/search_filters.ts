import type { Frame } from 'puppeteer-core';
import { SEARCH_STATE_SCRIPT } from './search_query.js';

export type SearchFilters = {city?: string; job: string};
const visible = "(e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')";
const cityLabel = "document.querySelector('.city-wrap .city-label')?.textContent.trim()";
const jobLabel = "document.querySelector('.search-current-job')?.textContent.trim()";
const cityOptions = '.city-wrap .city-box.searching .search-result-item';
const jobOptions = '.search-job-list-C li[ka="search_select_job"]';
const cityInput = '.city-wrap .search-city-kw input';
// Tolerate whitespace and the optional 市 suffix; a stricter predicate silently matches nothing and times out.
const norm = "(x => (x || '').replace(/\\s+/g,'').replace(/市$/,''))";

// Execute the same normalized-text predicate immediately before the one permitted option click.
async function pickOption(frame: Frame, selector: string, label: string, job: boolean) {
  const matches = `[...document.querySelectorAll(${JSON.stringify(selector)})].filter(${visible})
    .filter(el => { const n = ${norm}; return n((${job ? "el.querySelector('.job-name') || el" : "el"}).textContent) === n(${JSON.stringify(label)}); })`;
  await frame.waitForFunction(`${matches}.length > 0`, {timeout:8000});
  await frame.evaluate(`(() => {
    const matches = ${matches};
    if (matches.length !== 1) throw Error('筛选选项未唯一匹配：' + ${JSON.stringify(label)} + ' count=' + matches.length);
    if (${job} && matches[0].classList.contains('active')) {
      document.querySelector('.search-job-list-C .search-current-job').click();
    } else matches[0].click();
  })()`);
}

async function firstVisible(frame: Frame, selector: string) {
  for (const h of await frame.$$(selector)) {
    if (await h.evaluate((el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')) return h;
  }
  return null;
}

// Typing alone only fills the box and never produces a selectable result: the box must be opened and typed
// into with real key events, otherwise the option list never renders and the wait times out.
async function fillCityInput(frame: Frame, city: string) {
  let input = await firstVisible(frame, cityInput);
  if (!input) {
    const opener = await firstVisible(frame, '.city-wrap .city-label') || await firstVisible(frame, '.city-wrap');
    if (!opener) throw Error('城市筛选入口缺失');
    await opener.click();
    await new Promise(r => setTimeout(r, 400));
    input = await firstVisible(frame, cityInput);
    if (!input) throw Error('城市搜索输入框缺失');
  }
  await input.click();
  await input.evaluate((el: Element) => {
    const i = el as HTMLInputElement;
    i.value = '';
    i.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await frame.page().keyboard.type(city, {delay:60});
}

export async function selectCity(frame: Frame, city: string) {
  const n = (x?: string) => (x || '').replace(/\s+/g, '').replace(/市$/, '');
  // The visible city label no longer exists in the current layout; the bound params are authoritative.
  const current = await frame.evaluate(`(() => {
    const s = ${SEARCH_STATE_SCRIPT};
    return {name:s.params.cityName || '', label:${cityLabel} || ''};
  })()`) as {name: string; label: string};
  if (n(current.name) === n(city) || n(current.label) === n(city)) return;
  await fillCityInput(frame, city);
  await pickOption(frame, cityOptions, city, false);
  await frame.waitForFunction(`(() => {
    const s = ${SEARCH_STATE_SCRIPT};
    const n = ${norm};
    return n(s.params.cityName) === n(${JSON.stringify(city)}) && !s.loading;
  })()`,{timeout:8000});
}

export function searchFiltersMatch(filters: SearchFilters): string {
  return `(() => {
    const s = ${SEARCH_STATE_SCRIPT};
    const n = ${norm};
    return ${filters.city === undefined ? 'true' : `n(s.params.cityName) === n(${JSON.stringify(filters.city)})`} &&
      n(${jobLabel}) === n(${JSON.stringify(filters.job)}) && ${filters.job === '不限职位' ? '!s.params.jobId' : '!!s.params.jobId'};
  })()`;
}

export async function selectSearchFilters(frame: Frame, filters: SearchFilters) {
  if (filters.city !== undefined) await selectCity(frame, filters.city);
  // Inspect the menu even when the displayed title already matches: duplicate titles cannot identify a job.
  await frame.evaluate(`(() => {
    const controls = [...document.querySelectorAll('.search-job-list-C .search-current-job')].filter(${visible});
    if (controls.length !== 1) throw Error('搜索岗位菜单缺失或不唯一');
    if (![...document.querySelectorAll('${jobOptions}')].some(${visible})) controls[0].click();
  })()`);
  await pickOption(frame,jobOptions,filters.job,true);
  await frame.waitForFunction(`(() => {
    const s = ${SEARCH_STATE_SCRIPT};
    return ${jobLabel} === ${JSON.stringify(filters.job)} && !s.loading && ![...document.querySelectorAll('${jobOptions}')].some(${visible});
  })()`,{timeout:8000});
  if (filters.city !== undefined && await frame.evaluate(cityLabel) !== filters.city) await selectCity(frame, filters.city);
  if (!await frame.evaluate(searchFiltersMatch(filters))) throw Error('搜索城市或岗位核验失败，未提交关键词');
}

export async function readSearchSettings(frame: Frame) {
  return frame.evaluate(`(() => {
    const s = ${SEARCH_STATE_SCRIPT};
    return {city:s.params.cityName || '', job:${jobLabel}, keyword:s.keyword, jobId:s.params.jobId, cityCode:s.params.city};
  })()`) as Promise<{city:string;job:string;keyword:string;jobId:string;cityCode:string|number}>;
}
