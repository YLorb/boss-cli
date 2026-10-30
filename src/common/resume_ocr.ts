import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { isAbsolute, join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { orderOcrBoxes, orderOnlineResumeBoxes, parseOcrBoxes, type OcrLayout } from './resume_ocr_layout.js';
import { prepareOcrParts, mergeOcrParts, OCR_SPLIT_BYTES, OCR_OVERLAP_PX, OCR_MAX_PART_HEIGHT_PX } from './resume_ocr_split.js';

export function resumeOcrRequest(imagePath: string) {
  return { status: 'not-started', command: 'ocr', args: [imagePath, '--layout', 'boss-online-resume', '--json'], execution: 'agent-background', imagePath };
}

export async function runResumeOcr(imagePath: string, timeoutMs = 60_000, layout: OcrLayout = 'auto') {
  const started = performance.now();
  if (!isAbsolute(imagePath)) throw new Error('ocr 需要 PNG 的绝对路径');
  if (layout!=='auto' && layout!=='boss-online-resume') throw new Error('未知 OCR layout');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) throw new Error('OCR timeout-ms 必须为 1000–120000');
  const endpoint = new URL(process.env.BOSS_OCR_URL ?? 'http://ylorb.top:9002/ocr');
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash)
    throw new Error('BOSS_OCR_URL 必须是无内嵌凭据的 HTTP(S) OCR 完整接口地址');
  const info = await stat(imagePath);
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('OCR 输入必须是小于等于 20 MiB 的 PNG 文件');
  const bytes = await readFile(imagePath);
  if (bytes.length < 24 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('OCR 输入不是 PNG');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > 80_000_000) throw new Error('OCR PNG 像素数量超限');
  const parts = prepareOcrParts(bytes); // Decode/validate before uploading; never resize.
  const imageSha256 = createHash('sha256').update(bytes).digest('hex');
  const dir = join(imagePath + '.ocr', randomUUID());
  await mkdir(dir, {recursive: true});
  const rawPath = join(dir,'raw.json'), textPath = join(dir,'text.txt'), boxesPath = join(dir,'boxes.json'), resultPath = join(dir,'result.json');
  const partReceipts = parts.map(p=>({ index:p.index,y:p.y,width:p.width,height:p.height,
    imagePath:parts.length===1?imagePath:join(dir,`part-${p.index}.png`),
    rawPath:parts.length===1?rawPath:join(dir,`part-${p.index}.raw.json`),
    imageSha256:createHash('sha256').update(p.bytes).digest('hex'),bytes:p.bytes.length,status:'pending',requestMs:0 }));
  const context = { imagePath, imageSha256, endpoint: endpoint.href, resultPath, rawPath, requestedLayout:layout,
    split:{thresholdBytes:OCR_SPLIT_BYTES,maxHeightPx:OCR_MAX_PART_HEIGHT_PX,overlapPx:parts.length>1?parts[0].height-parts[1].y:0,configuredOverlapPx:OCR_OVERLAP_PX,partCount:parts.length},parts:partReceipts };
  try {
    await writeFile(resultPath, JSON.stringify({status:'running',...context}), 'utf8');
    if(parts.length>1) {
      for(const p of parts) await writeFile(partReceipts[p.index-1].imagePath,p.bytes);
      await writeFile(rawPath,JSON.stringify({type:'split-manifest',parts:partReceipts.map(({status,requestMs,...part})=>part)},null,2),'utf8');
    }
    const localBoxes = [];
    const signal=AbortSignal.timeout(timeoutMs); // One shared request budget, no per-part retry.
    let requestMs=0;
    for(const p of parts) {
      const receipt=partReceipts[p.index-1];receipt.status='running';
      const form = new FormData();
      form.set('image_file', new Blob([new Uint8Array(p.bytes)], {type:'image/png'}), basename(receipt.imagePath));
      for (const key of ['use_det','use_cls','use_rec']) form.set(key,'true');
      const requestStart = performance.now();
      try {
        const response = await fetch(endpoint, {method:'POST',body:form,signal,redirect:'error'});
        const raw = await response.text();
        await writeFile(receipt.rawPath,raw,'utf8');
        if (!response.ok) throw new Error(`OCR HTTP ${response.status}`);
        if (Buffer.byteLength(raw)>5*1024*1024) throw new Error('OCR 响应超过 5 MiB');
        localBoxes.push(parseOcrBoxes(JSON.parse(raw),p.width,p.height));
        receipt.status='completed';
      } catch(error) {
        receipt.status='failed';
        throw new Error(`OCR分段${p.index}/${parts.length}失败：${error instanceof Error?error.message:String(error)}`);
      } finally {receipt.requestMs=Math.round(performance.now()-requestStart);requestMs+=receipt.requestMs;}
    }
    const reorderStart = performance.now();
    const merged=mergeOcrParts(parts,localBoxes);
    const ordered = layout==='boss-online-resume' ? orderOnlineResumeBoxes(merged.boxes) : orderOcrBoxes(merged.boxes,width);
    const reorderMs = Math.round((performance.now()-reorderStart)*1000)/1000;
    await writeFile(textPath,ordered.text,'utf8');
    await writeFile(boxesPath,JSON.stringify(ordered.boxes,null,2),'utf8');
    const result = {status:'completed',...context,textPath,boxesPath,layout:ordered.layout,lineCount:ordered.boxes.length,
      lowConfidenceIds:ordered.lowConfidenceIds,needsReview:ordered.lowConfidenceIds.length>0,
      merge:{seamY:merged.seamY,seamYs:merged.seamYs,discardedOverlapIds:merged.discardedOverlapIds},
      timing:{requestMs,reorderMs,totalMs:Math.round(performance.now()-started)}};
    await writeFile(resultPath,JSON.stringify(result,null,2),'utf8');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(resultPath,JSON.stringify({status:'failed',...context,error:message,elapsedMs:Math.round(performance.now()-started)},null,2),'utf8');
    throw new Error(`OCR 失败：${message}；image=${imagePath}；result=${resultPath}；raw=${rawPath}`);
  }
}
