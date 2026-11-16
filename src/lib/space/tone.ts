import { useSyncExternalStore } from 'react';

/**
 * 封面色调（#133 主舞台方向原型）：每张封面一个代表色，用 OKLab 表示（L 亮度，a / b 色度平面）。
 * A 色彩星图按它排布；两个方向缩小看全貌时，每首歌化成一颗这种颜色的星。
 *
 * 取法：载入小缩略图（QQ 90×90 等），缩到 24×24，按 OKLab 加权求平均——彩色像素权重更高
 * （权重 0.35 + 色度/0.12，最多 1.35），所以「大片黑底 + 一小块红字」仍然偏暗、带一点红，不会被当成红封面。
 * 结果按封面地址缓存在 localStorage，1441 张只算一次。
 */
export type Tone = [number, number, number];

const CACHE_KEY = 'music-nebula.cover-tones.v1';
const CONCURRENCY = 8;
const SIZE = 24;

// ---------------------------------------------------------------- 色彩换算

function toLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function fromLinear(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

export function rgbToOklab(r: number, g: number, b: number): Tone {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** 色度（彩度）与色相角。 */
export function chromaOf(t: Tone): number {
  return Math.hypot(t[1], t[2]);
}
export function hueOf(t: Tone): number {
  return Math.atan2(t[2], t[1]);
}

/** 星的颜色：保留明暗次序（深的封面是暗星、浅的是亮星），整体提亮一些；色度放大 2 倍，让色相读得出来。 */
export function starRgb(t: Tone): [number, number, number] {
  return oklabToRgb(0.34 + 0.66 * t[0], t[1] * 2, t[2] * 2);
}

/** 亮版本：亮度至少 lMin，色度放大 boost 倍。 */
export function brightRgb(t: Tone, lMin = 0.62, boost = 1.35): [number, number, number] {
  const L = Math.max(lMin, t[0]);
  return oklabToRgb(L, t[1] * boost, t[2] * boost);
}

// ---------------------------------------------------------------- 缩略图地址

/** 取色只要很小的图：QQ R90x90、网易云 48×48、酷狗 100；认不出的原样用。 */
export function thumbUrl(url: string): string {
  if (/y\.gtimg\.cn\//.test(url) && /R\d+x\d+/.test(url)) return url.replace(/R\d+x\d+/, 'R90x90');
  if (/\.music\.126\.net\//.test(url)) return `${url.split('?')[0]}?param=48y48`;
  if (url.includes('{size}')) return url.replace('{size}', '100');
  return url;
}

// ---------------------------------------------------------------- 取色

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

function toneOfImage(img: HTMLImageElement): Tone | null {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!ctx) return null;
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
  let sw = 0;
  let sL = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 128) continue;
    const [L, a, b] = rgbToOklab(d[i]!, d[i + 1]!, d[i + 2]!);
    const w = 0.35 + Math.min(1, Math.hypot(a, b) / 0.12);
    sw += w;
    sL += L * w;
    sa += a * w;
    sb += b * w;
  }
  if (!sw) return null;
  return [sL / sw, sa / sw, sb / sw];
}

function sampleTone(url: string): Promise<Tone | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        resolve(toneOfImage(img));
      } catch {
        resolve(null); // 跨域被拦（画布被污染）时拿不到像素
      }
    };
    img.onerror = () => resolve(null);
    img.src = thumbUrl(url);
  });
}

// ---------------------------------------------------------------- 缓存 + 批量

type Cached = Tone | 0;
const tones = new Map<string, Cached>();
let loaded = false;
let saveTimer = 0;
const queue: string[] = [];
const queued = new Set<string>();
let running = 0;
/** 进度（这一批）：done / total；version 在一批全部完成时加一（A 色彩星图据此重新排布）。 */
let snapshot = { done: 0, total: 0, version: 0 };
const subs = new Set<() => void>();

function loadCache(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, number[] | 0>;
    for (const [k, v] of Object.entries(obj)) tones.set(k, v === 0 ? 0 : [v[0]!, v[1]!, v[2]!]);
  } catch {
    /* 缓存坏了就重新取 */
  }
}

function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    try {
      const obj: Record<string, number[] | 0> = {};
      for (const [k, v] of tones) obj[k] = v === 0 ? 0 : v.map((n) => Math.round(n * 1000) / 1000);
      localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    } catch {
      /* 存不下就只在这次有效 */
    }
  }, 1500);
}

function emit(): void {
  subs.forEach((f) => f());
}

function pump(): void {
  while (running < CONCURRENCY && queue.length) {
    const url = queue.shift()!;
    running++;
    void sampleTone(url).then((t) => {
      tones.set(url, t ?? 0);
      queued.delete(url);
      running--;
      const done = snapshot.done + 1;
      const finished = done >= snapshot.total;
      snapshot = { done, total: snapshot.total, version: snapshot.version + (finished ? 1 : 0) };
      saveSoon();
      // 进度每 24 张、以及最后一张时通知一次，别让面板每张都重绘
      if (finished || done % 24 === 0) emit();
      pump();
    });
  }
}

/** 确保这些封面都有色调：缺的排队去取（已在队里的不重复）。 */
export function ensureTones(urls: string[]): void {
  loadCache();
  let added = 0;
  for (const u of urls) {
    if (!u || tones.has(u) || queued.has(u)) continue;
    queued.add(u);
    queue.push(u);
    added++;
  }
  if (!added) return;
  const busy = snapshot.done < snapshot.total;
  snapshot = { done: busy ? snapshot.done : 0, total: (busy ? snapshot.total : 0) + added, version: snapshot.version };
  emit();
  pump();
}

/** 某张封面的色调；还没取到 / 取不到返回 null。 */
export function toneOf(url: string | undefined): Tone | null {
  if (!url) return null;
  loadCache();
  const v = tones.get(url);
  return v ? v : null;
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}
function getSnapshot() {
  return snapshot;
}
export function useToneProgress(): { done: number; total: number; version: number } {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
