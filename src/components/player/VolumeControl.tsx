import { memo, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import type { AudioPlayerState } from '../../lib/audio/AudioPlayer';
import { IconVolume } from './icons';

/**
 * 音量（NEBULA_UI_SYSTEM §9.1）：图标常显；悬停时在图标**上方**展开一条细胶囊（永不下方 / 侧向展开）。
 * 鼠标在图标与胶囊之间移动不消失（关闭延迟 + 悬停区域连续）；点击 / 拖动轨道、滚轮、方向键都能调。
 *
 * 细节（2026-11-16，用户要「更细、更精致、带点小动效」）：
 *   - 自绘滑杆：3px 细轨 + 封面强调色填充 + 小白点，拖动时轨道加粗、白点放大（元素自身变化，不发光）
 *   - 展开时胶囊从图标处升起，填充从 0 画到当前音量；收起时先淡出再卸载
 *   - 右侧数值平时是低一档的灰，调节中提亮；图标的声波随音量增减（0 无波、半格一道、过半两道，静音画叉）
 */
const STEP_WHEEL = 0.05;
const STEP_KEY = 0.05;

export const VolumeControl = memo(function VolumeControl({ state }: { state: AudioPlayerState }) {
  const volume = state.muted ? 0 : state.volume;
  // closed：不渲染；open：展开；closing：淡出中（0.14s 后卸载）
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const [dragging, setDragging] = useState(false);
  // 调节中（拖动、滚轮、按键后 0.8s 内）：数值提亮、白点放大
  const [adjusting, setAdjusting] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const unmountTimer = useRef<number | null>(null);
  const adjustTimer = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const clearTimers = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    if (unmountTimer.current !== null) window.clearTimeout(unmountTimer.current);
    closeTimer.current = unmountTimer.current = null;
  };
  const keepOpen = () => {
    clearTimers();
    setPhase('open');
  };
  const scheduleClose = () => {
    if (dragging) return;
    clearTimers();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPhase((p) => (p === 'closed' ? p : 'closing'));
      unmountTimer.current = window.setTimeout(() => {
        unmountTimer.current = null;
        setPhase('closed');
      }, 140);
    }, 160);
  };
  useEffect(
    () => () => {
      clearTimers();
      if (adjustTimer.current !== null) window.clearTimeout(adjustTimer.current);
    },
    [],
  );

  const pulse = () => {
    setAdjusting(true);
    if (adjustTimer.current !== null) window.clearTimeout(adjustTimer.current);
    adjustTimer.current = window.setTimeout(() => {
      adjustTimer.current = null;
      setAdjusting(false);
    }, 800);
  };
  const apply = (v: number) => {
    const next = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    audioPlayer.setVolume(next);
    if (next > 0 && state.muted) audioPlayer.toggleMute();
    pulse();
  };
  const fromPointer = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    apply((clientX - r.left) / r.width);
  };

  const onWheel = (e: WheelEvent<HTMLElement>) => {
    keepOpen();
    apply(volume + (e.deltaY > 0 ? -STEP_WHEEL : STEP_WHEEL));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? STEP_KEY
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -STEP_KEY
          : null;
    if (d !== null) apply(volume + d);
    else if (e.key === 'Home') apply(0);
    else if (e.key === 'End') apply(1);
    else return;
    e.preventDefault();
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    fromPointer(e.clientX);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) fromPointer(e.clientX);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    // 在胶囊外松开：照常收起
    const pop = e.currentTarget.closest('.vol-pop');
    const r = pop?.getBoundingClientRect();
    if (r && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) scheduleClose();
  };

  const pct = Math.round(volume * 100);
  const level = state.muted || volume <= 0 ? 0 : volume <= 0.5 ? 1 : 2;

  return (
    <div className="vol-ctl" onWheel={onWheel} onMouseEnter={keepOpen} onMouseLeave={scheduleClose}>
      <button
        className="bp-ctrl bp-vol"
        aria-label={state.muted ? '取消静音' : '静音'}
        data-tip={phase !== 'closed' ? undefined : '音量（滚轮调节）'}
        onClick={() => audioPlayer.toggleMute()}
      >
        <IconVolume muted={state.muted} level={level} />
      </button>
      {phase !== 'closed' && (
        <div
          className={`vol-pop glass-g3${phase === 'closing' ? ' is-closing' : ''}${dragging ? ' is-drag' : ''}${adjusting || dragging ? ' is-adjusting' : ''}`}
          style={{ ['--v' as string]: volume }}
          onMouseEnter={keepOpen}
          onMouseLeave={scheduleClose}
        >
          <div
            className="vol-slider"
            role="slider"
            tabIndex={0}
            aria-label="音量"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={state.muted ? '静音' : `${pct}%`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setDragging(false)}
            onKeyDown={onKey}
          >
            <div className="vol-track" ref={trackRef}>
              <i className="vol-fill" />
            </div>
            <i className="vol-knob" />
          </div>
          <span className="vol-num" aria-hidden="true">
            {pct}
          </span>
        </div>
      )}
    </div>
  );
});
