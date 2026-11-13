/**
 * 性能自动降级（docs/design/NEBULA_UI_SYSTEM.md §3.7）。
 *
 * 降级顺序（依次叠加）：色散 → G2 折射 → G1 折射（退回磨砂参数）→ 环境光漂移。
 * 始终保留：歌名 / 歌手、播放状态、当前歌词可读性、核心交互（降级只动材质与背景动画）。
 *
 * 帧监测：每 10 秒采样一次、每次 2 秒（只在窗口可见时），记录 requestAnimationFrame 的帧间隔。
 * 一次采样里平均帧耗时 > 20ms 且超过一半的帧 > 20ms 记为"慢"；
 * 连续两次采样都慢才降一级——导入歌单、切歌解码这类几秒的短暂卡顿不会误判。
 * 本次运行内只降不升（避免来回切换造成闪烁）；用户可在设置里打开「性能优先」直接到最低档。
 * 不常驻 requestAnimationFrame：两次采样之间不占用帧。
 */

import { setGlassPerfLevel, type PerfLevel } from './glass';

export type { PerfLevel };
export const MAX_PERF_LEVEL: PerfLevel = 4;

const SAMPLE_EVERY_MS = 10_000;
const WINDOW_MS = 2_000;
const SLOW_FRAME_MS = 20;
/** 大于它的帧间隔视为停顿（GC、切后台），不计入统计。 */
const STALL_MS = 250;
const MIN_FRAMES = 20;

/** 启动帧监测：连续两次采样都慢时调用 onSlow。返回停止函数。 */
export function startFrameMonitor(onSlow: () => void): () => void {
  let raf = 0;
  let sampling = false;
  let start = 0;
  let last = 0;
  let deltas: number[] = [];
  let slowStreak = 0;

  const finish = (): void => {
    sampling = false;
    raf = 0;
    if (deltas.length < MIN_FRAMES) return;
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const slowShare = deltas.filter((d) => d > SLOW_FRAME_MS).length / deltas.length;
    const slow = avg > SLOW_FRAME_MS && slowShare > 0.5;
    slowStreak = slow ? slowStreak + 1 : 0;
    if (slowStreak >= 2) {
      slowStreak = 0;
      onSlow();
    }
  };

  const step = (now: number): void => {
    if (!sampling) return;
    if (last) {
      const d = now - last;
      if (d < STALL_MS) deltas.push(d);
    }
    last = now;
    if (now - start < WINDOW_MS) raf = requestAnimationFrame(step);
    else finish();
  };

  const sample = (): void => {
    if (sampling || document.visibilityState !== 'visible') return;
    sampling = true;
    deltas = [];
    last = 0;
    start = performance.now();
    raf = requestAnimationFrame(step);
  };

  const timer = window.setInterval(sample, SAMPLE_EVERY_MS);
  return () => {
    window.clearInterval(timer);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    sampling = false;
  };
}

/** 应用降级档位：材质交给 GlassManager；环境光漂移由 CSS 读根节点 data-perf 处理（档位 4）。 */
export function applyPerfLevel(level: PerfLevel): void {
  setGlassPerfLevel(level);
  if (typeof document !== 'undefined') document.documentElement.dataset.perf = String(level);
}
