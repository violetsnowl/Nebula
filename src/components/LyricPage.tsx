import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { audioPlayer } from '../lib/audio/AudioPlayer';
import { useAudioPlayer } from '../lib/audio/useAudioPlayer';
import { useInterfaceSettingsContext } from '../hooks/interfaceSettings/InterfaceSettingsContext';
import type { LyricLineUI } from '../lib/lyrics';
import { listenBus } from '../lib/listenMode';
import { detectScript, songPace, toEngineLine, type EngineLine } from '../lib/listen/model';
import { analyzeSong, type SectionKind } from '../lib/listen/sections';
import { useListenSettings } from '../lib/listen/settings';
import { pageBus } from '../lib/listen/stageBus';
import { TYPO, measureUnits, renderUnits, restUnit, unitFrame, waveOf, type UnitRt } from '../lib/listen/words';
import { useSpaceLab } from '../lib/space/lab';
import { flatten } from './lyric-page/kit';
import { FALLBACK_H, newPickState, pickTpl, songHook } from './lyric-page/pools';
import {
  LsFly,
  columnSideOf,
  columnUnitsOf,
  hideFlyElements,
  isPageStageActive,
  launchStageToListenFly,
  matchColumnLines,
  type FlyPair,
  type FlySide,
} from '../lib/listen/flyTransition';
import { PH, PW, type PageHooks, type TCtx, type TLine, type Tpl } from './lyric-page/types';
import './listen/lyric-words.css';
import './listen/fly-transition.css';
import './lyric-page.css';
import './lyric-page-tpl.css';
import './lyric-page-tpl-b.css';
import './lyric-page-tpl-c.css';
import './lyric-page-tpl-d.css';
import './lyric-page-tpl-e.css';

/**
 * 版面（样张 M，2026-11-22，fe/next；规格 NEBULA_UI_SYSTEM §7.1b）：聆听时的另一种主舞台。完全不飞，靠排版：
 *   - 一个句组（段落引擎的 stanza）一页；整页一出现就以浅灰印好（能提前读到），唱到哪个字，哪个字印成实色；
 *   - 每种段落有几套版式，按页轮换（同一段落第几次出现用第几套，相邻两页不重复）；中文歌竖排；
 *   - 逐字层与听音空间、漫游歌词同一套（扫光、波浪、长音、尾韵），颜色跟随「封面色 / 同色系」；
 *   - 进入聆听时，漫游歌词正在唱的那句飞到版面上同一句的位置再交叉淡化（pageBus，LyricsLayer 那边做）。
 * 只在舞台实验室选了「版面」且正在聆听时出现（透明度 = 交接进度 --lk）。按 1600 × 900 的逻辑画幅排，等比缩放到窗口。
 */

interface LyricPageProps {
  lines: LyricLineUI[];
  loading?: boolean;
  songKey?: string;
  /** 听音空间开着（版面 ↔ 听音空间一镜到底用）。 */
  lsOpen?: boolean;
}

const usable = (l: LyricLineUI | undefined) => !!l && (!!l.text?.trim() || !!l.words?.length);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** 版面上的一句：版式看到的部分（TLine）+ 引擎自己的状态。 */
interface PLine extends TLine {
  eng: EngineLine;
  rts: UnitRt[] | null;
  state: 'future' | 'cur' | 'past';
  active: boolean;
  w: number;
  h: number;
}

interface PPage {
  el: HTMLElement;
  lines: PLine[];
  kind: SectionKind;
  tpl: Tpl;
  ctx: TCtx;
  hooks: PageHooks | null;
  s: number;
  e: number;
  tIn: number;
  tOut: number;
  on: boolean;
}


/** 没唱到的字（浅灰的「先印好」）：封面色模式是白 24%，同色系带一点主色（与 lyric-page.css 的 --lc-rest 一致）。 */
const GHOST = {
  cover: 'rgba(255,255,255,.24)',
  mono: 'color-mix(in srgb, color-mix(in srgb, var(--lc-a) 58%, #fff) 24%, transparent)',
} as const;

/** 纸面颗粒：一张 256px 的灰度噪点，第一次用到时生成（样张 M 的纸面质感）。 */
let grainUrl = '';
function grain(): string {
  if (grainUrl) return grainUrl;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (!g) return '';
  const im = g.createImageData(256, 256);
  let s = 20261122;
  for (let i = 0; i < im.data.length; i += 4) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const v = s >>> 24;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
    im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  grainUrl = c.toDataURL('image/png');
  return grainUrl;
}

/** 版面单独的波浪参数：拉丁歌波宽在听音空间那套的基础上收窄 40%（2026-11-22 用户要求，听音空间、漫游歌词不变）。 */
const PAGE_WAVE = { widthK: 0.6 };

/** 经典版式：每句一个位置和字号（f = 整页缩放）。 */
function layoutClassic(pg: PPage, f: number): void {
  const n = pg.lines.length;
  const hasTr = pg.lines.some((l) => l.tr);
  const place = pg.tpl.place!;
  pg.lines.forEach((l, i) => {
    const p = place(i, n, f, l.w);
    const st = l.el.style;
    st.left = p.center ? '0' : p.left != null ? `${p.left}px` : '';
    st.right = !p.center && p.right != null ? `${p.right}px` : '';
    st.width = p.center ? `${PW}px` : '';
    st.textAlign = p.center ? 'center' : p.right != null ? 'right' : '';
    st.top = `${p.top}px`;
    l.tx.style.fontSize = `${p.fs}px`;
    l.tx.style.fontStyle = pg.tpl.italic ? 'italic' : '';
    if (l.tr) l.tr.className = `lp-tr ${p.tr === 'side' && hasTr ? 'is-side' : 'is-under'}`;
  });
}

/** 重排之前把一页恢复成「刚建好」的样子：撤销分段、清掉装饰与版式加的类名和样式，翻译放回原句。 */
function resetPage(pg: PPage): void {
  pg.hooks?.undo?.();
  pg.hooks = null;
  pg.el.querySelectorAll('.lp-deco').forEach((d) => d.remove());
  for (const l of pg.lines) {
    flatten(l);
    l.el.style.cssText = '';
    l.el.className = l.el.className
      .split(' ')
      .filter((c) => c && !c.startsWith('lt-') && c !== 'lp-rot' && c !== 'is-vert')
      .join(' ');
    delete l.el.dataset.hb;
    l.tx.style.cssText = '';
    for (const u of l.units) u.classList.remove('lp-big', 'lp-still', 'lp-pc', 'lp-pb', 'lp-cutsrc', 'lp-onp');
    if (l.tr) {
      if (l.tr.parentElement !== l.el) l.el.appendChild(l.tr);
      l.tr.style.cssText = '';
      l.tr.className = 'lp-tr';
      delete l.tr.dataset.n;
    }
    l.vert = pg.ctx.vert;
    l.el.classList.toggle('is-vert', l.vert);
    l.rot = 0;
  }
}

/** 一个字的读向：在竖排段里（.lp-seg-v）就是竖的，否则跟这一句。 */
const unitVert = (l: PLine, el: HTMLElement) => (el.closest('.lp-seg-v') ? true : l.vert);

/**
 * 量字的位置（波浪按它找「正在唱的位置」）：每个字的盒子带一圈上色留白、再用负边距抵消，相邻两个字的盒子互相重叠。
 * 必须按字本身的范围量（扣掉留白）：按含留白的盒子量的话，演唱位置每走到下一个字都会先倒退 0.4 个字宽，
 * 波浪峰在每个字的交界处来回跳——慢歌里就是「诡异的抖动」（2026-11-22 用户反馈，fe/next-9 之后）。
 * 样张 N 起一句可以分成几段（几行、几列、横竖两截）：每段沿自己的读向量，段与段首尾相接累计，演唱位置跨段也只往前走。
 * 量的时候页上的旋转都临时关掉（.is-measuring），量的是平排的样子。
 */
function measureLine(l: PLine, S: number): void {
  if (!l.rts?.length) return;
  measureUnits(l.rts);
  const gap = (l.rts[0]!.fs || 36) * 0.26;
  let seg: Element | null = null;
  let segBase = 0;
  let segStart = 0;
  let end = 0;
  l.rts.forEach((r, i) => {
    const el = r.v.el;
    const v = unitVert(l, el);
    const cs = getComputedStyle(el);
    const p0 = (v ? parseFloat(cs.paddingTop) : parseFloat(cs.paddingLeft)) || 0;
    const p1 = (v ? parseFloat(cs.paddingBottom) : parseFloat(cs.paddingRight)) || 0;
    // 沿阅读方向用带小数的外接框量（offsetLeft / offsetWidth 是取整的，会留下约 1px 的重叠）；外接框带画幅缩放 S，换回未缩放的像素
    const b = el.getBoundingClientRect();
    const pos = (v ? b.top : b.left) / S + p0;
    const len = (v ? b.height : b.width) / S - p0 - p1;
    const sg = el.closest('.lp-seg') ?? l.tx;
    if (sg !== seg) {
      segStart = i === 0 ? 0 : end + gap;
      segBase = pos;
      seg = sg;
    }
    r.left = segStart + (pos - segBase);
    r.w = len;
    end = r.left + r.w;
  });
  for (const r of l.rts) r.lineW = end;
}



export function LyricPage({ lines, loading = false, songKey, lsOpen = false }: LyricPageProps) {
  const lab = useSpaceLab();
  const active = lab.stageMode === 'page';
  const listen = useListenSettings();
  const showTranslation = listen.translation;
  const { lyricSettings: settings } = useInterfaceSettingsContext();
  const playState = useAudioPlayer();
  const playingRef = useRef(playState.playing);
  playingRef.current = playState.playing;
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const morphRef = useRef<HTMLDivElement>(null);
  const lsOpenRef = useRef(lsOpen);
  lsOpenRef.current = lsOpen;
  /** 本次打开听音空间是否从版面聆听态起飞（跨切歌/重排版持久化，避免 ListenSpace 内切歌后收起误丢版面回飞）。 */
  const enteredFromPageRef = useRef(false);
  const pinRef = useRef(settings.listenPin);
  pinRef.current = settings.listenPin;
  const roamRef = useRef(settings.roamLyrics);
  roamRef.current = settings.roamLyrics;
  // 开发 / QA：强制某套版式后重新建页（__nebulaLyricPage.force）
  const [rev, setRev] = useState(0);
  const schemeRef = useRef(listen.scheme);
  schemeRef.current = listen.scheme;

  const model = useMemo(() => {
    const src = lines.filter(usable);
    const pace = songPace(src);
    const els = src.map((l, i) => toEngineLine(l, src[i + 1] ? src[i + 1]!.timeMs / 1000 : undefined, pace)).sort((a, b) => a.s - b.s);
    const shape = analyzeSong(els.map((e) => ({ s: e.s, e: e.e, text: e.text })));
    return { els, shape, script: detectScript(lines) };
  }, [lines]);
  const vert = model.script === 'zh';
  const typo = TYPO[listen.font][model.script];

  // 根元素标记：星云在版面模式下沉成纸面（styles.css）
  useEffect(() => {
    if (!active) return;
    const d = document.documentElement.dataset;
    d.stageMode = 'page';
    return () => {
      delete d.stageMode;
    };
  }, [active]);

  // 切歌取词加载三点：用 useLayoutEffect 在首帧绘制前同步挂上 .is-arrive，杜绝先满显一帧再闪暗淡入
  const showLoading = !!loading && model.els.length === 0;
  const [arriving, setArriving] = useState(false);
  const wasLoadingRef = useRef(false);
  const arriveTimerRef = useRef(0);
  useLayoutEffect(() => {
    if (showLoading) {
      wasLoadingRef.current = true;
      window.clearTimeout(arriveTimerRef.current);
      setArriving(false);
      return;
    }
    if (wasLoadingRef.current && model.els.length > 0) {
      wasLoadingRef.current = false;
      setArriving(true);
      window.clearTimeout(arriveTimerRef.current);
      arriveTimerRef.current = window.setTimeout(() => setArriving(false), 340);
    } else if (!loading && model.els.length === 0) {
      wasLoadingRef.current = false;
      setArriving(false);
    }
  }, [showLoading, loading, model.els.length]);
  useEffect(() => () => window.clearTimeout(arriveTimerRef.current), []);

  useEffect(() => {
    const root = rootRef.current;
    const frame = frameRef.current;
    if (!active) {
      enteredFromPageRef.current = false;
      return;
    }
    if (!root || !frame) return;
    frame.textContent = '';
    const { els, shape } = model;
    const total = shape.stanzas.length;
    // —— 建页：版式按段落轮换（lyric-page/pools.ts：稳和险交替，大胆版式一首歌最多一次，相邻两页不重复）——
    const lang: TCtx['lang'] = model.script === 'zh' ? 'zh' : model.script === 'ja' ? 'ja' : model.script === 'ko' ? 'ko' : 'en';
    const cjk = lang !== 'en';
    const chorusUnits = els.filter((_, k) => shape.sections[shape.lineSection[k] ?? -1]?.kind === 'chorus').map((e) => (cjk ? [e.units ? e.units.map((u) => u.t + (u.sp ? ' ' : '')).join('') : e.text] : (e.units ?? []).map((u) => u.t)));
    const hook = songHook(chorusUnits, cjk);
    let lastChorusSec = -1;
    shape.sections.forEach((s, i) => {
      if (s.kind === 'chorus') lastChorusSec = i;
    });
    const lastChorusStz = shape.stanzas.findIndex((z) => z.section === lastChorusSec);
    // 量尺寸：未变换的外接框 ÷ 画幅缩放（排版时随时更新）
    let S0 = 1;
    const size = (el: HTMLElement) => {
      const b = el.getBoundingClientRect();
      return { w: b.width / S0, h: b.height / S0 };
    };
    const pick = newPickState();
    const pages: PPage[] = shape.stanzas.map((stz, j) => {
      const sec = shape.sections[stz.section]!;
      const el = document.createElement('div');
      el.className = 'lp-page';
      // 页眉只留页码（用户 2026-11-22：不写这页是哪一段）
      const no = document.createElement('div');
      no.className = 'lp-no';
      no.textContent = `${String(j + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
      el.append(no);
      const pl: PLine[] = [];
      for (let k = stz.from; k <= stz.to; k++) {
        const e = els[k]!;
        const line = document.createElement('div');
        line.className = 'lp-line';
        const tx = document.createElement('div');
        tx.className = 'lp-tx';
        let rts: UnitRt[] | null = null;
        let whole: HTMLElement | null = null;
        if (e.units) {
          rts = renderUnits(tx, e.units);
          // 羽化宽度的数值版（lyric-page.css 按「字本身」而不是「含上色留白的盒子」铺扫光，要拿它乘字宽）
          for (const r of rts) r.v.el.style.setProperty('--fn', r.u.cjk ? '0.42' : '0.26');
        }
        else {
          whole = document.createElement('span');
          whole.className = 'lp-whole';
          whole.textContent = e.text;
          tx.appendChild(whole);
        }
        line.appendChild(tx);
        let tr: HTMLElement | null = null;
        if (showTranslation && !vert && e.tr) {
          tr = document.createElement('div');
          tr.className = 'lp-tr';
          tr.textContent = e.tr;
          line.appendChild(tr);
        }
        el.appendChild(line);
        pl.push({ eng: e, el: line, tx, tr, rts, whole, units: rts ? rts.map((r) => r.v.el) : [], eu: e.units, text: e.text, ts: e.s, te: e.e, vert, rot: 0, state: 'future', active: false, w: 0, h: 0 });
      }
      frame.appendChild(el);
      const ctx: TCtx = { page: el, lines: pl, kind: sec.kind, vert, cjk, lang, hasTr: pl.some((l) => l.tr), hook, lastChorus: j === lastChorusStz, song: els, first: stz.from, size };
      let tpl = pickTpl(ctx, pick);
      if (tpl.dir) ctx.vert = tpl.dir === 'v';
      // 强制横排的经典版式不存在（经典竖排只给中文）：中文歌里这种页面若退到经典版式，用横排左栏
      if (!tpl.layout && ctx.vert !== vert) tpl = FALLBACK_H;
      el.className = `lp-page tpl-${tpl.id}${cjk ? ' is-cjk' : ''} lang-${lang}${ctx.vert ? ' is-vert' : ''}`;
      return { el, lines: pl, kind: sec.kind, tpl, ctx, hooks: null, s: stz.s, e: stz.e, tIn: 0, tOut: Infinity, on: false };
    });
    // —— 换页时刻：长空档（间奏）里上一页唱完 1.4s 后淡出、下一页提前 2.2s 出现；否则唱完就换（最多提前 0.9s） ——
    pages.forEach((p, j) => {
      const prev = pages[j - 1];
      if (!prev) {
        p.tIn = -1;
        return;
      }
      const long = p.s - prev.e >= 4;
      p.tIn = long ? p.s - 2.2 : Math.max(prev.e + 0.1, p.s - 0.9);
      prev.tOut = long ? prev.e + 1.4 : p.tIn;
    });
    // —— 间奏三点（用户 2026-11-22：间奏时画面别空着）：和听音空间同一套——随进度逐个亮起、整体呼吸、收拢。
    // 只占「真正空白」的那段：上一页淡出之后（唱完 1.4s + 0.7s），到下一页提前 2.2s 出现时收拢；放在画面正中 ——
    const gapDots = shape.gaps
      .filter((g) => g.kind === 'interlude')
      .map((g) => ({ s: g.s + 1.6, e: g.e - 2.2 }))
      .filter((g) => g.e - g.s >= 1)
      .map((g) => {
        const el = document.createElement('div');
        el.className = 'lp-gap';
        el.innerHTML = '<i></i><i></i><i></i>';
        frame.appendChild(el);
        return { ...g, el, dots: [...el.querySelectorAll<HTMLElement>('i')], on: false };
      });
    // —— 排版：先恢复成刚建好的样子，再按版式平排（经典版式按最挤的那句整页缩小）、量字、最后旋转 / 加装饰 ——
    const layoutAll = () => {
      // 画幅当前的缩放（第一次排版时还没 fit，就是 1）：量出来的外接框除以它，得到未缩放的像素
      S0 = frame.getBoundingClientRect().width / PW || 1;
      for (const pg of pages) {
        pg.el.style.display = 'block';
        resetPage(pg);
        pg.el.classList.add('is-measuring');
        if (pg.tpl.layout) pg.tpl.layout(pg.ctx);
        else {
          layoutClassic(pg, 1);
          let f = 1;
          const n = pg.lines.length;
          pg.lines.forEach((l, i) => {
            l.w = l.tx.offsetWidth;
            l.h = l.tx.offsetHeight;
            const need = pg.ctx.vert ? l.h : l.w;
            if (need > 0) f = Math.min(f, pg.tpl.room!(i, n) / need);
          });
          f = clamp(f, 0.45, 1);
          layoutClassic(pg, f);
        }
        for (const l of pg.lines) {
          l.el.classList.toggle('is-vert', l.vert);
          measureLine(l, S0);
          // 浮起量按字号封顶（lyric-page.css 的 --lfk）：相当于不超过 52px 的字，粗大写（满版齐行 / 书脊）再乘 .7
          const heavy = l.el.classList.contains('lt-heavy') ? 0.7 : 1;
          for (const u of l.units) {
            const fpx = parseFloat(getComputedStyle(u).fontSize) || 40;
            u.style.setProperty('--lfk', (u.classList.contains('lp-still') ? 0 : Math.min(1, 52 / fpx) * heavy).toFixed(3));
          }
        }
        pg.el.classList.remove('is-measuring');
        pg.hooks = pg.tpl.finish?.(pg.ctx) || null;
        pg.el.style.display = pg.on ? 'block' : 'none';
      }
    };
    layoutAll();
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) layoutAll();
    });
    // —— 等比缩放到窗口 ——
    const fit = () => {
      const s = Math.min(root.clientWidth / PW, root.clientHeight / PH);
      frame.style.transform = `translate(-50%, -50%) scale(${s.toFixed(4)})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root);

    // —— 逐帧 ——
    let raf = 0;
    let last = performance.now();
    let lastPos = -1;
    let extrap = 0;
    let smoothT = 0;
    let rootOp = '';

    // —— 转场：逐字飞入 / 飞回（用户 2026-11-22 提议；第三版「克隆替身」）——
    // 交接一开始就抓住「最近开始唱的那一句」（两句之间的空档也算上一句）。每个字带两份克隆：
    //   A = 漫游歌词（或字幕）里那个字的原样复制，B = 版面上那个字的原样复制（扫光进度、长音光、颜色每帧从原字同步）；
    // 两份沿同一条路线飞（中心、视觉字号、倾斜随交接进度 --lk 插值），途中 A 渐变成 B。
    // B 按版面上那个字未变换时的真实盒子落位：交接走完时 B 和版面上的字逐像素重合，直接换成真字，没有落回的跳动；
    // 离开聆听时同理，飞回去时 A 和漫游歌词逐像素重合。竖排时 B 本身按竖排排（字距、扫光方向同版面）。
    interface MorphUnit {
      src: HTMLElement;
      tgt: HTMLElement;
      a: HTMLElement;
      b: HTMLElement;
      ac: HTMLElement;
      bc: HTMLElement;
      /** 两头原字的字号（未缩放）与自然盒子。 */
      fsA: number;
      fsB: number;
      aw: number;
      ah: number;
      bw: number;
      bh: number;
      lastS: DOMRect;
      lastT: { x: number; y: number; f: number } | null;
      /** 字形中心相对盒子中心的偏移（未缩放像素）：字距加在字后面、上色留白上下不等。 */
      gA: [number, number];
      gB: [number, number];
      /** 版面上那个字的倾斜（度：整句倾斜，或沿弧线摆时这个字自己的角度）。 */
      tr: number;
    }
    interface Morph {
      line: PLine;
      page: PPage;
      units: MorphUnit[];
      ctxA: HTMLElement;
      ctxB: HTMLElement;
      srcHost: HTMLElement;
      rot: number;
    }
    let morph: Morph | null = null;
    let morphTried = false;
    const fsOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).fontSize) || 16;
    const textOf = (els: HTMLElement[]) => els.map((e) => e.textContent ?? '').join('').replace(/\s+/g, '');
    /** 把原字的逐帧状态（行内变量、glow 等类名，含拉丁长音拆开的字母）同步到克隆上。 */
    const syncClone = (from: HTMLElement, to: HTMLElement) => {
      if (to.style.cssText !== from.style.cssText) to.style.cssText = from.style.cssText;
      if (to.className !== from.className) to.className = from.className;
      const fc = from.children;
      const tc = to.children;
      for (let i = 0; i < fc.length && i < tc.length; i++) syncClone(fc[i] as HTMLElement, tc[i] as HTMLElement);
    };
    /** 克隆所在的排版环境：字体、字重、字距、行高、斜体、没在扫的字的颜色，照抄原字算出来的值。 */
    const copyType = (ctx: HTMLElement, from: HTMLElement) => {
      const cs = getComputedStyle(from);
      ctx.style.fontFamily = cs.fontFamily;
      ctx.style.fontWeight = cs.fontWeight;
      ctx.style.fontStyle = cs.fontStyle;
      ctx.style.letterSpacing = cs.letterSpacing;
      ctx.style.lineHeight = cs.lineHeight;
      ctx.style.textTransform = cs.textTransform;
      const to = cs.getPropertyValue('text-orientation');
      if (to) ctx.style.setProperty('text-orientation', to);
      for (const v of ['--lc-rest', '--lp-ink', '--lc-a', '--lp-pc']) {
        const val = cs.getPropertyValue(v);
        if (val) ctx.style.setProperty(v, val);
      }
    };
    const startMorph = (t: number): Morph | null => {
      const layer = morphRef.current;
      if (!layer) return null;
      let line: PLine | null = null;
      let page: PPage | null = null;
      for (const pg of pages) for (const l of pg.lines) if (l.eng.s <= t + 0.05 && (!line || l.eng.s >= line.eng.s)) {
        line = l;
        page = pg;
      }
      if (!line || !page?.on) return null;
      const caption = roamRef.current === 'caption';
      const host = document.querySelector<HTMLElement>(caption ? '.lyric-caption > .is-grad' : '.lyrics-layer .flow-lyric.is-current .fl-words');
      if (!host) return null;
      const src = [...host.querySelectorAll<HTMLElement>(':scope > .u, :scope > .fl-whole')];
      const tgt = line.rts ? line.rts.map((r) => r.v.el) : line.whole ? [line.whole] : [];
      if (!src.length || src.length !== tgt.length || textOf(src) !== textOf(tgt)) return null;
      const srcHost = (caption ? host : host.closest<HTMLElement>('.flow-lyric')) ?? host;
      const m = (srcHost.style.transform.match(/rotate\((-?[\d.]+)deg\)/) ?? [])[1];
      layer.textContent = '';
      const ctxA = document.createElement('div');
      ctxA.className = 'lpm-ctx lpm-a';
      const ctxB = document.createElement('div');
      // 创建时就带上这一行的状态和竖排：下面量克隆的自然盒子要在最终的排版环境里量
      ctxB.className = `lpm-ctx lpm-b ${line.el.className}`;
      layer.append(ctxA, ctxB);
      copyType(ctxA, src[0]!);
      copyType(ctxB, tgt[0]!);
      const pre = src.map((s, i) => {
        const g = tgt[i]!;
        const bv = unitVert(line, g);
        const fsA = fsOf(s);
        const fsB = fsOf(g);
        const lsA = parseFloat(getComputedStyle(s).letterSpacing) || 0;
        const lsB = parseFloat(getComputedStyle(g).letterSpacing) || 0;
        const tr = rotTarget(line, g);
        const lastS = s.getBoundingClientRect();
        return { s, g, bv, fsA, fsB, lsA, lsB, tr, lastS };
      });
      // 第一遍（集中写入）：批量挂入所有克隆并设好字号，避免逐字读写交错触发布局抖动
      const built = pre.map((item) => {
        const a = document.createElement('span');
        a.className = 'lpm-u';
        const ac = item.s.cloneNode(true) as HTMLElement;
        a.appendChild(ac);
        ctxA.appendChild(a);
        const b = document.createElement('span');
        // 版面那份按目标字自己的读向排（一句跨横竖两截时每个字不同），字体照抄目标字（一句里可能混两种字号字体）
        b.className = item.bv ? 'lpm-u is-v' : 'lpm-u';
        copyType(b, item.g);
        const bc = item.g.cloneNode(true) as HTMLElement;
        b.appendChild(bc);
        ctxB.appendChild(b);
        a.style.fontSize = `${item.fsA}px`;
        b.style.fontSize = `${item.fsB}px`;
        return { ...item, a, b, ac, bc };
      });
      // 第二遍（单次集中读取）：一次性量取所有自然盒子尺寸
      const units = built.map((u): MorphUnit => {
        // 自然盒子用定位框（还没加变换）的小数实测，不用取整的 offsetWidth
        const ra = u.a.getBoundingClientRect();
        const rb = u.b.getBoundingClientRect();
        // 版面那份：上下留白 .12em / .16em；横排字距加在右边，竖排加在下边
        const gA: [number, number] = [-u.lsA / 2, 0];
        const gB0: [number, number] = u.bv ? [0, -u.lsB / 2 - 0.02 * u.fsB] : [-u.lsB / 2, -0.02 * u.fsB];
        const rc = Math.cos((u.tr * Math.PI) / 180);
        const rsn = Math.sin((u.tr * Math.PI) / 180);
        const gB: [number, number] = [gB0[0] * rc - gB0[1] * rsn, gB0[0] * rsn + gB0[1] * rc];
        return {
          gA,
          gB,
          tr: u.tr,
          src: u.s,
          tgt: u.g,
          a: u.a,
          b: u.b,
          ac: u.ac,
          bc: u.bc,
          fsA: u.fsA,
          fsB: u.fsB,
          aw: ra.width || u.s.offsetWidth,
          ah: ra.height || u.s.offsetHeight || 1,
          bw: rb.width || u.g.offsetWidth,
          bh: rb.height || u.g.offsetHeight || 1,
          lastS: u.lastS,
          lastT: null,
        };
      });
      pageBus.morph = true;
      pageBus.morphS = line.eng.s;
      pageBus.caption = caption;
      return { line, page, units, ctxA, ctxB, srcHost, rot: m ? Number(m) : 0 };
    };
    const endMorph = () => {
      const layer = morphRef.current;
      if (layer) {
        layer.textContent = '';
        layer.style.opacity = '0';
      }
      if (morph) morph.line.el.style.opacity = '';
      morph = null;
      pageBus.morph = false;
    };
    /** 原字自己的变换（波浪浮起、长音放大）让外接框中心偏了多少：按「没浮起时」的盒子定位，克隆同步了同样的变换。
     *  vs = 视觉缩放，theta = 所在句子的倾斜（弧度），h = 盒子高（未缩放），oy = transform-origin 的纵向比例。 */
    const ownShift = (el: HTMLElement, vs: number, theta: number, h: number, oy: number): { dx: number; dy: number; sc: number } => {
      const tf = getComputedStyle(el).transform;
      if (!tf || tf === 'none') return { dx: 0, dy: 0, sc: 1 };
      const m = new DOMMatrixReadOnly(tf);
      const lx = m.e;
      const ly = m.f + (0.5 - oy) * h * (m.a - 1);
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      return { dx: (lx * c - ly * s) * vs, dy: (lx * s + ly * c) * vs, sc: m.a || 1 };
    };
    /** 版面上一个字的倾斜：沿弧线摆的字带自己的角度（外壳上的 data-rot），否则是整句的倾斜。 */
    const rotTarget = (l: PLine, el: HTMLElement) => {
      const w = el.closest<HTMLElement>('[data-rot]');
      return w ? Number(w.dataset.rot) || 0 : l.rot;
    };
    const rotOf = (el: HTMLElement) => Number((el.style.transform.match(/rotate\((-?[\d.]+)deg\)/) ?? [])[1] ?? 0);
    const stepMorph = (mo: Morph, k: number) => {
      const layer = morphRef.current;
      if (!layer) return;
      // 第一遍（集中读取，零写入）：每帧只触发布局计算一次
      const box = layer.getBoundingClientRect();
      // 样张 N 起句子可能整句旋转，不能再用这一句的外接框反推：直接取画幅的缩放
      const S = frame.getBoundingClientRect().width / PW || 1;
      const srcGrad = mo.srcHost.classList.contains('is-grad');
      const lineGrad = mo.line.el.classList.contains('is-grad');
      if (mo.srcHost.isConnected) mo.rot = rotOf(mo.srcHost);
      const th = (mo.rot * Math.PI) / 180;
      const cos = Math.abs(Math.cos(th));
      const sin = Math.abs(Math.sin(th));
      const meas = mo.units.map((u) => {
        // 起点：漫游里那个字（外接框按倾斜反推视觉缩放，再扣掉它自己的浮起 / 放大）；原句被回收时用最后一次量到的
        let rs = u.src.getBoundingClientRect();
        if (rs.width > 0 && u.src.isConnected) u.lastS = rs;
        else rs = u.lastS;
        const vsAll = (rs.width + rs.height) / ((u.aw + u.ah) * (cos + sin) || 1);
        const ty = u.b.classList.contains('is-v') ? 0.5 : 0.85;
        const oa =
          u.src.isConnected && (srcGrad || u.src.classList.contains('fl-whole'))
            ? ownShift(u.src, vsAll, th, u.ah, 0.85)
            : { dx: 0, dy: 0, sc: 1 };
        // 终点：版面上那个字没浮起时的盒子中心，视觉字号 = 字号 × S
        let T = u.lastT;
        const rt = u.tgt.getBoundingClientRect();
        if (rt.width > 0) {
          const ob =
            lineGrad || u.tgt.classList.contains('lp-whole')
              ? ownShift(u.tgt, S, (u.tr * Math.PI) / 180, u.bh, ty)
              : { dx: 0, dy: 0, sc: 1 };
          T = { x: rt.left + rt.width / 2 - ob.dx - box.left, y: rt.top + rt.height / 2 - ob.dy - box.top, f: u.fsB * S };
          u.lastT = T;
        }
        // 看上去的位置和盒子不一样的字（断层错开的那半、滚筒上压扁的行）：终点跟着算
        const adj = mo.page.hooks?.fly?.(u.tgt) ?? null;
        return { rs, vsAll, oa, T: T && adj ? { x: T.x + adj.dx * S, y: T.y + adj.dy * S, f: T.f } : T, adj };
      });

      // 第二遍（集中写入样式与变换）
      layer.style.opacity = '1';
      mo.line.el.style.opacity = '0';
      mo.ctxA.classList.toggle('is-grad', srcGrad);
      mo.ctxB.className = `lpm-ctx lpm-b ${mo.line.el.className}`;
      // 途中 A 渐变成 B（.2 → .8），差异在运动中化掉
      const q = smooth((k - 0.2) / 0.6);
      mo.ctxA.style.opacity = (1 - q).toFixed(3);
      mo.ctxB.style.opacity = q.toFixed(3);
      // 原字的波浪浮起 / 长音放大只在两端保留：漫游那份起飞后 .2 内收平，版面那份 .8 之后才浮起，渐变那段两份都是平的
      mo.ctxA.style.setProperty('--lw', (1 - smooth(k / 0.2)).toFixed(3));
      mo.ctxB.style.setProperty('--lw', smooth((k - 0.8) / 0.2).toFixed(3));
      for (let i = 0; i < mo.units.length; i++) {
        const u = mo.units[i]!;
        const { rs, vsAll, oa, T: measuredT, adj } = meas[i]!;
        const qx = 1 + ((adj?.sx ?? 1) - 1) * k;
        const qy = 1 + ((adj?.sy ?? 1) - 1) * k;
        const rot = mo.rot * (1 - k) + u.tr * k;
        syncClone(u.src, u.ac);
        syncClone(u.tgt, u.bc);
        const vsA = vsAll / oa.sc;
        const sx = rs.left + rs.width / 2 - oa.dx - box.left;
        const sy = rs.top + rs.height / 2 - oa.dy - box.top;
        const sf = u.fsA * vsA;
        const T = measuredT ?? { x: sx, y: sy, f: sf };
        // 两份克隆的字形中心始终重合（G）；起点按漫游那份的盒子、终点按版面那份的盒子精确落位
        const f = sf + (T.f - sf) * k;
        const sA = f / u.fsA;
        const sB = f / u.fsB;
        const gx = sx + u.gA[0] * vsA + (T.x + u.gB[0] * S - (sx + u.gA[0] * vsA)) * k;
        const gy = sy + u.gA[1] * vsA + (T.y + u.gB[1] * S - (sy + u.gA[1] * vsA)) * k;
        const ax = gx - u.gA[0] * sA;
        const ay = gy - u.gA[1] * sA;
        const bx = gx - u.gB[0] * sB;
        const by = gy - u.gB[1] * sB;
        u.a.style.transform = `translate(${(ax - u.aw / 2).toFixed(3)}px, ${(ay - u.ah / 2).toFixed(3)}px) scale(${(sA * qx).toFixed(5)}, ${(sA * qy).toFixed(5)}) rotate(${rot.toFixed(3)}deg)`;
        u.b.style.transform = `translate(${(bx - u.bw / 2).toFixed(3)}px, ${(by - u.bh / 2).toFixed(3)}px) scale(${(sB * qx).toFixed(5)}, ${(sB * qy).toFixed(5)}) rotate(${rot.toFixed(3)}deg)`;
      }
    };

    // 测试探针（QA 用）：把替身推到交接进度 kk，量每个字和两头真字的偏差（中心 x / y、宽、高，像素）
    const probeWin = window as unknown as {
      __nebulaLyricPage?: {
        probe: (kk: number) => number[][] | null;
        pair: (kk: number) => number[][] | null;
        overlap: () => number;
        pages: () => { tpl: string; s: number; vert: boolean }[];
        force: (id: string | null) => void;
        bounds: () => { tpl: string; units: number; out: number; clash: number; bar: number; no: number }[];
        lsProbe: () => { n: number; err: number[][]; off: number } | null;
        lsLog: string[];
      };
    };
    probeWin.__nebulaLyricPage = {
      probe: (kk) => {
        if (!morph) return null;
        stepMorph(morph, kk);
        return morph.units.map((u) => {
          const a = (kk >= 0.5 ? u.bc : u.ac).getBoundingClientRect();
          const b = (kk >= 0.5 ? u.tgt : u.src).getBoundingClientRect();
          const o = kk >= 0.5 ? (morph?.page.hooks?.fly?.(u.tgt) ?? null) : null;
          const S = frame.getBoundingClientRect().width / PW || 1;
          return [a.left + a.width / 2 - (b.left + b.width / 2) - (o?.dx ?? 0) * S, a.top + a.height / 2 - (b.top + b.height / 2) - (o?.dy ?? 0) * S, a.width - b.width, a.height - b.height].map((v) => Math.round(v * 100) / 100);
        });
      },
      // 版面上每一句里相邻两个字「量出来的范围」最多重叠多少像素（应 ≤ 0：演唱位置只往前走）
      // 版面 ↔ 听音空间替身：推到终点量落位（每个字终点那份克隆和真字的中心差）
      get lsLog() {
        return lsLog;
      },
      lsProbe: () => {
        if (!lsFly) return null;
        lsFly.render(1);
        const err = lsFly.probe();
        // 飞到歌词栏范围外的字（应为 0）
        const box = document.querySelector('.ls-col')?.getBoundingClientRect();
        const off = box ? lsFly.targets().filter((el) => { const r = el.getBoundingClientRect(); return r.top < box.top - 2 || r.bottom > box.bottom + 2; }).length : 0;
        return { n: err.length, err, off };
      },
      // 每页用的版式和开始时间（QA 按它跳到某套版式的页）
      pages: () => pages.map((p) => ({ tpl: p.tpl.id, s: p.s, vert: p.ctx.vert })),
      // 强制所有能用的页都用某套版式（null = 恢复轮换），重新建页
      force: (id) => {
        try {
          if (id) localStorage.setItem('nebula.pageTpl', id);
          else localStorage.removeItem('nebula.pageTpl');
        } catch {
          /* 无痕模式等：忽略 */
        }
        setRev((r) => r + 1);
      },
      // 正在显示的页：多少个字跑出画幅（超出 2px 以上）、不同句子的字最多互相压住多少（屏幕像素，取两字重叠矩形的短边）
      bounds: () => {
        const fr = frame.getBoundingClientRect();
        return pages
          .filter((p) => p.on)
          .map((p) => {
            // 滚到筒边上的行（data-edge）压得很扁、本来就该出画；错版套印的第二块版本来就印在第一块上：都不算
            // 量字本身（扣掉四周的上色留白）：撑满版面宽度的大字，留白本来就伸出画幅
            const inner = (u: HTMLElement) => {
              const r = u.getBoundingClientRect();
              const cs = getComputedStyle(u);
              const k = r.width / (u.offsetWidth || r.width || 1);
              const n = (v: string) => (parseFloat(v) || 0) * k;
              return new DOMRect(r.left + n(cs.paddingLeft), r.top + n(cs.paddingTop), r.width - n(cs.paddingLeft) - n(cs.paddingRight), r.height - n(cs.paddingTop) - n(cs.paddingBottom));
            };
            const rs = p.lines.map((l) => l.units.filter((u) => !u.closest('.lp-deco, [data-edge], .lp-plate.is-b')).map(inner));
            let out = 0;
            let clash = 0;
            rs.flat().forEach((r) => {
              if (r.left < fr.left - 2 || r.right > fr.right + 2 || r.top < fr.top - 2 || r.bottom > fr.bottom + 2) out++;
            });
            // 字的盒子带上色留白（四周 .12–.2em），比字形大：两字之间按缩进 22% 的盒子算重叠
            const shrink = (r: DOMRect) => ({ l: r.left + r.width * 0.22, r: r.right - r.width * 0.22, t: r.top + r.height * 0.22, b: r.bottom - r.height * 0.22 });
            for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) for (const x of rs[a]!) for (const y of rs[b]!) {
              const A = shrink(x);
              const B = shrink(y);
              const w = Math.min(A.r, B.r) - Math.max(A.l, B.l);
              const h = Math.min(A.b, B.b) - Math.max(A.t, B.t);
              if (w > 0 && h > 0) clash = Math.max(clash, Math.min(w, h));
            }
            // 播放条与页码（2026-11-25 真实数据审查：QA 只量 1600 × 900 画幅，压进播放条、压住页码的字量不出来）：
            // bar = 被播放条盖住的字 / 译文数；no = 压住本页页码的字 / 译文数。
            // 出血大字（lp-deco）、套印的两块版、镂空大字是有意沉到播放条玻璃后面的大字（用户 2026-11-25 定：像水面倒影），不算
            const hit = (a: DOMRect, b: DOMRect, pad = 2) => a.right > b.left + pad && a.left < b.right - pad && a.bottom > b.top + pad && a.top < b.bottom - pad;
            const barR = document.querySelector('.bp-shell')?.getBoundingClientRect() ?? null;
            const noEl = p.el.querySelector<HTMLElement>('.lp-no');
            const noR = noEl && getComputedStyle(noEl).display !== 'none' && getComputedStyle(noEl).visibility !== 'hidden' && Number(getComputedStyle(noEl).opacity) > 0.05 ? noEl.getBoundingClientRect() : null;
            const texts: Array<{ r: DOMRect; big: boolean }> = [];
            p.lines.forEach((l) => {
              l.units.forEach((u) => {
                if (u.closest('.lp-deco, [data-edge], .lp-plate.is-b')) return;
                texts.push({ r: inner(u), big: !!u.closest('.lp-plate, .lp-cut-big') });
              });
              if (l.tr && l.tr.offsetParent && Number(getComputedStyle(l.tr).opacity) > 0.05) texts.push({ r: l.tr.getBoundingClientRect(), big: false });
            });
            const bar = barR && barR.height > 0 ? texts.filter((t) => !t.big && hit(t.r, barR)).length : 0;
            const no = noR && noR.width > 0 ? texts.filter((t) => hit(t.r, noR, 0)).length : 0;
            return { tpl: p.tpl.id, units: rs.flat().length, out, clash: Math.round(clash * 10) / 10, bar, no };
          });
      },
      overlap: () => {
        let worst = -Infinity;
        for (const pg of pages) for (const l of pg.lines) {
          const r = l.rts;
          if (!r) continue;
          for (let i = 1; i < r.length; i++) worst = Math.max(worst, r[i - 1]!.left + r[i - 1]!.w - r[i]!.left);
        }
        return Math.round(worst * 100) / 100;
      },
      // 两份克隆在交接进度 kk 时各自的盒子中心之差（看飞行途中会不会错位重影）
      pair: (kk) => {
        if (!morph) return null;
        stepMorph(morph, kk);
        return morph.units.map((u) => {
          const a = u.ac.getBoundingClientRect();
          const b = u.bc.getBoundingClientRect();
          return [a.left + a.width / 2 - (b.left + b.width / 2), a.top + a.height / 2 - (b.top + b.height / 2), a.width, b.width, a.height, b.height].map((v) => Math.round(v * 10) / 10);
        });
      },
    };

    // —— 版面 ↔ 听音空间一镜到底（共用引擎 lib/listen/flyTransition.ts）——
    let lsFly: LsFly | null = null;
    let lsFlyPage: PPage | null = null;
    const endLsFly = (t: number) => {
      lsFly?.end();
      lsFly = null;
      if (lsFlyPage) {
        lsFlyPage.hooks?.frame?.(t);
        lsFlyPage = null;
      }
    };
    /** 听音空间打开期间，不管一镜到底是否匹配成功，版面必须在 330ms 内统一淡出并在稳态保持 opacity = 0。 */
    const LS_FADE_OUT_MS = 330;
    /** 翻页过渡瞬间可能尚未拿到 >0.5 透明度的页，300ms 淡出窗口内每 60ms 补试一次。 */
    let lsWantAt = 0;
    let lsAttemptAt = 0;
    /** 一镜到底的起落记录（QA 排查用，最多 20 条）。 */
    const lsLog: string[] = [];
    const lsNote = (m: string) => {
      lsLog.push(m);
      if (lsLog.length > 20) lsLog.shift();
    };
    let lsPrev = lsOpenRef.current;
    /**
     * 听音空间遮罩逻辑状态：
     * - `-1`：effect 启动时听音空间已开启（如听音空间内切歌/加载新歌词/切翻译/切字体），或从漫游态进入，直接置 0；
     * - `0`：听音空间未开启，不压暗（fade = 1）；
     * - `> 0`：刚从有可见度的版面点开听音空间的时间戳，无论 lsFly 是否启动，330ms 内退到 0 并保持 0。
     */
    let lsFadeT0 = lsPrev ? -1 : 0;
    if (lsPrev) {
      root.style.opacity = '0';
      rootOp = '0.000';
    }
    /** 收起听音空间、飞回版面期间版面直接满显（不等交接曲线慢慢升起），直到交接追上。 */
    let lsBoostUntil = 0;
    const unitsOfPage = (l: PLine): HTMLElement[] => (l.rts ? l.rts.map((r) => r.v.el) : l.whole ? [l.whole] : []);
    const pageSide = (pg: PPage, l: PLine, el: HTMLElement): FlySide => {
      const side: FlySide = { el, ctx: `lpm-b ${l.el.className}`, rot: rotTarget(l, el), vert: unitVert(l, el) };
      const fly = pg.hooks?.fly;
      if (fly) {
        side.adj = () => {
          const a = fly(el);
          if (!a) return null;
          const S = frame.getBoundingClientRect().width / PW || 1;
          return { dx: a.dx * S, dy: a.dy * S, sx: a.sx, sy: a.sy };
        };
      }
      // 版式自己压暗的行（滚筒两边）：起点 / 落地的透明度跟着走
      const op = el.closest<HTMLElement>('.lp-op');
      if (op) {
        side.opEl = op;
        side.opacity = parseFloat(getComputedStyle(op).opacity) || 0;
      }
      return side;
    };
    /** 现在该显示哪一页：已经出现的最后一页。 */
    const pageAt = (t: number): PPage | null => {
      let pg: PPage | null = null;
      for (const p of pages) if (p.tIn <= t) pg = p;
      return pg;
    };
    const queriesOfPage = (ls: PLine[], t: number) => {
      let curP = -1;
      ls.forEach((l, i) => {
        if (l.eng.s <= t + 0.05) curP = i;
      });
      if (curP < 0) curP = 0;
      return ls.map((l, i) => ({ text: l.eng.text, offsetFromCur: i - curP }));
    };
    const syncPageLines = (pg: PPage, t: number, scheme: 'accent' | 'mono') => {
      const ghost = GHOST[scheme === 'mono' ? 'mono' : 'cover'];
      for (const l of pg.lines) {
        const e = l.eng;
        const state: PLine['state'] = t > e.e + 0.9 ? 'past' : t >= e.s - 0.05 ? 'cur' : 'future';
        if (state !== l.state) {
          l.state = state;
          l.el.classList.toggle('is-grad', state === 'cur');
          l.el.classList.toggle('is-past', state === 'past');
          l.el.classList.toggle('is-cur', state === 'cur');
          if (state !== 'cur' && l.rts && l.active) {
            l.rts.forEach(restUnit);
            l.active = false;
          }
        }
        if (l.whole) l.whole.classList.toggle('is-on', t >= e.s);
        // 版式挪出句子的翻译（脚注、右栏……）：跟着所属句子亮起
        if (l.tr && l.tr.parentElement !== l.el) l.tr.classList.toggle('is-on', state !== 'future');
        if (state !== 'cur' || !l.rts?.length) continue;
        // 正在唱（和唱完后 0.9s 的尾韵）：扫光、波浪、长音；没唱到的部分是浅灰的「先印好」
        const singing = t <= e.e + 0.3;
        const rawWave = singing ? waveOf(l.rts, e.dens, t, PAGE_WAVE) : null;
        // 波浪在句首前已预淡入，候选句不应用；切入当前句后的 0.15s 内从 0 过渡接上，避免首帧轻跳
        const waveK = smooth(clamp((t - (e.s - 0.05)) / 0.15, 0, 1));
        const wave = rawWave ? (c: number) => rawWave(c) * waveK : null;
        for (const rt of l.rts) {
          unitFrame(rt, t, scheme, singing, wave, e.dens);
          rt.v.set('--un', ghost);
          rt.chs?.forEach((c) => c.set('--un', ghost));
        }
        if (!singing && l.active) l.rts.forEach(restUnit);
        l.active = singing;
      }
    };
    const startLsIn = (t: number) => {
      const pg = pages.find((p) => p.on && Number(p.el.style.opacity || 1) > 0.5) ?? null;
      lsNote(`in page=${pg ? pages.indexOf(pg) : -1}`);
      if (!pg) return;
      const queries = queriesOfPage(pg.lines, t);
      lsFly = launchStageToListenFly(
        pg.lines.map((l, i) => ({
          text: l.eng.text,
          offsetFromCur: queries[i]!.offsetFromCur,
          units: unitsOfPage(l),
          sideOf: (el) => pageSide(pg, l, el),
        })),
        {
          flightMs: 600,
          onMatchChange: (matched, total, prog) => lsNote(`cols matched ${matched}/${total} at ${prog.toFixed(2)}`),
        },
      );
      if (lsFly) {
        lsFlyPage = pg;
        pg.hooks?.frame?.(t);
      }
    };
    const startLsOut = (t: number) => {
      const pg = pageAt(t);
      if (!pg) return;
      for (const p of pages) {
        if (p !== pg && p.on) {
          p.el.style.display = 'none';
          p.on = false;
        }
      }
      if (!pg.on) {
        pg.el.style.display = 'block';
        pg.on = true;
      }
      pg.el.style.opacity = '1';
      pg.el.style.transform = 'translate3d(0, 0px, 0)';
      syncPageLines(pg, t, schemeRef.current);
      const cols = matchColumnLines(queriesOfPage(pg.lines, t));
      const pairs: FlyPair[] = [];
      pg.lines.forEach((l, li) => {
        const col = cols[li] ?? null;
        const us = columnUnitsOf(col);
        const ps = unitsOfPage(l);
        if (!col || !us.length || us.length !== ps.length) return;
        us.forEach((el, i) => pairs.push({ from: columnSideOf(col, el), to: pageSide(pg, l, ps[i]!) }));
      });
      lsBoostUntil = performance.now() + 2600;
      if (!pairs.length) return;
      lsFly = new LsFly(pairs, () => null, 700, hideFlyElements);
      if (lsFly.done) {
        lsFly = null;
        return;
      }
      lsFlyPage = pg;
      pg.hooks?.frame?.(t);
    };

    const tick = (now: number) => {
      const dt = clamp((now - last) / 1000, 0.001, 0.05);
      last = now;
      const playing = playingRef.current;
      const pos = audioPlayer.position();
      if (playing && pos === lastPos) extrap = Math.min(0.25, extrap + dt);
      else extrap = 0;
      lastPos = pos;
      let cand = playing ? pos + extrap : pos;
      // 读数刚更新时可能比外推值略小：保持单调，别让波浪往回抖（同听音空间 LyricColumn）
      if (playing && cand < smoothT && smoothT - cand < 0.15) cand = smoothT;
      smoothT = cand;
      const t = cand;
      const k = listenBus.enabled ? listenBus.k : 0;
      const pageOwnsStage = isPageStageActive(true, listenBus.enabled, k);
      const lsNow = lsOpenRef.current;
      if (lsNow !== lsPrev) {
        endLsFly(t);
        lsNote(`ls ${lsNow} k=${k.toFixed(2)}`);
        if (lsNow) {
          enteredFromPageRef.current = pageOwnsStage;
          lsFadeT0 = k > 0.001 ? now : -1;
          if (pageOwnsStage) {
            startLsIn(t);
            lsWantAt = lsFly ? 0 : now;
            lsAttemptAt = now;
          } else {
            lsWantAt = 0;
          }
        } else {
          lsWantAt = 0;
          lsFadeT0 = 0;
          if (pinRef.current && (enteredFromPageRef.current || pageOwnsStage)) {
            startLsOut(t);
          }
          enteredFromPageRef.current = false;
        }
        lsPrev = lsNow;
      }
      if (lsNow && enteredFromPageRef.current && !lsFly && lsWantAt && now - lsWantAt < 300 && now - lsAttemptAt > 60) {
        lsAttemptAt = now;
        startLsIn(t);
        if (lsFly) lsWantAt = 0;
      }
      const boost = now < lsBoostUntil && k < 0.99 ? 1 : 0;
      if (k >= 0.99) lsBoostUntil = 0;
      if (lsFly) {
        if (lsFly.step(now)) {
          lsFly = null;
          if (lsFlyPage) {
            lsFlyPage.hooks?.frame?.(t);
            lsFlyPage = null;
          }
        } else if (lsFlyPage && !(k > 0.001 || boost) && lsFlyPage.on) {
          lsFlyPage.hooks?.frame?.(t);
        }
      }
      const fade = !lsNow
        ? 1
        : lsFly
          ? 1 - smooth(lsFly.progress / 0.55)
          : lsFadeT0 > 0
            ? 1 - smooth((now - lsFadeT0) / LS_FADE_OUT_MS)
            : 0;
      const op = Math.min(Math.max(k, boost), fade).toFixed(3);
      if (op !== rootOp) {
        root.style.opacity = op;
        rootOp = op;
      }
      const pageVisible = (k > 0.001 || boost > 0) && (!lsNow || fade > 0.001 || !!lsFly);
      if (pageVisible) {
        const scheme = schemeRef.current;
        for (const pg of pages) {
          const inK = pg.tIn < 0 ? 1 : smooth((t - pg.tIn) / 0.9);
          const outK = smooth((t - pg.tOut) / 0.7);
          const vis = inK * (1 - outK);
          if (vis <= 0.001) {
            if (pg.on) {
              pg.el.style.display = 'none';
              pg.on = false;
            }
            continue;
          }
          if (!pg.on) {
            pg.el.style.display = 'block';
            pg.on = true;
          }
          pg.el.style.opacity = vis.toFixed(3);
          pg.hooks?.frame?.(t);
          pg.el.style.transform = `translate3d(0, ${((1 - inK) * 22 - outK * 16).toFixed(1)}px, 0)`;
          syncPageLines(pg, t, scheme);
        }
      }
      // —— 间奏三点：p = 这段空白的进度；淡入 0.5s，结束前 0.45s 收拢（同听音空间 engine.ts 的公式） ——
      for (const g of gapDots) {
        const show = pageVisible && t >= g.s - 0.5 && t <= g.e;
        if (show !== g.on) {
          g.el.style.display = show ? 'flex' : 'none';
          g.on = show;
        }
        if (!show) continue;
        const p = clamp((t - g.s) / Math.max(0.01, g.e - g.s), 0, 1);
        const tail = clamp((g.e - t) / 0.45, 0, 1) * smooth((t - (g.s - 0.5)) / 0.5);
        const breathe = 1 + 0.06 * Math.sin(t * Math.PI * 1.25);
        g.dots.forEach((d, i) => {
          const f = clamp(p * 3.1 - i, 0, 1);
          d.style.opacity = ((0.25 + 0.75 * f) * tail).toFixed(3);
          d.style.transform = `scale(${((0.8 + 0.2 * f) * breathe * (0.4 + 0.6 * tail)).toFixed(3)})`;
        });
      }
      // —— 转场：交接进行中才有；到达两端（完全聆听 / 完全漫游）就收掉替身。听音空间开着或刚收起飞回版面时不做漫游 ↔ 版面的转场 ——
      if (lsNow || lsFly || boost) {
        if (morph) endMorph();
        morphTried = true;
      } else if (k <= 0.001 || k >= 0.999) {
        if (morph) endMorph();
        morphTried = false;
      } else {
        if (!morph && !morphTried) {
          morphTried = true;
          morph = startMorph(t);
        }
        if (morph) stepMorph(morph, k);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      frame.textContent = '';
      root.style.opacity = '0';
      endMorph();
      lsFly?.end();
    };
  }, [active, model, vert, showTranslation, listen.font, songKey, rev]);

  if (!active) return null;
  const lcA = settings.lyricColorSource === 'custom' ? settings.customColor : 'var(--ly-a, rgb(238 240 244))';
  const vars = {
    '--lc-a': lcA,
    '--lc-font': typo.f,
    '--lc-ls': typo.ls,
    '--lyric-weight': settings.bold ? 700 : typo.w,
    '--lp-grain': `url(${grain()})`,
  } as CSSProperties;
  return (
    <>
      <div ref={rootRef} className={`lyric-page lw${vert ? ' is-vert' : ''}`} data-scheme={listen.scheme} style={vars} aria-hidden="true">
        {/* 纸面（样张 N，2026-11-22 用户定稿）：封面最深的色、九成不透明，随交接进度和版面一起升起，压住你设的背景与星云 */}
        <i className="lp-paper" />
        <i className="lp-grain" style={{ backgroundImage: `url(${grain()})` }} />
        <div
          ref={frameRef}
          className={`lp-frame${arriving ? ' is-arrive' : ''}`}
          onAnimationEnd={(e) => {
            if (e.animationName === 'lp-frame-arrive') {
              window.clearTimeout(arriveTimerRef.current);
              setArriving(false);
            }
          }}
        />
        <div className={`lp-loading${showLoading ? ' is-on' : ''}`} aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
      {/* 转场替身：不放在版面根里（版面根的透明度随交接从 0 起，替身要一直看得见） */}
      <div ref={morphRef} className="lp-morph lw" data-scheme={listen.scheme} style={vars} aria-hidden="true" />
    </>
  );
}
