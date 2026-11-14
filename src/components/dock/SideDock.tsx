import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useOverlayScrollbar } from '../../lib/overlayScrollbar';
import { useGlass } from '../../lib/glass';
import './panel-kit.css';

/**
 * 两侧 Dock（NEBULA_UI_SYSTEM §9.2，样张 F，2026-11-12 定稿）：
 *   平时：两侧中段各一道极淡的提示光痕（鼠标靠近边缘 120px 内变亮）；
 *   浮出：鼠标到边缘，玻璃小球（G2）从边缘滑入；悬停只让图标自身提亮放大，旁边出名称提示；
 *   打开：点小球，同一侧滑出位置固定的侧面板（G3；液态主题下边缘折射，样张 G）；小球留在外侧当页签，当前那颗点亮；
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
  /** 浮在滚动区上面、不随内容滚动的一层（如歌单详情的紧凑栏）。 */
  overlay?: ReactNode;
  /** 追加到面板上的类名（内容方控制滚动区顶部淡出等）。 */
  panelClass?: string;
  children: ReactNode;
}

/** 点这些界面时侧面板保持打开（播放条、顶栏、另一侧 Dock、弹窗、弹层、提示）。 */
const KEEP_OPEN =
  '.side-dock, .player-surface, .topbar, .info-overlay, .ctx-menu, .ctx-backdrop, .now-playing-overlay, ' +
  '.wallpaper-overlay, .queue-pop, .vol-pop, .quality-pop, .tooltip-bubble, .center-btn, .lyric-probe, ' +
  // 首次启动空状态的三个按钮：面板开着时点它们不能被「点外面关面板」吞掉（第一下只关面板、第二下才生效）
  '.empty-nebula .en-acts';

/** 比侧面板更靠上的浮层：它们存在时 Esc 先归它们（评论 / 信息弹窗、右键菜单、二级播放页、队列 / 音质 / 音量弹层）。 */
const ABOVE_PANEL = '.info-overlay, .ctx-menu, .now-playing-overlay, .queue-pop, .quality-pop, .vol-pop';
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

function Orb({
  item,
  active,
  glass,
  tip,
  tipSide,
  onClick,
}: {
  item: SideDockItem;
  active: boolean;
  glass: boolean;
  tip: boolean;
  /** 名称提示往哪边出：往画面内侧（左侧小球 → right，右侧小球 → left）。 */
  tipSide: 'right' | 'left';
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
      data-tip-side={tipSide}
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
  overlay,
  panelClass,
  children,
}: SideDockProps) {
  const shown = visible || active !== null;
  const cls = side === 'left' ? 'sd-left' : 'sd-right';

  // 面板 = G3 大面：液态主题下边缘一圈折射（磨砂 / 降级时折射为 0，滤镜自动摘掉）。
  // 只在打开时注册；关闭后等收起动画（280ms）走完再注销，避免折射在淡出途中突然消失
  const panelRef = useRef<HTMLElement>(null);
  const [lensOn, setLensOn] = useState(false);
  useEffect(() => {
    if (active !== null) {
      setLensOn(true);
      return;
    }
    const t = window.setTimeout(() => setLensOn(false), 320);
    return () => window.clearTimeout(t);
  }, [active]);
  useGlass(panelRef, 'g3', lensOn);

  // 面板高度随内容（样张 H）：量内容的自然高度 + 滚动区上下内边距，写成 --sd-h；CSS 里再封顶
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!panel || !scroll || !content) return;
    const apply = () => {
      const cs = getComputedStyle(scroll);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      panel.style.setProperty('--sd-h', `${Math.ceil(content.offsetHeight + pad)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(content);
    return () => ro.disconnect();
  }, []);
  // 悬浮滚动条：原生滚动条不占宽度，切页时内容不再左右跳（用户反馈）
  useOverlayScrollbar(scrollRef);

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
    // Esc 只关最上面一层：页面上还有更高的浮层，或焦点在侧面板外的输入框里（如顶部搜索框，
    // 它自己用 Esc 收起）时，这一下不归侧面板。浮层的关闭和这里的监听都在 window 冒泡阶段、
    // 先后顺序不可靠，所以不看 defaultPrevented，而是看 DOM 此刻的状态。
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector(ABOVE_PANEL)) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(EDITABLE) && !t.closest('.sd-panel')) return;
      onActiveChange(null);
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
        // 键盘用户：Tab 聚焦到小球时让小球列浮出（否则焦点落在屏外不可见的小球上）；失焦后按原规则收回
        onFocus={(e) => {
          if ((e.target as HTMLElement).matches(':focus-visible')) onEnter();
        }}
        onBlur={(e) => {
          // 焦点在小球之间移动、或鼠标仍悬在小球上时不算离开
          if (e.currentTarget.contains(e.relatedTarget as Node | null) || e.currentTarget.matches(':hover')) return;
          onLeave();
        }}
      >
        {items.map((it) => (
          <Orb
            key={it.id}
            item={it}
            active={active === it.id}
            glass={shown}
            tip={active === null}
            tipSide={side === 'left' ? 'right' : 'left'}
            onClick={() => onActiveChange(active === it.id ? null : it.id)}
          />
        ))}
      </nav>
      <section
        ref={panelRef}
        className={`side-dock sd-panel ${cls} glass-g3${active ? ' is-open' : ''}${panelClass ? ` ${panelClass}` : ''}`}
        aria-hidden={!active}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      >
        <div className="sd-scroll" ref={scrollRef}>
          <div className="sd-content" ref={contentRef}>
            {children}
          </div>
        </div>
        {overlay}
      </section>
    </>
  );
}
