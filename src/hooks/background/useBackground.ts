import { useCallback, useEffect, useState } from 'react';
import { loadBackground, saveBackground, type BackgroundSetting } from '../../lib/backgrounds';
import type { CoverBgMode } from '../../lib/backgrounds';
import { DEFAULT_AMBIENT, PRESET_AMBIENT, applyAmbient, sampleMedia } from '../../lib/bgSampler';
import {
  SILVER_BLUE,
  paletteFromSample,
  sampleCover,
  sampleMediaElement,
  type CoverSample,
  type LyricPalette,
} from '../../lib/coverColors';
import { hasDesktopAPI } from '../../lib/playlist/ipcClient';
import type { DesktopWallpaperSetResult } from '../../lib/playlist/ipcClient';
import type { VisualAtmosphere } from '../../lib/atmosphere';
import { NEUTRAL_ENV, applyEnvironment, environmentFromUrl, extractEnvironment, type EnvPalette } from '../../lib/environment';

const COVER_MODE_KEY = 'music-nebula.bg-cover-mode.v2';

interface UseBackgroundOptions {
  /** 主窗口才订阅壁纸应用事件（wallpaper view 关闭）。 */
  enabled: boolean;
  /** 壁纸应用后回调（App 组合层关闭壁纸窗口）。 */
  onApplied: () => void;
  /** 封面变化 key（由 App 传入播放器当前封面，仅用于重采样触发）。 */
  coverKey: string;
}

/**
 * 背景/氛围领域（docs/project/ARCHITECTURE.md §2）：
 * 拥有 bgSetting / bgCoverMode，产出 VisualAtmosphere；
 * 只写自己的环境光 CSS 变量，**不直接修改歌词/玻璃**（歌词配色经中间层由消费端推导）。
 */
export function useBackground({ enabled, onApplied, coverKey }: UseBackgroundOptions) {
  const [bgSetting, setBgSetting] = useState<BackgroundSetting>(() => loadBackground());
  const [bgCoverMode, setBgCoverMode] = useState<CoverBgMode>(() => {
    // v2：全局 UI 重构后默认「环境光」（NEBULA_UI_SYSTEM §4.3）。只剩环境光和雾中封面两种，已删除的旧模式迁移到环境光。
    let m: string | null = null;
    try {
      m = typeof localStorage !== 'undefined' ? localStorage.getItem(COVER_MODE_KEY) : null;
    } catch {
      m = null;
    }
    return m === 'blend' ? 'blend' : 'nebula';
  });
  const [atmosphere, setAtmosphere] = useState<VisualAtmosphere>({ palette: null, sample: null });

  const handleSelectBg = useCallback((s: BackgroundSetting) => {
    setBgSetting(s);
    saveBackground(s);
  }, []);

  const handleCoverMode = useCallback((m: CoverBgMode) => {
    setBgCoverMode(m);
    try {
      localStorage.setItem(COVER_MODE_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  const applyWallpaperResult = useCallback((result: DesktopWallpaperSetResult) => {
    if ('url' in result && 'type' in result) {
      setBgSetting({ type: result.type, url: result.url });
    }
  }, []);

  const handleBgFile = useCallback((file: File) => {
    if (file.type.startsWith('video/')) {
      setBgSetting({ type: 'video', url: URL.createObjectURL(file) });
      return;
    }
    if (file.size <= 2.5 * 1024 * 1024) {
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        setBgSetting({ type: 'image', url });
        saveBackground({ type: 'image', url });
      };
      reader.readAsDataURL(file);
    } else {
      setBgSetting({ type: 'image', url: URL.createObjectURL(file) });
    }
  }, []);

  // 壁纸子窗口应用结果订阅
  useEffect(() => {
    if (!enabled || !hasDesktopAPI()) return;
    const off = window.nebulaAPI!.onWallpaperApplied((data) => {
      if ('url' in data) {
        setBgSetting({ type: data.type, url: data.url });
        onApplied();
      }
    });
    return off;
  }, [enabled, onApplied]);

  // 环境光和雾中封面都以环境光为底（雾中封面只是在环境光里多一层封面残影）
  const envMode = bgSetting.type === 'cover';

  // 环境光取色（NEBULA_UI_SYSTEM §4）：所有背景模式都产出 --acc 等变量（进度条、当前项等要用），
  // 「环境光」模式下背景层直接由这些变量绘制，并顺带写旧的 ambient 变量（--glow-rgb / 歌词明暗）。
  useEffect(() => {
    let cancelled = false;
    const apply = (env: EnvPalette) => {
      if (cancelled) return;
      applyEnvironment(env, envMode);
      // 环境光模式下背景始终是深色空间：歌词明暗按渲染出来的环境亮度判断，不被白色封面误导
      if (envMode) applyAmbient({ luma: env.bgLum, sat: env.sat, hue: env.hue });
    };
    if (bgSetting.type === 'video') {
      const media = document.querySelector<HTMLVideoElement>('video.bg-media');
      if (!media) {
        apply(NEUTRAL_ENV);
        return;
      }
      const sample = () => apply(extractEnvironment(media) ?? NEUTRAL_ENV);
      if (media.readyState >= 2) sample();
      media.addEventListener('loadeddata', sample);
      return () => {
        cancelled = true;
        media.removeEventListener('loadeddata', sample);
      };
    }
    const src = bgSetting.type === 'cover' ? coverKey : bgSetting.type === 'image' ? bgSetting.url : '';
    if (!src) {
      apply(NEUTRAL_ENV);
    } else {
      environmentFromUrl(src).then((env) => apply(env ?? NEUTRAL_ENV));
    }
    return () => {
      cancelled = true;
    };
  }, [bgSetting, coverKey, envMode]);

  // 环境光：背景自有输出（--glow-rgb 等 CSS 变量）；「环境光」模式由上面的取色统一写入
  useEffect(() => {
    if (envMode) return;
    if (bgSetting.type === 'preset') {
      applyAmbient(PRESET_AMBIENT[bgSetting.id] ?? DEFAULT_AMBIENT);
      return;
    }
    const media = document.querySelector<HTMLImageElement | HTMLVideoElement>('.bg-media');
    if (!media) {
      applyAmbient(DEFAULT_AMBIENT);
      return;
    }
    const trySample = () => {
      const s = sampleMedia(media);
      if (s) applyAmbient(s);
    };
    const onLoad = () => trySample();
    media.addEventListener('load', onLoad);
    if ((media as HTMLImageElement).complete || (media as HTMLVideoElement).readyState >= 1) trySample();
    let iv = 0;
    if (media.tagName === 'VIDEO') iv = window.setInterval(trySample, 3000);
    return () => {
      media.removeEventListener('load', onLoad);
      if (iv) window.clearInterval(iv);
    };
  }, [bgSetting, coverKey, envMode]);

  // 歌词色板采样：只产出 atmosphere 数据，不写任何歌词 CSS 变量
  useEffect(() => {
    let cancelled = false;
    const done = (palette: LyricPalette, sample: CoverSample | null) => {
      if (!cancelled) setAtmosphere({ palette, sample });
    };
    const media = document.querySelector<HTMLImageElement | HTMLVideoElement>('.bg-media');
    const trySample = (): void => {
      if (cancelled) return;
      if (
        media &&
        (media instanceof HTMLImageElement
          ? media.complete && media.naturalWidth > 0
          : media.readyState >= 1)
      ) {
        sampleMediaElement(media)
          .then((s) => done(s ? paletteFromSample(s) : SILVER_BLUE, s))
          .catch(() => done(SILVER_BLUE, null));
      } else {
        done(SILVER_BLUE, null);
      }
    };
    if (!media) {
      const src = coverKey;
      if (!src) {
        done(SILVER_BLUE, null);
      } else {
        sampleCover(src)
          .then((s) => done(s ? paletteFromSample(s) : SILVER_BLUE, s))
          .catch(() => done(SILVER_BLUE, null));
      }
    } else {
      trySample();
      media.addEventListener('load', trySample);
      media.addEventListener('loadeddata', trySample);
      return () => {
        cancelled = true;
        media.removeEventListener('load', trySample);
        media.removeEventListener('loadeddata', trySample);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [bgSetting, coverKey]);

  return { bgSetting, bgCoverMode, atmosphere, handleSelectBg, handleCoverMode, applyWallpaperResult, handleBgFile };
}
