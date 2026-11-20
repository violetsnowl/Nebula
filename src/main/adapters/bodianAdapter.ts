import crypto from 'node:crypto';
import https from 'node:https';
import zlib from 'node:zlib';
import type { HttpClient } from '../http';
import type { CookieStore } from '../cookieStore';
import type { Lyric, Playlist, PlaylistSummary, PlatformAdapter, QualityOption, SongUrl, Track } from '../types';
import { cleanMetadataText } from '../parsers/metadataText';
import { requestScope, withRequestScope } from '../requestScope';
import { fetchKuwoLyric } from './kuwoAdapter';

/*
 * 波点音乐（bodian）。接口地址、请求头、签名与各接口参数参考 PyBodian（MIT）：
 * https://github.com/MoeclubM/PyBodian ，这里按 TypeScript 重新实现。
 */

const API_BASE = 'https://bd-api.kuwo.cn';
const PAGE_SIZE = 100;
const MAX_PAGES = 60;
const COLLECT_PAGE_SIZE = 50;
const MAX_COLLECT_PAGES = 40;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_SOURCE = 5;
/** 收藏列表里 sourceType=6 是专辑，不是歌单。 */
const ALBUM_SOURCE = 6;
/** 业务码：登录失效。实测假 token 访问 playlist/userCreate 返回 -101（users/login 与 fond / collect 对假 token 不报错，不能用来判过期）。 */
export const BODIAN_AUTH_REJECT_CODES: ReadonlySet<number> = new Set([-101]);
/** 业务码：当前网络不在中国大陆。 */
const CODE_REGION_RESTRICTED = 407;
/** checkRight 的 status：1 / 4 可整曲播放；3 仅试听；其余（如 7 缺少权益）不可播。 */
const FULL_PLAY_STATUS = new Set([1, 4]);
/** 音质档位 → 波点 format / br。 */
const FORMAT_BY_LEVEL: Record<string, { format: string; br: string }> = {
  flac: { format: 'flac', br: '2000kflac' },
  '320': { format: 'mp3', br: '320kmp3' },
  '128': { format: 'mp3', br: '128kmp3' },
};
const LEVEL_ORDER = ['flac', '320', '128'];

export interface BodianSession { uid: string; token: string; devId: string }

function readCookie(cookie: string | undefined | null, name: string): string {
  if (!cookie) return '';
  for (const seg of cookie.split(';')) {
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    if (seg.slice(0, eq).trim().toLowerCase() === name) return seg.slice(eq + 1).trim();
  }
  return '';
}

/** 从波点 cookie（`uid=…; token=…; devid=…`）取登录身份：uid 为非零数字，token 非空。缺任一返回 null。 */
export function parseBodianSession(cookie: string | undefined | null): BodianSession | null {
  const uid = readCookie(cookie, 'uid');
  const token = readCookie(cookie, 'token');
  if (!/^\d+$/.test(uid) || /^0+$/.test(uid) || !token) return null;
  return { uid, token, devId: readCookie(cookie, 'devid') };
}

let processDevId = '';
/** 设备 ID：登录前在内存里保持稳定，登录后写进凭证。 */
function newDevId(): string {
  return crypto.createHash('md5').update(crypto.randomBytes(16)).digest('hex');
}
export function bodianDevId(session?: BodianSession | null): string {
  return session?.devId || (processDevId ||= newDevId());
}

const md5 = (text: string): string => crypto.createHash('md5').update(text, 'utf8').digest('hex');

/** 与 Python urllib.parse.urlencode 一致：空格写 +，除 `_.-~` 与字母数字外全部百分号编码。 */
export function encodeBodianQuery(params: Record<string, string | number>): string {
  const enc = (v: string) => encodeURIComponent(v)
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
  return Object.entries(params).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&');
}

/** sign = md5("kuwotest" + 排序后的查询串字母数字 + (有签名体 ? md5(体 + "kuwotest") : "") + path)。 */
export function bodianSign(path: string, params: Record<string, string | number>, signBody = ''): string {
  const alnum = [...encodeBodianQuery(params)].filter(c => /[A-Za-z0-9]/.test(c)).sort().join('');
  return md5(`kuwotest${alnum}${signBody ? md5(`${signBody}kuwotest`) : ''}${path}`);
}

export interface BodianHttpRequest { method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body?: string; timeoutMs: number }
export type BodianTransport = (req: BodianHttpRequest) => Promise<{ status: number; text: string }>;

/**
 * 波点的取链接口是「带请求体的 GET」，全局 fetch 发不了，所以用 node:https：
 * 支持 gzip、超时、响应大小上限，并跟随请求作用域的取消信号。
 */
export const bodianHttpsTransport: BodianTransport = (req) => withRequestScope(req.timeoutMs, () => new Promise((resolve, reject) => {
  const signal = requestScope()?.signal;
  const request = https.request(new URL(req.url), { method: req.method, headers: req.headers, timeout: req.timeoutMs }, res => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) { request.destroy(new Error('波点响应过大')); return; }
      chunks.push(chunk);
    });
    res.on('error', reject);
    res.on('end', () => {
      try {
        let raw: Buffer = Buffer.concat(chunks);
        const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
        if (encoding === 'gzip') raw = zlib.gunzipSync(raw, { maxOutputLength: MAX_RESPONSE_BYTES });
        else if (encoding === 'br') raw = zlib.brotliDecompressSync(raw, { maxOutputLength: MAX_RESPONSE_BYTES });
        else if (encoding === 'deflate') raw = zlib.inflateSync(raw, { maxOutputLength: MAX_RESPONSE_BYTES });
        resolve({ status: res.statusCode || 0, text: raw.toString('utf8') });
      } catch (err) { reject(err); }
    });
  });
  request.on('timeout', () => request.destroy(new Error('波点请求超时')));
  request.on('error', reject);
  signal?.addEventListener('abort', () => request.destroy(new Error('波点请求已取消')), { once: true });
  if (req.body) request.write(req.body);
  request.end();
}));

export interface BodianReply { code: number; msg: string; data: any; httpStatus: number }
export interface BodianCallOptions {
  session?: BodianSession | null;
  params?: Record<string, string | number>;
  /** 请求体对象（JSON）。取链接口是 GET + 体。 */
  body?: Record<string, unknown>;
  method?: 'GET' | 'POST';
  /** 加 timestamp 与 sign。 */
  signed?: boolean;
  /** 参与签名的请求体文本；默认就是 body 的 JSON，取链接口传 ''（体不参与签名）。 */
  signBody?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** 波点接口：统一请求头（含设备 ID）、uid / token 参数与签名。网络失败或响应不是 JSON 时抛错，业务码交给调用方判断。 */
export class BodianApi {
  constructor(private cookies: CookieStore, private transport: BodianTransport = bodianHttpsTransport) {}

  session(): BodianSession | null {
    return parseBodianSession(this.cookies.getHeader('bodian'));
  }

  async call(path: string, opts: BodianCallOptions = {}): Promise<BodianReply> {
    const session = opts.session === undefined ? this.session() : opts.session;
    const params: Record<string, string | number> = { ...opts.params, uid: session?.uid ?? '-1', token: session?.token ?? '' };
    const bodyText = opts.body === undefined ? '' : JSON.stringify(opts.body);
    if (opts.signed) {
      params.timestamp = String(Date.now());
      params.sign = bodianSign(path, params, opts.signBody ?? bodyText);
    }
    const devId = bodianDevId(session);
    const headers: Record<string, string> = {
      'user-agent': 'Dart/3.3 (dart:io)', plat: 'win', 'accept-encoding': 'gzip', 'api-ver': 'application/json',
      channel: 'W1', brand: 'Windows 11', net: 'wifi', 'content-type': 'application/json', ver: '1.1.7', svrver: '13',
      devid: devId, qimei36: devId,
      ...opts.headers,
    };
    if (bodyText) headers['content-length'] = String(Buffer.byteLength(bodyText));
    const res = await this.transport({
      method: opts.method ?? 'GET',
      url: `${API_BASE}${path}?${encodeBodianQuery(params)}`,
      headers,
      body: bodyText || undefined,
      timeoutMs: opts.timeoutMs ?? 10000,
    });
    let json: { code?: unknown; msg?: unknown; data?: unknown };
    try { json = JSON.parse(res.text); } catch { throw new Error(`波点接口返回异常 (HTTP ${res.status})`); }
    return { code: Number(json?.code ?? res.status), msg: String(json?.msg ?? ''), data: json?.data, httpStatus: res.status };
  }

  /** 自己创建的歌单；同时是验证登录是否有效的唯一可靠接口（见 BODIAN_AUTH_REJECT_CODES）。 */
  userCreate(session: BodianSession): Promise<BodianReply> {
    return this.call('/api/service/playlist/userCreate', { session, params: { userId: session.uid } });
  }
}

/** 歌单 ID：`<歌单 id>:<source>`，没有 source 时按 5（自建 / 红心）。 */
export function parseBodianPlaylistId(raw: string): { id: string; source: number } | null {
  const m = /^(\d+)(?::(\d+))?$/.exec(String(raw ?? '').trim());
  return m ? { id: m[1]!, source: m[2] ? Number(m[2]) : DEFAULT_SOURCE } : null;
}

function mapBodianTrack(item: Record<string, any>): Track | null {
  const id = String(item?.id ?? '').trim();
  const title = cleanMetadataText(item?.name || item?.songName);
  if (!/^\d+$/.test(id) || !title) return null;
  const listed = Array.isArray(item.artists) ? item.artists.map((a: any) => cleanMetadataText(a?.name)).filter(Boolean) : [];
  const artists: string[] = listed.length ? listed : cleanMetadataText(item.artist).split('&').map(s => s.trim()).filter(Boolean);
  const freeSign = String(item.freeSign || item.fsig || '');
  return {
    id: `bodian:${id}`,
    title,
    artist: artists.join(' / ') || '未知歌手',
    artists,
    album: cleanMetadataText(item.album),
    cover: String(item.albumPic || item.albumPic120 || '').trim(),
    duration: Number(item.duration) || 0,
    platform: 'bodian',
    sourceId: id,
    originalUrl: '',
    fallbackUrl: '',
    extra: {
      albumId: String(item.albumId ?? ''),
      artistId: String(item.artistId ?? ''),
      durationSec: Number(item.duration) || 0,
      ...(freeSign ? { freeSign } : {}),
    },
  };
}

function mapBodianSummary(p: Record<string, any>): PlaylistSummary | null {
  const id = String(p?.id ?? '').trim();
  const name = cleanMetadataText(p?.name);
  if (!/^\d+$/.test(id) || !name) return null;
  const source = Number(p.sourceType ?? p.source) || DEFAULT_SOURCE;
  return { id: `${id}:${source}`, name, cover: String(p.pic ?? '').trim(), trackCount: Number(p.musicCount ?? p.musicnum) || 0 };
}

export class BodianAdapter implements PlatformAdapter {
  readonly platform = 'bodian' as const;
  private api: BodianApi;
  private regionLogged = false;

  private http?: HttpClient;
  constructor(http: HttpClient, cookies: CookieStore, transport?: BodianTransport) {
    this.http = http;
    this.api = new BodianApi(cookies, transport);
  }

  async fetchPlaylist(playlistId: string): Promise<Playlist> {
    const target = parseBodianPlaylistId(playlistId);
    if (!target) throw new Error('无效的波点歌单 ID');
    const { id, source } = target;
    // 公开歌单未登录也能读；有登录时带上，私密歌单才读得到。
    let name = '';
    let cover = '';
    let description = '';
    try {
      const info = await this.api.call(`/api/service/playlist/info/${id}`, { params: { source } });
      if (info.code === 200 && info.data) {
        name = cleanMetadataText(info.data.name);
        cover = String(info.data.pic ?? '').trim();
        description = cleanMetadataText(info.data.description);
      }
    } catch { /* 歌单信息拿不到不影响读歌曲 */ }

    const tracks: Track[] = [];
    let seen = 0;
    let total = 0;
    for (let pn = 1; pn <= MAX_PAGES; pn++) {
      const res = await this.api.call(`/api/service/playlist/${id}/musicList`, { params: { source, pn, rn: PAGE_SIZE } });
      if (res.code !== 200) throw new Error(`波点歌单读取失败 (错误码 ${res.code})`);
      const rows: Array<Record<string, any>> = Array.isArray(res.data?.list) ? res.data.list : Array.isArray(res.data?.musicList) ? res.data.musicList : [];
      if (!rows.length) break;
      if (pn === 1) total = Number(res.data?.total) || 0;
      seen += rows.length;
      tracks.push(...rows.map(mapBodianTrack).filter((t): t is Track => !!t));
      if (total && seen >= total) break;
    }
    if (!tracks.length) throw new Error('波点歌单不存在、为空或未公开');
    return { id: `${id}:${source}`, platform: 'bodian', name: name || `波点歌单 ${id}`, cover, description: description || undefined, tracks };
  }

  /**
   * 取链需要登录 + 中国大陆网络。试听片段（checkRight status 3）、缺权益、地区限制、任何失败都返回 null，让路由器去兜底平台。
   * 请求的档位拿不到时依次降档。
   * TODO(待真实登录验证)：整曲音频域名。目前只看到试听走 *.kuwo.cn（audioProxy / main.cjs 已放行）；
   * 若整曲来自别的域名，需把域名补进 audioProxy HOSTS 与 main.cjs 的请求头注入，否则代理会拒绝（返回空地址）。
   */
  async fetchSongUrl(songId: string, _albumId?: string, quality?: string, extra?: Record<string, unknown>): Promise<SongUrl | null> {
    const mid = String(songId || '').trim();
    const session = this.api.session();
    if (!session || !/^\d+$/.test(mid)) return null;
    let freeSign = String(extra?.freeSign ?? '');
    try { freeSign = decodeURIComponent(freeSign); } catch { /* 已是明文 */ }
    try {
      const right = await this.api.call('/api/play/music/v2/checkRight', {
        session, signed: true, signBody: '',
        params: { musicId: mid, freeSign },
        body: { musicId: Number(mid), freeSign },
      });
      if (right.code === CODE_REGION_RESTRICTED) return this.regionBlocked();
      if (right.code !== 200 || !FULL_PLAY_STATUS.has(Number(right.data?.status))) return null;

      const start = Math.max(0, LEVEL_ORDER.indexOf(quality && FORMAT_BY_LEVEL[quality] ? quality : '320'));
      for (const level of LEVEL_ORDER.slice(start)) {
        const { format, br } = FORMAT_BY_LEVEL[level]!;
        const devId = bodianDevId(session);
        const res = await this.api.call('/api/play/music/v2/audioUrl', {
          session, signed: true, signBody: '',
          params: { devId, musicId: mid, format, br, freeSign },
          body: { devId, musicId: Number(mid), format, br, freeSign },
          headers: { uid: session.uid, token: session.token },
        });
        if (res.code === CODE_REGION_RESTRICTED) return this.regionBlocked();
        const url = String(res.data?.audioHttpsUrl || res.data?.audioUrl || '').trim();
        if (res.code === 200 && /^https?:\/\//i.test(url)) return { url, quality: level };
      }
      return null;
    } catch {
      return null;
    }
  }

  private regionBlocked(): null {
    if (!this.regionLogged) {
      this.regionLogged = true;
      console.warn('[BodianAdapter] 波点返回 407：当前网络不在中国大陆，改用其他平台取链');
    }
    return null;
  }

  async listQualities(): Promise<QualityOption[]> {
    return [
      { level: '128', label: '标准 128k' },
      { level: '320', label: '高品 320k' },
      { level: 'flac', label: '无损 FLAC', needsVip: true },
    ];
  }

  /** 本平台歌词（#204）：波点和酷我同一套曲库、歌曲 id 相同，用酷我的歌词接口（逐字 + 翻译，匿名）。 */
  async fetchLyric(songId: string): Promise<Lyric | null> {
    return this.http ? fetchKuwoLyric(this.http, songId) : null;
  }

  /** 我的歌单：红心歌单（排第一）、自建歌单、收藏的歌单（不含专辑）。失败返回 []。 */
  async fetchMyPlaylists(): Promise<PlaylistSummary[]> {
    const session = this.api.session();
    if (!session) return [];
    const out: PlaylistSummary[] = [];
    const known = new Set<string>();
    const add = (p: Record<string, any>) => {
      const item = mapBodianSummary(p);
      if (!item || known.has(item.id.split(':')[0]!)) return;
      known.add(item.id.split(':')[0]!);
      out.push(item);
    };
    try {
      const created = await this.api.userCreate(session);
      if (created.code !== 200) throw new Error(`错误码 ${created.code}`);
      const lists: Array<Record<string, any>> = Array.isArray(created.data?.playLists) ? created.data.playLists : [];
      // 红心歌单：fond 接口优先；没有名字时叫「我喜欢」。
      let fond: Record<string, any> | null = null;
      try {
        const res = await this.api.call('/api/service/playlist/fond', { session, params: { userId: session.uid } });
        if (res.code === 200 && res.data?.id) fond = res.data;
      } catch { /* 没有红心歌单信息就按自建歌单列表来 */ }
      if (fond) add({ ...fond, name: fond.name || '我喜欢' });
      lists.filter(p => p?.isFond).forEach(add);
      lists.forEach(add);
      for (let pn = 1; pn <= MAX_COLLECT_PAGES; pn++) {
        const res = await this.api.call('/api/service/collect/4/list', {
          session, params: { userId: session.uid, fromUid: session.uid, pn, rn: COLLECT_PAGE_SIZE },
        });
        const raw: Array<Record<string, any>> = res.code === 200 && Array.isArray(res.data?.playLists) ? res.data.playLists : [];
        if (!raw.length) break; // 以原始页是否为空判断结束：过滤掉专辑后的空页不代表到头
        raw.filter(p => Number(p?.sourceType) !== ALBUM_SOURCE).forEach(add);
      }
    } catch (err) {
      console.warn('[BodianAdapter] 歌单获取失败:', err instanceof Error ? err.message : '');
    }
    return out;
  }
}
