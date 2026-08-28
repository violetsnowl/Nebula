import { memo, type WheelEvent } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import type { AudioPlayerState } from '../../lib/audio/AudioPlayer';
import { IconVolume } from './icons';

/**
 * 音量：图标常显；hover 时在图标**上方**展开细滑杆（永不下方/侧向展开）。
 * 支持点击滑块与滚轮微调。
 */
export const VolumeControl = memo(function VolumeControl({ state }: { state: AudioPlayerState }) {
  const volume = state.muted ? 0 : state.volume;
  const onWheel = (e: WheelEvent<HTMLElement>) => {
    const delta = e.deltaY > 0 ? -0.06 : 0.06;
    const next = Math.min(1, Math.max(0, (state.muted ? 0 : state.volume) + delta));
    audioPlayer.setVolume(next);
    if (next > 0 && state.muted) audioPlayer.toggleMute();
  };

  return (
    <div className="vol-ctl" onWheel={onWheel}>
      <button
        className="bp-ctrl"
        aria-label={state.muted ? '取消静音' : '静音'}
        title="音量（滚轮调节）"
        onClick={() => audioPlayer.toggleMute()}
      >
        <IconVolume muted={state.muted} />
      </button>
      <div className="vol-pop">
        <input
          className="vol-slider"
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={volume}
          onChange={(e) => {
            const v = Number(e.target.value);
            audioPlayer.setVolume(v);
            if (v > 0 && state.muted) audioPlayer.toggleMute();
          }}
        />
      </div>
    </div>
  );
});
