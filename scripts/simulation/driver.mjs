import {mock} from 'node:test';
import {mkdir,readFile,writeFile,appendFile,open,unlink} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import {PNG} from 'pngjs';
import {CASES,RULES,MESSAGE} from './scenarios.mjs';

// There is no browser or external-service connection in this workflow simulator.
const deny=()=>{throw Error('SIMULATION_NETWORK_DENIED');};
net.connect=deny;net.createConnection=deny;tls.connect=deny;globalThis.fetch=deny;
const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2);
if(args[0]!=='--run'||!args[1])throw Error('Usage: simulate-recruitment.sh --run <new output directory> init|observe|inspect|classify|advance|command|report');
const directory=resolve(args[1]),operation=args[2],tail=args.slice(3);
if(!directory.startsWith(resolve(root,'output')+sep))throw Error('Simulation run must be under workspace output/');
const worldFile=join(directory,'world.json'),flowFile=join(directory,'flow.json');
process.env.BOSS_FLOW_STATE=flowFile;
const save=async()=>writeFile(worldFile,JSON.stringify(world,null,2)+'\n');
const event=async(value)=>appendFile(join(directory,'events.ndjson'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,...value})+'\n');
const emit=value=>console.log(JSON.stringify(value));
let world;
if(operation==='init'){
 await mkdir(directory,{recursive:true});
 const handle=await open(worldFile,'wx');
 world={version:1,cursor:0,open:null,records:{},decisions:{},classifications:{},messageEvents:[],contactEvents:[],faults:{},inspections:{},commands:0};
 await handle.writeFile(JSON.stringify(world,null,2));await handle.close();
 const manifest={version:1,scope:'Local workflow simulation using production CLI routing/state and simulated toolset; no browser, real OCR or LLM calls',rules:RULES,count:CASES.length};
 await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
 await event({type:'init'});emit(manifest);process.exit(0);
}
world=JSON.parse(await readFile(worldFile,'utf8'));
const current=()=>{const c=CASES[world.cursor];if(!c)throw Error('No candidate remaining');return c;};
const record=id=>world.records[id]??={previewCalls:0,physicalOpens:0,greetCalls:0,sendCalls:0,inspectCalls:0};
const fail=(name,message)=>{const e=new Error(message);e.name=name;throw e;};
const requireTarget=(name,id)=>{const c=current();if(name!==c.name||id!==c.id)fail('IdentityMismatchError','SIM_IDENTITY_MISMATCH: name and ID must match the current candidate');return c;};
async function preview(options){
 const c=requireTarget(options.candidateTarget,options.candidateId),r=record(c.id);r.previewCalls++;
 if(c.fault==='frame-detached')fail('ResumeFrameOpenError','SIM_FRAME_DETACHED: target contentFrame detached before opening; no panel open');
 if(c.fault==='identity-mismatch')fail('IdentityMismatchError','SIM_IDENTITY_MISMATCH: card ID and resume ID differ; no panel open');
 if(world.open&&world.open!==c.id)throw Error('SIM_PANEL_ALREADY_OPEN');
 if(!world.open)r.physicalOpens++;
 world.open=c.id;
 const image=join(directory,c.id+'.png'),text=join(directory,c.id+'.txt');
 const png=new PNG({width:32,height:32});png.data.fill(255);
 await writeFile(image,PNG.sync.write(png));
 const material=`${c.name}\n技能：${c.skills.join('、')}\n自述：开发库存服务与任务处理接口。\n全部内容虚构。`;
 await writeFile(text,material);
 await save();
 if(c.fault==='process-interrupted'&&!world.faults[c.id]){
  world.faults[c.id]=true;await save();await event({type:'injected-process-exit',id:c.id,outcome:'panel-open-result-not-returned'});
  console.error('SIM_PROCESS_INTERRUPTED: code=23; inspect persisted state before resuming');process.exit(23);
 }
 return JSON.stringify({name:c.name,candidateId:c.id,identityVerified:true,path:image,closed:false,
  material:{textPath:text,text:material,needsReview:c.fault==='low-confidence',source:'synthetic OCR fixture; no recognition performed'}});
}
async function greet(options){
 const c=requireTarget(options.candidateTarget,options.candidateId);record(c.id).greetCalls++;
 if(c.fault==='verification-required')throw Error('SIM_VERIFICATION_REQUIRED: 验证码阻塞，暂停整轮，不重试');
 world.contactEvents.push({id:c.id});world.open=null;await save();
 return JSON.stringify({status:'contact-confirmed',candidateId:c.id,clicked:true});
}
async function send(options){
 const c=requireTarget(options.target?.name,options.target?.dataId),r=record(c.id);r.sendCalls++;
 if(options.text!==MESSAGE)throw Error('SIM_MESSAGE_NOT_AUTHORIZED');
 if(!world.contactEvents.some(e=>e.id===c.id))throw Error('SIM_CONTACT_NOT_CONFIRMED');
 if(c.fault==='send-precondition'&&!world.faults[c.id]){
  world.faults[c.id]=true;await save();fail('SendPreconditionError','SIM_SEND_PRECONDITION: editor missing BEFORE sending; sendAttempted=false; inspect before retry');
 }
 world.messageEvents.push({id:c.id,text:options.text});await save();
 if(c.fault==='send-unconfirmed')fail('EmbeddedSendUnconfirmedError','SIM_SEND_UNCONFIRMED: sendAttempted=true; outcome=unconfirmed; retryAllowed=false');
 return JSON.stringify({status:'message-visible',text:options.text,target:options.target});
}
async function back(){const id=world.open;world.open=null;await save();return JSON.stringify({action:id?'close-panel':'noop',candidateId:id});}

const names=['implChatAction','implChatSearch','implClearChatSearch','implLogin','implListCandidates','implListUnreadCandidates','implOpenChatByIndex','implListPositions','implListPositionsWithOptions','implNormalSearch','implSearchControl','implOpenChat','implOpenTargetChat','implAcceptTargetResume','implDownloadTargetResume','implRecommend','implPreview','implRecommendGreet','implSetBaiduCredentials','implBossSearch','implSendMessage'];
const implementations={implPreview:preview,implRecommendGreet:greet,implSendMessage:send};
mock.module('../../dist/toolset/index.js',{namedExports:Object.fromEntries(names.map(name=>[name,implementations[name]??(async()=>{throw Error('Unsupported simulated tool: '+name);})]))});
mock.module('../../dist/toolset/back.js',{namedExports:{runBack:back,hasOnlineResumePanel:async()=>!!world.open}});
mock.module('../../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:async()=>{throw Error('SIM_REAL_SESSION_FORBIDDEN');}}});
const {executeCommand}=await import('../../dist/cli/cliRouter.js');
const {flowStatus,flowWatch}=await import('../../dist/common/flow_state.js');

if(operation==='observe'){
 const c=CASES[world.cursor];emit({rules:RULES,index:world.cursor+1,current:c?{id:c.id,name:c.name}:null,
  panel:world.open,progress:world.classifications,flow:await flowStatus(flowFile),watch:await flowWatch(flowFile)});
}else if(operation==='inspect'){
 const c=current();record(c.id).inspectCalls++;world.inspections[c.id]=true;await save();
 emit({id:c.id,panel:world.open,identityMatches:c.fault!=='identity-mismatch',sourceListUnchanged:true,
  editorReady:true,reviewedSkills:c.fault==='low-confidence'?['Go','SQL']:null,
  sendOutcome:c.fault==='send-unconfirmed'?'not-verifiable':world.messageEvents.some(e=>e.id===c.id)?'visible':'not-sent'});
}else if(operation==='command'){
 const argv=JSON.parse(tail[0]);
 if(!Array.isArray(argv)||!argv.every(x=>typeof x==='string')||!['preview','decide','greet','send','back','flow-status'].includes(argv[0]))throw Error('SIM_COMMAND_NOT_ALLOWED');
 world.commands++;await save();await event({type:'command',id:current().id,argv});
 try{
  const output=await executeCommand(argv);
  if(argv[0]==='decide')world.decisions[current().id]=argv[argv.indexOf('--verdict')+1];
  await save();await event({type:'result',id:current().id,output});emit({ok:true,output:JSON.parse(output)});
 }catch(error){await save();await event({type:'error',id:current().id,name:error.name,message:error.message});emit({ok:false,error:{name:error.name,message:error.message}});process.exitCode=1;}
}else if(operation==='classify'){
 const [id,category,note]=tail;if(id!==current().id||!category||!note||note.length<8)throw Error('classify requires current ID, category and explanatory note');
 world.classifications[id]={category,note};await save();await event({type:'classification',id,category,note});emit({ok:true});
}else if(operation==='advance'){
 if(!world.classifications[current().id])throw Error('Classify current candidate first');
 if(world.open)throw Error('SIM_PANEL_STILL_OPEN');
 world.cursor++;await save();emit({ok:true,remaining:CASES.length-world.cursor});
}else if(operation==='report'){
 const checks=[];const check=(name,pass,actual)=>checks.push({name,pass,actual});
 check('ten ordered candidates handled',world.cursor===10||(world.cursor===9&&world.classifications['sim-10']?.category==='global-blocked'),{cursor:world.cursor,classified:Object.keys(world.classifications).length});
 for(const c of CASES){
  const r=record(c.id),messages=world.messageEvents.filter(e=>e.id===c.id).length;
  check(c.id+' classification',world.classifications[c.id]?.category===c.expected,world.classifications[c.id]);
  check(c.id+' decision',!c.verdict||world.decisions[c.id]===c.verdict,world.decisions[c.id]??null);
  check(c.id+' exactly expected messages',messages===c.messages,messages);
  const expectedContacts=c.verdict==='fit'&&c.fault!=='verification-required'?1:0;
  check(c.id+' exactly expected contacts',world.contactEvents.filter(e=>e.id===c.id).length===expectedContacts,world.contactEvents.filter(e=>e.id===c.id).length);
 }
 check('low-confidence source inspected',world.inspections['sim-05']===true,world.inspections['sim-05']??false);
 check('identity mismatch inspected before continuing',world.inspections['sim-06']===true,world.inspections['sim-06']??false);
 check('local frame failure inspected before continuing',world.inspections['sim-04']===true,world.inspections['sim-04']??false);
 check('unconfirmed send not replayed',record('sim-07').sendCalls===1,record('sim-07').sendCalls);
 check('interruption injected and resumed without second physical opening',world.faults['sim-08']===true&&record('sim-08').physicalOpens===1,record('sim-08'));
 check('pre-send failure inspected and retried once',world.inspections['sim-09']===true&&record('sim-09').sendCalls===2,record('sim-09'));
 const watch=await flowWatch(flowFile);check('global verification stops task',watch.state==='paused',watch);
 const continuation=await flowStatus(flowFile);
 check('unconfirmed send remains pending verification',continuation.candidates.find(c=>c.candidateId==='sim-07')?.state==='needs-verify',continuation.candidates.find(c=>c.candidateId==='sim-07'));
 const events=(await readFile(join(directory,'events.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);
 const result={ok:checks.every(c=>c.pass),scope:'10-person LOCAL workflow simulation; production CLI router and flow state, simulated toolset and OCR text. Not browser E2E or one-hour soak.',
  checks,commands:world.commands,actualSimulatedMessages:world.messageEvents.length,processes:new Set(events.map(e=>e.pid)).size,
  scenarioSha256:createHash('sha256').update(JSON.stringify(CASES)).digest('hex')};
 await writeFile(join(directory,'report.json'),JSON.stringify(result,null,2));emit(result);process.exitCode=result.ok?0:1;
}else throw Error('Unknown simulator operation');
