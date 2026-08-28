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
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
      <path d="M7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h6v2H7v-2zM17 15l4 2-4 2v-4z" />
    </svg>
  );
}

export function IconModeShuffle() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
      <path d="M5 7h3.2l7.5 10H19a1 1 0 0 1 0 2h-3.2L8.3 9H5a1 1 0 0 1 0-2zm0 10h3.2L13 10.6l1.4 1.9L9.6 19H5a1 1 0 0 1 0-2zM19 5h-3.2L10.6 11l-1.4-1.9L14.4 5H19a1 1 0 0 1 0 2z" />
    </svg>
  );
}

export function IconModeRepeat() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
      <path d="M7 7h10v2.2l4-3.2-4-3.2V5H6a1 1 0 0 0-1 1v5h2V7zm10 10H7v-2.2l-4 3.2 4 3.2V19h11a1 1 0 0 0 1-1v-5h-2v4z" />
    </svg>
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
