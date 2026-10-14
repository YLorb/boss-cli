import {
  randomIntInclusive,
  selectAllModifierKey,
  SEND_AFTER_ENTER_MS,
  SEND_INPUT_CLICK_MS,
  sleepRandom,
} from '../browser/index.js';
import { isBossChatIndexUrl } from '../common/auth.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { runRequestAttachmentResume } from './action.js';
import { assertSelectedConversation, openConversationByTarget, type ConversationTarget } from './target_chat.js';

export type SendChatMessageOptions = {
  text?: string;
  requestResume?: boolean;
  signal?: AbortSignal;
  target?: ConversationTarget;
  json?: boolean;
  check?: boolean;
};

export async function runSendChatMessage(options: SendChatMessageOptions): Promise<string> {
  const messageText = (options.text ?? '').trim();
  const signal = options.signal;
  const requestResume = options.requestResume ?? false;

  if (!messageText) {
    throw new Error('请指定 --text <消息> 或 -t <消息>。');
  }
  if (options.check && !options.target) throw new Error('send --check 必须同时提供 --name 和 --data-id。');

  try {
    return await withBossSessionPage(async (page) => {
      if (options.target) {
        await openConversationByTarget(page, options.target, options.check);
      }
      const currentUrl = page.url();
      if (!isBossChatIndexUrl(currentUrl)) {
        throw new Error('请先进入聊天列表页（/web/chat/index）并打开候选人聊天。');
      }

      const input = await page.$('#boss-chat-editor-input');
      if (!input) {
        throw new Error('未找到聊天输入框（#boss-chat-editor-input）。');
      }
      if (options.target) await assertSelectedConversation(page, options.target);
      const sentBefore = (await page.evaluate(`(() => {
        const text = ${JSON.stringify(messageText)};
        const norm = (v) => (v ?? '').replace(/\\s+/g, ' ').trim();
        return Array.from(document.querySelectorAll('.chat-message-list .item-myself .text span'))
          .filter((el) => norm(el.innerText) === norm(text)).length;
      })()`)) as number;

      await input.click({
        delay: randomIntInclusive(SEND_INPUT_CLICK_MS.min, SEND_INPUT_CLICK_MS.max),
      });
      await sleepRandom(60, 220, signal);
      const selectAllMod = selectAllModifierKey();
      signal?.throwIfAborted();
      const clipboardSession = await page.createCDPSession();
      try {
        await clipboardSession.send('Browser.setPermission', {
          permission: { name: 'clipboard-write', allowWithoutSanitization: false },
          setting: 'granted', origin: new URL(currentUrl).origin,
        });
        await page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(messageText)})`);
      } finally {
        await clipboardSession.detach();
      }
      signal?.throwIfAborted();
      // Re-focus and select immediately before pasting: clipboard access may change focus.
      await input.click();
      await page.keyboard.down(selectAllMod);
      await page.keyboard.press('KeyA');
      await page.keyboard.press('KeyV');
      await page.keyboard.up(selectAllMod);
      await page.waitForFunction(`(() => {
        const el = document.querySelector('#boss-chat-editor-input');
        const norm = (v) => (v ?? '').replace(/\\r\\n/g, '\\n').trim();
        return el && norm(el.value ?? el.innerText) === norm(${JSON.stringify(messageText)});
      })()`, { timeout: 5_000 });
      await sleepRandom(120, 420, signal);
      if (options.target) await assertSelectedConversation(page, options.target);
      await page.keyboard.press('Enter');
      await sleepRandom(SEND_AFTER_ENTER_MS.min, SEND_AFTER_ENTER_MS.max, signal);
      await page.waitForFunction(`(() => {
        const text = ${JSON.stringify(messageText)};
        const before = ${sentBefore};
        const norm = (v) => (v ?? '').replace(/\\s+/g, ' ').trim();
        return Array.from(document.querySelectorAll('.chat-message-list .item-myself .text span'))
          .filter((el) => norm(el.innerText) === norm(text)).length > before;
      })()`, { timeout: 15_000 });
      if (options.target) await assertSelectedConversation(page, options.target);

      if (!requestResume) {
        if (options.json) return JSON.stringify({ text: messageText, target: options.target ?? null, status: 'message-visible', requestResume: false });
        return `已发送消息：${messageText}`;
      }

      await sleepRandom(1200, 2800, signal);
      if (options.target) await assertSelectedConversation(page, options.target);
      const resumeResult = await runRequestAttachmentResume(page, options.json);
      if (options.json) return JSON.stringify({ text: messageText, target: options.target ?? null, status: 'message-visible', requestResume: true, resumeRequest: JSON.parse(resumeResult) });
      return `已发送消息：${messageText}\n${resumeResult}`;
    });
  } catch (e) {
    if (e instanceof Error) {
      throw e;
    }
    throw new Error(`发送消息失败：${String(e)}`);
  }
}
