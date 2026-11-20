import type { CookieStore } from '../cookieStore';
import type { HttpClient } from '../http';
import type { AccountInfo } from '../types';
import { parseKuwoSession, readKuwoCookie } from '../adapters/kuwoAdapter';

function decode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** 官网写的 Cookie 值外面带一层双引号（实测 pic3 = "https://…"）。 */
function unquote(value: string): string {
  return value.trim().replace(/^"(.*)"$/s, '$1').trim();
}

/**
 * 酷我头像：cookie `pic3`（URL 编码 + 双引号包裹）。第三方登录时是微信 / QQ 的头像地址，
 * 末段 /132 是 132px 缩略图，换成 /0 取原图并升 https；酷我自己的图床保持原协议（https 证书与域名不匹配）。
 */
export function kuwoAvatarUrl(raw: string): string {
  const url = unquote(decode(raw || ''));
  if (!/^https?:\/\//i.test(url)) return '';
  if (/^https?:\/\/[^/]*\.qlogo\.cn\//i.test(url)) return url.replace(/^http:\/\//i, 'https://').replace(/\/(?:46|64|96|132)$/, '/0');
  return url;
}

const VIP_API = 'https://vip1.kuwo.cn/vip/v2/user/vip';
/** 会员接口里算「会员」的到期字段（毫秒时间戳字符串）；去广告 vipAd / 视频 vipWatch 不算。 */
const VIP_FIELDS = ['vipExpire', 'vipLuxuryExpire', 'vip3Expire', 'vipmExpire', 'svipExpire'] as const;

/**
 * 会员接口返回 → 会员状态：到期时间晚于服务器时间（`time`，缺失用本机时间）的字段才算有效。
 * 接口形状是匿名实测的；各字段对应哪档会员没有官方说明，所以只在「有没有任一档会员」和「svipExpire 有效」两处用。
 */
export function parseKuwoVip(data: unknown): { isVip: boolean; isSvip: boolean } | null {
  const d = (data as { data?: Record<string, unknown> } | null)?.data;
  if (!d || typeof d !== 'object') return null;
  const now = Number(d.time) || Date.now();
  const live = (key: string) => Number(d[key]) > now;
  return { isVip: VIP_FIELDS.some(live), isSvip: live('svipExpire') };
}

/**
 * 酷我账号信息：昵称 / 头像只读本地 cookie；有 http 时再查一次会员（失败不影响登录态）。
 * 没有登录失效判断：酷我的歌单读取与会员查询接口都不校验 sid（匿名拿假 sid 照样返回），暂时没有可用的服务端核验信号。
 * 校验逻辑集中在 parseKuwoSession。
 */
export class KuwoLogin {
  constructor(private cookies: CookieStore, private http?: HttpClient) {}

  async getAccount(): Promise<AccountInfo | null> {
    const cookie = this.cookies.getHeader('kuwo');
    if (!cookie) return null;
    const session = parseKuwoSession(cookie);
    if (!session) return { loggedIn: false, authStatus: 'missing', error: '酷我登录信息不完整，请重新登录' };
    const avatar = kuwoAvatarUrl(readKuwoCookie(cookie, 'pic3'));
    const vip = await this.fetchVip(session.uid, session.sid);
    return {
      loggedIn: true,
      authStatus: 'unknown',
      userId: session.uid,
      nickname: unquote(decode(readKuwoCookie(cookie, 'uname3'))) || unquote(decode(readKuwoCookie(cookie, 'username'))) || '酷我用户',
      avatarUrl: avatar || undefined,
      ...(vip ? { vipType: vip.isSvip ? 2 : vip.isVip ? 1 : 0, isVip: vip.isVip, isSvip: vip.isSvip } : {}),
    };
  }

  private async fetchVip(uid: string, sid: string): Promise<{ isVip: boolean; isSvip: boolean } | null> {
    if (!this.http) return null;
    try {
      const res = await this.http.requestJson<{ meta?: { code?: number } }>(
        `${VIP_API}?op=ui&uid=${encodeURIComponent(uid)}&sid=${encodeURIComponent(sid)}&token=`,
        { platform: 'kuwo', cookie: '', timeoutMs: 1500 },
      );
      return res?.meta?.code === 200 ? parseKuwoVip(res) : null;
    } catch {
      return null;
    }
  }
}
