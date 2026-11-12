import { isAbsolute } from 'node:path';
import { CliError } from './arguments.js';
import {
  PREFLIGHT_ARGV, findCommandSpec, requiredFormalOptions,
  type CommandForm, type CommandOption, type ValueSpec,
} from './command_spec.js';

class FormalUsageError extends CliError {
  constructor(message: string) {
    super(message);
    this.name = 'FormalUsageError';
  }
}

function matchesValue(value: string, spec: ValueSpec): boolean {
  if (!spec.allowEmpty && !value.trim()) return false;
  if (spec.choices && !spec.choices.includes(value)) return false;
  if (spec.absolutePath && !isAbsolute(value)) return false;
  if (spec.maxLength !== undefined && value.trim().length > spec.maxLength) return false;
  if (spec.integer) {
    const [min, max] = spec.integer;
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) return false;
  }
  return true;
}

function matchesForm(
  form: CommandForm,
  required: readonly CommandOption[],
  options: ReadonlyMap<string, string[]>,
  positional: readonly string[],
): boolean {
  if (form.optionalCommandName ? positional.length > 1 : positional.length !== (form.positional ? 1 : 0)) return false;
  if (form.positional && !matchesValue(positional[0]!, form.positional)) return false;
  if (form.minOptions !== undefined && options.size - Number(options.has('--json')) < form.minOptions) return false;
  if (required.some(option => !options.has(option.name))) return false;
  const allowed = [...required, ...form.optional];
  for (const [key, values] of options) {
    const rule = allowed.find(option => option.name === key);
    if (!rule || (!rule.repeatable && values.length > 1)) return false;
    if (rule.conflictsWith && options.has(rule.conflictsWith)) return false;
    if (rule.requires && !options.has(rule.requires)) return false;
    if (rule.value && !values.every(value => matchesValue(value, rule.value!))) return false;
  }
  return true;
}

function parseDeclaredArguments(
  argv: readonly string[],
  forms: { form: CommandForm; required: readonly CommandOption[] }[],
  deny: (reason: string) => never,
) {
  const declared = new Map<string, CommandOption>();
  for (const { form, required } of forms) {
    for (const option of [...required, ...form.optional]) declared.set(option.name, option);
  }
  const options = new Map<string, string[]>();
  const positional: string[] = [];
  for (let index = 1; index < argv.length; index++) {
    const token = argv[index]!;
    const rule = declared.get(token);
    if (!token.startsWith('-') ||
        (!rule && forms.some(({ form }) => form.optionalCommandName) && findCommandSpec(token))) {
      positional.push(token);
      continue;
    }
    if (!rule) return deny(`不支持参数 ${token.split('=')[0]}`);
    const previous = options.get(token);
    if (previous && !rule.repeatable) deny(`参数 ${token} 不可重复`);
    const value = rule.value ? argv[++index] : '';
    if (value === undefined || value.startsWith('-')) return deny(`参数 ${token} 缺少值`);
    options.set(token, [...(previous ?? []), value]);
  }
  if (forms.filter(({ form, required }) => matchesForm(form, required, options, positional)).length !== 1) {
    deny('参数组合不符合该命令的标准用法');
  }
  return { options, positional };
}

export function parseStartupArguments(argv: readonly string[]) {
  const command = argv[0]!;
  const form = findCommandSpec(command)?.startupForm;
  if (!form) return undefined;
  return parseDeclaredArguments(argv, [{ form, required: form.required }], reason => {
    const error = new CliError(`${reason}。命令用法见 boss commands ${command} --json`);
    error.name = 'StartupUsageError';
    throw error;
  });
}

/** Validate the exact argv before permit checks, intents, subprocesses or page actions. */
export function assertFormalCommand(argv: readonly string[], command = argv[0]!): void {
  const spec = findCommandSpec(command);
  if (!spec?.formalForms?.length) throw new FormalUsageError('该命令未声明正式任务用法');
  const deny = (reason: string): never => {
    throw new FormalUsageError(`${reason}。正式任务用法见 boss commands ${command} --json`);
  };
  if (argv[0] !== command) deny(`正式任务须使用命令名 ${command}`);
  parseDeclaredArguments(argv, spec.formalForms.map(form => ({ form, required: requiredFormalOptions(spec, form) })), deny);
}

const TASK_SETUP_COMMANDS = new Set(['login', '--check-login', 'status', 'check', 'spec-list']);

export function assertTaskInvocation(argv: readonly string[], command: string, bound: boolean, configured: boolean): void {
  if (!bound && !configured) return;
  if (!bound && !TASK_SETUP_COMMANDS.has(command)) {
    const error = new CliError(`正式任务尚未初始化：请先执行 boss ${PREFLIGHT_ARGV.join(' ')}，预检通过后按回执初始化`);
    error.name = 'TaskInitRequiredError';
    throw error;
  }
  assertFormalCommand(argv, command);
}
