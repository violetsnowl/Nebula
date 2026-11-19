import type { AppleMusicResource } from '../adapters/applemusicAdapter';
import { mapAppleTrack } from '../adapters/applemusicAdapter';
import { fromTtml } from '../parsers/ttml';
import type { Lyric, Platform, Track } from '../types';
import { requestScope, withRequestScope } from '../requestScope';
import { identityText, recordingMatch, searchKeyword } from './recordingMatch';
import { appleCatalogIdOf } from './lyricSourceIds';

/*
 * Apple Music 逐字歌词：经页面引擎（AppleMusicClient 的桥）读 syllable-lyrics，令牌不出页面。
 * - CookieStore 里没有 applemusic 标记（用户没登录过）：直接返回 null，不调用桥，不唤起页面；
 * - 有 Apple 目录 id（track 或 origin 是 Apple 曲目）直接取；否则用「歌名 + 第一个歌手」搜目录，
 *   候选用 recordingMatch 判同一录音，取最好的一个；
 * - 地区用账号地区（进程内缓存）；总时限 4 秒；命中缓存 24 小时、没有歌词 6 小时、最多 1000 条。
 */

const TOTAL_MS = 4000;
const HIT_TTL_MS = 24 * 3600_000;
const MISS_TTL_MS = 6 * 3600_000;
const CACHE_MAX = 1000;

/** AppleMusicClient 里歌词用到的那几个方法（测试里注入假的）。 */
export interface AppleLyricsClient {
  storefront(): Promise<string>;
  syllableLyrics(storefront: string, catalogId: string): Promise<string | null>;
  searchCatalogSongs(storefront: string, term: string, limit?: number): Promise<AppleMusicResource[]>;
}
export interface AppleLyricHit {
  lyric: Lyric;
  catalogId: string;
  /** id：直接用目录 id；search：搜目录 + recordingMatch。 */
  via: 'id' | 'search';
  /** 目录里那首的时长（秒），已知才有。 */
  duration?: number;
}
/** LyricService 依赖的最小接口。 */
export interface AppleLyricsSource {
  lookup(track: Track, origin?: Track): Promise<AppleLyricHit | null>;
}
export interface AppleLyricsOptions {
  totalMs?: number;
  now?: () => number;
}

interface CacheEntry {
  at: number;
  ttl: number;
  value: AppleLyricHit | null;
}

export class AppleMusicLyrics implements AppleLyricsSource {
  private cache = new Map<string, CacheEntry>();
  private storefrontCache = '';
  private readonly totalMs: number;
  private readonly now: () => number;

  constructor(
    private client: AppleLyricsClient,
    private cookies: { get(platform: Platform): unknown },
    options: AppleLyricsOptions = {},
  ) {
    this.totalMs = options.totalMs ?? TOTAL_MS;
    this.now = options.now ?? Date.now;
  }

  async lookup(track: Track, origin?: Track): Promise<AppleLyricHit | null> {
    // 没有登录标记：不碰桥（桥会唤起 music.apple.com 页面）
    if (!this.cookies.get('applemusic')) return null;
    const catalogId = appleCatalogIdOf(origin) ?? appleCatalogIdOf(track);
    const key = catalogId ? `id:${catalogId}` : `search:${identityText(track.title)}|${(track.artists?.length ? track.artists : [track.artist]).map(identityText).join('+')}|${Math.round(Number(track.duration) || 0)}`;
    const cached = this.cacheGet(key);
    if (cached !== undefined) return cached;
    try {
      const value = await withRequestScope(this.totalMs, () => this.fetch(track, catalogId));
      this.cacheSet(key, value.hit, value.hit ? HIT_TTL_MS : MISS_TTL_MS);
      return value.hit;
    } catch {
      return null; // 页面没就绪 / 登录过期 / 无订阅 / 超时 / 取消：不缓存
    }
  }

  private async storefront(): Promise<string> {
    if (this.storefrontCache) return this.storefrontCache;
    const sf = await this.client.storefront();
    if (!sf) throw new Error('读不到 Apple Music 账号地区');
    return (this.storefrontCache = sf);
  }

  private async fetch(track: Track, knownId: string | undefined): Promise<{ hit: AppleLyricHit | null }> {
    const sf = await this.storefront();
    let catalogId = knownId;
    let via: AppleLyricHit['via'] = 'id';
    let duration: number | undefined;
    if (!catalogId) {
      via = 'search';
      const rows = await this.client.searchCatalogSongs(sf, searchKeyword(track), 8);
      const best = rows
        .map((row) => mapAppleTrack(row, sf))
        .filter((t): t is Track => !!t)
        .map((candidate) => ({ candidate, m: recordingMatch(candidate, track) }))
        .filter((x) => x.m.ok)
        .sort((a, b) => a.m.rank - b.m.rank || b.m.score - a.m.score)[0];
      if (!best) return { hit: null };
      catalogId = appleCatalogIdOf(best.candidate);
      if (!catalogId) return { hit: null };
      duration = best.candidate.duration > 0 ? best.candidate.duration : undefined;
    }
    if (requestScope()?.signal.aborted) throw new Error('已取消');
    const ttml = await this.client.syllableLyrics(sf, catalogId);
    const lyric = ttml ? fromTtml(ttml, 'applemusic') : null;
    return { hit: lyric ? { lyric, catalogId, via, ...(duration ? { duration } : {}) } : null };
  }

  private cacheGet(k: string): AppleLyricHit | null | undefined {
    const e = this.cache.get(k);
    if (!e) return undefined;
    if (this.now() - e.at >= e.ttl) {
      this.cache.delete(k);
      return undefined;
    }
    return e.value;
  }

  private cacheSet(k: string, value: AppleLyricHit | null, ttl: number): void {
    this.cache.delete(k);
    this.cache.set(k, { at: this.now(), ttl, value });
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
  }
}
