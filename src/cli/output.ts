import { PREFLIGHT_ARGV, commandUsage, findCommandSpec, formalUsage } from './command_spec.js';
import { ChatSearchFailure } from '../common/chat_search_failure.js';
import { EmbeddedSendUnconfirmedError } from '../common/embedded_send_failure.js';

/** --json is a boolean output flag; tokens after -- remain literal arguments. */
export function splitJsonFlag(argv: string[]): { args: string[]; json: boolean } {
  const args: string[] = [];
  let json = false;
  let literal = false;
  for (const token of argv) {
    if (token === '--') literal = true;
    if (!literal && token === '--json') json = true;
    else args.push(token);
  }
  return { args, json };
}

export function jsonError(command: string, error: unknown): string {
  const spec = findCommandSpec(command);
  const formal = error instanceof Error && error.name === 'FormalUsageError';
  const startup = error instanceof Error && error.name === 'StartupUsageError';
  const needsInit = error instanceof Error && error.name === 'TaskInitRequiredError';
  const usage = spec && (formal ? formalUsage(spec)
    : startup || (error instanceof Error && error.name === 'CliError') ? commandUsage(spec) : undefined);
  return JSON.stringify({ ok: false, command, error: {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    ...(usage ? { usage } : {}),
    ...(formal || startup ? {
      code: formal ? 'FORMAL_USAGE_INVALID' : 'STARTUP_USAGE_INVALID',
      ...(spec ? { next: { argv: ['commands', command, '--json'] } } : {}),
    } : {}),
    ...(needsInit ? { code: 'TASK_INIT_REQUIRED', next: { argv: PREFLIGHT_ARGV } } : {}),
    ...(error instanceof ChatSearchFailure || error instanceof EmbeddedSendUnconfirmedError ? { details: error.details } : {}),
  } });
}
