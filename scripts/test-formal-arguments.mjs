import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { resolve } from 'node:path';

const run = { scope: 'collect', job: '示例岗位', task: { mode: 'collect-only' } };
let bound = run;
let permitChecks = 0;
let workerCalls = 0;
let sessions = 0;
const permitReached = new Error('SYNTHETIC_PERMIT_REACHED');

mock.module('../dist/cli/run_state.js', { namedExports: {
  activateRunBindings: async () => bound,
  getBoundRun: () => bound,
  initRun: async () => { throw Error('Unexpected task initialization'); },
} });

const permit = await import('../dist/cli/permit.js');
mock.module('../dist/cli/permit.js', { namedExports: {
  ...permit,
  assertPermittedCommand: async () => { permitChecks++; throw permitReached; },
} });

const commandProcess = await import('../dist/cli/command_process.js');
mock.module('../dist/cli/command_process.js', { namedExports: {
  ...commandProcess,
  runCommandProcess: async () => { workerCalls++; return '{}'; },
} });

mock.module('../dist/collection/session.js', { namedExports: {
  runCollectionSession: async () => { sessions++; },
  syncCollectionReceipt: async () => { throw Error('Unexpected attachment sync'); },
} });

const { executeCommand, runCli, runOneCommand } = await import('../dist/cli/cliRouter.js');
const { assertFormalCommand, parseStartupArguments } = await import('../dist/cli/formal_arguments.js');
const { COMMAND_SPECS, describeCommand, findCommandSpec } = await import('../dist/cli/command_spec.js');
const { parseCommandArguments } = await import('../dist/cli/arguments.js');
const { jsonError } = await import('../dist/cli/output.js');

const formalError = { name: 'FormalUsageError' };
const send = ['send', '--name', '合成候选人', '--data-id', 'test-id', '--text', '已确认正文', '--json'];

function sampleValue(rule) {
  if (rule.choices) return rule.choices[0];
  if (rule.integer) return String(rule.integer[0]);
  if (rule.absolutePath) return resolve('synthetic image.png');
  return '合成参数';
}

test('every registered formal variant can produce valid argv from its public specification', () => {
  for (const entry of COMMAND_SPECS.filter(spec => spec.formalForms)) {
    const spec = describeCommand(entry);
    for (const form of spec.formalForms) {
      const argv = [spec.name];
      if (form.positional) argv.push(sampleValue(form.positional));
      const args = [...form.required, ...form.optional.slice(0, form.minOptions ?? 0)];
      for (const option of args) {
        argv.push(option.name);
        if (option.value) argv.push(sampleValue(option.value));
      }
      assert.doesNotThrow(() => assertFormalCommand(argv), `${spec.name}/${form.id}`);
    }
    assert.equal(spec.formalUsage.length, spec.formalForms.length);
  }
});

test('startup forms drive catalog usage and reject invalid argv before execution', async t => {
  const stdout = t.mock.method(console, 'log', () => {});
  const originalExit = process.exitCode;
  try {
    await runOneCommand(['commands', '--json']);
    const { commands } = JSON.parse(stdout.mock.calls.at(-1).arguments[0]);
    const startup = commands.filter(command => command.startupForm);
    assert.deepEqual(startup.map(command => command.name).sort(),
      ['browser-session', 'commands', 'preflight', 'task-check', 'task-init', 'version-check']);
    for (const command of startup) {
      const { required, optional } = command.startupForm;
      const argv = [command.name, ...required.map(option => option.name)];
      assert.doesNotThrow(() => parseStartupArguments(argv));
      assert.doesNotThrow(() => parseStartupArguments([...argv, ...optional.map(option => option.name)]));
      await runOneCommand([command.name, '--json', '--json']);
      const { error } = JSON.parse(stdout.mock.calls.at(-1).arguments[0]);
      assert.equal(error.code, 'STARTUP_USAGE_INVALID', command.name);
      assert.equal(error.usage, command.usage);
      assert.deepEqual(error.next.argv, ['commands', command.name, '--json']);
    }
    for (const command of ['browser-session', 'preflight']) {
      assert.throws(() => parseStartupArguments([command]), { name: 'StartupUsageError' });
    }
    await runOneCommand(['commands', '--check-login', '--json']);
    assert.equal(JSON.parse(stdout.mock.calls.at(-1).arguments[0]).command.name, '--check-login');
    assert.throws(() => parseStartupArguments(['commands', '--json', 'preflight', 'task-init']),
      { name: 'StartupUsageError' });
  } finally {
    process.exitCode = originalExit;
  }
});

test('bound commands reject alternate, duplicate, conflicting or incomplete arguments before permissions', async () => {
  const bad = [
    ['send-message', ...send.slice(1)],
    [...send, '--text', '另一段'],
    [...send, '--json'],
    [...send, '--request-resume'],
    [...send.slice(0, -3), '-t', '正文', '--json'],
    [...send.slice(0, -3), '--text=正文', '--json'],
    [...send.slice(0, -3), '--text', '--check', '--json'],
    [...send, '--', '--check'],
    send.slice(0, -1),
    ['chat', '--index', '1', '--json'],
    ['chat', '--embedded', '--close', '--candidate-id', 'id', '--job', '岗位', '--json'],
    ['chat', '姓名', '--embedded', '--check', '--close', '--candidate-id', 'id', '--job', '岗位', '--json'],
    ['check', '--data-id', 'id', '--json'],
    ['check', '--json'],
    ['greet', '姓名', '--candidate-id', 'id', '--confirm-contact', '--json'],
    ['recommend', '岗位', '--check-job', '--json'],
    ['search-more', '--max-scrolls', '21', '--max-candidates', '10', '--json'],
    ['switch-job', '--list', '--job', '岗位', '--json'],
    ['action', 'not-fit', '--json'],
    ['ocr', 'relative.png', '--json'],
    ['deep-search', '--core', '关键词', '--clear-core', '--json'],
  ];
  const before = permitChecks;
  for (const argv of bad) await assert.rejects(executeCommand(argv), formalError, argv.join(' '));
  assert.equal(permitChecks, before);
  await assert.rejects(executeCommand(send), error => error === permitReached);
  assert.equal(permitChecks, before + 1);
});

test('phase parsing follows the declared flag type even when a name follows a switch', () => {
  const argv = ['chat', '--embedded', '实际姓名', '--close', '--candidate-id', 'id', '--job', '岗位', '--json'];
  assert.doesNotThrow(() => assertFormalCommand(argv));
  const args = parseCommandArguments(argv);
  assert.deepEqual(args.rest, ['实际姓名']);
  assert.ok(args.flags.has('embedded'));
  assert.equal(args.opts['candidate-id'], 'id');
  assert.doesNotThrow(() => assertFormalCommand(['check', '--keyword', '', '--json']));
  assert.doesNotThrow(() => assertFormalCommand(['deep-search', '--core', 'Go', '--core', 'SQL', '--json']));
});

test('attachment parent and collection entry validate before worker spawn or session start', async t => {
  const stdout = t.mock.method(console, 'log', () => {});
  const originalExit = process.exitCode;
  try {
    await runOneCommand(['download-resume', '姓名', '--json']);
    assert.equal(workerCalls, 0);
    const failure = JSON.parse(stdout.mock.calls.at(-1).arguments[0]);
    assert.equal(failure.error.code, 'FORMAL_USAGE_INVALID');
    await runOneCommand(['download-resume', '姓名', '--data-id', 'id', '--json']);
    assert.equal(workerCalls, 1);
  } finally {
    process.exitCode = originalExit;
  }
  await assert.rejects(runCli(['collect', '--job', run.job, '--job', run.job]), formalError);
  await assert.rejects(runCli(['collect', '--job', run.job, '--mode', 'collect-only']), error => error === permitReached);
  assert.equal(sessions, 0);
});

test('manual mode preserves legacy names while command lookup exposes formal errors and variants', async t => {
  bound = null;
  try {
    await assert.rejects(executeCommand(['send-message', '-t', '正文']), error => error === permitReached);
  } finally {
    bound = run;
  }
  const stdout = t.mock.method(console, 'log', () => {});
  await runOneCommand(['commands', 'send', '--json']);
  const { command } = JSON.parse(stdout.mock.calls[0].arguments[0]);
  assert.deepEqual(command, JSON.parse(JSON.stringify(describeCommand(findCommandSpec('send')))));
  await assert.rejects(executeCommand(['send', '-t', '正文', '--json']), error => {
    const failure = JSON.parse(jsonError('send', error)).error;
    assert.deepEqual(failure.usage, command.formalUsage);
    assert.deepEqual(failure.next.argv, ['commands', 'send', '--json']);
    return true;
  });
});

test('configured tasks cannot fall through to manual execution before initialization', async t => {
  const original = process.env.BOSS_TASK_CONFIG;
  const exitCode = process.exitCode;
  const stdout = t.mock.method(console, 'log', () => {});
  const before = { permitChecks, workerCalls, sessions };
  bound = null;
  process.env.BOSS_TASK_CONFIG = resolve('synthetic-task.json');
  try {
    await assert.rejects(executeCommand(send), { name: 'TaskInitRequiredError' });
    await assert.rejects(runCli(['collect', '--job', run.job]), { name: 'TaskInitRequiredError' });
    await runOneCommand(['download-resume', '姓名', '--data-id', 'id', '--json']);
    const error = JSON.parse(stdout.mock.calls.at(-1).arguments[0]).error;
    assert.equal(error.code, 'TASK_INIT_REQUIRED');
    assert.deepEqual(error.next.argv, ['preflight', '--json']);
    assert.deepEqual({ permitChecks, workerCalls, sessions }, before);

    await assert.rejects(executeCommand(['status', '--json']), failure => failure === permitReached);
    await assert.rejects(executeCommand(['status', '--unknown', '--json']), formalError);
  } finally {
    bound = run;
    process.exitCode = exitCode;
    if (original === undefined) delete process.env.BOSS_TASK_CONFIG;
    else process.env.BOSS_TASK_CONFIG = original;
  }
});
