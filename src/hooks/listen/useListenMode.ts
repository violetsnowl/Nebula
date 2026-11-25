import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import { ListenDirector, type ListenConfig } from '../../lib/listenMode';

/**
 * 漫游 / 聆听交接领域（NEBULA_UI_SYSTEM §7.1）：只做接线。
 * 引擎（计时、曲线、写根元素变量）在 lib/listenMode；硬阻断条件与听音空间开关由 App 分离传入。
 */
export function useListenMode(
  rootRef: RefObject<HTMLElement>,
  config: ListenConfig,
  blocked: boolean,
  listenSpaceOpen = false,
): () => void {
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const listenSpaceRef = useRef(listenSpaceOpen);
  listenSpaceRef.current = listenSpaceOpen;
  const directorRef = useRef<ListenDirector | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const director = new ListenDirector(root, {
      isPlaying: () => audioPlayer.getState().playing,
      isBlocked: () => blockedRef.current,
      isListenSpaceOpen: () => listenSpaceRef.current,
    });
    directorRef.current = director;
    director.start();
    return () => {
      director.dispose();
      directorRef.current = null;
    };
  }, [rootRef]);

  const { enabled, delayMs, style, dimBar, pin, lyricsUnder, layout } = config;
  useEffect(() => {
    directorRef.current?.configure({ enabled, delayMs, style, dimBar, pin, lyricsUnder, layout });
  }, [enabled, delayMs, style, dimBar, pin, lyricsUnder, layout]);

  useEffect(() => {
    directorRef.current?.notify();
  }, [blocked, listenSpaceOpen]);

  // 常驻聆听的收起键（左上角）用：离开聆听
  return useCallback(() => directorRef.current?.exit(), []);
}
