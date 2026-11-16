import { CARD_HEIGHT, CARD_WIDTH, type CardSpec } from '../layout';
import type { Track } from '../catalog';
import { chromaOf, hueOf, toneOf } from './tone';
import { zoomToFit } from './lens';

/**
 * 有边界的星云（#133 主舞台方向原型）。和现有卡片墙的区别：
 *   - 世界有边界（一整片星云，中心在原点），不再周期回绕；缩小能看到它的全貌和形状；
 *   - 位置有含义：A 按封面颜色，B 按歌手；
 *   - 真正的中心密、四周稀：卡片间距从中心 196px 往外逐渐放宽，外圈留出空气。
 *
 * 点阵用「向日葵」（每个点转一个黄金角，半径按累计面积增长）：随机但不会挤在一起，
 * 面积系数 1.1 时最近邻间距约等于设定间距（实测最差 0.945 倍），196px 间距下卡片（172px）不会重叠。
 */
export interface SpaceCluster {
  key: string;
  name: string;
  cx: number;
  cy: number;
  r: number;
  ids: number[];
}

export interface BoundedWorld {
  mode: 'chroma' | 'cluster';
  cards: CardSpec[];
  /** 卡片盒中心（世界坐标） */
  px: Float64Array;
  py: Float64Array;
  /** 整片星云的半径 */
  radius: number;
  /** B 的星团（A 为空） */
  clusters: SpaceCluster[];
  /** 每首歌属于哪个星团（A 为 -1） */
  clusterOf: Int32Array;
  grid: { cell: number; min: number; cols: number; cells: number[][] };
}

const GOLD = Math.PI * (3 - Math.sqrt(5));
const AREA_K = 1.1;
const TAU = Math.PI * 2;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

interface Pt {
  x: number;
  y: number;
  r: number;
  a: number;
}

/** 变密度向日葵：间距随半径变化。第一个点偏离圆心半个格子，避免中心几张挤在一起。 */
function sunflower(n: number, spacing: (r: number) => number): Pt[] {
  const pts: Pt[] = [];
  let area = (0.5 * AREA_K * spacing(0) * spacing(0));
  for (let k = 0; k < n; k++) {
    const r = Math.sqrt(area / Math.PI);
    const t = k * GOLD;
    const x = r * Math.cos(t);
    const y = r * Math.sin(t);
    pts.push({ x, y, r, a: angle01(Math.atan2(y, x)) });
    const s = spacing(r);
    area += AREA_K * s * s;
  }
  return pts;
}

function angle01(a: number): number {
  return ((a % TAU) + TAU) % TAU;
}
function angDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
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
  mode: BoundedWorld['mode'],
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

// ---------------------------------------------------------------- 色彩顺序（A 全部、B 的单曲歌手）

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
 * 点（已按离中心由近到远排好）按半径切成一圈一圈（每圈厚约 1.3 个间距），
 * 歌按 order 依次分到各圈；每一圈里点按方位角排、歌按色相排，再找一个整体旋转，
 * 让每张封面的方位尽量贴近它真实的色相角。
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

// ---------------------------------------------------------------- A 色彩星图

/**
 * 按封面颜色排成一片色轮：方位角 = 色相，半径 = 由深到浅、由淡到浓（见 colorOrder）。
 * 半径按「名次」分配（不是数值），密度由点阵控制：中心 196px 间距，往外逐渐放宽到 300px。
 */
export function buildChroma(songs: Track[]): BoundedWorld {
  const n = songs.length;
  const { order, hueAng } = colorOrder(songs, Array.from({ length: n }, (_, i) => i));
  const spacing = (r: number) => 196 + 104 * smoothstep(0, 4200, r);
  const pts = sunflower(n, spacing);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  assignRings(pts, order, hueAng, spacing, px, py);
  return finish('chroma', songs, px, py, [], new Int32Array(n).fill(-1));
}

// ---------------------------------------------------------------- B 星团

/** 主歌手：按 / 、 & , feat. ft. x 拆开取第一个。 */
function primaryArtist(artist: string | undefined): { key: string; name: string } {
  const name = (artist ?? '').split(/\s*(?:\/|、|&|,|，|;|；|\bfeat\.?\b|\bft\.?\b|\bx\b)\s*/i)[0]?.trim() ?? '';
  return { key: name.toLowerCase() || '(未知歌手)', name: name || '未知歌手' };
}

/**
 * 同一歌手的歌聚成一团（团内是 196px 的向日葵点阵，像墙一样密），同一张专辑的歌挨在一个扇区里。
 * 两首以上的星团从大到小，依次放在「离中心最近、又和已放的星团保持间距」的位置：最大的在中心。
 * 星团之间的间距 56 + 0.32 × 较小星团半径，给歌词和光留出空气。
 * 只有一首歌的歌手（用户曲库里 484 位，占三分之一）不再各自散落：它们填进星团之间和外围的空位，
 * 按和 A 一样的色彩顺序排（内深外艳、方位按色相），读起来是一圈安静的色带，而不是随机撒的一片。
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
  const S = 196;
  const list = [...groups.entries()]
    .map(([key, g]) => ({ key, name: g.name, ids: g.ids, r: 0, cx: 0, cy: 0, lx: [] as number[], ly: [] as number[] }))
    .sort((a, b) => b.ids.length - a.ids.length || (a.key < b.key ? -1 : 1));

  // 团内点阵：专辑按歌数从多到少排，同专辑连续；点按方位角排，同专辑落在同一个扇区
  for (const c of list) {
    const m = c.ids.length;
    if (m === 1) {
      c.lx = [0];
      c.ly = [0];
      c.r = 98;
      continue;
    }
    const pts = sunflower(m, () => S);
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
    c.r = Math.max(...pts.map((p) => p.r)) + 98;
  }

  const singles = list.filter((c) => c.ids.length === 1);
  const multi = list.filter((c) => c.ids.length > 1);

  // 两首以上的星团由大到小贪心放置：候选点是一片向日葵（离中心由近到远），网格加速碰撞检查
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
      const th = m * GOLD;
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

  // 单曲歌手：在星团之外找空位（离星团边缘至少 98 + 30px），由近到远取够数，再按色彩顺序分圈排
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  if (singles.length) {
    const SP = 210;
    const free: Pt[] = [];
    let area = 0.5 * AREA_K * SP * SP;
    for (let k = 0; free.length < singles.length && k < 200000; k++) {
      const r = Math.sqrt(area / Math.PI);
      area += AREA_K * SP * SP;
      const t = k * GOLD;
      const x = r * Math.cos(t);
      const y = r * Math.sin(t);
      let ok = true;
      each(x, y, 98 + 30, (key) => {
        const arr = grid.get(key);
        if (!arr) return;
        for (const q of arr) {
          const o = multi[q]!;
          if (Math.hypot(o.cx - x, o.cy - y) < o.r + 98 + 30) {
            ok = false;
            return false;
          }
        }
      });
      if (ok) free.push({ x, y, r, a: angle01(Math.atan2(y, x)) });
    }
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
 *   - B：命中大多落在同一个星团（搜歌手）→ 飞到这个星团，缩放到正好装下它；
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

/** 看全貌：整片星云装进屏幕。 */
export function overviewZoom(w: BoundedWorld, vw: number, vh: number): number {
  return Math.max(0.04, (0.47 * Math.min(vw, vh)) / w.radius);
}
