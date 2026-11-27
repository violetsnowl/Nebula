import type { EngineLine } from '../../lib/listen/model';
import type { SongShape } from '../../lib/listen/sections';
import type { Track } from '../../lib/catalog';
import { chromaOf, hueOf, toneOf } from '../../lib/space/tone';

/**
 * 穿行（样张 M 的第三种「聆听时的舞台」，初版）：路线、镜头、颜色旅程、封面摆位。纯计算，不碰 DOM。
 *
 * 世界坐标沿用样张：每句一个纵深 Z，镜头沿一条缓慢摆动的曲线往前走，透视 F = 900，可见纵深 FAR。
 *
 * 镜头（两份初版比较后的整合版，2026-11-26）：
 *   - 初版 A（停—推）唱句时几乎静止、换句用 1.15s 正弦缓入缓出：速度每句归零再起步，用户看着像「一脚油门一脚刹车」，句间距 540 又让纵深偏浅；
 *   - 初版 B（目标 + 指数追赶）首尾相接的句子目标瞬间跳过去、0.26s 时间常数追上：一下猛冲再滑停，「快速穿梭」，不安静。
 *   整合：先排一条「目标轨迹」——唱一句时从离它 DA 缓缓靠近到 DB，换句时跨到下一句（有空档就在空档里匀速走完），
 *   再对整条轨迹做一次高斯平滑（σ = SIGMA）。速度处处连续、加速度也连续（没有急起急刹），唱句时速度不归零，
 *   换句只是平滑地提一次速。轨迹是时间的纯函数（预先采样），跳转进度时自然跟上。
 */

export const F = 900;
/** 可见纵深 */
export const FAR = 5400;
/** 字号的参照距离（世界字号 × F / DREST = 屏幕字号） */
export const DREST = 1000;
/** 唱一句时镜头离它的距离：开唱 DA → 唱完 DB（缓缓靠近，样张 1100 → 720） */
const DA = 1250;
const DB = 1000;
/** 唱这句时离镜头最近大约这么远（长句世界字号按这里算，不出画面） */
export const NEAREST = 860;
/** 相邻两句的纵深间隔（样张 1000；整合版 900：下一句约为当前句的 0.58 倍，层次深，换句提速仍压在约 1000 单位 / 秒内） */
export const STEP = 900;
/** 换句组多走一段（样张 450；整合版 250，换句组时提速不过冲） */
export const STANZA_GAP = 250;
/** 快句：两句开唱间隔短于 STEP_T 秒时纵深间隔按比例缩短（最少 STEP_MINK），推进不用冲 */
const STEP_T = 2.2;
const STEP_MINK = 0.55;
/** ≥ 4s 间奏多走一段（随间奏长度增加，最多 2400：长间奏里慢慢穿过一片星云） */
const GAP_K = 420;
const GAP_MAX = 2400;
/** 目标轨迹的换句点比句界提前这么多秒（实测提前会让唱完那句在最后几个字时放大过多，定为 0：换句推进以句界为中心） */
const LEAD = 0;
/** 轨迹高斯平滑的 σ（秒）与采样间隔 */
const SIGMA = 0.42;
const CAM_DT = 0.02;
/** 没有歌词、或唱完之后匀速漂（单位 / 秒） */
export const IDLE_V = 120;

export const pathX = (z: number) => 260 * Math.sin(z / 3100);
export const pathY = (z: number) => 110 * Math.sin(z / 2300 + 1.3);

/**
 * 句子沿路线两侧三拍循环错开（样张的思路）。样张的偏移是世界坐标写死的，在 16:9 窗口里会把当前句推到画面顶端被切；
 * 改成「在参照距离 DREST 处时在画面上的位置」（窗口宽高的比例），三拍算过：任何一拍做当前句时，下一句（约 0.55 倍）、
 * 下下句（约 0.37 倍）都和它上下至少错开约 9% 窗口高（约 80px）。
 */
const OFFS: ReadonlyArray<readonly [number, number]> = [
  [-0.08, 0.2],
  [0.07, -0.19],
  [-0.02, 0.018],
];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

export interface RLine {
  s: number;
  e: number;
  z: number;
  x: number;
  y: number;
}

export interface Route {
  lines: RLine[];
  /** 镜头起点（t = 0） */
  z0: number;
  /** 平滑后的镜头轨迹：每 CAM_DT 秒一格，覆盖 0 … camEnd 秒 */
  cam: Float32Array;
  camEnd: number;
  /** 封面与颜色旅程覆盖的范围 */
  zMin: number;
  zMax: number;
  /** 颜色旅程：每 100 单位一格的色相偏移（弧度），见 hueOffsetAt */
  off: Float32Array;
}

/** 这首歌的路线。els 已按开始时间排好；shape 用默认切分（和漫游歌词同一套段落）；vw / vh 是窗口大小（句子摆位按画面比例）。 */
/** 镜头参数（默认即定稿值；只在开发 / 调参脚本里覆盖） */
export interface CamTune {
  step: number;
  stanza: number;
  da: number;
  db: number;
  lead: number;
  sigma: number;
}
export const CAM_TUNE: CamTune = { step: STEP, stanza: STANZA_GAP, da: DA, db: DB, lead: LEAD, sigma: SIGMA };

export function buildRoute(els: EngineLine[], shape: SongShape | null, vw: number, vh: number, tailSec = 120, tune: CamTune = CAM_TUNE): Route {
  const { step, stanza, da, db, lead, sigma } = tune;
  const n = els.length;
  const lines: RLine[] = [];
  const k = DREST / F;
  let z = 0;
  for (let i = 0; i < n; i++) {
    const e = els[i]!;
    if (i > 0) {
      z += step * clamp((e.s - els[i - 1]!.s) / STEP_T, STEP_MINK, 1);
      if (shape && shape.lineStanza[i] !== shape.lineStanza[i - 1]) z += stanza;
      const gap = e.s - els[i - 1]!.e;
      if (gap >= 4) z += Math.min(GAP_MAX, gap * GAP_K);
    }
    const [fx, fy] = OFFS[i % 3]!;
    lines.push({ s: e.s, e: e.e, z, x: pathX(z) + fx * vw * k, y: pathY(z) + fy * vh * k });
  }
  let z0 = 0;
  let cam = new Float32Array(0);
  let camEnd = 0;
  if (n) {
    // —— 目标轨迹（折线）：前奏从远处缓缓推到第一句；每句从离它 DA 靠近到 DB；换句时跨到下一句（有空档在空档里匀速走完） ——
    const intro = Math.max(0, lines[0]!.s);
    z0 = lines[0]!.z - da - clamp(intro * 110, 0, 2600);
    const pts: Array<[number, number]> = [[0, z0]];
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const l = lines[i]!;
      const ta = Math.max(prev, l.s - lead);
      const next = i + 1 < n ? lines[i + 1]!.s : Infinity;
      const tb = Math.max(ta + 0.1, Math.min(l.e, next) - (i + 1 < n ? lead : 0));
      pts.push([ta, l.z - da], [tb, l.z - db]);
      prev = tb;
    }
    camEnd = prev + tailSec;
    pts.push([camEnd, lines[n - 1]!.z - db + IDLE_V * tailSec]);
    // —— 采样 ——
    const N = Math.ceil(camEnd / CAM_DT) + 1;
    const raw = new Float32Array(N);
    let j = 0;
    for (let q = 0; q < N; q++) {
      const t = q * CAM_DT;
      while (j + 1 < pts.length && pts[j + 1]![0] <= t) j++;
      const a = pts[j]!;
      const b = pts[Math.min(j + 1, pts.length - 1)]!;
      raw[q] = b[0] > a[0] ? a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]) : a[1];
    }
    // —— 高斯平滑：开头按常数延伸，结尾按匀速漂延伸 ——
    const R = Math.ceil((3 * sigma) / CAM_DT);
    const w = new Float32Array(2 * R + 1);
    let ws = 0;
    for (let d = -R; d <= R; d++) {
      const v = Math.exp(-0.5 * ((d * CAM_DT) / sigma) ** 2);
      w[d + R] = v;
      ws += v;
    }
    cam = new Float32Array(N);
    for (let q = 0; q < N; q++) {
      let acc = 0;
      for (let d = -R; d <= R; d++) {
        const x = q + d;
        const v = x < 0 ? raw[0]! : x >= N ? raw[N - 1]! + IDLE_V * (x - N + 1) * CAM_DT : raw[x]!;
        acc += v * w[d + R]!;
      }
      cam[q] = acc / ws;
    }
    camEnd = (N - 1) * CAM_DT;
  }
  const zMin = z0 - 800;
  const zMax = (n ? lines[n - 1]!.z - db : 0) + IDLE_V * tailSec + FAR + 1200;
  return { lines, z0, cam, camEnd, zMin, zMax, off: buildHueOffsets(lines, shape, zMin, zMax) };
}

/** 镜头此刻的纵深。纯函数（查平滑后的轨迹），跳转进度时自然跟上。 */
export function camAt(r: Route, t: number): number {
  const { cam } = r;
  if (!cam.length) return r.z0 + IDLE_V * Math.max(0, t);
  if (t <= 0) return cam[0]!;
  if (t >= r.camEnd) return cam[cam.length - 1]! + IDLE_V * (t - r.camEnd);
  const f = t / CAM_DT;
  const q = Math.floor(f);
  const a = cam[q]!;
  const b = cam[Math.min(q + 1, cam.length - 1)]!;
  return a + (b - a) * (f - q);
}

// ---------------------------------------------------------------- 颜色旅程

const DEG = Math.PI / 180;
const OFF_STEP = 100;

/**
 * 沿路每处想要的色相 = 这首歌的色相 + 偏移（样张）：开头偏 160°（反差色），到第一次副歌的 Z 平滑回到 0；
 * 之后副歌处 0、其余段落 55°。分段值再做一次约 ±1200 的滑动平均，段落交界处慢慢转色。
 */
function buildHueOffsets(lines: RLine[], shape: SongShape | null, zMin: number, zMax: number): Float32Array {
  const cells = Math.max(2, Math.ceil((zMax - zMin) / OFF_STEP) + 1);
  const raw = new Float32Array(cells);
  const n = lines.length;
  let zFC = Number.NaN;
  if (n && shape) {
    const fc = shape.sections.find((s) => s.kind === 'chorus');
    let pick = fc;
    if (!pick && shape.sections.length) pick = shape.sections.reduce((a, b) => (b.lift > a.lift ? b : a));
    if (pick) zFC = lines[pick.from]?.z ?? Number.NaN;
  }
  if (!Number.isFinite(zFC)) zFC = zMin + 0.38 * (zMax - zMin);
  const zStart = n ? lines[0]!.z - 600 : zMin;
  let li = 0;
  for (let k = 0; k < cells; k++) {
    const z = zMin + k * OFF_STEP;
    if (z < zFC) {
      raw[k] = 160 * DEG * (1 - smooth((z - zStart) / Math.max(1, zFC - zStart)));
      continue;
    }
    while (li + 1 < n && lines[li + 1]!.z <= z) li++;
    const kind = n && shape ? shape.sections[shape.lineSection[li] ?? -1]?.kind : undefined;
    raw[k] = kind === 'chorus' || !n ? 0 : 55 * DEG;
  }
  // 副歌之后的段落起伏做滑动平均（副歌之前那段渐变本身是平滑的，平均后不变形）
  const W = 12;
  const out = new Float32Array(cells);
  let acc = 0;
  let cnt = 0;
  for (let k = -W; k < cells + W; k++) {
    const add = k + W;
    if (add < cells) {
      acc += raw[add]!;
      cnt++;
    }
    const drop = k - W - 1;
    if (drop >= 0) {
      acc -= raw[drop]!;
      cnt--;
    }
    if (k >= 0 && k < cells) out[k] = cnt ? acc / cnt : 0;
  }
  return out;
}

export function hueOffsetAt(r: Route, z: number): number {
  const f = (z - r.zMin) / OFF_STEP;
  const k = Math.floor(f);
  const a = r.off[clamp(k, 0, r.off.length - 1)]!;
  const b = r.off[clamp(k + 1, 0, r.off.length - 1)]!;
  return a + (b - a) * (f - k);
}

/** 这首歌的色相（oklab 色相角）；封面还没取到色调、或封面接近灰时退回曲目自带的 hue1。 */
export function songHue(track: Track | null): number {
  const t = track?.cover ? toneOf(track.cover) : null;
  if (t && chromaOf(t) > 0.025) return hueOf(t);
  return ((track?.hue1 ?? 250) * DEG) % (2 * Math.PI);
}

// ---------------------------------------------------------------- 封面摆位

export interface Slot {
  z: number;
  x: number;
  y: number;
  size: number;
  /** 曲目下标（tracks 里） */
  ci: number;
}

/** 大曲库的封面密度：两份初版比较后取中（初版 A .022 偏密、B 约 .015 偏疏），视野里约 90 张。 */
const DENSITY = 0.018;
/** 同一张封面两次出现之间至少隔这么远（大于可见纵深，同一张不会同时出现两次）。 */
const SEG_MIN = FAR + 200;

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const BINS = 24;
const BIN_W = (2 * Math.PI) / BINS;
/** 偏离目标色相超过这么多时，宁可放一张接近灰的封面（不抢颜色） */
const NEUTRAL_COST = 50 * DEG;
const NEUTRAL_CHROMA = 0.035;

/**
 * 沿路线摆封面：按「路段」摆，每段每张封面出现一次（大曲库一首歌通常只有一段）；
 * 每个位置挑颜色最接近该处目标色相的封面（颜色旅程），离路线中心 380–1700（开方分布）。
 * 小曲库补偿（样张，300 首以下逐渐生效）：封面放大（样张 300–360，初版 250–290）、离路线更近（300–900），路段缩短到可见纵深，按段重复。
 */
/** 封面离路线中心的范围（小曲库补偿程度 small 0–1 时）。穿行第二版的隧道壁按它算内倾。 */
export function slotRadius(small: number): { rMin: number; rMax: number } {
  return { rMin: 380 + (300 - 380) * small, rMax: 1700 + (900 - 1700) * small };
}

export function buildSlots(r: Route, tracks: Track[], baseHue: number, seed: number): { slots: Slot[]; small: number } {
  const n = tracks.length;
  if (!n) return { slots: [], small: 0 };
  const rand = mulberry(seed);
  const small = clamp((300 - n) / 260, 0, 1);
  const lerp = (a: number, b: number) => a + (b - a) * small;
  const { rMin, rMax } = slotRadius(small);
  // 样张补偿到 300–360；真实封面（白底、大字）放这么大像海报拼贴，初版收到 250–290
  const sMin = lerp(165, 250);
  const sVar = lerp(20, 40);
  const segLen = Math.max(SEG_MIN, n / DENSITY);
  // 每张封面按色相分桶（还没取到色调的当作近灰）
  const neutral: number[] = [];
  const bins: number[][] = Array.from({ length: BINS }, () => []);
  const order = tracks.map((_, i) => i);
  const slots: Slot[] = [];
  for (let seg = r.zMin; seg < r.zMax; seg += segLen) {
    // 每段重新洗一遍，同一个色相桶里谁先出场每段不同
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    neutral.length = 0;
    bins.forEach((b) => (b.length = 0));
    for (const i of order) {
      const t = tracks[i]!.cover ? toneOf(tracks[i]!.cover!) : null;
      if (!t || chromaOf(t) < NEUTRAL_CHROMA) {
        neutral.push(i);
        continue;
      }
      const h = ((hueOf(t) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      bins[Math.floor(h / BIN_W) % BINS]!.push(i);
    }
    const end = Math.min(r.zMax, seg + segLen);
    const m = Math.max(1, Math.round((n * (end - seg)) / segLen));
    for (let k = 0; k < m; k++) {
      const z = seg + ((k + rand()) * (end - seg)) / m;
      const want = (((baseHue + hueOffsetAt(r, z)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const b0 = Math.floor(want / BIN_W) % BINS;
      let ci = -1;
      for (let d = 0; d <= BINS / 2 && ci < 0; d++) {
        if (d * BIN_W > NEUTRAL_COST && neutral.length) break;
        for (const s of d ? [d, -d] : [0]) {
          const bin = bins[(b0 + s + BINS) % BINS]!;
          if (bin.length) {
            ci = bin.pop()!;
            break;
          }
        }
      }
      if (ci < 0) ci = neutral.pop() ?? -1;
      if (ci < 0) break;
      const rr = rMin + (rMax - rMin) * Math.sqrt(rand());
      const th = rand() * 2 * Math.PI;
      slots.push({ z, x: pathX(z) + rr * Math.cos(th), y: pathY(z) + rr * Math.sin(th) * 0.66, size: sMin + rand() * sVar, ci });
    }
  }
  slots.sort((a, b) => a.z - b.z);
  return { slots, small };
}

/** 第一个 z ≥ v 的下标（slots 已按 z 排好）。 */
export function lowerBound(slots: Slot[], v: number): number {
  let lo = 0;
  let hi = slots.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (slots[m]!.z < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}
