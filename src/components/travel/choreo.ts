import type { EngineLine } from '../../lib/listen/model';
import type { SongShape } from '../../lib/listen/sections';
import { estEm, normText } from './pathText';

/**
 * 编舞规划器（TRAVEL_HANDOFF §9.4 / §9.5）：给每句分一个招式，同一首歌每次一样。
 *
 * 招式：
 *   - 大招：穿针 needle（路从近处两张封面之间、从一张背后穿出）、环 ring（短句绕成环套在主角封面上）、
 *     卷起 swirl（进这句之前路打一个大螺旋，沿途封面被卷着转）；
 *   - 中招：立起 stand（句子先平躺在路面上，唱到哪个词哪个词立起来）、星座 constellation（按停顿拆成 2–3 截挂在封面边上）。
 * 其余句子只走「路」（句形见 pathText）。
 *
 * 规则（§9.5）：
 *   - 副歌入口不能只信段落识别（真实数据里会漏），同时看「重复句第一次成块出现」的位置；
 *   - 第一次副歌入口穿针，桥段后回到副歌的入口也穿针；最后一次副歌入口卷起（全曲最高能），其余副歌入口环 / 卷起交替；
 *   - 重复的短钩子句（拉丁 ≤ 28 字符 / 中日韩 ≤ 9 字，或句末长音的短句）用环；同一句每次出现用同一个招式、左右镜像交替，
 *     同一段里第 4 次以上退回普通的路；
 *   - 预算：任意连续 4 句最多 1 个大招、相邻两句不能都是大招、全曲最多 6 个；中招不超过全部句子的一半；
 *   - 短于 1.2 秒的句子不承担任何招式。
 */

export type Move = 'none' | 'needle' | 'ring' | 'swirl' | 'stand' | 'constellation';
export const BIG: ReadonlySet<Move> = new Set<Move>(['needle', 'ring', 'swirl']);

export interface LineMove {
  move: Move;
  /** 左右镜像：+1 / −1（同一招式在一首歌里轮流） */
  side: 1 | -1;
  /** 幅度 0–1：越往后的副歌越大 */
  amp: number;
  /** 星座：拆成几截的切点（单位下标，第二截、第三截的第一个单位） */
  cuts?: number[];
}

/** 能承担招式的最短时长（秒） */
const MIN_DUR = 1.2;
/** 任意连续这么多句里最多一个大招 */
const BIG_SPAN = 4;

const isCjk = (t: string) => /[⺀-鿿가-힯぀-ヿ]/.test(t);

/** 环要的短句：拉丁 ≤ 28 字符、中日韩 ≤ 9 字 */
function ringable(e: EngineLine): boolean {
  const t = e.text.trim();
  if (isCjk(t)) return [...t.replace(/\s/g, '')].length <= 9;
  return t.length <= 28;
}

/** 句末长音（秒） */
function tailHold(e: EngineLine): number {
  const u = e.units?.[e.units.length - 1];
  return u ? u.e - u.s : 0;
}

/**
 * 星座的切点：按单位之间的停顿 / 标点 / 空格挑 1–2 个切点，每截最短 2 个中日韩字或 1 个拉丁词，且至少占全句 22%。
 * 拆不开返回 null（回到普通的路）。
 */
export function constellationCuts(e: EngineLine): number[] | null {
  const us = e.units;
  if (!us || us.length < 2) return null;
  const n = us.length;
  const lens = us.map((u) => Math.max(1, [...u.t].length));
  const total = lens.reduce((a, b) => a + b, 0);
  const cjk = isCjk(e.text);
  if (cjk ? total < 4 : n < 2) return null;
  // 每个可切位置（第 k 个单位之前）的分数：停顿长、有标点、有空格
  const score: number[] = new Array(n).fill(-Infinity);
  let acc = 0;
  for (let k = 1; k < n; k++) {
    acc += lens[k - 1]!;
    const a = us[k - 1]!;
    const b = us[k]!;
    if (!cjk && !a.sp) continue;
    const pause = Math.max(0, b.s - a.e);
    const punct = /[,，、。.!?！？;；:：…]$/.test(a.t) ? 0.4 : 0;
    const space = a.sp ? 0.15 : 0;
    score[k] = Math.min(0.8, pause) * 1.5 + punct + space - Math.abs(acc / total - 0.5) * 0.3;
  }
  const okPiece = (from: number, to: number) => {
    let len = 0;
    for (let k = from; k < to; k++) len += lens[k]!;
    return (cjk ? len >= 2 : to - from >= 1) && len / total >= 0.22;
  };
  // 先找最好的一个切点，再看能不能再切一刀（长句三截）
  let best = -1;
  for (let k = 1; k < n; k++) if (score[k]! > -Infinity && okPiece(0, k) && okPiece(k, n) && (best < 0 || score[k]! > score[best]!)) best = k;
  if (best < 0) return null;
  const cuts = [best];
  if (total >= (cjk ? 10 : 24)) {
    let b2 = -1;
    for (let k = 1; k < n; k++) {
      if (k === best || score[k]! === -Infinity || score[k]! < 0.3) continue;
      const c = [best, k].sort((x, y) => x - y);
      if (!okPiece(0, c[0]!) || !okPiece(c[0]!, c[1]!) || !okPiece(c[1]!, n)) continue;
      if (b2 < 0 || score[k]! > score[b2]!) b2 = k;
    }
    if (b2 > 0) cuts.push(b2);
  }
  return cuts.sort((a, b) => a - b);
}

export interface ChoreoStats {
  /** 副歌入口（句下标） */
  entries: number[];
  hooks: number;
}

export function planChoreo(els: EngineLine[], shape: SongShape | null): { moves: LineMove[]; stats: ChoreoStats } {
  const n = els.length;
  const moves: LineMove[] = els.map(() => ({ move: 'none', side: 1, amp: 0.5 }));
  const dur = els.map((e) => e.e - e.s);
  const keys = els.map((e) => normText(e.text));
  const count = new Map<string, number>();
  for (const k of keys) if (k) count.set(k, (count.get(k) ?? 0) + 1);
  const hook = keys.map((k) => !!k && (count.get(k) ?? 0) >= 2);
  const secOf = (i: number) => (shape ? shape.sections[shape.lineSection[i] ?? -1] : undefined);

  // —— 副歌入口：段落识别的副歌开头 + 重复句第一次出现的位置（段落识别会漏） ——
  const entrySet = new Set<number>();
  const confident = !!shape?.confident;
  if (shape) for (const s of shape.sections) if (s.kind === 'chorus') entrySet.add(s.from);
  {
    const stanzaStart = new Set<number>(shape ? [...shape.stanzas.map((z) => z.from), ...shape.sections.map((z) => z.from)] : []);
    const first = new Map<string, number>();
    keys.forEach((k, i) => {
      if (k && !first.has(k)) first.set(k, i);
    });
    for (let i = 0; i < n; i++) {
      if (!hook[i] || first.get(keys[i]!) !== i) continue;
      const later = keys.findIndex((k, j) => j > i && k === keys[i]);
      const laterChorus = later > 0 && secOf(later)?.kind === 'chorus';
      // 《再见》：第一次副歌「不要对我说再见」被算进主歌，但同一句后来出现在副歌里 → 它第一次出现的地方就是入口
      if (laterChorus && (stanzaStart.has(i) || !shape)) entrySet.add(i);
      // 段落识别没把握时，一块重复句（连着两句都会再出现）的第一句也算入口；有把握时预副歌 / 主歌里的重复块不算（否则卷起太多）
      else if (!confident && hook[i + 1] && !hook[i - 1]) entrySet.add(i);
    }
  }
  // 歌一开头（前两句）不算入口：那是前奏后的第一句，留给星座；离得太近的入口只留前一个（同一次副歌被两种办法各认一次）
  const entries: number[] = [];
  for (const i of [...entrySet].sort((a, b) => a - b)) if (i >= 2 && (!entries.length || i - entries[entries.length - 1]! >= 4)) entries.push(i);

  let bigs = 0;
  const cap = Math.min(6, Math.max(2, Math.floor(n / 8)));
  const isBig = (i: number) => i >= 0 && i < n && BIG.has(moves[i]!.move);
  // 第 0 句是前奏后的第一句，留给星座
  const bigOk = (i: number) => {
    if (i <= 0 || dur[i]! < MIN_DUR || moves[i]!.move !== 'none' || bigs >= cap) return false;
    for (let j = i - BIG_SPAN + 1; j <= i + BIG_SPAN - 1; j++) if (j !== i && isBig(j)) return false;
    return true;
  };
  const sideOf = new Map<Move, number>();
  const put = (i: number, m: Move, amp: number) => {
    const c = sideOf.get(m) ?? 0;
    sideOf.set(m, c + 1);
    moves[i] = { move: m, side: c % 2 ? -1 : 1, amp };
    if (BIG.has(m)) bigs++;
  };

  // —— 大招 1：副歌入口 ——
  const lastEntry = entries[entries.length - 1];
  let alt = 0;
  let needles = 0;
  let swirls = 0;
  for (let k = 0; k < entries.length; k++) {
    const i = entries[k]!;
    // 上一个入口到这个入口之间有桥段：桥段后回到副歌
    const from = k > 0 ? entries[k - 1]! : 0;
    // （只有一句的「桥段」多半是段落识别把过门句认错了，不算）
    let afterBridge = false;
    for (let j = from; j < i; j++) {
      const sec = secOf(j);
      if (sec?.kind === 'bridge' && sec.to > sec.from) afterBridge = true;
    }
    const amp = Math.min(1, 0.45 + 0.18 * k);
    let m: Move;
    // 穿针最费、最显眼：一首最多两次（第一次副歌、桥段后第一次回到副歌）
    if ((k === 0 || afterBridge) && needles < 2) {
      m = 'needle';
      needles++;
    } else if (i === lastEntry && entries.length >= 3) m = 'swirl';
    else m = alt++ % 2 === 0 ? 'swirl' : ringable(els[i]!) ? 'ring' : 'swirl';
    // 卷起一首最多 3 次（最后一次副歌入口优先），多了换成环（短句）或普通的路
    if (m === 'swirl' && swirls >= (i === lastEntry ? 3 : 2)) {
      if (!ringable(els[i]!)) continue;
      m = 'ring';
    }
    if (m === 'swirl') swirls++;
    if (bigOk(i)) put(i, m, amp);
    else if (bigOk(i + 1)) put(i + 1, m, amp);
  }

  // —— 大招 2：重复的短钩子句、句末长音的短句 → 环（同一句同一个招式） ——
  const ringKeys = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (!hook[i] || !ringable(els[i]!) || ringKeys.has(keys[i]!)) continue;
    if (bigOk(i)) {
      put(i, 'ring', 0.5);
      ringKeys.set(keys[i]!, 1);
    }
  }
  // 后面再出现的同一句：同一个招式；同一段里第 4 次以上退回普通的路
  {
    const perSec = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const k = keys[i]!;
      if (!ringKeys.has(k) || moves[i]!.move !== 'none') continue;
      const sk = `${shape?.lineSection[i] ?? -1}:${k}`;
      const c = (perSec.get(sk) ?? 0) + 1;
      perSec.set(sk, c);
      if (c >= 4) continue;
      const occ = ringKeys.get(k)!;
      if (bigOk(i)) {
        put(i, 'ring', Math.min(1, 0.5 + 0.15 * occ));
        ringKeys.set(k, occ + 1);
      }
    }
  }
  // 句末长音的短句：拖得最长的先拿名额
  const tails = els
    .map((e, i) => ({ i, h: tailHold(e) }))
    .filter((x) => x.h >= 1.4 && ringable(els[x.i]!))
    .sort((a, b) => b.h - a.h);
  for (const { i } of tails) {
    if (bigs >= cap) break;
    if (bigOk(i)) put(i, 'ring', 0.5);
  }

  // —— 中招 1：星座——前奏后第一句、间奏后第一句、安静的桥段句、尾声最后一句、很长的句子 ——
  const mid = () => moves.filter((m) => m.move === 'stand' || m.move === 'constellation').length;
  const midCap = Math.floor(n / 2);
  // 星座要空间、节奏慢，一首最多约 12% 的句子（至少 3 个）
  const starCap = Math.max(3, Math.round(n * 0.12));
  let stars = 0;
  const tryStar = (i: number) => {
    if (i < 0 || i >= n || moves[i]!.move !== 'none' || dur[i]! < MIN_DUR || mid() >= midCap || stars >= starCap) return;
    // 相邻两句不连着星座（星座要空间，连着就挤）
    if (moves[i - 1]?.move === 'constellation' || moves[i + 1]?.move === 'constellation') return;
    const cuts = constellationCuts(els[i]!);
    if (!cuts) return;
    put(i, 'constellation', 0.5);
    moves[i]!.cuts = cuts;
    stars++;
  };
  tryStar(0);
  if (shape) {
    for (const g of shape.gaps) {
      if (g.kind === 'interlude') tryStar(els.findIndex((e) => e.s >= g.e - 0.05));
    }
    for (const s of shape.sections) {
      if (s.kind !== 'bridge') continue;
      // 桥段：每隔一句一个星座
      for (let i = s.from; i <= s.to; i += 2) tryStar(i);
    }
  }
  tryStar(n - 1);
  for (let i = 0; i < n; i++) if (dur[i]! >= 7) tryStar(i);

  // —— 中招 2：立起——真正唱得快的主歌 / 预副歌句（每秒 ≥ 3.8 个字 / 词，短的中文抒情句按时长算 dens 也高，不能只看 dens），
  //    至少隔两句一个（连着立起累） ——
  for (let i = 0; i < n; i++) {
    const e = els[i]!;
    const sec = secOf(i);
    if (sec && sec.kind !== 'verse' && sec.kind !== 'pre') continue;
    if (e.dens < 0.5 || dur[i]! < MIN_DUR || !e.units || e.units.length < 4 || hook[i]) continue;
    if (e.units.length / dur[i]! < 3.8) continue;
    if (moves[i]!.move !== 'none' || moves[i - 1]?.move === 'stand' || moves[i - 2]?.move === 'stand' || mid() >= midCap) continue;
    if (estEm(e.text) < 4) continue;
    put(i, 'stand', 0.5);
  }

  return { moves, stats: { entries, hooks: hook.filter(Boolean).length } };
}
