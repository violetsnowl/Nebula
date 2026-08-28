/** 播放器图标集：统一 24 viewBox、stroke/fill 走 currentColor，保持低视觉噪声。 */

export function IconPrev() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M6 5h2.2v14H6V5zm11.4 0L8.6 12l8.8 7V5z" />
    </svg>
  );
}

export function IconNext() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M15.8 5H18v14h-2.2V5zM4 5l9.4 7L4 19V5z" />
    </svg>
  );
}

export function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M8.2 5.2v13.6L19 12 8.2 5.2z" />
    </svg>
  );
}

export function IconPause() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M7.2 5h3.4v14H7.2V5zm6.2 0h3.4v14h-3.4V5z" />
    </svg>
  );
}

export function IconModeSequential() {
  // 顺序播放：两个围成一圈的箭头（经典 repeat 图标，线条风格）
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

export function IconModeShuffle() {
  // 随机播放：两条箭头交叉（经典 shuffle 图标）
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.8-1.1 2-1.7 3.3-1.7H22" />
      <path d="m18 2 4 4-4 4" />
      <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" />
      <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
      <path d="m18 14 4 4-4 4" />
    </svg>
  );
}

export function IconModeRepeatOne() {
  // 单曲循环：顺序播放图标 + 居中小数字 1
  return (
    <span className="mode-repeat-one">
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m17 2 4 4-4 4" />
        <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
        <path d="m7 22-4-4 4-4" />
        <path d="M21 13v1a4 4 0 0 1-4 4H3" />
        <path d="M12 9.4v5.2" />
        <path d="M10.7 10.9 12 9.4" />
      </svg>
    </span>
  );
}

export function IconVolume({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
        <path d="M4 9v6h4l5 4V5L8 9H4zm12.6 3 2.2-2.2-1.4-1.4-2.2 2.2-2.2-2.2-1.4 1.4L13.8 12l-2.2 2.2 1.4 1.4 2.2-2.2 2.2 2.2 1.4-1.4L16.6 12z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4zm11.5 3a3.5 3.5 0 0 0-2-3.15v6.3a3.5 3.5 0 0 0 2-3.15zm2 0c0 2.1-1.1 3.94-2.8 5l1.1 1.7A7 7 0 0 0 19 12a7 7 0 0 0-3.2-5.7l-1.1 1.7A5 5 0 0 1 17.5 12z" />
    </svg>
  );
}

export function IconQueue() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
      <path d="M4 6h16v2H4V6zm0 5h10v2H4v-2zm0 5h10v2H4v-2zm13-3 5 3-5 3v-6z" />
    </svg>
  );
}

export function IconComments() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm2 4v1h12V8H6zm0 4v1h8v-1H6z" />
    </svg>
  );
}
