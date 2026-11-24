import assert from 'node:assert/strict';
import { test, mock, beforeEach, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'boss-simple-routing-'));
process.env.BOSS_APP_HOME = directory;
let versionFailure = false;
let versionChecks = 0;
let calls = [];
let index = 0;
mock.module('../dist/cli/skill_compatibility.js', {namedExports:{
  requireSkillCompatibility: async () => {versionChecks++;if(versionFailure)throw new Error('VERSION_MISMATCH');},
  checkSkillCompatibility: async () => ({compatible:!versionFailure}),
  splitVersionConfirmation: argv => ({argv,confirmation:undefined}),
}});
const checkTools = await import('../dist/toolset/check.js');
mock.module('../dist/toolset/check.js', {namedExports:{...checkTools,
  runStatus: async () => {calls.push('status');return '{"pageType":"search"}';},
  runCheck: async () => {calls.push('check');return 'true';},
}});
const worker = await import('../dist/cli/command_process.js');
const workerFile = join(directory, 'timeout-worker.mjs');
await writeFile(workerFile, "setInterval(() => {}, 1000); process.on('disconnect', () => process.exit(1));");
mock.module('../dist/cli/command_process.js', {namedExports:{...worker,
  runCommandProcess:async argv=>{calls.push(argv[0]);return worker.runCommandProcess(argv,200,pathToFileURL(workerFile));},
}});
const {runCli} = await import('../dist/cli/cliRouter.js');
const {parseStartupArguments,assertFormalCommand} = await import('../dist/cli/formal_arguments.js');
const {readCommandReceipts} = await import('../dist/common/action_history.js');
let resultsFile;
beforeEach(async()=>{
  versionFailure=false;versionChecks=0;calls=[];process.exitCode=0;
  resultsFile=join(directory,`${++index}.jsonl`);
  const taskFile=join(directory,`${index}.json`);
  await writeFile(taskFile,JSON.stringify({job:'测试岗位',resultsFile}));
  process.env.BOSS_TASK_CONFIG=taskFile;
});
after(async()=>{process.exitCode=0;await rm(directory,{recursive:true,force:true});});

test('public status runs immediately after version verification and saves its result',async()=>{
  await runCli(['status','--json']);
  assert.equal(versionChecks,1);
  assert.deepEqual(calls,['status']);
  assert.equal((await readCommandReceipts(resultsFile)).at(-1).result.pageType,'search');
});

test('an incompatible version blocks the public tool before page actions',async()=>{
  versionFailure=true;
  await runCli(['status','--json']);
  assert.equal(process.exitCode,1);
  assert.deepEqual(calls,[]);
  await assert.rejects(readFile(resultsFile),{code:'ENOENT'});
  process.exitCode=0;
});

test('attachment worker failures leave a durable parent-command receipt',async()=>{
  await runCli(['download-resume','测试甲','--data-id','conversation-1','--json']);
  assert.equal(process.exitCode,1);
  const rows=await readCommandReceipts(resultsFile);
  assert.equal(rows.length,1);
  assert.equal(rows[0].error.name,'AttachmentTimeoutError');
  process.exitCode=0;
});

test('optional task-check reads JSON without initializing state',async()=>{
  await runCli(['task-check','--json']);
  assert.deepEqual(calls,[]);
  assert.equal(versionChecks,0);
  await assert.rejects(readFile(join(directory,'runs','current.json')),{code:'ENOENT'});
});

test('argument validation remains available independently of task initialization',()=>{
  assert.throws(()=>parseStartupArguments(['version-check','--unknown']),/不支持参数/);
  assert.throws(()=>assertFormalCommand(['send','--embedded','--json']),/标准用法/);
  assertFormalCommand(['decide','--candidate-id','candidate-1','--verdict','fit','--json']);
});
