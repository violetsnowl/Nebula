/**
 * 有边界星云的投影（#133）：真正的鱼眼透镜——位置和大小一起变。
 *
 * 镜头中心 c（世界坐标）在屏幕正中。先按缩放把世界偏移换成屏幕像素 d = (p − c) × zoom，
 * 再过一个径向透镜（Sarkar–Brown 图形鱼眼）：u = |d| / Rs（Rs = 屏幕半对角线），
 *   u ≤ 1：R = Rs · (1 + δ)u / (1 + δu)；u > 1：沿边缘的斜率继续往外。
 * 中心放大 1 + δ 倍，屏幕角落（u = 1）位置不变，所以视野不变，只是中间撑开、四周收紧。
 * 卡片大小取局部放大率（径向 × 切向的几何平均），邻居跟着一起挪，中心的大卡不会压住邻居。
 *
 * 透镜只在放大到一定程度后生效（缩放 0.3 → 0.8 渐入）：缩小看全貌时是一张不变形的平面地图。
 */
export interface Proj {
  sx: number;
  sy: number;
  /** 卡片缩放（已含 zoom） */
  s: number;
  /** 0 = 屏幕中心，1 = 屏幕角落 */
  u: number;
}

export interface CamLike {
  /** pan：屏幕左上角对应的世界坐标（与 PanController 一致） */
  x: number;
  y: number;
  zoom: number;
  vw: number;
  vh: number;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 当前缩放下的透镜系数 δ。 */
export function lensDelta(lens: number, zoom: number): number {
  return lens * smoothstep(0.3, 0.8, zoom);
}

/** 镜头中心（世界坐标）。 */
export function camCenter(f: CamLike): { cx: number; cy: number } {
  return { cx: f.x + f.vw / (2 * f.zoom), cy: f.y + f.vh / (2 * f.zoom) };
}

/** 世界点 (wx, wy) → 屏幕。结果写进 out（每帧上千次，不分配对象）。 */
export function project(wx: number, wy: number, f: CamLike, delta: number, out: Proj): Proj {
  const z = f.zoom;
  const hw = f.vw / 2;
  const hh = f.vh / 2;
  const rs = Math.hypot(hw, hh);
  const dx = (wx - (f.x + hw / z)) * z;
  const dy = (wy - (f.y + hh / z)) * z;
  const r = Math.hypot(dx, dy);
  const u = r / rs;
  let k: number;
  let radial: number;
  if (u <= 1) {
    const den = 1 + delta * u;
    k = (1 + delta) / den;
    radial = (1 + delta) / (den * den);
  } else {
    const R = rs + (r - rs) / (1 + delta);
    k = R / r;
    radial = 1 / (1 + delta);
  }
  out.sx = hw + dx * k;
  out.sy = hh + dy * k;
  out.s = z * Math.sqrt(radial * k);
  out.u = u;
  return out;
}

/** 屏幕上某点附近，拖动 1 屏幕像素对应多少世界坐标（拖到哪里，手下的那张卡就跟着手走）。 */
export function worldPerPixel(sx: number, sy: number, f: CamLike, delta: number): number {
  const hw = f.vw / 2;
  const hh = f.vh / 2;
  const rs = Math.hypot(hw, hh);
  const R = Math.hypot(sx - hw, sy - hh);
  // 反解 u：R = rs(1+δ)u / (1+δu) → u = R / (rs(1+δ) − δR)
  const u = Math.min(1, R / Math.max(1e-6, rs * (1 + delta) - delta * R));
  const den = 1 + delta * u;
  const k = (1 + delta) / den;
  const radial = (1 + delta) / (den * den);
  return 1 / (f.zoom * Math.sqrt(radial * k));
}

/** 让世界半径 r 的一块区域在屏幕上大约占半径 target 像素，需要的缩放（考虑透镜在这个缩放下的放大）。 */
export function zoomToFit(r: number, target: number, lens: number, zMin: number, zMax: number): number {
  let z = target / Math.max(1, r);
  for (let i = 0; i < 4; i++) z = target / (Math.max(1, r) * (1 + lensDelta(lens, z)));
  return Math.min(zMax, Math.max(zMin, z));
}
