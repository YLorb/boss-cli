import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const opts={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!['--archive','--python','--output'].includes(key)||!value||key in opts)throw Error('Usage: node scripts/test-harness.mjs --archive <ZIP> [--python <python executable>] [--output <new output directory>]');
  opts[key]=value;
}
if(!opts['--archive'])throw Error('--archive required');
const archive=resolve(opts['--archive']);
const output=resolve(opts['--output']??join(root,'output','harness',new Date().toISOString().replace(/[:.]/g,'-')));
// Reports contain private evidence. Require the existing ignored workspace output root.
if(!output.startsWith(resolve(root,'output')+ (process.platform==='win32'?'\\':'/')))throw Error('--output must be a new directory under workspace output/');
mkdirSync(output,{recursive:true});
writeFileSync(join(output,'run.json'),JSON.stringify({startedAt:new Date().toISOString(),archive,network:'local mock HTTP only'}),{flag:'wx'});
const stages=[];
function run(name,command,args){
  const start=Date.now();
  const r=spawnSync(command,args,{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,BOSS_APP_HOME:join(output,'isolated-home'),BOSS_RUNS_DIR:join(output,'isolated-home','runs'),BOSS_SKILL_DIR:join(root,'skills','boss-recruitment')},maxBuffer:32*1024*1024,timeout:180000});
  writeFileSync(join(output,name+'.log'),(r.stdout??'')+(r.stderr??'')+(r.error?String(r.error):''));
  const result={name,status:r.status===0&&!r.error?'passed':'failed',exitCode:r.status,ms:Date.now()-start};stages.push(result);
  console.log(JSON.stringify(result));
  writeFileSync(join(output,'summary.json'),JSON.stringify({output,stages,ok:stages.every(s=>s.status==='passed')},null,2));
  return result.status==='passed';
}
if(!run('build',process.execPath,['node_modules/typescript/bin/tsc']))process.exit(1);
if(!run('archive',opts['--python']??'python',[join(root,'scripts/harness/read_archive.py'),archive,join(output,'dataset.json')]))process.exit(1);
// Explicit list prevents accidental discovery of scripts that access real accounts.
const suites=[
 ['managed-task',['scripts/test-task-config.mjs','scripts/test-run-state.mjs','scripts/test-run-atomic.mjs','scripts/test-phase-state.mjs','scripts/test-managed-routing.mjs','scripts/test-offline-boundary.mjs']],
 ['unit',['scripts/test-collection.mjs','scripts/test-resume-analysis-session.mjs','scripts/test-resume-capture-timing.mjs','scripts/test-switch-job-route.mjs']],
 ['flow-lock',['scripts/test-flow-lock.mjs']],
 ['iframe-guard',['scripts/test-iframe-boundary.mjs','scripts/test-session-guard-boundary.mjs','scripts/test-session-no-recovery.mjs','scripts/test-resume-frame-recovery.mjs','scripts/test-page-guard-installation.mjs']],
 ['api-contract',['scripts/test-resume-ocr.mjs']],
];
let ok=true;
for(const [name,files] of suites)if(!run(name,process.execPath,['--experimental-test-module-mocks','--test',...files]))ok=false;
if(!run('workflow-simulation',process.execPath,['scripts/simulation/replay.mjs',join(output,'workflow')]))ok=false;
if(!run('archive-replay',process.execPath,['scripts/harness/replay.mjs',join(output,'dataset.json'),output]))ok=false;
console.log('Report: '+join(output,'summary.json'));
process.exitCode=ok?0:1;
