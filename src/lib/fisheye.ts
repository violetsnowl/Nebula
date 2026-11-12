/**
 * 鱼眼景深：以屏幕中心为焦点（docs/design/NEBULA_UI_SYSTEM.md §8.2）。
 * 缩放：中心 2.0x（聚焦感），边缘 0.5x（快速缩小），形成近大远小透视。
 * 景深：靠"空气透视"表达——离中心越远越暗、越淡；只有最外圈才有一点模糊；焦点圈内完全不加滤镜。
 */

export const FISHEYE_CENTER_SCALE = 2.0;
export const FISHEYE_EDGE_SCALE = 0.5;
/** 曲线指数：>1 时中心附近衰减较缓、离开中心后快速缩小。 */
export const FISHEYE_POWER = 1.35;

/** 焦点圈：t < 0.32 的卡片不加任何滤镜（滤镜会让卡片先按原尺寸栅格化再放大，焦点卡片会发虚）。 */
export const FISHEYE_FOCUS_T = 0.32;
/** 标题 / 歌手只在 t < 0.45 时显示（以及 hover 时）。 */
export const FISHEYE_META_T = 0.45;
/** 只有 t > 0.82 的最外圈才叠加模糊，最大约 1.1px。 */
export const FISHEYE_BLUR_T = 0.82;

/** t = 距离 ÷ 最大距离（0 = 屏幕中心，1 = 角落）。 */
function tOf(dist: number, maxDist: number): number {
  return Math.min(1, Math.max(0, dist / Math.max(1, maxDist)));
}

/** 中圈起算的"远近"程度 0–1：far = clamp((t − 0.32) / 0.70, 0, 1)。 */
function farOf(t: number): number {
  return Math.min(1, Math.max(0, (t - FISHEYE_FOCUS_T) / 0.7));
}

export function fisheyeScale(dist: number, maxDist: number): number {
  const t = tOf(dist, maxDist);
  return FISHEYE_EDGE_SCALE + (FISHEYE_CENTER_SCALE - FISHEYE_EDGE_SCALE) * Math.pow(1 - t, FISHEYE_POWER);
}

export function fisheyeFocal(dist: number, maxDist: number): boolean {
  return tOf(dist, maxDist) < FISHEYE_FOCUS_T;
}

/** 最外圈模糊：blur = (t − 0.82) × 6px，焦点与中圈为 0。 */
export function fisheyeBlur(dist: number, maxDist: number): number {
  const t = tOf(dist, maxDist);
  return t > FISHEYE_BLUR_T ? (t - FISHEYE_BLUR_T) * 6 : 0;
}

/** 空气透视：亮度 1 − 0.5 × far（中心不超过 1）。 */
export function fisheyeBrightness(dist: number, maxDist: number): number {
  return 1 - 0.5 * farOf(tOf(dist, maxDist));
}

/** 空气透视：饱和度 1 − 0.35 × far。 */
export function fisheyeSaturate(dist: number, maxDist: number): number {
  return 1 - 0.35 * farOf(tOf(dist, maxDist));
}

/** 卡片完整的景深滤镜字符串：焦点圈内返回 'none'（不能是 blur(0)，否则仍会触发栅格化放大）。 */
export function fisheyeFilter(dist: number, maxDist: number): string {
  if (fisheyeFocal(dist, maxDist)) return 'none';
  const b = fisheyeBrightness(dist, maxDist).toFixed(3);
  const s = fisheyeSaturate(dist, maxDist).toFixed(3);
  const blur = fisheyeBlur(dist, maxDist);
  return `brightness(${b}) saturate(${s})${blur > 0 ? ` blur(${blur.toFixed(2)}px)` : ''}`;
}

/** 标题 / 歌手透明度（1 = 显示，0 = 隐藏），由 CSS 过渡淡入淡出。 */
export function fisheyeMetaAlpha(dist: number, maxDist: number): number {
  return tOf(dist, maxDist) < FISHEYE_META_T ? 1 : 0;
}

/** 层级：越靠近屏幕中心 z-index 越高，保证中心放大卡遮挡周围卡片。 */
export function fisheyeZIndex(dist: number, maxDist: number): number {
  const t = tOf(dist, maxDist);
  return Math.round((1 - t) * 5000) + 1;
}
