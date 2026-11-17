import type { LoginAdapter } from '../login/index';
import { withRequestScope } from '../requestScope';

export interface FallbackTarget { platform: string; tier: 'svip' | 'vip' | 'free' | 'guest' }
export type PriorityProvider = (() => Promise<FallbackTarget[]>) & { invalidate(): void };

/** 权益在后台并发刷新；点播立即使用上一次结果或可播放平台的游客顺序。 */
export function createFallbackPriorityProvider(loginAdapters: Record<string, LoginAdapter>, excluded: string[] = ['qishui','spotify']): PriorityProvider {
  const platforms = ['netease','qq','kugou'].filter(p => loginAdapters[p] && !excluded.includes(p));
  const defaults = (): FallbackTarget[] => platforms.map(platform => ({ platform, tier:'guest' }));
  let order = defaults(), updated = 0, version = 0, pending = false;
  const get = (async () => {
    if (!pending && Date.now() - updated > 300000) {
      pending = true;
      const epoch = version;
      void Promise.all(platforms.map(async platform => {
        const acc = await withRequestScope(2000, async () => loginAdapters[platform].getAccount?.(), { detached:true }).catch(() => null);
        const tier: FallbackTarget['tier'] = !acc?.loggedIn ? 'guest' : acc.isSvip ? 'svip' : acc.isVip ? 'vip' : 'free';
        return { platform, tier };
      })).then(rows => {
        if (epoch !== version) return;
        const rank = { svip:0, vip:1, free:2, guest:3 };
        order = rows.sort((a,b) => rank[a.tier] - rank[b.tier]);
        updated = Date.now();
      }).finally(() => { pending = false; });
    }
    return order.map(row => ({ ...row }));
  }) as PriorityProvider;
  get.invalidate = () => { version++; updated = 0; order = defaults(); };
  return get;
}
