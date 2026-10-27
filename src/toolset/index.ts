import { runCheck } from './check.js';
import { searchChatCandidate, type ChatSearchOptions } from './chat_search.js';
import { isBossChatIndexUrl } from '../common/auth.js';
/** 业务实现聚合出口：impl* 供 CLI 与其它模块调用 */
import { runLogin } from './login.js';
import { runGetCandidateList, type CandidateListOptions } from './list.js';
import { runListOpenPositions } from './jd.js';
import { renderOpenedCandidateChat, runOpenCandidateChat, runOpenCandidateChatByIndex } from './chat.js';
import {
  runChatActionOnCurrentConversation,
  type ChatPageAction,
} from './action.js';
import { runSendChatMessage } from './send.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { runBossSearch, runBossSearchSet } from './deep-search.js';
import { runNormalSearch } from './normal-search.js';
import { runRecommend } from './recommend.js';
import { runPreview } from './preview.js';
import { runRecommendGreet } from './greet.js';
import { readSelectedConversation, assertSelectedConversation, openConversationByTarget, type ConversationTarget } from './target_chat.js';
import { runAcceptTargetResume, runDownloadTargetResume } from './attachment.js';
export type { ChatPageAction };
export async function implChatSearch(options: ChatSearchOptions, json = false): Promise<string> {
  const result = await withBossSessionPage(page => searchChatCandidate(page, options));
  return json ? JSON.stringify(result) : result.status === 'needs-confirmation'
    ? `已暂停：${result.reason}\n${JSON.stringify(result.matches)}`
    : result.status === 'not-found' ? `搜索完成，无匹配候选人：${result.name}`
    : `已打开并核验：${result.name} / ${result.dataId} / ${result.job}`;
}
export type { DeepSearchGeekItem } from './deep-search.js';

export async function implLogin(json = false): Promise<string> {
  return runLogin(json);
}

export async function implListCandidates(opts: CandidateListOptions = {}): Promise<string> {
  return runGetCandidateList(opts);
}

export async function implListUnreadCandidates(): Promise<string> {
  return runGetCandidateList({ unreadOnly: true });
}

export async function implOpenChat(
  candidateName: string,
  exact: boolean,
  json = false,
  check = false,
): Promise<string> {
  if (check) return runCheck({page:'chat',state:'conversation',name:candidateName,embedded:false});
  return withBossSessionPage(async (page) => runOpenCandidateChat(page, candidateName, exact, json));
}

export async function implOpenTargetChat(target: ConversationTarget, json = false): Promise<string> {
  return withBossSessionPage(async (page) => {
    await openConversationByTarget(page, target);
    if (json) return renderOpenedCandidateChat(page, target.name, true);
    return `已打开并核对候选人会话：${target.name} / ${target.dataId}`;
  });
}

export async function implAcceptTargetResume(target: ConversationTarget, json = false, check = false): Promise<string> {
  return runAcceptTargetResume(target, json, check);
}

export async function implDownloadTargetResume(target: ConversationTarget, outputDir?: string, check = false): Promise<string> {
  return runDownloadTargetResume(target, outputDir, check);
}

export async function implOpenChatByIndex(params: {
  index: number;
  unreadOnly?: boolean;
  expectedName?: string;
  exact?: boolean;
  json?: boolean;
}): Promise<string> {
  return withBossSessionPage(async (page) =>
    runOpenCandidateChatByIndex(page, {
      index: params.index,
      filter: params.unreadOnly ? 'unread' : 'all',
      expectedName: params.expectedName,
      exact: params.exact,
      json: params.json,
    }),
  );
}

export async function implChatAction(params: {
  action: ChatPageAction;
  remark?: string;
  json?: boolean;
}): Promise<string> {
  return withBossSessionPage(async (page) => runChatActionOnCurrentConversation(page, params));
}

export async function implSendMessage(params: {
  text: string;
  requestResume?: boolean;
  target?: ConversationTarget;
  json?: boolean;
  check?: boolean;
}): Promise<string> {
  return runSendChatMessage({
    text: params.text || undefined,
    requestResume: params.requestResume,
    target: params.target,
    json: params.json,
    check: params.check,
  });
}

export async function implListPositions(json = false): Promise<string> {
  return runListOpenPositions({ json });
}

export async function implListPositionsWithOptions(opts: {
  detail?: boolean;
  name?: string;
  json?: boolean;
}): Promise<string> {
  return runListOpenPositions({
    detail: opts.detail,
    detailName: opts.name,
    json: opts.json,
  });
}

export async function implBossSearch(
  opts: {
    jobKeyword?: string;
    coreRequirements?: string[];
    bonusRequirements?: string[];
    match?: boolean;
    json?: boolean;
  } = {},
): Promise<string> {
  return runBossSearch(opts);
}

export async function implNormalSearch(keyword?: string, json = false): Promise<string> {
  return runNormalSearch(keyword, json);
}

export async function implBossSearchSet(opts: {
  jobKeyword?: string;
  coreRequirements?: string[];
  bonusRequirements?: string[];
}): Promise<string> {
  return runBossSearchSet(opts);
}

export async function implRecommend(jobKeyword?: string, json = false, checkJob = false): Promise<string> {
  return runRecommend(jobKeyword, json, checkJob);
}

export async function implPreview(opts: {
  candidateTarget: string;
  openOnly?: boolean;
  candidateId?: string;
  json?: boolean;
}): Promise<string> {
  return runPreview(opts);
}

export async function implRecommendGreet(opts: {
  candidateTarget: string;
  jobKeyword?: string;
  check?: boolean;
  selectJob?: string;
  confirmContact?: boolean;
  continueChat?: boolean;
  candidateId?: string;
  json?: boolean;
}): Promise<string> {
  return runRecommendGreet(opts);
}

export { implSetBaiduCredentials } from './baidu_credentials.js';
