import { memo } from 'react';
import { audioPlayer, formatTime, type PlayMode } from '../../lib/audio/AudioPlayer';
import { useAudioPlayer } from '../../lib/audio/useAudioPlayer';
import { ProgressLine } from './ProgressLine';
import { VolumeControl } from './VolumeControl';
import { QueueControl } from './QueueControl';
import { QualityControl } from './QualityControl';
import type { DesktopPlaybackSourceOption } from '../../lib/playlist/ipcClient';
import type { PlaybackSourceSwitchResult, QualitySwitchResult } from '../../lib/audio/desktopPlayback';
import { platformName } from '../../lib/quality';
import { placeholderBg } from '../../lib/coverPlaceholder';
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
  onSelectQuality: (level: string) => Promise<QualitySwitchResult> | void;
  onLoadSources?: () => Promise<DesktopPlaybackSourceOption[]>;
  onSelectSource?: (platform: string) => Promise<PlaybackSourceSwitchResult> | void;
  onOpenNowPlaying: () => void;
  onOpenComments: () => void;
  onOpenSongDetail: () => void;
  onOpenArtist: (artistName: string) => void;
  /** 提示「登录已过期」时点它去重新登录（#157） */
  onRelogin: (platform: string) => void;
}

/** 播放失败是因为登录过期：返回要重新登录的平台（后端只对 QQ 报这个错，文案里带「QQ」）。 */
export function lapsedPlatformOf(error: string | null | undefined, source: string | undefined): string | null {
  if (!error || !/登录已过期/.test(error)) return null;
  return /QQ/.test(error) ? 'qq' : source || null;
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
  onLoadSources,
  onSelectSource,
  onOpenNowPlaying,
  onOpenComments,
  onOpenSongDetail,
  onOpenArtist,
  onRelogin,
}: BottomPlayerProps) {
  const state = useAudioPlayer();
  const hasSong = !!state.song;
  const coverStyle = state.song?.cover
    ? { backgroundImage: `url(${state.song.cover})`, backgroundSize: 'cover' as const, backgroundPosition: 'center' as const }
    : { background: placeholderBg(state.song?.hue1, state.song?.hue2) };
  const timeText = `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;
  return (
    <div className={`bp-shell${state.loading ? ' is-loading' : ''}`}>
      <ProgressLine current={state.currentTime} duration={state.duration} disabled={!hasSong} playing={state.playing} />
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
            {state.error && lapsedPlatformOf(state.error, state.song?.source) ? (
              // 登录过期（#157）：警告色，整句可点，直接打开该平台的登录
              <button
                type="button"
                className="bp-status is-warn is-action"
                role="status"
                data-tip="重新登录"
                onClick={() => onRelogin(lapsedPlatformOf(state.error, state.song?.source)!)}
              >
                {state.error}
              </button>
            ) : state.error ? (
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
            aria-label={state.playIntent ? '暂停' : '播放'}
            disabled={!hasSong}
            onClick={() => audioPlayer.toggle()}
          >
            {state.playIntent ? <IconPause /> : <IconPlay />}
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
            songKey={state.song ? `${state.song.source}:${state.song.sourceId || state.song.id}` : ''}
            source={state.song?.via ? platformName(state.song.via.platform) : undefined}
            activePlatform={state.song?.via?.platform ?? state.song?.source}
            onSelectQuality={onSelectQuality}
            onLoadSources={onLoadSources}
            onSelectSource={onSelectSource}
          />
          <button className="bp-ctrl" aria-label="评论" data-tip="查看评论" disabled={!hasSong} onClick={onOpenComments}>
            <IconComments />
          </button>
        </div>
      </div>
    </div>
  );
});
