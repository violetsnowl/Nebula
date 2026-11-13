import { useCallback, useEffect, useState } from 'react';
import { applyGlassTheme, loadGlassTheme, saveGlassTheme, type GlassTheme } from '../../lib/glass';
import { MAX_PERF_LEVEL, applyPerfLevel, startFrameMonitor, type PerfLevel } from '../../lib/perf';

function loadUiBool(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/**
 * 界面设置领域（docs/project/ARCHITECTURE.md §2）：
 * 沉浸开关（隐藏卡片 / 隐藏歌词层）+ 材质主题（液态 / 磨砂，NEBULA_UI_SYSTEM §3.2）
 * + 性能降级（§3.7：「性能优先」开关 + 帧监测自动逐级降级）+ 持久化。
 */
export function useInterfaceSettings() {
  const [uiHideCards, setUiHideCards] = useState<boolean>(() => loadUiBool('music-nebula.ui-hide-cards'));
  const [uiHideLyrics, setUiHideLyrics] = useState<boolean>(() => loadUiBool('music-nebula.ui-hide-lyrics'));
  const [glassTheme, setGlassThemeState] = useState<GlassTheme>(loadGlassTheme);
  const [perfPriority, setPerfPriorityState] = useState<boolean>(() => loadUiBool('music-nebula.perf-priority'));
  /** 帧监测自动降到的档位（本次运行内只降不升）。 */
  const [perfAutoLevel, setPerfAutoLevel] = useState<PerfLevel>(0);

  // 材质主题：写根节点档位变量并更新所有折射滤镜（只写材质变量，不碰其他领域）
  useEffect(() => {
    applyGlassTheme(glassTheme);
  }, [glassTheme]);

  // 性能降级（§3.7）：「性能优先」直接到最低档；否则按帧监测结果逐级降。主题切换后也要重新套用档位
  useEffect(() => {
    applyPerfLevel(perfPriority ? MAX_PERF_LEVEL : perfAutoLevel);
  }, [perfPriority, perfAutoLevel, glassTheme]);

  useEffect(() => {
    if (perfPriority || perfAutoLevel >= MAX_PERF_LEVEL) return;
    return startFrameMonitor(() => setPerfAutoLevel((l) => Math.min(MAX_PERF_LEVEL, l + 1) as PerfLevel));
  }, [perfPriority, perfAutoLevel]);

  const setPerfPriority = useCallback((on: boolean) => {
    try {
      localStorage.setItem('music-nebula.perf-priority', on ? '1' : '0');
    } catch {
      /* ignore */
    }
    setPerfPriorityState(on);
  }, []);

  const setGlassTheme = useCallback((theme: GlassTheme) => {
    saveGlassTheme(theme);
    setGlassThemeState(theme);
  }, []);

  const toggleHideCards = useCallback(() => {
    setUiHideCards((v) => {
      const next = !v;
      try {
        localStorage.setItem('music-nebula.ui-hide-cards', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleHideLyrics = useCallback(() => {
    setUiHideLyrics((v) => {
      const next = !v;
      try {
        localStorage.setItem('music-nebula.ui-hide-lyrics', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return {
    uiHideCards,
    uiHideLyrics,
    toggleHideCards,
    toggleHideLyrics,
    glassTheme,
    setGlassTheme,
    perfPriority,
    setPerfPriority,
    perfAutoLevel,
  };
}
