import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
let entered=0, reads=0, fail=false;
const page={url:()=> 'https://www.zhipin.com/web/chat/index',evaluate:async script=>{
  reads++;assert.equal(typeof script,'string');return script.includes('return label;')?'岗位A _ 深圳':true;
}};
mock.module('../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:async fn=>{
  entered++;if(fail)throw Error('guard installation failed');return fn(page);
}}});
const {executeCommand}=await import('../dist/cli/cliRouter.js');
test('public switch-job validates args before shared session and propagates guard failure without action',async()=>{
  for(const args of [[],['--list','--job','A'],['--list','--cdp-url','http://localhost'],['--job','A','--check'],['--list','--timeout-ms','0']])
    await assert.rejects(executeCommand(['switch-job',...args,'--json']));
  assert.equal(entered,0);assert.equal(reads,0);
  fail=true;await assert.rejects(executeCommand(['switch-job','--list','--json']),/guard installation failed/);
  assert.equal(entered,1);assert.equal(reads,0);
  fail=false;
  const same=JSON.parse(await executeCommand(['switch-job','--job','岗位A _ 深圳','--json']));
  assert.equal(entered,2);assert.equal(same.changed,false);assert.equal(same.job,'岗位A _ 深圳');
});
