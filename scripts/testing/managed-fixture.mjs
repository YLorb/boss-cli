import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {after} from 'node:test';
export const root=await mkdtemp(join(tmpdir(),'boss-managed-'));
process.env.BOSS_APP_HOME=join(root,'home');
process.env.BOSS_RUNS_DIR=join(root,'runs');
process.env.BOSS_SKILL_DIR=resolve('skills/boss-recruitment');
export function clearBindings(){for(const key of ['BOSS_RUN_ID','BOSS_TASK_CONFIG','BOSS_RUN_PERMIT','BOSS_FLOW_STATE','BOSS_PHASE_STATE','BOSS_LEDGER_DIR'])delete process.env[key];}
clearBindings();
let sequence=0;
export async function fixture(overrides={}){
 clearBindings();const n=++sequence,dir=join(root,'task-'+n);await mkdir(dir);
 const permit=join(dir,'permit.json'),file=join(dir,'task.json'),job=overrides.job??'测试岗位';
 const allowed=Object.fromEntries(['collect','collect-sync','list','chat','preview','action','ocr','decide','greet','send','back','probe-resume','accept-resume','download-resume','phase-status','phase-set','switch-job'].map(k=>[k,k==='action'?['resume']:[]]));
 await writeFile(permit,JSON.stringify({schemaVersion:1,job,entry:overrides.scope??'collect',allowed}));
 const spec=join(dir,'job-spec.json');await writeFile(spec,JSON.stringify({schemaVersion:1,job,mustHave:['Go','SQL']}));
 const task={schemaVersion:1,job,scope:'collect',permit,jobSpec:spec,stop:{},targets:[{id:'id-1',name:'模拟甲'}],messageScript:'已收到简历。',...overrides};
 await writeFile(file,JSON.stringify(task));process.env.BOSS_TASK_CONFIG=file;
 return {dir,file,permit,task,at:new Date(Date.UTC(2026,10,8,0,0,n))};
}
after(async()=>{clearBindings();if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('unsafe test cleanup');await rm(root,{recursive:true,force:true});});
