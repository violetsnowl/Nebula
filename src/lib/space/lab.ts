import { useSyncExternalStore } from 'react';

/**
 * 主舞台方向原型（#133）的实验室设置。默认「现有」，默认体验不变；
 * 用户用开发者面板（Ctrl+Shift+M）切换布局、调透镜和倾角，比较两个方向。
 *   - classic：现有的随机卡片墙（周期回绕 + 鱼眼）
 *   - chroma：A 色彩星图——按封面颜色排成一片色轮
 *   - cluster：B 星团——同一歌手聚成团，大的在中心
 */
export type StageMode = 'classic' | 'chroma' | 'cluster';

export interface SpaceLab {
  mode: StageMode;
  /** 透镜强度：中心放大 1 + lens 倍（只在放大到一定程度后生效，缩小看全貌时是平面地图）。 */
  lens: number;
  /** 镜头倾角（度）：整片星云一起后仰，取代每张卡各自随机旋转。 */
  tilt: number;
  /** 环境色跟随镜头所在区域的封面颜色。 */
  tint: boolean;
  /** 面板是否打开（不持久化）。 */
  open: boolean;
}

const KEY = 'music-nebula.space-lab';
const DEFAULTS: SpaceLab = { mode: 'classic', lens: 0.8, tilt: 0, tint: true, open: false };

function load(): SpaceLab {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<SpaceLab>;
    const mode: StageMode = v.mode === 'chroma' || v.mode === 'cluster' ? v.mode : 'classic';
    return {
      mode,
      lens: typeof v.lens === 'number' ? Math.min(1.5, Math.max(0, v.lens)) : DEFAULTS.lens,
      tilt: typeof v.tilt === 'number' ? Math.min(20, Math.max(0, v.tilt)) : DEFAULTS.tilt,
      tint: typeof v.tint === 'boolean' ? v.tint : DEFAULTS.tint,
      open: false,
    };
  } catch {
    return DEFAULTS;
  }
}

let state: SpaceLab = typeof localStorage === 'undefined' ? DEFAULTS : load();
const subs = new Set<() => void>();

export function getSpaceLab(): SpaceLab {
  return state;
}

export function setSpaceLab(patch: Partial<SpaceLab>): void {
  state = { ...state, ...patch };
  try {
    const { open: _open, ...persist } = state;
    localStorage.setItem(KEY, JSON.stringify(persist));
  } catch {
    /* 存不下就只在这次有效 */
  }
  subs.forEach((f) => f());
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export function useSpaceLab(): SpaceLab {
  return useSyncExternalStore(subscribe, getSpaceLab, getSpaceLab);
}

/** 面板上的按钮要让舞台做事（看全貌、回到正在播放）：舞台挂载时登记处理函数。 */
type SpaceCommand = 'overview' | 'focusCurrent';
const commands = new Map<SpaceCommand, () => void>();
export function registerSpaceCommand(name: SpaceCommand, fn: () => void): () => void {
  commands.set(name, fn);
  return () => {
    if (commands.get(name) === fn) commands.delete(name);
  };
}
export function runSpaceCommand(name: SpaceCommand): void {
  commands.get(name)?.();
}
