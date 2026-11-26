import { hslToRgb, rgbToHsl } from '../../lib/coverColors';
import { oklabToRgb, rgbToOklab } from '../../lib/space/tone';
import { unitBox } from './bold-d';
import { deco, flatten, glyphs, norm, px, segment, unitP } from './kit';
import { PW, type PageHooks, type TCtx, type TLine, type Tpl } from './types';

/**
 * 样张 O 第二批（2026-11-25 用户认可）：错版套印、负形镂空。
 * 错版套印 = 副歌里唱两遍的短语是两块版，印在同一处，第二遍唱到哪里哪里合成墨色；
 * 负形镂空 = 整页一张封面色的纸，拖得最久的那个词被裁掉，唱过的部分露出底下的星云。
 * 横排（拉丁、日韩）和竖排（中文）两种（负形镂空的横排只给拉丁）。坐标一律是 1600 × 900 的逻辑像素。
 */

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const allTimed = (c: TCtx) => c.lines.every((l) => l.units.length > 0 && l.eu?.length === l.units.length);
const keyOf = (u: HTMLElement) => norm(u.textContent ?? '');
/** 拉丁小写里伸出 x 高的字母（短语前面的小词要坐在它们之间的空当里）。 */
const TALL = /[bdfhijklt0-9]/;

let measureCtx: CanvasRenderingContext2D | null = null;
function textW(font: string, ls: number, s: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const g = measureCtx;
  if (!g) return s.length * 50;
  g.font = font;
  (g as unknown as { letterSpacing: string }).letterSpacing = `${ls}px`;
  return g.measureText(s).width;
}

/**
 * 一个词里能坐下小字的空当：从第 i 个字母起连续都是 x 高的字母、宽度够 need。返回空当左边离词首多远；没有为 -1。
 * 第一个字母不算（样张：So 坐在 b 的高低差里，空当在 b 后面）。
 */
function xSlot(word: string, font: string, ls: number, need: number): number {
  const w = word.toLowerCase();
  for (let i = 1; i < w.length; i++) {
    if (TALL.test(w[i]!)) continue;
    let j = i;
    while (j < w.length && !TALL.test(w[j]!)) j++;
    const x0 = textW(font, ls, w.slice(0, i));
    const x1 = textW(font, ls, w.slice(0, j)) - ls;
    if (x1 - x0 >= need) return x0;
    i = j;
  }
  return -1;
}

/** 按宽度把一段字断成几行（拉丁只在词缝断，中日韩任意两字之间都能断）。返回每行第一个字的下标。 */
function wrap(c: TCtx, l: TLine, from: number, to: number, width: number): number[] {
  const bx = l.units.map((u) => unitBox(c, u));
  const starts = [from];
  let x0 = bx[from]!.x;
  for (let i = from + 1; i <= to; i++) {
    const canBreak = c.cjk || !!l.eu![i - 1]!.sp;
    if (canBreak && bx[i]!.x + bx[i]!.w - x0 > width) {
      starts.push(i);
      x0 = bx[i]!.x;
    }
  }
  return starts;
}

/** 竖排的几列同一字号 f，起点在 top：最高的那列要收在 790 以内（播放条从 808 起；竖排字距把列拉长，只能量出来）。返回收完的字号。 */
function fitCol(c: TCtx, els: HTMLElement[], f: number, top: number): number {
  for (let k = 0; k < 4; k++) {
    for (const e of els) e.style.fontSize = px(f);
    const h = Math.max(0, ...els.map((e) => c.size(e).h));
    if (h <= 0 || top + h <= 790) break;
    f = Math.floor(f * ((790 - top) / h) * 100) / 100;
  }
  return f;
}

// ———— 错版套印（副歌）————
interface Reg {
  /** 两遍各在哪一句、从第几个字起；m = 短语几个字（单位）。 */
  l1: number;
  a1: number;
  l2: number;
  a2: number;
  m: number;
}

/** 本页唱两遍的短语：一句之内，或两句开头相同；拉丁 2–4 个词，中日韩 2–5 个字。取最长的。 */
function findReg(c: TCtx): Reg | null {
  const ks = c.lines.map((l) => l.units.map(keyOf));
  const ok = (m: number, li: number, a: number) => {
    const us = c.lines[li]!.units.slice(a, a + m);
    const g = glyphs(us.map((u) => u.textContent ?? '').join(''));
    // 拉丁按词算、中日韩按字算；短语里的拉丁词要在词首（不能从一个词的半截开始）
    if (c.cjk) return g >= 2 && g <= 5;
    return m >= 2 && m <= 4 && (a === 0 || !!c.lines[li]!.eu![a - 1]!.sp) && g <= 22;
  };
  const same = (li: number, a: number, lj: number, b: number, m: number) => {
    for (let k = 0; k < m; k++) if (!ks[li]![a + k] || ks[li]![a + k] !== ks[lj]![b + k]) return false;
    return true;
  };
  for (let m = c.cjk ? 5 : 4; m >= 2; m--) {
    // 一句之内唱两遍（不重叠，中间最多隔两个字）
    for (let li = 0; li < c.lines.length; li++) {
      const n = ks[li]!.length;
      for (let a = 0; a + 2 * m <= n; a++) {
        for (let b = a + m; b <= Math.min(n - m, a + m + 2); b++) {
          if (same(li, a, li, b, m) && ok(m, li, a)) return { l1: li, a1: a, l2: li, a2: b, m };
        }
      }
    }
    // 两句开头相同（相邻两句优先）
    for (let li = 0; li + 1 < c.lines.length; li++) {
      for (let lj = li + 1; lj < c.lines.length; lj++) {
        if (ks[li]!.length >= m && ks[lj]!.length >= m && same(li, 0, lj, 0, m) && ok(m, li, 0)) return { l1: li, a1: 0, l2: lj, a2: 0, m };
      }
    }
  }
  return null;
}

/**
 * 印色 B 的下限（OKLCH 明度 ≥ .62、彩度 ≥ .09，色相保留；彩度原定 .06，黑白封面上仍偏橄榄发闷，主对话 2026-11-25 提到 .09）：深色封面上 (墨 − A) × .62 + 副色 × .42 会算成发灰的脏紫 / 卡其。
 * 近乎无彩时（色相是噪声）取 A 的补色；A、B 两块版靠 OKLab 距离兜底，太近就把 B 的明度往远离 A 的一侧推。
 */
function floorOklch(B: [number, number, number], A: [number, number, number]): [number, number, number] {
  const hue = (t: [number, number, number]) => Math.atan2(t[2], t[1]);
  const lb = rgbToOklab(...B);
  const la = rgbToOklab(...A);
  // 近乎无彩时色相是噪声：（墨 − A）本来就是 A 的补色方向，就取 A 的补色
  const h = Math.hypot(lb[1], lb[2]) < 0.02 ? hue(la) + Math.PI : hue(lb);
  const make = (L: number, C: number) => oklabToRgb(L, C * Math.cos(h), C * Math.sin(h));
  let L = Math.max(lb[0], 0.62);
  const C = Math.max(Math.hypot(lb[1], lb[2]), 0.09);
  let out = make(L, C);
  const dist = (x: [number, number, number]) => {
    const p = rgbToOklab(...x);
    return Math.hypot(p[0] - la[0], p[1] - la[1], p[2] - la[2]);
  };
  if (dist(out) < 0.12) {
    // 太像 A：往远离 A 的明度方向推，推不动（顶到 .62 的下限）就往另一侧
    L = la[0] > 0.7 ? Math.max(0.62, la[0] - 0.14) : Math.min(0.95, la[0] + 0.14);
    out = make(L, C);
  }
  return out;
}

/** 印色 B：墨色减去 A，再掺一半封面副色、略提亮（规格：(墨 − A) × .62 + 副色 × .42 + 20）。两版叠在一起接近墨色。 */
function plateColors(): { a: string; b: string } {
  const st = document.documentElement.style;
  const rgb = (v: string, d: [number, number, number]): [number, number, number] => {
    const n = (v.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    return n.length === 3 ? [n[0]!, n[1]!, n[2]!] : d;
  };
  const acc = rgb(st.getPropertyValue('--acc'), [201, 207, 219]);
  const c2 = rgb(st.getPropertyValue('--e2'), [92, 96, 104]);
  const [h, s] = rgbToHsl(...acc);
  const A = hslToRgb(h, s, 0.6);
  const ink = A.map((v) => v + (255 - v) * 0.72);
  const B0 = A.map((v, i) => Math.round(clamp((ink[i]! - v) * 0.62 + c2[i]! * 0.42 + 20, 0, 255)));
  const B = floorOklch(B0 as [number, number, number], A);
  return { a: `rgb(${A.join(' ')})`, b: `rgb(${B.join(' ')})` };
}

interface RegGeo {
  reg: Reg;
  /** 短语每行（竖排每列）的左上角；两遍同一位置。 */
  rows: { x: number; y: number }[];
  fs: number;
  /** 块的外框与第二块版的错位原点。 */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const regGeo = new WeakMap<HTMLElement, RegGeo>();
const REG_MARK = '<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="10"/><path d="M20 0V40M0 20H40"/></svg>';

export const register: Tpl = {
  id: 'register',
  bold: true,
  fits: (c) => {
    if (c.lines.length < 2 || c.lines.length > 5 || !allTimed(c)) return false;
    const r = findReg(c);
    if (!r) return false;
    // 竖排：短语要在句首（两句开头相同，或一句里紧挨着唱两遍）
    if (c.vert && (r.a1 !== 0 || (r.l1 === r.l2 && r.a2 !== r.m))) return false;
    return c.lines.every((l) => glyphs(l.text) <= (c.cjk ? 16 : 44));
  },
  layout: (c) => {
    const r = findReg(c)!;
    const vert = c.vert;
    for (const l of c.lines) {
      l.el.classList.add('lt-reg');
      if (l.tr) l.tr.className = 'lp-tr is-under';
    }
    const L1 = c.lines[r.l1]!;
    const L2 = c.lines[r.l2]!;
    // 短语的字号：拉丁每个词一行；中日韩横排两字一行，竖排两字一列
    const per = c.cjk ? 2 : 1;
    const rowsN = Math.ceil(r.m / per);
    const rowStarts = Array.from({ length: rowsN }, (_, i) => i * per);
    const phraseW = (fs: number) => {
      // 用第一遍的字量（两遍文字相同）
      L1.tx.style.fontSize = px(fs);
      let w = 0;
      for (const s of rowStarts) {
        const us = L1.units.slice(r.a1 + s, r.a1 + Math.min(r.m, s + per));
        const a = unitBox(c, us[0]!);
        const z = unitBox(c, us[us.length - 1]!);
        w = Math.max(w, vert ? z.y + z.h - a.y : z.x + z.w - a.x);
      }
      return w;
    };
    // 先用 100px 量，再按「撑到约 1050 宽、整块不高过 690」定字号
    L1.el.classList.add('lt-reg-big');
    const w100 = phraseW(100);
    let fs: number;
    if (vert) fs = Math.min(366, (100 * 732) / Math.max(1, w100), 1000 / rowsN);
    else fs = Math.min(432, (100 * 1050) / Math.max(1, w100), 690 / (rowsN * (c.cjk ? 1 : 0.775)));
    L1.el.classList.remove('lt-reg-big');
    const LH = vert ? 1 : c.cjk ? 1 : 0.775;
    // 栏里的字从 34 起排；右栏排不下（整栏高过 660，底边会沉进播放条）就逐步收小字号重排（每次重新切段）
    const arrange = (COL_FS: number): number => {
      // 重排前先撤掉上一遍的分段：量字（wrap）要在整句平排的样子上量
      for (const l of c.lines) flatten(l);
      // —— 两遍所在的句子：按「前文 / 短语每行 / 后文（再按栏宽断行）」切段，段都绝对定位在页上 ——
      const restRows = new Map<TLine, number[]>();
      for (const l of [L1, L2]) {
        if (restRows.has(l)) continue;
        l.tx.style.fontSize = px(COL_FS);
        const occ = l === L1 && l === L2 ? [r.a1, r.a2] : [l === L1 ? r.a1 : r.a2];
        const cuts = new Set<number>();
        for (const a of occ) {
          for (const s of rowStarts) cuts.add(a + s);
          cuts.add(a + r.m);
        }
        const end = Math.max(...occ) + r.m;
        if (end < l.units.length) for (const s of wrap(c, l, end, l.units.length - 1, vert ? 700 : 250)) cuts.add(s);
        const list = [...cuts].filter((k) => k > 0 && k < l.units.length).sort((x, y) => x - y);
        restRows.set(l, list);
      }
      const segsOf = new Map<TLine, HTMLElement[]>();
      for (const [l, cuts] of restRows) {
        segsOf.set(l, segment(l, cuts, () => 'lp-reg-seg'));
        l.el.style.left = '0px';
        l.el.style.top = '0px';
      }
      const segStart = (l: TLine, seg: HTMLElement) => l.units.indexOf(seg.querySelector<HTMLElement>('.u')!);
      // —— 短语的位置 ——
      const rows: { x: number; y: number }[] = [];
      let x0: number;
      let y0: number;
      let x1: number;
      let y1: number;
      if (vert) {
        const xr = 1432;
        for (let i = 0; i < rowsN; i++) rows.push({ x: xr - (i + 1) * fs, y: 66 });
        x0 = xr - rowsN * fs;
        x1 = xr;
        y0 = 66;
        y1 = 66 + Math.min(per, r.m) * fs;
      } else {
        // 横排：短语前面的小词坐在第一个词的高低差里；坐不下就整块往下让出一行
        const pre = L1.units.slice(0, r.a1);
        let top = 104;
        if (pre.length && !c.cjk) {
          const font = `900 ${fs}px Inter`;
          const preW = textW('italic 600 74px Newsreader', 0, pre.map((u) => u.textContent ?? '').join(' ')) + 24;
          if (xSlot(L1.units[r.a1]!.textContent ?? '', font, -0.042 * fs, preW) < 0) top += 96;
        } else if (pre.length) top += 96;
        for (let i = 0; i < rowsN; i++) rows.push({ x: 104, y: top + i * fs * LH });
        x0 = 104;
        y0 = top;
        x1 = 104 + (w100 * fs) / 100;
        y1 = top + rowsN * fs * LH;
      }
      // 把两遍的短语段放到同一位置，前文 / 后文段放到各自的地方
      const colItems: { l: TLine; segs: HTMLElement[]; tone: 'a' | 'b' | null }[] = [];
      for (const [l, segs] of segsOf) {
        const occ = l === L1 && l === L2 ? [r.a1, r.a2] : [l === L1 ? r.a1 : r.a2];
        const rest: HTMLElement[] = [];
        for (const seg of segs) {
          const k = segStart(l, seg);
          const o = occ.findIndex((a) => k >= a && k < a + r.m);
          if (o >= 0) {
            const ri = Math.floor((k - occ[o]!) / per);
            seg.classList.add('lp-reg-w', o === 0 && l === L1 ? 'is-a' : 'is-b');
            seg.style.fontSize = px(fs);
            seg.style.left = px(rows[ri]!.x);
            seg.style.top = px(rows[ri]!.y);
          } else if (k < occ[0]!) {
            seg.classList.add('lp-reg-pre');
          } else rest.push(seg);
        }
        // 没有后文的句子，译文也要进栏（不让它孤零零挂在页角）
        if (rest.length || l.tr) colItems.push({ l, segs: rest, tone: l === L1 && l !== L2 ? 'a' : 'b' });
      }
      // 前文（「So」）：坐进第一个词的空当（xSlot），坐不下就放在块的左上方
      const preSeg = segsOf.get(L1)!.find((s) => s.classList.contains('lp-reg-pre')) ?? null;
      if (preSeg && !vert) {
        const font = `900 ${fs}px Inter`;
        const preW = c.size(preSeg).w;
        const sx = c.cjk ? -1 : xSlot(L1.units[r.a1]!.textContent ?? '', font, -0.042 * fs, preW + 24);
        preSeg.style.left = px(sx >= 0 ? 104 + sx + 10 : 104 + fs * 0.04);
        preSeg.style.top = px(sx >= 0 ? y0 + fs * 0.2 - 92 : y0 - 96);
      }
      // —— 其余句子：横排在右下一栏（宽 250，底边对齐 710）；竖排在块的左边一列列往左排 ——
      const others = c.lines.filter((l) => l !== L1 && l !== L2);
      if (vert) {
        // 左边的列：句子（竖排各列）、译文（一列竖排小字，紧贴在所属句子那一列的左边）从右往左排进块左边的空间；
        // 列太多放不下（会挤出左边、列叠在一起）就把句子的字号和间距按比例收小，译文列宽度不变
        interface Col {
          /** 列宽（译文列含它和左邻列之间的 12px）与排完之后到下一列的间距。 */
          w: number;
          gap: number;
          fixed?: boolean;
          /** xr = 这一列的右边缘；k = 句子列的缩放。 */
          place: (xr: number, k: number) => void;
        }
        const cols: Col[] = [];
        // 版面竖排页目前不排译文（LyricPage 只给横排页建 .lp-tr），这里拿不到 tr 时直接跳过；留着是为以后竖排开译文
        const trCol = (l: TLine, top: number, gap: number) => {
          const tr = l.tr;
          if (!tr) return;
          c.page.appendChild(tr);
          tr.className = 'lp-tr is-free is-reg-v';
          tr.style.top = px(top);
          tr.style.maxHeight = px(Math.max(160, 750 - top));
          const tw = c.size(tr).w;
          cols.push({ w: 12 + tw, gap, fixed: true, place: (xr) => (tr.style.left = px(xr - 12 - tw)) });
        };
        for (const it of colItems) {
          const top = it.tone === 'a' ? 96 : 236;
          it.segs.forEach((seg, i) => {
            const n = glyphs(seg.textContent ?? '');
            const f = fitCol(c, [seg], Math.min(60, 700 / Math.max(1, n)), top);
            seg.classList.add('lp-reg-tone', it.tone === 'a' ? 'is-a' : 'is-b');
            cols.push({
              w: f,
              gap: i < it.segs.length - 1 || !it.l.tr ? 38 : 0,
              place: (xr, k) => {
                seg.style.fontSize = px(f * k);
                seg.style.left = px(xr - f * k);
                seg.style.top = px(top);
              },
            });
          });
          trCol(it.l, top, 38);
        }
        const nSeg = cols.length;
        for (const l of others) {
          const n = glyphs(l.text);
          const f = fitCol(c, [l.tx], Math.min(38, 420 / Math.max(1, n)), 372);
          l.el.classList.add('lt-reg-col');
          l.el.style.top = '372px';
          cols.push({
            w: f,
            gap: l.tr ? 0 : 34,
            place: (xr, k) => {
              l.tx.style.fontSize = px(f * k);
              l.el.style.left = px(xr - f * k);
            },
          });
          trCol(l, 372, 34);
        }
        const xStart = x0 - 80;
        const extra = others.length ? 24 : 0;
        const fixedW = cols.reduce((a, q) => a + (q.fixed ? q.w + q.gap : 0), 0);
        const softW = cols.reduce((a, q) => a + (q.fixed ? 0 : q.w + q.gap), 0);
        const k = softW > 0 ? clamp((xStart - 40 - fixedW - extra) / softW, 0.5, 1) : 1;
        let x = xStart;
        cols.forEach((q, i) => {
          if (i === nSeg) x -= extra;
          q.place(x, k);
          x -= q.fixed ? q.w + q.gap : (q.w + q.gap) * k;
        });
        regGeo.set(c.page, { reg: r, rows, fs, x0, y0, x1, y1 });
        return 0;
      }
      // 横排的右栏：每块一段 34px 衬线（宽 250 断行），块间 26，整栏底边对齐 710
      const COL_X = Math.max(1278, x1 + 90);
      const blocks: { h: number; place: (y: number) => void }[] = [];
      for (const it of colItems) {
        const lh = COL_FS * 1.16;
        // 译文和栏里的句子同一栏、同一宽（250 断行）：跟在它那句（后文）下面；没有后文就只有译文一条
        const tr = it.l.tr;
        let th = 0;
        if (tr) {
          c.page.appendChild(tr);
          tr.className = 'lp-tr is-free is-reg-col';
          th = c.size(tr).h;
        }
        blocks.push({
          h: it.segs.length * lh + (tr ? th + (it.segs.length ? 6 : 0) : 0),
          place: (y) => {
            it.segs.forEach((seg, i) => {
              seg.classList.add('lp-reg-tone', it.tone === 'a' ? 'is-a' : 'is-b');
              seg.style.left = px(COL_X);
              seg.style.top = px(y + i * lh);
            });
            if (tr) {
              tr.style.left = px(COL_X);
              tr.style.top = px(y + it.segs.length * lh + (it.segs.length ? 6 : 0));
            }
          },
        });
      }
      for (const l of others) {
        l.el.classList.add('lt-reg-col');
        l.tx.style.fontSize = px(COL_FS);
        const starts = wrap(c, l, 0, l.units.length - 1, 250);
        const rowsL = segment(l, starts.filter((k) => k > 0), () => 'lp-row');
        if (l.tr) l.tr.className = 'lp-tr is-under is-reg-col';
        blocks.push({
          h: rowsL.length * COL_FS * 1.16 + (l.tr ? c.size(l.tr).h + 4 : 0),
          place: (y) => {
            l.el.style.left = px(COL_X);
            l.el.style.top = px(y);
          },
        });
      }
      const total = blocks.reduce((a, b) => a + b.h, 0) + 26 * Math.max(0, blocks.length - 1);
      let y = Math.max(120, 710 - total);
      for (const b of blocks) {
        b.place(y);
        y += b.h + 26;
      }
      regGeo.set(c.page, { reg: r, rows, fs, x0, y0, x1, y1 });
      return total;
    };
    let colFs = 34;
    let total = arrange(colFs);
    while (total > 660 && colFs > 20) total = arrange((colFs -= 2));
  },
  finish: (c) => {
    const g = regGeo.get(c.page);
    if (!g) return;
    const vert = c.vert;
    // 每页的第二块版往不同方向错（下一次出现方向取反）
    const sign = c.first % 2 ? -1 : 1;
    const tf = vert ? `translate(${-24 * sign}px, 20px) rotate(${1.3 * sign}deg)` : `translate(${30 * sign}px, 20px) rotate(${-1.5 * sign}deg)`;
    const origin = vert ? `${px(g.x1)} ${px(g.y0)}` : `${px(g.x0)} ${px(g.y1)}`;
    // 不透明的纸垫在本页最底下：加色混合要有底色，不然黑填充的轮廓那一层会露出黑底（规格：外层不要 isolation）
    deco(c, 'lp-reg-paper');
    const cols = plateColors();
    const undo: Array<() => void> = [];
    const wrapPlate = (segs: HTMLElement[], cls: string) => {
      if (!segs.length) return null;
      const w = document.createElement('span');
      w.className = `lp-plate ${cls}`;
      segs[0]!.before(w);
      for (const s of segs) w.appendChild(s);
      undo.push(() => {
        w.replaceWith(...segs);
      });
      return w;
    };
    const L1 = c.lines[g.reg.l1]!;
    const L2 = c.lines[g.reg.l2]!;
    const segsA = [...L1.tx.querySelectorAll<HTMLElement>('.lp-reg-w.is-a')];
    const segsB = [...L2.tx.querySelectorAll<HTMLElement>('.lp-reg-w.is-b')];
    const A = wrapPlate(segsA, 'is-a');
    const B = wrapPlate(segsB, 'is-b');
    for (const s of segsA) s.querySelectorAll<HTMLElement>('.u').forEach((u) => u.classList.add('lp-pc', 'lp-still'));
    for (const s of segsB) s.querySelectorAll<HTMLElement>('.u').forEach((u) => u.classList.add('lp-pc', 'lp-pb', 'lp-still'));
    // 第二块版的轮廓：一份静止的克隆（黑填充、描边，黑在加色下看不见），叠在两块版中间
    let O: HTMLElement | null = null;
    if (B) {
      O = B.cloneNode(true) as HTMLElement;
      O.className = 'lp-plate is-o lp-deco';
      O.setAttribute('aria-hidden', 'true');
      B.before(O);
      undo.push(() => O?.remove());
      for (const w of [B, O]) {
        w.style.transformOrigin = origin;
        w.style.transform = tf;
        w.dataset.rot = String(vert ? 1.3 * sign : -1.5 * sign);
      }
    }
    for (const w of [A, B, O]) w?.style.setProperty('--lp-pc', w === A ? cols.a : cols.b);
    // 套准十字：各自属于自己的版，跟着一起偏
    const marks = (cls: string, color: string, transform: string) => {
      const m = deco(c, `lp-reg-marks ${cls}`, { transformOrigin: origin, transform });
      m.style.setProperty('--lp-pc', color);
      const pts = vert
        ? [
            [g.x1 + 34, g.y0 + 4],
            [g.x1 + 34, g.y1 - 44],
          ]
        : [
            [g.x1 + 58, g.y0 + 10],
            [g.x1 + 58, g.y1 - 40],
          ];
      for (const [x, y] of pts) {
        const s = document.createElement('i');
        s.innerHTML = REG_MARK;
        s.style.left = px(x!);
        s.style.top = px(y!);
        m.appendChild(s);
      }
    };
    marks('is-a', cols.a, 'none');
    marks('is-b', cols.b, tf);
    // 前文 / 后文的段：用各自那块版的颜色印（样张竖排）
    for (const s of [...L1.tx.querySelectorAll<HTMLElement>('.lp-reg-tone'), ...(L2 !== L1 ? [...L2.tx.querySelectorAll<HTMLElement>('.lp-reg-tone')] : [])]) {
      s.style.setProperty('--lp-pc', s.classList.contains('is-a') ? cols.a : `color-mix(in srgb, ${cols.b} 72%, #fff)`);
      s.querySelectorAll<HTMLElement>('.u').forEach((u) => u.classList.add('lp-pc'));
    }
    // 封面换了（取色有 1.4s 过渡，建页时可能还是上一首的颜色）：印色跟着更新
    let accSeen = document.documentElement.style.getPropertyValue('--acc') + document.documentElement.style.getPropertyValue('--e2');
    const hooks: PageHooks = {
      frame: () => {
        const now = document.documentElement.style.getPropertyValue('--acc') + document.documentElement.style.getPropertyValue('--e2');
        if (now === accSeen) return;
        accSeen = now;
        const k = plateColors();
        A?.style.setProperty('--lp-pc', k.a);
        B?.style.setProperty('--lp-pc', k.b);
        O?.style.setProperty('--lp-pc', k.b);
      },
      undo: () => {
        for (const f of undo.reverse()) f();
      },
    };
    return hooks;
  },
};

// ———— 负形镂空（最后一遍副歌 / 尾声，末句收在长音上）————
/** 中文里不该被单独裁出来的字：虚字、方位、趋向。 */
const WEAK = new Set([...'的了着过吗呢吧啊哦呀和与而之以为于把被让给对从向到得地又还啦嘛上下里中来去在是我你他她它']);

/** 裁哪个字：末句最后一个字唱到 1.2s 以上才用这套；竖排在本页所有拖长的单字里挑（虚字打八折），横排就是末句最后一个词。 */
function cutPick(c: TCtx): { li: number; ui: number } | null {
  const z = c.lines.length - 1;
  const L = c.lines[z]!;
  const k = L.units.length - 1;
  const e = L.eu?.[k];
  if (!e || e.e - e.s < 1.2) return null;
  if (c.vert) {
    let best: { li: number; ui: number } | null = null;
    let score = 0;
    c.lines.forEach((l, li) =>
      l.eu?.forEach((u, ui) => {
        const t = u.t.replace(/[^\p{L}\p{N}]/gu, '');
        if ([...t].length !== 1 || u.e - u.s < 1.2) return;
        const s = (u.e - u.s) * (WEAK.has(t) ? 0.8 : 1);
        if (s > score) {
          score = s;
          best = { li, ui };
        }
      }),
    );
    return best;
  }
  if (c.cjk) return null;
  const t = e.t.replace(/[^A-Za-z]/g, '');
  if (t.length < 3 || t.length > 6 || (k > 0 && !L.eu![k - 1]!.sp)) return null;
  return { li: z, ui: k };
}

interface CutGeo {
  li: number;
  ui: number;
  fs: number;
  /** 大字的左边、基线（横排）/ 左上角（竖排）。 */
  x: number;
  y: number;
  /** 大字的字形文字。 */
  text: string;
}
const cutGeo = new WeakMap<HTMLElement, CutGeo>();

export const cut: Tpl = {
  id: 'cut',
  bold: true,
  fits: (c) => c.lines.length >= 1 && c.lines.length <= 4 && allTimed(c) && cutPick(c) != null && c.lines.every((l) => glyphs(l.text) <= (c.cjk ? 14 : 40)),
  layout: (c) => {
    const pk = cutPick(c)!;
    for (const l of c.lines) {
      l.el.classList.add('lt-cut');
      if (l.tr) l.tr.className = 'lp-tr is-under';
    }
    const H = c.lines[pk.li]!;
    const word = (H.units[pk.ui]!.textContent ?? '').trim();
    // 大字那句切成「前文 / 大字 / 后文」三段，都绝对定位
    const cuts = [pk.ui, pk.ui + 1].filter((k) => k > 0 && k < H.units.length);
    const segs = segment(H, cuts, () => 'lp-cut-seg');
    H.el.style.left = '0px';
    H.el.style.top = '0px';
    const bigSeg = segs.find((s) => s.contains(H.units[pk.ui]!))!;
    const pre = segs.filter((s) => s !== bigSeg && H.units.indexOf(s.querySelector<HTMLElement>('.u')!) < pk.ui);
    const post = segs.filter((s) => s !== bigSeg && !pre.includes(s));
    bigSeg.classList.add('lp-cut-big');
    H.units[pk.ui]!.classList.add('lp-cutsrc', 'lp-still');
    if (c.vert) {
      // 竖排：前面的句子和前文在大字右边，后文和后面的句子在左边，从右往左读下来
      const before = c.lines.slice(0, pk.li);
      const after = c.lines.slice(pk.li + 1);
      const colW = (n: number, f: number) => f + (n > 0 ? 32 : 0);
      const preN = pre.reduce((a, s) => a + glyphs(s.textContent ?? ''), 0);
      const postN = post.reduce((a, s) => a + glyphs(s.textContent ?? ''), 0);
      const preF = preN ? fitCol(c, pre, Math.min(84, 700 / preN), 92) : 0;
      const postF = postN ? fitCol(c, post, Math.min(64, 700 / postN), 92) : 0;
      const right = before.length * 72 + (preN ? colW(1, preF) : 0);
      const left = (postN ? colW(1, postF) + 40 : 0) + after.length * 72;
      const fs = clamp(1440 - right - left - 80, 380, 800);
      let x = 1500;
      for (const l of before) {
        x -= 40;
        l.el.style.left = px(x);
        l.el.style.top = '92px';
        fitCol(c, [l.tx], Math.min(40, 700 / Math.max(1, glyphs(l.text))), 92);
        x -= 32;
      }
      if (preN) {
        x -= preF;
        for (const s of pre) {
          s.style.fontSize = px(preF);
          s.style.left = px(x);
          s.style.top = '92px';
        }
        x -= 40;
      }
      const bx = x - fs;
      const by = 24 + (800 - fs) * 0.3;
      bigSeg.style.fontSize = px(fs);
      bigSeg.style.left = px(bx);
      bigSeg.style.top = px(by);
      x = bx - 40;
      if (postN) {
        x -= postF;
        for (const s of post) {
          s.style.fontSize = px(postF);
          s.style.left = px(x);
          s.style.top = '92px';
        }
        x -= 60;
      }
      for (const l of after) {
        x -= 40;
        l.el.style.left = px(Math.max(40, x));
        l.el.style.top = '92px';
        fitCol(c, [l.tx], Math.min(40, 700 / Math.max(1, glyphs(l.text))), 92);
        x -= 32;
      }
      cutGeo.set(c.page, { li: pk.li, ui: pk.ui, fs, x: bx, y: by, text: word });
      return;
    }
    // 横排：大字撑到 1486 宽、基线 776；前面的句子在左上 56px 一行一句；同句前文坐在 x 高上方的空当里
    const font = (f: number) => `900 ${f}px Inter`;
    const w100 = textW(font(100), -5, word.toLowerCase());
    let fs = Math.min((100 * 1486) / Math.max(1, w100), 900);
    const BASE = 776;
    const earlier = c.lines.slice(0, pk.li);
    let stack = 84;
    earlier.forEach((l, i) => {
      l.el.style.left = '112px';
      l.el.style.top = px(84 + i * 104);
      l.tx.style.fontSize = '56px';
      // 一句太长就收小字号，别伸出画幅右边（左 112，右边留 112）
      const w56 = c.size(l.tx).w;
      if (w56 > 1376) l.tx.style.fontSize = px((56 * 1376) / w56);
      stack = 84 + i * 104 + 56 * 1.2 + (l.tr ? 30 : 0);
    });
    let preW = 0;
    if (pre.length) {
      pre[0]!.style.fontSize = '76px';
      preW = c.size(pre[0]!).w;
      // 前文太长（一整句）就收小字号，别伸出画幅右边
      if (preW > 1376) {
        pre[0]!.style.fontSize = px((76 * 1376) / preW);
        preW = c.size(pre[0]!).w;
      }
    }
    let slot = -1;
    // 字母伸出 x 高的部分（.76em）不能碰到上面那几句；前文要坐得进空当，否则改成单独一行、大字再缩一点
    for (let k = 0; k < 30; k++) {
      slot = pre.length ? xSlot(word, font(fs), -0.05 * fs, preW + 30) : -1;
      const top = BASE - 0.76 * fs;
      const preTop = BASE - 0.546 * fs - 104;
      const okStack = earlier.length === 0 || top >= stack + 16 || (slot < 0 ? false : preTop >= stack + 12);
      if (okStack && (slot >= 0 || !pre.length || top >= stack + 104)) break;
      fs *= 0.95;
    }
    const x0 = 28;
    bigSeg.style.fontSize = px(fs);
    bigSeg.style.left = px(x0);
    // Inter 行高 1 时基线在盒子顶下 .864em
    bigSeg.style.top = px(BASE - fs * 0.864);
    if (pre.length) {
      const pTop = slot >= 0 ? BASE - 0.546 * fs - 104 : Math.max(stack + 8, BASE - 0.76 * fs - 100);
      const pLeft = slot >= 0 ? x0 + slot + 14 : 112;
      for (const s of pre) {
        s.style.left = px(pLeft);
        s.style.top = px(pTop);
      }
      if (H.tr) {
        c.page.appendChild(H.tr);
        H.tr.className = 'lp-tr is-free';
        H.tr.style.left = px(pLeft + preW + 34);
        H.tr.style.top = px(pTop + 46);
      }
    } else if (H.tr) {
      c.page.appendChild(H.tr);
      H.tr.className = 'lp-tr is-free';
      H.tr.style.left = '112px';
      H.tr.style.top = px(BASE - 0.76 * fs - 34);
    }
    for (const s of post) s.style.display = 'none';
    cutGeo.set(c.page, { li: pk.li, ui: pk.ui, fs, x: x0, y: BASE, text: word.toLowerCase() });
  },
  finish: (c) => {
    const g = cutGeo.get(c.page);
    if (!g) return;
    const vert = c.vert;
    deco(c, 'lp-cut-sheet');
    const u = c.lines[g.li]!.units[g.ui]!;
    const L = c.lines[g.li]!;
    for (const l of c.lines) l.units.forEach((x) => x.classList.add('lp-onp'));
    // 颜色：从样式表里取（都只从封面算），画进画布
    const probe = deco(c, 'lp-cut-probe');
    const colorOf = (v: string) => {
      probe.style.color = `var(${v})`;
      return getComputedStyle(probe).color;
    };
    // 三层画布：刀线（没唱到）、纸厚（亮纸色）、窗（底下的星云）；扫光用遮罩，边缘硬
    const PAD = Math.round(g.fs * 0.3);
    let w: number;
    let h: number;
    let ox: number;
    let oy: number;
    if (vert) {
      w = g.fs + 2 * PAD;
      h = g.fs + 2 * PAD;
      ox = g.x - PAD;
      oy = g.y - PAD;
    } else {
      w = textW(`900 ${g.fs}px Inter`, -0.05 * g.fs, g.text) + 2 * PAD;
      h = g.fs * 1.25 + PAD;
      ox = g.x - PAD;
      oy = g.y - g.fs * 0.95 - PAD / 2;
    }
    const mk = (cls: string) => {
      const cv = document.createElement('canvas');
      cv.className = `lp-deco lp-cut-cv ${cls}`;
      Object.assign(cv.style, { left: px(ox), top: px(oy), width: px(w), height: px(h) });
      c.page.appendChild(cv);
      return cv;
    };
    const die = mk('is-die');
    const wall = mk('is-wall');
    const win = mk('is-win');
    const grain = deco(c, 'lp-cut-grain');
    grain.setAttribute('aria-hidden', 'true');
    const glyph = (g2: CanvasRenderingContext2D) => {
      if (vert) {
        g2.font = `900 ${g.fs}px 'Noto Serif SC', 'Songti SC', 'SimSun', serif`;
        g2.textAlign = 'center';
        g2.textBaseline = 'middle';
        return { x: w / 2, y: h / 2 - g.fs * 0.03 };
      }
      g2.font = `900 ${g.fs}px Inter`;
      (g2 as unknown as { letterSpacing: string }).letterSpacing = `${-0.05 * g.fs}px`;
      g2.textAlign = 'left';
      g2.textBaseline = 'alphabetic';
      return { x: PAD, y: g.y - oy };
    };
    const draw = () => {
      const fr = c.page.getBoundingClientRect();
      const S = fr.width / PW || 1;
      const res = Math.min(2.5, S * (window.devicePixelRatio || 1));
      const field = colorOf('--cut-field');
      const lit = colorOf('--cut-lit');
      for (const cv of [die, wall, win]) {
        cv.width = Math.ceil(w * res);
        cv.height = Math.ceil(h * res);
      }
      // 刀线：3px 描边、再用纸色填满，内侧一半被盖掉 = 1.5px
      const d = die.getContext('2d');
      if (d) {
        d.setTransform(res, 0, 0, res, 0, 0);
        const p = glyph(d);
        d.lineWidth = 3;
        d.lineJoin = 'round';
        d.strokeStyle = colorOf('--cut-die');
        d.strokeText(g.text, p.x, p.y);
        d.fillStyle = field;
        d.fillText(g.text, p.x, p.y);
      }
      const wl = wall.getContext('2d');
      if (wl) {
        wl.setTransform(res, 0, 0, res, 0, 0);
        const p = glyph(wl);
        wl.fillStyle = lit;
        wl.fillText(g.text, p.x, p.y);
      }
      // 窗：底下那片星云（舞台画布 + 挂着的封面），压暗、带一点封面的光，再按字形裁出来
      const n = win.getContext('2d');
      if (n) {
        n.setTransform(res, 0, 0, res, 0, 0);
        n.fillStyle = colorOf('--lp-paper');
        n.fillRect(0, 0, w, h);
        // 窗整体偏 (−3, −4)：画面也跟着对齐到舞台
        const toPage = (cx: number, cy: number) => [(cx - fr.left) / S - ox + 3, (cy - fr.top) / S - oy + 4] as const;
        n.save();
        n.filter = 'blur(1.6px) brightness(.62) saturate(.9)';
        const stars = document.querySelector<HTMLCanvasElement>('.space-stars');
        if (stars?.width) {
          const r = stars.getBoundingClientRect();
          const [x, y] = toPage(r.left, r.top);
          n.drawImage(stars, x, y, r.width / S, r.height / S);
        }
        document.querySelectorAll<HTMLImageElement>('.music-card .cover-img').forEach((img) => {
          if (!img.complete || !img.naturalWidth) return;
          const r = img.getBoundingClientRect();
          if (!(r.width > 0)) return;
          const [x, y] = toPage(r.left, r.top);
          const cw = r.width / S;
          const ch = r.height / S;
          if (x > w || y > h || x + cw < 0 || y + ch < 0) return;
          n.globalAlpha = parseFloat(getComputedStyle(img.closest('.music-card')!).opacity) || 1;
          n.drawImage(img, x, y, cw, ch);
        });
        n.restore();
        n.globalCompositeOperation = 'screen';
        const rg = n.createRadialGradient(w * 0.62, h * 0.7, 10, w * 0.62, h * 0.7, Math.max(w, h) * 0.7);
        rg.addColorStop(0, colorOf('--cut-glow'));
        rg.addColorStop(1, 'transparent');
        n.fillStyle = rg;
        n.fillRect(0, 0, w, h);
        n.globalCompositeOperation = 'destination-in';
        n.fillStyle = '#000';
        const p = glyph(n);
        n.fillText(g.text, p.x - 3, p.y - 4);
        n.globalCompositeOperation = 'source-over';
      }
    };
    draw();
    let lastCall = performance.now();
    let lastM = '';
    let lastHide = false;
    const frame = (t: number) => {
      const now = performance.now();
      // 页面重新出现（隔了一会儿才又被调用）：重画一次窗，取当时的星云和封面颜色
      if (now - lastCall > 400) draw();
      lastCall = now;
      // 转场替身飞着的时候，大字让给替身
      const hide = u.hasAttribute('data-flyhide') || L.el.style.opacity === '0';
      if (hide !== lastHide) {
        lastHide = hide;
        for (const cv of [die, wall, win]) cv.style.visibility = hide ? 'hidden' : '';
      }
      const p = unitP(L, g.ui, t);
      const len = vert ? h : w;
      const m = p <= 0 ? -20 : p >= 1 ? len + 20 : PAD + p * (len - 2 * PAD);
      const ms = m.toFixed(1);
      if (ms === lastM) return;
      lastM = ms;
      for (const cv of [wall, win]) cv.style.setProperty('--m', `${ms}px`);
      die.style.clipPath = p >= 1 ? 'inset(0 0 100% 0)' : vert ? `inset(${ms}px 0 0 0)` : `inset(0 0 0 ${ms}px)`;
    };
    frame(-1);
    if (vert) for (const cv of [wall, win]) cv.classList.add('is-v');
    return { frame };
  },
};
