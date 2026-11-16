import { memo } from 'react';
import { audioPlayer, formatTime, type PlayMode } from '../../lib/audio/AudioPlayer';
import { useAudioPlayer } from '../../lib/audio/useAudioPlayer';
import { ProgressLine } from './ProgressLine';
import { VolumeControl } from './VolumeControl';
import { QueueControl } from './QueueControl';
import { QualityControl } from './QualityControl';
import { platformName } from '../../lib/quality';
import {
  IconPrev,
  IconNext,
  IconPlay,
  IconPause,
  IconModeSequential,
  IconModeShuffle,
  IconModeRepeatOne,
  IconComments,
} from './icons';

interface BottomPlayerProps {
  mode: PlayMode;
  qualities: { level: string; label: string; needsVip?: boolean; needsSvip?: boolean }[];
  quality: string;
  onCycleMode: () => void;
  onSelectQuality: (level: string) => void;
  onOpenNowPlaying: () => void;
  onOpenComments: () => void;
  onOpenSongDetail: () => void;
  onOpenArtist: (artistName: string) => void;
}

const MODE_ICON = {
  sequential: <IconModeSequential />,
  random: <IconModeShuffle />,
  'repeat-one': <IconModeRepeatOne />,
};

/**
 * 底部播放器（PlayerSurface compact 态内容，NEBULA_UI_SYSTEM §9.1）：
 * 左 Now Playing Object / 中 Playback Core / 右 Utility Cluster，按视觉权重而非等宽排列。
 * 听音空间打开时（.app[data-ls]）播放条缩成胶囊：左侧封面与歌名淡出，改显示 .bp-left-time。
 */
export const BottomPlayer = memo(function BottomPlayer({
  mode,
  qualities,
  quality,
  onCycleMode,
  onSelectQuality,
  onOpenNowPlaying,
  onOpenComments,
  onOpenSongDetail,
  onOpenArtist,
}: BottomPlayerProps) {
  const state = useAudioPlayer();
  const hasSong = !!state.song;
  const coverStyle = state.song?.cover
    ? { backgroundImage: `url(${state.song.cover})`, backgroundSize: 'cover' as const, backgroundPosition: 'center' as const }
    : {
        background: `linear-gradient(135deg, hsl(${state.song?.hue1 ?? 220} 70% 58%), hsl(${state.song?.hue2 ?? 280} 72% 34%))`,
      };
  const timeText = `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;
  return (
    <div className={`bp-shell${state.loading ? ' is-loading' : ''}`}>
      <ProgressLine current={state.currentTime} duration={state.duration} disabled={!hasSong} />
      {/* 悬停播放条时显示在进度线右端下方；听音空间里由左侧的 .bp-left-time 代替 */}
      <span className="bp-time" aria-hidden="true">
        {timeText}
      </span>
      <span className="bp-left-time" aria-hidden="true">
        {timeText}
      </span>
      <div className="bp-row">
        {/* 左：Now Playing Object */}
        <div className="bp-now">
          <button
            className="bp-cover"
            data-np-cover
            style={coverStyle}
            aria-label="进入听音空间"
            data-tip="进入听音空间"
            disabled={!hasSong}
            onClick={onOpenNowPlaying}
          />
          <div className="bp-meta">
            <button className="bp-title" disabled={!hasSong} onClick={onOpenSongDetail} data-tip="查看歌曲详情">
              {state.song?.title ?? '未在播放'}
            </button>
            {state.error ? (
              // 状态提示临时占用歌手这一行，不新增一行、不把播放条顶高（#106）；
              // 进行中的提示用中性灰，只有真的失败才用警示色（审查第 15 条）
              <span
                className={`bp-status${/失败|不可用/.test(state.error) && !/正在/.test(state.error) ? ' is-danger' : ''}`}
                role="status"
              >
                {state.error}
              </span>
            ) : (
            <button
              className="bp-artist"
              disabled={!hasSong || !state.song?.artist}
              onClick={() => state.song && onOpenArtist(state.song.artist)}
              data-tip="查看歌手"
            >
              {state.song ? state.song.artist : '点击星云卡片开始播放'}
            </button>
            )}
          </div>
        </div>

        {/* 中：Playback Core（播放 / 暂停无底，只有图形略大） */}
        <div className="bp-core">
          <button className="bp-ctrl" aria-label="上一首" disabled={!hasSong} onClick={() => audioPlayer.prev()}>
            <IconPrev />
          </button>
          <button
            className="bp-play"
            aria-label={state.playing ? '暂停' : '播放'}
            disabled={!hasSong}
            onClick={() => audioPlayer.toggle()}
          >
            {state.playing ? <IconPause /> : <IconPlay />}
          </button>
          <button className="bp-ctrl" aria-label="下一首" disabled={!hasSong} onClick={() => audioPlayer.next()}>
            <IconNext />
          </button>
        </div>

        {/* 右：Utility Cluster（按权重，非等宽按钮游行） */}
        <div className="bp-tools">
          <button
            className={`bp-ctrl${mode !== 'sequential' ? ' is-active' : ''}`}
            aria-label="播放模式"
            data-tip="切换播放模式"
            disabled={!hasSong}
            onClick={onCycleMode}
          >
            {MODE_ICON[mode]}
          </button>
          <VolumeControl state={state} />
          <QueueControl />
          <QualityControl
            qualities={qualities}
            quality={quality}
            source={state.song?.via ? platformName(state.song.via.platform) : undefined}
            onSelectQuality={onSelectQuality}
          />
          <button className="bp-ctrl" aria-label="评论" data-tip="查看评论" disabled={!hasSong} onClick={onOpenComments}>
            <IconComments />
          </button>
        </div>
      </div>
    </div>
  );
});
