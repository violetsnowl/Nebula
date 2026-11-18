import type { CookieStore } from '../cookieStore';
import type { HttpClient } from '../http';
import { QqSessionService, qqComm, qqCredential, qqSession } from './qqSession';

/**
 * QQ 音乐登录自动续期（QQ 号网页登录）。
 *
 * 官方网页本身不给 QQ 号登录续期（2026-11-18 查过 y.qq.com 前端脚本），所以直接调
 * music.login.LoginServer/Login（loginMode=2，QQ 型参数，参照 QQMusicApi 的 refresh_credential，代码自写）。
 * 2026-11-18 用户配置副本实测：网页登录没有 refresh_key 也能续出新的 musickey，
 * 服务器建议的有效期 keyExpiresIn=259200（3 天），旧票据续完后仍有效。
 *
 * 规则：新票据必须「返回成功 + 同一账号 + 核验有效」才整体替换；任何一项不满足都保留旧票据。
 * 续期期间用户换号或退出登录，结果直接丢弃。日志只写事件，不写任何票据。
 */

const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
/** 票据用了这么久就提前续（服务器建议 3 天，留一天余量）。 */
export const QQ_RENEW_AFTER_MS = 2 * 24 * 3600_000;
/** 定时检查间隔。 */
export const QQ_RENEW_CHECK_MS = 6 * 3600_000;
/** 续期失败后多久才再试。 */
export const QQ_RENEW_BACKOFF_MS = 30 * 60_000;

export type QqRenewReason = 'age' | 'expired' | 'manual';
export type QqRenewOutcome =
  | 'renewed'
  | 'not-needed'
  | 'unsupported'
  | 'rejected'
  | 'mismatch'
  | 'unverified'
  | 'network'
  | 'superseded'
  | 'backoff';
export interface QqRenewResult { ok: boolean; outcome: QqRenewOutcome; code?: number }

/** 按原顺序、原大小写拆 Cookie，便于只改几项、其余原样保留。 */
function parsePairs(cookie: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const part of cookie.split(';')) {
    const at = part.indexOf('=');
    if (at > 0) out.push([part.slice(0, at).trim(), part.slice(at + 1).trim()]);
  }
  return out;
}
function fieldMap(cookie: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [k, v] of parsePairs(cookie)) map[k.toLowerCase()] = v;
  return map;
}

/** 只有 QQ 号网页登录、且续期要用的几样都在，才尝试续期。微信登录参数不同、没实测，先不碰。 */
export function canRenewQq(cookie: string): boolean {
  const f = fieldMap(cookie), c = qqCredential(cookie);
  if (!c.key || c.uin === '0' || !['qm_keyst', 'qqmusic_key'].includes(c.keyName)) return false;
  if (f.wxopenid || f.login_type === '2' || f.tmelogintype === '1') return false;
  return !!(f.psrf_qqopenid && f.psrf_qqaccess_token && f.psrf_qqrefresh_token);
}

/** 当前票据用了多久（毫秒）；没有创建时间时返回 null。 */
export function qqKeyAgeMs(cookie: string, now = Date.now()): number | null {
  const created = Number(fieldMap(cookie).psrf_musickey_createtime || 0);
  if (!Number.isFinite(created) || created <= 0) return null;
  return now - (created > 1e12 ? created : created * 1000);
}

/** 续期请求体。tmeLoginType 2 = QQ 号（Cookie 里的 login_type=1 是另一套编号）。 */
export function buildQqRenewRequest(cookie: string): Record<string, unknown> {
  const f = fieldMap(cookie), c = qqCredential(cookie);
  return {
    comm: { ...qqComm(c), tmeLoginType: 2 },
    req_0: {
      module: 'music.login.LoginServer',
      method: 'Login',
      param: {
        openid: f.psrf_qqopenid || '',
        access_token: f.psrf_qqaccess_token || '',
        refresh_token: f.psrf_qqrefresh_token || '',
        refresh_key: f.refresh_key || '',
        musickey: c.key,
        musicid: Number(c.uin),
        expired_in: Number(f.psrf_access_token_expiresat || 0),
        loginMode: 2,
      },
    },
  };
}

/**
 * 校验续期返回并合并成新 Cookie；不合格返回 null。
 * 只改票据、票据创建时间和服务器发回的新授权令牌，其余字段与顺序原样保留。
 */
export function applyQqRenewal(cookie: string, response: any): { cookie: string } | { reject: QqRenewOutcome; code?: number } {
  const part = response?.req_0;
  if (response?.code !== 0 || part?.code !== 0 || !part?.data || typeof part.data !== 'object')
    return { reject: 'rejected', code: typeof part?.code === 'number' ? part.code : typeof response?.code === 'number' ? response.code : undefined };
  const d = part.data, f = fieldMap(cookie), c = qqCredential(cookie);
  const key = typeof d.musickey === 'string' ? d.musickey.trim() : '';
  if (!key) return { reject: 'rejected' };
  const ids = [d.str_musicid, d.musicid].filter((v) => v != null && v !== '' && v !== 0).map((v) => String(v).replace(/^o/, ''));
  if (!ids.length || ids.some((id) => id !== c.uin)) return { reject: 'mismatch' };
  if (typeof d.openid === 'string' && d.openid && f.psrf_qqopenid && d.openid !== f.psrf_qqopenid) return { reject: 'mismatch' };

  const updates: Record<string, string> = { qm_keyst: key, qqmusic_key: key };
  const created = Number(d.musickeyCreateTime);
  updates.psrf_musickey_createtime = String(Number.isFinite(created) && created > 0 ? Math.floor(created) : Math.floor(Date.now() / 1000));
  if (typeof d.access_token === 'string' && d.access_token) updates.psrf_qqaccess_token = d.access_token;
  if (typeof d.refresh_token === 'string' && d.refresh_token) updates.psrf_qqrefresh_token = d.refresh_token;
  const expiredAt = Number(d.expired_at);
  if (Number.isFinite(expiredAt) && expiredAt > 0) updates.psrf_access_token_expiresAt = String(Math.floor(expiredAt));
  if (typeof d.refresh_key === 'string' && d.refresh_key) updates.refresh_key = d.refresh_key;

  const pairs = parsePairs(cookie), seen = new Set<string>();
  const merged = pairs.map(([k, v]) => {
    const hit = Object.keys(updates).find((u) => u.toLowerCase() === k.toLowerCase());
    if (!hit) return [k, v] as [string, string];
    seen.add(hit);
    return [k, updates[hit]] as [string, string];
  });
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k) && (k !== 'qqmusic_key' || f.qqmusic_key)) merged.push([k, v]);
  return { cookie: merged.map(([k, v]) => `${k}=${v}`).join('; ') };
}

type Store = Pick<CookieStore, 'getHeader' | 'get' | 'set'>;
interface Options { now?: () => number; log?: (event: string) => void; renewAfterMs?: number; backoffMs?: number }

export class QqRenewService {
  private inflight?: Promise<QqRenewResult>;
  private failedAt = 0;
  private now: () => number;
  private log: (event: string) => void;
  private renewAfterMs: number;
  private backoffMs: number;

  constructor(private http: HttpClient, private cookies: Store, opts: Options = {}) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((e) => console.warn(`[QQ续期] ${e}`));
    this.renewAfterMs = opts.renewAfterMs ?? QQ_RENEW_AFTER_MS;
    this.backoffMs = opts.backoffMs ?? QQ_RENEW_BACKOFF_MS;
  }

  /** 票据够旧才续；新票据直接跳过。 */
  async maybeRenew(): Promise<QqRenewResult> {
    const cookie = this.cookies.getHeader('qq') || '';
    if (!canRenewQq(cookie)) return { ok: false, outcome: 'unsupported' };
    const age = qqKeyAgeMs(cookie, this.now());
    if (age != null && age < this.renewAfterMs) return { ok: false, outcome: 'not-needed' };
    return this.renew('age');
  }

  /** 同一时间只续一次；失败后一段时间内不再试。 */
  renew(reason: QqRenewReason): Promise<QqRenewResult> {
    if (this.inflight) return this.inflight;
    if (reason !== 'manual' && this.failedAt && this.now() - this.failedAt < this.backoffMs)
      return Promise.resolve({ ok: false, outcome: 'backoff' });
    this.inflight = this.run(reason).finally(() => { this.inflight = undefined; });
    return this.inflight;
  }

  private async run(reason: QqRenewReason): Promise<QqRenewResult> {
    const cookie = this.cookies.getHeader('qq') || '';
    if (!canRenewQq(cookie)) return { ok: false, outcome: 'unsupported' };
    const fail = (outcome: QqRenewOutcome, code?: number): QqRenewResult => {
      this.failedAt = this.now();
      this.log(`失败（${reason}）：${outcome}${code != null ? ` 代码=${code}` : ''}`);
      return { ok: false, outcome, code };
    };
    let response: unknown;
    try {
      response = await this.http.requestJson<unknown>(MUSICU, {
        platform: 'qq', cookie, method: 'POST', timeoutMs: 8000, body: buildQqRenewRequest(cookie),
      });
    } catch {
      return fail('network');
    }
    const merged = applyQqRenewal(cookie, response);
    if ('reject' in merged) return fail(merged.reject, merged.code);
    // 独立的核验实例：不污染共享缓存，也不触发「已过期」通知。
    const status = await new QqSessionService(this.http).check(merged.cookie, true).catch(() => 'unknown' as const);
    if (status !== 'valid') return fail('unverified');
    if ((this.cookies.getHeader('qq') || '') !== cookie) {
      this.log(`放弃（${reason}）：续期期间登录已变化`);
      return { ok: false, outcome: 'superseded' };
    }
    const rec = this.cookies.get('qq');
    this.cookies.set('qq', merged.cookie, rec?.token, rec?.nickname);
    this.failedAt = 0;
    this.log(`成功（${reason}）`);
    return { ok: true, outcome: 'renewed' };
  }

  /** 启动后稍等再检查一次，之后定时检查；确认过期时也续一次。返回停止函数。 */
  start(opts: { firstDelayMs?: number; intervalMs?: number } = {}): () => void {
    const tick = () => { void this.maybeRenew().catch(() => {}); };
    const first = setTimeout(tick, opts.firstDelayMs ?? 20_000);
    const timer = setInterval(tick, opts.intervalMs ?? QQ_RENEW_CHECK_MS);
    (first as { unref?: () => void }).unref?.();
    (timer as { unref?: () => void }).unref?.();
    const off = qqSession(this.http).onExpired((cookie) => {
      if (cookie === (this.cookies.getHeader('qq') || '')) void this.renew('expired').catch(() => {});
    });
    return () => { clearTimeout(first); clearInterval(timer); off(); };
  }
}
