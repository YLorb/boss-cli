import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { isAbsolute, join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { orderOcrBoxes, parseOcrBoxes } from './resume_ocr_layout.js';

export function resumeOcrRequest(imagePath: string) {
  return { status: 'not-started', command: 'ocr', args: [imagePath, '--json'], execution: 'agent-background', imagePath };
}

export async function runResumeOcr(imagePath: string, timeoutMs = 60_000) {
  const started = performance.now();
  if (!isAbsolute(imagePath)) throw new Error('ocr 需要 PNG 的绝对路径');
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
  PNG.sync.read(bytes); // Reject corrupt/truncated input before uploading.
  const imageSha256 = createHash('sha256').update(bytes).digest('hex');
  const dir = join(imagePath + '.ocr', randomUUID());
  await mkdir(dir, {recursive: true});
  const rawPath = join(dir,'raw.json'), textPath = join(dir,'text.txt'), boxesPath = join(dir,'boxes.json'), resultPath = join(dir,'result.json');
  const context = { imagePath, imageSha256, endpoint: endpoint.href, resultPath, rawPath };
  try {
    await writeFile(resultPath, JSON.stringify({status:'running',...context}), 'utf8');
    const form = new FormData();
    form.set('image_file', new Blob([new Uint8Array(bytes)], {type:'image/png'}), basename(imagePath));
    for (const key of ['use_det','use_cls','use_rec']) form.set(key,'true');
    const requestStart = performance.now();
    const response = await fetch(endpoint, {method:'POST',body:form,signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
    const raw = await response.text();
    const requestMs = Math.round(performance.now()-requestStart);
    await writeFile(rawPath,raw,'utf8');
    if (!response.ok) throw new Error(`OCR HTTP ${response.status}`);
    if (Buffer.byteLength(raw)>5*1024*1024) throw new Error('OCR 响应超过 5 MiB');
    const reorderStart = performance.now();
    const ordered = orderOcrBoxes(parseOcrBoxes(JSON.parse(raw),width,height),width);
    const reorderMs = Math.round((performance.now()-reorderStart)*1000)/1000;
    await writeFile(textPath,ordered.text,'utf8');
    await writeFile(boxesPath,JSON.stringify(ordered.boxes,null,2),'utf8');
    const result = {status:'completed',...context,textPath,boxesPath,layout:ordered.layout,lineCount:ordered.boxes.length,
      lowConfidenceIds:ordered.lowConfidenceIds,needsReview:ordered.lowConfidenceIds.length>0,
      timing:{requestMs,reorderMs,totalMs:Math.round(performance.now()-started)}};
    await writeFile(resultPath,JSON.stringify(result,null,2),'utf8');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(resultPath,JSON.stringify({status:'failed',...context,error:message,elapsedMs:Math.round(performance.now()-started)},null,2),'utf8');
    throw new Error(`OCR 失败：${message}；image=${imagePath}；result=${resultPath}；raw=${rawPath}`);
  }
}
