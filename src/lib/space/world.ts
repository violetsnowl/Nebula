import { CARD_HEIGHT, CARD_WIDTH, type CardSpec } from '../layout';
import type { Track } from '../catalog';
import { mulberry32, type RNG } from '../rng';
import { chromaOf, hueOf, toneOf } from './tone';
import { zoomToFit } from './lens';

/**
 * 主舞台星云（#133 原型 → #134 设置项 → #136 无边界）。
 *
 * #136（用户提议）：去掉边界和「中心密、四周稀」，改成一张首尾相接、没有尽头的平铺画布——
 * 往一个方向一直拖会从另一边接回来（像在星球表面走），用户永远看不见边界，也没有中心；
 * 疏密处处一样，唯一的焦点是镜头的透镜（以屏幕中心放大）。
 *
 * 画布是边长 period 的正方形，四边首尾相接。点的分布直接在首尾相接的画布上做蓝噪声
 * （泊松圆盘采样，距离按首尾相接算），接缝两边同样是「随机但不挤」，没有一条线。
 * 三种排法：
 *   - 随机：均匀撒满，每次打开换种子；
 *   - 按封面颜色：往右 = 色相沿彩虹走一圈（色相本来首尾相接），往下 = 由暗到鲜艳再回到暗；
 *   - 按歌手：星团均匀散开（不再越大越靠中心），单曲歌手按颜色填在团与团之间。
 */
export interface SpaceCluster {
  key: string;
  name: string;
  cx: number;
  cy: number;
  r: number;
  ids: number[];
}

export type WorldMode = 'chroma' | 'cluster' | 'random';

export interface SpaceWorld {
  mode: WorldMode;
  cards: CardSpec[];
  /** 卡片盒中心（世界坐标，0 ≤ x, y < period） */
  px: Float64Array;
  py: Float64Array;
  /** 首尾相接的周期（正方形边长） */
  period: number;
  /** 按歌手时的星团（其余排法为空） */
  clusters: SpaceCluster[];
  /** 每首歌属于哪个星团（其余排法为 -1） */
  clusterOf: Int32Array;
  grid: { cell: number; cols: number; cells: number[][] };
}

const TAU = Math.PI * 2;
/** 卡片最小间距（处处一样）：卡片 172px，不会重叠 */
const SPACING = 190;
/** 小歌单的最小周期：太小的话拖一下就转回来了 */
const MIN_PERIOD = 1800;
/** 泊松圆盘采样每个点大约占 1.5 s² 的面积 */
const AREA_PER_POINT = 1.5;
/** 按颜色 / 按歌手用固定种子（同一份歌单每次排出来一样，方便记住位置）；随机每次打开换一个。 */
const FIXED_SEED = 20261116;
const SESSION_SEED = (Math.random() * 0xffffffff) >>> 0;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function angle01(a: number): number {
  return ((a % TAU) + TAU) % TAU;
}
function angDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
}
function mod(v: number, T: number): number {
  return ((v % T) + T) % T;
}
/** 首尾相接时 a 到 b 的最短位移（-T/2 ~ T/2）。 */
export function wrapDelta(d: number, T: number): number {
  return d - T * Math.round(d / T);
}

interface Pt {
  x: number;
  y: number;
}

/**
 * 首尾相接画布上的泊松圆盘采样（间距 s 处处一样），长满为止。
 * exclude 返回 true 的位置不放点（按歌手时绕开星团）；被隔开的空隙随机补种子。
 */
function torusPoisson(T: number, s: number, rng: RNG, exclude?: (x: number, y: number) => boolean): Pt[] {
  const cols = Math.max(1, Math.floor(T / (s / Math.SQRT2)));
  const cell = T / cols;
  const grid = new Int32Array(cols * cols).fill(-1);
  const pts: Pt[] = [];
  const active: number[] = [];
  const reach = Math.ceil(s / cell);
  const s2 = s * s;
  const fits = (x: number, y: number): boolean => {
    if (exclude?.(x, y)) return false;
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let dy = -reach; dy <= reach; dy++) {
      const ry = mod(gy + dy, cols) * cols;
      for (let dx = -reach; dx <= reach; dx++) {
        const q = grid[ry + mod(gx + dx, cols)]!;
        if (q < 0) continue;
        const o = pts[q]!;
        const ddx = wrapDelta(o.x - x, T);
        const ddy = wrapDelta(o.y - y, T);
        if (ddx * ddx + ddy * ddy < s2) return false;
      }
    }
    return true;
  };
  const add = (x: number, y: number) => {
    grid[Math.floor(y / cell) * cols + Math.floor(x / cell)] = pts.length;
    pts.push({ x, y });
    active.push(pts.length - 1);
  };
  let reseeds = 0;
  while (reseeds < 500) {
    if (!active.length) {
      reseeds++;
      const x = rng() * T;
      const y = rng() * T;
      if (fits(x, y)) add(x, y);
      continue;
    }
    const ai = Math.floor(rng() * active.length);
    const p = pts[active[ai]!]!;
    let found = false;
    for (let k = 0; k < 30; k++) {
      const th = rng() * TAU;
      const d = s * (1 + rng());
      const x = mod(p.x + d * Math.cos(th), T);
      const y = mod(p.y + d * Math.sin(th), T);
      if (fits(x, y)) {
        add(x, y);
        found = true;
        break;
      }
    }
    if (!found) {
      active[ai] = active[active.length - 1]!;
      active.pop();
    }
  }
  return pts;
}

/** 正好 count 个点：按估计的周期撒满，多了随机去掉几个（空位很分散），少了放大周期重来。 */
function evenPoints(count: number, rng: RNG): { pts: Pt[]; T: number } {
  let s = SPACING;
  let T = Math.sqrt(count * AREA_PER_POINT) * s;
  if (T < MIN_PERIOD) {
    // 小歌单：周期不小于 MIN_PERIOD，间距相应放大
    s = MIN_PERIOD / Math.sqrt(Math.max(1, count) * AREA_PER_POINT);
    T = MIN_PERIOD;
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const pts = torusPoisson(T, s, rng);
    if (pts.length >= count) {
      for (let i = pts.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pts[i], pts[j]] = [pts[j]!, pts[i]!];
      }
      pts.length = count;
      return { pts, T };
    }
    T *= Math.sqrt(count / Math.max(1, pts.length)) * 1.03;
  }
  // 兜底（不会走到）：网格
  const side = Math.ceil(Math.sqrt(count));
  T = side * s * 1.2;
  return { pts: Array.from({ length: count }, (_, k) => ({ x: ((k % side) + 0.5) * (T / side), y: (Math.floor(k / side) + 0.5) * (T / side) })), T };
}

function buildGrid(px: Float64Array, py: Float64Array, T: number): SpaceWorld['grid'] {
  const cols = Math.max(1, Math.floor(T / 520));
  const cell = T / cols;
  const cells: number[][] = Array.from({ length: cols * cols }, () => []);
  for (let i = 0; i < px.length; i++) {
    const gx = Math.min(cols - 1, Math.floor(px[i]! / cell));
    const gy = Math.min(cols - 1, Math.floor(py[i]! / cell));
    cells[gy * cols + gx]!.push(i);
  }
  return { cell, cols, cells };
}

function finish(
  mode: WorldMode,
  songs: Track[],
  px: Float64Array,
  py: Float64Array,
  T: number,
  clusters: SpaceCluster[],
  clusterOf: Int32Array,
): SpaceWorld {
  for (let i = 0; i < px.length; i++) {
    px[i] = mod(px[i]!, T);
    py[i] = mod(py[i]!, T);
  }
  for (const c of clusters) {
    c.cx = mod(c.cx, T);
    c.cy = mod(c.cy, T);
  }
  const cards: CardSpec[] = songs.map((track, i) => ({
    id: i,
    x: px[i]! - CARD_WIDTH / 2,
    y: py[i]! - CARD_HEIGHT / 2,
    rotateZ: 0,
    track,
  }));
  return { mode, cards, px, py, period: T, clusters, clusterOf, grid: buildGrid(px, py, T) };
}

/**
 * 镜头中心 (cx, cy) 周围半宽 hx、半高 hy 的矩形里的卡片 id（首尾相接），写进 out。
 * 调用方保证矩形不超过一个周期（缩放下限保证），所以每首歌只会出现一次。
 */
export function queryRect(w: SpaceWorld, cx: number, cy: number, hx: number, hy: number, out: number[]): void {
  const { cell, cols, cells } = w.grid;
  const T = w.period;
  const x0 = Math.floor((cx - hx) / cell);
  const x1 = Math.floor((cx + hx) / cell);
  const y0 = Math.floor((cy - hy) / cell);
  const y1 = Math.floor((cy + hy) / cell);
  const seen = cols * cols < (x1 - x0 + 1) * (y1 - y0 + 1) ? new Set<number>() : null;
  for (let gy = y0; gy <= y1; gy++) {
    const ry = mod(gy, cols) * cols;
    for (let gx = x0; gx <= x1; gx++) {
      const key = ry + mod(gx, cols);
      if (seen) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      for (const id of cells[key]!) {
        if (Math.abs(wrapDelta(w.px[id]! - cx, T)) <= hx && Math.abs(wrapDelta(w.py[id]! - cy, T)) <= hy) out.push(id);
      }
    }
  }
}

// ---------------------------------------------------------------- 色彩顺序 + 按色带分配

/**
 * 封面颜色的「深度」次序：近中性的封面（OKLab 彩度 < 0.035，用户曲库里约一半，色相只是噪声）在前，按明暗从深到浅；
 * 有颜色的在后，按彩度从淡到浓。色相角 0–2π（红在 0）。
 */
const NEUTRAL_C = 0.035;
const HUE_ROTATE = -0.5; // OKLab 红约 0.5 弧度 → 0

function colorOrder(songs: Track[], ids: number[]): { order: number[]; hueAng: Map<number, number> } {
  const key = new Map<number, number>();
  const hueAng = new Map<number, number>();
  for (const i of ids) {
    const t = toneOf(songs[i]!.cover);
    const c = t ? chromaOf(t) : 0;
    const L = t ? t[0] : 0.5;
    hueAng.set(i, t ? angle01(hueOf(t) + HUE_ROTATE) : 0);
    key.set(i, c < NEUTRAL_C ? L : 1 + c);
  }
  const order = [...ids].sort((a, b) => key.get(a)! - key.get(b)! || a - b);
  return { order, hueAng };
}

/**
 * 在首尾相接的画布上按颜色分配：横向（x）= 色相，绕一圈正好一个周期；
 * 纵向（y）= 深度，上下两半镜像（y = 0 和周期处最暗、正中最鲜艳），上下接缝也是连续的。
 * 点按「深度坐标」切成一条条色带（每条厚约 1.3 个间距），歌按 order 依次分到各带；
 * 带内点按 x 排、歌按色相排，再找一个整体平移，让每张封面的横向位置尽量贴近它的色相。
 */
function assignBands(pts: Pt[], order: number[], hueAng: Map<number, number>, T: number, s: number, px: Float64Array, py: Float64Array): void {
  const n = order.length;
  const depth = (p: Pt) => 1 - Math.abs((2 * p.y) / T - 1);
  const idx = pts.map((_, k) => k).sort((a, b) => depth(pts[a]!) - depth(pts[b]!));
  const bandD = Math.max(1e-6, (2.6 * s) / T);
  let start = 0;
  let d0 = depth(pts[idx[0]!]!);
  for (let k = 1; k <= n; k++) {
    if (k < n && depth(pts[idx[k]!]!) - d0 < bandD) continue;
    const band = idx.slice(start, k).sort((a, b) => pts[a]!.x - pts[b]!.x);
    const songsIn = order.slice(start, k).sort((a, b) => hueAng.get(a)! - hueAng.get(b)!);
    const m = band.length;
    let best = 0;
    let bestCost = Infinity;
    for (let sh = 0; sh < m; sh++) {
      let cost = 0;
      for (let i = 0; i < m; i++) cost += angDiff((pts[band[(i + sh) % m]!]!.x / T) * TAU, hueAng.get(songsIn[i]!)!);
      if (cost < bestCost) {
        bestCost = cost;
        best = sh;
      }
    }
    for (let i = 0; i < m; i++) {
      const p = pts[band[(i + best) % m]!]!;
      px[songsIn[i]!] = p.x;
      py[songsIn[i]!] = p.y;
    }
    start = k;
    if (k < n) d0 = depth(pts[idx[k]!]!);
  }
}

// ---------------------------------------------------------------- 按封面颜色

export function buildChroma(songs: Track[]): SpaceWorld {
  const n = songs.length;
  const { pts, T } = evenPoints(n, mulberry32(FIXED_SEED));
  const { order, hueAng } = colorOrder(songs, Array.from({ length: n }, (_, i) => i));
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  assignBands(pts, order, hueAng, T, SPACING, px, py);
  return finish('chroma', songs, px, py, T, [], new Int32Array(n).fill(-1));
}

// ---------------------------------------------------------------- 随机

/** 不按颜色也不按歌手：每次打开换一个种子重新撒，同一次使用里不变（同一份歌单算出来一样）。 */
export function buildRandom(songs: Track[]): SpaceWorld {
  const n = songs.length;
  const rng = mulberry32(SESSION_SEED);
  const { pts, T } = evenPoints(n, rng);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  pts.forEach((p, k) => {
    px[k] = p.x;
    py[k] = p.y;
  });
  return finish('random', songs, px, py, T, [], new Int32Array(n).fill(-1));
}

// ---------------------------------------------------------------- 按歌手

/** 主歌手：按 / 、 & , feat. ft. x 拆开取第一个。 */
function primaryArtist(artist: string | undefined): { key: string; name: string } {
  const name = (artist ?? '').split(/\s*(?:\/|、|&|,|，|;|；|\bfeat\.?\b|\bft\.?\b|\bx\b)\s*/i)[0]?.trim() ?? '';
  return { key: name.toLowerCase() || '(未知歌手)', name: name || '未知歌手' };
}

/** 一团歌的形状：蓝噪声取最靠里的 m 个，带一点轮廓起伏（团是一块完整的形状，不首尾相接）。 */
function blobPoints(m: number, s: number, rng: RNG): Pt[] {
  const cell = s / Math.SQRT2;
  const R = Math.sqrt(m * AREA_PER_POINT * 1.6) * s * 0.62 + s;
  const grid = new Map<number, number>();
  const key = (gx: number, gy: number) => (gx + 4096) * 8192 + (gy + 4096);
  const pts: Pt[] = [];
  const active: number[] = [];
  const fits = (x: number, y: number) => {
    if (x * x + y * y > R * R) return false;
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const q = grid.get(key(gx + dx, gy + dy));
        if (q === undefined) continue;
        const o = pts[q]!;
        if ((o.x - x) ** 2 + (o.y - y) ** 2 < s * s) return false;
      }
    return true;
  };
  const add = (x: number, y: number) => {
    grid.set(key(Math.floor(x / cell), Math.floor(y / cell)), pts.length);
    pts.push({ x, y });
    active.push(pts.length - 1);
  };
  add(0, 0);
  while (active.length) {
    const ai = Math.floor(rng() * active.length);
    const p = pts[active[ai]!]!;
    let found = false;
    for (let k = 0; k < 30; k++) {
      const th = rng() * TAU;
      const d = s * (1 + rng());
      const x = p.x + d * Math.cos(th);
      const y = p.y + d * Math.sin(th);
      if (fits(x, y)) {
        add(x, y);
        found = true;
        break;
      }
    }
    if (!found) {
      active[ai] = active[active.length - 1]!;
      active.pop();
    }
  }
  const ph = rng() * TAU;
  const rr = (p: Pt) => Math.hypot(p.x, p.y) / (1 + 0.08 * Math.sin(3 * Math.atan2(p.y, p.x) + ph));
  pts.sort((a, b) => rr(a) - rr(b));
  return pts.slice(0, Math.min(m, pts.length));
}

/**
 * 同一歌手的歌聚成一团（团内 186px 蓝噪声，像墙一样密），同一张专辑的歌挨在一个扇区里。
 * 两首以上的星团从大到小，依次放在画布上均匀分布的候选位置（低差异序列）中第一个放得下的地方，
 * 星团之间的间距 56 + 0.32 × 较小星团半径，给歌词和光留出空气——没有中心，大星团散在各处。
 * 只有一首歌的歌手填进团与团之间的空位，按颜色分色带（和按颜色排法同一套规则）。
 */
export function buildCluster(songs: Track[]): SpaceWorld {
  const n = songs.length;
  const groups = new Map<string, { name: string; ids: number[] }>();
  songs.forEach((s, i) => {
    const { key, name } = primaryArtist(s.artist);
    const g = groups.get(key);
    if (g) g.ids.push(i);
    else groups.set(key, { name, ids: [i] });
  });
  const S = 186;
  const list = [...groups.entries()]
    .map(([key, g]) => ({ key, name: g.name, ids: g.ids, r: 0, cx: 0, cy: 0, lx: [] as number[], ly: [] as number[] }))
    .sort((a, b) => b.ids.length - a.ids.length || (a.key < b.key ? -1 : 1));

  for (const c of list) {
    const m = c.ids.length;
    if (m === 1) {
      c.lx = [0];
      c.ly = [0];
      c.r = 98;
      continue;
    }
    let raw = blobPoints(m, S, mulberry32(hash(c.key)));
    if (raw.length < m) raw = blobPoints(m, S * 0.98, mulberry32(hash(c.key) + 1));
    const gx = raw.reduce((s, p) => s + p.x, 0) / raw.length;
    const gy = raw.reduce((s, p) => s + p.y, 0) / raw.length;
    const pts = raw.map((p) => ({ x: p.x - gx, y: p.y - gy, a: angle01(Math.atan2(p.y - gy, p.x - gx)) }));
    const albumSize = new Map<string, number>();
    for (const id of c.ids) {
      const al = songs[id]!.album ?? '';
      albumSize.set(al, (albumSize.get(al) ?? 0) + 1);
    }
    const ids = [...c.ids].sort((a, b) => {
      const A = songs[a]!.album ?? '';
      const B = songs[b]!.album ?? '';
      return albumSize.get(B)! - albumSize.get(A)! || (A < B ? -1 : A > B ? 1 : 0) || (songs[a]!.title < songs[b]!.title ? -1 : 1);
    });
    const byAngle = pts.map((_, k) => k).sort((a, b) => pts[a]!.a - pts[b]!.a);
    c.ids = ids;
    c.lx = new Array<number>(m);
    c.ly = new Array<number>(m);
    byAngle.forEach((k, j) => {
      c.lx[j] = pts[k]!.x;
      c.ly[j] = pts[k]!.y;
    });
    c.r = Math.max(...pts.map((p) => Math.hypot(p.x, p.y))) + 98;
  }

  const singles = list.filter((c) => c.ids.length === 1);
  const multi = list.filter((c) => c.ids.length > 1);
  const gapOf = (a: number, b: number) => 56 + 0.32 * Math.min(a, b);
  const SP = 200;

  // 周期按面积估：星团（含一半间距）+ 单曲歌手的点；放不下就放大重来
  let area = singles.length * AREA_PER_POINT * SP * SP;
  for (const c of multi) area += Math.PI * (c.r + gapOf(c.r, 98) / 2) ** 2 * 1.25;
  let T = Math.max(MIN_PERIOD, Math.sqrt(area));
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  // R2 低差异序列：候选位置在画布上均匀铺开（比随机更匀，没有聚堆）
  const g2 = 1.32471795724474602596;
  const a1 = 1 / g2;
  const a2 = 1 / (g2 * g2);
  for (let attempt = 0; attempt < 8; attempt++, T *= 1.08) {
    let ok = true;
    let k = 0;
    for (let ci = 0; ci < multi.length; ci++) {
      const c = multi[ci]!;
      let placed = false;
      for (let tries = 0; tries < 6000; tries++, k++) {
        const x = (0.5 + a1 * k) % 1 * T;
        const y = (0.5 + a2 * k) % 1 * T;
        let clear = true;
        for (let oi = 0; oi < ci; oi++) {
          const o = multi[oi]!;
          const dx = wrapDelta(o.cx - x, T);
          const dy = wrapDelta(o.cy - y, T);
          const need = c.r + o.r + gapOf(c.r, o.r);
          if (dx * dx + dy * dy < need * need) {
            clear = false;
            break;
          }
        }
        if (clear) {
          c.cx = x;
          c.cy = y;
          placed = true;
          break;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // 单曲歌手：团外的空位撒蓝噪声（离星团边缘至少 98 + 30px），够数就按颜色分色带
    const blocked = (x: number, y: number) => {
      for (const o of multi) {
        const dx = wrapDelta(o.cx - x, T);
        const dy = wrapDelta(o.cy - y, T);
        const need = o.r + 98 + 30;
        if (dx * dx + dy * dy < need * need) return true;
      }
      return false;
    };
    const free = singles.length ? torusPoisson(T, SP, mulberry32(FIXED_SEED + 1 + attempt), blocked) : [];
    if (free.length < singles.length) continue;
    const rng = mulberry32(FIXED_SEED + 7);
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [free[i], free[j]] = [free[j]!, free[i]!];
    }
    free.length = singles.length;
    if (singles.length) {
      const ids = singles.map((c) => c.ids[0]!);
      const { order, hueAng } = colorOrder(songs, ids);
      assignBands(free, order, hueAng, T, SP, px, py);
      for (const c of singles) {
        c.cx = px[c.ids[0]!]!;
        c.cy = py[c.ids[0]!]!;
      }
    }
    const clusterOf = new Int32Array(n);
    const clusters: SpaceCluster[] = list.map((c, ci) => {
      c.ids.forEach((id, j) => {
        px[id] = c.cx + c.lx[j]!;
        py[id] = c.cy + c.ly[j]!;
        clusterOf[id] = ci;
      });
      return { key: c.key, name: c.name, cx: c.cx, cy: c.cy, r: c.r, ids: c.ids };
    });
    return finish('cluster', songs, px, py, T, clusters, clusterOf);
  }
  // 放不下（不会走到）：退回随机
  return { ...buildRandom(songs), mode: 'cluster' };
}

// ---------------------------------------------------------------- 搜索落点

/**
 * 搜索后镜头飞去哪里（世界坐标；镜头会走首尾相接里最近的那条路）：
 *   - 按歌手：命中大多落在同一个星团（搜歌手）→ 飞到这个星团，缩放到正好装下它；
 *   - 指定了某一首（从下拉里点的）或命中很分散 → 飞到那一首，缩放 1。
 */
export function searchTarget(
  w: SpaceWorld,
  matchIds: number[],
  focus: number | null,
  preferSong: boolean,
  vw: number,
  vh: number,
  lens: number,
): { cx: number; cy: number; zoom: number } | null {
  const ids = matchIds.filter((i) => i >= 0 && i < w.cards.length);
  if (!ids.length && focus == null) return null;
  if (w.mode === 'cluster' && !preferSong && ids.length >= 2) {
    const count = new Map<number, number>();
    for (const id of ids) {
      const c = w.clusterOf[id]!;
      if (c >= 0) count.set(c, (count.get(c) ?? 0) + 1);
    }
    let best = -1;
    let bestN = 0;
    for (const [c, k] of count) {
      if (k > bestN || (k === bestN && w.clusters[c]!.ids.length > w.clusters[best]!.ids.length)) {
        best = c;
        bestN = k;
      }
    }
    if (best >= 0 && bestN >= 2) {
      const c = w.clusters[best]!;
      return { cx: c.cx, cy: c.cy, zoom: zoomToFit(c.r, 0.44 * Math.min(vw, vh), lens, 0.3, 1.1) };
    }
  }
  const id = focus != null && focus >= 0 && focus < w.cards.length ? focus : ids[0]!;
  return { cx: w.px[id]!, cy: w.py[id]!, zoom: 1 };
}

/**
 * 缩放下限：最远也要认得出封面（约 48px，0.28 倍）；同时一屏不超过周期的一部分，
 * 同一首歌不会在同一屏里出现两次，转一圈也不会太快（大歌单 60%，小歌单最多 92%）。
 */
export function zoomFloor(w: SpaceWorld, vw: number, vh: number): number {
  const n = w.cards.length;
  const t = Math.min(1, Math.max(0, (n - 60) / 340));
  const share = 0.92 - 0.32 * (t * t * (3 - 2 * t));
  return Math.max(0.28, vw / (share * w.period), vh / (share * w.period));
}
