import { useSyncExternalStore } from 'react';

/**
 * 主舞台星云的排法（#134，用户确认：三种排法同源，做成设置项）。
 *   - cluster：按歌手——同一位歌手的歌聚成一团，歌越多越靠中心（默认）
 *   - chroma：按封面颜色——同色系挨在一起，中间深、外圈艳
 *   - random：随机——每次打开重新撒一遍，同一次使用里位置不变
 * 设置在「设置 › 外观 › 星云怎么排」。
 *
 * 开发者面板「舞台实验室」（Ctrl+Shift+M）另外能退回旧的随机卡片墙（classic，验收期间的退路），
 * 调透镜强度和镜头倾角。旧卡片墙在用户验收新星云后删除。
 */
export type StageLayout = 'cluster' | 'chroma' | 'random';
export type StageMode = StageLayout | 'classic';

export interface SpaceLab {
  /** 用户设置的排法 */
  layout: StageLayout;
  /** 开发者面板：退回旧卡片墙 */
  classic: boolean;
  /** 实际生效的模式（classic 优先） */
  mode: StageMode;
  /** 透镜强度：中心放大 1 + lens 倍（只在放大到一定程度后生效，缩小看全貌时是平面地图）。 */
  lens: number;
  /** 镜头倾角（度）：整片星云一起后仰。 */
  tilt: number;
  /** 环境色跟随镜头所在区域的封面颜色。 */
  tint: boolean;
  /** 开发者面板是否打开（不持久化）。 */
  open: boolean;
}

// 换了新键：原型阶段（#133）在旧键里存过「现有 / A / B」，不带过来，新星云从默认的「按歌手」开始
const KEY = 'music-nebula.stage-space.v2';
const LAYOUTS: StageLayout[] = ['cluster', 'chroma', 'random'];
const DEFAULTS: SpaceLab = { layout: 'cluster', classic: false, mode: 'cluster', lens: 0.8, tilt: 0, tint: true, open: false };

function withMode(s: Omit<SpaceLab, 'mode'> & { mode?: StageMode }): SpaceLab {
  return { ...s, mode: s.classic ? 'classic' : s.layout };
}

function load(): SpaceLab {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<SpaceLab>;
    return withMode({
      layout: LAYOUTS.includes(v.layout as StageLayout) ? (v.layout as StageLayout) : DEFAULTS.layout,
      classic: v.classic === true,
      lens: typeof v.lens === 'number' ? Math.min(1.5, Math.max(0, v.lens)) : DEFAULTS.lens,
      tilt: typeof v.tilt === 'number' ? Math.min(20, Math.max(0, v.tilt)) : DEFAULTS.tilt,
      tint: typeof v.tint === 'boolean' ? v.tint : DEFAULTS.tint,
      open: false,
    });
  } catch {
    return DEFAULTS;
  }
}

let state: SpaceLab = typeof localStorage === 'undefined' ? DEFAULTS : load();
const subs = new Set<() => void>();

export function getSpaceLab(): SpaceLab {
  return state;
}

/**
 * 改设置。传 mode 时：'classic' = 退回旧卡片墙；其余 = 设成这种排法并离开旧卡片墙。
 */
export function setSpaceLab(patch: Partial<SpaceLab>): void {
  const next = { ...state, ...patch };
  if (patch.mode) {
    if (patch.mode === 'classic') next.classic = true;
    else {
      next.layout = patch.mode;
      next.classic = false;
    }
  }
  state = withMode(next);
  try {
    const { open: _open, mode: _mode, ...persist } = state;
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

/** 面板上的按钮要让舞台做事（回到正在播放）：舞台挂载时登记处理函数。 */
type SpaceCommand = 'focusCurrent';
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
