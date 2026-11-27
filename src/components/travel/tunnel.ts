import { pathX, pathY, type Slot } from './route';

/**
 * 隧道壁（TRAVEL_HANDOFF §9.6）：每张封面朝向路的中轴、按离路线的远近有规律地内倾（越外圈越斜，12°–28°），
 * 再加一点按封面固定的小抖动（±3°），像 Demo 1 那样围出一条有秩序的通道，而不是随机角度乱撒。
 * 只在换歌时算一次：每张封面的半宽 / 半高向量（世界坐标，y 向下）。
 */

const DEG = Math.PI / 180;
const LEAN_MIN = 12 * DEG;
const LEAN_MAX = 28 * DEG;
const JITTER = 3 * DEG;

function rot(v: [number, number, number], k: [number, number, number], a: number): [number, number, number] {
  // Rodrigues：v 绕单位轴 k 转 a
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = (k[0] * v[0] + k[1] * v[1] + k[2] * v[2]) * (1 - c);
  return [
    v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d,
    v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d,
    v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d,
  ];
}

function hash01(i: number, salt: number): number {
  let h = (i * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 每张封面 6 个数：半宽向量 (ax) 与半高向量 (ay)。rMin / rMax 是摆位时离路线的范围，yAspect 是竖向压缩比。 */
export function tunnelBasis(slots: Slot[], rMin: number, rMax: number, yAspect = 0.66): Float32Array {
  const out = new Float32Array(slots.length * 6);
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    const dx = s.x - pathX(s.z);
    // 摆位时竖向压到 yAspect：按还原后的方向算朝向，上下两侧的倾角和左右一致
    const dy = (s.y - pathY(s.z)) / yAspect;
    const rr = Math.hypot(dx, dy) || 1;
    const rx = dx / rr;
    const ry = dy / rr;
    const f = Math.min(1, Math.max(0, (rr - rMin) / Math.max(1, rMax - rMin)));
    const lean = LEAN_MIN + (LEAN_MAX - LEAN_MIN) * f;
    // 法线从「正对镜头」(0,0,-1) 朝路的中轴 (-rx,-ry) 倾 lean：转轴 = (-ry, rx, 0)
    const k: [number, number, number] = [-ry, rx, 0];
    let ax = rot([1, 0, 0], k, lean);
    let ay = rot([0, 1, 0], k, lean);
    // 小抖动：绕随机的面内轴再转 ±3°，同一张封面每次一样
    const ja = (hash01(i, 7) * 2 - 1) * JITTER;
    const jt = hash01(i, 13) * 2 * Math.PI;
    const jk: [number, number, number] = [Math.cos(jt), Math.sin(jt), 0];
    ax = rot(ax, jk, ja);
    ay = rot(ay, jk, ja);
    const h = s.size / 2;
    out.set([ax[0] * h, ax[1] * h, ax[2] * h, ay[0] * h, ay[1] * h, ay[2] * h], i * 6);
  }
  return out;
}
