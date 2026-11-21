import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { audioPlayer } from '../lib/audio/AudioPlayer';
import { useAudioPlayer } from '../lib/audio/useAudioPlayer';
import { useInterfaceSettingsContext } from '../hooks/interfaceSettings/InterfaceSettingsContext';
import { currentLyricIndex, type LyricLineUI } from '../lib/lyrics';
import { listenBus } from '../lib/listenMode';
import { detectScript, songPace, toEngineLine, type EngineLine } from '../lib/listen/model';
import { useListenSettings } from '../lib/listen/settings';
import {
  TYPO,
  Vars,
  measureUnits,
  renderUnits,
  restUnit,
  unitFrame,
  waveOf,
  wholeLift,
  type UnitRt,
} from '../lib/listen/words';
import type { FrameBus } from '../lib/stage';
import './listen/lyric-words.css';

interface LyricsLayerProps {
  lines: LyricLineUI[];
  frameBus: FrameBus;
  /** 当前歌曲唯一标识：切歌时立即重置飞行状态。 */
  songKey?: string;
  /** 前奏/纯音乐时居中展示的歌曲信息。 */
  songTitle?: string;
  songArtist?: string;
}

type Role = 'current' | 'next' | 'nextNext' | 'leaving';

interface Flight {
  lineIdx: number;
  role: Role;
  prevRole: Role;
  sx: number;
  sy: number;
  rot: number;
  baseScale: number;
  scale: number;
  targetScale: number;
  opacity: number;
  targetOpacity: number;
  /** 水平错位（8%–18% 视口宽，随机方向）。 */
  xOff: number;
  /** 垂直带偏移量（next 用）。 */
  yMag: number;
  /** 下下句带偏移量（生成时一次定死）。 */
  yMagNext: number;
  /** 布局二的上/下侧。 */
  side: 'above' | 'below';
  /** 呼吸相位。 */
  phase: number;
  /** 目标角度（按角色）。 */
  angleCur: number;
  angleNext: number;
  /** 入场状态。 */
  entering: boolean;
  entryT: number;
  entryDur: number;
  entryFromX: number;
  entryFromY: number;
  /** 离场状态。 */
  exitT: number;
  exitDur: number;
  exitVx: number;
  exitVy: number;
  /** 离场时转出的角度（往飞出方向倾，#124）。 */
  exitRot: number;
}

const MARGIN = 240;
/** 主带：垂直中心 ±12%。 */
const MAIN_Y = 0.5;
/** 下一句带偏移 18%–28% 高度。 */
const NEXT_MAG = [0.18, 0.28] as const;
/** 下下句带：堆叠布局再向外 34%–48%（夹在可视区内）。 */
const NEXTNEXT_MAG = [0.34, 0.48] as const;
/** 水平错位 8%–18% 视口宽。 */
const X_OFF = [0.08, 0.18] as const;
/** 垂直入场概率。 */
const VERTICAL_P = 0.12;
/**
 * 倾斜（审查第 24 条，#124）：当前句只斜 0–3°，阅读基线稳定；候句 5–9°（下下句再 +3°）；
 * 进场从 16–24° 收到等候角，离场转出 10–16°——动感留在运动里。
 */
const ANG_CUR = [0, 3] as const;
/**
 * 字幕暗晕的色调曲线（输入 0 / .25 / .5 / .75 / 1 → 输出）：暗部原样，只把亮部往下压。
 * 压在白封面上字被托出来；暗色、中灰的空背景几乎不变，不会显出一团黑（#125，用户反馈 #124 的暗晕太重）。
 */
const CAP_TONE = '0 .25 .42 .55 .62';
const ANG_NEXT = [5, 9] as const;
const ANG_NN_EXTRA = 3;
const ANG_ENTRY = [16, 24] as const;
const ANG_EXIT = [10, 16] as const;
/** 长句自动收窄：当前句不超过屏宽 66%，候句不超过 58%。 */
const FIT_CUR = 0.66;
const FIT_WAIT = 0.58;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

const sign = () => (Math.random() < 0.5 ? -1 : 1);

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 估算单行文字像素宽度（CJK≈1 字宽，拉丁≈0.56 字宽），节点还没量到时用。 */
function estimateWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    w += /[⺀-鿿豈-﫿　-〿]/.test(ch) ? 1 : 0.56;
  }
  return Math.max(48, w * fontSize);
}

const usable = (l: LyricLineUI | undefined) => !!l && (!!l.text?.trim() || !!l.words?.length);

/** 当前时间对应的“可用正文”行（跳过翻译独行/空行）。 */
function usableCurrent(lines: LyricLineUI[], timeMs: number): number {
  const idx = currentLyricIndex(lines, timeMs);
  for (let i = idx; i >= 0; i--) if (usable(lines[i])) return i;
  return -1;
}

function usableNext(lines: LyricLineUI[], from: number): number {
  for (let i = from + 1; i < lines.length; i++) if (usable(lines[i])) return i;
  return -1;
}

/** 一句的字：逐字句是 `.u` 列表，整句是一个节点。 */
interface LineDom {
  host: HTMLElement;
  rts: UnitRt[] | null;
  whole: Vars | null;
  measured: boolean;
  settled: boolean;
}

/** 在一个空节点里建一句的字（逐字或整句）。 */
function buildLineDom(host: HTMLElement, e: EngineLine): LineDom {
  host.textContent = '';
  if (e.units) return { host, rts: renderUnits(host, e.units), whole: null, measured: false, settled: false };
  const w = document.createElement('span');
  w.className = 'fl-whole';
  w.textContent = e.text;
  host.appendChild(w);
  return { host, rts: null, whole: new Vars(w), measured: true, settled: false };
}

/**
 * Z1 空域层：三身份带状飞行系统（LYRICS_SYSTEM.md）+ 听音空间的逐字层（lib/listen/words.ts，#124）。
 * - 全局最多 current / next / nextNext 三句，身份随播放时间实时推进；
 * - 当前句主带 = 垂直中心 ±12%，保护性微调（不追字居中）；倾斜 0–3°；长句自动收窄；
 * - next / nextNext 位于等候带，呼吸漂浮；晋升短距滑入主带；离开斜向飞出并转出一点角度；
 * - 漫游时（交接启用、还没进入聆听）按设置退成「氛围」（只留当前句、缩小半透明微虚）和 / 或「字幕」；
 * - 前奏/纯音乐居中展示歌曲信息。
 */
export function LyricsLayer({ lines, frameBus, songKey, songTitle, songArtist }: LyricsLayerProps) {
  const playState = useAudioPlayer();
  const currentTime = playState.currentTime;
  const playing = playState.playing;
  const { lyricSettings: settings } = useInterfaceSettingsContext();
  const listen = useListenSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const elRefs = useRef(new Map<number, HTMLSpanElement>());
  const lineDoms = useRef(new Map<number, LineDom>());
  const flights = useRef(new Map<number, Flight>());
  const consumedRef = useRef(new Set<number>());
  const [activeKeys, setActiveKeys] = useState<number[]>([]);
  const lastKeysRef = useRef('');
  const prevLinesRef = useRef(lines);
  const songKeyRef = useRef(songKey);
  const linesReadyRef = useRef(true);
  const simTRef = useRef(0);
  /** 水平偏移平衡器：避免候选句连续多句扎堆同一侧。 */
  const balanceRef = useRef(0);
  const schemeRef = useRef(listen.scheme);
  schemeRef.current = listen.scheme;
  const roamRef = useRef(settings.roamLyrics);
  roamRef.current = settings.roamLyrics;

  // 每句的引擎数据（逐字单位 / 整句、快歌密度），与 lines 下标对齐；不可用的行为 null
  const engineLines = useMemo(() => {
    const out: Array<EngineLine | null> = new Array(lines.length).fill(null);
    const pace = songPace(lines); // 长音门槛按整首歌的字速（与听音空间同一个值）
    for (let i = 0; i < lines.length; i++) {
      if (!usable(lines[i])) continue;
      const n = usableNext(lines, i);
      out[i] = toEngineLine(lines[i]!, n >= 0 ? lines[n]!.timeMs / 1000 : undefined, pace);
    }
    return out;
  }, [lines]);
  const engineLinesRef = useRef(engineLines);
  engineLinesRef.current = engineLines;
  const script = useMemo(() => detectScript(lines), [lines]);
  const typo = TYPO[listen.font][script];

  const resetAll = () => {
    flights.current.clear();
    elRefs.current.clear();
    lineDoms.current.clear();
    consumedRef.current.clear();
    lastKeysRef.current = '';
  };
  if (songKey !== songKeyRef.current) {
    songKeyRef.current = songKey;
    linesReadyRef.current = false;
    resetAll();
    simTRef.current = 0;
    balanceRef.current = 0;
  }
  if (lines !== prevLinesRef.current) {
    prevLinesRef.current = lines;
    resetAll();
    linesReadyRef.current = true;
  }

  const playingRef = useRef(playing);
  playingRef.current = playing;
  const relayoutKey = `${settings.currentScale}|${settings.lyricLayout}|${settings.fontSize}|${listen.font}|${settings.bold}`;
  const relayoutKeyRef = useRef(relayoutKey);
  // 前奏/纯音乐：正文（可用行）未开始时居中展示歌曲信息
  const introVisible = !!songTitle && (lines.length === 0 || usableCurrent(lines, currentTime * 1000) === -1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    let last = performance.now();
    // 时钟：每帧读音频位置，读数没更新的帧按时间外推（同听音空间），保持单调
    let lastPos = -1;
    let extrap = 0;
    let smooth = audioPlayer.position() * 1000;
    let lastT = smooth;
    let captionIdx = -2;
    let captionDom: LineDom | null = null;

    // 字号、字体、布局变化：已有的句子重新量字宽；暂停时也给一段稳定期，把位置推到新目标
    let settleMs = 0;
    if (relayoutKeyRef.current !== relayoutKey) {
      relayoutKeyRef.current = relayoutKey;
      settleMs = 1500;
      for (const d of lineDoms.current.values()) d.measured = !d.rts;
      for (const fl of flights.current.values()) {
        fl.yMagNext =
          settings.lyricLayout === 'stacked'
            ? rand(NEXTNEXT_MAG[0], NEXTNEXT_MAG[1]) * frameBus.vh
            : rand(NEXT_MAG[0], NEXT_MAG[1]) * frameBus.vh;
      }
    }
    // 字体晚到：重新量
    let fontsDirty = false;
    document.fonts?.ready.then(() => {
      fontsDirty = true;
    });

    /** 句子的自然宽度（未缩放）。 */
    const naturalW = (lineIdx: number): number => {
      const el = elRefs.current.get(lineIdx);
      if (el && el.offsetWidth > 0) return el.offsetWidth;
      const l = lines[lineIdx];
      return l?.text ? estimateWidth(l.text, settings.fontSize) : 0;
    };
    const lineWidthPx = (fl: Flight): number => naturalW(fl.lineIdx) * fl.scale;
    /** 水平安全区：左右对称（当前句略紧），宽句被夹到中心而非偏向一侧。 */
    const clampX = (x: number, role: Role, width: number, cw: number): number => {
      const m = cw * (role === 'current' ? 0.08 : 0.1);
      return clamp(x, m, Math.max(m, cw - m - width));
    };
    const roleTarget = (fl: Flight, role: Role, cw: number, ch: number): { x: number; y: number } => {
      const width = lineWidthPx(fl);
      // 以“文字中心”对齐 cw/2 + xOff
      let x = cw / 2 - width / 2 + fl.xOff;
      x = clampX(x, role, width, cw);
      let y: number;
      if (role === 'current') {
        y = ch * MAIN_Y;
      } else if (role === 'next') {
        const mag = fl.yMag;
        y = settings.lyricLayout === 'stacked' ? ch * MAIN_Y - mag : fl.side === 'above' ? ch * MAIN_Y - mag : ch * MAIN_Y + mag;
      } else {
        const mag = fl.yMagNext;
        y =
          settings.lyricLayout === 'stacked'
            ? ch * MAIN_Y - mag
            : fl.side === 'above'
              ? ch * MAIN_Y + mag
              : ch * MAIN_Y - mag;
      }
      return { x, y: clamp(y, ch * 0.06, ch * 0.94) };
    };

    let dtRef = 0.016;
    /** 按角色设置目标缩放 / 透明度 / 角度（含长句收窄）。 */
    const applyRoleVisuals = (fl: Flight, cw: number): void => {
      const role = fl.role;
      const nat = naturalW(fl.lineIdx);
      const fitC = nat > 0 ? (FIT_CUR * cw) / nat : 9;
      const fitW = nat > 0 ? (FIT_WAIT * cw) / nat : 9;
      if (role !== 'leaving') {
        fl.targetScale =
          (role === 'current'
            ? Math.min(settings.currentScale, fitC)
            : role === 'next'
              ? Math.min(0.82, fitW)
              : Math.min(0.68, fitW * 0.85)) * fl.baseScale;
      }
      fl.targetOpacity = role === 'current' ? 1 : role === 'next' ? 0.62 : role === 'nextNext' ? 0.42 : 0.95;
      const nnSign = Math.sign(fl.angleNext) || 1;
      const targetAngle =
        role === 'current'
          ? fl.angleCur
          : role === 'next'
            ? fl.angleNext
            : role === 'nextNext'
              ? fl.angleNext + nnSign * ANG_NN_EXTRA
              : fl.angleCur + fl.exitRot * Math.min(1, fl.exitT * 1.6);
      fl.rot += (targetAngle - fl.rot) * (1 - Math.exp(-dtRef * (role === 'leaving' ? 3 : 4.5)));
    };

    const spawnFlight = (lineIdx: number, role: Role, t: number, cw: number, ch: number): Flight => {
      const side = Math.random() < 0.5 ? 'above' : 'below';
      let xSign: number;
      if (balanceRef.current >= 1) xSign = -1;
      else if (balanceRef.current <= -1) xSign = 1;
      else xSign = sign();
      balanceRef.current = clamp(balanceRef.current + xSign * 0.5, -2, 2);
      const angleCur = sign() * rand(ANG_CUR[0], ANG_CUR[1]);
      const fl: Flight = {
        lineIdx,
        role,
        prevRole: role,
        sx: 0,
        sy: 0,
        rot: angleCur,
        baseScale: rand(0.96, 1.04),
        scale: 0.68,
        targetScale: 0.68,
        opacity: 0,
        targetOpacity: 0.42,
        xOff: xSign * rand(X_OFF[0], X_OFF[1]) * cw,
        yMag: rand(NEXT_MAG[0], NEXT_MAG[1]) * ch,
        yMagNext:
          settings.lyricLayout === 'stacked'
            ? rand(NEXTNEXT_MAG[0], NEXTNEXT_MAG[1]) * ch
            : rand(NEXT_MAG[0], NEXT_MAG[1]) * ch,
        side,
        phase: rand(0, Math.PI * 2),
        angleCur,
        angleNext: sign() * rand(ANG_NEXT[0], ANG_NEXT[1]),
        entering: true,
        entryT: 0,
        entryDur: 1.2,
        entryFromX: 0,
        entryFromY: 0,
        exitT: 1,
        exitDur: 1.2,
        exitVx: 0,
        exitVy: 0,
        exitRot: 0,
      };
      const target = roleTarget(fl, role, cw, ch);
      const timeToStart = lines[lineIdx]?.timeMs != null ? lines[lineIdx]!.timeMs - t : 0;
      if (role === 'current') {
        // seek 补位：直接出现在主带，短促淡入
        fl.sx = target.x;
        fl.sy = target.y;
        fl.entryT = 1;
        fl.entering = false;
      } else if (timeToStart > 2000) {
        const vertical = Math.random() < VERTICAL_P;
        fl.entryDur = clamp(rand(1.1, 1.7), 0.6, Math.max(0.6, (timeToStart * 0.85) / 1000));
        if (vertical) {
          const fromTop = Math.random() < 0.5;
          fl.entryFromX = target.x;
          fl.entryFromY = fromTop ? -MARGIN : ch + MARGIN;
          fl.rot = fl.angleNext;
        } else {
          const fromLeft = Math.random() < 0.5;
          fl.entryFromX = fromLeft ? -MARGIN : cw + MARGIN;
          fl.entryFromY = target.y + rand(-ch * 0.06, ch * 0.06);
          // 进场带大角度：从左边来往下倾、从右边来往上倾，再收到等候角
          fl.rot = (fromLeft ? -1 : 1) * rand(ANG_ENTRY[0], ANG_ENTRY[1]);
        }
        fl.sx = fl.entryFromX;
        fl.sy = fl.entryFromY;
      } else {
        fl.sx = target.x;
        fl.sy = target.y;
        fl.entryT = 1;
        fl.entering = false;
        fl.rot = fl.angleNext;
      }
      return fl;
    };

    const syncActive = (): void => {
      const keys = [...flights.current.keys()].sort((a, b) => a - b);
      const sig = keys.join(',');
      if (sig !== lastKeysRef.current) {
        lastKeysRef.current = sig;
        setActiveKeys(keys);
      }
    };

    /** 这一句的字在这一帧的状态（当前句：扫光 + 波浪 + 长音；离场句：落回 + 尾韵）。 */
    const wordsFrame = (fl: Flight, el: HTMLElement, tSec: number): void => {
      const d = lineDoms.current.get(fl.lineIdx);
      const e = engineLinesRef.current[fl.lineIdx];
      if (!d || !e) return;
      const scheme = schemeRef.current;
      if (d.rts && (!d.measured || fontsDirty)) {
        measureUnits(d.rts);
        d.measured = d.rts[0] ? d.rts[0].w > 0 : true;
      }
      if (fl.role === 'current') {
        el.classList.add('is-grad');
        el.classList.remove('is-settle');
        d.settled = false;
        if (d.rts && d.rts.length) {
          const wave = waveOf(d.rts, e.dens, tSec);
          for (const rt of d.rts) unitFrame(rt, tSec, scheme, true, wave, e.dens);
        } else if (d.whole) {
          d.whole.el.classList.toggle('is-on', tSec >= e.s);
          d.whole.set('--lift', wholeLift(e.s, e.e, e.dens, tSec).toFixed(4));
        }
      } else if (fl.role === 'leaving') {
        if (!d.settled) {
          d.settled = true;
          el.classList.add('is-grad', 'is-settle');
          d.rts?.forEach(restUnit);
          d.whole?.set('--lift', '0');
          d.whole?.el.classList.add('is-on');
        }
        if (d.rts) for (const rt of d.rts) unitFrame(rt, tSec, scheme, false, null, e.dens);
      }
    };

    /** 字幕：当前句一行，只扫光不浮起。 */
    const captionFrame = (cur: number, tSec: number, show: number): void => {
      const cap = captionRef.current;
      if (!cap) return;
      if (show <= 0.001 || cur < 0) {
        // 透明度写成变量给子元素用：字幕根上不能有 opacity / filter，否则暗晕的 backdrop-filter 只看得到自己（#125）
        if (cap.style.getPropertyValue('--cap-o') !== '0') cap.style.setProperty('--cap-o', '0');
        return;
      }
      const e = engineLinesRef.current[cur];
      if (!e) return;
      const host = cap.firstElementChild as HTMLElement | null;
      if (!host) return;
      if (captionIdx !== cur || !captionDom) {
        captionIdx = cur;
        captionDom = buildLineDom(host, e);
      }
      if (captionDom.rts) for (const rt of captionDom.rts) unitFrame(rt, tSec, schemeRef.current, false, null, e.dens);
      else captionDom.whole?.el.classList.toggle('is-on', tSec >= e.s);
      cap.style.setProperty('--cap-o', show.toFixed(3));
    };

    const frame = (now: number): void => {
      const dt = clamp((now - last) / 1000, 0.001, 0.05);
      last = now;
      dtRef = dt;
      const f = frameBus;
      const cw = f.vw;
      const ch = f.vh;
      const playingNow = playingRef.current;
      const relayoutNow = !playingNow && settleMs > 0;
      if (relayoutNow) settleMs -= dt * 1000;
      // 时钟
      const pos = audioPlayer.position() * 1000;
      if (playingNow && pos === lastPos) extrap = Math.min(250, extrap + dt * 1000);
      else extrap = 0;
      lastPos = pos;
      let t = playingNow ? pos + extrap : pos;
      if (playingNow && t < smooth && smooth - t < 150) t = smooth;
      smooth = t;
      if (playingNow) simTRef.current += dt;
      // seek 检测：清除新位置之后的 consumed 条目，让未来句可重新入场
      if (Math.abs(t - lastT) > 200 + dt * 1000) {
        if (t < lastT - 1500) consumedRef.current.clear();
        else for (const idx of consumedRef.current) if (lines[idx] && lines[idx]!.timeMs > t) consumedRef.current.delete(idx);
      }
      lastT = t;
      const tSec = t / 1000;

      const active = flights.current;
      if (!linesReadyRef.current) {
        syncActive();
        raf = requestAnimationFrame(frame);
        return;
      }

      // 漫游 / 聆听（§7.1）：交接没启用时没有「聆听」，歌词按聆听时的样子常显
      const enabled = listenBus.enabled;
      const k = enabled ? listenBus.k : 1;
      const roam = roamRef.current;
      const ambient = enabled && roam !== 'caption';
      const captionOn = enabled && roam !== 'ambient';

      // 三身份：current / next / nextNext（跳过不可用行）
      const cur = usableCurrent(lines, t);
      const next = cur >= 0 ? usableNext(lines, cur) : -1;
      const nextNext = next >= 0 ? usableNext(lines, next) : -1;
      const wanted: Array<{ idx: number; role: Role }> = [];
      if (cur >= 0) wanted.push({ idx: cur, role: 'current' });
      if (next >= 0) wanted.push({ idx: next, role: 'next' });
      if (nextNext >= 0) wanted.push({ idx: nextNext, role: 'nextNext' });

      for (const w of wanted) {
        if (!active.has(w.idx) && !consumedRef.current.has(w.idx)) {
          active.set(w.idx, spawnFlight(w.idx, w.role, t, cw, ch));
        }
      }

      for (const fl of active.values()) {
        const w = wanted.find((x) => x.idx === fl.lineIdx);
        const newRole: Role = w ? w.role : 'leaving';
        if (newRole !== fl.role) {
          fl.prevRole = fl.role;
          fl.role = newRole;
          // 晋升当前句：水平偏移收窄到中心附近
          if (newRole === 'current') fl.xOff = (fl.xOff >= 0 ? 1 : -1) * cw * 0.03;
          if (newRole === 'leaving') {
            // 离开：左右 50%，带 ±1.5°–5° 小角度的非水平柔和飞出（1.0–1.4s），字往飞出方向转出 10–16°
            const dir = sign();
            fl.exitT = 0;
            fl.exitDur = rand(1.0, 1.4);
            const wPx = lineWidthPx(fl);
            const exitX = dir > 0 ? cw + MARGIN * 2 : -MARGIN * 2 - wPx;
            const exitY = fl.sy + rand(-ch * 0.1, ch * 0.08);
            const dx = exitX - fl.sx;
            const dy = exitY - fl.sy;
            const ang = (sign() * rand(1.5, 5) * Math.PI) / 180;
            const cosA = Math.cos(ang);
            const sinA = Math.sin(ang);
            fl.exitVx = (dx * cosA - dy * sinA) / fl.exitDur;
            fl.exitVy = (dx * sinA + dy * cosA) / fl.exitDur;
            fl.exitRot = dir * rand(ANG_EXIT[0], ANG_EXIT[1]);
          }
        }
        applyRoleVisuals(fl, cw);
      }

      for (const [lineIdx, fl] of active) {
        if (fl.role === 'leaving') {
          if (playingNow && fl.exitT < 1) {
            fl.exitT = Math.min(1, fl.exitT + dt / fl.exitDur);
            const ease = 1 - 0.35 * fl.exitT; // 轻微减速
            fl.sx += fl.exitVx * ease * dt;
            fl.sy += fl.exitVy * ease * dt;
          }
        } else if (playingNow || relayoutNow) {
          const target = roleTarget(fl, fl.role, cw, ch);
          let tx = target.x;
          const ty = target.y;
          // 当前句：保护性微调（最后 30% 时长冻结），防正在唱的字过度靠边
          const d = lineDoms.current.get(lineIdx);
          const e = engineLinesRef.current[lineIdx];
          if (fl.role === 'current' && d?.rts && e && e.e - tSec > (e.e - e.s) * 0.3) {
            const rt = d.rts.find((r) => tSec >= r.u.s && tSec <= r.u.e) ?? d.rts.find((r) => tSec <= (r.u.s + r.u.e) / 2);
            if (rt && rt.w > 0) {
              const cosR = Math.abs(Math.cos((fl.rot * Math.PI) / 180)) || 1;
              const wordX = fl.sx + (rt.left + rt.w / 2) * fl.scale * cosR;
              if (wordX < cw * 0.12) tx += (cw * 0.12 - wordX) * 0.18;
              else if (wordX > cw * 0.88) tx -= (wordX - cw * 0.88) * 0.18;
              tx = clampX(tx, 'current', lineWidthPx(fl), cw);
            }
          }
          if (fl.entering && fl.entryT < 1) {
            fl.entryT = Math.min(1, fl.entryT + dt / fl.entryDur);
            const ee = easeInOutCubic(fl.entryT);
            fl.sx = fl.entryFromX + (tx - fl.entryFromX) * ee;
            fl.sy = fl.entryFromY + (ty - fl.entryFromY) * ee;
            if (fl.entryT >= 1) fl.entering = false;
          } else {
            // 呼吸漂浮（仅等候句）
            let bx = 0;
            let by = 0;
            if (fl.role === 'next' || fl.role === 'nextNext') {
              bx = Math.sin(simTRef.current * 1.4 + fl.phase) * cw * 0.012;
              by = Math.cos(simTRef.current * 1.05 + fl.phase) * ch * 0.014;
            }
            const kk = 1 - Math.exp(-dt * (fl.role === 'current' ? 3.5 : 2.0));
            fl.sx += (tx + bx - fl.sx) * kk;
            fl.sy += (ty + by - fl.sy) * kk;
          }
          const k2 = 1 - Math.exp(-dt * 5);
          fl.scale += (fl.targetScale - fl.scale) * k2;
          fl.opacity += (fl.targetOpacity - fl.opacity) * k2;
        }

        const el = elRefs.current.get(lineIdx);
        if (!el) continue;
        // 漫游时的「氛围」：只留当前句（和刚离场的那句），缩到 84%、半透明、微虚；聆听时完整三句。只开字幕时整层让给字幕
        let opM = 1;
        let blur = 0;
        let scM = 1;
        if (ambient) {
          if (fl.role === 'current' || fl.role === 'leaving') {
            opM = 0.5 + 0.5 * k;
            blur = (1 - k) * 0.9;
            scM = 0.84 + 0.16 * k;
          } else opM = k;
        } else if (enabled) opM = k;
        el.style.transform = `translate3d(${fl.sx.toFixed(1)}px, ${fl.sy.toFixed(1)}px, 0) rotate(${fl.rot.toFixed(2)}deg) scale(${(fl.scale * scM).toFixed(4)})`;
        el.style.opacity = (fl.opacity * opM).toFixed(3);
        const fil = blur > 0.02 ? `blur(${blur.toFixed(2)}px)` : '';
        if (el.style.filter !== fil) el.style.filter = fil;
        el.classList.toggle('is-current', fl.role === 'current');
        // 第 11 条：当前句身后的暗晕（下一句淡一些）
        el.style.setProperty('--halo', fl.role === 'current' ? '1' : fl.role === 'next' ? '0.45' : '0');
        wordsFrame(fl, el, tSec);

        // 回收：按出场方向判“整句”越界（左出用句尾，右出用句首）
        const wPx = lineWidthPx(fl);
        const offX = fl.exitVx > 0 ? fl.sx > cw + MARGIN : fl.sx + wPx < -MARGIN;
        const offscreen = offX || fl.sy < -MARGIN || fl.sy > ch + MARGIN;
        if (fl.role === 'leaving' && (offscreen || fl.exitT >= 1)) {
          consumedRef.current.add(lineIdx);
          active.delete(lineIdx);
          lineDoms.current.delete(lineIdx);
        }
      }
      fontsDirty = false;
      captionFrame(cur, tSec, captionOn ? 1 - k : 0);
      syncActive();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, relayoutKey]);

  // 换歌/清空时在绘制前清掉渲染列表
  useLayoutEffect(() => {
    lastKeysRef.current = '';
    setActiveKeys([]);
  }, [lines]);

  // 自定义颜色：作为主舞台的歌词主色；跟随封面时用环境写入的 --ly-a（与听音空间同一个色）
  const lcA = settings.lyricColorSource === 'custom' ? settings.customColor : 'var(--ly-a, rgb(238 240 244))';
  const fontVars = {
    '--lyric-size': `${settings.fontSize}px`,
    '--lc-font': typo.f,
    '--lc-ls': typo.ls,
    '--lyric-weight': settings.bold ? 700 : typo.w,
    '--lc-a': lcA,
  } as CSSProperties;

  return (
    <>
      <div
        ref={containerRef}
        className={`lyrics-layer lw${settings.layerMode === 'over' ? ' lyrics-over' : ''}`}
        data-scheme={listen.scheme}
        style={fontVars}
        aria-hidden="true"
      >
        {introVisible && (
          <div className="lyrics-intro">
            <div className="li-title">{songTitle}</div>
            {songArtist && <div className="li-artist">{songArtist}</div>}
            {lines.length === 0 && <div className="li-note">纯音乐 · 暂无歌词</div>}
          </div>
        )}
        {activeKeys.map((lineIdx) => {
          const e = engineLines[lineIdx];
          if (!e) return null;
          return (
            <span
              key={lineIdx}
              ref={(el) => {
                if (el) elRefs.current.set(lineIdx, el);
                else elRefs.current.delete(lineIdx);
              }}
              className="flow-lyric"
            >
              <span className="fl-text">
                <i className="fl-halo" aria-hidden="true" />
                <span
                  className="fl-words"
                  ref={(el) => {
                    // 内联 ref 每次渲染都会先收到 null 再收到节点：节点没换就不重建（字的状态都在里面）
                    if (el && lineDoms.current.get(lineIdx)?.host !== el) lineDoms.current.set(lineIdx, buildLineDom(el, e));
                  }}
                />
              </span>
            </span>
          );
        })}
      </div>
      {/* 漫游时的字幕（§7.1，#124）：播放条上方一行，压在卡片之上 */}
      <div ref={captionRef} className="lyric-caption lw" data-scheme={listen.scheme} style={fontVars} aria-hidden="true">
        <span className="is-grad" />
        {/* 暗晕：只压亮处（色调曲线 + 轻虚化），暗 / 中灰的空背景上看不出来（#125） */}
        <i className="lc-haze" />
      </div>
      <svg className="lc-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id="lc-cap-tone" colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues={CAP_TONE} />
            <feFuncG type="table" tableValues={CAP_TONE} />
            <feFuncB type="table" tableValues={CAP_TONE} />
          </feComponentTransfer>
        </filter>
      </svg>
    </>
  );
}
