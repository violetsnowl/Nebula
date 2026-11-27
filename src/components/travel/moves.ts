import type { V3 } from './pathText';

/**
 * 招式的几何（TRAVEL_HANDOFF §9.4）。每个招式都是在「路」的摆位上再做一次变形（warp）：
 * 输入一个字在路上的位置 / 切向 / 向下方向，按招式的进度把它挪到招式的位置，并给出可见度（背面朝外的字隐去）。
 */

const smooth = (x: number) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};
const norm3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/**
 * 环：句子绕成一个倾斜的环套在主角封面上（Demo 3 的轨道环）。
 *   - 环面近乎水平、朝镜头倾斜 a（约 24°，镜像时从下方看）；字只占环正面约 140°（周长约句长 2.6 倍），其余是轨道光；
 *   - 字竖在环上（像写在一圈透明的带子上），沿环从左往右读；正在唱的词 front 始终转到正前方；
 *   - 背面朝外的字隐去，不出反字；
 *   - k：0 = 还在路上，1 = 绕好；句首先绕上去。
 */
export interface Ring {
  /** 环心（世界） */
  C: V3;
  R: number;
  /** 倾角（弧度，正 = 从上方看） */
  a: number;
  k: number;
  /** 转到正前方的排版坐标（em） */
  front: number;
  fs: number;
  width: number;
}

/** 环上排版坐标 e 处：位置（基线）、切向、向下方向、朝外的方向 */
export function ringAt(r: Ring, e: number): { p: V3; t: V3; d: V3; n: V3 } {
  const th = ((e - r.front) * r.fs) / r.R;
  const s = Math.sin(th);
  const c = Math.cos(th);
  const sa = Math.sin(r.a);
  const ca = Math.cos(r.a);
  // 环面基：X = 向右，Zt = 往远处、顺倾角往上（世界 y 向下，所以是 −sa）
  // P(θ) = C + R(sinθ·X − cosθ·Zt)，θ = 0 是离镜头最近的正前方
  return {
    p: [r.C[0] + r.R * s, r.C[1] + r.R * c * sa, r.C[2] - r.R * c * ca],
    t: [c, -s * sa, s * ca],
    d: [0, ca, sa],
    n: [s, c * sa, -c * ca],
  };
}

/** 把路上的一个字挪到环上；u = 这个字在句中的位置（0–1），句首先绕上去 */
export function warpRing(r: Ring, e: number, u: number, p: V3, t: V3, d: V3, cam: V3): { p: V3; t: V3; d: V3; vis: number } {
  const w = smooth(r.k * 1.5 - u * 0.5);
  if (w <= 0) return { p, t, d, vis: 1 };
  const q = ringAt(r, e);
  // 朝外的方向对着镜头才看得见；侧面渐隐，背面隐去
  const tc = norm3([cam[0] - q.p[0], cam[1] - q.p[1], cam[2] - q.p[2]]);
  const face = q.n[0] * tc[0] + q.n[1] * tc[1] + q.n[2] * tc[2];
  const vis = smooth((face - 0.12) / 0.38);
  return { p: lerp3(p, q.p, w), t: norm3(lerp3(t, q.t, w)), d: norm3(lerp3(d, q.d, w)), vis: 1 + (vis - 1) * w };
}
