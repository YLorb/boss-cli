import assert from 'node:assert/strict';
import { test, beforeEach, after } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const directory = await mkdtemp(join(tmpdir(), 'boss-simple-workflow-'));
process.env.BOSS_APP_HOME = join(directory, 'home');
const { withCommandReceipt, readCommandReceipts } = await import('../dist/common/action_history.js');
const { checkTaskConfig, readTaskConfig } = await import('../dist/cli/task_config.js');
const { COMMAND_SPECS } = await import('../dist/cli/command_spec.js');
let index = 0;
let task;
let taskFile;
beforeEach(async () => {
  const current = join(directory, String(++index));
  await mkdir(current);
  task = {job:'测试岗位', scope:'search', resultsFile:join(current,'results.jsonl'), ledgerDir:join(current,'ledgers')};
  taskFile = join(current, 'task.json');
  await writeFile(taskFile, JSON.stringify(task));
  process.env.BOSS_TASK_CONFIG = taskFile;
});
after(() => rm(directory, {recursive:true, force:true}));
const send = (text = '完整介绍') => ['send','--embedded','--name','测试甲','--candidate-id','candidate-1','--job','测试岗位','--text',text,'--json'];
const greet = ['greet','测试甲','--candidate-id','candidate-1','--json'];
const contactResult = () => JSON.stringify({status:'contact-confirmed',candidateId:'candidate-1',identityVerified:true});
const sentResult = () => JSON.stringify({status:'message-visible',sent:true});

test('one task JSON accepts Agent instructions and has no initialization or expiry gate', async () => {
  task.instructions = '逐人处理并保存结果';
  task.stop = {deadline:'2000-01-01T00:00:00Z',observeLimit:1};
  await writeFile(taskFile, JSON.stringify(task));
  assert.equal((await checkTaskConfig()).task.instructions, task.instructions);
  assert.equal(await withCommandReceipt(['status','--json'], async () => '{}'), '{}');
  assert.equal((await readCommandReceipts(task.resultsFile)).length, 1);
  const names = COMMAND_SPECS.map(command => command.name);
  for (const retired of ['task-init','preflight','phase-set','phase-status','flow-status','flow-pause','flow-resume']) {
    assert.equal(names.includes(retired), false, retired);
  }
});

test('old binding environment and damaged current pointer do not block ordinary commands', async () => {
  await mkdir(join(process.env.BOSS_APP_HOME,'runs'), {recursive:true});
  await writeFile(join(process.env.BOSS_APP_HOME,'runs','current.json'), 'broken historical state');
  process.env.BOSS_RUN_ID = 'expired-run';
  process.env.BOSS_RUN_PERMIT = 'missing-permit';
  process.env.BOSS_PHASE_STATE = 'missing-phase';
  process.env.BOSS_FLOW_STATE = 'missing-flow';
  const {executeCommand} = await import('../dist/cli/cliRouter.js');
  const output = JSON.parse(await executeCommand(['decide','--candidate-id','candidate-1','--verdict','fit','--json']));
  assert.equal(output.verdict, 'fit');
  assert.equal((await readCommandReceipts(task.resultsFile)).at(-1).result.verdict, 'fit');
});

test('contact intent is durable before clicking and the exact result is saved', async () => {
  const output = await withCommandReceipt(greet, async () => {
    const rows = await readCommandReceipts(task.resultsFile);
    assert.equal(rows.at(-1).outcome, 'intent');
    return contactResult();
  });
  assert.deepEqual((await readCommandReceipts(task.resultsFile)).at(-1).result, JSON.parse(output));
});

test('successful contact is protected across task edits and a new invocation', async () => {
  await withCommandReceipt(greet, async () => contactResult());
  task.instructions = '恢复后继续';
  await writeFile(taskFile, JSON.stringify(task));
  await assert.rejects(withCommandReceipt(greet, async () => assert.fail('duplicate clicked')), /已成功/);
});

test('read-only greet and send prechecks do not consume the actual action', async () => {
  await withCommandReceipt([...greet.slice(0,-1),'--check','--json'], async () => 'true');
  await withCommandReceipt(greet, async () => contactResult());
  await withCommandReceipt([...send().slice(0,-1),'--check','--json'], async () => 'true');
  await withCommandReceipt(send(), async () => sentResult());
  await assert.rejects(withCommandReceipt(send(), async () => assert.fail()), /已成功/);
});

test('a clicked recommendation stays unconfirmed until the same-person chat receipt', async () => {
  await withCommandReceipt(greet, async () => JSON.stringify({status:'clicked',identityVerified:true,candidateId:'candidate-1'}));
  await assert.rejects(withCommandReceipt(send(), async () => assert.fail('unconfirmed contact')), /未决/);
  await withCommandReceipt(['chat','测试甲','--recommend','--open','--candidate-id','candidate-1','--job','测试岗位','--json'],
    async () => JSON.stringify({status:'embedded-opened',identityVerified:true,target:{candidateId:'candidate-1'}}));
  await withCommandReceipt(send(), async () => sentResult());
  await assert.rejects(withCommandReceipt(greet, async () => assert.fail()), /已成功/);
});

test('continue-chat does not create a new unconfirmed contact', async () => {
  await withCommandReceipt(greet, async () => contactResult());
  await withCommandReceipt([...greet.slice(0,-1),'--continue-chat','--json'], async () => JSON.stringify({status:'continue-clicked'}));
  await withCommandReceipt(send(), async () => sentResult());
});

test('unknown sends retain full error details and prevent replay', async () => {
  const error = Object.assign(new Error('发送已尝试但结果未知'), {name:'EmbeddedSendUnconfirmedError',details:{text:'完整介绍',clicked:true}});
  await assert.rejects(withCommandReceipt(send(), async () => {throw error;}), /结果未知/);
  const rows = await readCommandReceipts(task.resultsFile);
  assert.equal(rows.at(-1).outcome, 'unknown');
  assert.equal(rows.at(-1).error.details.text, '完整介绍');
  await assert.rejects(withCommandReceipt(send(), async () => assert.fail()), /未决/);
});

test('an explicit same-message check resolves an uncertain send while keeping duplicate protection', async () => {
  await assert.rejects(withCommandReceipt(send(), async () => {throw new Error('timeout');}));
  await withCommandReceipt(['check','--embedded','--state','message-visible','--name','测试甲','--candidate-id','candidate-1','--job','测试岗位','--text','完整介绍','--json'], async () => 'true');
  await assert.rejects(withCommandReceipt(send(), async () => assert.fail()), /已成功/);
  await withCommandReceipt(send('另一条已授权正文'), async () => sentResult());
});

test('an interrupted intent prevents sending again', async () => {
  const intent={attemptId:'interrupted',command:'send',job:task.job,at:new Date().toISOString(),id:'candidate-1',text:'完整介绍',outcome:'intent'};
  await writeFile(task.resultsFile, JSON.stringify(intent)+'\n');
  await assert.rejects(withCommandReceipt(send(), async () => assert.fail()), /未决/);
});

test('old successful and uncertain per-job histories remain effective', async () => {
  await mkdir(task.ledgerDir);
  const legacy=join(task.ledgerDir,createHash('sha256').update(task.job).digest('hex')+'.actions.json');
  const entry={attemptId:'legacy',runId:'old-run',cmd:'greet',id:'candidate-1',text:'',at:new Date().toISOString(),outcome:'success'};
  await writeFile(legacy,JSON.stringify({version:1,entries:[entry]}));
  await assert.rejects(withCommandReceipt(greet,async()=>assert.fail()),/已成功/);
  entry.outcome='unknown';
  await writeFile(legacy,JSON.stringify({version:1,entries:[entry]}));
  await assert.rejects(withCommandReceipt(greet,async()=>assert.fail()),/未决/);
});

test('unwritable records stop before the action and damaged histories are exposed', async () => {
  await mkdir(task.resultsFile);
  await assert.rejects(withCommandReceipt(send(), async()=>assert.fail('must not execute')));
  await rm(task.resultsFile,{recursive:true});
  await writeFile(task.resultsFile,'{"incomplete":');
  await assert.rejects(withCommandReceipt(send(),async()=>assert.fail()),/损坏/);
});

test('known precondition failures permit an explicit corrected attempt', async () => {
  await assert.rejects(withCommandReceipt(send(),async()=>{throw Object.assign(new Error('draft exists'),{name:'SendPreconditionError'});}));
  assert.equal((await readCommandReceipts(task.resultsFile)).at(-1).outcome,'not-attempted');
  await withCommandReceipt(send(),async()=>sentResult());
});

test('task JSON is optional for direct tool calls, with receipts still saved', async () => {
  delete process.env.BOSS_TASK_CONFIG;
  assert.equal(await readTaskConfig(),null);
  await withCommandReceipt(['status','--json'],async()=>'{"pageType":"chat"}');
  const rows=await readCommandReceipts(join(process.env.BOSS_APP_HOME,'results','commands.jsonl'));
  assert.equal(rows.at(-1).result.pageType,'chat');
});

test('legacy task fields are descriptive and require no migration step',async()=>{
  await writeFile(taskFile,JSON.stringify({...task,permit:'C:/old/permit.json'}));
  assert.equal((await readTaskConfig()).job,task.job);
  await withCommandReceipt(['status','--json'],async()=> '{}');
});

test('credential configuration does not copy secrets into a result log',async()=>{
  await withCommandReceipt(['_baidu-keys','--api-key','synthetic-key','--secret-key','synthetic-secret'],async()=> 'configured');
  await assert.rejects(readFile(task.resultsFile),{code:'ENOENT'});
});
