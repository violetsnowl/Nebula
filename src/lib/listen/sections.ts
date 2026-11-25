/**
 * 歌曲段落引擎（2026-11-22，fe/next）：只用歌词文字和时间推断一首歌的结构，给主舞台的歌词模式共用：
 *   - 段落开合：主歌收着、副歌「打开」，最后一次副歌开到最大（lift 0–1）；
 *   - 间奏让位：前奏 / 间奏 / 尾奏（空档 ≥ GAP_MIN）里歌词让出，星云回来（gap 0–1）；
 *   - 句组：同一段里按时间空档切成「一口气唱完的几句」，运动方向、版面分页以句组为单位。
 *
 * 做法：
 *   1. 每句正文归一化（NFKC、小写、只留字母和数字），完全相同、或较长的句子二元组相似度 ≥ .8，算同一类；
 *   2. 找「连续两句以上、整段重复出现」的片段（类序列上的重复子串，两段不重叠）；
 *   3. 重复片段按句子对应关系连成组，句子最多的那组是副歌；组里只出现在部分副歌前面的句子算预副歌；
 *   4. 没被重复覆盖的句子：第一次副歌前 = 主歌，第二次副歌之后、下一次副歌之前 = 桥段，最后一次副歌之后 = 尾声。
 * 不分析音频。识别不出副歌（没有成段重复）时 confident = false，全部按主歌处理、只按句组和间奏起伏。
 */

/** 引擎需要的最少信息：开始 / 结束（秒）和正文。EngineLine 直接满足。 */
export interface ShapeLine {
  s: number;
  e: number;
  text: string;
}

export type SectionKind = 'verse' | 'pre' | 'chorus' | 'bridge' | 'outro';

export interface LyricSection {
  kind: SectionKind;
  /** 句子下标，含两端。 */
  from: number;
  to: number;
  /** 开始 / 结束（秒）。 */
  s: number;
  e: number;
  /** 同类段落第几次出现（0 起）与一共几次。 */
  occ: number;
  of: number;
  /** 舞台开合 0–1：主歌收着，副歌打开，最后一次副歌最大。 */
  lift: number;
}

/** 句组：同一段里一口气唱完的几句（最多 MAX_STANZA 句）。 */
export interface Stanza {
  from: number;
  to: number;
  s: number;
  e: number;
  section: number;
}

/** 前奏 / 间奏 / 尾奏：超过 GAP_MIN 秒没有歌词。 */
export interface ShapeGap {
  s: number;
  e: number;
  kind: 'intro' | 'interlude' | 'tail';
}

export interface SongShape {
  sections: LyricSection[];
  stanzas: Stanza[];
  gaps: ShapeGap[];
  /** 每句属于第几段 / 第几个句组。 */
  lineSection: number[];
  lineStanza: number[];
  /** 找到了成段重复的副歌。 */
  confident: boolean;
}

/** 和听音空间的间奏三点同一个门槛（model.ts GAP_MIN）。 */
export const SHAPE_GAP_MIN = 4;
/** 一个句组最多几句，超过就在最大的空档处对半切。 */
export const MAX_STANZA = 6;

const LIFT: Record<SectionKind, number> = { verse: 0.2, pre: 0.45, chorus: 0.8, bridge: 0.55, outro: 0.3 };

const norm = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * 两句是否只差少数几个字：编辑距离 ≤ 较长那句的 20%（至少容 1 个字）。
 * 不用二元组相似度：「first line number 0」和「second line number 0」这种句式相同、内容不同的句子会被误并。
 */
function nearlySame(a: string[], b: string[]): boolean {
  const longer = Math.max(a.length, b.length);
  const limit = Math.max(1, Math.floor(longer * 0.2));
  if (Math.abs(a.length - b.length) > limit) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return false;
    prev = cur;
  }
  return prev[b.length]! <= limit;
}

class Union {
  p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.p[x] !== x) {
      this.p[x] = this.p[this.p[x]!]!;
      x = this.p[x]!;
    }
    return x;
  }
  join(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/** 每句归类：正文相同，或都较长（≥ 6 个字符）且只差少数几个字。空句各自一类。 */
function classify(lines: ShapeLine[]): number[] {
  const keys = lines.map((l) => norm(l.text));
  const chars = keys.map((k) => [...k]);
  const u = new Union(lines.length);
  for (let i = 0; i < lines.length; i++) {
    if (!keys[i]) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (!keys[j]) continue;
      if (keys[i] === keys[j]) u.join(i, j);
      else if (chars[i]!.length >= 6 && chars[j]!.length >= 6 && nearlySame(chars[i]!, chars[j]!)) u.join(i, j);
    }
  }
  return lines.map((_, i) => u.find(i));
}

interface Pair {
  a: number;
  b: number;
  len: number;
}

/** 类序列上的成段重复：所有极大的、长度 ≥ 2、两段不重叠的匹配。 */
function repeatedPairs(c: number[]): Pair[] {
  const n = c.length;
  // run[i][j]：从 i、j 两处开始连续相同的长度（只用 i < j）
  const run: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(n + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = n - 1; j > i; j--) {
      if (c[i] === c[j]) run[i]![j] = run[i + 1]![j + 1]! + 1;
    }
  }
  const out: Pair[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = run[i]![j]!;
      if (r < 2) continue;
      if (i > 0 && c[i - 1] === c[j - 1]) continue; // 不是极大匹配的起点
      const len = Math.min(r, j - i);
      if (len >= 2) out.push({ a: i, b: j, len });
    }
  }
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
};

/** 推断一首歌的段落、句组与间奏。lines 需按时间排好；duration（秒）用来算尾奏，可省略。 */
export function analyzeSong(lines: ShapeLine[], duration?: number): SongShape {
  const n = lines.length;
  const empty: SongShape = { sections: [], stanzas: [], gaps: [], lineSection: [], lineStanza: [], confident: false };
  if (!n) return empty;

  // —— 间奏 ——
  const gaps: ShapeGap[] = [];
  if (lines[0]!.s >= SHAPE_GAP_MIN) gaps.push({ s: 0, e: lines[0]!.s, kind: 'intro' });
  for (let i = 0; i + 1 < n; i++) {
    const end = lines[i]!.e;
    if (lines[i + 1]!.s - end >= SHAPE_GAP_MIN) gaps.push({ s: end, e: lines[i + 1]!.s, kind: 'interlude' });
  }
  const lastEnd = lines[n - 1]!.e;
  if (duration != null && duration - lastEnd >= SHAPE_GAP_MIN) gaps.push({ s: lastEnd, e: duration, kind: 'tail' });

  // —— 成段重复 ——
  const cls = classify(lines);
  const pairs = repeatedPairs(cls);
  const marked = new Array<boolean>(n).fill(false);
  for (const p of pairs) for (let k = 0; k < p.len; k++) marked[p.a + k] = marked[p.b + k] = true;

  // 连续的重复句 = 一个重复块；块之间按句子对应关系连成组
  const runOf = new Array<number>(n).fill(-1);
  const runs: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < n; i++) {
    if (!marked[i]) continue;
    // 间奏把块切开（同一段重复不会跨过一段间奏）
    const split = i > 0 && lines[i]!.s - lines[i - 1]!.e >= SHAPE_GAP_MIN;
    if (i > 0 && marked[i - 1] && !split) runs[runs.length - 1]!.to = i;
    else runs.push({ from: i, to: i });
    runOf[i] = runs.length - 1;
  }
  const ug = new Union(runs.length);
  for (const p of pairs) for (let k = 0; k < p.len; k++) ug.join(runOf[p.a + k]!, runOf[p.b + k]!);
  const groups = new Map<number, number[]>();
  runs.forEach((_, r) => {
    const g = ug.find(r);
    groups.set(g, [...(groups.get(g) ?? []), r]);
  });

  // 副歌组 = 句子最多的组（同样多时取块数多的）；至少出现两次
  let chorusGroup: number[] | null = null;
  let best = -1;
  for (const rs of groups.values()) {
    if (rs.length < 2) continue;
    const size = rs.reduce((m, r) => m + runs[r]!.to - runs[r]!.from + 1, 0);
    const score = size * 100 + rs.length;
    if (score > best) {
      best = score;
      chorusGroup = rs;
    }
  }

  // 每句的标签
  const kind = new Array<SectionKind | null>(n).fill(null);
  /** 副歌的分段起点（一个块里连唱两遍副歌时从第二遍的头切开）。 */
  const chorusStarts = new Set<number>();
  if (chorusGroup) {
    // 每个类出现在几个副歌块里：出现在多数块里的是副歌本体，只出现在少数块开头的是预副歌
    const blockCount = new Map<number, number>();
    for (const r of chorusGroup) {
      const seen = new Set<number>();
      for (let i = runs[r]!.from; i <= runs[r]!.to; i++) seen.add(cls[i]!);
      for (const c of seen) blockCount.set(c, (blockCount.get(c) ?? 0) + 1);
    }
    const maxCount = Math.max(...blockCount.values());
    const core = (i: number) => (blockCount.get(cls[i]!) ?? 0) >= Math.max(2, Math.ceil(maxCount * 0.75));
    // 副歌的头：各块里第一个本体句的类，取最常见的
    const heads = new Map<number, number>();
    for (const r of chorusGroup) {
      for (let i = runs[r]!.from; i <= runs[r]!.to; i++) {
        if (core(i)) {
          heads.set(cls[i]!, (heads.get(cls[i]!) ?? 0) + 1);
          break;
        }
      }
    }
    const head = [...heads.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    for (const r of chorusGroup) {
      const { from, to } = runs[r]!;
      let i = from;
      // 块开头不属于本体的句子：预副歌
      while (i <= to && !core(i)) kind[i++] = 'pre';
      if (i > to) continue;
      const first = i;
      chorusStarts.add(first);
      let last = first;
      for (; i <= to; i++) {
        kind[i] = 'chorus';
        // 同一块里又从副歌的头唱起：第二遍。要求离上一遍的头至少 3 句、且接下来两句都对得上开头
        // （副歌本身是同一句反复唱时，不会被切成一句一段）
        if (
          i - last >= 3 &&
          cls[i] === head &&
          i + 2 <= to &&
          cls[i + 1] === cls[first + 1] &&
          cls[i + 2] === cls[first + 2] &&
          cls[i + 1] !== head
        ) {
          chorusStarts.add(i);
          last = i;
        }
      }
    }
    // 其余重复组：紧挨在副歌前面的算预副歌，最后一次副歌之后的算尾声，否则算主歌（重复的主歌）
    const lastChorus = kind.lastIndexOf('chorus');
    for (const rs of groups.values()) {
      if (rs === chorusGroup) continue;
      for (const r of rs) {
        const { from, to } = runs[r]!;
        const beforeChorus = to + 1 < n && kind[to + 1] === 'chorus';
        const k: SectionKind = beforeChorus ? 'pre' : from > lastChorus ? 'outro' : 'verse';
        for (let i = from; i <= to; i++) kind[i] = k;
      }
    }
  }

  // 没有被重复覆盖的句子：按在副歌之间的位置定主歌 / 桥段 / 尾声
  const chorusSeen: number[] = []; // 截至第 i 句已经开始过几次副歌
  let seen = 0;
  for (let i = 0; i < n; i++) {
    if (chorusStarts.has(i)) seen++;
    chorusSeen[i] = seen;
  }
  const lastChorusLine = kind.lastIndexOf('chorus');
  for (let i = 0; i < n; i++) {
    if (kind[i]) continue;
    if (!chorusGroup) kind[i] = 'verse';
    else if (i > lastChorusLine) kind[i] = 'outro';
    else if (chorusSeen[i]! >= 2) kind[i] = 'bridge';
    else kind[i] = 'verse';
  }

  // —— 段落：同标签连续的句子，副歌在每个起点切开；间奏也切开 ——
  const sections: LyricSection[] = [];
  const lineSection = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const prev = sections[sections.length - 1];
    const gapBefore = i > 0 && lines[i]!.s - lines[i - 1]!.e >= SHAPE_GAP_MIN;
    const cont = prev && prev.kind === kind[i] && !chorusStarts.has(i) && !(gapBefore && kind[i] !== 'chorus');
    if (cont) {
      prev.to = i;
      prev.e = lines[i]!.e;
    } else {
      sections.push({ kind: kind[i]!, from: i, to: i, s: lines[i]!.s, e: lines[i]!.e, occ: 0, of: 1, lift: 0 });
    }
    lineSection[i] = sections.length - 1;
  }
  // 第几次出现、开合
  const counts = new Map<SectionKind, number>();
  for (const sec of sections) {
    sec.occ = counts.get(sec.kind) ?? 0;
    counts.set(sec.kind, sec.occ + 1);
  }
  for (const sec of sections) {
    sec.of = counts.get(sec.kind)!;
    let lift = LIFT[sec.kind];
    if (sec.kind === 'chorus') {
      // 第一次副歌 .75，越往后越开，最后一次 1
      lift = sec.of <= 1 ? 0.9 : 0.75 + 0.25 * (sec.occ / (sec.of - 1));
    } else if (sec.kind === 'verse' && sec.occ > 0) {
      lift = 0.3; // 第二段主歌比第一段略开
    }
    if (!chorusGroup) lift = 0.25;
    sec.lift = lift;
  }

  // —— 句组：段内按时间空档切；太长再在最大空档处对半切 ——
  const stanzas: Stanza[] = [];
  const lineStanza = new Array<number>(n).fill(0);
  const innerGaps: number[] = [];
  for (let i = 0; i + 1 < n; i++) innerGaps.push(Math.max(0, lines[i + 1]!.s - lines[i]!.e));
  const breakGap = Math.max(1.6, median(innerGaps) * 2.5);
  const pushStanza = (from: number, to: number, section: number) => {
    // 超过 MAX_STANZA 句：在内部最大的空档处切开（不切出单句）
    if (to - from + 1 > MAX_STANZA) {
      let cut = -1;
      let widest = -1;
      for (let i = from + 1; i <= to - 2; i++) {
        const g = lines[i + 1]!.s - lines[i]!.e;
        // 偏向中间：两端的空档打折
        const centered = 1 - Math.abs((i - from + 1) / (to - from + 1) - 0.5);
        const w = g * (0.6 + 0.4 * centered);
        if (w > widest) {
          widest = w;
          cut = i;
        }
      }
      if (cut >= from && cut < to) {
        pushStanza(from, cut, section);
        pushStanza(cut + 1, to, section);
        return;
      }
    }
    stanzas.push({ from, to, s: lines[from]!.s, e: lines[to]!.e, section });
    for (let i = from; i <= to; i++) lineStanza[i] = stanzas.length - 1;
  };
  sections.forEach((sec, si) => {
    const parts: Array<[number, number]> = [];
    let start = sec.from;
    for (let i = sec.from; i < sec.to; i++) {
      if (lines[i + 1]!.s - lines[i]!.e >= breakGap) {
        parts.push([start, i]);
        start = i + 1;
      }
    }
    parts.push([start, sec.to]);
    // 段内前后都有停顿的孤句：并进相邻句组（取停顿小的那边），合并后不超过 MAX_STANZA
    for (let k = 0; k < parts.length && parts.length > 1; ) {
      const [a, b] = parts[k]!;
      if (a !== b) {
        k++;
        continue;
      }
      const left = k > 0 ? parts[k - 1]! : null;
      const right = k + 1 < parts.length ? parts[k + 1]! : null;
      const gl = left ? lines[a]!.s - lines[left[1]]!.e : Infinity;
      const gr = right ? lines[right[0]]!.s - lines[a]!.e : Infinity;
      const okL = left && left[1] - left[0] + 2 <= MAX_STANZA;
      const okR = right && right[1] - right[0] + 2 <= MAX_STANZA;
      if (okL && (!okR || gl <= gr)) {
        left![1] = a;
        parts.splice(k, 1);
      } else if (okR) {
        right![0] = a;
        parts.splice(k, 1);
      } else k++;
    }
    for (const [a, b] of parts) pushStanza(a, b, si);
  });

  return { sections, stanzas, gaps, lineSection, lineStanza, confident: !!chorusGroup };
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** 进入新段落提前多少秒开始变（让开合跟着「要唱了」走，而不是唱了才变）。 */
const LIFT_LEAD = 0.8;
/** 开合过渡时长（秒）。 */
const LIFT_RAMP = 1.6;
/** 间奏：歌词唱完多久星云开始回来、下一句前多久沉回去。 */
const GAP_IN = 0.6;
const GAP_RAMP = 1.4;
const GAP_OUT = 1.2;

export interface StageState {
  /** 舞台开合 0–1（在段落之间平滑过渡）。 */
  lift: number;
  /** 间奏让位 0–1：1 = 歌词完全让出、星云回来。 */
  gap: number;
  /** 当前（或即将开始的）段落、句组下标；还没开唱时为 -1。 */
  section: number;
  stanza: number;
}

/** 某一时刻的舞台状态。t（秒）。 */
export function stageAt(shape: SongShape, lines: ShapeLine[], t: number): StageState {
  const { sections, gaps } = shape;
  if (!sections.length) return { lift: 0.25, gap: 0, section: -1, stanza: -1 };
  // 当前段落：最后一个「开始时间 − 提前量」≤ t 的
  let si = -1;
  for (let i = 0; i < sections.length; i++) if (sections[i]!.s - LIFT_LEAD <= t) si = i;
  let lift: number;
  if (si < 0) lift = sections[0]!.lift * 0.6;
  else {
    const cur = sections[si]!;
    const prev = si > 0 ? sections[si - 1]!.lift : cur.lift * 0.6;
    const k = smooth((t - (cur.s - LIFT_LEAD)) / LIFT_RAMP);
    lift = prev + (cur.lift - prev) * k;
  }
  // 间奏让位
  let gap = 0;
  for (const g of gaps) {
    if (t < g.s || t > g.e) continue;
    const inK = g.kind === 'intro' ? 1 : smooth((t - g.s - GAP_IN) / GAP_RAMP);
    const outK = g.kind === 'tail' ? 1 : smooth((g.e - t - GAP_OUT * 0.25) / GAP_OUT);
    gap = Math.min(inK, outK);
    break;
  }
  // 当前句组：按句子
  let li = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i]!.s - LIFT_LEAD <= t) li = i;
  return { lift, gap, section: si, stanza: li >= 0 ? shape.lineStanza[li]! : -1 };
}
