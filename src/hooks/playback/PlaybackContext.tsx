import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { audioPlayer, type AudioPlayerState } from '../../lib/audio/AudioPlayer';

/** 低频播放状态（不含 currentTime/duration/progress）。 */
export interface PlaybackState {
  song: AudioPlayerState['song'];
  playing: boolean;
  mode: AudioPlayerState['mode'];
  quality: string;
  loading: boolean;
  failed: boolean;
  error: string | null;
  qualities: AudioPlayerState['qualities'];
}

function snapshot(s: AudioPlayerState): PlaybackState {
  return {
    song: s.song,
    playing: s.playing,
    mode: s.mode,
    quality: s.quality,
    loading: s.loading,
    failed: s.failed,
    error: s.error,
    qualities: s.qualities,
  };
}

function same(a: PlaybackState, b: PlaybackState): boolean {
  return (
    a.song === b.song &&
    a.playing === b.playing &&
    a.mode === b.mode &&
    a.quality === b.quality &&
    a.loading === b.loading &&
    a.failed === b.failed &&
    a.error === b.error &&
    a.qualities === b.qualities
  );
}

const PlaybackCtx = createContext<PlaybackState>(snapshot(audioPlayer.getState()));

/** 低频播放状态订阅（docs/project/ARCHITECTURE.md §4：忽略 tick，杜绝高频重渲染）。 */
export function usePlayback(): PlaybackState {
  return useContext(PlaybackCtx);
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlaybackState>(() => snapshot(audioPlayer.getState()));
  useEffect(() => {
    const sync = () => {
      const s = snapshot(audioPlayer.getState());
      setState((prev) => (same(prev, s) ? prev : s));
    };
    const off = audioPlayer.subscribe(sync);
    // 订阅之后立刻同步一次：子组件的副作用先于这里运行（例如会话恢复里的 audioPlayer.restore），
    // 它们发出的通知在订阅之前就丢了。以前 App 因此一直以为没有当前歌，启动时把会话里的当前歌抹掉，
    // 下次启动只能从第一首开始（#106）
    sync();
    return off;
  }, []);
  return <PlaybackCtx.Provider value={state}>{children}</PlaybackCtx.Provider>;
}
