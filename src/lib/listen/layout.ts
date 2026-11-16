import { columnScale } from './engine';

/**
 * 听音空间的水平布局（#129，用户反馈：2K 下歌词快居中、右边空一大块）。
 *
 * 原来封面左边距 10.6vw、歌词栏从 43.75vw 起、宽 50vw，全按窗口比例；而歌词一行最宽 760px×k，
 * #125 之后 k 只随高度阻尼增长。窗口宽过约 1600px（16:9）后歌词块不再变宽，多出来的宽度全堆在右边。
 *
 * 现在把「封面 + 间距 + 歌词块」当成一组：
 *   - 歌词块宽 Lw 的算法不变（原栏宽 50vw 减 40k，最多 760k）；
 *   - 间距最多 0.4 × 封面边长（原 43.75vw − 封面右边，宽窗口下会拉到 0.46 以上）；
 *   - 剩下的宽度左 54%、右 46%：歌词左对齐、句尾参差，右边按最长一行量会显得更空，所以右边少给一点。
 *     54% 就是原布局在 1424×835、1600×900 下的实际左右比例，中等窗口位置基本不动（差 1–2px）。
 * 歌词栏宽收成 Lw + 40k，翻译按钮（栏右下角）跟着贴近歌词。
 */
export interface ListenLayout {
  /** 封面边长 */
  cv: number;
  /** 封面左边 */
  x: number;
  /** 歌词栏左边 */
  colX: number;
  /** 歌词栏宽 */
  colW: number;
}

const COL_H = 0.844;
const GAP_MAX = 0.4;
const LEFT_SHARE = 0.54;

export function listenLayout(W: number, H: number): ListenLayout {
  const cv = Math.min(0.42 * H, 0.3 * W);
  const k = columnScale(COL_H * H);
  const pad = 40 * k;
  const lw = Math.max(0, Math.min(0.5 * W - pad, 760 * k));
  const gap0 = 0.4375 * W - (0.106 * W + cv);
  const gap = Math.max(0, Math.min(gap0, GAP_MAX * cv));
  const margin = Math.max(0, W - (cv + gap + lw));
  const x = margin * LEFT_SHARE;
  return { cv, x, colX: x + cv + gap, colW: lw + pad };
}

/** 写到 :root，封面槽、飞行层、歌名区、歌词栏、右栏详情共用（飞行层在 .ls-root 外面）。 */
export function applyListenLayout(): void {
  const { cv, x, colX, colW } = listenLayout(window.innerWidth, window.innerHeight);
  const st = document.documentElement.style;
  st.setProperty('--ls-cv', `${cv.toFixed(1)}px`);
  st.setProperty('--ls-x', `${x.toFixed(1)}px`);
  st.setProperty('--ls-colx', `${colX.toFixed(1)}px`);
  st.setProperty('--ls-colw', `${colW.toFixed(1)}px`);
}
