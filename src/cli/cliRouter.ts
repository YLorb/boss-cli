import { runCheck, runStatus, type CheckCriteria } from '../toolset/check.js';
import { runResumeOcr } from '../common/resume_ocr.js';
/**
 * CLI：子命令直接调用 toolset 中的 impl*。
 * 无参数时进入交互模式，逐行解析与 `boss <argv...>` 相同的命令。
 */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { detachBrowserSession } from '../browser/index.js';
import {
  implChatAction,
  implChatSearch,
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
import { parseSearchMoreArgs, runSearchMore } from '../toolset/search-more.js';
import { inspectEmbeddedChat, checkEmbeddedChat, sendEmbeddedChat, closeEmbeddedChat } from '../toolset/embedded-chat.js';
import { dismissContactNotice } from '../toolset/contact-notice.js';
import { checkSkillCompatibility, requireSkillCompatibility, splitVersionConfirmation } from './skill_compatibility.js';
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
  boss ocr <PNG绝对路径> [--timeout-ms <1000-120000>] [--json]
      向 BOSS_OCR_URL（默认 http://ylorb.top:9002/ocr）上传本地截图并按坐标分栏重排；保留原图
      截图后由 Agent 后台调用，评估前等待完成并优先读 textPath；失败报错，不重试、不连接浏览器
  boss collect --job <岗位完整名称> [--ledger-dir <目录>]
      一岗一账的常驻会话；stdin 每行一个 JSON 命令，stdout 每行一个 JSON 结果
      op: add / decision / round / recheck / reconcile / show / stop；仅 stop 或 Ctrl+C 正常写回
      recheck 必须显式发出；发现 reading 残留时，必须 reconcile 全量逐项对账
  boss version | ver（或 -v / --version）
      显示当前版本并检查 npm 是否有更新
  boss update
      使用 npm 安装最新版 boss-cli
  boss version-check [--json]
      离线校验 CLI 与实际加载的 Skill 配套版本；外部 Skill 必须设置绝对路径 BOSS_SKILL_DIR
      不匹配返回退出码 2，业务启动被阻止；用户确认后本轮业务命令可加 --confirm-version-mismatch <令牌>
  业务命令均支持 --json（login/list/chat/action/probe-resume/accept-resume/download-resume/send/positions/jd/recommend/search/search-more/deep-search/preview/greet/dismiss-contact-notice/back）
      输出各命令的原始字段；JSON 模式 stdout 仅输出结果，诊断日志写 stderr
      失败输出 {ok:false,command,error:{name,message}} 并返回非零退出码
      jd --json 返回 Markdown 正文与缓存路径；download-resume 默认已输出 JSON
  boss login
      打开登录页（需要用户在浏览器中自行完成登录，这个命令会直接返回）
  boss --check-login [--json]
      只读检查现有浏览器中的首个 BOSS 标签页；返回true/false，无法判定时报错，不打开或跳转页面
  boss check --page <chat|search|recommend|deep-search|online-resume|positions|login|other> [--state <状态>] [--name <姓名>] [--data-id <ID>] [--candidate-id <ID>] [--job <完整岗位>] [--text <正文>]
  boss status [--json]
      check 和业务 --check 严格只读，输出 true/false；status 输出当前页面信息。读取失败报错。
  boss list [--unread] [--chatting] [--json]
      --chatting 选择顶部「沟通中」；--json 输出含姓名、data-id、当前沟通职位的结构化列表
  boss chat --inspect-embedded
  boss dismiss-contact-notice <姓名> --candidate-id <已联系ID> --job <完整岗位>
    仅关闭当前搜索简历的已知畅聊卡使用成功提示；核验身份及已联系状态，点一次关闭，不点查看对话。
  boss chat <实际姓名> --embedded --close --candidate-id <ID> --job <完整岗位>
    仅关闭当前已核验的搜索页内嵌窗口；有草稿、遮挡或身份不符则停止，不刷新或重试。
  boss chat <实际姓名> --embedded --check --candidate-id <搜索候选人ID> --job <完整岗位>
  boss send --embedded --name <实际姓名> --candidate-id <搜索候选人ID> --job <完整岗位> --text <正文> [--check]
    只处理当前搜索页内嵌会话，不导航；send --embedded --check 仅读取，不输入、不发送。
  boss chat <姓名> [--strict]
      直接按完整昵称搜索，不主动切换或恢复岗位；按姓名和会话ID核验成功，重名保持搜索现场暂停；--strict 保留兼容
  boss chat-search <完整昵称> [--info <已知原文>] [--data-id <预期会话ID>] [--job <预期完整岗位>] [--json]
      须已在沟通页；直接搜索，唯一匹配打开并核验姓名和会话ID；BOSS自行重置筛选不算定位失败；重名保持搜索现场暂停
      零匹配且查询已完成返回not-found；查询未完成仍超时，业务定位遇零匹配抛CandidateNotFound停止
      匹配项含name/uniqueId/label/info/tag；info为原始workDesc，tag为exchangeDesc，缺失返回null；--info 按完整姓名和已获取的info原文精确筛选，不向页面输入info
      BOSS_CHAT_SEARCH_TIMEOUT_MS 设置每次搜索/身份等待上限，默认20000ms，范围1000–60000；错误附阶段和只读DOM诊断，不自动重试
      --job 比较实际岗位，--data-id 核验会话ID；不用于自动挑选重名；不支持 --check，不发送消息
  boss chat [姓名] --index <序号> [--unread] [--strict]
      从当前列表 1-based 序号读取姓名、ID及岗位，再按昵称搜索定位；--unread 用于读取未读列表的序号对象
      同时提供姓名时精确校验；序号或ID不能绕过重名暂停，不滚动查找
      仅用于已建立联系的候选人（即在 list 里可见的会话对象）
  boss chat <姓名> --data-id <会话ID> [--info <已知原文>]
      先核验当前姓名、会话ID及详情姓名，一致则直接使用；不一致才搜索定位，不主动切换或恢复岗位，搜索可用已知info精确筛选；仍多匹配则暂停，无匹配即停止，无失败回退
  boss accept-resume <姓名> --data-id <会话ID> [--check]
      在指定会话同意对方的附件简历请求，并等待附件卡片出现；不发送文字
  boss probe-resume <姓名> --data-id <会话ID> [--download] [--output-dir <目录>] [--json]
      复用或昵称定位指定会话后检查附件、已发送求简历消息，不主动切岗；--download 同时下载已收到附件
      probe-resume / accept-resume / download-resume 整条命令限时 15 秒，超时终止子进程并返回错误
  boss download-resume <姓名> --data-id <会话ID> [--output-dir <目录>] [--check]
      下载指定会话已经收到的原附件，返回 JSON 文件路径、大小和 SHA-256
      --check：只读比较当前身份及附件状态，返回 true/false，不定位、不接收或下载
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
  boss back [--if-open]；back --check-in_online_resume 只判断是否打开简历
      关闭在线简历弹层；独立在线简历页仅向已核验的列表历史回退一步。检查开关在列表上不操作。
  boss back --previous --expect-url <前一条历史的完整BOSS列表URL> [--json]
      显式返回上一条浏览器历史，仅一步；核对前后历史ID及URL。不刷新、不重新路由、不重跑失败动作。
      仅支持已知列表、在线简历页及权益页；登录、验证、未知页或简历弹层仍打开时停止。

  boss recommend [岗位关键字] [--ensure-job]；--check-job 只比较当前岗位
      进入推荐页并读取推荐列表；岗位名称＋城市作为匹配键，忽略薪资后缀；同岗位不重复选择；--ensure-job 要求该键唯一精确匹配
  boss search [关键词]
      进入「搜索」页并读取当前结果；带关键词时提交一次，等待本次响应成功并核对页面候选人 ID/查询标识；失败不重试
  boss search-more --max-scrolls <1-20> --max-candidates <1-500> [--timeout-ms <1000-15000>] [--json]
      仅当前常规搜索页，逐次向下滚动并核验下一页响应；关键词／岗位保持不变，按候选人ID去重，不联系。
      人数上限包含起始列表、限制返回池；平台单页可能额外加载。每轮响应及核验共用超时，默认10000ms。
      达上限、成功空响应或成功响应无新增ID即结束；无响应、请求失败或页面变化直接报错，不刷新、不重试。
  boss preview <姓名> [--candidate-id <ID>] [--open-only]
      在线简历预览：须当前已在「推荐」(/web/chat/recommend)、「深度搜索」(/web/chat/aiform) 或「常规搜索」(/web/chat/search) 且列表已加载；不会自动跳转
      --candidate-id 支持推荐及常规搜索：姓名和 ID 联合唯一核验；无 ID 时重名暂停；深度搜索不支持该参数
      --open-only 仅搜索页：打开并核验候选人 ID，保持展开，不截图、不沟通；已打开同一人时复用
      注意：平台对在线简历每日可查看次数有限，请按需使用、谨慎查看
  boss greet <姓名> [--candidate-id <ID>] [--job <岗位关键字>] [--select-job <联系岗位完整名称>] [--confirm-contact | --continue-chat --candidate-id <ID>] [--check]
      须在推荐、深度搜索或常规搜索页；常规搜索支持当前在线简历，不自动跳转
      点击目标的“打招呼/立即沟通”；--check 只读核对推荐列表或搜索在线简历的身份及按钮；搜索页不支持 --job
      --select-job 仅选择联系岗位；--confirm-contact 确认已选岗位；--continue-chat 配合回执 ID 打开已联系会话
      chat <姓名> --check 只读返回身份匹配 true/false；读取详情用 status
      可选 --job 先在岗位下拉中模糊匹配；同岗位不重复选择（与 recommend 共用同一套选择逻辑）
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
  if (json && !['ocr', 'check', 'status', '--check-login', 'login', 'list', 'chat', 'chat-search', 'action', 'probe-resume', 'accept-resume', 'download-resume', 'send', 'positions', 'jd', 'deep-search', 'deepsearch', 'search', 'search-more', 'preview', 'recommend', 'greet', 'back', 'dismiss-contact-notice'].includes(cmd)) {
    die(`❌ ${cmd} 不支持 --json。`);
  }
  if (cmd === 'ocr') {
    const paths: string[] = [];
    let timeoutMs: number | undefined;
    for (let i = 0; i < tail.length; i++) {
      if (tail[i] === '--timeout-ms') {
        if (timeoutMs !== undefined || !/^\d+$/.test(tail[i+1] ?? '')) die('ocr --timeout-ms 需要唯一整数值');
        timeoutMs = Number(tail[++i]);
      } else if (tail[i].startsWith('-')) die('ocr 不支持参数：' + tail[i]);
      else paths.push(tail[i]);
    }
    if (paths.length !== 1) die('用法: boss ocr <PNG绝对路径> [--timeout-ms <1000-120000>] [--json]');
    const result = await runResumeOcr(paths[0], timeoutMs);
    return json ? JSON.stringify(result) : `OCR 完成：${result.textPath}\n原图：${result.imagePath}\n结果：${result.resultPath}`;
  }
  if(cmd==='status') {
    if(tail.length) die('status 不接受参数');
    return runStatus();
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

  if (cmd === 'chat-search') {
    const { rest, opts, flags } = parseOpts(tail);
    if (rest.length !== 1 || !rest[0]!.trim() || flags.size || Object.keys(opts).some(k => !['data-id', 'job', 'info'].includes(k)) || Object.values(opts).some(v => !v.trim())) die('用法: chat-search <完整昵称> [--info <已知原文>] [--data-id <预期ID>] [--job <预期岗位>] [--json]');
    return implChatSearch({ name: rest[0]!, dataId: opts['data-id'], job: opts.job, ...(opts.info !== undefined ? { info: opts.info } : {}) }, json);
  }

  if (cmd === 'dismiss-contact-notice') {
    const {rest,flags,opts}=parseOpts(tail);
    if(!rest.join(' ').trim()||flags.size||!opts['candidate-id']?.trim()||!opts.job?.trim()||Object.keys(opts).some(k=>!['candidate-id','job'].includes(k)))
      die('dismiss-contact-notice <姓名> --candidate-id <已联系ID> --job <完整岗位> [--json]');
    return dismissContactNotice({name:rest.join(' ').trim(),candidateId:opts['candidate-id'].trim(),job:opts.job.trim()});
  }
  if (cmd === 'chat') {
    const { rest, flags, opts } = parseOpts(tail, new Set(['check', 'embedded', 'inspect-embedded', 'close']));
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
    if (flags.has('info') || (opts.info !== undefined && (!opts.info.trim() || !dataId || !!indexRaw || flags.has('check')))) {
      die('chat --info 需要非空原文及 --data-id，不与 --check/--index 混用');
    }
    if (flags.has('data-id')) {
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
    const { flags, opts, rest } = parseOpts(tail, new Set(['check','embedded']));
    if(flags.has('embedded')) {
      if(rest.length || !opts.name || !opts['candidate-id'] || !opts.job || !(opts.text||opts.t) ||
        [...flags].some(f=>!['embedded','check'].includes(f)) || Object.keys(opts).some(k=>!['name','candidate-id','job','text','t'].includes(k)))
        die('send --embedded --name <实际姓名> --candidate-id <ID> --job <完整岗位> --text <正文> [--check]');
      return sendEmbeddedChat({name:opts.name.trim(),candidateId:opts['candidate-id'].trim(),job:opts.job.trim()},opts.text||opts.t,flags.has('check'));
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

  if (cmd === 'search-more') return runSearchMore(parseSearchMoreArgs(tail), json);

  if (cmd === 'search') {
    const { rest, opts, flags } = parseOpts(tail);
    if (flags.size > 0 || Object.keys(opts).length > 0) {
      die('❌ 用法: search [关键词]');
    }
    const keyword = rest.join(' ').trim();
    return implNormalSearch(keyword || undefined, json);
  }

  if (cmd === 'preview') {
    const { rest, opts, flags } = parseOpts(tail, new Set(['open-only']));
    if ([...flags].some(flag => flag !== 'open-only')) {
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
    return implPreview({ candidateTarget, json, ...(opts['candidate-id'] ? {candidateId:opts['candidate-id'].trim()} : {}), ...(flags.has('open-only') ? { openOnly: true } : {}) });
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
    return runBack(flags.has('if-open'), json);
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
    const jobKeyword = opts.job?.trim();
    const extraOpts = Object.keys(opts).filter((k) => k !== 'job' && k !== 'select-job' && k !== 'candidate-id');
    if (extraOpts.length > 0) {
      die('❌ 用法: greet <姓名> [--candidate-id <ID>] [--job <岗位关键字>] [--select-job <联系岗位完整名称>] [--confirm-contact | --continue-chat --candidate-id <ID>] [--check]');
    }
    if (opts['select-job'] !== undefined && (!opts['select-job'].trim() || jobKeyword)) die('--select-job 需要完整岗位名称且不能与 --job 混用');
    const target = rest.join(' ').trim();
    if (!target) {
      die('❌ 用法: greet <姓名> [--candidate-id <ID>] [--job <岗位关键字>] [--select-job <联系岗位完整名称>] [--confirm-contact | --continue-chat --candidate-id <ID>] [--check]');
    }
    return implRecommendGreet({ candidateTarget: target, jobKeyword: jobKeyword || undefined, json, ...(flags.has('check') ? { check: true } : {}), ...(opts['candidate-id'] ? {candidateId:opts['candidate-id'].trim()} : {}), ...(flags.has('continue-chat') ? {continueChat:true} : {}), ...(flags.has('confirm-contact') ? {confirmContact:true} : {}), ...(opts['select-job'] ? {selectJob:opts['select-job'].trim()} : {}) });
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
  if (argv[0] === 'version-check') {
    if (argv.slice(1).some(arg => arg !== '--json') || argv.length > 2) die('用法: boss version-check [--json]；通过 BOSS_SKILL_DIR 指定实际加载的 Skill');
    const report = await checkSkillCompatibility();
    if (!report.compatible) process.exitCode = 2;
    return JSON.stringify(report);
  }
  if (argv[0] !== 'update') {
    const parsed = splitVersionConfirmation(argv);
    await requireSkillCompatibility(parsed.confirmation);
    argv = parsed.argv;
  }
  return isAttachmentCommand(argv) ? runCommandProcess(argv) : executeCommand(argv);
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
  if (argv[0] === 'collect') {
    const parsed = splitVersionConfirmation(argv);
    await requireSkillCompatibility(parsed.confirmation);
    argv = parsed.argv;
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

  if (!argv.some(a=>a==='--check'||a==='--check-job'||a==='--check-in_online_resume') && !isAttachmentCommand(argv) && !['ocr', 'update', 'version-check', 'check', 'status', '--check-login'].includes(normalizeSubcommand(argv[0] ?? '')) && !splitJsonFlag(argv.slice(1)).json) {
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
