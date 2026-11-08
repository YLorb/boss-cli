// 命令白名单审批：单一入口，统一管理本轮允许的 boss-cli 动作。
// 仅在 BOSS_RUN_PERMIT 设置时启用；未设置则行为不变。
// 这是编排级收紧，不是系统级权限隔离。
import { readFile } from 'node:fs/promises';
import type { ChatPageAction } from '../toolset/action.js';

export type PermitDoc = {
  schemaVersion: 1;
  roundId?: string;
  job?: string;
  entry?: 'collect' | 'recommend' | 'search' | 'view-only';
  allowed: Record<string, string[]>;
};

/** 只读安全/诊断命令，永不吞掉副作用动作，无需在 permit 中声明。 */
export const ALWAYS_ALLOWED = new Set([
  'status', 'check', 'search-sidebar', '--check-login', 'flow-status', 'spec-list', 'task-check', 'task-init',
  'help', 'version', 'version-check',
]);

export class PermitDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermitDeniedError';
  }
}

export function permitFilePath(): string | null {
  const raw = process.env.BOSS_RUN_PERMIT?.trim();
  return raw ? raw : null;
}

export function isPermitEnabled(): boolean {
  return permitFilePath() !== null;
}

function validatePermit(value: unknown): asserts value is PermitDoc {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PermitDeniedError('permit 必须是对象。');
  }
  const p = value as Partial<PermitDoc>;
  if (p.schemaVersion !== 1) throw new PermitDeniedError('permit schemaVersion 必须为 1。');
  if (!p.allowed || typeof p.allowed !== 'object' || Array.isArray(p.allowed)) {
    throw new PermitDeniedError('permit.allowed 必须是非空对象。');
  }
  for (const [cmd, variants] of Object.entries(p.allowed)) {
    if (!cmd.trim()) throw new PermitDeniedError('permit.allowed 的命令名不能为空。');
    if (!Array.isArray(variants) || variants.some(v => typeof v !== 'string')) {
      throw new PermitDeniedError(`permit.allowed.${cmd} 必须是字符串数组。`);
    }
  }
  if (p.entry !== undefined && !['collect', 'recommend', 'search', 'view-only'].includes(p.entry)) {
    throw new PermitDeniedError('permit.entry 必须是 collect/recommend/search/view-only。');
  }
}

export async function loadPermit(path: string): Promise<PermitDoc> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new PermitDeniedError(`permit 文件不存在：${path}`);
    }
    throw new PermitDeniedError(`permit 文件不可读：${path}；${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const value: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
    validatePermit(value);
    return value as PermitDoc;
  } catch (error) {
    if (error instanceof PermitDeniedError) throw error;
    throw new PermitDeniedError(`permit 文件无效：${path}；${error instanceof Error ? error.message : String(error)}`);
  }
}

export function isPermitDenied(error: unknown): boolean {
  return error instanceof Error && error.name === 'PermitDeniedError';
}

const ACTION_MAP: Record<string, ChatPageAction> = {
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

/**
 * 与 CLI 的 action 分支一致地解析实际子动作：rest[0] ?? opts.type ?? opts.action，
 * 经别名映射规范化。无法解析返回 null（由调用方决定拒绝或报错）。
 * argv 为完整参数（含命令名 'action'），与 cliRouter 中 action 分支的解析保持同一实现。
 */
export function resolveAction(argv: string[]): ChatPageAction | null {
  const tail = argv.slice(1);
  const rest: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < tail.length; i++) {
    const a = tail[i];
    if (a === '--') {
      rest.push(...tail.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        opts[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = tail[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        opts[key] = next;
        i += 1;
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      const short = a.slice(1);
      const next = tail[i + 1];
      if (short === 't' && next !== undefined && !next.startsWith('-')) {
        opts.t = next;
        i += 1;
        continue;
      }
      if (!/^\d/.test(short)) continue;
    }
    rest.push(a);
  }
  const raw = (rest[0] ?? opts.type ?? opts.action ?? '').trim().toLowerCase();
  return ACTION_MAP[raw] ?? null;
}

/** 唯一审批入口：动作执行前调用。失真即拒绝（fail-closed），不静默放行。 */
export async function assertPermittedCommand(normalizedCmd: string, argv: string[]): Promise<void> {
  const file = permitFilePath();
  if (!file) return;
  if (ALWAYS_ALLOWED.has(normalizedCmd)) return;
  const permit = await loadPermit(file);
  const variants = permit.allowed[normalizedCmd];
  if (variants === undefined) {
    throw new PermitDeniedError(`命令未授权：${normalizedCmd}；请在 permit.allowed 中声明本轮允许的动作。`);
  }
  if (variants.length === 0) return; // 命令名级放行
  if (normalizedCmd === 'action') {
    const action = resolveAction(argv);
    if (action !== null && variants.includes(action)) {
      return;
    }
    throw new PermitDeniedError(`action 的子动作未授权：${action ?? '(无法解析)'}；本轮允许：${variants.join(', ')}。`);
  }
  throw new PermitDeniedError(`命令 ${normalizedCmd} 使用了变体白名单，但当前仅 action 支持子动作粒度；请改用空数组放行命令名。`);
}