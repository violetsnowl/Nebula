import zlib from 'node:zlib';
import type { Lyric } from '../types';
import { mergeLyric } from './lyricParser';
import { lrcAt, toYrc, type TimedLine } from './timedLyrics';

/*
 * 酷我歌词（#204）：酷我和波点同一套曲库，歌曲 id 相同，两家共用。
 * 接口 newlyric.kuwo.cn：请求参数和返回内容都用 "yeelion" 循环异或；返回 = 几行文本头 + 空行 + zlib 压缩的正文。
 * 头里 lrcx=1 时正文还要再 base64 + 异或一次，得到 LRCX（逐字）；否则是普通 LRC。文字编码 GB18030。
 * LRCX：
 *   - 头部 [kuwo:N]，N 是八进制，十位 k1、个位 k2；
 *   - 每个字写成 <a,b>字，相对行首的起点 = (a+b)/(2·k1)、时长 = (a−b)/(2·k2)（实测几首歌，前一个字的起点 + 时长正好等于下一个字的起点）；
 *   - 同一时间戳出现两行时，全是 <0,0> 的那行是翻译，带时间的那行是原文。
 * 没有罗马音。
 */

const KEY = Buffer.from('yeelion');
const xor = (buf: Buffer): Buffer => {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i]! ^ KEY[i % KEY.length]!;
  return out;
};

/** 酷我歌词地址（匿名，不带登录信息）。rid 为纯数字。 */
export function kuwoLyricUrl(rid: string): string {
  const q = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${rid}&lrcx=1`;
  return `http://newlyric.kuwo.cn/newlyric.lrc?${xor(Buffer.from(q)).toString('base64')}`;
}

/** 解开接口返回的字节，得到 LRC / LRCX 文本；格式不对返回 null，不抛错。 */
export function decodeKuwoLyric(buf: Buffer): string | null {
  try {
    const sep = buf.indexOf('\r\n\r\n');
    if (sep < 0) return null;
    const head = buf.subarray(0, sep).toString('latin1');
    let body = zlib.inflateSync(buf.subarray(sep + 4));
    if (/(?:^|\r?\n)lrcx=1(?:\r?\n|$)/.test(head)) body = xor(Buffer.from(body.toString('latin1'), 'base64'));
    const text = new TextDecoder('gb18030').decode(body);
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

const TAG = /<(-?\d+),(-?\d+)>/g;
const HAS_TAG = /<-?\d+,-?\d+>/;
const stripTags = (s: string): string => s.replace(TAG, '');
const allZero = (s: string): boolean => {
  const tags = [...s.matchAll(TAG)];
  return tags.length > 0 && tags.every((m) => m[1] === '0' && m[2] === '0');
};

/** 解析酷我 LRC / LRCX 文本 → Lyric。没有正文返回 null。 */
export function parseKuwoLyric(text: string): Lyric | null {
  const kuwo = text.match(/\[kuwo:(\d+)\]/)?.[1];
  const k = kuwo ? parseInt(kuwo, 8) : NaN;
  const k1 = Number.isFinite(k) && Math.floor(k / 10) > 0 ? Math.floor(k / 10) : 1;
  const k2 = Number.isFinite(k) && k % 10 > 0 ? k % 10 : 1;
  const offset = Number(text.match(/\[offset:(-?\d+)\]/)?.[1]) || 0;
  // 按时间戳分组，保持原顺序
  const groups = new Map<number, string[]>();
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\[(\d+):(\d+)(?:[.:](\d+))?\](.*)$/);
    if (!m) continue;
    const frac = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) : 0;
    const t = Math.max(0, Number(m[1]) * 60000 + Number(m[2]) * 1000 + frac - offset);
    (groups.get(t) ?? groups.set(t, []).get(t)!).push(m[4]!);
  }
  const lines: Array<{ timeMs: number; text: string; translation?: string }> = [];
  const timed: TimedLine[] = [];
  for (const [timeMs, rows] of [...groups].sort((a, b) => a[0] - b[0])) {
    // 原文 = 带时间的那行（没有逐字时就是最后一行）；全是 <0,0> 的那行是翻译
    const origin = rows.find((r) => HAS_TAG.test(r) && !allZero(r)) ?? rows[rows.length - 1]!;
    const text0 = stripTags(origin).trim();
    if (!text0) continue;
    const trans = rows.filter((r) => r !== origin).map((r) => stripTags(r).trim()).find((t) => t && t !== text0);
    lines.push({ timeMs, text: text0, ...(trans ? { translation: trans } : {}) });
    if (allZero(origin) || !HAS_TAG.test(origin)) continue;
    const words: TimedLine['words'] = [];
    const parts = origin.split(/(<-?\d+,-?\d+>)/);
    for (let i = 1; i < parts.length; i += 2) {
      const [a, b] = parts[i]!.slice(1, -1).split(',').map(Number) as [number, number];
      const word = parts[i + 1] ?? '';
      if (!word) continue;
      const startMs = timeMs + Math.max(0, Math.round((a + b) / (2 * k1)));
      // 时长 0 的字（酷我偶尔给）按 1ms 保留，不然逐字解析会丢掉这个字、正文缺字
      const duration = Math.max(1, Math.round((a - b) / (2 * k2)));
      if (words.length && !word.trim()) { words[words.length - 1]!.text += word; continue; }
      words.push({ text: word, startMs, duration });
    }
    if (!words.length) continue;
    const end = Math.max(...words.map((w) => w.startMs + w.duration));
    timed.push({ timeMs, duration: Math.max(1, end - timeMs), text: words.map((w) => w.text).join('').trim(), words });
  }
  if (!lines.length) return null;
  const lrc = lines.map((l) => lrcAt(l.timeMs, l.text)).join('\n');
  const tlyric = lines.filter((l) => l.translation).map((l) => lrcAt(l.timeMs, l.translation!)).join('\n');
  return {
    raw: lrc,
    lrc,
    lines: mergeLyric(lrc, tlyric),
    yrc: timed.length ? toYrc(timed) : undefined,
    translationRaw: tlyric || undefined,
    tlyric: tlyric || undefined,
    source: 'kuwo',
  };
}
