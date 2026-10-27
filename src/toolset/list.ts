import type { Page } from 'puppeteer-core';
import {
  LIST_FILTER_GAP_MS,
  LIST_MIN_BEFORE_EMPTY_OK_MS,
  LIST_POLL_MS,
  sleepRandom,
} from '../browser/index.js';
import { BOSS_CHAT_INDEX_URL, isBossChatIndexUrl } from '../common/auth.js';
import { ensurePage } from '../common/ensure_page.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { closeAttachmentPreview } from './target_chat.js';
import { INVENTORY_LIST_SELECTOR, INVENTORY_STATE_SCRIPT } from './chat_inventory.js';

type CandidateItem = {
  dataId: string;
  name: string;
  job: string;
  time: string;
  message: string;
  unreadCount: number;
};

export type CandidateListOptions = {
  unreadOnly?: boolean;
  chattingOnly?: boolean;
  json?: boolean;
};

/** Full inventory for crash reconciliation, including read conversations. */
export async function runFullCandidateInventory(shouldStop: () => boolean = () => false): Promise<string> {
  return withBossSessionPage(async page => {
    await closeAttachmentPreview(page);
    await ensureChatListReady(page, 'all', 'all');
    const found = new Map<string, CandidateItem>();
    let resetToTop = false;
    for (let round = 0; round < 400; round++) {
      if (shouldStop()) throw new Error('全量列表扫描已停止，尚未完成对账。');
      let state = await page.evaluate(INVENTORY_STATE_SCRIPT) as { loading: boolean; empty: boolean; end?: boolean; top?: boolean; expectedIds: string[]; x: number; y: number };
      if(state.loading) {
        try {
          await page.waitForFunction(`(() => ![1,2].includes(document.querySelector('.chat-user')?.__vue__?.loading$))()`, {timeout:20_000,polling:100});
        } catch(error) {
          throw new Error(`全量盘点等待列表加载超时或失败（20秒），round=${round}；${error instanceof Error?error.message:String(error)}`);
        }
        state = await page.evaluate(INVENTORY_STATE_SCRIPT) as typeof state;
      }
      if (shouldStop()) throw new Error('全量列表扫描已停止，尚未完成对账。');
      if (state.loading) throw new Error('读取全量盘点状态时列表重新加载，停止对账。');
      if (state.empty) {
        if(found.size)throw new Error('盘点期间列表变空，停止；不返回部分列表。');
        return JSON.stringify({ category: 'all', filter: 'all', candidates: [] });
      }
      await page.mouse.move(state.x, state.y);
      if (!resetToTop) {
        await page.mouse.wheel({ deltaY: -10_000_000 });
        await sleepRandom(500, 650);
        resetToTop = true;
        continue;
      }
      if (found.size===0&&!state.top) throw new Error('全量盘点未确认回到列表顶部，停止；不返回部分列表。');
      for (const item of await readCandidateItems(page, `${INVENTORY_LIST_SELECTOR} .geek-item`)) {
        if (!item.dataId || !item.name || !item.job) throw new Error(`全量候选人缺少身份或岗位：${JSON.stringify(item)}`);
        const previous = found.get(item.dataId);
        if (previous && (previous.name !== item.name || previous.job !== item.job)) throw new Error(`扫描期间候选人身份发生变化：${item.dataId}`);
        found.set(item.dataId, item);
      }
      if (state.end) {
        const missing = state.expectedIds.filter(id=>!found.has(id));
        if(missing.length)throw new Error(`全量盘点仍缺少 ${missing.length} 个已加载会话，不能确认完整；dataIds=${JSON.stringify(missing)}`);
        return JSON.stringify({ category: 'all', filter: 'all', candidates: [...found.values()] });
      }
      await page.mouse.wheel({ deltaY: 400 });
      await sleepRandom(450, 650);
    }
    throw new Error('全量扫描超过 400 轮仍未见列表结束标志，对账未完成。');
  });
}

function traceListStep(message: string): void {
  if (process.env.BOSS_CLI_TRACE === 'true' || process.env.BOSS_CLI_TRACE === '1') {
    console.error(`[boss-cli][list] ${message}`);
  }
}

/** 顶部会话分类与列表内的「全部/未读」是两组不同筛选。 */
export async function selectChatCategory(page: Page, category: 'all' | 'chatting'): Promise<void> {
  const label = category === 'chatting' ? '沟通中' : '全部';
  traceListStep(`检查顶部「${label}」分类`);
  await page.waitForSelector('.label-list .chat-label-item', { timeout: 15_000 });
  const changed = (await page.evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const items = Array.from(document.querySelectorAll('.label-list .chat-label-item'));
    const target = items.find((el) => el.getAttribute('title') === label);
    if (!target) throw new Error('未找到顶部会话分类：' + label);
    if (target.classList.contains('selected')) return false;
    target.click();
    return true;
  })()`)) as boolean;
  if (changed) {
    traceListStep(`已点击顶部「${label}」，等待切换完成`);
    await page.waitForFunction(`(() => {
      const label = ${JSON.stringify(label)};
      return Array.from(document.querySelectorAll('.label-list .chat-label-item'))
        .some((el) => el.getAttribute('title') === label && el.classList.contains('selected'));
    })()`, { timeout: 10_000 });
    await sleepRandom(LIST_FILTER_GAP_MS.min, LIST_FILTER_GAP_MS.max);
  } else {
    traceListStep(`顶部「${label}」已选中`);
  }
}

async function waitForCandidateListSettled(
  page: Page,
  opts: { timeoutMs: number; pollMsMin: number; pollMsMax: number; minMsBeforeEmptyOk: number },
): Promise<void> {
  const start = Date.now();
  let prev = -1;
  let stable = 0;
  while (Date.now() - start < opts.timeoutMs) {
    const n = (await page.evaluate(
      `(() => document.querySelectorAll(".geek-item").length)()`,
    )) as number;
    const elapsed = Date.now() - start;
    if (n === prev) {
      stable++;
    } else {
      prev = n;
      stable = 1;
    }
    if (stable >= 2) {
      if (n > 0) {
        return;
      }
      if (n === 0 && elapsed >= opts.minMsBeforeEmptyOk) {
        return;
      }
    }
    await sleepRandom(opts.pollMsMin, opts.pollMsMax);
  }
}

async function clickChatFilterTab(page: Page, label: string): Promise<boolean> {
  const labelLiteral = JSON.stringify(label);
  return (await page.evaluate(`(() => {
    const targetText = ${labelLiteral};
    const container = document.querySelector(".chat-message-filter-left");
    if (!container) {
      throw new Error("未找到聊天筛选容器：.chat-message-filter-left");
    }
    const spans = Array.from(container.querySelectorAll("span"));
    const norm = (v) => (v ?? "").replace(/\\s+/g, "");
    const target = spans.find((el) => norm(el.textContent).includes(targetText));
    if (!target) {
      const labels = spans.map((el) => norm(el.textContent)).filter(Boolean).join(",");
      throw new Error("未找到聊天筛选项：" + targetText + "；当前筛选项：" + (labels || "空"));
    }
    const selected = /active|selected|current|checked/.test(String(target.className || "")) ||
      target.getAttribute("aria-selected") === "true" ||
      !!target.closest(".active, .selected, .current, .checked");
    if (selected) return false;
    target.click();
    return true;
  })()`)) as boolean;
}

async function waitForChatFilterTabSelected(page: Page, label: string): Promise<void> {
  const labelLiteral = JSON.stringify(label);
  await page.waitForFunction(
    `(() => {
      const targetText = ${labelLiteral};
      const container = document.querySelector(".chat-message-filter-left");
      if (!container) return false;
      const norm = (v) => (v ?? "").replace(/\\s+/g, "");
      const tabs = Array.from(container.querySelectorAll("span"));
      const tab = tabs.find((el) => norm(el.textContent).includes(targetText));
      if (!tab) return false;
      const cls = String(tab.className || "");
      const selectedByClass = /active|selected|current|checked/.test(cls);
      const selectedByAria = tab.getAttribute("aria-selected") === "true";
      const selectedByAncestor = !!tab.closest(".active, .selected, .current, .checked");
      return selectedByClass || selectedByAria || selectedByAncestor;
    })()`,
    { timeout: 8_000 },
  );
}

export async function ensureChatListReady(
  page: Page,
  filter: 'all' | 'unread' = 'all',
  category?: 'all' | 'chatting',
): Promise<void> {
  traceListStep('确认或进入沟通列表页');
  await ensurePage(page, {
    name: '沟通列表页',
    targetUrl: BOSS_CHAT_INDEX_URL,
    matches: isBossChatIndexUrl,
  });

  if (category) await selectChatCategory(page, category);

  await page.waitForFunction(
    `(() => {
      const filter = document.querySelector(".chat-message-filter-left");
      if (!filter) return false;
      const tabs = Array.from(filter.querySelectorAll("span"));
      return tabs.length >= 2;
    })()`,
    { timeout: 15_000 },
  );

  const filterLabel = filter === 'unread' ? '未读' : '全部';
  const changed = await clickChatFilterTab(page, filterLabel);
  traceListStep(changed ? `已点击列表「${filterLabel}」筛选` : `列表「${filterLabel}」已选中`);
  if (changed) await sleepRandom(LIST_FILTER_GAP_MS.min, LIST_FILTER_GAP_MS.max);
  await waitForChatFilterTabSelected(page, filterLabel);
  await waitForCandidateListSettled(page, {
    timeoutMs: 18_000,
    pollMsMin: LIST_POLL_MS.min,
    pollMsMax: LIST_POLL_MS.max,
    minMsBeforeEmptyOk: LIST_MIN_BEFORE_EMPTY_OK_MS,
  });
  traceListStep(`列表「${filterLabel}」已加载`);
}

async function readCandidateItems(page: Page, selector = '.geek-item'): Promise<CandidateItem[]> {
  return (await page.evaluate(
        `(() => {
          const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
          return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((el) => {
            const dataId = norm(el.getAttribute("data-id"));
            const name = norm(el.querySelector(".geek-name")?.textContent);
            const job = norm(el.querySelector(".source-job")?.textContent);
            const time = norm(el.querySelector(".time")?.textContent);
            const message = norm(el.querySelector(".push-text")?.textContent);
            const badge = el.querySelector(".badge-count");
            let unreadCount = 0;
            if (badge) {
              const digits = norm(badge.textContent).replace(/\\D/g, "");
              if (digits) unreadCount = parseInt(digits, 10) || 0;
            }
            return { dataId, name, job, time, message, unreadCount };
          });
        })()`,
  )) as CandidateItem[];
}

async function readAllChattingCandidateItems(page: Page): Promise<CandidateItem[]> {
  const found = new Map<string, CandidateItem>();
  let idle = 0;
  for (let round = 0; round < 160; round++) {
    const items = await readCandidateItems(page);
    for (const item of items) {
      if (!item.name) continue;
      if (!item.dataId) throw new Error(`「沟通中」候选人「${item.name}」缺少 data-id。`);
      const previous = found.get(item.dataId);
      if (previous && previous.name !== item.name) {
        throw new Error(`「沟通中」列表的 data-id「${item.dataId}」对应多个显示名称。`);
      }
      found.set(item.dataId, item);
    }
    const moved = (await page.evaluate(`(() => {
      const row = document.querySelector('.geek-item');
      if (!row) return false;
      let node = row.parentElement;
      while (node) {
        const style = getComputedStyle(node);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) break;
        node = node.parentElement;
      }
      if (!node) return false;
      const before = node.scrollTop;
      node.scrollTop = Math.min(node.scrollTop + Math.max(160, Math.floor(node.clientHeight * 0.8)), node.scrollHeight);
      return node.scrollTop !== before;
    })()`)) as boolean;
    traceListStep(`扫描第 ${round + 1} 轮：累计 ${found.size} 个会话，${moved ? '继续滚动' : '已到列表末尾'}`);
    idle = moved ? 0 : idle + 1;
    if (idle >= 2) return [...found.values()];
    await sleepRandom(350, 1550);
  }
  throw new Error('扫描「沟通中」列表超过 160 轮，无法确认已读取完整列表。');
}

export async function runGetCandidateList(
  opts: CandidateListOptions = {},
): Promise<string> {
  const unreadOnly = opts.unreadOnly === true;

  try {
    traceListStep('连接浏览器会话');
    return await withBossSessionPage(async (page) => {
      traceListStep(`浏览器已连接，当前页面：${page.url().split('?')[0]}`);
      if (opts.chattingOnly) {
        traceListStep('进入「沟通中」列表');
        await ensurePage(page, {
          name: '沟通列表页', targetUrl: BOSS_CHAT_INDEX_URL, matches: isBossChatIndexUrl,
        });
        await selectChatCategory(page, 'chatting');
      }
      await ensureChatListReady(page, unreadOnly ? 'unread' : 'all');

      const items = opts.chattingOnly ? await readAllChattingCandidateItems(page) : await readCandidateItems(page);

      const candidates = items.filter((it) => it.name) as CandidateItem[];
      traceListStep(`读取完成：${candidates.length} 个候选人会话`);
      if (opts.json) {
        if (candidates.some((it) => !it.dataId)) {
          throw new Error('候选人列表含缺少 data-id 的会话，无法输出稳定定位结果。');
        }
        return JSON.stringify({ category: opts.chattingOnly ? 'chatting' : 'current',
          filter: unreadOnly ? 'unread' : 'all', candidates });
      }
      const withUnread = candidates.filter((it) => it.unreadCount > 0).length;
      const visible = unreadOnly ? candidates : candidates;
      const lines = visible.map((it, idx) => {
        const base = `${idx + 1}. ${it.name}${it.dataId ? `｜data-id:${it.dataId}` : ''}${it.job ? `｜${it.job}` : ''}`;
        const meta = [
          it.unreadCount > 0 ? `未读:${it.unreadCount}` : '',
          it.time ? `时间:${it.time}` : '',
          it.message ? `消息:${it.message}` : '',
        ]
          .filter(Boolean)
          .join('｜');
        return meta ? `${base}｜${meta}` : base;
      });
      const previewText =
        lines.length > 0 ? `候选人明细：\n${lines.join('\n')}` : '候选人明细：暂无。';

      return [
        unreadOnly
          ? `未读筛选：共 ${visible.length} 人（已切换页面「未读」筛选）。`
          : `沟通列表共 ${candidates.length} 人，其中 ${withUnread} 人有未读消息。`,
        previewText,
      ]
        .filter(Boolean)
        .join('\n');
    });
  } catch (e) {
    if (e instanceof Error) {
      throw e;
    }
    throw new Error(`获取候选人列表失败：${String(e)}`);
  }
}
