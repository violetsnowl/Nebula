import type { CookieStore } from '../cookieStore';
import type { HttpClient } from '../http';
import type { AlbumDetail, Lyric, Playlist, PlatformAdapter, SongUrl, Track } from '../types';
import { requestScope, withRequestScope } from '../requestScope';

const API = 'https://api.spotify.com/v1';
/**
 * Spotify 登录用的客户端身份：默认用 Spotify 桌面客户端的公开 ID（开源播放器 librespot 等都用它），
 * 用户不用去开发者后台注册应用，也不受开发模式 5 个用户的限制；设了环境变量 SPOTIFY_CLIENT_ID 则用自己的。
 * 回调地址必须是这个 ID 登记过的形式：http://127.0.0.1:5588/login（folia 2026-10 实测）。
 */
export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '65b708073fc0480ea92a077233ca87bd';
export const SPOTIFY_REDIRECT_PORT = 5588;
export const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read user-read-private user-read-email';
type PlaylistPage={items?:Array<{track?:Record<string,any>;item?:Record<string,any>}>;next?:string|null;total?:number};

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
 * Spotify 适配器：歌单/我的歌单/搜索走官方 Web API（需 OAuth Token）。
 * 注意：Spotify 不提供 MP3 直链，播放由 SongResolver 兜底到网易云/酷狗完成。
 */
export class SpotifyAdapter implements PlatformAdapter {
  readonly platform = 'spotify' as const;

  constructor(
    private http: HttpClient,
    private cookies: CookieStore,
  ) {}

  async fetchPlaylist(playlistId: string): Promise<Playlist> {
    return withRequestScope(60000,()=>this.fetchPlaylistPages(playlistId));
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

  async fetchLyric(): Promise<Lyric | null> {
    return null;
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

  async getMyPlaylists() {
    try {
      const data = await this.authedRequest<{
        items?: Array<{ id?: string; name?: string; images?: Array<{ url?: string }>; tracks?: { total?: number } }>;
      }>(`${API}/me/playlists?limit=50`);
      return (data?.items ?? [])
        .map((p) => ({
          id: String(p.id ?? ''),
          name: p.name ?? '未命名歌单',
          cover: p.images?.[0]?.url ?? '',
          trackCount: p.tracks?.total ?? 0,
        }))
        .filter((p) => p.id);
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
      const me = await this.authedRequest<{ id?: string; display_name?: string; images?: Array<{ url?: string }>; product?: string }>(`${API}/me`);
      if (!me?.id) return null;
      return { id: me.id, nickname: me.display_name || 'Spotify 用户', avatarUrl: me.images?.[0]?.url, premium: me.product === 'premium' };
    } catch (err) {
      return err instanceof Error && /HTTP 401/.test(err.message) ? 'expired' : null;
    }
  }

  /** 自动附带 Bearer；401 时用 refresh_token 换新后重试一次。 */
  private async authedRequest<T>(url: string): Promise<T> {
    try {
      return await this.http.requestJson<T>(url, { platform: 'spotify' });
    } catch (err) {
      const status = err instanceof Error && /HTTP 401/.test(err.message) ? 401 : 0;
      if (status !== 401 || !(await this.refreshToken())) throw err;
      return await this.http.requestJson<T>(url, { platform: 'spotify' });
    }
  }

  private async refreshToken(): Promise<boolean> {
    const rec = this.cookies.get('spotify');
    const refresh = rec?.token;
    const clientId = SPOTIFY_CLIENT_ID;
    if (!refresh) return false;
    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        signal: requestScope()?.signal || AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refresh,
          client_id: clientId,
        }).toString(),
      });
      const tok = (await res.json()) as { access_token?: string; refresh_token?: string };
      if (!tok.access_token) return false;
      this.cookies.set('spotify', tok.access_token, tok.refresh_token ?? refresh, 'Spotify');
      return true;
    } catch {
      return false;
    }
  }
}
