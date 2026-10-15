/**
 * CLI：子命令直接调用 toolset 中的 impl*。
 * 无参数时进入交互模式，逐行解析与 `boss <argv...>` 相同的命令。
 */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { detachBrowserSession } from '../browser/index.js';
import {
  implChatAction,
  implLogin,
  implListCandidates,
  implListUnreadCandidates,
  implOpenChatByIndex,
  implListPositions,
  implListPositionsWithOptions,
  implNormalSearch,
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
  type ChatPageAction,
} from '../toolset/index.js';
import { printBossInteractiveBanner } from './banner.js';
import { jsonError, splitJsonFlag } from './output.js';
import { isAttachmentCommand, runCommandProcess } from './command_process.js';
import { runProbeTargetResume } from '../toolset/attachment.js';
import { runCollectionSession } from '../collection/session.js';
import { runBack } from '../toolset/back.js';
import { runCheckLogin } from '../toolset/check_login.js';
import { APP_HOME } from '../config.js';
import { join } from 'node:path';
import {
  printPackageUpdateNoticeIfDue,
  printVersionInfo,
  runPackageUpdate,
} from './version.js';

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

function envTruthy(name: string): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y';
}

/** 默认有头；仅当环境变量为真时启用无头（与 `connectBrowser` 读取的 `BOSS_BROWSER_HEADLESS` 一致）。 */
function shouldRunHeadless(): boolean {
  return envTruthy('BOSS_BROWSER_HEADLESS');
}

function configureHeadlessForCommand(cmd: string): void {
  if (cmd === 'login') {
    process.env.BOSS_BROWSER_HEADLESS = 'false';
    return;
  }
  process.env.BOSS_BROWSER_HEADLESS = shouldRunHeadless() ? 'true' : 'false';
}

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
    default:
      return cmd;
  }
}

function printHelp(): void {
  console.error(`boss-cli — Boss 直聘浏览器自动化（纯 CLI，无 Agent 运行时）

用法与说明:
  boss
      进入交互模式；提示符 boss> ，exit / quit 退出；Ctrl+C 正常结束
  boss help
      显示本帮助
  boss collect --job <岗位完整名称> [--ledger-dir <目录>]
      一岗一账的常驻会话；stdin 每行一个 JSON 命令，stdout 每行一个 JSON 结果
      op: add / decision / round / recheck / reconcile / show / stop；仅 stop 或 Ctrl+C 正常写回
      recheck 必须显式发出；发现 reading 残留时，必须 reconcile 全量逐项对账
  boss version | ver（或 -v / --version）
      显示当前版本并检查 npm 是否有更新
  boss update
      使用 npm 安装最新版 boss-cli
  业务命令均支持 --json（login/list/chat/action/probe-resume/accept-resume/download-resume/send/positions/jd/recommend/search/deep-search/preview/greet/back）
      输出各命令的原始字段；JSON 模式 stdout 仅输出结果，诊断日志写 stderr
      失败输出 {ok:false,command,error:{name,message}} 并返回非零退出码
      jd --json 返回 Markdown 正文与缓存路径；download-resume 默认已输出 JSON
  boss login
      打开登录页（需要用户在浏览器中自行完成登录，这个命令会直接返回）
  boss --check-login [--json]
      只读检查现有浏览器中的首个 BOSS 标签页；返回已登录/未登录/无法判定，不打开或跳转页面
  boss list [--unread] [--chatting] [--json]
      --chatting 选择顶部「沟通中」；--json 输出含姓名、data-id、当前沟通职位的结构化列表
  boss chat <姓名> [--strict]
      打开指定联系人会话；默认包含匹配，--strict 为精确匹配
  boss chat [姓名] --index <序号> [--unread] [--strict]
      按 boss list 输出的 1-based 序号打开会话；--unread 表示序号对应 boss list --unread
      同时提供姓名时会校验该序号候选人姓名，--strict 表示精确校验
      仅用于已建立联系的候选人（即在 list 里可见的会话对象）
  boss chat <姓名> --data-id <会话ID>
      在顶部「全部」会话中按姓名 + data-id 精确定位并核对详情
  boss accept-resume <姓名> --data-id <会话ID> [--check]
      在指定会话同意对方的附件简历请求，并等待附件卡片出现；不发送文字
  boss probe-resume <姓名> --data-id <会话ID> [--download] [--output-dir <目录>] [--json]
      沟通-全部定位后，依次检查附件、已发送求简历消息；--download 同时下载已收到附件
      probe-resume / accept-resume / download-resume 整条命令限时 15 秒，超时终止子进程并返回错误
  boss download-resume <姓名> --data-id <会话ID> [--output-dir <目录>] [--check]
      下载指定会话已经收到的原附件，返回 JSON 文件路径、大小和 SHA-256
      --check：检查当前会话，同一 data-id 时跳过列表定位；仍核对姓名与详情
  boss action <操作> [--remark <备注>]
      仅在当前聊天页已打开候选人详情时执行操作，并只返回 action 执行结果
      操作: resume | not-fit | remark | agree-resume | request-attachment-resume | history | wechat
      request-attachment-resume：工具栏「求简历」，确认后向对方发送默认话术索要附件简历（需双方各至少发过一条消息）
      操作为 remark 时必须提供 --remark
  boss send [--text <内容>] [-t <内容>] [--name <姓名> --data-id <会话ID>] [--request-resume] [--check]
      仅发送文本消息（等价于在当前会话输入框发送后回车）
      --request-resume：发送后延迟片刻自动执行「求简历」操作
  boss positions
      读取当前职位列表（含开放/待开放/已关闭状态）
  boss jd <name>
      抓取指定职位详情并缓存到项目目录同名 .md
  boss back [--check-in_online_resume]
      关闭在线简历弹层；独立在线简历页仅向已核验的列表历史回退一步。检查开关在列表上不操作。

  boss recommend [岗位关键字] [--check-job]
      进入推荐页并读取推荐列表；带岗位关键字时选择岗位；--check-job 与当前完整岗位名匹配时跳过选择
  boss search [关键词]
      进入「搜索」页并读取 Boss 默认常规搜索结果；带关键词时填入搜索框并回车搜索
  boss preview <姓名>
      在线简历预览：须当前已在「推荐」(/web/chat/recommend)、「深度搜索」(/web/chat/aiform) 或「常规搜索」(/web/chat/search) 且列表已加载；不会自动跳转
      注意：平台对在线简历每日可查看次数有限，请按需使用、谨慎查看
  boss greet <姓名> [--job <岗位关键字>]
      须当前已在「推荐」(/web/chat/recommend) 或「深度搜索」(/web/chat/aiform) 且列表已加载；不会自动跳转
      对当前列表中的候选人点击“打招呼”
      可选 --job 先在岗位下拉中模糊匹配并切换（与 recommend 共用同一套选择逻辑）
      会消耗打招呼次数且单次成本较高，请谨慎使用
  boss deep-search [岗位关键字] [--job <岗位关键字>] [--core <核心要求>] [--bonus <加分项>] [--clear-core] [--clear-bonus] [--match]
      进入「深度搜索」页并输出当前表单、剩余匹配次数和按钮状态；--core/--bonus 可重复，并按传入列表同步对应分组；--clear-* 清空对应分组
      只有显式提供 --match 时才会点击「立即匹配」并消耗今日匹配次数；--match 输出列表顶部最新 20 条
  
  !!鉴于boss的风控机制存在更新，且本cli的功能在逐步完善中，若遇到部分操作问题，请先检查版本更新
`);
}

/** 解析 `--key value` / `--key=value` / 布尔 `--flag` */
function parseOpts(argv: string[], booleanFlags: ReadonlySet<string> = new Set()): {
  rest: string[];
  flags: Set<string>;
  opts: Record<string, string>;
} {
  const rest: string[] = [];
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        const k = a.slice(2, eq);
        if (booleanFlags.has(k)) die(`❌ --${k} 是布尔开关，不接受值。`);
        opts[k] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      if (booleanFlags.has(key)) {
        flags.add(key);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        opts[key] = next;
        i += 1;
      } else {
        flags.add(key);
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !a.startsWith('--')) {
      const short = a.slice(1);
      const next = argv[i + 1];
      if (short === 't' && next !== undefined && !next.startsWith('-')) {
        opts.t = next;
        i += 1;
        continue;
      }
      if (!/^\d/.test(short)) {
        flags.add(short);
        continue;
      }
    }
    rest.push(a);
  }
  return { rest, flags, opts };
}

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

/**
 * 执行一条子命令并返回结果（与传入 `process.argv` 切片语义一致，不含 `boss` 本身）。
 */
export async function executeCommand(argv: string[]): Promise<string> {
  if (argv.length === 0) {
    die('❌ 空命令');
  }

  const cmd = normalizeSubcommand(argv[0]);
  const { args: tail, json } = splitJsonFlag(argv.slice(1));
  const delimiter = tail.indexOf('--');
  const optionTokens = delimiter === -1 ? tail : tail.slice(0, delimiter);
  if (optionTokens.some((token) => token.startsWith('--json='))) die('❌ --json 是布尔开关，不接受值。');
  if (json && !['--check-login', 'login', 'list', 'chat', 'action', 'probe-resume', 'accept-resume', 'download-resume', 'send', 'positions', 'jd', 'deep-search', 'deepsearch', 'search', 'preview', 'recommend', 'greet', 'back'].includes(cmd)) {
    die(`❌ ${cmd} 不支持 --json。`);
  }
  configureHeadlessForCommand(cmd);

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

  if (cmd === 'chat') {
    const { rest, flags, opts } = parseOpts(tail);
    const nameArg = rest.join(' ').trim();
    if ((opts.action ?? '').trim().length > 0 || (opts.remark ?? '').trim().length > 0) {
      die('❌ chat 不再支持 --action/--remark。请改用: action <操作> [--remark <备注>]');
    }
    const allowedOpts = new Set(['index', 'i', 'action', 'remark', 'data-id']);
    const unsupportedOpts = Object.keys(opts).filter((key) => !allowedOpts.has(key));
    if (unsupportedOpts.length > 0) {
      die(`❌ chat 不支持参数: --${unsupportedOpts.join(', --')}`);
    }
    // 默认模糊匹配（包含）；仅在指定 --strict 时做精确匹配
    const exact = flags.has('strict');
    const indexRaw = (opts.index ?? opts.i ?? '').trim();
    const dataId = (opts['data-id'] ?? '').trim();
    if (flags.has('data-id')) {
      die('❌ chat --data-id 必须提供会话 ID。');
    }
    if (dataId) {
      if (indexRaw || flags.has('unread') || !nameArg || Array.from(flags).some((f) => f !== 'strict')) {
        die('❌ 用法: chat <姓名> --data-id <会话ID>');
      }
      return implOpenTargetChat({ name: nameArg, dataId }, json);
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
    return implOpenChat(nameArg, exact, json);
  }

  if (cmd === 'action') {
    const { rest, opts } = parseOpts(tail);
    const raw = (rest[0] ?? opts.type ?? opts.action ?? '').trim().toLowerCase();
    const actionMap: Record<string, ChatPageAction> = {
      resume: 'resume',
      'not-fit': 'not-fit',
      remark: 'remark',
      'agree-resume': 'agree-resume',
      'request-attachment-resume': 'request-attachment-resume',
      'ask-attachment-resume': 'request-attachment-resume',
      'ask-resume': 'request-attachment-resume',
      history: 'history',
      'chat-history': 'history',
      wechat: 'exchange-wechat',
      'exchange-wechat': 'exchange-wechat',
    };
    const action = actionMap[raw];
    if (!action) {
      die(
        '❌ 用法: action <resume|not-fit|remark|agree-resume|request-attachment-resume|history|wechat> [--remark <备注>]',
      );
    }
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
    const { flags, opts } = parseOpts(tail, new Set(['check']));
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
    return implSendMessage({ text, requestResume, target: name ? { name, dataId } : undefined, json, check });
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

  if (cmd === 'deep-search' || cmd === 'deepsearch') {
    return implBossSearch({ ...parseDeepSearchArgs(tail), json });
  }

  if (cmd === 'search') {
    const { rest, opts, flags } = parseOpts(tail);
    if (flags.size > 0 || Object.keys(opts).length > 0) {
      die('❌ 用法: search [关键词]');
    }
    const keyword = rest.join(' ').trim();
    return implNormalSearch(keyword || undefined, json);
  }

  if (cmd === 'preview') {
    const { rest, opts, flags } = parseOpts(tail);
    if (flags.size > 0) {
      die('❌ preview 不支持该 flag');
    }
    const unsupportedOpts = Object.keys(opts);
    if (unsupportedOpts.length > 0) {
      die(`❌ preview 不支持: --${unsupportedOpts[0]}`);
    }
    const candidateTarget = rest.join(' ').trim();
    if (!candidateTarget) {
      die('❌ 用法: preview <姓名>');
    }
    return implPreview({ candidateTarget, json });
  }

  if (cmd === 'back') {
    const { rest, opts, flags } = parseOpts(tail, new Set(['check-in_online_resume']));
    if (rest.length || Object.keys(opts).length || [...flags].some(f => f !== 'check-in_online_resume')) die('❌ 用法: back [--check-in_online_resume]');
    return runBack(flags.has('check-in_online_resume'), json);
  }

  if (cmd === 'recommend') {
    const { rest, opts, flags } = parseOpts(tail, new Set(['check-job']));
    if (rest[0] === 'preview') {
      die('❌ 请改用: boss preview <姓名>（已不再使用 recommend preview）');
    }
    if (Object.keys(opts).length > 0 || [...flags].some(f => f !== 'check-job')) {
      die('❌ 用法: recommend [岗位完整名称] [--check-job]');
    }
    const jobKeyword = rest.join(' ').trim();
    if (flags.has('check-job') && !jobKeyword) die('❌ --check-job 需要岗位完整名称');
    return implRecommend(jobKeyword || undefined, json, flags.has('check-job'));
  }

  if (cmd === 'greet') {
    const { rest, opts, flags } = parseOpts(tail);
    if (flags.size > 0) {
      die('❌ 用法: greet <姓名> [--job <岗位关键字>]');
    }
    const jobKeyword = opts.job?.trim();
    const extraOpts = Object.keys(opts).filter((k) => k !== 'job');
    if (extraOpts.length > 0) {
      die('❌ 用法: greet <姓名> [--job <岗位关键字>]');
    }
    const target = rest.join(' ').trim();
    if (!target) {
      die('❌ 用法: greet <姓名> [--job <岗位关键字>]');
    }
    return implRecommendGreet({ candidateTarget: target, jobKeyword: jobKeyword || undefined, json });
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
    process.exitCode = 1;
  }
}

async function executeManagedCommand(argv: string[]): Promise<string> {
  return isAttachmentCommand(argv) ? runCommandProcess(argv) : executeCommand(argv);
}

async function runInteractiveLoop(): Promise<void> {
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
  if (argv[0] === 'collect') {
    const { rest, opts, flags } = parseOpts(argv.slice(1));
    if (rest.length || flags.size || !opts.job?.trim() || Object.keys(opts).some(key => !['job', 'ledger-dir'].includes(key))) {
      die('❌ 用法: boss collect --job <岗位完整名称> [--ledger-dir <目录>]');
    }
    try {
      await runCollectionSession(opts['ledger-dir'] || join(APP_HOME, 'ledgers'), opts.job.trim());
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

  if (!isAttachmentCommand(argv) && !['update', '--check-login'].includes(normalizeSubcommand(argv[0] ?? '')) && !splitJsonFlag(argv.slice(1)).json) {
    await printPackageUpdateNoticeIfDue();
  }

  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    return;
  }

  try {
    await runOneCommand(argv);
  } finally {
    await cleanupAfterCommand(argv[0] ?? '', true);
  }
}
