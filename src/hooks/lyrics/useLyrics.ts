import { useCallback, useEffect, useRef, useState } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import { hasDesktopAPI, streamTrack, toBackendTrack } from '../../lib/playlist/ipcClient';
import { normalizeLyricLines, type LyricLineUI } from '../../lib/lyrics';
import type { ListenSettingsPatch, LyricVisualSettings } from '../../lib/lyricSettings';
import type { Track } from '../../lib/catalog';
import { LYRIC_RELOAD_EVENT, type LyricProvenanceItem } from '../../lib/lyricVersions';

/** 开发调试：当前歌曲歌词来源信息。 */
export interface LyricDebugInfo {
  source: string;
  hasYrc: boolean;
  hasQrc: boolean;
  totalLines: number;
  wordLines: number;
  /** 合并来源链（后端 provenance，按合并顺序）：第一项是正文，其余是补全过的平台（gain = 补了什么）；手动选的正文 kind 是 manual。 */
  provenance?: LyricProvenanceItem[];
  /** 用户设的时间微调（毫秒，正数 = 推后）；没设为 0。 */
  offsetMs: number;
}

/** 歌曲身份（含兜底供流那首）：同一首换了供流平台要重新取歌词。 */
const lyricKey = (s: Track) => `${s.source}:${s.sourceId}:${s.via?.platform || ''}:${s.via?.sourceId || ''}`;
/** 通常在本平台直接出声的平台：下一首还没解析音源时，也能先按它自己取歌词（其余平台要等解析出实际供流那首）。 */
const NATIVE_STREAM = new Set(['netease', 'qq', 'kugou', 'kuwo', 'bodian']);

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
  let listenPin = false;
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
      if (typeof p.listenPin === 'boolean') listenPin = p.listenPin;
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
    listenPin,
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
  const [lyricLoading, setLyricLoading] = useState(false);
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
    // 预取下一首的歌词（#198）：后端取完进缓存，切过去时直接命中。不带 requestId，切歌不取消它。两个时机：
    // 1) 当前这首歌词出来 8 秒后，下一首通常在本平台出声（或已经知道供流那首）就先取——手动切下一首也能用上；
    // 2) 临近结尾播放器解析好下一首音源时，按实际供流那首再取——兜底播放的歌这时才知道是哪首。同一首只取一次。
    const warmed=new Set<string>();
    let warmTimer:ReturnType<typeof setTimeout>|undefined;
    let loadDelayTimer:ReturnType<typeof setTimeout>|undefined;
    const warmUp=(next:Track|undefined)=>{
      if(!next?.sourceId || !hasDesktopAPI())return;
      const key=lyricKey(next);
      if(key===songRef.current || warmed.has(key))return;
      warmed.add(key);if(warmed.size>64)warmed.delete(warmed.values().next().value!);
      void window.nebulaAPI!.fetchLyric(streamTrack(next),next.via?{origin:toBackendTrack(next)}:{}).catch(()=>{});
    };
    // keepOld：手动换歌词后重载当前这首——旧歌词留着直到新的到，不先清成空白闪一下
    const load = async (song: Track | null, keepOld = false) => {
      cancel();
      clearTimeout(warmTimer);
      clearTimeout(loadDelayTimer);
      const seq = ++loadSeqRef.current;
      if (!keepOld) {
        setLyricLines([]);
        setLyricDebugInfo(null);
        setLyricLoading(false);
      }
      if (!song) {
        setLyricLines([]);
        setLyricDebugInfo(null);
        setLyricLoading(false);
        return;
      }
      if (!hasDesktopAPI() || !song.sourceId) {
        setLyricLines([]);
        setLyricDebugInfo(null);
        setLyricLoading(false);
        return;
      }
      // 超过 250ms 还没返回才显示加载三点，缓存命中或预取秒回时不闪烁
      if (!keepOld) {
        loadDelayTimer = setTimeout(() => {
          if (seq === loadSeqRef.current) setLyricLoading(true);
        }, 250);
      }
      try {
        requestId=`lyric-${seq}-${Date.now()}`;
        // 兜底播放时再带上原曲（Spotify id / Apple 目录 id / isrc 供 AMLL、Apple 歌词查询）；缓存键仍按实际供流那首
        const res = await window.nebulaAPI!.fetchLyric(streamTrack(song),song.via?{requestId,origin:toBackendTrack(song)}:{requestId});
        if (seq !== loadSeqRef.current) return;
        clearTimeout(loadDelayTimer);
        setLyricLoading(false);
        const data = res.ok ? res.data : null;
        const lines = normalizeLyricLines(data, song.title, song.artist);
        setLyricLines(lines);
        warmTimer=setTimeout(()=>{const next=audioPlayer.peekUpcoming();if(next && (next.via || NATIVE_STREAM.has(next.source)))warmUp(next);},8000);
        if (data && typeof data === 'object') {
          const src = data as { source?: unknown; yrc?: unknown; qrc?: unknown; provenance?: unknown; lyricOffsetMs?: unknown };
          const provenance = Array.isArray(src.provenance)
            ? src.provenance
                .filter((p): p is { platform: string; kind: string; gain?: unknown } => !!p && typeof p.platform === 'string' && typeof p.kind === 'string')
                .map((p) => ({ platform: p.platform, kind: p.kind, ...(Array.isArray(p.gain) ? { gain: p.gain.filter((g): g is string => typeof g === 'string') } : {}) }))
            : undefined;
          setLyricDebugInfo({
            source: typeof src.source === 'string' ? src.source : 'unknown',
            hasYrc: typeof src.yrc === 'string' && src.yrc.length > 0,
            hasQrc: typeof src.qrc === 'string' && src.qrc.length > 0,
            totalLines: lines.length,
            wordLines: lines.filter((l) => !!l.words?.length).length,
            provenance,
            offsetMs: typeof src.lyricOffsetMs === 'number' && Number.isFinite(src.lyricOffsetMs) ? src.lyricOffsetMs : 0,
          });
        } else {
          setLyricDebugInfo(null);
        }
      } catch {
        if (seq !== loadSeqRef.current) return;
        clearTimeout(loadDelayTimer);
        setLyricLoading(false);
        setLyricLines([]);
        setLyricDebugInfo(null);
      }
    };
    const check = () => {
      const s = audioPlayer.getState().song;
      const key=s?lyricKey(s):'';
      if (key !== songRef.current) {
        songRef.current = key;
        void load(s);
      }
    };
    check();
    // 手动换歌词 / 改时间微调后（歌词版本页）：立即重载当前这首
    const reload = () => {
      const s = audioPlayer.getState().song;
      if (s) void load(s, true);
    };
    window.addEventListener(LYRIC_RELOAD_EVENT, reload);
    const unsubscribe=audioPlayer.subscribe(check);
    const unsubscribeUpcoming=audioPlayer.onUpcomingResolved(warmUp);
    return ()=>{window.removeEventListener(LYRIC_RELOAD_EVENT, reload);loadSeqRef.current++;songRef.current='';cancel();clearTimeout(warmTimer);clearTimeout(loadDelayTimer);unsubscribe();unsubscribeUpcoming();};
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
    lyricLoading,
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
