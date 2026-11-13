import { useEffect, useRef, type ReactNode } from 'react';
import { useGlass } from '../../lib/glass';
import './panel-kit.css';

/**
 * 两侧 Dock（NEBULA_UI_SYSTEM §9.2，样张 F，2026-11-12 定稿）：
 *   平时：两侧中段各一道极淡的提示光痕（鼠标靠近边缘 120px 内变亮）；
 *   浮出：鼠标到边缘，玻璃小球（G2）从边缘滑入；悬停只让图标自身提亮放大，旁边出名称提示；
 *   打开：点小球，同一侧滑出位置固定的侧面板（G3）；小球留在外侧当页签，当前那颗点亮；
 *   切换：点同侧另一颗小球只换内容，面板不动；
 *   关闭：点面板外面（落在星云 / 背景上时这一下只用来关闭，不穿透）、按 Esc、或再点当前小球。鼠标移开不关闭。
 * 只负责机制和外壳；面板里的内容由 PlaylistDock / AccountDock 提供。
 */

export interface SideDockItem {
  id: string;
  label: string;
  icon: ReactNode;
}

interface SideDockProps {
  side: 'left' | 'right';
  /** 边缘感应：小球列是否浮出（面板打开时始终浮出）。 */
  visible: boolean;
  /** 鼠标靠近这一侧边缘（提示光痕变亮）。 */
  near: boolean;
  items: SideDockItem[];
  /** 当前打开的面板（null = 关闭）。 */
  active: string | null;
  onActiveChange: (id: string | null) => void;
  /** 面板开 / 关：通知边缘感应钉住或解除（打开时不随鼠标离开收起）。 */
  onPinChange: (open: boolean) => void;
  onEnter: () => void;
  onLeave: () => void;
  children: ReactNode;
}

/** 点这些界面时侧面板保持打开（播放条、顶栏、另一侧 Dock、弹窗、弹层、提示）。 */
const KEEP_OPEN =
  '.side-dock, .player-surface, .topbar, .info-overlay, .ctx-menu, .ctx-backdrop, .now-playing-overlay, ' +
  '.wallpaper-overlay, .queue-pop, .vol-pop, .quality-pop, .tooltip-bubble, .center-btn, .lyric-probe';

function Orb({
  item,
  active,
  glass,
  tip,
  onClick,
}: {
  item: SideDockItem;
  active: boolean;
  glass: boolean;
  tip: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // G2 透镜：只在小球浮出时注册折射滤镜
  useGlass(ref, 'g2', glass);
  return (
    <button
      ref={ref}
      type="button"
      className={`sd-orb glass-g2${active ? ' is-active' : ''}`}
      aria-label={item.label}
      aria-pressed={active}
      data-tip={tip ? item.label : undefined}
      onClick={onClick}
    >
      <span className="sd-orb-icon">{item.icon}</span>
    </button>
  );
}

export function SideDock({
  side,
  visible,
  near,
  items,
  active,
  onActiveChange,
  onPinChange,
  onEnter,
  onLeave,
  children,
}: SideDockProps) {
  const shown = visible || active !== null;
  const cls = side === 'left' ? 'sd-left' : 'sd-right';

  useEffect(() => {
    onPinChange(active !== null);
  }, [active, onPinChange]);

  // 点外面关闭 / Esc 关闭
  useEffect(() => {
    if (!active) return;
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.closest?.(KEEP_OPEN)) return;
      onActiveChange(null);
      // 落在星云 / 背景上：这一下只用来关闭，不开始拖拽、不播放卡片
      e.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 500);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onActiveChange(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [active, onActiveChange]);

  return (
    <>
      <span className={`sd-seam ${cls}${near ? ' is-near' : ''}${shown ? ' is-hidden' : ''}`} aria-hidden="true" />
      <nav
        className={`side-dock sd-rail ${cls}${shown ? ' is-shown' : ''}`}
        aria-label={side === 'left' ? '左侧工具' : '右侧工具'}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      >
        {items.map((it) => (
          <Orb
            key={it.id}
            item={it}
            active={active === it.id}
            glass={shown}
            tip={active === null}
            onClick={() => onActiveChange(active === it.id ? null : it.id)}
          />
        ))}
      </nav>
      <section
        className={`side-dock sd-panel ${cls} glass-g3${active ? ' is-open' : ''}`}
        aria-hidden={!active}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      >
        <div className="sd-scroll">{children}</div>
      </section>
    </>
  );
}
