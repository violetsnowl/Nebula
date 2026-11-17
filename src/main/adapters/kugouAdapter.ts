import crypto from 'node:crypto';
import type { HttpClient } from '../http';
import { requestScope, throwIfCancelled, withRequestScope } from '../requestScope';
import type { CookieStore } from '../cookieStore';
import type { Lyric, Playlist, PlaylistSummary, PlatformAdapter, QualityOption, SongUrl, Track } from '../types';
import { parseLrc } from '../parsers/lyricParser';
import { decodeKrc, fromTimed } from '../parsers/timedLyrics';
import { mapKugouMobileTrack, mapKugouTrack } from './mappers';
import { sourceTiming } from '../../lib/audio/sourceLifetime';

// --- 文本处理（对齐 Mineradio） ---
function stripKugouHtml(text: string): string {
  return decodeKugouDisplayText(String(text || '').replace(/<[^>]+>/g, '').trim());
}
function decodeKugouDisplayText(text: string): string {
  let raw = String(text || '').trim();
  if (!raw) return '';
  if (/%u[0-9a-fA-F]{4}/.test(raw)) raw = raw.replace(/%u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  if (/%[0-9a-fA-F]{2}/.test(raw) && !/[\u3400-\u9fff]/.test(raw)) { try { raw = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { /* */ } }
  return raw.trim();
}
function stripKugouFileName(raw: string, fallbackArtist: string): string {
  let name = stripKugouHtml(raw || '').replace(/\.(mp3|flac|m4a|wav|ape|ogg)$/i, '').trim();
  const artist = stripKugouHtml(fallbackArtist || '');
  if (artist && name.indexOf(artist) === 0) name = name.slice(artist.length).replace(/^[\s\-–—]+/, '').trim();
  return name || stripKugouHtml(raw || '');
}
function extractKugouArtists(item: Record<string, any>): Array<{ id: string; name: string }> {
  const singers = Array.isArray(item.singerinfo) ? item.singerinfo : (Array.isArray(item.Singers) ? item.Singers : []);
  if (singers.length) return singers.map((s: any) => ({ id: String(s.id || s.SingerId || ''), name: stripKugouHtml(s.name || s.SingerName || '') })).filter(a => a.name);
  const names = String(item.SingerName || '').split(/、|\/|,| feat\.? /i).map(stripKugouHtml).filter(Boolean);
  const ids = Array.isArray(item.SingerId) ? item.SingerId : [];
  return names.map((name, i) => ({ id: String(ids[i] || ''), name }));
}

// --- 签名常量 ---
const H5_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const ANDROID_SALT = 'OIlwieks28dk2k092lksi2UIkp';
const SIGN_KEY_SALT = '57ae12eb6890223e355ccfcb74edf70d';
const H5_SRC_APPID = 2919;
const H5_CLIENTVER = 20000;
const ANDROID_APPID = 1005;
const ANDROID_CLIENTVER = 20489;
const ANDROID_UA = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi';

function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex');
}

/** H5 签名：md5(H5_SALT + sorted k=v[+bodyJson] + H5_SALT) */
function h5Sign(params: Record<string, string>, bodyObj?: Record<string, unknown>): string {
  const parts = Object.keys(params).sort().map(k => k + '=' + params[k]);
  if (bodyObj && typeof bodyObj === 'object') parts.push(JSON.stringify(bodyObj));
  return md5(H5_SALT + parts.join('') + H5_SALT);
}

/** Android 签名：md5(ANDROID_SALT + sorted k=v + body + ANDROID_SALT) */
function androidSign(params: Record<string, string>, body: string): string {
  const sorted = Object.keys(params).sort().map(k => k + '=' + params[k]).join('&');
  return md5(ANDROID_SALT + sorted + body + ANDROID_SALT);
}

/** mobile 云 key：md5(hash + 'kgcloud') */
function mobileKey(hash: string): string {
  return md5(hash + 'kgcloud');
}

// --- 手机端协议（扫码登录票据 appid=1005 用；协议细节参考 MIT 许可的 KuGouMusicApi） ---
type SignParams = Record<string, string | number>;

/** 登录票据里标记「手机端扫码取得」的 cookie 字段。 */
export const KUGOU_TICKET_MARK = 'kg_client';
export const KUGOU_TICKET_MOBILE = 'mobile';

/** 酷狗网页签名：每项 "k=v" 后整体排序直接拼接，再接请求体，前后加盐取 md5。 */
export function kugouWebSign(params: SignParams, body = ''): string {
  const joined = Object.keys(params).map(k => k + '=' + params[k]).sort().join('');
  return md5(H5_SALT + joined + body + H5_SALT);
}

/** 酷狗手机端签名：按 key 排序，"k=v" 直接拼接（不加分隔符），再接请求体，前后加盐取 md5。 */
export function kugouMobileSign(params: SignParams, body = ''): string {
  const joined = Object.keys(params).sort().map(k => k + '=' + params[k]).join('');
  return md5(ANDROID_SALT + joined + body + ANDROID_SALT);
}

/** 手机端请求头（与客户端一致的内部标识头）。 */
export function kugouMobileHeaders(mid: string, dfid: string, clienttime: number | string): Record<string, string> {
  return {
    'User-Agent': ANDROID_UA,
    dfid, mid, clienttime: String(clienttime),
    'kg-rc': '1',
    'kg-thash': '5d816a0',
    'kg-rec': '1',
    'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
  };
}

/** 手机端公共参数：dfid / mid / uuid / appid / clientver / clienttime，有票据时带 token、userid。 */
export function kugouCommonParams(
  ctx: { mid: string; dfid: string; userid?: string; token?: string },
  extra: SignParams = {},
  clienttime = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const out: Record<string, string> = {
    dfid: ctx.dfid || '-',
    mid: ctx.mid,
    uuid: '-',
    appid: String(ANDROID_APPID),
    clientver: String(ANDROID_CLIENTVER),
    clienttime: String(clienttime),
  };
  if (ctx.token) out.token = ctx.token;
  if (ctx.userid && ctx.userid !== '0') out.userid = ctx.userid;
  for (const [k, v] of Object.entries(extra)) out[k] = String(v);
  return out;
}

/** 参数加签名后拼成查询串（值做 URI 编码，签名按原始值计算）。 */
export function kugouSignedQuery(params: Record<string, string>, sign: (p: Record<string, string>) => string): string {
  const all = { ...params, signature: sign(params) };
  return Object.entries(all).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
}

/** 业务错误：status=0 或 error_code 非 0，保留错误码，供上层区分「票据失效」与普通失败。 */
export class KugouApiError extends Error {
  constructor(public readonly code: number, message?: string) {
    super(message || `酷狗接口错误 ${code}`);
    this.name = 'KugouApiError';
  }
}

/** 明确表示票据失效的错误码（20017：token 不被认可）。20006 是签名错误，不算过期。 */
export const KUGOU_AUTH_ERROR_CODES: ReadonlySet<number> = new Set([20017]);

function readCookieValue(cookie: string | undefined | null, name: string): string {
  if (!cookie) return '';
  for (const seg of cookie.split(';')) {
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    if (seg.slice(0, eq).trim() === name) return seg.slice(eq + 1).trim();
  }
  return '';
}

export interface KugouTicket {
  userid: string;
  token: string;
  mid: string;
  dfid: string;
  /** true：手机端扫码票据（appid 1005）；false：网页登录票据（appid 1014）。 */
  mobile: boolean;
}

/** 从已存的 cookie 串读取登录票据；缺 userid 或 token 返回 null。 */
export function parseKugouTicket(cookie: string | undefined | null): KugouTicket | null {
  let userid = '';
  for (const name of ['KugooID', 'kugooID', 'userid', 'UserId', 'kugouID', 'uid']) {
    const v = readCookieValue(cookie, name);
    if (v && v !== '0') { userid = v.replace(/\D/g, ''); break; }
  }
  let token = '';
  for (const name of ['t', 'token', 'Token', 'T']) {
    const v = readCookieValue(cookie, name);
    if (v) { token = v; break; }
  }
  if (!userid || !token) return null;
  return {
    userid, token,
    mid: readCookieValue(cookie, 'kg_mid'),
    dfid: readCookieValue(cookie, 'kg_dfid'),
    mobile: readCookieValue(cookie, KUGOU_TICKET_MARK) === KUGOU_TICKET_MOBILE,
  };
}

/** 酷狗扫码结果状态：0 过期，1 等待扫码，2 已扫待确认，4 成功。 */
export type KugouQrState =
  | { state: 'expired' }
  | { state: 'waiting' }
  | { state: 'scanned' }
  | { state: 'success'; token: string; userid: string; nickname: string }
  | { state: 'unknown'; message: string };

/** 解析 get_userinfo_qrcode 的返回。 */
export function parseKugouQrStatus(resp: any): KugouQrState {
  const d = resp?.data;
  const status = Number(d?.status);
  if (status === 0) return { state: 'expired' };
  if (status === 1) return { state: 'waiting' };
  if (status === 2) return { state: 'scanned' };
  if (status === 4) {
    const token = String(d?.token ?? '');
    const userid = String(d?.userid ?? '');
    if (!token || !userid || userid === '0') return { state: 'unknown', message: '扫码已确认，但未拿到登录票据' };
    return { state: 'success', token, userid, nickname: String(d?.nickname ?? '') };
  }
  const code = Number(resp?.error_code ?? 0) || 0;
  return { state: 'unknown', message: code ? `二维码状态异常（错误码 ${code}）` : '二维码状态未知' };
}

export type KugouListResult =
  | { kind: 'ok'; items: Array<Record<string, any>> }
  | { kind: 'expired'; code: number }
  | { kind: 'error'; code: number; message: string };

type JsonRequester = Pick<HttpClient, 'requestJson'>;

/**
 * 读「我的歌单」（POST /v7/get_all_list）。手机端票据用手机端参数与签名；网页票据保持原网页协议。
 * 业务错误按错误码分类返回（不静默吞掉）；网络 / 解析异常直接抛出，由调用方当作「未知」处理。
 */
export async function requestKugouMyPlaylists(http: JsonRequester, ticket: KugouTicket, page = 1, pagesize = 50, timeoutMs?: number): Promise<KugouListResult> {
  type Resp = { status?: number; error_code?: number; errcode?: number; error?: string; data?: { info?: any[]; list?: any[] } };
  let data: Resp;
  if (ticket.mobile) {
    const params = kugouCommonParams(ticket, { plat: 1, userid: ticket.userid });
    const bodyObj = { userid: ticket.userid, token: ticket.token, total_ver: 979, type: 2, page, pagesize };
    const qs = kugouSignedQuery(params, p => kugouMobileSign(p, JSON.stringify(bodyObj)));
    data = await http.requestJson<Resp>('https://gateway.kugou.com/v7/get_all_list?' + qs, {
      platform: 'kugou', method: 'POST', body: bodyObj, cookie: '', timeoutMs,
      headers: { ...kugouMobileHeaders(ticket.mid, ticket.dfid || '-', params.clienttime), 'x-router': 'cloudlist.service.kugou.com' },
    });
  } else {
    const params: Record<string, string> = {
      srcappid: String(H5_SRC_APPID), clientver: String(H5_CLIENTVER), clienttime: String(Date.now()),
      mid: ticket.mid || '0', uuid: String(Date.now()), dfid: ticket.dfid || '-',
      appid: '1014', token: ticket.token, userid: ticket.userid, plat: '1',
    };
    const bodyObj = { userid: Number(ticket.userid), token: ticket.token, total_ver: 979, type: 2, page, pagesize };
    params.signature = h5Sign(params, bodyObj);
    const qs = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    data = await http.requestJson<Resp>('https://gateway.kugou.com/v7/get_all_list?' + qs, {
      platform: 'kugou', method: 'POST', body: bodyObj, timeoutMs, headers: { 'x-router': 'cloudlist.service.kugou.com' },
    });
  }
  const code = Number(data?.error_code ?? data?.errcode ?? 0) || 0;
  if (data?.status === 0 || code !== 0) {
    if (KUGOU_AUTH_ERROR_CODES.has(code)) return { kind: 'expired', code };
    return { kind: 'error', code, message: String(data?.error || '') };
  }
  const raw: any = data?.data;
  const items: Array<Record<string, any>> = raw?.info ?? raw?.list ?? (data as any)?.info ?? [];
  return { kind: 'ok', items: Array.isArray(items) ? items : [] };
}

/** get_all_list 条目 → 歌单摘要。 */
export function mapKugouMyPlaylists(items: Array<Record<string, any>>): PlaylistSummary[] {
  return items.map(item => ({
    id: String(item.global_collection_id || item.specialid || item.listid || item.list_id || item.id || ''),
    name: stripKugouHtml(String(item.name || item.listname || item.specialname || item.title || '酷狗歌单')),
    cover: kugouCoverUrl(String(item.pic || item.img || item.imgurl || item.sizable_cover || item.create_user_pic || '')),
    trackCount: Number(item.count || item.m_count || item.song_count || item.total || item.list_count || item.songcount || 0) || 0,
  }));
}

/** 解析酷狗歌单 ID：支持纯数字、collection_xxx_xxx_NUM_xxx 格式 */
function parseKugouListId(playlistId: string): string {
  const id = String(playlistId || '').trim();
  if (!id) return '';
  if (/^\d+$/.test(id)) return id;
  if (id.startsWith('collection_')) {
    const parts = id.split('_');
    if (parts.length >= 5 && parts[3]) return parts[3];
  }
  const matched = id.match(/collection_\d+_\d+_(\d+)_\d+/);
  return matched ? matched[1] : id;
}

interface VipStatus {
  isVip: boolean;
  isSvip: boolean;
  expireTime: number;
  probedAt: number;
}

interface UrlCacheEntry {
  url: string;
  quality: string;
  cachedUntil: number;
  expiresAt: number;
}

const VIP_TTL_MS = 5 * 60 * 1000;


/** H5 网关歌单歌曲映射（对齐 Mineradio mapKugouPlaylistTrack） */
function mapKugouPlaylistTrack(item: Record<string, any>): Track | null {
  try {
    const artists = extractKugouArtists(item);
    const artistLabel = artists.map(a => a.name).join(' / ');
    const hash = item.hash || item.FileHash || '';
    if (!hash) return null;
    const songName = stripKugouFileName(item.name || item.SongName || item.filename || '', artistLabel);
    if (!songName) return null;
    const albumInfo = item.albuminfo || {};
    return {
      id: `kugou:${hash}`,
      title: songName,
      artist: artistLabel || '未知歌手',
      artists: artists.map(a => a.name),
      album: stripKugouHtml(albumInfo.name || item.album_name || item.AlbumName || ''),
      cover: kugouCoverUrl(String(item.cover || item.img || item.Image || albumInfo.img || albumInfo.cover || (item.trans_param && item.trans_param.union_cover) || '')),
      duration: Number(item.duration || (item.timelen ? Math.round(Number(item.timelen) / 1000) : 0) || item.Duration || 0) || 0,
      platform: 'kugou',
      sourceId: hash,
      originalUrl: '',
      fallbackUrl: '',
      extra: {
        albumId: String(albumInfo.id || item.album_id || item.AlbumID || ''),
        mixSongId: String(item.mixsongid || item.MixSongID || item.album_audio_id || ''),
        hqHash: item.HQFileHash || '',
        sqHash: item.SQFileHash || '',
        resHash: item.ResFileHash || '',
        privilege: Number(item.media_privilege ?? item.privilege ?? item.Privilege ?? 0),
      },
    };
  } catch { return null; }
}

/** 酷狗封面 URL：替换 {size} 占位符 + 确保 HTTPS */
function kugouCoverUrl(raw: string, size = 0): string {
  const url = String(raw || '').trim();
  if (!url) return '';
  return url.replace(/\{size\}/g, String(size)).replace(/^http:\/\//, 'https://');
}

export class KugouAdapter implements PlatformAdapter {
  readonly platform = 'kugou' as const;

  private vipCache: VipStatus | null = null;
  private urlCache = new Map<string, UrlCacheEntry>();

  constructor(
    private http: HttpClient,
    private cookies: CookieStore,
  ) { cookies.onChange?.(() => { this.vipCache = null; this.urlCache.clear(); }); }

  async fetchPlaylist(playlistId: string): Promise<Playlist> {
    const cookie = this.cookies.getHeader('kugou') ?? '';
    const userid = this.extractKugouUserId(cookie);
    const token = this.extractKugouToken(cookie);

    // 已登录 → 手机端票据走手机端协议；网页票据尝试 H5 网关（支持用户歌单 ID）
    const ticket = parseKugouTicket(cookie);
    if (ticket?.mobile) {
      try {
        return await this.fetchPlaylistViaMobileTicket(playlistId, ticket);
      } catch (err) {
        console.warn('[KugouAdapter] 手机端歌单失败，回退公开 API:', err instanceof KugouApiError ? `错误码 ${err.code}` : '');
      }
    } else if (userid && token) {
      try {
        return await this.fetchPlaylistViaH5(playlistId, cookie, userid, token);
      } catch (err) {
        console.warn("[KugouAdapter] H5 歌单失败，回退 mobile API:");
      }
    }

    // 兜底：mobilecdn 公开歌单 API
    return this.fetchPlaylistViaMobile(playlistId);
  }

  /**
   * 手机端票据读歌单歌曲：collection_ 开头的全局歌单 ID 走 pubsongs，纯数字的自建歌单 ID 走云歌单 v3。
   * 业务错误抛 KugouApiError（带错误码）。
   */
  private async fetchMobileTicketTracks(listId: string, ticket: KugouTicket, maxPages = 20): Promise<{ tracks: Track[]; name: string; cover: string }> {
    const id = String(listId || '').trim();
    if (!id) throw new Error('无效歌单 ID');
    const collection = id.startsWith('collection_');
    const pageSize = 100;
    const tracks: Track[] = [];
    let name = '';
    let cover = '';
    for (let page = 1; page <= maxPages; page++) {
      let data: { status?: number; error_code?: number; error?: string; data?: Record<string, any> };
      if (collection) {
        const params = kugouCommonParams(ticket, {
          area_code: 1, begin_idx: (page - 1) * pageSize, plat: 1, type: 1, mode: 1, personal_switch: 1,
          extend_fields: 'abtags,hot_cmt,popularization', pagesize: pageSize, global_collection_id: id,
        });
        const qs = kugouSignedQuery(params, p => kugouMobileSign(p));
        data = await this.http.requestJson(`https://gateway.kugou.com/pubsongs/v2/get_other_list_file_nofilt?${qs}`, {
          platform: 'kugou', cookie: '', headers: kugouMobileHeaders(ticket.mid, ticket.dfid || '-', params.clienttime),
        });
      } else {
        const params = kugouCommonParams(ticket);
        const bodyObj = { listid: id, userid: ticket.userid, type: 0, page, pagesize: pageSize, area_code: 1, allplatform: 1, show_cover: 1, token: ticket.token };
        const qs = kugouSignedQuery(params, p => kugouMobileSign(p, JSON.stringify(bodyObj)));
        data = await this.http.requestJson(`https://gateway.kugou.com/v4/get_list_all_file_v3?${qs}`, {
          platform: 'kugou', method: 'POST', body: bodyObj, cookie: '',
          headers: { ...kugouMobileHeaders(ticket.mid, ticket.dfid || '-', params.clienttime), 'x-router': 'cloudlist.service.kugou.com' },
        });
      }
      const code = Number(data?.error_code ?? 0) || 0;
      if (data?.status === 0 || code !== 0) throw new KugouApiError(code, String(data?.error || ''));
      const body = data?.data ?? {};
      if (page === 1) {
        name = stripKugouHtml(String(body.listname || body.list_info?.name || body.name || ''));
        cover = kugouCoverUrl(String(body.pic || body.list_info?.pic || ''));
      }
      const raw: Array<Record<string, any>> = body.songs ?? body.info ?? body.list ?? [];
      if (!Array.isArray(raw) || !raw.length) break;
      tracks.push(...raw.map(mapKugouPlaylistTrack).filter((t): t is Track => !!t));
      if (raw.length < pageSize) break;
    }
    return { tracks, name, cover };
  }

  private async fetchPlaylistViaMobileTicket(playlistId: string, ticket: KugouTicket): Promise<Playlist> {
    const { tracks, name, cover } = await this.fetchMobileTicketTracks(playlistId, ticket);
    if (!tracks.length) throw new Error('歌单为空');
    return { id: playlistId, platform: 'kugou', name: name || '酷狗歌单', cover, tracks };
  }

  /** H5 网关取歌单（需登录，支持用户歌单 listid） */
  private async fetchPlaylistViaH5(playlistId: string, cookie: string, userid: string, token: string): Promise<Playlist> {
    const mid = this.extractCookieValue(cookie, 'kg_mid') || '';
    const dfid = this.extractCookieValue(cookie, 'kg_dfid') || '-';
    const listid = parseKugouListId(playlistId);
    if (!listid) throw new Error('无效歌单 ID');

    let allTracks: Track[] = [];
    let playlistName = '酷狗歌单';
    let playlistCover = '';
    let page = 1;
    const pageSize = 100;

    // 分页获取所有歌曲
    while (true) {
      const params: Record<string, string> = {
        srcappid: String(H5_SRC_APPID), clientver: String(H5_CLIENTVER), clienttime: String(Date.now()),
        mid: mid || '0', uuid: String(Date.now()), dfid: dfid || '-',
        appid: '1014', token, userid, plat: '1',
      };
      const bodyObj = { listid: Number(listid) || listid, userid: Number(userid), token, area_code: 1, show_relate_goods: 0, pagesize: pageSize, allplatform: 1, show_cover: 1, type: 0, page };
      params.signature = h5Sign(params, bodyObj);
      const qs = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
      const url = 'https://gateway.kugou.com/v4/get_list_all_file?' + qs;
      const data = await this.http.requestJson<{ data?: { info?: Array<Record<string, any>>; listname?: string; pic?: string; count?: number } }>(
        url, { platform: 'kugou', method: 'POST', body: bodyObj, headers: { 'x-router': 'cloudlist.service.kugou.com' } },
      );

      if (page === 1) {
        playlistName = stripKugouHtml(String(data?.data?.listname || '酷狗歌单'));
        playlistCover = kugouCoverUrl(String(data?.data?.pic || ''));
      }

      const rawList = data?.data?.info ?? [];
      if (!rawList.length) break;

      const tracks = rawList.map(mapKugouPlaylistTrack).filter((t): t is Track => !!t);
      allTracks.push(...tracks);

      // 如果返回数量少于 pageSize，说明已到末页
      if (rawList.length < pageSize) break;
      page++;
      if (page > 20) break; // 安全上限
    }

    if (!allTracks.length) throw new Error('歌单为空');
    // 酷狗返回最旧在前，反转为最新在上
    allTracks.reverse();
    return { id: playlistId, platform: 'kugou', name: playlistName, cover: playlistCover, tracks: allTracks };
  }

  /** mobilecdn 公开歌单 API（无需登录） */
  private async fetchPlaylistViaMobile(specialId: string): Promise<Playlist> {
    const data = await this.http.requestJson<{
      data?: { info?: Array<Record<string, any>> };
    }>(
      `https://mobilecdn.kugou.com/api/v3/special/song?specialid=${encodeURIComponent(specialId)}&page=1&pagesize=300&plat=0&version=9000`,
      { platform: 'kugou' },
    );
    const list = data?.data?.info ?? [];
    if (!list.length) throw new Error('酷狗歌单不存在或已失效');
    return {
      id: specialId,
      platform: 'kugou',
      name: `酷狗歌单 ${specialId}`,
      cover: '',
      tracks: list.map(mapKugouMobileTrack).filter((t): t is Track => !!t),
    };
  }

  async searchSongs(keyword: string, pageSize = 10): Promise<Track[]> {
    try {
      const data = await this.http.requestJson<{
        data?: { lists?: Array<Record<string, any>> };
      }>(
        `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}&page=1&pagesize=${pageSize}&platform=WebFilter&tag=em&filter=2&iscorrection=1&privilege_filter=0`,
        { platform: 'kugou' },
      );
      return (data?.data?.lists ?? []).map(mapKugouTrack).filter((t): t is Track => !!t);
    } catch (err) {
      console.warn("[KugouAdapter] 搜索失败:");
      return [];
    }
  }

  /** VIP 探测：登录后调用一次，缓存 5 分钟。 */
  async probeVip(): Promise<VipStatus> {
    if (this.vipCache && Date.now() - this.vipCache.probedAt < VIP_TTL_MS) {
      return this.vipCache;
    }
    const cookie = this.cookies.getHeader('kugou');
    if (!cookie) {
      const anon: VipStatus = { isVip: false, isSvip: false, expireTime: 0, probedAt: Date.now() };
      this.vipCache = anon;
      return anon;
    }
    try {
      const ts = Math.floor(Date.now() / 1000);
      const data = await this.http.requestJson<{
        data?: { is_vip?: number; is_svip?: number; vip_expire_time?: number };
      }>(
        `https://vip.kugou.com/recharge/roleinfo?n=${ts}`,
        {
          platform: 'kugou',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Referer: 'https://vip.kugou.com/',
          },
        },
      );
      const d = data?.data;
      const result: VipStatus = {
        isVip: d?.is_vip === 1 || d?.is_svip === 1,
        isSvip: d?.is_svip === 1,
        expireTime: d?.vip_expire_time ?? 0,
        probedAt: Date.now(),
      };
      this.vipCache = result;
      return result;
    } catch (err) {
      console.warn("[KugouAdapter] VIP 探测失败:");
      const fallback: VipStatus = { isVip: false, isSvip: false, expireTime: 0, probedAt: Date.now() };
      this.vipCache = fallback;
      return fallback;
    }
  }

  private getCacheKey(hash: string): string {
    const rec = this.cookies.get('kugou');
    const userid = this.extractKugouUserId(rec?.cookies || '') || '0';
    const token = this.extractKugouToken(rec?.cookies || '') || '';
    return `${userid}:${token}:${hash}`;
  }

  private extractCookieValue(cookie: string | undefined | null, name: string): string {
    if (!cookie) return '';
    for (const seg of cookie.split(';')) {
      const eq = seg.indexOf('=');
      if (eq <= 0) continue;
      const k = seg.slice(0, eq).trim();
      const v = seg.slice(eq + 1).trim();
      if (k === name) return v;
    }
    return '';
  }

  /** 提取酷狗用户 ID（兼容多种 cookie 字段名） */
  private extractKugouUserId(cookie: string): string {
    for (const name of ['KugooID', 'kugooID', 'userid', 'UserId', 'kugouID', 'uid']) {
      const v = this.extractCookieValue(cookie, name);
      if (v && v !== '0') return v.replace(/\D/g, '');
    }
    // KuGoo 复合值中提取
    const kuGoo = this.extractCookieValue(cookie, 'KuGoo');
    if (kuGoo) {
      try {
        const decoded = decodeURIComponent(kuGoo.replace(/%u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
        const match = decoded.match(/(?:KugooID|userid|uid)=(\d+)/);
        if (match) return match[1];
      } catch { /* */ }
    }
    return '';
  }

  /** 提取酷狗 token（兼容多种 cookie 字段名） */
  private extractKugouToken(cookie: string): string {
    for (const name of ['t', 'token', 'Token', 'T']) {
      const v = this.extractCookieValue(cookie, name);
      if (v) return v;
    }
    return '';
  }

  /**
   * 四路取链：hash 质量链（Res→SQ→HQ→File）× 四路（H5→Mobile→Web→Gateway）
   * H5 为主路径，音质受限时逐路降级补偿。
   */
  async fetchSongUrl(hash: string, albumId?: string, quality?: string, extra?: Record<string, unknown>): Promise<SongUrl | null> {
    // 指定档位向下尝试；不同音质的 hash 不能总从最高档开始。
    const all=[{level:'hires',hash:extra?.resHash},{level:'flac',hash:extra?.sqHash},{level:'320',hash:extra?.hqHash},{level:'128',hash}];
    const at=all.findIndex(x=>x.level===quality);
    const candidates=[...new Set(all.slice(at<0?0:at).map(x=>String(x.hash || '')).filter(Boolean))];

    const cookie = this.cookies.getHeader('kugou') || '';
    const rec = this.cookies.get('kugou');
    const userid = this.extractKugouUserId(rec?.cookies || '') || '';
    const token = this.extractKugouToken(rec?.cookies || '') || '';
    const mid = this.extractCookieValue(cookie, 'kg_mid') || String(Math.floor(Math.random() * 1e10));
    const dfid = this.extractCookieValue(cookie, 'kg_dfid') || '';

    for (const h of candidates) {
      // 检查缓存
      const ck = this.getCacheKey(h);
      const cached = this.urlCache.get(ck);
      if (!requestScope()?.forceRefresh && cached && cached.cachedUntil > Date.now() && cached.expiresAt > Date.now()+5000) {
        return { url: cached.url, quality: cached.quality, expiresAt:cached.expiresAt };
      }

      // 不让失效的旧 mobile 路由挡住 web/H5；每路都继承父预算。
      const routes: Array<() => Promise<SongUrl | null>> = [
        () => this.fetchH5(h, albumId, quality, userid, token, mid, dfid, cookie),
        () => this.fetchMobile(h, albumId, userid, token),
        () => this.fetchWeb(h, albumId, mid, dfid, userid, token),
        () => this.fetchGateway(h, albumId, quality, userid, token, mid, dfid),
      ];
      const control=new AbortController();
      try {
        const result=await new Promise<SongUrl>((resolve,reject)=> {
          let remaining=routes.length;
          routes.forEach(route=> {
            void withRequestScope(1500,route,{signal:control.signal}).then(r=> {
              if(r?.url)resolve(r);else if(--remaining===0)reject(new Error('NO_SOURCE'));
            }).catch(()=>{if(--remaining===0)reject(new Error('NO_SOURCE'))});
          });
        });
        const timing=sourceTiming('kugou',Date.now(),result.expiresAt);
        this.urlCache.set(ck,{url:result.url,quality:result.quality || '',cachedUntil:Date.now()+120000,expiresAt:timing.expiresAt});
        if(this.urlCache.size>256)this.urlCache.delete(this.urlCache.keys().next().value!);
        return {...result,...timing};
      } catch { throwIfCancelled(); }
      finally { control.abort(); }
    }

    return { url: '', playable: false, trial: false, error: '酷狗四路取链均失败' };
  }

  private async fetchH5(hash: string, albumId: string | undefined, quality: string | undefined, userid: string, token: string, mid: string, dfid: string, cookie: string): Promise<SongUrl | null> {
    if (!userid || !token) return null;
    const params: Record<string, string> = {
      srcappid: String(H5_SRC_APPID),
      clientver: String(H5_CLIENTVER),
      clienttime: String(Date.now()),
      mid, uuid: mid, dfid,
      appid: '1014', token, userid,
      area_code: '1', hash,
      ssa_flag: 'is_fromtrack', version: '11430',
      quality: quality || '320',
      album_audio_id: albumId || '',
      behavior: 'play', pid: '2', cmd: '26', pidversion: '3001',
      IsFreePart: '0', cdnBackup: '1', module: '',
    };
    params.key = md5(hash + SIGN_KEY_SALT + params.appid + mid + (userid || '0'));
    const signature = h5Sign(params);
    const qs = Object.entries({...params, signature}).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const data = await this.http.requestJson<{
      status?: number;
      url?: string;
      bitRate?: number;
      fileSize?: number;
    }>(
      `https://gateway.kugou.com/v5/url?${qs}`,
      {
        platform: 'kugou',
        headers: {
          'x-router': 'trackercdn.kugou.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        cookie: cookie || undefined,
      },
    );
    if (data?.status === 1 && data.url) {
      const bitrate=Number(data.bitRate || 0);
      const kbps=bitrate>10000?bitrate/1000:bitrate;
      const q=kbps>=900?'flac':kbps>=256?'320':kbps>0?'128':'';
      return { url: data.url.replace(/^http:/, 'https:'), quality: q };
    }
    return null;
  }

  private async fetchMobile(hash: string, albumId: string | undefined, userid: string, token: string): Promise<SongUrl | null> {
    const key = mobileKey(hash);
    const qs = `cmd=playInfo&hash=${encodeURIComponent(hash)}&key=${key}${albumId ? '&album_id=' + encodeURIComponent(albumId) : ''}&pid=1&forceDown=0&vip=${token ? '1' : '65530'}${userid ? '&userid=' + userid : ''}${token ? '&token=' + token : ''}`;
    const data = await this.http.requestJson<{
      url?: string;
      fileSize?: number;
      bitRate?: number;
      vip?: number;
    }>(
      `http://m.kugou.com/app/i/getSongInfo.php?${qs}`,
      {
        platform: 'kugou',
        headers: { Referer: 'http://m.kugou.com/' },
      },
    );
    // vip=65530 表示 VIP 限制
    if (data?.vip === 65530) return null;
    if (data?.url) {
      const bitrate=Number(data.bitRate || 0);
      const kbps=bitrate>10000?bitrate/1000:bitrate;
      const q=kbps>=900?'flac':kbps>=256?'320':kbps>0?'128':'';
      return { url: data.url.replace(/^http:/, 'https:'), quality: q };
    }
    return null;
  }

  private async fetchWeb(hash: string, albumId: string | undefined, mid: string, dfid: string, userid: string, token: string): Promise<SongUrl | null> {
    const params = new URLSearchParams({
      r: 'play/getdata',
      hash,
      appid: '1014',
      platid: '4',
      mid,
      dfid,
    });
    if (albumId) params.set('album_id', albumId);
    if (userid) params.set('userid', userid);
    if (token) params.set('token', token);
    const data = await this.http.requestJson<{
      data?: { play_url?: string; quality?: string; bitrate?: number };
    }>(
      `https://wwwapi.kugou.com/yy/index.php?${params.toString()}`,
      { platform: 'kugou' },
    );
    const url = data?.data?.play_url;
    if (url) {
      return { url: url.replace(/^http:/, 'https:'), quality: data?.data?.quality ?? '' };
    }
    return null;
  }

  private async fetchGateway(hash: string, albumId: string | undefined, quality: string | undefined, userid: string, token: string, mid: string, dfid: string): Promise<SongUrl | null> {
    if (!userid || !token) return null;
    const clienttime = String(Date.now());
    const params: Record<string, string> = {
      srcappid: String(ANDROID_APPID),
      clientver: String(ANDROID_CLIENTVER),
      clienttime, mid, uuid: mid, dfid,
      appid: String(ANDROID_APPID), token, userid,
      area_code: '1', hash,
      ssa_flag: 'is_fromtrack', version: '11430',
      quality: quality || '320',
      album_audio_id: albumId || '',
      behavior: 'play', pid: '2', cmd: '26', pidversion: '3001',
      IsFreePart: '0', cdnBackup: '1', module: '',
    };
    params.key = md5(hash + SIGN_KEY_SALT + params.appid + mid + (userid || '0'));
    const body = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    params.signature = androidSign(params, body);
    const qs = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const data = await this.http.requestJson<{
      status?: number;
      url?: string;
      bitRate?: number;
    }>(
      `https://gateway.kugou.com/v5/url?${qs}`,
      {
        platform: 'kugou',
        headers: {
          'User-Agent': ANDROID_UA,
          dfid, mid,
          'kg-rc': '1',
          'kg-thash': '5d816a0',
          'kg-rec': '1',
          'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
        },
      },
    );
    if (data?.status === 1 && data.url) {
      const bitrate=Number(data.bitRate || 0);
      const kbps=bitrate>10000?bitrate/1000:bitrate;
      const q=kbps>=900?'flac':kbps>=256?'320':kbps>0?'128':'';
      return { url: data.url.replace(/^http:/, 'https:'), quality: q };
    }
    return null;
  }

  async listQualities(): Promise<QualityOption[]> {
    const vip = await this.probeVip();
    const base: QualityOption[] = [
      { level: '128', label: '标准 128k' },
      { level: '320', label: '高品 320k' },
    ];
    if (vip.isVip) base.push({ level: 'flac', label: '无损 FLAC', needsVip: true });
    if (vip.isSvip) base.push({ level: 'hires', label: 'Hi-Res', needsSvip: true });
    return base;
  }

  /** 最近一次「我的歌单」请求的失败信息；成功或未请求时为 null。供上层区分「没有歌单」和「票据失效 / 接口出错」。 */
  lastPlaylistError: { code: number; expired: boolean } | null = null;

  /** 用户歌单列表（需登录）。失败返回 []，但错误码记在 lastPlaylistError，不静默吞掉。 */
  async fetchMyPlaylists(): Promise<PlaylistSummary[]> {
    const ticket = parseKugouTicket(this.cookies.get('kugou')?.cookies);
    this.lastPlaylistError = null;
    if (!ticket) return [];
    try {
      const r = await requestKugouMyPlaylists(this.http, ticket, 1, 50);
      if (r.kind !== 'ok') {
        this.lastPlaylistError = { code: r.code, expired: r.kind === 'expired' };
        console.warn(`[KugouAdapter] 歌单接口失败 错误码=${r.code}${r.kind === 'expired' ? '（登录票据失效）' : ''}`);
        return [];
      }
      if (!r.items.length) console.log('[KugouAdapter] 歌单接口成功但没有歌单');
      return mapKugouMyPlaylists(r.items);
    } catch (err) {
      console.warn('[KugouAdapter] 歌单获取失败（网络或解析）:', err instanceof Error ? err.message : '');
      return [];
    }
  }

  /** 歌单内歌曲（需登录） */
  async fetchPlaylistTracks(listId: string): Promise<Track[]> {
    const rec = this.cookies.get('kugou');
    const cookie = rec?.cookies || '';
    const userid = this.extractKugouUserId(cookie);
    const token = this.extractKugouToken(cookie);
    const mid = this.extractCookieValue(cookie, 'kg_mid') || '';
    const dfid = this.extractCookieValue(cookie, 'kg_dfid') || '';
    if (!userid || !token) return [];
    try {
      const ticket = parseKugouTicket(cookie);
      if (ticket?.mobile) return (await this.fetchMobileTicketTracks(listId, ticket)).tracks;
      const params: Record<string, string> = {
        srcappid: String(H5_SRC_APPID),
        clientver: String(H5_CLIENTVER),
        clienttime: String(Date.now()),
        mid: mid || '0', uuid: String(Date.now()), dfid: dfid || '-',
        appid: '1014', token, userid,
      };
      const bodyObj = { listid: listId, userid: Number(userid), token, area_code: 1, show_relate_goods: 0, pagesize: 100, allplatform: 1, show_cover: 1, type: 0, page: 1 };
      params.signature = h5Sign(params, bodyObj);
      const qs = Object.entries(params).map(([k,v]) => k+'='+encodeURIComponent(v)).join('&');
      const url = 'https://gateway.kugou.com/v4/get_list_all_file?' + qs;
      const data = await this.http.requestJson<{ data?: { info?: Array<Record<string, any>> } }>(url, { platform: 'kugou', method: 'POST', body: bodyObj, headers: { 'x-router': 'cloudlist.service.kugou.com' } });
      return (data?.data?.info ?? []).map(mapKugouTrack).filter((t): t is Track => !!t);
    } catch (err) {
      console.warn('[KugouAdapter] 歌单歌曲获取失败:', err instanceof KugouApiError ? `错误码 ${err.code}` : '');
      return [];
    }
  }

    /**
   * 歌词获取：krcs 双接口为主（search -> download，下载 KRC 逐字），
   * m.kugou.com krc.php 为兜底（纯行级 LRC）。
   */
  async fetchLyric(hash: string, timeMs?: number): Promise<Lyric | null> {
    // 1) krcs 双接口（主链）
    try {
      const duration = timeMs ? Math.round(timeMs / 1000) : 0;
      const searchUrl = `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=&duration=${duration}&hash=${encodeURIComponent(hash)}&album_audio_id=`;
      const searchData = await this.http.requestJson<{ candidates?: Array<{ id: string; accesskey: string }> }>(searchUrl, { platform: 'kugou' });
      const candidate = searchData?.candidates?.[0];
      if (candidate?.id && candidate?.accesskey) {
        const dlUrl = `https://krcs.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(candidate.id)}&accesskey=${encodeURIComponent(candidate.accesskey)}&fmt=krc&charset=utf8`;
        const dlData = await this.http.requestJson<{ content?: string }>(dlUrl, { platform: 'kugou' });
        const lyric=fromTimed(decodeKrc(dlData?.content || ''),'krc');
        if(lyric)return lyric;
      }
    } catch (err) {
      console.warn("[KugouAdapter] krcs 歌词搜索失败:");
    }
    // 2) m.kugou.com krc.php（兜底）
    try {
      const raw = await this.http.requestText(
        `https://m.kugou.com/app/i/krc.php?cmd=100&hash=${encodeURIComponent(hash)}${timeMs ? `&timelength=${Math.round(timeMs)}` : ''}`,
        { platform: 'kugou' },
      );
      if (!raw || raw.includes('<')) return null;
      return { lines: parseLrc(raw), raw, source: 'kugou' };
    } catch (err) {
      console.warn("[KugouAdapter] krc.php 歌词兜底失败:");
      return null;
    }
  }
}
