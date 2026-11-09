import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {resolve,join,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const [operation,outputArg,...tail]=process.argv.slice(2),output=resolve(outputArg??'');
if(!output.startsWith(join(root,'output')+sep))throw Error('Output must be under workspace output/');
const message='已收到简历。',job='本地模拟服务器岗';
const shellPath=value=>"'"+value.replaceAll('\\','/').replaceAll("'","''")+"'";
async function protectedSnapshot(dir){
 const paths=[join(dir,'fixture.json'),join(dir,'permit.json'),join(dir,'job-spec.json'),join(dir,'skills/boss-recruitment/SKILL.md'),join(root,'scripts/agent-matrix-cli.mjs'),join(root,'dist/cli/cliRouter.js'),join(root,'dist/cli/phase_state.js'),join(root,'dist/cli/run_state.js')];
 return Object.fromEntries(await Promise.all(paths.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
}
const phrases={
 collect:['收集这个岗位已有的附件简历','把已有简历附件保存下来','只下载已收到的附件简历','整理这个职位现有的简历附件','将收到的简历附件收集到本地'],
 recommend:['从推荐中评估并联系符合条件的人','筛选推荐候选人，符合要求就沟通','看看推荐的人，匹配就联系','处理推荐列表中的合适候选人','评估推荐简历并触达符合条件者'],
 search:['在搜索结果中筛选并联系合适的人','评估当前搜索结果，匹配就沟通','看看搜索到的候选人，合适就联系','处理搜索结果中的匹配候选人','筛选搜索简历并触达符合要求者'],
};
async function oracle(dir){
 const f=JSON.parse(await readFile(join(dir,'fixture.json'),'utf8')),task=JSON.parse(await readFile(join(dir,'task.json'),'utf8'));
 let events=[];try{events=(await readFile(join(dir,'events.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
 const samePath=(a,b)=>typeof a==='string'&&(process.platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b));
 const checks={job:task.job===f.job,scope:task.scope===f.scope,mode:f.scope!=='collect'||task.mode==='collect-only',budget:task.stop?.contactLimit===(f.scope==='collect'?0:1),message:task.messageScript===message,spec:samePath(task.jobSpec,join(dir,'job-spec.json')),permit:samePath(task.permit,join(dir,'permit.json')),targets:task.targets?.length===1&&task.targets[0].id==='id-1'&&task.targets[0].name==='模拟甲',sends:events.filter(e=>e.type==='send').length===1,correctText:events.filter(e=>e.type==='send').every(e=>e.text===message),contacts:events.filter(e=>e.type==='contact').length===(f.scope==='collect'?0:1),material:events.some(e=>e.type===(f.scope==='collect'?'download':'ocr'))};
 if(f.scope==='collect'){
  const ledger=JSON.parse(await readFile(join(dir,'runtime','ledgers',createHash('sha256').update(f.job).digest('hex')+'.json'),'utf8'));
  checks.persistedLedger=ledger.header.job===f.job&&ledger.candidates.some(c=>c.dataId==='id-1'&&c.status==='DOWNLOADED');
 }
 return {ok:Object.values(checks).every(Boolean),checks};
}
const command=(dir,args)=>{
 const r=spawnSync(process.execPath,['--experimental-test-module-mocks',join(root,'scripts/agent-matrix-cli.mjs'),dir,...args],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000});
 if(r.status!==0||r.error)throw Error(((r.stdout??'')+'\n'+(r.stderr??'')+'\n'+(r.error?String(r.error):'')).slice(-3000));return JSON.parse(r.stdout);
};
if(operation==='prepare'){
 await mkdir(dirname(output),{recursive:true});await mkdir(output);const cases=[];
 for(const host of ['workbuddy','deepseek-harness'])for(const scope of Object.keys(phrases))for(let variant=0;variant<5;variant++)for(let repeat=0;repeat<3;repeat++){
  const id=`${host}-${scope}-${variant+1}-${repeat+1}`,dir=join(output,id);await mkdir(dir);
  await cp(join(root,'skills/boss-recruitment'),join(dir,'skills','boss-recruitment'),{recursive:true});
  const fixture={scope,job,host,id};await writeFile(join(dir,'fixture.json'),JSON.stringify(fixture));
  await writeFile(join(dir,'permit.json'),JSON.stringify({schemaVersion:1,job,entry:scope,allowed:Object.fromEntries(['collect','collect-sync','list','chat','probe-resume','preview','ocr','decide','greet','send','download-resume','back',...(scope==='collect'?[]:[scope])].map(x=>[x,[]]))}));
  await writeFile(join(dir,'job-spec.json'),JSON.stringify({schemaVersion:1,job,mustHave:['Go','SQL']}));
  const prompt=`你在进行完全离线的模拟验收。先读取已安装 Skill：${join(dir,'skills/boss-recruitment/SKILL.md')}。\n任务：${phrases[scope][variant]}。岗位“${job}”；当前已选中该岗位，只处理固定对象模拟甲，id-1，不重新搜索或切换岗位。${scope==='collect'?'只收集、不评估、不求附件，下载后发消息2。':'必须同时具备Go和SQL，证据不足不联系；符合条件时联系并发送消息。'}正文仅限“${message}”。主动联系人数上限${scope==='collect'?0:1}。\n只用离线入口：& ${shellPath(process.execPath)} --experimental-test-module-mocks ${shellPath(join(root,'scripts/agent-matrix-cli.mjs'))} ${shellPath(dir)} <boss命令>。它替换了页面/OCR，禁止访问真实BOSS、浏览器或其他招聘入口。\n在${join(dir,'task.json')}写出任务配置，引用本目录permit.json、job-spec.json，targets为本轮唯一对象；先task-check，再task-init，然后自行按Skill执行。每条命令带--json。不得改fixture、permit、脚本或验收器，不调用参考回放，不读取其他案例。全部完成后报告结果。`;
  await writeFile(join(dir,'prompt.md'),prompt+'\n这是合成夹具，不执行真实Chrome、登录、安装或环境诊断。只操作本案例文件；禁止修改生产代码、Skill或测试工具。不读取参考答案。遇认证、权限或不支持错误保存错误并停止，不修测试环境。');cases.push({id,host,scope,variant,repeat,dir,status:'not-run'});
 }
 await writeFile(join(output,'matrix.json'),JSON.stringify({version:1,scope:'90 independent LOCAL synthetic tasks; not live BOSS or real OCR',cases},null,2),{flag:'wx'});console.log(JSON.stringify({output,cases:cases.length}));
}else if(operation==='reference'){
 const matrix=JSON.parse(await readFile(join(output,'matrix.json'),'utf8'));const selected=matrix.cases.filter(x=>x.host==='workbuddy'&&x.variant===0&&x.repeat===0);
 const referenceRoot=join(output,'reference-'+Date.now());
 for(const original of selected){
  const c={...original,dir:join(referenceRoot,original.scope)};
  await cp(original.dir,c.dir,{recursive:true,errorOnExist:true,force:false});
  const task={schemaVersion:1,job,scope:c.scope,permit:join(c.dir,'permit.json'),jobSpec:join(c.dir,'job-spec.json'),targets:[{id:'id-1',name:'模拟甲'}],messageScript:message,stop:{contactLimit:c.scope==='collect'?0:1},...(c.scope==='collect'?{mode:'collect-only'}:{})};
  await writeFile(join(c.dir,'task.json'),JSON.stringify(task));command(c.dir,['task-check','--json']);command(c.dir,['task-init','--json']);command(c.dir,['check','--job',job,'--json']);
  if(c.scope==='collect'){command(c.dir,['download-resume','模拟甲','--data-id','id-1','--json']);command(c.dir,['collect-sync','--data-id','id-1','--json']);}
  else{const p=command(c.dir,['preview','模拟甲','--candidate-id','id-1','--json']);command(c.dir,['ocr',p.path,'--json']);command(c.dir,['decide','--candidate-id','id-1','--verdict','fit','--json']);command(c.dir,['greet','模拟甲','--candidate-id','id-1','--json']);}
  command(c.dir,['send','--name','模拟甲','--data-id','id-1','--text',message,'--json']);const result=await oracle(c.dir);await writeFile(join(c.dir,'reference-report.json'),JSON.stringify({...result,kind:'fixed reference; not host or language-understanding acceptance'},null,2));if(!result.ok)throw Error(JSON.stringify(result));
 }
 console.log(JSON.stringify({ok:true,referenceCases:selected.length,referenceRoot,hostAcceptance:false}));
}else if(operation==='desktop-start'){
 const [host,id]=tail;const matrix=JSON.parse(await readFile(join(output,'matrix.json'),'utf8'));const c=matrix.cases.find(c=>c.id===id&&c.host===host);if(!c)throw Error('Unknown case/host');
 await writeFile(join(c.dir,'desktop-start.json'),JSON.stringify({host,startedAt:new Date().toISOString(),snapshot:await protectedSnapshot(c.dir)},null,2),{flag:'wx'});console.log(JSON.stringify({host,id,prompt:join(c.dir,'prompt.md')}));
}else if(operation==='desktop-report'){
 const [host,id]=tail;const matrix=JSON.parse(await readFile(join(output,'matrix.json'),'utf8'));const c=matrix.cases.find(c=>c.id===id&&c.host===host);if(!c)throw Error('Unknown case/host');
 const start=JSON.parse(await readFile(join(c.dir,'desktop-start.json'),'utf8'));let result;try{result=await oracle(c.dir);}catch(error){result={ok:false,error:String(error)};}
 const after=await protectedSnapshot(c.dir);if(Object.keys(start.snapshot).some(file=>start.snapshot[file]!==after[file]))result={ok:false,error:'Protected runtime/fixture changed'};
 const report={host,mode:'desktop-ui',startedAt:start.startedAt,finishedAt:new Date().toISOString(),result};await writeFile(join(c.dir,'desktop-report.json'),JSON.stringify(report,null,2));
 c.headlessStatus=c.status;c.status=result.ok?'passed':'failed';c.mode='desktop-ui';await writeFile(join(output,'matrix.json'),JSON.stringify(matrix,null,2));console.log(JSON.stringify(report));if(!result.ok)process.exitCode=1;
}else if(operation==='host'){
 const [host,adapterFile,limitArg]=tail;if(!host||!adapterFile)throw Error('host <output> <host> <adapter.json> [limit]');
 const adapter=JSON.parse(await readFile(adapterFile,'utf8'));if(!Array.isArray(adapter.argv)||!adapter.argv.length||!adapter.argv.every(x=>typeof x==='string'))throw Error('adapter.argv required');
 const matrix=JSON.parse(await readFile(join(output,'matrix.json'),'utf8'));const selected=matrix.cases.filter(x=>x.host===host&&x.status==='not-run').slice(0,Number(limitArg??1));
 for(const c of selected){
  const prompt=await readFile(join(c.dir,'prompt.md'),'utf8');const [exe,...args]=adapter.argv;const start=Date.now();let stdout='',stderr='';
  const protectedFiles=[join(c.dir,'fixture.json'),join(c.dir,'permit.json'),join(c.dir,'job-spec.json'),join(root,'scripts/agent-matrix-cli.mjs'),join(root,'dist/cli/cliRouter.js'),join(root,'dist/cli/phase_state.js'),join(root,'dist/cli/run_state.js')];
  const hashes=await Promise.all(protectedFiles.map(async file=>createHash('sha256').update(await readFile(file)).digest('hex')));
  const child=spawn(exe,args,{cwd:root,env:{...process.env,...adapter.env,BOSS_OFFLINE_TEST:'1',BOSS_APP_HOME:join(c.dir,'runtime'),BOSS_RUNS_DIR:join(c.dir,'runtime','runs')},stdio:['pipe','pipe','pipe'],windowsHide:true});child.stdin.end(prompt);
  let tokens=0,lines='',budgetStopped=false,usageMissing=false;
  child.stdout.on('data',b=>{const chunk=b.toString();if(stdout.length<2_000_000)stdout+=chunk;lines+=chunk;let end;while((end=lines.indexOf('\n'))>=0){const line=lines.slice(0,end);lines=lines.slice(end+1);let e;try{e=JSON.parse(line);}catch{continue;}
   if(adapter.usageFormat==='dsh'&&e.phase==='step_start'&&usageMissing){budgetStopped=true;child.kill();}
   if(adapter.usageFormat==='dsh'&&e.phase==='step_end'){if(!e.usage)usageMissing=true;else tokens+=(e.usage.inputTokens??0)+(e.usage.outputTokens??0);}
   if(adapter.usageFormat==='workbuddy'&&e.type==='assistant'&&e.message?.usage)tokens+=(e.message.usage.input_tokens??0)+(e.message.usage.output_tokens??0);
   if(tokens>=60000){budgetStopped=true;child.kill();}
  }});child.stderr.on('data',b=>{if(stderr.length<100_000)stderr+=b.toString();});
  const timer=setTimeout(()=>child.kill(),adapter.timeoutMs??180000);const exit=await new Promise(res=>{child.once('error',e=>res({code:null,error:e.message}));child.once('close',code=>res({code}));});clearTimeout(timer);
  let result;try{result=await oracle(c.dir);}catch(error){result={ok:false,error:String(error)};}
  const after=await Promise.all(protectedFiles.map(async file=>createHash('sha256').update(await readFile(file)).digest('hex')));
  if(after.some((hash,index)=>hash!==hashes[index]))result={ok:false,error:'Protected fixture/runtime modified; acceptance invalid'};
  // Persist operational results, not model thinking, credentials or full provider errors.
  c.status=exit.code===0&&result.ok&&!budgetStopped?'passed':'failed';c.ms=Date.now()-start;
  const reason=/MISSING_CREDENTIAL|not logged|authentication|token.*missing|API key|EPERM|EACCES|ECONNREFUSED|MODULE_NOT_FOUND/i.exec(stdout+'\n'+stderr);
  if(reason&&!result.ok)c.status='blocked';await writeFile(join(c.dir,'host-report.json'),JSON.stringify({host,status:c.status,exit,ms:c.ms,result,blocker:reason?.[0]??null,reportedTokens:tokens||null,budgetStopped,budgetNote:'60k reported-token stop; usage arrives after steps, not a billing hard limit'},null,2));
  await writeFile(join(output,'matrix.json'),JSON.stringify(matrix,null,2));console.log(JSON.stringify({id:c.id,status:c.status,ms:c.ms}));if(c.status!=='passed')break;
 }
 if(selected.some(c=>c.status!=='passed'))process.exitCode=1;
}else if(operation==='report'){
 const matrix=JSON.parse(await readFile(join(output,'matrix.json'),'utf8'));const counts={};for(const c of matrix.cases)counts[c.status]=(counts[c.status]??0)+1;
 const report={counts,total:matrix.cases.length,complete:matrix.cases.every(c=>c.status==='passed'),scope:matrix.scope};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.complete)process.exitCode=1;
}else throw Error('Usage: agent-matrix.mjs prepare|reference|host|desktop-start|desktop-report|report <output directory> [host] [adapter.json|case-id] [limit]');
