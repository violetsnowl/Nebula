import type { EngineEntry, EngineUnit } from './model';
import type { ListenSettings } from './settings';

/**
 * 听音空间歌词阅读栏引擎（docs/design/NEBULA_UI_SYSTEM.md §7.2，样张 J 第 6 版的移植）。
 * 纯 DOM，不依赖 React；由外层每帧调用 frame(t, playing, now) 驱动。
 *
 * 重要（环境透色）：歌词容器及其所有祖先都不能建立层叠上下文 / 隔离组——
 * 不设 z-index、mask、filter、opacity<1、contain: paint 等，否则不在唱的句子上的
 * `mix-blend-mode: plus-lighter` 混合不到背后的封面环境，白字会退回灰白。
 * 上下边缘的淡出因此改成逐句算透明度，而不是遮罩。
 */

export type LyricScript = 'zh' | 'en' | 'ja' | 'ko';

export interface LyricEngineOptions {
  /** 设置里的预览：小尺寸（约 316×150）、三句可见、不接收滚轮 / 点击；动效与正式版完全一致。 */
  compact?: boolean;
  /** 点某一句：跳到该句开始（秒）。 */
  onSeek: (sec: number) => void;
}

// 字体与字号（§7.2 字体表；字号是 760px 高的栏下的值，按栏高等比缩放）
const TYPO: Record<ListenSettings['font'], Record<LyricScript, { f: string; size: number; lh: number; ls: string; w: number }>> = {
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

/** 基准栏高 760px（1600×900 下的听音空间）。 */
const REF_H = 760;
/** 当前句顶边停在栏高的 28%（预览 22%）。 */
const ANCHOR = 0.28;
const ANCHOR_COMPACT = 0.22;
/** 预览的字号比例：36px 的中文约缩到 20px。 */
const COMPACT_K = 0.56;

/** 回到当前按钮里的准星图标（lib 不能 import components，用内联 SVG 字符串）。 */
const BACK_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="6"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const sm = (x: number) => x * x * (3 - 2 * x);

/** 样式变量写入缓存：值没变就不碰 DOM（每帧要写很多变量）。 */
class Vars {
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
}

interface UnitRt {
  u: EngineUnit;
  v: Vars;
  /** 拉丁长音按字母拆开的子节点。 */
  chs: Vars[] | null;
  w: number;
  left: number;
  fs: number;
  lineW: number;
}

interface Row {
  e: EngineEntry;
  el: HTMLDivElement;
  /** 正文节点（整句条目的浮起也作用在它上面）。 */
  main: HTMLElement | null;
  rts: UnitRt[] | null;
  whole: Vars | null;
  dots: Vars[] | null;
  // 位置弹簧（y）、缩放弹簧（sc）、景深透明度（o）
  y: number;
  vy: number;
  ty: number;
  sc: number;
  vs: number;
  ts: number;
  o: number;
  to: number;
  /** 错峰起步时刻（performance.now 时间线，ms）。 */
  wait: number;
  top: number;
  h: number;
  pre: boolean;
  gradUntil: number;
  lastT: string;
  lastO: string;
}

export class LyricEngine {
  private host: HTMLElement;
  private opts: LyricEngineOptions;
  private compact: boolean;
  private box: HTMLDivElement;
  private back: HTMLButtonElement;
  private rows: Row[] = [];
  private tails = new Set<Row>();
  private script: LyricScript = 'zh';
  private settings: ListenSettings = { scheme: 'accent', font: 'serif', translation: true };
  // 尺寸
  private H = REF_H;
  private W = 800;
  private k = 1;
  private anchor = REF_H * ANCHOR;
  // 时钟与状态
  private t = 0;
  private nowMs = 0;
  private lastNow = 0;
  private playing = false;
  private cur = -1;
  private forceNext = false;
  // 手动浏览
  private browse = 0;
  private browsing = false;
  private browseTimer = 0;
  private destroyed = false;
  private fontRaf = 0;
  private sized = false;
  /** 刚换了歌词：下一帧直接落到当前位置，不从旧位置滚过去。 */
  private fresh = true;

  constructor(host: HTMLElement, opts: LyricEngineOptions) {
    this.host = host;
    this.opts = opts;
    this.compact = !!opts.compact;
    host.classList.add('lc-root');
    if (this.compact) host.dataset.compact = '1';
    host.dataset.scheme = this.settings.scheme;
    host.dataset.tr = this.settings.translation ? 'on' : 'off';

    this.box = document.createElement('div');
    this.box.className = 'lc-lines';
    host.appendChild(this.box);

    this.back = document.createElement('button');
    this.back.type = 'button';
    this.back.className = 'ly-back';
    this.back.innerHTML = `${BACK_ICON}回到当前`;
    this.back.addEventListener('click', this.onBack);
    host.appendChild(this.back);

    if (!this.compact) host.addEventListener('wheel', this.onWheel, { passive: false });
    // 字体加载完成后字宽会变：重新量一遍
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.addEventListener?.('loadingdone', this.onFontsLoaded);
      void document.fonts.ready.then(this.onFontsLoaded);
    }
    this.measureHost();
    this.applyTypography();
  }

  // ---------------------------------------------------------------- 对外接口

  /** 换歌词（或同一首的歌词更新）。 */
  setLyrics(entries: EngineEntry[], script: LyricScript): void {
    if (this.destroyed) return;
    this.script = script;
    this.endBrowseNow();
    this.tails.clear();
    this.box.textContent = '';
    this.rows = entries.map((e) => this.makeRow(e));
    for (const r of this.rows) this.box.appendChild(r.el);
    this.applyTypography();
    this.cur = -1;
    this.measure();
    this.update(true);
    this.snap();
    this.fresh = true;
  }

  setSettings(s: ListenSettings): void {
    if (this.destroyed) return;
    const fontChanged = s.font !== this.settings.font;
    const trChanged = s.translation !== this.settings.translation;
    this.settings = { ...s };
    this.host.dataset.scheme = s.scheme;
    this.host.dataset.tr = s.translation ? 'on' : 'off';
    if (!this.rows.length) {
      this.applyTypography();
      return;
    }
    if (fontChanged) {
      this.applyTypography();
      this.measure();
      this.setTargets(false);
      this.snap();
    } else if (trChanged) {
      // 翻译行显示 / 隐藏会改变每句的高度
      this.measure();
      this.setTargets(false);
    }
  }

  /**
   * 每帧调用。
   * @param tSec 当前播放位置（秒，外层已平滑）
   * @param playing 是否在播放
   * @param nowMs 单调时钟（rAF 时间戳或 performance.now()），用于弹簧积分与错峰起步
   */
  frame(tSec: number, playing: boolean, nowMs: number): void {
    if (this.destroyed) return;
    const dt = this.lastNow ? clamp((nowMs - this.lastNow) / 1000, 0, 0.05) : 1 / 60;
    this.lastNow = nowMs;
    this.nowMs = nowMs;
    if (playing !== this.playing) {
      this.playing = playing;
      this.host.dataset.playing = playing ? '1' : '0';
    }
    if (!this.rows.length) {
      this.t = tSec;
      return;
    }
    if (this.fresh) {
      // 换歌 / 首次出现：直接排到当前时间的位置
      this.fresh = false;
      this.t = tSec;
      this.resetForSeek();
      this.update(true);
      this.snap();
      return;
    }
    const jump = tSec - this.t;
    this.t = tSec;
    // 位置突然前后跳（拖进度条、点歌词、换歌）：按「跳转」处理，清掉预备 / 尾韵的残留
    if (jump < -0.35 || jump > 1.2) {
      this.resetForSeek();
      this.forceNext = true;
    }
    const force = this.forceNext;
    this.forceNext = false;
    this.update(force);
    this.physics(dt, nowMs);
  }

  /** 宿主尺寸变了（窗口缩放、预览容器变化）。 */
  resize(): void {
    if (this.destroyed) return;
    const changed = this.measureHost();
    if (!changed) return;
    this.applyTypography();
    if (!this.rows.length) return;
    this.measure();
    this.setTargets(false);
    this.snap();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.browseTimer);
    cancelAnimationFrame(this.fontRaf);
    this.host.removeEventListener('wheel', this.onWheel);
    this.back.removeEventListener('click', this.onBack);
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.removeEventListener?.('loadingdone', this.onFontsLoaded);
    }
    this.box.remove();
    this.back.remove();
    this.rows = [];
    this.tails.clear();
    delete this.host.dataset.compact;
    delete this.host.dataset.scheme;
    delete this.host.dataset.tr;
    delete this.host.dataset.browsing;
    delete this.host.dataset.playing;
  }

  // ---------------------------------------------------------------- 构建

  private makeRow(e: EngineEntry): Row {
    const el = document.createElement('div');
    el.className = 'ly-line';
    const row: Row = {
      e,
      el,
      main: null,
      rts: null,
      whole: null,
      dots: null,
      y: 0,
      vy: 0,
      ty: 0,
      sc: 0.96,
      vs: 0,
      ts: 0.96,
      o: 0,
      to: 0,
      wait: 0,
      top: 0,
      h: 0,
      pre: false,
      gradUntil: 0,
      lastT: '',
      lastO: '',
    };
    if (e.kind === 'gap') {
      el.classList.add('is-gapline');
      el.innerHTML = '<div class="ly-gap"><i></i><i></i><i></i></div>';
      row.dots = [...el.querySelectorAll<HTMLElement>('.ly-gap i')].map((i) => new Vars(i));
      return row;
    }
    const main = document.createElement('div');
    main.className = 'ly-main';
    row.main = main;
    if (e.units) {
      row.rts = this.renderUnits(main, e.units);
    } else {
      // 没有逐字时间：整句一个节点，不伪造时间
      main.classList.add('ly-whole');
      main.textContent = e.text;
      row.whole = new Vars(main);
    }
    el.appendChild(main);
    if (e.tr) {
      const tr = document.createElement('div');
      tr.className = 'ly-tr';
      tr.textContent = e.tr;
      el.appendChild(tr);
    }
    el.addEventListener('click', () => {
      if (this.compact) return;
      // 点一句：跳到该句开始，同时回到跟随状态
      this.endBrowseNow();
      this.forceNext = true;
      this.opts.onSeek(e.s + 0.01);
    });
    return row;
  }

  private renderUnits(host: HTMLElement, units: EngineUnit[]): UnitRt[] {
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

  // ---------------------------------------------------------------- 尺寸与排版

  /** 读宿主尺寸并换算缩放 / 锚点；返回是否有变化。 */
  private measureHost(): boolean {
    const H = this.host.clientHeight;
    const W = this.host.clientWidth;
    if (!H || !W) return false;
    if (this.sized && H === this.H && W === this.W) return false;
    this.sized = true;
    this.H = H;
    this.W = W;
    this.k = this.compact ? COMPACT_K : clamp(H / REF_H, 0.4, 2);
    this.anchor = H * (this.compact ? ANCHOR_COMPACT : ANCHOR);
    return true;
  }

  private applyTypography(): void {
    const ty = TYPO[this.settings.font][this.script];
    const st = this.host.style;
    st.setProperty('--lc-font', ty.f);
    st.setProperty('--lc-size', `${(ty.size * this.k).toFixed(2)}px`);
    st.setProperty('--lc-lh', String(ty.lh));
    st.setProperty('--lc-ls', ty.ls);
    st.setProperty('--lc-w', String(ty.w));
    st.setProperty('--lc-k', this.k.toFixed(4));
    st.setProperty('--lc-anchor', `${this.anchor.toFixed(1)}px`);
  }

  private onFontsLoaded = (): void => {
    if (this.destroyed || this.fontRaf) return;
    this.fontRaf = requestAnimationFrame(() => {
      this.fontRaf = 0;
      if (this.destroyed || !this.rows.length) return;
      this.measure();
      this.setTargets(false);
    });
  };

  /** 量每句的高度与每个字的位置（一次读完，中间不写样式）。 */
  private measure(): void {
    const ty = TYPO[this.settings.font][this.script];
    const gap = ty.size * this.k * 0.62;
    let top = 0;
    for (const r of this.rows) {
      r.h = r.el.offsetHeight;
      r.top = top;
      top += r.h + gap;
      if (r.rts) this.measureUnits(r.rts);
    }
  }

  private measureUnits(rts: UnitRt[]): void {
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

  /** 位置、缩放、透明度直接落到目标（初次排版、换字体、改尺寸时不走弹簧）。 */
  private snap(): void {
    for (const r of this.rows) {
      r.y = r.ty;
      r.vy = 0;
      r.sc = r.ts;
      r.vs = 0;
      r.o = r.to;
      this.apply(r);
    }
  }

  // ---------------------------------------------------------------- 当前句与目标

  private dOf(r: Row | undefined): number {
    return r && r.e.kind === 'line' ? r.e.dens : 0;
  }

  private idxAt(time: number): number {
    // 最后一个 s <= time 的条目（条目按开始时间有序）
    let lo = 0;
    let hi = this.rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.rows[mid]!.e.s <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** 每句的位置目标；换句时错峰：上方已唱的先走，当前与下方按距离依次晚起步（最多 8 句，快歌 6 句）。 */
  private setTargets(stagger: boolean): void {
    const c = this.rows[this.cur];
    if (!c) return;
    const dn = this.dOf(c);
    this.rows.forEach((r, i) => {
      r.ty = this.anchor - c.top + r.top + this.browse;
      r.ts = i === this.cur ? 1 : 0.96;
      const d = i - this.cur;
      r.wait = stagger ? this.nowMs + clamp(d + 1, 0, dn > 0.5 ? 6 : 8) * (42 - 18 * dn) : 0;
    });
  }

  /** 景深：当前 1；下方 .46 / .32 / .22 / .15；上方 .30 / .20 / .13 / .08；两句以外开始虚化，最多 2.8px。 */
  private setLooks(): void {
    const dur = (0.5 - 0.22 * this.dOf(this.rows[this.cur])).toFixed(2) + 's';
    this.rows.forEach((r, i) => {
      const d = i - this.cur;
      let o: number;
      let b: number;
      if (this.browsing) {
        o = d === 0 ? 1 : 0.5;
        b = 0;
      } else {
        o = d === 0 ? 1 : d === 1 ? 0.46 : d === 2 ? 0.32 : d === 3 ? 0.22 : d > 3 ? 0.15 : d === -1 ? 0.3 : d === -2 ? 0.2 : d === -3 ? 0.13 : 0.08;
        const a = Math.abs(d);
        b = a <= 1 ? 0 : Math.min(2.8, (a - 1) * 0.7);
      }
      r.to = o;
      r.el.style.filter = b ? `blur(${(b * this.k).toFixed(2)}px)` : 'none';
      r.el.style.transitionDuration = dur;
    });
  }

  private onLineChange(prev: number): void {
    const t = this.t;
    const P = prev >= 0 ? this.rows[prev] : undefined;
    if (P) {
      P.el.classList.remove('is-cur');
      P.el.classList.add('is-settle');
      if (P.rts) {
        P.gradUntil = t + 1.0;
        this.tails.add(P);
      }
      this.resetRow(P);
    }
    const C = this.rows[this.cur]!;
    C.el.classList.add('is-cur');
    C.el.classList.remove('is-settle');
    this.tails.delete(C);
    if (C.rts) C.el.classList.add('is-grad');
    // 上场轻弹：96% → 100%（快歌 98% 起）
    C.sc = Math.min(C.sc, 0.955 + 0.025 * this.dOf(C));
    this.rows.forEach((r, i) => {
      if (i > this.cur) r.pre = false;
      r.el.classList.toggle('is-past', i < this.cur);
    });
    this.setTargets(true);
    this.setLooks();
  }

  /** 一句退场：每个字的浮起、放大、辉光归零（CSS 的 is-settle 负责让它们依次落回）。 */
  private resetRow(r: Row): void {
    if (r.whole) r.whole.set('--lift', '0');
    if (!r.rts) return;
    for (const rt of r.rts) {
      rt.v.set('--lift', '0');
      rt.v.set('--sc', '1');
      rt.v.glow(false);
      if (rt.chs) {
        for (const c of rt.chs) {
          c.set('--lift', '0');
          c.set('--sc', '1');
          c.glow(false);
        }
      }
    }
  }

  /** 跳转：清掉预备 / 尾韵的残留。 */
  private resetForSeek(): void {
    for (const r of this.rows) {
      r.pre = false;
      r.gradUntil = 0;
      if (r.rts) r.el.classList.remove('is-grad');
    }
    this.tails.clear();
  }

  // ---------------------------------------------------------------- 每帧：字、波浪、间奏

  private update(force: boolean): void {
    const rows = this.rows;
    if (!rows.length) return;
    const t = this.t;
    const k = this.idxAt(t);
    if (k !== this.cur || force) {
      const prev = this.cur;
      this.cur = k;
      this.onLineChange(prev === k ? -1 : prev);
    }
    const C = rows[this.cur]!;
    const e = C.e;
    if (e.kind === 'gap') {
      // 间奏三点：随进度逐个亮起，整体呼吸，开唱前 0.45s 收拢
      const p = clamp((t - e.s) / Math.max(0.01, e.e - e.s), 0, 1);
      const tail = clamp((e.e - t) / 0.45, 0, 1);
      const breathe = 1 + 0.06 * Math.sin(t * Math.PI * 1.25);
      C.dots!.forEach((d, i) => {
        const f = clamp(p * 3.1 - i, 0, 1);
        d.set('--o', ((0.25 + 0.75 * f) * tail).toFixed(3));
        d.set('--ds', ((0.8 + 0.2 * f) * breathe * (0.4 + 0.6 * tail)).toFixed(3));
      });
    } else if (C.rts) {
      const D = e.dens;
      const w = this.waveOf(C.rts, D);
      for (const rt of C.rts) this.unitFrame(rt, true, w, D);
    } else if (C.whole) {
      // 整句：波浪改整句轻浮
      const D = e.dens;
      const lead = 0.35 - 0.2 * D;
      const settle = 0.7 - 0.35 * D;
      const A = 0.035 * (1 - 0.25 * D) * sm(clamp((t - e.s + lead) / (lead + 0.1), 0, 1)) * sm(clamp((e.e + settle - t) / settle, 0, 1));
      C.whole.set('--lift', A.toFixed(4));
    }
    // 上一句的尾韵还在褪
    for (const r of this.tails) {
      if (r.gradUntil > t) {
        const D = this.dOf(r);
        for (const rt of r.rts!) this.unitFrame(rt, false, null, D);
      } else {
        r.el.classList.remove('is-grad');
        this.tails.delete(r);
      }
    }
    // 预备：下一句开唱前 0.28s 先亮到 .72（快歌提前量缩短）
    const N = rows[this.cur + 1];
    if (N && !this.browsing && !N.pre && t > N.e.s - (0.28 - 0.12 * this.dOf(C))) {
      N.pre = true;
      N.to = 0.72;
    }
  }

  /**
   * 逐字波浪：沿一句的阅读顺序（按每个字实际宽度累计）找到正在唱的位置 S，在 S 隆起一道非对称高斯波。
   * 唱过的一侧更宽（慢慢落回），没唱的一侧更窄（快唱到时才升起）；S 在字间停顿里平滑移动；句首提前淡入、句尾落平。
   */
  private waveOf(rts: UnitRt[], D: number): (c: number) => number {
    const t = this.t;
    const a = rts[0]!;
    const z = rts[rts.length - 1]!;
    let S = a.left;
    if (t >= z.u.e) S = z.left + z.w;
    else if (t >= a.u.s) {
      for (let k = 0; k < rts.length; k++) {
        const r = rts[k]!;
        if (t < r.u.s) {
          const pv = rts[k - 1]!;
          const f = clamp((t - pv.u.e) / Math.max(0.01, r.u.s - pv.u.e), 0, 1);
          S = lerp(pv.left + pv.w, r.left, sm(f));
          break;
        }
        if (t < r.u.e) {
          S = r.left + clamp((t - r.u.s) / Math.max(0.001, r.u.e - r.u.s), 0, 1) * r.w;
          break;
        }
      }
    }
    const lead = 0.35 - 0.2 * D;
    const settle = 0.7 - 0.35 * D;
    const A = 0.075 * (1 - 0.25 * D) * sm(clamp((t - a.u.s + lead) / (lead + 0.1), 0, 1)) * sm(clamp((z.u.e + settle - t) / settle, 0, 1));
    const fs = a.fs || 36;
    const gb = (1.7 - 0.5 * D) * fs;
    const ga = (1.05 - 0.25 * D) * fs;
    return (c) => {
      const d = c - S;
      const g = d < 0 ? gb : ga;
      return A * Math.exp(-(d / g) * (d / g));
    };
  }

  /**
   * 着色（§7.2 视觉模式）。sung = 唱过的字，edge = 正在唱的那道光，un = 还没唱到的字；tint = 刚唱完的余光（0–1）。
   * 两种模式互为反色：封面色 = 唱过的染色；同色系 = 没唱的染色。
   */
  private colors(tint: number): { sung: string; edge: string; un: string } {
    const T = tint > 0.01;
    if (this.settings.scheme === 'mono') {
      return {
        sung: `color-mix(in srgb, var(--lc-a) ${T ? 8 + Math.round(tint * 50) : 8}%, #fff)`,
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

  /** 一个字在这一帧的状态：扫光进度、尾韵、波浪浮起、长音放大与白光。 */
  private unitFrame(rt: UnitRt, active: boolean, wave: ((c: number) => number) | null, D: number): void {
    const t = this.t;
    const u = rt.u;
    // 长音光固定白光（白 72% + 主色）
    const GC = 'color-mix(in srgb, #fff 72%, var(--lc-a))';
    const dur = Math.max(0.001, u.e - u.s);
    const p = clamp((t - u.s) / dur, 0, 1);
    // 尾韵：褪去时间 clamp(字时长×2, 0.22s, 0.7s)，字唱得越快褪得越快
    const tailDur = clamp(dur * 2, 0.22, 0.7);
    const tint = t > u.e ? clamp(1 - (t - u.e) / tailDur, 0, 1) : 0;
    const col = this.colors(tint);
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
    let lift = wave ? wave(rt.left + rt.w / 2) : 0;
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

  // ---------------------------------------------------------------- 物理与落样式

  /** 写位置 / 缩放 / 透明度：透明度 = 景深插值 × 上下边缘淡出（顶部 15%、底部 22%，按句子中心位置，不用遮罩）。 */
  private apply(r: Row): void {
    const T = `translate3d(0, ${r.y.toFixed(2)}px, 0) scale(${r.sc.toFixed(4)})`;
    if (T !== r.lastT) {
      r.lastT = T;
      r.el.style.transform = T;
    }
    const H = this.H;
    const c = r.y + r.h * 0.5;
    const edge = sm(clamp(c / (H * 0.15), 0, 1)) * sm(clamp((H - c) / (H * 0.22), 0, 1));
    const O = (r.o * edge).toFixed(3);
    if (O !== r.lastO) {
      r.lastO = O;
      r.el.style.opacity = O;
      // 完全看不见的句子不参与绘制 / 混合
      r.el.style.visibility = O === '0.000' ? 'hidden' : '';
    }
  }

  /** 每句一根弹簧（刚度 150、阻尼比 0.94、不回弹；快歌刚度到 230）；缩放弹簧刚度 300、阻尼 15（约 1% 回弹）。 */
  private physics(dt: number, now: number): void {
    const dn = this.dOf(this.rows[this.cur]);
    const ky = 150 + 80 * dn;
    const cy = 2 * 0.94 * Math.sqrt(ky);
    const ks = 300;
    const cs = 15;
    // 景深透明度逐帧插值：时间常数约 0.17s（快歌更快）
    const ko = 1 - Math.exp(-dt / Math.max(0.05, (0.5 - 0.22 * dn) / 3));
    for (const r of this.rows) {
      r.o += (r.to - r.o) * ko;
      if (now >= r.wait) {
        const a = ky * (r.ty - r.y) - cy * r.vy;
        r.vy += a * dt;
        r.y += r.vy * dt;
      }
      const as = ks * (r.ts - r.sc) - cs * r.vs;
      r.vs += as * dt;
      r.sc += r.vs * dt;
      this.apply(r);
    }
  }

  // ---------------------------------------------------------------- 手动浏览

  /** 滚轮前后翻：取消错峰、所有句子清晰并统一 .5，右侧出现「回到当前」，4s 不动自动回来。 */
  private onWheel = (ev: WheelEvent): void => {
    if (!this.rows.length || this.cur < 0) return;
    ev.preventDefault();
    this.browsing = true;
    this.host.dataset.browsing = '1';
    const c = this.rows[this.cur]!;
    const last = this.rows[this.rows.length - 1]!;
    const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
    this.browse = clamp(this.browse - dy * 0.9, -(last.top - c.top), c.top);
    for (const r of this.rows) {
      r.wait = 0;
      r.ty = this.anchor - c.top + r.top + this.browse;
    }
    this.setLooks();
    clearTimeout(this.browseTimer);
    this.browseTimer = window.setTimeout(this.endBrowse, 4000);
  };

  private endBrowse = (): void => {
    this.browsing = false;
    this.browse = 0;
    delete this.host.dataset.browsing;
    this.setTargets(true);
    this.setLooks();
  };

  /** 立即退出浏览状态（不排动画，由随后的 update(true) 重排）。 */
  private endBrowseNow(): void {
    clearTimeout(this.browseTimer);
    this.browsing = false;
    this.browse = 0;
    delete this.host.dataset.browsing;
  }

  private onBack = (ev: MouseEvent): void => {
    ev.stopPropagation();
    clearTimeout(this.browseTimer);
    this.endBrowse();
  };
}
