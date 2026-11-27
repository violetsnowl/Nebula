import type { EngineLine } from '../../lib/listen/model';
import type { SongShape } from '../../lib/listen/sections';
import type { GLine } from './glyphAtlas';

/**
 * 歌词之路的几何（TRAVEL_HANDOFF §9.3）：每句是过锚点的一小段空间曲线（一段或拆成两段），
 * 字沿曲线逐个摆放（路径文字：字本身不变形，只沿曲线摆放和转向）。
 *
 * 一段曲线 = 原点 C + 三个方向 U（字的走向）/ V（字的「向下」）/ D（纵深）+ 一张按弧长采样的表：
 * 沿弧长 s 积分两个走向角——画面内的 θ（往 V 转）和纵深的 φ（往 D 转），所以字间距在弯处也不被拉伸。
 *
 * 句形（2026-11-27 用户反馈「只有下凹和下拱两样，单调、单看也没设计感」后从五张 Demo 图里提炼，§9.3）：
 *   - 斜坡 ramp：斜着往纵深爬，起头陡、句尾放平（Demo 1 / 5 的「it's a prison inside my mind」）；
 *   - 波 wave：一整个 S（Demo 2 上面那句）；
 *   - 扬尾 swoop：前半平、句尾扬起来（Demo 2 下面的「…three strikes」）；
 *   - 拐角 corner：句尾越来越往远处拐进去（Demo 1 的「I need you to free me」）；
 *   - 弧 arc：绕着走廊的一段圆弧，上方的句子 ∩、下方的 ∪，两头往远处收（Demo 4 的环带）。
 * 远处幅度大（侧着、弯得厉害），开唱前以句首为轴慢慢转正、幅度收到一半左右——开唱时仍保留句形，不压平。
 */

export type V3 = [number, number, number];

export type Kind = 'ramp' | 'wave' | 'swoop' | 'corner' | 'arc';

export interface LineShape {
  /** 第一段的句形 */
  kind: Kind;
  /** 拆两段时第二段的句形 */
  kind2: Kind;
  /** 往画面中心的竖直方向：+1 = 下方的句子（句形往上收），−1 = 上方的句子（往下收） */
  dir: 1 | -1;
  /** 0–1 的固定随机，给幅度一点个性 */
  j: number;
}

/** 姿态幅度（度）：roll 整体滚转（正 = 往画面中心）、yaw 偏航（正 = 句尾更远）、bend 画面内弯、depth 纵深弯 */
interface Amp {
  roll: number;
  yaw: number;
  bend: number;
  depth: number;
}

/** 远处：侧着、弯得厉害 */
const FAR_AMP: Record<Kind, Amp> = {
  ramp: { roll: 20, yaw: 34, bend: 16, depth: 0 },
  wave: { roll: 6, yaw: 28, bend: 34, depth: 0 },
  swoop: { roll: 5, yaw: 26, bend: 58, depth: 0 },
  corner: { roll: 10, yaw: 16, bend: 14, depth: 85 },
  arc: { roll: 6, yaw: 30, bend: 64, depth: 24 },
};
/**
 * 开唱：保留句形，但局部倾角有上限（正在读的字最多斜约 35°，只在扬尾的最后几个字）：
 * 斜坡整体 ≤ 约 15°；波最陡处约 20°；弧总共转 30°（拱高约句长 6%）；拐角句尾往远处转约 50°（字仍读得出、稍窄）。
 */
const SING_AMP: Record<Kind, Amp> = {
  ramp: { roll: 11, yaw: 16, bend: 8, depth: 0 },
  wave: { roll: 3, yaw: 12, bend: 17, depth: 0 },
  swoop: { roll: 2, yaw: 10, bend: 34, depth: 0 },
  corner: { roll: 5, yaw: 6, bend: 8, depth: 44 },
  arc: { roll: 3, yaw: 14, bend: 30, depth: 12 },
};

const DEG = Math.PI / 180;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth01 = (x: number) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

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

// ---------------------------------------------------------------- 句形规划

const norm = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** 比较两句是否同一句（去标点、大小写） */
export const normText = norm;
/** 估计句宽（em）：只用来挑句形（实际排版宽度要等字形画好） */
export function estEm(t: string): number {
  let w = 0;
  for (const ch of t) w += /[⺀-鿿가-힯぀-ヿ＀-￯]/.test(ch) ? 1 : ch === ' ' ? 0.28 : 0.5;
  return w;
}
/** 句形对句长的要求：太短的句子弯不起来，弯了像抖 */
function fitKind(k: Kind, em: number): Kind {
  if (k === 'wave' && em < 7) return 'arc';
  if (k === 'corner' && em < 5) return 'ramp';
  if (k === 'swoop' && em < 3.5) return 'ramp';
  if (k === 'arc' && em < 3) return 'ramp';
  return k;
}
/** 每个句组用一组句形轮流（组内两三种交替、有节奏；换句组换一组）；副歌用起伏更大的组 */
const PALETTES: Kind[][] = [
  ['arc', 'ramp'],
  ['wave', 'swoop'],
  ['corner', 'arc'],
  ['ramp', 'wave'],
  ['swoop', 'corner'],
  ['arc', 'wave', 'ramp'],
];
const CHORUS: Kind[][] = [
  ['wave', 'arc'],
  ['swoop', 'wave', 'arc'],
  ['arc', 'corner', 'wave'],
];
const ALL: Kind[] = ['ramp', 'arc', 'swoop', 'corner', 'wave'];

/**
 * 整首歌的句形（同一首歌每次一样）：
 *   - 句组（段落分析的 stanza）内按一组句形轮流，换句组换组，副歌用起伏更大的组；
 *   - 同一句歌词再出现时用同一个句形（耳朵和眼睛都认得出），上下位置交替自然镜像；
 *   - 句末长音（≥ 1.6 秒）用扬尾：长音拖着，句尾扬起来（不连着两句）；
 *   - 太短的句子退到斜坡 / 弧；和上一句撞了就换组里另一种。
 */
export function planShapes(els: EngineLine[], shape: SongShape | null, seed: number): LineShape[] {
  const out: LineShape[] = [];
  const seen = new Map<string, Kind>();
  let prevStanza = -1;
  let pos = 0;
  let prev: Kind | null = null;
  for (let i = 0; i < els.length; i++) {
    const e = els[i]!;
    const st = shape?.lineStanza[i] ?? Math.floor(i / 4);
    if (st !== prevStanza) {
      prevStanza = st;
      pos = 0;
    } else pos++;
    const si = shape?.lineSection[i] ?? -1;
    const sec = si >= 0 ? shape?.sections[si]?.kind : undefined;
    const em = estEm(e.text);
    const key = norm(e.text);
    let kind = key ? seen.get(key) : undefined;
    if (!kind) {
      const pals = sec === 'chorus' ? CHORUS : PALETTES;
      const pal = pals[(seed + st) % pals.length]!;
      kind = fitKind(pal[pos % pal.length]!, em);
      const last = e.units?.[e.units.length - 1];
      // 长音扬尾：只给真正拖得长的（流行歌句末 1 秒多的音太常见，全给就满屏扬尾），且不连着两句
      if (last && last.e - last.s >= 1.6 && em >= 4 && prev !== 'swoop') kind = 'swoop';
      if (kind === prev) {
        const alt = [...pal, ...ALL].map((k) => fitKind(k, em)).find((k) => k !== prev);
        if (alt) kind = alt;
      }
      if (key) seen.set(key, kind);
    }
    const dir: 1 | -1 = BEATS[i % BEATS.length]![1] > 0 ? 1 : -1;
    // 拆成两段时第二段：波 / 拐角的后半句换成弧 / 扬尾，其余同形（第二段本身已经拐了个弯）
    const kind2 = fitKind(kind === 'wave' ? 'arc' : kind === 'corner' ? 'swoop' : kind, em / 2);
    out.push({ kind, kind2, dir, j: h01(i, 7) });
    prev = kind;
  }
  return out;
}

/** 句形在 u（−0.5 句首 → 0.5 句尾）处的两个走向角（弧度）：θ 往「向下」转，φ 往纵深转 */
function anglesAt(kind: Kind, u: number, a: Amp, dir: number): [number, number] {
  const b = a.bend * DEG;
  const dp = a.depth * DEG;
  const v = u + 0.5;
  switch (kind) {
    case 'ramp':
      // 起头往中心陡一点、句尾放平：像抛出去的一道弧
      return [dir * b * u, 0];
    case 'wave':
      // 一整个 S：句首往中心、中段反向、句尾再往中心
      return [-dir * b * Math.cos(2 * Math.PI * v), 0];
    case 'swoop': {
      const k = smooth01((v - 0.3) / 0.7);
      return [-dir * b * Math.pow(k, 1.4), 0];
    }
    case 'corner':
      return [-dir * b * v, dp * v * v];
    case 'arc':
      // 绕走廊的圆弧：下方的句子 ∪、上方的 ∩；两头往远处收
      return [-dir * b * u, dp * 2 * u];
  }
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

/** 每段曲线的采样数 */
const N = 32;

export interface Seg {
  /** 单位下标范围 [from, to) */
  from: number;
  to: number;
  /** 这段在整句排版里的起点与宽（主字号 em） */
  e0: number;
  w: number;
  /** s = 0 处的世界坐标（表的原点） */
  C: V3;
  /** 表覆盖 s ∈ [−half, half]（世界长度）；超出部分沿端点切向外推 */
  half: number;
  /** 采样点（相对 C）与单位切向，各 (N + 1) × 3 */
  P: Float32Array;
  T: Float32Array;
  /** 「向下」的基准方向 */
  V: V3;
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
function norm3(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function frame(yaw: number, roll: number): { U: V3; V: V3; D: V3 } {
  // 先偏航（绕竖直轴，句尾往纵深），再滚转（绕视线轴，在画面里转）
  const U = rotZ(rotY([1, 0, 0], -yaw), roll);
  const V = rotZ([0, 1, 0], roll);
  return { U, V, D: norm3(cross(U, V)) };
}

/** 段上 s（世界长度，以段中心为 0）处：零分配写入位置 p、切向 t、「向下」方向 d */
export function segAtOut(sg: Seg, s: number, p: V3, t: V3, d: V3): void {
  const { C, P, T, V, half } = sg;
  let tx: number;
  let ty: number;
  let tz: number;
  if (s <= -half || s >= half) {
    const o = (s <= -half ? 0 : N) * 3;
    tx = T[o]!;
    ty = T[o + 1]!;
    tz = T[o + 2]!;
    const ex = s <= -half ? s + half : s - half;
    p[0] = C[0] + P[o]! + tx * ex;
    p[1] = C[1] + P[o + 1]! + ty * ex;
    p[2] = C[2] + P[o + 2]! + tz * ex;
  } else {
    const x = ((s + half) / (2 * half)) * N;
    const k = Math.min(N - 1, Math.floor(x));
    const f = x - k;
    const a = k * 3;
    const b = a + 3;
    p[0] = C[0] + P[a]! + (P[b]! - P[a]!) * f;
    p[1] = C[1] + P[a + 1]! + (P[b + 1]! - P[a + 1]!) * f;
    p[2] = C[2] + P[a + 2]! + (P[b + 2]! - P[a + 2]!) * f;
    const ux = T[a]! + (T[b]! - T[a]!) * f;
    const uy = T[a + 1]! + (T[b + 1]! - T[a + 1]!) * f;
    const uz = T[a + 2]! + (T[b + 2]! - T[a + 2]!) * f;
    const tl = Math.hypot(ux, uy, uz) || 1;
    tx = ux / tl;
    ty = uy / tl;
    tz = uz / tl;
  }
  t[0] = tx;
  t[1] = ty;
  t[2] = tz;
  // 「向下」= V 去掉切向分量（画面内转弯时跟着转，字始终垂直于走向）
  const dv = V[0] * tx + V[1] * ty + V[2] * tz;
  const dx = V[0] - tx * dv;
  const dy = V[1] - ty * dv;
  const dz = V[2] - tz * dv;
  const dl = Math.hypot(dx, dy, dz) || 1;
  d[0] = dx / dl;
  d[1] = dy / dl;
  d[2] = dz / dl;
}

/** 段上 s（世界长度，以段中心为 0）处：位置、切向、「向下」方向 */
export function segAt(sg: Seg, s: number): { p: V3; t: V3; d: V3 } {
  const p: V3 = [0, 0, 0];
  const t: V3 = [0, 0, 0];
  const d: V3 = [0, 0, 0];
  segAtOut(sg, s, p, t, d);
  return { p, t, d };
}

/** 按句形积分出一段曲线（表的原点在段中心） */
function buildSeg(from: number, to: number, e0: number, w: number, kind: Kind, dir: number, a: Amp, yaw: number, roll: number, fs: number): Seg {
  const { U, V, D } = frame(yaw, roll);
  const L = Math.max(1e-3, w * fs);
  const ds = L / N;
  const P = new Float32Array((N + 1) * 3);
  const T = new Float32Array((N + 1) * 3);
  let x = 0;
  let y = 0;
  let z = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let k = 0; k <= N; k++) {
    const [th, ph] = anglesAt(kind, k / N - 0.5, a, dir);
    const cp = Math.cos(ph);
    const tx = Math.cos(th) * cp;
    const ty = Math.sin(th) * cp;
    const tz = Math.sin(ph);
    if (k > 0) {
      // 梯形积分：字沿弧长等距
      x += ((px + tx) / 2) * ds;
      y += ((py + ty) / 2) * ds;
      z += ((pz + tz) / 2) * ds;
    }
    px = tx;
    py = ty;
    pz = tz;
    const o = k * 3;
    P[o] = U[0] * x + V[0] * y + D[0] * z;
    P[o + 1] = U[1] * x + V[1] * y + D[1] * z;
    P[o + 2] = U[2] * x + V[2] * y + D[2] * z;
    const t = norm3([U[0] * tx + V[0] * ty + D[0] * tz, U[1] * tx + V[1] * ty + D[1] * tz, U[2] * tx + V[2] * ty + D[2] * tz]);
    T[o] = t[0];
    T[o + 1] = t[1];
    T[o + 2] = t[2];
  }
  // 原点移到段中心
  const m = (N / 2) * 3;
  const cx = P[m]!;
  const cy = P[m + 1]!;
  const cz = P[m + 2]!;
  for (let k = 0; k <= N; k++) {
    P[k * 3] -= cx;
    P[k * 3 + 1] -= cy;
    P[k * 3 + 2] -= cz;
  }
  return { from, to, e0, w, C: [0, 0, 0], half: L / 2, P, T, V };
}

function ampAt(kind: Kind, turnK: number, j: number): Amp {
  const f = FAR_AMP[kind];
  const s = SING_AMP[kind];
  const k = 0.85 + 0.3 * j;
  return { roll: lerp(f.roll, s.roll, turnK) * k, yaw: lerp(f.yaw, s.yaw, turnK) * k, bend: lerp(f.bend, s.bend, turnK) * k, depth: lerp(f.depth, s.depth, turnK) * k };
}

/** 拆成两段时，第二段相对第一段再往画面中心转一点（Demo 1：后半句换个角度走） */
function turnOf(k: number): { roll: number; yaw: number } {
  return { roll: lerp(24, 12, k) * DEG, yaw: lerp(14, 6, k) * DEG };
}

/**
 * 一句的曲线段（世界坐标）。anchor 是锚点；fs 世界字号；split 第二段起点（0 = 不拆）；
 * turnK 0 远处 → 1 开唱。整组按外接框的中心对齐到锚点。
 */
export function buildSegs(g: GLine, split: number, i: number, anchor: V3, fs: number, sh: LineShape, turnK: number): Seg[] {
  const us = g.units;
  const ranges = split > 0 ? [[0, split], [split, us.length]] : [[0, us.length]];
  const segs: Seg[] = [];
  // 第 4 拍反过来（句首远、句尾近），一路上的句子不全朝一个方向倒；拐角的句尾总是往远处拐
  const yawSign = i % 4 === 3 && sh.kind !== 'corner' ? -1 : 1;
  for (let r = 0; r < ranges.length; r++) {
    const [from, to] = ranges[r]!;
    const a = us[from]!;
    const z = us[to - 1]!;
    const e0 = a.left;
    const w = z.left + z.w - a.left;
    const kind = r === 0 ? sh.kind : sh.kind2;
    const amp = ampAt(kind, turnK, sh.j);
    // 滚转往画面中心：下方的句子句尾往上（负）、上方的往下（正）
    let roll = -sh.dir * amp.roll * DEG;
    let yaw = yawSign * amp.yaw * DEG;
    if (r > 0) {
      const tr = turnOf(turnK);
      roll -= sh.dir * tr.roll;
      yaw += tr.yaw;
    }
    const sg = buildSeg(from, to, e0, w, kind, sh.dir, amp, yaw, roll, fs);
    if (r > 0) {
      // 接在上一段末尾后面，空出约半个字宽；第二段往下错开一行的一半，读起来是「下一行」
      const prev = segs[r - 1]!;
      const end = segAt(prev, prev.half);
      const st = segAt(sg, -sg.half);
      const gap = 0.45 * fs;
      sg.C = [
        end.p[0] + end.t[0] * gap + end.d[0] * 0.55 * fs - (st.p[0] - sg.C[0]),
        end.p[1] + end.t[1] * gap + end.d[1] * 0.55 * fs - (st.p[1] - sg.C[1]),
        end.p[2] + end.t[2] * gap + end.d[2] * 0.55 * fs - (st.p[2] - sg.C[2]),
      ];
    }
    segs.push(sg);
  }
  // 外接框中心 → 锚点
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const sg of segs) {
    for (let k = 0; k <= N; k += 2) {
      const x = sg.C[0] + sg.P[k * 3]!;
      const y = sg.C[1] + sg.P[k * 3 + 1]!;
      const zz = sg.C[2] + sg.P[k * 3 + 2]!;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (zz < z0) z0 = zz;
      if (zz > z1) z1 = zz;
    }
  }
  const off: V3 = [anchor[0] - (x0 + x1) / 2, anchor[1] - (y0 + y1) / 2, anchor[2] - (z0 + z1) / 2];
  for (const sg of segs) sg.C = [sg.C[0] + off[0], sg.C[1] + off[1], sg.C[2] + off[2]];
  return segs;
}

/** 句首、字母中线（基线往上约 0.36em）：转正的轴，也是光点等开唱时停的地方 */
export function headOf(segs: Seg[], fs: number): V3 {
  const s0 = segs[0]!;
  const { p, d } = segAt(s0, -s0.half);
  return [p[0] - d[0] * 0.36 * fs, p[1] - d[1] * 0.36 * fs, p[2] - d[2] * 0.36 * fs];
}

/** 已知开唱姿态的句首 H，只积分一次当前 turnK 的曲线段并把句首对齐到 H（避免每帧双算开唱姿态）。 */
export function placeSegsWithHead(g: GLine, split: number, i: number, anchor: V3, fs: number, sh: LineShape, turnK: number, singHead: V3): Seg[] {
  const segs = buildSegs(g, split, i, anchor, fs, sh, turnK);
  const h = headOf(segs, fs);
  const dx = singHead[0] - h[0];
  const dy = singHead[1] - h[1];
  const dz = singHead[2] - h[2];
  for (const sg of segs) sg.C = [sg.C[0] + dx, sg.C[1] + dy, sg.C[2] + dz];
  return segs;
}

/**
 * 这一帧一句的曲线段：句形幅度与朝向从远处插值到开唱，转正时以「句首」为轴（2026-11-27 用户反馈后改）。
 * 原来整句绕外接框中心转、0.75 秒内转完、正好在开唱那一刻停：句首在转的最后一刻还在动，
 * 光丝又钉在句首，光点沿丝到达时句子刚好转正，看上去像被线扯直。现在句首不动（读的人眼睛落在那里），
 * 句尾像一扇门慢慢合到面前；开唱时的落位仍按开唱姿态的外接框中心对齐锚点。
 */
export function placeSegs(g: GLine, split: number, i: number, anchor: V3, fs: number, sh: LineShape, turnK: number): Seg[] {
  const sing = buildSegs(g, split, i, anchor, fs, sh, 1);
  if (turnK >= 1) return sing;
  return placeSegsWithHead(g, split, i, anchor, fs, sh, turnK, headOf(sing, fs));
}

/** 整句排版坐标 e（主字号 em，从句首起）在哪一段、段上 s 是多少（世界长度） */
export function locate(segs: Seg[], e: number, fs: number): { sg: Seg; s: number } {
  let sg = segs[0]!;
  for (const x of segs) if (e >= x.e0 - 0.3) sg = x;
  return { sg, s: (e - sg.e0 - sg.w / 2) * fs };
}
