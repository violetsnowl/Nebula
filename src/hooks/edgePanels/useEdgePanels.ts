import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export type EdgeKey = 'top' | 'right' | 'left';

/** 边缘热点宽度。 */
const EDGE_HOTSPOT = 16;
/** 移出面板后的收起延迟（防抖）。左右侧按样张 F 用 600ms，顶部沿用 300ms。 */
const EDGE_HIDE_DELAY = 300;
const SIDE_HIDE_DELAY = 600;
/** 提示光痕变亮的距离（NEBULA_UI_SYSTEM §9.2，样张 F）。 */
const SEAM_NEAR = 120;

interface UseEdgePanelsOptions {
  /** 右键菜单打开时暂停边缘隐藏（useOverlays.contextMenuRef）。 */
  contextMenuRef: RefObject<{ x: number; y: number; track: unknown } | null>;
}

/**
 * 边缘面板领域（docs/project/ARCHITECTURE.md §2）：
 * 顶部/右侧/左侧面板的显示状态、热点触发、移出防抖。
 * 只接收组合层传入的 ref，不依赖其他 hook。
 */
export function useEdgePanels({ contextMenuRef }: UseEdgePanelsOptions) {
  const [edge, setEdge] = useState<Record<EdgeKey, boolean>>({ top: false, right: false, left: false });
  const edgeHoverRef = useRef<Record<EdgeKey, boolean>>({ top: false, right: false, left: false });
  const edgeTimerRef = useRef<Record<EdgeKey, number>>({ top: 0, right: 0, left: 0 });
  /** 钉住：侧面板点开后常驻，鼠标离开也不收起（样张 F：点外面 / Esc / 再点小球才关）。 */
  const pinnedRef = useRef<Record<EdgeKey, boolean>>({ top: false, right: false, left: false });
  /** 鼠标是否靠近左右边缘（提示光痕变亮）。 */
  const [near, setNear] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  /**
   * 指针最近一次的位置（视口坐标；指针离开窗口后为 null）。
   * 小球滑入时会从静止的指针下面划过，触发一次多余的 pointerenter / pointerleave 并排上收起计时，
   * 之后指针不动就没有 pointermove 来取消它；所以计时到点时要再核对指针是不是还停在热区 / 小球上。
   */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const pointerStillIn = useCallback((k: EdgeKey): boolean => {
    const p = pointerRef.current;
    if (!p) return false;
    if (k === 'top') return p.y <= EDGE_HOTSPOT;
    if (k === 'right' ? p.x >= window.innerWidth - EDGE_HOTSPOT : p.x <= EDGE_HOTSPOT) return true;
    // 热区外：指针若还压在这一侧的小球 / 面板上，也不收（未浮出的小球 pointer-events:none，不会命中）
    const el = document.elementFromPoint(p.x, p.y);
    return !!el?.closest(k === 'left' ? '.side-dock.sd-left' : '.side-dock.sd-right');
  }, []);

  const showPanel = useCallback((k: EdgeKey) => {
    if (edgeTimerRef.current[k]) {
      window.clearTimeout(edgeTimerRef.current[k]);
      edgeTimerRef.current[k] = 0;
    }
    setEdge((prev) => (prev[k] ? prev : { ...prev, [k]: true }));
  }, []);

  const scheduleHidePanel = useCallback(
    (k: EdgeKey) => {
      if (contextMenuRef.current) return;
      // 搜索框聚焦期间不收回顶部面板（输入法弹出/打字）
      if (k === 'top') {
        const active = document.activeElement as HTMLElement | null;
        if (active?.closest?.('.topbar')) return;
      }
      if (pinnedRef.current[k] || edgeHoverRef.current[k] || edgeTimerRef.current[k]) return;
      edgeTimerRef.current[k] = window.setTimeout(() => {
        edgeTimerRef.current[k] = 0;
        if (pinnedRef.current[k]) return;
        if (pointerStillIn(k)) return;
        setEdge((prev) => (prev[k] ? { ...prev, [k]: false } : prev));
      }, k === 'top' ? EDGE_HIDE_DELAY : SIDE_HIDE_DELAY);
    },
    [contextMenuRef, pointerStillIn],
  );

  const enterPanel = useCallback(
    (k: EdgeKey) => {
      edgeHoverRef.current[k] = true;
      showPanel(k);
    },
    [showPanel],
  );

  const leavePanel = useCallback(
    (k: EdgeKey) => {
      edgeHoverRef.current[k] = false;
      scheduleHidePanel(k);
    },
    [scheduleHidePanel],
  );

  // 热点触发 + 移出防抖（全局 pointermove）
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      // 先记位置（在小球 / 面板上的移动也要记，收起计时到点时据此核对）
      pointerRef.current = { x: e.clientX, y: e.clientY };
      if (contextMenuRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('.edge-panel') || t?.closest('.dock') || t?.closest('.side-dock')) return;
      const x = e.clientX;
      const y = e.clientY;
      const nl = x <= SEAM_NEAR;
      const nr = x >= window.innerWidth - SEAM_NEAR;
      setNear((prev) => (prev.left === nl && prev.right === nr ? prev : { left: nl, right: nr }));
      if (y <= EDGE_HOTSPOT) showPanel('top');
      else scheduleHidePanel('top');
      if (x >= window.innerWidth - EDGE_HOTSPOT) showPanel('right');
      else scheduleHidePanel('right');
      if (x <= EDGE_HOTSPOT) showPanel('left');
      else scheduleHidePanel('left');
    };
    // 指针离开窗口：之后不会再有 pointermove，位置作废并按原规则收起（否则从 x=0 甩出窗口会一直停着）
    const onLeaveWindow = () => {
      pointerRef.current = null;
      (['top', 'right', 'left'] as const).forEach((k) => scheduleHidePanel(k));
    };
    document.addEventListener('pointermove', onMove);
    document.documentElement.addEventListener('pointerleave', onLeaveWindow);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeaveWindow);
    };
  }, [showPanel, scheduleHidePanel, contextMenuRef]);

  /** 侧面板开 / 关时调用：打开 = 钉住并保持显示；关闭 = 解除钉住，鼠标不在上面就按延迟收起。 */
  const setPinned = useCallback(
    (k: EdgeKey, on: boolean) => {
      pinnedRef.current[k] = on;
      if (on) showPanel(k);
      else scheduleHidePanel(k);
    },
    [showPanel, scheduleHidePanel],
  );
  const pinLeft = useCallback((on: boolean) => setPinned('left', on), [setPinned]);
  const pinRight = useCallback((on: boolean) => setPinned('right', on), [setPinned]);

  const enterTop = useCallback(() => enterPanel('top'), [enterPanel]);
  const leaveTop = useCallback(() => leavePanel('top'), [leavePanel]);
  const enterRight = useCallback(() => enterPanel('right'), [enterPanel]);
  const leaveRight = useCallback(() => leavePanel('right'), [leavePanel]);
  const enterLeft = useCallback(() => enterPanel('left'), [enterPanel]);
  const leaveLeft = useCallback(() => leavePanel('left'), [leavePanel]);

  return { edge, near, showPanel, enterTop, leaveTop, enterRight, leaveRight, enterLeft, leaveLeft, pinLeft, pinRight };
}
