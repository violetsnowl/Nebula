import type { Track } from '../catalog';
import { CARD_HEIGHT, CARD_WIDTH } from '../layout';
import { project, type CamLike, type Proj } from './lens';
import { thumbOf } from './thumbs';
import { starRgb, toneOf } from './tone';
import type { BoundedWorld } from './world';

/**
 * 星层（#133）：画在卡片下面的一张画布，承接所有「不挂 DOM」的歌：
 *   - 屏幕上 20–72px 的：画圆角小封面（和 DOM 卡片同位置、同圆角、同样的边缘 / 外圈淡出），
 *     和 DOM 卡片在 56–72px 之间交叉淡化，缩放时看不出换了一种画法；
 *   - 再小的：化成一颗星，颜色是封面的代表色（保留明暗次序），叠加混合，越密越亮，像星云的核；
 *   - B 在缩小时标出星团（歌手）名，大星团先占位，重叠的不写。
 */
const GRAY = '182,186,198';

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface StarFrame {
  world: BoundedWorld;
  cam: CamLike;
  delta: number;
  /** 每首歌已经作为 DOM 卡片显示的程度（0–1，只按大小算，不含边缘淡出），画布按 1 − 它画 */
  mounted: Float32Array;
  /** 卡片 DOM 盒的实际高度（封面 + 标题区）：缩放以盒中心为原点，算封面中心要用 */
  boxH: number;
  match: ReadonlySet<number> | null;
  currentId: number | null;
}

interface Thumb {
  img: CanvasImageSource;
  x: number;
  y: number;
  s: number;
  a: number;
}

export class StarField {
  private ctx: CanvasRenderingContext2D | null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private color = new Map<string, string>();
  private p: Proj = { sx: 0, sy: 0, s: 0, u: 0 };
  private thumbs: Thumb[] = [];
  private empty = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
  }

  private fit(vw: number, vh: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (vw === this.w && vh === this.h && dpr === this.dpr) return;
    this.w = vw;
    this.h = vh;
    this.dpr = dpr;
    this.canvas.width = Math.round(vw * dpr);
    this.canvas.height = Math.round(vh * dpr);
  }

  private rgbOf(track: Track): string {
    const key = track.cover ?? '';
    const hit = this.color.get(key);
    if (hit) return hit;
    const t = toneOf(track.cover);
    if (!t) return GRAY; // 还没取到色调：先灰着，取到后自然换色（不缓存灰色）
    const [r, g, b] = starRgb(t);
    const css = `${r},${g},${b}`;
    this.color.set(key, css);
    return css;
  }

  clear(): void {
    if (!this.ctx || this.empty) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.empty = true;
  }

  /** DOM 卡片的封面中心：盒子（172 × boxH）按盒中心缩放，封面在盒子上部。 */
  private coverY(p: Proj, boxH: number): number {
    const h = boxH || CARD_HEIGHT;
    const top = p.sy - CARD_HEIGHT / 2;
    const cb = top + h / 2;
    return cb + (top + CARD_WIDTH / 2 - cb) * p.s;
  }

  /** 屏幕点 (x, y) 上的小封面（画布画的那些），没有返回 -1。点小封面也能播放。 */
  hit(f: StarFrame, x: number, y: number): number {
    const p = this.p;
    let best = -1;
    let bestU = Infinity;
    const n = f.world.cards.length;
    for (let i = 0; i < n; i++) {
      if (f.mounted[i]! > 0.5) continue;
      project(f.world.px[i]!, f.world.py[i]!, f.cam, f.delta, p);
      const size = CARD_WIDTH * p.s;
      if (size < 20) continue;
      const cy = this.coverY(p, f.boxH);
      if (Math.abs(x - p.sx) <= size / 2 && Math.abs(y - cy) <= size / 2 && p.u < bestU) {
        best = i;
        bestU = p.u;
      }
    }
    return best;
  }

  draw(f: StarFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { cam } = f;
    this.fit(cam.vw, cam.vh);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cam.vw, cam.vh);
    ctx.globalCompositeOperation = 'lighter';
    const { world, delta, mounted, match } = f;
    const p = this.p;
    const n = world.cards.length;
    const thumbs = this.thumbs;
    thumbs.length = 0;
    let drew = false;
    let cur: { x: number; y: number; r: number; rgb: string } | null = null;
    for (let i = 0; i < n; i++) {
      const left = 1 - mounted[i]!;
      if (left <= 0.02) continue;
      project(world.px[i]!, world.py[i]!, cam, delta, p);
      const size = CARD_WIDTH * p.s;
      const half = Math.max(24, size * 0.6);
      if (p.sx < -half || p.sy < -half || p.sx > cam.vw + half || p.sy > cam.vh + half) continue;
      let a = left;
      if (match) a *= match.has(i) ? 1 : 0.16;
      const track = world.cards[i]!.track;
      // 小封面：和 DOM 卡片同样的边缘淡出、外圈淡出
      const thumbA = smoothstep(14, 24, size);
      let img: CanvasImageSource | null = null;
      if (thumbA > 0.02) {
        img = thumbOf(track.cover);
        if (img) {
          const edge = Math.min(p.sx, cam.vw - p.sx, p.sy, cam.vh - p.sy);
          const edgeA = smoothstep(-0.3 * size, 0.42 * size, edge);
          const airA = 1 - 0.4 * smoothstep(0.38, 1.05, p.u);
          thumbs.push({ img, x: p.sx, y: this.coverY(p, f.boxH), s: size, a: a * thumbA * edgeA * airA });
        }
      }
      // 星：封面越小越像星；有缩略图时随缩略图出现而退场
      const starA = img ? 1 - thumbA : 1;
      if (starA > 0.02) {
        const rr = Math.min(9, Math.max(1.8, size * 0.3));
        const sa = a * starA * (0.55 + 0.45 * smoothstep(1.8, 5, rr));
        const rgb = this.rgbOf(track);
        if (track.id === f.currentId) cur = { x: p.sx, y: p.sy, r: rr, rgb };
        ctx.fillStyle = `rgba(${rgb},${(0.15 * sa).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, rr * 2.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${rgb},${Math.min(1, 0.85 * sa).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, rr, 0, Math.PI * 2);
        ctx.fill();
        drew = true;
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // 小封面画在星上面
    for (const t of thumbs) {
      if (t.a <= 0.02) continue;
      ctx.globalAlpha = Math.min(1, t.a);
      ctx.drawImage(t.img, t.x - t.s / 2, t.y - t.s / 2, t.s, t.s);
      drew = true;
    }
    ctx.globalAlpha = 1;
    // 正在播放的那一颗：一圈细环
    if (cur) {
      ctx.strokeStyle = `rgba(${cur.rgb},0.9)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, cur.r * 2 + 6, 0, Math.PI * 2);
      ctx.stroke();
      drew = true;
    }
    // B：缩小时标星团名（4 首以上的歌手）。大星团先占位，和已放的名字重叠的就不写
    const labelA = world.mode === 'cluster' ? 1 - smoothstep(0.3, 0.5, cam.zoom) : 0;
    if (labelA > 0.02) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const taken: number[] = [];
      for (const c of world.clusters) {
        if (c.ids.length < 4) continue;
        project(c.cx, c.cy - c.r, cam, delta, p);
        if (p.sx < -200 || p.sy < -40 || p.sx > cam.vw + 200 || p.sy > cam.vh + 40) continue;
        const size = Math.round(Math.min(20, 10.5 + Math.sqrt(c.ids.length) * 1.1));
        ctx.font = `600 ${size}px Inter, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
        const w = ctx.measureText(c.name).width;
        const x0 = p.sx - w / 2 - 6;
        const x1 = p.sx + w / 2 + 6;
        const y0 = p.sy - 4 - size - 4;
        const y1 = p.sy;
        let overlap = false;
        for (let k = 0; k < taken.length; k += 4) {
          if (x0 < taken[k + 2]! && x1 > taken[k]! && y0 < taken[k + 3]! && y1 > taken[k + 1]!) {
            overlap = true;
            break;
          }
        }
        if (overlap) continue;
        taken.push(x0, y0, x1, y1);
        let a = labelA * (0.42 + 0.4 * smoothstep(4, 30, c.ids.length));
        if (match) a *= c.ids.some((id) => match.has(id)) ? 1.6 : 0.35;
        ctx.fillStyle = `rgba(236,238,245,${Math.min(1, a).toFixed(3)})`;
        ctx.fillText(c.name, p.sx, p.sy - 4);
      }
      drew = true;
    }
    this.empty = !drew;
  }
}
