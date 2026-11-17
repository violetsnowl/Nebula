import { CARD_HEIGHT, CARD_WIDTH, type CardSpec } from '../layout';
import type { Track } from '../catalog';
import { mulberry32, type RNG } from '../rng';
import { chromaOf, hueOf, toneOf } from './tone';
import { zoomToFit } from './lens';

/**
 * 主舞台星云（#133 原型 → #134 做成设置项）。和旧卡片墙的区别：
 *   - 世界有边界（一整片星云，中心在原点），不再周期回绕；缩小能看到它的全貌和形状；
 *   - 三种排法：按歌手（星团）、按封面颜色（色彩星图）、随机（每次打开重撒）；
 *   - 真正的中心密、四周稀：卡片间距从中心 196px 往外逐渐放宽，外圈留出空气。
 *
 * 点的分布用「蓝噪声」（Bridson 泊松圆盘采样，间距随半径变化）：随机但任意两点不近于设定间距，
 * 186px 以上的间距下卡片（172px）不会重叠。#133 用的是向日葵点阵，缩到全貌时会露出 13 / 21 / 34 条一组的螺旋
 * （像万花筒、LED 点阵，用户反馈），蓝噪声没有这种图案。
 * 轮廓也不再是正圆：按「带起伏的半径」取点，边缘像一团云。
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

export interface BoundedWorld {
  mode: WorldMode;
  cards: CardSpec[];
  /** 卡片盒中心（世界坐标） */
  px: Float64Array;
  py: Float64Array;
  /** 整片星云的半径 */
  radius: number;
  /** 按歌手时的星团（其余排法为空） */
  clusters: SpaceCluster[];
  /** 每首歌属于哪个星团（其余排法为 -1） */
  clusterOf: Int32Array;
  grid: { cell: number; min: number; cols: number; cells: number[][] };
}

const TAU = Math.PI * 2;
/** 按颜色 / 按歌手用固定种子（同一份歌单每次排出来一样，方便记住位置）；随机每次打开换一个。 */
const FIXED_SEED = 20261116;
const SESSION_SEED = (Math.random() * 0xffffffff) >>> 0;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Pt {
  x: number;
  y: number;
  /** 排序用的半径（带轮廓起伏） */
  r: number;
  /** 方位角 0–2π */
  a: number;
}

function angle01(a: number): number {
  return ((a % TAU) + TAU) % TAU;
}
function angDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
}

/** 轮廓起伏：几个低频正弦叠加，±amp 左右，让外缘像云而不是正圆。 */
function rimNoise(rng: RNG, amp: number): (a: number) => number {
  const terms = [2, 3, 5, 7].map((k, i) => ({ k, ph: rng() * TAU, w: amp / (1 + i * 0.7) }));
  return (a: number) => 1 + terms.reduce((s, t) => s + t.w * Math.sin(t.k * a + t.ph), 0);
}

/**
 * 变间距的泊松圆盘采样，取最靠里的 count 个点（按带起伏的半径排序）。
 * spacing(r) 是半径 r 处两点的最小距离（随半径不减）；exclude 返回 true 的位置不放点（按歌手时绕开星团）。
 * 活动表空了但点还不够（被星团隔开的空隙）时，在范围内随机补种子继续长。
 */
function blueNoise(
  count: number,
  spacing: (r: number) => number,
  rng: RNG,
  amp: number,
  exclude?: (x: number, y: number) => boolean,
): Pt[] {
  if (count <= 0) return [];
  const sMin = spacing(0);
  const cell = sMin / Math.SQRT2;
  // 估计需要的范围：泊松圆盘每个点约占 1.5 s² 的面积，多留 40% 给轮廓取舍和避让
  let R = 0;
  for (let n = 0; n < count * 1.4; R += 40) n += (TAU * R * 40) / (1.5 * spacing(R) ** 2);
  const noise = rimNoise(rng, amp);
  for (let attempt = 0; attempt < 6; attempt++, R *= 1.25) {
    const pts: { x: number; y: number }[] = [];
    const grid = new Map<number, number>();
    const key = (gx: number, gy: number) => (gx + 32768) * 65536 + (gy + 32768);
    const sMax = spacing(R);
    const reachCells = Math.ceil(sMax / cell);
    const fits = (x: number, y: number): boolean => {
      if (x * x + y * y > R * R) return false;
      if (exclude?.(x, y)) return false;
      const s = spacing(Math.hypot(x, y));
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      for (let dx = -reachCells; dx <= reachCells; dx++) {
        for (let dy = -reachCells; dy <= reachCells; dy++) {
          const q = grid.get(key(gx + dx, gy + dy));
          if (q === undefined) continue;
          const o = pts[q]!;
          const need = Math.max(s, spacing(Math.hypot(o.x, o.y)));
          if ((o.x - x) ** 2 + (o.y - y) ** 2 < need * need) return false;
        }
      }
      return true;
    };
    const add = (x: number, y: number) => {
      grid.set(key(Math.floor(x / cell), Math.floor(y / cell)), pts.length);
      pts.push({ x, y });
      active.push(pts.length - 1);
    };
    const active: number[] = [];
    if (fits(0, 0)) add(0, 0);
    let reseeds = 0;
    while (reseeds < 400) {
      if (!active.length) {
        // 补种子：在范围里随机找一个能放的位置（被星团隔开的空隙也能长满）
        reseeds++;
        const rr = R * Math.sqrt(rng());
        const th = rng() * TAU;
        const x = rr * Math.cos(th);
        const y = rr * Math.sin(th);
        if (fits(x, y)) add(x, y);
        continue;
      }
      const ai = Math.floor(rng() * active.length);
      const p = pts[active[ai]!]!;
      const s = spacing(Math.hypot(p.x, p.y));
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
    if (pts.length < count) continue;
    const out: Pt[] = pts.map((p) => {
      const a = angle01(Math.atan2(p.y, p.x));
      return { x: p.x, y: p.y, r: Math.hypot(p.x, p.y) / noise(a), a };
    });
    out.sort((a, b) => a.r - b.r);
    out.length = count;
    return out;
  }
  // 极端情况兜底（不会走到）：按螺线排
  return Array.from({ length: count }, (_, k) => {
    const r = sMin * Math.sqrt(k + 0.5);
    const a = angle01(k * 2.399963);
    return { x: r * Math.cos(a), y: r * Math.sin(a), r, a };
  });
}

function buildGrid(px: Float64Array, py: Float64Array, radius: number): BoundedWorld['grid'] {
  const cell = 520;
  const min = -radius - cell;
  const cols = Math.ceil((2 * radius + 2 * cell) / cell) + 1;
  const cells: number[][] = Array.from({ length: cols * cols }, () => []);
  for (let i = 0; i < px.length; i++) {
    const cx = Math.floor((px[i]! - min) / cell);
    const cy = Math.floor((py[i]! - min) / cell);
    cells[cy * cols + cx]!.push(i);
  }
  return { cell, min, cols, cells };
}

function finish(
  mode: WorldMode,
  songs: Track[],
  px: Float64Array,
  py: Float64Array,
  clusters: SpaceCluster[],
  clusterOf: Int32Array,
): BoundedWorld {
  let radius = 0;
  for (let i = 0; i < px.length; i++) radius = Math.max(radius, Math.hypot(px[i]!, py[i]!));
  for (const c of clusters) radius = Math.max(radius, Math.hypot(c.cx, c.cy) + c.r);
  radius += 120;
  const cards: CardSpec[] = songs.map((track, i) => ({
    id: i,
    x: px[i]! - CARD_WIDTH / 2,
    y: py[i]! - CARD_HEIGHT / 2,
    rotateZ: 0,
    track,
  }));
  return { mode, cards, px, py, radius, clusters, clusterOf, grid: buildGrid(px, py, radius) };
}

/** 世界圆盘内（圆心 cx, cy，半径 R）的卡片 id，写进 out。 */
export function queryDisc(w: BoundedWorld, cx: number, cy: number, R: number, out: number[]): void {
  const { cell, min, cols, cells } = w.grid;
  const x0 = Math.max(0, Math.floor((cx - R - min) / cell));
  const x1 = Math.min(cols - 1, Math.floor((cx + R - min) / cell));
  const y0 = Math.max(0, Math.floor((cy - R - min) / cell));
  const y1 = Math.min(cols - 1, Math.floor((cy + R - min) / cell));
  const R2 = R * R;
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const arr = cells[gy * cols + gx]!;
      for (const id of arr) {
        const dx = w.px[id]! - cx;
        const dy = w.py[id]! - cy;
        if (dx * dx + dy * dy <= R2) out.push(id);
      }
    }
  }
}

/**
 * 最小间距：中心 186px，往外逐渐放宽到 280px（卡片 172px，不会重叠）。
 * 蓝噪声的平均间距比最小间距大 10–30%，所以比向日葵点阵（196px）收紧一点，疏密观感和 #133 相当。
 */
const spacingFalloff = (r: number) => 186 + 94 * smoothstep(0, 5000, r);

// ---------------------------------------------------------------- 色彩顺序（按颜色全部、按歌手的单曲歌手）

/**
 * 封面颜色的「由内到外」顺序 + 方位角：
 *   - 近中性的封面（OKLab 彩度 < 0.035，用户曲库里约占一半，色相只是噪声）在内圈，按明暗从深到浅排；
 *   - 有颜色的在外圈，按彩度从淡到浓排；
 *   于是半径方向是一条连续的过渡：深 → 浅灰 → 粉彩 → 鲜艳。方位角 = 色相（红在正上方）。
 */
const HUE_ROTATE = -Math.PI / 2 - 0.5; // OKLab 红约 0.5 弧度 → 屏幕正上方
const NEUTRAL_C = 0.035;

function colorOrder(songs: Track[], ids: number[]): { order: number[]; hueAng: Map<number, number> } {
  const key = new Map<number, number>();
  const hueAng = new Map<number, number>();
  for (const i of ids) {
    const t = toneOf(songs[i]!.cover);
    const c = t ? chromaOf(t) : 0;
    const L = t ? t[0] : 0.5;
    hueAng.set(i, t ? angle01(hueOf(t) + HUE_ROTATE) : 0);
    // 中性：0–1 按亮度；有颜色：1 起按彩度
    key.set(i, c < NEUTRAL_C ? L : 1 + c);
  }
  const order = [...ids].sort((a, b) => key.get(a)! - key.get(b)! || a - b);
  return { order, hueAng };
}

/**
 * 点（已按带起伏的半径由内到外排好）切成一圈一圈（每圈厚约 1.3 个间距），歌按 order 依次分到各圈；
 * 每一圈里点按方位角排、歌按色相排，再找一个整体旋转，让每张封面的方位尽量贴近它真实的色相角。
 * 点是蓝噪声，圈与圈之间没有可见的界线。
 */
function assignRings(
  pts: Pt[],
  order: number[],
  hueAng: Map<number, number>,
  spacing: (r: number) => number,
  px: Float64Array,
  py: Float64Array,
): void {
  const n = order.length;
  let start = 0;
  let r0 = pts[0]?.r ?? 0;
  for (let k = 1; k <= n; k++) {
    if (k < n && pts[k]!.r - r0 < 1.3 * spacing(r0)) continue;
    const ring = Array.from({ length: k - start }, (_, j) => start + j).sort((a, b) => pts[a]!.a - pts[b]!.a);
    const songsIn = order.slice(start, k).sort((a, b) => hueAng.get(a)! - hueAng.get(b)!);
    const m = ring.length;
    let best = 0;
    let bestCost = Infinity;
    for (let sh = 0; sh < m; sh++) {
      let cost = 0;
      for (let i = 0; i < m; i++) cost += angDiff(pts[ring[(i + sh) % m]!]!.a, hueAng.get(songsIn[i]!)!);
      if (cost < bestCost) {
        bestCost = cost;
        best = sh;
      }
    }
    for (let i = 0; i < m; i++) {
      const p = pts[ring[(i + best) % m]!]!;
      px[songsIn[i]!] = p.x;
      py[songsIn[i]!] = p.y;
    }
    start = k;
    if (k < n) r0 = pts[k]!.r;
  }
}

// ---------------------------------------------------------------- 按封面颜色

/** 方位角 = 色相，半径 = 由深到浅、由淡到浓（见 colorOrder）。半径按「名次」分配，密度由点的分布控制。 */
export function buildChroma(songs: Track[]): BoundedWorld {
  const n = songs.length;
  const { order, hueAng } = colorOrder(songs, Array.from({ length: n }, (_, i) => i));
  const pts = blueNoise(n, spacingFalloff, mulberry32(FIXED_SEED), 0.1);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  assignRings(pts, order, hueAng, spacingFalloff, px, py);
  return finish('chroma', songs, px, py, [], new Int32Array(n).fill(-1));
}

// ---------------------------------------------------------------- 随机

/** 不按颜色也不按歌手：每次打开换一个种子重新撒，同一次使用里不变（同一份歌单算出来一样）。 */
export function buildRandom(songs: Track[]): BoundedWorld {
  const n = songs.length;
  const rng = mulberry32(SESSION_SEED);
  const pts = blueNoise(n, spacingFalloff, rng, 0.1);
  const ids = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  ids.forEach((id, k) => {
    px[id] = pts[k]!.x;
    py[id] = pts[k]!.y;
  });
  return finish('random', songs, px, py, [], new Int32Array(n).fill(-1));
}

// ---------------------------------------------------------------- 按歌手

/** 主歌手：按 / 、 & , feat. ft. x 拆开取第一个。 */
function primaryArtist(artist: string | undefined): { key: string; name: string } {
  const name = (artist ?? '').split(/\s*(?:\/|、|&|,|，|;|；|\bfeat\.?\b|\bft\.?\b|\bx\b)\s*/i)[0]?.trim() ?? '';
  return { key: name.toLowerCase() || '(未知歌手)', name: name || '未知歌手' };
}

/**
 * 同一歌手的歌聚成一团（团内 186px 蓝噪声，像墙一样密；轮廓略有起伏），同一张专辑的歌挨在一个扇区里。
 * 两首以上的星团从大到小，依次放在「离中心最近、又和已放的星团保持间距」的位置：最大的在中心。
 * 星团之间的间距 56 + 0.32 × 较小星团半径，给歌词和光留出空气。
 * 只有一首歌的歌手（用户曲库里 484 位，占三分之一）填进星团之间和外围的空位，按颜色排（内深外艳、方位按色相）。
 */
export function buildCluster(songs: Track[]): BoundedWorld {
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

  // 团内：蓝噪声（种子按歌手名，形状每次一样），专辑按歌数从多到少排、同专辑连续；点按方位角排，同专辑落在同一个扇区
  for (const c of list) {
    const m = c.ids.length;
    if (m === 1) {
      c.lx = [0];
      c.ly = [0];
      c.r = 98;
      continue;
    }
    const raw = blueNoise(m, () => S, mulberry32(hash(c.key)), 0.08);
    // 以点的重心为团心
    const gx = raw.reduce((s, p) => s + p.x, 0) / m;
    const gy = raw.reduce((s, p) => s + p.y, 0) / m;
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

  // 两首以上的星团由大到小贪心放置：候选点由近到远（黄金角螺线采样），网格加速碰撞检查
  const gapOf = (a: number, b: number) => 56 + 0.32 * Math.min(a, b);
  const CELL = 700;
  const grid = new Map<string, number[]>();
  const each = (x: number, y: number, rr: number, f: (k: string) => boolean | void) => {
    for (let gx = Math.floor((x - rr) / CELL); gx <= Math.floor((x + rr) / CELL); gx++)
      for (let gy = Math.floor((y - rr) / CELL); gy <= Math.floor((y + rr) / CELL); gy++) if (f(`${gx},${gy}`) === false) return;
  };
  const STEP = 70;
  const lastByR = new Map<number, number>();
  let lastAny = 0;
  multi.forEach((c, idx) => {
    const reach = c.r + 56 + 0.32 * c.r;
    let m = Math.floor(Math.max(lastByR.get(Math.round(c.r)) ?? 0, 0.3 * lastAny));
    for (;; m++) {
      const rho = STEP * Math.sqrt(m);
      const th = m * 2.399963;
      const x = rho * Math.cos(th);
      const y = rho * Math.sin(th);
      let ok = true;
      each(x, y, reach, (key) => {
        const arr = grid.get(key);
        if (!arr) return;
        for (const q of arr) {
          const o = multi[q]!;
          if (Math.hypot(o.cx - x, o.cy - y) < c.r + o.r + gapOf(c.r, o.r)) {
            ok = false;
            return false;
          }
        }
      });
      if (ok) {
        c.cx = x;
        c.cy = y;
        lastByR.set(Math.round(c.r), m);
        lastAny = m;
        break;
      }
    }
    each(c.cx, c.cy, c.r, (key) => {
      const arr = grid.get(key);
      if (arr) arr.push(idx);
      else grid.set(key, [idx]);
    });
  });

  // 单曲歌手：在星团之外的空位上撒蓝噪声（离星团边缘至少 98 + 30px），由内到外取够数，再按颜色分圈排
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  if (singles.length) {
    const SP = 200;
    const blocked = (x: number, y: number) => {
      let hit = false;
      each(x, y, 98 + 30, (key) => {
        const arr = grid.get(key);
        if (!arr) return;
        for (const q of arr) {
          const o = multi[q]!;
          if (Math.hypot(o.cx - x, o.cy - y) < o.r + 98 + 30) {
            hit = true;
            return false;
          }
        }
      });
      return hit;
    };
    const free = blueNoise(singles.length, () => SP, mulberry32(FIXED_SEED + 1), 0.1, blocked);
    const ids = singles.map((c) => c.ids[0]!);
    const { order, hueAng } = colorOrder(songs, ids);
    assignRings(free, order, hueAng, () => SP, px, py);
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
  return finish('cluster', songs, px, py, clusters, clusterOf);
}

// ---------------------------------------------------------------- 搜索落点

/**
 * 搜索后镜头飞去哪里：
 *   - 按歌手：命中大多落在同一个星团（搜歌手）→ 飞到这个星团，缩放到正好装下它；
 *   - 指定了某一首（从下拉里点的）或命中很分散 → 飞到那一首，缩放 1。
 */
export function searchTarget(
  w: BoundedWorld,
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
      count.set(c, (count.get(c) ?? 0) + 1);
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
