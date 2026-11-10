import { useCallback, useEffect, useState } from 'react';
import { applyGlassTheme, loadGlassTheme, saveGlassTheme, type GlassTheme } from '../../lib/glass';

function loadUiBool(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/**
 * 界面设置领域（docs/project/ARCHITECTURE.md §2）：
 * 沉浸开关（隐藏卡片 / 隐藏歌词层）+ 材质主题（液态 / 磨砂，NEBULA_UI_SYSTEM §3.2）+ 持久化。
 */
export function useInterfaceSettings() {
  const [uiHideCards, setUiHideCards] = useState<boolean>(() => loadUiBool('music-nebula.ui-hide-cards'));
  const [uiHideLyrics, setUiHideLyrics] = useState<boolean>(() => loadUiBool('music-nebula.ui-hide-lyrics'));
  const [glassTheme, setGlassThemeState] = useState<GlassTheme>(loadGlassTheme);

  // 材质主题：写根节点档位变量并更新所有折射滤镜（只写材质变量，不碰其他领域）
  useEffect(() => {
    applyGlassTheme(glassTheme);
  }, [glassTheme]);

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

  return { uiHideCards, uiHideLyrics, toggleHideCards, toggleHideLyrics, glassTheme, setGlassTheme };
}
