import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { buildClusterPositions, panForCentering, type SearchMatch } from '../../lib/search';
import type { PanController } from '../../lib/panEngine';
import type { CardSpec, LayoutMetrics } from '../../lib/layout';
import { getSpaceLab } from '../../lib/space/lab';
import { searchTarget, type SpaceWorld } from '../../lib/space/world';

interface UseSearchClusterOptions {
  /** 舞台控制器（App 组合层传入 stage ref）。 */
  controllerRef: RefObject<PanController | null>;
  /** 当前有效卡片布局（含搜索簇团替换）。 */
  effectiveCardsRef: RefObject<CardSpec[]>;
  /** 瓦片尺寸。 */
  metricsRef: RefObject<LayoutMetrics>;
  /** 有边界星云（#133 方向原型；现有卡片墙为 null）。 */
  worldRef: RefObject<SpaceWorld | null>;
}

/**
 * 搜索聚簇领域（docs/project/ARCHITECTURE.md §2）：
 * searchMatches 状态 + 定位/聚簇 handlers；歌曲数据来自 App 传参（songs prop），不依赖 usePlaylist。
 */
export function useSearchCluster({ controllerRef, effectiveCardsRef, metricsRef, worldRef }: UseSearchClusterOptions) {
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const searchMatchesRef = useRef(searchMatches);
  searchMatchesRef.current = searchMatches;

  /** 重排簇团 + 视角定位（供 __nebula.search 与 SearchBar 共用）。 */
  const applySearch = useCallback(
    (matches: SearchMatch[], focusIndex: number | null, preferSong = false) => {
      setSearchMatches(matches);
      const controller = controllerRef.current;
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
      // 有边界星云：卡片不挪；命中大多在同一个星团就飞到星团（缩放到装下它），否则飞到那一首
      const world = worldRef.current;
      if (world) {
        if (!controller) return;
        const t = searchTarget(world, matches.map((m) => m.index), focusIndex, preferSong, vw, vh, getSpaceLab().lens);
        if (t) controller.animateToCenter(t.cx, t.cy, t.zoom);
        return;
      }
      const cards = effectiveCardsRef.current;
      const metrics = metricsRef.current;
      if (!controller || !cards || !metrics) return;
      const cluster = buildClusterPositions(
        cards,
        matches.map((m) => m.index),
        metrics,
      );
      const focus = focusIndex != null ? cluster.get(focusIndex) ?? cards[focusIndex] : null;
      if (!focus) return;
      controller.animateTo(panForCentering({ x: focus.x, y: focus.y }, vw, vh, controller.zoom));
    },
    [controllerRef, effectiveCardsRef, metricsRef, worldRef],
  );

  const handleSearchPick = useCallback(
    (match: SearchMatch) => {
      applySearch(searchMatchesRef.current.length ? searchMatchesRef.current : [match], match.index, true);
    },
    [applySearch],
  );

  const handleSearchAll = useCallback(
    (matches: SearchMatch[]) => {
      applySearch(matches, matches[0]?.index ?? null);
    },
    [applySearch],
  );

  const handleSearchQueryChange = useCallback((matches: SearchMatch[]) => {
    setSearchMatches(matches);
  }, []);

  return { searchMatches, applySearch, handleSearchPick, handleSearchAll, handleSearchQueryChange };
}
