import { useEffect, useRef, useState } from 'react';

/**
 * 全局 Tooltip（NEBULA_UI_SYSTEM §9.6）。
 * 事件委托：任何带 `data-tip="文字"` 的元素（或其子元素）悬停 400ms 后显示气泡。
 * 全应用只渲染一次，不在元素上逐个接线。
 */

const SHOW_DELAY = 400;
const GAP = 8;
/** 横向出提示时与目标的距离（审查第 18 条）。 */
const SIDE_GAP = 10;
const EDGE = 8;

type Side = 'top' | 'right' | 'left';
type Pos = { left: number; top: number };

/** `data-tip-side`：top（默认，上方居中）/ right / left（垂直居中于目标，往侧面出）。 */
function tipSide(el: HTMLElement): Side {
  const v = el.getAttribute('data-tip-side');
  return v === 'right' || v === 'left' ? v : 'top';
}

function findTipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest<HTMLElement>('[data-tip]');
  if (!el) return null;
  return el.getAttribute('data-tip')?.trim() ? el : null;
}

export function TooltipLayer() {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [pos, setPos] = useState<Pos>({ left: 0, top: 0 });
  const [visible, setVisible] = useState(false);
  const [side, setSide] = useState<Side>('top');

  useEffect(() => {
    let target: HTMLElement | null = null;
    let timer = 0;
    let shown = false;
    let observer: MutationObserver | null = null;

    const hide = () => {
      window.clearTimeout(timer);
      observer?.disconnect();
      observer = null;
      target = null;
      if (shown) {
        shown = false;
        setVisible(false);
      }
    };

    const show = () => {
      const el = target;
      if (!el || !el.isConnected) {
        hide();
        return;
      }
      const tip = el.getAttribute('data-tip')?.trim();
      if (!tip) {
        hide();
        return;
      }
      setText(tip);
      setSide(tipSide(el));
      shown = true;
      setVisible(true);
      // 文字更新后在下一帧量尺寸再定位，避免首帧位置闪动
      requestAnimationFrame(() => {
        const bubble = bubbleRef.current;
        if (!bubble || !target || !target.isConnected) return;
        const rect = target.getBoundingClientRect();
        const bw = bubble.offsetWidth;
        const bh = bubble.offsetHeight;
        const s = tipSide(target);
        if (s !== 'top') {
          // 侧边小球：提示往画面内侧出，垂直居中于目标，相距 10px；上下夹在窗口内
          const left = s === 'right' ? rect.right + SIDE_GAP : rect.left - SIDE_GAP - bw;
          const top = rect.top + rect.height / 2 - bh / 2;
          setPos({
            left: Math.round(Math.max(EDGE, Math.min(left, window.innerWidth - bw - EDGE))),
            top: Math.round(Math.max(EDGE, Math.min(top, window.innerHeight - bh - EDGE))),
          });
          return;
        }
        let left = rect.left + rect.width / 2 - bw / 2;
        left = Math.max(EDGE, Math.min(left, window.innerWidth - bw - EDGE));
        const top = rect.top < bh + 16 ? rect.bottom + GAP : rect.top - bh - GAP;
        setPos({ left: Math.round(left), top: Math.round(top) });
      });
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = findTipTarget(e.target);
      if (el === target) return;
      if (!el) {
        if (target) hide();
        return;
      }
      // 已有气泡可见时，相邻切换不再等待延迟
      const instant = shown;
      window.clearTimeout(timer);
      observer?.disconnect();
      target = el;
      // 元素被移除时立即收起
      observer = new MutationObserver(() => {
        if (target && !target.isConnected) hide();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      if (instant) show();
      else timer = window.setTimeout(show, SHOW_DELAY);
    };

    const onOut = (e: PointerEvent) => {
      if (!target) return;
      const next = e.relatedTarget;
      if (next instanceof Node && target.contains(next)) return;
      hide();
    };

    const onHide = () => hide();

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', onHide, true);
    document.addEventListener('wheel', onHide, { capture: true, passive: true });
    document.addEventListener('keydown', onHide, true);
    window.addEventListener('blur', onHide);
    return () => {
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointerdown', onHide, true);
      document.removeEventListener('wheel', onHide, true);
      document.removeEventListener('keydown', onHide, true);
      window.removeEventListener('blur', onHide);
      hide();
    };
  }, []);

  return (
    <div
      ref={bubbleRef}
      className={`tooltip-bubble${visible ? ' is-visible' : ''}`}
      data-side={side === 'top' ? undefined : side}
      role="tooltip"
      aria-hidden="true"
      style={{ left: pos.left, top: pos.top }}
    >
      {text}
    </div>
  );
}
