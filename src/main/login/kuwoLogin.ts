import type { CookieStore } from '../cookieStore';
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

/**
 * 酷我账号信息：只读本地 cookie，不发网络请求（官网没有可用的会话校验接口）。
 * 校验逻辑集中在 parseKuwoSession，真实账号实测后只需收紧那一处。
 */
export class KuwoLogin {
  constructor(private cookies: CookieStore) {}

  async getAccount(): Promise<AccountInfo | null> {
    const cookie = this.cookies.getHeader('kuwo');
    if (!cookie) return null;
    const session = parseKuwoSession(cookie);
    if (!session) return { loggedIn: false, authStatus: 'missing', error: '酷我登录信息不完整，请重新登录' };
    const avatar = kuwoAvatarUrl(readKuwoCookie(cookie, 'pic3'));
    return {
      loggedIn: true,
      authStatus: 'unknown',
      userId: session.uid,
      nickname: unquote(decode(readKuwoCookie(cookie, 'uname3'))) || unquote(decode(readKuwoCookie(cookie, 'username'))) || '酷我用户',
      avatarUrl: avatar || undefined,
    };
  }
}
