import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { AccountState } from '../lib/accounts';
import type { Track } from '../lib/catalog';
import { usePlayback } from '../hooks/playback/PlaybackContext';
import type { ImportStatus } from './ImportBar';
import { DOCK_PLATFORM_ORDER, platformMeta } from './platforms';
import { SideDock } from './dock/SideDock';
import './dock/left-panel.css';

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

type PanelId = 'playlists' | 'import';
type LibView = 'list' | 'detail';

/** 面板内被选中的歌单（点进详情时记下，返回列表后仍保留，供离场动画使用）。 */
interface SelectedPlaylist {
  platform: string;
  id: string;
  name: string;
  cover: string;
  trackCount: number;
}

/** 推入动画状态：当前视图 + 正在离场的视图（NAV_MS 后移除）。 */
interface NavState {
  view: LibView;
  prev: LibView | null;
  dir: 'fwd' | 'back';
  /** 新视图是否已经滑到位（false = 还停在屏幕外一侧）。 */
  entered: boolean;
}

const NAV_MS = 300;

/** 视图的推入动画类名：新视图先停在屏幕外一侧，离场视图立刻滑向另一侧。 */
function viewClass(kind: LibView, nav: NavState): string {
  if (kind === nav.view) {
    if (nav.entered) return '';
    return nav.dir === 'fwd' ? ' hidden-right' : ' hidden-left';
  }
  return nav.dir === 'fwd' ? ' hidden-left' : ' hidden-right';
}

/** 带 role="button" 的行：回车 / 空格等同点击。 */
function activateOnKey(e: React.KeyboardEvent, fn: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
}

/** 封面方块：有图用背景图，没有就是中性占位。 */
/** 歌单详情顶部紧凑栏的高度（和 left-panel.css 的 .pl-bar 一致）。 */
const BAR_H = 52;

function Cover({ src, className }: { src?: string; className: string }) {
  return (
    <span
      className={`${className}${src ? '' : ' ph'}`}
      style={src ? { backgroundImage: `url(${src})` } : undefined}
    />
  );
}

/** 歌单详情里的一行歌曲（1500 首也要顺滑：memo + content-visibility）。 */
const SongRow = memo(function SongRow({
  song,
  index,
  current,
  onPlay,
  onContextMenu,
}: {
  song: Track;
  index: number;
  current: boolean;
  onPlay: (index: number) => void;
  onContextMenu: (e: React.MouseEvent, track: Track) => void;
}) {
  return (
    <div
      className={`song${current ? ' is-cur' : ''}`}
      role="button"
      tabIndex={0}
      onDoubleClick={() => onPlay(index)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onPlay(index);
        }
      }}
      onContextMenu={(e) => onContextMenu(e, song)}
    >
      <span className="idx">{index + 1}</span>
      <Cover src={song.cover} className="cv" />
      <span className="t">
        <b>{song.title}</b>
        <small>{song.artist}</small>
      </span>
    </div>
  );
});

/** 手动导入：输入框 + 按钮（回车 / 点按钮导入；留空 = 演示歌单，与既有行为一致）。 */
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
      <div className="field">
        <input
          className="input"
          type="text"
          placeholder="网易云 / QQ / 酷狗 / 汽水 / Spotify 的歌单链接"
          aria-label="歌单链接"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onImport(value.trim());
          }}
          spellCheck={false}
        />
        <button type="button" className="btn sec" onClick={() => onImport(value.trim())}>
          导入
        </button>
      </div>
      {status === 'error' && <div className="ok-line">歌单链接无效</div>}
      {status === 'parsing' && <div className="ok-line">正在导入…</div>}
    </div>
  );
}

/**
 * 左侧 Dock 的面板内容（样张 F）：
 *  - 「歌单」：已登录平台的歌单合在一起 + 平台筛选，点歌单在面板内推入详情；
 *  - 「导入」：粘贴链接、本地文件夹。
 * 外壳与开合机制在 dock/SideDock.tsx；视觉真源：样张 F（docs/design/NEBULA_UI_SYSTEM.md §9.2）。
 */
export const PlaylistDock = memo(function PlaylistDock({
  visible,
  accounts,
  importStatus,
  importMessage,
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
  const [active, setActive] = useState<PanelId | null>(null);
  const lastRef = useRef<PanelId>('playlists');
  if (active) lastRef.current = active;
  const shown = active ?? lastRef.current;

  const [filter, setFilter] = useState<string>('all');
  const [sel, setSel] = useState<SelectedPlaylist | null>(null);
  const [nav, setNav] = useState<NavState>({ view: 'list', prev: null, dir: 'fwd', entered: true });
  const navRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);
  const { song: playing } = usePlayback();
  // 歌单详情：大页头（含「播放全部」）滚出顶部后，顶部浮出一条紧凑栏（返回 · 封面 · 歌单名 · 播放 · 回到顶部）
  const actionsRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(
    () => () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const scroller = (): HTMLElement | null => navRef.current?.closest<HTMLElement>('.sd-scroll') ?? null;

  /** 列表 ↔ 详情的推入动画（样张 F renderLib 的 React 版）。 */
  const go = (view: LibView) => {
    if (view === nav.view) return;
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    setNav({ view, prev: nav.view, dir: view === 'detail' ? 'fwd' : 'back', entered: false });
    const scrollEl = scroller();
    if (scrollEl) scrollEl.scrollTop = 0;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setNav((n) => (n.view === view ? { ...n, entered: true } : n))),
    );
    timersRef.current.push(
      window.setTimeout(() => setNav((n) => (n.view === view ? { ...n, prev: null, entered: true } : n)), NAV_MS),
    );
  };

  const isCurrent = (platform: string, id: string): boolean =>
    !!currentPlaylist && currentPlaylist.platform === platform && currentPlaylist.id === id;

  const openPlaylist = (pl: SelectedPlaylist) => {
    // 不是当前歌单：先载入星云（与以前点歌单的行为一致），再推入详情
    if (!isCurrent(pl.platform, pl.id)) onImportPlaylist(pl.platform, pl.id);
    setSel(pl);
    go('detail');
  };

  const isPlayingTrack = useCallback(
    (t: Track): boolean => {
      if (!playing) return false;
      if (playing.sourceId && t.sourceId) return playing.source === t.source && playing.sourceId === t.sourceId;
      return playing.source === t.source && playing.id === t.id;
    },
    [playing],
  );

  // ---------- 视图：歌单列表 ----------
  const loggedIn = DOCK_PLATFORM_ORDER.filter((p) => accounts[p]?.loggedIn);
  const loadingPfs = DOCK_PLATFORM_ORDER.filter((p) => accounts[p]?.loading);
  const notLoggedIn = DOCK_PLATFORM_ORDER.filter((p) => !accounts[p]?.loggedIn && !accounts[p]?.loading);
  const totalPlaylists = loggedIn.reduce((n, p) => n + (accounts[p]?.playlists.length ?? 0), 0);
  // 筛选的平台退出登录后自动回到「全部」
  const curFilter = loggedIn.some((p) => p === filter) ? filter : 'all';
  const shownPfs = loggedIn.filter((p) => curFilter === 'all' || p === curFilter);
  const shownLoading = loadingPfs.filter((p) => curFilter === 'all' || p === curFilter);
  const hasRows = shownPfs.some((p) => (accounts[p]?.playlists.length ?? 0) > 0) || shownLoading.length > 0;

  const listView = (
    <div key="list" className={`view${viewClass('list', nav)}`}>
      <div className="win-head">
        <h2>歌单</h2>
        <span className="win-side">
          <span className="sub">
            {totalPlaylists} 个歌单 · {loggedIn.length} 个平台
          </span>
          <button type="button" className="btn text" onClick={onRefreshAll}>
            刷新
          </button>
        </span>
      </div>

      {loggedIn.length > 0 && (
        <div className="chips">
          <button type="button" className="chip-f" aria-pressed={curFilter === 'all'} onClick={() => setFilter('all')}>
            全部
          </button>
          {loggedIn.map((p) => {
            const meta = platformMeta(p);
            return (
              <button
                key={p}
                type="button"
                className="chip-f"
                aria-pressed={curFilter === p}
                aria-label={meta.name}
                onClick={() => setFilter(p)}
              >
                <img alt="" src={meta.logo} />
                {curFilter === p ? meta.name : ''}
              </button>
            );
          })}
        </div>
      )}

      {hasRows && (
        <>
          <div className="g-title">歌单</div>
          <div className="group">
            {shownPfs.flatMap((p) => {
              const meta = platformMeta(p);
              return (accounts[p]?.playlists ?? []).map((pl) => {
                const cur = isCurrent(p, pl.id);
                const open = () =>
                  openPlaylist({
                    platform: p,
                    id: pl.id,
                    name: pl.name,
                    cover: pl.cover,
                    trackCount: pl.trackCount,
                  });
                return (
                  <div
                    key={`${p}:${pl.id}`}
                    className={`pl-row${cur ? ' is-cur' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={(e) => activateOnKey(e, open)}
                  >
                    <Cover src={pl.cover} className="cv" />
                    <span className="lbl">
                      <span className="nm">{pl.name}</span>
                      <small>
                        <img alt="" src={meta.logo} />
                        {pl.trackCount.toLocaleString('en-US')} 首
                      </small>
                    </span>
                    {cur ? <span className="now">当前</span> : <span className="chev">›</span>}
                  </div>
                );
              });
            })}
            {shownLoading.map((p) => (
              <div key={`loading:${p}`} className="row pl-loading">
                <span className="lbl">正在获取{platformMeta(p).name}的歌单…</span>
              </div>
            ))}
          </div>
        </>
      )}

      {loggedIn.length === 0 && loadingPfs.length === 0 && (
        <>
          <p className="hint-line">还没有歌单。在右侧「账号」登录音乐平台，或者在「导入」里粘贴歌单链接。</p>
          <div className="empty-act">
            <button type="button" className="btn sec" onClick={() => setActive('import')}>
              去导入
            </button>
          </div>
        </>
      )}

      {loggedIn.length > 0 && notLoggedIn.length > 0 && (
        <p className="hint-line">
          还有 {notLoggedIn.length} 个平台没登录 · 在右侧「账号」里登录后，歌单会出现在这里
        </p>
      )}
    </div>
  );

  // ---------- 视图：歌单详情 ----------
  // 载入完成 = 选中的已经是当前歌单（歌曲在这一刻就已写入曲库；导入状态要等星云 4 秒的卡片揭示结束才变，不必等它）
  const ready = !!sel && isCurrent(sel.platform, sel.id);
  const selMeta = sel ? platformMeta(sel.platform) : null;
  const detailCover = (ready && currentPlaylist?.cover) || sel?.cover;

  const inDetail = shown === 'playlists' && nav.view === 'detail' && !!sel;
  useEffect(() => {
    const target = actionsRef.current;
    const root = scroller();
    if (!inDetail || !target || !root) {
      setStuck(false);
      return;
    }
    // 「播放全部」那一行滑到紧凑栏（52px）后面时，紧凑栏出现
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return;
        const top = e.rootBounds?.top ?? root.getBoundingClientRect().top + BAR_H;
        setStuck(!e.isIntersecting && e.boundingClientRect.top < top);
      },
      { root, rootMargin: `-${BAR_H}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(target);
    return () => {
      io.disconnect();
      setStuck(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inDetail, sel?.platform, sel?.id]);

  const toTop = () => scroller()?.scrollTo({ top: 0, behavior: 'smooth' });

  // 紧凑栏放在滚动区外面（SideDock 的 overlay 插槽）：栏下面的列表用遮罩淡出，栏直接落在面板玻璃上
  const topBar =
    inDetail && sel && selMeta ? (
      <div className={`pl-bar${stuck ? ' is-on' : ''}`} aria-hidden={!stuck}>
        <button
          type="button"
          className="pl-bar-back"
          aria-label="返回歌单"
          data-tip="返回歌单"
          tabIndex={stuck ? 0 : -1}
          onClick={() => go('list')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14.5 6 8.5 12l6 6" />
          </svg>
        </button>
        <Cover src={detailCover} className="cv" />
        <span className="pl-bar-name">{sel.name}</span>
        <button
          type="button"
          className="pl-bar-play"
          aria-label="播放全部"
          data-tip="播放全部"
          tabIndex={stuck ? 0 : -1}
          disabled={!ready || songs.length === 0}
          onClick={onPlayPlaylist}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8.5 6.2v11.6c0 .6.66.97 1.17.65l9.1-5.8a.77.77 0 0 0 0-1.3l-9.1-5.8a.77.77 0 0 0-1.17.65Z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="pl-bar-top"
          aria-label="回到顶部"
          data-tip="回到顶部"
          tabIndex={stuck ? 0 : -1}
          onClick={toTop}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 18.5V6.5M6.5 12 12 6.5l5.5 5.5" />
          </svg>
        </button>
      </div>
    ) : null;

  const detailView = (
    <div key="detail" className={`view${viewClass('detail', nav)}`}>
      <button type="button" className="back" onClick={() => go('list')}>
        ‹ 歌单
      </button>
      {sel && selMeta && (
        <>
          <div className="pl-head">
            <Cover src={detailCover} className="cv" />
            <div className="pl-info">
              <h3 title={sel.name}>{sel.name}</h3>
              <div className="meta">
                <img alt="" src={selMeta.logo} />
                {selMeta.name} · {(ready ? songs.length : sel.trackCount).toLocaleString('en-US')} 首
              </div>
            </div>
          </div>
          <div className="pl-actions" ref={actionsRef}>
            <button
              type="button"
              className="btn primary"
              disabled={!ready || songs.length === 0}
              onClick={onPlayPlaylist}
            >
              播放全部
            </button>
          </div>
          {ready && songs.length === 0 ? (
            <p className="hint-line">这个歌单是空的</p>
          ) : ready ? (
            <div className="group">
              {songs.map((song, i) => (
                <SongRow
                  key={`${song.source}:${song.sourceId ?? song.id}:${i}`}
                  song={song}
                  index={i}
                  current={isPlayingTrack(song)}
                  onPlay={onPlaySongFromList}
                  onContextMenu={onSongContextMenu}
                />
              ))}
            </div>
          ) : (
            <p className="hint-line">{importStatus === 'error' ? importMessage || '导入失败' : '正在导入…'}</p>
          )}
        </>
      )}
    </div>
  );

  const playlistsView = (
    <div className="nav" ref={navRef}>
      {nav.prev === 'list' || nav.view === 'list' ? listView : null}
      {nav.prev === 'detail' || nav.view === 'detail' ? detailView : null}
    </div>
  );

  // ---------- 视图：导入 ----------
  const importView = (
    <>
      <div className="win-head">
        <h2>导入</h2>
      </div>
      <div className="g-title">粘贴歌单链接</div>
      <div className="group">
        <ManualImport status={importStatus} onImport={onImportUrl} />
      </div>
      <div className="g-title">其他方式</div>
      <div className="group">
        <div
          className="row btn-row"
          role="button"
          tabIndex={0}
          onClick={onOpenLocal}
          onKeyDown={(e) => activateOnKey(e, onOpenLocal)}
        >
          <span className="lbl">
            本地文件夹…<small>选择文件夹，自动读取歌名、歌手和封面</small>
          </span>
          <span className="chev">›</span>
        </div>
        <div
          className="row btn-row"
          role="button"
          tabIndex={0}
          onClick={() => setActive('playlists')}
          onKeyDown={(e) => activateOnKey(e, () => setActive('playlists'))}
        >
          <span className="lbl">
            已登录平台的歌单<small>登录后自动出现在「歌单」里，不用手动导入</small>
          </span>
          <span className="chev">›</span>
        </div>
      </div>
      {/* 取消选择 / 空文件夹的短提示（几秒后由 usePlaylistImport 清掉） */}
      {importStatus === 'warn' && importMessage && (
        <p className="hint-line" role="status">
          {importMessage}
        </p>
      )}
    </>
  );

  return (
    <SideDock
      side="left"
      overlay={topBar}
      panelClass={inDetail ? `fade-top${stuck ? ' is-bar-on' : ''}` : undefined}
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
