import { requireChatSearch } from './chat_search.js';
import { closeAttachmentPreview } from './target_chat.js';
import type { Page } from 'puppeteer-core';
import {
  CHAT_HISTORY_DIALOG_WAIT_MS,
  CHAT_HISTORY_TAB_SWITCH_MS,
  sleepRandom,
} from '../browser/index.js';
import { isBossChatIndexUrl } from '../common/auth.js';
import { ensureChatListReady } from './list.js';

type ChatFrom = 'friend' | 'myself' | 'system' | 'unknown';

function chatRoleTag(from: ChatFrom): string {
  switch (from) {
    case 'friend':
      return '[candidate]';
    case 'myself':
      return '[you]';
    case 'system':
      return '[system]';
    default:
      return '[unknown]';
  }
}

async function waitForChatHistoryPanelReady(page: Page, selectedTab?: string): Promise<void> {
  const selectedTabLiteral = JSON.stringify(selectedTab ?? null);
  await page.waitForFunction(
    `(() => {
      const tabLabel = ${selectedTabLiteral};
      function norm(v) {
        return (v ?? "").replace(/\\s+/g, " ").trim();
      }
      function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }
      const root = document.querySelector(".chat-history-process");
      if (!isVisible(root)) return false;
      if (tabLabel) {
        const selected = root.querySelector(".tab-hd span.selected");
        if (norm(selected?.textContent) !== tabLabel) return false;
      }
      return !!root.querySelector(".record");
    })()`,
    { timeout: 10_000 },
  );
}

/**
 * 打开「沟通记录」弹窗，依次读取「同事沟通」「我的沟通」列表，关闭弹窗。
 * 未找到入口时返回 null（视为暂无同事沟通记录，不输出该段）。
 */
async function fetchColleagueChatHistorySection(page: Page, json = false): Promise<string | null> {
  const clicked = (await page.evaluate(`(() => {
    function norm(v) {
      return (v ?? "").replace(/\\s+/g, " ").trim();
    }
    const tooltips = Array.from(document.querySelectorAll(".chat-tooltip-custom"));
    for (const el of tooltips) {
      if (!norm(el.textContent).includes("沟通记录")) continue;
      const host = el.closest("span.icon") ?? el.closest("span") ?? el.parentElement;
      if (host) {
        host.click();
        return true;
      }
      el.click();
      return true;
    }
    const uses = Array.from(document.querySelectorAll("use"));
    for (const u of uses) {
      const h =
        u.getAttribute("href") ||
        u.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
        "";
      if (h.includes("icon-chat-history")) {
        const p = u.closest("span.icon") ?? u.parentElement?.parentElement;
        if (p) {
          p.click();
          return true;
        }
      }
    }
    return false;
  })()`)) as boolean;

  if (!clicked) {
    return null;
  }

  await sleepRandom(CHAT_HISTORY_DIALOG_WAIT_MS.min, CHAT_HISTORY_DIALOG_WAIT_MS.max);

  try {
    await waitForChatHistoryPanelReady(page);
  } catch (error) {
    if (json) throw error;
    return '(已点击「沟通记录」，但弹窗未在预期时间内出现。)';
  }

  const scrapeRows = () =>
    page.evaluate(`(() => {
      function norm(v) {
        return (v ?? "").replace(/\\s+/g, " ").trim();
      }
      const root = document.querySelector(".chat-history-process");
      if (!root) return [];
      return Array.from(root.querySelectorAll(".record li"))
        .map((li) => ({
          action: norm(li.querySelector(".action")?.textContent),
          operat: norm(li.querySelector(".operat")?.textContent),
        }))
        .filter((x) => x.action || x.operat);
    })()`) as Promise<Array<{ action: string; operat: string }>>;

  const clickTab = (label: string) => {
    const labelLiteral = JSON.stringify(label);
    return page.evaluate(
      `(() => {
        const lab = ${labelLiteral};
        function norm(v) {
          return (v ?? "").replace(/\\s+/g, " ").trim();
        }
        const root = document.querySelector(".chat-history-process");
        if (!root) return;
        const spans = Array.from(root.querySelectorAll(".tab-hd span"));
        const sp = spans.find((s) => norm(s.textContent) === lab);
        if (sp && !sp.classList.contains("selected")) {
          sp.click();
        }
      })()`,
    );
  };

  await clickTab('同事沟通');
  await sleepRandom(CHAT_HISTORY_TAB_SWITCH_MS.min, CHAT_HISTORY_TAB_SWITCH_MS.max);
  await waitForChatHistoryPanelReady(page, '同事沟通');
  const rowsColleague = await scrapeRows();

  await clickTab('我的沟通');
  await sleepRandom(CHAT_HISTORY_TAB_SWITCH_MS.min, CHAT_HISTORY_TAB_SWITCH_MS.max);
  await waitForChatHistoryPanelReady(page, '我的沟通');
  const rowsMine = await scrapeRows();

  const fmt = (label: string, rows: Array<{ action: string; operat: string }>): string[] => {
    const lines = [`[${label}]`];
    if (rows.length === 0) {
      lines.push('(暂无)');
      return lines;
    }
    rows.forEach((r, i) => {
      const line = [r.action, r.operat].filter(Boolean).join(' ｜ ');
      lines.push(`${i + 1}. ${line}`);
    });
    return lines;
  };

  const parts: string[] = [];
  parts.push(...fmt('同事沟通', rowsColleague));
  parts.push('');
  parts.push(...fmt('我的沟通', rowsMine));

  await closeChatHistoryPopup(page);

  if (json) return JSON.stringify({ action: 'history', status: 'read', colleague: rowsColleague, mine: rowsMine });
  return parts.join('\n');
}

export async function runGetCommunicationHistory(page: Page, json = false): Promise<string> {
  const currentUrl = page.url();
  if (!isBossChatIndexUrl(currentUrl)) {
    throw new Error('请先进入聊天列表页（/web/chat/index）并打开候选人聊天。');
  }
  const inCandidateChat = await page.$('.base-info-single-container');
  if (!inCandidateChat) {
    throw new Error('请先打开候选人聊天详情页，再执行“沟通记录”操作。');
  }

  let historyBlock: string | null = null;
  historyBlock = await fetchColleagueChatHistorySection(page, json);
  if (historyBlock === null) {
    if (json) return JSON.stringify({ action: 'history', status: 'unavailable', colleague: null, mine: null });
    return '未找到「沟通记录」入口，或当前候选人暂无可读取记录。';
  }
  if (json) return historyBlock;
  return ['同事/我的沟通记录：', '', historyBlock].join('\n');
}

/** 关闭「沟通记录」弹层（优先点 Boss 提供的 popup 关闭钮） */
async function closeChatHistoryPopup(page: Page): Promise<void> {
  try {
    const selectors = [
      '.boss-popup__wrapper.chat-history .boss-popup__close',
      '.boss-dialog__wrapper.chat-history .boss-popup__close',
      '.boss-popup__wrapper.boss-dialog.chat-history .boss-popup__close',
    ];
    let btn = null as Awaited<ReturnType<typeof page.$>>;
    for (const sel of selectors) {
      btn = await page.$(sel);
      if (btn) break;
    }
    if (btn) {
      await btn.click();
    } else {
      await page.evaluate(`(() => {
        const root =
          document.querySelector(".boss-popup__wrapper.chat-history") ||
          document.querySelector(".boss-dialog__wrapper.chat-history");
        const c = root?.querySelector(".boss-popup__close") ?? document.querySelector(".boss-popup__close");
        if (c) {
          c.click();
        }
      })()`);
    }
    await page.waitForFunction(
      `(() => {
        const roots = Array.from(document.querySelectorAll(".boss-popup__wrapper.chat-history, .boss-dialog__wrapper.chat-history"));
        return roots.every((el) => {
          if (!(el instanceof HTMLElement)) return true;
          const st = window.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return st.display === "none" || st.visibility === "hidden" || r.width <= 0 || r.height <= 0;
        });
      })()`,
      { timeout: 3_000 },
    ).catch(() => {});
    const popupWrap = await page.$('.boss-popup__wrapper.chat-history, .boss-dialog__wrapper.chat-history');
    if (popupWrap) {
      await page.evaluate(`(() => {
        const root =
          document.querySelector(".boss-popup__wrapper.chat-history") ||
          document.querySelector(".boss-dialog__wrapper.chat-history");
        const c = root?.querySelector(".boss-popup__close") ?? document.querySelector(".boss-popup__close");
        c?.click();
      })()`);
      await page.waitForFunction(
        `(() => {
          const roots = Array.from(document.querySelectorAll(".boss-popup__wrapper.chat-history, .boss-dialog__wrapper.chat-history"));
          return roots.every((el) => {
            if (!(el instanceof HTMLElement)) return true;
            const st = window.getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return st.display === "none" || st.visibility === "hidden" || r.width <= 0 || r.height <= 0;
          });
        })()`,
        { timeout: 2_500 },
      ).catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`关闭「沟通记录」弹层失败：${msg}`);
  }
}

type CandidateSummary = {
  name: string;
  active: string;
  basicFacts: string[];
  recentExperience: string[];
  communicationPosition: string;
  expectation: string;
  remark: string;
};

type ChatMessageSnapshot = {
  messages: Array<{
    time: string;
    from: 'friend' | 'myself' | 'system' | 'unknown';
    text: string;
  }>;
  hasFriendResumeAttachment: boolean;
};

async function fetchCandidateSummary(
  page: Page,
  expectedName: string,
  exactMatch: boolean,
): Promise<CandidateSummary> {
  const targetNameLiteral = JSON.stringify(expectedName);
  const exactMatchLiteral = JSON.stringify(exactMatch);
  const scraped = (await page.evaluate(`(() => {
    const targetName = ${targetNameLiteral};
    const exact = ${exactMatchLiteral};
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const matches = (value) => exact ? value === targetName : value.includes(targetName);
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const roots = Array.from(document.querySelectorAll(".base-info-single-container")).filter(isVisible);
    const root = roots.find((el) => matches(norm(el.querySelector(".name-box")?.textContent)));
    if (!root) {
      const visibleNames = roots.map((el) => norm(el.querySelector(".name-box")?.textContent)).filter(Boolean).join(", ");
      throw new Error("未找到目标候选人详情容器：" + targetName + "；当前可见详情：" + (visibleNames || "空"));
    }
    const name = norm(root.querySelector(".name-box")?.textContent);
    const active = norm(root.querySelector(".high-light-orange.active-time span")?.textContent);
    const basicFacts = Array.from(root.querySelectorAll(".base-info-single-detial > div"))
      .filter((el) => !el.classList.contains("name-contet") && !el.classList.contains("active-time"))
      .map((el) => norm(el.textContent))
      .filter((v) => v.length > 0);
    const recentExperience = Array.from(
      root.querySelectorAll(".experience-content.detail-list .work-content .value"),
    )
      .map((el) => norm(el.textContent))
      .filter((v) => v.length > 0);
    const communicationPosition = norm(
      root.querySelector(".position-item .position-name")?.textContent,
    );
    const expectation = norm(root.querySelector(".position-item.expect .value.job")?.textContent);
    const remark = norm(
      root.querySelector(".label-remark-content .remark span:last-child")?.textContent,
    );
    return {
      name,
      active,
      basicFacts,
      recentExperience,
      communicationPosition,
      expectation,
      remark,
    };
  })()`)) as CandidateSummary;
  return scraped;
}

async function waitForOpenedCandidateChat(page: Page, expectedName: string): Promise<void> {
  const expectedNameLiteral = JSON.stringify(expectedName);
  await page.waitForFunction(
    `(() => {
      const name = ${expectedNameLiteral};
      const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const selected = Array.from(document.querySelectorAll(".geek-item.selected")).find(isVisible);
      const selectedName = norm(selected?.querySelector(".geek-name")?.textContent);
      const root = Array.from(document.querySelectorAll(".base-info-single-container")).find(isVisible);
      const detailName = norm(root?.querySelector(".name-box")?.textContent);
      return selectedName === name && detailName === name;
    })()`,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    `(() => {
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const lists = Array.from(document.querySelectorAll(".chat-message-list")).filter(isVisible);
      const list = lists[lists.length - 1];
      if (!list) return false;
      const items = list.querySelectorAll(".message-item");
      if (!items || items.length === 0) return false;
      return Array.from(items).some((item) => {
        const txt =
          item.querySelector(".item-friend .text span")?.textContent ??
          item.querySelector(".item-myself .text span")?.textContent ??
          item.querySelector(".item-system .message-card-top-title")?.textContent ??
          "";
        return txt.replace(/\\s+/g, " ").trim().length > 0;
      });
    })()`,
    { timeout: 20_000 },
  );
}

async function scrapeCurrentChatMessages(page: Page): Promise<ChatMessageSnapshot> {
  return (await page.evaluate(`(() => {
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    function isBossPriorityUpsellSystemText(text) {
      return norm(text).indexOf("优先提醒") !== -1;
    }
    const lists = Array.from(document.querySelectorAll(".chat-message-list")).filter(isVisible);
    const list = lists[lists.length - 1];
    if (!list) {
      throw new Error("未找到可见聊天消息列表（.chat-message-list）。");
    }
    const items = Array.from(list.querySelectorAll(".message-item"));
    let currentTime = "";
    const messages = [];
    let hasFriendResumeAttachment = false;
    for (const item of items) {
      const timeNode = item.querySelector(".message-time .time");
      if (timeNode) {
        const t = norm(timeNode.textContent);
        if (t) currentTime = t;
      }
      const friendRoot = item.querySelector(".item-friend");
      let friendText = "";
      if (friendRoot) {
        friendText = norm(friendRoot.querySelector(".text > span")?.textContent);
        if (!friendText) {
          const resumeIcon = friendRoot.querySelector(".resume-icon");
          const title = norm(friendRoot.querySelector(".message-card-top-title")?.textContent);
          const cardBtn = norm(friendRoot.querySelector(".message-card-buttons .card-btn")?.textContent);
          if (resumeIcon) hasFriendResumeAttachment = true;
          if (title || cardBtn) {
            const parts = [];
            if (title) parts.push(title);
            if (cardBtn) parts.push(cardBtn);
            friendText = parts.length ? parts.join(" · ") : "";
          }
          if (!friendText) friendText = norm(friendRoot.querySelector(".text")?.textContent);
        }
      }
      const myselfText = norm(item.querySelector(".item-myself .text span")?.textContent);
      const systemText =
        norm(item.querySelector(".item-system .message-card-top-title")?.textContent) ||
        norm(item.querySelector(".item-system .text span")?.textContent);
      if (friendText) {
        messages.push({ text: friendText, time: currentTime, from: "friend" });
      } else if (myselfText) {
        messages.push({ text: myselfText, time: currentTime, from: "myself" });
      } else if (systemText) {
        if (!isBossPriorityUpsellSystemText(systemText)) {
          messages.push({ text: systemText, time: currentTime, from: "system" });
        }
      }
    }
    return { messages, hasFriendResumeAttachment };
  })()`)) as ChatMessageSnapshot;
}

export async function renderOpenedCandidateChat(page: Page, foundName: string, json = false): Promise<string> {
  await waitForOpenedCandidateChat(page, foundName);
  const scraped = await scrapeCurrentChatMessages(page);
  const detailLines = scraped.messages.map((m) => {
    const tag = chatRoleTag(m.from);
    const timePart = m.time ? ` ${m.time}` : '';
    return `${tag}${timePart} ${m.text}`.trimEnd();
  });

  const resumeStatus = scraped.hasFriendResumeAttachment ? '已获取' : '未获取';
  const summary = await fetchCandidateSummary(page, foundName, true);
  if (json) {
    const dataId = await page.evaluate(`(() => document.querySelector('.geek-item.selected')?.getAttribute('data-id') ?? '')()`);
    return JSON.stringify({ name: foundName, dataId, summary, ...scraped });
  }

  const out: string[] = [
    `成功进入候选人聊天：${foundName}`,
    `简历获取状态: ${resumeStatus}`,
  ];
  const summaryLines: string[] = [];
  const summaryName = summary.name || foundName;
  summaryLines.push(`姓名: ${summaryName}`);
  if (summary.active) {
    summaryLines.push(`活跃状态: ${summary.active}`);
  }
  if (summary.basicFacts.length > 0) {
    summaryLines.push(`基本信息: ${summary.basicFacts.join(' / ')}`);
  }
  if (summary.communicationPosition) {
    summaryLines.push(`沟通职位: ${summary.communicationPosition}`);
  }
  if (summary.expectation) {
    summaryLines.push(`期望: ${summary.expectation}`);
  }
  if (summary.recentExperience.length > 0) {
    summaryLines.push('近期经历:');
    summary.recentExperience.forEach((it, idx) => {
      summaryLines.push(`${idx + 1}. ${it}`);
    });
  }
  if (summaryLines.length > 0) {
    out.push('', '人才摘要：', '', ...summaryLines);
  }
  if (summary.remark) {
    out.push('', `备注: ${summary.remark}`);
  }
  out.push('', '完整聊天消息：');
  if (detailLines.length > 0) {
    out.push('', ...detailLines);
  } else {
    out.push('', '(暂无)');
  }
  return out.join('\n');
}

export async function runOpenCandidateChatByIndex(
  page: Page,
  params: { index: number; filter?: 'all' | 'unread'; expectedName?: string; exact?: boolean; json?: boolean },
): Promise<string> {
  if (!Number.isInteger(params.index) || params.index < 1) throw new Error('聊天列表序号必须是从 1 开始的整数，当前值：' + params.index);
  if (!isBossChatIndexUrl(page.url())) throw new Error('候选人定位必须已在沟通页 /web/chat/index；当前=' + page.url());
  await ensureChatListReady(page, params.filter ?? 'all');
  const row = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.geek-item-wrap')];
    const wrap = rows[${params.index - 1}];
    const item = wrap?.querySelector('.geek-item');
    const norm = v => (v || '').replace(/\\s+/g,' ').trim();
    return {total:rows.length,name:norm(wrap?.querySelector('.geek-name')?.textContent),dataId:item?.getAttribute('data-id') || '',job:norm(wrap?.querySelector('.source-job')?.textContent)};
  })()`) as { total: number; name: string; dataId: string; job: string };
  if (!row.name || !row.dataId || !row.job) throw new Error('聊天列表序号缺失或身份不完整：index=' + params.index + ' total=' + row.total);
  if (params.expectedName && params.expectedName.trim() !== row.name) throw new Error('聊天列表序号姓名不匹配：actual=' + row.name + ' expected=' + params.expectedName);
  await closeAttachmentPreview(page);
  await requireChatSearch(page, {name:row.name,dataId:row.dataId,job:row.job});
  return renderOpenedCandidateChat(page, row.name, params.json);
}

export async function runOpenCandidateChat(page: Page, candidateName: string, _exact = true, json = false): Promise<string> {
  if (!isBossChatIndexUrl(page.url())) throw new Error('候选人定位必须已在沟通页 /web/chat/index；当前=' + page.url());
  await closeAttachmentPreview(page);
  const result = await requireChatSearch(page, {name:candidateName});
  return renderOpenedCandidateChat(page, result.name, json);
}
