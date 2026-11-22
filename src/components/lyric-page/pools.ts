import type { SectionKind } from '../../lib/listen/sections';
import { foot, held, justify, spine } from './bold-a';
import { CLASSIC_FALLBACK_H, CLASSIC_H, CLASSIC_V } from './classic';
import { glyphs, norm } from './kit';
import type { TCtx, Tpl } from './types';

/**
 * 版式轮换（样张 N「一首歌翻下来」）：稳和险交替。每种段落一张计划表，'c' = 轮到经典版式；
 * 同一段落第几次出现就从计划表第几格开始找第一套能用的（fits），大胆版式一首歌里最多出现一次，相邻两页不重复。
 * 色场只给全曲最后一个副歌页。所有语言共用这一套轮换，横排还是竖排由页面方向决定（中文竖排、其余横排）。
 */

const BOLD: Record<string, Tpl> = { held, spine, justify, foot };

/** 后面几批版式在各自的模块里登记进来。 */
export function registerBold(...ts: Tpl[]): void {
  for (const t of ts) BOLD[t.id] = t;
}

const PLAN: Record<SectionKind, string[]> = {
  verse: ['held', 'c', 'foot', 'grid', 'c', 'c'],
  pre: ['spine', 'c', 'c'],
  chorus: ['justify', 'bleed', 'corner', 'c', 'c'],
  bridge: ['diag', 'c'],
  outro: ['groove', 'c'],
};

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
  if (c.lastChorus && BOLD.field && !st.used.has('field') && (!BOLD.field.fits || BOLD.field.fits(c))) return done(BOLD.field);
  const plan = PLAN[kind];
  for (let j = 0; j < plan.length; j++) {
    const id = plan[(nth + j) % plan.length]!;
    if (id === 'c') return classic();
    const t = BOLD[id];
    if (!t || st.used.has(id) || id === st.prev) continue;
    if (t.fits && !t.fits(c)) continue;
    return done(t);
  }
  return classic();
}

/** 强制横排的大胆版式（唱片纹）在中文歌里退回时用的经典版式。 */
export const FALLBACK_H = CLASSIC_FALLBACK_H;

const STOP = new Set(
  'the and you your for but not are was were with that this from have has had all can its our out who what when where why how she her him his they them then than there their just like into over only been will would could should about yeah ooh ohh woah baby gonna wanna'.split(' '),
);
const STOP_CJK = new Set([...'的了我你是在不有就都也和他她它们这那个一着吗呢吧啊哦呀']);

/**
 * 这首歌的「钩子词」（出血大字用）：副歌里重复最多的实词。拉丁：至少 3 个字母、不是虚词、出现 3 次以上；
 * 中日韩：连续两个字出现 3 次以上的优先，否则单字出现 4 次以上（去掉虚字）。没有就是 null。
 */
export function songHook(units: string[][], cjk: boolean): string | null {
  const count = new Map<string, number>();
  const add = (k: string, n = 1) => count.set(k, (count.get(k) ?? 0) + n);
  for (const us of units) {
    const ts = us.map(norm).filter(Boolean);
    if (!cjk) {
      for (const t of ts) if (glyphs(t) >= 3 && !STOP.has(t)) add(t);
      continue;
    }
    for (let i = 0; i < ts.length; i++) {
      if (glyphs(ts[i]!) === 1 && !STOP_CJK.has(ts[i]!)) add(ts[i]!);
      if (i + 1 < ts.length && glyphs(ts[i]! + ts[i + 1]!) === 2) add(ts[i]! + ts[i + 1]!, 1);
    }
  }
  let best: string | null = null;
  let score = 0;
  for (const [k, n] of count) {
    const two = cjk && glyphs(k) === 2;
    const need = !cjk ? 3 : two ? 3 : 4;
    if (n < need) continue;
    const s = n + (two ? 0.5 : 0) + glyphs(k) * 0.01;
    if (s > score) {
      score = s;
      best = k;
    }
  }
  return best;
}
