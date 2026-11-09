import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fixture} from './testing/managed-fixture.mjs';
const {initRun,getBoundRun}=await import('../dist/cli/run_state.js');
const {setPhase,assertPermittedPhase,recordPhaseCommand,phaseStatus,beforePhaseCommand,failPhaseCommand}=await import('../dist/cli/phase_state.js');
async function setup(extra={}){const f=await fixture(extra);const run=await initRun(f.at);return {...f,run};}
async function verified(){await recordPhaseCommand('check',['check','--job',getBoundRun().job,'--json'],'true');}
test('phase cannot skip or reverse, or advance without success receipts',async()=>{
 await setup({phases:[{name:'read',allowed:{list:[]}},{name:'evaluate',allowed:{ocr:[]}},{name:'send',allowed:{send:[]}}]});
 await assert.rejects(()=>setPhase('send'),/跳步/);await assert.rejects(()=>setPhase('evaluate'),/没有成功/);
 await verified();await recordPhaseCommand('list',['list','--json'],JSON.stringify({candidates:[]}));await setPhase('evaluate');await assert.rejects(()=>setPhase('read'),/倒退/);
});
test('declared prerequisite is based on evidence, not stage name',async()=>{
 await setup({phases:[{name:'read',allowed:{list:[]}},{name:'send',allowed:{send:[]},requires:['evaluated']}]});
 await recordPhaseCommand('list',['list','--json'],'{"candidates":[]}');await assert.rejects(()=>setPhase('send'),/evaluated/);
});
test('unknown object and unverified job blocked before action',async()=>{
 await setup();await assert.rejects(()=>assertPermittedPhase('preview',['preview','模拟甲','--candidate-id','id-1','--json']),/核验当前岗位/);await verified();await assert.rejects(()=>assertPermittedPhase('preview',['preview','同名','--candidate-id','other','--json']),/冻结范围/);
});
test('decide requires OCR result for the same screenshot',async()=>{
 await setup();await verified();await assert.rejects(()=>assertPermittedPhase('decide',['decide','--candidate-id','id-1','--json']),/材料/);
 await recordPhaseCommand('preview',['preview','--candidate-id','id-1','--json'],'{"path":"image.png"}');await assert.rejects(()=>assertPermittedPhase('ocr',['ocr','other.png','--json']),/不是当前/);
 await recordPhaseCommand('ocr',['ocr','image.png','--json'],'{"textPath":"image.txt"}');await assertPermittedPhase('decide',['decide','--candidate-id','id-1','--json']);
});
test('same screenshot is compared by path identity, not by literal spelling',async()=>{
 // Git Bash 会把 C:\a\b 改写成 C:/a/b；同一张图不应因此被判成「换了另一张」。
 await setup();await verified();
 const stored=process.platform==='win32'?'C:\\tmp\\shot.png':'/tmp/shot.png';
 const rewritten=stored.replaceAll('\\','/');
 await recordPhaseCommand('preview',['preview','--candidate-id','id-1','--json'],JSON.stringify({path:stored}));
 await assertPermittedPhase('ocr',['ocr',rewritten,'--json']);
 await assert.rejects(()=>assertPermittedPhase('ocr',['ocr',rewritten.replace('shot','other'),'--json']),/不是当前/);
});
test('recommend greeting only becomes a contact once the small window is verified',async()=>{
 // 推荐页 greet 固定返回 clicked：既不能直接发送，也不能卡死后续 chat --recommend --open。
 await setup({scope:'recommend',job:'推荐岗位',targets:[{id:'id-1',name:'模拟甲'}],messageScript:'你好，方便发一份你的简历过来吗？'});
 await verified();
 await recordPhaseCommand('preview',['preview','--candidate-id','id-1','--json'],JSON.stringify({path:'shot.png'}));
 await recordPhaseCommand('ocr',['ocr','shot.png','--json'],JSON.stringify({textPath:'shot.txt'}));
 await recordPhaseCommand('decide',['decide','--candidate-id','id-1','--verdict','fit','--json'],JSON.stringify({ok:true}));
 const greetArgs=['greet','模拟甲','--candidate-id','id-1','--json'];
 await beforePhaseCommand('greet',greetArgs);
 await recordPhaseCommand('greet',greetArgs,JSON.stringify({status:'clicked',candidateId:'id-1'}));
 const sendArgs=['send','--embedded','--name','模拟甲','--candidate-id','id-1','--text','你好，方便发一份你的简历过来吗？','--json'];
 await assert.rejects(()=>assertPermittedPhase('send',sendArgs),/未决|评估和联系/);
 const chatArgs=['chat','模拟甲','--recommend','--open','--candidate-id','id-1','--json'];
 await assertPermittedPhase('chat',chatArgs);
 await recordPhaseCommand('chat',chatArgs,JSON.stringify({status:'embedded-opened',identityVerified:true,target:{candidateId:'id-1',name:'模拟甲'}}));
 await assertPermittedPhase('send',sendArgs);
});
test('past deadline and zero contact budget stop business actions',async()=>{
 await setup({stop:{deadline:'2000-01-01T00:00:00Z'}});await assert.rejects(()=>assertPermittedPhase('list',['list','--json']),/截止/);
 const {run}=await setup({scope:'recommend',stop:{contactLimit:0}});await verified();const s=JSON.parse(await readFile(run.phaseState,'utf8'));s.decisions['id-1']='fit';await writeFile(run.phaseState,JSON.stringify(s));await assert.rejects(()=>assertPermittedPhase('greet',['greet','模拟甲','--candidate-id','id-1','--json']),/触达上限/);
});
test('status exposes choices and blockers',async()=>{await setup();const result=await phaseStatus();assert.ok(Array.isArray(result.allowedActions));assert.ok(result.blockedActions.preview);assert.equal(result.phase,'task');});
test('unknown send remains pending across readonly status and across runs',async()=>{
 const {run}=await setup({mode:'collect-only'});await verified();const s=JSON.parse(await readFile(run.phaseState,'utf8'));s.decisions['id-1']='fit';await writeFile(run.phaseState,JSON.stringify(s));
 const args=['send','--name','模拟甲','--data-id','id-1','--text','已收到简历。','--json'];await assertPermittedPhase('send',args);await beforePhaseCommand('send',args);await failPhaseCommand('send',args,new Error('connection lost'));
 await recordPhaseCommand('status',['status','--json'],'{"chatFilterJob":"测试岗位"}');assert.ok((await phaseStatus()).pending);
 await setup({mode:'collect-only'});await verified();await assert.rejects(()=>assertPermittedPhase('send',args),/历史动作结果未决/);
});
test('observation budget prevents another physical open but permits same-person reuse',async()=>{
 await setup({job:'观察岗位',targets:[{id:'id-1',name:'模拟甲'},{id:'id-2',name:'模拟乙'}],stop:{observeLimit:1}});await verified();
 await recordPhaseCommand('preview',['preview','--candidate-id','id-1','--json'],'{"path":"image.png"}');
 await assert.rejects(()=>assertPermittedPhase('preview',['preview','模拟乙','--candidate-id','id-2','--json']),/观察上限/);
 await assertPermittedPhase('preview',['preview','模拟甲','--candidate-id','id-1','--open-only','--json']);
});
test('collect needs a fit decision and the approved message, not a download receipt or a bare phase name',async()=>{
 await setup({job:'收件岗位',mode:'collect-only'});await verified();
 await assert.rejects(()=>assertPermittedPhase('send',['send','--data-id','id-1','--text','其他正文','--json']),/话术不一致/);
 await assert.rejects(()=>assertPermittedPhase('send',['send','--data-id','id-1','--text','已收到简历。','--json']),/先完成本人评估/);
});
test('known send precondition failure requires check and permits only one retry',async()=>{
 const {run}=await setup({job:'重试岗位',mode:'collect-only'});await verified();const s=JSON.parse(await readFile(run.phaseState,'utf8'));s.decisions['id-1']='fit';await writeFile(run.phaseState,JSON.stringify(s));
 const argv=['send','--name','模拟甲','--data-id','id-1','--text','已收到简历。','--json'],error=Object.assign(new Error('editor absent; attempted=false'),{name:'SendPreconditionError'});
 await beforePhaseCommand('send',argv);await failPhaseCommand('send',argv,error);await assert.rejects(()=>assertPermittedPhase('send',argv),/未决/);
 await recordPhaseCommand('send',[...argv,'--check'],'true');await assertPermittedPhase('send',argv);await beforePhaseCommand('send',argv);await failPhaseCommand('send',argv,error);await assert.rejects(()=>assertPermittedPhase('send',argv),/必须暂停/);
});
test('valid JSON with missing pause state fails closed',async()=>{
 const {run}=await setup();const s=JSON.parse(await readFile(run.phaseState,'utf8'));delete s.paused;await writeFile(run.phaseState,JSON.stringify(s));await assert.rejects(phaseStatus,/字段损坏/);
});
test('risk pause blocks page reads while local phase status remains readable',async()=>{
 await setup();await failPhaseCommand('preview',['preview','--json'],new Error('verification required'));await assert.rejects(()=>assertPermittedPhase('status',['status','--json']),/全局暂停/);assert.match((await phaseStatus()).paused,/verification/);
});
test('resume clears pause but keeps pending, so an unresolved action can still be verified',async()=>{
 // 推荐页真实故障链：greet 已点击（pending）→ chat 核验失败（paused）。若 resume 要求 pending 已清空，
 // 「读页面需 resume、resume 需 pending 清空、清 pending 又需读页面」会形成永久死锁。
 const {run}=await setup();await verified();
 const s=JSON.parse(await readFile(run.phaseState,'utf8'));
 s.pending={cmd:'greet',id:'id-1',text:''};
 s.paused='Error: 内嵌会话身份／岗位不符：job';
 await writeFile(run.phaseState,JSON.stringify(s));
 await assert.rejects(()=>assertPermittedPhase('status',['status','--json']),/全局暂停/);
 await recordPhaseCommand('flow-resume',['flow-resume','--json'],'{"ok":true}');
 const after=await phaseStatus();
 assert.equal(after.paused,null);
 assert.equal(after.pending?.cmd,'greet','解除暂停不得丢弃未决动作');
 await assertPermittedPhase('status',['status','--json']);
 await assert.rejects(()=>assertPermittedPhase('preview',['preview','--candidate-id','id-1','--json']),/未决/,'pending 仍须阻止重放与依赖动作');
});


test('bare job title from the search dropdown counts as the same job scope',async()=>{
 // 搜索页岗位下拉只显示岗位名，`--job` 必须与下拉文案逐字相同才选得中；任务键是「岗位 _ 城市」。
 await setup({job:'Harness工程师 _ 深圳'});
 await assertPermittedPhase('search',['search','--job','Harness工程师','--json']);
 await assertPermittedPhase('search',['search','--job','Harness工程师 _ 深圳','--json']);
 await assert.rejects(()=>assertPermittedPhase('search',['search','--job','后训练平台工程师','--json']),/范围以外/);
 await recordPhaseCommand('status',['status','--json'],JSON.stringify({searchJob:'Harness工程师'}));
 assert.equal((await phaseStatus()).jobVerified,true,'搜索页岗位标签不带城市，也应核验通过');
});
