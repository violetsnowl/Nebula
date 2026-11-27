import type { EngineLine } from '../../lib/listen/model';
import type { GLine } from './glyphAtlas';

/**
 * 歌词之路的几何（TRAVEL_HANDOFF §9.3）：每句是过锚点的一小段空间曲线（一段或拆成两段），
 * 字沿曲线逐个摆放（路径文字：字本身不变形，只沿曲线摆放和转向）。
 *
 * 一段曲线 = 原点 C + 三个方向：U（这段字的走向）、V（字的「向下」）、D（纵深），外加两种弯：
 *   P(s) = C + U·s + V·kv·s²/2 + D·kd·s²/2      （s 是沿字走向的世界长度，弯度小时近似弧长）
 * 姿态（偏航 yaw、滚转 roll、拱高 sag、纵深弯 curl）在「远处」与「开唱」之间插值：
 * 句子在远处时侧着、拐向纵深（像 Demo 1 里拐向远处的下一句），开唱前约 0.75 秒内平滑转正。
 */

export type V3 = [number, number, number];

export interface Pose {
  /** 偏航（弧度）：正 = 句尾更远 */
  yaw: number;
  /** 滚转（弧度，屏幕平面内；世界 y 向下，负 = 句尾往上） */
  roll: number;
  /** 画面内的拱高（占这段字长的比例，正 = 两端往下、中间拱起） */
  sag: number;
  /** 纵深弯（占字长比例，正 = 两端往远处弯，像一块弧形屏） */
  curl: number;
}

const DEG = Math.PI / 180;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function lerpPose(a: Pose, b: Pose, k: number): Pose {
  return { yaw: lerp(a.yaw, b.yaw, k), roll: lerp(a.roll, b.roll, k), sag: lerp(a.sag, b.sag, k), curl: lerp(a.curl, b.curl, k) };
}

function h01(i: number, salt: number): number {
  let h = (i * 2654435761 + salt * 40503) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 句子锚点（第二版自己排，不用 #287 的三拍）：四拍循环，上下交替、左右错开，单位是「在参照距离时画面上的位置」（窗口宽高的比例）。
 * #287 的三拍是给平放的小字算的：第 3 拍接回第 1 拍时当前句与下一句只差约 76px，字放大、带倾斜后会叠在一起。
 * 上下交替后，当前句（约 0.91 倍）和下一句（约 0.5 倍）至少错开约三分之一屏高，画面中心留给走廊。
 */
export const BEATS: ReadonlyArray<readonly [number, number]> = [
  [-0.08, 0.23],
  [0.09, -0.21],
  [0.07, 0.23],
  [-0.09, -0.21],
];

/**
 * 四拍循环的远处姿态：前三拍句尾往远处、往上走（Demo 1 里拐向远处的下一句）；第 4 拍反过来（句首远、句尾近、略往下），
 * 让一路上的句子不全朝一个方向倒。每句再有一点固定的随机幅度。
 */
const FAR_YAW = [34, 24, 40, -18];
const FAR_ROLL = [-10, -6, -13, 8];
export function poseFar(i: number): Pose {
  const b = i % 4;
  const k = 0.85 + 0.3 * h01(i, 1);
  return {
    yaw: FAR_YAW[b]! * k * DEG,
    roll: FAR_ROLL[b]! * (0.8 + 0.4 * h01(i, 2)) * DEG,
    sag: (i % 2 ? -1 : 1) * (0.07 + 0.05 * h01(i, 3)),
    curl: 0.07,
  };
}

/** 开唱时的姿态：偏航 ≤ 约 12°、滚转 ≤ 约 5°、拱高 ≤ 3%（§9.3 转正的上限内留余量） */
export function poseSing(i: number): Pose {
  const f = poseFar(i);
  return { yaw: f.yaw * 0.25, roll: f.roll * 0.35, sag: f.sag * 0.35, curl: 0.025 };
}

/** 拆成两段时，第二段相对第一段再转一点（Demo 1：后半句换个角度往上走） */
export function poseTurn(i: number, k: number): { roll: number; yaw: number } {
  const up = i % 4 === 3 ? 1 : -1;
  return { roll: lerp(26, 13, k) * up * DEG, yaw: lerp(14, 6, k) * DEG };
}

// ---------------------------------------------------------------- 拆句

/**
 * 长句在哪儿拆成两段：在词与词之间，挑「停顿长、离正中近」的位置（标点、中日韩之间的空格优先）。
 * 返回第二段第一个单位的下标；不拆返回 0。两段都至少占全句宽的 25%。
 */
export function splitAt(e: EngineLine, g: GLine): number {
  const us = g.units;
  if (us.length < 3) return 0;
  const W = g.width || 1;
  let best = 0;
  let bestScore = -Infinity;
  for (let k = 1; k < us.length; k++) {
    const a = us[k - 1]!;
    const b = us[k]!;
    const left = (a.left + a.w) / W;
    if (left < 0.25 || left > 0.75) continue;
    // 拉丁词中间（没有空格）不拆
    const latin = !(a.u?.cjk ?? /[⺀-鿿가-힯぀-ヿ]/.test(e.text));
    const gapSpace = b.left - (a.left + a.w) > 0.05;
    if (latin && !gapSpace) continue;
    const ua = e.units?.[k - 1];
    const ub = e.units?.[k];
    const pause = ua && ub ? Math.max(0, ub.s - ua.e) : 0;
    const punct = /[,，、。.!?！？;；:：…]$/.test(ua?.t ?? '') ? 0.35 : 0;
    const cjkSpace = !latin && gapSpace ? 0.3 : 0;
    const score = Math.min(0.6, pause) * 1.5 + punct + cjkSpace - Math.abs(left - 0.5) * 0.9;
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

// ---------------------------------------------------------------- 曲线段

export interface Seg {
  /** 单位下标范围 [from, to) */
  from: number;
  to: number;
  /** 这段在整句排版里的起点与宽（主字号 em） */
  e0: number;
  w: number;
  C: V3;
  U: V3;
  V: V3;
  D: V3;
  kv: number;
  kd: number;
}

function rotY(v: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
function rotZ(v: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function frame(yaw: number, roll: number): { U: V3; V: V3; D: V3 } {
  // 先偏航（绕竖直轴，句尾往纵深），再滚转（绕视线轴，在画面里转）
  const U = rotZ(rotY([1, 0, 0], -yaw), roll);
  const V = rotZ([0, 1, 0], roll);
  return { U, V, D: norm(cross(U, V)) };
}

/** 段上 s（世界长度，以段中心为 0）处：位置、切向、「向下」方向 */
export function segAt(sg: Seg, s: number): { p: V3; t: V3; d: V3 } {
  const { C, U, V, D, kv, kd } = sg;
  const a = (kv * s * s) / 2;
  const b = (kd * s * s) / 2;
  const p: V3 = [C[0] + U[0] * s + V[0] * a + D[0] * b, C[1] + U[1] * s + V[1] * a + D[1] * b, C[2] + U[2] * s + V[2] * a + D[2] * b];
  const t = norm([U[0] + V[0] * kv * s + D[0] * kd * s, U[1] + V[1] * kv * s + D[1] * kd * s, U[2] + V[2] * kv * s + D[2] * kd * s]);
  // 「向下」= V 去掉切向分量
  const dv = V[0] * t[0] + V[1] * t[1] + V[2] * t[2];
  const d = norm([V[0] - t[0] * dv, V[1] - t[1] * dv, V[2] - t[2] * dv]);
  return { p, t, d };
}

/**
 * 一句的曲线段（世界坐标）。anchor 是锚点；fs 世界字号；split 第二段起点（0 = 不拆）；
 * pose 整句姿态；turnK 0 远处 → 1 开唱（拆开的第二段转角随之收小）。
 * 整组按外接框的中心对齐到锚点。
 */
export function buildSegs(g: GLine, split: number, i: number, anchor: V3, fs: number, pose: Pose, turnK: number): Seg[] {
  const us = g.units;
  const ranges = split > 0 ? [[0, split], [split, us.length]] : [[0, us.length]];
  const segs: Seg[] = [];
  let origin: V3 = [0, 0, 0];
  let yaw = pose.yaw;
  let roll = pose.roll;
  for (let r = 0; r < ranges.length; r++) {
    const [from, to] = ranges[r]!;
    const a = us[from]!;
    const z = us[to - 1]!;
    const e0 = a.left;
    const w = z.left + z.w - a.left;
    if (r > 0) {
      const tr = poseTurn(i, turnK);
      roll += tr.roll;
      yaw += tr.yaw;
    }
    const { U, V, D } = frame(yaw, roll);
    const Wd = w * fs;
    const kv = (8 * pose.sag * Wd) / Math.max(1, Wd * Wd);
    const kd = (8 * pose.curl * Wd) / Math.max(1, Wd * Wd);
    let C: V3;
    if (r === 0) C = [0, 0, 0];
    else {
      // 接在上一段末尾后面，空出约半个字宽；第二段往下错开一行的一半，读起来是「下一行」
      const prev = segs[r - 1]!;
      const end = segAt(prev, (prev.w * fs) / 2);
      const gap = 0.45 * fs;
      const half = Wd / 2;
      C = [
        end.p[0] + end.t[0] * gap + U[0] * half + end.d[0] * 0.55 * fs,
        end.p[1] + end.t[1] * gap + U[1] * half + end.d[1] * 0.55 * fs,
        end.p[2] + end.t[2] * gap + U[2] * half + end.d[2] * 0.55 * fs,
      ];
    }
    segs.push({ from, to, e0, w, C, U, V, D, kv, kd });
    origin = C;
  }
  void origin;
  // 外接框中心 → 锚点
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const sg of segs) {
    for (const s of [-(sg.w * fs) / 2, 0, (sg.w * fs) / 2]) {
      const { p } = segAt(sg, s);
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
      z0 = Math.min(z0, p[2]);
      z1 = Math.max(z1, p[2]);
    }
  }
  const off: V3 = [anchor[0] - (x0 + x1) / 2, anchor[1] - (y0 + y1) / 2, anchor[2] - (z0 + z1) / 2];
  for (const sg of segs) sg.C = [sg.C[0] + off[0], sg.C[1] + off[1], sg.C[2] + off[2]];
  return segs;
}

/** 整句排版坐标 e（主字号 em，从句首起）在哪一段、段上 s 是多少（世界长度） */
export function locate(segs: Seg[], e: number, fs: number): { sg: Seg; s: number } {
  let sg = segs[0]!;
  for (const x of segs) if (e >= x.e0 - 0.3) sg = x;
  return { sg, s: (e - sg.e0 - sg.w / 2) * fs };
}
