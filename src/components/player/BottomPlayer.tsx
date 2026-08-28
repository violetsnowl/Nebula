import { memo } from 'react';
import { audioPlayer, type PlayMode } from '../../lib/audio/AudioPlayer';
import { useAudioPlayer } from '../../lib/audio/useAudioPlayer';
import { ProgressLine } from './ProgressLine';
import { VolumeControl } from './VolumeControl';
import { QueueControl } from './QueueControl';
import {
  IconPrev,
  IconNext,
  IconPlay,
  IconPause,
  IconModeSequential,
  IconModeShuffle,
  IconModeRepeat,
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

const SOURCE_LABEL: Record<string, string> = {
  qq: 'QQ 音乐',
  netease: '网易云音乐',
  kugou: '酷狗音乐',
  qishui: '汽水音乐',
  spotify: 'Spotify',
  demo: '演示歌单',
};

const MODE_ICON = {
  sequential: <IconModeSequential />,
  random: <IconModeShuffle />,
  'repeat-one': <IconModeRepeat />,
};

/**
 * 底部播放器（PlayerSurface compact 态内容）：
 * 左 Now Playing Object / 中 Playback Core / 右 Utility Cluster，按视觉权重而非等宽排列。
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
  const qualityLabel = qualities.find((o) => o.level === quality)?.label ?? (quality ? quality : '音质');

  return (
    <div className={`bp-shell${state.loading ? ' is-loading' : ''}`}>
      <ProgressLine current={state.currentTime} duration={state.duration} disabled={!hasSong} />
      {state.error && <div className="bp-error">⚠ {state.error}</div>}
      <div className="bp-row">
        {/* 左：Now Playing Object */}
        <div className="bp-now">
          <button
            className="bp-cover"
            style={coverStyle}
            aria-label="进入听音空间"
            title="进入听音空间"
            disabled={!hasSong}
            onClick={onOpenNowPlaying}
          />
          <div className="bp-meta">
            <button className="bp-title" disabled={!hasSong} onClick={onOpenSongDetail} title="查看歌曲详情">
              {state.song?.title ?? '未在播放'}
            </button>
            <button
              className="bp-artist"
              disabled={!hasSong || !state.song?.artist}
              onClick={() => state.song && onOpenArtist(state.song.artist)}
              title="查看歌手"
            >
              {state.song ? (
                <>
                  <span className="bp-artist-name">{state.song.artist}</span>
                  <span className="bp-artist-src">{SOURCE_LABEL[state.song.source] ?? state.song.source}</span>
                </>
              ) : (
                '点击星云卡片开始播放'
              )}
            </button>
          </div>
        </div>

        {/* 中：Playback Core（视觉中心，Play/Pause 略大） */}
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
            title="切换播放模式"
            disabled={!hasSong}
            onClick={onCycleMode}
          >
            {MODE_ICON[mode]}
          </button>
          <VolumeControl state={state} />
          <QueueControl />
          <div className="up-panel">
            <button className="bp-ctrl bp-quality" title="音质" disabled={!hasSong}>
              <span className="quality-badge">{qualityLabel.length > 5 ? qualityLabel.slice(0, 5) + '…' : qualityLabel}</span>
            </button>
            <div className="up-pop">
              <div className="up-pop-title">音质</div>
              {qualities.map((o) => (
                <button
                  key={o.level}
                  className={`quality-item${o.level === quality ? ' is-current' : ''}`}
                  onClick={() => onSelectQuality(o.level)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <button className="bp-ctrl bp-ctrl--ghost" aria-label="评论" title="查看评论" disabled={!hasSong} onClick={onOpenComments}>
            <IconComments />
          </button>
        </div>
      </div>
    </div>
  );
});
