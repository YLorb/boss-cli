import type { ElementHandle, Frame, Page } from 'puppeteer-core';
import {
  JOB_SEARCH_ACTION_GAP_MS,
  JOB_SELECT_ACTION_GAP_MS,
  RESUME_PREVIEW_OPEN_GAP_MS,
  sleepRandom,
} from '../browser/index.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { ensurePage } from '../common/ensure_page.js';
import { RECOMMEND_CARD_ROOT_SELECTOR, recommendTargetScript } from './recommend_identity.js';
import { recommendJobKey, recommendJobQuery } from './recommend_job.js';

const BOSS_CHAT_RECOMMEND_URL = 'https://www.zhipin.com/web/chat/recommend';

export type RecommendCandidate = {
  geekId: string;
  name: string;
  salary: string;
  baseInfo: string;
  expect: string;
  experience: string;
  work: string[];
  education: string[];
  advantage: string;
  highlights: string[];
  canGreet: boolean;
  hasHistoryChat: boolean;
  /** 卡片为灰色「已看过」样式（如 `.candidate-card-wrap.has-viewed` / `.card-inner.has-viewed`） */
  hasViewed: boolean;
};
/** 会话内记录：通过 greet 新出现的推荐卡片（以 geekId 识别） */
const sessionGreetProducedGeekIds = new Set<string>();

/**
 * 推荐列表每张候选人只读取 `.candidate-card-wrap`，外层列表项不作为第二张卡片。
 * 在线简历预览：点击卡片主体 `.card-inner`，而非「在线简历」链接或「打招呼」。
 */

export function isBossChatRecommendUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('zhipin.com')) {
      return false;
    }
    const p = u.pathname.replace(/\/+$/, '') || '/';
    return p === '/web/chat/recommend';
  } catch {
    return false;
  }
}

export async function readCurrentRecommendJobLabel(frame: Frame): Promise<string> {
  return (await frame.evaluate(`(() => {
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    return norm(document.querySelector(".job-selecter-wrap .ui-dropmenu-label")?.textContent);
  })()`)) as string;
}

async function waitForRecommendJobDropdownReady(frame: Frame): Promise<void> {
  await frame.waitForFunction(
    `(() => {
      const options = document.querySelector(".job-selecter-options");
      if (!(options instanceof HTMLElement)) return false;
      const rect = options.getBoundingClientRect();
      const style = window.getComputedStyle(options);
      if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      return !!options.querySelector(".top-chat-search .chat-job-search");
    })()`,
    { timeout: 8_000 },
  );
}

async function waitForRecommendJobSearchResults(frame: Frame, keyword: string): Promise<void> {
  await frame.waitForFunction(
    `((kw) => {
      const norm = (v) => (v ?? "").replace(/\\s+/g, "").trim().toLowerCase();
      const rows = Array.from(document.querySelectorAll(".job-selecter-options .job-list .job-item"));
      if (rows.length === 0) return false;
      if (!kw) return true;
      return rows.some((el) => {
        const label = norm(el.querySelector(".label")?.textContent || el.textContent || "");
        return label.includes(norm(kw));
      });
    })(${JSON.stringify(keyword)})`,
    { timeout: 10_000 },
  );
}

async function waitForReadyRecommendFrame(page: Page, expected?: string) {
  const expectedKey = expected === undefined ? null : recommendJobKey(expected);
  const element = await page.waitForFunction(`(() => {
    const frames = document.querySelectorAll('iframe[name="recommendFrame"]');
    if (frames.length > 1) throw Error('推荐 iframe 不唯一');
    const host = frames[0], doc = host?.contentDocument;
    if (!doc || doc.location.origin !== location.origin || doc.location.pathname.replace(/\\/+$/, '') !== '/web/frame/recommend') return false;
    const labels = doc.querySelectorAll('.job-selecter-wrap .ui-dropmenu-label');
    if (labels.length !== 1 || !labels[0].getClientRects().length) return false;
    const key = ${recommendJobKey.toString()};
    const label = key(labels[0].textContent || '');
    const expectedKey = ${JSON.stringify(expectedKey)};
    return !!label && (expectedKey === null || label === expectedKey) &&
      !!doc.querySelector(${JSON.stringify(RECOMMEND_CARD_ROOT_SELECTOR + ', .card-list, .geek-list-wrap .geek-list')}) && host;
  })()`, {timeout:expected === undefined ? 18000 : 10000});
  try {
    const host = element.asElement() as ElementHandle<HTMLIFrameElement> | null;
    const frame = await host?.contentFrame();
    if (!frame || frame.parentFrame() !== page.mainFrame()) throw Error('核验后的推荐 iframe 已失效');
    const label = await readCurrentRecommendJobLabel(frame);
    if (!label || (expectedKey !== null && recommendJobKey(label) !== expectedKey)) throw Error('只读复核的推荐岗位与目标不符');
    return {label, frame};
  } finally { await element.dispose(); }
}

export async function selectRecommendJob(frame: Frame, keyword: string, checkJob = false) {
  const kw = keyword.trim();
  if (!kw) {
    return {label: await readCurrentRecommendJobLabel(frame), frame};
  }
  const current = await readCurrentRecommendJobLabel(frame);
  const normalize = recommendJobKey;
  if (normalize(current) === normalize(kw)) return {label:current, frame};
  const page = frame.page();
  let topNavigation = false, frameNavigation = false, frameDetached = false;
  const navigated = (changed: Frame) => {
    if (changed === page.mainFrame()) topNavigation = true;
    if (changed === frame) frameNavigation = true;
  };
  const detached = (changed: Frame) => { if (changed === frame) frameDetached = true; };
  let confirming = false;
  const verify = (cause?: unknown) => {
    const reason = topNavigation ? '顶层页面导航' : !confirming && frameDetached ? '推荐 iframe 已分离' : !confirming && frameNavigation ? '推荐 iframe 导航' : '';
    if (reason) throw new Error(`推荐页切换岗位中止：${reason}，目标岗位=${kw}`, {cause});
  };
  page.on('framenavigated', navigated);
  page.on('framedetached', detached);
  try {
    const result = await changeRecommendJob(frame, kw, checkJob, verify, () => { confirming = true; });
    verify();
    return result;
  } catch (error) {
    verify(error);
    throw error;
  } finally {
    page.off('framenavigated', navigated);
    page.off('framedetached', detached);
  }
}

async function changeRecommendJob(frame: Frame, kw: string, checkJob: boolean, verify: () => void, startConfirmation: () => void) {
  const kwLiteral = JSON.stringify(kw);
  const query = recommendJobQuery(kw);

  const opened = (await frame.evaluate(`(() => {
    const host = document.querySelector(".job-selecter-wrap .ui-dropmenu-label");
    if (!(host instanceof HTMLElement)) return false;
    const menu=document.querySelector('.job-selecter-options');
    if(menu && menu.getBoundingClientRect().width>0 && menu.getBoundingClientRect().height>0 && getComputedStyle(menu).visibility!=='hidden')return true;
    host.scrollIntoView({ block: "center", inline: "nearest" });
    host.click();
    return true;
  })()`)) as boolean;
  if (!opened) {
    throw new Error('未找到岗位下拉入口（.job-selecter-wrap .ui-dropmenu-label）。');
  }
  await sleepRandom(JOB_SELECT_ACTION_GAP_MS.min, JOB_SELECT_ACTION_GAP_MS.max);
  await waitForRecommendJobDropdownReady(frame);
  verify();

  const searched = (await frame.evaluate(`(() => {
    const kw = ${JSON.stringify(query)};
    const input = document.querySelector(".job-selecter-options .top-chat-search .chat-job-search");
    if (!(input instanceof HTMLInputElement)) return false;
    input.focus();
    input.value = kw;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`)) as boolean;
  if (!searched) {
    throw new Error('已打开岗位下拉，但未找到职位搜索框（.chat-job-search）。');
  }
  await sleepRandom(JOB_SEARCH_ACTION_GAP_MS.min, JOB_SEARCH_ACTION_GAP_MS.max);
  await waitForRecommendJobSearchResults(frame, query);
  verify();

  const resolveOption = `(() => {
    const kw = ${kwLiteral};
    const norm = ${recommendJobKey.toString()};
    const rows = Array.from(document.querySelectorAll(".job-selecter-options .job-list .job-item"));
    if (rows.length === 0) return { ok: false, reason: "empty" };
    const key = el => norm(el.querySelector(".label")?.textContent || el.textContent || "");
    const exact = ${checkJob} ? rows.filter(el => key(el) === norm(kw)) : [];
    const matches = exact.length ? exact : rows.filter(el => key(el).includes(norm(kw)));
    if (matches.length > 1) return { ok: false, reason: "ambiguous" };
    const target = matches[0];
    if (!(target instanceof HTMLElement)) return { ok: false, reason: "not_found" };
    const label = (target.querySelector(".label")?.textContent ?? target.textContent ?? "")
      .replace(/\\s+/g, " ")
      .trim();
    // A partial keyword can resolve to the current job too. Close the dropdown without selecting it again.
    const host = document.querySelector(".job-selecter-wrap .ui-dropmenu-label");
    if (!(host instanceof HTMLElement)) throw new Error('选择前无法读取当前推荐岗位');
    if (norm(host.textContent) === norm(label)) {
      return { ok: true, label, changed: false };
    }
    return { ok: true, label, changed: true, target };
  })()`;
  const picked = (await frame.evaluate(`(() => {
    const { target, ...result } = ${resolveOption}; return result;
  })()`)) as { ok: boolean; label?: string; reason?: string; changed?: boolean };
  if (!picked.ok) {
    throw new Error(`岗位选择失败：${kw}；reason=${picked.reason}。`);
  }
  if (!picked.label) throw new Error(`岗位选择结果缺少名称：${kw}`);
  const label = picked.label;
  verify();
  if (picked.changed === false) {
    await frame.evaluate(`(() => {
      const row = ${resolveOption};
      if (!row.ok || row.changed || row.label !== ${JSON.stringify(label)}) throw Error('收起前岗位已变化');
      document.querySelector('.job-selecter-wrap .ui-dropmenu-label').click();
    })()`);
    await frame.waitForFunction(`(() => {
      const el = document.querySelector('.job-selecter-options');
      if (!el) return true;
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
      return rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden';
    })()`, { timeout: 8_000 });
    return {label, frame};
  }
  startConfirmation();
  try {
    await frame.evaluate(`(() => {
      const row = ${resolveOption};
      if (!row.ok || !row.changed || row.label !== ${JSON.stringify(label)}) throw Error('点击前目标岗位已变化');
      row.target.scrollIntoView({block:'center',inline:'nearest'});
      row.target.click();
    })()`);
  } catch (error) {
    // Replacing the iframe can destroy the command response. Only observe the selected job from here.
    if (!(error instanceof Error) || !/execution context was destroyed|detached frame|frame got detached|cannot find context with specified id/i.test(error.message)) throw error;
  }
  verify();
  return waitForReadyRecommendFrame(frame.page(), label);
}

export async function ensureInRecommendPage(page: Page): Promise<Frame> {
  await ensurePage(page, {
    name: '推荐列表页',
    targetUrl: BOSS_CHAT_RECOMMEND_URL,
    matches: isBossChatRecommendUrl,
  });
  return (await waitForReadyRecommendFrame(page)).frame;
}

/**
 * 供 `preview` 使用：不导航；若当前主页面不在推荐页或未就绪推荐 iframe，直接抛错。
 */
export async function assertRecommendPageReady(
  page: Page,
  actionName: string,
): Promise<Frame> {
  if (!isBossChatRecommendUrl(page.url())) {
    throw new Error(`当前不在推荐列表页（/web/chat/recommend），无法${actionName}。`);
  }
  return (await waitForReadyRecommendFrame(page)).frame;
}

export async function assertRecommendPageReadyForPreview(page: Page): Promise<Frame> {
  return assertRecommendPageReady(page, '预览候选人');
}

export async function readRecommendList(frame: Frame): Promise<RecommendCandidate[]> {
  return (await frame.evaluate(`(() => {
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const cardSel = ${JSON.stringify(RECOMMEND_CARD_ROOT_SELECTOR)};
    const cards = Array.from(document.querySelectorAll(cardSel));
    return cards.map((item) => {
      const inner = item.querySelector(".card-inner") || item;
      const wrap = item.matches(".candidate-card-wrap")
        ? item
        : item.querySelector(".candidate-card-wrap");
      const hasViewed = Boolean(
        (wrap && wrap.classList.contains("has-viewed")) ||
          (inner && inner.classList.contains("has-viewed")),
      );
      const geekId =
        inner?.getAttribute("data-geekid") ??
        inner?.getAttribute("data-geek") ??
        "";
      const name =
        norm(item.querySelector(".name-wrap .name")?.textContent) ||
        norm(item.querySelector(".name")?.textContent);
      const salary = norm(item.querySelector(".salary-wrap span")?.textContent);
      const baseInfo = Array.from(item.querySelectorAll(".base-info span"))
        .map((el) => norm(el.textContent))
        .filter(Boolean)
        .join(" / ");
      const expect =
        norm(item.querySelector(".expect-wrap .content")?.textContent) ||
        norm(item.querySelector(".expect-wrap .join-text-wrap")?.textContent);
      const work = [...item.querySelectorAll('.work-exps .timeline-item .content')].map(el=>norm(el.textContent)).filter(Boolean);
      const education = [...item.querySelectorAll('.edu-exps .timeline-item .content')].map(el=>norm(el.textContent)).filter(Boolean);
      const experience = [...work,...education].join('；');
      const advantage = norm(item.querySelector(".geek-desc .content")?.textContent);
      const highlightLabels = [
        ...Array.from(item.querySelectorAll(".operate .labels .label")),
        ...Array.from(item.querySelectorAll(".tags-wrap .tag-item")),
      ]
        .map((el) => norm(el.textContent))
        .filter(Boolean);
      const highlights = [...new Set(highlightLabels)];
      const greetBtn = item.querySelector(".button-chat-wrap .btn.btn-greet");
      const btnCls = greetBtn?.className ?? "";
      const disabled =
        !greetBtn ||
        /disabled|forbid|ban/i.test(btnCls) ||
        greetBtn.getAttribute("disabled") !== null;
      const hasHistoryChat = (() => {
        if (item.querySelector(".tooltip-wrap.chat-history .icon-chat-history")) return true;
        const uses = Array.from(item.querySelectorAll("use"));
        return uses.some((u) => {
          const href = u.getAttribute("href") ?? u.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "";
          return href.includes("icon-chat-history");
        });
      })();
      return {
        geekId,
        name,
        salary,
        baseInfo,
        expect,
        experience,
        work,
        education,
        advantage,
        highlights,
        canGreet: !disabled,
        hasHistoryChat,
        hasViewed,
      };
    }).filter((x) => x.name);
  })()`)) as RecommendCandidate[];
}

export function renderRecommendList(candidates: RecommendCandidate[]): string {
  if (candidates.length === 0) {
    return '推荐列表为空。';
  }
  const greetProduced: RecommendCandidate[] = [];
  const normal: RecommendCandidate[] = [];
  candidates.forEach((c) => {
    if (c.geekId && sessionGreetProducedGeekIds.has(c.geekId)) {
      greetProduced.push(c);
    } else {
      normal.push(c);
    }
  });

  const renderItems = (title: string, items: RecommendCandidate[]): string[] => {
    const lines: string[] = [];
    lines.push(`${title}（${items.length}）`);
    if (items.length === 0) {
      lines.push('  - 暂无');
      return lines;
    }
    items.forEach((m, idx) => {
      const advantageText =
        m.advantage ||
        (m.highlights.length > 0 ? m.highlights.slice(0, 3).join(' / ') : '（无）');
      const fields = [
        m.salary ? `薪资:${m.salary}` : '',
        m.baseInfo ? `信息:${m.baseInfo}` : '',
        m.expect ? `期望:${m.expect}` : '',
        m.experience ? `经历:${m.experience}` : '',
        m.hasHistoryChat ? '同事沟通过' : '',
        m.canGreet ? '可打招呼' : '已打招呼',
      ]
        .filter(Boolean)
        .join('｜');
      const nameWithViewed = m.hasViewed ? `${m.name} | 看过` : m.name;
      lines.push(`  - ${idx + 1}. ${nameWithViewed}｜${fields}`);
      lines.push(`    优势: ${advantageText}`);
    });
    return lines;
  };

  const out: string[] = [];
  out.push(`推荐列表（按来源分组）：共 ${candidates.length} 人。`);
  out.push('');
  out.push(...renderItems('常规推荐', normal));
  out.push('');
  out.push(...renderItems('打招呼产生的推荐', greetProduced));

  return out.join('\n');
}

export async function clickGreet(
  frame: Frame,
  target: string,
  candidateId?: string,
): Promise<{ message: string; name: string; geekId: string }> {
  const targetLiteral = JSON.stringify(target.trim());
  const result = (await frame.evaluate(
    `(() => {
      const raw = ${targetLiteral};
      const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
      const cardSel = ${JSON.stringify(RECOMMEND_CARD_ROOT_SELECTOR)};
      const cards = Array.from(document.querySelectorAll(cardSel));
      if (cards.length === 0) {
        return { kind: "empty" };
      }
      const {card:targetCard,identity} = ${recommendTargetScript(target,candidateId)};
      const {name,candidateId:geekId} = identity;
      const btn = targetCard.querySelector(".button-chat-wrap .btn.btn-greet");
      if (!(btn instanceof HTMLElement)) {
        return { kind: "no_btn", name };
      }
      const cls = btn.className ?? "";
      const disabled = /disabled|forbid|ban/i.test(cls) || btn.getAttribute("disabled") !== null;
      if (disabled) {
        return { kind: "disabled", name };
      }
      btn.scrollIntoView({ block: "center", inline: "nearest" });
      btn.click();
      return { kind: "clicked", name, geekId };
    })()`,
  )) as
    | { kind: 'empty' }
    | { kind: 'not_found'; target: string }
    | { kind: 'no_btn'; name: string }
    | { kind: 'disabled'; name: string }
    | { kind: 'clicked'; name: string; geekId: string };

  switch (result.kind) {
    case 'empty':
      throw new Error('推荐列表为空，无法执行打招呼。');
    case 'not_found':
      throw new Error(`未在推荐列表中找到目标：${result.target}`);
    case 'no_btn':
      throw new Error(`候选人 ${result.name} 缺少“打招呼”按钮，无法执行。`);
    case 'disabled':
      throw new Error(`候选人 ${result.name} 已打招呼。`);
    case 'clicked':
      return {
        message: `已对 ${result.name} 点击“打招呼”。`,
        name: result.name,
        geekId: result.geekId,
      };
    default: {
      const _x: never = result;
      throw new Error(`未知结果：${String(_x)}`);
    }
  }
}

export function markGreetProduced(
  before: RecommendCandidate[],
  after: RecommendCandidate[],
): void {
  const beforeIds = new Set(before.map((x) => x.geekId).filter(Boolean));
  after.forEach((x) => {
    if (x.geekId && !beforeIds.has(x.geekId)) {
      sessionGreetProducedGeekIds.add(x.geekId);
    }
  });
}

/**
 * 在推荐 iframe 内根据姓名打开在线简历预览：点击候选人卡片主体 `.card-inner`（与侧栏「打招呼」分离）。
 * 父页随后出现 `c-resume` iframe（如 `source=recommend`）；姓名和 ID 唯一核验后只点击卡片主体。
 */
export async function openRecommendResumePreview(frame: Frame, target: string, candidateId?: string): Promise<boolean> {
  const raw = target.trim();
  const targetLiteral = JSON.stringify(raw);
  const opened = (await frame.evaluate(`(() => {
    const raw = ${targetLiteral};
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const cardSel = ${JSON.stringify(RECOMMEND_CARD_ROOT_SELECTOR)};
    const cards = Array.from(document.querySelectorAll(cardSel));
    if (cards.length === 0) return false;
    const targetCard = (${recommendTargetScript(target,candidateId)}).card;

    const inner = targetCard.querySelector(".card-inner");
    if (inner instanceof HTMLElement) {
      inner.scrollIntoView({ block: "center", inline: "nearest" });
      inner.click();
      return true;
    }

    throw Error('推荐候选人卡片主体缺失，停止；不尝试备用链接');
  })()`)) as boolean;
  if (opened) {
    await sleepRandom(RESUME_PREVIEW_OPEN_GAP_MS.min, RESUME_PREVIEW_OPEN_GAP_MS.max);
  }
  return opened;
}

export async function runRecommend(jobKeyword?: string, json = false, checkJob = false): Promise<string> {
  try {
    return await withBossSessionPage(async (page) => {
      const frame = await ensureInRecommendPage(page).catch((cause: unknown) => {
        throw new Error(`推荐页起始就绪检查失败，尚未开始选岗：${cause instanceof Error ? cause.message : String(cause)}`, {cause});
      });
      const {label:selectedJob, frame:currentFrame} = await selectRecommendJob(frame, (jobKeyword ?? '').trim(), checkJob);
      const candidates = await readRecommendList(currentFrame);
      if (json) return JSON.stringify({ job: selectedJob, candidates });
      const title = selectedJob ? `当前岗位：${selectedJob}` : '当前岗位：默认';
      return [title, '', renderRecommendList(candidates)].join('\n');
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`读取推荐列表失败：${message}`);
  }
}

