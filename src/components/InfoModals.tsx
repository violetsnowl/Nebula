import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Track } from '../lib/catalog';
import { useOverlayScrollbar } from '../lib/overlayScrollbar';
import { hasDesktopAPI, toBackendTrack } from '../lib/playlist/ipcClient';
import type {
  DesktopAlbumDetail,
  DesktopAlbumSummary,
  DesktopArtistInfo,
  DesktopCommentResult,
  DesktopSongDetail,
  DesktopTrack,
} from '../lib/playlist/ipcClient';
import { IconChevronLeft, IconChevronRight, IconClose, IconHeart } from './icons';
import { platformMeta } from './platforms';
import './modals.css';

/** 把 background-image 的 url 安全地写进内联样式（地址里可能有引号 / 括号）。 */
const bgUrl = (src: string): CSSProperties => ({ backgroundImage: `url(${JSON.stringify(src)})` });

/** 秒 → m:ss；没有时长返回空串。 */
function fmtDuration(sec?: number): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ModalShell({
  width,
  head,
  children,
  onClose,
  minHeight,
}: {
  /** 弹窗宽度（px），实际不超过 92vw。 */
  width: number;
  /** 页头：固定在滚动区上方，不随正文滚动。 */
  head?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** 内容量差别大的弹窗（歌手页切页签）给个最小高度，避免居中的弹窗在页签间上下跳。 */
  minHeight?: number;
}) {
  // 弹窗 = G3，但不注册边缘折射（#103）：背后是压暗 + 模糊的遮罩，折射几乎看不见；
  // 而打开评论弹窗时桌面版出现过整窗黑屏（遮罩的背景滤镜叠在折射滤镜下面），去掉这条路径
  // §9.4：Esc 关闭；关闭后焦点回到打开它的元素
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [onClose]);

  // 正文区是唯一的滚动容器；悬浮滚动条挂在它的父元素（弹窗本身，已是 position: relative）上
  const bodyRef = useRef<HTMLDivElement>(null);
  useOverlayScrollbar(bodyRef);

  const style = { '--mdl-w': `${width}px`, ...(minHeight ? { '--mdl-min-h': `${minHeight}px` } : null) } as CSSProperties;
  return (
    <div className="info-overlay">
      {/* 遮罩独立一层（NEBULA_UI_SYSTEM §9.4）：点它关闭；面板不以它为祖先，G3 玻璃才能采到背后画面 */}
      <div className="info-veil" onPointerDown={onClose} />
      <div className="info-modal glass-g3" style={style} onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="mdl-x" aria-label="关闭" onClick={onClose}>
          <IconClose size={18} />
        </button>
        {head}
        <div className="mdl-body" ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return <div className="mdl-hint">加载中…</div>;
}

function ErrorLine({ text }: { text: string }) {
  return <div className="mdl-hint is-error">{text}</div>;
}

/** 页头大标题区：封面原图大幅模糊铺底（向下渐隐进玻璃）+ 132px 封面 + 衬线标题。 */
function HeroBand({
  kicker,
  title,
  cover,
  round,
  by,
  meta,
  children,
}: {
  kicker: string;
  title: string;
  cover?: string;
  /** 歌手头像是圆形，其余是圆角方形。 */
  round?: boolean;
  by?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mdl-band">
      {cover && <div className="mdl-band-bg" style={bgUrl(cover)} aria-hidden="true" />}
      {cover ? (
        <img className={`mdl-cv${round ? ' is-round' : ''}`} src={cover} alt="" draggable={false} />
      ) : (
        <span className={`mdl-cv is-ph${round ? ' is-round' : ''}`} />
      )}
      <div className="mdl-band-text">
        <div className="mdl-kicker">{kicker}</div>
        <h3 className="mdl-title">{title}</h3>
        {by}
        {meta && <div className="mdl-meta">{meta}</div>}
        {children}
      </div>
    </div>
  );
}

function SongRow({
  index,
  track,
  showCover = true,
  onClick,
  onDoubleClick,
}: {
  index?: number;
  track: DesktopTrack;
  showCover?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}) {
  const sub = showCover ? track.album : track.artist;
  return (
    <button
      type="button"
      className={`mdl-song${showCover ? '' : ' no-cover'}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <span className="mdl-song-n">{index ?? ''}</span>
      {showCover &&
        (track.cover ? (
          <img className="mdl-song-c" src={track.cover} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="mdl-song-c is-ph" />
        ))}
      <span className="mdl-song-t">
        {track.title}
        {sub && <small>{sub}</small>}
      </span>
      <span className="mdl-song-d">{fmtDuration(track.duration)}</span>
    </button>
  );
}

/* ---------- 评论 ---------- */

/** QQ 音乐评论里的表情是 `[em]e400835[/em]` 这样的代码，对应 QQ 自己图床上的 24px 表情图。 */
const QQ_EMOJI = /\[em\](e\d{3,8})\[\/em\]/g;
const qqEmojiUrl = (code: string) => `https://y.gtimg.cn/mediastyle/global/emoji/img/${code}.png`;

/** 评论正文：表情代码换成行内小图；图取不到时整个隐藏，不露出代码或破图标。 */
function CommentText({ text }: { text: string }) {
  if (!text.includes('[em]')) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(QQ_EMOJI)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    parts.push(
      <img
        key={i}
        className="cmt-emoji"
        src={qqEmojiUrl(m[1]!)}
        alt=""
        loading="lazy"
        draggable={false}
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />,
    );
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

interface CommentItem {
  nickname: string;
  avatarUrl: string;
  content: string;
  likedCount: number;
}

// 放在组件外：写在 CommentsPanel 里每次渲染都是新的组件类型，整列评论会被卸载重建
function CommentRow({ c }: { c: CommentItem }) {
  return (
    <div className="mdl-cmt">
      {c.avatarUrl ? (
        <img className="mdl-cmt-av" src={c.avatarUrl} alt="" loading="lazy" />
      ) : (
        <span className="mdl-cmt-av is-ph" />
      )}
      <span className="mdl-cmt-nm">{c.nickname}</span>
      <span className="mdl-cmt-like">
        <IconHeart size={13} />
        {c.likedCount}
      </span>
      <div className="mdl-cmt-tx">
        <CommentText text={c.content} />
      </div>
    </div>
  );
}

function CommentsPanel({ track, onClose }: { track: Track; onClose: () => void }) {
  const [hot, setHot] = useState<CommentItem[]>([]);
  const [latest, setLatest] = useState<CommentItem[]>([]);
  const [latestTotal, setLatestTotal] = useState<number | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  // 纯网页模式没有桌面接口：不进入加载态，直接给说明，避免永远「加载中…」
  const noDesktop = !hasDesktopAPI();
  useEffect(() => {
    if (!hasDesktopAPI()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setUnavailable(false);
    window.nebulaAPI!
      .fetchComments(toBackendTrack(track), 0)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const d = res.data as DesktopCommentResult | null;
        if (!d) {
          setUnavailable(true);
          return;
        }
        setHot(d?.hot ?? []);
        setLatest(d?.latest ?? []);
        setLatestTotal(d.latestTotal);
        setHasMore(!!d.hasMoreLatest);
      })
      .catch(() => !cancelled && setError('评论加载失败'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [track]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasDesktopAPI()) return;
    setLoadingMore(true);
    const next = page + 1;
    window.nebulaAPI!
      .fetchComments(toBackendTrack(track), next)
      .then((res) => {
        const d = res.ok ? (res.data as DesktopCommentResult | null) : null;
        if (!d) {
          setHasMore(false);
          return;
        }
        setLatest((prev) => [...prev, ...(d.latest ?? [])]);
        setLatestTotal(d.latestTotal);
        setHasMore(!!d.hasMoreLatest);
        setPage(next);
      })
      .catch(() => setHasMore(false))
      .finally(() => setLoadingMore(false));
  }, [track, page, loadingMore]);

  const head = (
    <div className="mdl-chead">
      <h3>
        评论
        {!!latestTotal && <small>共 {latestTotal.toLocaleString()} 条</small>}
      </h3>
      <div className="mdl-csong">
        {track.cover ? <img src={track.cover} alt="" draggable={false} /> : <span className="is-ph" />}
        <div>
          <b>{track.title}</b>
          {track.artist}
        </div>
      </div>
    </div>
  );

  return (
    <ModalShell width={580} head={head} onClose={onClose}>
      {noDesktop && <ErrorLine text="评论需要在桌面版中查看" />}
      {error && <ErrorLine text={error} />}
      {unavailable && <ErrorLine text="该平台暂无评论" />}
      {!noDesktop && !error && !unavailable && loading && <Loading />}
      {!!hot.length && (
        <>
          <div className="mdl-gtitle">
            <span>热门评论</span>
          </div>
          <div className="mdl-group" style={{ '--sep-l': '60px' } as CSSProperties}>
            {hot.map((c, i) => (
              <CommentRow key={`h${i}`} c={c} />
            ))}
          </div>
        </>
      )}
      {!!latest.length && (
        <>
          <div className="mdl-gtitle">
            <span>最新评论</span>
            {!!latestTotal && <span>{latestTotal.toLocaleString()}</span>}
          </div>
          <div className="mdl-group" style={{ '--sep-l': '60px' } as CSSProperties}>
            {latest.map((c, i) => (
              <CommentRow key={`l${i}`} c={c} />
            ))}
          </div>
        </>
      )}
      {hasMore && (
        <div className="mdl-more">
          <button type="button" className="mdl-btn-sec" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? '加载中…' : '加载更多评论'}
          </button>
        </div>
      )}
    </ModalShell>
  );
}

/* ---------- 歌曲详情 ---------- */

/** 把曲目的 artist 字符串拆成可点击的歌手引用（无平台 id，走名字转译路由）。 */
function splitTrackArtists(artist: string): Array<{ id: string; name: string }> {
  return String(artist || '')
    .split(/[\/、&,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ id: '', name }));
}

function SongDetailPanel({
  track,
  onOpenArtist,
  onOpenAlbum,
  onOpenComments,
  onClose,
}: {
  track: Track;
  onOpenArtist: (platform: string, artistId: string, name: string) => void;
  onOpenAlbum: (platform: string, albumId: string, albumName: string, artistName?: string) => void;
  onOpenComments?: (track: Track) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DesktopSongDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const noDesktop = !hasDesktopAPI();
  useEffect(() => {
    if (!hasDesktopAPI()) return;
    let cancelled = false;
    window.nebulaAPI!
      .songDetail(toBackendTrack(track))
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) setDetail(res.data);
        else if (res.ok) setMissing(true);
        else setError(res.error);
      })
      .catch(() => !cancelled && setError('详情加载失败'));
    return () => {
      cancelled = true;
    };
  }, [track]);

  const artists = detail?.artists?.length ? detail.artists : missing ? splitTrackArtists(track.artist) : [];
  const platform = detail?.platform ?? track.source;
  const albumId = detail?.album.id ?? '';
  const albumName = detail?.album.name || track.album || '';
  const albumCover = detail?.album.cover || track.cover || '';
  const artistName = artists[0]?.name || track.artist;
  const openAlbumClick = () => {
    if (!albumName) return;
    onOpenAlbum(platform, albumId, albumName, artistName);
  };
  const ready = !!detail || missing;

  const by = (
    <div className="mdl-by">
      {ready ? (
        artists.map((a) => (
          <button key={a.id || a.name} type="button" className="mdl-link" onClick={() => onOpenArtist(platform, a.id, a.name)}>
            {a.name}
          </button>
        ))
      ) : (
        <span>{track.artist}</span>
      )}
      {albumName && (
        <button type="button" className="mdl-link" onClick={openAlbumClick} data-tip="查看专辑">
          {albumName}
        </button>
      )}
    </div>
  );
  const meta = [detail?.album.publishDate, fmtDuration(detail?.duration ?? track.duration), platformMeta(platform).name]
    .filter(Boolean)
    .join(' · ');

  const head = <HeroBand kicker="歌曲" title={detail?.title || track.title} cover={albumCover} by={by} meta={meta} />;

  return (
    <ModalShell width={600} head={head} onClose={onClose}>
      {noDesktop && <ErrorLine text="详情需要在桌面版中查看" />}
      {error && <ErrorLine text={error} />}
      {!noDesktop && !error && !ready && <Loading />}
      {!!detail?.credits?.length && (
        <>
          <div className="mdl-gtitle">制作团队</div>
          <div className="mdl-group">
            {detail.credits.map((c, i) => (
              <div key={i} className="mdl-row">
                <span className="mdl-k">{c.role}</span>
                <span className="mdl-v">{c.name}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {ready && (
        <>
          <div className="mdl-gtitle">更多</div>
          <div className="mdl-group">
            {/* 评论数没有现成数据（不为它额外发请求），行尾只放箭头 */}
            {onOpenComments && (
              <button type="button" className="mdl-row is-btn" onClick={() => onOpenComments(track)}>
                <span className="mdl-v">评论</span>
                <span className="mdl-end">
                  <IconChevronRight size={14} />
                </span>
              </button>
            )}
            {artists.map((a) => (
              <button
                key={a.id || a.name}
                type="button"
                className="mdl-row is-btn"
                onClick={() => onOpenArtist(platform, a.id, a.name)}
              >
                <span className="mdl-v">歌手 · {a.name}</span>
                <span className="mdl-end">
                  <IconChevronRight size={14} />
                </span>
              </button>
            ))}
            {albumName && (
              <button type="button" className="mdl-row is-btn" onClick={openAlbumClick}>
                <span className="mdl-v">专辑 · {albumName}</span>
                <span className="mdl-end">
                  <IconChevronRight size={14} />
                </span>
              </button>
            )}
          </div>
        </>
      )}
    </ModalShell>
  );
}

/* ---------- 歌手主页 ---------- */

function ArtistPanel({
  platform,
  artistId,
  artistName,
  onPlayTrack,
  onOpenAlbum,
  onClose,
}: {
  platform: string;
  artistId: string;
  artistName: string;
  onPlayTrack: (track: DesktopTrack) => void;
  onOpenAlbum: (platform: string, albumId: string, albumName: string) => void;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<DesktopArtistInfo | null>(null);
  const [songs, setSongs] = useState<DesktopTrack[]>([]);
  const [albums, setAlbums] = useState<DesktopAlbumSummary[]>([]);
  const [view, setView] = useState<'overview' | 'all-songs'>('overview');
  const [tab, setTab] = useState<'songs' | 'albums'>('songs');
  const [allSongs, setAllSongs] = useState<DesktopTrack[] | null>(null);
  const [allLoading, setAllLoading] = useState(false);
  const [error, setError] = useState('');
  const noDesktop = !hasDesktopAPI();
  useEffect(() => {
    if (!hasDesktopAPI()) return;
    let cancelled = false;
    const api = window.nebulaAPI!;
    Promise.all([
      api.artistInfo(platform, artistId),
      api.artistSongs(platform, artistId),
      api.artistAlbums(platform, artistId),
    ])
      .then(([i, s, a]) => {
        if (cancelled) return;
        if (i.ok) setInfo(i.data);
        if (s.ok) setSongs(s.data);
        if (a.ok) setAlbums(a.data);
      })
      .catch(() => !cancelled && setError('歌手信息加载失败'));
    return () => {
      cancelled = true;
    };
  }, [platform, artistId]);

  const openAllSongs = useCallback(() => {
    setView('all-songs');
    if (allSongs !== null) return;
    setAllLoading(true);
    window.nebulaAPI!
      .artistSongsAll(platform, artistId)
      .then((res) => setAllSongs(res.ok ? res.data : []))
      .catch(() => setAllSongs([]))
      .finally(() => setAllLoading(false));
  }, [platform, artistId, allSongs]);

  if (view === 'all-songs') {
    const nav = (
      <div className="mdl-nav">
        <button type="button" className="mdl-back" onClick={() => setView('overview')}>
          <IconChevronLeft size={16} />
          返回
        </button>
        <span className="mdl-nav-t">{info?.name || artistName} · 全部歌曲</span>
      </div>
    );
    return (
      <ModalShell width={660} head={nav} onClose={onClose} minHeight={460}>
        {allLoading && <Loading />}
        {!allLoading && allSongs && (
          <>
            <div className="mdl-gtitle">
              <span>歌曲（{allSongs.length}）</span>
            </div>
            <div className="mdl-group" style={{ '--sep-l': '86px' } as CSSProperties}>
              {allSongs.map((s, i) => (
                <SongRow key={s.sourceId + i} index={i + 1} track={s} onDoubleClick={() => onPlayTrack(s)} />
              ))}
            </div>
          </>
        )}
      </ModalShell>
    );
  }

  // 歌曲总数没有现成数据（热门列表只有前几首），拿到「全部歌曲」后才显示
  const meta = [
    platformMeta(platform).name,
    allSongs ? `${allSongs.length} 首歌` : '',
    albums.length ? `${albums.length} 张专辑` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const head = (
    <>
      <HeroBand kicker="歌手" title={info?.name || artistName} cover={info?.avatar} round meta={meta}>
        {info?.description && <p className="mdl-desc">{info.description}</p>}
      </HeroBand>
      {!noDesktop && (
        <div className="mdl-tabs" role="tablist">
          <button type="button" role="tab" aria-pressed={tab === 'songs'} onClick={() => setTab('songs')}>
            热门歌曲
          </button>
          <button type="button" role="tab" aria-pressed={tab === 'albums'} onClick={() => setTab('albums')}>
            专辑
          </button>
        </div>
      )}
    </>
  );

  return (
    <ModalShell width={660} head={head} onClose={onClose} minHeight={460}>
      {/* 网页模式没有桌面接口：直接说明，不要无限「加载中」（与评论、详情一致） */}
      {noDesktop && <ErrorLine text="歌手页需要在桌面版中查看" />}
      {error && <ErrorLine text={error} />}
      {!noDesktop && !error && !info && <Loading />}
      {!noDesktop && tab === 'songs' && !!songs.length && (
        <div className="mdl-group is-first" style={{ '--sep-l': '86px' } as CSSProperties}>
          {songs.map((s, i) => (
            <SongRow key={s.sourceId + i} index={i + 1} track={s} onDoubleClick={() => onPlayTrack(s)} />
          ))}
          <button type="button" className="mdl-row is-btn" onClick={openAllSongs}>
            <span className="mdl-v">全部歌曲</span>
            <span className="mdl-end">
              <IconChevronRight size={14} />
            </span>
          </button>
        </div>
      )}
      {!noDesktop && tab === 'albums' && (
        <div className="mdl-albums">
          {albums.map((a) => (
            <button
              type="button"
              key={a.id}
              className="mdl-album"
              onClick={() => onOpenAlbum(platform, a.id, a.name)}
              data-tip={`查看专辑《${a.name}》`}
            >
              {a.cover ? (
                <img className="mdl-album-c" src={a.cover} alt="" loading="lazy" draggable={false} />
              ) : (
                <span className="mdl-album-c is-ph" />
              )}
              <b>{a.name}</b>
              {a.year ? <small>{a.year}</small> : null}
            </button>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

/** 专辑详情弹层：信息 + 专辑歌曲列表（点播走歌手页同款链路）。 */
function AlbumPanel({
  platform,
  albumId,
  albumName,
  onPlayTrack,
  onClose,
}: {
  platform: string;
  albumId: string;
  albumName: string;
  onPlayTrack: (track: DesktopTrack) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DesktopAlbumDetail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!hasDesktopAPI() || !window.nebulaAPI?.albumDetail) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    window.nebulaAPI!
      .albumDetail(platform, albumId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) setDetail(res.data);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [platform, albumId]);

  const meta = [detail?.artist, detail?.year, detail ? `${detail.tracks.length} 首` : '']
    .filter((x) => x !== undefined && x !== null && x !== '')
    .join(' · ');
  const head = <HeroBand kicker="专辑" title={detail?.name || albumName} cover={detail?.cover} meta={meta} />;

  return (
    <ModalShell width={640} head={head} onClose={onClose}>
      {failed && <ErrorLine text="该平台专辑歌曲暂不可用" />}
      {!failed && !detail && <Loading />}
      {!!detail?.tracks.length && (
        <>
          <div className="mdl-gtitle">
            <span>曲目</span>
          </div>
          <div className="mdl-group" style={{ '--sep-l': '48px' } as CSSProperties}>
            {detail.tracks.map((t, i) => (
              <SongRow
                key={`${t.platform}:${t.sourceId}`}
                index={i + 1}
                track={t}
                showCover={false}
                onClick={() => {
                  onPlayTrack(t);
                  onClose();
                }}
              />
            ))}
          </div>
        </>
      )}
    </ModalShell>
  );
}

export function InfoModals({
  modal,
  onClose,
  onOpenArtist,
  onOpenAlbum,
  onOpenComments,
  onPlayArtistTrack,
}: {
  modal: {
    kind: 'comments' | 'song' | 'artist' | 'album';
    track?: Track;
    platform?: string;
    artistId?: string;
    artistName?: string;
    albumId?: string;
    albumName?: string;
  } | null;
  onClose: () => void;
  onOpenArtist: (platform: string, artistId: string, name: string) => void;
  onOpenAlbum: (platform: string, albumId: string, albumName: string) => void;
  /** 歌曲详情「更多」里的评论入口；不传则不显示这一行。 */
  onOpenComments?: (track: Track) => void;
  onPlayArtistTrack: (track: DesktopTrack) => void;
}) {
  if (!modal) return null;
  if (modal.kind === 'comments' && modal.track) {
    return <CommentsPanel track={modal.track} onClose={onClose} />;
  }
  if (modal.kind === 'song' && modal.track) {
    return (
      <SongDetailPanel
        track={modal.track}
        onOpenArtist={onOpenArtist}
        onOpenAlbum={onOpenAlbum}
        onOpenComments={onOpenComments}
        onClose={onClose}
      />
    );
  }
  if (modal.kind === 'artist' && modal.platform && modal.artistId) {
    return (
      <ArtistPanel
        platform={modal.platform}
        artistId={modal.artistId}
        artistName={modal.artistName ?? ''}
        onOpenAlbum={onOpenAlbum}
        onPlayTrack={(t) => {
          onPlayArtistTrack(t);
          onClose();
        }}
        onClose={onClose}
      />
    );
  }
  if (modal.kind === 'album' && modal.platform && modal.albumId) {
    return (
      <AlbumPanel
        platform={modal.platform}
        albumId={modal.albumId}
        albumName={modal.albumName ?? ''}
        onPlayTrack={(t) => {
          onPlayArtistTrack(t);
          onClose();
        }}
        onClose={onClose}
      />
    );
  }
  return null;
}
