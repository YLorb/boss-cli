import {spawn,spawnSync} from 'node:child_process';
import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const opts={};for(let i=2;i<process.argv.length;i+=2){if(!['--exe','--run'].includes(process.argv[i])||!process.argv[i+1])throw Error('--exe <DeepSeek Harness.exe> --run <new output run> required');opts[process.argv[i]]=process.argv[i+1];}
if(!opts['--exe']||!opts['--run'])throw Error('--exe and --run required');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),run=resolve(opts['--run']);
const logs=resolve(root,'output','dsh-simulation-'+Date.now());await mkdir(logs,{recursive:true});
const task=(await readFile(join(root,'scripts/simulation/agent-task.md'),'utf8')).replaceAll('<ROOT>',root.replaceAll('\\','/')).replaceAll('<RUN>',run.replaceAll('\\','/'));
await writeFile(join(logs,'task.md'),task);
const exe=resolve(opts['--exe']),entry=join(dirname(exe),'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js');
const args=['--expose-internals',entry,'headless','--json','--permission-mode','workspace-write','--approval-policy','never','-'];
const child=spawn(exe,args,{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['pipe','pipe','pipe'],windowsHide:true});
child.stdin.end(task);
const usage={inputTokens:0,outputTokens:0,steps:0,missingUsageSteps:0};let buffer='',budgetStopped=false,stopReason=null,runError=null;
let writes=Promise.resolve();const log=(file,value)=>{writes=writes.then(()=>appendFile(join(logs,file),value));};
const stop=(reason)=>{if(budgetStopped)return;budgetStopped=true;stopReason=reason;child.kill();};
child.stdout.on('data',chunk=>{
 buffer+=chunk.toString();let end;
 while((end=buffer.indexOf('\n'))>=0){
  const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let e;
  try{e=JSON.parse(line);}catch{log('non-json.log',line+'\n');continue;}
  // Keep operational evidence, not model reasoning text.
  if(e.type!=='thinking')log('events.ndjson',JSON.stringify(e)+'\n');
  if(e.phase==='turn_end'&&e.reason?.kind==='error')runError=e.reason.error;
  if(e.phase==='step_start'&&usage.missingUsageSteps>0)stop('usage-unavailable-before-next-step');
  if(e.phase==='step_end'){
   usage.steps++;
   if(e.usage){usage.inputTokens+=e.usage.inputTokens??0;usage.outputTokens+=e.usage.outputTokens??0;}
   else usage.missingUsageSteps++;
   console.log(JSON.stringify({event:'dsh-step',...usage,total:usage.inputTokens+usage.outputTokens}));
   // Provider usage arrives after a step. Reserve 40k for one in-flight request.
   if(usage.inputTokens+usage.outputTokens>=60000)stop('token-budget-reserve');
  }
 }
});
child.stderr.on('data',chunk=>log('stderr.log',chunk.toString()));
const timer=setTimeout(()=>stop('wall-time-limit'),15*60*1000);
const exit=await new Promise((res,rej)=>{child.on('error',rej);child.on('close',(code,signal)=>res({code,signal}));});
clearTimeout(timer);await writes;
const result={...exit,...usage,totalReportedTokens:usage.inputTokens+usage.outputTokens,budget:100000,budgetStopped,stopReason,runError,
 budgetNote:'Stops after 60k reported tokens to reserve 40k for in-flight use; final provider accounting is authoritative.',logs,run};
await writeFile(join(logs,'usage.json'),JSON.stringify(result,null,2));
// The Agent's final text never decides acceptance; run the independent oracle again.
const check=spawnSync(process.execPath,[join(root,'scripts/simulate-recruitment.mjs'),'--run',run,'report'],{cwd:root,encoding:'utf8',windowsHide:true});
await writeFile(join(logs,'oracle.log'),(check.stdout??'')+(check.stderr??''));
console.log(JSON.stringify({...result,oracleExitCode:check.status}));process.exitCode=exit.code===0&&check.status===0&&!budgetStopped?0:1;
