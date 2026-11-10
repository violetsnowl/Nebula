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

/** bezel 宽度：min(高度 × 0.46, 30px)。 */
export function bezelWidth(height: number): number {
  return Math.min(height * 0.46, 30);
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
