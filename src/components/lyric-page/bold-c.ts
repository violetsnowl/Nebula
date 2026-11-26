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
/** 圆心上移（2026-11-25 用户）：标签顶（CY − 430）要露在播放条（y ≈ 810 起）上方 */
const CY = 1140;
const RING = [1010, 905, 800, 695];
/** 沟槽画到页面最远的角（离圆心 ≈ 1393）之外 */
const GROOVE_MAX = 1420;
/** 轨道线：换圈滑动 0.65s、两句之间降到 DIM 用 0.4s、淡入淡出同曲线；三次缓入缓出 */
const TRACK_MOVE = 650;
const TRACK_FADE = 400;
const TRACK_DIM = 0.35;
const easeIO = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
/**
 * 轨道线放在当前句和下一句（里面一圈）之间的正中（2026-11-26 用户：原来固定往里 58px，正好搭在下一句的字顶上）：
 * 当前句的下沿 = 它那一圈（有译文时是译文那一圈 R − 36），下一句的上沿 = 下一圈 + 字高 × .9；最后一句往里 30。
 */
const TRACK_LAST = 30;

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
  fits: (c) => c.lines.length >= 2 && c.lines.length <= 4 && allTimed(c) && c.lines.every((l) => glyphs(l.text) <= (c.cjk ? 16 : 36)),
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
    /** 每句的字高、下沿（算轨道线位置用）。 */
    const chs: number[] = [];
    const inner: number[] = [];
    c.lines.forEach((l, i) => {
      const R = RING[i]!;
      inner[i] = R;
      // —— 原文：每个 .u 包一层外壳（.lp-arcw），外壳按弧线定位并旋转；.u 自己的波浪 transform 在外壳里变成沿半径向外 ——
      const ms = l.units.map((u) => measureGlyph(u, S));
      chs[i] = Math.max(...ms.map((g) => g.ch));
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
        inner[i] = R - 36;
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
    const trackR = c.lines.map((_, i) =>
      i + 1 < c.lines.length ? (inner[i]! + RING[i + 1]! + chs[i + 1]! * 0.9) / 2 : inner[i]! - TRACK_LAST,
    );
    // —— 背后的沟槽：一张静态 SVG（装饰，放在最底下） ——
    let svg = `<svg width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}" aria-hidden="true">`;
    for (let r = 470, k = 0; r <= GROOVE_MAX; r += 11, k++) svg += `<circle cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="rgba(255,255,255,${k % 2 ? 0.068 : 0.035})" stroke-width="1"/>`;
    svg += `<circle class="lp-g-track" cx="${CX}" cy="${CY}" r="0"/>`;
    svg += `<circle class="lp-g-label" cx="${CX}" cy="${CY}" r="430"/><circle class="lp-g-ring" cx="${CX}" cy="${CY}" r="412"/>`;
    svg += '</svg>';
    const d = deco(c, 'lp-groove');
    d.innerHTML = svg;
    c.page.insertBefore(d, c.page.firstChild);
    const track = d.querySelector<SVGCircleElement>('.lp-g-track')!;
    // 当前轨道：沟槽里一圈封面色细线，跟着正在唱的那句（它的圈往里 58px）。
    // 换句时半径从当前值缓动到新圈；两句之间停在原圈、透明度降到 TRACK_DIM；下一句开唱时一边滑向新圈一边回到不透明；
    // 第一次出现从透明淡入。时间用 performance.now()，在 frame 里推进；只在数值变化时写 r / opacity，不读布局
    track.style.opacity = '0';
    let last = -1;
    let seen = false;
    // 半径：from → to，起点时刻 r0；透明度：aFrom → aTo，起点时刻 a0
    let from = 0;
    let to = 0;
    let r0 = 0;
    let aFrom = 0;
    let aTo = 0;
    let a0 = 0;
    let wr = Number.NaN;
    let wo = Number.NaN;
    const rAt = (now: number) => from + (to - from) * easeIO(clamp((now - r0) / TRACK_MOVE, 0, 1));
    const oAt = (now: number) => aFrom + (aTo - aFrom) * easeIO(clamp((now - a0) / TRACK_FADE, 0, 1));
    const hooks: PageHooks = {
      frame: (t) => {
        const now = performance.now();
        let k = -1;
        c.lines.forEach((l, i) => {
          if (stateAt(l, t) === 'cur') k = i;
        });
        if (k !== last) {
          last = k;
          const o = oAt(now);
          if (k >= 0) {
            const target = trackR[k]!;
            if (!seen) {
              // 第一次出现：直接落在这一圈，从透明淡入
              seen = true;
              from = to = target;
            } else if (target !== to) {
              from = rAt(now);
              to = target;
              r0 = now;
            }
            aFrom = o;
            aTo = 1;
          } else if (seen) {
            // 两句之间：停在原圈，透明度降下去
            aFrom = o;
            aTo = TRACK_DIM;
          }
          a0 = now;
        }
        if (!seen) return;
        const r = Math.round(rAt(now) * 10) / 10;
        if (r !== wr) {
          wr = r;
          track.setAttribute('r', String(r));
        }
        const o = Math.round(oAt(now) * 100) / 100;
        if (o !== wo) {
          wo = o;
          track.style.opacity = String(o);
        }
      },
      undo: () => {
        for (const u of undos) u();
        // 复位：下次重建后又是「第一次出现」
        seen = false;
        last = -1;
        wr = wo = Number.NaN;
        track.setAttribute('r', '0');
        track.style.opacity = '0';
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
  /** 画格子用的参数：竖排 X0 = 第一列（最右）的右缘，横排 X0 = 整块的左缘；Y0 = 整块的上缘。 */
  X0: number;
  Y0: number;
  /** 画几列 / 几行格子：竖排 = 句数 + 2 列（最后两列空着渐隐）；横排 = 最长句 + 3 列、句数 + 1 行（最后一行空着渐隐）。 */
  cols: number;
  rows: number;
}

/** 方块字（汉字、假名、谚文）一字一格。 */
const CJK_CH = /[぀-ヿ㐀-鿿豈-﫿가-힯ᄀ-ᇿ]/u;
/** 一个字占几格：方块字一字一格；拉丁字母按稿纸习惯两个字母一格（2026-11-22 用户：Breezing 之后的日文不再居中占格） */
const cellsOfUnit = (u: HTMLElement) => {
  const cs = [...(u.textContent ?? '').replace(/\s+/g, '')];
  const cjk = cs.filter((ch) => CJK_CH.test(ch)).length;
  return Math.max(1, cjk + Math.ceil((cs.length - cjk) / 2));
};
const isLatinUnit = (u: HTMLElement) => ![...(u.textContent ?? '')].some((ch) => CJK_CH.test(ch));
const charsOf = (l: TLine) => l.units.map(cellsOfUnit);

function gridGeo(c: TCtx): Geo {
  const n = c.lines.length;
  const mx = Math.max(...c.lines.map((l) => charsOf(l).reduce((a, b) => a + b, 0)));
  if (c.vert) {
    // 竖排（2026-11-25 用户）：句数 + 2 列，最后两列空着渐隐；整块在画面里水平居中（不再钉在右边）。
    // 每列上面空一格，格子 60px、列间空 20px；整块在播放条安全区（高 810）里垂直居中，
    // 最长句太长时格距按 750 ÷ 行数缩小（字距恒 20，字号跟着缩），免得末格压进播放条
    const rows = mx + 1;
    const cols = n + 2;
    const C = Math.min(60, Math.floor(750 / rows));
    const G = 20;
    const ls = 20;
    const fs = C - ls;
    const X0 = Math.round((PW + cols * (C + G) - G) / 2);
    const Y0 = Math.round((810 - rows * C) / 2) + 10;
    return {
      vert: true, C, G, fs, ls, mx, X0, Y0, cols, rows,
      // 字距加在字的下方：整句下挪半个字距，字形才落在格子正中
      at: (j) => ({ left: X0 - j * (C + G) - C, top: Y0 + C + ls / 2 }),
      cell: (j, k) => ({ x: X0 - j * (C + G) - C, y: Y0 + (k + 1) * C }),
    };
  }
  // 横排：格子 52px，行间空 18px（有译文时 34px，译文排在行下面的空里），第一格空着；
  // 句数 + 1 行（最后一行空着渐隐）、最长句 + 3 列（右侧渐隐），整块在画面里水平居中
  const C = 52;
  const G = c.hasTr ? 34 : 18;
  const fs = 36;
  const ls = C - fs;
  const cols = mx + 3;
  const rows = n + 1;
  const X0 = Math.round((PW - cols * C) / 2);
  const Y0 = Math.round((PH - (n * (C + G) - G)) / 2) - 20;
  return {
    vert: false, C, G, fs, ls, mx, X0, Y0, cols, rows,
    // 字形在行高里本来就偏上，再加上逐字浮起会显得顶出格子：整行下移 5px（2026-11-22 用户反馈）
    at: (j) => ({ left: X0 + C + ls / 2, top: Y0 + j * (C + G) + 5 }),
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
      // 拉丁词：两个字母一格，整个词占满它那几格、在格子里居中（字距按原样，不再每个字母加格距的字距）；
      // 整句为了让方块字居中挪了半个字距，这里挪回来。用逻辑属性，竖排时同样沿列的方向
      for (const u of l.units) {
        if (!isLatinUnit(u)) continue;
        u.style.letterSpacing = '0.02em';
        u.style.inlineSize = px(cellsOfUnit(u) * g.C);
        u.style.textAlign = 'center';
        u.style.position = 'relative';
        u.style.insetInlineStart = px(-g.ls / 2);
      }
      const p = g.at(j);
      put(l, p.left, p.top);
      if (l.tr) lift(c, l, p.left - g.ls / 2, p.top + g.C + 1, 'is-grid');
    });
  },
  finish: (c) => {
    const g = gridGeo(c);
    const { C, G, X0, Y0, mx, cols, rows } = g;
    const n = c.lines.length;
    // —— 格子：一张静态 SVG，没写的格子用遮罩渐隐 ——
    let svg = `<svg width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}" aria-hidden="true"><g class="lp-cellg">`;
    const box = (x: number, y: number, w: number, h: number, o: number, sw: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke-opacity="${o}" stroke-width="${sw}"/>`;
    const line = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-opacity=".16"/>`;
    const root = deco(c, 'lp-grid');
    let inner = root;
    if (g.vert) {
      // 句数 + 2 列；最后两列（第 n、n + 1 列，最靠左）没有字，用遮罩渐隐：
      // 第 n − 1 列（最后一句）的左缘起不透明，到第 n + 1 列的左缘全透明
      for (let j = 0; j < cols; j++) {
        const x = X0 - j * (C + G) - C;
        svg += box(x, Y0, C, rows * C, 0.34, 1.2);
        for (let k = 1; k < rows; k++) svg += line(x, Y0 + k * C, x + C, Y0 + k * C);
      }
      svg += box(X0 - cols * (C + G) + G - 14, Y0 - 14, cols * (C + G) - G + 28, rows * C + 28, 0.3, 2);
      const xo = X0 - (n - 1) * (C + G) - C;
      const xt = X0 - (n + 1) * (C + G) - C;
      maskOf(root, `linear-gradient(90deg, transparent ${xt}px, #000 ${xo}px)`);
    } else {
      for (let j = 0; j < rows; j++) {
        const y = Y0 + j * (C + G);
        svg += box(X0, y, cols * C, C, 0.34, 1.2);
        for (let k = 1; k < cols; k++) svg += line(X0 + k * C, y, X0 + k * C, y + C);
      }
      svg += box(X0 - 14, Y0 - 14, cols * C + 28, rows * (C + G) - G + 28, 0.3, 2);
      // 右边（最长那句之后的两格）和下面（最后一句之后的一行）渐隐；有译文时，最后一句的译文排在它下面的空里，别淡掉
      const xe = X0 + (mx + 1) * C;
      const ye = Y0 + n * (C + G) - G + (c.hasTr ? 20 : 8);
      maskOf(root, `linear-gradient(90deg, #000 ${xe}px, transparent ${xe + 2 * C}px)`);
      inner = deco(c, 'lp-grid-in', undefined, root);
      maskOf(inner, `linear-gradient(180deg, #000 ${ye}px, transparent ${Y0 + n * (C + G) + C + 8}px)`);
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

// ———— 转角（副歌，2026-11-23 单拐点 L 形定稿）：第一句前半横排放大到拐点，后半转 90° 竖排向下（┓）；其余小字排在左下 ————
interface Pair {
  l: TLine;
  /** 第几个字起是后半句。 */
  cut: number;
  /** [句眼, 尾巴]。 */
  segs: HTMLElement[];
}

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

/** 中文竖排（2026-11-23 单拐点）：第一句横排句眼折向竖排尾巴（┓），其余句子小字竖排在左下、严格从右往左排。 */
function cornerV(c: TCtx, A: Pair, rest: TLine[]): void {
  const [aE, aT] = A.segs as [HTMLElement, HTMLElement];
  const MIN_X = 136;
  const EY = 116;
  const Y_SAFE = 792;
  const fsA = fitLen(c, aE, 148, 1060, false);
  const aSz = c.size(aE);
  const aTop = EY + aSz.h + 34;
  fitLen(c, aT, 56, Y_SAFE - aTop, true);
  const colA = c.size(aT).w;

  // 先量左下旁注列所需的总宽度，保证竖排尾巴右侧落位与旁注区不撞字
  const restTop = Math.max(aTop + 36, 480);
  const restAvailH = Math.max(180, Y_SAFE - restTop);
  const restWidths: number[] = [];
  for (const l of rest) {
    l.el.classList.add('lt-cs');
    l.tx.style.letterSpacing = '.2em';
    fitTo(c, l.tx, restAvailH, true, 34);
    restWidths.push(c.size(l.tx).w);
  }
  const COL_GAP = 28;
  const restSpan = restWidths.reduce((s, w) => s + w, 0) + Math.max(0, rest.length - 1) * COL_GAP;
  const minTailLeft = MIN_X + restSpan + 60;

  const relTail = Math.max(0, aSz.w - lastAdv(c, A, false, fsA) / 2 - colA / 2);
  const eyeX = clamp(Math.max(MIN_X, minTailLeft - relTail), MIN_X, 1460 - aSz.w);
  at(aE, eyeX, EY);
  const aLeft = clamp(eyeX + relTail, minTailLeft, 1460 - colA);
  at(aT, aLeft, aTop);

  // 中文旁注列：从右往左排（第 2 句靠近内拐角，后续句依次往左）
  let right = Math.min(aLeft - 56, Math.max(eyeX + restSpan, MIN_X + restSpan));
  rest.forEach((l, i) => {
    const w = restWidths[i]!;
    put(l, right - w, restTop);
    right -= w + COL_GAP;
  });
}

/** 横排语言（2026-11-23 单拐点）：第一句横排大字到拐点，后半竖排向下（┓）；其余句子小字横排在左下。 */
function cornerH(c: TCtx, A: Pair, rest: TLine[]): void {
  const [aE, aT] = A.segs as [HTMLElement, HTMLElement];
  const X0 = 136;
  const Y0 = 148;
  const Y_SAFE = 792;
  const fsA = fitLen(c, aE, 112, 1080, false);
  const aSz = c.size(aE);
  const aTop = Y0 + aSz.h + 34;
  fitLen(c, aT, 52, Y_SAFE - aTop, true);
  const colA = c.size(aT).w;

  const minTailLeft = X0 + 380;
  const relTail = Math.max(0, aSz.w - lastAdv(c, A, false, fsA) / 2 - colA / 2);
  const eyeX = clamp(Math.max(X0, minTailLeft - relTail), X0, 1450 - aSz.w);
  at(aE, eyeX, Y0);
  const aLeft = clamp(eyeX + relTail, minTailLeft, 1450 - colA);
  at(aT, aLeft, aTop);

  if (rest.length) {
    const restW = Math.max(280, Math.min(820, aLeft - 52 - X0));
    const restTop = Math.max(aTop + 24, 476);
    const availH = Math.max(160, Y_SAFE - restTop);
    const baseFs: number[] = [];
    for (const l of rest) {
      l.el.classList.add('lt-cs');
      if (!c.cjk) l.el.classList.add('lt-ital');
      if (l.tr) l.tr.className = 'lp-tr is-under';
      baseFs.push(fitTo(c, l.tx, restW, false, 32));
    }
    let gap = 14;
    const totalH = () => rest.reduce((s, l) => s + c.size(l.el).h, 0) + Math.max(0, rest.length - 1) * gap;
    const h0 = totalH();
    if (h0 > availH) {
      const k = availH / h0;
      gap *= k;
      rest.forEach((l, i) => {
        l.tx.style.fontSize = px(baseFs[i]! * k);
        if (l.tr) l.tr.style.fontSize = px(15 * Math.max(0.8, k));
      });
    }
    let y = restTop;
    for (const l of rest) {
      put(l, X0, y);
      y += c.size(l.el).h + gap;
    }
  }

  if (A.l.tr) {
    const tr = lift(c, A.l, 0, aTop, 'is-corner');
    if (tr) {
      tr.style.fontSize = '17px';
      tr.style.writingMode = 'vertical-rl';
      tr.style.maxHeight = px(Y_SAFE - aTop);
      const tw = c.size(tr).w;
      if (aLeft + colA + 20 + tw <= 1472) {
        at(tr, aLeft + colA + 20, aTop);
      } else {
        tr.style.display = 'none';
      }
    }
  }
}

export const corner: Tpl = {
  id: 'corner',
  bold: true,
  fits: (c) => {
    const n = c.lines.length;
    if (n < 2 || n > 4 || maxGlyphs(c) > (c.cjk ? 16 : 42)) return false;
    // 只拐第一句：第一句必须能自然断成两截，绝不把后面句子拎到顶部颠倒唱序
    return splitAt(c.lines[0]!, c.cjk, c.cjk ? 5 : 12) > 0;
  },
  layout: (c) => {
    const cut = splitAt(c.lines[0]!, c.cjk, c.cjk ? 5 : 12);
    if (cut <= 0) return;
    for (const l of c.lines) {
      l.el.classList.add('lt-corner');
      put(l, 0, 0);
    }
    const first = c.lines[0]!;
    first.vert = false;
    first.el.classList.toggle('is-vert', false);
    const segs = segment(first, [cut], (k) => (k === 0 ? 'lt-eye' : 'lt-tail lp-seg-v'));
    const A: Pair = { l: first, cut, segs };
    const rest = c.lines.slice(1);
    if (c.vert) cornerV(c, A, rest);
    else cornerH(c, A, rest);
  },
  finish: (c) => {
    // 内拐角 L 形细线（┓）：沿句眼下缘水平延伸至竖排尾巴左侧内拐点，再折向下方伴随尾巴
    const eye = c.page.querySelector<HTMLElement>('.lt-corner .lt-eye');
    const tail = c.page.querySelector<HTMLElement>('.lt-corner .lt-tail');
    if (!eye || !tail) return;
    const pr = c.page.getBoundingClientRect();
    const S = pr.width / PW || 1;
    const er = eye.getBoundingClientRect();
    const tr = tail.getBoundingClientRect();
    const ex0 = (er.left - pr.left) / S;
    const ey1 = (er.bottom - pr.top) / S;
    const tx0 = (tr.left - pr.left) / S;
    const ty0 = (tr.top - pr.top) / S;
    const th = tr.height / S;
    const kx = tx0 - 18;
    const ky = ey1 + 15;
    const hx0 = Math.min(ex0, kx - 100);
    deco(c, 'lp-corner-line', { left: px(hx0), top: px(ky), width: px(Math.max(80, kx - hx0)), height: '1px' });
    deco(c, 'lp-corner-line', { left: px(kx), top: px(ky), width: '1px', height: px(Math.max(80, ty0 - ky + Math.min(180, th * 0.6))) });
  },
};
