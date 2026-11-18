import { useSyncExternalStore } from 'react';

/**
 * 听音空间歌词阅读栏的设置（docs/design/NEBULA_UI_SYSTEM.md §7.2 / §9.9）。
 * 与星云歌词（lib/lyricSettings.ts）分开存储：localStorage['music-nebula.listen-lyrics']。
 */
export interface ListenSettings {
  /** 歌词着色：accent = 封面色（默认）；mono = 同色系。 */
  scheme: 'accent' | 'mono';
  /** 字体：serif = 衬线（默认）；sans = 无衬线。 */
  font: 'serif' | 'sans';
  /** 外文歌词下方显示翻译（默认开）。 */
  translation: boolean;
  /** 读音（#161 罗马音，#172 起含假名注音；默认关；只在有读音的歌出现开关）。 */
  roman: boolean;
  /** 日语读音（#173）：原文下面一行罗马音、汉字上方标平假名，可单独开也可一起开（至少留一个）。韩语始终是罗马音。 */
  jaRoman: boolean;
  jaKana: boolean;
}

const KEY = 'music-nebula.listen-lyrics';

const DEFAULTS: ListenSettings = { scheme: 'accent', font: 'serif', translation: true, roman: false, jaRoman: true, jaKana: true };

function load(): ListenSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const o = JSON.parse(raw) as Partial<ListenSettings> | null;
    return {
      scheme: o?.scheme === 'mono' ? 'mono' : 'accent',
      font: o?.font === 'sans' ? 'sans' : 'serif',
      translation: typeof o?.translation === 'boolean' ? o.translation : DEFAULTS.translation,
      roman: typeof o?.roman === 'boolean' ? o.roman : DEFAULTS.roman,
      jaRoman: typeof o?.jaRoman === 'boolean' ? o.jaRoman : DEFAULTS.jaRoman,
      jaKana: typeof o?.jaKana === 'boolean' ? o.jaKana : DEFAULTS.jaKana,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: ListenSettings = load();
const listeners = new Set<() => void>();

export function getListenSettings(): ListenSettings {
  return current;
}

/** 合并修改并持久化；值没变化时不通知（保持快照引用稳定，useSyncExternalStore 不会多渲染）。 */
export function setListenSettings(patch: Partial<ListenSettings>): void {
  const next: ListenSettings = { ...current, ...patch };
  // 日语读音至少留一种（#173）：两种都关等于读音开关没意义
  if (!next.jaRoman && !next.jaKana) return;
  if (
    next.scheme === current.scheme &&
    next.font === current.font &&
    next.translation === current.translation &&
    next.roman === current.roman &&
    next.jaRoman === current.jaRoman &&
    next.jaKana === current.jaKana
  )
    return;
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* 存储不可用（隐私模式 / 配额）：只保留内存值 */
  }
  for (const fn of listeners) fn();
}

export function subscribeListenSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useListenSettings(): ListenSettings {
  return useSyncExternalStore(subscribeListenSettings, getListenSettings, getListenSettings);
}
