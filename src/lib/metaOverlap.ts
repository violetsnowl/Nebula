/**
 * 星云卡片标题防压盖（设计审查第 2 条，NEBULA_UI_SYSTEM §8）。
 *
 * 景深把卡片在 3D 里前后叠起来，焦点圈内的卡片都会显示标题（--meta-a = 1），
 * 于是后排卡片的标题会压在前排卡片的封面上，或者两张卡的标题叠成一团。
 * 这里在舞台已有的每帧循环里，用已经算好的屏幕坐标（x / y / 缩放 / 旋转）直接推出
 * 封面和标题区的四边形，不调用 getBoundingClientRect（那会强制同步布局）。
 *
 * 规则：
 *  - 标题区 = 封面正下方、宽同封面、高 META_H × 缩放（随卡片一起缩放、旋转）；
 *  - 标题区与任何别的卡片的封面重叠面积超过标题区面积的 COVER_OVERLAP → 隐藏；
 *  - 标题区与另一张更靠前（z 更大，其次 id 更大）且最终仍显示着标题的卡片的标题区重叠 → 隐藏
 *    （所以先按「前 → 后」排序再逐张判断：前面那张若已被隐藏，就不会再连累后面的）；
 *  - 豁免卡片（正在播放）永远显示；悬停卡片由 CSS（.is-hovered .meta）强制显示，不需要在这里处理。
 *
 * 为什么用四边形求交而不是轴对齐矩形：卡片带 ±8° 的随机旋转，旋转后的封面外接框比真实封面宽约 11%，
 * 标题区也会向旁边偏出约 7%，用外接框会把本来没碰到的标题也藏掉，或者漏掉真正压到的。
 * 只有「基础显示」的卡片（焦点圈内，通常 3–8 张）才需要求交，所以 O(n²) 的实际代价很小；
 * 输入池和缓冲区都复用，每帧不产生新对象。
 */
import { CARD_WIDTH } from './layout';

/** 标题区高度（设计值 ≈ 40px，随卡片一起缩放）。 */
export const META_H = 40;
/** 标题被别的封面盖住的面积比例超过它就隐藏。 */
export const COVER_OVERLAP = 0.15;
/** 两个标题区重叠超过标题区面积的这个比例才算叠在一起（避免边缘相切时来回闪）。 */
export const TITLE_OVERLAP = 0.05;

export interface MetaBox {
  id: number;
  /** 调用方挂自己的元素引用，结果按它写回（本文件不读写 DOM）。 */
  el: HTMLElement | null;
  /** 卡片盒左上角的屏幕坐标（变换前），即 --x / --y。 */
  x: number;
  y: number;
  /** 最终缩放（--scale）。 */
  s: number;
  /** 旋转角度（度，即 --rz）。 */
  rot: number;
  z: number;
  /** 景深给出的基础显隐：1 = 在焦点圈内，0 = 圈外（圈外的标题不参与也不需要判断）。 */
  base: number;
  /** 豁免：永远显示（正在播放）。 */
  exempt: boolean;
  /** 输出：1 = 显示，0 = 隐藏。 */
  alpha: number;
  // 以下为内部缓存：封面 / 标题区四边形（x0,y0,…x3,y3，顺序 左上→右上→右下→左下）及其外接框
  cover: Float64Array;
  title: Float64Array;
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  tx0: number;
  ty0: number;
  tx1: number;
  ty1: number;
}

export function makeMetaBox(): MetaBox {
  return {
    id: 0,
    el: null,
    x: 0,
    y: 0,
    s: 1,
    rot: 0,
    z: 0,
    base: 0,
    exempt: false,
    alpha: 0,
    cover: new Float64Array(8),
    title: new Float64Array(8),
    cx0: 0,
    cy0: 0,
    cx1: 0,
    cy1: 0,
    tx0: 0,
    ty0: 0,
    tx1: 0,
    ty1: 0,
  };
}

/** 把局部矩形 [u0,u1]×[v0,v1]（相对盒中心、已按缩放）旋转后平移到屏幕，四个顶点写进 out。 */
function fillQuad(out: Float64Array, cx: number, cy: number, cos: number, sin: number, u0: number, u1: number, v0: number, v1: number): void {
  // 左上、右上、右下、左下；CSS rotateZ 为 [cos −sin; sin cos]（屏幕坐标 y 向下，正角度顺时针）
  out[0] = cx + u0 * cos - v0 * sin;
  out[1] = cy + u0 * sin + v0 * cos;
  out[2] = cx + u1 * cos - v0 * sin;
  out[3] = cy + u1 * sin + v0 * cos;
  out[4] = cx + u1 * cos - v1 * sin;
  out[5] = cy + u1 * sin + v1 * cos;
  out[6] = cx + u0 * cos - v1 * sin;
  out[7] = cy + u0 * sin + v1 * cos;
}

const BUF_A = new Float64Array(32);
const BUF_B = new Float64Array(32);

/** 两个凸四边形（同为顺时针）的重叠面积：Sutherland–Hodgman，把 a 依次按 b 的四条边裁剪。 */
function overlapArea(a: Float64Array, b: Float64Array): number {
  let src = BUF_A;
  let dst = BUF_B;
  for (let i = 0; i < 8; i++) src[i] = a[i]!;
  let n = 4;
  for (let e = 0; e < 4 && n > 0; e++) {
    const ax = b[2 * e]!;
    const ay = b[2 * e + 1]!;
    const k = (e + 1) & 3;
    const ex = b[2 * k]! - ax;
    const ey = b[2 * k + 1]! - ay;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const px = src[2 * i]!;
      const py = src[2 * i + 1]!;
      const qx = src[2 * j]!;
      const qy = src[2 * j + 1]!;
      // 叉积 ≥ 0 在边的内侧（顺时针多边形、y 向下）
      const dp = ex * (py - ay) - ey * (px - ax);
      const dq = ex * (qy - ay) - ey * (qx - ax);
      if (dp >= 0) {
        dst[2 * m] = px;
        dst[2 * m + 1] = py;
        m++;
      }
      if (dp >= 0 !== (dq >= 0)) {
        const t = dp / (dp - dq);
        dst[2 * m] = px + (qx - px) * t;
        dst[2 * m + 1] = py + (qy - py) * t;
        m++;
      }
    }
    const tmp = src;
    src = dst;
    dst = tmp;
    n = m;
  }
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    area += src[2 * i]! * src[2 * j + 1]! - src[2 * j]! * src[2 * i + 1]!;
  }
  return Math.abs(area) / 2;
}

/**
 * @param boxes 前 n 项有效；函数会就地按「前 → 后」重排它们，并写入每项的 alpha
 * @param boxH  卡片 DOM 盒的完整高度（封面 + 标题区）；缩放 / 旋转都以盒中心为原点，所以要用它推封面位置
 */
export function resolveMetaVisibility(boxes: MetaBox[], n: number, boxH: number): void {
  // 前 → 后排序：z 大的在前，z 相同 id 大的在前。逐帧顺序变化很小，插入排序接近线性
  for (let i = 1; i < n; i++) {
    const cur = boxes[i]!;
    let j = i - 1;
    while (j >= 0 && (boxes[j]!.z < cur.z || (boxes[j]!.z === cur.z && boxes[j]!.id < cur.id))) {
      boxes[j + 1] = boxes[j]!;
      j--;
    }
    boxes[j + 1] = cur;
  }
  const halfW = CARD_WIDTH / 2;
  for (let i = 0; i < n; i++) {
    const b = boxes[i]!;
    const cx = b.x + halfW;
    const cy = b.y + boxH / 2;
    const rad = (b.rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const u = halfW * b.s;
    const top = (-boxH / 2) * b.s;
    const coverBottom = top + CARD_WIDTH * b.s;
    fillQuad(b.cover, cx, cy, cos, sin, -u, u, top, coverBottom);
    fillQuad(b.title, cx, cy, cos, sin, -u, u, coverBottom, coverBottom + META_H * b.s);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < 8; k += 2) {
      x0 = Math.min(x0, b.cover[k]!);
      x1 = Math.max(x1, b.cover[k]!);
      y0 = Math.min(y0, b.cover[k + 1]!);
      y1 = Math.max(y1, b.cover[k + 1]!);
    }
    b.cx0 = x0;
    b.cy0 = y0;
    b.cx1 = x1;
    b.cy1 = y1;
    x0 = Infinity;
    y0 = Infinity;
    x1 = -Infinity;
    y1 = -Infinity;
    for (let k = 0; k < 8; k += 2) {
      x0 = Math.min(x0, b.title[k]!);
      x1 = Math.max(x1, b.title[k]!);
      y0 = Math.min(y0, b.title[k + 1]!);
      y1 = Math.max(y1, b.title[k + 1]!);
    }
    b.tx0 = x0;
    b.ty0 = y0;
    b.tx1 = x1;
    b.ty1 = y1;
    b.alpha = b.base;
  }
  for (let i = 0; i < n; i++) {
    const a = boxes[i]!;
    if (a.base === 0 || a.exempt) continue;
    const areaA = CARD_WIDTH * a.s * META_H * a.s;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const o = boxes[j]!;
      // 外接框都不相交就不用求交
      if (a.tx0 < o.cx1 && a.tx1 > o.cx0 && a.ty0 < o.cy1 && a.ty1 > o.cy0) {
        if (overlapArea(a.title, o.cover) > COVER_OVERLAP * areaA) {
          a.alpha = 0;
          break;
        }
      }
      // 与更靠前（j < i）、并且最终显示着标题的卡片的标题区重叠
      if (j < i && o.alpha === 1 && a.tx0 < o.tx1 && a.tx1 > o.tx0 && a.ty0 < o.ty1 && a.ty1 > o.ty0) {
        if (overlapArea(a.title, o.title) > TITLE_OVERLAP * areaA) {
          a.alpha = 0;
          break;
        }
      }
    }
  }
}
