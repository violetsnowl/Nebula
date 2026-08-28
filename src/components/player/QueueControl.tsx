import { memo, useEffect, useRef, useState } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import { useAudioPlayer } from '../../lib/audio/useAudioPlayer';
import { useVisualAtmosphere } from '../../hooks/background/VisualAtmosphereContext';
import { IconQueue } from './icons';

/**
 * 播放队列：底部播放器常显入口；点击展开面板（当前项 + 即将播放）。
 * 仅「即将播放」可移除；点击行跳播；FIFO「下一首」段自然展示在队列中。
 */
export const QueueControl = memo(function QueueControl() {
  // 订阅播放器状态变化（队列增删/切歌都会 emit），快照在每次渲染时取最新
  useAudioPlayer();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { palette } = useVisualAtmosphere();
  const snap = audioPlayer.getQueueSnapshot();
  const accent = palette?.primary;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="queue-ctl" ref={rootRef}>
      <button
        className={`bp-ctrl${open ? ' is-active' : ''}`}
        aria-label="播放队列"
        title="播放队列"
        onClick={() => setOpen((o) => !o)}
      >
        <IconQueue />
      </button>
      {open && (
        <div className="queue-pop" onMouseEnter={() => setOpen(true)}>
          <div className="queue-pop-title">播放队列</div>
          {snap.current && (
            <button
              className="queue-row is-current"
              style={accent ? { color: accent } : undefined}
              onClick={() => audioPlayer.playQueueItem(snap.current!.id)}
            >
              <span className="queue-row-idx">▶</span>
              <span className="queue-row-name">{snap.current.title}</span>
              <span className="queue-row-artist">{snap.current.artist}</span>
            </button>
          )}
          <div className="queue-pop-sub">即将播放（{snap.upcoming.length}）</div>
          {snap.upcoming.length === 0 && <div className="queue-empty">队列已空</div>}
          {snap.upcoming.map((t, i) => (
            <div className="queue-row-wrap" key={t.id}>
              <button className="queue-row" onClick={() => audioPlayer.playQueueItem(t.id)}>
                <span className="queue-row-idx">{i + 1}</span>
                <span className="queue-row-name">{t.title}</span>
                <span className="queue-row-artist">{t.artist}</span>
              </button>
              <button
                className="queue-remove"
                aria-label={`移除《${t.title}》`}
                title="从队列移除"
                onClick={() => audioPlayer.removeUpcoming(t.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
