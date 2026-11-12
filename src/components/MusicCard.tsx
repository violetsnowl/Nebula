import { memo, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { CSSProperties } from 'react';
import { cardScreenPos } from '../lib/layout';
import type { CardSpec, LayoutMetrics } from '../lib/layout';
import { fisheyeFilter, fisheyeMetaAlpha, fisheyeScale, fisheyeZIndex } from '../lib/fisheye';
import { registerGlass } from '../lib/glass';

interface MusicCardProps {
  card: CardSpec;
  metrics: LayoutMetrics;
  buffer: number;
  pan: { x: number; y: number };
  zoom: number;
  hovered: boolean;
  isCurrent: boolean;
  isFailed: boolean;
  onPlay: (songId: number) => void;
  onContextMenu?: (e: MouseEvent, track: CardSpec['track']) => void;
  onHoverChange: (id: number, hovered: boolean) => void;
  registerEl: (id: number, el: HTMLElement | null) => void;
}

function MusicCardImpl({
  card,
  metrics,
  buffer,
  pan,
  zoom,
  hovered,
  isCurrent,
  isFailed,
  onPlay,
  onContextMenu,
  onHoverChange,
  registerEl,
}: MusicCardProps) {
  const [coverError, setCoverError] = useState(false);
  const chipRef = useRef<HTMLSpanElement>(null);
  // hover 播放球：G2 透镜玻璃（NEBULA_UI_SYSTEM §8.3），只在 hover 时注册折射滤镜，避免每张卡常驻一个滤镜
  useEffect(() => {
    if (!hovered || !chipRef.current) return;
    return registerGlass(chipRef.current, 'g2');
  }, [hovered]);
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const pos = cardScreenPos(card, pan, metrics.tileWidth, metrics.tileHeight, vw, vh, buffer, zoom);
  const maxDist = Math.hypot(vw, vh) / 2;

  const style = {
    '--x': `${pos?.x ?? 0}px`,
    '--y': `${pos?.y ?? 0}px`,
    '--rz': `${card.rotateZ}deg`,
    '--scale': pos ? Math.min(3.4, fisheyeScale(pos.dist, maxDist) * zoom) : 1,
    '--card-filter': pos ? fisheyeFilter(pos.dist, maxDist) : 'none',
    '--meta-a': pos ? fisheyeMetaAlpha(pos.dist, maxDist) : 1,
    zIndex: pos ? fisheyeZIndex(pos.dist, maxDist) : 1,
  } as CSSProperties;

  const { track } = card;

  return (
    <article
      ref={(el) => registerEl(card.id, el)}
      className={`music-card${hovered ? ' is-hovered' : ''}${isCurrent ? ' is-current' : ''}${
        isFailed ? ' is-failed' : ''
      }${pos ? '' : ' is-offscreen'}`}
      style={style}
      data-x={card.x}
      data-y={card.y}
      data-song-id={card.track.id}
      onClick={() => onPlay(card.track.id)}
      onPointerEnter={() => onHoverChange(card.id, true)}
      onPointerLeave={() => onHoverChange(card.id, false)}
      onContextMenu={(e) => onContextMenu?.(e, track)}
    >
      {/* 正在播放：封面自身的模糊提亮副本垫在下方，像封面把光投在空间里（NEBULA_UI_SYSTEM §8.4）；只给当前卡片渲染 */}
      {isCurrent && (
        <span
          className="cover-glow"
          aria-hidden="true"
          style={
            track.cover && !coverError
              ? { backgroundImage: `url("${track.cover}")` }
              : { background: `linear-gradient(135deg, hsl(${track.hue1} 70% 58%), hsl(${track.hue2} 72% 34%))` }
          }
        />
      )}
      <div
        className="cover"
        style={
          track.cover && !coverError
            ? undefined
            : { background: `linear-gradient(135deg, hsl(${track.hue1} 70% 58%), hsl(${track.hue2} 72% 34%))` }
        }
      >
        {track.cover && !coverError && (
          <img
            className="cover-img"
            src={track.cover}
            alt=""
            loading="lazy"
            onError={() => setCoverError(true)}
          />
        )}
        {(!track.cover || coverError) && (
          <>
            <span className="cover-sheen" />
            <span className="vinyl" style={{ '--vinyl-hue': track.hue2 } as CSSProperties} />
          </>
        )}
        <span ref={chipRef} className="play-chip glass-g2" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M8 5.3v13.4c0 .8.9 1.3 1.6.8l10-6.7a1 1 0 0 0 0-1.6l-10-6.7C8.9 4 8 4.5 8 5.3z" />
          </svg>
        </span>
      </div>
      <div className="meta">
        <div className="title">{track.title}</div>
        <div className="artist">{track.artist}</div>
      </div>
    </article>
  );
}

export const MusicCard = memo(MusicCardImpl);
