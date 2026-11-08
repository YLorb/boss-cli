// 唯一离线测试入口：生产 CLI + 明确替换的页面/OCR；拒绝所有网络连接。
import {mock} from 'node:test';
import {readFile,writeFile,appendFile,mkdir} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import './testing/offline-network.mjs';
import net from 'node:net';
import tls from 'node:tls';
const root=fileURLToPath(new URL('..',import.meta.url));
const [caseDir,...argv]=process.argv.slice(2),dir=resolve(caseDir??'');
if(!dir.startsWith(resolve(root,'output')+sep)||!argv.length)throw Error('Usage: agent-matrix-cli <output case dir> <boss command>');
const fixture=JSON.parse(await readFile(join(dir,'fixture.json'),'utf8'));
process.env.BOSS_OFFLINE_TEST='1';
process.env.NODE_OPTIONS=`--import ${pathToFileURL(resolve(root,'scripts/testing/offline-network.mjs')).href}`;
const deny=()=>{throw Error('OFFLINE_NETWORK_FORBIDDEN');};net.connect=deny;net.createConnection=deny;tls.connect=deny;globalThis.fetch=deny;
for(const key of ['BOSS_RUN_ID','BOSS_RUN_PERMIT','BOSS_FLOW_STATE','BOSS_PHASE_STATE','BOSS_LEDGER_DIR'])delete process.env[key];
process.env.BOSS_APP_HOME=join(dir,'runtime');process.env.BOSS_RUNS_DIR=join(dir,'runtime','runs');process.env.BOSS_TASK_CONFIG=join(dir,'task.json');process.env.BOSS_SKILL_DIR=join(dir,'skills','boss-recruitment');
await mkdir(join(dir,'material'),{recursive:true});
const event=async(type,details={})=>appendFile(join(dir,'events.ndjson'),JSON.stringify({type,...details})+'\n');
const candidate={name:'模拟甲',candidateId:'id-1',geekId:'id-1',dataId:'id-1',job:fixture.job};
function identity(name,id){if(name!==candidate.name||id!=='id-1')throw Error('SIM_IDENTITY_MISMATCH');}
const names=['implChatAction','implChatSearch','implClearChatSearch','implLogin','implListCandidates','implListUnreadCandidates','implOpenChatByIndex','implListPositions','implListPositionsWithOptions','implNormalSearch','implSearchControl','implOpenChat','implOpenTargetChat','implAcceptTargetResume','implDownloadTargetResume','implRecommend','implPreview','implRecommendGreet','implSetBaiduCredentials','implBossSearch','implSendMessage'];
const implementations={
 implListCandidates:async()=>JSON.stringify({candidates:[candidate]}),implListUnreadCandidates:async()=>JSON.stringify({candidates:[candidate]}),
 implRecommend:async()=>JSON.stringify({job:fixture.job,candidates:[candidate]}),implNormalSearch:async()=>JSON.stringify({job:fixture.job,candidates:[candidate]}),
 implPreview:async options=>{identity(options.candidateTarget,options.candidateId);const path=join(dir,'material','resume.png');await writeFile(path,'synthetic image placeholder');await event('preview',{id:'id-1'});return JSON.stringify({path,candidateId:'id-1',identityVerified:true});},
 implRecommendGreet:async options=>{identity(options.candidateTarget,options.candidateId);if(options.check)return 'true';await event('contact',{id:'id-1'});return JSON.stringify({status:'contact-confirmed',candidateId:'id-1'});},
 implOpenTargetChat:async target=>{identity(target.name,target.dataId);return JSON.stringify({...candidate,attachment:'RECEIVED',attachmentName:'resume.pdf',messages:[]});},
 implDownloadTargetResume:async(target,json,check)=>{identity(target.name,target.dataId);if(check)return 'true';const path=join(dir,'material','resume.pdf'),bytes=Buffer.from('fictional resume: Go SQL');await writeFile(path,bytes);await event('download',{id:'id-1'});return JSON.stringify({path,attachmentName:'resume.pdf',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});},
 implSendMessage:async options=>{identity(options.target.name,options.target.dataId);if(options.check)return 'true';await event('send',{id:'id-1',text:options.text});return JSON.stringify({status:'message-visible',text:options.text});},
};
mock.module('../dist/toolset/index.js',{namedExports:Object.fromEntries(names.map(name=>[name,implementations[name]??(async()=>{throw Error('UNSUPPORTED_SIMULATED_TOOL:'+name);})]))});
mock.module('../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:deny}});
mock.module('../dist/toolset/check_login.js',{namedExports:{runCheckLogin:async()=> 'true'}});
const check=await import('../dist/toolset/check.js');
mock.module('../dist/toolset/check.js',{namedExports:{...check,runCheck:async criteria=>JSON.stringify(!criteria.job||criteria.job===fixture.job),runStatus:async()=>JSON.stringify({chatFilterJob:fixture.job,searchJob:fixture.job,recommendJob:fixture.job}),withGuardedReadOnlyPage:deny}});
const ocr=await import('../dist/common/resume_ocr.js');
mock.module('../dist/common/resume_ocr.js',{namedExports:{...ocr,runResumeOcr:async()=>{const textPath=join(dir,'material','resume.txt');await writeFile(textPath,'模拟甲：具有 Go 和 SQL 项目经验。');await event('ocr',{id:'id-1'});return {status:'completed',textPath};}}});
mock.module('../dist/toolset/back.js',{namedExports:{runBack:async()=>'{"action":"close-panel"}',hasOnlineResumePanel:async()=>true}});
const attachment=await import('../dist/toolset/attachment.js');
mock.module('../dist/toolset/attachment.js',{namedExports:{...attachment,runProbeTargetResume:async(target,download)=>{
 identity(target.name,target.dataId);return JSON.stringify({name:target.name,dataId:target.dataId,attachment:'RECEIVED',attachmentName:'resume.pdf',request:'NOT_OBSERVED',requestEvidence:[],scope:'loaded-messages',download:download?JSON.parse(await implementations.implDownloadTargetResume(target,true,false)):null});
}}});
const commandProcess=await import('../dist/cli/command_process.js');
mock.module('../dist/cli/command_process.js',{namedExports:{...commandProcess,runCommandProcess:async args=>(await import('../dist/cli/cliRouter.js')).executeCommand(args)}});
const {runCli}=await import('../dist/cli/cliRouter.js');
await runCli(argv);
