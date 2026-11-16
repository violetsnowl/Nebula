import { memo } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { MusicCard } from './MusicCard';
import { CULL_BUFFER } from '../lib/stage';
import type { CardSpec, LayoutMetrics } from '../lib/layout';
import type { Track } from '../lib/catalog';

interface StageCanvasProps {
  stageRef: RefObject<HTMLDivElement>;
  /** 有边界星云（#133 方向原型）：星层画布、环境色层、整片倾斜的平面 */
  bounded: boolean;
  starCanvasRef: RefObject<HTMLCanvasElement>;
  tintRef: RefObject<HTMLDivElement>;
  tilt: number;
  /** 搜索命中（有边界星云里命中的亮、其余变暗；现有模式为 null） */
  matchSet: ReadonlySet<number> | null;
  importing: boolean;
  uiHideCards: boolean;
  visibleIds: number[];
  effectiveCards: CardSpec[];
  metrics: LayoutMetrics;
  pan: { x: number; y: number };
  zoom: number;
  hoveredId: number | null;
  currentSongId: number | null;
  failedIds: ReadonlySet<number>;
  onPlay: (songId: number) => void;
  onContextMenu: (e: ReactMouseEvent, track: Track) => void;
  onHoverChange: (id: number, hovered: boolean) => void;
  registerEl: (id: number, el: HTMLElement | null) => void;
}

/**
 * Z2 星云舞台区块（docs/project/ARCHITECTURE.md §5）：stage-3d + 卡片虚拟化渲染。
 * 收 useStage 数据（纯 props，memo 化）；同层区块互不依赖，组合由 App 完成。
 */
export const StageCanvas = memo(function StageCanvas({
  stageRef,
  bounded,
  starCanvasRef,
  tintRef,
  tilt,
  matchSet,
  importing,
  uiHideCards,
  visibleIds,
  effectiveCards,
  metrics,
  pan,
  zoom,
  hoveredId,
  currentSongId,
  failedIds,
  onPlay,
  onContextMenu,
  onHoverChange,
  registerEl,
}: StageCanvasProps) {
  const cardNodes = visibleIds.map((id) => {
    const card = effectiveCards[id]!;
    if (!card) return null;
    return (
      <MusicCard
        key={card.id}
        card={card}
        metrics={metrics}
        buffer={CULL_BUFFER}
        pan={pan}
        zoom={zoom}
        hovered={card.id === hoveredId}
        isCurrent={card.track.id === currentSongId}
        isFailed={failedIds.has(card.track.id)}
        matched={matchSet ? matchSet.has(card.id) : false}
        onPlay={onPlay}
        onContextMenu={onContextMenu}
        onHoverChange={onHoverChange}
        registerEl={registerEl}
      />
    );
  });
  return (
    <div
      ref={stageRef}
      className={`stage-3d${importing ? ' is-importing' : ''}${uiHideCards ? ' is-cards-hidden' : ''}${
        bounded ? ' is-bounded' : ''
      }${bounded && matchSet ? ' has-query' : ''}`}
    >
      {bounded ? (
        <>
          <div ref={tintRef} className="space-tint" aria-hidden="true" />
          <div className="space-plane" style={{ '--tilt': tilt } as CSSProperties}>
            <canvas ref={starCanvasRef} className="space-stars" aria-hidden="true" />
            {cardNodes}
          </div>
        </>
      ) : (
        cardNodes
      )}
    </div>
  );
});
