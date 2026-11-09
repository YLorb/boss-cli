import { parseCommandArguments } from './arguments.js';
// 阶段名只收紧命令集；业务门以真实命令回执和冻结任务为依据。
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { loadTaskConfig, taskConfigPath, type TaskConfig } from './task_config.js';
import { resolveAction, assertPermittedCommand, loadPermit } from './permit.js';
import { getBoundRun } from './run_state.js';
import { flowWatch, recordJournalResult } from '../common/flow_state.js';
import { recommendJobKey } from '../toolset/recommend_job.js';
import { assertActionHistory, beginAction, finishAction } from '../common/action_history.js';
import {createHash} from 'node:crypto';
import type {AttachmentProbe} from '../toolset/attachment.js';

type Target = { id: string; name: string };
type DownloadReceipt={path:string;bytes:number;sha256:string;attachmentName:string};
export type PhaseState = { version: 2; phase: string; at: string; runId: string; jobVerified: boolean; targets: Target[]; frozen: boolean; current: string | null; material: Record<string, { image?: string; textPath?: string }>; decisions: Record<string, string>; downloaded: string[]; downloads: Record<string,DownloadReceipt>; sent: string[]; contacts: string[]; observed: string[]; pending: { cmd: string; id: string; text: string; attemptId?: string; knownNotAttempted?: boolean } | null; safeRetries: Record<string, number>; successes: number; failures: number; paused: string | null };
export class PhaseDeniedError extends Error { constructor(message: string) { super(message); this.name = 'PhaseDeniedError'; } }
export function isPhaseDenied(error: unknown): boolean { return error instanceof Error && error.name === 'PhaseDeniedError'; }
export function phaseStatePath(): string | null { return process.env.BOSS_PHASE_STATE?.trim() || null; }
export function isPhaseEnabled(): boolean { return phaseStatePath() !== null; }
const ALWAYS = new Set(['phase-set', 'phase-status', 'status', 'check', 'search-sidebar', '--check-login', 'flow-status', 'spec-list', 'task-check', 'task-init', 'help', 'version', 'version-check', 'flow-pause', 'flow-resume']);
// 岗位身份 = 岗位名 + 城市；薪资只是展示数据（与 recommendJobKey 的既有约定一致）。
// 任务配置的 job 是账本键（去薪资），页面下拉/筛选标签带薪资，故一律归一化后比较。
const sameJobKey = (actual: string | undefined, expected: string): boolean => actual !== undefined && recommendJobKey(actual) === recommendJobKey(expected);
const TARGETED = new Set(['chat', 'preview', 'decide', 'greet', 'send', 'probe-resume', 'accept-resume', 'download-resume', 'action']);
const SIDE_EFFECTS = new Set(['send', 'greet', 'accept-resume', 'download-resume', 'probe-resume', 'action']);
function sideEffect(cmd:string,argv:string[]):boolean{return SIDE_EFFECTS.has(cmd)&&!(cmd==='action'&&resolveAction(argv)==='resume')&&!(cmd==='probe-resume'&&!hasFlag(argv,'--download'));}
function deny(message: string): never { throw new PhaseDeniedError(message); }
export function option(argv: string[], name: string): string | undefined {
  return parseCommandArguments(argv).opts[name.replace(/^-+/, '')];
}
function hasFlag(argv: string[], name: string): boolean {
  return parseCommandArguments(argv).flags.has(name.replace(/^-+/, ''));
}
// 同一张截图的判定不能按字面比较：Git Bash 会把 C:\a\b 转成 C:/a/b，Windows 盘符大小写也可能变。
// 归一化后比较，避免「路径写法不同」被误判成「换了另一张图」。
const samePath = (a: string | undefined, b: string | undefined): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const norm = (p: string) => { const r = resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  return norm(a) === norm(b);
};
function messageText(argv:string[]):string {return option(argv,'--text')?.trim() || option(argv,'-t')?.trim() || '';}

function targetId(argv: string[], state: PhaseState): string { return option(argv, '--candidate-id') ?? option(argv, '--data-id') ?? (argv[0] === 'action' ? state.current ?? '' : ''); }
async function task(): Promise<TaskConfig> { const path = taskConfigPath(); if (!path) deny('未设置 BOSS_TASK_CONFIG'); return loadTaskConfig(path); }
async function state(): Promise<PhaseState> {
  const path = phaseStatePath(); if (!path) deny('未设置 BOSS_PHASE_STATE');
  let s: PhaseState;
  try { s = JSON.parse(await readFile(path, 'utf8')); } catch (error) { deny(`阶段状态不可读或未初始化：${path}；${String(error)}`); }
  if (!s || s.version !== 2 || typeof s.phase !== 'string' || typeof s.jobVerified !== 'boolean' || typeof s.frozen !== 'boolean' || !Array.isArray(s.targets) || !Array.isArray(s.contacts) || !Array.isArray(s.observed) || !Array.isArray(s.downloaded) || !Array.isArray(s.sent) || !s.material || !s.downloads || !s.decisions || !Number.isSafeInteger(s.successes) || !Number.isSafeInteger(s.failures)) deny('阶段状态结构无效，禁止继续');
  if (typeof s.runId !== 'string' || typeof s.at !== 'string' || !Number.isFinite(Date.parse(s.at)) || (s.current !== null && typeof s.current !== 'string') || (s.paused !== null && typeof s.paused !== 'string') || !s.safeRetries || typeof s.safeRetries !== 'object' || Array.isArray(s.safeRetries) || s.successes < 0 || s.failures < 0) deny('阶段状态身份/暂停/计数字段损坏');
  if (s.targets.some(x => !x || typeof x.id !== 'string' || !x.id || typeof x.name !== 'string' || !x.name) || [s.contacts, s.observed, s.downloaded, s.sent].some(xs => xs.some(x => typeof x !== 'string')) || Object.values(s.decisions).some(v => !['fit', 'not-fit', 'unknown'].includes(v))) deny('阶段状态候选人或决策字段损坏');
  if (s.pending !== null && (!s.pending || typeof s.pending.cmd !== 'string' || typeof s.pending.id !== 'string' || typeof s.pending.text !== 'string')) deny('阶段状态未决字段损坏');
  const run = getBoundRun(); if (run && s.runId !== run.runId) deny('阶段状态与 runId 错绑');
  return s;
}
async function save(s: PhaseState): Promise<void> {
  const file = phaseStatePath()!; const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify({ ...s, at: new Date().toISOString() }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  try { await rename(tmp, file); } finally { await unlink(tmp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export async function currentPhase(): Promise<string | null> { if (!phaseStatePath()) return null; return (await state()).phase; }
export async function recordCollectionDecision(id: string, verdict: 'fit' | 'not-fit', persist = true): Promise<void> {
  if (!getBoundRun()) return;
  const s = await state(), t = await task();
  if (!s.jobVerified || !s.frozen || !s.targets.some(x => x.id === id)) deny('收集决策对象未完成岗位/范围核验');
  if ((t.mode ?? 'screen') === 'screen' && !s.material[id]?.textPath) deny('收集评估前必须完成本人的材料解析');
  if (persist) { s.decisions[id] = verdict; await save(s); }
}
export async function readCollectionReceipt(id:string):Promise<AttachmentProbe>{
  const s=await state(),t=await task(),who=s.targets.find(x=>x.id===id),receipt=s.downloads[id];
  if(t.scope!=='collect'||!who||!receipt)deny('没有本轮该候选人的实际下载回执，不能入账');
  const bytes=await readFile(receipt.path);
  if(bytes.length!==receipt.bytes||createHash('sha256').update(bytes).digest('hex')!==receipt.sha256)deny('下载文件与回执字节数/SHA-256不匹配');
  return {name:who.name,dataId:id,attachment:'RECEIVED',attachmentName:receipt.attachmentName,request:'NOT_OBSERVED',requestEvidence:[],scope:'loaded-messages',download:receipt};
}
function requirement(s: PhaseState, r: string): boolean {
  switch (r) { case 'job-verified': return s.jobVerified; case 'scope-frozen': return s.frozen; case 'material-ready': return !!s.current && !!s.material[s.current]?.textPath; case 'evaluated': return !!s.current && !!s.decisions[s.current]; case 'download-confirmed': return !!s.current && s.downloaded.includes(s.current); case 'no-pending': return s.pending === null; default: return false; }
}
export async function setPhase(name: string): Promise<PhaseState> {
  const t = await task(); if (!t.phases?.length) deny('任务未声明 phases');
  const s = await state();
  const index = t.phases.findIndex(p => p.name === s.phase), next = t.phases.findIndex(p => p.name === name);
  if (next < 0) deny(`阶段未声明：${name}`);
  if (next === index) return s;
  if (next !== index + 1) deny('阶段必须按声明顺序推进，禁止跳步或倒退');
  if (s.paused || s.pending) deny('暂停或结果未决，不能切换阶段');
  if (s.successes === 0) deny('当前阶段没有成功业务回执，不能推进');
  for (const r of t.phases[next].requires ?? []) if (!requirement(s, r)) deny(`阶段前置条件未满足：${r}`);
  s.phase = name; s.successes = 0; await save(s); return s;
}
function phaseAllowed(t: TaskConfig, s: PhaseState, cmd: string, argv: string[]): void {
  if (!t.phases) return;
  const p = t.phases.find(p => p.name === s.phase); if (!p) deny(`当前阶段未声明：${s.phase}`);
  const variants = p.allowed[cmd]; if (!variants) deny(`命令 ${cmd} 在阶段 ${s.phase} 未授权`);
  if (variants.length && !(cmd === 'action' && variants.some(v=>resolveAction(['action',v])!==null&&resolveAction(['action',v])===resolveAction(argv)))) deny(`阶段 ${s.phase} 未允许该子动作`);
}
async function evaluate(cmd: string, argv: string[], t: TaskConfig, s: PhaseState): Promise<void> {
  if (getBoundRun() && ['status', 'check', 'search-sidebar', '--check-login'].includes(cmd)) {
    const watch = await flowWatch(getBoundRun()!.flowState);
    const verifying = cmd === 'check' && s.pending?.cmd === 'send' && targetId(argv, s) === s.pending.id && option(argv, '--job') === t.job && option(argv, '--text') === s.pending.text && !/验证码|风控|限流|verification|risk/i.test(s.paused ?? '') && !watch.paused;
    if ((s.paused || watch.paused) && !verifying) deny('全局暂停期间禁止继续读取真实页面');
  }
  if (ALWAYS.has(cmd)) return;
  phaseAllowed(t, s, cmd, argv);
  if (!getBoundRun()) return; // 手工模式仍只提供显式阶段白名单；正式任务强制下列业务门。
  if(cmd==='collect-sync'){await readCollectionReceipt(targetId(argv,s));return;}
  if (s.paused) deny(`必须暂停：${s.paused}`);
  const run = getBoundRun()!; const flow = await flowWatch(run.flowState); if (flow.paused) deny(`必须暂停：${flow.paused.reason}`);
  if (t.stop.deadline && Date.now() >= Date.parse(t.stop.deadline)) deny('本轮已到截止时间');
  if (t.stop.maxConsecutiveFailures !== undefined && s.failures >= t.stop.maxConsecutiveFailures) deny('已到连续失败上限');
  if (cmd === 'collect') return; // 会话各 stdin op 和 worker 仍逐步过门，不在此操作页面。
  if (['switch-job', 'search', 'recommend'].includes(cmd) && option(argv, '--job') !== undefined && !sameJobKey(option(argv, '--job'), t.job)) deny('不得切换到本轮岗位范围以外');
  if (t.scope === 'view-only' && (['greet', 'send', 'accept-resume', 'download-resume'].includes(cmd) || (cmd === 'probe-resume' && hasFlag(argv,'--download')))) deny('view-only 未授权联系、收件或下载');
  if (!parseCommandArguments(argv).json) deny('正式任务命令必须使用 --json 保存结构化回执');
  const id = targetId(argv, s), check = hasFlag(argv,'--check');
  if (TARGETED.has(cmd)) {
    if (!s.jobVerified) deny('先核验当前岗位（check --job 或 status）');
    if (!s.frozen) deny('先取得并冻结本轮候选人快照');
    if (!id || !s.targets.some(x => x.id === id)) deny('目标不在本轮冻结范围，必须携带稳定 ID');
  }
  // 推荐页 greet 只返回 clicked（点成功≠沟通成功），SOP 的下一步就是 chat --recommend --open 打开小窗核对身份，
  // 所以它必须能穿过「结果未决」这道门；真正的联系确认在 chat 回执核验通过时落账。
  const continuation = cmd === 'greet' && s.pending?.cmd === 'greet' && s.pending.id === id && (hasFlag(argv,'--confirm-contact') || option(argv, '--select-job') !== undefined)
    || (cmd === 'chat' && hasFlag(argv,'--recommend') && s.pending?.cmd === 'greet' && s.pending.id === id);
  if (s.pending && !continuation && (!check || cmd !== 'send')) deny(`动作结果未决：${s.pending.cmd}/${s.pending.id}，禁止重放或继续依赖动作`);
  if(sideEffect(cmd,argv)&&!check&&!continuation)await assertActionHistory(cmd,id,messageText(argv));
  if (cmd === 'preview' && !hasFlag(argv,'--open-only') && !s.observed.includes(id) && t.stop.observeLimit !== undefined && s.observed.length >= t.stop.observeLimit) deny('已到观察上限');
  if (cmd === 'ocr') {
    const image = parseCommandArguments(argv).rest[0]; if (!s.current || !samePath(s.material[s.current]?.image, image)) deny('OCR图片不是当前候选人截图');
  }
  if (cmd === 'decide' && !s.material[id]?.textPath) deny('材料尚未完整解析，不能评估');
  if (t.scope === 'collect' && (t.mode ?? 'screen') === 'screen' && (['accept-resume', 'download-resume'].includes(cmd) || (cmd === 'probe-resume' && hasFlag(argv,'--download'))) && s.decisions[id] !== 'fit') deny('收件/下载前必须完成本人的本轮评估');
  if (cmd === 'greet' && !check) {
    if (s.decisions[id] !== 'fit') deny('尚未评估为 fit，不能联系');
    if (!s.contacts.includes(id) && t.stop.contactLimit !== undefined && s.contacts.length >= t.stop.contactLimit) deny('已到触达上限');
  }
  if (cmd === 'send' && !check) {
    const text = messageText(argv);
    if (!t.messageScript || text !== t.messageScript) deny('消息正文与本轮授权话术不一致');
    if (s.sent.includes(id)) deny('本轮该对象已发送，禁止重复');
    if (t.scope === 'collect') {
      // 收集轮的话术是「求简历」，不是收件后确认：只要本人已完成评估且为 fit 即可发送，
      // 不要求先有下载回执；同一对象本轮仍只能发一次（上方 s.sent 已拦截）。
      if (!s.decisions[id]) deny('先完成本人评估，再发求简历话术');
      if (s.decisions[id] !== 'fit') deny('仅向评估为 fit 的对象发求简历话术');
    }
    else if (s.decisions[id] !== 'fit' || !s.contacts.includes(id)) deny('尚未完成评估和联系，不能发送');
  }
  if (cmd === 'action' && resolveAction(argv) !== 'resume') deny('正式任务 action 只用于查看简历；其他动作使用有对象 ID 的公开入口');
}
export async function assertPermittedPhase(cmd: string, argv: string[]): Promise<void> { if (!phaseStatePath()) return; await evaluate(cmd, argv, await task(), await state()); }
export async function beforePhaseCommand(cmd: string, argv: string[]): Promise<void> {
  if (!phaseStatePath() || ALWAYS.has(cmd) || !getBoundRun() || hasFlag(argv,'--check')) return;
  const s = await state(), id = targetId(argv, s);
  if (sideEffect(cmd,argv)) {
    if (cmd === 'greet' && s.pending?.cmd === 'greet') return;
    const text = messageText(argv);
    const attemptId = await beginAction(cmd, id, text);
    s.pending = { cmd, id, text, ...(attemptId ? { attemptId } : {}) }; await save(s);
  }
}
export async function recordPhaseCommand(cmd: string, argv: string[], output: string): Promise<void> {
  if (!phaseStatePath() || !getBoundRun() || ['phase-set', 'phase-status'].includes(cmd)) return;
  const s = await state(), t = await task(); let result: any;
  try { result = JSON.parse(output); } catch (error) { deny(`命令 ${cmd} 回执不是 JSON，保留未决状态：${String(error)}`); }
  const id = targetId(argv, s);
  if (cmd === 'check' && result === true && sameJobKey(option(argv, '--job'), t.job)) s.jobVerified = true;
  if (cmd === 'flow-pause') s.paused = option(argv, '--reason')!;
  if (cmd === 'flow-resume') { if (s.pending) deny('未决动作尚未核验，不能解除暂停'); s.paused = null; }
  if (cmd === 'check' && result === true && s.pending?.cmd === 'send' && id === s.pending.id && sameJobKey(option(argv, '--job'), t.job) && option(argv, '--text') === s.pending.text) {
    if (s.pending.attemptId) await finishAction(s.pending.attemptId, 'success');
    await recordJournalResult(getBoundRun()!.flowState, id, s.targets.find(x => x.id === id)!.name, 'send', 'success', undefined, { verifiedBy: 'check', text: s.pending.text, job: t.job });
    s.sent.push(s.pending.id); s.pending = null; s.paused = null;
  }
  if (cmd === 'send' && hasFlag(argv,'--check') && result === true && s.pending?.knownNotAttempted && id === s.pending.id && (option(argv, '--text') ?? option(argv, '-t')) === s.pending.text) {
    if ((s.safeRetries[id] ?? 0) >= 1) deny('发送前失败已完成一次核验重试，必须停止');
    s.safeRetries[id] = 1; s.pending = null;
  }
  if (cmd === 'status' && [result.chatFilterJob, result.searchJob, result.recommendJob].some((x: unknown) => typeof x === 'string' && sameJobKey(x as string, t.job))) s.jobVerified = true;
  if (['list', 'recommend', 'search'].includes(cmd) && Array.isArray(result.candidates) && !s.frozen) {
    if (!s.jobVerified) deny('冻结快照前必须核验岗位');
    const field = cmd === 'list' ? 'dataId' : cmd === 'recommend' ? 'geekId' : 'candidateId';
    const targets = result.candidates.map((x: any) => ({ id: x[field], name: x.name }));
    if (targets.some((x: Target) => typeof x.id !== 'string' || !x.id || typeof x.name !== 'string' || !x.name) || new Set(targets.map((x: Target) => x.id)).size !== targets.length) deny('列表回执缺少唯一 ID/姓名');
    s.targets = targets; s.frozen = true;
  }
  if (cmd === 'chat') {
    s.current = id;
    // 小窗凭同一 candidateId 打开/复用，说明该人已经处于沟通过程中：这才是推荐页的联系确认证据。
    const chatOpened = ['embedded-opened', 'embedded-already-open'].includes(result?.status) && result?.identityVerified === true && result?.target?.candidateId === id;
    if (chatOpened && s.pending?.cmd === 'greet' && s.pending.id === id) {
      if (s.pending.attemptId) await finishAction(s.pending.attemptId, 'success');
      s.pending = null;
      if (!s.contacts.includes(id)) s.contacts.push(id);
    }
  }
  if (cmd === 'preview' || (cmd === 'action' && resolveAction(argv) === 'resume')) {
    if (typeof result.path !== 'string' || !result.path) deny('截图回执缺少 path');
    s.current = id; s.material[id] = { image: result.path }; if (!s.observed.includes(id)) s.observed.push(id);
  }
  if (cmd === 'ocr') {
    if (typeof result.textPath !== 'string' || !result.textPath) deny('OCR回执缺少 textPath');
    s.material[s.current!].textPath = result.textPath;
  }
  if (cmd === 'decide') s.decisions[id] = option(argv, '--verdict')!;
  const contactConfirmed = ['contact-confirmed', 'already-contacted'].includes(result.status);
  if (cmd === 'greet' && !hasFlag(argv,'--check') && contactConfirmed && !s.contacts.includes(id)) s.contacts.push(id);
  if (cmd === 'download-resume' || (cmd === 'probe-resume' && hasFlag(argv,'--download'))) {
    // 下载仅接受明确文件证据，探测到“有附件”不等于下载成功。
    const receipt = cmd === 'download-resume' ? result : result.download;
    if(cmd==='probe-resume'&&receipt===null&&result.attachment==='NOT_OBSERVED'){
      if(s.pending?.attemptId)await finishAction(s.pending.attemptId,'not-attempted');s.pending=null;
    }else{
      if(!receipt||typeof receipt.path!=='string'||typeof receipt.bytes!=='number'||receipt.bytes<=0||typeof receipt.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(receipt.sha256))deny('下载回执不完整，保留未决，禁止重放');
      if(typeof receipt.attachmentName!=='string'||!receipt.attachmentName)deny('下载回执缺少实际附件名');
      s.downloads[id]={path:receipt.path,bytes:receipt.bytes,sha256:receipt.sha256,attachmentName:receipt.attachmentName};
      if (!s.downloaded.includes(id)) s.downloaded.push(id);
    }
  }
  if (cmd === 'send' && !hasFlag(argv,'--check')) s.sent.push(id);
  if (!hasFlag(argv,'--check') && !ALWAYS.has(cmd)) {
    if (s.pending?.cmd === cmd && !(cmd === 'greet' && !contactConfirmed)) { if (s.pending.attemptId) await finishAction(s.pending.attemptId, 'success'); s.pending = null; }
    s.successes++; s.failures = 0;
  }
  await save(s);
}
export async function failPhaseCommand(cmd: string, argv: string[], error: unknown): Promise<void> {
  if (!phaseStatePath() || !getBoundRun() || ALWAYS.has(cmd)) return;
  const s = await state(); s.failures++;
  if (s.pending?.attemptId) await finishAction(s.pending.attemptId, error instanceof Error && error.name === 'SendPreconditionError' ? 'not-attempted' : 'unknown');
  if (error instanceof Error && error.name === 'SendPreconditionError' && s.pending) { s.pending.knownNotAttempted = true; if ((s.safeRetries[s.pending.id] ?? 0) >= 1) s.paused = '发送前失败已重试一次，必须停止'; }
  else s.paused = String(error);
  await save(s);
}
export async function phaseStatus(): Promise<unknown> {
  if (!phaseStatePath()) deny('未设置 BOSS_PHASE_STATE'); const s = await state(), t = await task();
  const allowedActions: string[] = [], blockedActions: Record<string, string> = {};
  const declared = t.phases?.find(p => p.name === s.phase)?.allowed;
  const candidates = Object.keys(declared ?? (await loadPermit(t.permit)).allowed);
  const representative = s.current ?? s.targets[0]?.id ?? '';
  for (const cmd of candidates) {
    try {
      const argv = cmd === 'ocr' ? [cmd, s.material[representative]?.image ?? '', '--json'] : cmd === 'action' ? [cmd, 'resume', '--json'] : [cmd, '--candidate-id', representative, '--data-id', representative, '--text', t.messageScript ?? '', '--json'];
      await assertPermittedCommand(cmd, argv); await evaluate(cmd, argv, t, s); allowedActions.push(cmd);
    } catch (error) { blockedActions[cmd] = String(error); }
  }
  return { phase: s.phase, runId: s.runId, jobVerified: s.jobVerified, scopeFrozen: s.frozen, current: s.current, targets: s.targets, pending: s.pending, paused: s.paused, allowedActions, blockedActions, suggestedAction: allowedActions[0] ?? null, parameterRules: '携带冻结范围内的同人ID；消息正文必须等于task.messageScript。允许集不替代实际参数校验。' };
}
