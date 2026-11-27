/**
 * 穿行用的封面大图（初版）：星层的缩略图只有 72px，穿行里近处的封面要画到 200–300px，所以另取一份较大的图，
 * 载入时一次性裁成圆角、轻微降饱和与亮度（「柔化压暗」，不在每帧上做滤镜），之后每帧只 drawImage。
 * 只取视野里用得到的，按最近使用淘汰，最多留 CAP 张（每张约 110KB）。
 */
const SIZE = 168;
const CAP = 380;
const CONCURRENCY = 6;

interface Entry {
  c: HTMLCanvasElement | null;
  /** 0 = 失败，1 = 加载中，2 = 好了 */
  st: 0 | 1 | 2;
  used: number;
}

const cache = new Map<string, Entry>();
/** 后进先出：每帧从远往近请求，最近的封面最后进队、最先取 */
const queue: string[] = [];
let running = 0;

/** 较大的封面图地址（约 300px）。穿行第二版（coverTex.ts）也用它。 */
export function bigUrl(url: string): string {
  if (/y\.gtimg\.cn\//.test(url) && /R\d+x\d+/.test(url)) return url.replace(/R\d+x\d+/, 'R300x300');
  if (/\.music\.126\.net\//.test(url)) return `${url.split('?')[0]}?param=200y200`;
  if (url.includes('{size}')) return url.replace('{size}', '300');
  if (url.includes('{w}')) return url.replace('{w}', '300').replace('{h}', '300');
  return url;
}

function prepare(img: HTMLImageElement): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.beginPath();
  ctx.roundRect(0, 0, SIZE, SIZE, Math.round((14 / 172) * SIZE));
  ctx.clip();
  ctx.filter = 'saturate(0.78) brightness(0.86)';
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  return c;
}

function evict(): void {
  if (cache.size <= CAP) return;
  const done = [...cache.entries()].filter(([, e]) => e.st !== 1).sort((a, b) => a[1].used - b[1].used);
  for (let i = 0; i < Math.min(done.length, cache.size - CAP + 40); i++) cache.delete(done[i]![0]);
}

function pump(): void {
  while (running < CONCURRENCY && queue.length) {
    const url = queue.pop()!;
    const e = cache.get(url);
    if (!e || e.st !== 1) continue;
    running++;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const done = (c: HTMLCanvasElement | null) => {
      e.c = c;
      e.st = c ? 2 : 0;
      running--;
      evict();
      pump();
    };
    img.onload = () => done(prepare(img));
    img.onerror = () => done(null);
    img.src = bigUrl(url);
  }
}

/** 某张封面的大图；还没有就排队去取（返回 null，调用方先画缩略图）。frame 用来按最近使用淘汰。 */
export function bigCover(url: string, frame: number): HTMLCanvasElement | null {
  let e = cache.get(url);
  if (!e) {
    e = { c: null, st: 1, used: frame };
    cache.set(url, e);
    queue.push(url);
    pump();
    return null;
  }
  e.used = frame;
  return e.st === 2 ? e.c : null;
}

export function bigCoverStats(): { cached: number; queued: number } {
  return { cached: cache.size, queued: queue.length };
}
