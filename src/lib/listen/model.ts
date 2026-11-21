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
  /** 长音（规则见 markEmph：门槛随这首歌的字速，多字单位只给最后一个字，每句最多 2 个）。 */
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
  /** 罗马音（#161，没有则为 undefined）；只有听音空间的歌词栏显示。 */
  ro?: string;
  /** 假名注音（#172）：每段汉字的读音，按出现顺序。 */
  rb?: string[];
  /** 日语句（#172）。 */
  ja?: boolean;
  /** 和声（背景人声，#199）：随行小字，按它自己的逐字时间扫色；units 为 null = 没有逐字时间，整句显示。 */
  bg?: { text: string; units: EngineUnit[] | null };
  /** 对唱（#199）：v2 换第二色，both（合唱）与 v1 用主色；v1 不用记。 */
  agent?: 'v2' | 'both';
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

/**
 * 长音判定（2026-11-21 起，#218；用户在真实缓存 113 首上看过统计后拍板）。以前固定「唱满 1 秒」：
 * 慢歌长音扎堆、快歌一个没有；韩语 / 部分日语按词给时间永远不触发；只认 a–z、单字母不算。现在：
 *   - 门槛跟着这首歌的字速走：max(0.8s, 3 × 每字中位时长)，但唱满 1.3s 一定算；
 *   - 中日韩多字单位估算最后一个字唱了多久（总时长 − 前面几个字 × 每字中位时长），够长就把这个单位拆开、只给最后一个字长音；
 *   - 拉丁词认所有字母（含重音字母、西里尔字母），单字母（"I"）也算，长词不再排除；
 *   - 单个字超过 10 秒不算（来源把间奏 / 下一段并进了这个字，实测 14–33 秒的都是这种；4–10 秒的大多是真长音）；
 *   - 每句最多 2 个，挑最长的。
 */
const EMPH_FLOOR = 0.8;
const EMPH_MUL = 3;
const EMPH_SURE = 1.3;
const EMPH_CAP = 10;
const EMPH_PER_LINE = 2;
/** 没给字速时的默认值：门槛正好 1 秒（和旧规则一致）。 */
const DEFAULT_PACE = 1 / 3;

const voiced = (t: string) => [...t.replace(/[^\p{L}\p{N}]/gu, '')].length;

/** parseYrcText 对没有逐字数据的行会把整行塞成「一个词」：这不是真的逐字。 */
const fakeWords = (l: LyricLineUI) => {
  const ws = l.words ?? [];
  return ws.length === 0 || (ws.length === 1 && [...ws[0]!.text.trim()].length > 1);
};

/**
 * 一首歌的字速：每个字的中位时长（秒），中日韩多字单位按字数摊开。长音门槛按它算；
 * 听音空间、星云歌词、设置预览都要用同一首歌的值（按整首算，不按一句算）。
 */
export function songPace(lines: LyricLineUI[]): number {
  const per: number[] = [];
  for (const l of lines) {
    if (fakeWords(l)) continue;
    for (const w of l.words!) {
      const t = (w.text ?? '').trim();
      const n = voiced(t);
      if (!n || !(w.duration > 0)) continue;
      const k = CJK.test(t) ? n : 1;
      for (let i = 0; i < k; i++) per.push(w.duration / 1000 / k);
    }
  }
  if (per.length < 8) return DEFAULT_PACE;
  per.sort((a, b) => a - b);
  return per[Math.floor(per.length / 2)]!;
}

/** 给一句的单位标长音（见上面的规则）；中日韩多字单位命中时拆成「前面几个字 + 最后一个字」，返回新的单位列表。 */
function markEmph(units: EngineUnit[], pace: number): EngineUnit[] {
  const th = Math.min(EMPH_SURE, Math.max(EMPH_FLOOR, EMPH_MUL * pace));
  const cand: { u: EngineUnit; hold: number }[] = [];
  for (const u of units) {
    const d = u.e - u.s;
    if (d > EMPH_CAP) continue;
    const n = voiced(u.t);
    if (!n) continue;
    const hold = u.cjk ? d - (n - 1) * pace : d;
    if (hold >= th) cand.push({ u, hold });
  }
  if (!cand.length) return units;
  cand.sort((a, b) => b.hold - a.hold);
  const hit = new Map(cand.slice(0, EMPH_PER_LINE).map((c) => [c.u, c.hold]));
  const out: EngineUnit[] = [];
  for (const u of units) {
    const hold = hit.get(u);
    if (hold === undefined) {
      out.push(u);
      continue;
    }
    if (!u.cjk || voiced(u.t) === 1) {
      out.push({ ...u, emph: true });
      continue;
    }
    // 最后一个字（连同它后面的标点）单独成一个长音单位，前面的字按字速唱完
    const chs = [...u.t];
    let cut = chs.length - 1;
    while (cut > 0 && !/[\p{L}\p{N}]/u.test(chs[cut]!)) cut--;
    const mid = u.e - hold;
    out.push({ ...u, t: chs.slice(0, cut).join(''), e: mid, sp: false, emph: false });
    out.push({ ...u, t: chs.slice(cut).join(''), s: mid, cjk: CJK.test(chs.slice(cut).join('')), emph: true });
  }
  return out;
}

/** 逐字句的单位列表。 */
function buildUnits(line: LyricLineUI, pace = DEFAULT_PACE): EngineUnit[] {
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
  for (const u of units) u.sp = u.sp && !/[（(]$/.test(u.t);
  if (units.length) units[units.length - 1]!.sp = false;
  return markEmph(units, pace);
}

/** 和声 / 对唱归属 → 引擎条目上的可选字段。和声没有长音效果（浮起、放大、白光只属于主唱），units 的 emph 一律关掉。 */
function layersOf(l: LyricLineUI): Pick<EngineLine, 'bg' | 'agent'> {
  const out: Pick<EngineLine, 'bg' | 'agent'> = {};
  const bgText = l.bg?.text?.trim();
  if (l.bg && bgText) {
    const units = l.bg.words?.length ? buildUnits({ timeMs: 0, text: bgText, words: l.bg.words }).map((u) => ({ ...u, emph: false })) : [];
    out.bg = { text: bgText, units: units.length ? units : null };
  }
  if (l.agent === 'v2' || l.agent === 'both') out.agent = l.agent;
  return out;
}

/**
 * 一句歌词 → 引擎句子（逐字 / 整句）。nextStart = 下一句开始（秒），整句没有时长时用它当结束。
 * 听音空间（buildEntries）和星云上的空域歌词（LyricsLayer）共用。pace = 这首歌的字速（songPace），长音门槛按它算。
 */
export function toEngineLine(l: LyricLineUI, nextStart?: number, pace = DEFAULT_PACE): EngineLine {
  const tr = l.translation?.trim() || undefined;
  const ro = l.roman?.trim() || undefined;
  const rb = l.ruby?.length ? l.ruby : undefined;
  const ja = l.ja || undefined;
  // parseYrcText 对没有逐字数据的行会把整行塞成「一个词」：这不是真的逐字，按整句处理
  const ws = l.words ?? [];
  const units = fakeWords(l) ? [] : buildUnits(l, pace);
  if (units.length) {
    const s = units[0]!.s;
    const e = units.reduce((m, u) => Math.max(m, u.e), s);
    return { kind: 'line', s, e, text: units.map((u) => u.t).join(''), units, tr, ro, rb, ja, ...layersOf(l), dens: clamp((3.6 - (e - s)) / 1.8, 0, 1) };
  }
  // 没有逐字时间：整句条目，不伪造逐字
  const s = l.timeMs / 1000;
  const rawDur = l.duration && l.duration > 0 ? l.duration : ws[0]?.duration;
  const dur = rawDur && rawDur > 0 ? rawDur / 1000 : undefined;
  const e = dur != null ? s + dur : nextStart != null && nextStart > s ? nextStart : s + 4;
  return { kind: 'line', s, e, text: (l.text ?? '').trim(), units: null, tr, ro, rb, ja, ...layersOf(l), dens: clamp((3.6 - (e - s)) / 1.8, 0, 1) };
}

/** 把歌词转成引擎条目；中间加入间奏 / 前奏（空档 > 4s）。 */
export function buildEntries(lines: LyricLineUI[]): EngineEntry[] {
  const out: EngineEntry[] = [];
  // 先转成句子，再统一插间奏
  const src = lines.filter((l) => (l.text ?? '').trim() !== '' || (l.words?.length ?? 0) > 0);
  const pace = songPace(src);
  const body: EngineLine[] = src.map((l, i) => toEngineLine(l, src[i + 1] ? src[i + 1]!.timeMs / 1000 : undefined, pace));
  body.sort((a, b) => a.s - b.s);
  if (body.length && body[0]!.s > GAP_MIN) out.push({ kind: 'gap', s: 0, e: body[0]!.s });
  for (let i = 0; i < body.length; i++) {
    const cur = body[i]!;
    out.push(cur);
    const next = body[i + 1];
    // 和声比主唱晚唱完时，间奏从和声唱完开始算（不然间奏三点会把这一句从「当前句」里挤掉，和声扫到一半就停）
    const end = cur.bg?.units ? cur.bg.units.reduce((m, u) => Math.max(m, u.e), cur.e) : cur.e;
    if (next && next.s - end > GAP_MIN) out.push({ kind: 'gap', s: end, e: next.s });
  }
  return out;
}
