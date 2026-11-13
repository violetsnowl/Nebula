import { useEffect, type RefObject } from 'react';
import { registerGlass } from './manager';
import type { GlassTier } from './materials';

/**
 * 把一个元素注册为玻璃面，获得折射滤镜（G1 / G2，以及 G3 的两侧面板）。
 * G3 的小弹层不调用它，只用 CSS 档位变量。
 * active = false 时不注册（例如 Dock 隐藏时，小球不需要折射滤镜，省掉 backdrop 开销）。
 */
export function useGlass(ref: RefObject<HTMLElement | null>, tier: GlassTier, active = true): void {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    return registerGlass(el, tier);
  }, [ref, tier, active]);
}
