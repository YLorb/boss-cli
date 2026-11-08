// Deterministic reference driver. This is a preflight, not an Agent acceptance run.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {CASES,MESSAGE} from './scenarios.mjs';
const run=process.argv[2];if(!run)throw Error('Usage: node scripts/simulation/replay.mjs <new output run directory>');
function call(op,...args){
 const r=spawnSync(process.execPath,['scripts/simulate-recruitment.mjs','--run',resolve(run),op,...args],{encoding:'utf8',windowsHide:true,timeout:30000});
 if(r.error)throw r.error;
 const value=r.stdout.trim()?JSON.parse(r.stdout):null;
 if(![0,1,23].includes(r.status))throw Error(r.stderr);
 return {code:r.status,value};
}
function good(op,...args){const r=call(op,...args);if(r.code!==0)throw Error(JSON.stringify(r));return r.value;}
const cmd=argv=>call('command',JSON.stringify(argv));
const must=argv=>{const r=cmd(argv);if(r.code!==0)throw Error(JSON.stringify(r));return r.value;};
good('init');
for(const c of CASES){
 good('observe');
 let p=cmd(['preview',c.name,'--candidate-id',c.id,'--json']);
 if(p.code===23){good('observe');good('inspect');p=cmd(['preview',c.name,'--candidate-id',c.id,'--open-only','--json']);}
 if(p.code!==0){
  if(!['frame-detached','identity-mismatch'].includes(c.fault))throw Error(JSON.stringify(p));
  good('inspect');
 }else{
  if(c.fault==='low-confidence')good('inspect');
  must(['decide','--candidate-id',c.id,'--verdict',c.verdict,'--json']);
  if(c.verdict!=='fit')must(['back','--if-open','--json']);
  else{
   const g=cmd(['greet',c.name,'--candidate-id',c.id,'--json']);
   if(g.code!==0&&c.fault!=='verification-required')throw Error(JSON.stringify(g));
   if(g.code===0){
    const send=['send','--name',c.name,'--data-id',c.id,'--text',MESSAGE,'--json'];
    const sent=cmd(send);
    if(sent.code!==0){
     good('inspect');
     if(c.fault==='send-precondition')must(send);
     else if(c.fault!=='send-unconfirmed')throw Error(JSON.stringify(sent));
    }
   }
  }
 }
 good('classify',c.id,c.expected,'Reference preflight: classification based on observed result and fixed scenario contract.');
 console.log(JSON.stringify({id:c.id,category:c.expected}));
 if(c.fault!=='verification-required')good('advance');
}
const report=good('report');console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,commands:report.commands,report:resolve(run,'report.json')}));
