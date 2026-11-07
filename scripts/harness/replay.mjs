import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {orderOnlineResumeBoxes,parseOcrBoxes} from '../../dist/common/resume_ocr_layout.js';
import {Ledger} from '../../dist/collection/ledger.js';

const [input,output]=process.argv.slice(2);
const data=JSON.parse(await readFile(input,'utf8'));
const checks=[];
async function check(id,kind,fn){
  const start=performance.now();
  try{await fn();checks.push({id,kind,status:'passed',ms:performance.now()-start});}
  catch(error){
    // Assertion messages can contain resume text. Keep details in private files only.
    checks.push({id,kind,status:'failed',ms:performance.now()-start,error:String(error.stack)});
  }
}
for(const sample of data.samples){
  if(sample.status==='not-ocr'){
    checks.push({id:sample.id,kind:'ocr-reorder',status:'skipped',reason:'Archive explicitly records OCR not performed'});continue;
  }
  await check(sample.id,'ocr-reorder',()=>{
    assert.ok(sample.image,'No exact screenshot/OCR mapping');
    const {width,height}=sample.image;
    assert.ok(Array.isArray(sample.boxes)&&sample.boxes.length);
    assert.equal(new Set(sample.boxes.map(b=>b.id)).size,sample.boxes.length,'Duplicate source IDs');
    for(const box of sample.boxes){
      const validated=parseOcrBoxes({0:{rec_txt:box.text,score:box.score,dt_boxes:box.dt_boxes}},width,height)[0];
      for(const key of ['left','right','top','bottom'])assert.equal(box[key],validated[key],`Invalid geometry: ${box.id}/${key}`);
      if(box.source){
        assert.equal(box.top,Math.min(...box.source.dt_boxes.map(p=>p[1]))+box.source.offsetY);
        assert.equal(box.bottom,Math.max(...box.source.dt_boxes.map(p=>p[1]))+box.source.offsetY);
      }
    }
    const reordered=orderOnlineResumeBoxes(sample.boxes);
    // Exact historical snapshot comparison; these are NOT human-corrected OCR labels.
    assert.equal(reordered.text.replace(/\r\n/g,'\n'),sample.text.replace(/\r\n/g,'\n'));
    assert.deepEqual(reordered.boxes.map(b=>b.id),sample.boxes.map(b=>b.id));
  });
  if(sample.raw.type==='split-manifest'){
    checks.push({id:sample.id,kind:'raw-api-replay',status:'skipped',reason:'Split manifest contains paths; per-part wire responses absent'});
  }else{
    await check(sample.id,'raw-api-replay',()=>{
      const parsed=parseOcrBoxes(sample.raw,sample.image.width,sample.image.height);
      const reordered=orderOnlineResumeBoxes(parsed);
      assert.equal(reordered.text.replace(/\r\n/g,'\n'),sample.text.replace(/\r\n/g,'\n'));
    });
  }
}
for(const [index,doc] of data.ledgers.entries()){
  await check(`ledger-${index+1}`,'ledger-load',async()=>{
    const directory=resolve(output,'ledger-copies',String(index+1));
    await mkdir(directory,{recursive:true});
    const file=join(directory,createHash('sha256').update(doc.header.job).digest('hex')+'.json');
    await writeFile(file,JSON.stringify(doc),{flag:'wx'});
    const ledger=await Ledger.load(directory,doc.header.job);
    try{
      assert.equal(ledger.entries().length,doc.candidates.filter(c=>c.decision!=='FAIL').length);
      assert.equal(new Set(ledger.entries().map(c=>c.dataId)).size,ledger.entries().length);
    }finally{await ledger.stop();}
  });
}
const summary={passed:checks.filter(c=>c.status==='passed').length,failed:checks.filter(c=>c.status==='failed').length,skipped:checks.filter(c=>c.status==='skipped').length};
const report={archiveSha256:data.archiveSha256,counts:data.counts,summary,checks,
  scope:'Offline historical OCR ordering and copied ledger compatibility; no live OCR, browser or candidate assessment',
  limitations:['Archived text is a historical snapshot, not human-verified recognition ground truth.','PDFs checked for headers only; no extraction accuracy test.','Historical screening decisions are not approved golden labels.']};
await writeFile(resolve(output,'replay-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(summary));
process.exitCode=summary.failed?1:0;
