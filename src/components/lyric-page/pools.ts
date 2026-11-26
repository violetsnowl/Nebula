import type { SectionKind } from '../../lib/listen/sections';
import { foot, held, justify, spine } from './bold-a';
import { bleed, diag, field } from './bold-b';
import { corner, groove, grid } from './bold-c';
import { drum, fault } from './bold-d';
import { cut, register } from './bold-e';
import { CLASSIC_FALLBACK_H, CLASSIC_H, CLASSIC_V } from './classic';
import { glyphs, norm } from './kit';
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

/** 常见虚词 / 代词 / 助动词 / 缩写 / 语气词（拉丁）：不单独当出血大字的钩子词。 */
const STOP = new Set(
  (
    'the and you your yours for but not are was were with that this these those from have has had all can its our ours out ' +
    'who whom whose what when where why how which she her hers him his they them their theirs then than there here ' +
    'just like into over under only been will would could should shall might must about ' +
    'i me my mine we us he it a an or if so as at by in on of to up down off again once any both each few more most other some such no nor own same very ' +
    "i'm i'll i've i'd you're you'll you've you'd we're we'll we've they're they'll they've he's she's it's that's what's who's there's here's " +
    "don't can't won't didn't doesn't isn't aren't wasn't weren't haven't hasn't hadn't couldn't shouldn't wouldn't " +
    'yeah yep nah ooh ohh ooo woah whoa baby gonna wanna gotta lemme gimme ayy ah ay hey mm mmm uh hmm la na da'
  ).split(/\s+/),
);
const VOCABLES = new Set('yeah yep nah ooh ohh ooo woah whoa ayy ah ay hey mm mmm uh hmm la na da oh'.split(/\s+/));
const STOP_CJK = new Set([...'的了我你他她它们是在不有就都也这那个一着过吗呢吧啊哦呀和与而之以为于把被让给对从向到得地又还啦嘛哟喔咯哎唉嘿哈嗯呃']);
const PARTICLE_CJK = new Set([...'的了着过吗呢吧啊哦呀啦嘛哟喔咯哎唉嘿哈嗯呃']);
const STOP_CJK_PAIR = new Set(
  '我们 你们 他们 她们 它们 自己 什么 怎么 那么 这么 哪里 那里 这里 没有 不是 不要 不会 不能 可以 应该 因为 所以 如果 只是 还是 就是 已经 一直 一起 一样 一个 一下 一点 那些 这些 可是 但是 或者 而且 虽然 然后 于是 终于'.split(
    /\s+/,
  ),
);
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
export function songHook(units: string[][], cjk: boolean): string | null {
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
  return (
    pickBest(strong, (c) => (/[a-zA-Z]/.test(c.key) ? 3 : c.len >= 2 ? 3 : 4)) ??
    pickBest(phrases, () => 3)
  );
}
