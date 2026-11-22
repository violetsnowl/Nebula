import type { EngineUnit } from './model';
import type { ListenSettings } from './settings';

/**
 * 逐字层（NEBULA_UI_SYSTEM §7.2「每个字」）：扫光、跟着演唱位置的波浪、长音放大与白光、尾韵、快歌自适应。
 * 听音空间的歌词阅读栏（engine.ts）和星云上的空域歌词（components/LyricsLayer）共用这一层，
 * 两处是同一套字（#124，样张 K 第 2 版）。整列的运动（弹簧滚动、景深、环境透色）不在这里。
 *
 * 样式在 components/listen/lyric-words.css，作用于 `.lw` 根下的 `.u` / `.ch`：
 *   --p 扫光进度、--sung / --edge / --un 三段颜色、--lift 浮起（em）、--sc 放大、.glow + --gr / --gc 白光。
 *   根上需要 --lc-a（歌词主色）与 --lc-rest（没在扫的字的颜色）。
 */

export type LyricScript = 'zh' | 'en' | 'ja' | 'ko';

/** 字体与字号（§7.2 字体表；字号是 760px 高的栏下的值）。主舞台只取字体栈和字重。 */
export const TYPO: Record<ListenSettings['font'], Record<LyricScript, { f: string; size: number; lh: number; ls: string; w: number }>> = {
  serif: {
    zh: { f: "'Newsreader',Georgia,'Noto Serif SC','Songti SC',serif", size: 36, lh: 1.32, ls: '0.02em', w: 600 },
    en: { f: "'Newsreader',Georgia,'Noto Serif SC',serif", size: 38, lh: 1.16, ls: '0em', w: 600 },
    ja: { f: "'Newsreader',Georgia,'Noto Serif JP','Yu Mincho',serif", size: 34, lh: 1.38, ls: '0.03em', w: 600 },
    ko: { f: "'Newsreader',Georgia,'Noto Serif KR','Batang','Malgun Gothic',serif", size: 34, lh: 1.38, ls: '0em', w: 600 },
  },
  sans: {
    zh: { f: "'Inter','Segoe UI','Noto Sans SC','Microsoft YaHei',sans-serif", size: 36, lh: 1.3, ls: '0.01em', w: 700 },
    en: { f: "'Inter','Segoe UI',sans-serif", size: 36, lh: 1.14, ls: '-0.012em', w: 700 },
    ja: { f: "'Inter','Segoe UI','Noto Sans JP','Yu Gothic','Meiryo',sans-serif", size: 34, lh: 1.36, ls: '0.02em', w: 700 },
    ko: { f: "'Inter','Segoe UI','Noto Sans KR','Malgun Gothic',sans-serif", size: 34, lh: 1.36, ls: '-0.01em', w: 700 },
  },
};

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const sm = (x: number) => x * x * (3 - 2 * x);

/** 样式变量写入缓存：值没变就不碰 DOM（每帧要写很多变量）。 */
export class Vars {
  private m: Record<string, string> = {};
  private g = false;
  constructor(readonly el: HTMLElement) {}
  set(name: string, val: string): void {
    if (this.m[name] === val) return;
    this.m[name] = val;
    this.el.style.setProperty(name, val);
  }
  glow(on: boolean): void {
    if (on === this.g) return;
    this.g = on;
    this.el.classList.toggle('glow', on);
  }
  /** 回到静止（退场 / 不再是当前句）：浮起与放大归零、白光关掉。 */
  rest(): void {
    this.set('--lift', '0');
    this.set('--sc', '1');
    this.glow(false);
  }
}

export interface UnitRt {
  u: EngineUnit;
  v: Vars;
  /** 拉丁长音按字母拆开的子节点。 */
  chs: Vars[] | null;
  w: number;
  left: number;
  fs: number;
  lineW: number;
}

/** 把一句的唱的单位渲染成 `.u` 节点（拉丁长音再按字母拆成 `.ch`），英文词后补空格。 */
export function renderUnits(host: HTMLElement, units: EngineUnit[]): UnitRt[] {
  return units.map((u, k) => {
    const sp = document.createElement('span');
    sp.className = 'u';
    sp.style.setProperty('--k', String(k));
    sp.style.setProperty('--f', u.cjk ? '42%' : '26%');
    let chs: Vars[] | null = null;
    if (u.emph && !u.cjk) {
      // 拉丁长音：按字母拆开，依次起伏、依次扫光
      sp.classList.add('has-ch');
      chs = [...u.t].map((c) => {
        const c1 = document.createElement('span');
        c1.className = 'ch';
        c1.textContent = c;
        c1.style.setProperty('--k', String(k));
        sp.appendChild(c1);
        return new Vars(c1);
      });
    } else {
      sp.textContent = u.t;
    }
    host.appendChild(sp);
    if (u.sp) host.appendChild(document.createTextNode(' '));
    return { u, v: new Vars(sp), chs, w: 0, left: 0, fs: 36, lineW: 0 };
  });
}

/** 量每个字在句子里的位置（不含 transform，只读布局）。 */
export function measureUnits(rts: UnitRt[]): void {
  if (!rts.length) return;
  const fs = parseFloat(getComputedStyle(rts[0]!.v.el).fontSize) || 36;
  let x = 0;
  for (const r of rts) {
    r.w = r.v.el.offsetWidth;
    r.left = x;
    r.fs = fs;
    x += r.w + (r.u.sp ? fs * 0.26 : 0);
  }
  for (const r of rts) r.lineW = x;
}

/**
 * 逐字波浪：沿一句的阅读顺序（按每个字实际宽度累计）找到正在唱的位置 S，在 S 隆起一道非对称高斯波。
 * 唱过的一侧更宽（慢慢落回），没唱的一侧更窄（快唱到时才升起）；S 在字间停顿里平滑移动；句首提前淡入、句尾落平。
 * D = 快歌密度 0–1（越快波越窄越低）。t 为秒。
 */
export function waveOf(rts: UnitRt[], D: number, t: number): (c: number) => number {
  const a = rts[0]!;
  const z = rts[rts.length - 1]!;
  // 一个字和下一个字之间没有停顿（逐字时间首尾相接，拉丁歌几乎都是这样）时，S 在这个字的时长里一路走到下一个字的起点，
  // 把词后的空格也走掉：原来 S 只走到词尾，换词那一刻跨过空格瞬移约 .26em，波峰每个词跳一下（2026-11-22 用户反馈英文歌的颗粒感）
  const spanEnd = (k: number): number => {
    const r = rts[k]!;
    const nx = rts[k + 1];
    return nx && nx.u.s - r.u.e < 0.06 ? Math.max(r.left + r.w, nx.left) : r.left + r.w;
  };
  let S = a.left;
  if (t >= z.u.e) S = z.left + z.w;
  else if (t >= a.u.s) {
    for (let k = 0; k < rts.length; k++) {
      const r = rts[k]!;
      if (t < r.u.s) {
        const pv = rts[k - 1]!;
        const f = clamp((t - pv.u.e) / Math.max(0.01, r.u.s - pv.u.e), 0, 1);
        S = lerp(spanEnd(k - 1), r.left, sm(f));
        break;
      }
      if (t < r.u.e) {
        S = r.left + clamp((t - r.u.s) / Math.max(0.001, r.u.e - r.u.s), 0, 1) * (spanEnd(k) - r.left);
        break;
      }
    }
  }
  const lead = 0.35 - 0.2 * D;
  const settle = 0.7 - 0.35 * D;
  const A = 0.075 * (1 - 0.25 * D) * sm(clamp((t - a.u.s + lead) / (lead + 0.1), 0, 1)) * sm(clamp((z.u.e + settle - t) / settle, 0, 1));
  const fs = a.fs || 36;
  // 波宽按「字与字的平均间距」放宽（2026-11-22 用户要求「波浪加宽、起伏更柔和」）：中日韩一个字约 1em，间距 ≈ 字号，X ≈ 1 不变；
  // 拉丁一个词常有 3–4em，按 em 定的波比一个词还窄，相邻两个词浮起差得多，看着一个词一个词地跳。
  // X = 平均间距 ÷ 1.1 字号（1–4.5），越像拉丁（L：X 从 1 到 2.5 渐入）再额外放宽到 1.8 倍、未唱一侧再宽 35%：
  // 英文一道波同时托起三四个词，起伏平缓（实测每帧最大跳变从峰值的 22% 降到 4%，和中文同一水平；中文 X = 1，完全不变）
  const span = z.left + z.w - a.left;
  const X = clamp(span / Math.max(1, rts.length) / (1.1 * fs), 1, 4.5);
  const L = clamp((X - 1) / 1.5, 0, 1);
  const widen = X * (1 + 0.8 * L);
  const gb = (1.7 - 0.5 * D) * fs * widen;
  const ga = (1.05 - 0.25 * D) * fs * widen * (1 + 0.35 * L);
  // 放宽之后起伏被摊薄（2026-11-22 用户：柔了、顿挫没了，但起伏小到第一眼像只有扫光）：越像拉丁峰值越高，最多到 2 倍；中日韩 L = 0 不变
  const Aw = A * (1 + L);
  return (c) => {
    const d = c - S;
    const g = d < 0 ? gb : ga;
    return Aw * Math.exp(-(d / g) * (d / g));
  };
}

/** 没有逐字时间的整句：整句一起轻浮（0.035em），句首提前淡入、句尾落平。 */
export function wholeLift(s: number, e: number, D: number, t: number): number {
  const lead = 0.35 - 0.2 * D;
  const settle = 0.7 - 0.35 * D;
  return 0.035 * (1 - 0.25 * D) * sm(clamp((t - s + lead) / (lead + 0.1), 0, 1)) * sm(clamp((e + settle - t) / settle, 0, 1));
}

/**
 * 着色（§7.2 视觉模式）。sung = 唱过的字，edge = 正在唱的那道光，un = 还没唱到的字；tint = 刚唱完的余光（0–1）。
 * 两种模式互为反色：封面色 = 唱过的染色；同色系 = 没唱的染色。
 * 尾韵都是往「更亮」走再褪回：封面色模式唱完的字先偏白再回到封面色；同色系唱过的本来就近白，
 * 尾韵是再亮到纯白、褪回 8% 淡染。不能往主色走——那是没唱的颜色，扫白的字会先变回主色再二次变白（2026-11-21 修）。
 */
export function wordColors(scheme: ListenSettings['scheme'], tint: number): { sung: string; edge: string; un: string } {
  const T = tint > 0.01;
  if (scheme === 'mono') {
    return {
      sung: `color-mix(in srgb, var(--lc-a) ${T ? Math.round(8 * (1 - tint)) : 8}%, #fff)`,
      edge: 'color-mix(in srgb, var(--lc-a) 35%, #fff)',
      un: 'color-mix(in srgb, color-mix(in srgb, var(--lc-a) 58%, #fff) 52%, transparent)',
    };
  }
  return {
    sung: T ? `color-mix(in srgb, #fff ${Math.round(tint * 55)}%, var(--lc-a))` : 'var(--lc-a)',
    edge: 'color-mix(in srgb, var(--lc-a) 30%, #fff)',
    un: 'rgba(255,255,255,.42)',
  };
}

/**
 * 一个字在这一帧的状态：扫光进度、尾韵、波浪浮起、长音放大与白光。
 * active = 当前句（要浮起和发光）；false 时只更新扫光与尾韵颜色。
 */
export function unitFrame(
  rt: UnitRt,
  t: number,
  scheme: ListenSettings['scheme'],
  active: boolean,
  wave: ((c: number) => number) | null,
  D: number,
): void {
  const u = rt.u;
  // 长音光固定白光（白 72% + 主色）
  const GC = 'color-mix(in srgb, #fff 72%, var(--lc-a))';
  const dur = Math.max(0.001, u.e - u.s);
  const p = clamp((t - u.s) / dur, 0, 1);
  // 尾韵：褪去时间 clamp(字时长×2, 0.22s, 0.7s)，字唱得越快褪得越快
  const tailDur = clamp(dur * 2, 0.22, 0.7);
  const tint = t > u.e ? clamp(1 - (t - u.e) / tailDur, 0, 1) : 0;
  const col = wordColors(scheme, tint);
  const setGrad = (v: Vars, pp: number) => {
    v.set('--p', pp.toFixed(3));
    v.set('--sung', col.sung);
    v.set('--edge', col.edge);
    v.set('--un', col.un);
  };
  const singing = t >= u.s && t < u.e;
  if (rt.chs) {
    const n = rt.chs.length;
    rt.chs.forEach((c, ci) => {
      setGrad(c, clamp(p * n - ci, 0, 1));
      if (!active) return;
      const base = wave ? wave(rt.left + ((ci + 0.5) * rt.w) / n) : 0;
      const lp = clamp((p - (ci / n) * 0.55) / 0.45, 0, 1);
      const bump = Math.sin(Math.PI * lp);
      c.set('--lift', (base + 0.05 * bump).toFixed(4));
      c.set('--sc', (1 + 0.06 * bump).toFixed(4));
      const g = singing ? Math.sin(Math.PI * Math.min(1, p * 1.05)) : 0;
      if (g > 0.02) {
        c.glow(true);
        c.set('--gr', (6 + 12 * g).toFixed(1) + 'px');
        c.set('--gc', `color-mix(in srgb, ${GC} ${Math.round(60 * g)}%, transparent)`);
      } else c.glow(false);
    });
    return;
  }
  setGrad(rt.v, p);
  if (!active) return;
  // 宽的字（拉丁词）整体浮起：取它左、中、右三处波高的平均，而不是只看中点，词与词之间的高低差更平缓
  let lift = wave ? (rt.w > 1.6 * (rt.fs || 36) ? (wave(rt.left + rt.w * 0.15) + wave(rt.left + rt.w / 2) + wave(rt.left + rt.w * 0.85)) / 3 : wave(rt.left + rt.w / 2)) : 0;
  let sc = 1;
  let g = 0;
  if (u.emph) {
    // 中日韩长音：叠在波浪上再浮 0.045em、放大到 107%
    const k = Math.sin(Math.PI * Math.min(1, p * 1.04));
    lift += 0.045 * k;
    sc = 1 + 0.07 * (p < 1 ? Math.sin(Math.PI * Math.min(1, p * 0.95)) : 0);
    g = singing ? k : 0;
  } else if (singing) g = 0.45 * (1 - 0.45 * D);
  rt.v.set('--lift', lift.toFixed(4));
  rt.v.set('--sc', sc.toFixed(4));
  // 唱完后的余光：渐弱
  const tailGlow = t > u.e ? clamp(1 - (t - u.e) / (tailDur * 1.3), 0, 1) * 0.5 : 0;
  const G = Math.max(g, tailGlow * (u.emph ? 1.4 : 0.6));
  if (G > 0.03) {
    rt.v.glow(true);
    rt.v.set('--gr', ((u.emph ? 8 : 5) + (u.emph ? 12 : 4) * G).toFixed(1) + 'px');
    rt.v.set('--gc', `color-mix(in srgb, ${GC} ${Math.round((u.emph ? 62 : 45) * G)}%, transparent)`);
  } else rt.v.glow(false);
}

/**
 * 和声的一个字这一帧的状态（#199，方案 A「随行小字」）：只扫色，写 --p 一个变量。
 * 不浮起、不放大、不出长音白光（这些只属于主唱，「正在唱的那个字」是签名时刻）；三段颜色由样式按视觉模式定（lyric-column.css 的 --bgs / --bge / --bgu），
 * 所以也没有尾韵。只有当前句调用它；不是当前句时样式直接给静止色（已唱 / 待唱），和声时间超出这一句的部分换句后就停在那里。
 */
export function bgUnitFrame(rt: UnitRt, t: number): void {
  const u = rt.u;
  rt.v.set('--p', clamp((t - u.s) / Math.max(0.001, u.e - u.s), 0, 1).toFixed(3));
}

/** 一个字回到静止（含拉丁长音拆开的字母）。 */
export function restUnit(rt: UnitRt): void {
  rt.v.rest();
  rt.chs?.forEach((c) => c.rest());
}
