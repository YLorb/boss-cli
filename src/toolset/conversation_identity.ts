import type { Page } from 'puppeteer-core';

export type ConversationTarget = { name: string; dataId: string; info?: string };

export function requireConversationTarget(target: ConversationTarget): ConversationTarget {
  const name = target.name.trim();
  const dataId = target.dataId.trim();
  if (!name || !dataId) throw new Error('必须同时提供候选人显示名称和 data-id。');
  if (target.info !== undefined && !target.info.trim()) throw new Error('已知搜索 info 不能为空。');
  return { name, dataId, ...(target.info !== undefined ? { info: target.info } : {}) };
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

export function matchesConversationIdentity(actual: SelectedConversation, target: ConversationTarget): boolean {
  return actual.count === 1 && actual.dataId === target.dataId &&
    actual.name === target.name && actual.detailName === target.name;
}

function assertConversationIdentity(actual: SelectedConversation, target: ConversationTarget): void {
  if (!matchesConversationIdentity(actual, target)) {
    throw new Error(`会话身份校验失败：期望「${target.name} / ${target.dataId}」，当前选中「${actual.name} / ${actual.dataId}」，详情「${actual.detailName}」，选中行数 ${actual.count}。`);
  }
}

/** 每次产生外部效果前核对选中的会话，避免页面焦点被其它操作切走。 */
export async function assertSelectedConversation(page: Page, input: ConversationTarget): Promise<void> {
  assertConversationIdentity(await readSelectedConversation(page), requireConversationTarget(input));
}
