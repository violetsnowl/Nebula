import type { ReactNode } from 'react';

/**
 * 统一的小图标集（审查第 1 条）：以前面板 / 队列 / 搜索 / 评论里的 ×、‹、›、▶、♥、✓ 是字符，
 * 字体一换粗细和基线就不一样。这里全部画成同一套 SVG：24 网格、1.7 线宽、圆头圆角、颜色跟随 currentColor。
 * 播放器底栏那套（player/icons.tsx）尺寸和线宽另有规格，不在这里。
 */

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 16, className, children, solid }: IconProps & { children: ReactNode; solid?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      {...(solid
        ? { fill: 'currentColor', stroke: 'none' }
        : {
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.7,
            strokeLinecap: 'round' as const,
            strokeLinejoin: 'round' as const,
          })}
    >
      {children}
    </svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function IconChevronLeft(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14.5 6l-6 6 6 6" />
    </Svg>
  );
}

export function IconChevronRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.5 6l6 6-6 6" />
    </Svg>
  );
}

/** 播放三角：实心无描边（描边的三角在 10–12px 下发虚）。 */
export function IconPlay(p: IconProps) {
  return (
    <Svg {...p} solid>
      <path d="M8 5.6v12.8a.6.6 0 0 0 .9.5l10.2-6.4a.6.6 0 0 0 0-1L8.9 5.1a.6.6 0 0 0-.9.5z" />
    </Svg>
  );
}

export function IconHeart(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />
    </Svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

/** 准星（回到中心）：圆 r=6 + 四向短刻度（伸出圆外）+ 中心实心点（审查第 18 条）。 */
export function IconLocate(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="6" />
      <path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** 音符（导入本地音乐）：两个符头连一道横梁。 */
export function IconMusic(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 17.5V6l10-2v11.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="16.5" cy="15.5" r="2.5" />
    </Svg>
  );
}
