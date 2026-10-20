import type { Page } from 'puppeteer-core';
import { ONLINE_RESUME_IFRAME_WAIT_MAX_MS } from '../browser/index.js';
import { waitForCResumeIframeOrPaywall, describeBossPaywallPopupIfPresent } from '../common/boss_paywall_popup.js';
import { assertNormalSearchPageReadyForPreview, openNormalSearchResumePreview } from './normal-search.js';
import { visibleResumeFrame, readSearchCandidateId, greetNormalSearch } from './search-greet.js';

export async function openSearchResumeOnly(page: Page, target: string) {
  const search = await assertNormalSearchPageReadyForPreview(page);
  const candidateId = await readSearchCandidateId(search, target);
  let resume = await visibleResumeFrame(page);
  const reused = !!resume;
  if (!resume) {
    if (!(await openNormalSearchResumePreview(search, target))) throw new Error(`未能打开目标在线简历：${target}`);
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
  const checked = await greetNormalSearch(page, search, target, true);
  if (checked.candidateId !== candidateId) throw new Error('打开简历期间搜索候选人身份已变化');
  return {name:target,status:'open',reused,sourceUrl:page.url(),resumePath:new URL(resume.url()).pathname,
    candidateId,identityVerified:true,controls:[{text:checked.buttonText}], screenshot:false,closed:false};
}
