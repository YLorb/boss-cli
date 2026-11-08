import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {fixture} from './testing/managed-fixture.mjs';
let failWrites=false;
const wrapped={...fs,writeFile:async(path,text,options)=>{
 if(failWrites&&String(path).includes('.tmp')){await fs.writeFile(path,String(text).slice(0,10),options);throw Object.assign(new Error('disk full fixture'),{code:'ENOSPC'});}
 return fs.writeFile(path,text,options);
}};
mock.module('node:fs/promises',{namedExports:wrapped,defaultExport:wrapped});
const {initRun,generateRunId,runStateFile,CURRENT_RUN_FILE}=await import('../dist/cli/run_state.js');
test('partial write never publishes target or changes current run pointer',async()=>{
 const a=await fixture();await initRun(a.at);const pointer=await fs.readFile(CURRENT_RUN_FILE,'utf8');
 const b=await fixture();failWrites=true;try{await assert.rejects(()=>initRun(b.at),/disk full/);}finally{failWrites=false;}
 await assert.rejects(()=>fs.readFile(runStateFile(generateRunId(b.task.job,b.at))),{code:'ENOENT'});assert.equal(await fs.readFile(CURRENT_RUN_FILE,'utf8'),pointer);
});
