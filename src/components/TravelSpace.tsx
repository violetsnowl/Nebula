import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { audioPlayer } from '../lib/audio/AudioPlayer';
import { useAudioPlayer } from '../lib/audio/useAudioPlayer';
import { useInterfaceSettingsContext } from '../hooks/interfaceSettings/InterfaceSettingsContext';
import type { LyricLineUI } from '../lib/lyrics';
import type { Track } from '../lib/catalog';
import type { CardSpec } from '../lib/layout';
import { listenBus } from '../lib/listenMode';
import { detectScript, songPace, toEngineLine, type EngineLine } from '../lib/listen/model';
import { analyzeSong, stageAt } from '../lib/listen/sections';
import { useListenSettings } from '../lib/listen/settings';
import { TYPO, restUnit, unitFrame, waveOf } from '../lib/listen/words';
import { useSpaceLab } from '../lib/space/lab';
import { oklabToRgb, toneOf } from '../lib/space/tone';
import { cssRgba } from './travel/glCore';
import { CoverTextures } from './travel/coverTex';
import { ATLAS_H, GlyphAtlas, PAD, R_MAIN, TR_K, type FontSpec, type GLine, type GUnit } from './travel/glyphAtlas';
import { INST, KIND_CHIP, KIND_COVER, KIND_DOT, KIND_GLYPH, KIND_LIGHT, KIND_STROKE, Renderer, type Palette } from './travel/renderer';
import { DREST, F, FAR, buildRoute, buildSlots, camAt, hashStr, hueOffsetAt, lowerBound, notifySmallLibraryOnce, pathX, pathY, slotRadius, slotYAspect, songHue } from './travel/route';
import { BEATS, buildSegs, headOf, locate, placeSegs, placeSegsWithHead, planShapes, segAt, segAtOut, splitAt, type Seg, type SegOpts, type V3 } from './travel/pathText';
import { tunnelBasis } from './travel/tunnel';
import { planChoreo } from './travel/choreo';
import { buildStar, ringAt, warpRing, warpStar, type Ring, type StarPiece, type Warp } from './travel/moves';
import { wordRt, type WordRt } from './travel/wordState';
import { LsFly, columnSideOf, columnUnitsOf, hideFlyElements, launchStageToListenFly, matchColumnLines, normLyricText, type FlyPair, type FlySide } from '../lib/listen/flyTransition';
import { pageBus } from '../lib/listen/stageBus';
import { createTravelFlySession, type FlyCam, type TravelFlySession } from './travel/travelFly';
import './listen/lyric-words.css';
import './listen/fly-transition.css';
import './travel-stage.css';

/**
 * 穿行第二版「空间歌词」（TRAVEL_HANDOFF §9，第一步：3D 底座）。
 *
 * 一张 WebGL2 画布：背景、隧道壁封面、字、光点都在同一个三维空间里，从远到近画，字和封面有真实的前后遮挡。
 * 镜头路线、句子摆位、颜色旅程、按色相挑封面、小曲库补偿全部沿用 #287（travel/route.ts）；
 * 逐字扫光 / 波浪 / 长音由 words.ts 算（只调用不改），字形按软件现有歌词字体画进贴图（travel/glyphAtlas.ts）。
 * 第一步里字仍是正对镜头的平面句子（和 #287 一样的位置与大小），路径文字、转正、招式是后面几步。
 *
 * 挂在舞台实验室的隐藏开关「穿行 · 空间歌词（实验）」下；WebGL2 不可用或上下文丢失时 onFail，回到 #287 的画布版本。
 */

interface Props {
  lines: LyricLineUI[];
  loading?: boolean;
  songKey: string;
  lsOpen: boolean;
  song: Track | null;
  cards: CardSpec[];
  onNotice?: (msg: string) => void;
  onFail: () => void;
}

/** 0–1 的固定随机（浮尘的位置、速度、闪烁） */
function hash01(i: number, salt: number): number {
  let h = (i * 2654435761 + salt * 40503) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const usable = (l: LyricLineUI | undefined) => !!l && (!!l.text?.trim() || !!l.words?.length);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const DEG = Math.PI / 180;
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
/** 当前句前一句到后两句（同 #287） */
const LINE_FAR = 3400;
const AHEAD = 2;
/** 近平面 / 远平面（世界单位，离镜头） */
const NEAR = 40;
const FARZ = FAR + 2000;
/** 开唱后镜头离句子大约这么远（#287 的镜头：开唱 1250 → 唱完 1000），字号按这时的画面宽度算 */
const DSING = 1000;
/** 世界字号上限 / 拆两段的门槛 / 下限（§9.2「字是主角」：比 #287 的 30–60 大一档） */
const FS_MAX = 84;
const FS_SPLIT = 62;
const FS_MIN = 30;
/**
 * 转正的时间窗：开唱前 TURN_FROM 秒开始、TURN_TO 秒转完（2026-11-27 用户反馈：原来 0.75 秒内转完、开唱那一刻才停，
 * 和光点到达撞在同一刻，像被光丝扯直）。现在约 2 秒慢慢转过来，开唱前已经停稳，转的时候它还只是「下一句」。
 */
const TURN_FROM = 2.4;
const TURN_TO = 0.3;
/** 光点在两句之间飞行：最长 / 最短用时（秒），光尾比光点晚多少（占飞行时长） */
const FLY_MAX = 0.9;
const FLY_MIN = 0.24;
const FLY_LAG = 0.3;
/** 唱完往外侧推开 / 往下沉多少（世界单位，1.2 秒内） */
const PASS_X = 260;
const PASS_Y = 70;

interface LS {
  i: number;
  g: GLine;
  /** 世界字号 */
  fs: number;
  /** 拆成两段时第二段的第一个单位（0 = 不拆） */
  split: number;
  /** 句形弯出画面时把锚点挪回来（世界 x / y，按唱完那一刻的镜头算） */
  fix: [number, number];
  w: WordRt | null;
  state: 'future' | 'cur' | 'past';
  active: boolean;
  done: boolean;
  /** 环（招式）：这一帧的环；rf = 转到正前方的排版坐标（平滑过的） */
  ring: Ring | null;
  rf: number;
  /** 这一帧招式对字的变形（环 / 星座 / 立起），译文另有一个；没有招式时为 null */
  warp: Warp | null;
  trWarp: Warp | null;
  /** 星座：各截的落点与成形进度 */
  star: StarPiece[] | null;
  starK: number;
  /** 曲线缓存：开唱姿态 / 句首 / 远处姿态 / 唱完平移复用段（改窗口时清，避免每帧重复积分） */
  singSegs: Seg[] | null;
  singHead: V3 | null;
  farSegs: Seg[] | null;
  passSegs: Seg[] | null;
}

interface Bound {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

/** 一句这一帧的曲线、画面外接框与沿曲线采样圆包络 */
interface Geo {
  d: LS;
  segs: Seg[];
  op: number;
  boxOp: number;
  frontOp: number;
  dz: number;
  state: LS['state'];
  bd: Bound;
  circles: Circle[];
}

type ProbeLine = { i: number; text: string; x: number; y: number; w: number; h: number; op: number; state: string; done: boolean; kind: string; move: string };

export function TravelSpace({ lines, loading = false, songKey, lsOpen, song, cards, onNotice, onFail }: Props) {
  const lab = useSpaceLab();
  const active = lab.stageMode === 'travel';
  const listen = useListenSettings();
  const { lyricSettings: settings } = useInterfaceSettingsContext();
  const playState = useAudioPlayer();
  const playingRef = useRef(playState.playing);
  playingRef.current = playState.playing;
  const lsOpenRef = useRef(lsOpen);
  lsOpenRef.current = lsOpen;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const schemeRef = useRef(listen.scheme);
  schemeRef.current = listen.scheme;
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  const pinRef = useRef(settings.listenPin);
  pinRef.current = settings.listenPin;
  const roamRef = useRef(settings.roamLyrics);
  roamRef.current = settings.roamLyrics;
  /** 记住从穿行聆听态进听音空间的路径（听音空间内切歌后 useEffect 重跑也不丢，同 LyricPage） */
  const enteredFromTravelRef = useRef(false);
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flyHostRef = useRef<HTMLDivElement>(null);

  const model = useMemo(() => {
    const src = lines.filter(usable);
    const pace = songPace(src);
    const els = src.map((l, i) => toEngineLine(l, src[i + 1] ? src[i + 1]!.timeMs / 1000 : undefined, pace)).sort((a, b) => a.s - b.s);
    const shapeLines = els.map((e) => ({ s: e.s, e: e.e, text: e.text }));
    const shape = els.length ? analyzeSong(shapeLines) : null;
    return { els, shape, shapeLines, script: detectScript(lines) };
  }, [lines]);
  const tracks = useMemo(() => {
    const seen = new Set<string>();
    return cards
      .map((c) => c.track)
      .filter((t) => {
        const key = t.cover || `#${t.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [cards]);
  const typo = TYPO[listen.font][model.script];
  const weight = settings.bold ? 700 : typo.w;

  useEffect(() => {
    if (!active) return;
    const d = document.documentElement.dataset;
    d.stageMode = 'travel';
    return () => {
      if (d.stageMode === 'travel') delete d.stageMode;
    };
  }, [active]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!active || !root || !canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) {
      failRef.current();
      return;
    }
    let renderer: Renderer;
    let covers: CoverTextures;
    let atlas: GlyphAtlas;
    try {
      renderer = new Renderer(gl);
      covers = new CoverTextures(gl);
      atlas = new GlyphAtlas(gl);
    } catch (err) {
      console.warn('[travel-space] WebGL 初始化失败，回到画布版本', err);
      failRef.current();
      return;
    }
    let lost = false;
    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      failRef.current();
    };
    canvas.addEventListener('webglcontextlost', onLost);

    const { els, shape, shapeLines } = model;
    const showTr = listen.translation;
    const font: FontSpec = { family: typo.f, weight, ls: parseFloat(typo.ls) || 0 };
    let fontsReady = false;
    Promise.all([
      document.fonts.load(`${weight} ${R_MAIN}px ${typo.f}`, els[0]?.text || 'Aa'),
      document.fonts.load(`400 40px Inter`, 'Aa'),
    ])
      .catch(() => undefined)
      .then(() => {
        fontsReady = true;
      });

    // —— 画布尺寸 ——
    let vw = 0;
    let vh = 0;
    let dpr = 1;
    const doms = new Map<number, LS>();
    /**
     * 字号与拆句（§9.2「字是主角」）：开唱后镜头离句子约 DSING，那时整句不超过窗口宽 58%，世界字号最大 FS_MAX；
     * 放不下（字号会小于 FS_SPLIT）的长句在停顿处拆成两段（§9.3），每段不超过窗口宽 50%。
     */
    const sizeLine = (e: EngineLine, g: GLine): { fs: number; split: number } => {
      const vwp = Math.max(320, vw || window.innerWidth);
      const fitW = (wEm: number, frac: number) => (frac * vwp * DSING) / (Math.max(0.5, wEm) * F);
      const trW = g.tr && showTr ? g.trWidth : 0;
      const fs = fitW(Math.max(g.width, trW), 0.58);
      if (fs >= FS_SPLIT) return { fs: Math.min(FS_MAX, fs), split: 0 };
      const k = splitAt(e, g);
      if (k > 0) {
        const a = g.units[k - 1]!;
        const wA = a.left + a.w;
        const wB = g.width - g.units[k]!.left;
        // 错落双行总宽 ≈ max(wA, wB) + shift，按整块宽度限制在画面 58% 以内
        const wBlock = Math.max(wA, wB) + Math.min(2.4, Math.max(1.0, 0.18 * Math.min(wA, wB)));
        return { fs: clamp(fitW(Math.max(wBlock, trW * 0.85), 0.58), FS_MIN, FS_MAX), split: k };
      }
      return { fs: clamp(fs, FS_MIN, FS_MAX), split: 0 };
    };
    // —— 初始尺寸与路线 / 槽位 / 隧道壁（拖曳期间不清空画布；松手防抖 220ms 后再按 >15% 重排路线，零闪烁） ——
    const initRect = root.getBoundingClientRect();
    vw = initRect.width || window.innerWidth;
    vh = initRect.height || window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(vw * dpr));
    canvas.height = Math.max(1, Math.round(vh * dpr));
    let pendingW = vw;
    let pendingH = vh;
    let pendingDpr = dpr;
    let sizeDirty = false;
    let rebuildTimer: number | null = null;

    const songSeed = hashStr(songKey);
    const baseHue = songHue(song);
    let routeW = vw;
    let routeH = vh;
    let rebuilds = 0;
    let route = buildRoute(els, shape, routeW, routeH);
    let slotPack = buildSlots(route, tracks, baseHue, songSeed, routeW, routeH);
    let slots = slotPack.slots;
    let small = slotPack.small;
    let basis = (() => {
      const { rMin, rMax } = slotRadius(small, routeW);
      return tunnelBasis(slots, rMin, rMax, slotYAspect(routeW, routeH));
    })();
    /** 每句的句形（静置 / 斜坡 / 波 / 扬尾 / 拐角 / 弧，§9.3）：按句组轮换，同一首歌每次一样 */
    const plan = planShapes(els, shape, songSeed);
    /** 每句的招式（穿针 / 环 / 卷起 / 立起 / 星座，§9.4–9.5）：同一首歌每次一样 */
    const choreo = planChoreo(els, shape).moves;
    const isCjkScript = model.script !== 'en';
    const segOptsOf = (i: number): SegOpts => ({ cjk: isCjkScript, flat: choreo[i]?.move === 'stand' });
    /** 间奏三点窗口（≥ 4s 间奏，上一句掠过完到下一句临近开唱，§9.10 第 2 项） */
    const gapWindows = (shape?.gaps ?? [])
      .filter((g) => g.kind === 'interlude')
      .map((g) => ({ s: g.s + 1.0, e: g.e - 1.4 }))
      .filter((g) => g.e - g.s >= 1.2);

    const applyPendingResize = () => {
      if (!sizeDirty) return;
      sizeDirty = false;
      if (pendingW <= 0 || pendingH <= 0) return;
      vw = pendingW;
      vh = pendingH;
      dpr = pendingDpr;
      canvas.width = Math.max(1, Math.round(vw * dpr));
      canvas.height = Math.max(1, Math.round(vh * dpr));
    };
    const commitResizeRebuild = () => {
      rebuildTimer = null;
      applyPendingResize();
      if (vw > 0 && vh > 0 && routeW > 0 && routeH > 0) {
        if (Math.abs(vw - routeW) / routeW > 0.15 || Math.abs(vh - routeH) / routeH > 0.15) {
          routeW = vw;
          routeH = vh;
          route = buildRoute(els, shape, routeW, routeH);
          slotPack = buildSlots(route, tracks, baseHue, songSeed, routeW, routeH);
          slots = slotPack.slots;
          small = slotPack.small;
          const { rMin, rMax } = slotRadius(small, routeW);
          basis = tunnelBasis(slots, rMin, rMax, slotYAspect(routeW, routeH));
          rebuilds++;
        }
      }
      for (const d of doms.values()) {
        Object.assign(d, sizeLine(els[d.i]!, d.g));
        d.fix = fixOf(d);
        d.singSegs = null;
        d.singHead = null;
        d.farSegs = null;
        d.passSegs = null;
      }
    };
    const onResize = () => {
      const b = root.getBoundingClientRect();
      const r = Math.min(2, window.devicePixelRatio || 1);
      if (b.width <= 0 || b.height <= 0) return;
      if (b.width === pendingW && b.height === pendingH && r === pendingDpr) return;
      pendingW = b.width;
      pendingH = b.height;
      pendingDpr = r;
      sizeDirty = true;
      if (rebuildTimer !== null) clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(commitResizeRebuild, 220);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(root);

    /** 第 i 句的锚点（世界 x / y）：路线中心 + 四拍错开（极短静置词横向略收拢，保留上下交替防重叠） */
    const KREST = DREST / F;
    const beatAt = (i: number): [number, number] => {
      const z = route.lines[i]!.z;
      const [fx, fy] = BEATS[i % BEATS.length]!;
      const still = plan[i]?.kind === 'still';
      const sx = still ? fx * 0.45 : fx;
      const sy = still ? fy * 0.85 : fy;
      return [pathX(z) + sx * (vw || window.innerWidth) * KREST, pathY(z) + sy * (vh || window.innerHeight) * KREST];
    };
    /** 一句的锚点；passK = 唱完后往外侧推开的进度 */
    const anchorOf = (d: LS, passK: number): V3 => {
      const [bx, by] = beatAt(d.i);
      const side = bx >= 0 ? 1 : -1;
      const hasTr = !!d.g.tr && showTr;
      return [bx + d.fix[0] + side * passK * PASS_X, by + d.fix[1] + (hasTr ? 0.11 : 0.4) * d.fs + passK * PASS_Y, route.lines[d.i]!.z];
    };
    /**
     * 句形弯得大（扬尾、拐角、拆两段）时，整句在画面上可能伸出窗口。按唱完那一刻（镜头最近、字最大）的镜头位置
     * 把开唱姿态投到画面上，伸出去多少就把锚点往回挪多少（§9.2 可读性底线：没唱完的句子不出画面）。
     */
    const fixOf = (d: LS): [number, number] => {
      d.fix = [0, 0];
      const e = els[d.i]!;
      const L = route.lines[d.i]!;
      const zc = camAt(route, e.e);
      const dz = L.z - zc;
      if (dz < NEAR * 4) return [0, 0];
      const W = vw || window.innerWidth;
      const H = vh || window.innerHeight;
      const s = F / dz;
      const cxs = W / 2;
      const cys = H * 0.47;
      const ox = pathX(zc);
      const oy = pathY(zc);
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const sg of placeSegs(d.g, d.split, d.i, anchorOf(d, 0), d.fs, plan[d.i]!, 1, segOptsOf(d.i))) {
        for (let k = 0; k <= 32; k += 2) {
          const x = cxs + (sg.C[0] + sg.P[k * 3]! - ox) * s;
          const y = cys + (sg.C[1] + sg.P[k * 3 + 1]! - oy) * s;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      // 曲线是基线：往上留一个字高、往下留降部（有译文再留一行）
      const fpx = d.fs * s;
      y0 -= 0.85 * fpx;
      y1 += (d.g.tr && showTr ? 1.15 : 0.3) * fpx;
      const mx = W * 0.05;
      const top = H * 0.07;
      const bot = H - 104;
      let dx = 0;
      let dy = 0;
      if (x1 - x0 > W - 2 * mx) dx = W / 2 - (x0 + x1) / 2;
      else if (x0 < mx) dx = mx - x0;
      else if (x1 > W - mx) dx = W - mx - x1;
      if (y1 - y0 > bot - top) dy = (top + bot) / 2 - (y0 + y1) / 2;
      else if (y0 < top) dy = top - y0;
      else if (y1 > bot) dy = bot - y1;
      return [dx / s, dy / s];
    };
    let buildMax = 0;
    const makeLine = (i: number): LS | null => {
      const tb = performance.now();
      const e = els[i]!;
      const g = atlas.build(e, font, showTr && e.tr ? e.tr : null);
      buildMax = Math.max(buildMax, performance.now() - tb);
      if (!g) return null;
      const d: LS = {
        i, g, ...sizeLine(e, g), fix: [0, 0], w: wordRt(e, g),
        state: 'future', active: false, done: false,
        ring: null, rf: 0, warp: null, trWarp: null, star: null, starK: 0,
        singSegs: null, singHead: null, farSegs: null, passSegs: null,
      };
      d.fix = fixOf(d);
      return d;
    };
    const ensureSegCache = (d: LS): Seg[] => {
      if (!d.singSegs) {
        const sing = buildSegs(d.g, d.split, d.i, anchorOf(d, 0), d.fs, plan[d.i]!, 1, segOptsOf(d.i));
        d.singSegs = sing;
        d.singHead = headOf(sing, d.fs);
        d.farSegs = null;
        d.passSegs = sing.map((sg) => ({ ...sg, C: [sg.C[0], sg.C[1], sg.C[2]] as V3 }));
      }
      return d.singSegs;
    };
    const segsOf = (d: LS, turnK: number, passK: number): Seg[] => {
      const sing = ensureSegCache(d);
      if (turnK >= 1) {
        if (passK <= 0) return sing;
        const [bx] = beatAt(d.i);
        const dx = (bx >= 0 ? 1 : -1) * passK * PASS_X;
        const dy = passK * PASS_Y;
        const ps = d.passSegs!;
        for (let r = 0; r < sing.length; r++) {
          const sC = sing[r]!.C;
          const pC = ps[r]!.C;
          pC[0] = sC[0] + dx;
          pC[1] = sC[1] + dy;
          pC[2] = sC[2];
        }
        return ps;
      }
      const opts = segOptsOf(d.i);
      if (turnK <= 0 && passK <= 0) {
        if (!d.farSegs) d.farSegs = placeSegsWithHead(d.g, d.split, d.i, anchorOf(d, 0), d.fs, plan[d.i]!, 0, d.singHead!, opts);
        return d.farSegs;
      }
      const baseH = d.singHead!;
      if (passK <= 0) return placeSegsWithHead(d.g, d.split, d.i, anchorOf(d, 0), d.fs, plan[d.i]!, turnK, baseH, opts);
      const [bx] = beatAt(d.i);
      const dx = (bx >= 0 ? 1 : -1) * passK * PASS_X;
      const dy = passK * PASS_Y;
      return placeSegsWithHead(d.g, d.split, d.i, anchorOf(d, passK), d.fs, plan[d.i]!, turnK, [baseH[0] + dx, baseH[1] + dy, baseH[2]], opts);
    };
    const dropLine = (d: LS) => {
      atlas.release(d.g);
      doms.delete(d.i);
    };

    // —— 颜色 ——
    const chipCache = new Map<number, number[]>();
    const chipOf = (ci: number): number[] => {
      const hit = chipCache.get(ci);
      if (hit) return hit;
      const tr = tracks[ci];
      const t = tr?.cover ? toneOf(tr.cover) : null;
      const [r, g, b] = t ? oklabToRgb(0.22 + 0.6 * t[0], t[1] * 1.2, t[2] * 1.2) : [44, 46, 54];
      const out = [r / 255, g / 255, b / 255];
      if (t) chipCache.set(ci, out);
      return out;
    };
    const lab3 = (L: number, C: number, h: number) => {
      const [r, g, b] = oklabToRgb(L, C * Math.cos(h), C * Math.sin(h));
      return [r / 255, g / 255, b / 255];
    };
    let lcCss = '';
    let lcScheme = '';
    let lc = [0.93, 0.94, 0.96, 1];
    const pal: Palette = { sung: [1, 1, 1, 1], edge: [1, 1, 1, 1], un: [1, 1, 1, 0.34], rest: [1, 1, 1, 0.34], ink: [1, 1, 1, 1], tr: [1, 1, 1, 0.62], glow: [1, 1, 1] };
    const mix = (a: number[], b: number[], k: number) => [0, 1, 2].map((j) => a[j]! + (b[j]! - a[j]!) * k);
    const W1 = [1, 1, 1];
    const syncPalette = () => {
      const css = getComputedStyle(root).getPropertyValue('--lc-a').trim();
      const scheme = schemeRef.current;
      if (css === lcCss && scheme === lcScheme) return;
      lcCss = css;
      lcScheme = scheme;
      if (css) lc = cssRgba(css);
      if (scheme === 'mono') {
        // 同色系：唱过的近白（主色 8%），波前主色 35%，没唱的是主色 58% 的淡色 34%（同 wordColors / travel-stage.css）
        pal.sung = [...mix(lc, W1, 0.92), 1];
        pal.edge = [...mix(lc, W1, 0.65), 1];
        pal.un = [...mix(lc, W1, 0.42), 0.34];
        pal.rest = [...mix(lc, W1, 0.42), 0.46];
        pal.ink = pal.sung;
      } else {
        // 封面色：唱过的是主色，波前主色 30%，没唱的白 34%（穿行把 --un 换成 GHOST）
        pal.sung = [lc[0]!, lc[1]!, lc[2]!, 1];
        pal.edge = [...mix(lc, W1, 0.7), 1];
        pal.un = [1, 1, 1, 0.34];
        pal.rest = [1, 1, 1, 0.46];
        pal.ink = pal.sung;
      }
      pal.glow = mix(lc, W1, 0.72);
    };

    // —— 小平面缓冲：先按任意顺序写进 scratch，再按离镜头从远到近排序拷进 out ——
    let cap = 1024;
    let scratch = new Float32Array(cap * INST);
    let out = new Float32Array(cap * INST);
    let depth = new Float32Array(cap);
    let order = new Uint32Array(cap);
    let n = 0;
    const grow = () => {
      cap *= 2;
      const s2 = new Float32Array(cap * INST);
      s2.set(scratch);
      scratch = s2;
      out = new Float32Array(cap * INST);
      const d2 = new Float32Array(cap);
      d2.set(depth);
      depth = d2;
      order = new Uint32Array(cap);
    };
    const put = (
      dz: number,
      px: number, py: number, pz: number,
      axx: number, axy: number, axz: number,
      ayx: number, ayy: number, ayz: number,
      u0: number, v0: number, u1: number, v1: number,
      kind: number, layer: number, alpha: number,
      a0: number, a1: number, a2: number, a3: number,
      b0: number, b1: number, b2: number, b3: number,
    ) => {
      if (n >= cap) grow();
      const o = n * INST;
      const s = scratch;
      s[o] = px; s[o + 1] = py; s[o + 2] = pz;
      s[o + 3] = axx; s[o + 4] = axy; s[o + 5] = axz;
      s[o + 6] = ayx; s[o + 7] = ayy; s[o + 8] = ayz;
      s[o + 9] = u0; s[o + 10] = v0; s[o + 11] = u1; s[o + 12] = v1;
      s[o + 13] = kind; s[o + 14] = layer; s[o + 15] = alpha;
      s[o + 16] = a0; s[o + 17] = a1; s[o + 18] = a2; s[o + 19] = a3;
      s[o + 20] = b0; s[o + 21] = b1; s[o + 22] = b2; s[o + 23] = b3;
      depth[n] = dz;
      n++;
    };

    // —— 世界坐标 → 画面坐标（与着色器同一套投影；每帧开头更新镜头） ——
    let pcx = 0;
    let pcy = 0;
    let pX = 0;
    let pY = 0;
    let pZ = 0;

    /**
     * 一句的字沿曲线逐个出平面（路径文字，§9.3）。mode：0 候场（--lc-rest）、1 扫光、2 唱完（--tv-ink）；
     * trK 是译文亮起程度。顺带量出画面上的外接框（给封面让开、压暗和探针用）。
     */
    const _gp: V3 = [0, 0, 0];
    const _gt: V3 = [0, 0, 0];
    const _gd: V3 = [0, 0, 0];
    /** 后句让开粗判：先按曲线几个采样点算粗略画面外接框，和 curBox 不相交就整句跳过逐字投影 */
    const overlapsBox = (d: LS, segs: Seg[], box: Bound): boolean => {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      let minDz = Infinity;
      const addPt = (wx: number, wy: number, wz: number) => {
        const dz = wz - pZ;
        if (dz < NEAR) return;
        if (dz < minDz) minDz = dz;
        const s = F / dz;
        const sx = pcx + (wx - pX) * s;
        const sy = pcy + (wy - pY) * s;
        if (sx < x0) x0 = sx;
        if (sx > x1) x1 = sx;
        if (sy < y0) y0 = sy;
        if (sy > y1) y1 = sy;
      };
      if (d.star) {
        for (const pc of d.star) {
          const hw = ((pc.e1 - pc.e0) / 2) * d.fs;
          addPt(pc.C[0] - pc.U[0] * hw, pc.C[1] - pc.U[1] * hw, pc.C[2]);
          addPt(pc.C[0] + pc.U[0] * hw, pc.C[1] + pc.U[1] * hw, pc.C[2]);
        }
      } else if (d.ring) {
        const r = d.ring;
        addPt(r.C[0] - r.R, r.C[1] - r.R, r.C[2] - r.R);
        addPt(r.C[0] + r.R, r.C[1] + r.R, r.C[2] - r.R);
      } else {
        for (const sg of segs) {
          const P = sg.P;
          const C = sg.C;
          for (let k = 0; k <= 32; k += 8) {
            const o = k * 3;
            addPt(C[0] + P[o]!, C[1] + P[o + 1]!, C[2] + P[o + 2]!);
          }
        }
      }
      if (x1 < x0) return false;
      const pad = (minDz < Infinity ? (d.fs * F) / minDz : 80) * 1.6 + 44;
      return x1 + pad >= box.x0 && x0 - pad <= box.x1 && y1 + pad >= box.y0 && y0 - pad <= box.y1;
    };
    /** 估算一句的画面外接框（飞入期间 WebGL2 尚未出字时，提前给字后封面压暗与后句让位用，避免落地最后一帧场景突兀变暗） */
    const boundOf = (d: LS, segs: Seg[], bd: Bound) => {
      const add = (wx: number, wy: number, wz: number, padX = 0, padY = 0) => {
        const dz = wz - pZ;
        if (dz < NEAR) return;
        const s = F / dz;
        const sx = pcx + (wx - pX) * s;
        const sy = pcy + (wy - pY) * s;
        const px = padX * s;
        const py = padY * s;
        if (sx - px < bd.x0) bd.x0 = sx - px;
        if (sx + px > bd.x1) bd.x1 = sx + px;
        if (sy - py < bd.y0) bd.y0 = sy - py;
        if (sy + py > bd.y1) bd.y1 = sy + py;
      };
      if (d.star) {
        for (const pc of d.star) {
          const hw = ((pc.e1 - pc.e0) / 2) * d.fs;
          add(pc.C[0] - pc.U[0] * hw, pc.C[1] - pc.U[1] * hw, pc.C[2], 0, 0.55 * d.fs);
          add(pc.C[0] + pc.U[0] * hw, pc.C[1] + pc.U[1] * hw, pc.C[2], 0, 0.55 * d.fs);
        }
      } else if (d.ring) {
        const r = d.ring;
        add(r.C[0] - r.R, r.C[1] - r.R, r.C[2] - r.R * 0.5);
        add(r.C[0] + r.R, r.C[1] + r.R, r.C[2] - r.R * 0.5);
      } else {
        const py = 0.58 * d.fs;
        for (const sg of segs) {
          const P = sg.P;
          const C = sg.C;
          for (let q = 0; q <= 32; q += 4) {
            const o = q * 3;
            add(C[0] + P[o]!, C[1] + P[o + 1]! - 0.35 * d.fs, C[2] + P[o + 2]!, 0.25 * d.fs, py);
          }
        }
      }
    };
    const _cp: V3 = [0, 0, 0];
    const _ct: V3 = [0, 0, 0];
    const _cd: V3 = [0, 0, 0];
    /** 沿曲线（含星座 / 环招式变形）采样屏幕空间包络圆，替代单一矩形 AABB 做后句让位与字后封面有机压暗 */
    const sampleCircles = (d: LS, segs: Seg[], hasTr: boolean): Circle[] => {
      const outC: Circle[] = [];
      const pushPt = (wx: number, wy: number, wz: number, rWorld: number) => {
        const dz = wz - pZ;
        if (dz < NEAR) return;
        const s = F / dz;
        outC.push({ x: pcx + (wx - pX) * s, y: pcy + (wy - pY) * s, r: rWorld * s });
      };
      if (d.star && d.starK > 0.85) {
        const rW = 0.8 * d.fs;
        const cy = -0.36 * d.fs;
        for (const pc of d.star) {
          const hw = ((pc.e1 - pc.e0) / 2) * d.fs;
          for (const k of [-0.65, 0, 0.65]) {
            const x = hw * k;
            pushPt(pc.C[0] + pc.U[0] * x + pc.V[0] * cy, pc.C[1] + pc.U[1] * x + pc.V[1] * cy, pc.C[2] + pc.U[2] * x + pc.V[2] * cy, rW);
          }
        }
        return outC;
      }
      if (d.ring && d.ring.k > 0.85) {
        const rg = d.ring;
        const rW = 0.82 * d.fs;
        const span = Math.min(rg.width * 0.5, (65 * DEG * rg.R) / Math.max(1, rg.fs));
        for (let q = 0; q <= 6; q++) {
          const em = rg.front + ((q / 6) * 2 - 1) * span;
          const rp = ringAt(rg, em);
          pushPt(rp.p[0] - rp.d[0] * 0.36 * d.fs, rp.p[1] - rp.d[1] * 0.36 * d.fs, rp.p[2] - rp.d[2] * 0.36 * d.fs, rW);
        }
        return outC;
      }
      const invW = 1 / Math.max(0.5, d.g.width);
      const cnt = segs.length > 1 ? 5 : 8;
      for (let r = 0; r < segs.length; r++) {
        const sg = segs[r]!;
        const trOn = hasTr && r === segs.length - 1;
        const midOff = (trOn ? 0.12 : 0.36) * d.fs;
        const rW = (trOn ? 1.05 : 0.82) * d.fs;
        const inset = Math.min(sg.half * 0.8, 0.25 * d.fs);
        const span = Math.max(0, sg.half - inset);
        for (let q = 0; q < cnt; q++) {
          const u = cnt > 1 ? q / (cnt - 1) : 0.5;
          const s = -span + 2 * span * u;
          segAtOut(sg, s, _cp, _ct, _cd);
          let p: V3 = _cp;
          let tg: V3 = _ct;
          let dn: V3 = _cd;
          let vis = 1;
          if (d.warp) {
            const em = sg.e0 + sg.w * 0.5 + s / Math.max(1, d.fs);
            const w = d.warp(em, em * invW, p, tg, dn);
            p = w.p;
            tg = w.t;
            dn = w.d;
            vis = w.vis;
          }
          if (vis < 0.15) continue;
          pushPt(p[0] - dn[0] * midOff, p[1] - dn[1] * midOff, p[2] - dn[2] * midOff, rW);
        }
      }
      return outC;
    };
    const emitLine = (
      d: LS,
      segs: Seg[],
      op: number,
      mode: number,
      blur: number,
      trK: number,
      bd: Bound,
      yieldBox: Bound | null,
      yieldCircles: Circle[] | null,
    ) => {
      const { g, fs } = d;
      const aw = atlas.atlasW;
      const useYield = yieldBox && yieldCircles?.length && overlapsBox(d, segs, yieldBox) ? yieldCircles : null;
      const corner = (x: number, y: number, z: number) => {
        const dz = z - pZ;
        if (dz < NEAR) return;
        const s = F / dz;
        const sx = pcx + (x - pX) * s;
        const sy = pcy + (y - pY) * s;
        if (sx < bd.x0) bd.x0 = sx;
        if (sx > bd.x1) bd.x1 = sx;
        if (sy < bd.y0) bd.y0 = sy;
        if (sy > bd.y1) bd.y1 = sy;
      };
      const seg0 = segs[0]!;
      const seg1 = segs.length > 1 ? segs[1]! : null;
      const splitAtUi = seg1 ? seg1.from : 1e9;
      const emitUnits = (units: GUnit[], trSeg: Seg | null, k: number, isTr: boolean) => {
        const padEm = PAD * k;
        const invW = 1 / Math.max(0.5, isTr ? g.trWidth : g.width);
        const wf = isTr ? d.trWarp : d.warp;
        for (let ui = 0; ui < units.length; ui++) {
          const gu = units[ui]!;
          const sg = trSeg ?? (ui >= splitAtUi ? seg1! : seg0);
          const rec = !isTr ? d.w?.recs[ui] : undefined;
          const chs = !isTr ? d.w?.chs[ui] : null;
          const nL = gu.edges.length - 1;
          if (nL <= 0) continue;
          const f = gu.u?.cjk ? 0.42 : 0.26;
          const top = -gu.baseEm;
          const bot = gu.bandEm - gu.baseEm;
          const uLift = rec?.lift ?? 0;
          const uSc = rec?.sc ?? 1;
          const uGlow = rec?.glowK ?? 0;
          const uP = (rec?.p ?? 0) * (1 + 2 * f) - f;
          const ox = gu.left + gu.w / 2;
          for (let j = 0; j < nL; j++) {
            const e0 = gu.edges[j]!;
            const e1 = gu.edges[j + 1]!;
            const le = e0 - (j === 0 ? padEm : 0);
            const re = e1 + (j === nL - 1 ? padEm : 0);
            let xl = gu.left + le;
            let xr = gu.left + re;
            let yt = top;
            let yB = bot;
            let lift = uLift;
            let sc = uSc;
            let glow = uGlow;
            let P = uP;
            let g0 = le / Math.max(1e-4, gu.w);
            let g1 = re / Math.max(1e-4, gu.w);
            let cx = ox;
            const ch = chs?.[j];
            if (ch) {
              // 拉丁长音：每个字母自己扫光、起伏、放大
              const lw = Math.max(1e-4, e1 - e0);
              lift = ch.lift;
              sc = ch.sc;
              glow = ch.glowK;
              P = ch.p * (1 + 2 * 0.26) - 0.26;
              g0 = (le - e0) / lw;
              g1 = (re - e0) / lw;
              cx = gu.left + (e0 + e1) / 2;
            }
            if (sc !== 1) {
              xl = cx + (xl - cx) * sc;
              xr = cx + (xr - cx) * sc;
              yt *= sc;
              yB *= sc;
            }
            yt -= lift;
            yB -= lift;
            // 字母中点在曲线上的位置与方向：字沿切向摆、沿「向下」方向竖着
            const em = (xl + xr) / 2;
            const sMid = (em - sg.e0 - sg.w / 2) * fs;
            segAtOut(sg, sMid, _gp, _gt, _gd);
            let p: V3 = _gp;
            let tg: V3 = _gt;
            let dn: V3 = _gd;
            let vis = 1;
            if (wf) {
              const w = wf(em, em * invW, p, tg, dn);
              p = w.p;
              tg = w.t;
              dn = w.d;
              vis = w.vis;
            }
            if (vis < 0.01) continue;
            const hx = ((xr - xl) / 2) * fs;
            const hy = ((yB - yt) / 2) * fs;
            const cy0 = ((yt + yB) / 2) * fs;
            const wx = p[0] + dn[0] * cy0;
            const wy = p[1] + dn[1] * cy0;
            const wz = p[2] + dn[2] * cy0;
            // 后面的句子（远处弯得大的句形）落进当前句曲线包络圆时压到很淡：只按曲线真实距离让位，不误伤斜句空旷区
            if (useYield) {
              const dzY = wz - pZ;
              if (dzY >= NEAR) {
                const sY = F / dzY;
                const qx = pcx + (wx - pX) * sY;
                const qy = pcy + (wy - pY) * sY;
                let minD = 9999;
                for (let ci = 0; ci < useYield.length; ci++) {
                  const c = useYield[ci]!;
                  const dC = Math.hypot(qx - c.x, qy - c.y) - c.r;
                  if (dC < minD) minD = dC;
                }
                if (minD < 36) vis *= 0.1 + 0.9 * smooth(minD / 36);
              }
            }
            put(
              wz - pZ - 0.01,
              wx, wy, wz,
              tg[0] * hx, tg[1] * hx, tg[2] * hx,
              dn[0] * hy, dn[1] * hy, dn[2] * hy,
              (gu.ax + le * gu.px) / aw, gu.ay / ATLAS_H, (gu.ax + re * gu.px) / aw, (gu.ay + gu.bandEm * gu.px) / ATLAS_H,
              KIND_GLYPH, 0, (isTr ? op * trK : op) * vis,
              P, f, g0, g1,
              isTr ? 3 : mode, isTr ? 0 : glow * 0.9, blur, isTr ? 0.6 : 1,
            );
            if ((!isTr || trK > 0.3) && vis > 0.3) {
              // 外接框只量字形本体（不含暗晕的留白）
              const ix = hx * 0.8;
              const iy = hy * 0.62;
              const txI = tg[0] * ix; const tyI = tg[1] * ix; const tzI = tg[2] * ix;
              const dxI = dn[0] * iy; const dyI = dn[1] * iy; const dzI = dn[2] * iy;
              corner(wx - txI - dxI, wy - tyI - dyI, wz - tzI - dzI);
              corner(wx + txI - dxI, wy + tyI - dyI, wz + tzI - dzI);
              corner(wx - txI + dxI, wy - tyI + dyI, wz - tzI + dzI);
              corner(wx + txI + dxI, wy + tyI + dyI, wz + tzI + dzI);
            }
          }
        }
      };
      emitUnits(g.units, null, 1, false);
      if (g.tr && showTr && trK > 0.004) {
        // 译文：跟在最后一段下方、沿同一条曲线（§9.3）
        const ref = segs[segs.length - 1]!;
        const c = segAt(ref, 0);
        const off = 0.73 * fs;
        const trSeg: Seg = { ...ref, C: [ref.C[0] + c.d[0] * off, ref.C[1] + c.d[1] * off, ref.C[2] + c.d[2] * off], e0: 0, w: g.trWidth };
        emitUnits(g.tr, trSeg, TR_K, true);
      }
    };


    /**
     * 主角封面（§9.6）：招式套住的那张，用正在播放的这首歌的封面（钩子句和这首歌绑在一起），放在环心、稍压暗，
     * 好让绕在前面的字读得出。
     */
    const heroUrl = song?.cover || tracks[0]?.cover || '';
    const emitHero = (r: Ring, a: number) => {
      if (a < 0.01) return;
      const dz = r.C[2] - pZ;
      if (dz < NEAR * 2) return;
      const half = r.R * 0.56;
      const layer = heroUrl ? covers.layerOf(heroUrl, frameNo) : -1;
      const chip = layer < 0 ? [0.2, 0.2, 0.24] : null;
      put(
        dz,
        r.C[0], r.C[1] - r.R * 0.3, r.C[2],
        half, 0, 0,
        0, half, 0,
        0, 0, 1, 1,
        layer < 0 ? KIND_CHIP : KIND_COVER, Math.max(0, layer), a * 0.92,
        -0.7, 0, 0.3, 0,
        chip ? chip[0]! : 0, chip ? chip[1]! : 0, chip ? chip[2]! : 0, 0,
      );
    };

    /**
     * 星座的星、连线和挂着的小封面：
     *   - 每截句首前面一颗星（柔光点），唱到这截时亮、唱过的稍亮、没唱的很淡；
     *   - 唱到第 j 截时，一根细线从上一截的句尾画到这一截的星（0.4 秒画完），之后淡淡留着；
     *   - 每截旁边挂一张小封面（曲库里按句子固定挑），很淡，衬着字（「挂在路旁几张封面边上」）。
     */
    const emitStar = (d: LS, pieces: StarPiece[], k: number, op: number, t: number) => {
      const e = els[d.i]!;
      const fs = d.fs;
      const col = pal.glow;
      const us = e.units ?? [];
      const nodeOf = (pc: StarPiece): V3 => {
        const x = (pc.e0 - (pc.e0 + pc.e1) / 2 - 0.55) * fs;
        return [pc.C[0] + pc.U[0] * x - pc.V[0] * 0.36 * fs, pc.C[1] + pc.U[1] * x - pc.V[1] * 0.36 * fs, pc.C[2] + pc.U[2] * x];
      };
      const tailOf = (pc: StarPiece): V3 => {
        const x = (pc.e1 - (pc.e0 + pc.e1) / 2 + 0.3) * fs;
        return [pc.C[0] + pc.U[0] * x - pc.V[0] * 0.36 * fs, pc.C[1] + pc.U[1] * x - pc.V[1] * 0.36 * fs, pc.C[2] + pc.U[2] * x];
      };
      pieces.forEach((pc, j) => {
        const s0 = us[pc.from]?.s ?? e.s;
        const s1 = us[pc.to - 1]?.e ?? e.e;
        const act = t >= s0 - 0.1 && t <= s1 + 0.2 ? 1 : 0;
        const sung = t > s1 + 0.2 ? 1 : 0;
        const nd = nodeOf(pc);
        const dz = nd[2] - pZ;
        if (dz > NEAR * 3) {
          const I = op * k * (0.1 + 0.32 * act + 0.12 * sung) * smooth((dz - 300) / 500);
          const r = fs * (0.5 + 0.25 * act);
          put(dz - 0.5, nd[0], nd[1], nd[2], r, 0, 0, 0, r, 0, 0, 0, 1, 1, KIND_LIGHT, 0, 1, col[0]! * I, col[1]! * I, col[2]! * I, 0, 0, 0, 0, 0);
          // 小封面：挂在星的左上方、稍靠后
          const tr = tracks.length ? tracks[(d.i * 7 + j * 13) % tracks.length] : null;
          if (tr?.cover) {
            const layer = covers.layerOf(tr.cover, frameNo);
            const half = fs * 0.75;
            const cx = nd[0] - fs * 0.9;
            const cy = nd[1] - fs * 1.25;
            const cz = nd[2] + 60;
            const ch = layer < 0 ? chipOf(d.i + j) : null;
            put(cz - pZ, cx, cy, cz, half, 0, 0, 0, half, 0, 0, 0, 1, 1, layer < 0 ? KIND_CHIP : KIND_COVER, Math.max(0, layer), op * k * 0.5, -0.3, 0, 0.3, 0, ch ? ch[0]! : 0, ch ? ch[1]! : 0, ch ? ch[2]! : 0, 0);
          }
        }
        if (j > 0) {
          // 连线：唱到这截时从上一截句尾画过来（连续丝带）
          const g = smooth((t - (s0 - 0.3)) / 0.4);
          if (g > 0.001) {
            const A = tailOf(pieces[j - 1]!);
            const B = nd;
            const nSeg = 12;
            const alpha = op * k * (0.16 + 0.2 * act);
            for (let q = 0; q <= nSeg; q++) {
              const u = (q / nSeg) * g;
              const o = q * 3;
              _rbP[o] = A[0] + (B[0] - A[0]) * u;
              _rbP[o + 1] = A[1] + (B[1] - A[1]) * u;
              _rbP[o + 2] = A[2] + (B[2] - A[2]) * u;
              _rbH[q] = 0.9 + (act && q === nSeg ? 0.9 : 0);
              _rbA[q] = alpha;
            }
            emitRibbon(_rbP, _rbH, _rbA, nSeg + 1, col, 1.2, false);
          }
        }
      });
    };

    /**
     * 卷起的螺旋光（Demo 4 的螺旋带，只取光）：两股，绕走廊中轴、在这句前方约 1800 → 150 的路段上转 1.6 圈，
     * 半径约画面宽 0.3（开唱距离时），镜头从里面穿过去：近处的一圈扫过画面边缘，远处收向这句。很淡、虚，亮暗往前流。
     */
    const emitHelix = (sw: { sw: number; side: number; zEnd: number }, t: number) => {
      const col = pal.glow;
      const R = 0.3 * (((vw || window.innerWidth) * DSING) / F);
      const z0 = sw.zEnd - 1800;
      const z1 = sw.zEnd - 150;
      const N2 = 96;
      for (const ph of [0, Math.PI]) {
        for (let q = 0; q <= N2; q++) {
          const u = q / N2;
          const z = z0 + (z1 - z0) * u;
          const th = sw.side * u * 1.6 * 2 * Math.PI + ph + t * 0.5 * sw.side;
          // 越靠近这句半径越收，像气流收进句子
          const r = R * (1 - 0.45 * u);
          const o = q * 3;
          _rbP[o] = pathX(z) + r * Math.cos(th);
          _rbP[o + 1] = pathY(z) + r * Math.sin(th) * 0.8;
          _rbP[o + 2] = z;
          const taper = smooth(u / 0.15) * smooth((1 - u) / 0.2);
          const flow = 0.5 + 0.5 * Math.sin(u * 18 - t * 2.2 + ph);
          _rbH[q] = 7;
          _rbA[q] = sw.sw * taper * (0.03 + 0.05 * flow);
        }
        emitRibbon(_rbP, _rbH, _rbA, N2 + 1, col, 0, false);
      }
    };

    /** 穿针那一句唱到的位置（em）：S 只在当前句有，其余时候按时间估 */
    const needleS = (d: LS, e: EngineLine, t: number): number => {
      const us = d.g.units;
      const eu = e.units;
      if (!eu?.length) return ((t - e.s) / Math.max(0.1, e.e - e.s)) * d.g.width;
      let k = 0;
      for (let q = 0; q < eu.length; q++) if (t >= eu[q]!.s) k = q;
      const u = us[k];
      return u ? u.left + u.w * clamp((t - eu[k]!.s) / Math.max(0.05, eu[k]!.e - eu[k]!.s), 0, 1) : d.g.width;
    };
    const glassUrl = (i: number, j: number) => (tracks.length ? tracks[(i * 11 + j * 5 + 3) % tracks.length]?.cover ?? '' : '');
    const emitNeedle = (nd: { d: LS; segs: Seg[]; k: number; S: number; side: number }, t: number) => {
      const { d, segs, k } = nd;
      const fs = d.fs;
      const w = d.g.width;
      // 玻璃封面：左边缘贴在唱到的字右边 1.1em 处，盖住后半截；唱完往右滑出、淡掉
      const leftEm = clamp(nd.S + 1.1, 1.2, w + 3);
      const half = 1.45 * fs;
      const a = pointOn(d, segs, Math.min(w, leftEm));
      const extra = Math.max(0, leftEm - w) * fs;
      const gx = a.p[0] + a.t[0] * (half + extra);
      const gy = a.p[1] + a.t[1] * (half + extra);
      const gz = a.p[2] + a.t[2] * (half + extra) - 0.9 * fs;
      const dzA = gz - pZ;
      void t;
      if (dzA > NEAR * 2) {
        const url = glassUrl(d.i, 0);
        const layer = url ? covers.layerOf(url, frameNo) : -1;
        const ch = layer < 0 ? chipOf(d.i) : null;
        // 玻璃：整体很透（0.34）、内侧亮边加强（0.9）、稍提亮；后面的字透出来（液态玻璃的「透 + 边缘光」）
        put(
          dzA,
          gx, gy, gz,
          a.t[0] * half, a.t[1] * half, 0,
          -a.t[1] * half, a.t[0] * half, 0,
          0, 0, 1, 1,
          layer < 0 ? KIND_CHIP : KIND_COVER, Math.max(0, layer), k * 0.34 * (1 - smooth(leftEm - w - 1.5)),
          0.4, 0.6, 0.9, 0,
          ch ? ch[0]! : 0, ch ? ch[1]! : 0, ch ? ch[2]! : 0, 0,
        );
      }
      // 针眼的另一边：句首左后方一张实的封面
      const h = pointOn(d, segs, 0);
      const bh = 1.25 * fs;
      const bx = h.p[0] - h.t[0] * 1.6 * fs;
      const by = h.p[1] - h.t[1] * 1.6 * fs - nd.side * 0.5 * fs;
      const bz = h.p[2] + 320;
      const dzB = bz - pZ;
      if (dzB > NEAR * 2) {
        const url = glassUrl(d.i, 1);
        const layer = url ? covers.layerOf(url, frameNo) : -1;
        const ch = layer < 0 ? chipOf(d.i + 1) : null;
        put(
          dzB,
          bx, by, bz,
          bh, 0, 0,
          0, bh, 0,
          0, 0, 1, 1,
          layer < 0 ? KIND_CHIP : KIND_COVER, Math.max(0, layer), k * 0.8,
          0, 0, 0.3, 0,
          ch ? ch[0]! : 0, ch ? ch[1]! : 0, ch ? ch[2]! : 0, 0,
        );
      }
    };

    /** 一句在整句排版坐标 e（em）处、字母中线（基线往上约 0.36em）的世界位置与切向；按这句这一帧的招式变形（环会把字挪到环上） */
    const pointOn = (d: LS, segs: Seg[], e: number): { p: V3; t: V3 } => {
      const { sg, s } = locate(segs, e, d.fs);
      let { p, t, d: dn } = segAt(sg, s);
      if (d.warp) ({ p, t, d: dn } = d.warp(e, e / Math.max(0.5, d.g.width), p, t, dn));
      return { p: [p[0] - dn[0] * 0.36 * d.fs, p[1] - dn[1] * 0.36 * d.fs, p[2] - dn[2] * 0.36 * d.fs], t };
    };
    const cam3 = (): V3 => [pX, pY, pZ];

    /**
     * 光的飞行路线（§9.3）：上一句句尾 → 下一句句首，三次贝塞尔，切向接着两句的走向（把手短一点，弧线平缓、不打圈）。
     * 起点固定在「唱完那一刻」的句尾：唱完的句子会往外侧滑走，光点不跟着走，留在路上等，再从那里飞向下一句。
     */
    const tailRest = (d: LS) => pointOn(d, ensureSegCache(d), d.g.width);
    const threadCurve = (a: Geo, b: Geo): ((u: number) => V3) => {
      const A = tailRest(a.d);
      const B = pointOn(b.d, b.segs, 0);
      const L = Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2]);
      const c1: V3 = [A.p[0] + A.t[0] * L * 0.3, A.p[1] + A.t[1] * L * 0.3, A.p[2] + A.t[2] * L * 0.3];
      const c2: V3 = [B.p[0] - B.t[0] * L * 0.3, B.p[1] - B.t[1] * L * 0.3, B.p[2] - B.t[2] * L * 0.3];
      return (u: number) => {
        const v = 1 - u;
        const k0 = v * v * v;
        const k1 = 3 * v * v * u;
        const k2 = 3 * v * u * u;
        const k3 = u * u * u;
        return [
          k0 * A.p[0] + k1 * c1[0] + k2 * c2[0] + k3 * B.p[0],
          k0 * A.p[1] + k1 * c1[1] + k2 * c2[1] + k3 * B.p[1],
          k0 * A.p[2] + k1 * c1[2] + k2 * c2[2] + k3 * B.p[2],
        ];
      };
    };
    /**
     * 第 a 句 → 第 a+1 句的飞行时间窗：唱完马上起飞（这时句尾还在画面里；等到下一句快开唱再飞，上一句已经贴到镜头边上，
     * 光会从画面外斜穿全屏射进来），飞到下一句句首后停在那里等开唱。空档太长（> 6 秒，光已熄）不飞。
     */
    const flightOf = (a: number): { f0: number; f1: number; fd: number; lag: number } | null => {
      const A = route.lines[a];
      const B = route.lines[a + 1];
      if (!A || !B) return null;
      if (B.s - A.e > 6) return null;
      const f0 = A.e + 0.05;
      const fd = clamp(B.s - 0.05 - f0, FLY_MIN, FLY_MAX);
      return { f0, f1: f0 + fd, fd, lag: fd * FLY_LAG };
    };

    /**
     * 光尾：飞行路线上 [u0, u1] 这一截（u1 是光点），越靠光点越亮越粗（画面上尾端约 1px → 光点处约 3.6px），
     * 不是常驻的线：光点飞到之后尾巴很快收拢消失。
     */
    /**
     * 连续无缝光带 / 气流丝（复用预分配缓冲，零每帧分配）：
     * 每个顶点算平滑切向与垂直视线的半宽向量，相邻两段完全共用端点顶点与透明度并由着色器逐像素插值，
     * 杜绝段间切缝、阶梯色差与弯处重叠加亮（「火柴棍拼接」）。
     */
    const RIB_MAX = 128;
    const _rbP = new Float32Array(RIB_MAX * 3);
    const _rbW = new Float32Array(RIB_MAX * 3);
    const _rbH = new Float32Array(RIB_MAX);
    const _rbA = new Float32Array(RIB_MAX);
    const _rbEA = new Float32Array(RIB_MAX);
    const _rbDz = new Float32Array(RIB_MAX);
    const emitRibbon = (
      pts: Float32Array,
      hwPxArr: Float32Array,
      aArr: Float32Array,
      count: number,
      col: number[],
      bias = 0,
      closed = false,
    ) => {
      if (count < 2) return;
      for (let q = 0; q < count; q++) {
        const o = q * 3;
        const px = pts[o]!;
        const py = pts[o + 1]!;
        const pz = pts[o + 2]!;
        const dz = pz - pZ;
        _rbDz[q] = dz;
        if (dz <= NEAR + 40) {
          _rbEA[q] = 0;
          continue;
        }
        _rbEA[q] = aArr[q]! * smooth((dz - 300) / 500);
        const iPrev = q === 0 ? (closed ? count - 1 : 0) : q - 1;
        const iNext = q === count - 1 ? (closed ? 0 : count - 1) : q + 1;
        const oP = iPrev * 3;
        const oN = iNext * 3;
        const tx = pts[oN]! - pts[oP]!;
        const ty = pts[oN + 1]! - pts[oP + 1]!;
        const tz = pts[oN + 2]! - pts[oP + 2]!;
        const vx = px - pX;
        const vy = py - pY;
        let wx = ty * dz - tz * vy;
        let wy = tz * vx - tx * dz;
        let wz = tx * vy - ty * vx;
        const wl = Math.hypot(wx, wy, wz) || 1;
        const hw = (hwPxArr[q]! * dz) / F;
        _rbW[o] = (wx / wl) * hw;
        _rbW[o + 1] = (wy / wl) * hw;
        _rbW[o + 2] = (wz / wl) * hw;
      }
      const segsN = closed ? count : count - 1;
      for (let q = 0; q < segsN; q++) {
        const i0 = q;
        const i1 = closed && q === count - 1 ? 0 : q + 1;
        const dz0 = _rbDz[i0]!;
        const dz1 = _rbDz[i1]!;
        if (dz0 <= NEAR + 40 || dz1 <= NEAR + 40) continue;
        const a0 = _rbEA[i0]!;
        const a1 = _rbEA[i1]!;
        if (a0 < 0.002 && a1 < 0.002) continue;
        const o0 = i0 * 3;
        const o1 = i1 * 3;
        const mx = (pts[o0]! + pts[o1]!) * 0.5;
        const my = (pts[o0 + 1]! + pts[o1 + 1]!) * 0.5;
        const mz = (pts[o0 + 2]! + pts[o1 + 2]!) * 0.5;
        const dx = (pts[o1]! - pts[o0]!) * 0.5;
        const dy = (pts[o1 + 1]! - pts[o0 + 1]!) * 0.5;
        const dzz = (pts[o1 + 2]! - pts[o0 + 2]!) * 0.5;
        put(
          (dz0 + dz1) * 0.5 + bias,
          mx, my, mz,
          dx, dy, dzz,
          _rbW[o0]!, _rbW[o0 + 1]!, _rbW[o0 + 2]!,
          _rbW[o1]!, _rbW[o1 + 1]!, _rbW[o1 + 2]!, 1,
          KIND_STROKE, 0, Math.max(a0, a1),
          col[0]!, col[1]!, col[2]!, 0,
          a0, a1, 1, 0,
        );
      }
    };
    const TRAIL_N = 24;
    const emitTrail = (curve: (u: number) => V3, u0: number, u1: number, alpha: number) => {
      const span = u1 - u0;
      for (let q = 0; q <= TRAIL_N; q++) {
        const r = q / TRAIL_N;
        const pt = curve(u0 + span * r);
        const o = q * 3;
        _rbP[o] = pt[0];
        _rbP[o + 1] = pt[1];
        _rbP[o + 2] = pt[2];
        _rbH[q] = 0.5 + 1.3 * r;
        _rbA[q] = alpha * Math.pow(r, 1.6);
      }
      emitRibbon(_rbP, _rbH, _rbA, TRAIL_N + 1, pal.glow, 0, false);
    };

    /**
     * 衬托层（2026-11-27 用户：「每句都孤零零裸漂在空间里；五张 Demo 的字都有光效衬托，做一些淡淡的气流、光带，
     * 不夺睛不吵闹的层次」）。不做实心带 / 玻璃板（§9.4 明确不做），只取 Demo 里衬托的「气」：
     *   - 气流丝（Demo 1 / 5 光带的边缘光、Demo 4 的流线）：字上一根、字下两根极细的线顺着句形走，比句子长，
     *     句尾那头继续往前流、慢慢散开；线身缓缓起伏，一段段亮暗往阅读方向流；
     *   - 光雾（Demo 4 字周围的暖光）：当前句底下一层很宽很淡的柔光，像字把周围的空气照亮；
     *   - 浮尘（Demo 2 / 4 沿带的微粒）：二三十粒极小的尘顺着气流飘、闪。
     * 光有语义（§9.2）：平时都很淡，只有正在唱的位置把它们点亮——丝上滑过一道亮光、那一片雾和尘变亮。
     * 颜色取封面色（pal.glow），全部叠加，不挡字也不挡封面。k = 强度：当前句 1，下一句约 0.35（告诉眼睛下一句在哪），唱完掠过时淡出。
     */
    const AURA_N = 44;
    const AURA_NEXT_N = 24;
    const DUST = 26;
    const STRANDS = [
      // 上方改作极淡宽光雾，重心留给下方两股非对称柔丝并避开 y/g/p 降部，去掉上下平行轨道感
      { off: -1.12, amp: 0.12, ph: 0, w: 6.2, a: 0.36 },
      { off: 0.68, amp: 0.13, ph: 2.1, w: 3.2, a: 0.78 },
      { off: 1.06, amp: 0.18, ph: 4.2, w: 6.4, a: 0.48 },
    ];
    const _ap: V3 = [0, 0, 0];
    const _at: V3 = [0, 0, 0];
    const _ad: V3 = [0, 0, 0];
    const _stP = [new Float32Array((AURA_N + 1) * 3), new Float32Array((AURA_N + 1) * 3), new Float32Array((AURA_N + 1) * 3)];
    const _stH = [new Float32Array(AURA_N + 1), new Float32Array(AURA_N + 1), new Float32Array(AURA_N + 1)];
    const _stA = [new Float32Array(AURA_N + 1), new Float32Array(AURA_N + 1), new Float32Array(AURA_N + 1)];
    const emitAura = (d: LS, segs: Seg[], kIn: number, S: number, t: number) => {
      const fs = d.fs;
      const col = pal.glow;
      // 环：气流丝换成两圈很淡的闭合轨道光（Demo 3 的轨道环），正前方唱到的地方亮一点；后半圈在封面后面被挡住
      const rg = d.ring;
      const k = (rg ? kIn * (1 - rg.k) : kIn) * (1 - d.starK);
      if (rg && rg.k > 0.01) {
        for (const [mul, da, a0] of [
          [1.16, 0.05, 1],
          [1.32, -0.05, 0.6],
        ] as const) {
          const R2 = rg.R * mul;
          const al = rg.a + da;
          const sa = Math.sin(al);
          const ca = Math.cos(al);
          const N2 = 64;
          for (let q = 0; q < N2; q++) {
            const th = (q / N2) * 2 * Math.PI;
            const o = q * 3;
            _rbP[o] = rg.C[0] + R2 * Math.sin(th);
            _rbP[o + 1] = rg.C[1] + R2 * Math.cos(th) * sa;
            _rbP[o + 2] = rg.C[2] - R2 * Math.cos(th) * ca;
            const front = 0.5 + 0.5 * Math.cos(th);
            const flow = 0.55 + 0.45 * Math.sin(3 * th - 1.4 * t + mul * 3);
            const wrap = Math.atan2(Math.sin(th), Math.cos(th));
            const g = S >= 0 ? Math.exp(-((wrap / 0.32) ** 2)) : 0;
            _rbH[q] = 2 + 2 * g;
            _rbA[q] = kIn * rg.k * a0 * (0.05 * flow * (0.35 + 0.65 * front) + 0.2 * g);
          }
          emitRibbon(_rbP, _rbH, _rbA, N2, col, 1.5, true);
        }
      }
      if (k < 0.01) return;
      const trOff = d.g.tr && showTr ? 0.72 : 0;
      const sing = S >= 0 ? locate(segs, S, fs) : null;
      const last = segs.length - 1;
      const seed = (d.i * 0.6180339) % 1;
      const nSeg = k > 0.5 ? AURA_N : AURA_NEXT_N;
      const bases = [
        STRANDS[0]!.off > 0 ? STRANDS[0]!.off + trOff : STRANDS[0]!.off,
        STRANDS[1]!.off > 0 ? STRANDS[1]!.off + trOff : STRANDS[1]!.off,
        STRANDS[2]!.off > 0 ? STRANDS[2]!.off + trOff : STRANDS[2]!.off,
      ];
      for (let r = 0; r <= last; r++) {
        const sg = segs[r]!;
        const L = sg.half * 2;
        const twoLine = last > 0;
        // 错落双行时：第一行只画上方柔雾，第二行只画下方两股气流丝，整体合围双行而不从两行字之间穿过
        const siFrom = twoLine && r > 0 ? 1 : 0;
        const siTo = twoLine && r === 0 ? 1 : 3;
        // 句首那头只出一点、句尾那头继续往前流
        const s0 = -sg.half - (r === 0 || twoLine ? 0.16 : 0.06) * L;
        const s1 = sg.half + (r === last || twoLine ? 0.38 : 0.06) * L;
        const glintAt = sing && sing.sg === sg ? sing.s : null;
        // —— 气流丝（每步采一次 segAtOut，共用再按连续无缝丝带提交） ——
        const invL13 = (2 * Math.PI) / (1.3 * L);
        const invL045 = (2 * Math.PI) / (0.45 * L);
        const seedRad = seed * 6.28;
        for (let q = 0; q <= nSeg; q++) {
          const u = q / nSeg;
          const s = s0 + (s1 - s0) * u;
          segAtOut(sg, s, _ap, _at, _ad);
          const outD = Math.max(0, s - sg.half, -sg.half - s) / L;
          const outSq = outD * outD * 2.4;
          const taper = smooth(u / 0.14) * smooth((1 - u) / 0.3);
          const g = glintAt !== null ? Math.exp(-(((s - glintAt) / (1.4 * fs)) ** 2)) : 0;
          const o = q * 3;
          for (let si = siFrom; si < siTo; si++) {
            const st = STRANDS[si]!;
            const base = bases[si]!;
            const off = (base + st.amp * Math.sin(s * invL13 - 1.1 * t + st.ph + seedRad) + (base >= 0 ? outSq : -outSq)) * fs;
            const pArr = _stP[si]!;
            pArr[o] = _ap[0] + _ad[0] * off;
            pArr[o + 1] = _ap[1] + _ad[1] * off;
            pArr[o + 2] = _ap[2] + _ad[2] * off;
            const flow = 0.55 + 0.45 * Math.sin(s * invL045 - 1.6 * t + st.ph);
            _stH[si]![q] = st.w * (0.7 + 0.5 * taper) * (1 + 0.6 * g);
            _stA[si]![q] = k * taper * st.a * (0.05 * flow + 0.22 * g);
          }
        }
        for (let si = siFrom; si < siTo; si++) {
          emitRibbon(_stP[si]!, _stH[si]!, _stA[si]!, nSeg + 1, col, 1.5, false);
        }
        // —— 光雾：沿字的中线排一串互相重叠的柔光椭圆（宽光段拼接在弯处会拼出放射状的条纹），唱到的地方亮一点 ——
        if (k > 0.5) {
          const hk = (k - 0.5) / 0.5;
          const step = 0.55 * fs;
          const n = Math.max(2, Math.ceil(L / step));
          const ry = (0.95 + trOff * 0.5) * fs;
          const rx = 1.3 * fs;
          const m = -0.34 * fs + trOff * 0.4 * fs;
          for (let q = 0; q <= n; q++) {
            const um = q / n;
            const s = -sg.half + L * um;
            segAtOut(sg, s, _ap, _at, _ad);
            const x = _ap[0] + _ad[0] * m;
            const y = _ap[1] + _ad[1] * m;
            const z = _ap[2] + _ad[2] * m;
            const dz = z - pZ;
            if (dz < 300) continue;
            const taper = smooth((um + 0.05) / 0.25) * smooth((1.05 - um) / 0.25);
            const gx = glintAt !== null ? (s - glintAt) / (2.4 * fs) : 9;
            const g = Math.exp(-gx * gx);
            // 重叠的高斯叠加后约是单个的 rx / step 倍，这里除掉
            const I = ((hk * taper * (0.014 + 0.03 * g) * step) / rx) * smooth((dz - 300) / 500);
            if (I < 0.0015) continue;
            put(dz + 2, x, y, z, _at[0] * rx, _at[1] * rx, _at[2] * rx, _ad[0] * ry, _ad[1] * ry, _ad[2] * ry, 0, 0, 1, 1, KIND_LIGHT, 0, 1, col[0]! * I, col[1]! * I, col[2]! * I, 0, 0, 0, 0, 0);
          }
        }
        // —— 浮尘 ——
        const nd = Math.round((k > 0.5 ? DUST : 10) / segs.length);
        const span = s1 - s0;
        for (let m = 0; m < nd; m++) {
          const key = d.i * 131 + r * 37 + m;
          const h1 = hash01(key, 1);
          const h2 = hash01(key, 2);
          const h3 = hash01(key, 3);
          const h4 = hash01(key, 4);
          const s = s0 + ((h1 * span + t * 0.1 * L * (0.6 + 0.8 * h2)) % span);
          const v = (s - s0) / span;
          const edge = smooth(v / 0.12) * smooth((1 - v) / 0.2);
          segAtOut(sg, s, _ap, _at, _ad);
          const off = (-1.7 + (3.2 + trOff) * h3 + 0.12 * Math.sin(t * 0.7 + h4 * 6.28)) * fs;
          const x = _ap[0] + _ad[0] * off;
          const y = _ap[1] + _ad[1] * off;
          const z = _ap[2] + _ad[2] * off;
          const dz = z - pZ;
          if (dz < 300) continue;
          const tw = 0.5 + 0.5 * Math.sin(t * (1.2 + 1.8 * h2) + h4 * 6.28);
          let lit = 0;
          if (glintAt !== null) {
            const lx2 = (s - glintAt) / (2.2 * fs);
            const ly2 = (off + 0.34 * fs) / (1.6 * fs);
            lit = Math.exp(-lx2 * lx2 - ly2 * ly2);
          }
          const I = k * edge * smooth((dz - 300) / 500) * (0.05 + 0.08 * tw + 0.5 * lit);
          if (I < 0.004) continue;
          const rad = ((1.3 + 1.5 * h4) * dz) / F;
          put(dz + 1.4, x, y, z, rad, 0, 0, 0, rad, 0, 0, 0, 1, 1, KIND_LIGHT, 0, 1, col[0]! * I, col[1]! * I, col[2]! * I, 0, 0, 0, 0, 0);
        }
      }
    };

    // —— 帧循环 ——
    let raf = 0;
    let last = performance.now();
    let lastPos = -1;
    let extrap = 0;
    let smoothT = 0;
    let rootOp = '';
    let frameNo = 0;
    let lightK = 0;
    /** 光点亮度：飞到下一句句首、等开唱时稍暗 */
    let lightI = 1;
    let lx = 0;
    let ly = 0;
    let lz = 0;
    let drawn = 0;
    let camZ = route.z0;
    const times: number[] = [];
    let probeLines: ProbeLine[] = [];
    /** 光点这一帧在做什么（自检用）：唱 / 飞 / 在句首等 / 无 */
    let lightMode: 'sing' | 'fly' | 'wait' | 'off' = 'off';
    /** 取词加载三点淡入淡出进度（0–1），以及三点探针状态 */
    let loadVis = 0;
    let dotsProbe: { mode: 'interlude' | 'loading' | 'none'; op: number; levels: number[] } = { mode: 'none', op: 0, levels: [0, 0, 0] };
    /** 在隧道前方路线上画三颗清晰 3D 圆点（抗锯齿实心珠 + 极轻光晕，不再糊成大光斑） */
    const emitDots = (op0: number, levels: [number, number, number], scales: [number, number, number], yOffs: [number, number, number]) => {
      const zDot = camZ + DREST;
      const cx3 = pathX(zDot);
      const cy3 = pathY(zDot);
      const col = pal.glow;
      const rCol = col[0]! + (1 - col[0]!) * 0.55;
      const gCol = col[1]! + (1 - col[1]!) * 0.55;
      const bCol = col[2]! + (1 - col[2]!) * 0.55;
      const dz = DREST - 1;
      for (let idx = 0; idx < 3; idx++) {
        const lv = levels[idx]!;
        const sc = scales[idx]!;
        const x = cx3 + (idx - 1) * 28;
        const y = cy3 + yOffs[idx]!;
        const rad = 11 * sc;
        const a = op0 * (0.28 + 0.72 * lv);
        const halo = 0.22 * lv;
        put(dz, x, y, zDot, rad, 0, 0, 0, rad, 0, 0, 0, 1, 1, KIND_DOT, 0, a, rCol, gCol, bCol, 0, halo, 0, 0, 0);
      }
    };

    const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flyHost = flyHostRef.current;
    let lsPrev = lsOpenRef.current;
    let lsFly: LsFly | null = null;
    let lsFlyDir: 'in' | 'out' | null = null;
    let lsFlySlots: TravelFlySession | null = null;
    let lsOutBlendT0 = 0;
    let morphFly: LsFly | null = null;
    let morphDir: 'in' | 'out' | null = null;
    let morphSlots: TravelFlySession | null = null;
    let morphInBlendT0 = 0;
    let morphTries = 0;
    /** 飞入穿行（漫游 → 穿行 / 听音空间 → 穿行）落地句的衬托光带渐显，避免落地瞬间气流与光雾突兀弹出 */
    let landingLineIdx = -1;
    let landingAura = 1;
    let lsFadeT0 = 0;
    let lsBoostUntil = 0;
    let lsWantAt = 0;
    let lsAttemptAt = 0;
    let lastGeos: Geo[] = [];
    let lastCur = -1;
    const camNow = (): FlyCam => ({ pcx, pcy, pX, pY, pZ, F, near: NEAR });
    const endMorph = () => {
      if (morphFly) {
        morphFly.end();
        morphFly = null;
      }
      if (morphSlots) {
        morphSlots.clear();
        morphSlots = null;
      }
      morphDir = null;
      morphInBlendT0 = 0;
      if (pageBus.morph) pageBus.morph = false;
    };
    const startMorph = (i: number, d: LS, e: EngineLine, segs: Seg[], state: LS['state'], t: number): boolean => {
      if (!flyHost || reduceMotion) return false;
      const caption = roamRef.current === 'caption';
      const host = document.querySelector<HTMLElement>(
        caption ? '.lyric-caption > :first-child' : '.lyrics-layer .flow-lyric.is-current .fl-words',
      );
      if (!host) return false;
      const src = [...host.querySelectorAll<HTMLElement>(':scope > .u, :scope > .fl-whole')];
      if (!src.length) return false;
      syncPalette();
      const dir: 'in' | 'out' = listenBus.target === 1 ? 'in' : 'out';
      const slots0 = createTravelFlySession(flyHost, i, e, d.g, d.fs, segs, d.warp, camNow(), t, schemeRef.current, state, dir === 'in' ? 0 : 1);
      if (!slots0) return false;
      if (src.length !== slots0.units.length || normLyricText(src.map((u) => u.textContent || '').join('')) !== normLyricText(slots0.text)) {
        slots0.clear();
        return false;
      }
      const srcHost = (caption ? host : host.closest<HTMLElement>('.flow-lyric')) ?? host;
      const parseRoamXf = (tf: string) => {
        const mT = tf.match(/translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/);
        const mR = tf.match(/rotate\((-?[\d.]+)deg\)/);
        const mS = tf.match(/scale\((-?[\d.]+)\)/);
        return {
          tx: mT ? parseFloat(mT[1]!) : 0,
          ty: mT ? parseFloat(mT[2]!) : 0,
          rot: mR ? parseFloat(mR[1]!) : 0,
          sc: mS ? parseFloat(mS[1]!) : 1,
        };
      };
      const initXf = caption ? { tx: 0, ty: 0, rot: 0, sc: 1 } : parseRoamXf(srcHost.style.transform);
      const srcRot = caption ? 0 : initXf.rot;
      const roamOp = caption ? 1 : 0.5;
      // 穿行 → 漫游时用纯 JS 解析 srcHost.style.transform 增量追踪终点，跳过每帧对漫游词调用 getBoundingClientRect / getComputedStyle 的强制重排
      const roamSide = (el: HTMLElement): FlySide => {
        let lastTx = initXf.tx;
        let lastTy = initXf.ty;
        let lastRot = initXf.rot;
        let lastSc = initXf.sc;
        const side: FlySide = {
          el,
          ctx: el.classList.contains('fl-whole') ? 'lpm-r' : 'lpm-r is-grad',
          rot: srcRot,
          vert: false,
          opacity: roamOp,
          endOpacity: roamOp,
          place:
            dir === 'out'
              ? (prev) => {
                  if (!prev) {
                    if (!caption) {
                      const xf = parseRoamXf(srcHost.style.transform);
                      lastTx = xf.tx;
                      lastTy = xf.ty;
                      lastRot = xf.rot;
                      lastSc = xf.sc;
                      side.rot = xf.rot;
                    }
                    return null;
                  }
                  if (caption) return prev;
                  const xf = parseRoamXf(srcHost.style.transform);
                  if (Math.abs(xf.sc - lastSc) > 0.002 || Math.abs(xf.rot - lastRot) > 0.05) {
                    lastTx = xf.tx;
                    lastTy = xf.ty;
                    lastRot = xf.rot;
                    lastSc = xf.sc;
                    side.rot = xf.rot;
                    return null;
                  }
                  const dx = xf.tx - lastTx;
                  const dy = xf.ty - lastTy;
                  lastTx = xf.tx;
                  lastTy = xf.ty;
                  return { x: prev.x + dx, y: prev.y + dy, f: prev.f, rot: prev.rot, sx: prev.sx, sy: prev.sy };
                }
              : undefined,
        };
        return side;
      };
      const pairs: FlyPair[] =
        dir === 'in'
          ? src.map((el, j) => ({ from: roamSide(el), to: slots0.sides[j]! }))
          : src.map((el, j) => ({ from: slots0.sides[j]!, to: roamSide(el) }));
      const fly = new LsFly(pairs, () => null, 1, hideFlyElements, (x) => x);
      if (fly.done) {
        slots0.clear();
        return false;
      }
      // 先在 0 处附着终点并锁定 e0=0，保证无论正向推进还是中途折返都对称插值
      fly.render(0);
      morphFly = fly;
      morphDir = dir;
      morphSlots = slots0;
      if (dir === 'in') {
        landingLineIdx = i;
        landingAura = 0;
      }
      pageBus.morph = true;
      pageBus.morphS = e.s;
      pageBus.caption = caption;
      return true;
    };
    const endLsFly = () => {
      lsFly?.end();
      lsFly = null;
      lsFlyDir = null;
      lsFlySlots?.clear();
      lsFlySlots = null;
      lsOutBlendT0 = 0;
    };
    const startLsIn = (t: number) => {
      if (!flyHost || lastCur < 0) return;
      endMorph();
      const gCur = lastGeos.find((g) => g.d.i === lastCur && g.op > 0.12 && !g.d.done);
      if (!gCur) return;
      const slots0 = createTravelFlySession(flyHost, gCur.d.i, els[gCur.d.i]!, gCur.d.g, gCur.d.fs, gCur.segs, gCur.d.warp, camNow(), t, schemeRef.current, gCur.state);
      if (!slots0) return;
      const fly = launchStageToListenFly(
        [{ text: slots0.text, offsetFromCur: 0, units: slots0.units, sideOf: (el) => slots0.sides[slots0.units.indexOf(el)]! }],
        { flightMs: 600 },
      );
      if (fly) {
        lsFly = fly;
        lsFlyDir = 'in';
        lsFlySlots = slots0;
      } else {
        slots0.clear();
      }
    };
    const startLsOut = (t: number) => {
      if (!flyHost || !els.length) return;
      endMorph();
      applyPendingResize();
      if (!vw) {
        const b = root.getBoundingClientRect();
        vw = b.width || window.innerWidth;
        vh = b.height || window.innerHeight;
      }
      const cx0 = vw / 2;
      const cy0 = vh * 0.47;
      camZ = camAt(route, t);
      pcx = cx0;
      pcy = cy0;
      pX = pathX(camZ);
      pY = pathY(camZ);
      pZ = camZ;
      let cur0 = -1;
      {
        let lo0 = 0;
        let hi0 = route.lines.length - 1;
        while (lo0 <= hi0) {
          const m = (lo0 + hi0) >> 1;
          if (route.lines[m]!.s <= t + 0.05) {
            cur0 = m;
            lo0 = m + 1;
          } else hi0 = m - 1;
        }
      }
      if (cur0 < 0) return;
      const e = els[cur0]!;
      if (t > e.e + 0.1) return;
      let d = doms.get(cur0);
      if (!d) {
        d = makeLine(cur0) ?? undefined;
        if (d) {
          doms.set(cur0, d);
          atlas.flush();
        }
      }
      if (!d) return;
      const turnK = smooth((t - (e.s - TURN_FROM)) / (TURN_FROM - TURN_TO));
      const passK = smooth((t - e.e - 0.05) / 1.2);
      const segs = segsOf(d, turnK, passK);
      const state: LS['state'] = t > e.e + 0.9 ? 'past' : t >= e.s - 0.05 ? 'cur' : 'future';
      syncPalette();
      const slots0 = createTravelFlySession(flyHost, cur0, e, d.g, d.fs, segs, d.warp, camNow(), t, schemeRef.current, state, 0);
      if (!slots0) return;
      const cols = matchColumnLines([{ text: slots0.text, offsetFromCur: 0 }]);
      const col = cols[0] ?? null;
      const us = columnUnitsOf(col);
      lsBoostUntil = performance.now() + 2600;
      if (!col || !us.length || us.length !== slots0.units.length) {
        slots0.clear();
        return;
      }
      const pairs: FlyPair[] = us.map((el, j) => ({ from: columnSideOf(col, el), to: slots0.sides[j]! }));
      const fly = new LsFly(pairs, () => null, 700, hideFlyElements);
      if (fly.done) {
        slots0.clear();
        return;
      }
      lsFly = fly;
      lsFlyDir = 'out';
      lsFlySlots = slots0;
      landingLineIdx = cur0;
      landingAura = 0;
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (lost) return;
      const dt = clamp((now - last) / 1000, 0.001, 0.05);
      last = now;
      const playing = playingRef.current;
      const pos = audioPlayer.position();
      if (playing && pos === lastPos) extrap = Math.min(0.25, extrap + dt);
      else extrap = 0;
      lastPos = pos;
      let cand = playing ? pos + extrap : pos;
      if (playing && cand < smoothT && smoothT - cand < 0.15) cand = smoothT;
      smoothT = cand;
      const t = cand;
      const k = listenBus.enabled ? listenBus.k : 0;
      const lsNow = lsOpenRef.current;
      const travelOwns = listenBus.enabled && k > 0.5;
      if (lsNow !== lsPrev) {
        endLsFly();
        if (lsNow) {
          enteredFromTravelRef.current = travelOwns;
          lsFadeT0 = travelOwns || Number(rootOp) > 0.002 ? now : 0;
          if (travelOwns) {
            startLsIn(t);
            lsWantAt = lsFly ? 0 : now;
            lsAttemptAt = now;
          } else {
            lsWantAt = 0;
          }
        } else {
          lsFadeT0 = 0;
          lsWantAt = 0;
          if (pinRef.current && (enteredFromTravelRef.current || travelOwns)) {
            startLsOut(t);
          }
          enteredFromTravelRef.current = false;
        }
        lsPrev = lsNow;
      }
      if (lsNow && enteredFromTravelRef.current && !lsFly && lsWantAt && now - lsWantAt < 250 && now - lsAttemptAt > 60) {
        lsAttemptAt = now;
        startLsIn(t);
        if (lsFly) lsWantAt = 0;
      }
      const boost = now < lsBoostUntil && k < 0.99 ? 1 : 0;
      if (k >= 0.99) lsBoostUntil = 0;
      if (lsFly && lsFlyDir === 'in') {
        if (lsFly.step(now)) endLsFly();
      }
      const fade = !lsNow
        ? 1
        : lsFly
          ? 1 - smooth(lsFly.progress / 0.55)
          : lsFadeT0 > 0
            ? 1 - smooth((now - lsFadeT0) / 330)
            : 0;
      const op = Math.min(Math.max(k, boost), fade);
      const opS = op < 0.002 ? '0' : op.toFixed(3);
      if (opS !== rootOp) {
        root.style.opacity = opS;
        rootOp = opS;
      }
      if (lsNow || lsFly || boost > 0) {
        if (morphFly) endMorph();
        morphTries = 99;
      } else if (k <= 0.001) {
        if (morphFly) endMorph();
        morphTries = 0;
      } else if (k >= 0.999) {
        if (morphFly && morphDir === 'in') {
          // 漫游 → 穿行抵达 k=1：进入 140ms 锁位交叉淡化（DOM 与 WebGL2 完全重合后融化交接，零闪跳）
          if (!morphInBlendT0) morphInBlendT0 = now;
        } else {
          if (morphFly) endMorph();
          morphTries = 0;
        }
      } else if (morphInBlendT0 > 0) {
        // 交接融化尚未结束就被用户退出（k < 1）：立刻清理进入反向流程
        endMorph();
        morphTries = 0;
      }
      if (op < 0.002) {
        if (lsFly && lsFlyDir === 'out' && lsFly.step(now)) endLsFly();
        return;
      }
      if (k > 0.35 && !lsNow) notifySmallLibraryOnce(tracks, noticeRef.current);
      const t0 = performance.now();
      frameNo++;
      applyPendingResize();
      if (!vw) {
        const b = root.getBoundingClientRect();
        vw = b.width || window.innerWidth;
        vh = b.height || window.innerHeight;
        canvas.width = Math.max(1, Math.round(vw * dpr));
        canvas.height = Math.max(1, Math.round(vh * dpr));
      }
      if (frameNo % 20 === 1) syncPalette();
      const cx = vw / 2;
      const cy = vh * 0.47;
      // 漫游 ↔ 穿行轻纵深推入（方案 1A）：进入时镜头从后方 420 单位平滑滑入，k=1 时归零无折角
      const enterPull = reduceMotion || boost > 0 ? 0 : -420 * (1 - k) * (1 - k);
      camZ = camAt(route, t) + enterPull;
      const camX = pathX(camZ);
      const camY = pathY(camZ);
      pcx = cx;
      pcy = cy;
      pX = camX;
      pY = camY;
      pZ = camZ;
      const st = shape ? stageAt(shape, shapeLines, t) : { lift: 0.3, gap: 0, section: -1, stanza: -1 };

      // 当前句（光源）：最后一句已开唱的
      let cur = -1;
      {
        let lo = 0;
        let hi = route.lines.length - 1;
        while (lo <= hi) {
          const m = (lo + hi) >> 1;
          if (route.lines[m]!.s <= t + 0.05) {
            cur = m;
            lo = m + 1;
          } else hi = m - 1;
        }
      }
      const curL = cur >= 0 ? route.lines[cur]! : null;
      const nextL = cur + 1 < route.lines.length ? route.lines[cur + 1]! : null;
      // 光在句间空档里沿光丝走向下一句，所以空档里也亮着（空档太长才熄）
      const inGap = !!curL && !!nextL && t > curL.e && t < nextL.s && nextL.s - curL.e < 6;
      const lightOn = curL && (t <= curL.e + 0.6 || inGap) ? 1 : 0;
      lightK += (lightOn - lightK) * (1 - Math.exp(-dt * 3));
      if (curL) {
        [lx, ly] = beatAt(cur);
        lz = curL.z;
      }

      // —— 歌词：要哪几句（多建一句在前方，字形提前画好，不在出现的那一帧卡） ——
      const scheme = schemeRef.current;
      const want = new Set<number>();
      const iEnd = Math.min(route.lines.length - 1, Math.max(cur, 0) + AHEAD);
      for (let i = Math.max(0, cur - 1); i <= iEnd; i++) {
        const dz = route.lines[i]!.z - camZ;
        if (dz > LINE_FAR) break;
        if (dz > 40) want.add(i);
      }
      // 没有歌词（取词中、纯音乐）时 pre = -1
      const pre = Math.min(route.lines.length - 1, iEnd + 1);
      for (const d of [...doms.values()]) if (!want.has(d.i) && d.i !== pre) dropLine(d);
      if (fontsReady) {
        let built = 0;
        const maxBuild = morphFly || lsFly || (k > 0.001 && k < 0.999) ? 1 : 2;
        const orderBuild = pre >= 0 ? [...want, pre] : [...want];
        if (cur >= 0 && want.has(cur) && !doms.has(cur)) {
          const idx = orderBuild.indexOf(cur);
          if (idx > 0) {
            orderBuild.splice(idx, 1);
            orderBuild.unshift(cur);
          }
        }
        for (const i of orderBuild) {
          if (doms.has(i)) continue;
          const d = makeLine(i);
          if (d) doms.set(i, d);
          // 转场期每帧最多建 1 句（且优先建当前句），平时最多 2 句，平摊首帧上传与 mipmap 开销
          if (++built >= maxBuild) break;
        }
      }
      atlas.flush();

      n = 0;
      // 落地锁位交叉淡化（220ms）：飞行全程 WebGL2 不提前露重影；抵达 100% 锁齐曲线后再 220ms 融化交接，杜绝落地闪黑与样式跳变
      const HANDOFF_MS = 220;
      const lsOutP = lsFly && lsFlyDir === 'out' ? lsFly.progress : -1;
      if (lsFly && lsFlyDir === 'out' && !lsOutBlendT0 && lsOutP >= 1) lsOutBlendT0 = now;
      const lsOutBlend = lsOutBlendT0 > 0 ? clamp((now - lsOutBlendT0) / HANDOFF_MS, 0, 1) : 0;
      const glLsOutK = lsOutBlendT0 > 0 ? smooth(lsOutBlend) : 0;
      const morphInBlend = morphInBlendT0 > 0 ? clamp((now - morphInBlendT0) / HANDOFF_MS, 0, 1) : 0;
      const glMorphInK = morphInBlendT0 > 0 ? smooth(morphInBlend) : 0;
      if (landingLineIdx >= 0) {
        let arrP = 2;
        if (morphFly && morphDir === 'in' && morphSlots?.lineIdx === landingLineIdx) arrP = morphInBlendT0 > 0 ? 2 : k;
        else if (lsFly && lsFlyDir === 'out' && lsFlySlots?.lineIdx === landingLineIdx) arrP = lsOutBlendT0 > 0 ? 2 : lsOutP;
        if (arrP < 0.65) {
          landingAura = 0;
        } else if (arrP <= 1) {
          const target = 0.35 * smooth((arrP - 0.65) / 0.35);
          landingAura += (target - landingAura) * (1 - Math.exp(-dt * 10));
        } else {
          landingAura += (1 - landingAura) * (1 - Math.exp(-dt * 4.0));
          if (landingAura > 0.995) {
            landingAura = 1;
            landingLineIdx = -1;
          }
        }
      }
      // —— 歌词：逐字层算状态 → 姿态（远处侧着、开唱前转正、唱完往外侧掠过）→ 沿曲线出字 ——
      const geos: Geo[] = [];
      /** 当前句这一帧在画面上的外接框（粗判）与曲线包络圆（精细让位） */
      let curBox: Bound | null = null;
      let curCircles: Circle[] | null = null;
      /** 卷起：这一帧的螺旋（封面转角、螺旋光） */
      let swirl: { zMid: number; zHalf: number; ang: number; sw: number; side: number; zEnd: number } | null = null;
      /** 穿针：这一帧的那一句 */
      let needle: { d: LS; segs: Seg[]; k: number; S: number; side: number } | null = null;
      probeLines = [];
      let lightPt: V3 | null = null;
      for (const i of [...want].sort((a, b) => a - b)) {
        const d = doms.get(i);
        if (!d) continue;
        const L = route.lines[i]!;
        const e = els[i]!;
        const dz = L.z - camZ;
        const done = t > e.e + 0.1;
        d.done = done;
        // 唱完后「时间 + 距离」双重退场：停顿时微退、下一句开唱即在 0.45s 内让出清晰度与亮度，不再压过新当前句
        const doneAgo = Math.max(0, t - e.e);
        const pauseK = doneAgo > 0 ? 0.28 * smooth(doneAgo / 0.5) : 0;
        const nextStart = i < cur && cur >= 0 ? els[cur]!.s : e.e;
        const yieldK = i < cur ? smooth((t - nextStart) / 0.45) : 0;
        const postK = pauseK + (1 - pauseK) * yieldK;
        const near = done ? smooth((dz - 380) / 420) * (1 - 0.54 * postK) : smooth((dz - 160) / 380);
        const far = smooth((LINE_FAR - dz) / 900);
        const state: LS['state'] = t > e.e + 0.9 ? 'past' : t >= e.s - 0.05 ? 'cur' : 'future';
        const dist = i - Math.max(cur, -1);
        // 下一句要提前读得到（§9.2）：侧着、变小之后比 #287 的平放更难读，亮度提一档（.72 / .36，候场色也从白 34% 提到 46%）
        const dim = state === 'future' ? (dist <= 1 ? 0.72 : 0.36) * (1 - 0.6 * st.gap) : 1;
        const o = near * far * dim;
        if (state !== d.state) {
          d.state = state;
          if (state !== 'cur' && d.w && d.active) {
            d.w.rts.forEach(restUnit);
            d.active = false;
          }
        }
        let S = -1;
        if (state === 'cur' && d.w?.rts.length) {
          const singing = t <= e.e + 0.3;
          const raw = singing ? waveOf(d.w.rts, e.dens, t) : null;
          const waveK = smooth((t - (e.s - 0.05)) / 0.15);
          const wave = raw ? (c: number) => raw(c) * waveK : null;
          for (const rt of d.w.rts) unitFrame(rt, t, scheme, singing, wave, e.dens);
          if (!singing && d.active) d.w.rts.forEach(restUnit);
          d.active = singing;
          if (singing && i === cur) {
            const us = d.w.rts;
            for (let q = 0; q < us.length; q++) {
              const r = us[q]!;
              if (t < r.u.s) {
                if (q > 0) {
                  const pv = us[q - 1]!;
                  const k2 = clamp((t - pv.u.e) / Math.max(0.01, r.u.s - pv.u.e), 0, 1);
                  S = pv.left + pv.w + (r.left - pv.left - pv.w) * smooth(k2);
                }
                break;
              }
              if (t < r.u.e) {
                S = r.left + r.w * clamp((t - r.u.s) / Math.max(0.001, r.u.e - r.u.s), 0, 1);
                break;
              }
            }
          }
        }
        // 姿态：远处 → 开唱前 2.4–0.3 秒间以句首为轴慢慢转正；唱完往离路线远的一侧推开、略往下（从镜头侧边掠过，不糊在画面正中）
        const turnK = smooth((t - (e.s - TURN_FROM)) / (TURN_FROM - TURN_TO));
        const passK = smooth((t - e.e - 0.05) / 1.2);
        const segs = segsOf(d, turnK, passK);
        // —— 招式：环（§9.4）——开唱前 1.7–0.4 秒绕上去，唱完 0.15 秒后 0.9 秒内松开、回到路上（随后掠过）
        const mv = choreo[i]!;
        d.ring = null;
        d.warp = null;
        d.trWarp = null;
        d.star = null;
        d.starK = 0;
        if (mv.move === 'ring') {
          const rk = smooth((t - (e.s - 1.7)) / 1.3) * (1 - smooth((t - e.e - 0.15) / 0.9));
          // 字只占环正面约 140°（设计稿原写「周长约为句长 1.15 倍」，实测短句的环直径只有两三个字宽，正面一次只露两三个字，读不出来）。
          // 开唱前整句偏左居中朝前；唱的时候只在句子中间那段跟着转，正在唱的字始终在正前方 ±20° 内，整句一直大致看得见
          const w = d.g.width;
          const target = t < e.s ? 0.35 * w : clamp(S >= 0 ? S : t > e.e ? w : d.rf, 0.35 * w, 0.65 * w);
          if (d.rf === 0) d.rf = target;
          d.rf += (target - d.rf) * (1 - Math.exp(-dt * 6));
          if (rk > 0.001) {
            const R = (w * d.fs) / (140 * DEG);
            const a = mv.side * 24 * DEG;
            const an = anchorOf(d, 0);
            // 正前方（离镜头最近、字最正）落在锚点上
            const ring: Ring = { C: [an[0], an[1] - R * Math.sin(a), an[2] + R * Math.cos(a)], R, a, k: rk, front: d.rf, fs: d.fs, width: d.g.width };
            d.ring = ring;
            d.warp = (em, u, p, tg, dn) => warpRing(ring, em, u, p, tg, dn, cam3());
            emitHero(ring, rk * o);
          }
        } else if (mv.move === 'swirl') {
          // —— 卷起（§9.4）：进这句之前，路段上一道双股螺旋光、沿途封面被卷着转；句子从螺旋里转着停到出口，开唱时是正的 ——
          const sw = smooth((t - (e.s - 2.8)) / 1.6) * (1 - smooth((t - e.e) / 1.0));
          if (sw > 0.001) {
            const amp = 0.7 + 0.3 * mv.amp;
            swirl = { zMid: L.z - 950, zHalf: 650, ang: mv.side * sw * 150 * DEG * amp, sw, side: mv.side, zEnd: L.z };
            const spin = smooth((t - (e.s - 2.6)) / 2.2);
            const phi = (1 - spin) * mv.side * 140 * DEG;
            if (Math.abs(phi) > 0.001) {
              const ax = pathX(L.z);
              const ay = pathY(L.z);
              const c = Math.cos(phi);
              const sn = Math.sin(phi);
              const rot = (v: V3): V3 => [v[0] * c - v[1] * sn, v[0] * sn + v[1] * c, v[2]];
              d.warp = (_em, _u, p, tg, dn) => {
                const o2 = rot([p[0] - ax, p[1] - ay, 0]);
                return { p: [ax + o2[0], ay + o2[1], p[2]], t: rot(tg), d: rot(dn), vis: 1 };
              };
              d.trWarp = d.warp;
            }
          }
        } else if (mv.move === 'needle') {
          // —— 穿针（§9.4）：一张玻璃化的封面盖在还没唱的后半截上，随演唱往右滑开、字从它背后露出来；
          //    另一张封面在句首左后方，两张一起像针眼。开唱的词始终在玻璃左边（不被挡）——
          const nk = smooth((t - (e.s - 2.2)) / 1.4) * (1 - smooth((t - e.e - 0.1) / 0.8));
          if (nk > 0.001) needle = { d, segs, k: nk, S: S >= 0 ? S : t >= e.e ? d.g.width : t >= e.s ? needleS(d, e, t) : 0, side: mv.side };
        } else if (mv.move === 'constellation' && mv.cuts?.length) {
          // —— 星座（§9.4）：开唱前 2.4–0.8 秒散开挂到各自的星上，之后一直挂着、随镜头掠过 ——
          const sk = smooth((t - (e.s - 2.4)) / 1.6);
          if (sk > 0.001) {
            const [bx, by] = beatAt(i);
            const unit = ((vw || window.innerWidth) * DSING) / F;
            // 星座留在这句自己那一行（上下交替的错位不能动，否则和下一句撞上），只横向往中间收一半，各截按画面比例摆开
            const center: V3 = [pathX(L.z) + (bx - pathX(L.z)) * 0.5, by + 0.2 * d.fs, L.z];
            const pieces = buildStar(center, d.g.units, mv.cuts, d.fs, unit * 0.85, mv.side);
            d.star = pieces;
            d.starK = sk;
            const fsl = d.fs;
            d.warp = (em, _u, p, tg, dn) => warpStar(pieces, sk, fsl, em, p, tg, dn);
            // 译文排在最低那一截的正下方、横向居中
            const low = pieces.reduce((a, b) => (b.C[1] > a.C[1] ? b : a));
            const trC: V3 = [center[0], low.C[1] + 0.95 * d.fs, low.C[2]];
            const trW = d.g.trWidth;
            d.trWarp = (em, _u, p, tg, dn) => {
              const x = (em - trW / 2) * fsl;
              const q: V3 = [trC[0] + x, trC[1], trC[2]];
              return { p: [p[0] + (q[0] - p[0]) * sk, p[1] + (q[1] - p[1]) * sk, p[2] + (q[2] - p[2]) * sk], t: tg, d: dn, vis: 1 };
            };
            emitStar(d, pieces, sk, o, t);
          }
        } else if (mv.move === 'stand' && e.units?.length) {
          // —— 立起（§9.4）：句子平躺在路面上（向后倒约 62°，像公路标线字），唱到哪个词，那个词带一点弹性立起来
          //    （设计稿写 55°；实测正对着看时 55° 只矮一截、不像「躺着」，加到 62°，透视下仍读得出）——
          const us = d.g.units;
          const eu = e.units;
          const nU = us.length;
          const csArr = new Float32Array(nU * 2);
          for (let q = 0; q < nU; q++) {
            const x = t - ((eu[q] ?? eu[eu.length - 1]!).s - 0.1);
            const sk = x <= 0 ? 0 : 1 - Math.exp(-7 * x) * Math.cos(12 * x);
            const phi = 62 * DEG * (1 - sk);
            csArr[q * 2] = Math.cos(phi);
            csArr[q * 2 + 1] = Math.sin(phi);
          }
          let curU = 0;
          d.warp = (em, _u, p, tg, dn) => {
            if (curU >= nU || em < us[curU]!.left - 0.05) curU = 0;
            while (curU + 1 < nU && em >= us[curU + 1]!.left - 0.05) curU++;
            const c = csArr[curU * 2]!;
            const sn = csArr[curU * 2 + 1]!;
            if (sn < 0.001) return { p, t: tg, d: dn, vis: 1 };
            // 往远处的方向（垂直于切向和「向下」）：字以基线为轴往后倒
            const nx = tg[1] * dn[2] - tg[2] * dn[1];
            const ny = tg[2] * dn[0] - tg[0] * dn[2];
            const nz = tg[0] * dn[1] - tg[1] * dn[0];
            const d2x = dn[0] * c - nx * sn;
            const d2y = dn[1] * c - ny * sn;
            const d2z = dn[2] * c - nz * sn;
            const l = Math.hypot(d2x, d2y, d2z) || 1;
            return { p, t: tg, d: [d2x / l, d2y / l, d2z / l], vis: 1 };
          };
        }
        const mode = d.w ? (state === 'cur' ? 1 : state === 'past' ? 2 : 0) : t >= e.s ? 2 : 0;
        const dzBlur = done ? smooth((820 - dz) / 440) : 0;
        const blur = Math.max(dzBlur, 0.42 * postK);
        const trK = smooth((t - e.s + 0.05) / 0.45);
        const bd: Bound = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
        // 漫游 ↔ 穿行一镜到底：在保持场景淡入淡出与轻纵深推入的同时，当前句逐字飞向/飞离 3D 曲线（允许最多 4 帧等漫游 DOM 对齐）
        if (i === cur && !done && !lsNow && !lsFly && !boost && k > 0.001 && k < 0.999 && !morphFly && morphTries < 4) {
          morphTries = startMorph(i, d, e, segs, state, t) ? 99 : morphTries + 1;
        }
        // 衬托层强度：下一句约 0.35，开唱前后 0.6 秒升到 1，唱完掠过时随推开淡出；落地句叠加柔和渐显，不瞬弹
        const rawAuraK =
          i === cur + 1 ? 0.35 * o : i <= cur && i >= cur - 1 ? (0.35 + 0.65 * smooth((t - e.s + 0.4) / 0.6)) * (1 - passK) * Math.min(1, o * 1.4) : 0;
        const auraK = i === landingLineIdx ? rawAuraK * landingAura : rawAuraK;
        const flyingLsIn = lsFlyDir === 'in' && lsFlySlots?.lineIdx === i;
        const flyingLsOut = lsFlyDir === 'out' && lsFlySlots?.lineIdx === i;
        const flyingMorphIn = morphDir === 'in' && morphSlots?.lineIdx === i;
        const flyingMorphOut = morphDir === 'out' && morphSlots?.lineIdx === i;
        // 飞入穿行抵达后锁位交叉淡化（0→1 / 1→0）；飞出穿行保持隐藏 WebGL2 原样
        const glLineK = flyingLsIn || flyingMorphOut ? 0 : flyingLsOut ? glLsOutK : flyingMorphIn ? glMorphInK : 1;
        // 字后封面压暗与后句让位提前生效：漫游→穿行首帧即就位（随画布整体淡入，落地零变化）；穿行→漫游随退场平滑松开不瞬亮；听音空间→穿行在飞行前 78% 舒缓铺开
        const boxK = flyingLsIn ? 0 : flyingMorphOut ? smooth(k / 0.75) : flyingMorphIn ? 1 : flyingLsOut ? (lsOutBlendT0 > 0 ? 1 : smooth(lsOutP / 0.78)) : 1;
        const lineTrK = i === landingLineIdx ? trK * landingAura : trK;
        if (!flyingLsIn && auraK > 0.01) emitAura(d, segs, auraK, i === cur ? S : -1, t);
        if (glLineK > 0.004 && o > 0.004) emitLine(d, segs, o * glLineK, mode, blur, lineTrK, bd, i > cur && curBox ? curBox : null, i > cur ? curCircles : null);
        else if (boxK > 0.05 && o > 0.004) boundOf(d, segs, bd);
        const circles = boxK > 0.05 && o > 0.004 ? sampleCircles(d, segs, !!d.g.tr && showTr && lineTrK > 0.3) : [];
        if (i === cur && bd.x1 > bd.x0 && boxK > 0.05) {
          curBox = { x0: bd.x0 - 10, x1: bd.x1 + 10, y0: bd.y0 - 8, y1: bd.y1 + 8 };
          curCircles = circles;
        }
        // 前景封面避让在唱完后 0.4s 内平滑松开，避免 done 翻转单帧突然弹出遮字
        const frontOp = state === 'future' ? 0.7 * o * boxK : (1 - smooth((t - e.e - 0.05) / 0.4)) * Math.min(1, o * boxK);
        geos.push({ d, segs, op: o * glLineK, boxOp: o * boxK, frontOp, dz, state, bd, circles });
        if (S >= 0) lightPt = pointOn(d, segs, S).p;
        if (bd.x1 > bd.x0) probeLines.push({ i, text: e.text, x: bd.x0, y: bd.y0, w: bd.x1 - bd.x0, h: bd.y1 - bd.y0, op: o * glLineK, state: d.state, done, kind: plan[i]!.kind, move: choreo[i]!.move });
      }
      lastGeos = geos;
      lastCur = cur;
      // 漫游 ↔ 穿行一镜到底逐帧同步：飞入时逐字母渐弯贴合 3D 弧线并 220ms 锁位淡出；飞出时直接调起点侧 --cv 解弯（零逐字母 DOM 写入）
      if (morphFly && morphSlots) {
        const gM = geos.find((g) => g.d.i === morphSlots!.lineIdx);
        if (gM) {
          const outP = 1 - k;
          if (morphDir === 'in') {
            const mCurveK = morphInBlendT0 > 0 ? 1 : smooth((k - 0.25) / 0.65);
            morphSlots.update(gM.segs, gM.d.warp, camNow(), t, scheme, gM.state, mCurveK);
          } else if (outP < 0.85) {
            const mCurveK = 1 - smooth((outP - 0.08) / 0.62);
            morphFly.setCurveA(mCurveK);
            morphSlots.update(gM.segs, gM.d.warp, camNow(), t, scheme, gM.state, -1);
          }
          if (morphInBlendT0 > 0) {
            morphFly.render(1);
            morphFly.setLayerOpacity(1 - glMorphInK);
            if (morphInBlend >= 1) {
              endMorph();
              morphTries = 0;
            }
          } else {
            morphFly.render(morphDir === 'in' ? k : outP);
          }
        } else {
          endMorph();
        }
      }
      // 听音空间收起回飞穿行：飞行中逐字母渐弯贴合 3D 弧线，抵达后 220ms 锁位与 WebGL2 交叉淡化，落地帧零闪黑
      if (lsFly && lsFlyDir === 'out') {
        if (lsFlySlots) {
          const gFly = geos.find((g) => g.d.i === lsFlySlots!.lineIdx);
          const lCurveK = lsOutBlendT0 > 0 ? 1 : smooth((lsOutP - 0.25) / 0.65);
          if (gFly) lsFlySlots.update(gFly.segs, gFly.d.warp, camNow(), t, scheme, gFly.state, lCurveK);
        }
        if (lsOutBlendT0 > 0) {
          lsFly.render(1);
          lsFly.setLayerOpacity(1 - glLsOutK);
          if (lsOutBlend >= 1) endLsFly();
        } else {
          lsFly.render(lsOutP);
        }
      }

      // —— 光的飞行（§9.3，2026-11-27 用户反馈后改：不再常驻光丝，免得像隧道里的蛛丝、把句子「扯直」）——
      //    上一句唱完，光点马上沿平缓弧线飞向下一句句首（最长 0.9 秒），身后拖一截很快收拢的光尾；
      //    到了就停在句首（稍暗）等开唱。句首是转正的轴，光点停着的地方不动。两句紧挨着时飞得很快（最短 0.24 秒，和下一句的第一个字重叠）。
      let lingering = false;
      let flying = false;
      for (const a of [cur - 1, cur]) {
        const fl = flightOf(a);
        if (!fl || t < fl.f0) continue;
        const ga = geos.find((g) => g.d.i === a);
        const gb = geos.find((g) => g.d.i === a + 1);
        if (!ga || !gb || gb.op < 0.02) continue;
        if (t > fl.f1 + fl.lag) {
          // 光尾已收拢：还没开唱就停在句首等
          if (a === cur) {
            lightPt = pointOn(gb.d, gb.segs, 0).p;
            lingering = true;
          }
          continue;
        }
        const curve = threadCurve(ga, gb);
        const head = smooth((t - fl.f0) / fl.fd);
        const tail = smooth((t - fl.f0 - fl.lag) / fl.fd);
        if (head - tail > 0.004) emitTrail(curve, tail, head, 0.42 * smooth(gb.op / 0.3));
        if (t < fl.f1) {
          lightPt = curve(head);
          flying = true;
        } else if (a === cur) {
          lightPt = curve(1);
          lingering = true;
        }
      }
      lightI += ((lingering ? 0.55 : 1) - lightI) * (1 - Math.exp(-dt * 4));
      lightMode = !lightPt || lightK < 0.02 ? 'off' : flying ? 'fly' : lingering ? 'wait' : 'sing';

      if (swirl) emitHelix(swirl, t);
      if (needle) emitNeedle(needle, t);

      // —— 封面：隧道壁；字后面的按沿曲线包络圆有机压暗、挡在字前面的平滑让开（飞入句提前平滑就位不瞬暗） ——
      const boxes = geos
        .filter((g) => g.boxOp > 0.05 && g.circles.length > 0 && g.bd.x1 > g.bd.x0)
        .map((g) => {
          let maxR = 0;
          for (let ci = 0; ci < g.circles.length; ci++) if (g.circles[ci]!.r > maxR) maxR = g.circles[ci]!.r;
          const pad = maxR + 48;
          return {
            x0: g.bd.x0 - pad,
            x1: g.bd.x1 + pad,
            y0: g.bd.y0 - pad,
            y1: g.bd.y1 + pad,
            k: g.boxOp * (g.state === 'future' ? 0.6 : 1),
            front: g.frontOp,
            dz: g.dz,
            circles: g.circles,
          };
        });
      if (lightPt) {
        lx = lightPt[0];
        ly = lightPt[1];
        lz = lightPt[2];
      }
      drawn = 0;
      const halfDiag = Math.hypot(cx, vh - cy) || 1;
      const lo = lowerBound(slots, camZ + 200);
      const hi = lowerBound(slots, camZ + FAR);
      for (let j = lo; j < hi; j++) {
        const sl = slots[j]!;
        const dz = sl.z - camZ;
        const s = F / dz;
        const size = sl.size * s;
        if (size < 1.2) continue;
        // 卷起：这一段路上的封面绕走廊中轴转一段（像被气流卷起），转角按离螺旋中段的远近衰减
        let sx = sl.x;
        let sy = sl.y;
        let rc = 1;
        let rs = 0;
        if (swirl) {
          const bump = Math.exp(-(((sl.z - swirl.zMid) / swirl.zHalf) ** 2));
          const th = swirl.ang * bump;
          if (Math.abs(th) > 0.002) {
            rc = Math.cos(th);
            rs = Math.sin(th);
            const ax = pathX(sl.z);
            const ay = pathY(sl.z);
            const ox = sl.x - ax;
            const oy = sl.y - ay;
            sx = ax + ox * rc - oy * rs;
            sy = ay + ox * rs + oy * rc;
          }
        }
        const px = cx + (sx - camX) * s;
        const py = cy + (sy - camY) * s;
        const m = size * 0.75;
        if (px + m < 0 || px - m > vw || py + m < 0 || py - m > vh) continue;
        const cd = Math.hypot(px - cx, py - cy) / halfDiag;
        let a =
          (0.24 + 0.52 * smooth(cd / 0.72)) * smooth((FAR - dz) / 1800) * smooth((dz - 260) / 620) * (1 - 0.5 * smooth((dz - 800) / (FAR - 800)));
        if (a < 0.01) continue;
        const half = size / 2;
        const feather = Math.max(24, half * 0.55);
        for (const b of boxes) {
          if (px + half < b.x0 || px - half > b.x1 || py + half < b.y0 || py - half > b.y1) continue;
          let minGap = 9999;
          const cs = b.circles;
          for (let ci = 0; ci < cs.length; ci++) {
            const c = cs[ci]!;
            const gap = Math.hypot(px - c.x, py - c.y) - (c.r + half);
            if (gap < minGap) minGap = gap;
          }
          if (minGap >= feather) continue;
          const cov = 1 - smooth((minGap + half * 0.45) / (feather + half * 0.45));
          if (cov <= 0.004) continue;
          // 字后面的封面沿曲线有机压暗；字前面的封面平滑让开：正在唱的字永远不被挡（§9.2 可读性底线）
          if (dz > b.dz) a *= 1 - 0.72 * b.k * cov;
          else a *= 1 - 0.92 * b.front * Math.min(1, cov * 1.45);
        }
        if (a < 0.01) continue;
        const url = tracks[sl.ci]?.cover;
        const layer = url ? covers.layerOf(url, frameNo) : -1;
        let light = 0;
        if (lightK > 0.02) {
          const d3 = Math.hypot(sx - lx, sy - ly, (sl.z - lz) * 0.6);
          light = Math.exp(-d3 / 1000) * lightK;
          if (light < 0.06) light = 0;
        }
        const blur = 2.4 * smooth((760 - dz) / 460);
        const b = j * 6;
        const chip = layer < 0 ? chipOf(sl.ci) : null;
        const bx0 = basis[b]!;
        const by0 = basis[b + 1]!;
        const bx1 = basis[b + 3]!;
        const by1 = basis[b + 4]!;
        put(
          dz,
          sx, sy, sl.z,
          bx0 * rc - by0 * rs, bx0 * rs + by0 * rc, basis[b + 2]!,
          bx1 * rc - by1 * rs, bx1 * rs + by1 * rc, basis[b + 5]!,
          0, 0, 1, 1,
          layer < 0 ? KIND_CHIP : KIND_COVER, Math.max(0, layer), a,
          light, blur, 0.22, 0,
          chip ? chip[0]! : 0, chip ? chip[1]! : 0, chip ? chip[2]! : 0, 0,
        );
        drawn++;
      }
      covers.pump(frameNo);

      // —— 光点：正在唱的位置（或空档里沿光丝走向下一句） ——
      if (lightPt && lightK > 0.02) {
        const curD = doms.get(cur);
        const fs = curD?.fs ?? 50;
        const r = fs * 1.15;
        const I = 0.2 * lightK * lightI * (cur === landingLineIdx ? landingAura : 1);
        if (I > 0.002) {
          put(lightPt[2] - camZ - 0.02, lightPt[0], lightPt[1], lightPt[2], r, 0, 0, 0, r, 0, 0, 0, 1, 1, KIND_LIGHT, 0, 1, pal.sung[0]! * I, pal.sung[1]! * I, pal.sung[2]! * I, 0, 0, 0, 0, 0);
        }
      }

      // —— 3D 柔光三点：间奏（≥ 4s，逐个亮起） / 切歌慢取词（循环波浪呼吸） ——
      const wantLoad = loadingRef.current && els.length === 0 ? 1 : 0;
      loadVis += (wantLoad - loadVis) * (1 - Math.exp(-dt * (wantLoad ? 8 : 12)));
      const gapNow = gapWindows.find((g) => t >= g.s && t <= g.e) ?? null;
      if (gapNow) {
        const env = smooth((t - gapNow.s) / 0.5) * (1 - smooth((t - (gapNow.e - 0.45)) / 0.45));
        if (env > 0.004) {
          const p = clamp((t - gapNow.s) / Math.max(0.1, gapNow.e - gapNow.s), 0, 1);
          const breathe = 1 + 0.08 * Math.sin(t * Math.PI * 1.25);
          const lvs: [number, number, number] = [clamp(p * 3.1, 0, 1), clamp(p * 3.1 - 1, 0, 1), clamp(p * 3.1 - 2, 0, 1)];
          const scs: [number, number, number] = [
            (0.78 + 0.22 * lvs[0]) * breathe * (0.45 + 0.55 * env),
            (0.78 + 0.22 * lvs[1]) * breathe * (0.45 + 0.55 * env),
            (0.78 + 0.22 * lvs[2]) * breathe * (0.45 + 0.55 * env),
          ];
          emitDots(env, lvs, scs, [0, 0, 0]);
          dotsProbe = { mode: 'interlude', op: env, levels: lvs };
        } else {
          dotsProbe = { mode: 'none', op: 0, levels: [0, 0, 0] };
        }
      } else if (loadVis > 0.005) {
        const sec = now / 1000;
        const omega = (2 * Math.PI) / 1.4;
        const w0 = 0.5 - 0.5 * Math.cos(sec * omega);
        const w1 = 0.5 - 0.5 * Math.cos((sec - 0.18) * omega);
        const w2 = 0.5 - 0.5 * Math.cos((sec - 0.36) * omega);
        const lvs: [number, number, number] = [0.22 + 0.78 * w0, 0.22 + 0.78 * w1, 0.22 + 0.78 * w2];
        const envSc = 0.65 + 0.35 * loadVis;
        const scs: [number, number, number] = [(0.82 + 0.24 * w0) * envSc, (0.82 + 0.24 * w1) * envSc, (0.82 + 0.24 * w2) * envSc];
        emitDots(loadVis, lvs, scs, [-w0 * 7, -w1 * 7, -w2 * 7]);
        dotsProbe = { mode: 'loading', op: loadVis, levels: lvs };
      } else {
        dotsProbe = { mode: 'none', op: 0, levels: [0, 0, 0] };
      }

      // —— 从远到近排序（手写原地快排 + 直接拷贝，避开 TypedArray.sort 的 JS 回调与每帧数百次 subarray 分配） ——
      for (let q = 0; q < n; q++) order[q] = q;
      const sortDesc = (lo0: number, hi0: number) => {
        if (hi0 - lo0 < 16) {
          for (let a = lo0 + 1; a <= hi0; a++) {
            const idx = order[a]!;
            const dv = depth[idx]!;
            let b = a - 1;
            while (b >= lo0 && depth[order[b]!]! < dv) {
              order[b + 1] = order[b]!;
              b--;
            }
            order[b + 1] = idx;
          }
          return;
        }
        const piv = depth[order[(lo0 + hi0) >> 1]!]!;
        let i0 = lo0;
        let j0 = hi0;
        while (i0 <= j0) {
          while (depth[order[i0]!]! > piv) i0++;
          while (depth[order[j0]!]! < piv) j0--;
          if (i0 <= j0) {
            const tmp = order[i0]!;
            order[i0] = order[j0]!;
            order[j0] = tmp;
            i0++;
            j0--;
          }
        }
        if (lo0 < j0) sortDesc(lo0, j0);
        if (i0 < hi0) sortDesc(i0, hi0);
      };
      if (n > 1) sortDesc(0, n - 1);
      for (let q = 0; q < n; q++) {
        const src = order[q]! * INST;
        const dst = q * INST;
        for (let k = 0; k < INST; k++) out[dst + k] = scratch[src + k]!;
      }

      // —— 背景：径向渐变，色相随颜色旅程从反差色走到封面色，段落开合越大越亮（同 #287） ——
      const bgHue = baseHue + hueOffsetAt(route, camZ + DREST);
      renderer.draw({
        vw,
        vh,
        dpr,
        cy,
        cam: [camX, camY, camZ],
        F,
        near: NEAR,
        far: FARZ,
        bg: {
          c0: lab3(0.2 + 0.07 * st.lift, 0.055 + 0.02 * st.lift, bgHue),
          c1: lab3(0.12 + 0.03 * st.lift, 0.035, bgHue),
          c2: lab3(0.07, 0.018, bgHue),
          rad: Math.max(vw, vh) * 0.78,
        },
        pal,
        covers: covers.tex,
        glyphs: atlas.tex,
        atlas: [atlas.atlasW, ATLAS_H],
        data: out,
        count: n,
      });

      const ms = performance.now() - t0;
      times.push(ms);
      if (times.length > 240) times.shift();
    };
    raf = requestAnimationFrame(tick);

    const w = window as unknown as { __nebulaTravel?: { probe: () => unknown; lsProbe?: () => unknown; morphProbe?: () => unknown } };
    w.__nebulaTravel = {
      probe: () => {
        const sorted = [...times].sort((a, b) => a - b);
        return {
          active: true,
          gl: true,
          op: Number(root.style.opacity || 0),
          camZ,
          covers: drawn,
          slots: slots.length,
          small,
          rebuilds,
          lines: [...probeLines].sort((a, b) => a.i - b.i),
          frameMs: {
            avg: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
            p95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0,
            n: sorted.length,
          },
          cache: covers.stats(),
          quads: n,
          light: lightMode,
          dots: dotsProbe,
          moves: choreo.map((m, i) => ({ i, m: m.move, s: els[i]!.s, e: els[i]!.e })).filter((x) => x.m !== 'none'),
          buildMax,
          atlasTiming: atlas.timing.slice(-12),
        };
      },
      lsProbe: () => {
        if (!lsFly) return null;
        lsFlySlots?.syncSlots();
        lsFly.render(1);
        const err = lsFly.probe();
        const box = document.querySelector('.ls-col')?.getBoundingClientRect();
        const off = box
          ? lsFly.targets().filter((el) => {
              const r = el.getBoundingClientRect();
              return r.top < box.top - 2 || r.bottom > box.bottom + 2;
            }).length
          : 0;
        return { n: err.length, err, off };
      },
      morphProbe: () => {
        if (!morphFly) return null;
        morphSlots?.syncSlots();
        morphFly.render(1);
        const err = morphFly.probe();
        return { dir: morphDir, n: err.length, err };
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (rebuildTimer !== null) clearTimeout(rebuildTimer);
      canvas.removeEventListener('webglcontextlost', onLost);
      endMorph();
      endLsFly();
      for (const d of [...doms.values()]) dropLine(d);
      root.style.opacity = '0';
      if (w.__nebulaTravel) delete w.__nebulaTravel;
      if (!lost) {
        renderer.dispose();
        covers.dispose();
        atlas.dispose();
      }
    };
    // song 只取色相，换歌时 songKey 一起变
  }, [active, model, tracks, songKey, listen.font, listen.translation, weight, typo.f, typo.ls]);

  if (!active) return null;
  const vars = {
    '--lc-a': settings.lyricColorSource === 'custom' ? settings.customColor : 'var(--ly-a, rgb(238 240 244))',
    '--lc-font': typo.f,
    '--lc-ls': typo.ls,
    '--lyric-weight': weight,
  } as CSSProperties;
  return (
    <div ref={rootRef} className="travel-stage travel-space lw" data-scheme={listen.scheme} style={vars} aria-hidden="true">
      <canvas ref={canvasRef} className="tv-canvas" />
      <div ref={flyHostRef} className="tv-fly-host" />
    </div>
  );
}
