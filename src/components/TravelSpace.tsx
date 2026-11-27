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
import { INST, KIND_CHIP, KIND_COVER, KIND_GLYPH, KIND_LIGHT, KIND_STROKE, Renderer, type Palette } from './travel/renderer';
import { DREST, F, FAR, buildRoute, buildSlots, camAt, hashStr, hueOffsetAt, lowerBound, pathX, pathY, slotRadius, songHue } from './travel/route';
import { BEATS, locate, placeSegs, segAt, splitAt, type Seg, type V3 } from './travel/pathText';
import { tunnelBasis } from './travel/tunnel';
import { wordRt, type WordRt } from './travel/wordState';
import './listen/lyric-words.css';
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
  songKey: string;
  lsOpen: boolean;
  song: Track | null;
  cards: CardSpec[];
  onFail: () => void;
}

const usable = (l: LyricLineUI | undefined) => !!l && (!!l.text?.trim() || !!l.words?.length);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
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
  w: WordRt | null;
  state: 'future' | 'cur' | 'past';
  active: boolean;
  done: boolean;
}

interface Bound {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** 一句这一帧的曲线与画面外接框 */
interface Geo {
  d: LS;
  segs: Seg[];
  op: number;
  dz: number;
  state: LS['state'];
  bd: Bound;
}

type ProbeLine = { i: number; text: string; x: number; y: number; w: number; h: number; op: number; state: string; done: boolean };

export function TravelSpace({ lines, songKey, lsOpen, song, cards, onFail }: Props) {
  const lab = useSpaceLab();
  const active = lab.stageMode === 'travel';
  const listen = useListenSettings();
  const { lyricSettings: settings } = useInterfaceSettingsContext();
  const playState = useAudioPlayer();
  const playingRef = useRef(playState.playing);
  playingRef.current = playState.playing;
  const lsOpenRef = useRef(lsOpen);
  lsOpenRef.current = lsOpen;
  const schemeRef = useRef(listen.scheme);
  schemeRef.current = listen.scheme;
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
        return { fs: clamp(fitW(Math.max(wA, wB, trW * 0.85), 0.56), FS_MIN, FS_MAX), split: k };
      }
      return { fs: clamp(fs, FS_MIN, FS_MAX), split: 0 };
    };
    const fit = () => {
      const b = root.getBoundingClientRect();
      const r = Math.min(2, window.devicePixelRatio || 1);
      if (b.width === vw && b.height === vh && r === dpr) return;
      vw = b.width;
      vh = b.height;
      dpr = r;
      canvas.width = Math.max(1, Math.round(vw * dpr));
      canvas.height = Math.max(1, Math.round(vh * dpr));
      for (const d of doms.values()) Object.assign(d, sizeLine(els[d.i]!, d.g));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    fit();

    const route = buildRoute(els, shape, vw || window.innerWidth, vh || window.innerHeight);
    const baseHue = songHue(song);
    const { slots, small } = buildSlots(route, tracks, baseHue, hashStr(songKey));
    const { rMin, rMax } = slotRadius(small);
    const basis = tunnelBasis(slots, rMin, rMax);

    /** 第 i 句的锚点（世界 x / y）：路线中心 + 四拍错开（按当前窗口大小，改窗口后自然重排） */
    const KREST = DREST / F;
    const beatAt = (i: number): [number, number] => {
      const z = route.lines[i]!.z;
      const [fx, fy] = BEATS[i % BEATS.length]!;
      return [pathX(z) + fx * (vw || window.innerWidth) * KREST, pathY(z) + fy * (vh || window.innerHeight) * KREST];
    };
    /** 一句的锚点；passK = 唱完后往外侧推开的进度 */
    const anchorOf = (d: LS, passK: number): V3 => {
      const [bx, by] = beatAt(d.i);
      const side = bx >= 0 ? 1 : -1;
      const hasTr = !!d.g.tr && showTr;
      return [bx + side * passK * PASS_X, by + (hasTr ? 0.11 : 0.4) * d.fs + passK * PASS_Y, route.lines[d.i]!.z];
    };
    let buildMax = 0;
    const makeLine = (i: number): LS | null => {
      const tb = performance.now();
      const e = els[i]!;
      const g = atlas.build(e, font, showTr && e.tr ? e.tr : null);
      buildMax = Math.max(buildMax, performance.now() - tb);
      if (!g) return null;
      return { i, g, ...sizeLine(e, g), w: wordRt(e, g), state: 'future', active: false, done: false };
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
    const proj = (x: number, y: number, z: number): [number, number] | null => {
      const dz = z - pZ;
      if (dz < NEAR) return null;
      const s = F / dz;
      return [pcx + (x - pX) * s, pcy + (y - pY) * s];
    };

    /**
     * 一句的字沿曲线逐个出平面（路径文字，§9.3）。mode：0 候场（--lc-rest）、1 扫光、2 唱完（--tv-ink）；
     * trK 是译文亮起程度。顺带量出画面上的外接框（给封面让开、压暗和探针用）。
     */
    const emitLine = (d: LS, segs: Seg[], op: number, mode: number, blur: number, trK: number, bd: Bound) => {
      const { g, fs } = d;
      const aw = atlas.atlasW;
      const corner = (x: number, y: number, z: number) => {
        const q = proj(x, y, z);
        if (!q) return;
        if (q[0] < bd.x0) bd.x0 = q[0];
        if (q[0] > bd.x1) bd.x1 = q[0];
        if (q[1] < bd.y0) bd.y0 = q[1];
        if (q[1] > bd.y1) bd.y1 = q[1];
      };
      const emitUnits = (units: GUnit[], segFor: (ui: number) => Seg, k: number, isTr: boolean) => {
        const padEm = PAD * k;
        for (let ui = 0; ui < units.length; ui++) {
          const gu = units[ui]!;
          const sg = segFor(ui);
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
            const sMid = ((xl + xr) / 2 - sg.e0 - sg.w / 2) * fs;
            const { p, t: tg, d: dn } = segAt(sg, sMid);
            const hx = ((xr - xl) / 2) * fs;
            const hy = ((yB - yt) / 2) * fs;
            const cy0 = ((yt + yB) / 2) * fs;
            const wx = p[0] + dn[0] * cy0;
            const wy = p[1] + dn[1] * cy0;
            const wz = p[2] + dn[2] * cy0;
            put(
              wz - pZ - 0.01,
              wx, wy, wz,
              tg[0] * hx, tg[1] * hx, tg[2] * hx,
              dn[0] * hy, dn[1] * hy, dn[2] * hy,
              (gu.ax + le * gu.px) / aw, gu.ay / ATLAS_H, (gu.ax + re * gu.px) / aw, (gu.ay + gu.bandEm * gu.px) / ATLAS_H,
              KIND_GLYPH, 0, isTr ? op * trK : op,
              P, f, g0, g1,
              isTr ? 3 : mode, isTr ? 0 : glow * 0.9, blur, isTr ? 0.6 : 1,
            );
            if (!isTr || trK > 0.3) {
              // 外接框只量字形本体（不含暗晕的留白）
              const ix = hx * 0.8;
              const iy = hy * 0.62;
              corner(wx - tg[0] * ix - dn[0] * iy, wy - tg[1] * ix - dn[1] * iy, wz - tg[2] * ix - dn[2] * iy);
              corner(wx + tg[0] * ix - dn[0] * iy, wy + tg[1] * ix - dn[1] * iy, wz + tg[2] * ix - dn[2] * iy);
              corner(wx - tg[0] * ix + dn[0] * iy, wy - tg[1] * ix + dn[1] * iy, wz - tg[2] * ix + dn[2] * iy);
              corner(wx + tg[0] * ix + dn[0] * iy, wy + tg[1] * ix + dn[1] * iy, wz + tg[2] * ix + dn[2] * iy);
            }
          }
        }
      };
      emitUnits(g.units, (ui) => segs.find((s) => ui >= s.from && ui < s.to) ?? segs[0]!, 1, false);
      if (g.tr && showTr && trK > 0.004) {
        // 译文：跟在最后一段下方、沿同一条曲线（§9.3）
        const ref = segs[segs.length - 1]!;
        const c = segAt(ref, 0);
        const off = 0.73 * fs;
        const trSeg: Seg = { ...ref, C: [ref.C[0] + c.d[0] * off, ref.C[1] + c.d[1] * off, ref.C[2] + c.d[2] * off], e0: 0, w: g.trWidth };
        emitUnits(g.tr, () => trSeg, TR_K, true);
      }
    };

    /** 一句在整句排版坐标 e（em）处、字母中线（基线往上约 0.36em）的世界位置与切向 */
    const lineAt = (segs: Seg[], fs: number, e: number): { p: V3; t: V3 } => {
      const { sg, s } = locate(segs, e, fs);
      const r = segAt(sg, s);
      return { p: [r.p[0] - r.d[0] * 0.36 * fs, r.p[1] - r.d[1] * 0.36 * fs, r.p[2] - r.d[2] * 0.36 * fs], t: r.t };
    };

    /**
     * 光的飞行路线（§9.3）：上一句句尾 → 下一句句首，三次贝塞尔，切向接着两句的走向（把手短一点，弧线平缓、不打圈）。
     * 起点固定在「唱完那一刻」的句尾：唱完的句子会往外侧滑走，光点不跟着走，留在路上等，再从那里飞向下一句。
     */
    const tailRest = (d: LS) => lineAt(placeSegs(d.g, d.split, d.i, anchorOf(d, 0), d.fs, 1), d.fs, d.g.width);
    const threadCurve = (a: Geo, b: Geo): ((u: number) => V3) => {
      const A = tailRest(a.d);
      const B = lineAt(b.segs, b.d.fs, 0);
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
    const TRAIL_N = 24;
    const emitTrail = (curve: (u: number) => V3, u0: number, u1: number, alpha: number) => {
      const col = pal.glow;
      const span = u1 - u0;
      let a = curve(u0);
      for (let q = 1; q <= TRAIL_N; q++) {
        const b = curve(u0 + (span * q) / TRAIL_N);
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        const mz = (a[2] + b[2]) / 2;
        const dz = mz - pZ;
        if (dz > NEAR + 40) {
          // 宽度按画面上约 1.6px：世界宽 = 像素 × 距离 / F；方向垂直于这一小段和视线
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const dzz = b[2] - a[2];
          const vx = mx - pX;
          const vy = my - pY;
          const vz = dz;
          let wx = dy * vz - dzz * vy;
          let wy = dzz * vx - dx * vz;
          let wz = dx * vy - dy * vx;
          const wl = Math.hypot(wx, wy, wz) || 1;
          // r：0 = 尾端，1 = 光点
          const r = (q - 0.5) / TRAIL_N;
          const hw = ((0.5 + 1.3 * r) * dz) / F;
          wx = (wx / wl) * hw;
          wy = (wy / wl) * hw;
          wz = (wz / wl) * hw;
          const fade = smooth((dz - 300) / 500);
          const A = alpha * Math.pow(r, 1.6) * fade;
          if (A > 0.003) put(dz, mx, my, mz, dx / 2, dy / 2, dzz / 2, wx, wy, wz, 0, 0, 1, 1, KIND_STROKE, 0, A, col[0]!, col[1]!, col[2]!, 0, 0, 0, 0, 0);
        }
        a = b;
      }
    };

    // —— 帧循环 ——
    let raf = 0;
    let last = performance.now();
    let lastPos = -1;
    let extrap = 0;
    let smoothT = 0;
    let lsVis = lsOpenRef.current ? 0 : 1;
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
      const lsTarget = lsOpenRef.current ? 0 : 1;
      lsVis += (lsTarget - lsVis) * (1 - Math.exp(-dt * (lsTarget ? 6 : 12)));
      const op = Math.min(k, lsVis);
      const opS = op < 0.002 ? '0' : op.toFixed(3);
      if (opS !== rootOp) {
        root.style.opacity = opS;
        rootOp = opS;
      }
      if (op < 0.002) return;
      const t0 = performance.now();
      frameNo++;
      if (!vw) fit();
      if (frameNo % 20 === 1) syncPalette();
      const cx = vw / 2;
      const cy = vh * 0.47;
      camZ = camAt(route, t);
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
        for (const i of pre >= 0 ? [...want, pre] : want) {
          if (doms.has(i)) continue;
          const d = makeLine(i);
          if (d) doms.set(i, d);
          // 一帧最多新画两句（排版 + 上传几毫秒），其余下一帧
          if (++built >= 2) break;
        }
      }
      atlas.flush();

      n = 0;
      // —— 歌词：逐字层算状态 → 姿态（远处侧着、开唱前转正、唱完往外侧掠过）→ 沿曲线出字 ——
      const geos: Geo[] = [];
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
        const near = done ? 0.88 * smooth((dz - 380) / 420) : smooth((dz - 160) / 380);
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
        const segs = placeSegs(d.g, d.split, i, anchorOf(d, passK), d.fs, turnK);
        const mode = d.w ? (state === 'cur' ? 1 : state === 'past' ? 2 : 0) : t >= e.s ? 2 : 0;
        const blur = done ? smooth((820 - dz) / 440) : 0;
        const trK = smooth((t - e.s + 0.05) / 0.45);
        const bd: Bound = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
        if (o > 0.004) emitLine(d, segs, o, mode, blur, trK, bd);
        geos.push({ d, segs, op: o, dz, state, bd });
        if (S >= 0) lightPt = lineAt(segs, d.fs, S).p;
        if (bd.x1 > bd.x0) probeLines.push({ i, text: e.text, x: bd.x0, y: bd.y0, w: bd.x1 - bd.x0, h: bd.y1 - bd.y0, op: o, state: d.state, done });
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
            lightPt = lineAt(gb.segs, gb.d.fs, 0).p;
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

      // —— 封面：隧道壁；字后面的压暗、挡在字前面的让开（按画面上的字框） ——
      const boxes = geos
        .filter((g) => g.op > 0.05 && g.bd.x1 > g.bd.x0)
        .map((g) => ({
          x0: g.bd.x0 - 18,
          x1: g.bd.x1 + 18,
          y0: g.bd.y0 - 10,
          y1: g.bd.y1 + 10,
          k: g.op * (g.state === 'future' ? 0.6 : 1),
          front: g.d.done ? 0 : g.state === 'future' ? 0.7 * g.op : 1,
          dz: g.dz,
        }));
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
        const px = cx + (sl.x - camX) * s;
        const py = cy + (sl.y - camY) * s;
        const m = size * 0.75;
        if (px + m < 0 || px - m > vw || py + m < 0 || py - m > vh) continue;
        const cd = Math.hypot(px - cx, py - cy) / halfDiag;
        let a =
          (0.24 + 0.52 * smooth(cd / 0.72)) * smooth((FAR - dz) / 1800) * smooth((dz - 260) / 620) * (1 - 0.5 * smooth((dz - 800) / (FAR - 800)));
        if (a < 0.01) continue;
        const half = size / 2;
        for (const b of boxes) {
          const ox = Math.min(px + half, b.x1) - Math.max(px - half, b.x0);
          const oy = Math.min(py + half, b.y1) - Math.max(py - half, b.y0);
          if (ox <= 0 || oy <= 0) continue;
          const cov = Math.min(1, (2.2 * ox * oy) / (size * size));
          // 字后面的封面压暗（同 #287）；字前面的封面让开：正在唱的字永远不被挡（§9.2 可读性底线）
          if (dz > b.dz) a *= 1 - 0.72 * b.k * cov;
          else a *= 1 - 0.92 * b.front * Math.min(1, cov * 1.6);
        }
        if (a < 0.01) continue;
        const url = tracks[sl.ci]?.cover;
        const layer = url ? covers.layerOf(url, frameNo) : -1;
        let light = 0;
        if (lightK > 0.02) {
          const d3 = Math.hypot(sl.x - lx, sl.y - ly, (sl.z - lz) * 0.6);
          light = Math.exp(-d3 / 1000) * lightK;
          if (light < 0.06) light = 0;
        }
        const blur = 2.4 * smooth((760 - dz) / 460);
        const b = j * 6;
        const chip = layer < 0 ? chipOf(sl.ci) : null;
        put(
          dz,
          sl.x, sl.y, sl.z,
          basis[b]!, basis[b + 1]!, basis[b + 2]!,
          basis[b + 3]!, basis[b + 4]!, basis[b + 5]!,
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
        const I = 0.2 * lightK * lightI;
        put(lightPt[2] - camZ - 0.02, lightPt[0], lightPt[1], lightPt[2], r, 0, 0, 0, r, 0, 0, 0, 1, 1, KIND_LIGHT, 0, 1, pal.sung[0]! * I, pal.sung[1]! * I, pal.sung[2]! * I, 0, 0, 0, 0, 0);
      }

      // —— 从远到近排序 ——
      for (let q = 0; q < n; q++) order[q] = q;
      const ord = order.subarray(0, n);
      ord.sort((a, b) => depth[b]! - depth[a]!);
      for (let q = 0; q < n; q++) out.set(scratch.subarray(ord[q]! * INST, ord[q]! * INST + INST), q * INST);

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

    const w = window as unknown as { __nebulaTravel?: { probe: () => unknown } };
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
          lines: [...probeLines].sort((a, b) => a.i - b.i),
          frameMs: {
            avg: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
            p95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0,
            n: sorted.length,
          },
          cache: covers.stats(),
          quads: n,
          light: lightMode,
          buildMax,
          atlasTiming: atlas.timing.slice(-12),
        };
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
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
  } as CSSProperties;
  return (
    <div ref={rootRef} className="travel-stage travel-space" data-scheme={listen.scheme} style={vars} aria-hidden="true">
      <canvas ref={canvasRef} className="tv-canvas" />
    </div>
  );
}
