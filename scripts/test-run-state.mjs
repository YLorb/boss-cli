import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {fixture,clearBindings} from './testing/managed-fixture.mjs';
const {initRun,activateRunBindings,runStateFile,CURRENT_RUN_FILE,defaultFlowStateFile}=await import('../dist/cli/run_state.js');
test('new run activates guards and preserves fixed ledger across tasks',async()=>{
 const a=await fixture();const first=await initRun(a.at);const b=await fixture();const second=await initRun(b.at);
 assert.equal(first.ledgerDir,second.ledgerDir);assert.notEqual(first.flowState,second.flowState);
 assert.equal(second.flowState,defaultFlowStateFile(second.runId));assert.equal(process.env.BOSS_RUN_PERMIT,b.permit);
 assert.equal(process.env.BOSS_FLOW_STATE,second.flowState);assert.equal(second.schemaVersion,2);
});
test('sequential tasks in same process cannot inherit previous permit',async()=>{
 const a=await fixture();await initRun(a.at);const b=await fixture();const next=await initRun(b.at);await activateRunBindings();
 assert.equal(process.env.BOSS_RUN_PERMIT,b.permit);assert.equal(process.env.BOSS_RUN_ID,next.runId);
});
test('fresh process binding loads pointer and fills all guards',async()=>{
 const a=await fixture();const run=await initRun(a.at);clearBindings();await activateRunBindings();
 assert.equal(process.env.BOSS_RUN_ID,run.runId);assert.equal(process.env.BOSS_TASK_CONFIG,a.file);assert.equal(process.env.BOSS_PHASE_STATE,run.phaseState);
});
test('corrupt pointer fails closed',async()=>{
 clearBindings();await writeFile(CURRENT_RUN_FILE,'{ broken');await assert.rejects(activateRunBindings,/指针损坏/);
});
test('pointer referring to missing run fails closed',async()=>{
 clearBindings();await writeFile(CURRENT_RUN_FILE,JSON.stringify({runId:'aaaaaaaaaaaa-20261108-000000'}));await assert.rejects(activateRunBindings,/不可读/);
});
test('corrupt existing run fails closed',async()=>{
 const a=await fixture();const run=await initRun(a.at);await writeFile(runStateFile(run.runId),'{ broken');await assert.rejects(activateRunBindings,/损坏/);
});
test('changed task and permit are rejected',async()=>{
 const a=await fixture();await initRun(a.at);await writeFile(a.file,JSON.stringify({...a.task,stop:{observeLimit:1}}));await assert.rejects(activateRunBindings,/任务配置已改变/);
 const b=await fixture();await initRun(b.at);await writeFile(b.permit,JSON.stringify({schemaVersion:1,allowed:{send:[]}}));await assert.rejects(activateRunBindings,/permit 已改变/);
});
test('explicit environment conflicts cannot replace bindings',async()=>{
 const a=await fixture();await initRun(a.at);process.env.BOSS_LEDGER_DIR=a.dir;await assert.rejects(activateRunBindings,/绑定冲突/);
});
test('same job/time cannot overwrite a run',async()=>{
 const a=await fixture();const run=await initRun(a.at),before=await readFile(runStateFile(run.runId),'utf8');await assert.rejects(()=>initRun(a.at),/不可重复/);assert.equal(await readFile(runStateFile(run.runId),'utf8'),before);
});
test('only absent first-run pointer means no managed task',async()=>{
 clearBindings();await rm(CURRENT_RUN_FILE,{force:true});assert.equal(await activateRunBindings(),null);
});
