import { useEffect, type RefObject } from 'react';

/**
 * 悬浮滚动条（2026-11-14，用户反馈）：系统滚动条太抢眼、和玻璃界面割裂；而且它占宽度，
 * 面板在「有滚动条的页」和「没有滚动条的页」之间切换时，内容会左右跳一下。
 *
 * 做法：隐藏原生滚动条（不再占宽度），在滚动容器的父元素里叠一根细圆条——
 *   - 只在滚动时、鼠标在滚动区里时淡入，停下 900ms 后淡出；内容放得下时完全不出现；
 *   - 4px 宽，鼠标移到圆条上时变 6px，可以拖动；
 *   - 圆条挂在父元素上而不是滚动容器里：放在滚动内容里时，合成线程会先把它跟着内容滚走、
 *     主线程再把它拉回，快速滚动时会抖。
 * 圆条挂在滚动容器的定位祖先（offsetParent）上，不改动任何元素的定位方式。
 */

const HIDE_DELAY = 900;
/** 圆条上下与滚动区边缘的最小留白。 */
const MIN_PAD = 6;
const MIN_THUMB = 28;
/** 圆条元素的宽度 = 可点区域；真正画出来的细条在它右侧 3px 处（见 styles.css .ovs-thumb）。 */
const HIT_W = 12;
/** 细条外沿离右边的距离（styles.css .ovs-thumb::after right: 3px）。 */
const BAR_INSET = 3;

/**
 * 圆角容器里，细条两端要躲开圆角：圆角半径 r 处，离右边 3px 的竖线要往里退多少才不被圆角切掉。
 * 圆角曲线在 y 处向里缩 r - √(r² - (r - y)²)，令它 ≤ 3px 解出 y，再多留 2px。
 */
function padFor(radius: number): number {
  if (!(radius > BAR_INSET)) return MIN_PAD;
  const y = radius - Math.sqrt(2 * radius * BAR_INSET - BAR_INSET * BAR_INSET);
  return Math.max(MIN_PAD, Math.ceil(y) + 2);
}

export function attachOverlayScrollbar(el: HTMLElement): () => void {
  // 挂在定位祖先上：offset 坐标天然以它为基准；固定定位的元素没有 offsetParent，退回父元素 + 量矩形
  const parent = (el.offsetParent as HTMLElement | null) ?? el.parentElement;
  if (!parent) return () => {};
  el.classList.add('ovs');
  const elStyle = getComputedStyle(el);
  // 滚动区自己有位移（例如播放队列弹层 translateX(-50%) 居中）时 offset 不含这段位移，只能量矩形
  const useOffsets = el.offsetParent === parent && elStyle.transform === 'none';
  // 滚动区自己没圆角时（侧栏的滚动区），圆角在外层面板上
  const radius =
    parseFloat(elStyle.borderTopRightRadius) || parseFloat(getComputedStyle(parent).borderTopRightRadius) || 0;
  const PAD = padFor(radius);

  const thumb = document.createElement('div');
  thumb.className = 'ovs-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  parent.appendChild(thumb);
  // 圆条要盖在滚动容器之上（滚动容器自己可能有 z-index，例如播放队列弹层）
  const z = parseInt(elStyle.zIndex, 10);
  thumb.style.zIndex = String((Number.isFinite(z) ? z : 0) + 1);

  let raf = 0;
  let hideTimer = 0;
  let overEl = false;
  let overThumb = false;
  let dragging = false;
  let thumbH = 0;

  const layout = () => {
    raf = 0;
    const ch = el.clientHeight;
    const sh = el.scrollHeight;
    if (sh <= ch + 1 || ch === 0) {
      thumb.style.display = 'none';
      thumb.classList.remove('is-on');
      return;
    }
    thumb.style.display = '';
    // 以宿主的内边距盒为坐标系：offsetParent 就是宿主时用 offset（不受宿主自己的滑入位移影响），否则退回量矩形
    let left: number;
    let top: number;
    if (useOffsets) {
      left = el.offsetLeft + el.offsetWidth;
      top = el.offsetTop;
    } else {
      const er = el.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      left = er.right - pr.left - parent.clientLeft;
      top = er.top - pr.top - parent.clientTop;
    }
    const track = ch - PAD * 2;
    thumbH = Math.max(MIN_THUMB, (track * ch) / sh);
    const ratio = el.scrollTop / (sh - ch);
    thumb.style.height = `${thumbH.toFixed(1)}px`;
    thumb.style.transform = `translate(${(left - HIT_W).toFixed(1)}px, ${(top + PAD + ratio * (track - thumbH)).toFixed(1)}px)`;
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(layout);
  };

  const show = () => {
    if (thumb.style.display === 'none') return;
    thumb.classList.add('is-on');
    window.clearTimeout(hideTimer);
    if (!overEl && !overThumb && !dragging) {
      hideTimer = window.setTimeout(() => thumb.classList.remove('is-on'), HIDE_DELAY);
    }
  };
  const settle = () => {
    // 离开滚动区 / 圆条、或拖完：按原规则在 900ms 后淡出
    window.clearTimeout(hideTimer);
    if (!overEl && !overThumb && !dragging) {
      hideTimer = window.setTimeout(() => thumb.classList.remove('is-on'), HIDE_DELAY);
    }
  };

  const onScroll = () => {
    layout();
    show();
  };
  const onElEnter = () => {
    overEl = true;
    layout();
    show();
  };
  const onElLeave = () => {
    overEl = false;
    settle();
  };
  const onThumbEnter = () => {
    overThumb = true;
    show();
  };
  const onThumbLeave = () => {
    overThumb = false;
    settle();
  };

  // 拖动圆条：圆条移动的距离按比例换算成滚动距离
  const onThumbDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    thumb.classList.add('is-drag');
    thumb.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const s0 = el.scrollTop;
    const k = (el.scrollHeight - el.clientHeight) / Math.max(1, el.clientHeight - PAD * 2 - thumbH);
    const onMove = (ev: PointerEvent) => {
      el.scrollTop = s0 + (ev.clientY - y0) * k;
    };
    const onUp = () => {
      dragging = false;
      thumb.classList.remove('is-drag');
      thumb.removeEventListener('pointermove', onMove);
      thumb.removeEventListener('pointerup', onUp);
      thumb.removeEventListener('pointercancel', onUp);
      settle();
    };
    thumb.addEventListener('pointermove', onMove);
    thumb.addEventListener('pointerup', onUp);
    thumb.addEventListener('pointercancel', onUp);
  };

  el.addEventListener('scroll', onScroll, { passive: true });
  el.addEventListener('pointerenter', onElEnter);
  el.addEventListener('pointerleave', onElLeave);
  thumb.addEventListener('pointerenter', onThumbEnter);
  thumb.addEventListener('pointerleave', onThumbLeave);
  thumb.addEventListener('pointerdown', onThumbDown);
  // 容器尺寸、内容增减（翻页、加载更多、展开详情）都要重新算
  const ro = new ResizeObserver(schedule);
  ro.observe(el);
  const mo = new MutationObserver(schedule);
  mo.observe(el, { childList: true, subtree: true });
  layout();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.clearTimeout(hideTimer);
    ro.disconnect();
    mo.disconnect();
    el.removeEventListener('scroll', onScroll);
    el.removeEventListener('pointerenter', onElEnter);
    el.removeEventListener('pointerleave', onElLeave);
    el.classList.remove('ovs');
    thumb.remove();
  };
}

/** React 用法：滚动容器挂上 ref 即可；active = false（例如弹层还没打开）时不挂。 */
export function useOverlayScrollbar(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    return attachOverlayScrollbar(el);
  }, [ref, active]);
}
