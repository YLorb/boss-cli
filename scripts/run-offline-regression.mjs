import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const output=resolve('output','managed-regression-'+Date.now());await mkdir(output,{recursive:true});
const files=['test-task-config','test-run-state','test-run-atomic','test-phase-state','test-managed-routing','test-collection-receipt','test-offline-boundary','test-permit','test-flow-lock','test-cli-json','test-collection','test-resume-analysis-session'].map(x=>'scripts/'+x+'.mjs');
const result=spawnSync(process.execPath,['--experimental-test-module-mocks','--test',...files],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:16*1024*1024,env:{...process.env,NODE_OPTIONS:'--import '+pathToFileURL(resolve('scripts/testing/offline-network.mjs')).href,BOSS_OFFLINE_TEST:'1',BOSS_APP_HOME:join(output,'home'),BOSS_RUNS_DIR:join(output,'runs'),BOSS_SKILL_DIR:resolve('skills/boss-recruitment')}});
const log=(result.stdout??'')+(result.stderr??'');await writeFile(join(output,'tests.log'),log);
const counts=Object.fromEntries(['tests','pass','fail','skipped'].map(key=>[key,Number(new RegExp('^# '+key+' (\\d+)','m').exec(log)?.[1]??0)]));
let browser=null;
if(process.argv.includes('--browser-fixtures')){
 const env={...process.env,BOSS_APP_HOME:join(output,'fixture-home'),BOSS_RUNS_DIR:join(output,'fixture-home','runs')};delete env.NODE_OPTIONS;
 const r=spawnSync(process.execPath,['--experimental-test-module-mocks','--test','scripts/test-collection-page.mjs'],{encoding:'utf8',windowsHide:true,timeout:120000,env});const log=(r.stdout??'')+(r.stderr??'');await writeFile(join(output,'browser-fixtures.log'),log);browser={exitCode:r.status,scope:'synthetic HTML in a separate Chrome; external traffic blocked by closed proxy'};
}
const ok=result.status===0&&(!browser||browser.exitCode===0);
await writeFile(join(output,'report.json'),JSON.stringify({ok,exitCode:result.status,...counts,files,browser},null,2));console.log(JSON.stringify({output,ok,exitCode:result.status,...counts,browser}));if(!ok){console.log(log.split('\n').filter(x=>/not ok|error:|failureType:/.test(x)).join('\n'));process.exitCode=1;}
