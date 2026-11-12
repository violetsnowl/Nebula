import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import { ListenDirector, type ListenConfig } from '../../lib/listenMode';

/**
 * 漫游 / 聆听交接领域（NEBULA_UI_SYSTEM §7.1）：只做接线。
 * 引擎（计时、曲线、写根元素变量）在 lib/listenMode；阻断条件由 App 汇总后传入。
 */
export function useListenMode(rootRef: RefObject<HTMLElement>, config: ListenConfig, blocked: boolean): void {
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const directorRef = useRef<ListenDirector | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const director = new ListenDirector(root, {
      isPlaying: () => audioPlayer.getState().playing,
      isBlocked: () => blockedRef.current,
    });
    directorRef.current = director;
    director.start();
    return () => {
      director.dispose();
      directorRef.current = null;
    };
  }, [rootRef]);

  const { enabled, delayMs, style, dimBar, lyricsUnder, layout } = config;
  useEffect(() => {
    directorRef.current?.configure({ enabled, delayMs, style, dimBar, lyricsUnder, layout });
  }, [enabled, delayMs, style, dimBar, lyricsUnder, layout]);
}
