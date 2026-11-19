import crypto from 'node:crypto';
import type { CookieStore } from '../cookieStore';
import type { HttpClient } from '../http';
import type { Lyric, Playlist, PlaylistSummary, PlatformAdapter, SongUrl, Track } from '../types';
import { cleanMetadataText } from '../parsers/metadataText';
import { identityText } from '../services/recordingMatch';
import { requestScope, throwIfCancelled, withRequestScope } from '../requestScope';

/*
 * YouTube Music（ytmusic）。
 * Google 现在只认 YouTube 电视端（TVHTML5）身份签发的 OAuth 令牌，所以整套协议走电视端 + 设备码登录。
 * 请求参数参考 youtubei.js（MIT），代码按 TypeScript 自写，不引入任何依赖。
 * 第一阶段：能登录、读我的歌单、读歌单内容；不取 YouTube 音频，播放与歌词走跨平台兜底。
 *
 * 安全约定：客户端身份、设备码、访问令牌、续期令牌都不许写进日志、不许落盘（令牌只存 CookieStore）。
 */

const TV_ORIGIN = 'https://www.youtube.com';
const API = `${TV_ORIGIN}/youtubei/v1`;
const DEVICE_CODE_URL = `${TV_ORIGIN}/o/oauth2/device/code`;
const TOKEN_URL = `${TV_ORIGIN}/o/oauth2/token`;
const DEFAULT_VERIFICATION_URL = 'https://www.google.com/device';
const SCOPE = 'http://gdata.youtube.com https://www.googleapis.com/auth/youtube-paid-content';
export const YTMUSIC_UA = 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version';
const CLIENT_VERSION = '7.20260311.12.00';
/** 访问令牌实测有效约 23 小时；写入超过 50 分钟就在请求前先续，少走一次 401。 */
export const YTMUSIC_RENEW_AFTER_MS = 50 * 60_000;
export const YTMUSIC_AUTH_EXPIRED = 'YouTube Music 登录已过期，请重新登录';
/** 歌单翻页上限（实测「赞过的视频」175 首 = 12 页，每页 15 首）。 */
export const YTMUSIC_MAX_PAGES = 60;
const LIST_MAX_PAGES = 5;
/** 「赞过的视频」（含用户在 YouTube Music 里点赞的歌）：我们把它排在歌单列表第一位。 */
export const YTMUSIC_LIKED_ID = 'LL';
const LIKED_NAME = '赞过的视频';
/** 「赞过的视频」里超过这个时长（秒）的视频当作非歌曲（播客、实况）丢掉。 */
export const YTMUSIC_LIKED_MAX_SEC = 15 * 60;

/** 登录令牌失效且无法续期（invalid_grant，或续期后仍 401）。 */
export class YtmusicAuthExpired extends Error {
  constructor() {
    super(YTMUSIC_AUTH_EXPIRED);
    this.name = 'YtmusicAuthExpired';
  }
}

export interface YtmusicRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  /** 共用请求（取客户端身份、换令牌、续期）：不跟某一个调用方的取消走，免得它被取消时连带别人一起失败。 */
  shared?: boolean;
  timeoutMs?: number;
}
export interface YtmusicResponse { status: number; text: string }
export type YtmusicTransport = (req: YtmusicRequest) => Promise<YtmusicResponse>;

/** 默认传输层：全局 fetch；非共用请求挂在当前请求作用域上（可取消、受总截止时间约束）。 */
export const defaultYtmusicTransport: YtmusicTransport = async (req) => {
  const run = async (signal: AbortSignal): Promise<YtmusicResponse> => {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal });
    return { status: res.status, text: await res.text() };
  };
  if (req.shared) return run(AbortSignal.timeout(req.timeoutMs ?? 10000));
  return withRequestScope(req.timeoutMs ?? 12000, async () => {
    throwIfCancelled();
    return run(requestScope()!.signal);
  });
};

export interface YtmusicClientIdentity { clientId: string; clientSecret: string }
export interface YtmusicDeviceCode { deviceCode: string; userCode: string; verificationUrl: string; expiresIn: number; interval: number }
export type YtmusicExchange =
  | { state: 'ok'; accessToken: string; refreshToken: string; expiresIn: number }
  | { state: 'pending' | 'slow_down' | 'expired' | 'denied' };
export interface YtmusicAccountInfo { nickname: string; avatarUrl: string; isVip: boolean; handle: string }

/** 从电视端页面取客户端脚本地址（相对 www.youtube.com）。只接受 youtube.com 下的 https 脚本。 */
export function extractYtmusicScriptUrl(html: string): string | null {
  const src = String(html ?? '').match(/<script\s+id="base-js"\s+src="([^"]+)"/)?.[1];
  if (!src) return null;
  try {
    const url = new URL(src.replace(/&amp;/g, '&'), TV_ORIGIN);
    if (url.protocol !== 'https:' || !/(?:^|\.)youtube\.com$/i.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** 从电视端脚本里取客户端身份（clientId / clientSecret）。取不到返回 null。 */
export function extractYtmusicClientIdentity(script: string): YtmusicClientIdentity | null {
  const m = String(script ?? '').match(/clientId:"(?<client_id>[^"]+)",[^"]*?:"(?<client_secret>[^"]+)"/);
  const clientId = m?.groups?.client_id, clientSecret = m?.groups?.client_secret;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const asRecord = (v: unknown): Record<string, any> | undefined => (v && typeof v === 'object' ? (v as Record<string, any>) : undefined);

function parseJson(text: string): Record<string, any> {
  try {
    return asRecord(JSON.parse(text)) ?? {};
  } catch {
    return {};
  }
}

/** YouTube 文本对象：simpleText 或 runs 拼接。 */
function textOf(v: unknown): string {
  const o = asRecord(v);
  if (!o) return typeof v === 'string' ? v : '';
  if (typeof o.simpleText === 'string') return o.simpleText;
  return Array.isArray(o.runs) ? o.runs.map((r: any) => (typeof r?.text === 'string' ? r.text : '')).join('') : '';
}

type Thumb = { url?: string; width?: number; height?: number };
function largestThumb(thumbs: unknown): string {
  const list: Thumb[] = Array.isArray(thumbs) ? thumbs : [];
  const best = [...list]
    .filter((t) => typeof t?.url === 'string' && t.url)
    .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];
  if (!best?.url) return '';
  return best.url.startsWith('//') ? `https:${best.url}` : best.url;
}

/** 递归收集 tileRenderer（不钻进磁贴内部）。 */
function collectTiles(node: unknown, out: Record<string, any>[] = [], depth = 0): Record<string, any>[] {
  if (!node || typeof node !== 'object' || depth > 40) return out;
  if (Array.isArray(node)) {
    for (const x of node) collectTiles(x, out, depth + 1);
    return out;
  }
  const o = node as Record<string, any>;
  if (o.tileRenderer && typeof o.tileRenderer === 'object') out.push(o.tileRenderer);
  for (const [k, v] of Object.entries(o)) if (k !== 'tileRenderer') collectTiles(v, out, depth + 1);
  return out;
}

/** 翻页令牌：nextContinuationData.continuation 或 continuationCommand.token（不钻进磁贴）。 */
function findContinuation(node: unknown, depth = 0): string {
  if (!node || typeof node !== 'object' || depth > 40) return '';
  if (Array.isArray(node)) {
    for (const x of node) {
      const t = findContinuation(x, depth + 1);
      if (t) return t;
    }
    return '';
  }
  const o = node as Record<string, any>;
  const direct = o.nextContinuationData?.continuation ?? o.continuationCommand?.token;
  if (typeof direct === 'string' && direct) return direct;
  for (const [k, v] of Object.entries(o)) {
    if (k === 'tileRenderer') continue;
    const t = findContinuation(v, depth + 1);
    if (t) return t;
  }
  return '';
}

/** 歌单页标题（左栏 entityMetadataRenderer.title）。 */
function findPlaylistTitle(node: unknown, depth = 0): string {
  if (!node || typeof node !== 'object' || depth > 40) return '';
  if (Array.isArray(node)) {
    for (const x of node) {
      const t = findPlaylistTitle(x, depth + 1);
      if (t) return t;
    }
    return '';
  }
  const o = node as Record<string, any>;
  if (o.entityMetadataRenderer) {
    const t = textOf(o.entityMetadataRenderer.title).trim();
    if (t) return t;
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'tileRenderer') continue;
    const t = findPlaylistTitle(v, depth + 1);
    if (t) return t;
  }
  return '';
}

/** 「3:45」/「1:02:03」→ 秒；直播等解析不了的返回 0。 */
export function parseYtmusicDuration(text: string): number {
  const parts = String(text ?? '').trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p) && !/^\d+$/.test(p))) return 0;
  return parts.reduce((sum, p) => sum * 60 + Number(p), 0);
}

/* ---------- 标题清洗 ---------- */

/** 括注里只剩这些词（官方 MV / 歌词版 / 音频 / 高清…）才算噪音；(Live) (Remix) (Taylor's Version) 等版本信息不动。 */
const NOISE_WORDS =
  /official|oficial|music|lyrics?|audio|video(?:clip)?|visuali[sz]er|clip|m\/v|\bmv\b|\bpv\b|\bhd\b|\b4k\b|\bhq\b|full|官方完整版|官方|完整版|高清|超清|歌词版|歌詞版|歌词|歌詞|音频|音源|公式|オフィシャル|オリジナル|mv|pv/gi;
const NOISE_BRACKETS = /\(([^()]*)\)|\[([^\[\]]*)\]|【([^【】]*)】|（([^（）]*)）/g;
const NOISE_TAIL = /\s*[|–—-]\s*(?:official\s+(?:music\s+)?(?:video|audio|lyric\s+video|visuali[sz]er|mv)|lyrics?(?:\s+video)?|(?:music|lyric)\s+video)\s*$/i;

function isNoiseNote(note: string): boolean {
  const s = note.trim();
  if (!s) return false;
  return s.toLowerCase().replace(NOISE_WORDS, '').replace(/[\s/|,·•+&\-–—.]/g, '') === '';
}

/** 去掉标题里的 (Official Video) / (Lyric Video) / 【MV】 / 【官方MV】 之类噪音；清完是空的就保留原文。 */
export function cleanYtmusicTitle(raw: string): string {
  const original = cleanMetadataText(raw).replace(/\s+/g, ' ');
  let s = original.replace(NOISE_BRACKETS, (whole, ...g) => {
    const note = g.slice(0, 4).find((x) => typeof x === 'string') ?? '';
    return isNoiseNote(note) ? ' ' : whole;
  });
  s = s.replace(NOISE_TAIL, '');
  s = s.replace(/\s+/g, ' ').replace(/\s+([,，])/g, '$1').trim();
  return s || original;
}

/** 歌手 / 歌名拆分：频道名去掉「 - Topic」；非 Topic 频道且标题形如「A - B」时拆开（频道名出现在右边就倒过来）。 */
export function splitYtmusicTitle(title: string, channel: string): { title: string; artist: string } {
  const isTopic = /\s*-\s*Topic$/i.test(channel);
  let artist = channel.replace(/\s*-\s*Topic$/i, '').trim();
  let name = title;
  if (!isTopic) {
    const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (m) {
      const left = m[1]!.trim(), right = m[2]!.trim();
      const ch = identityText(artist);
      const hit = (s: string) => !!ch && (identityText(s).includes(ch) || (identityText(s).length > 1 && ch.includes(identityText(s))));
      if (left && right) {
        if (!hit(left) && hit(right)) { artist = right; name = left; }
        else { artist = left; name = right; }
      }
    }
  }
  return { title: name || title, artist: artist || '未知歌手' };
}

function videoIdOf(tile: Record<string, any>): string {
  const id = tile.onSelectCommand?.watchEndpoint?.videoId ?? tile.contentId;
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
}

/** 歌单里的一个视频磁贴 → Track；不是视频或没有可用 ID 返回 null。 */
export function mapYtmusicTrack(tile: Record<string, any> | undefined | null): Track | null {
  try {
    if (!tile || tile.contentType !== 'TILE_CONTENT_TYPE_VIDEO') return null;
    const id = videoIdOf(tile);
    const meta = tile.metadata?.tileMetadataRenderer;
    const rawTitle = textOf(meta?.title).trim();
    if (!id || !rawTitle) return null;
    const lines: any[] = Array.isArray(meta?.lines) ? meta.lines : [];
    const channel = textOf(lines[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text).trim();
    const { title, artist } = splitYtmusicTitle(cleanYtmusicTitle(rawTitle), channel);
    const header = tile.header?.tileHeaderRenderer;
    let duration = 0;
    for (const o of Array.isArray(header?.thumbnailOverlays) ? header.thumbnailOverlays : []) {
      const t = o?.thumbnailOverlayTimeStatusRenderer;
      if (t) { duration = parseYtmusicDuration(textOf(t.text)); break; }
    }
    const cover = largestThumb(header?.thumbnail?.thumbnails);
    return {
      id: `ytmusic:${id}`,
      title,
      artist,
      artists: [artist],
      album: '',
      cover,
      coverInfo: cover ? { url: cover, verified: false } : undefined,
      duration,
      platform: 'ytmusic',
      sourceId: id,
      originalUrl: '',
      fallbackUrl: '',
    };
  } catch {
    return null;
  }
}

/** 「N 首歌曲」「N 个视频」「N 首曲目」→ N；解析不到返回 0。 */
function parseCount(text: string): number {
  const m = String(text ?? '').match(/(\d[\d,，]*)\s*(?:首|个|songs?|videos?|tracks?)/i);
  return m ? Number(m[1]!.replace(/[,，]/g, '')) || 0 : 0;
}

/** 歌单磁贴 → 摘要；不是歌单或 ID 不合法返回 null。 */
export function mapYtmusicPlaylistTile(tile: Record<string, any> | undefined | null): PlaylistSummary | null {
  if (!tile || tile.contentType !== 'TILE_CONTENT_TYPE_PLAYLIST') return null;
  const browseId = tile.onSelectCommand?.browseEndpoint?.browseId;
  const id = typeof browseId === 'string' ? browseId.replace(/^VL/, '') : '';
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const meta = tile.metadata?.tileMetadataRenderer;
  const header = tile.header?.tileHeaderRenderer;
  let trackCount = 0;
  for (const o of Array.isArray(header?.thumbnailOverlays) ? header.thumbnailOverlays : []) {
    const t = o?.thumbnailOverlayTimeStatusRenderer?.text;
    if (!t) continue;
    trackCount = parseCount(textOf(t)) || (/^\d+$/.test(String(t.runs?.[0]?.text ?? '').trim()) ? Number(t.runs[0].text) : 0);
    if (trackCount) break;
  }
  if (!trackCount) {
    for (const line of Array.isArray(meta?.lines) ? meta.lines : []) {
      for (const item of Array.isArray(line?.lineRenderer?.items) ? line.lineRenderer.items : []) {
        trackCount = parseCount(textOf(item?.lineItemRenderer?.text));
        if (trackCount) break;
      }
      if (trackCount) break;
    }
  }
  return {
    id,
    name: textOf(meta?.title).trim() || `YouTube 歌单 ${id}`,
    cover: largestThumb(header?.thumbnail?.thumbnails),
    trackCount,
  };
}

/** 是否是我们不列、也不能导入的歌单 ID：稍后观看 WL、赞过的音乐 LM（电视端读不出内容）、RD 开头的合辑（打开报错）。 */
function unsupportedListId(id: string): string {
  if (id === 'WL') return '「稍后观看」不是公开歌单，暂不支持导入';
  if (id === 'LM') return '「赞过的音乐」在 YouTube 电视端读不出内容，请改用「赞过的视频」（它包含你在 YouTube Music 里点赞的歌）';
  if (/^RD/i.test(id)) return '这是 YouTube 自动生成的合辑 / 电台，没法导入，请换成普通歌单链接';
  return '';
}

/** accounts_list 的响应 → 当前账号（优先 isSelected 的那个）。 */
export function parseYtmusicAccount(data: unknown): YtmusicAccountInfo | null {
  const items: Record<string, any>[] = [];
  const walk = (node: unknown, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 20) return;
    if (Array.isArray(node)) { node.forEach((x) => walk(x, depth + 1)); return; }
    const o = node as Record<string, any>;
    if (o.accountItem && typeof o.accountItem === 'object') items.push(o.accountItem);
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(data);
  const item = items.find((i) => i.isSelected) ?? items[0];
  if (!item) return null;
  return {
    nickname: textOf(item.accountName).trim(),
    avatarUrl: largestThumb(item.accountPhoto?.thumbnails),
    isVip: item.shouldShowPremiumLogo === true,
    handle: textOf(item.channelHandle).trim(),
  };
}

/**
 * 电视端协议客户端：客户端身份（进程内缓存）、设备码、令牌续期（全局单飞）、带令牌的 youtubei 调用。
 * 适配器与登录模块共用同一个实例（adapter.client），保证续期只有一个在进行。
 */
export class YtmusicClient {
  private identityCache?: YtmusicClientIdentity;
  private identityPending?: Promise<YtmusicClientIdentity>;
  private renewing?: Promise<'ok' | 'expired' | 'failed'>;
  /** 已确认失效的续期令牌：同一个令牌之后不再尝试；换了新登录自然不再相等。 */
  private expiredFor?: string;
  private warned = new Set<string>();

  constructor(
    private cookies: CookieStore,
    private transport: YtmusicTransport = defaultYtmusicTransport,
  ) {}

  /** 当前登录状态（不发请求）：missing 未登录 / expired 已确认失效 / valid 有令牌。 */
  authState(): 'missing' | 'valid' | 'expired' {
    const rec = this.cookies.get('ytmusic');
    if (!rec?.cookies) return 'missing';
    if (this.expiredFor && rec.token === this.expiredFor) return 'expired';
    return 'valid';
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(message);
  }

  /* ---------- 客户端身份 ---------- */

  identity(): Promise<YtmusicClientIdentity> {
    if (this.identityCache) return Promise.resolve(this.identityCache);
    if (!this.identityPending) {
      this.identityPending = this.loadIdentity()
        .then((v) => (this.identityCache = v))
        .finally(() => { this.identityPending = undefined; });
    }
    return this.identityPending;
  }

  private async loadIdentity(): Promise<YtmusicClientIdentity> {
    const headers = { 'User-Agent': YTMUSIC_UA, Referer: `${TV_ORIGIN}/tv` };
    let page: YtmusicResponse;
    try {
      page = await this.transport({ url: `${TV_ORIGIN}/tv`, method: 'GET', headers, shared: true, timeoutMs: 15000 });
    } catch {
      throw new Error('连不上 YouTube，没法获取登录所需的客户端信息（可能需要代理）');
    }
    if (page.status !== 200) throw new Error(`获取 YouTube 客户端信息失败（电视端页面 HTTP ${page.status}）`);
    const scriptUrl = extractYtmusicScriptUrl(page.text);
    if (!scriptUrl) throw new Error('YouTube 电视端页面结构变了，找不到客户端脚本，暂时无法登录');
    let script: YtmusicResponse;
    try {
      script = await this.transport({ url: scriptUrl, method: 'GET', headers, shared: true, timeoutMs: 30000 });
    } catch {
      throw new Error('下载 YouTube 电视端脚本失败，暂时无法登录');
    }
    if (script.status !== 200) throw new Error(`下载 YouTube 电视端脚本失败（HTTP ${script.status}）`);
    const identity = extractYtmusicClientIdentity(script.text);
    if (!identity) throw new Error('YouTube 电视端脚本里找不到客户端身份（格式可能变了），暂时无法登录');
    return identity;
  }

  /* ---------- OAuth ---------- */

  private async postOAuth(url: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, any> }> {
    const res = await this.transport({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': YTMUSIC_UA },
      body: JSON.stringify(body),
      shared: true,
    });
    return { status: res.status, json: parseJson(res.text) };
  }

  async requestDeviceCode(): Promise<YtmusicDeviceCode> {
    const { clientId } = await this.identity();
    let res: { status: number; json: Record<string, any> };
    try {
      res = await this.postOAuth(DEVICE_CODE_URL, { client_id: clientId, scope: SCOPE, device_id: crypto.randomUUID(), device_model: 'ytlr::' });
    } catch {
      throw new Error('连不上 YouTube，获取登录代码失败');
    }
    const j = res.json;
    if (res.status !== 200 || typeof j.device_code !== 'string' || typeof j.user_code !== 'string' || !j.device_code || !j.user_code) {
      if (j.error === 'invalid_client' || j.error === 'unauthorized_client') this.identityCache = undefined;
      throw new Error(`获取 YouTube 登录代码失败（${j.error || `HTTP ${res.status}`}）`);
    }
    let verificationUrl = DEFAULT_VERIFICATION_URL;
    try {
      const u = new URL(String(j.verification_url ?? ''));
      if (u.protocol === 'https:' && /(?:^|\.)google\.com$/i.test(u.hostname)) verificationUrl = u.href;
    } catch { /* 用默认地址 */ }
    const expiresIn = Number(j.expires_in) > 0 ? Number(j.expires_in) : 1800;
    const interval = Number(j.interval) > 0 ? Number(j.interval) : 5;
    return { deviceCode: j.device_code, userCode: j.user_code, verificationUrl, expiresIn, interval };
  }

  /** 轮询换令牌：等待 / 太频繁 / 过期 / 拒绝都映射成状态，其余错误抛出。 */
  async exchangeDeviceCode(deviceCode: string): Promise<YtmusicExchange> {
    const { clientId, clientSecret } = await this.identity();
    const res = await this.postOAuth(TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      code: deviceCode,
      grant_type: 'http://oauth.net/grant_type/device/1.0',
    });
    const j = res.json;
    if (typeof j.access_token === 'string' && j.access_token) {
      return { state: 'ok', accessToken: j.access_token, refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : '', expiresIn: Number(j.expires_in) || 0 };
    }
    switch (j.error) {
      case 'authorization_pending': return { state: 'pending' };
      case 'slow_down': return { state: 'slow_down' };
      case 'expired_token': return { state: 'expired' };
      case 'access_denied': return { state: 'denied' };
    }
    if (j.error === 'invalid_client') this.identityCache = undefined;
    throw new Error(`YouTube 授权出错（${j.error || `HTTP ${res.status}`}）`);
  }

  /** 续期：同一时间只续一次，并发的调用共用同一个结果。 */
  renew(): Promise<'ok' | 'expired' | 'failed'> {
    if (!this.renewing) this.renewing = this.renewOnce().finally(() => { this.renewing = undefined; });
    return this.renewing;
  }

  private async renewOnce(): Promise<'ok' | 'expired' | 'failed'> {
    const rec = this.cookies.get('ytmusic');
    const refresh = rec?.token;
    if (!refresh) return 'failed';
    try {
      const { clientId, clientSecret } = await this.identity();
      const res = await this.postOAuth(TOKEN_URL, { client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' });
      const j = res.json;
      if (typeof j.access_token === 'string' && j.access_token) {
        // 续期期间登录变了（换号、退出）：这份结果不属于现在的登录，丢弃。
        if (this.cookies.get('ytmusic')?.token !== refresh) return 'failed';
        // refresh_token 不轮换：沿用旧的（响应里真带了新的就用新的）。
        this.cookies.set('ytmusic', j.access_token, typeof j.refresh_token === 'string' && j.refresh_token ? j.refresh_token : refresh, rec?.nickname);
        return 'ok';
      }
      if (j.error === 'invalid_grant') {
        this.expiredFor = refresh;
        this.warnOnce('invalid_grant', '[YtmusicClient] 续期令牌已失效（invalid_grant），需要重新登录');
        return 'expired';
      }
      this.warnOnce(`renew:${j.error || res.status}`, `[YtmusicClient] 续期失败: ${res.status} ${j.error ?? ''}`);
      return 'failed';
    } catch (err) {
      this.warnOnce('renew-net', `[YtmusicClient] 续期请求失败: ${err instanceof Error ? err.message : ''}`);
      return 'failed';
    }
  }

  /* ---------- youtubei ---------- */

  private async rawCall(endpoint: string, body: Record<string, unknown>, accessToken?: string): Promise<{ status: number; json: Record<string, any> }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': YTMUSIC_UA,
      'X-Youtube-Client-Name': '7',
      'X-Youtube-Client-Version': CLIENT_VERSION,
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await this.transport({
      url: `${API}/${endpoint}?prettyPrint=false`,
      method: 'POST',
      headers,
      body: JSON.stringify({ context: { client: { clientName: 'TVHTML5', clientVersion: CLIENT_VERSION, hl: 'zh-CN', gl: 'US' } }, ...body }),
    });
    return { status: res.status, json: res.status === 200 ? parseJson(res.text) : {} };
  }

  private static ok(res: { status: number; json: Record<string, any> }): Record<string, any> {
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return res.json;
  }

  /** 用刚拿到的访问令牌直接调一次（登录时读昵称）：不走续期逻辑。 */
  async callWithToken(endpoint: string, body: Record<string, unknown>, accessToken: string): Promise<Record<string, any>> {
    return YtmusicClient.ok(await this.rawCall(endpoint, body, accessToken));
  }

  /**
   * 调用 youtubei。未登录按匿名读（公开歌单可读）；已登录自动附带 Bearer：
   * 令牌写入超过 50 分钟先续；401 时别的请求已经续过（令牌变了）就直接重试，否则续一次再重试；
   * 续期被拒（invalid_grant）或续期后仍 401 → 抛 YtmusicAuthExpired（anonymousOk 时退回匿名读）。
   */
  async call(endpoint: string, body: Record<string, unknown>, opts: { anonymousOk?: boolean } = {}): Promise<Record<string, any>> {
    const rec = this.cookies.get('ytmusic');
    if (!rec?.cookies) return YtmusicClient.ok(await this.rawCall(endpoint, body));
    const expired = async (): Promise<Record<string, any>> => {
      if (opts.anonymousOk) return YtmusicClient.ok(await this.rawCall(endpoint, body));
      throw new YtmusicAuthExpired();
    };
    if (this.authState() === 'expired') return expired();
    if (rec.token && Date.now() - rec.updatedAt > YTMUSIC_RENEW_AFTER_MS) {
      if ((await this.renew()) === 'expired') return expired();
    }
    const used = this.cookies.get('ytmusic')?.cookies;
    const first = await this.rawCall(endpoint, body, used);
    if (first.status !== 401) return YtmusicClient.ok(first);
    const now = this.cookies.get('ytmusic')?.cookies;
    let renewed: 'ok' | 'expired' | 'failed' = now && now !== used ? 'ok' : await this.renew();
    if (!this.cookies.get('ytmusic')?.token && renewed === 'failed') renewed = 'expired'; // 没有续期令牌：只能重新登录
    if (renewed === 'expired') {
      this.expiredFor ??= this.cookies.get('ytmusic')?.token;
      return expired();
    }
    if (renewed === 'failed') throw new Error('HTTP 401（续期失败，网络或服务暂时不可用）');
    const second = await this.rawCall(endpoint, body, this.cookies.get('ytmusic')?.cookies);
    if (second.status === 401) {
      this.expiredFor = this.cookies.get('ytmusic')?.token;
      return expired();
    }
    return YtmusicClient.ok(second);
  }

  /** 当前登录账号。 */
  async accountInfo(): Promise<YtmusicAccountInfo | null> {
    return parseYtmusicAccount(await this.call('account/accounts_list', {}));
  }

  /** 用刚拿到、还没存盘的访问令牌读账号（登录成功时取昵称）。 */
  async accountInfoWithToken(accessToken: string): Promise<YtmusicAccountInfo | null> {
    return parseYtmusicAccount(await this.callWithToken('account/accounts_list', {}, accessToken));
  }
}

/**
 * YouTube Music 适配器：电视端协议；我的歌单 = YouTube 资料库 + YouTube Music 资料库合并去重；
 * 歌单曲目是视频磁贴。不提供音频直链，播放与歌词交给跨平台兜底（第一阶段）。
 */
export class YtmusicAdapter implements PlatformAdapter {
  readonly platform = 'ytmusic' as const;
  readonly client: YtmusicClient;

  constructor(_http: HttpClient, private cookies: CookieStore, transport?: YtmusicTransport) {
    this.client = new YtmusicClient(cookies, transport);
  }

  async fetchPlaylist(playlistId: string): Promise<Playlist> {
    const id = String(playlistId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{2,}$/.test(id)) throw new Error('YouTube 歌单 ID 不合法');
    const blocked = unsupportedListId(id);
    if (blocked) throw new Error(blocked);
    if (id === YTMUSIC_LIKED_ID && !this.cookies.get('ytmusic')?.cookies) throw new Error('「赞过的视频」是私人歌单，请先登录 YouTube Music');
    return withRequestScope(60000, async () => {
      const own = id === YTMUSIC_LIKED_ID;
      const browse = (body: Record<string, unknown>) =>
        this.client.call('browse', body, { anonymousOk: !own }).catch((err) => {
          if (err instanceof YtmusicAuthExpired) throw err;
          const msg = err instanceof Error ? err.message : '';
          if (/HTTP (?:400|403|404)/.test(msg)) throw new Error('YouTube 歌单不存在或未公开（私享歌单需要登录自己的账号）');
          throw err;
        });
      const tracks: Track[] = [];
      const seen = new Set<string>();
      let data = await browse({ browseId: `VL${id}` });
      const name = findPlaylistTitle(data) || (own ? LIKED_NAME : '');
      for (let page = 1; ; page++) {
        const rows = collectTiles(data).map(mapYtmusicTrack).filter((t): t is Track => !!t);
        // 整页没有新曲目 = 翻到头了（或令牌在原地打转）：这一页丢掉并停；到上限也停。
        if (!rows.some((t) => !seen.has(t.sourceId))) break;
        for (const t of rows) {
          if (seen.has(t.sourceId)) continue;
          seen.add(t.sourceId);
          tracks.push(t);
        }
        const next = findContinuation(data);
        if (!next || page >= YTMUSIC_MAX_PAGES) break;
        data = await browse({ continuation: next });
      }
      // 「赞过的视频」混着普通视频的点赞：播客、游戏实况动辄几十分钟到几小时，既不是歌也找不到音源，超过 15 分钟的不收（#185 实测）。
      const kept = own ? tracks.filter((t) => !(Number(t.duration) > YTMUSIC_LIKED_MAX_SEC)) : tracks;
      if (!kept.length) throw new Error('YouTube 歌单为空、不存在或未公开');
      return { id, platform: 'ytmusic', name: name || `YouTube 歌单 ${id}`, cover: kept.find((t) => t.cover)?.cover ?? '', tracks: kept };
    });
  }

  /** 歌单没有封面时补的图：只读第一页，取第一首有封面的。 */
  async fetchPlaylistFirstCover(playlistId: string): Promise<string> {
    const id = String(playlistId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{2,}$/.test(id) || unsupportedListId(id)) return '';
    const data = await this.client.call('browse', { browseId: `VL${id}` }, { anonymousOk: id !== YTMUSIC_LIKED_ID });
    for (const tile of collectTiles(data)) {
      const cover = mapYtmusicTrack(tile)?.cover;
      if (cover) return cover;
    }
    return '';
  }

  /** 播放：第一阶段不取 YouTube 音频，返回 null 交给 SongResolver 跨平台兜底。 */
  async fetchSongUrl(_songId?: string, _albumId?: string, _quality?: string, _extra?: Record<string, unknown>): Promise<SongUrl | null> {
    return null;
  }

  async fetchLyric(): Promise<Lyric | null> {
    return null;
  }

  /**
   * 我的歌单：YouTube 资料库（含「赞过的视频」）+ YouTube Music 资料库，按歌单 ID 去重；
   * 「赞过的视频」放第一位；跳过「稍后观看」「赞过的音乐」（电视端读不出内容）和 RD 合辑。未登录 / 失败返回 []。
   */
  async fetchMyPlaylists(): Promise<PlaylistSummary[]> {
    if (!this.cookies.get('ytmusic')?.cookies) return [];
    const [lib, music] = await Promise.all([
      this.readAggregation().catch((err) => this.listFailed('YouTube 资料库', err)),
      this.readMusicLibrary().catch((err) => this.listFailed('YouTube Music 资料库', err)),
    ]);
    const merged = new Map<string, PlaylistSummary>();
    for (const p of [...lib, ...music]) {
      if (merged.has(p.id) || p.id === 'WL' || p.id === 'LM' || /^RD/i.test(p.id)) continue;
      merged.set(p.id, p);
    }
    const out = [...merged.values()];
    const liked = out.findIndex((p) => p.id === YTMUSIC_LIKED_ID);
    if (liked >= 0) {
      const [row] = out.splice(liked, 1);
      out.unshift({ ...row!, name: LIKED_NAME });
    }
    return out;
  }

  private listFailed(what: string, err: unknown): PlaylistSummary[] {
    if (!(err instanceof YtmusicAuthExpired)) console.warn(`[YtmusicAdapter] 读取${what}失败:`, err instanceof Error ? err.message : '');
    return [];
  }

  /** YouTube 资料库：翻页返回的多半是同一批，没有新 ID 就停。 */
  private async readAggregation(): Promise<PlaylistSummary[]> {
    const out: PlaylistSummary[] = [];
    const seen = new Set<string>();
    let data = await this.client.call('browse', { browseId: 'FEplaylist_aggregation' });
    for (let page = 1; ; page++) {
      let added = 0;
      for (const tile of collectTiles(data)) {
        const p = mapYtmusicPlaylistTile(tile);
        if (!p || seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
        added++;
      }
      const next = findContinuation(data);
      if (!next || !added || page >= LIST_MAX_PAGES) break;
      data = await this.client.call('browse', { continuation: next });
    }
    return out;
  }

  /** YouTube Music 资料库（「播放列表」页签里的歌单磁贴）。 */
  private async readMusicLibrary(): Promise<PlaylistSummary[]> {
    const data = await this.client.call('browse', { browseId: 'FEmusic_liked_playlists' });
    const out: PlaylistSummary[] = [];
    const seen = new Set<string>();
    for (const tile of collectTiles(data)) {
      const p = mapYtmusicPlaylistTile(tile);
      if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
    }
    return out;
  }
}
