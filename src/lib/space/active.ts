import type { CSSProperties } from 'react';
import { CARD_HEIGHT, CARD_WIDTH, type CardSpec } from '../layout';
import { getSpaceLab } from './lab';
import { lensDelta, project, type Proj } from './lens';
import type { SpaceWorld } from './world';

/**
 * 当前生效的有边界星云（#133）。舞台在渲染时写入（和 metricsRef 一样的做法），
 * 卡片组件渲染时据此算初始位置——必须和舞台帧循环算的一致，否则卡片会从错的位置滑过来（transform 有 0.45s 过渡）。
 * 现有卡片墙模式下为 null。
 */
let active: SpaceWorld | null = null;
export function setActiveWorld(w: SpaceWorld | null): void {
  active = w;
}
export function getActiveWorld(): SpaceWorld | null {
  return active;
}

const tmp: Proj = { sx: 0, sy: 0, s: 0, u: 0 };

/**
 * 有边界星云里一张卡片的初始样式。现有模式返回 null。
 * 不写透明度（--card-a 归舞台帧循环管；写在这里的话，卡片每次重渲染都会被打回 0 再淡入）；
 * 挂上时的淡入由 CSS 动画负责。
 */
export function boundedCardStyle(card: CardSpec, pan: { x: number; y: number }, zoom: number): CSSProperties | null {
  if (!active) return null;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const p = project(card.x + CARD_WIDTH / 2, card.y + CARD_HEIGHT / 2, { x: pan.x, y: pan.y, zoom, vw, vh }, lensDelta(getSpaceLab().lens, zoom), tmp, active.period);
  return {
    '--x': `${p.sx - CARD_WIDTH / 2}px`,
    '--y': `${p.sy - CARD_HEIGHT / 2}px`,
    '--rz': '0deg',
    '--scale': Math.min(3.4, p.s),
    '--card-filter': 'none',
    '--meta-a': p.u < 0.3 && zoom > 0.55 ? 1 : 0,
    zIndex: Math.round((1 - Math.min(1, p.u)) * 5000) + 1,
  } as CSSProperties;
}
