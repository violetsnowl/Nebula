import { thumbUrl } from './tone';

/**
 * 星层上的小封面（#133 / #134）：屏幕上小于 72px 的卡片不挂 DOM（几百张同时变动时样式重算太贵，
 * 实测每张约 50µs/帧），改在画布上画缩略图——一直画到缩小看全貌（6–12px），整片星云都是真封面。
 * 缩略图就是取色时下载过的 90px 小图（走浏览器缓存），载入后预先裁成圆角（和卡片 14px 圆角同比例），
 * 另做一份 18px 的小图（分两步缩，免得远处的小封面发花），每帧只需 drawImage。
 */
const BIG = 72;
const SMALL = 18;
const CONCURRENCY = 6;

export interface ThumbPair {
  big: CanvasImageSource;
  small: CanvasImageSource;
}

type Entry = ThumbPair | 0 | 1; // 0 = 失败，1 = 加载中
const cache = new Map<string, Entry>();
const queue: string[] = [];
let running = 0;
const listeners = new Set<() => void>();
let notifyTimer = 0;

function notify(): void {
  if (notifyTimer) return;
  // 一批一批到：最多每 120ms 通知一次重画
  notifyTimer = window.setTimeout(() => {
    notifyTimer = 0;
    listeners.forEach((f) => f());
  }, 120);
}

function roundedCanvas(src: CanvasImageSource, size: number): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, Math.max(1, Math.round((14 / 172) * size)));
  ctx.clip();
  ctx.drawImage(src, 0, 0, size, size);
  return c;
}

function pump(): void {
  while (running < CONCURRENCY && queue.length) {
    const url = queue.shift()!;
    running++;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const done = (entry: Entry) => {
      cache.set(url, entry);
      running--;
      notify();
      pump();
    };
    img.onload = () => {
      const big = roundedCanvas(img, BIG);
      // 分两步缩到 18px（72 → 36 → 18），比一步缩清楚
      const mid = big && roundedCanvas(big, BIG / 2);
      const small = mid && roundedCanvas(mid, SMALL);
      if (!big || !small) return done(0);
      done({ big, small });
    };
    img.onerror = () => done(0);
    img.src = thumbUrl(url);
  }
}

/** 某张封面在屏幕上 px 大小时用的圆角缩略图；还没有就排队去取（返回 null）。 */
export function thumbOf(url: string | undefined, px: number): CanvasImageSource | null {
  if (!url) return null;
  const e = cache.get(url);
  if (e === undefined) {
    cache.set(url, 1);
    queue.push(url);
    pump();
    return null;
  }
  if (e === 0 || e === 1) return null;
  return px < 26 ? e.small : e.big;
}

/** 有新的缩略图到了（节流）：舞台据此补画一帧。 */
export function onThumbsReady(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
