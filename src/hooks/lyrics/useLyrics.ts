import { useCallback, useEffect, useRef, useState } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import { hasDesktopAPI, streamTrack } from '../../lib/playlist/ipcClient';
import { alignWordsToText, filterCreditLines, mergeWordLyrics, type LyricLineUI } from '../../lib/lyrics';
import type { ListenSettingsPatch, LyricVisualSettings } from '../../lib/lyricSettings';
import type { Track } from '../../lib/catalog';

/** 开发调试：当前歌曲歌词来源信息。 */
export interface LyricDebugInfo {
  source: string;
  hasYrc: boolean;
  hasQrc: boolean;
  totalLines: number;
  wordLines: number;
}

/** 后端歌词结果（unknown）防御性归一化。 */
function normalizeLyricLines(data: unknown, title?: string, artist?: string): LyricLineUI[] {
  if (!data || typeof data !== 'object') return [];
  const lines = (data as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return [];
  const out: LyricLineUI[] = [];
  for (const raw of lines) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { timeMs?: unknown; text?: unknown; translation?: unknown };
    if (typeof r.timeMs !== 'number' || typeof r.text !== 'string') continue;
    out.push({
      timeMs: r.timeMs,
      text: r.text,
      translation: typeof r.translation === 'string' && r.translation ? r.translation : undefined,
    });
  }
  // 逐字歌词：yrc 优先，QQ 的 qrc 直接映射进 yrc 统一解析
  const src = data as { yrc?: unknown; qrc?: unknown };
  const yrc = typeof src.yrc === 'string' ? src.yrc : '';
  const qrc = typeof src.qrc === 'string' ? src.qrc : '';
  return filterCreditLines(alignWordsToText(mergeWordLyrics(out, yrc || qrc)), title, artist);
}

const DEFAULT_LYRIC_FONT_SIZE = 44;
const LEGACY_LYRIC_FONT_SIZE = 24;

function loadLyricSettings(): LyricVisualSettings {
  const maxFont = Math.max(28, Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) / 4));
  // 衬线 Display 歌词（NEBULA_UI_SYSTEM §7）默认 44px；旧默认 24 视为"从没调过"，自动迁移到新默认，用户自己调过的值保留
  let fontSize = DEFAULT_LYRIC_FONT_SIZE;
  let layerMode: LyricVisualSettings['layerMode'] = 'under';
  let currentScale = 1.22;
  let lyricLayout: LyricVisualSettings['lyricLayout'] = 'stacked';
  let lyricColorSource: LyricVisualSettings['lyricColorSource'] = 'cover';
  let customColor = '#3aa0ff';
  let bold = false;
  // 漫游 / 聆听交接（NEBULA_UI_SYSTEM §7.1）：默认打开、6 秒、沉降、播放条跟着变淡
  let listenHandoff = true;
  let listenDelay = 6;
  let listenStyle: LyricVisualSettings['listenStyle'] = 'sink';
  let listenDimBar = true;
  let roamLyrics: LyricVisualSettings['roamLyrics'] = 'ambient';
  try {
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem('music-nebula.lyric-settings') : null;
    if (s) {
      const p = JSON.parse(s) as Partial<LyricVisualSettings>;
      if (typeof p.fontSize === 'number' && p.fontSize >= 14 && p.fontSize <= maxFont && p.fontSize !== LEGACY_LYRIC_FONT_SIZE) {
        fontSize = p.fontSize;
      }
      if (p.layerMode === 'under' || p.layerMode === 'over') layerMode = p.layerMode;
      if (typeof p.currentScale === 'number' && p.currentScale >= 1 && p.currentScale <= 1.6) currentScale = p.currentScale;
      if (p.lyricLayout === 'stacked' || p.lyricLayout === 'offset') lyricLayout = p.lyricLayout;
      if (p.lyricColorSource === 'cover' || p.lyricColorSource === 'custom') lyricColorSource = p.lyricColorSource;
      if (typeof p.customColor === 'string' && /^#?[0-9a-f]{6}$/i.test(p.customColor)) customColor = p.customColor;
      if (p.bold === true) bold = true;
      if (typeof p.listenHandoff === 'boolean') listenHandoff = p.listenHandoff;
      if (p.listenDelay === 3 || p.listenDelay === 6 || p.listenDelay === 10) listenDelay = p.listenDelay;
      if (p.listenStyle === 'sink' || p.listenStyle === 'part' || p.listenStyle === 'ebb') listenStyle = p.listenStyle;
      if (typeof p.listenDimBar === 'boolean') listenDimBar = p.listenDimBar;
      if (p.roamLyrics === 'ambient' || p.roamLyrics === 'caption' || p.roamLyrics === 'both') roamLyrics = p.roamLyrics;
    }
  } catch {
    /* 用默认值 */
  }
  return {
    fontSize,
    layerMode,
    currentScale,
    lyricLayout,
    lyricColorSource,
    customColor,
    bold,
    listenHandoff,
    listenDelay,
    listenStyle,
    listenDimBar,
    roamLyrics,
  };
}

/**
 * 歌词领域（docs/project/ARCHITECTURE.md §2）：
 * 运行态（lyricLines 拉取/归一化，随切歌）+ 设置（lyricSettings 持久化）+ 翻译开关。
 * 只依赖 service（audioPlayer / IPC / lib/lyrics），不依赖其他 hook。
 */
export function useLyrics() {
  const [lyricLines, setLyricLines] = useState<LyricLineUI[]>([]);
  const [lyricSettings, setLyricSettings] = useState<LyricVisualSettings>(loadLyricSettings);
  const [lyricTranslationEnabled, setLyricTranslationEnabled] = useState(
    () => typeof localStorage === 'undefined' || localStorage.getItem('music-nebula.lyric-translate') !== '0',
  );
  const [lyricDebugInfo, setLyricDebugInfo] = useState<LyricDebugInfo | null>(null);

  // 随切歌拉取歌词：低频订阅（仅歌曲身份变化时触发）
  const songRef = useRef<string>('');
  // 请求序号：快速切歌时，上一首慢返回的歌词不能覆盖当前歌，只接受最新一次请求的结果
  const loadSeqRef = useRef(0);
  useEffect(() => {
    let requestId='';
    const cancel=()=>{if(requestId)void window.nebulaAPI?.cancelResolve?.(requestId).catch(()=>{});requestId='';};
    const load = async (song: Track | null) => {
      cancel();
      const seq = ++loadSeqRef.current;
      setLyricLines([]);setLyricDebugInfo(null);
      if (!song) {
        setLyricLines([]);
        setLyricDebugInfo(null);
        return;
      }
      if (!hasDesktopAPI() || !song.sourceId) {
        setLyricLines([]);
        setLyricDebugInfo(null);
        return;
      }
      try {
        requestId=`lyric-${seq}-${Date.now()}`;
        const res = await window.nebulaAPI!.fetchLyric(streamTrack(song),{requestId});
        if (seq !== loadSeqRef.current) return;
        const data = res.ok ? res.data : null;
        const lines = normalizeLyricLines(data, song.title, song.artist);
        setLyricLines(lines);
        if (data && typeof data === 'object') {
          const src = data as { source?: unknown; yrc?: unknown; qrc?: unknown };
          setLyricDebugInfo({
            source: typeof src.source === 'string' ? src.source : 'unknown',
            hasYrc: typeof src.yrc === 'string' && src.yrc.length > 0,
            hasQrc: typeof src.qrc === 'string' && src.qrc.length > 0,
            totalLines: lines.length,
            wordLines: lines.filter((l) => !!l.words?.length).length,
          });
        } else {
          setLyricDebugInfo(null);
        }
      } catch {
        if (seq !== loadSeqRef.current) return;
        setLyricLines([]);
        setLyricDebugInfo(null);
      }
    };
    const check = () => {
      const s = audioPlayer.getState().song;
      const key=s?`${s.source}:${s.sourceId}:${s.via?.platform || ''}:${s.via?.sourceId || ''}`:'';
      if (key !== songRef.current) {
        songRef.current = key;
        void load(s);
      }
    };
    check();
    const unsubscribe=audioPlayer.subscribe(check);
    return ()=>{loadSeqRef.current++;songRef.current='';cancel();unsubscribe();};
  }, []);

  const persistLyricSettings = useCallback((next: LyricVisualSettings) => {
    setLyricSettings(next);
    try {
      localStorage.setItem('music-nebula.lyric-settings', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const patchSettings = useCallback(
    (patch: Partial<LyricVisualSettings>) => persistLyricSettings({ ...lyricSettings, ...patch }),
    [lyricSettings, persistLyricSettings],
  );

  const handleLyricFontSize = useCallback((n: number) => patchSettings({ fontSize: n }), [patchSettings]);
  const handleLayerMode = useCallback(
    (m: LyricVisualSettings['layerMode']) => patchSettings({ layerMode: m }),
    [patchSettings],
  );
  const handleCurrentScale = useCallback((n: number) => patchSettings({ currentScale: n }), [patchSettings]);
  const handleLyricLayout = useCallback(
    (m: LyricVisualSettings['lyricLayout']) => patchSettings({ lyricLayout: m }),
    [patchSettings],
  );
  const handleLyricColorSource = useCallback(
    (s: LyricVisualSettings['lyricColorSource']) => patchSettings({ lyricColorSource: s }),
    [patchSettings],
  );
  const handleCustomColor = useCallback((c: string) => patchSettings({ customColor: c }), [patchSettings]);
  const handleLyricBold = useCallback((b: boolean) => patchSettings({ bold: b }), [patchSettings]);
  const handleListenSettings = useCallback((patch: ListenSettingsPatch) => patchSettings(patch), [patchSettings]);

  const toggleTranslation = useCallback(() => {
    setLyricTranslationEnabled((v) => {
      const next = !v;
      try {
        localStorage.setItem('music-nebula.lyric-translate', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return {
    lyricLines,
    lyricDebugInfo,
    lyricSettings,
    lyricTranslationEnabled,
    handleLyricFontSize,
    handleLayerMode,
    handleCurrentScale,
    handleLyricLayout,
    handleLyricColorSource,
    handleCustomColor,
    handleLyricBold,
    handleListenSettings,
    toggleTranslation,
  };
}
