/**
 * 在线简历容器判定。
 *
 * 背景（实测，BOSS 沟通页，2026-11-09）：
 * - 在线简历现在挂在 `boss-popup__wrapper ... resume-common-dia` 弹层里（1084×826，x=226），
 *   外层是 fixed 全屏的 `dialog-wrap`；
 * - 关闭后 DOM 不清除，容器被改成 `dialog-wrap deactive` 继续留存；
 * - 关键事实：**正在展示的弹层其 `dialog-wrap` 也可能带 `deactive`**（动画状态类不可靠），
 *   所以「deactive 即残留」的判据是错的，必须改用几何判据：
 *   真实弹层尺寸不超过视口、上边不高于视口；废弃弹层会被撑成超高或被移到视口外。
 *
 * 该片段注入页面执行，只读、无副作用。
 */
export const LIVE_RESUME_FRAME_FN = `(el) => {
  if (!(el instanceof HTMLElement)) return false;
  const src = el.getAttribute('src') || '';
  if (src.indexOf('c-resume') < 0) return false;
  const r = el.getBoundingClientRect();
  if (!(r.width > 8 && r.height > 8)) return false;
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
  }
  const dialog = el.closest('.boss-popup__wrapper, .boss-dialog__wrapper, [class*="resume-common-dia"], .dialog-wrap');
  if (dialog) {
    const d = dialog.getBoundingClientRect();
    if (d.top < -2) return false;
    if (!(d.height > 8)) return false;
    if (d.height > window.innerHeight * 1.2) return false;
  }
  return true;
}`;

/** 从当前文档中取“真正在展示”的那份在线简历 iframe；多次失败会叠加残留，取 DOM 最后一个。 */
export const LIVE_RESUME_FRAME_PICK = `(() => {
  const live = ${LIVE_RESUME_FRAME_FN};
  const all = Array.from(document.querySelectorAll('iframe[src*="c-resume"]'));
  const good = all.filter(live);
  return good.length ? good[good.length - 1] : null;
})()`;
