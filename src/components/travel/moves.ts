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

/** 一个招式的变形：输入路上一个字（排版坐标 e，句中位置 u）的位置 / 切向 / 向下，返回变形后的，和可见度 */
export type Warp = (e: number, u: number, p: V3, t: V3, d: V3) => { p: V3; t: V3; d: V3; vis: number };

/**
 * 星座：句子按停顿拆成 2–3 截，挂在画面中央 60% 框内的几个「星」上（§9.4）。
 * 每截是一小段直的字，各自一点倾斜、前后错开一点深度；截与截之间唱到时才连上一根细线（在 TravelSpace 里画）。
 */
export interface StarPiece {
  /** 这截字基线中点（世界） */
  C: V3;
  U: V3;
  V: V3;
  /** 排版坐标范围（em） */
  e0: number;
  e1: number;
  /** 单位下标范围 [from, to) */
  from: number;
  to: number;
}

/** 截的落点：画面宽度的比例（在开唱距离时），y 向下；2 截 / 3 截各一套，镜像时上下翻 */
const STAR_LAYOUT: Record<number, ReadonlyArray<readonly [number, number, number, number]>> = {
  // [x, y, 深度偏移（世界）, 滚转（度）]
  2: [
    [-0.14, -0.07, -90, -5],
    [0.13, 0.08, 70, 4],
  ],
  3: [
    [-0.18, -0.09, -110, -6],
    [0, 0.08, 80, 5],
    [0.18, -0.04, -30, -3],
  ],
};

export function buildStar(center: V3, units: ReadonlyArray<{ left: number; w: number }>, cuts: number[], fs: number, unit: number, side: number): StarPiece[] {
  const bounds = [0, ...cuts, units.length];
  const lay = STAR_LAYOUT[bounds.length - 1] ?? STAR_LAYOUT[3]!;
  const out: StarPiece[] = [];
  for (let j = 0; j + 1 < bounds.length; j++) {
    const from = bounds[j]!;
    const to = bounds[j + 1]!;
    const a = units[from]!;
    const z = units[to - 1]!;
    const [fx, fy, dz, rd] = lay[Math.min(j, lay.length - 1)]!;
    const r = side * rd * (Math.PI / 180);
    out.push({
      C: [center[0] + fx * unit, center[1] + side * fy * unit, center[2] + dz],
      U: [Math.cos(r), Math.sin(r), 0],
      V: [-Math.sin(r), Math.cos(r), 0],
      e0: a.left,
      e1: z.left + z.w,
      from,
      to,
    });
  }
  void fs;
  return out;
}

/** 字在第几截 */
export function starPieceOf(pieces: StarPiece[], e: number): number {
  let j = 0;
  for (let k = 0; k < pieces.length; k++) if (e >= pieces[k]!.e0 - 0.3) j = k;
  return j;
}

export function warpStar(pieces: StarPiece[], k: number, fs: number, e: number, p: V3, t: V3, d: V3): { p: V3; t: V3; d: V3; vis: number } {
  const j = starPieceOf(pieces, e);
  const pc = pieces[j]!;
  const w = smooth(k * 1.3 - j * 0.15);
  if (w <= 0) return { p, t, d, vis: 1 };
  const x = (e - (pc.e0 + pc.e1) / 2) * fs;
  const q: V3 = [pc.C[0] + pc.U[0] * x, pc.C[1] + pc.U[1] * x, pc.C[2] + pc.U[2] * x];
  return { p: lerp3(p, q, w), t: norm3(lerp3(t, pc.U, w)), d: norm3(lerp3(d, pc.V, w)), vis: 1 };
}
