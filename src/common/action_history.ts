import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { APP_HOME } from '../config.js';
import { parseCommandArguments } from '../cli/arguments.js';
import { readTaskConfig, taskResultsFile, type TaskConfig } from '../cli/task_config.js';

type Outcome = 'intent' | 'success' | 'unknown' | 'not-attempted' | 'failed';
export type CommandReceipt = {
  attemptId: string;
  at: string;
  command: string;
  job: string | null;
  id: string;
  name: string;
  text: string;
  outcome: Outcome;
  argv: string[];
  result?: unknown;
  error?: { name: string; message: string; details?: unknown };
};

export async function readCommandReceipts(file: string): Promise<CommandReceipt[]> {
  let source: string;
  try { source = await readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return source.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    let row: CommandReceipt;
    try { row = JSON.parse(line); }
    catch (error) { throw new Error(`结果记录损坏：${file} 第 ${index + 1} 行；${String(error)}`); }
    if (!row || typeof row.attemptId !== 'string' || !row.attemptId || typeof row.command !== 'string' ||
        typeof row.id !== 'string' || typeof row.text !== 'string' || !Number.isFinite(Date.parse(row.at)) ||
        !['intent', 'success', 'unknown', 'not-attempted', 'failed'].includes(row.outcome)) {
      throw new Error(`结果记录结构无效：${file} 第 ${index + 1} 行`);
    }
    return row;
  });
}

async function appendReceipt(file: string, receipt: CommandReceipt): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const handle = await open(file, 'a');
  try {
    await handle.writeFile(JSON.stringify(receipt) + '\n', 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
}

/** Existing per-job contacts continue to participate in duplicate detection. */
async function legacyHistory(task: TaskConfig | null): Promise<CommandReceipt[]> {
  if (!task) return [];
  const file = join(task.ledgerDir ?? join(APP_HOME, 'ledgers'), createHash('sha256').update(task.job).digest('hex') + '.actions.json');
  let value: any;
  try { value = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`历史动作记录不可读：${file}；${String(error)}`);
  }
  if (value?.version !== 1 || !Array.isArray(value.entries)) throw new Error(`历史动作记录结构无效：${file}`);
  return value.entries.map((entry: any) => {
    if (!entry || typeof entry.attemptId !== 'string' || typeof entry.cmd !== 'string' ||
        typeof entry.id !== 'string' || typeof entry.text !== 'string' ||
        !['intent', 'success', 'unknown', 'not-attempted'].includes(entry.outcome)) {
      throw new Error(`历史动作记录条目无效：${file}`);
    }
    return { ...entry, command: entry.cmd, job: task.job, argv: [], name: '' };
  });
}

function latestAttempts(rows: CommandReceipt[]): CommandReceipt[] {
  const latest = new Map<string, CommandReceipt>();
  for (const row of rows) latest.set(row.attemptId, row);
  return [...latest.values()];
}

function messageText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

export async function withCommandReceipt(argv: string[], execute: () => Promise<string>): Promise<string> {
  // Credentials must never be copied into a result log.
  if (argv[0] === '_baidu-keys') return execute();
  const task = await readTaskConfig();
  const file = taskResultsFile(task);
  const { opts, flags, rest, json } = parseCommandArguments(argv);
  const command = argv[0];
  const id = opts['candidate-id'] ?? opts['data-id'] ?? '';
  const text = messageText(opts.text ?? opts.t ?? '');
  const continuation = command === 'greet' && !flags.has('check') && (flags.has('continue-chat') || flags.has('confirm-contact') ||
    opts['select-job'] !== undefined || opts['contact-mode'] !== undefined);
  const contact = command === 'greet' && !flags.has('check') && !continuation;
  const sending = command === 'send' && !flags.has('check');
  let history: CommandReceipt[] = [];
  if (id && (contact || sending || continuation || ['chat', 'check', 'dismiss-contact-notice'].includes(command))) {
    history = latestAttempts([...(await legacyHistory(task)), ...(await readCommandReceipts(file))]
      .filter(row => !task || row.job === task.job));
  }
  if (id && (contact || sending)) {
    for (const row of history) {
      if (row.id !== id || !['greet', 'send'].includes(row.command) ||
          row.argv?.includes('--check') || row.argv?.includes('--continue-chat')) continue;
      if (row.outcome === 'intent' || row.outcome === 'unknown') {
        throw new Error(`历史动作结果未决：${row.command}/${id}；先核验，禁止重放。记录：${file}`);
      }
      if (row.outcome === 'success' && row.command === command && (contact || messageText(row.text) === text)) {
        throw new Error(`历史 ${command} 已成功，禁止重复：${id}；记录：${file}`);
      }
    }
  }
  const receipt: CommandReceipt = {
    attemptId: randomUUID(), at: new Date().toISOString(), command, job: task?.job ?? opts.job ?? null,
    id, name: opts.name ?? rest.join(' '), text, outcome: 'intent', argv,
  };
  if (contact || sending || (continuation && !flags.has('continue-chat'))) {
    await appendReceipt(file, receipt);
  }
  let output: string;
  let result: any;
  try {
    output = await execute();
    result = json ? JSON.parse(output) : output;
  }
  catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const outcome = ['SendPreconditionError', 'CliError'].includes(failure.name) ? 'not-attempted' : contact || sending || continuation ? 'unknown' : 'failed';
    await appendReceipt(file, { ...receipt, at: new Date().toISOString(), outcome,
      error: { name: failure.name, message: failure.message, ...('details' in failure ? { details: failure.details } : {}) } });
    throw error;
  }
  const confirmedContact = command === 'greet' && ['contact-confirmed', 'already-contacted'].includes(result?.status);
  const unconfirmedContact = contact && !confirmedContact;
  const outcome = unconfirmedContact || (continuation && !flags.has('continue-chat') && !confirmedContact) ? 'unknown' : 'success';
  await appendReceipt(file, { ...receipt, at: new Date().toISOString(), outcome, result });
  const chatConfirmed = command === 'chat' && ['embedded-opened', 'embedded-already-open'].includes(result?.status) &&
    result?.identityVerified === true && result?.target?.candidateId === id;
  const noticeConfirmed = command === 'dismiss-contact-notice' && result?.status === 'contact-notice-dismissed';
  for (const previous of history) {
    if (previous.id !== id || !['intent', 'unknown'].includes(previous.outcome)) continue;
    const contactVerified = previous.command === 'greet' && (confirmedContact || chatConfirmed || noticeConfirmed);
    const previousJob = previous.argv?.length ? parseCommandArguments(previous.argv).opts.job : undefined;
    const sendVerified = previous.command === 'send' && command === 'check' && result === true &&
      opts.state === 'message-visible' && messageText(opts.text ?? '') === messageText(previous.text) &&
      (previousJob === undefined || opts.job === previousJob);
    if (contactVerified || sendVerified) {
      await appendReceipt(file, { ...previous, at: new Date().toISOString(), outcome: 'success', result: { verifiedBy: command, receipt: result } });
    }
  }
  return output;
}
