import type { CookieStore } from '../cookieStore';
import type { AccountInfo } from '../types';
import { parseKuwoSession, readKuwoCookie } from '../adapters/kuwoAdapter';

function decode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
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
    const avatar = decode(readKuwoCookie(cookie, 'pic3')).trim();
    return {
      loggedIn: true,
      authStatus: 'unknown',
      userId: session.uid,
      nickname: decode(readKuwoCookie(cookie, 'username')).trim() || '酷我用户',
      avatarUrl: /^https?:\/\//i.test(avatar) ? avatar : undefined,
    };
  }
}
