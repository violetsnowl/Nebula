import { deco, fitTo, glyphs, heldRange, lift, put, px, segment, splitAt } from './kit';
import { PH, type TCtx, type TLine, type Tpl } from './types';

/**
 * 样张 N 第一批（2026-11-22 用户定稿）：一词放大、书脊、满版齐行、脚注。
 * 每套都有横排（拉丁、日韩）和竖排（中文）两种；中日韩没有大小写和斜体，用字重和字号拉开对比。
 */

const allTimed = (c: TCtx) => c.lines.every((l) => l.units.length > 0);
const maxGlyphs = (c: TCtx) => Math.max(...c.lines.map((l) => glyphs(l.text)));

// ———— 一词放大（主歌）：每句唱得最久的词放大，其余小字 ————
export const held: Tpl = {
  id: 'held',
  bold: true,
  fits: (c) => c.lines.length >= 2 && c.lines.length <= 5 && allTimed(c) && maxGlyphs(c) <= (c.cjk ? 18 : 48),
  layout: (c) => {
    const n = c.lines.length;
    for (const l of c.lines) {
      l.el.classList.add('lt-held');
      const r = heldRange(l, c.cjk);
      if (r) for (let k = r[0]; k <= r[1]; k++) l.units[k]!.classList.add('lp-big');
      if (l.tr) l.tr.className = 'lp-tr is-under';
    }
    if (c.vert) {
      // 竖排：从右往左一列一句，大字与小字沿列中轴对齐
      let f = 1;
      for (const l of c.lines) {
        l.tx.style.fontSize = '30px';
        f = Math.min(f, 640 / Math.max(1, c.size(l.tx).h));
      }
      const fs = 30 * f;
      const col = fs * 4.2;
      const step = col + 44 * f;
      c.lines.forEach((l, i) => put(l, 1300 - i * step - col, 150 + (i % 2) * 40, fs));
      return;
    }
    const X = [150, 336, 214, 412, 270];
    let f = 1;
    c.lines.forEach((l, i) => {
      l.tx.style.fontSize = '23px';
      f = Math.min(f, (1450 - X[i]!) / Math.max(1, c.size(l.tx).w));
    });
    const fs = 23 * f;
    const big = fs * (c.cjk ? 4.2 : 5.9);
    const step = big * 1.25 + (c.hasTr ? 18 : 0);
    const top0 = (PH - (n - 1) * step - big) / 2 - 10;
    c.lines.forEach((l, i) => put(l, X[i]!, top0 + i * step, fs));
  },
};

// ———— 书脊（预副歌）：那句竖起来贴边排满整个高度，其余句子横排 ————
/** 挑竖起来的那句：整句是一个短语重复两遍的优先，否则挑最短的。 */
function spineOf(c: TCtx): number {
  let best = 0;
  let score = Infinity;
  c.lines.forEach((l, i) => {
    const t = l.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const w = t.split(' ');
    const h = w.length / 2;
    const rep = w.length >= 2 && w.length % 2 === 0 && w.slice(0, h).join(' ') === w.slice(h).join(' ');
    const s = glyphs(l.text) - (rep ? 100 : 0);
    if (s < score) {
      score = s;
      best = i;
    }
  });
  return best;
}
const LEN = 700;
export const spine: Tpl = {
  id: 'spine',
  bold: true,
  fits: (c) => {
    if (c.lines.length < 2 || c.lines.length > 4) return false;
    const k = spineOf(c);
    return glyphs(c.lines[k]!.text) <= (c.cjk ? 14 : 32) && c.lines.every((l, i) => i === k || glyphs(l.text) <= (c.cjk ? 16 : 44));
  },
  layout: (c) => {
    const k = spineOf(c);
    const sp = c.lines[k]!;
    const rest = c.lines.filter((_, i) => i !== k);
    sp.el.classList.add('lt-heavy');
    if (c.vert) {
      // 竖排：那句本来就竖着，直接放大成贴右边的一整列
      const fs = fitTo(c, sp.tx, 760, true, 150);
      const h = c.size(sp.tx).h;
      put(sp, 1450 - fs, 70 + (760 - h) / 2);
      rest.forEach((l, j) => {
        l.el.classList.add('lt-ital');
        put(l, 1450 - fs - 120 - j * 104, 230, 52);
      });
      return;
    }
    const cut = splitAt(sp, c.cjk, c.cjk ? 7 : 14);
    const rows = cut > 0 ? segment(sp, [cut], () => 'lp-row') : [sp.tx];
    let hb = 0;
    for (const r of rows) hb += fitTo(c, r, LEN, false, 150) * (c.cjk ? 1 : 0.86);
    if (rows[0] !== sp.tx) sp.tx.style.fontSize = rows[0]!.style.fontSize;
    // 平排时就放在终点位置的「旋转前」：finish 转 -90° 后正好贴左边、从下往上读
    put(sp, 120, 70 + LEN);
    sp.el.dataset.hb = String(hb);
    sp.rot = -90;
    const x2 = 120 + hb + 140;
    const m = rest.length;
    rest.forEach((l, j) => {
      l.el.classList.add('lt-ital');
      if (l.tr) l.tr.className = 'lp-tr is-under';
      l.tx.style.fontSize = '66px';
      const f = Math.min(1, (1450 - x2) / Math.max(1, c.size(l.tx).w));
      put(l, x2, 392 + (j - (m - 1) / 2) * (c.hasTr ? 140 : 112), 66 * f);
    });
    lift(c, sp, 122, 800);
  },
  finish: (c) => {
    if (c.vert) return;
    const sp = c.lines.find((l) => l.rot === -90);
    if (!sp) return;
    sp.el.classList.add('lp-rot');
    sp.el.style.transformOrigin = '0 0';
    sp.el.style.transform = 'rotate(-90deg)';
    const hb = Number(sp.el.dataset.hb) || 120;
    const first = c.lines.find((l) => l !== sp);
    if (first) {
      const x0 = 120 + hb + 28;
      const x1 = parseFloat(first.el.style.left) - 26;
      const fs = parseFloat(first.tx.style.fontSize) || 66;
      deco(c, 'lp-hair', { left: px(x0), top: px(parseFloat(first.el.style.top) + fs * 0.78), width: px(Math.max(0, x1 - x0)), height: '1px' });
    }
  },
};

// ———— 满版齐行（副歌）：每句断成一两行（竖排是列），每行撑满同一长度，字号由字数决定 ————
interface Row { el: HTMLElement; line: TLine; first: boolean; n: number }
function rowsOf(c: TCtx): Row[] {
  const out: Row[] = [];
  for (const l of c.lines) {
    l.el.classList.add('lt-heavy');
    const cut = splitAt(l, c.cjk, c.vert ? 10 : c.cjk ? 9 : 14);
    const segs = cut > 0 ? segment(l, [cut], () => 'lp-row') : [l.tx];
    segs.forEach((el, i) => {
      el.style.fontSize = '100px';
      out.push({ el, line: l, first: i === 0, n: 0 });
    });
  }
  for (const r of out) r.n = c.vert ? c.size(r.el).h : c.size(r.el).w;
  return out;
}
export const justify: Tpl = {
  id: 'justify',
  bold: true,
  fits: (c) => c.lines.length <= 5 && maxGlyphs(c) <= (c.cjk ? 24 : 60),
  layout: (c) => {
    const rows = rowsOf(c);
    if (rows.some((r) => r.n <= 0)) return;
    const LH = c.cjk ? 1 : 0.86;
    if (c.vert) {
      // 满栏：每列撑满同一高度，从右往左排；整组宽过画面时整体等比缩
      const H0 = 700;
      const GAP = 30;
      const W = (H: number) => rows.reduce((a, r, i) => a + ((100 * H) / r.n) * LH + (i && r.first ? (GAP * H) / H0 : 0), 0);
      const H = Math.min(H0, (H0 * 1250) / W(H0));
      let x = 800 + W(H) / 2;
      const top = (PH - H) / 2;
      for (const [i, r] of rows.entries()) {
        if (i && r.first) x -= (GAP * H) / H0;
        const fs = (100 * H) / r.n;
        r.el.style.fontSize = px(fs);
        if (r.first) {
          // 一句占的总宽（它的几列）：右边对齐 x
          const cols = rows.filter((q) => q.line === r.line);
          const w = cols.reduce((a, q) => a + ((100 * H) / q.n) * LH, 0);
          put(r.line, x - w, top);
          if (r.line.tx !== r.el) r.line.tx.style.fontSize = px(fs);
        }
        x -= fs * LH;
      }
      return;
    }
    const W0 = 1000;
    const GAP = 26;
    const Ht = (W: number) => rows.reduce((a, r, i) => a + ((100 * W) / r.n) * LH + (i && r.first ? (GAP * W) / W0 : 0), 0);
    const W = Math.min(W0, (W0 * 700) / Ht(W0));
    const top0 = (PH - Ht(W)) / 2;
    let y = top0;
    const x = 150;
    for (const [i, r] of rows.entries()) {
      if (i && r.first) y += (GAP * W) / W0;
      const fs = (100 * W) / r.n;
      r.el.style.fontSize = px(fs);
      if (r.first) {
        put(r.line, x, y);
        if (r.line.tx !== r.el) r.line.tx.style.fontSize = px(fs);
        lift(c, r.line, x + W + 84, y + fs * 0.1);
      }
      y += fs * LH;
    }
    if (c.hasTr) deco(c, 'lp-hair', { left: px(x + W + 50), top: px(top0 + 6), height: px(Ht(W) - 12), width: '1px' });
  },
};

// ———— 脚注（开了翻译的主歌）：句末上标序号，译文统一排到页脚 ————
export const foot: Tpl = {
  id: 'foot',
  bold: true,
  fits: (c) => c.hasTr && !c.vert && c.lines.length >= 2 && c.lines.length <= 5,
  layout: (c) => {
    const n = c.lines.length;
    let f = 1;
    for (const l of c.lines) {
      l.el.classList.add('lt-serif');
      l.tx.style.fontSize = '56px';
      f = Math.min(f, 1150 / Math.max(1, c.size(l.tx).w + 30));
    }
    const step = 102 * f;
    const top0 = Math.max(130, 400 - (n * step) / 2 - 40);
    c.lines.forEach((l, i) => {
      put(l, 230, top0 + i * step, 56 * f);
      const sup = document.createElement('sup');
      sup.className = 'lp-deco lp-fn';
      sup.textContent = String(i + 1);
      l.tx.appendChild(sup);
    });
    const footY = Math.max(640, top0 + n * step + 70);
    deco(c, 'lp-hair', { left: '232px', top: px(footY - 28), width: '140px', height: '1px' });
    const rows = Math.ceil(n / 2);
    c.lines.forEach((l, i) => {
      const t = lift(c, l, 232 + Math.floor(i / rows) * 520, footY + (i % rows) * 32, 'is-fn');
      if (t) t.dataset.n = String(i + 1);
    });
  },
};
