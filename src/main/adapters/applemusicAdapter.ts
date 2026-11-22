import type { CookieStore } from '../cookieStore';
import type { HttpClient } from '../http';
import type { Lyric, Playlist, PlaylistSummary, PlatformAdapter, SongUrl, Track } from '../types';
import { withRequestScope } from '../requestScope';

/*
 * Apple Music（applemusic）。
 * Apple 的接口要「开发者令牌 + 用户令牌」，两个令牌都只在 music.apple.com 官方页面里：
 * 主进程开一个独立分区的页面（electron/appleMusicEngine.cjs），在页面里用 MusicKit 发请求，只把精简后的结果带回来。
 * 这里不碰任何令牌：适配器通过可注入的「桥」（bridge）读数据，Electron 启动时注入页面引擎，纯 Node 测试注入假的。
 * 第一阶段：能登录、读我的歌单、读歌单内容；不取 Apple 音频（有 DRM），播放与歌词走跨平台兜底。
 */

export const APPLEMUSIC_AUTH_EXPIRED = 'Apple Music 登录已过期，请重新登录';
export const APPLEMUSIC_NOT_READY = 'Apple Music 页面还没准备好，请稍后再试';
export const APPLEMUSIC_NO_SUBSCRIPTION = '这个 Apple ID 没有有效的 Apple Music 订阅，Apple 不开放资料库（我的歌单）；公开歌单链接仍可导入';
export const APPLEMUSIC_RESTRICTED = 'Apple Music 拒绝了这次请求（地区或权益限制），不影响登录状态';

/** 我的歌单翻页上限（每页 100 个）。 */
export const APPLEMUSIC_LIST_MAX_PAGES = 20;
/** 歌单曲目翻页上限（每页 100 首）。 */
export const APPLEMUSIC_TRACK_MAX_PAGES = 60;
const PAGE_SIZE = 100;

/** 页面里的登录已失效（401）。 */
export class AppleMusicAuthExpired extends Error {
  constructor() {
    super(APPLEMUSIC_AUTH_EXPIRED);
    this.name = 'AppleMusicAuthExpired';
  }
}

/** 页面还没准备好（没有桥、MusicKit 没就绪）：不是掉登录。 */
export class AppleMusicNotReady extends Error {
  constructor() {
    super(APPLEMUSIC_NOT_READY);
    this.name = 'AppleMusicNotReady';
  }
}

/** 没有有效订阅：资料库接口一律 400 / 40015；不是掉登录。 */
export class AppleMusicNoSubscription extends Error {
  constructor() {
    super(APPLEMUSIC_NO_SUBSCRIPTION);
    this.name = 'AppleMusicNoSubscription';
  }
}

/** 403：这一次请求受限（地区、权益、这首歌），不是掉登录。 */
export class AppleMusicRestricted extends Error {
  constructor() {
    super(APPLEMUSIC_RESTRICTED);
    this.name = 'AppleMusicRestricted';
  }
}

/** 其余 HTTP 错误（带状态码，供调用方区分 404）。 */
export class AppleMusicHttpError extends Error {
  constructor(public status: number) {
    super(`Apple Music 请求失败${status ? `（HTTP ${status}）` : ''}`);
    this.name = 'AppleMusicHttpError';
  }
}

/** 页面里精简后的资源（只有白名单字段，见 appleMusicEngine.cjs）。 */
export interface AppleMusicResource {
  id?: string;
  type?: string;
  href?: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    curatorName?: string;
    durationInMillis?: number;
    artwork?: { url?: string };
    isrc?: string;
    playParams?: { id?: string; kind?: string; catalogId?: string; isLibrary?: boolean };
    tags?: string[];
    description?: { standard?: string };
    trackCount?: number;
    canEdit?: boolean;
    isPublic?: boolean;
    lastModifiedDate?: string;
    /** 逐字歌词 TTML（syllable-lyrics 接口；单个上限 2MB，页面里超了就丢弃）。 */
    ttml?: string;
    /** 带翻译 / 罗马音的 TTML（请求带 extend=ttmlLocalizations 且带 l= 语言时才有）。 */
    ttmlLocalizations?: string;
  };
  /** 资料库曲目带 include=catalog 时，对应的目录曲目（页面里只留 id 和 isrc）。 */
  relationships?: { catalog?: { data?: Array<{ id?: string; attributes?: { isrc?: string } }> } };
}
export interface AppleMusicResponse {
  status: number;
  data?: AppleMusicResource[];
  next?: string;
  total?: number;
  errors?: Array<{ code?: string; status?: string }>;
  meta?: { subscription?: { active?: boolean } };
}
export interface AppleMusicRequest {
  path: string;
  query?: Record<string, string | number>;
}
export type AppleMusicBridgeResult = AppleMusicResponse | { notReady: true };
export interface AppleMusicBridge {
  call(req: AppleMusicRequest): Promise<AppleMusicBridgeResult>;
  /** 批量并行读（页面里限并发）；单项被拒为 null。没实现的桥就不补曲目数。 */
  callMany?(reqs: AppleMusicRequest[]): Promise<Array<AppleMusicResponse | null> | { notReady: true }>;
}

/** 一次批量最多几张歌单（与 appleMusicEngine.cjs 的 BATCH_MAX 一致）。 */
const COUNT_BATCH = 60;
/** 歌单曲目数缓存多久（用户可能在手机上改歌单，不能一直用旧数）。 */
const COUNT_TTL_MS = 5 * 60 * 1000;
/** 拉曲目数最多等多久；超时就不显示数量，不拖慢歌单列表。 */
const COUNT_BUDGET_MS = 8000;

/** 路径里的 ID 段：字母数字和 . _ -，且不能含 ..（防止拼出上级路径）。 */
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
function segment(value: unknown, what: string): string {
  const s = String(value ?? '');
  if (!SEGMENT_RE.test(s) || s.includes('..')) throw new Error(`Apple Music ${what} 不合法`);
  return s;
}
const STOREFRONT_RE = /^[a-z]{2}$/;

/** 封面模板（{w}x{h} / {f} / {c}）换成具体尺寸；只接受 http(s)。 */
export function appleArtworkUrl(template: string | undefined, size: number): string {
  const raw = String(template ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw
    .replace(/^http:\/\//i, 'https://')
    .replace(/\{w\}x\{h\}/g, `${size}x${size}`)
    .replace(/\{w\}/g, String(size))
    .replace(/\{h\}/g, String(size))
    .replace(/\{c\}/g, 'bb')
    .replace(/\{f\}/g, 'jpg');
}

/** 从 `next`（相对地址，如 `/v1/...?offset=100`）取下一页的 offset；取不到返回 null。 */
export function appleNextOffset(next: string | undefined): number | null {
  if (!next) return null;
  try {
    const raw = new URL(next, 'https://api.music.apple.com').searchParams.get('offset');
    return raw && /^\d+$/.test(raw) ? Number(raw) : null;
  } catch {
    return null;
  }
}

/** 曲目（资料库曲目或目录曲目）→ 统一 Track；没有标题的丢掉。 */
export function mapAppleTrack(item: AppleMusicResource, storefront?: string): Track | null {
  const a = item?.attributes;
  const rawId = String(item?.id ?? '');
  if (!a?.name || !rawId) return null;
  const pp = a.playParams;
  // 资料库曲目 id 是 i.（云端上传 / 导入）或 a.（添加自目录）开头；类型是 library-songs / library-music-videos
  const isLibrary = pp?.isLibrary === true || /^[ia]\./.test(rawId) || /^library-/.test(item.type ?? '');
  const catalog = item.relationships?.catalog?.data?.[0];
  const catalogId = pp?.catalogId || catalog?.id || (!isLibrary ? rawId : '') || '';
  const key = catalogId || rawId;
  const extra: Record<string, unknown> = {
    // 资料库曲目本身没有 isrc，要从 include=catalog 带回的目录曲目里取
    isrc: a.isrc || catalog?.attributes?.isrc || undefined,
    catalogId: catalogId || undefined,
    libraryId: isLibrary ? rawId : undefined,
  };
  if (storefront) extra.storefront = storefront;
  return {
    id: `applemusic:${key}`,
    title: a.name,
    artist: a.artistName ?? '',
    album: a.albumName ?? '',
    cover: appleArtworkUrl(a.artwork?.url, 1000),
    duration: Math.round(Number(a.durationInMillis) / 1000) || 0,
    platform: 'applemusic',
    sourceId: key,
    originalUrl: '',
    fallbackUrl: '',
    extra,
  };
}

/**
 * Apple Music 页面请求客户端：把操作翻成路径 + 查询，统一错误类型。
 * 桥由外部注入；没有桥或页面没就绪一律「还没准备好」。
 */
export class AppleMusicClient {
  private bridge: AppleMusicBridge | null = null;

  setBridge(bridge: AppleMusicBridge | null): void {
    this.bridge = bridge;
  }

  /** 发一个请求并把失败翻成明确的错误；成功返回精简响应。 */
  async request(path: string, query?: Record<string, string | number>): Promise<AppleMusicResponse> {
    if (!this.bridge) throw new AppleMusicNotReady();
    const res = await this.bridge.call({ path, query });
    if (!res || (res as { notReady?: boolean }).notReady) throw new AppleMusicNotReady();
    const r = res as AppleMusicResponse;
    const errors = Array.isArray(r.errors) ? r.errors : [];
    const status = Number(r.status) || 0;
    // 没有订阅（资料库 / 最近播放）：4xx 也可能以 resolve 的形式回来，只看 errors 里的代码
    if (errors.some((e) => String(e?.code) === '40015')) throw new AppleMusicNoSubscription();
    if (status === 401) throw new AppleMusicAuthExpired();
    if (status === 403) throw new AppleMusicRestricted();
    if (status >= 400 || errors.length) throw new AppleMusicHttpError(status || Number(errors[0]?.status) || 0);
    return r;
  }

  /** 翻页读完（按 `next` 里的 offset 往后走，offset 不前进就停）。 */
  async paged(path: string, baseQuery: Record<string, string | number>, maxPages: number): Promise<AppleMusicResource[]> {
    const out: AppleMusicResource[] = [];
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const res = await this.request(path, { ...baseQuery, limit: PAGE_SIZE, offset });
      out.push(...(res.data ?? []));
      const next = appleNextOffset(res.next);
      if (next === null || next <= offset) break;
      offset = next;
    }
    return out;
  }

  /** 账号地区（两位小写字母）；读不到返回 ''。 */
  async storefront(): Promise<string> {
    const id = (await this.request('/v1/me/storefront')).data?.[0]?.id ?? '';
    return STOREFRONT_RE.test(id) ? id : '';
  }

  /** 社交资料：可能没有（data 为空数组）。 */
  async socialProfile(): Promise<{ nickname: string; avatarUrl: string }> {
    const a = (await this.request('/v1/me/social-profile')).data?.[0]?.attributes;
    return { nickname: a?.name ?? '', avatarUrl: appleArtworkUrl(a?.artwork?.url, 300) };
  }

  /** 订阅是否有效；页面没给就是 undefined。 */
  async subscriptionActive(): Promise<boolean | undefined> {
    const res = await this.request('/v1/me/account', { meta: 'subscription' });
    return res.meta?.subscription?.active;
  }

  async libraryPlaylists(): Promise<AppleMusicResource[]> {
    return this.paged('/v1/me/library/playlists', { extend: 'tags' }, APPLEMUSIC_LIST_MAX_PAGES);
  }

  async libraryPlaylist(id: string): Promise<AppleMusicResource | undefined> {
    return (await this.request(`/v1/me/library/playlists/${segment(id, '歌单 ID')}`)).data?.[0];
  }

  async libraryPlaylistTracks(id: string): Promise<AppleMusicResource[]> {
    return this.paged(`/v1/me/library/playlists/${segment(id, '歌单 ID')}/tracks`, { include: 'catalog' }, APPLEMUSIC_TRACK_MAX_PAGES);
  }

  async catalogPlaylist(storefront: string, id: string): Promise<AppleMusicResource | undefined> {
    return (await this.request(`/v1/catalog/${catalogStorefront(storefront)}/playlists/${segment(id, '歌单 ID')}`)).data?.[0];
  }

  async catalogPlaylistTracks(storefront: string, id: string): Promise<AppleMusicResource[]> {
    return this.paged(`/v1/catalog/${catalogStorefront(storefront)}/playlists/${segment(id, '歌单 ID')}/tracks`, {}, APPLEMUSIC_TRACK_MAX_PAGES);
  }

  /**
   * 资料库歌单的曲目总数：歌单列表接口不给数量，每张歌单读一次 `tracks?limit=1` 的 `meta.total`，
   * 用批量请求在页面里并行跑。桥不支持批量、页面没就绪或单张失败的，结果里就没有那张。
   */
  async libraryPlaylistTrackCounts(ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const valid = ids.filter((id) => LIBRARY_ID_RE.test(id));
    if (!this.bridge?.callMany || !valid.length) return out;
    for (let i = 0; i < valid.length; i += COUNT_BATCH) {
      const chunk = valid.slice(i, i + COUNT_BATCH);
      const res = await this.bridge.callMany(chunk.map((id) => ({ path: `/v1/me/library/playlists/${segment(id, '歌单 ID')}/tracks`, query: { limit: 1 } })));
      if (!Array.isArray(res)) break; // 页面没就绪
      res.forEach((r, k) => {
        const total = r && Number(r.status) < 400 && !r.errors?.length ? Number(r.total) : NaN;
        if (Number.isFinite(total) && total >= 0) out.set(chunk[k]!, total);
      });
    }
    return out;
  }

  /**
   * 目录曲目的逐字歌词 TTML：带 l=zh-Hans-CN&extend=ttmlLocalizations 时优先用 ttmlLocalizations（含中文翻译），
   * 没有就用 ttml。404（没有歌词）返回 null，其他错误照常抛。
   */
  async syllableLyrics(storefront: string, catalogId: string): Promise<string | null> {
    try {
      const res = await this.request(`/v1/catalog/${catalogStorefront(storefront)}/songs/${segment(catalogId, '曲目 ID')}/syllable-lyrics`, {
        l: 'zh-Hans-CN',
        extend: 'ttmlLocalizations',
      });
      const a = res.data?.[0]?.attributes;
      const text = a?.ttmlLocalizations || a?.ttml;
      return typeof text === 'string' && text ? text : null;
    } catch (err) {
      if (err instanceof AppleMusicHttpError && err.status === 404) return null;
      throw err;
    }
  }

  /** 目录搜歌（只要歌曲）：结果在响应体 results.songs.data，页面里已放进 data。 */
  async searchCatalogSongs(storefront: string, term: string, limit = 8): Promise<AppleMusicResource[]> {
    const q = String(term ?? '').trim().slice(0, 150);
    if (!q) return [];
    const res = await this.request(`/v1/catalog/${catalogStorefront(storefront)}/search`, {
      term: q,
      types: 'songs',
      limit: Math.max(1, Math.min(25, Math.floor(limit) || 8)),
    });
    return res.data ?? [];
  }

  /** 资料库歌单的第一页第一首（补封面用）。 */
  async libraryPlaylistFirstTrack(id: string): Promise<AppleMusicResource | undefined> {
    return (await this.request(`/v1/me/library/playlists/${segment(id, '歌单 ID')}/tracks`, { limit: 1 })).data?.[0];
  }
}

function catalogStorefront(sf: string): string {
  if (!STOREFRONT_RE.test(sf)) throw new Error('Apple Music 地区代码不合法');
  return sf;
}

const LIBRARY_ID_RE = /^p\.[A-Za-z0-9._-]+$/;
const CATALOG_ID_RE = /^([a-z]{2}):(pl\.[A-Za-z0-9._-]+)$/;

/**
 * Apple Music 适配器：资料库歌单（`p.` 开头）和目录歌单（`{地区}:pl.xxx`，来自公开链接）。
 * 不提供音频直链与歌词，播放交给跨平台兜底；不实现 getAuthStatus（登录过期不该拒播）。
 */
export class AppleMusicAdapter implements PlatformAdapter {
  readonly platform = 'applemusic' as const;
  readonly client = new AppleMusicClient();
  /** 账号地区缓存（读到过一次就不再读）；只用于曲目里记下地区，给分享链接用。 */
  private storefrontCache = '';
  /** 资料库歌单曲目数缓存：id → { 数量, 读到的时间 }。 */
  private trackCounts = new Map<string, { count: number; at: number }>();

  constructor(_http?: HttpClient, private cookies?: CookieStore) {}

  async fetchPlaylist(playlistId: string): Promise<Playlist> {
    const id = String(playlistId ?? '').trim();
    const catalog = id.match(CATALOG_ID_RE);
    if (!catalog && !LIBRARY_ID_RE.test(id)) throw new Error('Apple Music 歌单 ID 不合法');
    return withRequestScope(60000, async () => {
      try {
        if (catalog) {
          const [, sf, pl] = catalog;
          const info = await this.client.catalogPlaylist(sf!, pl!);
          const rows = await this.client.catalogPlaylistTracks(sf!, pl!);
          return this.toPlaylist(id, info, rows, sf);
        }
        const [info, rows] = await Promise.all([this.client.libraryPlaylist(id), this.client.libraryPlaylistTracks(id)]);
        const playlist = this.toPlaylist(id, info, rows, await this.accountStorefront());
        this.trackCounts.set(id, { count: rows.length, at: Date.now() }); // 导入过的歌单顺手记下实际数量
        return playlist;
      } catch (err) {
        if (err instanceof AppleMusicHttpError && err.status === 404) throw new Error('Apple Music 歌单不存在或未公开');
        throw err;
      }
    });
  }

  private toPlaylist(id: string, info: AppleMusicResource | undefined, rows: AppleMusicResource[], storefront?: string): Playlist {
    const seen = new Set<string>();
    const tracks: Track[] = [];
    for (const row of rows) {
      const t = mapAppleTrack(row, storefront);
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      tracks.push(t);
    }
    const a = info?.attributes;
    return {
      id,
      platform: 'applemusic',
      name: a?.name || `Apple Music 歌单 ${id}`,
      cover: appleArtworkUrl(a?.artwork?.url, 600) || tracks.find((t) => t.cover)?.cover || '',
      description: a?.description?.standard || undefined,
      tracks,
    };
  }

  /**
   * 关键词搜歌（#232）：走目录搜索 `/v1/catalog/{地区}/search`（页面引擎已放行结果）。
   * 只在 Apple Music 登录可用时参与：没有登录标记时直接返回空，不让全网搜索白等一条必挂的请求。
   */
  async searchSongs(keyword: string, pageSize = 10): Promise<Track[]> {
    const term = String(keyword ?? '').trim();
    if (!term) return [];
    // 未登录时页面引擎根本没初始化，这里先挡住，省一次注定失败的调用。
    if (!this.cookies?.get('applemusic')?.cookies) return [];
    const storefront = await this.accountStorefront();
    const rows = await this.client.searchCatalogSongs(storefront || 'cn', term, Math.min(25, pageSize));
    return rows
      .map((r) => mapAppleTrack(r, storefront || 'cn'))
      .filter((t): t is Track => !!t)
      .slice(0, pageSize);
  }

  /** 账号地区：读不到不影响主流程（分享链接退回 cn）。 */
  private async accountStorefront(): Promise<string> {
    if (this.storefrontCache) return this.storefrontCache;
    try {
      this.storefrontCache = await this.client.storefront();
    } catch {
      /* 读不到就不记 */
    }
    return this.storefrontCache;
  }

  /** 歌单没有封面时补的图：只读资料库歌单的第一首。 */
  async fetchPlaylistFirstCover(playlistId: string): Promise<string> {
    const id = String(playlistId ?? '').trim();
    if (!LIBRARY_ID_RE.test(id)) return '';
    const row = await this.client.libraryPlaylistFirstTrack(id);
    return (row && mapAppleTrack(row)?.cover) || '';
  }

  /** 播放：第一阶段不取 Apple 音频（有 DRM），返回 null 交给 SongResolver 跨平台兜底。 */
  async fetchSongUrl(_songId?: string, _albumId?: string, _quality?: string, _extra?: Record<string, unknown>): Promise<SongUrl | null> {
    return null;
  }

  async fetchLyric(): Promise<Lyric | null> {
    return null;
  }

  /**
   * 我的歌单：资料库全量翻页；「喜爱」（tags 含 favorited）排前面，其余保持原顺序。
   * 没有订阅 / 登录过期 / 页面没就绪都直接抛带中文消息的错误，由界面显示。
   */
  async fetchMyPlaylists(): Promise<PlaylistSummary[]> {
    const rows = await this.client.libraryPlaylists();
    const seen = new Set<string>();
    const list: Array<PlaylistSummary & { favorited: boolean }> = [];
    for (const row of rows) {
      const id = String(row.id ?? '');
      if (!LIBRARY_ID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      list.push({
        id,
        name: row.attributes?.name || '未命名歌单',
        cover: appleArtworkUrl(row.attributes?.artwork?.url, 600),
        // 资料库歌单列表不带曲目数；下面另外批量读，读不到保持 0（界面对 Apple Music 的 0 不显示数量）
        trackCount: Number(row.attributes?.trackCount) || 0,
        favorited: !!row.attributes?.tags?.includes('favorited'),
      });
    }
    await this.fillTrackCounts(list);
    return [...list.filter((p) => p.favorited), ...list.filter((p) => !p.favorited)].map(({ favorited: _f, ...p }) => p);
  }

  /** 补曲目数：缓存里 5 分钟内的直接用，其余批量读；最多等 8 秒，失败不影响歌单列表。 */
  private async fillTrackCounts(list: PlaylistSummary[]): Promise<void> {
    const fresh = (id: string) => {
      const c = this.trackCounts.get(id);
      return c && Date.now() - c.at < COUNT_TTL_MS ? c.count : undefined;
    };
    const missing = list.filter((p) => !p.trackCount && fresh(p.id) === undefined).map((p) => p.id);
    if (missing.length) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      // 结果一到就写缓存：超时没赶上这一次的，下次刷新歌单时就有了
      const job = this.client.libraryPlaylistTrackCounts(missing).then((counts) => {
        const at = Date.now();
        counts.forEach((count, id) => this.trackCounts.set(id, { count, at }));
      });
      try {
        await Promise.race([
          job,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, COUNT_BUDGET_MS);
          }),
        ]);
      } catch {
        /* 读不到就不显示数量 */
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    for (const p of list) {
      if (!p.trackCount) p.trackCount = fresh(p.id) ?? 0;
    }
  }
}

/** 歌单链接：music.apple.com/{地区}/playlist/{任意名字}/pl.xxx（名字可省略、可带查询串）→ 目录歌单 ID `{地区}:pl.xxx`。 */
export function parseAppleMusicPlaylistUrl(input: string): { platform: 'applemusic'; id: string } | null {
  const m = String(input ?? '')
    .trim()
    .match(/^(?:https?:\/\/)?music\.apple\.com\/([A-Za-z]{2})\/playlist\/(?:[^/?#]*\/)?(pl\.[A-Za-z0-9._-]+)(?:[/?#]|$)/i);
  if (!m) return null;
  return { platform: 'applemusic', id: `${m[1]!.toLowerCase()}:${m[2]}` };
}
