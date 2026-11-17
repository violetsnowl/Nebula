import type { CSSProperties } from 'react';
import { CARD_HEIGHT, CARD_WIDTH, type CardSpec } from '../layout';
import { getSpaceLab } from './lab';
import { lensDelta, project, type Proj } from './lens';
import type { SpaceWorld } from './world';

/**
 * 当前生效的星云（#133）。舞台在渲染时写入（和 worldRef 一样的做法），
 * 卡片组件渲染时据此算初始位置——必须和舞台帧循环算的一致，否则卡片会从错的位置滑过来（transform 有 0.45s 过渡）。
 */
let active: SpaceWorld | null = null;
export function setActiveWorld(w: SpaceWorld): void {
  active = w;
}

const tmp: Proj = { sx: 0, sy: 0, s: 0, u: 0 };

/** 屏幕上小于这个尺寸（px）的卡片不挂 DOM，由画布画缩略图；56–72px 之间两种画法交叉淡化。 */
export const MIN_CARD_PX = 56;
export const FULL_CARD_PX = 72;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 这首歌由 DOM 卡片显示的份额（只按屏幕上的大小算）：56px 以下全由画布画，72px 以上全是 DOM 卡片。 */
export function domShare(size: number): number {
  return smoothstep(MIN_CARD_PX, FULL_CARD_PX, size);
}

/**
 * 透镜外圈略暗（离屏幕中心越远越暗，最多暗 40%）。DOM 卡片和画布缩略图用同一条曲线。
 * #137：不再按离屏幕边缘的远近淡出——屏幕边缘像一扇窗，卡片本来就在那里，拖过去自然看见，而不是到了边上才浮现。
 */
export function airAlpha(u: number): number {
  return 1 - 0.4 * smoothstep(0.38, 1.05, u);
}

/**
 * 舞台帧循环每帧算出的卡片透明度（按歌曲序号，NaN = 还没算过）。卡片渲染时优先用它：
 * 超过挂载上限时交界处的淡化只有帧循环知道，按公式算会在挂上的第一帧闪一下。
 */
let frameAlpha = new Float32Array(0);
export function frameAlphaBuffer(n: number): Float32Array {
  if (frameAlpha.length !== n) frameAlpha = new Float32Array(n).fill(NaN);
  return frameAlpha;
}

/**
 * 一张卡片的初始样式。
 * 透明度按当前镜头算好（和舞台帧循环同一条公式）：新挂上的卡片第一帧就是它该有的样子，不从 0 淡入、也不从 1 闪一下。
 */
export function boundedCardStyle(card: CardSpec, pan: { x: number; y: number }, zoom: number): CSSProperties {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const p = project(card.x + CARD_WIDTH / 2, card.y + CARD_HEIGHT / 2, { x: pan.x, y: pan.y, zoom, vw, vh }, lensDelta(getSpaceLab().lens, zoom), tmp, active?.period ?? 0);
  return {
    '--x': `${p.sx - CARD_WIDTH / 2}px`,
    '--y': `${p.sy - CARD_HEIGHT / 2}px`,
    '--rz': '0deg',
    '--scale': Math.min(3.4, p.s),
    '--card-filter': 'none',
    '--meta-a': p.u < 0.3 && zoom > 0.55 ? 1 : 0,
    '--card-a': (Number.isNaN(frameAlpha[card.id] ?? NaN) ? domShare(CARD_WIDTH * p.s) * airAlpha(p.u) : frameAlpha[card.id]!).toFixed(3),
    zIndex: Math.round((1 - Math.min(1, p.u)) * 5000) + 1,
  } as CSSProperties;
}
