/**
 * 播放器图标集（NEBULA_UI_SYSTEM §9.1，样张 I + J）：24 网格、currentColor。
 * 播放控制（上一首 / 下一首 / 播放 / 暂停）为实心圆角形；模式 / 音量 / 队列 / 评论为 1.7 线宽描边。
 * 显示尺寸由 styles.css 的 .bp-* 规则控制（svg 属性只是兜底）。
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function IconPrev() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
      <rect x="5.6" y="5.6" width="2" height="12.8" rx="1" />
      <path d="M17.5 6.2v11.6a.7.7 0 0 1-1.1.6L8.6 12.6a.7.7 0 0 1 0-1.2l7.8-5.8a.7.7 0 0 1 1.1.6z" />
    </svg>
  );
}

export function IconNext() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
      <rect x="16.4" y="5.6" width="2" height="12.8" rx="1" />
      <path d="M6.5 6.2v11.6a.7.7 0 0 0 1.1.6l7.8-5.8a.7.7 0 0 0 0-1.2L7.6 5.6a.7.7 0 0 0-1.1.6z" />
    </svg>
  );
}

export function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
      <path d="M8.6 5.6v12.8a.6.6 0 0 0 .9.5l10.2-6.4a.6.6 0 0 0 0-1L9.5 5.1a.6.6 0 0 0-.9.5z" />
    </svg>
  );
}

export function IconPause() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
      <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1.2" />
    </svg>
  );
}

/** 顺序播放：两条首尾相接的箭头 */
export function IconModeSequential() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE} aria-hidden="true">
      <path d="M17 3.5l3 3-3 3" />
      <path d="M4 11.5v-1a4 4 0 0 1 4-4h12" />
      <path d="M7 20.5l-3-3 3-3" />
      <path d="M20 12.5v1a4 4 0 0 1-4 4H4" />
    </svg>
  );
}

/** 随机播放：两条箭头交叉 */
export function IconModeShuffle() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE} aria-hidden="true">
      <path d="M3.5 17.5h2.4a4 4 0 0 0 3.3-1.8l5.6-8.4a4 4 0 0 1 3.3-1.8h2.4" />
      <path d="M17.8 3.9l2.7 2.6-2.7 2.6" />
      <path d="M3.5 6.5h2.4a4 4 0 0 1 3 1.4" />
      <path d="M14.2 16.1a4 4 0 0 0 3 1.4h3.3" />
      <path d="M17.8 14.9l2.7 2.6-2.7 2.6" />
    </svg>
  );
}

/** 单曲循环：顺序播放图标 + 中间的 1 */
export function IconModeRepeatOne() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE} aria-hidden="true">
      <path d="M17 3.5l3 3-3 3" />
      <path d="M4 11.5v-1a4 4 0 0 1 4-4h12" />
      <path d="M7 20.5l-3-3 3-3" />
      <path d="M20 12.5v1a4 4 0 0 1-4 4H4" />
      <path d="M10.9 10.9l1.5-1v5.2" />
    </svg>
  );
}

/**
 * 音量图标：声波随音量增减（level 0 无波、1 一道、2 两道），静音画叉。
 * 三组笔画常驻，靠 pathLength=1 的描边偏移画出 / 收回（样式在 styles.css 的 .vol-ico），切换时有过渡。
 */
export function IconVolume({ muted, level = 2 }: { muted: boolean; level?: 0 | 1 | 2 }) {
  return (
    <svg
      className="vol-ico"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      {...STROKE}
      aria-hidden="true"
      data-lv={muted ? 0 : level}
      data-muted={muted ? '' : undefined}
    >
      <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z" />
      <path className="va1" pathLength={1} d="M15.5 9a4 4 0 0 1 0 6" />
      <path className="va2" pathLength={1} d="M18 6.5a7.5 7.5 0 0 1 0 11" />
      <path className="vx" pathLength={1} d="M16 9.6l4.4 4.8M20.4 9.6L16 14.4" />
    </svg>
  );
}

export function IconQueue() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE} aria-hidden="true">
      <path d="M4 6.5h16M4 11.5h11M4 16.5h8" />
      <path d="M16.5 14.6v4.8l4-2.4z" fill="currentColor" />
    </svg>
  );
}

export function IconComments() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE} aria-hidden="true">
      <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8.5l-4 3.2v-3.2H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z" />
    </svg>
  );
}
