import { thumbUrl } from './tone';

/**
 * 星层上的小封面（#133）：屏幕上小于 72px 的卡片不挂 DOM（几百张同时变动时样式重算太贵，
 * 实测每张约 50µs/帧），改在画布上画缩略图。缩略图就是取色时下载过的 90px 小图（走浏览器缓存），
 * 载入后预先裁成圆角（和卡片 14px 圆角同比例），每帧只需 drawImage，不用逐张裁剪。
 */
const SIZE = 72;
const RADIUS = Math.round((14 / 172) * SIZE);
const CONCURRENCY = 6;

type Entry = ImageBitmap | HTMLCanvasElement | 0 | 1; // 0 = 失败，1 = 加载中
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

function rounded(img: HTMLImageElement): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.beginPath();
  ctx.roundRect(0, 0, SIZE, SIZE, RADIUS);
  ctx.clip();
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
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
      const c = rounded(img);
      if (!c) return done(0);
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(c).then(
          (b) => done(b),
          () => done(c),
        );
      } else done(c);
    };
    img.onerror = () => done(0);
    img.src = thumbUrl(url);
  }
}

/** 某张封面的圆角缩略图；还没有就排队去取（返回 null）。 */
export function thumbOf(url: string | undefined): ImageBitmap | HTMLCanvasElement | null {
  if (!url) return null;
  const e = cache.get(url);
  if (e === undefined) {
    cache.set(url, 1);
    queue.push(url);
    pump();
    return null;
  }
  return e === 0 || e === 1 ? null : e;
}

/** 有新的缩略图到了（节流）：舞台据此补画一帧。 */
export function onThumbsReady(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
