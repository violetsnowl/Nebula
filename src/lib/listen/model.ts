import type { LyricLineUI } from '../lyrics';

/**
 * 听音空间歌词阅读栏的数据转换（docs/design/NEBULA_UI_SYSTEM.md §7.2）：
 * LyricLineUI[] → 引擎条目（整句 / 逐字 / 间奏）。时间单位统一为秒。
 */

/** 一个「唱的单位」：逐字歌词里的一个 word（中文基本是单字，英文是单词）。 */
export interface EngineUnit {
  /** 显示文字（已去掉首尾空白；纯标点的 word 并入前一个单位）。 */
  t: string;
  /** 开始 / 结束（秒）。 */
  s: number;
  e: number;
  /** 含假名 / 汉字 / 谚文：扫光羽化 42% 字宽（拉丁词 26%）。 */
  cjk: boolean;
  /** 这个单位后面是否跟空格（对照该行 text 推断，YRC 的英文 word 常被 trim 掉空格）。 */
  sp: boolean;
  /** 长音：逐字时长 ≥1000ms，且是中日韩单字或 2–7 个字母的拉丁词。 */
  emph: boolean;
}

/** 一句歌词。units 为 null = 没有逐字时间（不伪造，整句亮起）。 */
export interface EngineLine {
  kind: 'line';
  /** 开始 / 结束（秒）。逐字句取第一个字的开始与最后一个字的结束；整句取行时间与时长。 */
  s: number;
  e: number;
  text: string;
  units: EngineUnit[] | null;
  /** 翻译（没有则为 undefined）。 */
  tr?: string;
  /** 快歌密度 0–1：演唱时长 3.6s 以上 = 0，1.8s 以内 = 1。 */
  dens: number;
}

/** 间奏 / 前奏（超过 4s 才会插入）：三点随进度逐个亮起。 */
export interface EngineGap {
  kind: 'gap';
  s: number;
  e: number;
}

export type EngineEntry = EngineLine | EngineGap;

/** 超过这个空档（秒）才显示间奏三点。 */
export const GAP_MIN = 4;

/** 假名 / 谚文 / 汉字（含兼容汉字区）。用 \u 转义写，避免源码里的生僻字符被编辑器改坏。 */
const KANA = /[぀-ヿ]/;
const HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const HAN = /[㐀-鿿豈-﫿]/;
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;
/** 纯标点（含括号、引号、省略号、破折号）。 */
const PUNCT_ONLY = /^[\s，。、！？；：,.!?;:'"‘’“”）)（(…—\-~·]+$/;
/** 开括号：不并入前一个单位。 */
const OPEN_BRACKET = /^[（(“‘"']/;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** 按歌词正文的文字多数判断用哪一套字体 / 字号（假名 → 日文，谚文 → 韩文，汉字 → 中文，否则拉丁）。 */
export function detectScript(lines: LyricLineUI[]): 'zh' | 'en' | 'ja' | 'ko' {
  let kana = 0;
  let hangul = 0;
  let han = 0;
  let latin = 0;
  for (const l of lines) {
    for (const ch of l.text) {
      if (KANA.test(ch)) kana++;
      else if (HANGUL.test(ch)) hangul++;
      else if (HAN.test(ch)) han++;
    }
    // 拉丁文按「词」数（一个英文词和一个汉字的信息量相当），不按字母数
    latin += (l.text.match(/[A-Za-z]+/g) ?? []).length;
  }
  const cjk = kana + hangul + han;
  if (cjk === 0 || latin > cjk) return 'en';
  if (hangul > 0 && hangul >= kana && hangul >= han) return 'ko';
  // 日文里汉字也很多：只要假名占到汉字的一成以上就算日文
  if (kana > 0 && kana >= han * 0.1) return 'ja';
  if (han > 0) return 'zh';
  return 'en';
}

/** 长音判定：只看逐字时长（≥1000ms）+ 字数规则。 */
function isEmph(t: string, s: number, e: number, cjk: boolean): boolean {
  if (e - s < 1.0) return false;
  if (cjk) return [...t.replace(/[^\p{L}\p{N}]/gu, '')].length === 1;
  const letters = t.replace(/[^A-Za-z]/g, '').length;
  return letters >= 2 && letters <= 7;
}

/** 逐字句的单位列表。 */
function buildUnits(line: LyricLineUI): EngineUnit[] {
  const words = line.words ?? [];
  const text = line.text ?? '';
  const units: EngineUnit[] = [];
  // 词后空格：来源带了原文空格信息（LyricWordUI.space）就以它为准；没有时才对照整行文字推断（游标顺着 text 往后找）
  const hasSpaceInfo = words.some((w) => w.space !== undefined);
  let cursor = 0;
  for (const w of words) {
    const t = (w.text ?? '').trim();
    if (!t) continue;
    const s = w.startMs / 1000;
    const e = Math.max(s, (w.startMs + (w.duration || 0)) / 1000);
    let sp = hasSpaceInfo ? !!w.space : /\s$/.test(w.text);
    const at = hasSpaceInfo ? -1 : text.indexOf(t, cursor);
    if (at >= 0) {
      const after = at + t.length;
      sp = sp || /\s/.test(text.charAt(after));
      cursor = after;
    }
    const prev = units[units.length - 1];
    if (prev && PUNCT_ONLY.test(t) && !OPEN_BRACKET.test(t)) {
      prev.t += t;
      prev.sp = sp;
      continue;
    }
    const cjk = CJK.test(t);
    units.push({ t, s, e, cjk, sp, emph: false });
  }
  // 没在 text 里找到任何位置（文字与逐字不一致）：拉丁词之间补空格，中日韩不补
  if (!hasSpaceInfo && cursor === 0 && units.length > 1) {
    for (let i = 0; i < units.length - 1; i++) {
      const a = units[i]!;
      const b = units[i + 1]!;
      if (!a.cjk && !b.cjk) a.sp = true;
    }
  }
  for (const u of units) {
    u.sp = u.sp && !/[（(]$/.test(u.t);
    u.emph = isEmph(u.t, u.s, u.e, u.cjk);
  }
  if (units.length) units[units.length - 1]!.sp = false;
  return units;
}

/** 把歌词转成引擎条目；中间加入间奏 / 前奏（空档 > 4s）。 */
export function buildEntries(lines: LyricLineUI[]): EngineEntry[] {
  const out: EngineEntry[] = [];
  // 先转成句子，再统一插间奏
  const body: EngineLine[] = [];
  const src = lines.filter((l) => (l.text ?? '').trim() !== '' || (l.words?.length ?? 0) > 0);
  for (let i = 0; i < src.length; i++) {
    const l = src[i]!;
    const nextStart = src[i + 1] ? src[i + 1]!.timeMs / 1000 : undefined;
    const tr = l.translation?.trim() || undefined;
    // parseYrcText 对没有逐字数据的行会把整行塞成「一个词」：这不是真的逐字，按整句处理
    const ws = l.words ?? [];
    const fake = ws.length === 0 || (ws.length === 1 && [...ws[0]!.text.trim()].length > 1);
    const units = fake ? [] : buildUnits(l);
    if (units.length) {
      const s = units[0]!.s;
      const e = units.reduce((m, u) => Math.max(m, u.e), s);
      body.push({
        kind: 'line',
        s,
        e,
        text: units.map((u) => u.t).join(''),
        units,
        tr,
        dens: clamp((3.6 - (e - s)) / 1.8, 0, 1),
      });
    } else {
      // 没有逐字时间：整句条目，不伪造逐字
      const s = l.timeMs / 1000;
      const rawDur = l.duration && l.duration > 0 ? l.duration : ws[0]?.duration;
      const dur = rawDur && rawDur > 0 ? rawDur / 1000 : undefined;
      const e = dur != null ? s + dur : nextStart != null && nextStart > s ? nextStart : s + 4;
      body.push({
        kind: 'line',
        s,
        e,
        text: (l.text ?? '').trim(),
        units: null,
        tr,
        dens: clamp((3.6 - (e - s)) / 1.8, 0, 1),
      });
    }
  }
  body.sort((a, b) => a.s - b.s);
  if (body.length && body[0]!.s > GAP_MIN) out.push({ kind: 'gap', s: 0, e: body[0]!.s });
  for (let i = 0; i < body.length; i++) {
    const cur = body[i]!;
    out.push(cur);
    const next = body[i + 1];
    if (next && next.s - cur.e > GAP_MIN) out.push({ kind: 'gap', s: cur.e, e: next.s });
  }
  return out;
}
