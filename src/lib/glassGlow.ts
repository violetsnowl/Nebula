/**
 * 卡片邻近反馈（全局委托，零组件侵入）：指针靠近卡片时轻微上浮。
 * 写 CSS 变量 `--near-z / --near-s`（不用 class，避免被 React 的 className 协调清除）。
 *
 * P4（2026-11-12）删除了原来的"跟随光标的局部柔光"（`--gx / --gy / --glow-a` + `::after` 径向光晕）：
 * 它属于 NEBULA_UI_SYSTEM §6 禁止的通用发光。文件名沿用，避免改动调用方。
 */

const NEAR_RADIUS = 150;

/** 只有指针落在这些元素上时才更新邻近状态（沿用 P2 验收时的行为：在星云空白处移动不会让卡片上浮）。 */
const PROXIMITY_GATE = '.glass, .glass-btn, .music-card, .search-drop, .now-playing';

let initialized = false;
const proximityTargets = new Set<HTMLElement>();

function onPointerMove(e: PointerEvent): void {
  const t = e.target as HTMLElement | null;
  if (!t || !t.closest?.(PROXIMITY_GATE)) return;
  for (const el of proximityTargets) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = Math.hypot(e.clientX - cx, e.clientY - cy);
    const near = d < NEAR_RADIUS + Math.max(r.width, r.height) / 2;
    el.style.setProperty('--near-z', near ? '26px' : '0px');
    el.style.setProperty('--near-s', near ? '1.045' : '1');
  }
}

export function initGlassGlow(): () => void {
  if (initialized) return () => undefined;
  initialized = true;
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  return () => {
    initialized = false;
    document.removeEventListener('pointermove', onPointerMove);
  };
}

/** 注册邻近反馈目标（卡片挂载时调用，卸载时注销）。 */
export function registerProximity(el: HTMLElement | null): void {
  if (!el) return;
  proximityTargets.add(el);
}

export function unregisterProximity(el: HTMLElement | null): void {
  if (!el) return;
  proximityTargets.delete(el);
}
