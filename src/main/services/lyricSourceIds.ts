import type { Track } from '../types';

/** AMLL 社区库能按哪些 id 查（顺序即查询优先级：ncm → qq → apple → spotify → isrc）。 */
export interface LyricIds {
  /** 网易云歌曲 id（数字）。 */
  ncm?: string;
  /** QQ 音乐歌曲数字 id（songid）。songmid 实测查不到，不能放这里。 */
  qq?: string;
  /** Apple Music 目录曲目 id（数字）。 */
  apple?: string;
  spotify?: string;
  isrc?: string;
}
export type LyricIdKey = keyof LyricIds;
export const LYRIC_ID_ORDER: readonly LyricIdKey[] = ['ncm', 'qq', 'apple', 'spotify', 'isrc'];

const NUMERIC = /^\d{1,20}$/;
const SPOTIFY = /^[A-Za-z0-9]{22}$/;
const ISRC = /^[A-Za-z]{2}[A-Za-z0-9]{3}\d{7}$/;

/** 规范化一个 id；不合法返回 undefined。 */
export function normalizeLyricId(key: LyricIdKey, value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const s = String(value).trim();
  if (key === 'spotify') return SPOTIFY.test(s) ? s : undefined;
  if (key === 'isrc') return ISRC.test(s) ? s.toUpperCase() : undefined;
  return NUMERIC.test(s) ? s : undefined;
}

/** Apple 目录曲目 id：Apple 曲目取 extra.catalogId，没有再取 sourceId（资料库 id `i.xxx` 不是目录 id，会被丢掉）。 */
export function appleCatalogIdOf(track: Track | undefined): string | undefined {
  if (!track || track.platform !== 'applemusic') return undefined;
  return normalizeLyricId('apple', track.extra?.catalogId) ?? normalizeLyricId('apple', track.sourceId);
}

/** 一首歌自己带的、能拿去查歌词库的 id。 */
export function lyricIdsOf(track: Track | undefined): LyricIds {
  const out: LyricIds = {};
  if (!track) return out;
  if (track.platform === 'netease') out.ncm = normalizeLyricId('ncm', track.sourceId);
  // QQ 的 sourceId 是 songmid，AMLL 不认；数字 id 在 extra.songId
  if (track.platform === 'qq') out.qq = normalizeLyricId('qq', track.extra?.songId);
  if (track.platform === 'applemusic') out.apple = appleCatalogIdOf(track);
  if (track.platform === 'spotify') out.spotify = normalizeLyricId('spotify', track.sourceId);
  out.isrc = normalizeLyricId('isrc', track.extra?.isrc);
  for (const k of LYRIC_ID_ORDER) if (out[k] === undefined) delete out[k];
  return out;
}

/** 合并多首（实际供流那首、原曲、搜到的同一首…）的 id；同一类 id 取靠前的。 */
export function mergeLyricIds(...parts: Array<LyricIds | undefined>): LyricIds {
  const out: LyricIds = {};
  for (const p of parts) {
    if (!p) continue;
    for (const k of LYRIC_ID_ORDER) if (out[k] === undefined && p[k] !== undefined) out[k] = p[k];
  }
  return out;
}
