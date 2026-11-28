import type { CookieStore } from '../cookieStore';
import type { HttpClient } from '../http';
import type { AlbumDetail, AlbumSummary, Lyric, Playlist, PlatformAdapter, SongUrl, Track } from '../types';
import { withRequestScope } from '../requestScope';
import { mergeLyric } from '../parsers/lyricParser';
import { lrcAt } from '../parsers/timedLyrics';

const API = 'https://api.spotify.com/v1';
/**
 * Spotify 登录用的客户端身份：默认用 Spotify 桌面客户端的公开 ID（开源播放器 librespot 等都用它），
 * 用户不用去开发者后台注册应用，也不受开发模式 5 个用户的限制；设了环境变量 SPOTIFY_CLIENT_ID 则用自己的。
 * 回调地址必须是这个 ID 登记过的形式：http://127.0.0.1:5588/login。
 */
export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '65b708073fc0480ea92a077233ca87bd';
export const SPOTIFY_REDIRECT_PORT = 5588;
/** 访问令牌有效期 1 小时；写入超过 55 分钟就在请求前先续，少走一次 401。 */
export const SPOTIFY_RENEW_AFTER_MS = 55 * 60_000;
export const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read user-read-private user-read-email';
type PlaylistPage={items?:Array<{track?:Record<string,any>;item?:Record<string,any>}>;next?:string|null;total?:number};

/** color-lyrics 的返回 → Lyric（只要逐行同步的；「♪」这类空行去掉）。导出给回归用。 */
export function mapSpotifyLyric(raw: unknown): Lyric | null {
  const l = (raw as { lyrics?: { syncType?: string; lines?: Array<{ startTimeMs?: string | number; words?: string }> } } | null)?.lyrics;
  if (!l || l.syncType !== 'LINE_SYNCED' || !Array.isArray(l.lines)) return null;
  const rows = l.lines
    .map((x) => ({ timeMs: Math.max(0, Math.round(Number(x.startTimeMs) || 0)), text: String(x.words ?? '').trim() }))
    .filter((x) => x.text && !/^[♪♫\s]+$/.test(x.text));
  if (!rows.length) return null;
  const lrc = rows.map((x) => lrcAt(x.timeMs, x.text)).join('\n');
  return { raw: lrc, lrc, lines: mergeLyric(lrc, ''), source: 'spotify' };
}

function mapSpotifyTrack(raw: Record<string, any> | undefined | null): Track | null {
  try {
    if (!raw || !raw.id || !raw.name || (raw.type && raw.type!=='track')) return null;
    const artists: Array<{ name?: string }> = raw.artists ?? [];
    const image=[...(raw.album?.images || [])].sort((a,b)=>(b.width || 0)*(b.height || 0)-(a.width || 0)*(a.height || 0))[0];
    return {
      id: `spotify:${raw.id}`,
      title: raw.name,
      artist: artists[0]?.name ?? '未知歌手',
      artists: artists.map((a) => a.name ?? '').filter(Boolean),
      album: raw.album?.name ?? '',
      cover: image?.url ?? '',
      coverInfo:image?.url?{url:image.url,width:image.width,height:image.height,verified:false}:undefined,
      duration: Math.round((raw.duration_ms ?? 0) / 1000),
      platform: 'spotify',
      sourceId: String(raw.id),
      originalUrl: '',
      fallbackUrl: '',
      quality: 'ogg',
    };
  } catch {
    return null;
  }
}

/**
 * Spotify 自家 App 用的查询服务（pathfinder，固定名字的持久化查询）。
 * 桌面客户端身份在公开 Web API 上第一次请求就被 429（全世界的开源播放器共用这个身份，额度总是满的；
 * 2026-11-18 用户账号实测），所以账号、我的歌单、歌单曲目都走这里，用的是同一个登录令牌。
 * 查询名和哈希来自实测记录；Spotify 改版换掉某个查询时会返回错误，届时按日志更新哈希。
 */
const PATHFINDER = 'https://api-partner.spotify.com/pathfinder/v2/query';
const QUERY_HASH = {
  profileAttributes: '53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced',
  libraryV3: '390c78e5b951029bad359785e69b07b536a509c581cbcd0aded5e5067f187455',
  fetchLibraryTracks: '087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240',
  fetchPlaylist: 'cd2275433b29f7316176e7b5b5e098ae7744724e1a52d63549c76636b3257749',
} as const;
/** 「已点赞的歌曲」在我们这里的歌单 id（Spotify 里它不是普通歌单）。 */
export const SPOTIFY_LIKED_ID = 'liked';
const IMPORT_LIMIT = 5000;
type Source = { url?: string; width?: number; height?: number };
const largest = (sources?: Source[]): Source | undefined =>
  [...(sources || [])].filter((s) => s?.url).sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];

/** pathfinder 的曲目（歌单曲目是 trackDuration，点赞曲目是 duration）。 */
export function mapPathfinderTrack(d: Record<string, any> | undefined | null, uri?: string): Track | null {
  const id = String(d?.uri || uri || '').split(':').pop() || '';
  if (!d?.name || !/^[0-9A-Za-z]{22}$/.test(id)) return null;
  const artists: string[] = (d.artists?.items || []).map((a: any) => a?.profile?.name).filter(Boolean);
  const cover = largest(d.albumOfTrack?.coverArt?.sources);
  const ms = Number(d.trackDuration?.totalMilliseconds ?? d.duration?.totalMilliseconds ?? 0);
  return {
    id: `spotify:${id}`,
    title: String(d.name),
    artist: artists[0] ?? '未知歌手',
    artists,
    album: String(d.albumOfTrack?.name ?? ''),
    cover: cover?.url ?? '',
    coverInfo: cover?.url ? { url: cover.url, width: cover.width, height: cover.height, verified: false } : undefined,
    duration: Math.round(ms / 1000),
    platform: 'spotify',
    sourceId: id,
    originalUrl: '',
    fallbackUrl: '',
    quality: 'ogg',
  };
}

/**
 * Spotify 适配器：账号、我的歌单、歌单曲目走 pathfinder；公开 Web API 只作后备（多半 429）。
 * 注意：Spotify 不提供 MP3 直链，播放由 SongResolver 兜底到网易云/酷狗完成。
 */
export class SpotifyAdapter implements PlatformAdapter {
  readonly platform = 'spotify' as const;

  constructor(
    private http: HttpClient,
    private cookies: CookieStore,
  ) {}

  async fetchPlaylist(playlistId: string): Promise<Playlist> {
    return withRequestScope(60000, async () => {
      if (playlistId === SPOTIFY_LIKED_ID) return this.fetchLikedPages();
      try {
        return await this.fetchPlaylistViaQuery(playlistId);
      } catch (err) {
        console.warn('[Spotify] 查询服务读歌单失败，改用公开接口:', err instanceof Error ? err.message : '');
        return this.fetchPlaylistPages(playlistId);
      }
    });
  }

  /** pathfinder 调用：带登录令牌；401 时续期后重试一次。 */
  private query<T>(name: keyof typeof QUERY_HASH, variables: Record<string, unknown>): Promise<T> {
    return this.authedRequest<T>(PATHFINDER, {
      method: 'POST',
      headers: { 'app-platform': 'WebPlayer', Accept: 'application/json' },
      body: { variables, operationName: name, extensions: { persistedQuery: { version: 1, sha256Hash: QUERY_HASH[name] } } },
    });
  }

  private async fetchPlaylistViaQuery(playlistId: string): Promise<Playlist> {
    const uri = `spotify:playlist:${playlistId}`;
    const tracks: Track[] = [];
    let name = '', cover = '', description: string | undefined, total = Infinity;
    for (let offset = 0; offset < Math.min(total, IMPORT_LIMIT); ) {
      const res = await this.query<any>('fetchPlaylist', { uri, offset, limit: 100, enableWatchFeedEntrypoint: false });
      const pl = res?.data?.playlistV2;
      if (!pl?.content) throw new Error(res?.errors?.[0]?.message || 'Spotify 没有返回歌单内容');
      if (offset === 0) {
        name = String(pl.name ?? '');
        cover = largest(pl.images?.items?.[0]?.sources)?.url ?? '';
        description = pl.description || undefined;
      }
      total = Number(pl.content.totalCount ?? 0);
      const rows: any[] = pl.content.items || [];
      if (!rows.length) break;
      for (const row of rows) {
        const t = mapPathfinderTrack(row?.itemV2?.data);
        if (t) tracks.push(t);
      }
      offset += rows.length;
    }
    return { id: playlistId, platform: 'spotify', name: name || '未命名歌单', cover, description, tracks };
  }

  private async fetchLikedPages(): Promise<Playlist> {
    const tracks: Track[] = [];
    let total = Infinity;
    for (let offset = 0; offset < Math.min(total, IMPORT_LIMIT); ) {
      const res = await this.query<any>('fetchLibraryTracks', { offset, limit: 100 });
      const page = res?.data?.me?.library?.tracks;
      if (!page) throw new Error(res?.errors?.[0]?.message || 'Spotify 没有返回点赞歌曲');
      total = Number(page.totalCount ?? 0);
      const rows: any[] = page.items || [];
      if (!rows.length) break;
      for (const row of rows) {
        const t = mapPathfinderTrack(row?.track?.data, row?.track?._uri);
        if (t) tracks.push(t);
      }
      offset += rows.length;
    }
    return { id: SPOTIFY_LIKED_ID, platform: 'spotify', name: '已点赞的歌曲', cover: tracks[0]?.cover ?? '', tracks };
  }
  private async fetchPlaylistPages(playlistId:string):Promise<Playlist> {
    const data = await this.authedRequest<{
      id?: string;
      name?: string;
      images?: Array<{ url?: string }>;
      description?: string;
      tracks?: PlaylistPage;
      items?: PlaylistPage;
    }>(`${API}/playlists/${encodeURIComponent(playlistId)}`);
    if (!data?.id) throw new Error('Spotify 歌单不存在或需要授权');
    // 兼容新 items/item 与旧 tracks/track；无条目字段意味着未获歌单权限，不能冒充空歌单。
    let page=data.items || data.tracks;
    if(!page)throw new Error('Spotify 未授予歌单条目访问权限，请使用本人拥有或可协作的歌单');
    const items=[...(page.items || [])],seen=new Set<string>();
    while(page.next){
      const url:URL=new URL(page.next);
      const prefix=`/v1/playlists/${encodeURIComponent(playlistId)}/`;
      if(url.origin!=='https://api.spotify.com' || ![prefix+'items',prefix+'tracks'].includes(url.pathname) || seen.has(url.href))throw new Error('Spotify 歌单分页响应异常');
      if(seen.size>=100 || items.length>=5000)throw new Error('Spotify 歌单超过本次导入上限（5000 首），请拆分歌单');
      seen.add(url.href);page=await this.authedRequest<PlaylistPage>(url.href);items.push(...(page.items || []));
    }
    const tracks = items
      .map((it) => mapSpotifyTrack(it.item ?? it.track))
      .filter((t): t is Track => !!t);
    return {
      id: String(data.id),
      platform: 'spotify',
      name: data.name ?? '未命名歌单',
      cover: data.images?.[0]?.url ?? '',
      description: data.description,
      tracks,
    };
  }

  /** 无直链：返回 null，由 SongResolver 走跨平台兜底。 */
  async fetchSongUrl(_songId?: string, _albumId?: string, _quality?: string, _extra?: Record<string, unknown>): Promise<SongUrl | null> {
    return null;
  }

  /**
   * Spotify 自家歌词（#210，app 里同一个 color-lyrics 接口；登录令牌即可，2026-11-19 副本实测 3/3 返回逐行同步、来源 syncpower）。
   * 只有逐行时间，没有逐字和翻译；不同步的（UNSYNCED）没有时间轴，不要。没登录 / 没收录 / 出错都返回 null。
   */
  async fetchLyric(songId?: string): Promise<Lyric | null> {
    const id = String(songId ?? '').trim();
    if (!/^[A-Za-z0-9]{22}$/.test(id) || !this.cookies.get('spotify')?.cookies) return null;
    try {
      const res = await this.authedRequest<unknown>(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`, {
        headers: { 'app-platform': 'WebPlayer', Accept: 'application/json' },
      });
      return mapSpotifyLyric(res);
    } catch {
      return null;
    }
  }

  async searchSongs(keyword: string, pageSize = 10): Promise<Track[]> {
    try {
      const data = await this.authedRequest<{ tracks?: { items?: Array<Record<string, any>> } }>(
        `${API}/search?q=${encodeURIComponent(keyword)}&type=track&limit=${pageSize}`,
      );
      return (data?.tracks?.items ?? []).map(mapSpotifyTrack).filter((t): t is Track => !!t);
    } catch {
      return [];
    }
  }

  /** 我的歌单：「已点赞的歌曲」+ 资料库里的歌单（pathfinder）；歌单数各取一次总数。 */
  async getMyPlaylists() {
    try {
      const [liked, lib] = await Promise.all([
        this.query<any>('fetchLibraryTracks', { offset: 0, limit: 1 }).catch(() => null),
        this.query<any>('libraryV3', {
          filters: ['Playlists'], order: null, textFilter: '', features: [], limit: 50, offset: 0, flatten: true,
          expandedFolders: [], folderUri: null, includeFoldersWhenFlattening: true,
        }),
      ]);
      const rows: any[] = lib?.data?.me?.libraryV3?.items || [];
      const lists = rows
        .map((r) => r?.item?.data)
        .filter((d) => d?.__typename === 'Playlist' && /^spotify:playlist:/.test(String(d?.uri || '')));
      const counts = await Promise.all(
        lists.map((d) =>
          this.query<any>('fetchPlaylist', { uri: d.uri, offset: 0, limit: 1, enableWatchFeedEntrypoint: false })
            .then((r) => Number(r?.data?.playlistV2?.content?.totalCount ?? 0))
            .catch(() => 0),
        ),
      );
      const out = lists.map((d, i) => ({
        id: String(d.uri).split(':').pop()!,
        name: String(d.name || '未命名歌单'),
        cover: largest(d.images?.items?.[0]?.sources)?.url ?? '',
        trackCount: counts[i] ?? 0,
      }));
      const likedPage = liked?.data?.me?.library?.tracks;
      if (likedPage && Number(likedPage.totalCount) > 0) {
        const first = likedPage.items?.[0]?.track?.data;
        out.unshift({
          id: SPOTIFY_LIKED_ID,
          name: '已点赞的歌曲',
          cover: largest(first?.albumOfTrack?.coverArt?.sources)?.url ?? '',
          trackCount: Number(likedPage.totalCount),
        });
      }
      return out;
    } catch (err) {
      console.warn('[Spotify] 读取我的歌单失败:', err instanceof Error ? err.message : '');
      return [];
    }
  }

  /**
   * 关键词搜专辑（#226）：走 Web API 的 /search?type=album。
   * 需要登录令牌，和 searchSongs 同一个前提；未登录时回空，交给调用方。
   */
  async searchAlbums(keyword: string, pageSize = 8): Promise<AlbumSummary[]> {
    try {
      const data = await this.authedRequest<{
        albums?: { items?: Array<Record<string, any>> };
      }>(`${API}/search?q=${encodeURIComponent(keyword)}&type=album&limit=${pageSize}`);
      return (data?.albums?.items ?? [])
        .map((a) => ({
          platform: 'spotify' as const,
          id: String(a.id ?? ''),
          name: String(a.name ?? ''),
          cover: a.images?.[0]?.url ?? '',
          artist: (a.artists ?? []).map((x: any) => String(x?.name ?? '')).filter(Boolean).join('/'),
          year: a.release_date ? Number(String(a.release_date).slice(0, 4)) || undefined : undefined,
          songCount: Number(a.total_tracks) || undefined,
        }))
        .filter((a) => a.id && a.name);
    } catch {
      return [];
    }
  }

  /** 专辑详情：官方 /albums/{id} + /albums/{id}/tracks。 */
  async fetchAlbumDetail(albumId: string): Promise<AlbumDetail | null> {
    try {
      const [album, tracksData] = await Promise.all([
        this.authedRequest<{
          id?: string;
          name?: string;
          images?: Array<{ url?: string }>;
          artists?: Array<{ name?: string }>;
          release_date?: string;
          tracks?: { items?: Array<{ track?: Record<string, any> }> };
        }>(`${API}/albums/${encodeURIComponent(albumId)}`),
        this.authedRequest<{ items?: Array<Record<string, any>> }>(
          `${API}/albums/${encodeURIComponent(albumId)}/tracks?limit=50`,
        ),
      ]);
      if (!album?.id) return null;
      const tracks = (tracksData?.items ?? []).map(mapSpotifyTrack).filter((t): t is Track => !!t);
      return {
        platform: 'spotify',
        id: String(album.id),
        name: album.name ?? '',
        cover: album.images?.[0]?.url ?? '',
        year: album.release_date ? Number(String(album.release_date).slice(0, 4)) || undefined : undefined,
        artist: album.artists?.[0]?.name,
        tracks,
      };
    } catch (err) {
      console.warn("[SpotifyAdapter] 专辑详情失败:");
      return null;
    }
  }

  /**
   * 当前账号：昵称、头像、是否 Premium。
   * 令牌失效且续期失败（401）返回 'expired'；网络异常等暂时查不到返回 null，不当作登出。
   */
  async fetchMe(): Promise<{ id: string; nickname: string; avatarUrl?: string; premium: boolean } | 'expired' | null> {
    if (!this.cookies.get('spotify')?.cookies) return 'expired';
    try {
      // 公开 /v1/me 对这个身份总是 429，改用 Spotify 自家 App 的账号查询；是否 Premium 这里读不到，按否处理。
      const res = await this.query<any>('profileAttributes', {});
      const p = res?.data?.me?.profile;
      if (!p?.username && !p?.uri) return null;
      return {
        id: String(p.username || String(p.uri).split(':').pop()),
        nickname: String(p.name || p.username || 'Spotify 用户'),
        avatarUrl: largest(p.avatar?.sources)?.url,
        premium: false,
      };
    } catch (err) {
      return err instanceof Error && /HTTP 401/.test(err.message) ? 'expired' : null;
    }
  }

  /**
   * 自动附带 Bearer。令牌快到期时先续；401 时：别的请求已经续过（令牌变了）就直接重试，否则续一次再重试。
   * Spotify 的 refresh_token 用一次就换新、旧的作废，所以续期必须全局只有一个在进行（见 refreshToken）。
   */
  private async authedRequest<T>(
    url: string,
    extra: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const opts = { platform: 'spotify' as const, ...extra } as Parameters<HttpClient['requestJson']>[1];
    const rec = this.cookies.get('spotify');
    if (rec?.token && Date.now() - rec.updatedAt > SPOTIFY_RENEW_AFTER_MS) await this.refreshToken();
    const used = this.cookies.get('spotify')?.cookies;
    try {
      return await this.http.requestJson<T>(url, opts);
    } catch (err) {
      const status = err instanceof Error && /HTTP 401/.test(err.message) ? 401 : 0;
      if (status !== 401) throw err;
      const now = this.cookies.get('spotify')?.cookies;
      if (!(now && now !== used) && !(await this.refreshToken())) throw err;
      return await this.http.requestJson<T>(url, opts);
    }
  }

  private refreshing?: Promise<boolean>;

  /** 同一时间只续一次：并发的调用共用同一个结果，免得拿已作废的旧 refresh_token 再续一次把登录整组吊销。 */
  private refreshToken(): Promise<boolean> {
    if (!this.refreshing) this.refreshing = this.renewOnce().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  private async renewOnce(): Promise<boolean> {
    const rec = this.cookies.get('spotify');
    const refresh = rec?.token;
    const clientId = SPOTIFY_CLIENT_ID;
    if (!refresh) return false;
    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        // 续期是共用的：不跟某一个调用方的取消走，免得它被取消时连带别人一起失败。
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refresh,
          client_id: clientId,
        }).toString(),
      });
      const tok = (await res.json()) as { access_token?: string; refresh_token?: string; error?: string };
      if (!tok.access_token) {
        // invalid_grant = 续期令牌已被吊销或作废，只能重新授权；只记错误码，不记令牌。
        console.warn('[Spotify] 续期失败:', res.status, tok.error ?? '');
        return false;
      }
      this.cookies.set('spotify', tok.access_token, tok.refresh_token ?? refresh, 'Spotify');
      return true;
    } catch {
      return false;
    }
  }
}
