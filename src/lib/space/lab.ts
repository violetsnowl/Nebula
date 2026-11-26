import { useSyncExternalStore } from 'react';

/**
 * 主舞台星云的排法（#134，用户确认：三种排法同源，做成设置项）。
 *   - chroma：按封面颜色——横向沿彩虹走，纵向由暗到鲜艳（默认，#137 用户确认：第一眼最好看）
 *   - cluster：按歌手——同一位歌手的歌聚成一团，星团均匀散在画布上
 *   - random：随机——每次打开重新撒一遍，同一次使用里位置不变
 * 设置在「设置 › 外观 › 星云怎么排」；开发者面板「舞台实验室」（Ctrl+Shift+M）另外能调透镜强度和镜头倾角。
 */
export type StageLayout = 'cluster' | 'chroma' | 'random';
export type StageMode = 'roam' | 'page' | 'travel';
const STAGE_MODES: StageMode[] = ['roam', 'page', 'travel'];

export interface SpaceLab {
  /** 用户设置的排法 */
  layout: StageLayout;
  /** 实际生效的排法（始终等于 layout；setSpaceLab({ mode }) 就是改 layout） */
  mode: StageLayout;
  /** 透镜强度：中心放大 1 + lens 倍（只在放大到一定程度后生效，缩小看全貌时是平面地图）。 */
  lens: number;
  /** 镜头倾角（度）：整片星云一起后仰。 */
  tilt: number;
  /** 环境色跟随镜头所在区域的封面颜色。 */
  tint: boolean;
  /** 漫游歌词升级（样张 M，2026-11-22）：段落开合、间奏让位、字照亮空间、大小对比、同段同向。关掉 = 旧样子，用来对比。 */
  lyricShape: boolean;
  /** 聆听时的舞台（样张 M）：漫游歌词（默认）/ 版面 / 穿行（初版，待验证）。先挂在实验室里，验收后再进设置。 */
  stageMode: StageMode;
  /** 开发者面板是否打开（不持久化）。 */
  open: boolean;
}

// 换了新键：原型阶段（#133）在 v1 存过「现有 / A / B」；#134–#136 比较三种排法时在 v2 里存过各自的选择。
// 都不带过来，新星云从默认的「按颜色」开始（#137）。v3 里若还存着旧卡片墙的 classic 标记，读取时直接忽略
const KEY = 'music-nebula.stage-space.v3';
const LAYOUTS: StageLayout[] = ['cluster', 'chroma', 'random'];
const DEFAULTS: SpaceLab = { layout: 'chroma', mode: 'chroma', lens: 0.8, tilt: 0, tint: true, lyricShape: true, stageMode: 'roam', open: false };

function withMode(s: Omit<SpaceLab, 'mode'>): SpaceLab {
  return { ...s, mode: s.layout };
}

function load(): SpaceLab {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<SpaceLab>;
    return withMode({
      layout: LAYOUTS.includes(v.layout as StageLayout) ? (v.layout as StageLayout) : DEFAULTS.layout,
      lens: typeof v.lens === 'number' ? Math.min(1.5, Math.max(0, v.lens)) : DEFAULTS.lens,
      tilt: typeof v.tilt === 'number' ? Math.min(20, Math.max(0, v.tilt)) : DEFAULTS.tilt,
      tint: typeof v.tint === 'boolean' ? v.tint : DEFAULTS.tint,
      lyricShape: typeof v.lyricShape === 'boolean' ? v.lyricShape : DEFAULTS.lyricShape,
      stageMode: STAGE_MODES.includes(v.stageMode as StageMode) ? (v.stageMode as StageMode) : DEFAULTS.stageMode,
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

/** 改设置。传 mode 就是换排法（同时改 layout）。 */
export function setSpaceLab(patch: Partial<SpaceLab>): void {
  const next = { ...state, ...patch };
  if (patch.mode) next.layout = patch.mode;
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
