import test from 'node:test';
import assert from 'node:assert/strict';
import { chatSearchTimeoutMs, captureChatSearchDiagnostics } from '../dist/toolset/chat_search_diagnostics.js';
import { ChatSearchFailure } from '../dist/common/chat_search_failure.js';
import { jsonError } from '../dist/cli/output.js';

test('search timeout defaults to 20s; explicit environment accepts 20–30s and rejects malformed values', t => {
  const old = process.env.BOSS_CHAT_SEARCH_TIMEOUT_MS;
  t.after(() => {if(old===undefined)delete process.env.BOSS_CHAT_SEARCH_TIMEOUT_MS;else process.env.BOSS_CHAT_SEARCH_TIMEOUT_MS=old;});
  delete process.env.BOSS_CHAT_SEARCH_TIMEOUT_MS;
  assert.equal(chatSearchTimeoutMs(),20_000);
  for (const value of ['1000','20000','30000','60000']) {
    process.env.BOSS_CHAT_SEARCH_TIMEOUT_MS=value;
    assert.equal(chatSearchTimeoutMs(),Number(value));
  }
  for (const value of ['', '0','999','60001','30s','20.5','NaN']) {
    process.env.BOSS_CHAT_SEARCH_TIMEOUT_MS=value;
    assert.throws(chatSearchTimeoutMs,/BOSS_CHAT_SEARCH_TIMEOUT_MS/);
  }
});

test('diagnostic capture failure is explicit and never replaces the original timeout', async () => {
  let reads=0;
  const diagnostics=await captureChatSearchDiagnostics({evaluate:async()=>{reads++;throw Error('frame detached');}});
  assert.equal(reads,1);
  assert.equal(diagnostics.diagnosticError,'frame detached');
  const cause=Object.assign(Error('Waiting failed: 30000ms'),{name:'TimeoutError'});
  const error=new ChatSearchFailure({stage:'wait-candidate-identity',timeoutMs:30000,name:'测试',expectedDataId:'123',clickState:'returned',locationVerified:false,diagnostics},cause);
  assert.equal(error.cause,cause);
  const output=JSON.parse(jsonError('chat',error));
  assert.equal(output.error.name,'ChatLocateError');
  assert.equal(output.error.details.diagnostics.diagnosticError,'frame detached');
  assert.equal(output.error.details.locationVerified,false);
  assert.match(output.error.message,/30000ms/);
});

test('final state failure reports historical location success without claiming current identity', () => {
  const details={stage:'verify-final-identity',timeoutMs:20000,name:'测试',clickState:'returned',locationVerified:true,verifiedConversation:{name:'测试',dataId:'123',job:'岗位A'},diagnostics:{selected:[]}};
  const output=JSON.parse(jsonError('chat',new ChatSearchFailure(details,Error('timeout'))));
  assert.equal(output.ok,false);
  assert.equal(output.error.name,'ChatStateError');
  assert.deepEqual(output.error.details.verifiedConversation,details.verifiedConversation);
  assert.deepEqual(output.error.details.diagnostics.selected,[]);
  assert.ok(!output.error.message.includes('定位结果未确认'));
});
