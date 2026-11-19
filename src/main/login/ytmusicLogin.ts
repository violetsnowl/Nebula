import crypto from 'node:crypto';
import type { CookieStore } from '../cookieStore';
import type { AccountInfo } from '../types';
import {
  defaultYtmusicTransport,
  YTMUSIC_AUTH_EXPIRED,
  YTMUSIC_UA,
  YtmusicAuthExpired,
  type YtmusicClient,
  type YtmusicTransport,
} from '../adapters/ytmusicAdapter';

/** 同时最多留几个待确认的设备码（用户反复点「重新获取」时丢最旧的）。 */
const MAX_PENDING = 6;

interface PendingDevice {
  /** 设备码只留在主进程，按 unikey 查，不下发前端。 */
  deviceCode: string;
  expiresAt: number;
  /** 轮询间隔（秒）；收到 slow_down 时加 5 秒。 */
  interval: number;
  /** 下一次允许真正去问 Google 的时间。 */
  nextAt: number;
  busy: boolean;
}

export interface YtmusicPollResult {
  ok: boolean;
  message: string;
  nickname?: string;
  /** 这个代码不会再有结果（过期 / 拒绝 / 已失效）：前端应停止轮询，让用户重新获取。 */
  final?: boolean;
}

/**
 * YouTube Music 登录：设备码（电视端那套）。
 * - createQr：向 Google 要设备码；返回 userCode 与验证地址给界面，device_code 留在待定表里；
 * - pollLogin：按 unikey 查设备码去换令牌，把 pending / slow_down / expired / denied 映射成中文提示；
 *   成功后先读 accounts_list 拿昵称，再把令牌存进 CookieStore（cookies=访问令牌，token=续期令牌）；
 * - getAccount：真实请求一次 accounts_list 核验（invalid_grant 或续期后仍 401 判过期，网络异常不判登出）。
 */
export class YtmusicLogin {
  private pending = new Map<string, PendingDevice>();

  constructor(
    private cookies: CookieStore,
    private client: YtmusicClient,
    private now: () => number = Date.now,
  ) {}

  async createQr(): Promise<{ unikey: string; payload: string; userCode: string; verificationUrl: string; expiresIn: number; interval: number }> {
    const dc = await this.client.requestDeviceCode();
    const t = this.now();
    for (const [k, p] of this.pending) if (p.expiresAt <= t) this.pending.delete(k);
    while (this.pending.size >= MAX_PENDING) this.pending.delete(this.pending.keys().next().value!);
    const unikey = crypto.randomUUID();
    this.pending.set(unikey, { deviceCode: dc.deviceCode, expiresAt: t + dc.expiresIn * 1000, interval: dc.interval, nextAt: 0, busy: false });
    return { unikey, payload: dc.verificationUrl, userCode: dc.userCode, verificationUrl: dc.verificationUrl, expiresIn: dc.expiresIn, interval: dc.interval };
  }

  async pollLogin(unikey: string): Promise<YtmusicPollResult> {
    const p = this.pending.get(unikey);
    if (!p) return { ok: false, message: '代码已失效，请重新获取', final: true };
    const t = this.now();
    if (t >= p.expiresAt) {
      this.pending.delete(unikey);
      return { ok: false, message: '代码已过期，请重新获取', final: true };
    }
    // 前端轮询比 Google 要求的间隔更勤、或上一次还没回来：不再去问 Google（问多了会被要求放慢）。
    if (p.busy || t < p.nextAt) return { ok: false, message: '等待你在浏览器里完成授权…' };
    p.busy = true;
    p.nextAt = t + Math.max(1000, p.interval * 1000 - 1000);
    let res: Awaited<ReturnType<YtmusicClient['exchangeDeviceCode']>>;
    try {
      res = await this.client.exchangeDeviceCode(p.deviceCode);
    } catch (err) {
      return { ok: false, message: `网络波动（${err instanceof Error ? err.message : String(err)}），正在重试…` };
    } finally {
      p.busy = false;
    }
    switch (res.state) {
      case 'pending':
        return { ok: false, message: '等待你在浏览器里完成授权…' };
      case 'slow_down':
        p.interval += 5;
        p.nextAt = this.now() + p.interval * 1000;
        return { ok: false, message: '请求太频繁，已放慢轮询，请稍候…' };
      case 'expired':
        this.pending.delete(unikey);
        return { ok: false, message: '代码已过期，请重新获取', final: true };
      case 'denied':
        this.pending.delete(unikey);
        return { ok: false, message: '已在浏览器拒绝授权，请重新获取代码', final: true };
    }
    this.pending.delete(unikey);
    if (!res.refreshToken) return { ok: false, message: 'YouTube 没有返回续期令牌，请重新获取代码', final: true };
    // 先读昵称再存令牌：这时令牌还没落盘，直接用刚拿到的访问令牌调；读不到不影响登录。
    let nickname = '';
    try {
      nickname = (await this.client.accountInfoWithToken(res.accessToken))?.nickname ?? '';
    } catch (err) {
      console.warn('[YtmusicLogin] 登录后读取账号昵称失败:', err instanceof Error ? err.message : '');
    }
    this.cookies.set('ytmusic', res.accessToken, res.refreshToken, nickname || undefined);
    return { ok: true, message: `登录成功${nickname ? '：' + nickname : ''}`, nickname: nickname || undefined };
  }

  async getAccount(): Promise<AccountInfo | null> {
    const rec = this.cookies.get('ytmusic');
    if (!rec?.cookies) return null;
    try {
      const me = await this.client.accountInfo();
      if (!me) throw new Error('accounts_list 没有账号信息');
      return {
        loggedIn: true,
        authStatus: 'valid',
        userId: me.handle || 'ytmusic',
        nickname: me.nickname || rec.nickname || 'YouTube 用户',
        avatarUrl: me.avatarUrl || undefined,
        vipType: me.isVip ? 1 : 0,
        isVip: me.isVip,
        isSvip: false,
      };
    } catch (err) {
      if (err instanceof YtmusicAuthExpired) return { loggedIn: false, authStatus: 'expired', error: YTMUSIC_AUTH_EXPIRED };
      // 网络异常等：不能判登出，保留存的昵称。
      console.warn('[YtmusicLogin] 账号核验失败，按未知处理:', err instanceof Error ? err.message : '');
      return { loggedIn: true, authStatus: 'unknown', userId: 'ytmusic', nickname: rec.nickname || 'YouTube 用户' };
    }
  }
}

/** 退出登录时尽力撤销续期令牌（失败一律忽略；令牌在 URL 里，所以也不记任何日志）。 */
export async function revokeYtmusicToken(refreshToken: string, transport: YtmusicTransport = defaultYtmusicTransport): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await transport({
      url: `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': YTMUSIC_UA },
      shared: true,
      timeoutMs: 5000,
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
