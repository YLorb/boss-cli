/**
 * 在线简历预览：须在「推荐」页、「深度搜索 aiform」页或「常规搜索」页且列表已加载；不自动跳转，否则报错。
 */
import { openSearchResumeOnly } from './open-search-resume.js';
import { readRecommendCandidateId, assertRecommendResumeIdentity } from './recommend_identity.js';
import { visibleResumeFrame } from './search-greet.js';
import { join } from 'node:path';
import { ONLINE_RESUME_IFRAME_WAIT_MAX_MS } from '../browser/index.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import {
  closeBossPaywallPopupIfPresent,
  describeBossPaywallPopupIfPresent,
  waitForCResumeIframeOrPaywall,
} from '../common/boss_paywall_popup.js';
import {
  captureCResumeIframeToFile,
  closeCResumePanel,
  safeResumeScreenshotFileBase,
  waitForVisibleCResumeIframeReady,
} from '../common/c_resume_capture.js';
import { ensureAppDataLayout, RESUME_SCREENSHOTS_DIR } from '../config.js';
import {
  ensureInDeepSearchPage,
  isBossChatAiFormUrl,
  openDeepSearchResumePreview,
  readAiFormSelectedJobLabel,
} from './deep-search.js';
import {
  assertRecommendPageReadyForPreview,
  isBossChatRecommendUrl,
  openRecommendResumePreview,
  readCurrentRecommendJobLabel,
} from './recommend.js';
import {
  assertNormalSearchPageReadyForPreview,
  isBossChatSearchUrl,
  readNormalSearchSelectedJobLabel,
} from './normal-search.js';

export type PreviewOptions = {
  json?: boolean;
  candidateTarget: string;
  candidateId?: string;
  openOnly?: boolean;
};

export async function runPreview(options: PreviewOptions): Promise<string> {
  const target = options.candidateTarget.trim();
  if (!target) {
    throw new Error('请提供候选人姓名。');
  }
  try {
    return await withBossSessionPage(async (page) => {
      const url = page.url();
      if (options.candidateId && !isBossChatSearchUrl(url) && !isBossChatRecommendUrl(url)) throw new Error('--candidate-id 仅支持常规搜索页或推荐页');
      let verifiedCandidateId: string | undefined;
      if (options.openOnly) {
        if (!isBossChatSearchUrl(url)) throw new Error('preview --open-only 当前仅支持常规搜索页');
        const result = await openSearchResumeOnly(page, target, options.candidateId);
        return options.json ? JSON.stringify(result) : `在线简历已打开并核对：${target}；保持展开，未截图、未沟通`;
      }
      let jobLine: string;
      let job: string;
      let opened: boolean;

      if (isBossChatAiFormUrl(url)) {
        await ensureInDeepSearchPage(page);
        const label = await readAiFormSelectedJobLabel(page);
        job = label;
        jobLine = `当前岗位：${label}`;
        opened = await openDeepSearchResumePreview(page, target);
      } else if (isBossChatRecommendUrl(url)) {
        const frame = await assertRecommendPageReadyForPreview(page);
        job = options.json ? await readCurrentRecommendJobLabel(frame) : '';
        jobLine = '当前岗位：当前推荐列表';
        verifiedCandidateId = await readRecommendCandidateId(frame,target,options.candidateId);
        if(await visibleResumeFrame(page)) {
          await assertRecommendResumeIdentity(page,verifiedCandidateId);
          opened = true;
        } else opened = await openRecommendResumePreview(frame,target,verifiedCandidateId);
      } else if (isBossChatSearchUrl(url)) {
        const frame = await assertNormalSearchPageReadyForPreview(page);
        const label = await readNormalSearchSelectedJobLabel(frame);
        job = label;
        jobLine = `当前岗位：${label}`;
        const result = await openSearchResumeOnly(page, target, options.candidateId);
        verifiedCandidateId = result.candidateId;
        opened = true;
      } else {
        throw new Error('当前不在推荐列表页、深度搜索页或常规搜索页，无法预览候选人。');
      }

      if (!opened) {
        throw new Error('未在列表中找到该候选人，或点击未能打开简历预览。');
      }

      const outcome = await waitForCResumeIframeOrPaywall(page, ONLINE_RESUME_IFRAME_WAIT_MAX_MS);
      if (outcome !== 'iframe') {
        const paywall = await describeBossPaywallPopupIfPresent(page);
        await closeBossPaywallPopupIfPresent(page);
        if (paywall) {
          throw new Error(paywall);
        }
        throw new Error('点击后未出现在线简历 iframe（c-resume）。');
      }
      const ready = await waitForVisibleCResumeIframeReady(page);
      if (!ready) {
        throw new Error('在线简历 iframe 已出现，但内容未在预期时间内渲染完成。');
      }
      if(isBossChatRecommendUrl(url)) {
        const frame=await assertRecommendPageReadyForPreview(page);
        await readRecommendCandidateId(frame,target,verifiedCandidateId);
        await assertRecommendResumeIdentity(page,verifiedCandidateId!);
      }
      ensureAppDataLayout();
      const fileName = `preview-${safeResumeScreenshotFileBase(target)}-${Date.now()}.png`;
      const absPath = join(RESUME_SCREENSHOTS_DIR, fileName);

      const ok = await captureCResumeIframeToFile(page, absPath);
      if (!ok) {
        await closeCResumePanel(page);
        throw new Error('在线简历 iframe 截图失败。');
      }

      const disclaimer =
        '说明：平台对在线简历的每日可查看次数有限，请按需使用、谨慎查看。';

      if (options.json) return JSON.stringify({ name: target, ...(verifiedCandidateId ? {candidateId: verifiedCandidateId, identityVerified:true} : {}), sourceUrl: url, job, path: absPath, type: 'online-resume-screenshot' });

      return [jobLine, `简历预览截图：${absPath}`, '', disclaimer].join('\n');
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`简历预览失败：${message}`);
  }
}
