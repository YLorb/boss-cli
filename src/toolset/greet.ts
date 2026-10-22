import {
  GREET_PAYWALL_WAIT_MAX_MS,
  sleepRandom,
} from '../browser/index.js';
import { closeBossModalIfPresent, waitAndCloseBossModalIfPresent } from '../common/boss_modal.js';
import {
  closeBossPaywallPopupIfPresent,
  describeBossPaywallPopupIfPresent,
  waitForBossPaywallPopup,
} from '../common/boss_paywall_popup.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import {
  clickGreetDeepSearch,
  ensureInDeepSearchPage,
  isBossChatAiFormUrl,
  readDeepSearchGeekList,
  renderGeekListSection,
  selectAiFormJob,
} from './deep-search.js';
import {
  clickGreet,
  assertRecommendPageReady,
  markGreetProduced,
  readRecommendList,
  renderRecommendList,
  selectRecommendJob,
} from './recommend.js';
import { isBossChatSearchUrl, assertNormalSearchPageReadyForPreview } from './normal-search.js';
import { selectSearchContactJob } from './search-contact-job.js';
import { greetNormalSearch } from './search-greet.js';
import { inspectSearchContactFrames } from './search-contact-diagnostics.js';
import type { Page } from 'puppeteer-core';

/** 操作完成后等待并关闭延迟出现的提示弹层（如「当前职位尚未开放」）。 */
const GREET_MODAL_CLEANUP_WAIT_MAX_MS = 4000;

async function assertNoGreetPaywallPopup(page: Page): Promise<void> {
  if (await waitForBossPaywallPopup(page, GREET_PAYWALL_WAIT_MAX_MS)) {
    const paywall = await describeBossPaywallPopupIfPresent(page, 'greet');
    await closeBossPaywallPopupIfPresent(page);
    if (paywall) {
      throw new Error(paywall);
    }
    throw new Error('页面出现 VIP/付费购买弹层，打招呼可能需开通权益或充值直豆。');
  }
}

async function cleanupGreetModalIfPresent(page: Page): Promise<void> {
  await waitAndCloseBossModalIfPresent(page, GREET_MODAL_CLEANUP_WAIT_MAX_MS);
}

export type GreetOptions = {
  candidateTarget: string;
  jobKeyword?: string;
  check?: boolean;
  selectJob?: string;
  confirmContact?: boolean;
  continueChat?: boolean;
  candidateId?: string;
  json?: boolean;
};

export async function runRecommendGreet(options: GreetOptions): Promise<string> {
  const t = options.candidateTarget.trim();
  const kw = (options.jobKeyword ?? '').trim();
  if (!t) {
    throw new Error('请提供打招呼目标（姓名）。');
  }
  try {
    return await withBossSessionPage(async (page) => {
      const url = page.url();
      if (isBossChatSearchUrl(url)) {
        if (kw) throw new Error('搜索页 greet 不支持 --job；请先核对当前搜索岗位');
        const frame = await assertNormalSearchPageReadyForPreview(page);
        if (options.selectJob) {
          const selected = await selectSearchContactJob(page, frame, t, options.selectJob, options.check === true, options.confirmContact === true, options.candidateId);
          return options.json ? JSON.stringify(selected) : `候选人：${t}；岗位：${selected.job}；selected=${selected.selected}；contactConfirmed=${selected.contactConfirmed}`;
        }
        let result;
        try {
          result = await greetNormalSearch(page, frame, t, options.check === true, options.continueChat === true, options.candidateId);
        } catch (error) {
          if (!options.check) throw error;
          const diagnostics = await inspectSearchContactFrames(page, t);
          throw new Error(`${error instanceof Error ? error.message : String(error)}；只读frame诊断=${JSON.stringify(diagnostics)}`);
        }
        return options.json ? JSON.stringify(result) : `候选人：${t}；入口：${result.source}；状态：${result.status}；clicked=${result.clicked}`;
      }
      if (options.candidateId) throw new Error('--candidate-id 仅支持搜索页');
      if (options.continueChat) throw new Error('--continue-chat 仅支持搜索页');
      if (options.selectJob) throw new Error('--select-job 仅支持搜索页已打开的联系岗位弹层');
      if (options.check) throw new Error('greet --check 当前仅支持常规搜索页及其在线简历');
      await closeBossModalIfPresent(page);
      if (isBossChatAiFormUrl(url)) {
        await ensureInDeepSearchPage(page);
        let jobLine = '';
        if (kw) {
          const label = await selectAiFormJob(page, kw);
          await ensureInDeepSearchPage(page);
          jobLine = `当前岗位：${label}`;
        }
        const greetResult = await clickGreetDeepSearch(page, t);
        await assertNoGreetPaywallPopup(page);
        await sleepRandom(380, 1000);
        const after = await readDeepSearchGeekList(page);
        await cleanupGreetModalIfPresent(page);
        if (options.json) return JSON.stringify({ source: 'deep-search', ...greetResult, jobKeyword: kw, status: 'clicked', candidates: after });
        const lines = [greetResult.message];
        if (jobLine) {
          lines.unshift(jobLine);
        }
        lines.push('', '当前深度搜索列表：', renderGeekListSection('深度搜索匹配结果', after));
        return lines.join('\n');
      }

      const frame = await assertRecommendPageReady(page, '打招呼');
      const selectedJob = await selectRecommendJob(frame, kw);
      const jobLine = selectedJob ? `当前岗位：${selectedJob}` : '当前岗位：默认';
      const before = await readRecommendList(frame);
      const greetResult = await clickGreet(frame, t);
      await assertNoGreetPaywallPopup(page);
      await sleepRandom(380, 1000);
      const after = await readRecommendList(frame);
      markGreetProduced(before, after);
      await cleanupGreetModalIfPresent(page);
      if (options.json) return JSON.stringify({ source: 'recommend', ...greetResult, job: selectedJob, status: 'clicked', candidates: after });
      return [jobLine, greetResult.message, '', '当前推荐列表（来源分组）：', renderRecommendList(after)].join('\n');
    }, { ensureChatShell: false, ensureMenuList: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`执行打招呼失败：${message}`);
  }
}
