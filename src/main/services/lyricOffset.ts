import type { Lyric, LyricLine } from '../types';
import { lrcAt, timedLines, toYrc } from '../parsers/timedLyrics';

const TIME_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** LRC 文本里的每个时间标签平移 offsetMs（其余内容原样保留）；平移后小于 0 的夹到 0。 */
export function shiftLrcText(text: string, offsetMs: number): string {
  if (!text || !offsetMs) return text;
  return text.replace(TIME_TAG, (_all, min: string, sec: string, frac?: string) => {
    let ms = frac ? Number(frac) : 0;
    if (frac?.length === 1) ms *= 100;
    else if (frac?.length === 2) ms *= 10;
    const at = Math.max(0, Number(min) * 60000 + Number(sec) * 1000 + ms + offsetMs);
    return lrcAt(at, '');
  });
}

const shiftLine = (l: LyricLine, by: number): LyricLine => ({
  ...l,
  timeMs: Math.max(0, l.timeMs + by),
  ...(l.bg?.words ? { bg: { ...l.bg, words: l.bg.words.map((w) => ({ ...w, startMs: w.startMs + by })) } } : {}),
});

/**
 * 时间微调（输出时整体平移，缓存里存的始终是没平移的）：正数 = 歌词推后。
 * 平移：行时间、逐字（yrc；只有 qrc / krc 时先转成 yrc，原始 qrc / krc 不再带出）、lrc / tlyric / romalrc / romanRaw / translationRaw 文本里的时间、和声词时间。
 */
export function applyLyricOffset(l: Lyric, offsetMs: number): Lyric {
  if (!offsetMs) return l;
  const next: Lyric = { ...l, lines: l.lines.map((x) => shiftLine(x, offsetMs)), lyricOffsetMs: offsetMs };
  for (const k of ['lrc', 'tlyric', 'romalrc', 'romanRaw', 'translationRaw'] as const) {
    if (typeof l[k] === 'string') next[k] = shiftLrcText(l[k]!, offsetMs);
  }
  const words = l.yrc ? timedLines(l.yrc) : l.qrc ? timedLines(l.qrc, 'qrc') : l.krc ? timedLines(l.krc, 'krc') : [];
  if (l.yrc !== undefined || words.length) next.yrc = toYrc(words, offsetMs);
  delete next.qrc;
  delete next.krc;
  return next;
}
