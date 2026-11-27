import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { audioPlayer } from '../lib/audio/AudioPlayer';
import { useAudioPlayer } from '../lib/audio/useAudioPlayer';
import { useInterfaceSettingsContext } from '../hooks/interfaceSettings/InterfaceSettingsContext';
import type { LyricLineUI } from '../lib/lyrics';
import type { Track } from '../lib/catalog';
import type { CardSpec } from '../lib/layout';
import { listenBus } from '../lib/listenMode';
import { detectScript, songPace, toEngineLine } from '../lib/listen/model';
import { analyzeSong, stageAt } from '../lib/listen/sections';
import { useListenSettings } from '../lib/listen/settings';
import { TYPO, restUnit, unitFrame, waveOf } from '../lib/listen/words';
import { useSpaceLab } from '../lib/space/lab';
import { oklabToRgb, toneOf } from '../lib/space/tone';
import { cssRgba } from './travel/glCore';
import { CoverTextures } from './travel/coverTex';
import { ATLAS_H, GlyphAtlas, PAD, R_MAIN, TR_K, type FontSpec, type GLine, type GUnit } from './travel/glyphAtlas';
import { INST, KIND_CHIP, KIND_COVER, KIND_GLYPH, KIND_LIGHT, Renderer, type Palette } from './travel/renderer';
import { DREST, F, FAR, NEAREST, buildRoute, buildSlots, camAt, hashStr, hueOffsetAt, lowerBound, pathX, pathY, slotRadius, songHue } from './travel/route';
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
/** 一句歌词的块高（主字号 em）：主文行高 1.2；带译文时再加间距与译文一行（同 #287 的 DOM 排版） */
const BLOCK = 1.2;
const BLOCK_TR = 1.777;

interface LS {
  i: number;
  g: GLine;
  /** 世界字号 */
  fs: number;
  w: WordRt | null;
  state: 'future' | 'cur' | 'past';
  active: boolean;
  done: boolean;
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
    const fitFont = (g: GLine): number => {
      // 唱这句时最近离镜头约 NEAREST：那时屏幕宽度不超过窗口的 70%（同 #287）
      const w = Math.max(g.width, g.tr && showTr ? g.trWidth : 0) || 1;
      return clamp((0.7 * Math.max(320, vw) * NEAREST) / (w * F), 30, 60);
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
      for (const d of doms.values()) d.fs = fitFont(d.g);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    fit();

    const route = buildRoute(els, shape, vw || window.innerWidth, vh || window.innerHeight);
    const baseHue = songHue(song);
    const { slots, small } = buildSlots(route, tracks, baseHue, hashStr(songKey));
    const { rMin, rMax } = slotRadius(small);
    const basis = tunnelBasis(slots, rMin, rMax);

    const makeLine = (i: number): LS | null => {
      const e = els[i]!;
      const g = atlas.build(e, font, showTr && e.tr ? e.tr : null);
      if (!g) return null;
      return { i, g, fs: fitFont(g), w: wordRt(e, g), state: 'future', active: false, done: false };
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
        pal.rest = pal.un;
        pal.ink = pal.sung;
      } else {
        // 封面色：唱过的是主色，波前主色 30%，没唱的白 34%（穿行把 --un 换成 GHOST）
        pal.sung = [lc[0]!, lc[1]!, lc[2]!, 1];
        pal.edge = [...mix(lc, W1, 0.7), 1];
        pal.un = [1, 1, 1, 0.34];
        pal.rest = [1, 1, 1, 0.34];
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

    /**
     * 一句的字：每个字母一块平面（第一步仍是正对镜头的平面句子）。
     * mode：0 候场（--lc-rest）、1 扫光、2 唱完（--tv-ink）；trK 是译文亮起程度。
     */
    const emitLine = (d: LS, lx: number, ly: number, lz: number, dz: number, op: number, mode: number, blur: number, trK: number) => {
      const { g, fs } = d;
      const hasTr = !!g.tr && showTr;
      const yb = ly + (hasTr ? 0.11 : 0.4) * fs;
      const emitUnits = (units: GUnit[], width: number, base: number, k: number, isTr: boolean) => {
        const x0 = lx - (width * fs) / 2;
        const padEm = PAD * k;
        for (let ui = 0; ui < units.length; ui++) {
          const gu = units[ui]!;
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
            const hx = ((xr - xl) / 2) * fs;
            const hy = ((yB - yt) / 2) * fs;
            const wx = x0 + ((xl + xr) / 2) * fs;
            const wy = base + ((yt + yB) / 2) * fs;
            const aw = atlas.atlasW;
            put(
              dz - 0.01,
              wx, wy, lz,
              hx, 0, 0,
              0, hy, 0,
              (gu.ax + le * gu.px) / aw, gu.ay / ATLAS_H, (gu.ax + re * gu.px) / aw, (gu.ay + gu.bandEm * gu.px) / ATLAS_H,
              KIND_GLYPH, 0, isTr ? op * trK : op,
              P, f, g0, g1,
              isTr ? 3 : mode, isTr ? 0 : glow * 0.9, blur, isTr ? 0.6 : 1,
            );
          }
        }
      };
      emitUnits(g.units, g.width, yb, 1, false);
      if (hasTr && g.tr && trK > 0.004) emitUnits(g.tr, g.trWidth, yb + 0.73 * fs, TR_K, true);
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
    let lx = 0;
    let ly = 0;
    let lz = 0;
    let drawn = 0;
    let camZ = route.z0;
    const times: number[] = [];
    let probeLines: ProbeLine[] = [];

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
      const lightOn = curL && t <= curL.e + 0.6 ? 1 : 0;
      lightK += (lightOn - lightK) * (1 - Math.exp(-dt * 3));
      if (curL) {
        lx = curL.x;
        ly = curL.y;
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
      // —— 歌词落位（同 #287）：先算位置与透明度、文字框（给字后面的封面压暗） ——
      const boxes: Array<{ x0: number; x1: number; y0: number; y1: number; k: number; front: number; dz: number }> = [];
      const places: Array<{ d: LS; dz: number; op: number; s: number }> = [];
      for (const i of want) {
        const d = doms.get(i);
        if (!d) continue;
        const L = route.lines[i]!;
        const e = els[i]!;
        const dz = L.z - camZ;
        const s = F / dz;
        const done = t > e.e + 0.1;
        d.done = done;
        const near = done ? 0.88 * smooth((dz - 380) / 420) : smooth((dz - 160) / 380);
        const far = smooth((LINE_FAR - dz) / 900);
        const state: LS['state'] = t > e.e + 0.9 ? 'past' : t >= e.s - 0.05 ? 'cur' : 'future';
        const dist = i - Math.max(cur, -1);
        const dim = state === 'future' ? (dist <= 1 ? 0.58 : 0.32) * (1 - 0.6 * st.gap) : 1;
        const o = near * far * dim;
        places.push({ d, dz, op: o, s });
        if (o > 0.05) {
          const hasTr = !!d.g.tr && showTr;
          const hw = (Math.max(d.g.width, hasTr ? d.g.trWidth : 0) * d.fs * s) / 2 + 18;
          const hh = ((hasTr ? BLOCK_TR : BLOCK) * d.fs * s) / 2 + 10;
          const px = cx + (L.x - camX) * s;
          const py = cy + (L.y - camY) * s;
          boxes.push({ x0: px - hw, x1: px + hw, y0: py - hh, y1: py + hh, k: o * (state === 'future' ? 0.6 : 1), front: done ? 0 : state === 'future' ? 0.7 * o : 1, dz });
        }
      }

      // —— 封面：隧道壁，从远到近（排序在最后统一做） ——
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

      // —— 歌词：逐字层算状态，再按字母出平面 ——
      probeLines = [];
      let lightPt: [number, number, number, number] | null = null;
      for (const { d, dz, op: o, s } of places) {
        const e = els[d.i]!;
        const L = route.lines[d.i]!;
        const state: LS['state'] = t > e.e + 0.9 ? 'past' : t >= e.s - 0.05 ? 'cur' : 'future';
        if (state !== d.state) {
          d.state = state;
          if (state !== 'cur' && d.w && d.active) {
            d.w.rts.forEach(restUnit);
            d.active = false;
          }
        }
        if (state === 'cur' && d.w?.rts.length) {
          const singing = t <= e.e + 0.3;
          const raw = singing ? waveOf(d.w.rts, e.dens, t) : null;
          const waveK = smooth((t - (e.s - 0.05)) / 0.15);
          const wave = raw ? (c: number) => raw(c) * waveK : null;
          for (const rt of d.w.rts) unitFrame(rt, t, scheme, singing, wave, e.dens);
          if (!singing && d.active) d.w.rts.forEach(restUnit);
          d.active = singing;
          // 光点：正在唱的位置
          if (singing && d.i === cur) {
            let S = -1;
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
            if (S >= 0) {
              const hasTr = !!d.g.tr && showTr;
              lightPt = [L.x - (d.g.width * d.fs) / 2 + S * d.fs, L.y + ((hasTr ? 0.11 : 0.4) - 0.36) * d.fs, L.z - 2, d.fs];
            }
          }
        }
        const mode = d.w ? (state === 'cur' ? 1 : state === 'past' ? 2 : 0) : t >= e.s ? 2 : 0;
        const blur = d.done ? smooth((820 - dz) / 440) : 0;
        const trK = smooth((t - e.s + 0.05) / 0.45);
        if (o > 0.004) emitLine(d, L.x, L.y, L.z, dz, o, mode, blur, trK);
        // 探针：画面上的文字框
        const hasTr = !!d.g.tr && showTr;
        const w = Math.max(d.g.width, hasTr ? d.g.trWidth : 0) * d.fs * s;
        const h = (hasTr ? BLOCK_TR : BLOCK) * d.fs * s;
        probeLines.push({
          i: d.i,
          text: e.text,
          x: cx + (L.x - camX) * s - w / 2,
          y: cy + (L.y - camY) * s - h / 2,
          w,
          h,
          op: o,
          state: d.state,
          done: d.done,
        });
      }
      if (lightPt && lightK > 0.02) {
        const [px, py, pz, fs] = lightPt;
        const r = fs * 1.15;
        const I = 0.2 * lightK;
        put(pz - camZ - 0.02, px, py, pz, r, 0, 0, 0, r, 0, 0, 0, 1, 1, KIND_LIGHT, 0, 1, pal.sung[0]! * I, pal.sung[1]! * I, pal.sung[2]! * I, 0, 0, 0, 0, 0);
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
