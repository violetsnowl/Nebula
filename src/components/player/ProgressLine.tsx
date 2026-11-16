import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audioPlayer, formatTime } from '../../lib/audio/AudioPlayer';

interface ProgressLineProps {
  current: number;
  duration: number;
  disabled: boolean;
  playing: boolean;
}

/**
 * 底部播放器进度线（NEBULA_UI_SYSTEM §9.1）：顶边 2px 细线、左右内缩 22px；平时不显示时间。
 * 悬停播放条时细线变 3px（样式在 styles.css）；指针在 16px 高命中区上时跟一个时间点气泡，点击 / 拖动跳转。
 * 「当前 / 总长」不在这里画，由 BottomPlayer 的 .bp-time 负责（悬停播放条时显示）。
 *
 * 填充逐帧走（2026-11-16，用户要「丝滑的亚像素连贯移动」）：以前按 timeupdate（约 4Hz）改 width，
 * 宽度被取整到像素、一格一格地跳。现在播放时每帧读音频位置，读数没更新的帧按时间外推（同歌词阅读栏的时钟），
 * 写到合成层的 translate3d 上（亚像素、不触发布局）；填充本身是满宽、右端圆角，平移后被轨道裁掉左侧。
 */
export const ProgressLine = memo(function ProgressLine({ current, duration, disabled, playing }: ProgressLineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // 指针所在位置：x 为相对轨道左端的像素，t 为该位置对应的时间（秒）
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const lastXRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const fillAt = (p: number) => `translate3d(${(p - 100).toFixed(4)}%, 0, 0)`;

  // 填充的 transform 全部命令式写，不交给 React 的 style（否则 4Hz 的渲染会把逐帧值拉回去、切换时还会空一帧）。
  // 暂停 / 停止：按 current 定位
  useLayoutEffect(() => {
    if (playing && duration > 0) return;
    const el = fillRef.current;
    if (el) el.style.transform = fillAt(pct);
  }, [playing, duration, pct]);

  // 播放中：逐帧推进
  useEffect(() => {
    if (!playing || !(duration > 0)) return;
    let raf = 0;
    let prev = performance.now();
    let lastPos = -1;
    let extrap = 0;
    let smooth = 0;
    const el0 = fillRef.current;
    if (el0) el0.style.transform = fillAt(Math.min(100, (audioPlayer.position() / duration) * 100));
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      const pos = audioPlayer.position();
      if (pos === lastPos) extrap = Math.min(0.25, extrap + dt);
      else extrap = 0;
      lastPos = pos;
      let t = pos + extrap;
      // 读数刚更新时可能比外推值略小：保持单调，别往回抖；跳转（差得多）直接跟上
      if (t < smooth && smooth - t < 0.15) t = smooth;
      smooth = t;
      const el = fillRef.current;
      if (el) el.style.transform = fillAt(Math.min(100, (t / duration) * 100));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

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
        <div className="bp-progress-fill" ref={fillRef} />
      </div>
      {hover && !disabled && (
        <div className="bp-seek-bubble" style={{ left: hover.x }}>
          {formatTime(hover.t)}
        </div>
      )}
    </div>
  );
});
