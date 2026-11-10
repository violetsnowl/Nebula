import { useEffect, type RefObject } from 'react';
import { registerGlass } from './manager';
import type { GlassTier } from './materials';

/** 把一个元素注册为玻璃面（G1 / G2 会获得折射滤镜；G3 只用 CSS 档位变量）。 */
export function useGlass(ref: RefObject<HTMLElement | null>, tier: GlassTier): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerGlass(el, tier);
  }, [ref, tier]);
}
