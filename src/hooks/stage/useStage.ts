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
import { buildSpatialIndex, queryVisibleIds } from '../../lib/spatial';
import { CULL_BUFFER, type FrameBus } from '../../lib/stage';
import { initGlassGlow, registerProximity, unregisterProximity } from '../../lib/glassGlow';
import type { Track } from '../../lib/catalog';
import { mulberry32 } from '../../lib/rng';
import { buildClusterPositions, matchSongs, panForCentering, type SearchMatch } from '../../lib/search';
import { PanController } from '../../lib/panEngine';
import { listenBus, onListenFrame, partOffset } from '../../lib/listenMode';
import type { PanFrame } from '../../lib/panEngine';
import { hasDesktopAPI, toBackendTrack, toFrontendTrack } from '../../lib/playlist/ipcClient';
import type { DesktopTrack } from '../../lib/playlist/ipcClient';
import { libraryService } from '../../lib/library';
import { preferredQuality } from '../../lib/preferences';
import type { ImportStatus } from '../../lib/playlistTypes';

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

  // 派生布局（与 useSearchCluster 共用：渲染时写 refs，回调运行时读）
  const cards = useMemo(() => generateCards(mulberry32(SEED), songs), [songs]);
  const metrics = useMemo(() => computeTileSize(songs.length), [songs.length]);
  metricsRef.current = metrics;
  const clusterPositions = useMemo(
    () =>
      buildClusterPositions(
        cards,
        searchMatches.map((m) => m.index),
        metrics,
      ),
    [cards, searchMatches, metrics],
  );
  const effectiveCards = useMemo(
    () =>
      clusterPositions.size
        ? cards.map((c, i) => {
            const p = clusterPositions.get(i);
            return p ? { ...c, x: p.x, y: p.y } : c;
          })
        : cards,
    [cards, clusterPositions],
  );
  effectiveCardsRef.current = effectiveCards;
  const spatial = useMemo(() => buildSpatialIndex(effectiveCards, metrics), [effectiveCards, metrics]);
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

  const handleFrame = useCallback((frame: PanFrame) => {
    panRef.current = { x: frame.x, y: frame.y };
    frameBusRef.current.x = frame.x;
    frameBusRef.current.y = frame.y;
    frameBusRef.current.zoom = frame.zoom;
    frameBusRef.current.vw = frame.vw;
    frameBusRef.current.vh = frame.vh;
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
    partActiveRef.current = partK > 0;

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
      el.style.setProperty('--meta-a', String(fisheyeMetaAlpha(dist, maxDist)));
      el.style.zIndex = String(fisheyeZIndex(dist, maxDist));
    }
  }, []);

  // PanController 生命周期 + __nebula 调试口
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const controller = new PanController(stage, {
      tileWidth: metrics.tileWidth,
      tileHeight: metrics.tileHeight,
      initialX: (metrics.tileWidth - window.innerWidth) / 2,
      initialY: (metrics.tileHeight - window.innerHeight) / 2,
      onFrame: handleFrame,
      onPanStart: () => setHoveredId(null),
    });
    controllerRef.current = controller;
    controller.start();

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
    };

    return () => {
      controller.dispose();
      controllerRef.current = null;
      window.__nebula = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, handleFrame, songs.length, applySearch]);

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

  // 交接进行中每帧刷新一次卡片位置（只有「散开」会移动卡片；切走「散开」时再刷新一次把卡片放回原位）
  useEffect(
    () =>
      onListenFrame(() => {
        if (listenBus.style === 'part' || partActiveRef.current) controllerRef.current?.refresh();
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
        };
      }
    }
    audioPlayer.playSong(target, songsRef.current);
  }, []);

  /** 回到中心：当前歌曲卡片居中，无则重置视角。 */
  const handleReset = useCallback(() => {
    setHoveredId(null);
    const controller = controllerRef.current;
    const song = audioPlayer.getState().song;
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
