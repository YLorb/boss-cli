import type { Page } from 'puppeteer-core';
import { requireChatSearch } from './chat_search.js';
import { isBossChatIndexUrl } from '../common/auth.js';
import { requireConversationTarget, readSelectedConversation, matchesConversationIdentity, assertSelectedConversation, type ConversationTarget } from './conversation_identity.js';
export { requireConversationTarget, readSelectedConversation, assertSelectedConversation, type ConversationTarget } from './conversation_identity.js';

export const ATTACHMENT_PREVIEW_CONTENT_SELECTOR = '.resume-detail-chat iframe.attachment-iframe, .resume-detail-chat img';

/** Close only the attachment preview that otherwise covers chat search. */
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

/** Reuse a verified current conversation; search only when the initial identity differs. */
export async function openConversationByTarget(page: Page, input: ConversationTarget): Promise<void> {
  const target = requireConversationTarget(input);
  if (!isBossChatIndexUrl(page.url())) throw new Error('候选人定位必须已在沟通页 /web/chat/index；当前=' + page.url());
  const reuseCurrent = matchesConversationIdentity(await readSelectedConversation(page), target);
  await closeAttachmentPreview(page);
  if (!reuseCurrent) await requireChatSearch(page, target);
  // A later read/identity failure is terminal; never retry it through search.
  await assertSelectedConversation(page, target);
}
