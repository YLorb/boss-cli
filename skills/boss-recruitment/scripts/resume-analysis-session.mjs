// Offline Agent handoff: verified OCR text -> compact field/evidence payload.
// This utility never connects to BOSS, calls OCR, or chooses candidate outcomes.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const [op,...args]=process.argv.slice(2);
const opts={};
for(let i=0;i<args.length;i+=2){
  if(!['--receipt','--output','--result'].includes(args[i]) || !args[i+1] || opts[args[i]])throw Error('Invalid or duplicate argument');
  opts[args[i]]=args[i+1];
}
if(!opts['--output'])throw Error('--output required');
const output=path.resolve(opts['--output']);
const hash=data=>createHash('sha256').update(data).digest('hex');
const save=(name,data)=>writeFile(path.join(output,name),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
if(op==='start'){
  if(!opts['--receipt'] || opts['--result'])throw Error('start requires --receipt only');
  const startedAtMs=Date.now();
  const r=JSON.parse((await readFile(opts['--receipt'],'utf8')).replace(/^\uFEFF/,''));
  if(r.status!=='completed' || r.needsReview!==false)throw Error('OCR incomplete or requires image review; fast text-only session not eligible');
  if(hash(await readFile(r.imagePath))!==r.imageSha256)throw Error('OCR image hash mismatch');
  const rawText=await readFile(r.textPath,'utf8');
  const lines=rawText.split(/\r?\n/).filter(s=>s.trim());
  if(!lines.length)throw Error('No OCR text');
  await mkdir(output,{recursive:true});
  const state={startedAtMs,receipt:path.resolve(opts['--receipt']),imageSha256:r.imageSha256,textSha256:hash(rawText),lines,ocrReused:true};
  await save('session.json',state);
  const textReadyAtMs=Date.now();
  await save('text-ready.json',{textReadyAtMs,verificationMs:textReadyAtMs-startedAtMs});
  console.log(JSON.stringify({event:'text-ready',textReadyAtMs,lineCount:lines.length,ocrReused:true}));
  console.log(lines.map((line,i)=>`${i+1}: ${line}`).join('\n'));
}else if(op==='finish'){
  if(!opts['--result'] || opts['--receipt'])throw Error('finish requires --result only');
  const finishStartedAtMs=Date.now();
  const state=JSON.parse(await readFile(path.join(output,'session.json'),'utf8'));
  const ready=JSON.parse(await readFile(path.join(output,'text-ready.json'),'utf8'));
  let r=JSON.parse(opts['--result']);
  if(r.format==='line-map'){
    const mappedKeys=['format','profile','education','skills','employment','projects','issues'];
    if(Object.keys(r).length!==mappedKeys.length || mappedKeys.some(k=>!(k in r)))throw Error('Invalid line-map fields');
    if(!Array.isArray(r.profile)||r.profile.length!==5)throw Error('profile requires name, role, city, email, experience line IDs');
    const sourceLine=id=>{
      if(!Number.isInteger(id)||id<1||id>state.lines.length)throw Error('Invalid profile line ID');
      return state.lines[id-1];
    };
    const values=r.profile.map(sourceLine);
    const valueAfterColon=text=>{
      const i=text.search(/[:：]/);if(i<0)throw Error('Expected labeled profile field');return text.slice(i+1).trim();
    };
    const experience=valueAfterColon(values[4]);
    if(!/^\d+(?:\.\d+)?年$/.test(experience))throw Error('Experience field needs explicit numeric years');
    r={name:values[0],role:valueAfterColon(values[1]),city:valueAfterColon(values[2]),email:valueAfterColon(values[3]),
      experienceYears:Number(experience.slice(0,-1)),education:r.education,skills:r.skills,employment:r.employment,projects:r.projects,issues:r.issues};
  }
  const keys=['name','role','city','email','experienceYears','education','skills','employment','projects','issues'];
  if(Object.keys(r).length!==keys.length || keys.some(k=>!(k in r)))throw Error('Result fields do not match schema');
  for(const k of ['name','role','city','email'])if(typeof r[k]!=='string'||!r[k].trim())throw Error('Missing field: '+k);
  if(!Number.isFinite(r.experienceYears)||r.experienceYears<0)throw Error('Invalid experience');
  const evidence=ids=>{
    if(!Array.isArray(ids)||!ids.length||ids.some(i=>!Number.isInteger(i)||i<1||i>state.lines.length)||new Set(ids).size!==ids.length)throw Error('Invalid evidence line references');
    return ids.map(line=>({line,text:state.lines[line-1]}));
  };
  const result={mode:'collect-only',...r,education:evidence(r.education),skills:evidence(r.skills),employment:evidence(r.employment),
    projects:r.projects.map(evidence),issues:r.issues.map(i=>{
      if(typeof i.issue!=='string'||!i.issue.trim())throw Error('Missing issue explanation');
      return {issue:i.issue,evidence:evidence(i.evidence)};
    }),source:{receipt:state.receipt,imageSha256:state.imageSha256,textSha256:state.textSha256},next:'await-user-or-authorized-workflow'};
  await save('agent-result.json',result);
  const savedAtMs=Date.now();
  const timing={startedAtMs:state.startedAtMs,textReadyAtMs:ready.textReadyAtMs,finishStartedAtMs,savedAtMs,
    verificationMs:ready.verificationMs,agentAndToolGapMs:finishStartedAtMs-ready.textReadyAtMs,
    validateAndSaveMs:savedAtMs-finishStartedAtMs,totalMs:savedAtMs-state.startedAtMs,within30s:savedAtMs-state.startedAtMs<=30000,
    ocrReused:true,ocrCalls:0,timingScope:'Verified OCR cache read through fresh Agent result saved; excludes original OCR and preflight approvals'};
  await save('timing.json',timing);
  console.log(JSON.stringify(timing));
}else throw Error('Expected start or finish');
