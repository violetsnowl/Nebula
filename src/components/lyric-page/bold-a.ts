import { deco, fitTo, glyphs, heldRange, isFunctionWord, lift, put, px, segment, splitAt, wordBounds } from './kit';
import type { TCtx, TLine, Tpl } from './types';

/**
 * 样张 N 第一批（2026-11-22 用户定稿）：一词放大、书脊、满版齐行、脚注。
 * 每套都有横排（拉丁、日韩）和竖排（中文）两种；中日韩没有大小写和斜体，用字重和字号拉开对比。
 */

const allTimed = (c: TCtx) => c.lines.every((l) => l.units.length > 0);
const maxGlyphs = (c: TCtx) => Math.max(...c.lines.map((l) => glyphs(l.text)));

/** 整页挑一个唱得最久的非虚词（中文竖排用）：按分词候选遍历，避免某句最长字碰巧是「的」就漏掉同句实词。 */
function heldPickZh(c: TCtx): { l: TLine; from: number; to: number; dur: number } | null {
  let best: { l: TLine; from: number; to: number; dur: number } | null = null;
  const consider = (l: TLine, a: number, b: number) => {
    const raw = l.units
      .slice(a, b + 1)
      .map((u) => u.textContent ?? '')
      .join('')
      .replace(/[^\p{L}\p{N}]/gu, '');
    if (!raw || isFunctionWord(raw, true)) return;
    const dur = l.eu!.slice(a, b + 1).reduce((s, u) => s + (u.e - u.s), 0) + glyphs(raw) * 0.001;
    if (!best || dur > best.dur) best = { l, from: a, to: b, dur };
  };
  for (const l of c.lines) {
    if (!l.eu?.length || l.eu.length !== l.units.length) continue;
    const starts = [...wordBounds(l)].sort((x, y) => x - y);
    for (let m = 0; m < starts.length; m++) {
      const a = starts[m]!;
      const b = (starts[m + 1] ?? l.units.length) - 1;
      if (b - a <= 2) {
        consider(l, a, b);
      } else {
        for (let k = a; k <= b; k++) consider(l, k, k);
      }
    }
  }
  return best;
}

// ———— 一词放大（主歌）：每句唱得最久的词放大，其余小字 ————
export const held: Tpl = {
  id: 'held',
  bold: true,
  fits: (c) =>
    c.lines.length >= 2 &&
    c.lines.length <= 5 &&
    allTimed(c) &&
    maxGlyphs(c) <= (c.cjk ? 18 : 48) &&
    // 整页一个合格的词都挑不出来（全是 it / me / you 这类虚词）就不用这套
    (c.cjk && c.vert ? heldPickZh(c) !== null : c.lines.some((l) => heldRange(l, c.cjk) !== null)),
  layout: (c) => {
    const n = c.lines.length;
    for (const l of c.lines) {
      l.el.classList.add('lt-held');
      const r = heldRange(l, c.cjk);
      if (r) for (let k = r[0]; k <= r[1]; k++) l.units[k]!.classList.add('lp-big');
      if (l.tr) l.tr.className = 'lp-tr is-under';
    }
    if (c.vert) {
      // 中文竖排（2026-11-23 用户定稿）：整页只放大一个实词，按词在句中的位置自然切成
      // 「前半列（右）→ 大字列（中）→ 后半列（左）」，从右往左阅读不断句；全部留在 .lp-line.is-vert 内。
      const pick = heldPickZh(c);
      if (!pick) {
        let f = 1;
        for (const l of c.lines) {
          l.tx.style.fontSize = '30px';
          f = Math.min(f, 590 / Math.max(1, c.size(l.tx).h));
        }
        const fs = 30 * f;
        const col = fs * 4.2;
        const step = col + 44 * f;
        const totalW = n * col + Math.max(0, n - 1) * 44 * f;
        const right0 = (1600 + totalW) / 2;
        c.lines.forEach((l, i) => put(l, right0 - i * step - col, 136 + (i % 2) * 32, fs));
        return;
      }
      for (const l of c.lines) for (const u of l.units) u.classList.remove('lp-big');
      const uLen = pick.l.units.length;
      const hasGlyph = (a: number, b: number) =>
        a <= b &&
        glyphs(
          pick.l.units
            .slice(a, b + 1)
            .map((u) => u.textContent ?? '')
            .join(''),
        ) > 0;
      const from = hasGlyph(0, pick.from - 1) ? pick.from : 0;
      const to = hasGlyph(pick.to + 1, uLen - 1) ? pick.to : uLen - 1;
      const cuts: number[] = [];
      if (from > 0) cuts.push(from);
      if (to + 1 < uLen) cuts.push(to + 1);
      const bigIdx = from > 0 ? 1 : 0;
      pick.l.el.classList.add('lt-held-host');
      put(pick.l, 0, 0);
      const segs = segment(pick.l, cuts, (k) => (k === bigIdx ? 'lt-held-big' : 'lt-held-sub'));
      // 大字列里的空格（歌词里词与词之间的空格）在竖排里是一个整字宽的空隙：去掉，大字之间只留字距
      for (const nd of [...(segs[bigIdx]?.childNodes ?? [])]) if (nd.nodeType === 3) nd.remove();

      interface Col {
        el: HTMLElement;
        line: TLine;
        lineIdx: number;
        isSeg: boolean;
        isBig: boolean;
        fs: number;
        w: number;
      }
      const cols: Col[] = [];
      c.lines.forEach((l, lineIdx) => {
        if (l === pick.l) {
          segs.forEach((seg, si) => {
            cols.push({ el: seg, line: l, lineIdx, isSeg: true, isBig: si === bigIdx, fs: 46, w: 0 });
          });
        } else {
          cols.push({ el: l.tx, line: l, lineIdx, isSeg: false, isBig: false, fs: 46, w: 0 });
        }
      });

      const MAX_H = 580;
      for (const col of cols) {
        if (col.isBig) {
          col.el.style.fontSize = '100px';
          const h100 = c.size(col.el).h;
          col.fs = Math.min(190, h100 > 0 ? (100 * MAX_H) / h100 : 190);
        } else {
          col.el.style.fontSize = '46px';
          const h46 = c.size(col.el).h;
          col.fs = 46 * Math.min(1, MAX_H / Math.max(1, h46));
        }
        col.el.style.fontSize = px(col.fs);
        col.w = c.size(col.el).w;
      }
      const AVAIL_W = 1600 - 2 * 128;
      const MIN_GAP = 40;
      const gaps = Math.max(0, cols.length - 1);
      let sumW = cols.reduce((s, col) => s + col.w, 0);
      if (gaps > 0 && sumW + gaps * MIN_GAP > AVAIL_W) {
        const shrink = (AVAIL_W - gaps * MIN_GAP) / Math.max(1, sumW);
        for (const col of cols) {
          col.fs *= shrink;
          col.el.style.fontSize = px(col.fs);
          col.w = c.size(col.el).w;
        }
        sumW = cols.reduce((s, col) => s + col.w, 0);
      }
      if (segs[0]) pick.l.tx.style.fontSize = segs[0].style.fontSize;
      const S = gaps > 0 ? Math.min(130, Math.max(MIN_GAP, (AVAIL_W - sumW) / gaps)) : 0;
      const totalW = sumW + S * gaps;
      let right = 800 + totalW / 2;
      for (const col of cols) {
        const left = right - col.w;
        // 大字列在安全区（y 120–790）里整列居中，其余小字列顶部错开
        const top = col.isBig ? 455 - c.size(col.el).h / 2 : 136 + (col.lineIdx % 2) * 32;
        if (col.isSeg) {
          col.el.style.left = px(left);
          col.el.style.top = px(top);
        } else {
          put(col.line, left, top);
        }
        right = left - S;
      }
      return;
    }
    const X = [150, 336, 214, 412, 270];
    let f = 1;
    c.lines.forEach((l, i) => {
      l.tx.style.fontSize = '23px';
      f = Math.min(f, (1450 - X[i]!) / Math.max(1, c.size(l.tx).w));
    });
    let fs = 23 * f;
    const K = c.cjk ? 4.2 : 5.9;
    const gapOf = (v: number) => v * K * 0.25 + (c.hasTr ? 18 : 0);
    // 整组高度（含大字行的真实行高）不超过 640，居中在安全区（y 125–765）；超了就整体缩小
    const stackH = () => {
      for (const l of c.lines) l.tx.style.fontSize = px(fs);
      return c.lines.reduce((a, l) => a + c.size(l.el).h, 0) + gapOf(fs) * (n - 1);
    };
    let total = stackH();
    for (let it = 0; it < 3 && total > 640; it++) {
      fs *= Math.max(0.4, 640 / total);
      total = stackH();
    }
    let y = 445 - total / 2;
    c.lines.forEach((l, i) => {
      put(l, X[i]!, y, fs);
      y += c.size(l.el).h + gapOf(fs);
    });
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
/** 竖排书脊：细线从书脊右边缘连到其余竖列的左边缘（layout 量好，finish 画）。 */
const spineV = new WeakMap<HTMLElement, { x0: number; x1: number }>();
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
      // 竖排（2026-11-25 用户定稿）：和横排书脊一个意思——书脊那句贴左边、整高一列粗字（x 从 140 起，y 140–790，字号自适应、最大 150），
      // 一条封面色细线连到其余句子；其余句子是斜体 / 衬线竖列，从右边（x ≈ 1400）往左排，顶约 200、底不过 790。
      sp.el.classList.add('lt-spine-v');
      fitTo(c, sp.tx, 650, true, 150);
      const h = c.size(sp.tx).h;
      const wSp = c.size(sp.tx).w;
      put(sp, 140, 140 + (650 - h) / 2);
      let f = 1;
      for (const l of rest) {
        l.el.classList.add('lt-ital');
        l.tx.style.fontSize = '52px';
        f = Math.min(f, 590 / Math.max(1, c.size(l.tx).h));
      }
      const rfs = 52 * f;
      const col = rest.length ? Math.max(...rest.map((l) => c.size(l.tx).w)) : 0;
      const step = col + 56 * f;
      rest.forEach((l, j) => put(l, 1400 - col - j * step, 200, rfs));
      spineV.set(c.page, { x0: 140 + wSp + 30, x1: 1400 - rest.length * step + 56 * f - 20 });
      return;
    }
    const cut = splitAt(sp, c.cjk, c.cjk ? 7 : 14);
    const rows = cut > 0 ? segment(sp, [cut], () => 'lp-row lp-fit') : [sp.tx];
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
    lift(c, sp, 122, 776);
  },
  finish: (c) => {
    if (c.vert) {
      const v = spineV.get(c.page);
      // 细线贴着书脊右侧竖下来（像书脊的边）；原来一条横线横穿中间的空白，看着随意（主对话 2026-11-25 审截图后改）
      if (v) deco(c, 'lp-hair', { left: px(v.x0), top: '150px', width: '1px', height: '630px' });
      return;
    }
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
    // lp-fit：每一行 / 列按自己的字数量宽（不然块级的行会撑到最长那行的宽度，短行量出来和长行一样长），字距也按本行字号算
    const segs = cut > 0 ? segment(l, [cut], () => 'lp-row lp-fit') : [l.tx];
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
      // 高 ≤ 640，居中在安全区（y 125–765）：底端在播放条上方留足，顶端不碰页码
      const H0 = 640;
      const GAP = 30;
      const W = (H: number) => rows.reduce((a, r, i) => a + ((100 * H) / r.n) * LH + (i && r.first ? (GAP * H) / H0 : 0), 0);
      const H = Math.min(H0, (H0 * 1250) / W(H0));
      let x = 800 + W(H) / 2;
      const top = 445 - H / 2;
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
    // 整块高 ≤ 630，居中在安全区（y 130–760）：大写字形比行盒高出约 .17em，最后一行底端仍在播放条上方 ≥ 10px，译文也不碰页码
    const W = Math.min(W0, (W0 * 630) / Ht(W0));
    const top0 = 445 - Ht(W) / 2;
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
    // 句数 ≤ 3：译文排一栏（一条一行）；4–5 句两栏。页脚最底一行（24px 高）不过 y 780
    const rows = n <= 3 ? n : Math.ceil(n / 2);
    const footY = Math.min(Math.max(640, top0 + n * step + 70), 780 - 24 - (rows - 1) * 32);
    deco(c, 'lp-hair', { left: '232px', top: px(footY - 28), width: '140px', height: '1px' });
    c.lines.forEach((l, i) => {
      const t = lift(c, l, 232 + Math.floor(i / rows) * 520, footY + (i % rows) * 32, 'is-fn');
      if (t) t.dataset.n = String(i + 1);
    });
  },
};
