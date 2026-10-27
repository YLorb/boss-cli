import { runCheck } from './check.js';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'puppeteer-core';
import { APP_HOME } from '../config.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { runChatActionOnCurrentConversation } from './action.js';
import { ATTACHMENT_PREVIEW_CONTENT_SELECTOR, assertSelectedConversation, closeAttachmentPreview, openConversationByTarget, type ConversationTarget } from './target_chat.js';

const MAX_BYTES = 50 * 1024 * 1024;

/** 接受当前候选人发来的附件请求；不发送任何文字消息。 */
export async function runAcceptTargetResume(target: ConversationTarget, json = false, check = false): Promise<string> {
  if(check) return runCheck({page:'chat',state:'resume-request',...target,embedded:false});
  return withBossSessionPage(async (page) => {
    await openConversationByTarget(page, target);
    return runChatActionOnCurrentConversation(page, { action: 'agree-resume', target, json });
  });
}

async function latestAttachmentCard(page: Page): Promise<string> {
  const name = (await page.evaluate(`(() => {
    const norm = (v) => (v ?? '').replace(/\\s+/g, ' ').trim();
    const cards = Array.from(document.querySelectorAll('.chat-message-list .message-item .item-friend'))
      .filter((el) => el.querySelector('.resume-icon'));
    return norm(cards.at(-1)?.querySelector('.message-card-top-title')?.textContent);
  })()`)) as string;
  if (!name) throw new Error('当前会话没有已收到的附件简历卡片。');
  return name;
}

async function waitForCompletedDownload(dir: string, timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let stable = 0;
  let previous = '';
  while (Date.now() < deadline) {
    const entries = await readdir(dir);
    const complete = entries.filter((name) => !name.endsWith('.crdownload') && !name.endsWith('.tmp'));
    if (complete.length > 1) throw new Error(`下载目录出现多个文件，无法确定目标：${dir}`);
    if (complete.length === 1 && entries.length === 1) {
      const file = path.join(dir, complete[0]!);
      const info = await stat(file);
      if (info.size > MAX_BYTES) throw new Error(`附件超过 50 MiB：${info.size} 字节，路径：${file}`);
      if (info.isFile() && info.size > 0) {
        const current = `${file}:${info.size}`;
        stable = current === previous ? stable + 1 : 1;
        previous = current;
        if (stable >= 2) return file;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`等待原附件下载完成超时（${timeoutMs}ms），目录：${dir}`);
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** 使用 Boss 页面自身的预览和下载按钮保存原附件。 */
export async function runDownloadTargetResume(
  target: ConversationTarget,
  outputDir = path.join(APP_HOME, 'resume-files'),
  check = false,
): Promise<string> {
  if(check) return runCheck({page:'chat',state:'resume-received',...target,embedded:false});
  return withBossSessionPage(async (page) => {
    await openConversationByTarget(page, target);
    return downloadCurrentResume(page, target, outputDir);
  });
}

async function downloadCurrentResume(page: Page, target: ConversationTarget, outputDir: string): Promise<string> {
    const cardName = await latestAttachmentCard(page);
    await assertSelectedConversation(page, target);
    const previewButtons = await page.$$('.chat-message-list .message-item .item-friend:has(.resume-icon) .message-card-buttons .card-btn');
    const previewButton = previewButtons.at(-1);
    if (!previewButton) throw new Error(`候选人「${target.name} / ${target.dataId}」的附件卡片没有预览按钮。`);
    await previewButton.click();
    await page.waitForSelector(ATTACHMENT_PREVIEW_CONTENT_SELECTOR, { visible: true, timeout: 20_000 });
    await page.waitForFunction(`(() => {
      const contents = Array.from(document.querySelectorAll(${JSON.stringify(ATTACHMENT_PREVIEW_CONTENT_SELECTOR)}))
        .filter((el) => el.getBoundingClientRect().width && el.getBoundingClientRect().height);
      if (contents.length !== 1) throw new Error('可见附件预览数量异常：' + contents.length);
      const content = contents[0];
      return content.tagName === 'IFRAME' || (content.complete && content.naturalWidth > 0);
    })()`, { timeout: 20_000 });
    await assertSelectedConversation(page, target);

    const preview = (await page.evaluate(`(() => {
      const contents = Array.from(document.querySelectorAll(${JSON.stringify(ATTACHMENT_PREVIEW_CONTENT_SELECTOR)}))
        .filter((el) => el.getBoundingClientRect().width && el.getBoundingClientRect().height);
      if (contents.length !== 1) throw new Error('可见附件预览数量异常：' + contents.length);
      const content = contents[0];
      const src = content.getAttribute('src');
      if (!src) throw new Error('附件预览内容缺少 src：' + content.tagName);
      let geekId = null;
      if (content.tagName === 'IFRAME') {
        const outer = new URL(src, location.origin);
        const innerRaw = outer.searchParams.get('url');
        if (!innerRaw) throw new Error('附件预览地址缺少 url 参数。');
        const inner = new URL(innerRaw, location.origin);
        geekId = inner.searchParams.get('geekId') ?? '';
      }
      const buttons = Array.from(document.querySelectorAll('.resume-detail-chat .attachment-resume-btns > .popover.icon-content'));
      const matches = buttons.map((el, index) => ({ el, index }))
        .filter(({ el }) => el.querySelector('use')?.getAttribute('xlink:href') === '#icon-attacthment-download');
      if (matches.length !== 1) throw new Error('下载图标数量异常：' + matches.length);
      return { geekId, downloadIndex: matches[0].index };
    })()`)) as { geekId: string | null; downloadIndex: number };

    const absoluteOutputDir = path.resolve(outputDir);
    await mkdir(absoluteOutputDir, { recursive: true });
    const downloadDir = path.join(absoluteOutputDir, randomUUID());
    await mkdir(downloadDir);
    const downloadSession = await page.createCDPSession();
    await downloadSession.send('Browser.setDownloadBehavior', {
      behavior: 'allow', downloadPath: downloadDir,
    });
    let file: string;
    try {
      await assertSelectedConversation(page, target);
      const icons = await page.$$('.resume-detail-chat .attachment-resume-btns > .popover.icon-content');
      const downloadIcon = icons[preview.downloadIndex];
      if (!downloadIcon) throw new Error('附件下载图标在点击前消失。');
      await downloadIcon.click();
      file = await waitForCompletedDownload(downloadDir);
    } finally {
      await downloadSession.detach();
    }
    await assertSelectedConversation(page, target);
    const info = await stat(file);
    const hash = await sha256File(file);
    await closeAttachmentPreview(page);
    return JSON.stringify({ name: target.name, dataId: target.dataId, geekId: preview.geekId,
      attachmentName: cardName, fileName: path.basename(file), path: file,
      bytes: info.size, sha256: hash });
}

export type AttachmentProbe = {
  name: string;
  dataId: string;
  attachment: 'RECEIVED' | 'NOT_OBSERVED';
  attachmentName: string | null;
  request: 'SENT' | 'NOT_OBSERVED';
  requestEvidence: string[];
  scope: 'loaded-messages';
  download: Record<string, unknown> | null;
};

export function validateAttachmentProbe(value: AttachmentProbe): void {
  if (!value || typeof value.name !== 'string' || !value.name.trim() || typeof value.dataId !== 'string' || !value.dataId.trim() ||
      !['RECEIVED', 'NOT_OBSERVED'].includes(value.attachment) || !['SENT', 'NOT_OBSERVED'].includes(value.request) ||
      (value.attachment === 'RECEIVED' ? typeof value.attachmentName !== 'string' || !value.attachmentName : value.attachmentName !== null) ||
      value.scope !== 'loaded-messages' || !Array.isArray(value.requestEvidence) || value.requestEvidence.some(text => typeof text !== 'string') ||
      (value.request === 'SENT' && !value.requestEvidence.length) ||
      (value.download !== null && (typeof value.download !== 'object' ||
        typeof value.download.path !== 'string' || typeof value.download.sha256 !== 'string' || typeof value.download.bytes !== 'number'))) {
    throw new Error('附件探测结果格式无效，不能更新账本。');
  }
}

/** Read attachment evidence first, then outgoing request evidence; never send a message. */
export async function runProbeTargetResume(target: ConversationTarget, download = false, outputDir = path.join(APP_HOME, 'resume-files')): Promise<string> {
  return withBossSessionPage(async (page) => {
    await openConversationByTarget(page, target);
    await page.waitForSelector('.chat-message-list .message-item', { timeout: 15_000 });
    const evidence = await page.evaluate(`(() => {
      const norm = v => (v ?? '').replace(/\\s+/g, ' ').trim();
      const lists = Array.from(document.querySelectorAll('.chat-message-list'))
        .filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height);
      if (lists.length !== 1) throw new Error('可见消息列表数量异常：' + lists.length);
      const list = lists[0];
      const cards = Array.from(list.querySelectorAll('.message-item .item-friend')).filter(el => el.querySelector('.resume-icon'));
      const attachment = cards.length > 0;
      const attachmentName = attachment ? norm(cards.at(-1).querySelector('.message-card-top-title')?.textContent) : null;
      if (attachment && !attachmentName) throw new Error('附件卡片缺少名称，不能确认附件。');
      const requestEvidence = Array.from(list.querySelectorAll('.message-item .item-myself .text'))
        .map(el => norm(el.textContent)).filter(text => ['方便发一份你的简历过来吗？', '你好，方便发一份你的简历过来吗？'].includes(text));
      return { attachment, attachmentName, requestEvidence };
    })()`) as { attachment: boolean; attachmentName: string | null; requestEvidence: string[] };
    await assertSelectedConversation(page, target);
    const result: AttachmentProbe = {
      ...target, attachment: evidence.attachment ? 'RECEIVED' : 'NOT_OBSERVED', attachmentName: evidence.attachmentName,
      request: evidence.requestEvidence.length ? 'SENT' : 'NOT_OBSERVED',
      requestEvidence: evidence.requestEvidence, scope: 'loaded-messages', download: null,
    };
    if (download && evidence.attachment) result.download = JSON.parse(await downloadCurrentResume(page, target, outputDir));
    return JSON.stringify(result);
  });
}
