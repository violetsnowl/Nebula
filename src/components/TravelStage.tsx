import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { TravelSpace } from './TravelSpace';
import { hasWebGL2 } from './travel/glCore';
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
import { TYPO, measureUnits, renderUnits, restUnit, unitFrame, waveOf, type UnitRt } from '../lib/listen/words';
import { useSpaceLab } from '../lib/space/lab';
import { thumbOf } from '../lib/space/thumbs';
import { oklabToRgb, toneOf } from '../lib/space/tone';
import { bigCover, bigCoverStats } from './travel/covers';
import { DREST, F, FAR, NEAREST, buildRoute, buildSlots, camAt, hashStr, hueOffsetAt, lowerBound, pathX, pathY, songHue } from './travel/route';
import './listen/lyric-words.css';
import './travel-stage.css';

/**
 * 穿行（初版，2026-11-26，短命工作树 travel-opus5.5）：聆听时的第三种主舞台，舞台实验室「聆听时的舞台 › 穿行」。
 * 设计来源：样张 M 与 docs/project/TRAVEL_HANDOFF.md §2。初版只为回答两个问题（Gemini 提的验证口径）：
 *   1. 换成真实曲库的封面后，画面是「穿过星云」还是「花哨屏保」；
 *   2. 镜头压慢到「唱句几乎静止、换句缓推」后，听半小时累不累、浪漫感还在不在。
 * 所以进出只做淡入淡出（透明度 = 交接进度 --lk），不做「从当前星云长出纵深」，也不做和听音空间的一镜到底。
 *
 * 结构：一块画布画背景与封面（按透视投影，每帧只画视野里的），歌词用 DOM（逐字层与听音空间 / 漫游歌词同一套，
 * 扫光要 background-clip），按同一套投影逐帧定位。不碰星云舞台：聆听中星云与漫游歌词随 --lk 淡出（travel-stage.css）。
 */

interface TravelStageProps {
  lines: LyricLineUI[];
  loading?: boolean;
  songKey: string;
  lsOpen: boolean;
  song: Track | null;
  cards: CardSpec[];
}

const usable = (l: LyricLineUI | undefined) => !!l && (!!l.text?.trim() || !!l.words?.length);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
/** 歌词按这个字号排（世界字号 ≤ 60，开唱时屏幕上约 54px），逐帧用 scale 缩放 */
const BASE = 72;
/** 当前句前一句到后两句（小曲库补偿时多露几句当路标） */
const LINE_FAR = 3400;
const GHOST = {
  cover: 'rgba(255,255,255,.34)',
  mono: 'color-mix(in srgb, color-mix(in srgb, var(--lc-a) 58%, #fff) 34%, transparent)',
} as const;

interface LDom {
  i: number;
  el: HTMLDivElement;
  rts: UnitRt[] | null;
  whole: HTMLElement | null;
  /** 世界字号 */
  fs: number;
  state: 'future' | 'cur' | 'past';
  active: boolean;
  /** 这句已唱完、正在迎面飞出（允许出画面） */
  done: boolean;
  /** 按 BASE 字号排好时的盒子（未缩放），用来算画面上的文字框 */
  w: number;
  h: number;
}

/** 本帧一句歌词的落位（先算好，画封面时给字后面的封面压暗，再统一写 DOM） */
interface LPlace {
  d: LDom;
  px: number;
  py: number;
  sc: number;
  op: number;
}

type ProbeLine = { i: number; text: string; x: number; y: number; w: number; h: number; op: number; state: string; done: boolean };
type TravelProbe = {
  active: boolean;
  op: number;
  camZ: number;
  covers: number;
  slots: number;
  small: number;
  lines: ProbeLine[];
  frameMs: { avg: number; p95: number; n: number };
  cache: { cached: number; queued: number };
};

/**
 * 穿行入口：舞台实验室开了「穿行 · 空间歌词（实验）」且显卡支持 WebGL2 时用第二版（TravelSpace），
 * 否则（或第二版初始化失败 / 上下文丢失）用 #287 的画布版本。
 */
export function TravelStage(props: TravelStageProps) {
  const lab = useSpaceLab();
  const [failed, setFailed] = useState(false);
  const gl2 = useMemo(() => (lab.travelGL ? hasWebGL2() : false), [lab.travelGL]);
  if (lab.travelGL && gl2 && !failed) return <TravelSpace {...props} onFail={() => setFailed(true)} />;
  return <TravelStageFlat {...props} />;
}

function TravelStageFlat({ lines, songKey, lsOpen, song, cards }: TravelStageProps) {
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
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);

  const model = useMemo(() => {
    const src = lines.filter(usable);
    const pace = songPace(src);
    const els = src.map((l, i) => toEngineLine(l, src[i + 1] ? src[i + 1]!.timeMs / 1000 : undefined, pace)).sort((a, b) => a.s - b.s);
    const shapeLines = els.map((e) => ({ s: e.s, e: e.e, text: e.text }));
    const shape = els.length ? analyzeSong(shapeLines) : null;
    return { els, shape, shapeLines, script: detectScript(lines) };
  }, [lines]);
  // 一张封面只占一个位置：同一张专辑的几首歌封面相同，不去重会在画面里成对出现
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

  // 根元素标记：聆听中星云与漫游歌词随交接淡出、让给穿行（travel-stage.css）
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
    const host = linesRef.current;
    if (!active || !root || !canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { els, shape, shapeLines } = model;
    const showTr = listen.translation;

    // —— 歌词 DOM：只建视野里的几句 ——
    let vw = 0;
    let vh = 0;
    let dpr = 1;
    const doms = new Map<number, LDom>();
    const fitFont = (d: LDom): number => {
      const w = d.el.offsetWidth || 1;
      // 唱这句时最近离镜头约 NEAREST：那时屏幕宽度不超过窗口的 70%
      const max = (0.7 * Math.max(320, vw) * BASE * NEAREST) / (w * F);
      return clamp(max, 30, 60);
    };

    // —— 画布尺寸 ——
    const fit = () => {
      const b = root.getBoundingClientRect();
      const r = Math.min(1.5, window.devicePixelRatio || 1);
      if (b.width === vw && b.height === vh && r === dpr) return;
      vw = b.width;
      vh = b.height;
      dpr = r;
      canvas.width = Math.max(1, Math.round(vw * dpr));
      canvas.height = Math.max(1, Math.round(vh * dpr));
      // 窗口变了，长句的世界字号要重算
      for (const d of doms.values()) d.fs = fitFont(d);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    fit();

    // 路线按开唱时在画面上的位置摆句子，用当前窗口大小（初版：中途改窗口大小不重排路线，只重算字号）
    const route = buildRoute(els, shape, vw || window.innerWidth, vh || window.innerHeight);
    const baseHue = songHue(song);
    const { slots, small } = buildSlots(route, tracks, baseHue, hashStr(songKey));
    const lineFar = LINE_FAR;
    /** 当前句之后最多露几句（样张：后两句）。样张在小曲库补偿时露后五句当路标，真实歌词里远处几句会往画面中心收、互相叠字，初版不采用 */
    const ahead = 2;

    const makeLine = (i: number): LDom => {
      const e = els[i]!;
      const el = document.createElement('div');
      el.className = 'tv-line';
      const tx = document.createElement('div');
      tx.className = 'tv-tx';
      let rts: UnitRt[] | null = null;
      let whole: HTMLElement | null = null;
      if (e.units) rts = renderUnits(tx, e.units);
      else {
        whole = document.createElement('span');
        whole.className = 'tv-whole';
        whole.textContent = e.text;
        tx.appendChild(whole);
      }
      el.appendChild(tx);
      if (showTr && e.tr) {
        const tr = document.createElement('div');
        tr.className = 'tv-tr';
        tr.textContent = e.tr;
        el.appendChild(tr);
      }
      el.style.opacity = '0';
      host.appendChild(el);
      if (rts) measureUnits(rts);
      const d: LDom = { i, el, rts, whole, fs: 60, state: 'future', active: false, done: false, w: el.offsetWidth, h: el.offsetHeight };
      d.fs = fitFont(d);
      return d;
    };
    const dropLine = (d: LDom) => {
      d.el.remove();
      doms.delete(d.i);
    };

    // —— 封面占位色（缩略图还没到时） ——
    const chips = new Map<number, string>();
    const chipOf = (ci: number): string => {
      const hit = chips.get(ci);
      if (hit) return hit;
      const tr = tracks[ci];
      const t = tr?.cover ? toneOf(tr.cover) : null;
      const [r, g, b] = t ? oklabToRgb(0.22 + 0.6 * t[0], t[1] * 1.2, t[2] * 1.2) : [44, 46, 54];
      const css = `rgb(${r},${g},${b})`;
      if (t) chips.set(ci, css);
      return css;
    };
    const rgb = (L: number, C: number, h: number) => {
      const [r, g, b] = oklabToRgb(L, C * Math.cos(h), C * Math.sin(h));
      return `rgb(${r},${g},${b})`;
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

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
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
      // 听音空间打开时淡出（常驻聆听下 k 保持 1），收起后淡回；初版不做一镜到底
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

      // —— 歌词落位（先算，不写 DOM）：当前句前一句到后两句 ——
      const scheme = schemeRef.current;
      const ghost = GHOST[scheme === 'mono' ? 'mono' : 'cover'];
      const want = new Set<number>();
      const iEnd = Math.min(route.lines.length - 1, Math.max(cur, 0) + ahead);
      for (let i = Math.max(0, cur - 1); i <= iEnd; i++) {
        const dz = route.lines[i]!.z - camZ;
        if (dz > lineFar) break;
        if (dz > 40) want.add(i);
      }
      for (const d of [...doms.values()]) if (!want.has(d.i)) dropLine(d);
      const places: LPlace[] = [];
      for (const i of want) {
        let d = doms.get(i);
        if (!d) {
          d = makeLine(i);
          doms.set(i, d);
        }
        const L = route.lines[i]!;
        const e = els[i]!;
        const dz = L.z - camZ;
        const s = F / dz;
        // 远处淡入。唱完的那句继续迎面靠近、放大着飞出画面，离镜头 800 起淡、380 淡尽（两份初版比较：
        // 太早淡掉看不出「从字中间穿过去」，留到放大约 2 倍再淡更像穿过）。
        // 视觉焦点只有当前句：下一句约 .58、下下句约 .32 的亮度；候场的句子在间奏里再变暗
        const done = t > e.e + 0.1;
        d.done = done;
        const near = done ? 0.88 * smooth((dz - 380) / 420) : smooth((dz - 160) / 380);
        const far = smooth((lineFar - dz) / 900);
        const st0: LDom['state'] = t > e.e + 0.9 ? 'past' : t >= e.s - 0.05 ? 'cur' : 'future';
        const dist = i - Math.max(cur, -1);
        const dim = st0 === 'future' ? (dist <= 1 ? 0.58 : 0.32) * (1 - 0.6 * st.gap) : 1;
        places.push({ d, px: cx + (L.x - camX) * s, py: cy + (L.y - camY) * s, sc: (d.fs * s) / BASE, op: near * far * dim });
      }
      // 画面上的文字框（给字后面的封面压暗用）
      const boxes = places
        .filter((p) => p.op > 0.05)
        .map((p) => {
          const hw = (p.d.w * p.sc) / 2 + 18;
          const hh = (p.d.h * p.sc) / 2 + 10;
          return { x0: p.px - hw, x1: p.px + hw, y0: p.py - hh, y1: p.py + hh, k: p.op * (p.d.state === 'future' ? 0.6 : 1) };
        });

      // —— 背景：径向渐变，色相随颜色旅程从反差色走到封面色，段落开合越大越亮 ——
      const bgHue = baseHue + hueOffsetAt(route, camZ + DREST);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(vw, vh) * 0.78);
      g.addColorStop(0, rgb(0.2 + 0.07 * st.lift, 0.055 + 0.02 * st.lift, bgHue));
      g.addColorStop(0.55, rgb(0.12 + 0.03 * st.lift, 0.035, bgHue));
      g.addColorStop(1, rgb(0.07, 0.018, bgHue));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, vw, vh);

      // —— 封面：从远到近画；离镜头太近之前就淡出（不迎面怼大），越远越融进背景 ——
      drawn = 0;
      const halfDiag = Math.hypot(cx, vh - cy) || 1;
      const lo = lowerBound(slots, camZ + 200);
      const hi = lowerBound(slots, camZ + FAR);
      for (let j = hi - 1; j >= lo; j--) {
        const sl = slots[j]!;
        const dz = sl.z - camZ;
        const s = F / dz;
        const size = sl.size * s;
        if (size < 1.2) continue;
        const px = cx + (sl.x - camX) * s;
        const py = cy + (sl.y - camY) * s;
        if (px + size / 2 < 0 || px - size / 2 > vw || py + size / 2 < 0 || py - size / 2 > vh) continue;
        // 中心走廊：远处的封面都往消失点收，画面中心的压淡（.24），往外圈逐渐清楚（.76），中间不再挤成一团、纵深靠外圈往外扫出来
        const cd = Math.hypot(px - cx, py - cy) / halfDiag;
        let a =
          (0.24 + 0.52 * smooth(cd / 0.72)) * smooth((FAR - dz) / 1800) * smooth((dz - 260) / 620) * (1 - 0.5 * smooth((dz - 800) / (FAR - 800)));
        if (a < 0.01) continue;
        // 压在歌词后面的封面压暗（按重叠面积），字永远读得清
        const half = size / 2;
        for (const b of boxes) {
          const ox = Math.min(px + half, b.x1) - Math.max(px - half, b.x0);
          const oy = Math.min(py + half, b.y1) - Math.max(py - half, b.y0);
          if (ox > 0 && oy > 0) a *= 1 - 0.72 * b.k * Math.min(1, (2.2 * ox * oy) / (size * size));
        }
        if (a < 0.01) continue;
        const url = tracks[sl.ci]?.cover;
        const img = url ? (size >= 54 ? bigCover(url, frameNo) ?? thumbOf(url, size) : thumbOf(url, size)) : null;
        const x0 = px - size / 2;
        const y0 = py - size / 2;
        ctx.globalAlpha = a;
        if (img) ctx.drawImage(img, x0, y0, size, size);
        else {
          ctx.fillStyle = chipOf(sl.ci);
          ctx.beginPath();
          ctx.roundRect(x0, y0, size, size, size * 0.08);
          ctx.fill();
        }
        // 字照亮空间：当前句是光源，附近的封面按距离提亮
        if (img && lightK > 0.02) {
          const d3 = Math.hypot(sl.x - lx, sl.y - ly, (sl.z - lz) * 0.6);
          const L = Math.exp(-d3 / 1000) * lightK;
          if (L > 0.06) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = a * L * 0.34;
            ctx.drawImage(img, x0, y0, size, size);
            ctx.globalCompositeOperation = 'source-over';
          }
        }
        drawn++;
      }
      ctx.globalAlpha = 1;

      // —— 歌词：写状态、逐字扫光与落位 ——
      for (const { d, px, py, sc, op: o } of places) {
        const e = els[d.i]!;
        const state: LDom['state'] = t > e.e + 0.9 ? 'past' : t >= e.s - 0.05 ? 'cur' : 'future';
        if (state !== d.state) {
          d.state = state;
          d.el.classList.toggle('is-grad', state === 'cur');
          d.el.classList.toggle('is-cur', state === 'cur');
          d.el.classList.toggle('is-past', state === 'past');
          if (state !== 'cur' && d.rts && d.active) {
            d.rts.forEach(restUnit);
            d.active = false;
          }
        }
        if (d.whole) d.whole.classList.toggle('is-on', t >= e.s);
        if (state === 'cur' && d.rts?.length) {
          const singing = t <= e.e + 0.3;
          const raw = singing ? waveOf(d.rts, e.dens, t) : null;
          const waveK = smooth((t - (e.s - 0.05)) / 0.15);
          const wave = raw ? (c: number) => raw(c) * waveK : null;
          for (const rt of d.rts) {
            unitFrame(rt, t, scheme, singing, wave, e.dens);
            rt.v.set('--un', ghost);
            rt.chs?.forEach((c) => c.set('--un', ghost));
          }
          if (!singing && d.active) d.rts.forEach(restUnit);
          d.active = singing;
        }
        d.el.style.opacity = o < 0.004 ? '0' : o.toFixed(3);
        d.el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) scale(${sc.toFixed(4)}) translate(-50%, -50%)`;
      }

      const ms = performance.now() - t0;
      times.push(ms);
      if (times.length > 240) times.shift();
    };
    raf = requestAnimationFrame(tick);

    const w = window as unknown as { __nebulaTravel?: { probe: () => TravelProbe } };
    w.__nebulaTravel = {
      probe: () => {
        const sorted = [...times].sort((a, b) => a - b);
        const out: ProbeLine[] = [];
        for (const d of doms.values()) {
          const b = d.el.getBoundingClientRect();
          out.push({ i: d.i, text: els[d.i]!.text, x: b.left, y: b.top, w: b.width, h: b.height, op: Number(d.el.style.opacity || 0), state: d.state, done: d.done });
        }
        return {
          active: true,
          op: Number(root.style.opacity || 0),
          camZ,
          covers: drawn,
          slots: slots.length,
          small,
          lines: out.sort((a, b) => a.i - b.i),
          frameMs: {
            avg: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
            p95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0,
            n: sorted.length,
          },
          cache: bigCoverStats(),
        };
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const d of [...doms.values()]) dropLine(d);
      root.style.opacity = '0';
      if (w.__nebulaTravel) delete w.__nebulaTravel;
    };
    // song 只取色相，换歌时 songKey 一起变
  }, [active, model, tracks, songKey, listen.font, listen.translation]);

  if (!active) return null;
  const vars = {
    '--lc-a': settings.lyricColorSource === 'custom' ? settings.customColor : 'var(--ly-a, rgb(238 240 244))',
    '--lc-font': typo.f,
    '--lc-ls': typo.ls,
    '--lyric-weight': settings.bold ? 700 : typo.w,
  } as CSSProperties;
  return (
    <div ref={rootRef} className="travel-stage lw" data-scheme={listen.scheme} style={vars} aria-hidden="true">
      <canvas ref={canvasRef} className="tv-canvas" />
      <div ref={linesRef} className="tv-lines" />
    </div>
  );
}
