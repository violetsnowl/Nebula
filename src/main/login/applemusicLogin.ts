import type { CookieStore } from '../cookieStore';
import type { AccountInfo } from '../types';
import {
  APPLEMUSIC_AUTH_EXPIRED,
  AppleMusicAuthExpired,
  AppleMusicRestricted,
  type AppleMusicClient,
} from '../adapters/applemusicAdapter';

const DEFAULT_NICKNAME = 'Apple Music 用户';

/**
 * Apple Music 账号：登录态在页面分区里（官方页面里用 Apple ID 登录），CookieStore 里只存一条不含任何凭据的标记
 * （cookies = 'page-session'，不是 Cookie 头，也不会附到任何请求），表示「这个用户用过 Apple Music 登录」。
 * - 没有标记：直接返回 null，不唤起页面（没用过 Apple 的用户启动时不加载 music.apple.com）；
 * - 有标记：在页面里读账号地区 / 社交资料 / 订阅状态；401 判过期，页面没就绪、网络失败按未知处理（仍算已登录）。
 */
export class AppleMusicLogin {
  constructor(
    private cookies: CookieStore,
    private client: AppleMusicClient,
  ) {}

  async getAccount(): Promise<AccountInfo | null> {
    const marker = this.cookies.get('applemusic');
    if (!marker) return null;
    const fallback: AccountInfo = { loggedIn: true, authStatus: 'unknown', userId: 'applemusic', nickname: DEFAULT_NICKNAME };
    try {
      // 账号地区：读不到 / 401 / 403 都是页面里没有有效登录
      try {
        await this.client.storefront();
      } catch (err) {
        if (err instanceof AppleMusicRestricted) throw new AppleMusicAuthExpired();
        throw err;
      }
      // 社交资料和订阅状态只是锦上添花：它们单独失败（没有社交资料、Apple 临时拒绝）不影响登录判定
      const [profile, subscription] = await Promise.all([
        this.client.socialProfile().catch((err) => this.optional(err, { nickname: '', avatarUrl: '' })),
        this.client.subscriptionActive().catch((err) => this.optional(err, undefined)),
      ]);
      const isVip = subscription === true;
      return {
        loggedIn: true,
        authStatus: 'valid',
        userId: 'applemusic',
        nickname: profile.nickname || DEFAULT_NICKNAME,
        avatarUrl: profile.avatarUrl || undefined,
        vipType: isVip ? 1 : 0,
        isVip,
        isSvip: false,
      };
    } catch (err) {
      if (err instanceof AppleMusicAuthExpired) return { loggedIn: false, authStatus: 'expired', error: APPLEMUSIC_AUTH_EXPIRED };
      // 页面没就绪 / 网络异常：不能判登出，保留存的昵称
      console.warn('[AppleMusicLogin] 账号核验失败，按未知处理:', err instanceof Error ? err.message : '');
      return fallback;
    }
  }

  /** 可选信息读取失败：登录过期要继续往上抛，其余按缺省值。 */
  private optional<T>(err: unknown, value: T): T {
    if (err instanceof AppleMusicAuthExpired) throw err;
    return value;
  }
}
