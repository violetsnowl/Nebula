import type { SectionKind } from '../../lib/listen/sections';
import { foot, held, justify, spine } from './bold-a';
import { bleed, diag, field } from './bold-b';
import { corner, groove, grid } from './bold-c';
import { drum, fault } from './bold-d';
import { cut, register } from './bold-e';
import { CLASSIC_FALLBACK_H, CLASSIC_H, CLASSIC_V } from './classic';
import { glyphs, norm, PARTICLE_CJK, STOP, STOP_CJK, STOP_CJK_PAIR, VOCABLES } from './kit';
import type { TCtx, Tpl } from './types';

/**
 * 版式轮换（样张 N「一首歌翻下来」）：稳和险交替。每种段落一张计划表，'c' = 轮到经典版式；
 * 同一段落第几次出现就从计划表第几格开始找第一套能用的（fits），大胆版式一首歌里最多出现一次，相邻两页不重复。
 * 色场只给全曲最后一个副歌页。所有语言共用这一套轮换，横排还是竖排由页面方向决定（中文竖排、其余横排）。
 */

const BOLD: Record<string, Tpl> = { held, spine, justify, foot, bleed, diag, field, groove, grid, corner, fault, drum, register, cut };

/** 后面几批版式在各自的模块里登记进来。 */
export function registerBold(...ts: Tpl[]): void {
  for (const t of ts) BOLD[t.id] = t;
}

const PLAN: Record<SectionKind, string[]> = {
  verse: ['held', 'c', 'foot', 'grid', 'c', 'c'],
  pre: ['spine', 'c', 'c'],
  chorus: ['justify', 'register', 'bleed', 'corner', 'drum', 'c', 'c'],
  bridge: ['diag', 'fault', 'c'],
  outro: ['drum', 'groove', 'cut', 'c'],
};

/** 大动作的版式：新四套（样张 O）不和它们排在相邻两页，反过来它们也不紧跟新四套。 */
const LOUD = new Set(['justify', 'bleed', 'field', 'fault', 'drum', 'register', 'cut']);
const NEW_O = new Set(['fault', 'drum', 'register', 'cut']);

/** 按歌轮流：一首歌只有一段桥时，一半的歌用断层、一半用斜线（同一首歌每次一样）。 */
function flip(c: TCtx): boolean {
  let h = 0;
  for (const l of c.song) for (const ch of l.text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h >>> 7) % 2 === 1;
}

export interface PickState {
  seen: Partial<Record<SectionKind, number>>;
  classic: Partial<Record<SectionKind, number>>;
  used: Set<string>;
  prev: string;
}
export const newPickState = (): PickState => ({ seen: {}, classic: {}, used: new Set(), prev: '' });

/** 开发 / QA 用：localStorage['nebula.pageTpl'] = 版式 id，能用的页一律用它。 */
function forced(): string | null {
  try {
    return localStorage.getItem('nebula.pageTpl');
  } catch {
    return null;
  }
}

export function pickTpl(c: TCtx, st: PickState): Tpl {
  const kind = c.kind;
  const nth = st.seen[kind] ?? 0;
  st.seen[kind] = nth + 1;
  const done = (t: Tpl) => {
    st.prev = t.id;
    if (t.bold) st.used.add(t.id);
    return t;
  };
  const f = forced();
  if (f && BOLD[f] && (!BOLD[f]!.fits || BOLD[f]!.fits!(c))) return done(BOLD[f]!);
  const classic = () => {
    const pool = (c.vert ? CLASSIC_V : CLASSIC_H)[kind];
    let j = st.classic[kind] ?? 0;
    let t = pool[j % pool.length]!;
    j++;
    if (t.id === st.prev && pool.length > 1) t = pool[j++ % pool.length]!;
    st.classic[kind] = j;
    return done(t);
  };
  // 全曲最后一个副歌页：末句收在长音上用负形镂空，否则色场（二选一）
  if (c.lastChorus) for (const id of ['cut', 'field']) {
    const t = BOLD[id];
    if (t && !st.used.has('cut') && !st.used.has('field') && (!t.fits || t.fits(c))) return done(t);
  }
  const plan = kind === 'bridge' && flip(c) ? ['fault', 'diag', 'c'] : PLAN[kind];
  for (let j = 0; j < plan.length; j++) {
    const id = plan[(nth + j) % plan.length]!;
    if (id === 'c') return classic();
    const t = BOLD[id];
    if (!t || st.used.has(id) || id === st.prev) continue;
    if ((NEW_O.has(id) && LOUD.has(st.prev)) || (NEW_O.has(st.prev) && LOUD.has(id))) continue;
    if (t.fits && !t.fits(c)) continue;
    return done(t);
  }
  return classic();
}

/** 强制横排的大胆版式（唱片纹）在中文歌里退回时用的经典版式。 */
export const FALLBACK_H = CLASSIC_FALLBACK_H;

const HAN_CH = /[\u3400-\u9fff\uf900-\ufaff]/;

interface HookTok {
  key: string;
  text: string;
  strong: boolean;
}

interface HookCand {
  key: string;
  text: string;
  n: number;
  ends: number;
  len: number;
}

const isLatinWord = (s: string) => /[a-zA-Z]/.test(s) && !/[\u3040-\u30ff\uac00-\ud7af\u3400-\u9fff]/.test(s);
const latinLetters = (s: string) => s.replace(/[^a-zA-Z]/g, '').length;

/** 剥去首尾标点括号、保留词内撇号，防止出血 660px 大字把逗号/感叹号一起画出来。 */
function cleanSurface(raw: string, latin: boolean): string {
  const s = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return latin ? s.toLowerCase() : s;
}

/** 判定单个词是否为可独立撑起版面的「强词」。 */
function classifyWord(raw: string): HookTok | null {
  const key = norm(raw);
  if (!key) return null;
  if (isLatinWord(raw)) {
    const text = cleanSurface(raw, true);
    if (!text) return null;
    const strong = !key.includes("'") && latinLetters(key) >= 3 && !STOP.has(key);
    return { key, text, strong };
  }
  const text = cleanSurface(raw, false);
  const chars = [...key];
  if (!text || !chars.length) return null;
  if (chars.length === 1) {
    const ch = chars[0]!;
    // 单字只接受中文实义汉字（排除日文单假名、韩文单音节和中文虚字）
    return { key, text, strong: HAN_CH.test(ch) && !STOP_CJK.has(ch) };
  }
  if (chars.length === 2) {
    const strong =
      !STOP_CJK_PAIR.has(key) &&
      !chars.some((ch) => PARTICLE_CJK.has(ch)) &&
      !chars.every((ch) => STOP_CJK.has(ch));
    return { key, text, strong };
  }
  return { key, text, strong: false };
}

function pickBest(map: Map<string, HookCand>, minNeed: (c: HookCand) => number): string | null {
  let best: HookCand | null = null;
  let bestScore = 0;
  for (const c of map.values()) {
    if (c.n < minNeed(c)) continue;
    const s = c.n + (c.ends / c.n) * 0.9 + c.len * 0.01;
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best ? best.text : null;
}

/**
 * 这首歌的「钩子词」（出血大字用）：副歌里重复最多的实词。
 * 分级选择：强词达标（拉丁 ≥3 次，中日韩双字 ≥3 次，中文实义单字 ≥4 次）→ 相邻两词短语（≥3 次）→ null（无重复钩子则不用出血版式）。
 * units：拉丁 = 每句的词；中日韩 = 每句整句原文（一个元素，保留空格，分词要看停顿）。
 */
export function songHook(units: string[][], cjk: boolean, title?: string): string | null {
  const strong = new Map<string, HookCand>();
  const phrases = new Map<string, HookCand>();
  const bump = (map: Map<string, HookCand>, key: string, text: string, len: number, end: boolean) => {
    const cur = map.get(key) ?? { key, text, n: 0, ends: 0, len };
    cur.n++;
    if (end) cur.ends++;
    map.set(key, cur);
  };
  const addLine = (tokens: Array<{ tok: HookTok; phraseEnd: boolean }>) => {
    tokens.forEach(({ tok, phraseEnd }, i) => {
      const isEnd = phraseEnd || i === tokens.length - 1;
      if (tok.strong) bump(strong, tok.key, tok.text, glyphs(tok.key), isEnd);
    });
    for (let i = 0; i + 1 < tokens.length; i++) {
      const a = tokens[i]!.tok;
      const b = tokens[i + 1]!.tok;
      // 跨句中停顿（如「等一束光　穿过很长的夜」中间的全角空格）不拼成短语
      if (tokens[i]!.phraseEnd) continue;
      const latin = isLatinWord(a.text) && isLatinWord(b.text);
      const len = latin ? latinLetters(a.key + b.key) : glyphs(a.key + b.key);
      if (latin ? len < 4 : len < 2 || len > 4) continue;
      if (a.key === b.key) continue;
      if (VOCABLES.has(a.key) && VOCABLES.has(b.key)) continue;
      if (!a.strong && !b.strong) {
        if (!latin) continue;
        // 两个普通虚词（in the / to the）无信息量；带缩写的短语（I'll be / don't stop）允许入选
        if (STOP.has(a.key) && STOP.has(b.key) && !a.key.includes("'") && !b.key.includes("'")) continue;
      }
      const key = `${a.key} ${b.key}`;
      const text = latin ? `${a.text} ${b.text}` : `${a.text}${b.text}`;
      const isEnd = tokens[i + 1]!.phraseEnd || i + 1 === tokens.length - 1;
      bump(phrases, key, text, len, isEnd);
    }
  };
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter;
  if (cjk && Seg) {
    const seg = new Seg(undefined, { granularity: 'word' });
    for (const us of units) {
      const rawSegs = [...seg.segment(us.join(''))];
      const lineToks: Array<{ tok: HookTok; phraseEnd: boolean }> = [];
      rawSegs.forEach((w, i) => {
        if (w.isWordLike === false) return;
        const tok = classifyWord(w.segment);
        if (!tok) return;
        const next = rawSegs[i + 1];
        const phraseEnd = !next || (next.isWordLike === false && /[\s,，、;；!！?？。]/.test(next.segment));
        lineToks.push({ tok, phraseEnd });
      });
      addLine(lineToks);
    }
  } else {
    for (const us of units) {
      const rawList = cjk ? [...us.join('')] : us;
      const lineToks: Array<{ tok: HookTok; phraseEnd: boolean }> = [];
      rawList.forEach((raw) => {
        if (!raw.trim()) {
          if (lineToks.length) lineToks[lineToks.length - 1]!.phraseEnd = true;
          return;
        }
        const tok = classifyWord(raw);
        if (!tok) return;
        const phraseEnd = /[,，、;；!！?？。]$/.test(raw);
        lineToks.push({ tok, phraseEnd });
      });
      addLine(lineToks);
    }
  }
  // 歌名优先（2026-11-25 真实数据审查，用户确认）：旧规则在 840 首真实歌里常挑出「却 / 每 / 会 / know / never」这类
  // 没有画面感的词。歌名里的词（Sunflower、Psycho、旅行的意义）才是这首歌真正的钩子：副歌里唱到两次以上就用它。
  const fromTitle = titleHook(title, units, cjk);
  if (fromTitle) return fromTitle;
  // 中文单字只认歌名里出现的字：单字钩子大多是虚字、动词（会 / 里 / 去 / 没 / 却），放到 660px 撑不起版面
  const inTitle = (k: string) => !!title && norm(title).includes(k);
  for (const [k, c] of strong) if (c.len === 1 && !/[a-zA-Z]/.test(k) && !inTitle(k)) strong.delete(k);
  return (
    pickBest(strong, (c) => (/[a-zA-Z]/.test(c.key) ? 3 : c.len >= 2 ? 3 : 4)) ??
    pickBest(phrases, () => 3)
  );
}

/** 歌名的主体：去掉括号里的版本说明（Jazz Version / feat. / Live）和「 - 」之后的副标题。 */
function titleCore(title: string): string {
  return title
    .replace(/\s*[(（[【][^)）\]】]*[)）\]】]\s*/g, ' ')
    .replace(/\s+[-–—]\s+.*$/, '')
    .trim();
}

/**
 * 歌名里在副歌中唱到至少两次的词（按歌名自己的文字判断，不按歌词语种：中文歌也常有英文歌名）：
 *   - 拉丁：整个歌名（≤ 2 个词）或其中唱得最多的实词（≥ 3 个字母、不是虚词），按整词计数；
 *   - 中日韩：整个歌名（2–4 个字），否则用分词切出歌名里的词（2–4 个字、不是虚词），取副歌里出现最多的。
 *     不按两字硬切：「所以你睡了没」会切出跨词的「以你」。
 * 返回显示用的词面；没有则 null。
 */
function titleHook(title: string | undefined, units: string[][], cjk: boolean): string | null {
  if (!title) return null;
  const core = titleCore(title);
  if (!core) return null;
  const all = units.map((us) => (cjk ? us.join('') : us.join(' '))).join('\n');
  if (!/[぀-ヿ가-힯㐀-鿿]/.test(core)) {
    const words = core.split(/\s+/).map((w) => cleanSurface(w, true)).filter(Boolean);
    const hay = ` ${all.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ')} `;
    const count = (s: string) => hay.split(` ${s} `).length - 1;
    if (words.length === 2 && words.every((w) => latinLetters(w) >= 2) && count(words.join(' ')) >= 2) return words.join(' ');
    const cands = words.filter((w) => latinLetters(w) >= 3 && !STOP.has(norm(w)) && count(w) >= 2).sort((a, b) => count(b) - count(a) || b.length - a.length);
    return cands[0] ?? null;
  }
  const flat = norm(all);
  const count = (s: string) => (s ? flat.split(s).length - 1 : 0);
  const t = norm(core);
  const n = [...t].length;
  if (n >= 2 && n <= 4 && count(t) >= 2) return cleanSurface(core, false);
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter;
  if (!Seg) return null;
  let best: string | null = null;
  let bestN = 1;
  for (const w of new Seg('zh', { granularity: 'word' }).segment(core)) {
    if (w.isWordLike === false) continue;
    const k = norm(w.segment);
    const len = [...k].length;
    if (len < 2 || len > 4 || STOP_CJK_PAIR.has(k) || [...k].some((ch) => STOP_CJK.has(ch))) continue;
    const m = count(k);
    if (m > bestN) {
      bestN = m;
      best = cleanSurface(w.segment, false);
    }
  }
  return best;
}
