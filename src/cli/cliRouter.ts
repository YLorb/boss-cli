import { parseOpts, CliError } from './arguments.js';
import { runCheck, runStatus, type CheckCriteria } from '../toolset/check.js';
import { runSearchSidebar } from '../toolset/search-sidebar.js';
import { runResumeOcr } from '../common/resume_ocr.js';
import { parseSwitchJobArgs, runSwitchJob } from '../toolset/switch-job.js';
/**
 * CLI：子命令直接调用 toolset 中的 impl*。
 * 无参数时进入交互模式，逐行解析与 `boss <argv...>` 相同的命令。
 */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { detachBrowserSession } from '../browser/index.js';
import {
  implChatAction,
  implChatSearch,
  implClearChatSearch,
  implLogin,
  implListCandidates,
  implListUnreadCandidates,
  implOpenChatByIndex,
  implListPositions,
  implListPositionsWithOptions,
  implNormalSearch,
  implSearchControl,
  implOpenChat,
  implOpenTargetChat,
  implAcceptTargetResume,
  implDownloadTargetResume,
  implRecommend,
  implPreview,
  implRecommendGreet,
  implSetBaiduCredentials,
  implBossSearch,
  implSendMessage,
} from '../toolset/index.js';
import { printBossInteractiveBanner } from './banner.js';
import { jsonError, splitJsonFlag } from './output.js';
import { isAttachmentCommand, runCommandProcess } from './command_process.js';
import { runProbeTargetResume } from '../toolset/attachment.js';
import { runCollectionSession, syncCollectionReceipt } from '../collection/session.js';
import { runBack } from '../toolset/back.js';
import { parseSearchMoreArgs, runSearchMore } from '../toolset/search-more.js';
import { inspectEmbeddedChat, checkEmbeddedChat, sendEmbeddedChat, closeEmbeddedChat } from '../toolset/embedded-chat.js';
import { dismissContactNotice } from '../toolset/contact-notice.js';
import { favoriteResume } from '../toolset/favorite.js';
import { openRecommendChat } from '../toolset/recommend-chat.js';
import { checkSkillCompatibility, requireSkillCompatibility, splitVersionConfirmation } from './skill_compatibility.js';
import { assertPermittedCommand, isPermitDenied, resolveAction } from './permit.js';
import { COMMAND_SPECS, describeCommand, findCommandSpec, renderCommandHelp } from './command_spec.js';
import { assertTaskInvocation, parseStartupArguments } from './formal_arguments.js';
import { checkTaskConfig, taskConfigPath } from './task_config.js';
import { initRun, activateRunBindings, getBoundRun } from './run_state.js';
import { installOfflineTestGuard } from '../common/offline_test.js';
import { assertPermittedPhase, isPhaseDenied, setPhase, phaseStatus, beforePhaseCommand, recordPhaseCommand, failPhaseCommand } from './phase_state.js';
import { runCheckLogin } from '../toolset/check_login.js';
import { APP_HOME, JOBS_DIR } from '../config.js';
import { join } from 'node:path';
import { acquireFlowOpen, clearFlowPause, consecutiveActionFailures, flowStatePath, flowStatus, flowWatch, pauseFlow, readFlowOpen, recordFlowDecision, recordJournalIntent, recordJournalResult, releaseFlowOpen, verifyFlowCandidate, verifyFlowDecided, verifyFlowNotPaused, verifyFlowNotReplayed, type JournalAction } from '../common/flow_state.js';
import {
  printPackageUpdateNoticeIfDue,
  printVersionInfo,
  runPackageUpdate,
} from './version.js';



/**
 * 一次性命令结束后：detach CDP，不关浏览器窗口。
 * 交互模式在循环内不调用；退出 REPL 时在 `runInteractiveLoop` 的 finally 里单独 detach（避免 Node 退出时拖死 Chrome）。
 */
async function cleanupAfterCommand(_cmd: string, nonInteractive: boolean): Promise<void> {
  if (!nonInteractive) {
    return;
  }
  await detachBrowserSession().catch(() => {});
}

function die(msg: string): never {
  throw new CliError(msg);
}

/** `readline.question` 在 Ctrl+C 时会抛出 AbortError，视为正常结束而非业务错误 */
export function isReadlineAbortError(e: unknown): boolean {
  if (e === null || typeof e !== 'object') {
    return false;
  }
  const err = e as { name?: string; code?: string };
  return err.name === 'AbortError' || err.code === 'ABORT_ERR';
}

/** 类 shell 分词：支持双引号、单引号包裹含空格的参数 */
function splitShellLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        cur += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur.length > 0) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += c;
  }
  if (cur.length > 0) {
    out.push(cur);
  }
  return out;
}

/** 短命令为主；保留旧长名作为别名，避免已有脚本失效 */
function normalizeSubcommand(cmd: string): string {
  switch (cmd) {
    case '/back':
      return 'back';
    case 'list-candidates':
      return 'list';
    case 'open-chat':
      return 'chat';
    case 'send-message':
      return 'send';
    case 'list-positions':
      return 'positions';
    case 'deepsearch':
      return 'deep-search';
    default:
      return cmd;
  }
}

function printHelp(): void {
  console.error(renderCommandHelp());
}

/** 解析 `--key value` / `--key=value` / 布尔 `--flag` */

function splitRequirementArg(value: string): string[] {
  return value
    .split(/\r?\n|[;；]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseDeepSearchArgs(argv: string[]): {
  jobKeyword?: string;
  coreRequirements?: string[];
  bonusRequirements?: string[];
  match: boolean;
} {
  const positional: string[] = [];
  const coreRequirements: string[] = [];
  const bonusRequirements: string[] = [];
  let jobKeyword = '';
  let match = false;
  let coreSpecified = false;
  let bonusSpecified = false;

  function readValue(i: number, key: string): { value: string; nextIndex: number } {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('-')) {
      die(`❌ deep-search 参数 ${key} 需要提供值`);
    }
    return { value: next, nextIndex: i + 1 };
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--match') {
      match = true;
      continue;
    }
    if (arg === '--clear-core') {
      coreSpecified = true;
      coreRequirements.length = 0;
      continue;
    }
    if (arg === '--clear-bonus') {
      bonusSpecified = true;
      bonusRequirements.length = 0;
      continue;
    }
    if (arg === '--job' || arg === '-j') {
      const read = readValue(i, arg);
      jobKeyword = read.value.trim();
      i = read.nextIndex;
      continue;
    }
    if (arg.startsWith('--job=')) {
      jobKeyword = arg.slice('--job='.length).trim();
      continue;
    }
    if (arg === '--core' || arg === '-c') {
      const read = readValue(i, arg);
      coreSpecified = true;
      coreRequirements.push(...splitRequirementArg(read.value));
      i = read.nextIndex;
      continue;
    }
    if (arg.startsWith('--core=')) {
      coreSpecified = true;
      coreRequirements.push(...splitRequirementArg(arg.slice('--core='.length)));
      continue;
    }
    if (arg === '--bonus' || arg === '-b') {
      const read = readValue(i, arg);
      bonusSpecified = true;
      bonusRequirements.push(...splitRequirementArg(read.value));
      i = read.nextIndex;
      continue;
    }
    if (arg.startsWith('--bonus=')) {
      bonusSpecified = true;
      bonusRequirements.push(...splitRequirementArg(arg.slice('--bonus='.length)));
      continue;
    }
    if (arg.startsWith('-')) {
      die(`❌ deep-search 不支持参数: ${arg}`);
    }
    positional.push(arg);
  }

  if (!jobKeyword && positional.length > 0) {
    jobKeyword = positional.join(' ').trim();
  } else if (jobKeyword && positional.length > 0) {
    die('❌ deep-search 已提供 --job 时，不再支持额外的位置参数');
  }

  return {
    jobKeyword: jobKeyword || undefined,
    coreRequirements: coreSpecified ? coreRequirements : undefined,
    bonusRequirements: bonusSpecified ? bonusRequirements : undefined,
    match,
  };
}

function printStdout(text: string): void {
  const t = text.trimEnd();
  if (t.length > 0) {
    console.log(t);
  }
}

function startProcessingSpinner(): () => void {
  if (!output.isTTY) {
    return () => {};
  }

  const frames = ['|', '/', '-', '\\'];
  let idx = 0;
  output.write(`${frames[idx]}\r`);
  const timer = setInterval(() => {
    idx = (idx + 1) % frames.length;
    output.write(`${frames[idx]}\r`);
  }, 90);
  timer.unref();

  return () => {
    clearInterval(timer);
    output.write(' \r');
  };
}

/** 动作结果分类：副作用结果未确认的错误记为 unknown，其余 failed。 */
function classifyJournalResult(error: unknown): 'failed' | 'unknown' {
  const name = error instanceof Error ? error.name : '';
  return name === 'EmbeddedSendUnconfirmedError' || name === 'AttachmentTimeoutError' ? 'unknown' : 'failed';
}

/** 触达受阻（付费/风控等）视为必须暂停的硬失败。 */
function isHardFailure(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /付费|VIP|购买|权益|限流|风控|验证码|访问频繁/.test(msg);
}

/** 动作前后机械落盘意图/结果到流程日志；flow 为空（未开锁）时直接执行，不改日志。 */
async function withFlowJournal<T>(
  flow: string | null,
  target: { candidateId: string; name: string; action: JournalAction },
  fn: () => Promise<T>,
  extractEvidence?: (value: T) => Record<string, string> | undefined,
): Promise<T> {
  if (!flow) return fn();
  await recordJournalIntent(flow, target.candidateId, target.name, target.action);
  try {
    const value = await fn();
    await recordJournalResult(flow, target.candidateId, target.name, target.action, 'success', undefined, extractEvidence ? extractEvidence(value) : undefined);
    return value;
  } catch (error) {
    await recordJournalResult(flow, target.candidateId, target.name, target.action, classifyJournalResult(error), error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * 执行一条子命令并返回结果（与传入 `process.argv` 切片语义一致，不含 `boss` 本身）。
 */
export async function executeCommand(argv: string[]): Promise<string> {
  installOfflineTestGuard();
  if (process.env.BOSS_RUN_ID) await activateRunBindings();
  return executeBoundCommand(argv, validateTaskCommand(argv));
}

function validateTaskCommand(argv: string[]): string {
  if (!argv.length) die('命令不能为空');
  const cmd = normalizeSubcommand(argv[0]);
  assertTaskInvocation(argv, cmd, Boolean(getBoundRun()), Boolean(taskConfigPath()));
  return cmd;
}

async function executeBoundCommand(argv: string[], cmd: string): Promise<string> {
  await assertPermittedCommand(cmd, argv);
  await assertPermittedPhase(cmd, argv);
  await beforePhaseCommand(cmd, argv);
  try {
    const result = await executeCommandBody(argv);
    await recordPhaseCommand(cmd, argv, result);
    return result;
  } catch (error) {
    await failPhaseCommand(cmd, argv, error);
    throw error;
  }
}

async function executeCommandBody(argv: string[]): Promise<string> {
  if (argv.length === 0) {
    die('❌ 空命令');
  }

  const cmd = normalizeSubcommand(argv[0]);
  const { args: tail, json } = splitJsonFlag(argv.slice(1));
  const delimiter = tail.indexOf('--');
  const optionTokens = delimiter === -1 ? tail : tail.slice(0, delimiter);
  if (optionTokens.some((token) => token.startsWith('--json='))) die('❌ --json 是布尔开关，不接受值。');
  if (json && !['collect-sync', 'favorite', 'switch-job', 'ocr', 'check', 'decide', 'flow-pause', 'flow-resume', 'flow-status', 'phase-set', 'phase-status', 'spec-list', 'status', 'search-sidebar', '--check-login', 'login', 'list', 'chat', 'chat-search', 'action', 'probe-resume', 'accept-resume', 'download-resume', 'send', 'positions', 'jd', 'deep-search', 'deepsearch', 'search', 'search-more', 'preview', 'recommend', 'greet', 'back', 'dismiss-contact-notice'].includes(cmd)) {
    die(`❌ ${cmd} 不支持 --json。`);
  }
  if (cmd === 'ocr') {
    const paths: string[] = [];
    let timeoutMs: number | undefined;
    let layout: 'auto' | 'boss-online-resume' | undefined;
    for (let i = 0; i < tail.length; i++) {
      if (tail[i] === '--timeout-ms') {
        if (timeoutMs !== undefined || !/^\d+$/.test(tail[i+1] ?? '')) die('ocr --timeout-ms 需要唯一整数值');
        timeoutMs = Number(tail[++i]);
      } else if (tail[i] === '--layout') {
        if (layout !== undefined || !['auto','boss-online-resume'].includes(tail[i+1])) die('ocr --layout 需要唯一的 auto 或 boss-online-resume');
        layout=tail[++i] as 'auto' | 'boss-online-resume';
      } else if (tail[i].startsWith('-')) die('ocr 不支持参数：' + tail[i]);
      else paths.push(tail[i]);
    }
    if (paths.length !== 1) die('用法: boss ocr <PNG绝对路径> [--layout <auto|boss-online-resume>] [--timeout-ms <1000-120000>] [--json]');
    try {
      const result = await runResumeOcr(paths[0], timeoutMs, layout);
      return json ? JSON.stringify(result) : `OCR 完成：${result.textPath}\n原图：${result.imagePath}\n结果：${result.resultPath}`;
    } catch (error) {
      const ocrFlow = flowStatePath();
      if (ocrFlow) await pauseFlow(ocrFlow, 'OCR服务错误').catch(() => {});
      throw error;
    }
  }
  if(cmd==='status') {
    if(tail.length) die('status 不接受参数');
    return runStatus();
  }
  if(cmd==='search-sidebar') {
    if(tail.length) die('search-sidebar 不接受参数');
    return runSearchSidebar();
  }
  if(cmd==='check') {
    const {rest,opts,flags}=parseOpts(tail,new Set(['embedded']));
    const keys:Record<string,keyof CheckCriteria>={page:'page',overlay:'overlay',state:'state',name:'name','data-id':'dataId','candidate-id':'candidateId',job:'job',keyword:'keyword',text:'text'};
    if(rest.length||[...flags].some(f=>f!=='embedded')||Object.keys(opts).some(k=>!keys[k]))die('check 参数不支持');
    const criteria:CheckCriteria={};
    for(const [k,v] of Object.entries(opts)){if(!v.trim()&&k!=='keyword')die('check 比较标准不能为空');(criteria as any)[keys[k]!]=v.trim();}
    if(flags.has('embedded'))criteria.embedded=true;
    return runCheck(criteria);
  }
  if(cmd==='decide') {
    const {rest,opts,flags}=parseOpts(tail);
    if(rest.length||flags.size||!opts['candidate-id']?.trim()||!opts.verdict?.trim()||Object.keys(opts).some(k=>!['candidate-id','verdict'].includes(k)))
      die('❌ 用法: decide --candidate-id <ID> --verdict <fit|not-fit|unknown> [--json]');
    if(!['fit','not-fit','unknown'].includes(opts.verdict))die('❌ decide --verdict 必须是 fit/not-fit/unknown');
    const decideFlow=flowStatePath();
    if(!decideFlow)die('❌ decide 需要在锁模式（BOSS_FLOW_STATE）下使用');
    await verifyFlowNotPaused(decideFlow);
    const decideCandidateId=opts['candidate-id'].trim();
    const decideVerdict=opts.verdict as 'fit'|'not-fit'|'unknown';
    const decideOpenName=(await readFlowOpen(decideFlow))?.name ?? '';
    await recordJournalIntent(decideFlow,decideCandidateId,decideOpenName,'decide');
    try {
      await recordFlowDecision(decideFlow,decideCandidateId,decideVerdict);
      await recordJournalResult(decideFlow,decideCandidateId,decideOpenName,'decide','success',undefined,{verdict:decideVerdict});
    } catch (error) {
      await recordJournalResult(decideFlow,decideCandidateId,decideOpenName,'decide','failed',error instanceof Error?error.message:String(error));
      throw error;
    }
    return json?JSON.stringify({ok:true,candidateId:decideCandidateId,verdict:decideVerdict}):`已记录评估结论：${decideCandidateId} ${decideVerdict}`;
  }
  if(cmd==='flow-status') {
    if(tail.length) die('flow-status 不接受参数');
    const fsFlow=flowStatePath();
    if(!fsFlow)die('❌ flow-status 需要在锁模式（BOSS_FLOW_STATE）下使用');
    const report=await flowStatus(fsFlow);
    const watch=await flowWatch(fsFlow);
    const summary={...report,paused:watch.paused,lastProgressAt:watch.lastProgressAt,idleMs:watch.idleMs,watchState:watch.state};
    return json?JSON.stringify(summary):`已打开：${report.open?`${report.open.name}（${report.open.state}${report.open.next?`→${report.open.next}`:''}）`:'无'}\n需核验：${report.candidates.filter(c=>c.state==='needs-verify').map(c=>c.name).join('、')||'无'}\n已完成：${report.candidates.filter(c=>c.state==='done').length} 人\n停滞：${watch.state}${watch.paused?`（${watch.paused.reason}）`:''}`;
  }
  if(cmd==='flow-pause') {
    const {rest,opts,flags}=parseOpts(tail);
    if(rest.length||flags.size||!opts.reason?.trim()||Object.keys(opts).some(k=>k!=='reason'))die('❌ 用法: flow-pause --reason <原因> [--json]');
    const fpFlow=flowStatePath();
    if(!fpFlow)die('❌ flow-pause 需要在锁模式（BOSS_FLOW_STATE）下使用');
    await pauseFlow(fpFlow,opts.reason.trim());
    return json?JSON.stringify({ok:true,paused:true,reason:opts.reason.trim()}):`已暂停：${opts.reason.trim()}`;
  }
  if(cmd==='flow-resume') {
    if(tail.length)die('flow-resume 不接受参数');
    const frFlow=flowStatePath();
    if(!frFlow)die('❌ flow-resume 需要在锁模式（BOSS_FLOW_STATE）下使用');
    await clearFlowPause(frFlow);
    return json?JSON.stringify({ok:true,paused:false}):'已恢复';
  }
  if(cmd==='phase-set') {
    const {rest,opts,flags}=parseOpts(tail);
    if(rest.length||flags.size||!opts.phase?.trim()||Object.keys(opts).some(k=>k!=='phase'))die('❌ 用法: phase-set --phase <阶段名> [--json]');
    const ps=await setPhase(opts.phase.trim());
    return json?JSON.stringify({ok:true,phase:ps.phase,at:ps.at}):`已进入阶段：${ps.phase}`;
  }
  if(cmd==='phase-status') {
    if(tail.length)die('phase-status 不接受参数');
    const report=await phaseStatus();
    return JSON.stringify({ok:true,...report as object});
  }
  if(cmd==='collect-sync') {
    const {rest,opts,flags}=parseOpts(tail);
    if(rest.length||flags.size||!opts['data-id']||Object.keys(opts).some(k=>k!=='data-id'))die('collect-sync --data-id <已下载会话ID> --json');
    return syncCollectionReceipt(opts['data-id']);
  }
  if(cmd==='spec-list') {
    if(tail.length) die('spec-list 不接受参数');
    const specs = [];
    if (existsSync(JOBS_DIR)) {
      const names = await readdir(JOBS_DIR);
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const file = join(JOBS_DIR, name);
        let job = '';
        try {
          const raw = await readFile(file, 'utf8');
          const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
          job = typeof parsed.job === 'string' ? parsed.job : '';
        } catch { job = ''; }
        specs.push({ file, job });
      }
      specs.sort((a, b) => a.job.localeCompare(b.job, 'zh'));
    }
    return json ? JSON.stringify({ dir: JOBS_DIR, jobs: specs }) : (specs.map(s => `${s.job || '(缺 job 字段)'}\t${s.file}`).join('\n') || '(空)');
  }
  if (cmd === 'switch-job') return runSwitchJob(parseSwitchJobArgs(tail), json);

  if (cmd === '--check-login') {
    if (tail.length) die('❌ 用法: boss --check-login [--json]');
    return runCheckLogin(json);
  }

  if (cmd === '_baidu-keys') {
    const { rest, opts } = parseOpts(tail);
    let apiKey = (opts['api-key'] ?? opts.apikey ?? '').trim();
    let secretKey = (opts['secret-key'] ?? opts.secretkey ?? '').trim();
    if (!apiKey && rest.length >= 2) {
      apiKey = rest[0]!.trim();
      secretKey = rest.slice(1).join(' ').trim();
    }
    if (!apiKey || !secretKey) {
      die(
        '❌ 用法: _baidu-keys --api-key <KEY> --secret-key <SECRET>\n    或: _baidu-keys <KEY> <SECRET>（本命令不在 help 中列出）',
      );
    }
    return implSetBaiduCredentials(apiKey, secretKey);
  }

  if (cmd === 'login') {
    if (tail.length) die('❌ 用法: login [--json]');
    return implLogin(json);
  }

  if (cmd === 'update') {
    const { rest, opts, flags } = parseOpts(tail);
    if (rest.length > 0 || Object.keys(opts).length > 0 || flags.size > 0) {
      die('❌ 用法: update');
    }
    return runPackageUpdate();
  }

  if (cmd === 'list') {
    const { rest, flags, opts } = parseOpts(tail);
    if (rest.length || Object.keys(opts).length || Array.from(flags).some((f) => !['unread', 'chatting', 'json'].includes(f))) {
      die('❌ 用法: list [--unread] [--chatting] [--json]');
    }
    if (flags.has('unread') && !flags.has('chatting') && !json) {
      return implListUnreadCandidates();
    }
    return implListCandidates({ unreadOnly: flags.has('unread'), chattingOnly: flags.has('chatting'), json });
  }

  if (cmd === 'chat-search') {
    const { rest, opts, flags } = parseOpts(tail, new Set(['clear']));
    if (flags.has('clear')) {
      const keyword = opts['expect-keyword'];
      if (!keyword?.trim() || rest.length || flags.size !== 1 || Object.keys(opts).length !== 1) die('用法: chat-search --clear --expect-keyword <当前完整昵称> [--json]');
      return implClearChatSearch(keyword, json);
    }
    if (rest.length !== 1 || !rest[0]!.trim() || flags.size || Object.keys(opts).some(k => !['data-id', 'job', 'info'].includes(k)) || Object.values(opts).some(v => !v.trim())) die('用法: chat-search <完整昵称> [--info <已知原文>] [--data-id <预期ID>] [--job <预期岗位>] [--json]');
    return implChatSearch({ name: rest[0]!, dataId: opts['data-id'], job: opts.job, ...(opts.info !== undefined ? { info: opts.info } : {}) }, json);
  }

  if (cmd === 'favorite') {
    const {rest,flags,opts}=parseOpts(tail,new Set(['check']));
    if(rest.length||[...flags].some(f=>f!=='check')||!opts['candidate-id']?.trim()||Object.keys(opts).some(k=>k!=='candidate-id'))
      die('favorite --candidate-id <当前简历ID> [--check] [--json]');
    return favoriteResume(opts['candidate-id'],flags.has('check'));
  }
  if (cmd === 'dismiss-contact-notice') {
    const {rest,flags,opts}=parseOpts(tail);
    if(!rest.join(' ').trim()||flags.size||!opts['candidate-id']?.trim()||!opts.job?.trim()||Object.keys(opts).some(k=>!['candidate-id','job'].includes(k)))
      die('dismiss-contact-notice <姓名> --candidate-id <已联系ID> --job <完整岗位> [--json]');
    return dismissContactNotice({name:rest.join(' ').trim(),candidateId:opts['candidate-id'].trim(),job:opts.job.trim()});
  }
  if (cmd === 'chat') {
    const { rest, flags, opts } = parseOpts(tail, new Set(['check', 'embedded', 'inspect-embedded', 'close', 'recommend', 'open']));
    if(flags.has('recommend')||flags.has('open')) {
      if(flags.size!==2||!flags.has('recommend')||!flags.has('open')||!rest.join(' ').trim()||
        !opts['candidate-id']?.trim()||!opts.job?.trim()||!opts['recommend-job']?.trim()||Object.keys(opts).some(k=>!['candidate-id','job','recommend-job'].includes(k)))
        die('chat <卡片姓名> --recommend --open --candidate-id <已联系ID> --recommend-job <推荐岗位与城市> --job <聊天岗位原文>');
      return openRecommendChat({name:rest.join(' ').trim(),candidateId:opts['candidate-id'].trim(),job:opts.job.trim(),recommendJob:opts['recommend-job'].trim()});
    }
    if (flags.has('inspect-embedded')) {
      if(rest.length || Object.keys(opts).length || flags.size!==1) die('chat --inspect-embedded 不能与其他选项混用');
      return inspectEmbeddedChat();
    }
    if (flags.has('embedded')) {
      if(flags.has('check')===flags.has('close') || !rest.join(' ').trim() || !opts['candidate-id']?.trim() || !opts.job?.trim() ||
        [...flags].some(f=>!['embedded','check','close'].includes(f)) || Object.keys(opts).some(k=>!['candidate-id','job'].includes(k)))
        die('chat <实际姓名> --embedded (--check 或 --close) --candidate-id <ID> --job <完整岗位>');
      const target={name:rest.join(' ').trim(),candidateId:opts['candidate-id'].trim(),job:opts.job.trim()};
      return flags.has('close') ? closeEmbeddedChat(target) : checkEmbeddedChat(target);
    }
    if(flags.has('close')) die('chat --close 必须配合 --embedded、姓名、candidate-id和job');
    const nameArg = rest.join(' ').trim();
    if ((opts.action ?? '').trim().length > 0 || (opts.remark ?? '').trim().length > 0) {
      die('❌ chat 不再支持 --action/--remark。请改用: action <操作> [--remark <备注>]');
    }
    const allowedOpts = new Set(['index', 'i', 'action', 'remark', 'data-id', 'info']);
    const unsupportedOpts = Object.keys(opts).filter((key) => !allowedOpts.has(key));
    if (unsupportedOpts.length > 0) {
      die(`❌ chat 不支持参数: --${unsupportedOpts.join(', --')}`);
    }
    // Full nickname is required on every chat search path; --strict remains compatible.
    const exact = true;
    const indexRaw = (opts.index ?? opts.i ?? '').trim();
    const dataId = (opts['data-id'] ?? '').trim();
    if (flags.has('info') || (opts.info !== undefined && (!opts.info.trim() || !!indexRaw || flags.has('check')))) {
      die('chat --info 需要非空原文，不与 --check/--index 混用');
    }
    if (flags.has('data-id') || (opts['data-id'] !== undefined && !dataId)) {
      die('❌ chat --data-id 必须提供会话 ID。');
    }
    if (flags.has('check')) {
      if (!nameArg || indexRaw || [...flags].some(f=>!['check','strict'].includes(f))) die('chat --check 需要姓名，不接受index定位选项');
      if(dataId) return runCheck({page:'chat',state:'conversation',name:nameArg,dataId,embedded:false});
      return implOpenChat(nameArg, true, json, true);
    }
    if (dataId) {
      if (indexRaw || flags.has('unread') || !nameArg || Array.from(flags).some((f) => f !== 'strict')) {
        die('❌ 用法: chat <姓名> --data-id <会话ID>');
      }
      return implOpenTargetChat({ name: nameArg, dataId, ...(opts.info !== undefined ? { info: opts.info } : {}) }, json);
    }
    if (indexRaw) {
      const index = Number(indexRaw);
      if (!Number.isInteger(index) || index < 1) {
        die(`❌ chat --index 必须是从 1 开始的整数，当前值: ${indexRaw}`);
      }
      return implOpenChatByIndex({
        index,
        unreadOnly: flags.has('unread'),
        expectedName: nameArg || undefined,
        exact,
        json,
      });
    }
    if (flags.has('unread')) {
      die('❌ chat 只有配合 --index 时才支持 --unread。用法: chat --index <序号> --unread');
    }
    if (!nameArg) {
      die('❌ 用法: chat <姓名> [--strict]；或 chat [姓名] --index <序号> [--unread]');
    }
    return implOpenChat(nameArg, exact, json, false, opts.info);
  }

  if (cmd === 'action') {
    const action = resolveAction(argv);
    if (!action) {
      die(
        '❌ 用法: action <resume|not-fit|remark|agree-resume|request-attachment-resume|history|wechat> [--remark <备注>]',
      );
    }
    const { opts } = parseOpts(tail);
    const remark = (opts.remark ?? '').trim();
    if (action === 'remark' && !remark) {
      die('❌ 当操作为 remark 时，必须提供 --remark <备注内容>。');
    }
    return implChatAction({ action, remark, json });
  }

  if (cmd === 'probe-resume') {
    const { rest, opts, flags } = parseOpts(tail, new Set(['download']));
    const name = rest.join(' ').trim();
    const dataId = (opts['data-id'] ?? '').trim();
    if (!name || !dataId || Array.from(flags).some(flag => flag !== 'download') ||
        Object.keys(opts).some(key => !['data-id', 'output-dir'].includes(key)) ||
        ('output-dir' in opts && !flags.has('download'))) {
      die('❌ 用法: probe-resume <姓名> --data-id <会话ID> [--download] [--output-dir <目录>] [--json]');
    }
    return runProbeTargetResume({ name, dataId }, flags.has('download'), opts['output-dir']);
  }

  if (cmd === 'accept-resume' || cmd === 'download-resume') {
    const { rest, opts, flags } = parseOpts(tail, new Set(['check']));
    const check = flags.has('check');
    const name = rest.join(' ').trim();
    const dataId = (opts['data-id'] ?? '').trim();
    const allowed = cmd === 'download-resume' ? ['data-id', 'output-dir'] : ['data-id'];
    if (!name || !dataId || Array.from(flags).some(flag => flag !== 'check') || Object.keys(opts).some((key) => !allowed.includes(key))) {
      die(`❌ 用法: ${cmd} <姓名> --data-id <会话ID>${cmd === 'download-resume' ? ' [--output-dir <目录>]' : ''} [--check]`);
    }
    const target = { name, dataId };
    return cmd === 'accept-resume'
      ? implAcceptTargetResume(target, json, check)
      : implDownloadTargetResume(target, opts['output-dir']?.trim() || undefined, check);
  }

  if (cmd === 'send') {
    const { flags, opts, rest } = parseOpts(tail, new Set(['check','embedded']));
    if(flags.has('embedded')) {
      if(rest.length || !opts.name || !opts['candidate-id'] || !opts.job || !(opts.text||opts.t) ||
        [...flags].some(f=>!['embedded','check'].includes(f)) || Object.keys(opts).some(k=>!['name','candidate-id','job','text','t'].includes(k)))
        die('send --embedded --name <实际姓名> --candidate-id <ID> --job <完整岗位> --text <正文> [--check]');
      const sendFlow = flags.has('check') ? null : flowStatePath();
      if (sendFlow) {
        await verifyFlowNotPaused(sendFlow);
        await verifyFlowNotReplayed(sendFlow, opts['candidate-id'].trim(), opts.name.trim(), 'send');
      }
      return withFlowJournal(sendFlow, { candidateId: opts['candidate-id'].trim(), name: opts.name.trim(), action: 'send' }, () => sendEmbeddedChat({name:opts.name.trim(),candidateId:opts['candidate-id'].trim(),job:opts.job.trim()},opts.text||opts.t,flags.has('check')));
    }
    const check = flags.has('check');
    const text = opts.text?.trim() || opts.t?.trim() || '';
    if (!text) {
      die('❌ 用法: send [--text <消息>] [-t <消息>] [--request-resume]');
    }
    const requestResume = flags.has('request-resume');
    const name = (opts.name ?? '').trim();
    const dataId = (opts['data-id'] ?? '').trim();
    if (Boolean(name) !== Boolean(dataId)) {
      die('❌ 指定收件人时必须同时提供 --name 和 --data-id。');
    }
    if (check && !name) die('❌ send --check 必须同时提供 --name 和 --data-id。');
    if (Object.keys(opts).some((key) => !['text', 't', 'name', 'data-id'].includes(key)) ||
        Array.from(flags).some((flag) => flag !== 'request-resume' && flag !== 'check')) {
      die('❌ 用法: send --text <内容> [--name <姓名> --data-id <会话ID>] [--request-resume] [--check]');
    }
    const normalSendFlow = check ? null : flowStatePath();
    if (normalSendFlow) {
      await verifyFlowNotPaused(normalSendFlow);
      await verifyFlowNotReplayed(normalSendFlow, dataId || name || '', name, 'send');
    }
    return withFlowJournal(normalSendFlow, { candidateId: dataId || name || '', name, action: 'send' }, () => implSendMessage({ text, requestResume, target: name ? { name, dataId } : undefined, json, check }));
  }

  if (cmd === 'positions') {
    const { rest, opts, flags } = parseOpts(tail);
    if (rest.length > 0 || Object.keys(opts).length > 0 || flags.size > 0) {
      die('❌ 用法: positions');
    }
    return implListPositions(json);
  }

  if (cmd === 'jd') {
    const { flags, opts, rest } = parseOpts(tail);
    if (flags.has('detail')) {
      die('❌ jd 不再支持 --detail。请使用: jd <name>');
    }
    if (flags.size > 0) {
      const unsupportedFlags = Array.from(flags).join(', --');
      die(`❌ jd 不支持参数: --${unsupportedFlags}`);
    }
    const detailName = rest.join(' ').trim();
    if (!detailName) {
      die('❌ 用法: jd <name>');
    }
    const unknownOpts = Object.keys(opts);
    if (unknownOpts.length > 0) {
      die(`❌ jd 不支持参数: --${unknownOpts.join(', --')}`);
    }
    return implListPositionsWithOptions({ detail: true, name: detailName, json });
  }

  if (cmd === 'deep-search') {
    return implBossSearch({ ...parseDeepSearchArgs(tail), json });
  }

  if (cmd === 'search-more') return runSearchMore(parseSearchMoreArgs(tail), json);

  if (cmd === 'search') {
    const { rest, opts, flags } = parseOpts(tail,new Set(['submit']));
    if ([...flags].some(f=>f!=='submit') || Object.keys(opts).some(key=>!['city','job','keyword'].includes(key))) {
      die('❌ 搜索参数无效。用法见 boss commands search --json');
    }
    const keyword = rest.join(' ').trim();
    if(flags.has('submit')) {
      if(rest.length||Object.keys(opts).length)die('search --submit 不与设置选项混用');
      return implSearchControl({action:'submit'},json);
    }
    const keys=Object.keys(opts);
    if(!rest.length&&keys.length===1) {
      const action=keys[0] as 'city'|'job'|'keyword';
      const value=opts[action]?.trim();
      if(value===undefined || (action==='job'&&!value) || (action==='keyword'&&value.length>20))die('岗位名称不能为空，关键词最多20字符');
      return implSearchControl({action,value},json);
    }
    if (Object.keys(opts).length) {
      if(opts.keyword!==undefined)die('--keyword 须独立使用');
      if (!opts.job?.trim()) die('筛选搜索须提供岗位名称');
      return implNormalSearch(keyword,json,{city:opts.city?.trim(),job:opts.job.trim()});
    }
    return implNormalSearch(keyword || undefined, json);
  }

  if (cmd === 'preview') {
    const { rest, opts, flags } = parseOpts(tail, new Set(['open-only','reopen-on-frame-error']));
    if ([...flags].some(flag => !['open-only','reopen-on-frame-error'].includes(flag))) {
      die('❌ preview 不支持该 flag');
    }
    const unsupportedOpts = Object.keys(opts).filter(k => k !== 'candidate-id');
    if (opts['candidate-id'] !== undefined && !opts['candidate-id'].trim()) die('--candidate-id 不能为空');
    if (unsupportedOpts.length > 0) {
      die(`❌ preview 不支持: --${unsupportedOpts[0]}`);
    }
    const candidateTarget = rest.join(' ').trim();
    if (!candidateTarget) {
      die('❌ 用法: preview <姓名>');
    }
    if(flags.has('reopen-on-frame-error')&&!opts['candidate-id']?.trim())die('--reopen-on-frame-error 要求 --candidate-id');
    const previewCandidateId = opts['candidate-id']?.trim();
    const previewFlow = flowStatePath();
    if (previewFlow) {
      if (!previewCandidateId) die('❌ 锁模式（BOSS_FLOW_STATE）下 preview 必须提供 --candidate-id；深度搜索不支持锁，请勿对深度搜索设置 BOSS_FLOW_STATE。');
      await verifyFlowNotPaused(previewFlow);
      await verifyFlowCandidate(previewFlow, previewCandidateId, candidateTarget);
    }
    let previewResult: string;
    try {
      previewResult = await withFlowJournal(previewFlow, { candidateId: previewCandidateId ?? '', name: candidateTarget, action: 'preview' }, () => implPreview({ candidateTarget, json, ...(previewCandidateId ? {candidateId:previewCandidateId} : {}), ...(flags.has('open-only') ? { openOnly: true } : {}), ...(flags.has('reopen-on-frame-error')?{reopenOnFrameError:true}:{}) }), (result) => {
        if (!json) return undefined;
        try {
          const obj = JSON.parse(result);
          return obj && typeof obj.path === 'string' ? { screenshot: obj.path } : undefined;
        } catch { return undefined; }
      });
    } catch (error) {
      if (previewFlow && (await consecutiveActionFailures(previewFlow, 'preview')) >= 3) {
        await pauseFlow(previewFlow, '在线简历连续打开失败');
      }
      throw error;
    }
    if (previewFlow) await acquireFlowOpen(previewFlow, previewCandidateId!, candidateTarget, !flags.has('open-only'));
    return previewResult;
  }

  if (cmd === 'back') {
    const keys = tail.filter(t => t.startsWith('--')).map(t => t.split('=')[0]);
    if (new Set(keys).size !== keys.length) die('back 参数不能重复');
    const { rest, opts, flags } = parseOpts(tail, new Set(['check-in_online_resume','if-open','previous']));
    if (rest.length || Object.keys(opts).some(k => k !== 'expect-url') || [...flags].some(f => !['check-in_online_resume','if-open','previous'].includes(f))) die('用法: back [--if-open | --check-in_online_resume | --previous --expect-url <URL>]');
    if (flags.has('previous')) {
      if (flags.size !== 1 || !opts['expect-url']?.trim()) die('--previous 必须配合 --expect-url，不能与其他返回或检查开关混用');
      return runBack(false, json, opts['expect-url']);
    }
    if (Object.keys(opts).length) die('--expect-url 仅用于 back --previous');
    if(flags.has('check-in_online_resume')) {if(flags.has('if-open'))die('检查不能与返回动作混用');return runCheck({state:'online-resume-open'});}
    const backFlow = flowStatePath();
    if (backFlow) await verifyFlowNotPaused(backFlow);
    const backOpen = backFlow ? await readFlowOpen(backFlow) : null;
    const backResult = await withFlowJournal(backFlow, { candidateId: backOpen?.candidateId ?? '', name: backOpen?.name ?? '', action: 'back' }, () => runBack(flags.has('if-open'), json));
    if (backFlow) await releaseFlowOpen(backFlow);
    return backResult;
  }

  if (cmd === 'recommend') {
    const { rest, opts, flags } = parseOpts(tail, new Set(['check-job','ensure-job']));
    if (rest[0] === 'preview') {
      die('❌ 请改用: boss preview <姓名>（已不再使用 recommend preview）');
    }
    if (Object.keys(opts).length > 0 || [...flags].some(f => !['check-job','ensure-job'].includes(f))) {
      die('❌ 用法: recommend [岗位完整名称] [--check-job | --ensure-job]');
    }
    const jobKeyword = rest.join(' ').trim();
    if (flags.has('check-job') && !jobKeyword) die('❌ --check-job 需要岗位完整名称');
    if(flags.has('check-job')) {if(flags.has('ensure-job'))die('检查不能与选岗混用');return runCheck({page:'recommend',job:jobKeyword});}
    return implRecommend(jobKeyword || undefined, json, flags.has('ensure-job'));
  }

  if (cmd === 'greet') {
    const { rest, opts, flags } = parseOpts(tail, new Set(['check', 'confirm-contact', 'continue-chat']));
    if ([...flags].some(flag => flag !== 'check' && flag !== 'confirm-contact' && flag !== 'continue-chat')) {
      die('❌ 用法: greet <姓名> [--candidate-id <ID>] [--job <岗位关键字>] [--select-job <联系岗位完整名称>] [--confirm-contact | --continue-chat --candidate-id <ID>] [--check]');
    }
    if (opts['candidate-id'] !== undefined && !opts['candidate-id'].trim()) die('--candidate-id 不能为空');
    if (flags.has('continue-chat') && !opts['candidate-id']?.trim()) die('--continue-chat 必须配合成功回执的 --candidate-id');
    if (flags.has('continue-chat') && (opts.job || opts['select-job'] || flags.has('confirm-contact'))) die('--continue-chat 不能与选岗或确认联系混用');
    if (flags.has('confirm-contact') && !opts['select-job']?.trim()) die('--confirm-contact 需要 --select-job 指定已选岗位');
    if (opts['contact-mode'] !== undefined) {
      if (!opts['contact-mode'].trim()) die('--contact-mode 不能为空');
      if (!opts['candidate-id']?.trim()) die('--contact-mode 必须配合成功回执的 --candidate-id');
      if (flags.has('continue-chat') || opts['select-job'] || opts.job) die('--contact-mode 不能与 --continue-chat／--select-job／--job 混用');
    }
    const jobKeyword = opts.job?.trim();
    const extraOpts = Object.keys(opts).filter((k) => k !== 'job' && k !== 'select-job' && k !== 'contact-mode' && k !== 'candidate-id');
    if (extraOpts.length > 0) {
      die('❌ 用法: greet <姓名> [--candidate-id <ID>] [--job <岗位关键字>] [--select-job <联系岗位完整名称>] [--confirm-contact | --continue-chat --candidate-id <ID>] [--check]');
    }
    if (opts['select-job'] !== undefined && (!opts['select-job'].trim() || jobKeyword)) die('--select-job 需要完整岗位名称且不能与 --job 混用');
    const target = rest.join(' ').trim();
    if (!target) {
      die('❌ 用法: greet <姓名> [--candidate-id <ID>] [--job <岗位关键字>] [--select-job <联系岗位完整名称>] [--confirm-contact | --continue-chat --candidate-id <ID>] [--check]');
    }
    const contactForm = !flags.has('check') && !flags.has('continue-chat');
    const actualContact = contactForm && !flags.has('confirm-contact') && !opts['select-job'];
    const greetAction: JournalAction = flags.has('confirm-contact') ? 'confirm-contact' : opts['select-job'] ? 'select-job' : 'greet';
    const greetCandidateId = opts['candidate-id']?.trim();
    const greetFlow = flowStatePath();
    if (contactForm && greetFlow) {
      if (!greetCandidateId) die('❌ 锁模式（BOSS_FLOW_STATE）下联系动作（greet/select-job/confirm-contact）必须提供 --candidate-id。');
      await verifyFlowNotPaused(greetFlow);
      await verifyFlowCandidate(greetFlow, greetCandidateId, target);
      await verifyFlowDecided(greetFlow, greetCandidateId, target);
      await verifyFlowNotReplayed(greetFlow, greetCandidateId, target, greetAction);
    }
    let greetResult: string;
    try {
      greetResult = await withFlowJournal(contactForm ? greetFlow : null, { candidateId: greetCandidateId ?? '', name: target, action: greetAction }, () => implRecommendGreet({ candidateTarget: target, jobKeyword: jobKeyword || undefined, json, ...(flags.has('check') ? { check: true } : {}), ...(greetCandidateId ? {candidateId:greetCandidateId} : {}), ...(flags.has('continue-chat') ? {continueChat:true} : {}), ...(flags.has('confirm-contact') ? {confirmContact:true} : {}), ...(opts['select-job'] ? {selectJob:opts['select-job'].trim()} : {}), ...(opts['contact-mode'] !== undefined ? {contactMode:opts['contact-mode'].trim()} : {}) }));
    } catch (error) {
      if (actualContact && greetFlow && isHardFailure(error)) {
        await pauseFlow(greetFlow, '触达受阻（付费/风控）');
      }
      throw error;
    }
    if ((actualContact || flags.has('confirm-contact')) && greetFlow) await releaseFlowOpen(greetFlow);
    return greetResult;
  }

  die(`❌ 未知命令 “${argv[0]}”。输入 help 查看用法。`);
}

export async function runOneCommand(argv: string[]): Promise<void> {
  if (argv.length === 0) {
    return;
  }
  try {
    const text = await executeManagedCommand(argv);
    printStdout(text);
  } catch (e) {
    if (splitJsonFlag(argv.slice(1)).json) printStdout(jsonError(normalizeSubcommand(argv[0]), e));
    else console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = (isPermitDenied(e) || isPhaseDenied(e)) ? 2 : 1;
  }
}

async function executeManagedCommand(argv: string[]): Promise<string> {
  const startup = parseStartupArguments(argv);
  if (argv[0] === 'commands') {
    const name = startup!.positional[0];
    if (name !== undefined) {
      const spec = findCommandSpec(name);
      if (!spec) die('命令未注册，请用 boss commands --json 查询正式命令名');
      return JSON.stringify({ ok: true, command: describeCommand(spec) });
    }
    return JSON.stringify({ ok: true, commands: COMMAND_SPECS.map(describeCommand) });
  }
  if (argv[0] === 'browser-session') {
    await requireSkillCompatibility();
    const { runBrowserSession } = await import('./browser-session.js');
    return runBrowserSession(printStdout);
  }
  if (argv[0] === 'preflight') {
    const { runPreflight } = await import('./preflight.js');
    const result = await runPreflight();
    if (result.status === 'failed') process.exitCode = 2;
    return JSON.stringify(result);
  }
  if (argv[0] === 'version-check') {
    const report = await checkSkillCompatibility();
    if (!report.compatible) process.exitCode = 2;
    return JSON.stringify(report);
  }
  if (argv[0] === 'task-check') {
    const report = await checkTaskConfig();
    return JSON.stringify({ ok: true, ...report });
  }
  if (argv[0] === 'task-init') {
    const run = await initRun(undefined, { keepObserved: startup!.options.has('--keep-observed') });
    return JSON.stringify({ ok: true, ...run, phase: run.task.phases?.[0]?.name ?? 'task' });
  }
  const run = await activateRunBindings();
  const parsed = argv[0] === 'update' ? { argv, confirmation: undefined } : splitVersionConfirmation(argv);
  const cmd = validateTaskCommand(parsed.argv);
  if (cmd !== 'update' && (!run || parsed.confirmation)) await requireSkillCompatibility(parsed.confirmation);
  return isAttachmentCommand(parsed.argv)
    ? runCommandProcess(parsed.argv)
    : executeBoundCommand(parsed.argv, cmd);
}

async function runInteractiveLoop(): Promise<void> {
  await requireSkillCompatibility();
  const rl = createInterface({ input, output, terminal: true });
  await printPackageUpdateNoticeIfDue();
  printBossInteractiveBanner();
  try {
    for (;;) {
      let line: string;
      try {
        line = await rl.question('boss> ');
      } catch (e) {
        if (isReadlineAbortError(e)) {
          break;
        }
        throw e;
      }
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      if (/^(exit|quit)$/i.test(trimmed)) {
        break;
      }
      if (/^help$/i.test(trimmed)) {
        printHelp();
        continue;
      }
      if (/^(version|ver)$/i.test(trimmed) || /^(-v|--version)$/.test(trimmed)) {
        await printVersionInfo();
        continue;
      }
      const argv = splitShellLine(trimmed);
      try {
        const stopSpinner = startProcessingSpinner();
        const text = await executeManagedCommand(argv).finally(() => {
          stopSpinner();
        });
        printStdout(text);
      } catch (e) {
        if (splitJsonFlag(argv.slice(1)).json) printStdout(jsonError(normalizeSubcommand(argv[0]), e));
        else console.error(e instanceof Error ? e.message : e);
      }
    }
  } finally {
    rl.close();
    // 退出交互时进程即将结束，必须 detach + unref 子进程，否则 Chrome 常随 Node 一起退出
    await detachBrowserSession().catch(() => {});
  }
}

export async function runCli(argv: string[]): Promise<void> {
  installOfflineTestGuard();
  if (argv[0] === 'collect') {
    const run = await activateRunBindings();
    const parsed = splitVersionConfirmation(argv);
    argv = parsed.argv;
    validateTaskCommand(argv);
    if (!run || parsed.confirmation) await requireSkillCompatibility(parsed.confirmation);
    const { rest, opts, flags } = parseOpts(argv.slice(1));
    if (rest.length || flags.size || !opts.job?.trim() || Object.keys(opts).some(key => !['job', 'ledger-dir', 'mode'].includes(key))) {
      die('❌ 用法: boss collect --job <岗位完整名称> [--ledger-dir <目录>] [--mode <screen|collect-only>]');
    }
    if (run && (run.scope !== 'collect' || run.job !== opts.job.trim())) die('collect 的岗位/入口与运行任务不匹配');
    const mode = (opts.mode ?? run?.task.mode ?? 'screen') as 'screen' | 'collect-only';
    if (run && mode !== (run.task.mode ?? 'screen')) die('collect --mode 与任务配置不匹配');
    if (mode !== 'screen' && mode !== 'collect-only') die('❌ collect --mode 必须是 screen 或 collect-only。');
    // 账本目录一致性：run 绑定的 ledgerDir 与显式 --ledger-dir 不一致即拒绝。
    const boundLedgerDir = process.env.BOSS_LEDGER_DIR?.trim();
    const requestedLedgerDir = opts['ledger-dir']?.trim();
    if (boundLedgerDir && requestedLedgerDir && requestedLedgerDir !== boundLedgerDir) {
      die(`❌ collect --ledger-dir 与运行绑定账本目录不一致：${requestedLedgerDir} / ${boundLedgerDir}`);
    }
    await assertPermittedCommand('collect', argv);
    await assertPermittedPhase('collect', argv);
    try {
      await runCollectionSession(requestedLedgerDir || boundLedgerDir || join(APP_HOME, 'ledgers'), opts.job.trim(), mode);
    } finally { await cleanupAfterCommand('collect', true); }
    return;
  }
  if (argv.length === 0) {
    if (process.env.npm_lifecycle_event === 'dev') {
      await runInteractiveLoop();
    } else {
      console.error('❌ 生产环境不支持交互模式。请使用 boss --help 查看可用命令。');
      process.exit(1);
    }
    return;
  }

  if (
    argv[0] === 'version' ||
    argv[0] === 'ver' ||
    argv[0] === '-v' ||
    argv[0] === '--version'
  ) {
    await printVersionInfo();
    return;
  }

  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    return;
  }

  if (!findCommandSpec(argv[0]!)?.startupForm && !taskConfigPath() && !argv.some(a=>a==='--check'||a==='--check-job'||a==='--check-in_online_resume') && !isAttachmentCommand(argv) && !['ocr', 'update', 'check', 'status', '--check-login'].includes(normalizeSubcommand(argv[0] ?? '')) && !splitJsonFlag(argv.slice(1)).json) {
    await printPackageUpdateNoticeIfDue();
  }

  try {
    await runOneCommand(argv);
  } finally {
    await cleanupAfterCommand(argv[0] ?? '', true);
  }
}
