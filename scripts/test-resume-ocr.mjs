import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {PNG} from 'pngjs';
import {randomFillSync} from 'node:crypto';
import {parseOcrBoxes,orderOcrBoxes,orderOnlineResumeBoxes} from '../dist/common/resume_ocr_layout.js';
import {resumeOcrRequest} from '../dist/common/resume_ocr.js';
import {prepareOcrParts,mergeOcrParts,OCR_SPLIT_BYTES,OCR_MAX_PART_HEIGHT_PX} from '../dist/common/resume_ocr_split.js';

const box=(text,x,y,w=250,score=.99)=>({rec_txt:text,score,dt_boxes:[[x,y],[x+w,y],[x+w,y+24],[x,y+24]]});
const fixture={0:box('页眉',40,20,900),1:box('左栏一',40,120),2:box('右栏一',500,120),
  3:box('左栏二',40,180),4:box('右栏二',500,180),5:box('左栏三',40,260),6:box('右栏三',500,240),
  7:box('左栏末行',40,340),8:box('页脚',40,600,900)};
test('coordinate sorting preserves all blocks, trailing left text, scores and source coordinates',()=>{
  const result=orderOcrBoxes(parseOcrBoxes(fixture,1200,1600),1200);
  assert.equal(result.layout,'two-column');
  assert.deepEqual(result.boxes.map(b=>b.text),['页眉','左栏一','左栏二','左栏三','左栏末行','右栏一','右栏二','右栏三','页脚']);
  assert.deepEqual(result.boxes[0].dt_boxes,fixture[0].dt_boxes);
  assert.deepEqual(resumeOcrRequest('/resume.png').args,['/resume.png','--layout','boss-online-resume','--json']);
  assert.equal(resumeOcrRequest('/resume.png').status,'not-started');
  const single=orderOcrBoxes(parseOcrBoxes({0:box('低分',40,60,500,.5),1:box('首行',40,10,500)},1200,1600),1200);
  assert.equal(single.layout,'single-column');assert.deepEqual(single.lowConfidenceIds,['0']);
  assert.match(single.text,/首行\n低分/);
});
test('online rows preserve dates, tags, spanning notices and all provenance without column guessing',()=>{
  const raw={0:box('工作经历',40,100,100),1:box('公司 职位',200,102,400),2:box('日期',930,99,160),
    3:box('正文',200,150,850),4:box('标签甲',200,200,90),5:box('标签乙',340,197,90),
    6:box('跨越旧分栏线的提示',730,50,280),7:box('操作',1020,51,80),8:box('次段',200,260,400),9:box('日期二',930,260,160),10:box('日期三',930,340,160)};
  const parsed=parseOcrBoxes(raw,1200,1600),r=orderOnlineResumeBoxes(parsed);
  assert.equal(r.layout,'boss-online-resume');assert.equal(r.boxes.length,parsed.length);
  assert.match(r.text,/工作经历 公司 职位 日期\n正文\n标签甲 标签乙/);
  assert.match(r.text,/跨越旧分栏线的提示 操作/);
  for(const b of r.boxes){assert.deepEqual(b.dt_boxes,raw[b.id].dt_boxes);assert.equal(b.score,raw[b.id].score);assert.equal(b.text,raw[b.id].rec_txt);}
  assert.throws(()=>orderOnlineResumeBoxes([...parsed,parsed[0]]),/重合|重复/);
  assert.throws(()=>orderOnlineResumeBoxes(parseOcrBoxes({0:box('a',40,10),1:box('b',60,12,200)},1200,1600)),/顺序不明确.*ids=0,1/);
  const overlap=orderOnlineResumeBoxes(parseOcrBoxes({0:box('姓名',189,45,83),1:box('状态',250,45,115)},1200,1600));
  assert.equal(overlap.text,'姓名 状态\n');assert.equal(overlap.boxes.length,2);
  assert.throws(()=>orderOnlineResumeBoxes([]),/空/);
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
  const run=(args=[])=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['dist/cli/index.js','ocr',input,'--timeout-ms','1000',...args,'--json'],{
      env:{...process.env,BOSS_OCR_URL:url,BOSS_SKILL_DIR:resolvePath('skills/boss-recruitment')},windowsHide:true});
    let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
    child.on('error',reject);child.on('close',code=>resolve({code,json:JSON.parse(stdout),stderr}));
  });
  try {
    const good=await run();assert.equal(good.code,0,JSON.stringify(good));assert.equal(good.json.status,'completed');
    assert.equal(good.json.lineCount,9);assert.equal(good.json.layout,'two-column');
    assert.match(await readFile(good.json.textPath,'utf8'),/左栏末行\n\n右栏一/);
    assert.deepEqual(await readFile(input),bytes);
    const online=await run(['--layout','boss-online-resume']);assert.equal(online.code,0,JSON.stringify(online));assert.equal(online.json.layout,'boss-online-resume');assert.equal(online.json.lineCount,9);
    const beforeInvalid=requests;for(const args of [['--layout','wrong'],['--layout'],['--layout','auto','--layout','auto']]){const bad=await run(args);assert.equal(bad.code,1);}assert.equal(requests,beforeInvalid);
    for(const failure of ['http','schema','timeout']){
      mode=failure;const before=requests;const r=await run();assert.equal(r.code,1);assert.equal(r.json.ok,false);
      assert.equal(requests,before+1);assert.match(r.json.error.message,/OCR 失败.*result=/);
    }
    const jobs=await readdir(input+'.ocr');assert.equal(jobs.length,5);
    const results=await Promise.all(jobs.map(j=>readFile(join(input+'.ocr',j,'result.json'),'utf8').then(JSON.parse)));
    assert.equal(results.filter(r=>r.status==='failed').length,3);
  } finally {
    server.closeAllConnections();await new Promise(r=>server.close(r));
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + (process.platform==='win32'?'\\':'/')));
    await rm(dir,{recursive:true,force:true});
  }
});
function resolvePath(p){return resolve(p);}

// Valid ancillary PNG chunk exercises the exact byte boundary independently of compression.
function largeInput(extra=1,height=2001){
  const png=new PNG({width:400,height});
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
    const i=(y*png.width+x)*4;png.data.set([x%256,y%256,(x+y)%256,255],i);
  }
  const encoded=PNG.sync.write(png);
  const chunk=Buffer.alloc(OCR_SPLIT_BYTES+extra-encoded.length);
  chunk.writeUInt32BE(chunk.length-12,0);chunk.write('teSt',4,'ascii');
  let crc=0xffffffff;
  for(const value of chunk.subarray(4,-4)){
    crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
  return Buffer.concat([encoded.subarray(0,-12),chunk,encoded.subarray(-12)]);
}
test('3 MiB boundary, two overlapping halves and exact unscaled source pixels',()=>{
  const exact=largeInput(0,OCR_MAX_PART_HEIGHT_PX);assert.equal(prepareOcrParts(exact).length,1);
  assert.equal(prepareOcrParts(exact)[0].bytes,exact);
  const bytes=largeInput(),source=PNG.sync.read(bytes),parts=prepareOcrParts(bytes);
  assert.equal(parts.length,2);assert.deepEqual(parts.map(p=>[p.y,p.width,p.height]),[[0,400,1128],[872,400,1129]]);
  assert.equal(parts[0].height-parts[1].y,256);
  for(const part of parts){
    const cropped=PNG.sync.read(part.bytes);
    assert.deepEqual(cropped.data,source.data.subarray(part.y*source.width*4,(part.y+part.height)*source.width*4));
  }
});
test('highly compressed long images split by height including overlap, preserving every pixel',()=>{
  for(const height of [1984,1985,3456,3457,11064]){
    const source=new PNG({width:400,height});source.data.fill(255);
    const bytes=PNG.sync.write(source);assert.ok(bytes.length<OCR_SPLIT_BYTES);
    const parts=prepareOcrParts(bytes);
    if(height===1984){assert.equal(parts.length,1);assert.equal(parts[0].bytes,bytes);}
    if(height===11064)assert.equal(parts.length,7);
    assert.equal(parts[0].y,0);assert.equal(parts.at(-1).y+parts.at(-1).height,height);
    for(const [i,p] of parts.entries()){
      assert.ok(p.height<=OCR_MAX_PART_HEIGHT_PX);assert.ok(p.bytes.length<=OCR_SPLIT_BYTES);
      assert.deepEqual(PNG.sync.read(p.bytes).data,source.data.subarray(p.y*400*4,(p.y+p.height)*400*4));
      if(i)assert.equal(parts[i-1].y+parts[i-1].height-p.y,256);
    }
  }
});
const globalRows=[['首行',50],['相同文本',500],['重叠行',982],['相同文本',1060],['末行',1700]];
function partRaw(part,rows=globalRows){return Object.fromEntries(rows.filter(([,y])=>y>=part.y&&y+24<part.y+part.height)
  .map(([text,y],i)=>[i,box(text,20,y-part.y,250)]));}
test('overlap merge restores global coordinates and removes only spatial duplicates',()=>{
  const parts=prepareOcrParts(largeInput());
  const groups=parts.map(p=>parseOcrBoxes(partRaw(p),p.width,p.height));
  const merged=mergeOcrParts(parts,groups);
  assert.deepEqual(merged.boxes.map(b=>[b.text,b.top]),globalRows);
  assert.equal(merged.discardedOverlapIds.length,2);
  assert.equal(merged.seamY,1007);
  assert.equal(merged.boxes.at(-1).source.offsetY,872);
  assert.deepEqual(merged.boxes.at(-1).dt_boxes,box('末行',20,1700).dt_boxes);
  const covering=parts.map(p=>parseOcrBoxes({0:{...box('跨越整个重叠区',20,0),dt_boxes:[[20,0],[270,0],[270,p.height],[20,p.height]]}},p.width,p.height));
  assert.throws(()=>mergeOcrParts(parts,covering),/无安全分界线/);
  assert.throws(()=>mergeOcrParts(parts,[groups[0]]),/数量不完整/);
});
test('6.25 MiB creates three equal-height overlapping pieces and merges both seams',()=>{
  const bytes=largeInput(OCR_SPLIT_BYTES+256*1024),parts=prepareOcrParts(bytes),source=PNG.sync.read(bytes);
  assert.equal(parts.length,3);
  assert.deepEqual(parts.map(p=>[p.y,p.height]),[[0,795],[539,923],[1206,795]]);
  for(const p of parts){assert.ok(p.bytes.length<=OCR_SPLIT_BYTES);assert.deepEqual(PNG.sync.read(p.bytes).data,source.data.subarray(p.y*400*4,(p.y+p.height)*400*4));}
  const rows=[['起始',100],['边界一',660],['边界二',1330],['结束',1700]];
  const groups=parts.map(p=>parseOcrBoxes(Object.fromEntries(rows.filter(([,y])=>y>=p.y&&y+24<p.y+p.height).map(([t,y],i)=>[i,box(t,20,y-p.y)])),p.width,p.height));
  const merged=mergeOcrParts(parts,groups);
  assert.equal(merged.seamYs.length,2);assert.deepEqual(merged.boxes.map(b=>[b.text,b.top]),rows);assert.equal(merged.discardedOverlapIds.length,2);
});
test('uneven compression that exceeds 3 MiB in a planned crop fails before upload without repartitioning',()=>{
  const png=new PNG({width:1024,height:1600});randomFillSync(png.data.subarray(0,1024*800*4));
  const bytes=PNG.sync.write(png);assert.ok(bytes.length>OCR_SPLIT_BYTES&&bytes.length<2*OCR_SPLIT_BYTES);
  assert.throws(()=>prepareOcrParts(bytes),/分段预检超限.*part=1\/2.*停止上传/);
});
for(const count of [2,3,7])test(`public CLI ${count}-part requests retain audit artifacts; any failed part stops without partial text or retries`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'boss-ocr-split-test-')),input=join(dir,'large.png');
  const tall=new PNG({width:400,height:11064});tall.data.fill(255);
  const bytes=count===7?PNG.sync.write(tall):largeInput(count===2?1:OCR_SPLIT_BYTES+256*1024),parts=prepareOcrParts(bytes);await writeFile(input,bytes);
  const rows=count===7?Array.from({length:22},(_,i)=>['相同文本',50+i*500]):globalRows;
  let failPart=0,requests=0;
  const server=createServer(async(req,res)=>{
    const part=parts[requests++];
    const chunks=[];for await(const c of req)chunks.push(c);
    const form=await new Request('http://localhost/ocr',{method:'POST',headers:{'content-type':req.headers['content-type']},body:Buffer.concat(chunks)}).formData();
    assert.ok(part,'unexpected retry/request');
    assert.deepEqual(Buffer.from(await form.get('image_file').arrayBuffer()),part.bytes);
    res.writeHead(part.index===failPart?503:200,{'content-type':'application/json'});
    res.end(JSON.stringify(partRaw(part,rows)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['dist/cli/index.js','ocr',input,'--layout','boss-online-resume','--json'],{
      env:{...process.env,BOSS_OCR_URL:`http://127.0.0.1:${server.address().port}/ocr`,BOSS_SKILL_DIR:resolvePath('skills/boss-recruitment')},windowsHide:true});
    let stdout='';child.stdout.on('data',d=>stdout+=d);child.on('error',reject);
    child.on('close',code=>resolve({code,json:JSON.parse(stdout)}));
  });
  try{
    const good=await run();assert.equal(good.code,0,JSON.stringify(good));assert.equal(requests,count);
    assert.equal(good.json.split.partCount,count);assert.equal(good.json.split.maxHeightPx,1984);assert.equal(good.json.lineCount,rows.length);assert.equal(good.json.merge.seamYs.length,count-1);
    assert.deepEqual((await readFile(good.json.textPath,'utf8')).trim().split('\n'),rows.map(r=>r[0]));
    for(const p of good.json.parts){assert.equal(p.status,'completed');assert.deepEqual(await readFile(p.imagePath),parts[p.index-1].bytes);assert.ok(await readFile(p.rawPath,'utf8'));}
    assert.equal(JSON.parse(await readFile(good.json.rawPath,'utf8')).type,'split-manifest');
    for(let failed=1;failed<=count;failed++){
      requests=0;failPart=failed;const bad=await run();assert.equal(bad.code,1);assert.equal(requests,failed);
      assert.match(bad.json.error.message,new RegExp(`OCR分段${failed}/${count}失败`));
    }
    const jobs=await readdir(input+'.ocr');assert.equal(jobs.length,count+1);
    for(const job of jobs){
      const folder=join(input+'.ocr',job),result=JSON.parse(await readFile(join(folder,'result.json'),'utf8'));
      if(result.status==='failed'){
        const files=await readdir(folder);assert.ok(!files.includes('text.txt'));assert.ok(!files.includes('boxes.json'));
        assert.equal(result.parts.filter(p=>p.status==='failed').length,1);
      }
    }
    assert.deepEqual(await readFile(input),bytes);
  }finally{
    server.closeAllConnections();await new Promise(r=>server.close(r));
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())+(process.platform==='win32'?'\\':'/')));
    await rm(dir,{recursive:true,force:true});
  }
});
