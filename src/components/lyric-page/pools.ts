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
 * 版式轮换（样张 P，2026-11-26 用户定稿「方案三·加强＋轮休」，规格 NEBULA_UI_SYSTEM §7.1b「轮换与切分」）：
 * 整首统筹——建页时先知道每页能放哪几套大胆版式（fits），再按能量曲线从最重要的段落往前分配：
 *   最后一次副歌（镂空 / 色场 + 高能 ×2 + 中能）→ 桥段 → 中间几次副歌（高能 + 中能）→ 第一次副歌（中能，有成段重复时滚筒 / 套印）
 *   → 尾声 → 预副歌 → 主歌；同一格里内容契合的先用（成段重复 → 滚筒 / 套印，末字长音 → 镂空，3–4 句 → 断层），其次越冷门越先用。
 * 约束：任意两套高能不相邻；每段最多一套高能（最后一次副歌三套）；除中间 / 最后一次副歌外同段两页大胆不相邻；
 * 每套一首一次，例外是长歌：14 套用完后静 / 中能可再用一次（离上次 ≥ 8 页、不同段）。
 * 连续经典超过 2 页时在中间插一套静 / 中能；每首按歌轮休一套中能（一词放大 / 转角 / 斜线 / 书脊）。
 * 识别不出副歌的歌按时间位置当作主歌 → 第一次 → 中间 → 最后一次副歌来起伏。所有语言共用这一套，横竖排由页面方向决定。
 */

const BOLD: Record<string, Tpl> = { held, spine, justify, foot, bleed, diag, field, groove, grid, corner, fault, drum, register, cut };

/** 后面几批版式在各自的模块里登记进来。 */
export function registerBold(...ts: Tpl[]): void {
  for (const t of ts) BOLD[t.id] = t;
}

/** 这一页在整首能量曲线里的角色。 */
export type PageRole = 'verse0' | 'verseN' | 'pre' | 'chorusFirst' | 'chorusMid' | 'chorusLast' | 'bridge' | 'outro';

/** 三档能量：高能（下面这些）、中能（MID）、静（稿纸 / 脚注 / 唱片纹）。 */
export const HIGH = new Set(['justify', 'drum', 'fault', 'register', 'cut', 'field', 'bleed']);
const MID = ['held', 'corner', 'diag', 'spine'];
const HI = ['register', 'drum', 'fault', 'bleed', 'justify'];
/** 分配顺序：[角色, 候选]，每个角色的每一段各分一格。 */
const SLOTS: Array<[PageRole, string[]]> = [
  ['chorusLast', ['cut', 'field']],
  ['chorusLast', HI],
  ['chorusLast', ['drum', 'register', 'fault', 'bleed', 'justify']],
  ['bridge', ['fault', 'diag']],
  ['chorusMid', HI],
  ['chorusFirst', ['drum', 'register', 'corner', 'justify', 'diag']],
  ['chorusMid', ['corner', 'diag', 'held']],
  ['outro', ['drum', 'register', 'groove', 'cut']],
  ['chorusLast', ['corner', 'diag', 'held']],
  ['pre', ['drum', 'register', 'spine', 'diag']],
  ['verse0', ['held', 'grid', 'foot']],
  ['verseN', ['grid', 'foot', 'held', 'spine', 'groove']],
  ['verse0', ['spine', 'diag', 'groove']],
  ['bridge', ['groove', 'spine']],
];
/** 防平用的静 / 中能。 */
const FILL = ['held', 'grid', 'foot', 'spine', 'diag', 'corner', 'groove'];
/** 内容契合：这页放得下就先用。 */
const AFFINITY = new Set(['drum', 'register', 'cut', 'fault']);
/** 同段两页大胆不相邻的角色（中间 / 最后一次副歌允许挨着，只要不是两套高能）。 */
const ALT = new Set<PageRole>(['chorusFirst', 'verse0', 'verseN', 'pre', 'outro', 'bridge']);
const HIGH_PER_SEC = 1;
const HIGH_PER_LAST = 3;
const MAX_CLASSIC_RUN = 2;
const REUSE_GAP = 8;

/** 同一首歌每次一样的散列（候选轮转、轮休用）。 */
export function songHash(song: readonly { text: string }[]): number {
  let h = 0;
  for (const l of song) for (const ch of l.text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export interface PlanPage {
  c: TCtx;
  role: PageRole;
  /** 所在段落下标。 */
  sec: number;
}

/** 开发 / QA 用：localStorage['nebula.pageTpl'] = 版式 id，能用的页一律用它。 */
function forced(): string | null {
  try {
    return localStorage.getItem('nebula.pageTpl');
  } catch {
    return null;
  }
}

/** 给整首歌的每一页定版式。 */
export function planTpls(P: PlanPage[], h: number): Tpl[] {
  const fit = P.map((p) => new Set(Object.keys(BOLD).filter((id) => { const t = BOLD[id]!; return !t.fits || t.fits(p.c); })));
  const out: Array<string | null> = P.map(() => null);
  const used = new Set<string>();
  // 轮休：这首歌歇掉一套中能
  used.add(MID[(h >>> 9) % MID.length]!);
  const highIn = new Map<number, number>();
  const isHigh = (i: number) => i >= 0 && i < P.length && !!out[i] && HIGH.has(out[i]!);
  const isBold = (i: number) => i >= 0 && i < P.length && !!out[i];
  const okAt = (i: number, id: string) => {
    if (out[i] || used.has(id) || !fit[i]!.has(id)) return false;
    const p = P[i]!;
    if (HIGH.has(id)) {
      if (isHigh(i - 1) || isHigh(i + 1)) return false;
      if ((highIn.get(p.sec) ?? 0) >= (p.role === 'chorusLast' ? HIGH_PER_LAST : HIGH_PER_SEC)) return false;
    }
    if (ALT.has(p.role) && ((isBold(i - 1) && P[i - 1]!.sec === p.sec) || (isBold(i + 1) && P[i + 1]!.sec === p.sec))) return false;
    return true;
  };
  const put = (i: number, id: string) => {
    out[i] = id;
    used.add(id);
    if (HIGH.has(id)) highIn.set(P[i]!.sec, (highIn.get(P[i]!.sec) ?? 0) + 1);
  };
  /** 这套在还没定的页里能放几页（越少越冷门，越先用）。 */
  const left = (id: string) => P.reduce((m, _, i) => m + (!out[i] && fit[i]!.has(id) ? 1 : 0), 0);
  const order = (ids: string[], salt: number) => {
    const r = ids.length ? ((h >>> (salt % 13)) + salt) % ids.length : 0;
    const rot = [...ids.slice(r), ...ids.slice(0, r)];
    return rot
      .map((id, k) => ({ id, k, n: left(id) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => (AFFINITY.has(b.id) ? 1 : 0) - (AFFINITY.has(a.id) ? 1 : 0) || a.n - b.n || a.k - b.k)
      .map((x) => x.id);
  };
  const secs = new Map<number, number[]>();
  P.forEach((p, i) => secs.set(p.sec, [...(secs.get(p.sec) ?? []), i]));
  SLOTS.forEach(([role, cands], si) => {
    for (const [sec, idx] of secs) {
      if (P[idx[0]!]!.role !== role) continue;
      // 最后一次副歌的第一格不轮转：末字长音先给负形镂空，否则色场
      const ids = role === 'chorusLast' && si === 0 ? cands.filter((id) => left(id) > 0) : order(cands, si * 5 + sec);
      let done = false;
      for (const id of ids) {
        for (const i of idx) {
          if (okAt(i, id)) {
            put(i, id);
            done = true;
            break;
          }
        }
        if (done) break;
      }
    }
  });
  // 防平：连续经典超过 MAX_CLASSIC_RUN 页，在这一串中间插一套静 / 中能（按歌轮转，不按稀有度，免得几套首首都有）
  for (let guard = 0; guard < 20; guard++) {
    let changed = false;
    let a = 0;
    while (a < P.length) {
      if (out[a]) {
        a++;
        continue;
      }
      let b = a;
      while (b + 1 < P.length && !out[b + 1]) b++;
      if (b - a + 1 > MAX_CLASSIC_RUN) {
        const mid = (a + b) >> 1;
        let hit = false;
        for (const i of [mid, mid + 1, mid - 1, mid + 2, mid - 2].filter((x) => x >= a && x <= b)) {
          const r = ((h >>> 5) + i) % FILL.length;
          const id = [...FILL.slice(r), ...FILL.slice(0, r)].find((x) => okAt(i, x));
          if (id) {
            put(i, id);
            hit = true;
            changed = true;
            break;
          }
        }
        if (!hit) a = b + 1;
      } else a = b + 1;
    }
    if (!changed) break;
  }
  // 长歌：仍连续经典的地方，静 / 中能可以再用一次（离上次 ≥ REUSE_GAP 页、不同段、两边不是大胆页）
  const lastAt = new Map<string, number>();
  out.forEach((id, i) => id && lastAt.set(id, i));
  let run = 0;
  for (let i = 0; i < P.length; i++) {
    if (out[i]) {
      run = 0;
      continue;
    }
    run++;
    if (run <= MAX_CLASSIC_RUN) continue;
    const cand = FILL.filter((id) => fit[i]!.has(id) && lastAt.has(id) && i - lastAt.get(id)! >= REUSE_GAP && P[lastAt.get(id)!]!.sec !== P[i]!.sec && !isBold(i - 1) && !isBold(i + 1));
    const r = cand.length ? cand[((h >>> 3) + i) % cand.length]! : null;
    if (r) {
      out[i] = r;
      lastAt.set(r, i);
      run = 0;
    }
  }
  // 其余页：经典版式按段落轮换，相邻两页不重复
  const f = forced();
  const cidx: Partial<Record<SectionKind, number>> = {};
  let prev = '';
  return P.map((p, i) => {
    let t: Tpl;
    if (f && BOLD[f] && fit[i]!.has(f)) t = BOLD[f]!;
    else if (out[i]) t = BOLD[out[i]!]!;
    else {
      const pool = (p.c.vert ? CLASSIC_V : CLASSIC_H)[p.c.kind];
      let j = cidx[p.c.kind] ?? 0;
      t = pool[j % pool.length]!;
      j++;
      if (t.id === prev && pool.length > 1) t = pool[j++ % pool.length]!;
      cidx[p.c.kind] = j;
    }
    prev = t.id;
    return t;
  });
}

/** 每页的角色：主歌第一段 / 之后，副歌第一次 / 中间 / 最后一次；识别不出副歌的歌按时间位置起伏。 */
export function pageRoles(pages: Array<{ kind: SectionKind; sec: number; occ: number; of: number; s: number }>, confident: boolean, end: number): PageRole[] {
  let verseSeen = -1;
  let verseSecs = 0;
  return pages.map((p) => {
    if (!confident) {
      const f = p.s / Math.max(1, end);
      return f < 0.3 ? 'verse0' : f < 0.55 ? 'chorusFirst' : f < 0.8 ? 'chorusMid' : 'chorusLast';
    }
    if (p.kind === 'verse') {
      if (p.sec !== verseSeen) {
        verseSeen = p.sec;
        verseSecs++;
      }
      return verseSecs <= 1 ? 'verse0' : 'verseN';
    }
    if (p.kind === 'chorus') return p.occ === p.of - 1 ? 'chorusLast' : p.occ === 0 ? 'chorusFirst' : 'chorusMid';
    return p.kind;
  });
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
