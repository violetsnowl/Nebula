import { memo, useRef, useState } from 'react';
import type { AccountState } from '../lib/accounts';
import type { Track } from '../lib/catalog';
import type { ImportStatus } from './ImportBar';
import { DOCK_PLATFORM_ORDER, platformMeta } from './platforms';
import { SideDock } from './dock/SideDock';

interface PlaylistDockProps {
  visible: boolean;
  accounts: Record<string, AccountState>;
  importStatus: ImportStatus;
  importMessage: string;
  songs: Track[];
  currentPlaylist: { platform: string; id: string; name: string; cover: string } | null;
  onEnter: () => void;
  onLeave: () => void;
  onImportPlaylist: (platform: string, id: string) => void;
  onImportUrl: (url: string) => void;
  onGoLogin: (platform: string) => void;
  onRefreshAll: () => void;
  onPlaySongFromList: (index: number) => void;
  onPlayPlaylist: () => void;
  onSongContextMenu: (e: React.MouseEvent, track: Track) => void;
  /** 导入本地文件夹（与顶栏 ♪ 同一个入口）。 */
  onOpenLocal: () => void;
  /** 鼠标靠近左边缘（提示光痕变亮）。 */
  near: boolean;
  /** 面板开 / 关：通知边缘感应钉住或解除。 */
  onPinChange: (open: boolean) => void;
}

/** 未登录平台窗口内文案（与原型逐字一致）。 */
const UNAVAILABLE_TEXT: Record<string, string> = {
  kugou: '未登录酷狗音乐 · 请在右侧登录面板扫码或粘贴 Cookie',
  qishui: '汽水音乐为字节系封闭平台，暂无公开登录/歌单 API',
  spotify: '未登录 Spotify · 需配置 SPOTIFY_CLIENT_ID',
};

/** 手动导入输入框：tidy-pig-67 复刻（回车导入，无效链接小字提醒）。 */
function ManualImport({
  status,
  onImport,
}: {
  status: ImportStatus;
  onImport: (url: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <div className="manual-import">
      <div className="group">
        <svg
          className="search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          className="input"
          placeholder="歌单链接"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // 回车导入；留空=演示歌单（与既有行为一致）
            if (e.key === 'Enter') onImport(value.trim());
          }}
          spellCheck={false}
        />
      </div>
      {status === 'error' && <div className="manual-error">歌单链接无效</div>}
    </div>
  );
}

/**
 * 左侧歌单导入 Dock —— 原型 dock-prototype-v3.html 的逐行移植。
 * 视觉真源：prototype/dock-prototype-v3.html（用户已验证定稿，勿改结构/类名）。
 */
export const PlaylistDock = memo(function PlaylistDock({
  visible,
  accounts,
  importStatus,
  songs,
  currentPlaylist,
  onEnter,
  onLeave,
  onImportPlaylist,
  onImportUrl,
  onRefreshAll,
  onPlaySongFromList,
  onPlayPlaylist,
  onSongContextMenu,
  onOpenLocal,
  near,
  onPinChange,
}: PlaylistDockProps) {
  // 侧面板（样张 F）：歌单 / 导入
  const [active, setActive] = useState<'playlists' | 'import' | null>(null);
  const [detailOpen, setDetailOpen] = useState(true);
  const lastRef = useRef<'playlists' | 'import'>('playlists');
  if (active) lastRef.current = active;
  const shown = active ?? lastRef.current;
  const listRef = useRef<HTMLDivElement>(null);

  const isCurrent = (platform: string, id: string): boolean =>
    !!currentPlaylist && currentPlaylist.platform === platform && currentPlaylist.id === id;

  const windowContent = (id: string) => {
    const meta = platformMeta(id);
    if (id === 'manual') {
      return <ManualImport status={importStatus} onImport={onImportUrl} />;
    }
    const account = accounts[id];
    if (!account?.loggedIn) {
      return <div className="login-detail">{UNAVAILABLE_TEXT[id] ?? `未登录${meta.name}`}</div>;
    }
    return (
      <>
        <div className="win-title">
          <span>{meta.name} · 歌单</span>
          <span className="refresh" onClick={onRefreshAll}>
            刷新
          </span>
        </div>
        {account.playlists.map((pl) => {
          const current = isCurrent(id, pl.id);
          return (
            <div key={pl.id} className={`pl-wrap${current ? ' is-current' : ''}`}>
              <button
                type="button"
                className="pl"
                onClick={() => {
                  if (current) setDetailOpen((v) => !v);
                  else onImportPlaylist(id, pl.id);
                }}
              >
                <span
                  className="pl-cover"
                  style={
                    pl.cover
                      ? { backgroundImage: `url(${pl.cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                      : undefined
                  }
                />
                <span className="pl-name">{pl.name}</span>
                <span className="pl-count">{pl.trackCount} 首</span>
                {current && <span className="pl-tag">已导入</span>}
              </button>
              {current && detailOpen && (
                <div className="pl-detail">
                  <div className="pl-head">
                    <span
                      className="pl-head-cover"
                      style={
                        (currentPlaylist?.cover || pl.cover)
                          ? {
                              backgroundImage: `url(${currentPlaylist?.cover || pl.cover})`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                            }
                          : undefined
                      }
                    />
                    <div className="pl-head-info">
                      <span className="pl-head-name">{currentPlaylist?.name || pl.name}</span>
                      <span className="pl-head-count">{songs.length} 首</span>
                    </div>
                    <button className="pl-head-btn" onClick={onPlayPlaylist}>
                      ▶ 播放歌单
                    </button>
                    <button
                      className="pl-head-btn"
                      onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                    >
                      ⬆ 回到顶部
                    </button>
                  </div>
                  <div className="pl-songs">
                    {songs.map((song, i) => (
                      <div
                        key={`${song.source}:${song.sourceId ?? i}`}
                        className="pl-song"
                        onDoubleClick={() => onPlaySongFromList(i)}
                        onContextMenu={(e) => onSongContextMenu(e, song)}
                      >
                        <span
                          className="pl-song-cover"
                          style={
                            song.cover
                              ? { backgroundImage: `url(${song.cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                              : undefined
                          }
                        />
                        <div className="pl-song-meta">
                          <span className="pl-song-title">{song.title}</span>
                          <span className="pl-song-artist">{song.artist}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  // 过渡版内容：已登录平台的歌单依次排列；下一步换成样张 F 的「歌单」（全部平台合并 + 平台筛选 + 详情）
  const loggedIn = DOCK_PLATFORM_ORDER.filter((p) => accounts[p]?.loggedIn);
  const playlistsView = (
    <div ref={listRef}>
      {loggedIn.length ? (
        loggedIn.map((p) => <div key={p}>{windowContent(p)}</div>)
      ) : (
        <div className="login-detail">还没有登录任何平台 · 在右侧「账号」里登录后，歌单会出现在这里</div>
      )}
    </div>
  );
  const importView = (
    <>
      <div className="win-title">
        <span>导入</span>
      </div>
      <ManualImport status={importStatus} onImport={onImportUrl} />
      <button type="button" className="glass-btn" style={{ marginTop: 12 }} onClick={onOpenLocal}>
        本地文件夹…
      </button>
    </>
  );

  return (
    <SideDock
      side="left"
      visible={visible}
      near={near}
      active={active}
      onActiveChange={(id) => setActive(id === 'playlists' || id === 'import' ? id : null)}
      onPinChange={onPinChange}
      onEnter={onEnter}
      onLeave={onLeave}
      items={[
        {
          id: 'playlists',
          label: '歌单',
          icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
              <path d="M5.5 4.5v15M9.5 4.5v15" />
              <path d="M14 5.2l4.2 14.3" />
            </svg>
          ),
        },
        {
          id: 'import',
          label: '导入',
          icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 4v11" />
              <path d="M7.5 10.5L12 15l4.5-4.5" />
              <path d="M5 19.5h14" />
            </svg>
          ),
        },
      ]}
    >
      {shown === 'playlists' ? playlistsView : importView}
    </SideDock>
  );
});
