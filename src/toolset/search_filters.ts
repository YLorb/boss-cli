import type { Frame } from 'puppeteer-core';
import { SEARCH_STATE_SCRIPT } from './search_query.js';

export type SearchFilters = {city?: string; job: string};
const visible = "(e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')";
const cityLabel = "document.querySelector('.city-wrap .city-label')?.textContent.trim()";
const jobLabel = "document.querySelector('.search-current-job')?.textContent.trim()";
const cityOptions = '.city-wrap .city-box.searching .search-result-item';
const jobOptions = '.search-job-list-C li[ka="search_select_job"]';

// Execute the same exact-text predicate immediately before the one permitted option click.
async function pickOption(frame: Frame, selector: string, label: string, job: boolean) {
  const matches = `[...document.querySelectorAll(${JSON.stringify(selector)})].filter(${visible})
    .filter(el => (${job ? "el.querySelector('.job-name') || el" : "el"}).textContent.trim() === ${JSON.stringify(label)})`;
  await frame.waitForFunction(`${matches}.length > 0`, {timeout:8000});
  await frame.evaluate(`(() => {
    const matches = ${matches};
    if (matches.length !== 1) throw Error('筛选选项未唯一匹配：' + ${JSON.stringify(label)} + ' count=' + matches.length);
    if (${job} && matches[0].classList.contains('active')) {
      document.querySelector('.search-job-list-C .search-current-job').click();
    } else matches[0].click();
  })()`);
}

export async function selectCity(frame: Frame, city: string) {
  if (await frame.evaluate(cityLabel) !== city) {
    await frame.evaluate(`(() => {
      const inputs = [...document.querySelectorAll('.city-wrap .search-city-kw input')].filter(${visible});
      if (inputs.length !== 1) throw Error('城市搜索输入框缺失或不唯一');
      const input = inputs[0];
      input.focus();
      input.value = ${JSON.stringify(city)};
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await pickOption(frame,cityOptions,city,false);
  }
  await frame.waitForFunction(`(() => {
    const s = ${SEARCH_STATE_SCRIPT};
    return ${cityLabel} === ${JSON.stringify(city)} && s.params.cityName === ${JSON.stringify(city)} && !s.loading;
  })()`,{timeout:8000});
}

export function searchFiltersMatch(filters: SearchFilters): string {
  return `(() => {
    const s = ${SEARCH_STATE_SCRIPT};
    return ${filters.city === undefined ? 'true' : `${cityLabel} === ${JSON.stringify(filters.city)} && s.params.cityName === ${JSON.stringify(filters.city)}`} &&
      ${jobLabel} === ${JSON.stringify(filters.job)} && ${filters.job === '不限职位' ? '!s.params.jobId' : '!!s.params.jobId'};
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
    return {city:${cityLabel}, job:${jobLabel}, keyword:s.keyword, jobId:s.params.jobId, cityCode:s.params.city};
  })()`) as Promise<{city:string;job:string;keyword:string;jobId:string;cityCode:string|number}>;
}
