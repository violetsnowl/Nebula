import { useCallback, useRef, useState } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import { libraryService } from '../../lib/library';
import type { Track } from '../../lib/catalog';
import type { PlaylistMeta } from '../../lib/playlistTypes';

export type { PlaylistMeta };

/**
 * 读会话记忆（localStorage `music-nebula.session`，由 App 写入、useStage 恢复曲库）里的歌单身份。
 * 只有同时存在恢复出来的歌曲时才有意义（App 写入时已保证）；字段不全一律当作没有。
 */
function restoreSessionPlaylist(): PlaylistMeta | null {
  try {
    const raw = localStorage.getItem('music-nebula.session');
    if (!raw) return null;
    const p = (JSON.parse(raw) as { playlist?: Partial<PlaylistMeta> | null }).playlist;
    if (!p || typeof p.platform !== 'string' || typeof p.id !== 'string') return null;
    return {
      platform: p.platform,
      id: p.id,
      name: typeof p.name === 'string' ? p.name : '',
      cover: typeof p.cover === 'string' ? p.cover : '',
    };
  } catch {
    return null;
  }
}

/**
 * 歌单生命周期 / 播放队列（docs/project/ARCHITECTURE.md §2）：
 * 当前歌单身份 + 队列播放入口；歌曲数据来自 LibraryService（不持有 songs）。
 */
export function usePlaylist() {
  // 刷新后从会话记忆恢复歌单身份：列表里的「当前」标记、点它直接进详情都靠它
  const [currentPlaylist, setCurrentPlaylist] = useState<PlaylistMeta | null>(restoreSessionPlaylist);
  const songsRef = useRef<Track[]>([]);
  songsRef.current = libraryService.getState().songs;

  // null = 当前曲库不属于任何平台歌单（本地文件夹）：清掉歌单身份，免得刷新后把旧歌单标成「当前」
  const setCurrent = useCallback((meta: PlaylistMeta | null) => setCurrentPlaylist(meta), []);

  const playFromList = useCallback((index: number) => {
    const song = songsRef.current[index];
    if (song) audioPlayer.playSong(song, songsRef.current);
  }, []);

  const playFromStart = useCallback(() => {
    const list = songsRef.current;
    if (list.length) audioPlayer.playSong(list[0]!, list);
  }, []);

  const insertNext = useCallback((track: Track) => {
    audioPlayer.insertNext(track);
  }, []);

  return { currentPlaylist, setCurrent, playFromList, playFromStart, insertNext };
}
