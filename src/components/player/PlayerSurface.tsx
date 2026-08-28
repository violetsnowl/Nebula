import { memo, type ReactNode } from 'react';

export type PlayerVariant = 'compact' | 'expanded';

/**
 * PlayerSurface：Bottom Player 与 Listening Space 的**单一身份**根元素。
 * compact / expanded 只切换 class 与内部组合，DOM 根不卸载重挂（Phase 2 提供 expanded 内容）。
 * 材料参数走 CSS 变量（Frosted 现在，Liquid 未来只换变量）。
 */
export const PlayerSurface = memo(function PlayerSurface({
  variant,
  children,
}: {
  variant: PlayerVariant;
  children: ReactNode;
}) {
  return <section className={`player-surface is-${variant}`}>{children}</section>;
});
