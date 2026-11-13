/**
 * 液态玻璃的边缘折射位移贴图（docs/design/NEBULA_UI_SYSTEM.md §3.6）。
 *
 * 表面轮廓：convex squircle f(t) = (1 − (1 − t)^4)^(1/4)，t ∈ [0,1] 为离边缘的归一化距离（0 = 边缘，1 = bezel 内侧）。
 * 法线倾角 θ → 斯涅尔折射（n = 1.5）得折射角 θr → 横向位移 = f(t) · tan(θ − θr)，预先算成 256 档查找表并归一化。
 * 位移方向一律**向内**（只从玻璃内部取样，避免取到玻璃外的空白）。
 * 编码：R = 128 − nx·m·127，G = 128 − ny·m·127，B = 128（feDisplacementMap 用 R/G 通道）。
 */

const LUT_SIZE = 256;
const REFRACTIVE_INDEX = 1.5;

const LUT: Float32Array = (() => {
  const f = (t: number) => Math.pow(1 - Math.pow(1 - t, 4), 0.25);
  const out = new Float32Array(LUT_SIZE + 1);
  let max = 0;
  for (let i = 0; i <= LUT_SIZE; i++) {
    const t = Math.max(i / LUT_SIZE, 0.002);
    const lo = Math.max(0, t - 0.001);
    const hi = Math.min(1, t + 0.001);
    const slope = (f(hi) - f(lo)) / (hi - lo);
    const theta = Math.min(Math.atan(slope), 1.3);
    const thetaR = Math.asin(Math.sin(theta) / REFRACTIVE_INDEX);
    out[i] = f(t) * Math.tan(theta - thetaR);
    max = Math.max(max, out[i]!);
  }
  for (let i = 0; i <= LUT_SIZE; i++) out[i] = out[i]! / (max || 1);
  return out;
})();

const cache = new Map<string, string>();

/** 默认 bezel 宽度：min(高度 × 0.46, 30px)（G1 / G2；G3 用 materials.tierBezel 的固定值）。 */
export function bezelWidth(height: number): number {
  return Math.min(height * 0.46, 30);
}

/** 单个像素的位移编码（R/G，B 恒 128）。所有贴图都用它，保证九宫格拼出来和整张图逐像素一致。 */
function encodePixel(px: number, py: number, hx: number, hy: number, r: number, bezel: number): [number, number] {
  const qx = Math.abs(px) - hx;
  const qy = Math.abs(py) - hy;
  const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  let nx = 0;
  let ny = 0;
  let m = 0;
  if (sd < 0) {
    const t = Math.min(-sd / bezel, 1);
    m = LUT[Math.round(t * LUT_SIZE)]!;
    if (qx > 0 && qy > 0) {
      const len = Math.hypot(qx, qy) || 1;
      nx = (qx / len) * Math.sign(px);
      ny = (qy / len) * Math.sign(py);
    } else if (qx > qy) {
      nx = Math.sign(px);
    } else {
      ny = Math.sign(py);
    }
  }
  return [128 - nx * m * 127, 128 - ny * m * 127];
}

function canvasUrl(w: number, h: number, fill: (d: Uint8ClampedArray) => void): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(w, h);
  fill(img.data);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** 九宫格贴图：4 个角 R×R + 4 条边（1 像素宽 / 高，拉伸使用）。中间区域是中性色，由 feFlood 填。 */
export interface DisplacementTiles {
  /** 角块边长：max(圆角, bezel)。元素宽高都 ≥ 2R 时九宫格成立。 */
  R: number;
  tl: string;
  tr: string;
  bl: string;
  br: string;
  top: string;
  bottom: string;
  left: string;
  right: string;
}

const tileCache = new Map<string, DisplacementTiles>();

/**
 * 生成九宫格位移贴图（NEBULA_UI_SYSTEM §3.6，P4 修正）。
 * 圆角矩形的位移只取决于"离最近边或角的几何关系"：角块只和圆角、bezel 有关，边条只和离边距离有关，与元素宽度无关。
 * 所以元素宽度变化（Dock 小球展开成胶囊、搜索胶囊展开）时只需移动这些块的位置，不用重画贴图，每一帧都和真实形状对齐。
 * 贴图只取决于 角块边长 R、圆角、bezel：三者不变就复用缓存（G3 的 bezel 固定，面板 / 弹窗高度变化不会重画）。
 */
export function displacementTiles(height: number, radius: number, bezelPx?: number): DisplacementTiles | null {
  const h = Math.max(2, Math.round(height));
  const r = Math.max(0, Math.min(radius, h / 2));
  const bezel = bezelPx ?? bezelWidth(h);
  const R = Math.ceil(Math.min(Math.max(r, bezel), h / 2));
  if (R < 1) return null;
  const key = `${R}x${r.toFixed(1)}x${bezel.toFixed(1)}`;
  const hit = tileCache.get(key);
  if (hit) return hit;

  // 在一个 (2R+1)² 的虚拟圆角矩形上逐像素计算，再切成角块和中线条：与真实元素对应位置的数值完全相同
  const S = 2 * R + 1;
  const hx = S / 2 - r;
  const hy = S / 2 - r;
  const at = (x: number, y: number) => encodePixel(x + 0.5 - S / 2, y + 0.5 - S / 2, hx, hy, r, bezel);
  const region = (x0: number, y0: number, w: number, hh: number) =>
    canvasUrl(w, hh, (d) => {
      for (let y = 0; y < hh; y++) {
        for (let x = 0; x < w; x++) {
          const [cr, cg] = at(x0 + x, y0 + y);
          const i = (y * w + x) * 4;
          d[i] = cr;
          d[i + 1] = cg;
          d[i + 2] = 128;
          d[i + 3] = 255;
        }
      }
    });
  const tiles: DisplacementTiles = {
    R,
    tl: region(0, 0, R, R),
    tr: region(S - R, 0, R, R),
    bl: region(0, S - R, R, R),
    br: region(S - R, S - R, R, R),
    top: region(R, 0, 1, R),
    bottom: region(R, S - R, 1, R),
    left: region(0, R, R, 1),
    right: region(S - R, R, R, 1),
  };
  if (!tiles.tl) return null;
  if (tileCache.size > 24) tileCache.clear();
  tileCache.set(key, tiles);
  return tiles;
}

/**
 * 生成圆角矩形（含正圆）的位移贴图 data URL；同尺寸结果缓存复用。
 * @param radius 圆角（会被限制在宽高一半以内）
 */
export function displacementMapUrl(width: number, height: number, radius: number): string {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const bezel = bezelWidth(h);
  const key = `${w}x${h}x${r.toFixed(1)}x${bezel.toFixed(1)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - h / 2;
      const qx = Math.abs(px) - hx;
      const qy = Math.abs(py) - hy;
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      let nx = 0;
      let ny = 0;
      let m = 0;
      if (sd < 0) {
        const t = Math.min(-sd / bezel, 1);
        m = LUT[Math.round(t * LUT_SIZE)]!;
        if (qx > 0 && qy > 0) {
          const len = Math.hypot(qx, qy) || 1;
          nx = (qx / len) * Math.sign(px);
          ny = (qy / len) * Math.sign(py);
        } else if (qx > qy) {
          nx = Math.sign(px);
        } else {
          ny = Math.sign(py);
        }
      }
      const i = (y * w + x) * 4;
      d[i] = 128 - nx * m * 127;
      d[i + 1] = 128 - ny * m * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/png');
  if (cache.size > 24) cache.clear();
  cache.set(key, url);
  return url;
}
