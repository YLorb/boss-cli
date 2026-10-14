import type { Page } from 'puppeteer-core';
import { sleepRandom } from '../browser/index.js';
import { ensureChatListReady } from './list.js';
import { isBossChatIndexUrl } from '../common/auth.js';

export type ConversationTarget = { name: string; dataId: string };

export const ATTACHMENT_PREVIEW_CONTENT_SELECTOR = '.resume-detail-chat iframe.attachment-iframe, .resume-detail-chat img';

export function requireConversationTarget(target: ConversationTarget): ConversationTarget {
  const name = target.name.trim();
  const dataId = target.dataId.trim();
  if (!name || !dataId) throw new Error('必须同时提供候选人显示名称和 data-id。');
  return { name, dataId };
}

type SelectedConversation = { count: number; dataId: string; name: string; detailName: string };

/** 直接读取页面当前会话，不安装全局状态或观察器。 */
export async function readSelectedConversation(page: Page): Promise<SelectedConversation> {
  return (await page.evaluate(`(() => {
    const norm = (v) => (v ?? '').replace(/\\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('.geek-item.selected'));
    return {
      count: rows.length,
      dataId: rows[0]?.getAttribute('data-id') ?? '',
      name: norm(rows[0]?.querySelector('.geek-name')?.textContent),
      detailName: norm(document.querySelector('.base-info-single-container .name-box')?.textContent),
    };
  })()`)) as SelectedConversation;
}

function assertConversationIdentity(actual: SelectedConversation, target: ConversationTarget): void {
  if (actual.count !== 1 || actual.dataId !== target.dataId ||
      actual.name !== target.name || actual.detailName !== target.name) {
    throw new Error(`会话身份校验失败：期望「${target.name} / ${target.dataId}」，当前选中「${actual.name} / ${actual.dataId}」，详情「${actual.detailName}」，选中行数 ${actual.count}。`);
  }
}

/** 每次产生外部效果前核对选中的会话，避免页面焦点被其它操作切走。 */
export async function assertSelectedConversation(page: Page, input: ConversationTarget): Promise<void> {
  assertConversationIdentity(await readSelectedConversation(page), requireConversationTarget(input));
}

/** Close only the attachment preview that otherwise intercepts list wheel events. */
export async function closeAttachmentPreview(page: Page): Promise<void> {
  const closed = await page.evaluate(`(() => {
    const previews = Array.from(document.querySelectorAll(${JSON.stringify(ATTACHMENT_PREVIEW_CONTENT_SELECTOR)}))
      .filter((el) => el.getBoundingClientRect().width && el.getBoundingClientRect().height);
    if (previews.length === 0) return false;
    if (previews.length !== 1) throw new Error('可见附件预览数量异常：' + previews.length);
    const root = previews[0].closest('.new-resume-online-main-ui');
    const close = root?.querySelector('.close-btn');
    if (!(close instanceof HTMLElement)) throw new Error('附件预览缺少关闭按钮，不能定位会话。');
    close.click();
    return true;
  })()`);
  if (closed) await page.waitForSelector(ATTACHMENT_PREVIEW_CONTENT_SELECTOR, { hidden: true, timeout: 10_000 });
}

/** 在顶部「全部」会话中用联合键查找，禁止按同名首项隐式选择。 */
export async function openConversationByTarget(page: Page, input: ConversationTarget, check = false): Promise<void> {
  const target = requireConversationTarget(input);
  if (check && isBossChatIndexUrl(page.url())) {
    const actual = await readSelectedConversation(page);
    if (actual.count > 1) throw new Error(`当前会话选中行数量异常：${actual.count}；目标「${target.name} / ${target.dataId}」。`);
    if (actual.count === 1 && actual.dataId === target.dataId) {
      assertConversationIdentity(actual, target);
      return;
    }
  }
  await closeAttachmentPreview(page);
  await ensureChatListReady(page, 'all', 'all');

  // Search from the current viewport, down then up. No unconditional jump to the top.
  let direction = 1;
  let previousSignature: string | undefined;
  let unchanged = 0;
  for (let round = 0; round < 120; round++) {
    const state = (await page.evaluate(`(() => {
      const id = ${JSON.stringify(target.dataId)};
      const name = ${JSON.stringify(target.name)};
      const norm = (v) => (v ?? '').replace(/\\s+/g, ' ').trim();
      const rows = Array.from(document.querySelectorAll('.geek-item'));
      const container = document.querySelector('.user-list');
      if (!container) throw new Error('找不到会话列表容器');
      const viewport = container.getBoundingClientRect();
      if (!viewport.width || !viewport.height) throw new Error('会话列表容器不可见');
      const step = Math.max(1, Math.min(500, Math.floor(viewport.height * 0.65)));
      const visible = rows.map(row => {
        const r = row.getBoundingClientRect();
        return { id: row.getAttribute('data-id'), top: Math.round(r.top - viewport.top), bottom: Math.round(r.bottom - viewport.top), visible: r.height > 0 && r.bottom > viewport.top && r.top < viewport.bottom };
      }).filter(row => row.visible);
      const scan = { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2,
        step, signature: JSON.stringify(visible) };
      const matches = rows.filter((el) => el.getAttribute('data-id') === id);
      if (matches.length > 1) return { kind: 'duplicate', foundName: '', x: 0, y: 0 };
      if (matches.length === 1) {
        const row = matches[0];
        const foundName = norm(row.querySelector('.geek-name')?.textContent);
        if (foundName !== name) return { kind: 'name_mismatch', foundName, x: 0, y: 0 };
        const r = row.getBoundingClientRect();
        if (row.closest('.user-list') !== container) throw new Error('候选人不在当前会话列表中');
        if (r.height > viewport.height) throw new Error('候选人卡片高度超过列表视口，无法完整定位');
        if (r.top < viewport.top || r.bottom > viewport.bottom) {
          const distance = (r.top + r.bottom - viewport.top - viewport.bottom) / 2;
          return { kind: 'next', foundName, ...scan,
            deltaY: Math.sign(distance) * Math.min(step, Math.abs(distance)) };
        }
        return { kind: 'found', foundName, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      if (!visible.length) throw new Error('当前会话列表没有可见候选人，无法确认加载或滚动状态');
      return { kind: 'next', foundName: '', ...scan };
    })()`)) as { kind: string; foundName: string; x: number; y: number; deltaY?: number; step: number; signature: string };
    if (state.kind === 'found') {
      await page.mouse.click(state.x, state.y, { delay: 40 });
      await page.waitForFunction(`(() => {
        const id = ${JSON.stringify(target.dataId)};
        const name = ${JSON.stringify(target.name)};
        const norm = (v) => (v ?? '').replace(/\\s+/g, ' ').trim();
        const row = document.querySelector('.geek-item.selected');
        return row?.getAttribute('data-id') === id &&
          norm(row.querySelector('.geek-name')?.textContent) === name &&
          norm(document.querySelector('.base-info-single-container .name-box')?.textContent) === name;
      })()`, { timeout: 15_000 });
      await assertSelectedConversation(page, target);
      return;
    }
    if (state.kind === 'name_mismatch') {
      throw new Error(`data-id「${target.dataId}」的显示名称已变为「${state.foundName}」，与「${target.name}」不一致。`);
    }
    if (state.kind !== 'next') throw new Error(`未找到会话「${target.name} / ${target.dataId}」：${state.kind}。`);
    unchanged = state.signature === previousSignature ? unchanged + 1 : 0;
    previousSignature = state.signature;
    if (unchanged >= 3) {
      if (state.deltaY !== undefined) throw new Error(`会话列表滚轮无响应，无法显示目标「${target.name} / ${target.dataId}」。`);
      if (direction === -1) throw new Error(`双向分段扫描未定位「${target.name} / ${target.dataId}」，列表不再移动；不能据此确认候选人不存在。`);
      direction = -1;
      unchanged = 0;
      previousSignature = undefined;
    }
    await page.mouse.move(state.x, state.y);
    await page.mouse.wheel({ deltaY: state.deltaY ?? direction * state.step });
    await sleepRandom(350, 550);
  }
  throw new Error(`扫描会话列表超过 120 轮，仍未找到「${target.name} / ${target.dataId}」。`);
}
