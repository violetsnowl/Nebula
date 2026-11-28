import type { CookieStore } from '../cookieStore';
import type { HttpClient } from '../http';
import type { AlbumDetail, AlbumSummary, ArtistInfo, ArtistSearchHit, Lyric, Playlist, PlatformAdapter, SongUrl, Track } from '../types';
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
  searchTracks: 'b02683192a98dde7966b5e6655a79eeb62713eab703eda9902c932818dd52751',
  searchAlbums: '202cb3305e31e5a0767ba7925f28bd728cf8f8b0217e6da43909056071cd70e9',
  searchArtists: '7bf95d754fdbe32c8b161fbbe54d1ae50974900df4dce4c8f1afcbcad153224d',
  getAlbum: '0b6ce3511e1b02e4a40fa95440f992acbe85080eb308af9194322d708fc1914f',
  queryArtistOverview: 'eafb1620d783ece118e72fbfede2b0064483e029d3c1aafafa1c2de0e25a89e7',
} as const;

const SEARCH_VARS_BASE = {
  offset: 0,
  numberOfTopResults: 5,
  includeAudiobooks: false,
  includeArtistHasConcertsField: false,
  includePreReleases: false,
  includeAuthors: false,
};

function spotifyIdFromUri(uri: unknown, kind: string): string {
  const s = String(uri ?? '');
  const prefix = `spotify:${kind}:`;
  const id = s.startsWith(prefix) ? s.slice(prefix.length) : s.split(':').pop() || '';
  return /^[0-9A-Za-z]{22}$/.test(id) ? id : '';
}

function stripHtmlTags(raw: unknown): string {
  return String(raw ?? '').replace(/<[^>]+>/g, '').trim();
}
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

  /** 全网搜歌：优先走 pathfinder searchTracks（绕开公开 /v1/search 429），失败时回退公开接口；未登录直接返回空。 */
  async searchSongs(keyword: string, pageSize = 10): Promise<Track[]> {
    const q = String(keyword ?? '').trim();
    if (!q || !this.cookies.get('spotify')?.cookies) return [];
    const limit = Math.max(1, Math.min(25, Math.floor(pageSize) || 10));
    try {
      const res = await this.query<any>('searchTracks', { ...SEARCH_VARS_BASE, searchTerm: q, limit });
      const items: any[] = res?.data?.searchV2?.tracksV2?.items ?? [];
      if (items.length) {
        return items.map((it) => mapPathfinderTrack(it?.item?.data)).filter((t): t is Track => !!t).slice(0, limit);
      }
    } catch {
      /* pathfinder 失败时降级公开 Web API */
    }
    try {
      const data = await this.authedRequest<{ tracks?: { items?: Array<Record<string, any>> } }>(
        `${API}/search?q=${encodeURIComponent(q)}&type=track&limit=${limit}`,
      );
      return (data?.tracks?.items ?? []).map(mapSpotifyTrack).filter((t): t is Track => !!t);
    } catch {
      return [];
    }
  }

  /** 全网搜歌手（pathfinder searchArtists）；未登录返回空。 */
  async searchArtists(keyword: string, pageSize = 5): Promise<ArtistSearchHit[]> {
    const q = String(keyword ?? '').trim();
    if (!q || !this.cookies.get('spotify')?.cookies) return [];
    const limit = Math.max(1, Math.min(20, Math.floor(pageSize) || 5));
    try {
      const res = await this.query<any>('searchArtists', { ...SEARCH_VARS_BASE, searchTerm: q, limit });
      const items: any[] = res?.data?.searchV2?.artists?.items ?? [];
      return items
        .map((it): ArtistSearchHit | null => {
          const d = it?.data;
          const id = spotifyIdFromUri(d?.uri, 'artist');
          const name = String(d?.profile?.name ?? '').trim();
          if (!id || !name) return null;
          const avatar = largest(d?.visuals?.avatarImage?.sources)?.url ?? '';
          return { platform: 'spotify', id, name, avatar };
        })
        .filter((x): x is ArtistSearchHit => !!x)
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  private artistCache = new Map<string, { at: number; data: Record<string, any> }>();

  /** 歌手总览（60 秒进程内缓存：打开歌手页并行调 info / songs / albums 只发一次请求）。 */
  private async artistOverview(artistId: string): Promise<Record<string, any> | null> {
    const id = String(artistId ?? '').trim();
    if (!/^[0-9A-Za-z]{22}$/.test(id) || !this.cookies.get('spotify')?.cookies) return null;
    const hit = this.artistCache.get(id);
    if (hit && Date.now() - hit.at < 60_000) return hit.data;
    try {
      const res = await this.query<any>('queryArtistOverview', { uri: `spotify:artist:${id}`, locale: '' });
      const u = res?.data?.artistUnion;
      if (!u?.profile?.name) return null;
      this.artistCache.set(id, { at: Date.now(), data: u });
      if (this.artistCache.size > 32) this.artistCache.delete(this.artistCache.keys().next().value!);
      return u;
    } catch {
      return null;
    }
  }

  async fetchArtistInfo(artistId: string): Promise<ArtistInfo | null> {
    const u = await this.artistOverview(artistId);
    if (!u) return null;
    return {
      platform: 'spotify',
      id: artistId,
      name: String(u.profile?.name ?? ''),
      avatar: largest(u.visuals?.avatarImage?.sources)?.url ?? '',
      description: stripHtmlTags(u.profile?.biography?.text) || undefined,
    };
  }

  async fetchArtistSongs(artistId: string): Promise<Track[]> {
    const u = await this.artistOverview(artistId);
    const items: any[] = u?.discography?.topTracks?.items ?? [];
    return items.map((it) => mapPathfinderTrack(it?.track)).filter((t): t is Track => !!t);
  }

  async fetchArtistAlbums(artistId: string): Promise<AlbumSummary[]> {
    const u = await this.artistOverview(artistId);
    if (!u) return [];
    const groups: any[] = [
      ...(u.discography?.albums?.items ?? []),
      ...(u.discography?.singles?.items ?? []),
    ];
    const seen = new Set<string>();
    const out: AlbumSummary[] = [];
    const artistName = String(u.profile?.name ?? '');
    for (const g of groups) {
      for (const rel of g?.releases?.items ?? []) {
        const id = spotifyIdFromUri(rel?.uri, 'album');
        const name = String(rel?.name ?? '').trim();
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        out.push({
          platform: 'spotify',
          id,
          name,
          cover: largest(rel?.coverArt?.sources)?.url ?? '',
          artist: artistName,
          year: Number(rel?.date?.year) || undefined,
          songCount: Number(rel?.tracks?.totalCount) || undefined,
        });
        if (out.length >= 25) return out;
      }
    }
    return out;
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
   * 关键词搜专辑（#226 / #322）：优先走 pathfinder searchAlbums（绕开公开 /v1/search 429），
   * 失败时回退公开 Web API；未登录直接返回空。
   */
  async searchAlbums(keyword: string, pageSize = 8): Promise<AlbumSummary[]> {
    const q = String(keyword ?? '').trim();
    if (!q || !this.cookies.get('spotify')?.cookies) return [];
    const limit = Math.max(1, Math.min(20, Math.floor(pageSize) || 8));
    try {
      const res = await this.query<any>('searchAlbums', { ...SEARCH_VARS_BASE, searchTerm: q, limit });
      const items: any[] = res?.data?.searchV2?.albumsV2?.items ?? [];
      if (items.length) {
        return items
          .map((it): AlbumSummary | null => {
            const d = it?.data;
            const id = spotifyIdFromUri(d?.uri, 'album');
            const name = String(d?.name ?? '').trim();
            if (!id || !name) return null;
            return {
              platform: 'spotify',
              id,
              name,
              cover: largest(d?.coverArt?.sources)?.url ?? '',
              artist: (d?.artists?.items ?? []).map((x: any) => String(x?.profile?.name ?? '')).filter(Boolean).join('/'),
              year: Number(d?.date?.year) || undefined,
            };
          })
          .filter((a): a is AlbumSummary => !!a)
          .slice(0, limit);
      }
    } catch {
      /* pathfinder 失败时降级公开 Web API */
    }
    try {
      const data = await this.authedRequest<{
        albums?: { items?: Array<Record<string, any>> };
      }>(`${API}/search?q=${encodeURIComponent(q)}&type=album&limit=${limit}`);
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

  /** 专辑详情：优先走 pathfinder getAlbum（绕开公开 /v1/albums 429），失败时回退公开接口。 */
  async fetchAlbumDetail(albumId: string): Promise<AlbumDetail | null> {
    const id = String(albumId ?? '').trim();
    if (!id || !this.cookies.get('spotify')?.cookies) return null;
    if (/^[0-9A-Za-z]{22}$/.test(id)) {
      try {
        const res = await this.query<any>('getAlbum', { uri: `spotify:album:${id}`, locale: '', offset: 0, limit: 300 });
        const alb = res?.data?.albumUnion;
        if (alb?.name) {
          const coverObj = largest(alb.coverArt?.sources);
          const cover = coverObj?.url ?? '';
          const albumName = String(alb.name);
          const yearRaw = alb.date?.year ?? (alb.date?.isoString ? Number(String(alb.date.isoString).slice(0, 4)) : undefined);
          const artist = (alb.artists?.items ?? []).map((x: any) => String(x?.profile?.name ?? '')).filter(Boolean).join(' / ') || undefined;
          const rows: any[] = alb.tracksV2?.items ?? alb.tracks?.items ?? [];
          const tracks = rows
            .map((r) => {
              const t = mapPathfinderTrack(r?.track);
              if (!t) return null;
              if (!t.album) t.album = albumName;
              if (!t.cover && cover) {
                t.cover = cover;
                t.coverInfo = { url: cover, width: coverObj?.width, height: coverObj?.height, verified: false };
              }
              return t;
            })
            .filter((t): t is Track => !!t);
          return {
            platform: 'spotify',
            id,
            name: albumName,
            cover,
            year: Number(yearRaw) || undefined,
            artist,
            tracks,
          };
        }
      } catch {
        /* pathfinder 失败时降级公开 Web API */
      }
    }
    try {
      const [album, tracksData] = await Promise.all([
        this.authedRequest<{
          id?: string;
          name?: string;
          images?: Array<{ url?: string }>;
          artists?: Array<{ name?: string }>;
          release_date?: string;
          tracks?: { items?: Array<{ track?: Record<string, any> }> };
        }>(`${API}/albums/${encodeURIComponent(id)}`),
        this.authedRequest<{ items?: Array<Record<string, any>> }>(
          `${API}/albums/${encodeURIComponent(id)}/tracks?limit=50`,
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
      console.warn('[SpotifyAdapter] 专辑详情失败:');
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
