import type { Page } from 'puppeteer-core';
import { sleepRandom } from '../browser/index.js';
import { ensureChatListReady, selectChatCategory } from './list.js';

export type ConversationTarget = { name: string; dataId: string };

export function requireConversationTarget(target: ConversationTarget): ConversationTarget {
  const name = target.name.trim();
  const dataId = target.dataId.trim();
  if (!name || !dataId) throw new Error('必须同时提供候选人显示名称和 data-id。');
  return { name, dataId };
}

/** 每次产生外部效果前核对选中的会话，避免页面焦点被其它操作切走。 */
export async function assertSelectedConversation(page: Page, input: ConversationTarget): Promise<void> {
  const target = requireConversationTarget(input);
  const actual = (await page.evaluate(`(() => {
    const norm = (v) => (v ?? '').replace(/\\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('.geek-item.selected'));
    return {
      count: rows.length,
      dataId: rows[0]?.getAttribute('data-id') ?? '',
      name: norm(rows[0]?.querySelector('.geek-name')?.textContent),
      detailName: norm(document.querySelector('.base-info-single-container .name-box')?.textContent),
    };
  })()`)) as { count: number; dataId: string; name: string; detailName: string };
  if (actual.count !== 1 || actual.dataId !== target.dataId ||
      actual.name !== target.name || actual.detailName !== target.name) {
    throw new Error(`会话身份校验失败：期望「${target.name} / ${target.dataId}」，当前选中「${actual.name} / ${actual.dataId}」，详情「${actual.detailName}」。`);
  }
}

/** 在顶部「全部」会话中用联合键查找，禁止按同名首项隐式选择。 */
export async function openConversationByTarget(page: Page, input: ConversationTarget): Promise<void> {
  const target = requireConversationTarget(input);
  await ensureChatListReady(page, 'all');
  await selectChatCategory(page, 'all');
  await ensureChatListReady(page, 'all');

  for (let round = 0; round < 120; round++) {
    const state = (await page.evaluate(`(() => {
      const id = ${JSON.stringify(target.dataId)};
      const name = ${JSON.stringify(target.name)};
      const norm = (v) => (v ?? '').replace(/\\s+/g, ' ').trim();
      const rows = Array.from(document.querySelectorAll('.geek-item'));
      const matches = rows.filter((el) => el.getAttribute('data-id') === id);
      if (matches.length > 1) return { kind: 'duplicate', foundName: '', x: 0, y: 0 };
      if (matches.length === 1) {
        const row = matches[0];
        const foundName = norm(row.querySelector('.geek-name')?.textContent);
        if (foundName !== name) return { kind: 'name_mismatch', foundName, x: 0, y: 0 };
        const r = row.getBoundingClientRect();
        const container = row.closest('.user-list');
        if (!container) return { kind: 'no_scroller', foundName: '', x: 0, y: 0 };
        const viewport = container.getBoundingClientRect();
        if (r.top < viewport.top || r.bottom > viewport.bottom) {
          return { kind: 'next', foundName, x: viewport.left + viewport.width / 2,
            y: viewport.top + viewport.height / 2, deltaY: r.top < viewport.top ? -350 : 350 };
        }
        return { kind: 'found', foundName, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      const first = rows[0];
      if (!first) return { kind: 'empty', foundName: '', x: 0, y: 0 };
      // BOSS uses BetterScroll with overflow:hidden; scrollTop does not drive its virtual list.
      const node = first.closest('.user-list');
      if (!node) return { kind: 'no_scroller', foundName: '', x: 0, y: 0 };
      const r = node.getBoundingClientRect();
      return { kind: 'next', foundName: '', x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`)) as { kind: string; foundName: string; x: number; y: number; deltaY?: number };
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
    await page.mouse.move(state.x, state.y);
    await page.mouse.wheel({ deltaY: state.deltaY ?? 500 });
    await sleepRandom(350, 550);
  }
  throw new Error(`扫描会话列表超过 120 轮，仍未找到「${target.name} / ${target.dataId}」。`);
}
