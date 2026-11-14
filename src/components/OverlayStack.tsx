import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { Track } from '../lib/catalog';
import type { LyricLineUI } from '../lib/lyrics';
import type { DesktopTrack, DesktopWallpaperItem, DesktopWallpaperSetResult } from '../lib/playlist/ipcClient';
import type { ContextMenuState, InfoModalState } from '../hooks/overlays/useOverlays';
import { hasDesktopAPI } from '../lib/playlist/ipcClient';
import { trackShareLink } from '../lib/shareLink';
import { NowPlayingPanel } from './NowPlayingPanel';
import { WallpaperPicker } from './WallpaperPicker';
import { InfoModals } from './InfoModals';

interface OverlayStackProps {
  nowPlayingOpen: boolean;
  liked: boolean;
  lines: LyricLineUI[];
  translateOn: boolean;
  wallpaperOpen: boolean;
  infoModal: InfoModalState | null;
  modeToast: string;
  contextMenu: ContextMenuState | null;
  onCloseNowPlaying: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleLike: () => void;
  onToggleTranslate: () => void;
  onSeek: (t: number) => void;
  onCloseWallpaper: () => void;
  onApplyWallpaper: (item: DesktopWallpaperItem, result: DesktopWallpaperSetResult) => void;
  onCloseInfo: () => void;
  /** 歌曲详情「更多 › 评论」：切到这首歌的评论弹窗。 */
  onOpenComments: (track: Track) => void;
  onOpenArtist: (platform: string, artistId: string, name: string) => void;
  onOpenAlbum: (platform: string, albumId: string, albumName: string) => void;
  onPlayArtistTrack: (t: DesktopTrack) => void;
  onCloseContextMenu: () => void;
  onInsertNext: (track: Track) => void;
  onPlayNow: (track: Track) => void;
  onViewArtist: (track: Track) => void;
  onViewAlbum: (track: Track) => void;
  onCopyLink: (track: Track) => void;
}

/** 菜单离视口边缘的最小留白。 */
const CTX_MARGIN = 8;

/**
 * 右键菜单（NEBULA_UI_SYSTEM §9.6，设计审查第 17 条）：立即播放 / 下一首播放 / 查看歌手 / 查看专辑 / 复制链接。
 * 没有「取消」：点空白处（遮罩）或按 Esc 关闭。靠近右 / 下边缘时翻到指针的另一侧，不会超出视口。
 */
function ContextMenu({
  menu,
  onClose,
  onInsertNext,
  onPlayNow,
  onViewArtist,
  onViewAlbum,
  onCopyLink,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onInsertNext: (track: Track) => void;
  onPlayNow: (track: Track) => void;
  onViewArtist: (track: Track) => void;
  onViewAlbum: (track: Track) => void;
  onCopyLink: (track: Track) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  // 量到真实尺寸后在绘制前校正位置（useLayoutEffect：不会闪一帧越界的菜单）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = menu.x;
    let top = menu.y;
    if (left + w > window.innerWidth - CTX_MARGIN) left = menu.x - w;
    if (top + h > window.innerHeight - CTX_MARGIN) top = menu.y - h;
    setPos({
      left: Math.max(CTX_MARGIN, left),
      top: Math.max(CTX_MARGIN, top),
    });
  }, [menu.x, menu.y]);

  const { track } = menu;
  // 查看歌手 / 专辑要走桌面端接口（取歌手 id、按专辑名转译）；没有专辑名的歌也没法查
  const desktop = hasDesktopAPI();
  const canArtist = desktop && !!track.artist;
  const canAlbum = desktop && !!track.album;
  const canCopy = trackShareLink(track) !== null;
  const run = (fn: (t: Track) => void) => () => {
    fn(track);
    onClose();
  };
  return (
    <div ref={ref} className="ctx-menu glass-g3" style={{ left: pos.left, top: pos.top }} role="menu">
      <button role="menuitem" onClick={run(onPlayNow)}>
        立即播放
      </button>
      <button role="menuitem" onClick={run(onInsertNext)}>
        下一首播放
      </button>
      <div className="ctx-sep" role="separator" />
      <button role="menuitem" disabled={!canArtist} onClick={run(onViewArtist)}>
        查看歌手
      </button>
      <button role="menuitem" disabled={!canAlbum} onClick={run(onViewAlbum)}>
        查看专辑
      </button>
      <div className="ctx-sep" role="separator" />
      <button role="menuitem" disabled={!canCopy} onClick={run(onCopyLink)}>
        复制链接
      </button>
    </div>
  );
}

/**
 * Z4 浮层区块（docs/project/ARCHITECTURE.md §5）：二级播放窗 / 壁纸窗口 / 信息弹层 / 模式 toast / 右键菜单。
 * 同层区块互不依赖，纯收 props（memo 化，App 提供稳定回调）。
 */
export const OverlayStack = memo(function OverlayStack({
  nowPlayingOpen,
  liked,
  lines,
  translateOn,
  wallpaperOpen,
  infoModal,
  modeToast,
  contextMenu,
  onCloseNowPlaying,
  onTogglePlay,
  onPrev,
  onNext,
  onToggleLike,
  onToggleTranslate,
  onSeek,
  onCloseWallpaper,
  onApplyWallpaper,
  onCloseInfo,
  onOpenComments,
  onOpenArtist,
  onOpenAlbum,
  onPlayArtistTrack,
  onCloseContextMenu,
  onInsertNext,
  onPlayNow,
  onViewArtist,
  onViewAlbum,
  onCopyLink,
}: OverlayStackProps) {
  return (
    <>
      {nowPlayingOpen && (
        <NowPlayingPanel
          liked={liked}
          lines={lines}
          translateOn={translateOn}
          onClose={onCloseNowPlaying}
          onTogglePlay={onTogglePlay}
          onPrev={onPrev}
          onNext={onNext}
          onToggleLike={onToggleLike}
          onToggleTranslate={onToggleTranslate}
          onSeek={onSeek}
        />
      )}
      {wallpaperOpen && <WallpaperPicker onClose={onCloseWallpaper} onApply={onApplyWallpaper} />}
      <InfoModals
        modal={infoModal}
        onClose={onCloseInfo}
        onOpenComments={onOpenComments}
        onOpenArtist={onOpenArtist}
        onOpenAlbum={onOpenAlbum}
        onPlayArtistTrack={onPlayArtistTrack}
      />
      {modeToast && <div className="mode-toast">{modeToast}</div>}
      {contextMenu && (
        <>
          <div className="ctx-backdrop" onPointerDown={onCloseContextMenu} onContextMenu={(e) => e.preventDefault()} />
          <ContextMenu
            menu={contextMenu}
            onClose={onCloseContextMenu}
            onInsertNext={onInsertNext}
            onPlayNow={onPlayNow}
            onViewArtist={onViewArtist}
            onViewAlbum={onViewAlbum}
            onCopyLink={onCopyLink}
          />
        </>
      )}
    </>
  );
});
