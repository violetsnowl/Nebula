import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { audioPlayer, FOREIGN_SONG_ID } from '../../lib/audio/AudioPlayer';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SEED,
  cardScreenPos,
  computeTileSize,
  generateCards,
  type CardSpec,
  type LayoutMetrics,
} from '../../lib/layout';
import { fisheyeFilter, fisheyeMetaAlpha, fisheyeScale, fisheyeZIndex } from '../../lib/fisheye';
import { makeMetaBox, resolveMetaVisibility, type MetaBox } from '../../lib/metaOverlap';
import { buildSpatialIndex, queryVisibleIds } from '../../lib/spatial';
import { CULL_BUFFER, type FrameBus } from '../../lib/stage';
import { initGlassGlow, registerProximity, unregisterProximity } from '../../lib/glassGlow';
import type { Track } from '../../lib/catalog';
import { mulberry32 } from '../../lib/rng';
import { buildClusterPositions, matchSongs, panForCentering, type SearchMatch } from '../../lib/search';
import { PanController } from '../../lib/panEngine';
import { listenBus, onListenFrame, partOffset } from '../../lib/listenMode';
import type { PanFrame } from '../../lib/panEngine';
import { hasDesktopAPI, toBackendTrack, toFrontendTrack, viaOf } from '../../lib/playlist/ipcClient';
import type { DesktopTrack } from '../../lib/playlist/ipcClient';
import { libraryService } from '../../lib/library';
import { preferredQuality } from '../../lib/preferences';
import type { ImportStatus } from '../../lib/playlistTypes';
import { getSpaceLab, registerSpaceCommand, setSpaceLab, useSpaceLab, type StageMode } from '../../lib/space/lab';
import { buildChroma, buildCluster, overviewZoom, queryDisc, type BoundedWorld } from '../../lib/space/world';
import { camCenter, lensDelta, project, worldPerPixel, type Proj } from '../../lib/space/lens';
import { ensureTones, oklabToRgb, toneOf, useToneProgress } from '../../lib/space/tone';
import { setActiveWorld } from '../../lib/space/active';
import { StarField, type StarFrame } from '../../lib/space/stars';
import { onThumbsReady } from '../../lib/space/thumbs';

/**
 * 有边界星云里同时挂成 DOM 卡片的上限。几百张卡片同时变动时样式重算太贵（实测每张约 50µs/帧，
 * 0.3 倍缩放下 190 张时拖动每帧 40–50ms），所以小卡片交给星层画布画缩略图。
 */
const MAX_MOUNT = 140;
/** 屏幕上小于这个尺寸（px）的卡片不挂 DOM，由画布画缩略图；56–72px 之间两种画法交叉淡化。 */
const MIN_CARD_PX = 56;
const FULL_CARD_PX = 72;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

interface Pick {
  id: number;
  sx: number;
  sy: number;
  s: number;
  u: number;
}

/** contextMenu 的最小结构类型（与 useOverlays.ContextMenuState 结构化兼容）。 */
interface CtxMenuShape {
  x: number;
  y: number;
  track: Track;
}

interface UseStageOptions {
  /** 舞台控制器 ref（App 声明并传给 useSearchCluster 做搜索定位接线）。 */
  controllerRef: MutableRefObject<PanController | null>;
  /** 当前曲库（渲染卡片 + 曲库刷新）。 */
  songs: Track[];
  /** 搜索命中（簇团替换有效布局）。 */
  searchMatches: SearchMatch[];
  /** 搜索聚簇定位（__nebula.search 接线）。 */
  applySearch: (matches: SearchMatch[], focusIndex: number | null) => void;
  /** 右键菜单打开时保留卡片悬浮态（防菜单抢占指针）。 */
  contextMenuRef: RefObject<CtxMenuShape | null>;
  /** 导入渐进揭示完成后的收尾（组合层接 usePlaylistImport.complete）。 */
  completeImport: (status: ImportStatus, message: string) => void;
  /** 当前播放歌曲 id（低频 context 注入，避免 stage 依赖 playback hook）。 */
  currentSongId: number | null;
  /** 由 App 声明并传给 useSearchCluster 的布局 refs（useStage 渲染时写入）。 */
  metricsRef: MutableRefObject<LayoutMetrics>;
  effectiveCardsRef: MutableRefObject<CardSpec[]>;
  /** 有边界星云（#133 方向原型，现有模式为 null），同上由 useStage 渲染时写入。 */
  worldRef: MutableRefObject<BoundedWorld | null>;
}

/**
 * 舞台领域（docs/project/ARCHITECTURE.md §2，最后迁移的高风险块）：
 * 拥有 hovered/visible/failed/liked/渐进揭示/PanController/虚拟化渲染数据；
 * 只依赖 lib（audioPlayer / LibraryService / 布局 / 空间索引 / 搜索），不依赖其他 hook。
 */
export function useStage({
  controllerRef,
  songs,
  searchMatches,
  applySearch,
  contextMenuRef,
  completeImport,
  currentSongId,
  metricsRef,
  effectiveCardsRef,
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

  // 主舞台方向原型（#133）：现有卡片墙 / A 色彩星图 / B 星团，由开发者面板切换，默认现有
  const lab = useSpaceLab();
  const toneProgress = useToneProgress();
  // 两个方向都要封面色调（A 按它排布，缩小时每首歌画成这个颜色的星）：切过去时把缺的排队去取，1441 张只取一次
  useEffect(() => {
    if (lab.mode !== 'classic') ensureTones(songs.map((s) => s.cover ?? '').filter(Boolean));
  }, [lab.mode, songs]);
  // 两个方向都按色调排（A 全部、B 的单曲歌手）：一批取完（version 变）再排一次
  const toneVersion = lab.mode !== 'classic' ? toneProgress.version : 0;
  const world = useMemo<BoundedWorld | null>(() => {
    if (lab.mode === 'chroma') return buildChroma(songs);
    if (lab.mode === 'cluster') return buildCluster(songs);
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab.mode, songs, toneVersion]);
  worldRef.current = world;
  setActiveWorld(world);
  const worldNowRef = useRef(world);
  worldNowRef.current = world;

  // 派生布局（与 useSearchCluster 共用：渲染时写 refs，回调运行时读）
  const cards = useMemo(() => generateCards(mulberry32(SEED), songs), [songs]);
  const metrics = useMemo(() => computeTileSize(songs.length), [songs.length]);
  metricsRef.current = metrics;
  // 搜索「把命中的卡挪到画布中心」只属于现有卡片墙；有边界星云里卡片不动，命中的亮、其余变暗，镜头飞过去
  const clusterPositions = useMemo(
    () =>
      world
        ? new Map<number, { x: number; y: number }>()
        : buildClusterPositions(
            cards,
            searchMatches.map((m) => m.index),
            metrics,
          ),
    [cards, searchMatches, metrics, world],
  );
  const effectiveCards = useMemo(
    () =>
      world
        ? world.cards
        : clusterPositions.size
          ? cards.map((c, i) => {
              const p = clusterPositions.get(i);
              return p ? { ...c, x: p.x, y: p.y } : c;
            })
          : cards,
    [cards, clusterPositions, world],
  );
  effectiveCardsRef.current = effectiveCards;
  const spatial = useMemo(() => buildSpatialIndex(world ? [] : effectiveCards, metrics), [effectiveCards, metrics, world]);
  const matchSet = useMemo(
    () => (world && searchMatches.length ? new Set(searchMatches.map((m) => m.index)) : null),
    [world, searchMatches],
  );
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
  const spatialRef = useRef(spatial);
  spatialRef.current = spatial;

  const panRef = useRef({
    x: (metrics.tileWidth - (typeof window !== 'undefined' ? window.innerWidth : 1280)) / 2,
    y: (metrics.tileHeight - (typeof window !== 'undefined' ? window.innerHeight : 800)) / 2,
  });
  const frameBusRef = useRef<FrameBus>({
    x: panRef.current.x,
    y: panRef.current.y,
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
   * 有边界星云的一帧（#133）：查镜头周围的卡片 → 过透镜投影 → 太小 / 超出上限的画成星，其余挂成卡片；
   * 卡片在屏幕边缘、透镜外圈、缩小时淡出（透明度，不用滤镜，省重绘）；散开 / 退潮照旧在屏幕坐标上推。
   */
  const boundedFrame = useCallback((frame: PanFrame, world: BoundedWorld) => {
    const lab = getSpaceLab();
    const z = frame.zoom;
    const vw = frame.vw;
    const vh = frame.vh;
    const delta = lensDelta(lab.lens, z);
    const { cx, cy } = camCenter(frame);
    const rs = Math.hypot(vw, vh) / 2;
    const n = world.cards.length;
    if (mountedARef.current.length !== n) mountedARef.current = new Float32Array(n);
    const mountedA = mountedARef.current;
    mountedA.fill(0);
    const p = projRef.current;
    const pool = pickPoolRef.current;
    let np = 0;
    if (z > 0.12) {
      const was = visibleRef.current;
      const cand = candRef.current;
      cand.length = 0;
      queryDisc(world, cx, cy, (rs / z) * 1.12 + 260, cand);
      for (const id of cand) {
        if (id >= revealedRef.current) continue;
        project(world.px[id]!, world.py[id]!, frame, delta, p);
        const size = CARD_WIDTH * p.s;
        // 小于 56px 的交给画布（这时 DOM 卡片本来就淡到 0 了，挂着只是白白重算样式）
        if (size < MIN_CARD_PX) continue;
        // 已挂着的卡片出了屏幕边缘再多留一段才卸（滞回），免得在边界上反复挂 / 卸，触发整批渲染
        const m = was.has(id) ? 1.6 : 1;
        if (p.sx < -size * m || p.sx > vw + size * m || p.sy < -size * 1.4 * m || p.sy > vh + size * 1.4 * m) continue;
        const slot = (pool[np] ??= { id: 0, sx: 0, sy: 0, s: 0, u: 0 });
        slot.id = id;
        slot.sx = p.sx;
        slot.sy = p.sy;
        slot.s = p.s;
        slot.u = p.u;
        np++;
      }
    }
    const live = pool.slice(0, np).sort((a, b) => a.u - b.u);
    if (live.length > MAX_MOUNT) live.length = MAX_MOUNT;
    const ids = live.map((q) => q.id);

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
      visibleRef.current = new Set(ids);
      setVisibleIds(ids);
    }

    const spawnSet = spawnFromCenterRef.current;
    const partK = listenBus.style === 'part' ? listenBus.k : 0;
    const ebbK = listenBus.style === 'ebb' ? listenBus.k : 0;
    partActiveRef.current = partK > 0 || ebbK > 0;
    const metaPool = metaPoolRef.current;
    let metaN = 0;
    for (const q of live) {
      // 56–72px 之间 DOM 卡片和画布缩略图交叉淡化
      const domA = smoothstep(MIN_CARD_PX, FULL_CARD_PX, CARD_WIDTH * q.s);
      mountedA[q.id] = domA;
      const el = cardEls.current.get(q.id);
      if (!el) {
        mountedA[q.id] = 0; // 还没挂上（下一次渲染才有）：先由画布画
        continue;
      }
      el.classList.remove('is-offscreen');
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
      const size = CARD_WIDTH * q.s;
      const edge = Math.min(sx, vw - sx, sy, vh - sy);
      const edgeA = smoothstep(-0.3 * size, 0.42 * size, edge);
      const airA = 1 - 0.4 * smoothstep(0.38, 1.05, q.u);
      const scale = Math.min(3.4, q.s);
      const x = sx - CARD_WIDTH / 2;
      const y = sy - CARD_HEIGHT / 2;
      el.style.setProperty('--x', `${x}px`);
      el.style.setProperty('--y', `${y}px`);
      el.style.setProperty('--scale', String(scale));
      el.style.setProperty('--card-a', (domA * edgeA * airA).toFixed(3));
      el.style.setProperty('--card-filter', pushDim > 0.01 ? `brightness(${(1 - 0.42 * pushDim).toFixed(3)})` : 'none');
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
    sf.currentId = currentSongIdRef.current;
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
    const worldNow = worldNowRef.current;
    if (worldNow) {
      boundedFrame(frame, worldNow);
      return;
    }
    starsRef.current?.clear();
    const cardsNow = effectiveCardsRef.current;
    const spatialNow = spatialRef.current;
    const metricsNow = metricsRef.current;
    const ids = queryVisibleIds(cardsNow, spatialNow, frame, CULL_BUFFER, metricsNow).filter(
      (id) => id < revealedRef.current,
    );
    const maxDist = Math.hypot(frame.vw, frame.vh) / 2;
    const spawnSet = spawnFromCenterRef.current;
    // 漫游 / 聆听交接「散开」（NEBULA_UI_SYSTEM §7.1）：卡片中心按离歌词区的远近向外推，景深按推开后的位置算
    const partK = listenBus.style === 'part' ? listenBus.k : 0;
    // 「退潮」（#124）：卡片像退去的潮水，向外、略向下漂散（离中心越远漂得越多），材质由 CSS 化成薄雾
    const ebbK = listenBus.style === 'ebb' ? listenBus.k : 0;
    partActiveRef.current = partK > 0 || ebbK > 0;

    const metaPool = metaPoolRef.current;
    let metaN = 0;

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
      visibleRef.current = new Set(ids);
      setVisibleIds(ids);
    }

    for (const id of ids) {
      const el = cardEls.current.get(id);
      if (!el) continue;
      const card = cardsNow[id];
      if (!card) continue;
      const pos = cardScreenPos(
        card,
        panRef.current,
        metricsNow.tileWidth,
        metricsNow.tileHeight,
        frame.vw,
        frame.vh,
        CULL_BUFFER,
        frame.zoom,
      );
      if (!pos) {
        el.classList.add('is-offscreen');
        continue;
      }
      el.classList.remove('is-offscreen');
      if (spawnSet?.has(id)) {
        el.style.setProperty('--x', `${frame.vw / 2 - CARD_WIDTH / 2}px`);
        el.style.setProperty('--y', `${frame.vh / 2 - CARD_HEIGHT / 2}px`);
        el.style.setProperty('--scale', '0.9');
        el.style.setProperty('--card-filter', 'none');
        el.style.setProperty('--meta-a', '1');
        el.style.zIndex = '1';
        spawnSet.delete(id);
        continue;
      }
      let x = pos.x;
      let y = pos.y;
      let dist = pos.dist;
      let pushDim = 0;
      if (partK > 0) {
        const cx = pos.x + CARD_WIDTH / 2;
        const cy = pos.y + CARD_HEIGHT / 2;
        const p = partOffset(cx, cy, frame.vw, frame.vh, partK, listenBus.layout, id * 2.399);
        x += p.x - cx;
        y += p.y - cy;
        dist = Math.hypot(p.x - frame.vw / 2, p.y - frame.vh / 2);
        pushDim = p.push;
      } else if (ebbK > 0) {
        const cx = pos.x + CARD_WIDTH / 2;
        const cy = pos.y + CARD_HEIGHT / 2;
        x += (cx - frame.vw / 2) * 0.18 * ebbK;
        y += (cy - frame.vh * 0.45) * 0.14 * ebbK + frame.vh * 0.05 * ebbK;
      }
      const depthFilter = fisheyeFilter(dist, maxDist);
      el.style.setProperty('--x', `${x}px`);
      el.style.setProperty('--y', `${y}px`);
      el.style.setProperty('--scale', String(Math.min(3.4, fisheyeScale(dist, maxDist) * frame.zoom)));
      el.style.setProperty(
        '--card-filter',
        pushDim > 0.01
          ? `${depthFilter === 'none' ? '' : `${depthFilter} `}brightness(${(1 - 0.42 * pushDim).toFixed(3)})`
          : depthFilter,
      );
      const scale = Math.min(3.4, fisheyeScale(dist, maxDist) * frame.zoom);
      const z = fisheyeZIndex(dist, maxDist);
      el.style.zIndex = String(z);
      // --meta-a 先按景深（焦点圈内为 1）写一个初值，循环后再由防压盖判断改写
      const base = fisheyeMetaAlpha(dist, maxDist);
      el.style.setProperty('--meta-a', String(base));
      if (cardBoxHRef.current === 0) cardBoxHRef.current = el.offsetHeight;
      const box = (metaPool[metaN] ??= makeMetaBox());
      box.id = id;
      box.el = el;
      box.x = x;
      box.y = y;
      box.s = scale;
      box.rot = card.rotateZ;
      box.z = z;
      box.base = base;
      box.exempt = card.track.id === currentSongIdRef.current;
      metaN++;
    }

    // 标题防压盖：只有结果变成 0 的才需要再写一次（0.3s 透明度过渡沿用 CSS）
    if (metaN > 1 && cardBoxHRef.current > 0) {
      resolveMetaVisibility(metaPool, metaN, cardBoxHRef.current);
      for (let i = 0; i < metaN; i++) {
        const b = metaPool[i]!;
        if (b.alpha !== b.base) b.el!.style.setProperty('--meta-a', String(b.alpha));
      }
    }
    for (let i = 0; i < metaN; i++) metaPool[i]!.el = null; // 不让池持有已卸载卡片的元素
  }, []);

  // 新挂载的卡片 / 换了正在播放的歌：补一帧，让防压盖按最新的屏幕坐标重新判断（空闲时没有别的帧会来做）
  useEffect(() => {
    controllerRef.current?.refresh();
  }, [visibleIds, currentSongId, controllerRef]);

  // 星层画布：有边界星云时才挂（StageCanvas 渲染），换模式时重建
  useEffect(() => {
    starsRef.current = world && starCanvasRef.current ? new StarField(starCanvasRef.current) : null;
  }, [world]);

  // 小封面缩略图陆续到了：补画一帧
  useEffect(() => (world ? onThumbsReady(() => controllerRef.current?.refresh()) : undefined), [world, controllerRef]);

  // 点画布上的小封面也能播放（DOM 卡片自己处理点击）；按下到松开移动超过 5px 算拖动，不算点击
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !world) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      if ((e.target as Element | null)?.closest('.music-card')) return;
      const f = lastStarFrameRef.current;
      const sf = starsRef.current;
      if (!f || !sf) return;
      const r = stage.getBoundingClientRect();
      const id = sf.hit(f, e.clientX - r.left, e.clientY - r.top);
      if (id >= 0) void handleCardPlayRef.current(id);
    };
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('click', onClick);
    return () => {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('click', onClick);
    };
  }, [world]);

  // 透镜强度变了：补一帧
  useEffect(() => {
    if (world) controllerRef.current?.refresh();
  }, [lab.lens, world, matchSet, controllerRef]);

  // PanController 生命周期 + __nebula 调试口
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    // 有边界星云：开场镜头对准正在播放的那首（没有就对准星云中心），而不是固定的画布中心
    const w = world;
    let initialX = (metrics.tileWidth - window.innerWidth) / 2;
    let initialY = (metrics.tileHeight - window.innerHeight) / 2;
    let initialZoom = 1;
    if (w) {
      initialZoom = 0.62;
      const sid = audioPlayer.getState().song?.id ?? -1;
      const inWorld = sid >= 0 && sid < w.cards.length;
      initialX = (inWorld ? w.px[sid]! : 0) - window.innerWidth / (2 * initialZoom);
      initialY = (inWorld ? w.py[sid]! : 0) - window.innerHeight / (2 * initialZoom);
    }
    const controller = new PanController(stage, {
      tileWidth: metrics.tileWidth,
      tileHeight: metrics.tileHeight,
      initialX,
      initialY,
      initialZoom,
      bounded: w
        ? {
            radius: w.radius * 0.96,
            zoomMin: Math.min(0.2, overviewZoom(w, window.innerWidth, window.innerHeight)),
            zoomMax: 2.4,
            worldPerPixel: (sx, sy, f) => worldPerPixel(sx, sy, f, lensDelta(getSpaceLab().lens, f.zoom)),
          }
        : undefined,
      onFrame: handleFrame,
      onPanStart: () => setHoveredId(null),
    });
    controllerRef.current = controller;
    controller.start();
    const offCommands = w
      ? [
          registerSpaceCommand('overview', () =>
            controller.animateToCenter(0, 0, overviewZoom(w, window.innerWidth, window.innerHeight), 1300),
          ),
          registerSpaceCommand('focusCurrent', () => {
            const sid = audioPlayer.getState().song?.id ?? -1;
            if (sid >= 0 && sid < w.cards.length) controller.animateToCenter(w.px[sid]!, w.py[sid]!, 1);
          }),
        ]
      : [];

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
      stageMode: (m: StageMode) => setSpaceLab({ mode: m }),
      space: () => {
        const c = controllerRef.current;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return {
          mode: getSpaceLab().mode,
          zoom: c?.zoom ?? 1,
          center: c ? { x: c.pan.x + vw / (2 * c.zoom), y: c.pan.y + vh / (2 * c.zoom) } : null,
          radius: w?.radius ?? 0,
          clusters: w?.clusters.length ?? 0,
        };
      },
    };

    return () => {
      offCommands.forEach((off) => off());
      controller.dispose();
      controllerRef.current = null;
      window.__nebula = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, handleFrame, songs.length, applySearch, world]);

  // 播放器失败事件 → 卡片置灰
  useEffect(
    () =>
      audioPlayer.subscribe(() => {
        const s = audioPlayer.getState();
        if (s.failed && s.song && lastFailedSongRef.current !== s.song.id) {
          lastFailedSongRef.current = s.song.id;
          setFailedIds((prev) => (prev.has(s.song!.id) ? prev : new Set(prev).add(s.song!.id)));
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

  // 交接进行中每帧刷新一次卡片位置（「散开」「退潮」会移动卡片；切走时再刷新一次把卡片放回原位）
  useEffect(
    () =>
      onListenFrame(() => {
        if (listenBus.style === 'part' || listenBus.style === 'ebb' || partActiveRef.current) controllerRef.current?.refresh();
      }),
    [controllerRef],
  );

  // 会话记忆恢复：上次导入歌单 + 上次播放歌曲（只跑一次）
  useEffect(() => {
    try {
      const raw = localStorage.getItem('music-nebula.session');
      if (!raw) return;
      const s = JSON.parse(raw) as {
        tracks?: DesktopTrack[];
        currentId?: number;
        currentTrack?: DesktopTrack;
        resumeAfter?: number;
      };
      if (!s.tracks?.length) return;
      const restored = s.tracks.map((t, i) => toFrontendTrack(t, i));
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
    } catch {
      /* ignore */
    }
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
    if (w && controller) {
      // 有边界星云：飞回正在播放的那首；没有就回到星云中心
      if (song && song.id >= 0 && song.id < w.cards.length) controller.animateToCenter(w.px[song.id]!, w.py[song.id]!, 1);
      else controller.animateToCenter(0, 0, 0.92);
      return;
    }
    if (song && controller) {
      const card = effectiveCardsRef.current[song.id];
      if (card) {
        const z = controller.zoom;
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        controller.animateTo(panForCentering({ x: card.x, y: card.y }, vw, vh, z));
        return;
      }
    }
    controller?.reset();
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
    world,
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
    metrics,
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
