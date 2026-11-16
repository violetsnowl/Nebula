import { hslToRgb, rgbToHsl } from '../coverColors';

/**
 * 歌词用的两种颜色（NEBULA_UI_SYSTEM §7.2「视觉模式」）。
 * 色相取封面的第一、第二主色（环境光 --e1 / --e2）；饱和度 72–90%（第二色 62–84%）；
 * 亮度不定死，而是按色相二分查找到「看起来一样亮」的那一档（相对亮度约 0.5），
 * 黄色不会发白、蓝色不会发暗，深色背景上都读得清。
 * 第二色离主色太近（看不出区别）或太远（撞色）时，改成主色的邻近色（±32°）。
 * 灰色 / 黑白封面退成近白。
 */
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const rgbOf = (c: string): [number, number, number] => {
  const n = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0];
};

/** sRGB 相对亮度（0–1）。 */
const lum = (c: [number, number, number]): number => {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};

const css = (c: [number, number, number]) => `rgb(${c[0]} ${c[1]} ${c[2]})`;

/** 固定色相与饱和度，二分查找亮度使相对亮度 ≈ Y（HSL 亮度限制在 .5–.9）。 */
function vivid(h: number, s: number, Y: number): string {
  let lo = 0.5;
  let hi = 0.9;
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    if (lum(hslToRgb(h, s, m)) < Y) lo = m;
    else hi = m;
  }
  return css(hslToRgb(h, s, (lo + hi) / 2));
}

/** @param e1 环境光第一色（`rgb(r g b)` 或 `rgb(r, g, b)`）@param e2 第二色 */
export function lyricPaletteFrom(e1: string, e2: string): { a: string; b: string } {
  const [h1, s1] = rgbToHsl(...rgbOf(e1));
  const [h2, s2] = rgbToHsl(...rgbOf(e2));
  if (s1 < 0.12) return { a: 'rgb(238 240 244)', b: 'rgb(222 228 236)' };
  let dh = ((h2 - h1 + 1.5) % 1) - 0.5;
  if (Math.abs(dh) < 0.05 || Math.abs(dh) > 0.2) dh = dh >= 0 ? 0.09 : -0.09;
  const sa = clamp(s1 * 1.5, 0.72, 0.9);
  const sb = clamp(Math.max(s2, s1 * 0.8) * 1.4, 0.62, 0.84);
  return { a: vivid(h1, sa, 0.5), b: vivid((h1 + dh + 1) % 1, sb, 0.46) };
}
