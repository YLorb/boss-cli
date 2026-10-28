import type { Page } from 'puppeteer-core';
import { ONLINE_RESUME_IFRAME_WAIT_MAX_MS } from '../browser/index.js';
import { waitForCResumeIframeOrPaywall, describeBossPaywallPopupIfPresent } from '../common/boss_paywall_popup.js';
import { assertNormalSearchPageReadyForPreview, openNormalSearchResumePreview } from './normal-search.js';
import { visibleResumeFrame, readSearchCandidateId } from './search-greet.js';
import { RESUME_IDENTITY_SCRIPT } from './recommend_identity.js';

export async function openSearchResumeOnly(page: Page, target: string, expectedCandidateId?: string) {
  const search = await assertNormalSearchPageReadyForPreview(page);
  const candidateId = await readSearchCandidateId(search, target, expectedCandidateId);
  let resume = await visibleResumeFrame(page);
  const reused = !!resume;
  if (!resume) {
    if (!(await openNormalSearchResumePreview(search, target, candidateId))) throw new Error(`未能打开目标在线简历：${target}`);
    if (await waitForCResumeIframeOrPaywall(page, ONLINE_RESUME_IFRAME_WAIT_MAX_MS) !== 'iframe') {
      throw new Error(await describeBossPaywallPopupIfPresent(page) || '未出现在线简历；停止，不关闭页面或重试');
    }
    resume = await visibleResumeFrame(page);
    if (!resume) throw new Error('在线简历 iframe 不可见');
  }
  await resume.waitForFunction(`(() => {
    const canvas=document.querySelector('canvas#resume');
    return canvas && canvas.width>0 && canvas.height>0 && document.readyState==='complete';
  })()`, {timeout:15_000,polling:200});
  if (resume.parentFrame() !== page.mainFrame()) throw new Error('搜索简历 iframe 不属于主页面，停止预览');
  const identity = await page.evaluate(RESUME_IDENTITY_SCRIPT) as {geekId: string; resumeId: string};
  if (identity.geekId !== candidateId || identity.resumeId !== candidateId)
    throw new Error(`搜索简历 ID 核验失败：expected=${candidateId}；actual=${JSON.stringify(identity)}`);
  if (await readSearchCandidateId(search, target, expectedCandidateId) !== candidateId)
    throw new Error('打开简历期间搜索候选人身份已变化');
  // Preview verifies identity, not contact eligibility. These labels are informational only.
  const controls = await page.evaluate(`(() => {
    const visible=el=>el.getClientRects().length>0 && getComputedStyle(el).visibility!=='hidden';
    const panels=Array.from(document.querySelectorAll('.resume-middle-wrap')).filter(visible);
    if(panels.length!==1)throw Error('读取预览控件时简历面板不唯一');
    const boxes=Array.from(panels[0].querySelectorAll('.resume-right-side .resume-simple-box')).filter(visible);
    if(boxes.length!==1)throw Error('读取预览控件时身份组件不唯一');
    const props=boxes[0].__vue__?.$props;
    if(props?.geekInfo?.encryptGeekId!==${JSON.stringify(candidateId)} || props?.resumeInfo?.encryptGeekId!==${JSON.stringify(candidateId)})
      throw Error('读取预览控件时简历 ID 已变化');
    return Array.from(boxes[0].querySelectorAll('button,a,[role="button"],.btn-getcontact,.btn-greet'))
      .filter(visible).map(el=>({text:(el.textContent||'').replace(/\\s+/g,' ').trim()}));
  })()`) as {text: string}[];
  return {name:target,status:'open',reused,sourceUrl:page.url(),resumePath:new URL(resume.url()).pathname,
    candidateId,identityVerified:true,controls, screenshot:false,closed:false};
}
