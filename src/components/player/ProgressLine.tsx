import { memo, useRef, useState } from 'react';
import { audioPlayer, formatTime } from '../../lib/audio/AudioPlayer';

interface ProgressLineProps {
  current: number;
  duration: number;
  disabled: boolean;
}

/**
 * 底部播放器进度线：默认极细、无时间标签；hover 时显示时间并强化交互态。
 * 规范：进度常显但不抢眼；点击/拖动 seek。
 */
export const ProgressLine = memo(function ProgressLine({ current, duration, disabled }: ProgressLineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const lastXRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  const seekFrom = (clientX: number) => {
    const el = ref.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    audioPlayer.seek(((clientX - rect.left) / rect.width) * duration);
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
      className={`bp-progress${dragging ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        lastXRef.current = e.clientX;
        seekFrom(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging) {
          lastXRef.current = e.clientX;
          schedule();
        }
      }}
      onPointerUp={flush}
      onPointerCancel={flush}
    >
      <div className="bp-progress-track">
        <div className="bp-progress-fill" style={{ width: `${pct}%` }} />
        <div className="bp-progress-thumb" style={{ left: `${pct}%` }} />
      </div>
      <div className="bp-progress-time">
        {formatTime(current)} / {formatTime(duration)}
      </div>
    </div>
  );
});
