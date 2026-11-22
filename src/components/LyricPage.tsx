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

/** 量字的位置：每个字的盒子带一圈留白（让斜体伸出去的部分也能上色），按实际位置量，不按宽度累加。 */
function measureLine(l: PLine, vert: boolean): void {
  if (!l.rts?.length) return;
  measureUnits(l.rts);
  const first = l.rts[0]!.v.el;
  const base = vert ? first.offsetTop : first.offsetLeft;
  for (const r of l.rts) {
    const el = r.v.el;
    r.left = (vert ? el.offsetTop : el.offsetLeft) - base;
    r.w = vert ? el.offsetHeight : el.offsetWidth;
  }
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
        for (const l of pg.lines) measureLine(l, vert);
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
    let morphLine: PLine | null = null;
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
      let curLine: PLine | null = null;
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
            if (state === 'cur' && t <= e.e + 0.3 && vis > 0.5) curLine = l;
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
      // —— 转场：把当前句的屏幕位置交给漫游歌词；它接手时，版面上这句先藏着，交接快结束时再交叉淡入 ——
      if (curLine && k > 0.001 && k < 0.999) {
        const r = curLine.tx.getBoundingClientRect();
        pageBus.on = true;
        pageBus.s = curLine.e.s;
        pageBus.cx = r.left + r.width / 2;
        pageBus.cy = r.top + r.height / 2;
        pageBus.w = r.width;
        pageBus.h = r.height;
        pageBus.vert = vert;
      } else pageBus.on = false;
      const target = pageBus.taken && curLine ? curLine : null;
      if (morphLine && morphLine !== target) morphLine.el.style.opacity = '';
      if (target) target.el.style.opacity = smooth((k - 0.72) / 0.28).toFixed(3);
      morphLine = target;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      frame.textContent = '';
      root.style.opacity = '0';
      pageBus.on = false;
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
    <div ref={rootRef} className={`lyric-page lw${vert ? ' is-vert' : ''}`} data-scheme={listen.scheme} style={vars} aria-hidden="true">
      <i className="lp-grain" style={{ backgroundImage: `url(${grain()})` }} />
      <div ref={frameRef} className="lp-frame" />
    </div>
  );
}
