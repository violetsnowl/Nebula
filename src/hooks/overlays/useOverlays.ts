import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import { libraryService } from '../../lib/library';
import { hasDesktopAPI, toBackendTrack, toFrontendTrack, type DesktopTrack } from '../../lib/playlist/ipcClient';
import type { Track } from '../../lib/catalog';
import { trackShareLink } from '../../lib/shareLink';

export interface InfoModalState {
  /** lyrics = 歌词版本页，只在听音空间右栏里出现，没有弹窗呈现。 */
  kind: 'comments' | 'song' | 'artist' | 'album' | 'lyrics';
  track?: Track;
  platform?: string;
  artistId?: string;
  artistName?: string;
  albumId?: string;
  albumName?: string;
  /** 专辑歌手（专辑页兜底时按它校验同名专辑，避免串到别人的同名专辑）。 */
  albumArtist?: string;
}

export interface ContextMenuState {
  x: number;
  y: number;
  track: Track;
}

/**
 * 浮层领域（docs/project/ARCHITECTURE.md §2）：
 * 右键菜单 / 信息弹层（评论·详情·歌手）/ 二级播放窗 / 模式 toast。
 * 只依赖 service（audioPlayer / LibraryService / IPC），不依赖其他 hook。
 */
export function useOverlays() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<ContextMenuState | null>(null);
  contextMenuRef.current = contextMenu;
  const [infoModal, setInfoModal] = useState<InfoModalState | null>(null);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  // 听音空间（NEBULA_UI_SYSTEM §9.9）打开时，歌曲详情 / 歌手 / 专辑 / 评论不再弹窗，而是在右栏原地显示
  const [listenPane, setListenPane] = useState<InfoModalState | null>(null);
  const listenOpenRef = useRef(false);
  listenOpenRef.current = nowPlayingOpen;
  const showInfo = useCallback((s: InfoModalState) => {
    if (listenOpenRef.current) setListenPane(s);
    else setInfoModal(s);
  }, []);
  // 收起听音空间时右栏回到歌词
  useEffect(() => {
    if (!nowPlayingOpen) setListenPane(null);
  }, [nowPlayingOpen]);
  const [modeToast, setModeToast] = useState('');
  // Toast 停留 2.4s 后自动消失（NEBULA_UI_SYSTEM §9.6）；文字变了就重新计时。以前只有播放模式提示会消失，「未找到歌手」等提示会一直留着
  useEffect(() => {
    if (!modeToast) return;
    const t = window.setTimeout(() => setModeToast(''), 2400);
    return () => window.clearTimeout(t);
  }, [modeToast]);

  const openContextMenu = useCallback((e: MouseEvent, track: Track) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, track });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  /** 右键菜单「复制链接」：写入歌曲页面地址，用 toast 反馈结果；没有链接的平台菜单项已禁用。 */
  const copyTrackLink = useCallback((track: Track) => {
    const url = trackShareLink(track);
    if (!url) return;
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip) {
      setModeToast('复制失败');
      return;
    }
    clip.writeText(url).then(
      () => setModeToast('已复制链接'),
      () => setModeToast('复制失败'),
    );
  }, []);

  // 右键菜单按 Esc 关闭（NEBULA_UI_SYSTEM §9.6）。以前只能点空白处关，而它的透明遮罩会挡住之后的悬停和点击
  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contextMenu]);

  const openCommentsModal = useCallback(() => {
    const song = audioPlayer.getState().song;
    if (!song) return;
    showInfo({ kind: 'comments', track: song });
  }, [showInfo]);

  /** 歌曲详情弹窗里的「评论」行：评论的是详情里那首歌，不一定是正在播放的。 */
  const openCommentsFor = useCallback((track: Track) => {
    showInfo({ kind: 'comments', track });
  }, [showInfo]);

  /** 听音空间右栏「歌词版本」（手动换歌词）：只在听音空间里有，星云主界面没有入口。 */
  const openLyricVersions = useCallback(() => {
    const song = audioPlayer.getState().song;
    if (!song || !listenOpenRef.current) return;
    setListenPane({ kind: 'lyrics', track: song });
  }, []);

  const openSongDetailModal = useCallback(() => {
    const song = audioPlayer.getState().song;
    if (!song) return;
    showInfo({ kind: 'song', track: song });
  }, [showInfo]);

  /** 底部条点击歌手名：先取详情拿歌手 id；详情缺失/匹配不到时按名字转译路由到网易云/QQ 歌手。
   *  右键菜单「查看歌手」传入被点的那首歌（track）；底部条不传，沿用正在播放的歌。 */
  const openArtistByName = useCallback((name: string, track?: Track) => {
    const song = track ?? audioPlayer.getState().song;
    if (!song || !hasDesktopAPI()) return;
    const fallbackToNameRoute = () => {
      window.nebulaAPI!
        .resolveArtistByName(name)
        .then((r) => {
          if (r.ok && r.data) {
            showInfo({ kind: 'artist', platform: r.data.platform, artistId: r.data.id, artistName: r.data.name });
          } else {
            showInfo({ kind: 'song', track: song });
          }
        })
        .catch(() => showInfo({ kind: 'song', track: song }));
    };
    window.nebulaAPI!
      .songDetail(toBackendTrack(song))
      .then((res) => {
        if (!res.ok || !res.data) {
          fallbackToNameRoute();
          return;
        }
        const parts = name
          .split(/[\/、&,，]/)
          .map((s) => s.trim())
          .filter(Boolean);
        const match = res.data.artists.filter((a) =>
          parts.some((p) => p === a.name || p.includes(a.name) || a.name.includes(p)),
        );
        if (match.length === 1) {
          showInfo({
            kind: 'artist',
            platform: res.data.platform,
            artistId: match[0]!.id,
            artistName: match[0]!.name,
          });
        } else {
          fallbackToNameRoute();
        }
      })
      .catch(fallbackToNameRoute);
  }, [showInfo]);

  /**
   * 专辑点击 → 专辑详情弹层。netease/qq 带 id 直接打开；其他平台（酷狗/汽水/Spotify）
   * 或 id 缺失时按「专辑名 + 歌手名」转译到网易云 / QQ 专辑。
   * netease/qq 的专辑页本身取不到时由后端兜底（fetchAlbumDetail 会再转一次），
   * 所以这里只要把专辑名和歌手一起交下去。
   */
  const openAlbum = useCallback((platform: string, albumId: string, albumName: string, artistName?: string) => {
    if (albumId && (platform === 'netease' || platform === 'qq')) {
      showInfo({ kind: 'album', platform, albumId, albumName, albumArtist: artistName });
      return;
    }
    if (!hasDesktopAPI()) return;
    window.nebulaAPI!
      .resolveAlbumByTitle(albumName, artistName)
      .then((res) => {
        if (res.ok && res.data) {
          showInfo({
            kind: 'album',
            platform: res.data.platform,
            albumId: res.data.id,
            albumName: res.data.name,
            albumArtist: res.data.artist,
          });
        } else {
          setModeToast(`未找到专辑《${albumName}》`);
        }
      })
      .catch(() => setModeToast(`未找到专辑《${albumName}》`));
  }, [showInfo]);

  /**
   * 歌手 chip 点击：netease/qq 带 id 直接打开；其他平台（酷狗/汽水/Spotify）
   * 或 id 缺失时按歌手名转译到网易云/QQ 歌手页。
   */
  const openArtistFromChip = useCallback((platform: string, artistId: string, name: string) => {
    if (artistId && (platform === 'netease' || platform === 'qq')) {
      showInfo({ kind: 'artist', platform, artistId, artistName: name });
      return;
    }
    if (!hasDesktopAPI()) return;
    window.nebulaAPI!
      .resolveArtistByName(name)
      .then((res) => {
        if (res.ok && res.data) {
          showInfo({
            kind: 'artist',
            platform: res.data.platform,
            artistId: res.data.id,
            artistName: res.data.name,
          });
        } else {
          setModeToast(`未找到歌手「${name}」`);
        }
      })
      .catch(() => setModeToast(`未找到歌手「${name}」`));
  }, [showInfo]);

  /** 歌手页点播：追加到当前曲库队列播放（不打断歌单本身）。听音空间里点播时听音空间保持打开，只换歌。 */
  const playArtistTrack = useCallback((t: DesktopTrack) => {
    const songs = libraryService.getState().songs;
    const front = toFrontendTrack(t, songs.length);
    audioPlayer.playSong(front, [...songs, front]);
  }, []);

  return {
    contextMenu,
    contextMenuRef,
    infoModal,
    listenPane,
    setListenPane,
    nowPlayingOpen,
    modeToast,
    openContextMenu,
    closeContextMenu,
    copyTrackLink,
    openCommentsModal,
    openCommentsFor,
    openSongDetailModal,
    openLyricVersions,
    openArtistByName,
    openArtistFromChip,
    openAlbum,
    playArtistTrack,
    setNowPlayingOpen,
    setModeToast,
    setInfoModal,
  };
}
