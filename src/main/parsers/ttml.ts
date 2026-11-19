import type { Lyric } from '../types';
import { mergeLyric } from './lyricParser';
import { lrcAt, toYrc, type TimedLine } from './timedLyrics';

/*
 * TTML（Apple Music 逐字歌词 / AMLL 社区库）子集解析器，自己写的，不依赖任何 XML 库。
 * 只覆盖歌词用到的部分：标签、属性、文本、实体、注释、CDATA；
 * 不处理 DTD / 外部实体（带 DOCTYPE 的文档整个拒绝），不展开任何自定义实体，所以没有实体膨胀类攻击面。
 * 畸形输入一律返回空结果，不抛异常。
 */

export interface TtmlLineRow {
  timeMs: number;
  text: string;
  /** 行 id（itunes:key），翻译 / 罗马音按它对应。 */
  key?: string;
}
export interface TtmlTextRow {
  timeMs: number;
  text: string;
}
export interface TtmlResult {
  /** Word：有逐字时间；Line：只有行时间；None：没有可用正文。 */
  timing: 'Word' | 'Line' | 'None';
  /** 主唱的逐字行（只有 Word 时才有内容）。 */
  lines: TimedLine[];
  /** 全部主唱行（逐行时间），Word / Line 都有。 */
  lineRows: TtmlLineRow[];
  translations: TtmlTextRow[];
  romans: TtmlTextRow[];
}

/** 输入上限（字符数）。 */
export const TTML_MAX_CHARS = 2 * 1024 * 1024;
const MAX_NODES = 400_000;
const MAX_DEPTH = 64;

const empty = (): TtmlResult => ({ timing: 'None', lines: [], lineRows: [], translations: [], romans: [] });

/* ---------- XML 层 ---------- */

interface XEl {
  name: string;
  attrs: Record<string, string>;
  kids: Array<XEl | string>;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** 一次扫描解码，不递归：`&amp;lt;` 得到 `&lt;`，不会二次展开。未知的命名实体原样保留。 */
function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]{2,4}));/g, (whole, dec, hex, name) => {
    if (name) return NAMED[name] ?? whole;
    const cp = dec ? Number(dec) : parseInt(hex, 16);
    if (cp === 9 || cp === 10 || cp === 13) return String.fromCharCode(cp);
    if (cp < 32 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfffe || cp === 0xffff) return '';
    return String.fromCodePoint(cp);
  });
}

const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/** 解析成元素树；任何结构错误返回 null。迭代实现，深度有上限。 */
function parseXml(src: string): XEl | null {
  const n = src.length;
  const root: XEl = { name: '#root', attrs: Object.create(null), kids: [] };
  const stack: XEl[] = [root];
  let i = 0;
  let nodes = 0;
  let roots = 0;
  const top = (): XEl => stack[stack.length - 1]!;
  while (i < n) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i && stack.length > 1) top().kids.push(decodeEntities(src.slice(i, textEnd)));
    if (lt < 0) break;
    i = lt;
    if (++nodes > MAX_NODES) return null;
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      if (e < 0) return null;
      i = e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i + 9);
      if (e < 0 || stack.length < 2) return null;
      top().kids.push(src.slice(i + 9, e));
      i = e + 3;
      continue;
    }
    if (src.startsWith('<?', i)) {
      const e = src.indexOf('?>', i + 2);
      if (e < 0) return null;
      i = e + 2;
      continue;
    }
    // DOCTYPE / ENTITY 等声明：歌词文件不会有，整个文档拒绝
    if (src.startsWith('<!', i)) return null;
    if (src[i + 1] === '/') {
      const e = src.indexOf('>', i + 2);
      if (e < 0 || stack.length < 2) return null;
      if (src.slice(i + 2, e).trim() !== top().name) return null;
      stack.pop();
      i = e + 1;
      continue;
    }
    // 开始标签
    let j = i + 1;
    while (j < n && !isSpace(src[j]!) && src[j] !== '/' && src[j] !== '>') j++;
    const name = src.slice(i + 1, j);
    if (!name || !/^[A-Za-z_][\w.:-]*$/.test(name)) return null;
    const el: XEl = { name, attrs: Object.create(null), kids: [] };
    let selfClose = false;
    for (;;) {
      while (j < n && isSpace(src[j]!)) j++;
      if (j >= n) return null;
      if (src[j] === '>') {
        j++;
        break;
      }
      if (src[j] === '/') {
        if (src[j + 1] !== '>') return null;
        selfClose = true;
        j += 2;
        break;
      }
      const a0 = j;
      while (j < n && !isSpace(src[j]!) && src[j] !== '=' && src[j] !== '/' && src[j] !== '>') j++;
      const attr = src.slice(a0, j);
      if (!attr) return null;
      while (j < n && isSpace(src[j]!)) j++;
      if (src[j] !== '=') return null;
      j++;
      while (j < n && isSpace(src[j]!)) j++;
      const quote = src[j];
      if (quote !== '"' && quote !== "'") return null;
      const e = src.indexOf(quote, j + 1);
      if (e < 0) return null;
      el.attrs[attr] = decodeEntities(src.slice(j + 1, e));
      j = e + 1;
      if (++nodes > MAX_NODES) return null;
    }
    if (stack.length === 1 && ++roots > 1) return null;
    top().kids.push(el);
    if (!selfClose) {
      if (stack.length >= MAX_DEPTH) return null;
      stack.push(el);
    }
    i = j;
  }
  if (stack.length !== 1 || !roots) return null;
  return root;
}

const local = (name: string): string => name.slice(name.indexOf(':') + 1);

/** 取属性：先按完整名（含前缀），再按去掉前缀的名字（ttm:role / itunes:key / xml:lang 不关心前缀怎么写）。 */
function attr(el: XEl, name: string): string | undefined {
  if (name in el.attrs) return el.attrs[name];
  for (const k of Object.keys(el.attrs)) if (local(k) === name) return el.attrs[k];
  return undefined;
}

/* ---------- 时间 ---------- */

/** `hh:mm:ss.fff` / `mm:ss.fff` / `ss.fff` / 带 h m s ms 后缀；认不出返回 null。 */
export function parseTtmlTime(input: string | undefined): number | null {
  if (typeof input !== 'string') return null;
  const t = input.trim().replace(',', '.');
  if (!t) return null;
  let m = /^(\d{1,4}):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(t);
  let sec: number;
  if (m) sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  else if ((m = /^(\d{1,4}):(\d{1,2}(?:\.\d+)?)$/.exec(t))) sec = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d+(?:\.\d+)?)(h|ms|m|s)?$/.exec(t))) {
    const v = Number(m[1]);
    sec = m[2] === 'h' ? v * 3600 : m[2] === 'm' ? v * 60 : m[2] === 'ms' ? v / 1000 : v;
  } else return null;
  const ms = Math.round(sec * 1000);
  return Number.isFinite(ms) && ms >= 0 && ms <= 1e9 ? ms : null;
}

/* ---------- 歌词层 ---------- */

type Role = 'bg' | 'translation' | 'roman' | '';
function roleOf(el: XEl): Role {
  const r = (attr(el, 'role') ?? '').trim().toLowerCase();
  return r === 'x-bg' ? 'bg' : r === 'x-translation' ? 'translation' : r === 'x-roman' ? 'roman' : '';
}

/** 元素的全部文字（跳过背景人声 / 行内翻译 / 行内罗马音）。 */
function textOf(el: XEl): string {
  let out = '';
  for (const k of el.kids) {
    if (typeof k === 'string') out += k;
    else if (!roleOf(k)) out += textOf(k);
  }
  return out;
}

/** 后代里有没有带可解析 begin 的 span（嵌套 span 时外层不算「字」）。 */
function hasTimedDescendant(el: XEl): boolean {
  for (const k of el.kids) {
    if (typeof k === 'string' || roleOf(k)) continue;
    if (parseTtmlTime(attr(k, 'begin')) !== null || hasTimedDescendant(k)) return true;
  }
  return false;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ');

interface RawWord {
  text: string;
  start: number;
  end: number | null;
}
interface LineCtx {
  words: RawWord[];
  plain: string;
  translation: string;
  roman: string;
}

function walkLine(el: XEl, ctx: LineCtx): void {
  for (const k of el.kids) {
    if (typeof k === 'string') {
      ctx.plain += k;
      // span 之间的文字（多半是英文词间空格）并到前一个词末尾
      const last = ctx.words[ctx.words.length - 1];
      if (last) last.text += k;
      continue;
    }
    const role = roleOf(k);
    if (role === 'bg') continue; // 背景人声：第一版丢掉
    if (role === 'translation') {
      ctx.translation += textOf(k);
      continue;
    }
    if (role === 'roman') {
      ctx.roman += textOf(k);
      continue;
    }
    if (local(k.name) === 'br') {
      ctx.plain += ' ';
      const last = ctx.words[ctx.words.length - 1];
      if (last) last.text += ' ';
      continue;
    }
    const start = parseTtmlTime(attr(k, 'begin'));
    if (start !== null && !hasTimedDescendant(k)) {
      const text = textOf(k);
      let end = parseTtmlTime(attr(k, 'end'));
      if (end === null) {
        const dur = parseTtmlTime(attr(k, 'dur'));
        end = dur === null ? null : start + dur;
      }
      ctx.words.push({ text, start, end });
      ctx.plain += text;
    } else walkLine(k, ctx); // 外层包装 / 没有时间的 span：展开
  }
}

/** 词表整理：词内空白折叠；词首空白移到前一个词末尾；纯空白不算词；行首尾去空白。 */
function normalizeWords(raw: RawWord[], lineEnd: number | null): TimedLine['words'] {
  const words: Array<{ text: string; start: number; end: number | null }> = [];
  for (const w of raw) {
    let t = collapse(w.text);
    const prev = words[words.length - 1];
    if (prev && t.startsWith(' ')) {
      if (!prev.text.endsWith(' ')) prev.text += ' ';
      t = t.slice(1);
    }
    if (!t.trim()) {
      if (prev && t && !prev.text.endsWith(' ')) prev.text += ' ';
      continue;
    }
    words.push({ text: t, start: w.start, end: w.end });
  }
  if (!words.length) return [];
  words[0]!.text = words[0]!.text.trimStart();
  words[words.length - 1]!.text = words[words.length - 1]!.text.trimEnd();
  return words.map((w, i) => {
    const next = words[i + 1]?.start;
    let end = w.end ?? next ?? lineEnd ?? w.start;
    if (end <= w.start) end = next !== undefined && next > w.start ? next : w.start + 1;
    return { text: w.text, startMs: w.start, duration: end - w.start };
  });
}

function collectByTag(el: XEl, tag: string, out: XEl[]): void {
  for (const k of el.kids) {
    if (typeof k === 'string') continue;
    if (local(k.name) === tag) out.push(k);
    else collectByTag(k, tag, out);
  }
}

/** 多种语言时：zh-Hans 优先，其次任意 zh，再其次第一个。 */
function pickLanguage(list: XEl[]): XEl | undefined {
  const lang = (e: XEl): string => (attr(e, 'lang') ?? '').toLowerCase();
  return list.find((e) => lang(e).startsWith('zh-hans')) ?? list.find((e) => /^zh(?:$|[-_])/.test(lang(e))) ?? list[0];
}

/** head 里的翻译 / 罗马音：`<translation xml:lang><text for="L1">…</text>`，返回 行 id → 文字。 */
function headTexts(root: XEl, group: 'translation' | 'transliteration'): Map<string, string> {
  const out = new Map<string, string>();
  const containers: XEl[] = [];
  collectByTag(root, group, containers);
  const chosen = pickLanguage(containers);
  if (!chosen) return out;
  const texts: XEl[] = [];
  collectByTag(chosen, 'text', texts);
  for (const t of texts) {
    const key = attr(t, 'for');
    if (!key || out.has(key)) continue;
    // 这里的文字允许带逐音节 span，直接拼接（词间空格在文本节点里）
    let s = '';
    const gather = (e: XEl): void => {
      for (const k of e.kids) {
        if (typeof k === 'string') s += k;
        else gather(k);
      }
    };
    gather(t);
    const text = collapse(s).trim();
    if (text) out.set(key, text);
  }
  return out;
}

/** 解析 TTML：不抛异常，畸形 / 超大输入返回空结果。 */
export function parseTtml(xml: string): TtmlResult {
  try {
    if (typeof xml !== 'string' || !xml || xml.length > TTML_MAX_CHARS) return empty();
    const root = parseXml(xml);
    if (!root) return empty();
    const tts: XEl[] = [];
    collectByTag(root, 'tt', tts);
    const body: XEl[] = [];
    collectByTag(tts[0] ?? root, 'body', body);
    const ps: XEl[] = [];
    collectByTag(body[0] ?? tts[0] ?? root, 'p', ps);

    interface Row {
      timeMs: number;
      text: string;
      key?: string;
      words: TimedLine['words'];
      endMs: number;
      translation: string;
      roman: string;
    }
    const rows: Row[] = [];
    for (const p of ps) {
      if (roleOf(p) === 'bg') continue;
      const ctx: LineCtx = { words: [], plain: '', translation: '', roman: '' };
      walkLine(p, ctx);
      const pBegin = parseTtmlTime(attr(p, 'begin'));
      let pEnd = parseTtmlTime(attr(p, 'end'));
      if (pEnd === null) {
        const dur = parseTtmlTime(attr(p, 'dur'));
        pEnd = pBegin !== null && dur !== null ? pBegin + dur : null;
      }
      const words = normalizeWords(ctx.words, pEnd);
      const text = words.length ? words.map((w) => w.text).join('').trim() : collapse(ctx.plain).trim();
      if (!text) continue;
      const timeMs = words.length ? Math.min(pBegin ?? words[0]!.startMs, words[0]!.startMs) : pBegin;
      if (timeMs === null) continue; // 没有任何时间的行放不进时间轴
      const lastEnd = words.length ? Math.max(...words.map((w) => w.startMs + w.duration)) : 0;
      const endMs = Math.max(pEnd ?? 0, lastEnd, timeMs + 1);
      rows.push({
        timeMs,
        text,
        key: attr(p, 'key') || undefined,
        words,
        endMs,
        translation: collapse(ctx.translation).trim(),
        roman: collapse(ctx.roman).trim(),
      });
    }
    if (!rows.length) return empty();
    rows.sort((a, b) => a.timeMs - b.timeMs);

    const headTrans = headTexts(root, 'translation');
    const headRoman = headTexts(root, 'transliteration');
    const translations: TtmlTextRow[] = [];
    const romans: TtmlTextRow[] = [];
    for (const r of rows) {
      const tr = r.translation || (r.key ? headTrans.get(r.key) : '') || '';
      const ro = r.roman || (r.key ? headRoman.get(r.key) : '') || '';
      if (tr) translations.push({ timeMs: r.timeMs, text: tr });
      if (ro) romans.push({ timeMs: r.timeMs, text: ro });
    }
    const lines: TimedLine[] = rows
      .filter((r) => r.words.length)
      .map((r) => ({ timeMs: r.timeMs, duration: r.endMs - r.timeMs, text: r.text, words: r.words }));
    return {
      timing: lines.length ? 'Word' : 'Line',
      lines,
      lineRows: rows.map((r) => ({ timeMs: r.timeMs, text: r.text, ...(r.key ? { key: r.key } : {}) })),
      translations,
      romans,
    };
  } catch {
    return empty();
  }
}

/** TTML → Lyric；逐字（timing=Word）才给 yrc。没有正文返回 null。 */
export function fromTtml(xml: string, source: 'amll' | 'applemusic'): Lyric | null {
  const t = parseTtml(xml);
  if (!t.lineRows.length) return null;
  const lrc = t.lineRows.map((l) => lrcAt(l.timeMs, l.text)).join('\n');
  const tlyric = t.translations.map((l) => lrcAt(l.timeMs, l.text)).join('\n');
  const romalrc = t.romans.map((l) => lrcAt(l.timeMs, l.text)).join('\n');
  const lyric: Lyric = {
    raw: lrc,
    lrc,
    lines: mergeLyric(lrc, tlyric),
    translationRaw: tlyric,
    tlyric,
    romanRaw: romalrc,
    romalrc,
    source,
  };
  if (t.timing === 'Word' && t.lines.length) lyric.yrc = toYrc(t.lines);
  return lyric;
}
