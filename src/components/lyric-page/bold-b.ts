import { deco, glyphs, hookRuns, put, px, stateAt, syncClone, unitP } from './kit';
import { PH, type TCtx, type TLine, type Tpl } from './types';

/**
 * 样张 N 第二批（2026-11-22 用户定稿）：出血大字、斜线、色场。
 * 每套都有横排（拉丁、日韩）和竖排（中文）两种；中日韩没有大小写和斜体，用字重和字号拉开对比。
 */

const maxGlyphs = (c: TCtx) => Math.max(...c.lines.map((l) => glyphs(l.text)));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ———— 出血大字（副歌第二次起）：副歌里重复最多的词放到出血，唱到它时跟着扫满 ————
/** 每一句里组成钩子的字（按出现的几次分段）。 */
const runsOf = (c: TCtx): number[][][] => c.lines.map((l) => (c.hook ? hookRuns(l, c.hook, c.cjk) : []));

export const bleed: Tpl = {
  id: 'bleed',
  bold: true,
  fits: (c) => !!c.hook && c.lines.length >= 2 && c.lines.length <= 5 && runsOf(c).some((r) => r.length > 0),
  layout: (c) => {
    for (const l of c.lines) {
      l.el.classList.add('lt-bleed');
      if (l.tr) l.tr.className = 'lp-tr is-under';
    }
    if (c.vert) {
      // 竖排：句子是右边的竖列（从右往左），大字在左下角（finish 里放）
      let f = 1;
      for (const l of c.lines) {
        l.tx.style.fontSize = '52px';
        f = Math.min(f, 640 / Math.max(1, c.size(l.tx).h));
      }
      const fs = 52 * Math.max(0.5, f);
      const col = fs * 1.2;
      c.lines.forEach((l, i) => put(l, 1450 - col - i * (col + 40), 150, fs));
      return;
    }
    // 横排：句子在左上一栏，句间距约 20px；每句是绝对定位，top 用量出来的高度（含句下翻译）往下排
    let f = 1;
    for (const l of c.lines) {
      l.tx.style.fontSize = '44px';
      f = Math.min(f, 1250 / Math.max(1, c.size(l.el).w));
    }
    const fs = 44 * Math.max(0.55, f);
    let y = 164;
    for (const l of c.lines) {
      put(l, 150, y, fs);
      y += c.size(l.el).h + 20;
    }
  },
  finish: (c) => {
    const hook = c.hook;
    if (!hook) return;
    const runs = runsOf(c);
    // 大字两份：一份只描边，一份填封面色（按 --f 露出左边 / 上边一段）；都是装饰，不进测量
    const cls = c.vert ? 'lp-gw is-v' : 'lp-gw';
    const back = deco(c, cls);
    const fill = deco(c, `${cls} is-fill`);
    for (const g of [back, fill]) g.textContent = hook;
    const n = [...hook].length;
    if (c.vert) {
      // 竖着出血：左下角，最后一个字被下边缘裁掉三成多；字多时缩小，让整列不顶出画面上沿
      const fs = Math.min(520, 820 / (n - 0.35));
      for (const g of [back, fill]) Object.assign(g.style, { left: px(-40), top: px(PH - (n - 0.35) * fs), fontSize: px(fs) });
    } else {
      // 横着出血：右下角；词太长时缩小到整词不超过约 1300px，基线始终压在画面下沿附近
      back.style.fontSize = '660px';
      const w = c.size(back).w;
      const fs = clamp((660 * 1300) / Math.max(1, w), 240, 660);
      for (const g of [back, fill]) Object.assign(g.style, { right: px(-70), top: px(PH - 0.8 * fs), fontSize: px(fs) });
    }
    let lastF = '';
    let lastO = '';
    const frame = (t: number) => {
      // 正在唱的那一次钩子：进度 = 这段字整体唱到几成；没有就看最近唱完的一次，唱完 1.2s 内淡出，只剩描边
      let act = -1;
      let doneAt = -Infinity;
      c.lines.forEach((l, i) => {
        const rs = runs[i]!;
        if (!rs.length || stateAt(l, t) === 'future') return;
        for (const r of rs) {
          let sum = 0;
          for (const k of r) sum += unitP(l, k, t);
          const p = sum / r.length;
          if (p > 0 && p < 1) act = p;
          else if (p >= 1) doneAt = Math.max(doneAt, l.eu?.[r[r.length - 1]!]?.e ?? l.te);
        }
      });
      let f = 0;
      let o = 0;
      if (act >= 0) {
        f = act;
        o = 0.9;
      } else if (doneAt > -Infinity) {
        f = 1;
        o = 0.9 * (1 - clamp((t - doneAt) / 1.2, 0, 1));
      }
      const fs = f.toFixed(3);
      const os = o.toFixed(3);
      if (fs !== lastF) {
        fill.style.setProperty('--f', fs);
        lastF = fs;
      }
      if (os !== lastO) {
        fill.style.opacity = os;
        lastO = os;
      }
    };
    frame(-1);
    return { frame };
  },
};

// ———— 斜线（桥段）：整页倾斜 12°，逐句错开，一条细线沿同一角度贯穿 ————
/** 整页倾斜的角度（度）。逆时针为负，同 CSS rotate。 */
const DEG = -12;
const COS = Math.cos((DEG * Math.PI) / 180);
const SIN = Math.sin((DEG * Math.PI) / 180);
interface Rc { x: number; y: number; w: number; h: number }
/** 一页倾斜用的参数：旋转原点（逻辑像素）、是否竖排；layout 算好，finish 取用。 */
interface Spin { ox: number; oy: number; vert: boolean }
const spins = new WeakMap<HTMLElement, Spin>();

/** 一组矩形（坐标相对旋转原点、平排时的位置）绕原点转 DEG 度之后的外接框。 */
function spunBox(rs: Rc[]): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const r of rs) {
    for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]] as const) {
      const rx = x * COS - y * SIN;
      const ry = x * SIN + y * COS;
      x0 = Math.min(x0, rx);
      x1 = Math.max(x1, rx);
      y0 = Math.min(y0, ry);
      y1 = Math.max(y1, ry);
    }
  }
  return { x0, x1, y0, y1 };
}

export const diag: Tpl = {
  id: 'diag',
  bold: true,
  fits: (c) => c.lines.length >= 2 && c.lines.length <= 5 && maxGlyphs(c) <= (c.cjk ? 18 : 48),
  layout: (c) => {
    for (const l of c.lines) {
      l.el.classList.add('lt-diag');
      if (l.tr) l.tr.className = 'lp-tr is-under';
    }
    if (c.vert) {
      // 竖排：竖列从右往左、逐列往下错开；原点取在第一列右边缘的上沿，整组按外接框居中到安全区里
      const BASE = 60;
      for (const l of c.lines) l.tx.style.fontSize = px(BASE);
      const sz = c.lines.map((l) => c.size(l.el));
      const dx = Math.max(...sz.map((s) => s.w)) + 44;
      const rs: Rc[] = sz.map((s, i) => ({ x: -i * dx - s.w, y: i * 66, w: s.w, h: s.h }));
      const b = spunBox(rs);
      const f = clamp(Math.min(1, 1360 / (b.x1 - b.x0), 720 / (b.y1 - b.y0)), 0.3, 1);
      const ox = 800 - ((b.x0 + b.x1) / 2) * f;
      const oy = 450 - ((b.y0 + b.y1) / 2) * f;
      c.lines.forEach((l, i) => put(l, ox + rs[i]!.x * f, oy + rs[i]!.y * f, BASE * f));
      spins.set(c.page, { ox, oy, vert: true });
      return;
    }
    // 横排：样张的局部坐标（第 i 句 left = 236 + i*132、top = 452 + i*138），平排；旋转原点 (236, 452)
    const OX = 236;
    const OY = 452;
    const BASE = c.cjk ? 64 : 74;
    for (const l of c.lines) l.tx.style.fontSize = px(BASE);
    const rs: Rc[] = c.lines.map((l, i) => ({ ...c.size(l.el), x: i * 132, y: i * 138 }));
    const b = spunBox(rs);
    // 句数多或长时只缩字号（连同错开的步长一起等比缩），保证转完不出画幅（x 120–1480、y 90–810）
    let f = 1;
    if (b.x1 > 0) f = Math.min(f, (1480 - OX) / b.x1);
    if (b.x0 < 0) f = Math.min(f, (120 - OX) / b.x0);
    if (b.y1 > 0) f = Math.min(f, (810 - OY) / b.y1);
    if (b.y0 < 0) f = Math.min(f, (90 - OY) / b.y0);
    f = clamp(f, 0.3, 1);
    c.lines.forEach((l, i) => put(l, OX + i * 132 * f, OY + i * 138 * f, BASE * f));
    spins.set(c.page, { ox: OX, oy: OY, vert: false });
  },
  finish: (c) => {
    const s = spins.get(c.page);
    if (!s) return;
    // 每句都绕同一个点转：transform-origin = 旋转原点相对这一句左上角的偏移，效果等于整组旋转
    for (const l of c.lines) {
      const left = parseFloat(l.el.style.left) || 0;
      const top = parseFloat(l.el.style.top) || 0;
      l.el.classList.add('lp-rot');
      l.el.style.transformOrigin = `${px(s.ox - left)} ${px(s.oy - top)}`;
      l.el.style.transform = `rotate(${DEG}deg)`;
      l.rot = DEG;
    }
    // 封面色细线：横排在第一句上方 54px、沿句子方向；竖排在第一列右边 54px、沿竖列方向；同样绕原点转
    if (s.vert) {
      const left = s.ox + 54;
      const top = s.oy - 1500;
      deco(c, 'lp-hair', { left: px(left), top: px(top), width: '1px', height: '3000px', transformOrigin: `${px(s.ox - left)} ${px(s.oy - top)}`, transform: `rotate(${DEG}deg)` });
    } else {
      const left = s.ox - 900;
      const top = s.oy - 54;
      deco(c, 'lp-hair', { left: px(left), top: px(top), width: '3000px', height: '1px', transformOrigin: `${px(s.ox - left)} ${px(s.oy - top)}`, transform: `rotate(${DEG}deg)` });
    }
  },
};

// ———— 色场（全曲最后一个副歌页）：一整块封面色，句子写进去之后变深色，像印在色纸上 ————
/** 竖排：色块从这条线往下铺到底；横排：色块从这条线往右铺到边。 */
/**
 * 色块的分割线跟着这一页的句子走（2026-11-22 用户：句子都短时，固定在右侧的分割线一句也碰不到）：
 * 横排 = 最长那句写进色块约四成（左缘 150 + 最长宽 × .6），竖排 = 最长那列写进色块约四成；再夹在一个不太偏的范围里。
 */
function fieldEdge(c: TCtx): number {
  if (c.vert) {
    let top = 0;
    let h = 0;
    for (const l of c.lines) {
      const s = c.size(l.tx);
      if (s.h > h) {
        h = s.h;
        top = parseFloat(l.el.style.top) || 0;
      }
    }
    // 最长那列至少有 70px 写进色块
    return clamp(Math.min(top + h * 0.6, top + h - 70), 260, 640);
  }
  const w = Math.max(...c.lines.map((l) => c.size(l.tx).w));
  // 最长那句至少有 90px 写进色块
  return clamp(Math.min(150 + w * 0.6, 150 + w - 90), 330, 1120);
}

export const field: Tpl = {
  id: 'field',
  bold: true,
  fits: (c) => c.lines.length >= 2 && c.lines.length <= 6 && maxGlyphs(c) <= (c.vert ? 13 : c.cjk ? 24 : 48),
  layout: (c) => {
    for (const l of c.lines) {
      l.el.classList.add('lt-field');
      if (l.tr) l.tr.className = 'lp-tr is-under';
    }
    if (c.vert) {
      // 竖排：竖列从右往左、逐列错开；长句从暗处一直写进下面的色块（整列最低不过 830，最高不过 90）。
      // 句子都短时字号放大到 1.4 倍（最长那列撑到约 560px），让句子够得着色块
      let f = 1.4;
      let hm = 0;
      for (const l of c.lines) {
        l.tx.style.fontSize = '60px';
        const h = c.size(l.tx).h;
        hm = Math.max(hm, h);
        f = Math.min(f, 740 / Math.max(1, h));
      }
      f = Math.min(f, Math.max(1, 560 / Math.max(1, hm)));
      const fs = 60 * Math.max(0.5, f);
      const STAG = [118, 170, 262, 214, 296, 248];
      c.lines.forEach((l, i) => {
        l.tx.style.fontSize = px(fs);
        const h = c.size(l.tx).h;
        put(l, 1240 - i * 130, clamp(Math.min(STAG[i]!, 830 - h), 90, 830), fs);
      });
      return;
    }
    // 横排：句子左对齐从 x 150 起，纵向居中成一组；长句越过色块的边线写进去。
    // 句子都短时字号放大（最多 1.5 倍，最长那句撑到约 900px），让句子够得着色块
    let f = 1.5;
    let wm = 0;
    for (const l of c.lines) {
      l.tx.style.fontSize = '72px';
      const w = c.size(l.el).w;
      wm = Math.max(wm, w);
      f = Math.min(f, 1300 / Math.max(1, w));
    }
    f = Math.min(f, Math.max(1, 900 / Math.max(1, wm)));
    let fs = 72 * Math.max(0.55, f);
    const GAP = 26;
    const stack = () => {
      for (const l of c.lines) l.tx.style.fontSize = px(fs);
      return c.lines.reduce((a, l) => a + c.size(l.el).h, 0) + GAP * (c.lines.length - 1);
    };
    let total = stack();
    if (total > 720) {
      fs *= 720 / total;
      total = stack();
    }
    let y = (PH - total) / 2;
    for (const l of c.lines) {
      put(l, 150, y, fs);
      y += c.size(l.el).h + GAP;
    }
  },
  finish: (c) => {
    // 色块（压在原文上面，不透明）
    const edge = fieldEdge(c);
    const block = deco(c, 'lp-field', c.vert ? { left: '0', right: '0', top: px(edge), bottom: '0' } : { left: px(edge), right: '0', top: '0', bottom: '0' });
    // 色块里的那一份：本页所有句子深拷贝一份，整层裁成色块那块区域，颜色在 CSS 里压成深色（见 lyric-page-tpl-b.css）
    const layer = deco(c, 'lp-field-on', { clipPath: c.vert ? `inset(${edge}px 0 0 0)` : `inset(0 0 0 ${edge}px)` });
    layer.setAttribute('aria-hidden', 'true');
    block.setAttribute('aria-hidden', 'true');
    const pairs = c.lines.map((l: TLine) => {
      const copy = l.el.cloneNode(true) as HTMLElement;
      layer.appendChild(copy);
      return { from: l.el, copy };
    });
    return {
      frame: () => {
        for (const p of pairs) syncClone(p.from, p.copy);
      },
    };
  },
};
