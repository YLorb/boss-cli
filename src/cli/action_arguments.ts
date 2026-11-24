import { parseCommandArguments } from './arguments.js';
import type { ChatPageAction } from '../toolset/action.js';

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
  const { rest, opts } = parseCommandArguments(argv);
  const raw = (rest[0] ?? opts.type ?? opts.action ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ACTION_MAP,raw) ? ACTION_MAP[raw] : null;
}
