import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { audioPlayer, FOREIGN_SONG_ID } from '../../lib/audio/AudioPlayer';
import { CARD_HEIGHT, CARD_WIDTH } from '../../lib/layout';
import { makeMetaBox, resolveMetaVisibility, type MetaBox } from '../../lib/metaOverlap';
import type { FrameBus } from '../../lib/stage';
import { initGlassGlow, clearProximity, registerProximity, unregisterProximity } from '../../lib/glassGlow';
import type { Track } from '../../lib/catalog';
import { matchSongs, type SearchMatch } from '../../lib/search';
import { PanController } from '../../lib/panEngine';
import { listenBus, onListenFrame, partOffset } from '../../lib/listenMode';
import { stageShapeBus } from '../../lib/listen/stageBus';
import type { PanFrame } from '../../lib/panEngine';
import { hasDesktopAPI, toBackendTrack, toFrontendTrack, viaOf } from '../../lib/playlist/ipcClient';
import type { DesktopTrack } from '../../lib/playlist/ipcClient';
import { libraryService } from '../../lib/library';
import { preferredQuality } from '../../lib/preferences';
import type { ImportStatus } from '../../lib/playlistTypes';
import { getSpaceLab, registerSpaceCommand, setSpaceLab, useSpaceLab, type StageLayout } from '../../lib/space/lab';
import { buildChroma, buildCluster, buildRandom, queryRect, zoomFloor, type SpaceWorld } from '../../lib/space/world';
import { applyXf, camCenter, lensDelta, project, worldPerPixel, type Proj, type ScreenXf } from '../../lib/space/lens';
import { ensureTones, oklabToRgb, toneOf, useToneProgress } from '../../lib/space/tone';
import { airAlpha, frameAlphaBuffer, MIN_CARD_PX, onCardCoverReady, setActiveWorld } from '../../lib/space/active';
import { StarField, type StarFrame } from '../../lib/space/stars';
import { onThumbsReady } from '../../lib/space/thumbs';

/**
 * 星云里同时挂成 DOM 卡片的上限。几百张卡片同时变动时样式重算太贵（实测每张约 50µs/帧，
 * 0.3 倍缩放下 190 张时拖动每帧 40–50ms），所以小卡片交给星层画布画缩略图。
 */
const MAX_MOUNT = 140;
/**
 * 查候选卡片的范围比屏幕大的那一圈（世界坐标）。#137：卡片要在离屏幕边缘还有一段距离时就挂好 DOM，
 * 拖进来时它已经在那里；最大缩放下边缘卡片约 370px，挂载范围（1.5 张卡 + 60px）过透镜外圈压缩后约 680 世界单位。
 */
const QUERY_PAD = 660;

interface Pick {
  id: number;
  sx: number;
  sy: number;
  s: number;
  u: number;
  sortU: number;
  inView: boolean;
}

/** contextMenu 的最小结构类型（与 useOverlays.ContextMenuState 结构化兼容）。 */
interface CtxMenuShape {
  x: number;
  y: number;
  track: Track;
}

interface CardMenuEvent {
  preventDefault(): void;
  stopPropagation(): void;
  clientX: number;
  clientY: number;
}

interface UseStageOptions {
  /** 舞台控制器 ref（App 声明并传给 useSearchCluster 做搜索定位接线）。 */
  controllerRef: MutableRefObject<PanController | null>;
  /** 当前曲库（渲染卡片 + 曲库刷新）。 */
  songs: Track[];
  /** 搜索命中（命中的亮、其余变暗）。 */
  searchMatches: SearchMatch[];
  /** 搜索聚簇定位（__nebula.search 接线）。 */
  applySearch: (matches: SearchMatch[], focusIndex: number | null) => void;
  /** 右键菜单打开时保留卡片悬浮态（防菜单抢占指针）。 */
  contextMenuRef: RefObject<CtxMenuShape | null>;
  /** 右键打开歌曲菜单（供画布外围卡片复用 DOM 卡片菜单）。 */
  onContextMenu?: (e: CardMenuEvent, track: Track) => void;
  /** 导入渐进揭示完成后的收尾（组合层接 usePlaylistImport.complete）。 */
  completeImport: (status: ImportStatus, message: string) => void;
  /** 当前播放歌曲 id（低频 context 注入，避免 stage 依赖 playback hook）。 */
  currentSongId: number | null;
  /** 由 App 声明并传给 useSearchCluster 的星云 ref（useStage 渲染时写入）。 */
  worldRef: MutableRefObject<SpaceWorld>;
}

/**
 * 舞台领域（docs/project/ARCHITECTURE.md §2，最后迁移的高风险块）：
 * 拥有 hovered/visible/failed/liked/渐进揭示/PanController/虚拟化渲染数据；
 * 只依赖 lib（audioPlayer / LibraryService / 星云布局与透镜 / 搜索），不依赖其他 hook。
 */
export function useStage({
  controllerRef,
  songs,
  searchMatches,
  applySearch,
  contextMenuRef,
  onContextMenu,
  completeImport,
  currentSongId,
  worldRef,
}: UseStageOptions) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [visibleIds, setVisibleIds] = useState<number[]>([]);
  const [revealedCount, setRevealedCount] = useState(() => songs.length);
  const [failedIds, setFailedIds] = useState<ReadonlySet<number>>(new Set());
  const [likedIds, setLikedIds] = useState<ReadonlySet<number>>(new Set());
  const [importing, setImporting] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef(new Map<number, HTMLElement>());
  const visibleRef = useRef(new Set<number>());
  const revealedRef = useRef(revealedCount);
  const songsRef = useRef(songs);
  songsRef.current = songs;
  const revealTimerRef = useRef<number | null>(null);
  const spawnFromCenterRef = useRef<Set<number> | null>(null);
  const lastFailedSongRef = useRef<number | null>(null);

  // 星云的排法（设置 › 外观 › 星云怎么排）：按歌手 / 按颜色 / 随机
  const lab = useSpaceLab();
  const toneProgress = useToneProgress();
  // 按颜色排布、缩小时每首歌画成封面颜色的星：把缺的封面色调排队去取，1441 张只取一次
  useEffect(() => {
    ensureTones(songs.map((s) => s.cover ?? '').filter(Boolean));
  }, [songs]);
  // 按颜色（全部）、按歌手（单曲歌手）都按色调排：一批取完（version 变）再排一次
  const toneVersion = lab.mode === 'chroma' || lab.mode === 'cluster' ? toneProgress.version : 0;
  // 色雾按色调画：随机排法的布局不依赖色调，但色雾要跟着色调更新
  const hazeVersionRef = useRef(0);
  hazeVersionRef.current = toneProgress.version;
  const world = useMemo<SpaceWorld>(() => {
    if (lab.mode === 'cluster') return buildCluster(songs);
    if (lab.mode === 'random') return buildRandom(songs);
    return buildChroma(songs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab.mode, songs, toneVersion]);
  worldRef.current = world;
  setActiveWorld(world);
  const worldNowRef = useRef(world);
  worldNowRef.current = world;

  const effectiveCards = world.cards;
  // 搜索时命中的卡片亮、其余变暗；卡片不挪，镜头飞过去
  const matchSet = useMemo(() => (searchMatches.length ? new Set(searchMatches.map((m) => m.index)) : null), [searchMatches]);
  const matchSetRef = useRef(matchSet);
  matchSetRef.current = matchSet;
  const starCanvasRef = useRef<HTMLCanvasElement>(null);
  const tintRef = useRef<HTMLDivElement>(null);
  const starsRef = useRef<StarField | null>(null);
  const mountedARef = useRef(new Float32Array(0));
  const projRef = useRef<Proj>({ sx: 0, sy: 0, s: 0, u: 0 });
  const candRef = useRef<number[]>([]);
  const pickPoolRef = useRef<Pick[]>([]);
  const tintAtRef = useRef(0);
  const lastStarFrameRef = useRef<StarFrame | null>(null);
  const handleCardPlayRef = useRef<(songId: number) => Promise<void>>(async () => {});
  const onContextMenuRef = useRef(onContextMenu);
  onContextMenuRef.current = onContextMenu;

  const panRef = useRef({ x: 0, y: 0 });
  const frameBusRef = useRef<FrameBus>({
    x: 0,
    y: 0,
    zoom: 1,
    vw: typeof window !== 'undefined' ? window.innerWidth : 1280,
    vh: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  /** 「散开」是否正在推卡片（交接结束时还要再刷新一次，把卡片放回原位）。 */
  const partActiveRef = useRef(false);

  // 标题防压盖（审查第 2 条）：每帧把参与计算的卡片收进复用池，循环结束后统一判断再写 --meta-a
  const metaPoolRef = useRef<MetaBox[]>([]);
  /** 卡片 DOM 盒高度（封面 + 标题区）：缩放以盒中心为原点，推封面位置要用它。只在第一次读一次 offsetHeight。 */
  const cardBoxHRef = useRef(0);
  /** 正在播放的卡片的标题不参与防压盖（handleFrame 是稳定回调，用 ref 读最新值）。 */
  const currentSongIdRef = useRef(currentSongId);
  currentSongIdRef.current = currentSongId;

  const registerEl = useCallback((id: number, el: HTMLElement | null) => {
    if (el) {
      cardEls.current.set(id, el);
      registerProximity(el);
    } else {
      cardEls.current.delete(id);
      unregisterProximity(el);
    }
  }, []);

  const handleHoverChange = useCallback(
    (id: number, hovered: boolean) => {
      // 右键菜单打开时保留卡片悬浮态，避免菜单抢占指针导致卡片“收回”
      if (!hovered && contextMenuRef.current) return;
      if (hovered) {
        const el = cardEls.current.get(id);
        const w = worldNowRef.current;
        if (el && id >= 0 && id < w.cards.length) {
          const f = frameBusRef.current;
          const delta = lensDelta(getSpaceLab().lens, f.zoom);
          const shape = stageShapeBus.on ? stageShapeBus : null;
          const sinkK = listenBus.style === 'sink' ? listenBus.k * (shape ? shape.sinkPos : 1) : 0;
          const xf: ScreenXf | null =
            sinkK > 0.0005 ? { f: 1 - 0.14 * sinkK, ox: f.vw / 2, oy: f.vh * 0.45, ty: f.vh * 0.04 * sinkK } : null;
          const p = applyXf(project(w.px[id]!, w.py[id]!, f, delta, projRef.current, w.period), xf);
          const t = Math.min(1, Math.max(0, (p.u - 0.35) / 0.65));
          const edge = t * t * (3 - 2 * t);
          const baseScale = Math.min(3.4, p.s);
          const mul = 1.3 - 0.12 * edge;
          const floor = 0.95 - 0.25 * edge;
          const hoverScale = Math.max(baseScale * mul, floor, baseScale * 1.12);
          const hoverZ = Math.round(130 - 55 * edge);
          el.style.setProperty('--hover-s', String(hoverScale));
          el.style.setProperty('--hover-z', `${hoverZ}px`);
        }
      }
      setHoveredId(hovered ? id : null);
    },
    [contextMenuRef],
  );

  // 右键菜单关闭后补一次 hover 清理：菜单开着时卡片的 pointerleave 被上面忽略了，
  // 关闭后若指针已不在那张卡上，hoveredId / .is-hovered 会一直残留，并且 hoveredId !== null 会挡住让开模式。
  // 这里用最近一次指针位置做 elementFromPoint 判断，不依赖浏览器何时刷新 :hover。
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  const menuWasOpenRef = useRef(false);
  const menuOpen = !!contextMenuRef.current;
  useEffect(() => {
    const wasOpen = menuWasOpenRef.current;
    menuWasOpenRef.current = menuOpen;
    if (!wasOpen || menuOpen || hoveredId === null) return;
    const p = lastPointerRef.current;
    const hit = p ? document.elementFromPoint(p.x, p.y) : null;
    const card = cardEls.current.get(hoveredId);
    if (!card || !hit || !card.contains(hit)) setHoveredId(null);
  });

  /**
   * 星云的一帧（#133）：查镜头周围的卡片 → 过透镜投影 → 太小 / 超出上限的画成星，其余挂成卡片；
   * 卡片在屏幕边缘、透镜外圈、缩小时淡出（透明度，不用滤镜，省重绘）；散开 / 退潮照旧在屏幕坐标上推。
   */
  const boundedFrame = useCallback((frame: PanFrame, world: SpaceWorld) => {
    const lab = getSpaceLab();
    const z = frame.zoom;
    const vw = frame.vw;
    const vh = frame.vh;
    const delta = lensDelta(lab.lens, z);
    const { cx, cy } = camCenter(frame);
    const n = world.cards.length;
    if (mountedARef.current.length !== n) mountedARef.current = new Float32Array(n);
    const mountedA = mountedARef.current;
    mountedA.fill(0);
    const p = projRef.current;
    const pool = pickPoolRef.current;
    // 聆听「沉降」：整片星云往下沉、后退（缩到 86%、下移 4vh，中心在 50% / 45%），在屏幕坐标上算（见 lens.applyXf）
    // 漫游歌词升级（样张 M）：沉降幅度随段落开合、间奏让位变化（主歌略沉，副歌浮起一半，间奏完全浮起）
    const pageStage = document.documentElement.dataset.stageMode === 'page';
    const shape = !pageStage && stageShapeBus.on ? stageShapeBus : null;
    const sinkK = !pageStage && listenBus.style === 'sink' ? listenBus.k * (shape ? shape.sinkPos : 1) : 0;
    const xf: ScreenXf | null = sinkK > 0.0005 ? { f: 1 - 0.14 * sinkK, ox: vw / 2, oy: vh * 0.45, ty: vh * 0.04 * sinkK } : null;
    const qk = xf ? 1 / xf.f : 1; // 缩小后一屏装得下更大一片世界，查询范围跟着放大
    let np = 0;
    if (z > 0.12) {
      const was = visibleRef.current;
      const cand = candRef.current;
      cand.length = 0;
      // 画布首尾相接（#136）：查镜头周围一个屏幕大小（加一圈余量）的矩形，取每首歌离镜头最近的那一份
      queryRect(world, cx, cy, (vw * qk) / (2 * z) + QUERY_PAD + 120 / z, (vh * qk) / (2 * z) + QUERY_PAD * 1.2 + 120 / z, cand);
      for (const id of cand) {
        if (id >= revealedRef.current) continue;
        applyXf(project(world.px[id]!, world.py[id]!, frame, delta, p, world.period), xf);
        const size = CARD_WIDTH * p.s;
        // 小于 56px 的交给画布（这时 DOM 卡片本来就淡到 0 了，挂着只是白白重算样式）
        if (size < MIN_CARD_PX) continue;
        // 挂 DOM 的范围比屏幕大一圈（#137：1.5 张卡 + 60px）：拖进来时卡片早已挂好、就在那里，不会到了边上才闪现。
        // 已挂着的出了这个范围再多留一段才卸（滞回），免得在边界上反复挂 / 卸，触发整批渲染
        const keep = was.has(id);
        const padX = size * (keep ? 2.3 : 1.5) + 60;
        const padY = size * (keep ? 2.7 : 1.9) + 60;
        if (p.sx < -padX || p.sx > vw + padX || p.sy < -padY || p.sy > vh + padY) continue;
        const slot = (pool[np] ??= { id: 0, sx: 0, sy: 0, s: 0, u: 0, sortU: 0, inView: false });
        const margin = size * (keep ? 1.0 : 0.6);
        slot.id = id;
        slot.sx = p.sx;
        slot.sy = p.sy;
        slot.s = p.s;
        slot.u = p.u;
        slot.sortU = keep ? p.u - 0.06 : p.u;
        slot.inView = p.sx >= -margin && p.sx <= vw + margin && p.sy >= -margin && p.sy <= vh + margin;
        np++;
      }
    }
    const live = pool
      .slice(0, np)
      .sort((a, b) => (a.inView === b.inView ? a.sortU - b.sortU : a.inView ? -1 : 1));
    // 超过上限时优先保留视口内卡片，再按离中心由近到远分配名额，超出部分由画布画（单卡只在画布或 DOM 之一显示，不双画）
    if (live.length > MAX_MOUNT) live.length = MAX_MOUNT;
    // 交给 React 的列表按 id 排，不按离镜头远近排（#137）：远近顺序每帧都在变，按它排的话每次有卡片进出，
    // React 都要在 DOM 里挪动一大批卡片节点，挪动会让卡片的动画从头再放一遍——拖动时满屏闪烁。
    // 按 id 排，已挂着的卡片相对顺序不变，进出只插入 / 删除；层叠靠 z-index，不靠 DOM 顺序。
    const ids = live.map((q) => q.id).sort((a, b) => a - b);

    const cur = visibleRef.current;
    let changed = ids.length !== cur.size;
    if (!changed) {
      for (const id of ids) {
        if (!cur.has(id)) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      const nextSet = new Set(ids);
      // 跌出 DOM 名额的卡片在本帧立刻隐藏，防止 React 异步卸载前旧 DOM 留在上一帧坐标、和画布一起出现双影跳跃
      for (const oldId of cur) {
        if (!nextSet.has(oldId)) {
          const oldEl = cardEls.current.get(oldId);
          if (oldEl) oldEl.style.visibility = 'hidden';
        }
      }
      visibleRef.current = nextSet;
      setVisibleIds(ids);
    }

    const spawnSet = spawnFromCenterRef.current;
    const partK = !pageStage && listenBus.style === 'part' ? listenBus.k : 0;
    const ebbK = !pageStage && listenBus.style === 'ebb' ? listenBus.k : 0;
    // 字照亮空间：正在唱的字附近的卡片提亮（高斯衰减，半径约 0.22 屏宽）。
    // lk = 光心处卡片从让开后的暗度往原亮度（1.05）拉回的比例，所以要知道这一刻整片星云被压到多暗
    const lightK = shape ? shape.lk * listenBus.k : 0;
    const lightR = vw * 0.22;
    const dimBase =
      listenBus.style === 'sink'
        ? 1 - 0.62 * listenBus.k * (shape ? shape.sinkDepth : 1)
        : listenBus.style === 'part'
          ? 1 - 0.16 * listenBus.k * (shape ? shape.sinkDepth : 1)
          : 1 - 0.08 * listenBus.k;
    const lightGain = 1.05 / Math.max(0.2, dimBase) - 1;
    partActiveRef.current = partK > 0 || ebbK > 0 || xf !== null;
    const metaPool = metaPoolRef.current;
    let metaN = 0;
    const liveA = frameAlphaBuffer(n);
    for (const q of live) {
      const airA = airAlpha(q.u);
      liveA[q.id] = airA; // 还没挂上的卡片第一次渲染时用这个值，挂上的第一帧就对
      const el = cardEls.current.get(q.id);
      if (!el) {
        mountedA[q.id] = 0; // 还没挂上（下一次渲染才有）：先由画布画
        continue;
      }
      if (el.dataset.pending !== undefined) {
        if (el.dataset.imgReady === '1') {
          delete el.dataset.pending;
          if (el.style.visibility) el.style.visibility = '';
          mountedA[q.id] = 1;
        } else {
          mountedA[q.id] = 0;
        }
      } else {
        if (el.style.visibility) el.style.visibility = '';
        mountedA[q.id] = 1; // 画布与 DOM 同帧互斥，杜绝双画重影
      }
      if (spawnSet?.has(q.id)) {
        el.style.setProperty('--x', `${vw / 2 - CARD_WIDTH / 2}px`);
        el.style.setProperty('--y', `${vh / 2 - CARD_HEIGHT / 2}px`);
        el.style.setProperty('--scale', '0.9');
        el.style.setProperty('--card-a', '1');
        el.style.setProperty('--meta-a', '1');
        el.style.zIndex = '1';
        spawnSet.delete(q.id);
        continue;
      }
      let sx = q.sx;
      let sy = q.sy;
      let pushDim = 0;
      if (partK > 0) {
        const pp = partOffset(sx, sy, vw, vh, partK, listenBus.layout, q.id * 2.399);
        sx = pp.x;
        sy = pp.y;
        pushDim = pp.push;
      } else if (ebbK > 0) {
        sx += (sx - vw / 2) * 0.18 * ebbK;
        sy += (sy - vh * 0.45) * 0.14 * ebbK + vh * 0.05 * ebbK;
      }
      const scale = Math.min(3.4, q.s);
      const x = sx - CARD_WIDTH / 2;
      const y = sy - CARD_HEIGHT / 2;
      el.style.setProperty('--x', `${x}px`);
      el.style.setProperty('--y', `${y}px`);
      el.style.setProperty('--scale', String(scale));
      el.style.setProperty('--card-a', airA.toFixed(3));
      let lit = 0;
      if (lightK > 0.01) {
        const dx = (sx - shape!.lx) / lightR;
        const dy = (sy - shape!.ly) / lightR;
        lit = lightK * Math.exp(-(dx * dx + dy * dy));
      }
      const bright = (1 - 0.42 * pushDim) * (1 + lightGain * lit);
      el.style.setProperty(
        '--card-filter',
        Math.abs(bright - 1) > 0.01 ? `brightness(${bright.toFixed(3)})${lit > 0.01 ? ` saturate(${(1 + 0.3 * lit).toFixed(3)})` : ''}` : 'none',
      );
      const zi = Math.round((1 - Math.min(1, q.u)) * 5000) + 1;
      el.style.zIndex = String(zi);
      const base = q.u < 0.3 && z > 0.55 ? 1 : 0;
      el.style.setProperty('--meta-a', String(base));
      if (cardBoxHRef.current === 0) cardBoxHRef.current = el.offsetHeight;
      const box = (metaPool[metaN] ??= makeMetaBox());
      box.id = q.id;
      box.el = el;
      box.x = x;
      box.y = y;
      box.s = scale;
      box.rot = 0;
      box.z = zi;
      box.base = base;
      box.exempt = world.cards[q.id]!.track.id === currentSongIdRef.current;
      metaN++;
    }
    if (metaN > 1 && cardBoxHRef.current > 0) {
      resolveMetaVisibility(metaPool, metaN, cardBoxHRef.current);
      for (let i = 0; i < metaN; i++) {
        const b = metaPool[i]!;
        if (b.alpha !== b.base) b.el!.style.setProperty('--meta-a', String(b.alpha));
      }
    }
    for (let i = 0; i < metaN; i++) metaPool[i]!.el = null;

    const sf = (lastStarFrameRef.current ??= {} as StarFrame);
    sf.world = world;
    sf.cam = { x: frame.x, y: frame.y, zoom: frame.zoom, vw, vh };
    sf.delta = delta;
    sf.mounted = mountedA;
    sf.boxH = cardBoxHRef.current;
    sf.match = matchSetRef.current;
    sf.xf = xf;
    sf.currentId = currentSongIdRef.current;
    sf.toneVersion = hazeVersionRef.current;
    starsRef.current?.draw(sf);

    // 环境色跟随：镜头附近卡片的封面色调（越大越靠中心权重越高），每 220ms 更新一次，CSS 过渡负责平滑
    const tint = tintRef.current;
    if (tint) {
      const now = performance.now();
      if (!lab.tint || !live.length) {
        tint.style.opacity = '0';
      } else if (now - tintAtRef.current > 220) {
        tintAtRef.current = now;
        let w = 0;
        let A = 0;
        let B = 0;
        for (let i = 0; i < Math.min(40, live.length); i++) {
          const q = live[i]!;
          const t = toneOf(world.cards[q.id]!.track.cover);
          if (!t) continue;
          const ww = q.s * q.s * (1 - Math.min(1, q.u));
          w += ww;
          A += t[1] * ww;
          B += t[2] * ww;
        }
        if (w > 0) {
          const [r, g, b] = oklabToRgb(0.62, (A / w) * 1.6, (B / w) * 1.6);
          tint.style.backgroundColor = `rgb(${r},${g},${b})`;
          tint.style.opacity = '';
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFrame = useCallback((frame: PanFrame) => {
    panRef.current = { x: frame.x, y: frame.y };
    frameBusRef.current.x = frame.x;
    frameBusRef.current.y = frame.y;
    frameBusRef.current.zoom = frame.zoom;
    frameBusRef.current.vw = frame.vw;
    frameBusRef.current.vh = frame.vh;
    boundedFrame(frame, worldNowRef.current);
  }, []);

  // 新挂载的卡片 / 换了正在播放的歌：补一帧，让防压盖按最新的屏幕坐标重新判断（空闲时没有别的帧会来做）
  useEffect(() => {
    controllerRef.current?.refresh();
  }, [visibleIds, currentSongId, controllerRef]);

  // 星层画布（StageCanvas 渲染），换排法时重建
  useEffect(() => {
    starsRef.current = starCanvasRef.current ? new StarField(starCanvasRef.current) : null;
  }, [world]);

  // 打开 / 换排法时整片淡入（#137）：只在这之后约 0.9s 内新挂上的卡片淡入，拖动时进来的卡片不淡入。
  // 用 data 属性而不是 class：className 归 React 管，重渲染会冲掉手动加的 class
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.dataset.arriving = '';
    const t = window.setTimeout(() => delete stage.dataset.arriving, 900);
    return () => {
      window.clearTimeout(t);
      delete stage.dataset.arriving;
    };
  }, [world]);

  // 小封面缩略图陆续到了：补画一帧
  useEffect(() => onThumbsReady(() => controllerRef.current?.refresh()), [world, controllerRef]);
  // DOM 卡片封面解码完成后：同帧去掉 pending、让画布停画这张卡
  useEffect(() => onCardCoverReady(() => controllerRef.current?.refresh()), [world, controllerRef]);

  // 点 / 右键 / 静止悬停画布上的小封面也能交互（DOM 卡片自己处理）；拖拽期完全跳过，零拖拽开销
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let down: { x: number; y: number } | null = null;
    let lastHoverCheck = 0;
    const setCursor = (on: boolean) => {
      const next = on ? 'pointer' : '';
      if (stage.style.cursor !== next) stage.style.cursor = next;
    };
    const hitAt = (clientX: number, clientY: number): number => {
      const f = lastStarFrameRef.current;
      const sf = starsRef.current;
      if (!f || !sf) return -1;
      const r = stage.getBoundingClientRect();
      return sf.hit(f, clientX - r.left, clientY - r.top);
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (
        stage.classList.contains('is-panning') ||
        stage.classList.contains('is-grabbing') ||
        (e.target as Element | null)?.closest('.music-card')
      ) {
        setCursor(false);
        return;
      }
      const now = performance.now();
      if (now - lastHoverCheck < 80) return;
      lastHoverCheck = now;
      setCursor(hitAt(e.clientX, e.clientY) >= 0);
    };
    const onLeave = () => setCursor(false);
    const onClick = (e: MouseEvent) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      if ((e.target as Element | null)?.closest('.music-card')) return;
      const id = hitAt(e.clientX, e.clientY);
      if (id >= 0) void handleCardPlayRef.current(id);
    };
    const onCtx = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest('.music-card')) return;
      const id = hitAt(e.clientX, e.clientY);
      const f = lastStarFrameRef.current;
      const track = id >= 0 && f ? f.world.cards[id]?.track : undefined;
      if (track) onContextMenuRef.current?.(e, track);
    };
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove, { passive: true });
    stage.addEventListener('pointerleave', onLeave);
    stage.addEventListener('click', onClick);
    stage.addEventListener('contextmenu', onCtx);
    return () => {
      setCursor(false);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      stage.removeEventListener('click', onClick);
      stage.removeEventListener('contextmenu', onCtx);
    };
  }, [world]);

  // 透镜强度、搜索命中、封面色调（色雾）变了：补一帧
  useEffect(() => {
    controllerRef.current?.refresh();
  }, [lab.lens, world, matchSet, controllerRef, toneProgress.version]);

  // PanController 生命周期 + __nebula 调试口
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    // 开场镜头对准正在播放的那首，而不是固定的位置；缩放不低于下限（小歌单 / 大屏幕下限更高）
    const w = world;
    const initialZoom = Math.max(0.62, zoomFloor(w, window.innerWidth, window.innerHeight));
    const sid0 = audioPlayer.getState().song?.id ?? -1;
    const inWorld = sid0 >= 0 && sid0 < w.cards.length;
    const controller = new PanController(stage, {
      initialX: (inWorld ? w.px[sid0]! : 0) - window.innerWidth / (2 * initialZoom),
      initialY: (inWorld ? w.py[sid0]! : 0) - window.innerHeight / (2 * initialZoom),
      initialZoom,
      bounded: {
        // 首尾相接、没有边界（#136）。缩放下限：最远也要认得出封面（约 48px，0.28 倍）；
        // 一屏不超过周期的一部分（大歌单 60%），同一首歌不会在同一屏出现两次（见 zoomFloor）
        period: w.period,
        zoomMin: (vw, vh) => zoomFloor(w, vw, vh),
        zoomMax: 2.4,
        worldPerPixel: (sx, sy, f) => worldPerPixel(sx, sy, f, lensDelta(getSpaceLab().lens, f.zoom)),
      },
      onFrame: handleFrame,
      onPanStart: () => {
        setHoveredId(null);
        clearProximity();
        stage.style.cursor = '';
      },
    });
    controllerRef.current = controller;
    controller.start();
    const offCommands = [
      registerSpaceCommand('focusCurrent', () => {
        const sid = audioPlayer.getState().song?.id ?? -1;
        if (sid >= 0 && sid < w.cards.length) controller.animateToCenter(w.px[sid]!, w.py[sid]!, 1);
      }),
    ];

    window.__nebula = {
      reset: () => controller.reset(),
      pan: () => ({ x: controller.pan.x, y: controller.pan.y }),
      total: songs.length,
      visible: () => cardEls.current.size,
      revealed: () => revealedRef.current,
      player: audioPlayer,
      songsData: () => songsRef.current,
      setSongAudio: (id: number, url: string) => {
        libraryService.applyImported(
          songsRef.current.map((s, i) => (i === id ? { ...s, audio: url } : s)),
        );
      },
      search: (q: string) => {
        const m = matchSongs(q, songsRef.current);
        if (!m.length) return;
        applySearch(m, m[0]!.index);
      },
      zoom: () => controllerRef.current?.zoom ?? 1,
      stageMode: (m: StageLayout) => setSpaceLab({ mode: m }),
      travelGL: (on: boolean) => setSpaceLab({ travelGL: on }),
      space: () => {
        const c = controllerRef.current;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return {
          mode: getSpaceLab().mode,
          zoom: c?.zoom ?? 1,
          center: c ? { x: c.pan.x + vw / (2 * c.zoom), y: c.pan.y + vh / (2 * c.zoom) } : null,
          period: w.period,
          clusters: w.clusters.length,
          labels: w.clusters
            .filter((c) => c.label)
            .map((c) => ({ name: c.name, kind: c.label!.kind, x: c.label!.x, y: c.label!.y, songs: c.ids.length })),
        };
      },
      lookAt: (x: number, y: number, z: number) => controller.animateToCenter(x, y, z, 1),
    };

    return () => {
      offCommands.forEach((off) => off());
      controller.dispose();
      controllerRef.current = null;
      window.__nebula = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleFrame, songs.length, applySearch, world]);

  // 播放器失败事件 → 卡片置灰；之后同一首真正播起来（如重新登录后）→ 恢复
  useEffect(
    () =>
      audioPlayer.subscribe(() => {
        const s = audioPlayer.getState();
        if (!s.song) return;
        const id = s.song.id;
        if (s.failed && lastFailedSongRef.current !== id) {
          lastFailedSongRef.current = id;
          setFailedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
        } else if (s.playing && !s.failed) {
          if (lastFailedSongRef.current === id) lastFailedSongRef.current = null;
          setFailedIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      }),
    [],
  );

  useEffect(
    () => () => {
      if (revealTimerRef.current !== null) window.clearInterval(revealTimerRef.current);
    },
    [],
  );

  useEffect(() => initGlassGlow(), []);

  // 交接进行中每帧刷新一次卡片位置（「沉降」「散开」「退潮」都会移动卡片；版面模式下交由纸面托底，不触发整片星云每帧重排；切走前若仍有偏移则刷新一次归位）
  useEffect(
    () =>
      onListenFrame(() => {
        if (document.documentElement.dataset.stageMode === 'page' && !partActiveRef.current) return;
        if (listenBus.style === 'sink' || listenBus.style === 'part' || listenBus.style === 'ebb' || partActiveRef.current) controllerRef.current?.refresh();
      }),
    [controllerRef],
  );

  // 会话记忆恢复：上次导入歌单 + 上次播放歌曲（只跑一次；超大整合歌单回落按 mergedId 从主进程读取）
  useEffect(() => {
    let cancelled = false;
    interface SavedSession {
      tracks?: DesktopTrack[];
      mergedId?: string;
      currentId?: number;
      currentTrack?: DesktopTrack;
      resumeAfter?: number;
    }
    const applyRestored = (rawTracks: DesktopTrack[], s: SavedSession) => {
      if (cancelled || !rawTracks.length) return;
      const restored = rawTracks.map((t, i) => toFrontendTrack(t, i));
      libraryService.restoreSongs(restored);
      setRevealedCount(restored.length);
      revealedRef.current = restored.length;
      visibleRef.current = new Set();
      setVisibleIds([]);
      if (s.currentTrack) {
        // 上次正在播的是「插播歌」（不在歌单里）：按插播还原，播完接回歌单原来的位置
        audioPlayer.restoreTransient(
          toFrontendTrack(s.currentTrack, FOREIGN_SONG_ID),
          restored,
          typeof s.resumeAfter === 'number' ? s.resumeAfter : -1,
        );
      } else {
        const cur = restored.find((t) => t.id === s.currentId) ?? restored[0]!;
        audioPlayer.restore(cur, restored);
      }
    };
    try {
      const raw = localStorage.getItem('music-nebula.session');
      if (!raw) return;
      const s = JSON.parse(raw) as SavedSession;
      if (s.tracks?.length) {
        applyRestored(s.tracks, s);
      } else if (s.mergedId && hasDesktopAPI() && window.nebulaAPI?.mergedGet) {
        void window.nebulaAPI
          .mergedGet(s.mergedId)
          .then((res) => {
            if (cancelled || libraryService.getState().songs.length > 0) return;
            if (res.ok && res.data?.playlist?.tracks?.length) {
              applyRestored(res.data.playlist.tracks, s);
            }
          })
          .catch(() => {
            /* ignore */
          });
      }
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 渐进式生成：每 100ms 揭示一批卡片，总时长约 4 秒。 */
  const startProgressiveReveal = useCallback((total: number, onDone?: () => void) => {
    if (revealTimerRef.current !== null) window.clearInterval(revealTimerRef.current);
    revealedRef.current = 0;
    setRevealedCount(0);
    const batch = Math.max(1, Math.ceil(total / 40));
    const timer = window.setInterval(() => {
      revealedRef.current = Math.min(total, revealedRef.current + batch);
      setRevealedCount(revealedRef.current);
      controllerRef.current?.refresh();
      if (revealedRef.current >= total) {
        window.clearInterval(timer);
        revealTimerRef.current = null;
        onDone?.();
      }
    }, 100);
    revealTimerRef.current = timer;
  }, []);

  /** 统一入口：把解析好的歌曲集合交给星云（渐进生成）。 */
  const beginImport = useCallback(
    (adapterName: string, tracks: Track[], simulated = false, note?: string) => {
      visibleRef.current = new Set();
      setVisibleIds([]);
      libraryService.applyImported(tracks);
      // 新歌单接管播放队列，但不打断正在播的歌：它播完后从新歌单第一首接上（AudioPlayer.adoptQueue）
      audioPlayer.adoptQueue(tracks);
      setImporting(true);
      spawnFromCenterRef.current = new Set(tracks.map((_, i) => i));
      startProgressiveReveal(tracks.length, () => {
        setImporting(false);
        spawnFromCenterRef.current = null;
        completeImport(
          simulated ? 'warn' : 'done',
          simulated ? `已导入 ${tracks.length} 首（模拟）${note ?? ''}` : `已导入 ${tracks.length} 首（${adapterName}）`,
        );
      });
    },
    [startProgressiveReveal, completeImport],
  );

  const resetImportState = useCallback(() => {
    setHoveredId(null);
    // 不再 audioPlayer.stop()：载入新歌单不打断正在播放的歌（2026-11-14 用户确认）
    setFailedIds(new Set());
    lastFailedSongRef.current = null;
    setLikedIds(new Set());
  }, []);

  /** 卡片点播：解析（桌面取链）→ 播放。不再自动打开二级页（NEBULA_UI_SYSTEM §10，用户 2026-11-09 确认）；
   *  二级页从底部播放条封面进入。 */
  const handleCardPlay = useCallback(async (songId: number) => {
    const song = songsRef.current[songId];
    if (!song) return;
    let target = song;
    if (!target.audio && hasDesktopAPI()) {
      const res = await window.nebulaAPI!.resolveSong(toBackendTrack(target), preferredQuality() || undefined);
      if (res.ok && res.data?.url) {
        target = {
          ...target,
          audio: res.data.url,
          trial: res.data.trial,
          trialEndTime: res.data.trialEndTime,
          quality: res.data.quality,
          via: viaOf(res.data),
        };
      }
    }
    audioPlayer.playSong(target, songsRef.current);
  }, []);

  handleCardPlayRef.current = handleCardPlay;

  /** 回到中心：当前歌曲卡片居中，无则重置视角。 */
  const handleReset = useCallback(() => {
    setHoveredId(null);
    const controller = controllerRef.current;
    const song = audioPlayer.getState().song;
    const w = worldNowRef.current;
    if (!controller) return;
    // 飞回正在播放的那首；没有就回到星云中心
    if (song && song.id >= 0 && song.id < w.cards.length) controller.animateToCenter(w.px[song.id]!, w.py[song.id]!, 1);
    else controller.animateToCenter(0, 0, 0.92);
  }, []);

  const handleToggleLike = useCallback(() => {
    const song = audioPlayer.getState().song;
    if (!song) return;
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (next.has(song.id)) next.delete(song.id);
      else next.add(song.id);
      return next;
    });
  }, []);

  const liked = currentSongId != null && likedIds.has(currentSongId);

  return {
    stageRef,
    starCanvasRef,
    tintRef,
    matchSet,
    tilt: lab.tilt,
    frameBusRef,
    panRef,
    importing,
    hoveredId,
    visibleIds,
    failedIds,
    likedIds,
    liked,
    effectiveCards,
    registerEl,
    handleHoverChange,
    handleCardPlay,
    handleReset,
    handleToggleLike,
    beginImport,
    resetImportState,
  };
}
