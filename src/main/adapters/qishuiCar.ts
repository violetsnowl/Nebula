/**
 * 汽水音乐「车机协议」：抖音扫码授权 + 未加密音频取链。
 *
 * 协议细节参考 MIT 许可的开源项目 qishui-music-api（GSQZ/qishui-music-api，版本 0.2.2，
 * 作者 sayqz；https://github.com/GSQZ/qishui-music-api）。本文件是按该项目的接口形状用 TypeScript
 * 重新写的实现，不是代码拷贝；协议常量（客户端标识、应用参数等）是车机端公开的固定值。
 *
 * 要点：
 * - 授权票据和汽水 PC 扫码登录（CookieStore 的 `qishui` 条目）完全独立，存在 `qishui-car` 条目里。
 * - 只取接口直接给出的未加密资源（车机只给标准音质），不解密、不提取密钥；只有加密资源时视为取不到。
 * - 所有失败都不抛：取链返回 null，原因（只有安全的错误码，不含地址和令牌）记在 lastFailure。
 */
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { CookieStore } from '../cookieStore';
import { requestScope } from '../requestScope';
import type { SongUrl } from '../types';

// ---------------------------------------------------------------------------
// 协议常量
// ---------------------------------------------------------------------------

export const QISHUI_CAR_KEY = 'qishui-car' as const;
export const QISHUI_CAR_UA = 'LunaOpenSDK/1.0.10';
const PREFIX = '/api/luna/v1/platform';
const CLIENT_KEY = 'aw4bbxfujo741d09';
const QR_SIGNATURE = 'cf9024ea72d9c71813238b13ea107a3d';
const QR_TTL_MS = 300_000;
/** 距离到期不足这个时间就先续期。 */
const RENEW_WINDOW_MS = 3_600_000;
/** 接口没给有效期时的保守假设。 */
const DEFAULT_CREDENTIAL_MS = 6 * 3_600_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** 平台明确拒绝令牌 / 票据的错误码；客户端令牌过期是其中的 28001008。 */
const AUTH_CODES = new Set([28001003, 28001007, 28001008, 10007]);
const TOKEN_EXPIRED = '28001008';

const COMMON: Record<string, string> = {
  aid: '765213',
  app_id: '765213',
  app_name: 'byte_autoservice_lite',
  version_code: '100010',
  version_name: '1.0.10',
  channel: 'bydSong',
  sdk_aid: '753999',
  caller_name: 'luna_open_sdk',
  sdk_version_code: '100000100',
  sdk_version_name: '0.0.1',
  sdk_channel: 'Test',
  vehicle_type: 'BYD',
  device_brand: 'BYD',
  device_type: 'BYD',
  device_platform: 'android',
  resolution: '1920x1080',
  os_version: '13',
  ac: 'wifi',
};

/** 媒体地址只认字节系 CDN / 官方域名，避免被接口返回的地址带去别处。 */
const MEDIA_HOSTS = [
  '365yg.com', 'douyinvod.com', 'douyinscdn.com', 'bytefcdn.com', 'bytecdn.cn', 'byteicdn.com', 'ibytedtos.com',
  'pstatp.com', 'snssdk.com', 'bytedance.com', 'bytetos.com', 'volcvideo.com', 'volccdn.com', 'volces.com',
  'volcengineapi.com', 'douyin.com', 'qishui.com', 'zijieapi.com', 'zjcdn.com',
];

export type CarQuality = 'standard' | 'high' | 'lossless' | 'hires';
const QUALITY_RANK: CarQuality[] = ['standard', 'high', 'lossless', 'hires'];
const QUALITY_NAMES: Record<string, CarQuality> = { medium: 'standard', higher: 'high', highest: 'high', lossless: 'lossless', hi_res: 'hires' };

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

export type CarErrorCode = 'network' | 'invalid-response' | 'auth-required' | 'unavailable' | 'not-playable' | 'unsupported';

/** 只有错误码、阶段名和平台错误码，不带地址 / 令牌 / 原始响应。 */
export class CarError extends Error {
  constructor(readonly code: CarErrorCode, message: string, readonly upstreamCode?: string, public stage?: string) {
    super(message);
    this.name = 'CarError';
  }
}

// ---------------------------------------------------------------------------
// 纯函数：参数、签名、票据
// ---------------------------------------------------------------------------

/** 设备标识：19 位数字，授权时生成一次，随票据保存并复用。 */
export function createCarDeviceId(random: (n: number) => Buffer = randomBytes): string {
  return (random(8).readBigUInt64BE() % 9_000_000_000_000_000_000n + 1_000_000_000_000_000_000n).toString();
}

/** 车机接口的通用查询参数。 */
export function carParams(deviceId: string, now = Date.now(), nonce = randomBytes(2).readUInt16BE()): URLSearchParams {
  return new URLSearchParams({
    ...COMMON,
    device_id: deviceId,
    did: deviceId,
    iid: deviceId,
    vehicle_id: `qishui-${deviceId}`,
    _timestamp: String(Math.floor(now / 1000)),
    _nonce: String(nonce),
  });
}

/** 抖音开放平台扫码的固定参数（取二维码 / 轮询共用，轮询另加 token 和 timestamp）。 */
export function carQrParams(): Record<string, string> {
  return {
    aid: '1128',
    client_key: CLIENT_KEY,
    scope: 'user_info,luna.openapi.platform.interaction,luna.openapi.platform.me_tab,luna.commerce.openapi_platform.vip_info',
    state: '',
    next: '',
    jump_type: 'native',
    optional_scope_check: '',
    optional_scope_uncheck: '',
    customize_params: '{"source":"pc_auth","not_skip_confirm":"true"}',
    source_from: 'native',
    device_platform: 'android',
    app_identity: createHash('md5').update('com.luna.music.car').digest('hex'),
    signature: QR_SIGNATURE,
  };
}

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const n = body.length;
  const len = n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
}

export interface CarGuardKey {
  /** PKCS#8 PEM 私钥（P-256），只在本机保存。 */
  guardKey: string;
  /** 证书请求（PKCS#10 PEM 再做一次 base64），换票据时交给服务端签发客户端证书。 */
  csr: string;
}

/** 生成本次授权专用的 P-256 密钥和证书请求（subject: CN=bd-ticket-guard）。 */
export function createCarGuard(): CarGuardKey {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const rdn = (oidLast: number, value: string) => der(0x31, der(0x30, der(6, Buffer.from([0x55, 4, oidLast])), der(12, Buffer.from(value))));
  const subject = der(0x30, rdn(3, 'bd-ticket-guard'), rdn(11, ''), rdn(10, ''));
  const info = der(0x30, der(2, Buffer.from([0])), subject, publicKey.export({ type: 'spki', format: 'der' }), der(0xa0));
  const algorithm = der(0x30, der(6, Buffer.from('2a8648ce3d040302', 'hex')));
  const request = der(0x30, info, algorithm, der(3, Buffer.from([0]), sign('sha256', info, privateKey)));
  const pem = `-----BEGIN CERTIFICATE REQUEST-----\n${request.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE REQUEST-----\n`;
  return {
    guardKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    csr: Buffer.from(pem).toString('base64'),
  };
}

/** 本地保存的车机授权票据（JSON 存在 CookieStore 的 qishui-car 条目里）。 */
export interface CarCredential {
  v: 1;
  deviceId: string;
  ticket: string;
  guardKey: string;
  guardCert: string;
  guardTsSign: string;
  accessCode: string;
  openId: string;
  /** 授权有效期（毫秒时间戳）；0 表示已被平台拒绝 / 已失效。 */
  expiresAt: number;
  userId: string;
  user: { nickname: string; avatar?: string; isVip: boolean };
}

/** 账号类接口的票据签名头：ECDSA(SHA-256) 签 `ticket=…&path=…&timestamp=…`。 */
export function carGuardHeaders(credential: Pick<CarCredential, 'ticket' | 'guardKey' | 'guardCert' | 'guardTsSign'>, path: string, nowMs = Date.now()): Record<string, string> {
  for (const key of ['ticket', 'guardKey', 'guardCert', 'guardTsSign'] as const) {
    const v = credential[key];
    if (typeof v !== 'string' || !v || v.length > 16_384) throw new CarError('invalid-response', '票据字段无效');
  }
  const key = createPrivateKey(credential.guardKey);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new CarError('invalid-response', '票据密钥无效');
  const timestamp = Math.floor(nowMs / 1000);
  const content = `ticket=${credential.ticket}&path=${PREFIX}${path}&timestamp=${timestamp}`;
  return {
    'access-token': credential.ticket,
    'bd-ticket-guard-version': '1',
    'bd-ticket-guard-client-cert': credential.guardCert,
    'bd-ticket-guard-client-data': Buffer.from(JSON.stringify({
      ts_sign: credential.guardTsSign,
      req_content: 'ticket,path,timestamp',
      req_sign: sign('sha256', Buffer.from(content), key).toString('base64'),
      timestamp,
    })).toString('base64'),
  };
}

/** 解开换票据响应头 `bd-ticket-guard-server-data`（base64 的 JSON）。 */
export function readCarGuard(raw: string | null | undefined): { ticket: string; guardTsSign: string; guardCert: string } {
  if (typeof raw !== 'string' || !raw || raw.length > 65_536) throw new CarError('invalid-response', '票据响应缺失');
  let data: any;
  try { data = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch { throw new CarError('invalid-response', '票据响应无法解析'); }
  for (const key of ['ticket', 'ts_sign', 'client_cert']) {
    if (typeof data?.[key] !== 'string' || !data[key] || data[key].length > 16_384) throw new CarError('invalid-response', '票据响应缺字段');
  }
  const cert: string = data.client_cert;
  return { ticket: data.ticket, guardTsSign: data.ts_sign, guardCert: cert.includes('-----BEGIN') ? Buffer.from(cert).toString('base64') : cert };
}

/** expires_time 既可能是毫秒时间戳、秒时间戳，也可能是剩余秒数；缺省按 6 小时。 */
export function carCredentialExpiry(raw: unknown, now = Date.now()): number {
  const value = Number(raw || 0);
  const at = value > 1e12 ? value : value > 1e9 ? value * 1000 : value > 0 ? now + value * 1000 : now + DEFAULT_CREDENTIAL_MS;
  if (!Number.isFinite(at) || at <= now) throw new CarError('invalid-response', '票据有效期无效');
  return at;
}

export function isCarMediaUrl(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  return MEDIA_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

const isEncrypted = (item: any): boolean =>
  Boolean(item?.encrypt_info?.encrypt || item?.encrypt_info?.spade_a || item?.PlayAuth || Number(item?.Encrypt || 0));

export interface CarAudio {
  url: string;
  quality: CarQuality;
  /** 试听片段（只有这一版时）。 */
  preview: boolean;
  /** 毫秒时间戳；接口没给时缺省。 */
  expiresAt?: number;
}

/**
 * 从 /media/mget/ 返回的曲目里挑未加密音频：先整曲、再试听；同一版里只取不超过 requested 的最高档（没有就取现有最高）。
 * url_player_info 是备用的播放信息接口，由 getJson 取回。
 */
export async function pickCarAudio(
  track: any,
  requested: CarQuality,
  getJson: (url: string) => Promise<any>,
): Promise<CarAudio> {
  const player = track?.player_info;
  if (!player) throw new CarError('not-playable', '没有播放信息');
  let skippedUntrusted = false;
  for (const variant of ['full', 'preview'] as const) {
    const info = player[variant]?.video_model_info;
    if (!info) continue;
    const candidates: Array<{ url: string; quality: CarQuality; bitrate: number }> = [];
    const add = (rawUrl: unknown, quality: unknown, bitrate: unknown) => {
      const url = String(rawUrl || '');
      if (!isCarMediaUrl(url)) { skippedUntrusted = true; return; }
      candidates.push({ url, quality: QUALITY_NAMES[String(quality)] || 'standard', bitrate: Number(bitrate || 0) });
    };
    if (info.video_model) {
      let model: any;
      try { model = typeof info.video_model === 'string' ? JSON.parse(info.video_model) : info.video_model; } catch { throw new CarError('invalid-response', '播放模型无法解析'); }
      for (const item of model?.video_list || []) {
        if (isEncrypted(item) || !item?.main_url) continue;
        add(item.main_url, item.video_meta?.quality, item.video_meta?.bitrate);
      }
    }
    if (!candidates.length && info.url_player_info) {
      if (!isCarMediaUrl(String(info.url_player_info))) skippedUntrusted = true;
      else {
        const data = await getJson(String(info.url_player_info));
        const list = data?.Result?.Data?.PlayInfoList || data?.data?.PlayInfoList || data?.PlayInfoList;
        if (!Array.isArray(list)) throw new CarError('invalid-response', '播放信息缺列表');
        for (const item of list) {
          if (isEncrypted(item) || !item?.MainPlayUrl) continue;
          add(item.MainPlayUrl, item.Quality, item.Bitrate);
        }
      }
    }
    if (!candidates.length) {
      // 有未加密资源但域名不可信：明说，不悄悄退到试听
      if (skippedUntrusted) throw new CarError('invalid-response', '媒体域名不可信');
      continue;
    }
    const rank = (q: CarQuality) => QUALITY_RANK.indexOf(q);
    const allowed = candidates.filter((c) => rank(c.quality) <= rank(requested));
    const best = (allowed.length ? allowed : candidates).sort((a, b) => rank(b.quality) - rank(a.quality) || b.bitrate - a.bitrate)[0];
    const expireAt = Number(info.expire_at);
    return { url: best.url, quality: best.quality, preview: variant === 'preview', ...(expireAt > Date.now() / 1000 ? { expiresAt: expireAt * 1000 } : {}) };
  }
  throw new CarError('unsupported', '只有受保护的音频');
}

// ---------------------------------------------------------------------------
// 客户端
// ---------------------------------------------------------------------------

export type CarFetch = (url: string, init?: any) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<any> }>;

export interface CarOptions {
  fetch?: CarFetch;
  now?: () => number;
  log?: (message: string) => void;
}

export type CarState = 'authorized' | 'unauthorized' | 'expired';
export interface CarStatus {
  state: CarState;
  userId?: string;
  nickname?: string;
  avatar?: string;
  isVip?: boolean;
  /** 授权到期时间（毫秒时间戳）。 */
  expiresAt?: number;
}

export type CarQrState = 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'refused' | 'error';
export interface CarQrPoll {
  state: CarQrState;
  /** 终态：不用再轮询（confirmed / expired / refused，以及授权后半段出错）。 */
  final: boolean;
  message?: string;
}

interface PendingQr { token: string; image: string; deviceId: string; expires: number; task?: Promise<CarQrPoll> }

export class QishuiCar {
  /** 最近一次取链失败的安全原因（错误码 + 阶段），给诊断用。 */
  lastFailure: { code: string; stage?: string; upstreamCode?: string } | null = null;
  private pending = new Map<string, PendingQr>();
  /** 每次生成新二维码 / 退出都加一：让还在路上的授权作废。 */
  private generation = 0;
  /** 票据被换掉（退出、授权成功）就加一：让还在路上的续期作废。 */
  private revision = 0;
  private renewBackoffUntil = 0;
  private renewing: Promise<CarCredential | null> | null = null;
  private tokens = new Map<string, Promise<string>>();
  private fetcher: CarFetch;
  private now: () => number;
  private log: (message: string) => void;

  constructor(private cookies: CookieStore, options: CarOptions = {}) {
    this.fetcher = options.fetch ?? ((url, init) => (globalThis as any).fetch(url, init));
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
  }

  // ----- 票据存取 -----

  /** 读出本地票据；字段缺失或格式不对一律当没有。 */
  loadCredential(): CarCredential | null {
    const raw = this.cookies.get(QISHUI_CAR_KEY)?.cookies;
    if (!raw) return null;
    try {
      const c = JSON.parse(raw);
      if (c?.v !== 1 || !/^\d{19}$/.test(String(c.deviceId))) return null;
      for (const key of ['ticket', 'guardKey', 'guardCert', 'guardTsSign', 'accessCode', 'userId']) if (typeof c[key] !== 'string' || !c[key]) return null;
      return {
        v: 1, deviceId: c.deviceId, ticket: c.ticket, guardKey: c.guardKey, guardCert: c.guardCert, guardTsSign: c.guardTsSign,
        accessCode: c.accessCode, openId: String(c.openId || ''), expiresAt: Number(c.expiresAt) || 0, userId: c.userId,
        user: { nickname: String(c.user?.nickname || ''), avatar: c.user?.avatar ? String(c.user.avatar) : undefined, isVip: c.user?.isVip === true },
      };
    } catch { return null; }
  }

  private saveCredential(c: CarCredential): void {
    this.cookies.set(QISHUI_CAR_KEY, JSON.stringify(c), undefined, c.user.nickname);
  }

  /** 已授权且在有效期内。 */
  hasUsableCredential(): boolean {
    const c = this.loadCredential();
    return !!c && c.expiresAt > this.now();
  }

  /** 退出车机授权：只清 qishui-car 条目，PC 登录不动。 */
  logout(): void {
    this.generation++;
    this.revision++;
    this.pending.clear();
    this.tokens.clear();
    this.cookies.clear(QISHUI_CAR_KEY);
    this.log('[QishuiCar] 已退出车机授权');
  }

  // ----- HTTP -----

  private async http(url: string, init: { body?: Record<string, unknown>; form?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<{ data: any; headers: { get(name: string): string | null } }> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    const scope = requestScope()?.signal;
    const onScopeAbort = () => timeout.abort();
    if (scope) { if (scope.aborted) timeout.abort(); else scope.addEventListener('abort', onScopeAbort, { once: true }); }
    try {
      const hasBody = init.body !== undefined || init.form !== undefined;
      let response;
      try {
        response = await this.fetcher(url, {
          method: hasBody ? 'POST' : 'GET',
          headers: {
            'user-agent': QISHUI_CAR_UA,
            ...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : init.body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...init.headers,
          },
          ...(init.form ? { body: new URLSearchParams(init.form).toString() } : init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
          redirect: 'error',
          signal: timeout.signal,
        });
      } catch { throw new CarError('network', '无法连接汽水服务'); }
      if (!response.ok) throw new CarError(response.status === 429 ? 'unavailable' : [401, 403].includes(response.status) ? 'auth-required' : 'network', `HTTP ${response.status}`);
      let data: any;
      try { data = await response.json(); } catch { throw new CarError('invalid-response', '响应不是 JSON'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CarError('invalid-response', '响应格式无效');
      const code = Number(data.err_no ?? data.data?.error_code ?? 0);
      if (code) throw new CarError(AUTH_CODES.has(code) ? 'auth-required' : 'unavailable', '汽水拒绝了请求', String(code));
      return { data, headers: response.headers };
    } finally {
      clearTimeout(timer);
      scope?.removeEventListener('abort', onScopeAbort);
    }
  }

  private query(base: string, deviceId: string, extra: Record<string, string> = {}): string {
    const params = carParams(deviceId, this.now());
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    return `${base}?${params}`;
  }

  /** 公共读取用的客户端令牌（按设备缓存；过期由调用方失效重取）。 */
  private clientToken(deviceId: string): Promise<string> {
    let task = this.tokens.get(deviceId);
    if (!task) {
      task = this.http(this.query(`https://open.qishui.com${PREFIX}/client/token/get/`, deviceId, { trigger_type: 'cold_start' }))
        .then(({ data }) => {
          if (typeof data.client_token !== 'string' || !data.client_token) throw new CarError('invalid-response', '缺少客户端令牌');
          return data.client_token as string;
        })
        .catch((e) => { if (this.tokens.get(deviceId) === task) this.tokens.delete(deviceId); throw e; });
      this.tokens.set(deviceId, task);
    }
    return task;
  }

  /** 账号接口（票据签名）。 */
  private async guarded(path: string, credential: CarCredential, body: Record<string, unknown> = {}): Promise<any> {
    const { data } = await this.http(this.query(`https://open.douyin.com${PREFIX}${path}`, credential.deviceId), {
      body: { ...body, common_params: credential.userId ? { user_id: credential.userId } : {} },
      headers: carGuardHeaders(credential, path, this.now()),
    });
    if (!data.data || typeof data.data !== 'object') throw new CarError('invalid-response', '缺少数据');
    return data.data;
  }

  /** 公共接口（客户端令牌 + 账号 user_id）。令牌过期时失效旧令牌并重试一次。 */
  private async publicRead(path: string, credential: CarCredential, body: Record<string, unknown>): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      const task = this.clientToken(credential.deviceId);
      try {
        const token = await task;
        const { data } = await this.http(this.query(`https://open.douyin.com${PREFIX}${path}`, credential.deviceId), {
          body: { ...body, common_params: credential.userId ? { user_id: credential.userId } : {} },
          headers: { 'access-token': token },
        });
        if (!data.data || typeof data.data !== 'object') throw new CarError('invalid-response', '缺少数据');
        return data.data;
      } catch (e) {
        if (!(e instanceof CarError) || e.upstreamCode !== TOKEN_EXPIRED || attempt) throw e;
        if (this.tokens.get(credential.deviceId) === task) this.tokens.delete(credential.deviceId);
      }
    }
  }

  private async fetchUser(credential: CarCredential): Promise<{ id: string; nickname: string; avatar?: string; isVip: boolean }> {
    const data = await this.guarded('/me/info/', credential);
    const user = data.my_info;
    if (typeof user?.id !== 'string' && typeof user?.id !== 'number') throw new CarError('invalid-response', '没有识别出账号');
    const id = String(user.id);
    if (!id || id.length > 512 || /[\s\x00-\x1f\x7f]/.test(id)) throw new CarError('invalid-response', '账号标识无效');
    return { id, nickname: String(user.nickname || ''), avatar: user.medium_avatar_url || user.avatar_url || user.thumb_avatar_url || undefined, isVip: user.is_vip === true };
  }

  /** 用 access_code 换票据：首次带证书请求（csr），续期时带已有证书。 */
  private async exchangeTicket(access: any, guard: { guardKey: string; csr?: string; guardCert?: string }, deviceId: string): Promise<Omit<CarCredential, 'userId' | 'user'>> {
    if (!access?.access_code) throw new CarError('invalid-response', '缺少 access_code');
    const openId = String(access.open_id || access.open_uid || '');
    const params = new URLSearchParams({ aid: '1128', client_key: CLIENT_KEY, device_platform: 'android' });
    const res = await this.http(`https://open-client.douyin.com/passport/open/get_access_ticket/?${params}`, {
      form: { access_code: String(access.access_code), open_id: openId },
      headers: { 'bd-ticket-guard-version': '1', ...(guard.csr ? { 'bd-ticket-guard-client-csr': guard.csr } : { 'bd-ticket-guard-client-cert': guard.guardCert! }) },
    });
    return {
      v: 1, deviceId, guardKey: guard.guardKey, ...readCarGuard(res.headers.get('bd-ticket-guard-server-data')),
      accessCode: String(access.access_code), openId, expiresAt: carCredentialExpiry(access.expires_time, this.now()),
    };
  }

  // ----- 扫码授权 -----

  /** 取二维码（匿名接口，不需要任何票据）。返回的 key 交给 pollQr。 */
  async createQr(): Promise<{ key: string; imageDataUrl: string; expiresIn: number }> {
    for (const [k, v] of this.pending) if (v.expires <= this.now()) this.pending.delete(k);
    const mine = ++this.generation;
    const { data } = await this.http(`https://open.douyin.com/oauth/get_qrcode/?${new URLSearchParams(carQrParams())}`);
    const qr = data.data;
    if (!qr?.token || !qr.qrcode) throw new CarError('invalid-response', '缺少二维码');
    if (mine !== this.generation) throw new CarError('unavailable', '授权已取消');
    this.pending.clear();
    const key = randomBytes(16).toString('hex');
    this.pending.set(key, { token: String(qr.token), image: `data:image/png;base64,${qr.qrcode}`, deviceId: createCarDeviceId(), expires: this.now() + QR_TTL_MS });
    this.log('[QishuiCar] 授权二维码已生成');
    return { key, imageDataUrl: this.pending.get(key)!.image, expiresIn: Math.round(QR_TTL_MS / 1000) };
  }

  /** 轮询二维码；同一个 key 的并发轮询共用一次查询。不抛异常：网络波动回 error（非终态）。 */
  pollQr(key: string): Promise<CarQrPoll> {
    const value = this.pending.get(key);
    if (!value || value.expires <= this.now()) { this.pending.delete(key); return Promise.resolve({ state: 'expired', final: true, message: '二维码已过期，请重新获取' }); }
    if (!value.task) value.task = this.pollOnce(key, value).finally(() => { value.task = undefined; });
    return value.task;
  }

  private async pollOnce(key: string, value: PendingQr): Promise<CarQrPoll> {
    const generation = this.generation;
    let stage = 'check';
    try {
      const { data } = await this.http(`https://open.douyin.com/oauth/check_qrcode/?${new URLSearchParams({ ...carQrParams(), token: value.token, timestamp: String(this.now()) })}`);
      const r = data.data;
      if (!r || !['new', 'scanned', 'confirmed', 'expired', 'refused'].includes(r.status)) throw new CarError('invalid-response', '二维码状态无效');
      if (r.status === 'new') return { state: 'waiting', final: false, message: '用汽水音乐 App 扫码授权' };
      if (r.status === 'scanned') return { state: 'scanned', final: false, message: '已扫码，请在手机上确认' };
      if (r.status === 'expired') { this.pending.delete(key); return { state: 'expired', final: true, message: '二维码已过期，请重新获取' }; }
      if (r.status === 'refused') { this.pending.delete(key); return { state: 'refused', final: true, message: '已在手机上拒绝授权' }; }
      // confirmed：auth_code 只能换一次，之后任何一步出错都是终态
      const code = r.code || r.auth_code;
      if (!code) throw new CarError('invalid-response', '缺少授权码');
      this.pending.delete(key);
      stage = 'access-code';
      const accessRes = await this.http(this.query(`https://open.qishui.com${PREFIX}/access/code/get/`, value.deviceId, { auth_code: String(code) }));
      stage = 'ticket';
      const credential = await this.exchangeTicket(accessRes.data.data || accessRes.data, createCarGuard(), value.deviceId);
      stage = 'account';
      const draft: CarCredential = { ...credential, userId: '', user: { nickname: '', isVip: false } };
      // 先用一个占位 userId 取账号：/me/info/ 的 common_params 不依赖它
      const user = await this.fetchUser(draft);
      if (generation !== this.generation) return { state: 'expired', final: true, message: '授权已取消' };
      this.revision++;
      this.renewBackoffUntil = 0;
      this.saveCredential({ ...credential, userId: user.id, user: { nickname: user.nickname, avatar: user.avatar, isVip: user.isVip } });
      this.log('[QishuiCar] 授权成功，票据已保存');
      return { state: 'confirmed', final: true, message: '汽水车机授权成功' };
    } catch (e) {
      const err = e instanceof CarError ? e : new CarError('invalid-response', '授权响应无法读取');
      const late = stage !== 'check';
      this.log(`[QishuiCar] 授权失败：${[err.code, late ? stage : 'check', err.upstreamCode].filter(Boolean).join(' ')}`);
      return { state: 'error', final: late, message: late ? '授权没有完成，请重新获取二维码' : '验证异常（持续重试中…）' };
    }
  }

  // ----- 状态与续期 -----

  /** 授权状态：没有票据 = unauthorized；已过期或被平台拒绝 = expired；到期前一小时内顺手续期。 */
  async status(): Promise<CarStatus> {
    let c = this.loadCredential();
    if (!c) return { state: 'unauthorized' };
    if (c.expiresAt < this.now() + RENEW_WINDOW_MS) c = (await this.renew()) ?? this.loadCredential();
    if (!c) return { state: 'unauthorized' };
    const info = { userId: c.userId, nickname: c.user.nickname, avatar: c.user.avatar, isVip: c.user.isVip, expiresAt: c.expiresAt || undefined };
    return c.expiresAt > this.now() ? { state: 'authorized', ...info } : { state: 'expired', ...info };
  }

  /** 续期（并发合一）。平台明确拒绝时票据置为失效（expiresAt=0，状态变 expired）；网络等失败保持原样。 */
  renew(): Promise<CarCredential | null> {
    if (!this.renewing) this.renewing = this.renewOnce().finally(() => { this.renewing = null; });
    return this.renewing;
  }

  private async renewOnce(): Promise<CarCredential | null> {
    const old = this.loadCredential();
    // expiresAt=0 是平台明确拒绝过的，续期没有意义；其余失败后 1 分钟内不重复打扰平台
    if (!old || !old.expiresAt || this.now() < this.renewBackoffUntil) return null;
    const revision = this.revision;
    try {
      const refreshed = await this.http(this.query(`https://open.qishui.com${PREFIX}/access/code/refresh/`, old.deviceId, { access_code: old.accessCode }));
      const access = refreshed.data.data || refreshed.data;
      const next = await this.exchangeTicket({ ...access, open_id: access?.open_id || access?.open_uid || old.openId }, old, old.deviceId);
      const candidate: CarCredential = { ...next, userId: old.userId, user: old.user };
      const user = await this.fetchUser(candidate);
      if (user.id !== old.userId) throw new CarError('auth-required', '账号已变化', '10007');
      if (revision !== this.revision) return null;
      const saved: CarCredential = { ...candidate, user: { nickname: user.nickname, avatar: user.avatar, isVip: user.isVip } };
      this.saveCredential(saved);
      this.tokens.delete(old.deviceId);
      this.log('[QishuiCar] 票据已续期');
      return saved;
    } catch (e) {
      const err = e instanceof CarError ? e : null;
      // 只有平台带错误码的明确拒绝才作废；无错误码的 401/403、网络、解析失败都留着以后重试
      if (revision !== this.revision) return null;
      if (err?.code === 'auth-required' && err.upstreamCode) {
        this.saveCredential({ ...old, expiresAt: 0 });
        this.log('[QishuiCar] 票据被平台拒绝，已标记失效');
      } else {
        this.renewBackoffUntil = this.now() + 60_000;
        this.log(`[QishuiCar] 续期失败：${err ? err.code : 'unknown'}`);
      }
      return null;
    }
  }

  // ----- 歌词 -----

  /** 没有授权时读公开曲目信息用的设备 id（只在内存里，不落盘）。 */
  private anonDeviceId?: string;
  /**
   * 汽水歌词（#216）：/media/mget/ 曲目信息里的 display_info.lyric_info——原文 lyric_entity（实测 type=krc，明文逐字）
   * 和翻译 lang_translations（type=lrc）。不需要授权（2026-11-20 匿名实测 3/3 有逐字和中文翻译）：有授权用授权的设备，
   * 没有就用内存里随机生成的设备 id。网页 SEO 接口（seo_track）现在只回 status_info、没有歌词。失败返回 null，不抛。
   */
  async fetchCarLyric(trackId: string): Promise<{ type: string; content: string; translation?: string } | null> {
    try {
      if (!/^\d{1,30}$/.test(String(trackId))) return null;
      const own = this.loadCredential();
      const credential = own && own.expiresAt > this.now() ? own : ({ deviceId: (this.anonDeviceId ??= createCarDeviceId()) } as CarCredential);
      const data = await this.publicRead('/media/mget/', credential, { media_list: [{ id: String(trackId), type: 'track' }], card_context: {} });
      const list = Array.isArray(data?.media_list) ? data.media_list : [];
      const media = list.find((m: any) => String(m?.media_id || m?.track_entity?.base_info?.id) === String(trackId)) ?? list.find((m: any) => m?.track_entity);
      const info = media?.track_entity?.display_info?.lyric_info;
      const entity = info?.lyric_entity;
      if (!entity?.content || typeof entity.content !== 'string') return null;
      const trans = Object.entries(info.lang_translations ?? {}).find(([k]) => /^ZH/i.test(k))?.[1] as { content?: string } | undefined;
      return { type: String(entity.type || ''), content: entity.content, ...(typeof trans?.content === 'string' && trans.content ? { translation: trans.content } : {}) };
    } catch {
      return null;
    }
  }

  // ----- 取链 -----

  /**
   * 取歌曲播放地址（未加密、只有标准音质；整曲优先，没有整曲才给试听并标 trial）。
   * 没有有效票据 / 任何失败都返回 null（原因记在 lastFailure），不抛异常。
   */
  async fetchCarSongUrl(trackId: string, quality?: string): Promise<SongUrl | null> {
    this.lastFailure = null;
    try {
      if (!/^\d{1,30}$/.test(String(trackId))) throw new CarError('invalid-response', '歌曲 ID 无效', undefined, 'input');
      let credential = this.loadCredential();
      if (!credential) throw new CarError('auth-required', '没有车机授权', undefined, 'credential');
      if (credential.expiresAt < this.now() + RENEW_WINDOW_MS) credential = (await this.renew()) ?? this.loadCredential();
      if (!credential || credential.expiresAt <= this.now()) throw new CarError('auth-required', '车机授权已过期', undefined, 'credential');
      const wanted = QUALITY_RANK.includes(quality as CarQuality) ? (quality as CarQuality) : (QUALITY_NAMES[String(quality)] ?? 'hires');
      const data = await this.publicRead('/media/mget/', credential, { media_list: [{ id: String(trackId), type: 'track' }], card_context: {} });
      const list = data.media_list;
      if (!Array.isArray(list)) throw new CarError('invalid-response', '缺少曲目列表', undefined, 'media');
      const media = list.find((m: any) => String(m?.media_id || m?.track_entity?.base_info?.id) === String(trackId));
      if (!media?.track_entity) throw new CarError('not-playable', '汽水没有返回这首歌', undefined, 'media');
      const audio = await pickCarAudio(media.track_entity, wanted, async (url) => (await this.http(url)).data);
      return {
        url: audio.url,
        quality: audio.quality,
        level: audio.quality,
        playable: true,
        ...(audio.preview ? { trial: true } : {}),
        ...(audio.expiresAt ? { expiresAt: audio.expiresAt } : {}),
      };
    } catch (e) {
      const err = e instanceof CarError ? e : new CarError('invalid-response', '取链失败');
      this.lastFailure = { code: err.code, stage: err.stage, upstreamCode: err.upstreamCode };
      return null;
    }
  }
}
