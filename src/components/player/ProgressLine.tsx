import { memo, useRef, useState } from 'react';
import { audioPlayer, formatTime } from '../../lib/audio/AudioPlayer';

interface ProgressLineProps {
  current: number;
  duration: number;
  disabled: boolean;
}

/**
 * 底部播放器进度线（NEBULA_UI_SYSTEM §9.1）：顶边 2px 细线、左右内缩 22px；平时不显示时间。
 * 悬停播放条时细线变 3px（样式在 styles.css）；指针在 16px 高命中区上时跟一个时间点气泡，点击 / 拖动跳转。
 * 「当前 / 总长」不在这里画，由 BottomPlayer 的 .bp-time 负责（悬停播放条时显示）。
 */
export const ProgressLine = memo(function ProgressLine({ current, duration, disabled }: ProgressLineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // 指针所在位置：x 为相对轨道左端的像素，t 为该位置对应的时间（秒）
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const lastXRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  const ratioAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    return { ratio: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)), width: rect.width };
  };
  const seekFrom = (clientX: number) => {
    if (duration <= 0) return;
    const r = ratioAt(clientX);
    if (r) audioPlayer.seek(r.ratio * duration);
  };
  const updateHover = (clientX: number) => {
    if (duration <= 0) return;
    const r = ratioAt(clientX);
    if (r) setHover({ x: r.ratio * r.width, t: r.ratio * duration });
  };
  const endDrag = (e: { clientX: number; clientY: number }) => {
    if (dragging) flush();
    setDragging(false);
    // 在命中区外松开：气泡随之收起
    const rect = ref.current?.getBoundingClientRect();
    if (rect && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) {
      setHover(null);
    }
  };
  const schedule = () => {
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      seekFrom(lastXRef.current);
    }, 80);
  };
  const flush = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      seekFrom(lastXRef.current);
    }
  };

  return (
    <div
      ref={ref}
      className={`bp-progress${dragging ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        lastXRef.current = e.clientX;
        seekFrom(e.clientX);
        updateHover(e.clientX);
      }}
      onPointerMove={(e) => {
        if (disabled) return;
        updateHover(e.clientX);
        if (dragging) {
          lastXRef.current = e.clientX;
          schedule();
        }
      }}
      onPointerLeave={() => {
        if (!dragging) setHover(null);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => setDragging(false)}
    >
      <div className="bp-progress-track" ref={trackRef}>
        <div className="bp-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {hover && !disabled && (
        <div className="bp-seek-bubble" style={{ left: hover.x }}>
          {formatTime(hover.t)}
        </div>
      )}
    </div>
  );
});
