import type { Track } from './catalog';

/** 卡片固定宽度。 */
export const CARD_WIDTH = 172;
/** 卡片近似高度（缩放、挂载范围、透镜投影都以卡片中心为基准）。 */
export const CARD_HEIGHT = 246;
/** 演示曲库的种子：固定 seed 保证同一份演示数据每次刷新一致（星云的位置由 space/world 排）。 */
export const SEED = 20260810;

export interface CardSpec {
  id: number;
  /** 世界坐标（星云画布内，首尾相接）。 */
  x: number;
  y: number;
  track: Track;
}

/** 把数值回绕进 [0, size)，实现周期画布。 */
export function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}
