import type { Frame, Page } from 'puppeteer-core';
import { describeBossPaywallPopupIfPresent } from '../common/boss_paywall_popup.js';
import { directResumeFrame } from '../common/resume_frame_locator.js';
import { C_RESUME_IFRAME_SELECTOR } from '../common/c_resume_capture.js';
import { sleepRandom } from '../browser/timing.js';

/**
 * 「使用成功」层（`.use-prop-chat-success`）只在平台确认「已发起沟通」后出现，
 * 因此它是触达成功的正向信号，而不是失败。它的出现同时会遮挡简历右侧的沟通按钮，
 * 使按钮翻转读不到，导致 5s 等待超时被误判为未决。
 * 关闭选择器与 contact-notice 一致：`.boss-dialog__footer .boss-dialog__button` 且文本为「关闭」。
 */
function chatSuccessNoticeScript(click: boolean): string {
  return `(() => {
    const norm = v => (v || '').replace(/\\s+/g, ' ').trim();
    const flat = el => (el.textContent || '').replace(/\\s+/g, '');
    const visible = el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
    };
    const panels = Array.from(document.querySelectorAll('.dialog-wrap.active'))
      .filter(el => visible(el) && /^使用成功/.test(flat(el)) && /已为您发起沟通/.test(flat(el)));
    if (panels.length > 1) throw new Error('使用成功弹层不唯一：' + panels.length);
    if (!panels.length) return { present: false };
    const root = panels[0];
    if (!${click}) return { present: true };
    const buttons = Array.from(root.querySelectorAll('.boss-dialog__footer .boss-dialog__button'))
      .filter(el => visible(el) && norm(el.textContent) === '关闭');
    if (buttons.length !== 1) throw new Error('使用成功弹层的关闭控件不唯一：' + buttons.length);
    const button = buttons[0];
    if (button.matches('[disabled],[aria-disabled="true"]') || getComputedStyle(button).pointerEvents === 'none')
      throw new Error('使用成功弹层的关闭控件不可用');
    button.click();
    return { present: true, closed: true };
  })()`;
}

/**
 * 轮询等待「使用成功」层出现并就地关闭。
 * 只有平台确认沟通已发起才会出现该层，所以命中即等于触达成功。
 */
async function probeAndCloseChatSuccessNotice(page: Page, timeoutMs: number): Promise<{ present: boolean; closed?: boolean }> {
  const main = page.mainFrame();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let probe: { present: boolean } | null = null;
    try {
      probe = (await main.evaluate(chatSuccessNoticeScript(false))) as { present: boolean };
    } catch {
      probe = null;
    }
    if (probe?.present) {
      let closed: { present: boolean; closed?: boolean } | null = null;
      try {
        closed = (await main.evaluate(chatSuccessNoticeScript(true))) as { present: boolean; closed?: boolean };
      } catch {
        closed = null;
      }
      return { present: true, closed: closed?.closed === true };
    }
    if (Date.now() >= deadline) return { present: false };
    await sleepRandom(300, 500);
  }
}

/** Selectors and component identity fields verified read-only on the live search page (2026-10-20). */
function contactScript(name: string, resume: boolean, click: boolean, candidateId: string, continueChat = false): string {
  return `(() => {
    const name = ${JSON.stringify(name)};
    const norm = value => (value || '').replace(/\\s+/g, ' ').trim();
    const visible = el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
    };
    let root;
    if (${resume}) {
      const panels = Array.from(document.querySelectorAll('.resume-middle-wrap')).filter(visible);
      if (panels.length !== 1) throw new Error('可见简历操作区不唯一：' + panels.length);
      const panel = panels[0];
      const iframes = Array.from(panel.querySelectorAll(${JSON.stringify(C_RESUME_IFRAME_SELECTOR)})).filter(visible);
      if (iframes.length !== 1) throw new Error('简历操作区与 iframe 关联不唯一');
      const boxes = Array.from(panel.querySelectorAll('.resume-right-side .resume-simple-box')).filter(visible);
      if (boxes.length !== 1) throw new Error('简历右侧操作组件不唯一');
      const props = boxes[0].__vue__?.$props;
      const expected = ${JSON.stringify(candidateId)};
      if (!expected || props?.geekInfo?.encryptGeekId !== expected || props?.resumeInfo?.encryptGeekId !== expected)
        throw new Error('在线简历候选人 ID 与目标卡片不一致或缺失：' + name);
      root = boxes[0];
    } else {
      const cards = Array.from(document.querySelectorAll('.geek-info-card')).filter(el =>
        visible(el) && norm(el.querySelector('.name-label')?.textContent) === name && el.__vue__?.$props?.geek?.geekCard?.encryptGeekId === ${JSON.stringify(candidateId)});
      if (cards.length !== 1) throw new Error('搜索候选人必须按完整显示姓名唯一匹配：' + name + '；matches=' + cards.length);
      const geek = cards[0].__vue__?.$props?.geek?.geekCard;
      if (geek?.encryptGeekId !== ${JSON.stringify(candidateId)} || norm(geek?.name) !== name)
        throw new Error('搜索卡片候选人身份已变化：' + name);
      root = cards[0];
    }
    const LABEL = /^(?:(?:立即沟通|打招呼|继续沟通)(?:[（(]\\s*\\d+\\s*\\/\\s*\\d+\\s*[）)])?|搜索畅聊卡[（(]\\s*\\d+\\s*\\/\\s*\\d+\\s*[）)])$/;
    // 热搜牛人/畅聊卡的权益提示气泡会渲染在按钮内部，使 textContent 变成
    // 「继续沟通 该牛人为热搜牛人，需消耗3次…」，整串匹配会误判为「按钮缺失」。
    // 故按按钮内最贴近标签的叶子文本判定。
    const labelOf = el => {
      const whole = norm(el.textContent);
      if (LABEL.test(whole)) return whole;
      const leaves = Array.from(el.querySelectorAll('*')).filter(x => !x.children.length).map(x => norm(x.textContent)).filter(t => LABEL.test(t));
      return leaves[0] || whole;
    };
    const buttons = Array.from(root.querySelectorAll('button,a,[role="button"],.btn-getcontact,.btn-greet')).filter(el => visible(el) && LABEL.test(labelOf(el)));
    if (buttons.length !== 1) throw new Error('目标沟通按钮缺失或不唯一：' + name + '；matches=' + buttons.length);
    const button = buttons[0], text = labelOf(button);
    if (${continueChat} && text !== '继续沟通') throw new Error('当前按钮不是继续沟通，停止操作');
    if (!${continueChat} && text === '继续沟通') return {name, buttonText:text, status:'already-contacted'};
    if (button.matches(':disabled,[disabled],[aria-disabled="true"]') || /disabled|forbid|ban/.test(button.className) ||
        getComputedStyle(button).pointerEvents === 'none') throw new Error('目标沟通按钮不可用：' + name);
    const r = button.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x,y);
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight || !hit || !(hit === button || button.contains(hit)))
      throw new Error('目标沟通按钮在视口外或被遮挡：' + name);
    if (${click}) button.click();
    return {name, buttonText:text, status:${click ? "'clicked'" : "'ready'"}, point:{x,y}};
  })()`;
}

type ContactState = { name: string; buttonText: string; status: string; point?: { x: number; y: number } };

/**
 * 开聊模式弹层：点「搜索畅聊卡」后页面出现「选择开聊模式 → 使用账号权益 / 使用畅聊卡」。
 * 与选岗弹层同类：点击本身不等于联系成功，必须由随后按钮变为「继续沟通」确认。
 * label 为空时只读列出可选项，不点击。
 */
function contactModeScript(label: string | null, click: boolean): string {
  return `(() => {
    const norm = value => (value || '').replace(/\\s+/g, ' ').trim();
    const visible = el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
    };
    const boxes = Array.from(document.querySelectorAll('.bubble-reference.chat-btns')).filter(visible);
    if (boxes.length > 1) throw new Error('开聊模式弹层不唯一：' + boxes.length);
    if (!boxes.length) return {present:false, options:[]};
    const root = boxes[0];
    const all = Array.from(root.querySelectorAll('*')).filter(el => visible(el) && /^使用\\S*沟通$/.test(norm(el.textContent)));
    const leaves = all.filter(el => !all.some(other => other !== el && el.contains(other)));
    const options = leaves.map(el => norm(el.textContent));
    if (!options.length) throw new Error('开聊模式弹层未找到可选项');
    const label = ${JSON.stringify(label)};
    if (!label) return {present:true, options};
    const hits = leaves.filter(el => { const n = norm(el.textContent); return n === label || n.startsWith(label); });
    if (hits.length !== 1) throw new Error('开聊模式选项不唯一：' + label + '；matches=' + hits.length + '；options=' + JSON.stringify(options));
    const el = hits[0];
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight || !hit || !(hit === el || el.contains(hit)))
      throw new Error('开聊模式选项在视口外或被遮挡：' + label);
    if (${click}) (el.closest('button') || el).click();
    return {present:true, options, clicked:${click}, label:norm(el.textContent), point:{x,y}};
  })()`;
}


/** An iframe's own hit test cannot see overlays in an ancestor document. */
async function assertAncestorFramesExposed(frame: Frame, point: { x: number; y: number }): Promise<void> {
  let child = frame, position = point;
  for (let parent = child.parentFrame(); parent; parent = child.parentFrame()) {
    const elements = await parent.$$('iframe,frame');
    let index = -1;
    try {
      for (let i = 0; i < elements.length; i++) {
        if (await elements[i].contentFrame() === child) { index = i; break; }
      }
    } finally { await Promise.all(elements.map(el => el.dispose())); }
    if (index < 0) throw new Error('沟通按钮所属 iframe 已失效');
    position = await parent.evaluate(`(() => {
      const el = document.querySelectorAll('iframe,frame')[${index}];
      if (!(el instanceof HTMLElement)) throw new Error('沟通 iframe 已失效');
      const r = el.getBoundingClientRect();
      if (Math.abs(r.width - el.offsetWidth) > 1 || Math.abs(r.height - el.offsetHeight) > 1)
        throw new Error('沟通 iframe 存在变换，无法可靠核对遮挡');
      const x = r.left + el.clientLeft + ${position.x}, y = r.top + el.clientTop + ${position.y};
      if (document.elementFromPoint(x,y) !== el) throw new Error('沟通按钮被上层页面遮挡，停止点击');
      return {x,y};
    })()`) as { x: number; y: number };
    child = parent;
  }
}

export async function visibleResumeFrame(page: Page, host: Frame = page.mainFrame(), timeoutMs = 0): Promise<Frame | null> {
  return directResumeFrame(host, timeoutMs);
}

/** Read the same identity used by the rendered search card. No component methods are called. */
export async function readSearchCandidateId(searchFrame: Frame, name: string, expectedCandidateId?: string): Promise<string> {
  return await searchFrame.evaluate(`(() => {
    const norm = value => (value || '').replace(/\\s+/g,' ').trim();
    const cards = Array.from(document.querySelectorAll('.geek-info-card'))
      .filter(el => norm(el.querySelector('.name-label')?.textContent) === ${JSON.stringify(name)} && (!${JSON.stringify(expectedCandidateId)} || el.__vue__?.$props?.geek?.geekCard?.encryptGeekId === ${JSON.stringify(expectedCandidateId)}));
    if (cards.length !== 1) throw new Error('搜索列表姓名不唯一或ID不匹配，禁止操作：name=' + ${JSON.stringify(name)} + '；candidateId=' + ${JSON.stringify(expectedCandidateId)} + '；matches=' + cards.length);
    const geek = cards[0].__vue__?.$props?.geek?.geekCard;
    if (norm(geek?.name) !== ${JSON.stringify(name)} || typeof geek?.encryptGeekId !== 'string' || !geek.encryptGeekId.trim())
      throw new Error('搜索卡片候选人姓名或 ID 缺失/不符');
    return geek.encryptGeekId;
  })()`) as string;
}

/** Explicit search branch: never closes a resume, changes jobs or retries a click. */
export async function greetNormalSearch(page: Page, searchFrame: Frame, name: string, check = false, continueChat = false, expectedCandidateId?: string, contactMode?: string) {
  const resumeFrame = await visibleResumeFrame(page);
  if (resumeFrame && resumeFrame.parentFrame() !== page.mainFrame())
    throw new Error('搜索简历 iframe 不属于主页面，停止操作');
  const frame = resumeFrame ? page.mainFrame() : searchFrame;
  const source = resumeFrame ? 'search-resume' : 'search';
  if (continueChat && (!resumeFrame || !expectedCandidateId?.trim()))
    throw new Error('继续沟通需要已打开简历及成功回执中的 --candidate-id');
  if (contactMode !== undefined) {
    // 开聊模式弹层依附于已打开的在线简历；与选岗一致：不关闭、不重开，凭同一 candidateId 核验。
    if (!resumeFrame) throw new Error('选择开聊模式需要已打开在线简历');
    if (!expectedCandidateId?.trim()) throw new Error('选择开聊模式需要 --candidate-id');
    const main = page.mainFrame();
    const state = await main.evaluate(contactScript(name, true, false, expectedCandidateId, false)) as ContactState;
    if (state.status === 'already-contacted')
      return { source, ...state, candidateId: expectedCandidateId, identityVerified: true, clicked: false };
    const paywall = await describeBossPaywallPopupIfPresent(page, 'greet');
    if (paywall) throw new Error(paywall);
    if (check) {
      const probe = await main.evaluate(contactModeScript(null, false)) as { present: boolean; options: string[] };
      return { source, name, candidateId: expectedCandidateId, identityVerified: true, status: probe.present ? 'mode-ready' : 'mode-missing', options: probe.options, clicked: false };
    }
    const picked = await main.evaluate(contactModeScript(contactMode, true)) as { present: boolean; options: string[]; label: string };
    try {
      await main.waitForFunction(`(() => {
        const state = ${contactScript(name, true, false, expectedCandidateId, false)};
        return state.status === 'already-contacted';
      })()`, { timeout: 8_000, polling: 200 });
      return { source, name, candidateId: expectedCandidateId, identityVerified: true, buttonText: '继续沟通', status: 'contact-confirmed', clicked: true, mode: picked.label };
    } catch {
      // 已点击选项但按钮未翻转：动作可能已发生，只报未确认，不重试、不推断成功。
      return { source, name, candidateId: expectedCandidateId, identityVerified: true, status: 'mode-clicked', clicked: true, mode: picked.label, options: picked.options };
    }
  }
  const candidateId = continueChat ? expectedCandidateId! : await readSearchCandidateId(searchFrame, name, expectedCandidateId);
  const paywall = await describeBossPaywallPopupIfPresent(page, 'greet');
  if (paywall) throw new Error(paywall);
  const before = await frame.evaluate(contactScript(name, !!resumeFrame, false, candidateId, continueChat)) as ContactState;
  if (before.point) await assertAncestorFramesExposed(frame, before.point);
  if (check || before.status === 'already-contacted') return { source, ...before, candidateId, identityVerified:true, clicked: false };
  if (!continueChat && await readSearchCandidateId(searchFrame, name, expectedCandidateId) !== candidateId)
    throw new Error('点击前搜索候选人身份已变化，停止操作');
  let clicked: ContactState;
  try {
    clicked = await frame.evaluate(contactScript(name, !!resumeFrame, true, candidateId, continueChat)) as ContactState;
  } catch (error) {
    throw new Error(`沟通点击阶段失败，动作是否发生尚未确认，禁止自动重试：${name}；${error instanceof Error ? error.message : String(error)}`);
  }
  if (continueChat) return {source,name,candidateId,identityVerified:true,buttonText:clicked.buttonText,status:'continue-clicked',clicked:true};
  if (clicked.status === 'already-contacted') return { source, ...clicked, candidateId, identityVerified:true, clicked: false };
  try {
    await frame.waitForFunction(`(() => {
      const state = ${contactScript(name, !!resumeFrame, false, candidateId, continueChat)};
      return state.status === 'already-contacted';
    })()`, { timeout: 5_000, polling: 200 });
    return { source, name, candidateId, identityVerified:true, buttonText: '继续沟通', status: 'contact-confirmed', clicked: true };
  } catch (error) {
    // 「使用成功」层出现即证明平台已发起沟通；它同时遮挡按钮使翻转读不到，是本次超时的真实原因。
    // 命中时按成功返回并就地关闭该层，避免叠层挡住后续「继续沟通」。
    const notice = await probeAndCloseChatSuccessNotice(page, 3_000);
    if (notice.present)
      return { source, name, candidateId, identityVerified: true, buttonText: clicked.buttonText, status: 'contact-confirmed', clicked: true, via: 'chat-success-notice', noticeClosed: notice.closed === true };
    // 首次联系可能只弹出「选择开聊模式」：这不是失败，下一步用 --contact-mode 选择后确认。
    const probe = await frame.evaluate(contactModeScript(null, false)).catch(() => null) as { present: boolean; options: string[] } | null;
    if (probe?.present)
      return { source, name, candidateId, identityVerified: true, buttonText: clicked.buttonText, status: 'mode-required', clicked: true, options: probe.options };
    throw new Error(`已点击一次「${clicked.buttonText}」，但未确认沟通成功；可能已产生动作，禁止自动重试。候选人=${name}；原因=${error instanceof Error ? error.message : String(error)}`);
  }
}
