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
    // 按轨道本身换算（轨道右边留给了时间文字，比整个热区短）
    const track = el.querySelector<HTMLElement>('.bp-progress-track') ?? el;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audioPlayer.seek(ratio * duration);
  };
  const endDrag = () => {
    if (dragging) flush();
    setDragging(false);
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
      }}
      onPointerMove={(e) => {
        if (dragging) {
          lastXRef.current = e.clientX;
          schedule();
        }
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => setDragging(false)}
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
