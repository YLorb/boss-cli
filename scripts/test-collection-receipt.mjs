import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fixture} from './testing/managed-fixture.mjs';
const {initRun}=await import('../dist/cli/run_state.js');
const {recordPhaseCommand}=await import('../dist/cli/phase_state.js');
const {syncCollectionReceipt}=await import('../dist/collection/session.js');
test('actual download receipt merges into fixed ledger and validates file integrity',async()=>{
 const f=await fixture({mode:'collect-only'}),run=await initRun(f.at),path=join(f.dir,'resume.pdf'),bytes=Buffer.from('synthetic resume');await writeFile(path,bytes);
 await recordPhaseCommand('check',['check','--job',f.task.job,'--json'],'true');
 await recordPhaseCommand('download-resume',['download-resume','--data-id','id-1','--json'],JSON.stringify({path,attachmentName:'resume.pdf',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
 const receipt=JSON.parse(await syncCollectionReceipt('id-1'));assert.equal(receipt.status,'DOWNLOADED');assert.ok(receipt.file.startsWith(run.ledgerDir));
 const saved=JSON.parse(await readFile(receipt.file,'utf8'));assert.equal(saved.candidates[0].attachment.probe.download.bytes,bytes.length);
 await writeFile(path,'corrupted');await assert.rejects(()=>syncCollectionReceipt('id-1'),/不匹配/);
});
