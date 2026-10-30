export type OcrBox = {
  id: string; text: string; score: number; dt_boxes: number[][];
  left: number; right: number; top: number; bottom: number;
};

export type OcrLayout = 'auto' | 'boss-online-resume';

/** Explicit online-resume contract: vertical rows, with dates/tags on the same row. */
export function orderOnlineResumeBoxes(boxes: OcrBox[]) {
  if (!boxes.length) throw new Error('无法排列空 OCR 结果');
  const rows: { anchor: OcrBox; boxes: OcrBox[] }[] = [];
  const center = (b: OcrBox) => (b.top + b.bottom) / 2;
  for (const box of [...boxes].sort((a,b) => center(a)-center(b) || a.left-b.left)) {
    const matches = rows.filter(row => Math.abs(center(row.anchor)-center(box)) <=
      Math.min(row.anchor.bottom-row.anchor.top,box.bottom-box.top)*0.5);
    if (matches.length > 1) throw new Error(`在线简历行归属不明确：id=${box.id}`);
    if (matches.length === 1) matches[0].boxes.push(box);
    else rows.push({anchor:box,boxes:[box]});
  }
  for (const row of rows) {
    row.boxes.sort((a,b) => a.left-b.left);
    for (let i=1;i<row.boxes.length;i++) {
      const a=row.boxes[i-1],b=row.boxes[i];
      // OCR box edges may overlap while both endpoints still give the same order.
      // Containment/equal endpoints cannot establish that order; never discard a box.
      if (a.left===b.left || a.right>=b.right)
        throw new Error(`在线简历同行文字框顺序不明确（包含或重合）：ids=${a.id},${b.id}`);
    }
  }
  const ordered=rows.flatMap((row,i)=>row.boxes.map(b=>({...b,region:'body',row:i})));
  if (ordered.length!==boxes.length || new Set(ordered.map(b=>b.id)).size!==boxes.length)
    throw new Error('OCR 重排丢失或重复文字框');
  return {layout:'boss-online-resume' as const,boxes:ordered,
    text:rows.map(row=>row.boxes.map(b=>b.text).join(' ')).join('\n')+'\n',
    lowConfidenceIds:ordered.filter(b=>b.score<0.9).map(b=>b.id)};
}

/** Validate the RapidOCR wire contract before assigning reading order. */
export function parseOcrBoxes(raw: unknown, width: number, height: number): OcrBox[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('OCR 响应必须为文字框对象');
  const entries = Object.entries(raw);
  if (!entries.length || entries.length > 10000) throw new Error('OCR 未识别到文字或文字框数量超限');
  return entries.map(([id, value]) => {
    const v = value as { rec_txt?: unknown; score?: unknown; dt_boxes?: unknown };
    if (!/^\d+$/.test(id) || !v || typeof v.rec_txt !== 'string' || !v.rec_txt.trim() ||
        typeof v.score !== 'number' || !Number.isFinite(v.score) || v.score < 0 || v.score > 1 ||
        !Array.isArray(v.dt_boxes) || v.dt_boxes.length !== 4 || !v.dt_boxes.every(p =>
          Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= 0 && p[1] >= 0 && p[0] <= width + 2 && p[1] <= height + 2)) {
      throw new Error(`OCR 文字框字段无效：id=${id}`);
    }
    const points = v.dt_boxes as number[][];
    const left = Math.min(...points.map(p => p[0])), right = Math.max(...points.map(p => p[0]));
    const top = Math.min(...points.map(p => p[1])), bottom = Math.max(...points.map(p => p[1]));
    if (right <= left || bottom <= top) throw new Error(`OCR 文字框面积无效：id=${id}`);
    return { id, text: v.rec_txt, score: v.score, dt_boxes: points, left, right, top, bottom };
  });
}

/** Explicit geometric layout classification, not semantic reconstruction or a fallback. */
export function orderOcrBoxes(boxes: OcrBox[], width: number) {
  if (!boxes.length) throw new Error('无法排列空 OCR 结果');
  const heights = boxes.map(b => b.bottom - b.top).sort((a,b) => a-b);
  const lineHeight = heights[Math.floor(heights.length / 2)];
  const starts = boxes.map(b => b.left).sort((a,b) => a-b);
  const gaps = starts.slice(1).map((x,i) => ({ index: i, gap: x-starts[i] }))
    .filter(g => g.gap > Math.max(lineHeight * 3, width * 0.12));
  const sort = (group: OcrBox[]) => [...group].sort((a,b) => a.top-b.top || a.left-b.left);
  let layout: 'single-column' | 'two-column';
  let groups: { region: string; boxes: OcrBox[] }[];
  if (gaps.length === 0) {
    // Same-row disjoint blocks without a clear column gutter are ambiguous.
    const byTop = sort(boxes);
    for (let i = 0; i < byTop.length; i++) for (let j = i+1; j < byTop.length; j++) {
      const a = byTop[i], b = byTop[j];
      if (b.top >= a.bottom) break;
      if ((a.right + lineHeight < b.left || b.right + lineHeight < a.left) &&
          Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top) > lineHeight * 0.5)
        throw new Error('OCR 排版不明确：同一行存在分离文本，但无法确定栏间距');
    }
    layout = 'single-column'; groups = [{ region: 'body', boxes: sort(boxes) }];
  } else {
    if (gaps.length !== 1) throw new Error('OCR 排版不支持：检测到多个分栏间隙');
    const split = gaps[0].index, rightStart = starts[split+1], mid = (starts[split]+rightStart)/2;
    const right = boxes.filter(b => b.left > mid);
    if (right.length < 3) throw new Error('OCR 排版不明确：右栏证据不足');
    const bodyTop = Math.min(...right.map(b => b.top)), bodyBottom = Math.max(...right.map(b => b.bottom));
    const header = boxes.filter(b => b.bottom < bodyTop);
    const footer = boxes.filter(b => b.top > bodyBottom && b.left < mid && b.right > rightStart);
    const excluded = new Set([...header,...footer].map(b => b.id));
    const left = boxes.filter(b => b.left < mid && !excluded.has(b.id));
    if (left.length < 3 || Math.max(...left.map(b => b.right)) >= rightStart)
      throw new Error('OCR 排版不明确：栏内容重叠或正文中有跨栏文字');
    layout = 'two-column';
    groups = [{region:'header',boxes:sort(header)}, {region:'left',boxes:sort(left)},
      {region:'right',boxes:sort(right)}, {region:'footer',boxes:sort(footer)}];
  }
  const ordered = groups.flatMap(g => g.boxes.map(b => ({...b,region:g.region})));
  if (ordered.length !== boxes.length || new Set(ordered.map(b => b.id)).size !== boxes.length)
    throw new Error('OCR 重排丢失或重复文字框');
  return { layout, boxes: ordered,
    text: groups.filter(g => g.boxes.length).map(g => g.boxes.map(b => b.text).join('\n')).join('\n\n') + '\n',
    lowConfidenceIds: ordered.filter(b => b.score < 0.9).map(b => b.id) };
}
