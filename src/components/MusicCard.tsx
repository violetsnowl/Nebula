import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import type { CSSProperties } from 'react';
import type { CardSpec } from '../lib/layout';
import { registerGlass } from '../lib/glass';
import { placeholderBg } from '../lib/coverPlaceholder';
import { boundedCardStyle, isCoverLoaded, markCoverLoaded, scheduleCardCoverRefresh } from '../lib/space/active';

interface MusicCardProps {
  card: CardSpec;
  pan: { x: number; y: number };
  zoom: number;
  hovered: boolean;
  isCurrent: boolean;
  isFailed: boolean;
  /** 搜索命中 */
  matched?: boolean;
  onPlay: (songId: number) => void;
  onContextMenu?: (e: MouseEvent, track: CardSpec['track']) => void;
  onHoverChange: (id: number, hovered: boolean) => void;
  registerEl: (id: number, el: HTMLElement | null) => void;
}

function MusicCardImpl({
  card,
  pan,
  zoom,
  hovered,
  isCurrent,
  isFailed,
  matched = false,
  onPlay,
  onContextMenu,
  onHoverChange,
  registerEl,
}: MusicCardProps) {
  const [coverError, setCoverError] = useState(false);
  const articleRef = useRef<HTMLElement | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const setArticleRef = useCallback(
    (el: HTMLElement | null) => {
      articleRef.current = el;
      if (el && el.dataset.mountedOnce !== '1') {
        el.dataset.mountedOnce = '1';
        el.dataset.pending = '';
        if (!card.track.cover || coverError || isCoverLoaded(card.track.cover)) {
          el.dataset.imgReady = '1';
        }
      }
      registerEl(card.id, el);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card.id, registerEl],
  );
  // hover 播放球：G2 透镜玻璃（NEBULA_UI_SYSTEM §8.3），只在 hover 时注册折射滤镜，避免每张卡常驻一个滤镜
  useEffect(() => {
    if (!hovered || !chipRef.current) return;
    return registerGlass(chipRef.current, 'g2');
  }, [hovered]);
  // 初始位置按透镜投影算，和舞台帧循环一致（之后位置全由帧循环写入）
  const style = boundedCardStyle(card, pan, zoom);

  const { track } = card;
  const markDomReady = () => {
    const el = articleRef.current;
    if (!el || el.dataset.pending === undefined || el.dataset.imgReady === '1') return;
    el.dataset.imgReady = '1';
    scheduleCardCoverRefresh();
  };

  useLayoutEffect(() => {
    const el = articleRef.current;
    if (!el || el.dataset.pending === undefined || el.dataset.imgReady === '1') return;
    if (!track.cover || coverError || isCoverLoaded(track.cover)) {
      markDomReady();
      return;
    }
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      markCoverLoaded(track.cover);
      markDomReady();
    }
  });

  return (
    <article
      ref={setArticleRef}
      className={`music-card${hovered ? ' is-hovered' : ''}${isCurrent ? ' is-current' : ''}${
        isFailed ? ' is-failed' : ''
      }${matched ? ' is-match' : ''}`}
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
              : { background: placeholderBg(track.hue1, track.hue2) }
          }
        />
      )}
      <div
        className="cover"
        style={
          track.cover && !coverError
            ? undefined
            : { background: placeholderBg(track.hue1, track.hue2) }
        }
      >
        {track.cover && !coverError && (
          <img
            ref={imgRef}
            className="cover-img"
            src={track.cover}
            alt=""
            onLoad={() => {
              markCoverLoaded(track.cover);
              markDomReady();
            }}
            onError={() => {
              setCoverError(true);
              markDomReady();
            }}
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

/**
 * 卡片位置全由舞台帧循环写入，平移 / 缩放不需要重渲染卡片：
 * 只因 pan / zoom 变了就跳过（一屏几百张时，每次可见集合变化都整批重渲染会让拖动掉帧）。
 */
function sameCard(prev: MusicCardProps, next: MusicCardProps): boolean {
  for (const k of Object.keys(next) as (keyof MusicCardProps)[]) {
    if (prev[k] === next[k]) continue;
    if (k === 'pan' || k === 'zoom') continue;
    return false;
  }
  return true;
}

export const MusicCard = memo(MusicCardImpl, sameCard);
