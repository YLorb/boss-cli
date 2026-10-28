import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {PNG} from 'pngjs';
import {parseOcrBoxes,orderOcrBoxes} from '../dist/common/resume_ocr_layout.js';
import {resumeOcrRequest} from '../dist/common/resume_ocr.js';

const box=(text,x,y,w=250,score=.99)=>({rec_txt:text,score,dt_boxes:[[x,y],[x+w,y],[x+w,y+24],[x,y+24]]});
const fixture={0:box('页眉',40,20,900),1:box('左栏一',40,120),2:box('右栏一',500,120),
  3:box('左栏二',40,180),4:box('右栏二',500,180),5:box('左栏三',40,260),6:box('右栏三',500,240),
  7:box('左栏末行',40,340),8:box('页脚',40,600,900)};
test('coordinate sorting preserves all blocks, trailing left text, scores and source coordinates',()=>{
  const result=orderOcrBoxes(parseOcrBoxes(fixture,1200,1600),1200);
  assert.equal(result.layout,'two-column');
  assert.deepEqual(result.boxes.map(b=>b.text),['页眉','左栏一','左栏二','左栏三','左栏末行','右栏一','右栏二','右栏三','页脚']);
  assert.deepEqual(result.boxes[0].dt_boxes,fixture[0].dt_boxes);
  assert.deepEqual(resumeOcrRequest('/resume.png').args,['/resume.png','--json']);
  assert.equal(resumeOcrRequest('/resume.png').status,'not-started');
  const single=orderOcrBoxes(parseOcrBoxes({0:box('低分',40,60,500,.5),1:box('首行',40,10,500)},1200,1600),1200);
  assert.equal(single.layout,'single-column');assert.deepEqual(single.lowConfidenceIds,['0']);
  assert.match(single.text,/首行\n低分/);
});
test('empty, malformed and ambiguous/multi-column results fail explicitly',()=>{
  for(const raw of [{},[],{error:'bad'}, {0:{...box('x',40,10),score:NaN}}, {0:box('x',1190,10)}])
    assert.throws(()=>parseOcrBoxes(raw,1200,1600));
  assert.throws(()=>orderOcrBoxes(parseOcrBoxes({...fixture,9:box('正文跨栏',40,210,800)},1200,1600),1200),/跨栏/);
  const three={0:box('a',10,100,80),1:box('b',400,100,80),2:box('c',900,100,80)};
  assert.throws(()=>orderOcrBoxes(parseOcrBoxes(three,1200,1600),1200),/多个分栏/);
});
test('public CLI uploads exact PNG, keeps original, writes artifacts, and exposes HTTP/schema/timeout errors without retries',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'boss-ocr-test-'));
  const input=join(dir,'synthetic.png');const png=new PNG({width:1200,height:1600});png.data.fill(255);
  const bytes=PNG.sync.write(png);await writeFile(input,bytes);
  let mode='success',requests=0;
  const server=createServer(async(req,res)=>{
    requests++;
    const chunks=[];for await(const c of req)chunks.push(c);
    const form=await new Request('http://localhost/ocr',{method:'POST',headers:{'content-type':req.headers['content-type']},body:Buffer.concat(chunks)}).formData();
    assert.deepEqual(Buffer.from(await form.get('image_file').arrayBuffer()),bytes);
    for(const key of ['use_det','use_cls','use_rec'])assert.equal(form.get(key),'true');
    if(mode==='timeout')return;
    res.writeHead(mode==='http'?503:200,{'content-type':'application/json'});
    res.end(JSON.stringify(mode==='schema'?{bad:true}:fixture));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/ocr`;
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['dist/cli/index.js','ocr',input,'--timeout-ms','1000','--json'],{
      env:{...process.env,BOSS_OCR_URL:url,BOSS_SKILL_DIR:resolvePath('skills/boss-recruitment')},windowsHide:true});
    let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
    child.on('error',reject);child.on('close',code=>resolve({code,json:JSON.parse(stdout),stderr}));
  });
  try {
    const good=await run();assert.equal(good.code,0,JSON.stringify(good));assert.equal(good.json.status,'completed');
    assert.equal(good.json.lineCount,9);assert.equal(good.json.layout,'two-column');
    assert.match(await readFile(good.json.textPath,'utf8'),/左栏末行\n\n右栏一/);
    assert.deepEqual(await readFile(input),bytes);
    for(const failure of ['http','schema','timeout']){
      mode=failure;const before=requests;const r=await run();assert.equal(r.code,1);assert.equal(r.json.ok,false);
      assert.equal(requests,before+1);assert.match(r.json.error.message,/OCR 失败.*result=/);
    }
    const jobs=await readdir(input+'.ocr');assert.equal(jobs.length,4);
    const results=await Promise.all(jobs.map(j=>readFile(join(input+'.ocr',j,'result.json'),'utf8').then(JSON.parse)));
    assert.equal(results.filter(r=>r.status==='failed').length,3);
  } finally {
    server.closeAllConnections();await new Promise(r=>server.close(r));
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + (process.platform==='win32'?'\\':'/')));
    await rm(dir,{recursive:true,force:true});
  }
});
function resolvePath(p){return resolve(p);}
