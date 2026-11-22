import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
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
import './listen/lyric-words.css';
import './lyric-page.css';

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
  songKey?: string;
}

const PW = 1600;
const PH = 900;

const usable = (l: LyricLineUI | undefined) => !!l && (!!l.text?.trim() || !!l.words?.length);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

interface PLine {
  e: EngineLine;
  el: HTMLElement;
  tx: HTMLElement;
  tr: HTMLElement | null;
  rts: UnitRt[] | null;
  whole: HTMLElement | null;
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
  s: number;
  e: number;
  tIn: number;
  tOut: number;
  on: boolean;
}

/** 一句在一页上的位置（逻辑像素）。 */
interface Place {
  left?: number;
  right?: number;
  /** 居中：left = 0、width = 画幅宽、文字居中。 */
  center?: boolean;
  top: number;
  fs: number;
  /** 翻译排在哪：右栏旁注 / 原文下面。 */
  tr: 'side' | 'under';
}

/** 一套版式。f = 整页字号缩放（长句塞不下时 < 1）；w = 这句按原字号量出的宽（横排）。 */
interface Tpl {
  id: string;
  italic?: boolean;
  place: (i: number, n: number, f: number, w: number) => Place;
  /** 第 i 句最多能占多宽（横排）/ 多高（竖排）。 */
  room: (i: number, n: number) => number;
}

const stackTop = (n: number, step: number, fs: number) => PH / 2 - ((n - 1) * step) / 2 - fs * 0.6;

// ———— 横排版式 ————
const H: Record<string, Tpl> = {
  // 左栏：左对齐一栏，翻译作旁注排在右栏
  left: { id: 'left', place: (i, n, f) => ({ left: 190, top: stackTop(n, 80 * f, 42 * f) + i * 80 * f, fs: 42 * f, tr: 'side' }), room: () => 950 },
  // 右栏：右对齐一栏，翻译排在下面
  right: { id: 'right', place: (i, n, f) => ({ right: 190, top: stackTop(n, 96 * f, 44 * f) + i * 96 * f, fs: 44 * f, tr: 'under' }), room: () => 1150 },
  // 居中轴
  axis: { id: 'axis', place: (i, n, f) => ({ center: true, top: stackTop(n, 100 * f, 48 * f) + i * 100 * f, fs: 48 * f, tr: 'under' }), room: () => 1250 },
  // 阶梯：每行往右错开
  stairs: { id: 'stairs', place: (i, n, f) => ({ left: 190 + i * 56, top: stackTop(n, 108 * f, 64 * f) + i * 108 * f, fs: 64 * f, tr: 'under' }), room: (i) => PW - 150 - (190 + i * 56) },
  // 反阶梯：右对齐，每行往左错开
  stairsR: { id: 'stairsR', place: (i, n, f) => ({ right: 190 + i * 56, top: stackTop(n, 108 * f, 64 * f) + i * 108 * f, fs: 64 * f, tr: 'under' }), room: (i) => PW - 150 - (190 + i * 56) },
  // 首句大字：第一句压满一行，其余小字跟在下面
  headline: {
    id: 'headline',
    place: (i, n, f) => {
      if (i === 0) return { left: 180, top: 210 - (n > 4 ? 40 : 0), fs: 88 * f, tr: 'under' };
      return { left: 190, top: 210 - (n > 4 ? 40 : 0) + 150 * f + (i - 1) * 66 * f, fs: 34 * f, tr: 'side' };
    },
    room: (i) => (i === 0 ? PW - 330 : 950),
  },
  // 上下分置：前半句组在左上，后半在右下
  split: {
    id: 'split',
    place: (i, n, f) => {
      const h = Math.ceil(n / 2);
      if (i < h) return { left: 190, top: 190 + i * 82 * f, fs: 44 * f, tr: 'under' };
      return { right: 190, top: PH - 150 - (n - h) * 82 * f + (i - h) * 82 * f, fs: 44 * f, tr: 'under' };
    },
    room: () => 1050,
  },
  // 两栏交错：单句在左栏、双句在右栏，逐句往下走
  columns: {
    id: 'columns',
    place: (i, n, f) => ({ left: i % 2 ? 840 : 190, top: stackTop(n, 74 * f, 40 * f) + i * 74 * f, fs: 40 * f, tr: 'under' }),
    room: () => 600,
  },
  // 散点：一句一个位置往右下错开，留白最多（桥段）
  scatter: {
    id: 'scatter',
    italic: true,
    place: (i, n, f, w) => ({ left: Math.max(150, Math.min(200 + (i % 3) * 340, PW - 150 - w * f)), top: 230 + i * Math.min(180, 440 / Math.max(1, n - 1)), fs: 54 * f, tr: 'under' }),
    room: () => PW - 300,
  },
  // 右下斜体（预副歌）
  corner: {
    id: 'corner',
    italic: true,
    place: (i, n, f) => ({ right: 190, top: Math.min(470, PH - 130 - n * 96 * f) + i * 96 * f, fs: 44 * f, tr: 'under' }),
    room: () => 1260,
  },
  // 左上斜体（预副歌的另一套）
  cornerL: {
    id: 'cornerL',
    italic: true,
    place: (i, _n, f) => ({ left: 190, top: 180 + i * 90 * f, fs: 42 * f, tr: 'under' }),
    room: () => 1150,
  },
  // 居中小字（尾声）
  coda: { id: 'coda', place: (i, n, f) => ({ center: true, top: PH / 2 - 20 - (n - 1) * 55 + i * 110, fs: 38 * f, tr: 'under' }), room: () => 1300 },
};

// ———— 竖排版式（中文歌，从右往左一列一句；right = 这一列的右边） ————
const vCol = (right: number, top: number, fs: number): Place => ({ left: right - fs, top, fs, tr: 'under' });
const V: Record<string, Tpl> = {
  // 右起：从右边一列列往左排
  rightStart: { id: 'v-right', place: (i, _n, f) => vCol(1290 - i * 104 * f, 200, 50 * f), room: () => PH - 270 },
  // 居中成组（大字）
  group: { id: 'v-group', place: (i, n, f) => vCol(PW / 2 + ((n - 1) * 136 * f) / 2 + 36 * f - i * 136 * f, 130, 72 * f), room: () => PH - 200 },
  // 斜阶：每列比右边一列低一截
  steps: { id: 'v-steps', place: (i, _n, f) => vCol(1240 - i * 112 * f, 150 + i * 56, 50 * f), room: (i) => PH - 220 - i * 56 },
  // 左起：整组靠左
  leftStart: { id: 'v-left', place: (i, n, f) => vCol(380 + (n - 1 - i) * 100 * f + 48 * f, 220, 48 * f), room: () => PH - 290 },
  // 首列大字：第一列压满，其余小字列在它左边
  headline: {
    id: 'v-headline',
    place: (i, _n, f) => (i === 0 ? vCol(1250, 130, 92 * f) : vCol(1250 - 160 * f - (i - 1) * 80 * f, 300, 40 * f)),
    room: (i) => (i === 0 ? PH - 200 : PH - 370),
  },
  // 预副歌：左半边小字
  pre: { id: 'v-pre', place: (i, _n, f) => vCol(700 - i * 90 * f, 300, 44 * f), room: () => PH - 370 },
  // 桥段：每列往下错开，留白最多
  scatter: { id: 'v-scatter', place: (i, _n, f) => vCol(1120 - i * 190 * f, 170 + i * 70, 52 * f), room: (i) => PH - 240 - i * 70 },
  // 尾声：居中小字
  coda: { id: 'v-coda', place: (i, n, f) => vCol(PW / 2 + ((n - 1) * 96 * f) / 2 + 20 - i * 96 * f, 330, 42 * f), room: () => PH - 400 },
};

/** 每种段落可用的版式（第几次出现就用第几套）。 */
const POOL_H: Record<SectionKind, Tpl[]> = {
  verse: [H.left!, H.right!, H.headline!, H.columns!, H.axis!],
  pre: [H.corner!, H.cornerL!],
  chorus: [H.stairs!, H.stairsR!, H.headline!, H.axis!],
  bridge: [H.scatter!, H.split!],
  outro: [H.coda!, H.right!],
};
const POOL_V: Record<SectionKind, Tpl[]> = {
  verse: [V.rightStart!, V.steps!, V.leftStart!],
  pre: [V.pre!, V.leftStart!],
  chorus: [V.group!, V.headline!, V.steps!],
  bridge: [V.scatter!],
  outro: [V.coda!],
};

/** 没唱到的字（浅灰的「先印好」）：封面色模式是白 16%，同色系带一点主色。 */
const GHOST = {
  cover: 'rgba(255,255,255,.16)',
  mono: 'color-mix(in srgb, color-mix(in srgb, var(--lc-a) 58%, #fff) 18%, transparent)',
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

function layoutPage(pg: PPage, f: number): void {
  const n = pg.lines.length;
  const hasTr = pg.lines.some((l) => l.tr);
  pg.lines.forEach((l, i) => {
    const p = pg.tpl.place(i, n, f, l.w);
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

/**
 * 量字的位置（波浪按它找「正在唱的位置」）：每个字的盒子带一圈上色留白、再用负边距抵消，相邻两个字的盒子互相重叠。
 * 必须按字本身的范围量（扣掉留白）：按含留白的盒子量的话，演唱位置每走到下一个字都会先倒退 0.4 个字宽，
 * 波浪峰在每个字的交界处来回跳——慢歌里就是「诡异的抖动」（2026-11-22 用户反馈，fe/next-9 之后）。
 */
function measureLine(l: PLine, vert: boolean, S: number): void {
  if (!l.rts?.length) return;
  measureUnits(l.rts);
  const pads = l.rts.map((r) => {
    const cs = getComputedStyle(r.v.el);
    return vert ? [parseFloat(cs.paddingTop) || 0, parseFloat(cs.paddingBottom) || 0] : [parseFloat(cs.paddingLeft) || 0, parseFloat(cs.paddingRight) || 0];
  });
  // 沿阅读方向用带小数的外接框量（offsetLeft / offsetWidth 是取整的，会留下约 1px 的重叠）；
  // 波浪浮起垂直于阅读方向，不影响这一维。外接框带画幅缩放 S，换回未缩放的像素
  const rects = l.rts.map((r) => r.v.el.getBoundingClientRect());
  const pos = (b: DOMRect) => (vert ? b.top : b.left) / S;
  const len = (b: DOMRect) => (vert ? b.height : b.width) / S;
  const base = pos(rects[0]!) + pads[0]![0]!;
  l.rts.forEach((r, i) => {
    const [p0, p1] = pads[i]!;
    r.left = pos(rects[i]!) + p0! - base;
    r.w = len(rects[i]!) - p0! - p1!;
  });
  const z = l.rts[l.rts.length - 1]!;
  for (const r of l.rts) r.lineW = z.left + z.w;
}

export function LyricPage({ lines, songKey }: LyricPageProps) {
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
  const roamRef = useRef(settings.roamLyrics);
  roamRef.current = settings.roamLyrics;
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

  useEffect(() => {
    const root = rootRef.current;
    const frame = frameRef.current;
    if (!active || !root || !frame) return;
    frame.textContent = '';
    const { els, shape } = model;
    const total = shape.stanzas.length;
    // —— 建页：版式按段落种类轮换，相邻两页不重复 ——
    const seen: Record<string, number> = {};
    let prevTpl = '';
    const pages: PPage[] = shape.stanzas.map((stz, j) => {
      const sec = shape.sections[stz.section]!;
      const pool = (vert ? POOL_V : POOL_H)[sec.kind];
      const nth = seen[sec.kind] ?? 0;
      seen[sec.kind] = nth + 1;
      let tpl = pool[nth % pool.length]!;
      if (tpl.id === prevTpl && pool.length > 1) tpl = pool[(nth + 1) % pool.length]!;
      prevTpl = tpl.id;
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
        if (e.units) rts = renderUnits(tx, e.units);
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
        pl.push({ e, el: line, tx, tr, rts, whole, state: 'future', active: false, w: 0, h: 0 });
      }
      frame.appendChild(el);
      return { el, lines: pl, kind: sec.kind, tpl, s: stz.s, e: stz.e, tIn: 0, tOut: Infinity, on: false };
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
    // —— 排版：先按原字号排、量尺寸，再按最挤的那句整页缩小 ——
    const layoutAll = () => {
      for (const pg of pages) {
        pg.el.style.display = 'block';
        layoutPage(pg, 1);
        let f = 1;
        const n = pg.lines.length;
        pg.lines.forEach((l, i) => {
          l.w = l.tx.offsetWidth;
          l.h = l.tx.offsetHeight;
          const need = vert ? l.h : l.w;
          if (need > 0) f = Math.min(f, pg.tpl.room(i, n) / need);
        });
        f = clamp(f, 0.45, 1);
        layoutPage(pg, f);
        // 画幅当前的缩放（第一次排版时还没 fit，就是 1）：量出来的外接框除以它，得到未缩放的像素
        const S = frame.getBoundingClientRect().width / PW || 1;
        for (const l of pg.lines) measureLine(l, vert, S);
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
    }
    interface Morph {
      line: PLine;
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
      for (const v of ['--lc-rest', '--lp-ink', '--lc-a']) {
        const val = cs.getPropertyValue(v);
        if (val) ctx.style.setProperty(v, val);
      }
    };
    const startMorph = (t: number): Morph | null => {
      const layer = morphRef.current;
      if (!layer) return null;
      let line: PLine | null = null;
      let page: PPage | null = null;
      for (const pg of pages) for (const l of pg.lines) if (l.e.s <= t + 0.05 && (!line || l.e.s >= line.e.s)) {
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
      ctxB.className = `lpm-ctx lpm-b ${line.el.className}${vert ? ' is-vert' : ''}`;
      layer.append(ctxA, ctxB);
      copyType(ctxA, src[0]!);
      copyType(ctxB, tgt[0]!);
      const units = src.map((s, i): MorphUnit => {
        const g = tgt[i]!;
        const a = document.createElement('span');
        a.className = 'lpm-u';
        const ac = s.cloneNode(true) as HTMLElement;
        a.appendChild(ac);
        ctxA.appendChild(a);
        const b = document.createElement('span');
        b.className = 'lpm-u';
        const bc = g.cloneNode(true) as HTMLElement;
        b.appendChild(bc);
        ctxB.appendChild(b);
        const fsA = fsOf(s);
        const fsB = fsOf(g);
        a.style.fontSize = `${fsA}px`;
        b.style.fontSize = `${fsB}px`;
        // 自然盒子用定位框（还没加变换）的小数实测，不用取整的 offsetWidth
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const lsA = parseFloat(getComputedStyle(s).letterSpacing) || 0;
        const lsB = parseFloat(getComputedStyle(g).letterSpacing) || 0;
        // 版面那份：上下留白 .12em / .16em；横排字距加在右边，竖排加在下边
        const gA: [number, number] = [-lsA / 2, 0];
        const gB: [number, number] = vert ? [0, -lsB / 2 - 0.02 * fsB] : [-lsB / 2, -0.02 * fsB];
        return { gA, gB, src: s, tgt: g, a, b, ac, bc, fsA, fsB, aw: ra.width || s.offsetWidth, ah: ra.height || s.offsetHeight || 1, bw: rb.width || g.offsetWidth, bh: rb.height || g.offsetHeight || 1, lastS: s.getBoundingClientRect(), lastT: null };
      });
      pageBus.morph = true;
      pageBus.morphS = line.e.s;
      pageBus.caption = caption;
      return { line, units, ctxA, ctxB, srcHost, rot: m ? Number(m) : 0 };
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
    const rotOf = (el: HTMLElement) => Number((el.style.transform.match(/rotate\((-?[\d.]+)deg\)/) ?? [])[1] ?? 0);
    const stepMorph = (mo: Morph, k: number) => {
      const layer = morphRef.current;
      if (!layer) return;
      layer.style.opacity = '1';
      mo.line.el.style.opacity = '0';
      const box = layer.getBoundingClientRect();
      // 版面这一行：未变换的盒子 × 画幅缩放 S（页的进出场只有平移）
      const lr = mo.line.el.getBoundingClientRect();
      const S = lr.width / (mo.line.el.offsetWidth || 1) || 1;
      mo.ctxA.classList.toggle('is-grad', mo.srcHost.classList.contains('is-grad'));
      mo.ctxB.className = `lpm-ctx lpm-b ${mo.line.el.className}${vert ? ' is-vert' : ''}`;
      // 途中 A 渐变成 B（.2 → .8），差异在运动中化掉
      const q = smooth((k - 0.2) / 0.6);
      mo.ctxA.style.opacity = (1 - q).toFixed(3);
      mo.ctxB.style.opacity = q.toFixed(3);
      // 原字的波浪浮起 / 长音放大只在两端保留：漫游那份起飞后 .2 内收平，版面那份 .8 之后才浮起，渐变那段两份都是平的
      mo.ctxA.style.setProperty('--lw', (1 - smooth(k / 0.2)).toFixed(3));
      mo.ctxB.style.setProperty('--lw', smooth((k - 0.8) / 0.2).toFixed(3));
      // 起点的倾斜每帧从原句读（交接途中换句时，被接手那句正在转出离场）
      if (mo.srcHost.isConnected) mo.rot = rotOf(mo.srcHost);
      const th = (mo.rot * Math.PI) / 180;
      const cos = Math.abs(Math.cos(th));
      const sin = Math.abs(Math.sin(th));
      const rot = mo.rot * (1 - k);
      const ty = vert ? 0.5 : 0.85;
      for (const u of mo.units) {
        syncClone(u.src, u.ac);
        syncClone(u.tgt, u.bc);
        // 起点：漫游里那个字（外接框按倾斜反推视觉缩放，再扣掉它自己的浮起 / 放大）；原句被回收时用最后一次量到的
        let rs = u.src.getBoundingClientRect();
        if (rs.width > 0 && u.src.isConnected) u.lastS = rs;
        else rs = u.lastS;
        const vsAll = (rs.width + rs.height) / ((u.aw + u.ah) * (cos + sin) || 1);
        const oa = u.src.isConnected ? ownShift(u.src, vsAll, th, u.ah, 0.85) : { dx: 0, dy: 0, sc: 1 };
        const vsA = vsAll / oa.sc;
        const sx = rs.left + rs.width / 2 - oa.dx - box.left;
        const sy = rs.top + rs.height / 2 - oa.dy - box.top;
        const sf = u.fsA * vsA;
        // 终点：版面上那个字没浮起时的盒子中心，视觉字号 = 字号 × S
        let T = u.lastT;
        const rt = u.tgt.getBoundingClientRect();
        if (rt.width > 0) {
          const ob = ownShift(u.tgt, S, 0, u.bh, ty);
          T = { x: rt.left + rt.width / 2 - ob.dx - box.left, y: rt.top + rt.height / 2 - ob.dy - box.top, f: u.fsB * S };
          u.lastT = T;
        }
        if (!T) T = { x: sx, y: sy, f: sf };
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
        u.a.style.transform = `translate(${(ax - u.aw / 2).toFixed(3)}px, ${(ay - u.ah / 2).toFixed(3)}px) scale(${sA.toFixed(5)}) rotate(${rot.toFixed(3)}deg)`;
        u.b.style.transform = `translate(${(bx - u.bw / 2).toFixed(3)}px, ${(by - u.bh / 2).toFixed(3)}px) scale(${sB.toFixed(5)}) rotate(${rot.toFixed(3)}deg)`;
      }
    };

    // 测试探针（QA 用）：把替身推到交接进度 kk，量每个字和两头真字的偏差（中心 x / y、宽、高，像素）
    const probeWin = window as unknown as { __nebulaLyricPage?: { probe: (kk: number) => number[][] | null; pair: (kk: number) => number[][] | null; overlap: () => number } };
    probeWin.__nebulaLyricPage = {
      probe: (kk) => {
        if (!morph) return null;
        stepMorph(morph, kk);
        return morph.units.map((u) => {
          const a = (kk >= 0.5 ? u.bc : u.ac).getBoundingClientRect();
          const b = (kk >= 0.5 ? u.tgt : u.src).getBoundingClientRect();
          return [a.left + a.width / 2 - (b.left + b.width / 2), a.top + a.height / 2 - (b.top + b.height / 2), a.width - b.width, a.height - b.height].map((v) => Math.round(v * 100) / 100);
        });
      },
      // 版面上每一句里相邻两个字「量出来的范围」最多重叠多少像素（应 ≤ 0：演唱位置只往前走）
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

    const tick = (now: number) => {
      const dt = clamp((now - last) / 1000, 0.001, 0.05);
      last = now;
      const playing = playingRef.current;
      const pos = audioPlayer.position();
      if (playing && pos === lastPos) extrap = Math.min(0.25, extrap + dt);
      else extrap = 0;
      lastPos = pos;
      const t = playing ? pos + extrap : pos;
      const k = listenBus.enabled ? listenBus.k : 0;
      const op = k.toFixed(3);
      if (op !== rootOp) {
        root.style.opacity = op;
        rootOp = op;
      }
      if (k > 0.001) {
        const scheme = schemeRef.current;
        const ghost = GHOST[scheme === 'mono' ? 'mono' : 'cover'];
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
          pg.el.style.transform = `translate3d(0, ${((1 - inK) * 22 - outK * 16).toFixed(1)}px, 0)`;
          for (const l of pg.lines) {
            const e = l.e;
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
            if (state !== 'cur' || !l.rts?.length) continue;
            // 正在唱（和唱完后 0.9s 的尾韵）：扫光、波浪、长音；没唱到的部分是浅灰的「先印好」
            const singing = t <= e.e + 0.3;
            const wave = singing ? waveOf(l.rts, e.dens, t) : null;
            for (const rt of l.rts) {
              unitFrame(rt, t, scheme, singing, wave, e.dens);
              rt.v.set('--un', ghost);
              rt.chs?.forEach((c) => c.set('--un', ghost));
            }
            if (!singing && l.active) l.rts.forEach(restUnit);
            l.active = singing;
          }
        }
      }
      // —— 间奏三点：p = 这段空白的进度；淡入 0.5s，结束前 0.45s 收拢（同听音空间 engine.ts 的公式） ——
      for (const g of gapDots) {
        const show = k > 0.001 && t >= g.s - 0.5 && t <= g.e;
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
      // —— 转场：交接进行中才有；到达两端（完全聆听 / 完全漫游）就收掉替身 ——
      if (k <= 0.001 || k >= 0.999) {
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
    };
  }, [active, model, vert, showTranslation, listen.font, songKey]);

  if (!active) return null;
  const lcA = settings.lyricColorSource === 'custom' ? settings.customColor : 'var(--ly-a, rgb(238 240 244))';
  const vars = {
    '--lc-a': lcA,
    '--lc-font': typo.f,
    '--lc-ls': typo.ls,
    '--lyric-weight': settings.bold ? 700 : typo.w,
  } as CSSProperties;
  return (
    <>
      <div ref={rootRef} className={`lyric-page lw${vert ? ' is-vert' : ''}`} data-scheme={listen.scheme} style={vars} aria-hidden="true">
        <i className="lp-grain" style={{ backgroundImage: `url(${grain()})` }} />
        <div ref={frameRef} className="lp-frame" />
      </div>
      {/* 转场替身：不放在版面根里（版面根的透明度随交接从 0 起，替身要一直看得见） */}
      <div ref={morphRef} className="lp-morph lw" data-scheme={listen.scheme} style={vars} aria-hidden="true" />
    </>
  );
}
