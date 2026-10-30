import { PNG } from 'pngjs';
import type { OcrBox } from './resume_ocr_layout.js';

export const OCR_SPLIT_BYTES = 3 * 1024 * 1024;
export const OCR_OVERLAP_PX = 256;
export const OCR_MAX_PART_HEIGHT_PX = 1984;
export type OcrPart = { index: number; y: number; width: number; height: number; bytes: Buffer };

/** Chosen before the first request. Never triggered by a failed OCR response. */
export function prepareOcrParts(bytes: Buffer): OcrPart[] {
  const image = PNG.sync.read(bytes);
  if (bytes.length <= OCR_SPLIT_BYTES && image.height <= OCR_MAX_PART_HEIGHT_PX)
    return [{ index: 1, y: 0, width: image.width, height: image.height, bytes }];
  // Reserve both overlap margins in every equal-height core. Plan once, before requests.
  const heightCount = image.height <= OCR_MAX_PART_HEIGHT_PX ? 1 :
    Math.ceil(image.height / (OCR_MAX_PART_HEIGHT_PX - OCR_OVERLAP_PX));
  const count = Math.max(Math.ceil(bytes.length / OCR_SPLIT_BYTES), heightCount);
  if (image.height < count * 2) throw new Error(`图片高度不足，无法均分为${count}个重叠段`);
  const margin = Math.min(OCR_OVERLAP_PX / 2, Math.floor(image.height / count / 2));
  const parts = Array.from({length:count},(_,i) => {
    const y = Math.floor(image.height*i/count) - (i>0 ? margin : 0);
    const end = Math.floor(image.height*(i+1)/count) + (i<count-1 ? margin : 0);
    const r = {y,height:end-y};
    const crop = new PNG({ width: image.width, height: r.height });
    PNG.bitblt(image, crop, 0, r.y, image.width, r.height, 0, 0);
    return { index: i+1, ...r, width: image.width, bytes: PNG.sync.write(crop) };
  });
  // File compression and overlap can make equal-height pieces unequal in bytes.
  // Reject the whole plan before any upload; do not silently repartition/retry.
  for(const p of parts) if(p.bytes.length>OCR_SPLIT_BYTES || p.height>OCR_MAX_PART_HEIGHT_PX)
    throw new Error(`OCR分段预检超限：part=${p.index}/${count} bytes=${p.bytes.length} limit=${OCR_SPLIT_BYTES} y=${p.y} height=${p.height} maxHeight=${OCR_MAX_PART_HEIGHT_PX}；停止上传，不自动追加裁剪`);
  return parts;
}

export function mergeOcrParts(parts: OcrPart[], localBoxes: OcrBox[][]) {
  if (parts.length !== localBoxes.length || !parts.length) throw new Error('OCR分段结果数量不完整');
  if (parts.length === 1) return { boxes: localBoxes[0], seamY: null, seamYs:[] as number[], discardedOverlapIds: [] as string[] };
  if(parts[0].y!==0 || parts.some((p,i)=>p.index!==i+1 || p.width!==parts[0].width ||
    (i>0 && (p.y<=parts[i-1].y || p.y>=parts[i-1].y+parts[i-1].height || p.y+p.height<=parts[i-1].y+parts[i-1].height)) ||
    (i>1 && p.y<parts[i-2].y+parts[i-2].height))) throw new Error('OCR分段几何关系无效');
  const boxes = localBoxes.map((group,i) => group.map(b => ({ ...b,
    id: `${parts[i].index}:${b.id}`, top: b.top+parts[i].y, bottom: b.bottom+parts[i].y,
    dt_boxes: b.dt_boxes.map(([x,y]) => [x,y+parts[i].y]),
    source: { part: parts[i].index, originalId: b.id, offsetY: parts[i].y, dt_boxes: b.dt_boxes },
  })));
  const seamYs = parts.slice(1).map((lower,i) => {
  const upper=parts[i], start=lower.y, end=upper.y+upper.height;
  const pair=[...boxes[i],...boxes[i+1]];
  // Union both observations so coordinate jitter cannot split a duplicated text line.
  const intervals = pair.filter(b => b.bottom >= start && b.top <= end)
    .map(b => [Math.max(start,b.top),Math.min(end,b.bottom)]).sort((a,b) => a[0]-b[0]);
  const gaps: number[][] = [];
  let cursor = start;
  for (const [top,bottom] of intervals) {
    if (top-cursor >= 2) gaps.push([cursor,top]);
    cursor = Math.max(cursor,bottom);
  }
  if (end-cursor >= 2) gaps.push([cursor,end]);
  const mid = (start+end)/2;
  const candidates = gaps.map(([a,b]) => Math.max(a+1,Math.min(mid,b-1)))
    .sort((a,b) => Math.abs(a-mid)-Math.abs(b-mid) || a-b);
  if (!candidates.length) throw new Error(`OCR重叠区无安全分界线：parts=${i+1}/${i+2} y=${start}..${end}；ids=${pair.filter(b=>b.bottom>=start&&b.top<=end).map(b=>b.id).join(',')}`);
  return candidates[0];
  });
  if(seamYs.some((y,i)=>i>0&&y<=seamYs[i-1])) throw new Error('OCR分界线顺序无效');
  const kept = boxes.flatMap((group,i)=>group.filter(b=>(i===0 || b.top>seamYs[i-1]) && (i===parts.length-1 || b.bottom<seamYs[i])));
  const keptIds = new Set(kept.map(b=>b.id));
  const discarded = boxes.flat().filter(b=>!keptIds.has(b.id));
  if (discarded.some(b=>seamYs.some(y=>b.top<=y && b.bottom>=y)))
    throw new Error('OCR分界线穿过文字框，停止合并');
  if (new Set(kept.map(b=>b.id)).size!==kept.length) throw new Error('OCR合并ID重复');
  return { boxes: kept, seamY:seamYs.length===1?seamYs[0]:null, seamYs, discardedOverlapIds: discarded.map(b=>b.id) };
}
