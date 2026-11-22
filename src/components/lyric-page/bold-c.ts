import { deco, fitTo, glyphs, lift, put, px, segment, splitAt, stateAt, unitP } from './kit';
import { PH, PW, type PageHooks, type TCtx, type TLine, type Tpl } from './types';

/**
 * 样张 N 第三批（2026-11-22 用户定稿）：唱片纹、稿纸、转角。
 * 唱片纹所有语言都横排；稿纸只给中日韩（中文竖排、日韩横排）；转角横竖两种都有。
 * 坐标一律是 1600 × 900 的逻辑像素。
 */

const allTimed = (c: TCtx) => c.lines.every((l) => l.units.length > 0);
const maxGlyphs = (c: TCtx) => Math.max(...c.lines.map((l) => glyphs(l.text)));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface Gm {
  /** 字形左边（页内像素，只用来比较先后）。 */
  x: number;
  /** 字形的前进宽度（不含字距）。 */
  w: number;
  /** 盒子的内容宽 / 高（扣掉上色留白；宽含尾部字距）。 */
  cw: number;
  ch: number;
  ls: number;
}

/** 量一个字（或词）平排时的位置：外接框扣掉上色留白（同引擎 measureLine 的做法），再换回未缩放的像素。 */
function measureGlyph(el: HTMLElement, S: number): Gm {
  const cs = getComputedStyle(el);
  const n = (v: string) => parseFloat(v) || 0;
  const ls = n(cs.letterSpacing);
  const b = el.getBoundingClientRect();
  const cw = b.width / S - n(cs.paddingLeft) - n(cs.paddingRight);
  return { x: b.left / S + n(cs.paddingLeft), w: Math.max(0, cw - ls), cw, ch: b.height / S - n(cs.paddingTop) - n(cs.paddingBottom), ls };
}

// ———— 唱片纹（尾声）：沿同心圆弧排，背后一圈圈沟槽，底部露出唱片标签 ————
const CX = 800;
const CY = 1262;
const RING = [1010, 905, 800, 695];

/** 把一个外壳摆到半径 R 的圆弧上：s = 字形中心沿弧的位置（距句子正中），壳的底边中点落在弧上、朝外转 θ。 */
function onArc(el: HTMLElement, g: Gm, s: number, R: number): number {
  const th = s / R;
  const ox = g.w / 2;
  el.style.left = px(CX + R * Math.sin(th) - ox);
  el.style.top = px(CY - R * Math.cos(th) - g.ch);
  el.style.width = px(g.cw);
  el.style.height = px(g.ch);
  el.style.transformOrigin = `${px(ox)} ${px(g.ch)}`;
  el.style.transform = `rotate(${th.toFixed(5)}rad)`;
  return (th * 180) / Math.PI;
}

/** 译文拆成「词」（中文按字、拉丁按词）：空白和标点单独成块。 */
const TR_TOKENS = /\s+|[⺀-鿿가-힯＀-￯　-〿]|[^\s⺀-鿿가-힯＀-￯　-〿]+/g;

export const groove: Tpl = {
  id: 'groove',
  bold: true,
  dir: 'h',
  fits: (c) => c.lines.length >= 1 && c.lines.length <= 4 && allTimed(c) && c.lines.every((l) => glyphs(l.text) <= (c.cjk ? 16 : 36)),
  layout: (c) => {
    // 平排：每句一行、字号 40px，都放在页的左上角（finish 里量完再沿弧摆）；译文先挪到页上，平排量它
    for (const l of c.lines) {
      l.el.classList.add('lt-groove');
      put(l, 0, 0, 40);
      lift(c, l, 0, 0, 'lt-gtr');
    }
  },
  finish: (c) => {
    const S = c.page.getBoundingClientRect().width / PW || 1;
    const undos: Array<() => void> = [];
    c.lines.forEach((l, i) => {
      const R = RING[i]!;
      // —— 原文：每个 .u 包一层外壳（.lp-arcw），外壳按弧线定位并旋转；.u 自己的波浪 transform 在外壳里变成沿半径向外 ——
      const ms = l.units.map((u) => measureGlyph(u, S));
      const a = ms[0]!;
      const z = ms[ms.length - 1]!;
      const mid = (a.x + z.x + z.w) / 2;
      const nodes = [...l.tx.childNodes];
      l.tx.textContent = '';
      l.units.forEach((u, k) => {
        const g = ms[k]!;
        const sh = document.createElement('span');
        sh.className = 'lp-arcw';
        sh.dataset.rot = onArc(sh, g, g.x + g.w / 2 - mid, R).toFixed(3);
        sh.appendChild(u);
        l.tx.appendChild(sh);
      });
      undos.push(() => {
        l.tx.textContent = '';
        for (const n of nodes) l.tx.appendChild(n);
      });
      // —— 译文：逐字（中文按字、拉丁按词）沿同一圈的内侧（半径 R − 36）摆 ——
      const tr = l.tr;
      if (!tr) return;
      const text = tr.textContent ?? '';
      tr.textContent = '';
      const pieces: HTMLElement[] = [];
      for (const tok of text.match(TR_TOKENS) ?? []) {
        if (/^\s+$/.test(tok)) {
          tr.appendChild(document.createTextNode(' '));
          continue;
        }
        const p = document.createElement('span');
        p.className = 'lp-arcg';
        p.textContent = tok;
        tr.appendChild(p);
        pieces.push(p);
      }
      if (pieces.length) {
        const pm = pieces.map((p) => measureGlyph(p, S));
        const pa = pm[0]!;
        const pz = pm[pm.length - 1]!;
        const pmid = (pa.x + pz.x + pz.w) / 2;
        tr.textContent = '';
        pieces.forEach((p, k) => {
          const g = pm[k]!;
          p.className = 'lp-arcw lp-arct';
          onArc(p, g, g.x + g.w / 2 - pmid, R - 36);
          tr.appendChild(p);
        });
      }
      undos.push(() => {
        tr.textContent = text;
      });
    });
    // —— 背后的沟槽：一张静态 SVG（装饰，放在最底下） ——
    let svg = `<svg width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}" aria-hidden="true">`;
    for (let r = 470, k = 0; r <= 1220; r += 11, k++) svg += `<circle cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="rgba(255,255,255,${k % 2 ? 0.068 : 0.035})" stroke-width="1"/>`;
    svg += `<circle class="lp-g-track" cx="${CX}" cy="${CY}" r="0"/>`;
    svg += `<circle class="lp-g-label" cx="${CX}" cy="${CY}" r="430"/><circle class="lp-g-ring" cx="${CX}" cy="${CY}" r="412"/>`;
    svg += '</svg>';
    const d = deco(c, 'lp-groove');
    d.innerHTML = svg;
    c.page.insertBefore(d, c.page.firstChild);
    const track = d.querySelector<SVGCircleElement>('.lp-g-track')!;
    track.style.display = 'none';
    let last = -1;
    const hooks: PageHooks = {
      // 当前轨道：沟槽里一圈封面色细线，跟着正在唱的那句（它的圈往里 58px）
      frame: (t) => {
        let k = -1;
        c.lines.forEach((l, i) => {
          if (stateAt(l, t) === 'cur') k = i;
        });
        if (k === last) return;
        last = k;
        if (k < 0) track.style.display = 'none';
        else {
          track.style.display = '';
          track.setAttribute('r', String(RING[k]! - 58));
        }
      },
      undo: () => {
        for (const u of undos) u();
      },
    };
    return hooks;
  },
};

// ———— 稿纸（主歌，只给中日韩）：一格一字，中文竖排从右往左一列一句，日韩横排从上往下一行一句 ————
interface Geo {
  vert: boolean;
  /** 格距、行 / 列间的空、字号、字距（格距 = 字号 + 字距，字形正好落在格子正中）。 */
  C: number;
  G: number;
  fs: number;
  ls: number;
  /** 第 j 句的位置（.lp-line 的 left / top）。 */
  at: (j: number) => { left: number; top: number };
  /** 第 j 句第 k 个字所在的格子左上角。 */
  cell: (j: number, k: number) => { x: number; y: number };
  /** 一句最长几个字。 */
  mx: number;
  /** 画格子用的参数。 */
  X0: number;
  Y0: number;
}

const charsOf = (l: TLine) => l.units.map((u) => glyphs(u.textContent ?? ''));

function gridGeo(c: TCtx): Geo {
  const n = c.lines.length;
  const mx = Math.max(...c.lines.map((l) => charsOf(l).reduce((a, b) => a + b, 0)));
  if (c.vert) {
    // 竖排：格子 60px，列间空 20px，每列上面空一格；整块在画面里垂直居中（11 格时 Y0 = 130，同样张）
    const C = 60;
    const G = 20;
    const fs = 40;
    const ls = C - fs;
    const X0 = 1440;
    const Y0 = Math.round((PH - (mx + 1) * C) / 2) + 10;
    return {
      vert: true, C, G, fs, ls, mx, X0, Y0,
      // 字距加在字的下方：整句下挪半个字距，字形才落在格子正中
      at: (j) => ({ left: X0 - j * (C + G) - C, top: Y0 + C + ls / 2 }),
      cell: (j, k) => ({ x: X0 - j * (C + G) - C, y: Y0 + (k + 1) * C }),
    };
  }
  // 横排：格子 52px，行间空 18px（有译文时 34px，译文排在行下面的空里），第一格空着，从 x = 200 起
  const C = 52;
  const G = c.hasTr ? 34 : 18;
  const fs = 36;
  const ls = C - fs;
  const X0 = 200;
  const Y0 = Math.round((PH - (n * (C + G) - G)) / 2) - 20;
  return {
    vert: false, C, G, fs, ls, mx, X0, Y0,
    at: (j) => ({ left: X0 + C + ls / 2, top: Y0 + j * (C + G) }),
    cell: (j, k) => ({ x: X0 + (k + 1) * C, y: Y0 + j * (C + G) }),
  };
}

function maskOf(el: HTMLElement, grad: string): void {
  el.style.setProperty('mask-image', grad);
  el.style.setProperty('-webkit-mask-image', grad);
}

export const grid: Tpl = {
  id: 'grid',
  bold: true,
  fits: (c) => {
    if (!c.cjk || !allTimed(c) || c.lines.length < 2 || c.lines.length > 8) return false;
    if (c.vert && c.lines.length > 15) return false;
    return maxGlyphs(c) <= (c.vert ? 12 : 20);
  },
  layout: (c) => {
    const g = gridGeo(c);
    c.lines.forEach((l, j) => {
      l.el.classList.add('lt-grid');
      // 平排本身就是一格一字：字号 + 字距 = 格距，行高 = 格宽（竖排时列宽 = 行高）
      l.tx.style.fontSize = px(g.fs);
      l.tx.style.lineHeight = px(g.C);
      l.tx.style.letterSpacing = px(g.ls);
      const p = g.at(j);
      put(l, p.left, p.top);
      if (l.tr) lift(c, l, p.left - g.ls / 2, p.top + g.C + 6, 'is-grid');
    });
  },
  finish: (c) => {
    const g = gridGeo(c);
    const { C, G, X0, Y0, mx } = g;
    const n = c.lines.length;
    // —— 格子：一张静态 SVG，没写的格子用遮罩渐隐 ——
    let svg = `<svg width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}" aria-hidden="true"><g class="lp-cellg">`;
    const box = (x: number, y: number, w: number, h: number, o: number, sw: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke-opacity="${o}" stroke-width="${sw}"/>`;
    const line = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-opacity=".16"/>`;
    const root = deco(c, 'lp-grid');
    let inner = root;
    if (g.vert) {
      const N = 15;
      const rows = mx + 1;
      for (let j = 0; j < N; j++) {
        const x = X0 - j * (C + G) - C;
        svg += box(x, Y0, C, rows * C, 0.34, 1.2);
        for (let k = 1; k < rows; k++) svg += line(x, Y0 + k * C, x + C, Y0 + k * C);
      }
      svg += box(X0 - N * (C + G) + G - 14, Y0 - 14, N * (C + G) - G + 28, rows * C + 28, 0.3, 2);
      // 样张：渐变从 x = 1440 到 300 透明（不透明段到 42% 处）
      maskOf(root, 'linear-gradient(90deg, transparent 300px, #000 961px)');
    } else {
      const cols = mx + 3;
      const rows = n + 3;
      for (let j = 0; j < rows; j++) {
        const y = Y0 + j * (C + G);
        svg += box(X0, y, cols * C, C, 0.34, 1.2);
        for (let k = 1; k < cols; k++) svg += line(X0 + k * C, y, X0 + k * C, y + C);
      }
      svg += box(X0 - 14, Y0 - 14, cols * C + 28, rows * (C + G) - G + 28, 0.3, 2);
      // 右边（最长那句之后的两格）和下面（最后一句之后的三行）渐隐
      const xe = X0 + (mx + 1) * C;
      const ye = Y0 + n * (C + G) - G + 8;
      maskOf(root, `linear-gradient(90deg, #000 ${xe}px, transparent ${xe + 2 * C}px)`);
      inner = deco(c, 'lp-grid-in', undefined, root);
      maskOf(inner, `linear-gradient(180deg, #000 ${ye}px, transparent ${ye + 3 * (C + G)}px)`);
    }
    svg += '</g></svg>';
    inner.innerHTML = svg;
    c.page.insertBefore(root, c.page.firstChild);
    // —— 正在唱的字所在的格子：垫一层极淡的封面色 ——
    const hl = deco(c, 'lp-gcell', { width: px(C), height: px(C), display: 'none' });
    c.page.insertBefore(hl, c.lines[0]!.el);
    const starts = c.lines.map((l) => {
      let a = 0;
      return charsOf(l).map((k) => {
        const s = a;
        a += k;
        return s;
      });
    });
    const lens = c.lines.map(charsOf);
    let last = '';
    return {
      frame: (t) => {
        let key = '';
        let at: { x: number; y: number } | null = null;
        let j = -1;
        c.lines.forEach((l, i) => {
          if (stateAt(l, t) === 'cur') j = i;
        });
        const l = c.lines[j];
        if (l) {
          for (let k = 0; k < l.units.length; k++) {
            const p = unitP(l, k, t);
            if (p <= 0 || p >= 1) continue;
            // 一个 .u 里有几个字时（词），按唱到几成落在第几格
            const cn = lens[j]![k]!;
            const ci = starts[j]![k]! + Math.min(cn - 1, Math.floor(p * cn));
            key = `${j},${ci}`;
            at = g.cell(j, ci);
            break;
          }
        }
        if (key === last) return;
        last = key;
        if (!at) hl.style.display = 'none';
        else {
          hl.style.display = '';
          hl.style.left = px(at.x);
          hl.style.top = px(at.y);
        }
      },
    };
  },
};

// ———— 转角（副歌）：句子断成两截，前半放大成句眼，后半转 90° 接着写 ————
interface Pair {
  l: TLine;
  /** 第几个字起是后半句。 */
  cut: number;
  /** [句眼, 尾巴]。 */
  segs: HTMLElement[];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const hit = (a: Box, b: Box, m = 8) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

const at = (el: HTMLElement, x: number, y: number) => {
  el.style.left = px(x);
  el.style.top = px(y);
};

/** 一个字（词）沿读向的前进量：盒子长度扣掉上色留白。 */
function adv(c: TCtx, u: HTMLElement, vert: boolean): number {
  const s = c.size(u);
  const cs = getComputedStyle(u);
  const n = (v: string) => parseFloat(v) || 0;
  return Math.max(0, vert ? s.h - n(cs.paddingTop) - n(cs.paddingBottom) : s.w - n(cs.paddingLeft) - n(cs.paddingRight));
}

/** 句眼最后一个字（词）沿读向的长度：中日韩按「一个字」算（一个单位里可能有几个字）。 */
const lastAdv = (c: TCtx, p: Pair, vert: boolean, fs: number) => {
  const a = adv(c, p.l.units[p.cut - 1]!, vert);
  return c.cjk ? Math.min(a, fs) : a;
};

/** 字号先定成 fs0；沿读向超过 avail 时等比缩小。返回定下的字号。 */
function fitLen(c: TCtx, el: HTMLElement, fs0: number, avail: number, vert: boolean): number {
  el.style.fontSize = px(fs0);
  const s = c.size(el);
  const len = vert ? s.h : s.w;
  const fs = len > avail && len > 0 ? (fs0 * Math.max(avail, 1)) / len : fs0;
  if (fs !== fs0) el.style.fontSize = px(fs);
  return fs;
}

/** 中文（样张 bCorner）：第一句「┓」横着写完拐下来，第二句「┗」竖着写完拐出去，其余句子小字竖排塞进拐角下的空当。 */
function cornerV(c: TCtx, A: Pair, B: Pair, rest: TLine[]): void {
  const [aE, aT] = A.segs as [HTMLElement, HTMLElement];
  const [bE, bT] = B.segs as [HTMLElement, HTMLElement];
  // ┓：句眼横排（900 字重 150px），后半句竖排 56px，从句眼最后一个字的正下方拐下来
  const EX = 150;
  const EY = 120;
  at(aE, EX, EY);
  const fsA = fitLen(c, aE, 150, 700, false);
  const aSz = c.size(aE);
  const aTop = EY + aSz.h + 30;
  fitLen(c, aT, 56, 820 - aTop, true);
  const colA = c.size(aT).w;
  const aLeft = EX + aSz.w - fsA / 2 - colA / 2;
  at(aT, aLeft, aTop);
  // ┗：句眼竖排 130px（放不下就缩），后半句横排 56px，从句眼最后一个字的右边拐出去
  const BX = 880;
  const BY = 300;
  at(bE, BX, BY);
  const fsB = fitLen(c, bE, 130, 820 - BY, true);
  const bSz = c.size(bE);
  const bLeft = BX + bSz.w + 30;
  fitLen(c, bT, 56, 1480 - bLeft, false);
  at(bT, bLeft, BY + bSz.h - fsB / 2 - c.size(bT).h / 2);
  // 其余句子：小字竖排（34px，字距 .2em），从第一句拐角左边起往左排
  let x = Math.min(470, aLeft - 36 - 41);
  rest.forEach((l) => {
    l.el.classList.add('lt-cs');
    l.tx.style.letterSpacing = '.2em';
    fitTo(c, l.tx, 820 - 330, true, 34);
    x = Math.min(x, aLeft - 36 - c.size(l.tx).w);
    put(l, x, 330);
    x -= 66;
  });
}

/** 横排语言（拉丁、日韩，样张没有画，按对照表）：句眼 Inter 800 大写 / 粗体，尾巴竖排（拉丁字母侧躺着从上往下读）。 */
function cornerH(c: TCtx, A: Pair, B: Pair, rest: TLine[]): void {
  const [aE, aT] = A.segs as [HTMLElement, HTMLElement];
  const [bE, bT] = B.segs as [HTMLElement, HTMLElement];
  const X0 = 130;
  const Y0 = 96;
  const YB = 300;
  const YMAX = 820;
  const XMAX = 1480;
  const tailFs = (fs: number) => clamp(fs * 0.6, 22, 44);
  const occ: Box[] = [];
  // ┓ 的句眼：横排，按宽度撑到 900px 以内
  at(aE, X0, Y0);
  const fsA = fitLen(c, aE, 120, 900, false);
  const aSz = c.size(aE);
  // ┗ 的句眼：竖排（侧躺），贴左边从 y = 300 往下；它先排，第一句的尾巴要避开它的尾巴
  at(bE, X0, YB);
  const fsB = fitLen(c, bE, 100, YMAX - YB, true);
  const bSz = c.size(bE);
  const bLeft = X0 + bSz.w + 30;
  fitLen(c, bT, tailFs(fsB), XMAX - bLeft, false);
  const bTs = c.size(bT);
  // 尾巴从句眼底部右边拐出去：以句眼最后一个词的中线对齐，但不低于句眼底边
  const bBottom = YB + bSz.h;
  const bTop = bBottom - Math.max(Math.min(lastAdv(c, B, true, fsB), bTs.h * 3) / 2, bTs.h / 2) - bTs.h / 2;
  at(bT, bLeft, bTop);
  const bTail: Box = { x: bLeft, y: bTop, w: bTs.w, h: bTs.h };
  occ.push({ x: X0, y: YB, w: bSz.w, h: bSz.h }, bTail);
  // ┓ 的尾巴：竖排，从句眼最后一个词的正下方拐下来
  const aTopY = Y0 + aSz.h + 24;
  aT.style.fontSize = px(tailFs(fsA));
  const colA = c.size(aT).w;
  const aLeft = clamp(X0 + aSz.w - lastAdv(c, A, false, fsA) / 2 - colA / 2, X0 + bSz.w + 24, XMAX - colA);
  const overlapB = aLeft < bTail.x + bTail.w + 16 && bTail.x < aLeft + colA + 16;
  fitLen(c, aT, tailFs(fsA), (overlapB ? bTop - 20 : YMAX) - aTopY, true);
  at(aT, aLeft, aTopY);
  const aTs = c.size(aT);
  const aTail: Box = { x: aLeft, y: aTopY, w: aTs.w, h: aTs.h };
  occ.push({ x: X0, y: Y0, w: aSz.w, h: aSz.h }, aTail);
  // 其余句子：小字横排，放进两个拐角之间的空当（左边或 A 尾巴右边，哪边宽放哪边）
  if (rest.length) {
    const regions = [
      { x: X0 + bSz.w + 40, w: aTail.x - 36 - (X0 + bSz.w + 40) },
      { x: aTail.x + aTail.w + 40, w: XMAX - (aTail.x + aTail.w + 40) },
    ].sort((p, q) => q.w - p.w);
    const place = (r: { x: number; w: number }): Box => {
      let y = 330;
      let w = 0;
      for (const l of rest) {
        l.el.classList.add('lt-cs');
        if (!c.cjk) l.el.classList.add('lt-ital');
        if (l.tr) l.tr.className = 'lp-tr is-under';
        fitTo(c, l.tx, Math.max(60, r.w), false, 32);
        put(l, r.x, y);
        const s = c.size(l.el);
        w = Math.max(w, s.w);
        y += s.h + 14;
      }
      return { x: r.x, y: 330, w, h: y - 330 };
    };
    // 先试宽的那边，压到别的字就换另一边，两边都不行仍用宽的那边
    let boxed = place(regions[0]!);
    if (occ.some((o) => hit(o, boxed))) {
      const alt = place(regions[1]!);
      boxed = occ.some((o) => hit(o, alt)) ? place(regions[0]!) : alt;
    }
    occ.push(boxed);
  }
  // 翻译：放在每句尾巴附近；放不下（出画幅或压到别的字）就不显示
  const putTr = (p: Pair, cands: (w: number, h: number) => Array<{ x: number; y: number }>) => {
    const tr = lift(c, p.l, 0, 0, 'is-corner');
    if (!tr) return;
    tr.style.fontSize = '15px';
    const s = c.size(tr);
    for (const q of cands(s.w, s.h)) {
      const b: Box = { x: q.x, y: q.y, w: s.w, h: s.h };
      if (b.x < 120 || b.x + b.w > XMAX || b.y < 80 || b.y + b.h > 830 || occ.some((o) => hit(o, b, 6))) continue;
      at(tr, q.x, q.y);
      occ.push(b);
      return;
    }
    tr.style.display = 'none';
  };
  putTr(A, (w) => [
    { x: aTail.x + aTail.w + 14, y: aTail.y },
    { x: aTail.x - 14 - w, y: aTail.y },
  ]);
  putTr(B, (_w, h) => [
    { x: bTail.x, y: bTail.y - 8 - h },
    { x: bTail.x, y: bTail.y + bTail.h + 8 },
  ]);
}

export const corner: Tpl = {
  id: 'corner',
  bold: true,
  fits: (c) => {
    const n = c.lines.length;
    if (n < 2 || n > 4 || maxGlyphs(c) > (c.cjk ? 14 : 40)) return false;
    return c.lines.filter((l) => splitAt(l, c.cjk, c.cjk ? 5 : 12) > 0).length >= 2;
  },
  layout: (c) => {
    const min = c.cjk ? 5 : 12;
    const cuts = c.lines.map((l) => splitAt(l, c.cjk, min));
    const idx = c.lines.map((_, i) => i).filter((i) => cuts[i]! > 0);
    const i1 = idx[0];
    const i2 = idx[1];
    if (i1 == null || i2 == null) return;
    for (const l of c.lines) {
      l.el.classList.add('lt-corner');
      put(l, 0, 0);
    }
    // 两句都按「横 + 竖」分段：A = 句眼横排 + 尾巴竖排（┓），B = 句眼竖排 + 尾巴横排（┗）；竖的那段靠 .lp-seg-v，整句不再竖排
    const mk = (i: number, vertFirst: boolean): Pair => {
      const l = c.lines[i]!;
      l.vert = false;
      l.el.classList.toggle('is-vert', false);
      const segs = segment(l, [cuts[i]!], (k) => (k === 0 ? 'lt-eye' : 'lt-tail') + ((k === 0) === vertFirst ? ' lp-seg-v' : ''));
      return { l, cut: cuts[i]!, segs };
    };
    const A = mk(i1, false);
    const B = mk(i2, true);
    const rest = c.lines.filter((l) => l !== A.l && l !== B.l);
    if (c.vert) cornerV(c, A, B, rest);
    else cornerH(c, A, B, rest);
  },
};
