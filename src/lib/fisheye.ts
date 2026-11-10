/**
 * 鱼眼景深：以屏幕中心为焦点。
 * 强对比曲线：中心 2.0x（聚焦感），边缘 0.5x（快速缩小），形成近大远小透视。
 */

export const FISHEYE_CENTER_SCALE = 2.0;
export const FISHEYE_EDGE_SCALE = 0.5;
/** 曲线指数：>1 时中心附近衰减较缓、离开中心后快速缩小。 */
export const FISHEYE_POWER = 1.35;

export function fisheyeScale(dist: number, maxDist: number): number {
  const t = Math.min(1, Math.max(0, dist / Math.max(1, maxDist)));
  return FISHEYE_EDGE_SCALE + (FISHEYE_CENTER_SCALE - FISHEYE_EDGE_SCALE) * Math.pow(1 - t, FISHEYE_POWER);
}

/**
 * 焦点圈：距中心 < 32% 最大距离的卡片不加任何滤镜（NEBULA_UI_SYSTEM §8.2）。
 * 滤镜会让卡片先按原尺寸栅格化再放大，即使 blur 只有零点几像素，焦点卡片也会发虚。
 */
export const FISHEYE_FOCUS_T = 0.32;

export function fisheyeFocal(dist: number, maxDist: number): boolean {
  return dist < FISHEYE_FOCUS_T * Math.max(1, maxDist);
}

/** 景深模糊：从焦点圈边缘起算（曲线整体外移，过渡连续），上限 4px。 */
export function fisheyeBlur(dist: number, maxDist: number): number {
  const focus = FISHEYE_FOCUS_T * Math.max(1, maxDist);
  return Math.min(4, Math.max(0, dist - focus) / 260);
}

/** 卡片完整的景深滤镜字符串：焦点圈内返回 'none'（不能是 blur(0)，否则仍会触发栅格化放大）。 */
export function fisheyeFilter(dist: number, maxDist: number): string {
  if (fisheyeFocal(dist, maxDist)) return 'none';
  return `blur(${fisheyeBlur(dist, maxDist)}px) brightness(${fisheyeBrightness(dist)})`;
}

export function fisheyeBrightness(dist: number): number {
  return Math.max(0.72, 1.12 - dist / 1800);
}

/** 层级：越靠近屏幕中心 z-index 越高，保证中心放大卡遮挡周围卡片。 */
export function fisheyeZIndex(dist: number, maxDist: number): number {
  const t = Math.min(1, Math.max(0, dist / Math.max(1, maxDist)));
  return Math.round((1 - t) * 5000) + 1;
}
