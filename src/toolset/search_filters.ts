import type { Frame } from 'puppeteer-core';
import { SEARCH_STATE_SCRIPT } from './search_query.js';

export type SearchFilters = {city?: string; job: string};
type JobSelection =
  | {status: 'selected'; job: string}
  | {status: 'needs-confirmation'; requestedJob: string; reason: 'not-found' | 'ambiguous'; options: string[]};
const visible = "(e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')";
const cityLabel = "document.querySelector('.city-wrap .city-label')?.textContent.trim()";
const jobLabel = "document.querySelector('.search-current-job')?.textContent.trim()";
const cityOptions = '.city-wrap .city-box.searching .search-result-item';
const jobOptions = '.search-job-list-C li[ka="search_select_job"]';
const cityInput = '.city-wrap .search-city-kw input';
// Tolerate whitespace and the optional 市 suffix; a stricter predicate silently matches nothing and times out.
const norm = "(x => (x || '').replace(/\\s+/g,'').replace(/市$/,''))";

async function pickCityOption(frame: Frame, label: string) {
  const matches = `[...document.querySelectorAll(${JSON.stringify(cityOptions)})].filter(${visible})
    .filter(el => { const n = ${norm}; return n(el.textContent) === n(${JSON.stringify(label)}); })`;
  await frame.waitForFunction(`${matches}.length > 0`, {timeout:8000});
  await frame.evaluate(`(() => {
    const matches = ${matches};
    if (matches.length !== 1) throw Error('筛选选项未唯一匹配：' + ${JSON.stringify(label)} + ' count=' + matches.length);
    matches[0].click();
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
  await pickCityOption(frame, city);
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

export async function selectSearchFilters(frame: Frame, filters: SearchFilters): Promise<JobSelection> {
  if (filters.city) await selectCity(frame, filters.city);
  // Inspect the menu even when the displayed title already matches: duplicate titles cannot identify a job.
  await frame.evaluate(`(() => {
    const controls = [...document.querySelectorAll('.search-job-list-C .search-current-job')].filter(${visible});
    if (controls.length !== 1) throw Error('搜索岗位菜单缺失或不唯一');
    if (![...document.querySelectorAll('${jobOptions}')].some(${visible})) controls[0].click();
  })()`);
  const visibleOptions = `[...document.querySelectorAll(${JSON.stringify(jobOptions)})].filter(${visible})`;
  await frame.waitForFunction(`${visibleOptions}.length > 0`, {timeout:8000});
  const selection = await frame.evaluate(`(() => {
    const requestedJob = ${JSON.stringify(filters.job)};
    const normalize = ${norm};
    const key = normalize(requestedJob);
    const rows = ${visibleOptions}.map(element => ({
      element, label: (element.querySelector('.job-name') || element).textContent.trim()
    }));
    if (!rows.length) throw Error('搜索岗位选项在匹配前已消失');
    const exact = rows.filter(row => normalize(row.label) === key);
    const matches = exact.length ? exact : rows.filter(row => normalize(row.label).startsWith(key));
    if (matches.length !== 1) {
      return {
        status:'needs-confirmation', requestedJob,
        reason:matches.length ? 'ambiguous' : 'not-found',
        options:(matches.length ? matches : rows).map(row => row.label)
      };
    }
    const {element, label} = matches[0];
    if (element.classList.contains('active')) {
      const controls = [...document.querySelectorAll('.search-job-list-C .search-current-job')].filter(${visible});
      if (controls.length !== 1) throw Error('搜索岗位菜单缺失或不唯一');
      controls[0].click();
    } else {
      element.click();
    }
    return {status:'selected', job:label};
  })()`) as JobSelection;
  if (selection.status === 'needs-confirmation') return selection;
  await frame.waitForFunction(`(() => {
    const s = ${SEARCH_STATE_SCRIPT};
    return ${jobLabel} === ${JSON.stringify(selection.job)} && !s.loading && !${visibleOptions}.length;
  })()`,{timeout:8000});
  if (!await frame.evaluate(searchFiltersMatch({city:filters.city || undefined, job:selection.job}))) {
    throw Error('选岗后的城市或岗位核验失败，未提交搜索');
  }
  return selection;
}

export async function readSearchSettings(frame: Frame) {
  return frame.evaluate(`(() => {
    const s = ${SEARCH_STATE_SCRIPT};
    return {city:s.params.cityName || '', job:${jobLabel}, keyword:s.keyword, jobId:s.params.jobId, cityCode:s.params.city};
  })()`) as Promise<{city:string;job:string;keyword:string;jobId:string;cityCode:string|number}>;
}
