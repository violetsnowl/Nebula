import type { HttpClient } from '../http';
import type { Lyric } from '../types';
import { fromTtml } from '../parsers/ttml';
import { LYRIC_ID_ORDER, normalizeLyricId, type LyricIdKey, type LyricIds } from './lyricSourceIds';

/*
 * AMLL 社区逐字歌词库（api.amll.dev）客户端。
 * GET /v1/lyrics/get?<键>=<值>：命中 200 + { status, data: { …id 列表…, lyrics: "<tt …>" } }；没收录 404。
 * 只带歌曲 id，不带 Cookie / 账号信息；单次 3 秒；同一首最多 3 次请求，按 ncm → qq → apple → spotify → isrc，命中即停。
 */

const BASE_URL = 'https://api.amll.dev/v1/lyrics/get';
const QUERY_KEY: Record<LyricIdKey, string> = { ncm: 'ncmMusicId', qq: 'qqMusicId', apple: 'appleMusicId', spotify: 'spotifyId', isrc: 'isrc' };
const RECORD_KEY: Record<LyricIdKey, string> = { ncm: 'ncmMusicIds', qq: 'qqMusicIds', apple: 'appleMusicIds', spotify: 'spotifyIds', isrc: 'isrcs' };

const REQUEST_TIMEOUT_MS = 3000;
const MAX_REQUESTS = 3;
const HIT_TTL_MS = 24 * 3600_000;
const MISS_TTL_MS = 6 * 3600_000;
const BREAKER_MS = 5 * 60_000;
const CACHE_MAX = 1000;
/** 响应体上限（字符）；TTML 本身另有 2MB 上限。 */
const BODY_MAX = 4 * 1024 * 1024;

/** AMLL 记录里列出的各类 id。 */
export type AmllRecord = Record<LyricIdKey, string[]>;
export interface AmllHit {
  lyric: Lyric;
  /** 命中时用的是哪一类 id。 */
  matchedBy: LyricIdKey;
  /** 用来查的那个 id。 */
  id: string;
  record: AmllRecord;
}
/** LyricService 依赖的最小接口，测试里可以注入假的。 */
export interface AmllSource {
  lookup(ids: LyricIds): Promise<AmllHit | null>;
}
export interface AmllOptions {
  timeoutMs?: number;
  /** 测试用：可控时钟。 */
  now?: () => number;
  baseUrl?: string;
}

interface CacheEntry {
  at: number;
  ttl: number;
  value: { lyric: Lyric; record: AmllRecord } | null;
}

function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' || typeof x === 'number').map(String).slice(0, 20) : [];
}

export class AmllLyrics implements AmllSource {
  private cache = new Map<string, CacheEntry>();
  private blockedUntil = 0;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly baseUrl: string;

  /** http 只用 requestRaw；这里显式传空 Cookie，请求里不会有任何账号信息。 */
  constructor(private http: Pick<HttpClient, 'requestRaw'>, options: AmllOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.baseUrl = options.baseUrl ?? BASE_URL;
  }

  async lookup(query: LyricIds): Promise<AmllHit | null> {
    let requests = 0;
    for (const key of LYRIC_ID_ORDER) {
      const id = normalizeLyricId(key, query[key]);
      if (!id) continue;
      const cached = this.cacheGet(`${key}:${id}`);
      if (cached !== undefined) {
        if (cached) return { ...cached, matchedBy: key, id };
        continue;
      }
      if (this.now() < this.blockedUntil) continue; // 熔断中：只用缓存
      if (requests >= MAX_REQUESTS) break;
      requests++;
      let outcome: CacheEntry['value'] | 'skip';
      try {
        outcome = await this.fetchOne(key, id);
      } catch {
        break; // 超时 / 取消 / 网络错误：不缓存，也不再试后面的 id
      }
      if (outcome === 'skip') continue;
      this.cacheSet(key, id, outcome);
      if (outcome) return { ...outcome, matchedBy: key, id };
    }
    return null;
  }

  /** 单次请求：命中返回内容，没收录 / 内容不可用返回 null，状态异常（不缓存）返回 'skip'。 */
  private async fetchOne(key: LyricIdKey, id: string): Promise<CacheEntry['value'] | 'skip'> {
    const url = `${this.baseUrl}?${QUERY_KEY[key]}=${encodeURIComponent(id)}`;
    const res = await this.http.requestRaw(url, { platform: 'applemusic', cookie: '', timeoutMs: this.timeoutMs, headers: { Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      this.blockedUntil = this.now() + BREAKER_MS;
      return 'skip';
    }
    if (res.status !== 200) return 'skip';
    if (typeof res.text !== 'string' || res.text.length > BODY_MAX) return null;
    let data: Record<string, unknown> | undefined;
    try {
      data = (JSON.parse(res.text) as { data?: Record<string, unknown> })?.data;
    } catch {
      return null;
    }
    if (!data || typeof data !== 'object' || typeof data.lyrics !== 'string') return null;
    const record = {} as AmllRecord;
    for (const k of LYRIC_ID_ORDER) record[k] = ids(data[RECORD_KEY[k]]);
    // 防串：记录里必须确实列着我们查的这个 id
    const listed = record[key].map((v) => (key === 'isrc' ? v.toUpperCase() : v));
    if (!listed.includes(id)) return null;
    const lyric = fromTtml(data.lyrics, 'amll');
    return lyric ? { lyric, record } : null;
  }

  private cacheGet(k: string): CacheEntry['value'] | undefined {
    const e = this.cache.get(k);
    if (!e) return undefined;
    if (this.now() - e.at >= e.ttl) {
      this.cache.delete(k);
      return undefined;
    }
    return e.value;
  }

  private put(k: string, value: CacheEntry['value'], ttl: number): void {
    this.cache.delete(k);
    this.cache.set(k, { at: this.now(), ttl, value });
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
  }

  private cacheSet(key: LyricIdKey, id: string, value: CacheEntry['value']): void {
    this.put(`${key}:${id}`, value, value ? HIT_TTL_MS : MISS_TTL_MS);
    if (!value) return;
    // 命中的记录同时列着别的 id：之后按它们查也不用再请求
    for (const k of LYRIC_ID_ORDER) {
      for (const other of value.record[k].slice(0, 5)) {
        const norm = normalizeLyricId(k, other);
        if (norm && !this.cache.has(`${k}:${norm}`)) this.put(`${k}:${norm}`, value, HIT_TTL_MS);
      }
    }
  }
}
