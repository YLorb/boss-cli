import type { Frame, Page } from 'puppeteer-core';
import { RESUME_PREVIEW_OPEN_GAP_MS, sleepRandom } from '../browser/index.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { ensurePage } from '../common/ensure_page.js';
import { selectCity, readSearchSettings, selectSearchFilters, searchFiltersMatch, type SearchFilters } from './search_filters.js';
import { SEARCH_STATE_SCRIPT, submitSearchQuery, searchMatchesEvidenceScript, type SearchQueryEvidence } from './search_query.js';

const BOSS_CHAT_SEARCH_URL = 'https://www.zhipin.com/web/chat/search';
const SEARCH_FRAME_READY_TIMEOUT_MS = 18_000;

export type NormalSearchCandidate = {
  candidateId: string;
  name: string;
  active: string;
  labels: string[];
  basicInfo: string;
  summary: string;
  tags: string[];
  expectation: string;
  work: string[];
  education: string;
  reason: string;
  contactText: string;
};

export function isBossChatSearchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('zhipin.com')) {
      return false;
    }
    const p = u.pathname.replace(/\/+$/, '') || '/';
    return p === '/web/chat/search';
  } catch {
    return false;
  }
}

async function getSearchFrame(page: Page): Promise<Frame> {
  const iframe = await page.waitForSelector('iframe[name="searchFrame"]', {
    timeout: SEARCH_FRAME_READY_TIMEOUT_MS,
  });
  if (!iframe) {
    throw new Error('未找到常规搜索 iframe（iframe[name="searchFrame"]）。');
  }

  const deadline = Date.now() + SEARCH_FRAME_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const frame = await iframe.contentFrame();
    if (frame && frame.url().includes('/web/frame/search')) {
      return frame;
    }
    await sleepRandom(120, 220);
  }

  const iframeSrc = (await page.evaluate(
    `(() => document.querySelector('iframe[name="searchFrame"]')?.getAttribute("src") ?? "")()`,
  )) as string;
  const frameUrls = page.frames().map((f) => f.url()).join(' | ');
  throw new Error(
    `已检测到常规搜索 iframe，但无法获取其页面上下文。iframe src：${iframeSrc || 'unknown'}；frames：${frameUrls || 'empty'}`,
  );
}

async function ensureSearchFrameReady(frame: Frame): Promise<void> {
  await frame.waitForFunction(
    `(() => {
      const input = document.querySelector(".search-input");
      if (!(input instanceof HTMLInputElement)) return false;
      const hasCard = document.querySelectorAll(".geek-info-card").length > 0;
      const empty = document.querySelector(".empty-tips");
      const s=${SEARCH_STATE_SCRIPT};
      return !s.loading && s.initializing===false && (hasCard || !!empty) && JSON.stringify(s.cards)===JSON.stringify(s.rendered);
    })()`,
    { timeout: SEARCH_FRAME_READY_TIMEOUT_MS },
  );
}

async function ensureInNormalSearchPage(page: Page): Promise<Frame> {
  await ensurePage(page, {
    name: '常规搜索页',
    targetUrl: BOSS_CHAT_SEARCH_URL,
    matches: isBossChatSearchUrl,
  });
  const frame = await getSearchFrame(page);
  await ensureSearchFrameReady(frame);
  return frame;
}

export async function assertNormalSearchPageReadyForPreview(page: Page): Promise<Frame> {
  if (!isBossChatSearchUrl(page.url())) {
    throw new Error('当前不在常规搜索页（/web/chat/search），请先通过 boss search 进入。');
  }
  const frame = await getSearchFrame(page);
  await ensureSearchFrameReady(frame);
  return frame;
}

async function runKeywordSearch(frame: Frame, keyword: string, filters?: SearchFilters, submitOnly = false): Promise<SearchQueryEvidence> {
  const kwLiteral = JSON.stringify(keyword);
  return submitSearchQuery(frame,keyword,async()=>{
  const ok = (await frame.evaluate(`(() => {
    const input = document.querySelector(".search-input");
    if (!(input instanceof HTMLInputElement)) return false;
    const kw = ${kwLiteral};
    ${submitOnly ? `if(input.value !== kw)throw Error('提交前关键词变化');` : `input.focus();
    input.value = kw;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));`}
    ${filters ? `if (!(${searchFiltersMatch(filters)}) || input.value !== kw) throw Error('提交前搜索条件变化');
    const buttons = [...document.querySelectorAll('.search-container .icon-search')].filter(el => el.getClientRects().length && el.textContent.trim()==='搜索');
    if (buttons.length !== 1) throw Error('搜索按钮缺失或不唯一');
    buttons[0].click();` : `
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    }));
    input.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    }));`}
    return true;
  })()`)) as boolean;
  if (!ok) {
    throw new Error('未找到常规搜索关键词输入框（.search-input）。');
  }

  },20_000,filters?.city);
}

export type SearchControl = {action:'city'|'job'|'keyword'|'submit';value?:string};

export async function runSearchControl(control:SearchControl,json=false):Promise<string> {
  return withBossSessionPage(async page=>{
    const frame=await assertNormalSearchPageReadyForPreview(page);
    const before=await readSearchSettings(frame);
    let evidence:SearchQueryEvidence|undefined;
    if(control.action==='city') await selectCity(frame,control.value!);
    if(control.action==='job') await selectSearchFilters(frame,{city:before.city,job:control.value!});
    if(control.action==='keyword') {
      await frame.evaluate(`(() => {
        const inputs=[...document.querySelectorAll('.search-input')].filter(el=>el.getClientRects().length);
        if(inputs.length!==1)throw Error('关键词输入框缺失或不唯一');
        const input=inputs[0];
        input.focus();input.value=${JSON.stringify(control.value)};
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
    }
    if(control.action==='submit') {
      if(!before.keyword?.trim()||!before.city||!before.job)throw Error('提交前须明确城市、岗位和非空关键词');
      evidence=await runKeywordSearch(frame,before.keyword,{city:before.city,job:before.job},true);
    }
    const settings=await readSearchSettings(frame);
    if(control.action==='city'&&settings.city!==control.value ||
       control.action==='job'&&(settings.job!==control.value||settings.city!==before.city) ||
       control.action==='keyword'&&(settings.keyword!==control.value||settings.city!==before.city||settings.job!==before.job)) throw Error('独立设置后的搜索条件核验失败');
    if(evidence&&!await frame.evaluate(searchMatchesEvidenceScript(evidence)))throw Error('提交后结果发生变化');
    const candidates=evidence?await readNormalSearchCandidates(frame):undefined;
    if(evidence&&JSON.stringify(candidates!.map(c=>c.candidateId))!==JSON.stringify(evidence.cards.map(c=>c.id)))throw Error('候选人结果与本次提交不符');
    if(evidence&&(!await frame.evaluate(searchMatchesEvidenceScript(evidence)) ||
      !await frame.evaluate(searchFiltersMatch({city:before.city,job:before.job}))))throw Error('读取结果期间搜索条件变化');
    const result={action:control.action,submitted:!!evidence,...settings,...(candidates&&{candidates})};
    return json?JSON.stringify(result):JSON.stringify(result,null,2);
  });
}

async function readNormalSearchKeyword(frame: Frame): Promise<string> {
  return (await frame.evaluate(
    `(() => document.querySelector(".search-input")?.value?.trim() ?? "")()`,
  )) as string;
}

async function readCurrentSearchJob(frame: Frame): Promise<string> {
  return (await frame.evaluate(
    `(() => (document.querySelector(".search-current-job")?.textContent ?? "").replace(/\\s+/g, " ").trim())()`,
  )) as string;
}

export async function readNormalSearchSelectedJobLabel(frame: Frame): Promise<string> {
  const label = await readCurrentSearchJob(frame);
  return label || '默认';
}

export async function openNormalSearchResumePreview(frame: Frame, target: string, candidateId?: string): Promise<boolean> {
  const targetLiteral = JSON.stringify(target.trim());
  const opened = (await frame.evaluate(`(() => {
    const raw = ${targetLiteral};
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const cards = Array.from(document.querySelectorAll(".geek-info-card"));
    const matches = cards.filter(item => norm(item.querySelector(".name-label")?.textContent) === raw && (!${JSON.stringify(candidateId)} || item.__vue__?.$props?.geek?.geekCard?.encryptGeekId === ${JSON.stringify(candidateId)}));
    if (matches.length !== 1) throw new Error('候选人姓名须唯一精确匹配：' + raw + '；candidateId=' + ${JSON.stringify(candidateId)} + '；matches=' + matches.length);
    const targetCard = matches[0];
    const geek = targetCard.__vue__?.$props?.geek?.geekCard;
    if (!geek?.encryptGeekId || norm(geek.name) !== raw) throw new Error("候选人卡片姓名或ID缺失/不符");

    function tryOpen(el) {
      if (!(el instanceof HTMLElement)) return false;
      const st = window.getComputedStyle(el);
      if (st.pointerEvents === "none" || Number(st.opacity) < 0.3) return false;
      el.scrollIntoView({ block: "center", inline: "nearest" });
      el.click();
      return true;
    }

    return tryOpen(targetCard.querySelector(".name-label"));
  })()`)) as boolean;
  if (opened) {
    await sleepRandom(RESUME_PREVIEW_OPEN_GAP_MS.min, RESUME_PREVIEW_OPEN_GAP_MS.max);
  }
  return opened;
}

export async function readNormalSearchCandidates(frame: Frame): Promise<NormalSearchCandidate[]> {
  return (await frame.evaluate(`(() => {
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const unique = (items) => Array.from(new Set(items.map(norm).filter(Boolean)));
    return Array.from(document.querySelectorAll(".geek-info-card")).map((card) => {
      const labels = unique(Array.from(card.querySelectorAll(".card-label")).map((el) => el.textContent));
      const tags = unique(
        Array.from(card.querySelectorAll(".info-tags:not(.info-tags-measure) .info-tags-item"))
          .map((el) => el.textContent),
      );
      const work = Array.from(card.querySelectorAll(".work-exp-box .work-exp-item"))
        .map((el) => norm(el.textContent))
        .filter(Boolean);
      return {
        candidateId: typeof card.__vue__?.$props?.geek?.geekCard?.encryptGeekId === 'string' ? card.__vue__.$props.geek.geekCard.encryptGeekId : '',
        name: norm(card.querySelector(".name-label")?.textContent),
        active: norm(card.querySelector(".active-desc-text")?.textContent),
        labels,
        basicInfo: norm(card.querySelector(".info-labels")?.textContent),
        summary: norm(card.querySelector(".info-detail")?.textContent),
        tags,
        expectation: norm(card.querySelector(".expect-exp-box")?.textContent),
        work,
        education: norm(card.querySelector(".edu-exp-box")?.textContent),
        reason: norm(card.querySelector(".recommend-reason")?.textContent),
        contactText: norm(card.querySelector(".btn-getcontact")?.textContent),
      };
    }).filter((item) => item.name);
  })()`)) as NormalSearchCandidate[];
}

function renderNormalSearchCandidates(
  candidates: NormalSearchCandidate[],
  meta: { keyword: string; job: string },
): string {
  const titleKeyword = meta.keyword ? `关键词：${meta.keyword}` : '关键词：默认/热门词';
  const lines = [
    `常规搜索结果（${titleKeyword}${meta.job ? `；当前岗位：${meta.job}` : ''}）`,
    `共 ${candidates.length} 人`,
  ];
  if (candidates.length === 0) {
    return lines.join('\n');
  }

  lines.push('');
  candidates.forEach((item, idx) => {
    const labelText = item.labels.length > 0 ? `｜标签:${item.labels.join('/')}` : '';
    const activeText = item.active ? `｜${item.active}` : '';
    lines.push(`${idx + 1}. ${item.name}${activeText}${item.basicInfo ? `｜${item.basicInfo}` : ''}${labelText}`);
    if (item.summary) {
      lines.push(`   摘要: ${item.summary}`);
    }
    if (item.tags.length > 0) {
      lines.push(`   亮点: ${item.tags.join(' / ')}`);
    }
    if (item.expectation) {
      lines.push(`   ${item.expectation}`);
    }
    if (item.work.length > 0) {
      lines.push(`   经历: ${item.work.join('；')}`);
    }
    if (item.education) {
      lines.push(`   ${item.education}`);
    }
    if (item.reason) {
      lines.push(`   ${item.reason}`);
    }
  });
  return lines.join('\n');
}

export async function runNormalSearch(keyword?: string, json = false, filters?: SearchFilters): Promise<string> {
  const kw = (keyword ?? '').trim();
  if (kw.length > 20) {
    throw new Error('常规搜索关键词最多 20 个字符。');
  }
  try {
    return await withBossSessionPage(async (page) => {
      const frame = filters ? await assertNormalSearchPageReadyForPreview(page) : await ensureInNormalSearchPage(page);
      if (filters) await selectSearchFilters(frame, filters);
      let evidence:SearchQueryEvidence|undefined;
      if (kw) {
        evidence=await runKeywordSearch(frame, kw, filters);
      }

      const [currentKeyword, currentJob, candidates] = await Promise.all([
        readNormalSearchKeyword(frame),
        readCurrentSearchJob(frame),
        readNormalSearchCandidates(frame),
      ]);
      if(evidence && !(await frame.evaluate(searchMatchesEvidenceScript(evidence))))throw Error('读取结果期间搜索条件或列表已变化，停止');
      if(evidence && JSON.stringify(candidates.map(x=>x.candidateId))!==JSON.stringify(evidence.cards.map(x=>x.id)))throw Error('输出候选人与本次搜索响应不一致');
      if (filters && !await frame.evaluate(searchFiltersMatch(filters))) throw Error('读取结果期间城市或岗位变化');
      if (json) return JSON.stringify({ keyword: currentKeyword || kw, job: currentJob, ...(filters && {city:filters.city}), candidates });
      return renderNormalSearchCandidates(candidates, {
        keyword: currentKeyword || kw,
        job: currentJob,
      });
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`读取常规搜索列表失败：${message}`);
  }
}
