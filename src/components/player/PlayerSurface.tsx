import { memo, useRef, type ReactNode } from 'react';
import { useGlass } from '../../lib/glass';

export type PlayerVariant = 'compact' | 'expanded';

/**
 * PlayerSurface：Bottom Player 与 Listening Space 的**单一身份**根元素。
 * compact / expanded 只切换 class 与内部组合，DOM 根不卸载重挂（Phase 2 提供 expanded 内容）。
 * 材质：G1 主玻璃（NEBULA_UI_SYSTEM §3.3），折射滤镜由 GlassManager 按元素尺寸生成。
 */
export const PlayerSurface = memo(function PlayerSurface({
  variant,
  children,
}: {
  variant: PlayerVariant;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useGlass(ref, 'g1');
  return (
    <section ref={ref} className={`player-surface glass-g1 is-${variant}`}>
      {children}
    </section>
  );
});
