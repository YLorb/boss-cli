import type { Frame, Page } from 'puppeteer-core';
import { describeBossPaywallPopupIfPresent } from '../common/boss_paywall_popup.js';
import { C_RESUME_IFRAME_SELECTOR } from '../common/c_resume_capture.js';

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
    const buttons = Array.from(root.querySelectorAll('button,a,[role="button"],.btn-getcontact,.btn-greet')).filter(el =>
      visible(el) && /^(立即沟通|打招呼|继续沟通)(?:[（(]\\s*\\d+\\s*\\/\\s*\\d+\\s*[）)])?$/.test(norm(el.textContent)));
    if (buttons.length !== 1) throw new Error('目标沟通按钮缺失或不唯一：' + name + '；matches=' + buttons.length);
    const button = buttons[0], text = norm(button.textContent);
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

export async function visibleResumeFrame(page: Page): Promise<Frame | null> {
  const found: Frame[] = [];
  for (const parent of page.frames()) {
    for (const handle of await parent.$$(C_RESUME_IFRAME_SELECTOR)) {
      try {
        if (!(await handle.isVisible())) continue;
        const box = await handle.boundingBox();
        if (!box || box.width < 8 || box.height < 8) continue;
        const frame = await handle.contentFrame();
        if (!frame) throw new Error('在线简历 iframe 尚未就绪，停止沟通');
        found.push(frame);
      } finally { await handle.dispose(); }
    }
  }
  if (found.length > 1) throw new Error('多个在线简历同时可见，无法确定沟通目标');
  return found[0] ?? null;
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
export async function greetNormalSearch(page: Page, searchFrame: Frame, name: string, check = false, continueChat = false, expectedCandidateId?: string) {
  const resumeFrame = await visibleResumeFrame(page);
  if (resumeFrame && resumeFrame.parentFrame() !== page.mainFrame())
    throw new Error('搜索简历 iframe 不属于主页面，停止操作');
  const frame = resumeFrame ? page.mainFrame() : searchFrame;
  const source = resumeFrame ? 'search-resume' : 'search';
  if (continueChat && (!resumeFrame || !expectedCandidateId?.trim()))
    throw new Error('继续沟通需要已打开简历及成功回执中的 --candidate-id');
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
    throw new Error(`已点击一次「${clicked.buttonText}」，但未确认沟通成功；可能已产生动作，禁止自动重试。候选人=${name}；原因=${error instanceof Error ? error.message : String(error)}`);
  }
}
