import type { AdapterMap, UrlTarget } from './adapters/index';
import { resolveAdapterByUrl } from './adapters/index';
import type { CookieStore } from './cookieStore';
import type { NeteaseLogin } from './login/neteaseLogin';
import type { SongResolver } from './services/songResolver';
import type { LyricService } from './services/lyricService';
import type { Platform, PlaylistSummary, Track } from './types';
import type { LoginAdapter } from './login/index';
import type { AudioProxy } from './audioProxy';
import { CoverService,coverCandidates } from './services/coverService';
import type { WallpaperLibrary } from './services/wallpaperLibrary';
import { normalizeCookieHeader, validatePlatformCookie } from './cookieStore';

/** 歌单自己没有封面时用的图：第一首有封面的歌。 */
export function firstTrackCover(tracks: Array<Pick<Track, 'cover'>>): string {
  return tracks.find(t => /^https?:\/\//i.test(t.cover || ''))?.cover || '';
}

/** 仅依赖 ipcMain.handle 形状，避免在纯 Node 冒烟测试中引入 electron。 */
export interface IpcLike {
  handle(channel: string, fn: (event: unknown, payload: any) => Promise<unknown>): void;
}

export interface IpcDeps {
  adapters: AdapterMap;
  resolver: SongResolver;
  lyricService: LyricService;
  cookies: CookieStore;
  login: NeteaseLogin;
  loginAdapters: Record<string, LoginAdapter>;
  audioProxy: AudioProxy;
  spotifyOAuth?: { start: () => Promise<boolean>; status: () => boolean };
  qqLoginWindow?: () => Promise<{ ok: boolean; message?: string; error?: string }>;
  kugouLoginWindow?: () => Promise<{ ok: boolean; message?: string; error?: string }>;
  kuwoLoginWindow?: () => Promise<{ ok: boolean; message?: string; error?: string }>;
  applemusicLoginWindow?: () => Promise<{ ok: boolean; message?: string; error?: string }>;
  /**
   * Optional hook invoked after a platform cookie is cleared (e.g. purge Electron partition sessions).
   * previous 是清除前的记录（YouTube Music 退出时要拿续期令牌去撤销）。
   */
  onCookieClear?: (platform: Platform, previous?: { token?: string }) => Promise<void> | void;
  wallpaperLibrary?: WallpaperLibrary;
}

export function registerIpcHandlers(ipcMain: IpcLike, deps: IpcDeps): void {
  const covers=new CoverService();
  // 没有封面的歌单（酷我「我喜欢听」等系统歌单）用第一首歌的封面补；只缓存取到的结果，进程内有效。
  const firstCovers = new Map<string, string>();
  const fillPlaylistCovers = async (platform: Platform, list: PlaylistSummary[]): Promise<PlaylistSummary[]> => {
    const adapter = deps.adapters[platform];
    if (!adapter) return list;
    const missing = list.filter(p => !p.cover).slice(0, 8);
    await Promise.all(missing.map(async p => {
      const key = `${platform}:${p.id}`;
      let cover = firstCovers.get(key) || '';
      if (!cover) {
        try {
          cover = adapter.fetchPlaylistFirstCover
            ? await adapter.fetchPlaylistFirstCover(p.id)
            : firstTrackCover((await adapter.fetchPlaylist(p.id)).tracks);
        } catch { /* 补不上就保持空，前端显示占位 */ }
        if (cover) firstCovers.set(key, cover);
      }
      if (cover) p.cover = cover;
    }));
    return list;
  };
  const owners = new WeakMap<object, Map<string, AbortController>>();
  const testingOwner = {};
  const requestsFor = (event: unknown) => {
    const sender = (event as { sender?: object } | null)?.sender ?? testingOwner;
    let requests = owners.get(sender);
    if (!requests) {
      requests = new Map(); owners.set(sender,requests);
      const owned = requests;
      (sender as { once?: (name: string, fn: () => void) => void }).once?.('destroyed',()=> { owned.forEach(c=>c.abort()); owned.clear(); });
    }
    return requests;
  };
  const safe = (channel: string, fn: (payload: any, event?: unknown) => Promise<unknown>) => {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        return { ok: true, data: await fn(payload, _event) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  };

  safe('nebula:cover-info',async({track}:{track:Track})=>covers.inspect(track));

  safe('nebula:import-playlist', async ({ url }: { url?: string }) => {
    if (!url) throw new Error('缺少歌单链接');
    const target: UrlTarget | null = resolveAdapterByUrl(url);
    if (!target) throw new Error('无法识别的歌单链接（支持网易云 / QQ音乐 / 酷狗 / 酷我 / 波点 / YouTube Music / Apple Music / Spotify / 汽水）');
    const playlist = await deps.adapters[target.platform].fetchPlaylist(target.id);
    return {
      platformName: target.platform,
      name: playlist.name,
      cover: playlist.cover || firstTrackCover(playlist.tracks),
      tracks: playlist.tracks.map(t=>({...t,coverInfo:t.coverInfo || (t.cover?{url:coverCandidates(t)[0] || t.cover,verified:false}:undefined)})),
    };
  });

  safe('nebula:import-playlist-id', async ({ platform, id }: { platform: Platform; id: string }) => {
    const playlist = await deps.adapters[platform].fetchPlaylist(id);
    if (!playlist.cover) {
      const cover = firstTrackCover(playlist.tracks);
      if (cover) firstCovers.set(`${platform}:${id}`, cover);
    }
    return {
      platformName: platform,
      name: playlist.name,
      cover: playlist.cover || firstTrackCover(playlist.tracks),
      tracks: playlist.tracks.map(t=>({...t,coverInfo:t.coverInfo || (t.cover?{url:coverCandidates(t)[0] || t.cover,verified:false}:undefined)})),
    };
  });

  safe('nebula:resolve-song', async ({ track, quality, requestId, forceRefresh }: { track: Track; quality?: string; requestId?: string; forceRefresh?: boolean }, event) => {
    const requests = requestsFor(event), control = new AbortController();
    const key = typeof requestId === 'string' ? requestId.slice(0,96) : '';
    if (key) {
      requests.get(key)?.abort();
      if (requests.size >= 16) { const first=requests.keys().next().value!; requests.get(first)?.abort(); requests.delete(first); }
      requests.set(key,control);
    }
    try {
      const result = await deps.resolver.resolve(track, quality, {signal:control.signal,forceRefresh:!!forceRefresh});
      if (!result) return null;
      return { ...result, url: deps.audioProxy.urlFor(result.url) };
    } finally { if (key && requests.get(key) === control) requests.delete(key); }
  });
  safe('nebula:cancel-resolve', async ({requestId}: {requestId: string},event) => {
    const requests=requestsFor(event); requests.get(requestId)?.abort(); requests.delete(requestId); return true;
  });
  safe('nebula:song-qualities', async ({ track }: { track: Track }) => {
    // 必须带着适配器调用：网易云的 listQualities 要读 this 上的账号权益（拆下来调用时 this 丢失，菜单一直是空的）
    const adapter = deps.adapters[track.platform];
    if (!adapter?.listQualities) return [];
    return adapter.listQualities(track.sourceId);
  });
  safe('nebula:fallback-song', async ({ track }: { track: Track }) => {
    const result = await deps.resolver.enrichFallback(track);
    return {
      ...result,
      originalUrl: deps.audioProxy.urlFor(result.originalUrl),
      fallbackUrl: deps.audioProxy.urlFor(result.fallbackUrl),
    };
  });
  safe('nebula:lyric', async ({track,requestId}:{track:Track;requestId?:string},event)=>{
    const requests=requestsFor(event),control=new AbortController();
    const key=typeof requestId==='string'?requestId.slice(0,96):'';
    if(key){requests.get(key)?.abort();if(requests.size>=16){const first=requests.keys().next().value!;requests.get(first)?.abort();requests.delete(first);}requests.set(key,control);}
    try{return await deps.lyricService.fetchLyric(track,control.signal);}
    finally{if(key && requests.get(key)===control)requests.delete(key);}
  });
  safe('nebula:comments', async ({ track, page }: { track: Track; page?: number }) =>
    deps.lyricService.fetchComments(track, Number(page) || 0),
  );
  safe('nebula:song-detail', async ({ track, withCredits }: { track: Track; withCredits?: boolean }) =>
    deps.lyricService.fetchSongDetail(track, { withCredits: !!withCredits }),
  );
  safe('nebula:artist-info', async ({ platform, artistId }: { platform: Platform; artistId: string }) =>
    deps.lyricService.fetchArtistInfo(platform, String(artistId)),
  );
  safe('nebula:artist-songs', async ({ platform, artistId }: { platform: Platform; artistId: string }) =>
    deps.lyricService.fetchArtistSongs(platform, String(artistId)),
  );
  safe('nebula:artist-albums', async ({ platform, artistId }: { platform: Platform; artistId: string }) =>
    deps.lyricService.fetchArtistAlbums(platform, String(artistId)),
  );
  safe('nebula:artist-songs-all', async ({ platform, artistId }: { platform: Platform; artistId: string }) =>
    deps.lyricService.fetchArtistAllSongs(platform, String(artistId)),
  );
  safe('nebula:album-detail', async ({ platform, albumId }: { platform: Platform; albumId: string }) =>
    deps.lyricService.fetchAlbumDetail(platform, String(albumId)),
  );
  safe('nebula:search-songs', async ({ keyword, pageSize }: { keyword: string; pageSize?: number }) =>
    deps.lyricService.searchSongs(String(keyword), Number(pageSize) || 8),
  );
  safe('nebula:search-artists', async ({ keyword, pageSize }: { keyword: string; pageSize?: number }) =>
    deps.lyricService.searchArtists(String(keyword), Number(pageSize) || 5),
  );
  safe('nebula:resolve-artist-by-name', async ({ name }: { name: string }) =>
    deps.lyricService.resolveArtistByName(String(name)),
  );
  safe('nebula:resolve-album-by-title', async ({ title, artist }: { title: string; artist?: string }) =>
    deps.lyricService.resolveAlbumByTitle(String(title), artist ? String(artist) : undefined),
  );

  safe('nebula:wallpaper:list', async () => {
    const lib = deps.wallpaperLibrary;
    if (!lib) throw new Error('wallpaper 库不可用');
    const items = await lib.list();
    return items.map((it) => ({
      ...it,
      previewUrl: it.hasPreview ? `wallpaper://preview/${it.id}?token=${lib.token}` : '',
      mediaUrl: it.playable ? `wallpaper://media/${it.id}?token=${lib.token}` : '',
    }));
  });
  safe('nebula:wallpaper:info', async () => ({
    weInstalled: deps.wallpaperLibrary?.wallpapersEngineInstalled() ?? false,
    weLaunchUrl: deps.wallpaperLibrary?.wallpapersEngineLaunchUrl() ?? '',
  }));
  safe('nebula:wallpaper:set', async ({ id }: { id: string }) => {
    const lib = deps.wallpaperLibrary;
    if (!lib) throw new Error('wallpaper 库不可用');
    return lib.setBackground(String(id));
  });

  safe('nebula:cookie:set', async ({ platform, cookie, token, nickname }: { platform: Platform; cookie: string; token?: string; nickname?: string }) => {
    console.log("[ipc.ts] 接口状态变化");
    const normalized = normalizeCookieHeader(cookie);
    console.log("[ipc.ts] 接口状态变化");
    const validation = validatePlatformCookie(platform, normalized);
    if (!validation.ok) {
      console.log("[IPC] cookie:set VALIDATION FAILED:");
      throw new Error(validation.error);
    }
    deps.cookies.set(platform, normalized, token, nickname);
    console.log("[IPC] cookie:set SUCCESS for");
    return true;
  });
  safe('nebula:cookie:get', async ({ platform }: { platform: Platform }) => deps.cookies.get(platform) ?? null);
  safe('nebula:cookie:clear', async ({ platform }: { platform: Platform }) => {
    const previous = deps.cookies.get(platform);
    deps.cookies.clear(platform);
    if (deps.onCookieClear) await deps.onCookieClear(platform, previous ? { token: previous.token } : undefined);
    return true;
  });

  safe('nebula:login:qr', async () => deps.login.createQr());
  safe('nebula:login:poll', async ({ unikey }: { unikey: string }) => deps.login.pollLogin(unikey));
  safe('nebula:login:platforms', async () =>
    Object.values(deps.loginAdapters).map((a) => ({
      platform: a.platform,
      name: a.name,
      kind: a.kind,
      unavailableReason: a.unavailableReason ?? null,
    })),
  );
  safe('nebula:login:qr-platform', async ({ platform }: { platform: string }) => {
    const a = deps.loginAdapters[platform];
    if (!a?.createQr) throw new Error(`平台 ${platform} 不支持扫码登录`);
    return a.createQr();
  });
  safe('nebula:login:poll-platform', async ({ platform, unikey }: { platform: string; unikey: string }) => {
    const a = deps.loginAdapters[platform];
    if (!a?.pollLogin) throw new Error(`平台 ${platform} 不支持扫码登录`);
    return a.pollLogin(unikey);
  });
  safe('nebula:login:account', async ({ platform }: { platform: string }) => {
    const a = deps.loginAdapters[platform];
    if (!a?.getAccount) return null;
    return a.getAccount();
  });
  safe('nebula:login:playlists', async ({ platform }: { platform: string }) => {
    const a = deps.loginAdapters[platform];
    if (!a?.getMyPlaylists) return [];
    return fillPlaylistCovers(platform as Platform, await a.getMyPlaylists());
  });
  safe('nebula:login:spotify:start', async () => {
    if (!deps.spotifyOAuth) throw new Error('Spotify OAuth 未配置');
    return deps.spotifyOAuth.start();
  });
  safe('nebula:login:spotify:status', async () => {
    if (!deps.spotifyOAuth) return false;
    return deps.spotifyOAuth.status();
  });
  safe('nebula:login:qq:window', async () => {
    if (!deps.qqLoginWindow) throw new Error('QQ 登录窗口不可用');
    return deps.qqLoginWindow();
  });
  safe('nebula:login:kugou:window', async () => {
    if (!deps.kugouLoginWindow) throw new Error('酷狗登录窗口不可用');
    return deps.kugouLoginWindow();
  });
  safe('nebula:login:kuwo:window', async () => {
    if (!deps.kuwoLoginWindow) throw new Error('酷我登录窗口不可用');
    return deps.kuwoLoginWindow();
  });
  safe('nebula:login:applemusic:window', async () => {
    if (!deps.applemusicLoginWindow) throw new Error('Apple Music 登录窗口不可用');
    return deps.applemusicLoginWindow();
  });
}
