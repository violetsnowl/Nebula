import { hslToRgb as hslToRgbUnit, rgbToHsl as rgbToHslUnit } from './coverColors';

/** coverColors 的色相单位是 0–1；本模块统一用角度（0–360）。 */
const hslToRgb = (hDeg: number, s: number, l: number) => hslToRgbUnit(hDeg / 360, s, l) as [number, number, number];
const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  const [h, s, l] = rgbToHslUnit(r, g, b);
  return [h * 360, s, l];
};

/**
 * 环境光（docs/design/NEBULA_UI_SYSTEM.md §4）：从当前背景媒体取色，生成三团环境光 + 底色 + 强调色。
 * 写入根节点 CSS 变量（--e1 / --e2 / --e3 / --ebase / --acc / --env-lum / --tint-adapt），
 * 由背景层、玻璃材质、进度条等消费端读取；本模块不触碰歌词或任何组件状态。
 */

export type RGB = [number, number, number];

export interface EnvPalette {
  e1: RGB;
  e2: RGB;
  e3: RGB;
  base: RGB;
  /** 强调色：进度、当前项、正在唱的字。 */
  acc: RGB;
  /** 背景媒体（封面 / 图片）的平均亮度 0–1。 */
  lum: number;
  /** 环境光背景实际渲染出来的亮度（底色与主光团的混合），环境光模式下用它判断明暗。 */
  bgLum: number;
  /** 浅色封面（lum > .6）。 */
  light: boolean;
  /** 主色相（度）与加权饱和度，供旧的环境光采样接口兼容。 */
  hue: number;
  sat: number;
}

const NEAR_BLACK: RGB = [5, 6, 7];

/** 中性兜底：黑白 / 灰调封面、无封面、取色失败。 */
export const NEUTRAL_ENV: EnvPalette = {
  e1: hslToRgb(216, 0.06, 0.5),
  e2: hslToRgb(216, 0.06, 0.4),
  e3: hslToRgb(216, 0.06, 0.32),
  base: [6, 7, 8],
  acc: hslToRgb(216, 0.14, 0.82),
  lum: 0.2,
  bgLum: 0.12,
  light: false,
  hue: 216,
  sat: 0.06,
};

const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

const relLum = (c: RGB) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

interface Cluster {
  c: RGB;
  h: number;
  s: number;
  l: number;
  n: number;
}

/** k-means（K = 6，迭代 10 次）取色；按"占比 × 饱和度、排除极端亮暗"打分取 3 个可区分的颜色。 */
export function extractEnvironment(source: CanvasImageSource): EnvPalette | null {
  try {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const px: RGB[] = [];
    let lumSum = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 128) continue;
      const p: RGB = [data[i]!, data[i + 1]!, data[i + 2]!];
      px.push(p);
      lumSum += (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
    }
    if (px.length < 16) return null;

    const K = 6;
    let centers: RGB[] = Array.from({ length: K }, (_, k) => [...px[Math.floor(((k + 0.5) * px.length) / K)]!] as RGB);
    const assign = new Int32Array(px.length);
    for (let it = 0; it < 10; it++) {
      for (let i = 0; i < px.length; i++) {
        const a = px[i]!;
        let best = 0;
        let bestD = Infinity;
        for (let k = 0; k < K; k++) {
          const c = centers[k]!;
          const dd = (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2 + (a[2] - c[2]) ** 2;
          if (dd < bestD) {
            bestD = dd;
            best = k;
          }
        }
        assign[i] = best;
      }
      const sums = centers.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < px.length; i++) {
        const s = sums[assign[i]!]!;
        s[0]! += px[i]![0];
        s[1]! += px[i]![1];
        s[2]! += px[i]![2];
        s[3]! += 1;
      }
      centers = sums.map((s, k) => (s[3] ? [s[0]! / s[3], s[1]! / s[3], s[2]! / s[3]] : centers[k]!) as RGB);
    }
    const counts = new Array<number>(K).fill(0);
    assign.forEach((k) => counts[k]++);

    const clusters: Cluster[] = centers
      .map((c, k) => {
        const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
        return { c, h, s, l, n: counts[k]! / px.length };
      })
      .filter((o) => o.n > 0.02);
    const score = (o: Cluster) => o.n * (0.25 + o.s * 1.6) * (o.l > 0.07 && o.l < 0.93 ? 1 : 0.25);
    const ranked = [...clusters].sort((a, b) => score(b) - score(a));
    const picks: Cluster[] = [];
    for (const o of ranked) {
      const distinct = picks.every((p) => {
        const dh = Math.min(Math.abs(p.h - o.h), 360 - Math.abs(p.h - o.h));
        return dh > 18 || Math.abs(p.l - o.l) > 0.18;
      });
      if (distinct) picks.push(o);
      if (picks.length === 3) break;
    }
    while (picks.length < 3) picks.push(picks[picks.length - 1] ?? { c: [60, 70, 90], h: 216, s: 0.2, l: 0.3, n: 1 });

    const lum = lumSum / px.length;
    const meanSat = clusters.reduce((a, o) => a + o.s * o.n, 0);
    const light = lum > 0.6;
    const neutral = meanSat < 0.12;
    const [p0, p1, p2] = picks as [Cluster, Cluster, Cluster];

    let e: [RGB, RGB, RGB] = neutral
      ? [NEUTRAL_ENV.e1, NEUTRAL_ENV.e2, NEUTRAL_ENV.e3]
      : [
          hslToRgb(p0.h, Math.min(p0.s, 0.8), 0.46),
          hslToRgb(p1.h, Math.min(p1.s, 0.75), 0.4),
          hslToRgb(p2.h, Math.min(p2.s, 0.7), 0.36),
        ];
    // 浅色封面：底色仍保持近黑（空间是"深"的），只把三团光调成淡色光；不把整个空间铺成灰（P1 修正，见 CHANGE_LOG #89）
    if (light) e = [mix(e[0], [255, 255, 255], 0.35), mix(e[1], [235, 236, 240], 0.3), mix(e[2], [210, 212, 218], 0.25)];
    const base: RGB = mix(NEAR_BLACK, light ? p0.c : e[0], light ? 0.1 : 0.08);
    const acc: RGB = neutral ? NEUTRAL_ENV.acc : hslToRgb(p0.h, Math.min(Math.max(p0.s, 0.45), 0.85), 0.72);
    const bgLum = relLum(mix(base, e[0], 0.45));
    return { e1: e[0], e2: e[1], e3: e[2], base, acc, lum, bgLum, light, hue: neutral ? NEUTRAL_ENV.hue : p0.h, sat: meanSat };
  } catch {
    // 跨域图片未放开 CORS 时 getImageData 会抛错：交给调用方走兜底
    return null;
  }
}

/** 从图片 URL 取色（需要 CORS；桌面端主进程已放开音乐平台的 CORS 响应头）。 */
export function environmentFromUrl(src: string): Promise<EnvPalette | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(extractEnvironment(img));
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const css = (c: RGB) => `rgb(${c[0]} ${c[1]} ${c[2]})`;

/** 实际背景亮度：环境光模式看渲染出来的环境，其他模式（原图铺满等）看媒体本身。 */
export function backgroundLuminance(env: EnvPalette, envMode: boolean): number {
  return envMode ? env.bgLum : env.lum;
}

/**
 * 写根节点环境变量。亮背景时玻璃自动加深：tintAdapt = 0.22 × smoothstep(.45, .70, 实际背景亮度)。
 * @param envMode 当前背景是否为「环境光」模式（决定用哪种亮度判断明暗）
 */
export function applyEnvironment(env: EnvPalette, envMode: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  const lum = backgroundLuminance(env, envMode);
  root.setProperty('--e1', css(env.e1));
  root.setProperty('--e2', css(env.e2));
  root.setProperty('--e3', css(env.e3));
  root.setProperty('--ebase', css(env.base));
  root.setProperty('--acc', css(env.acc));
  root.setProperty('--env-lum', lum.toFixed(3));
  // 封面本身的亮度：雾中封面据此调淡（浅色封面的残影更淡，保证深色空间和白字）
  root.setProperty('--cover-lum', env.lum.toFixed(3));
  root.setProperty('--tint-adapt', (0.22 * smoothstep(0.45, 0.7, lum)).toFixed(3));
}
