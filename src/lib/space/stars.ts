import type { Track } from '../catalog';
import { CARD_HEIGHT, CARD_WIDTH } from '../layout';
import { project, type CamLike, type Proj } from './lens';
import { thumbOf } from './thumbs';
import { oklabToRgb, toneOf } from './tone';
import type { BoundedWorld } from './world';

/**
 * 封面层（#133 星层 → #134 重做）：画在 DOM 卡片下面的一张画布，承接所有「不挂 DOM」的歌。
 *
 * #133 缩到全貌时把每首歌画成一样的发光点，加上向日葵点阵的螺旋，看起来像万花筒、LED 点阵，
 * 和这个软件没有关系（用户反馈）。现在：
 *   - 一直画真封面：屏幕上 72px 以下到最远的 6px 左右，都是圆角小封面（远处用 18px 的小图）；
 *     和 DOM 卡片同位置、同圆角、同样的边缘 / 外圈淡出，56–72px 之间和 DOM 卡片交叉淡化；
 *     缩略图还没到时先画一块封面代表色的小方块，到了自然换成封面；
 *   - 缩小看全貌时，底下铺一层很淡的色雾：每首歌的封面色在世界坐标里晕开、模糊，越密的地方越亮，
 *     远看是一团发光的云（预先画好的一张小图，每帧只画一次）；
 *   - 按歌手时在缩小时标出星团（歌手）名，大星团先占位，重叠的不写。
 */
const GRAY: [number, number, number] = [150, 154, 166];

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
  /** 封面色调的版本（取完一批加一）：色雾据此重画 */
  toneVersion: number;
}

export class StarField {
  private ctx: CanvasRenderingContext2D | null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private chip = new Map<string, string>();
  private p: Proj = { sx: 0, sy: 0, s: 0, u: 0 };
  private empty = true;
  private haze: HTMLCanvasElement | null = null;
  private hazeWorld: BoundedWorld | null = null;
  private hazeVersion = -1;

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

  /** 缩略图没到时的小方块颜色：封面代表色（略提亮），没有色调先用灰。 */
  private chipOf(track: Track): string {
    const key = track.cover ?? '';
    const hit = this.chip.get(key);
    if (hit) return hit;
    const t = toneOf(track.cover);
    const [r, g, b] = t ? oklabToRgb(0.25 + 0.7 * t[0], t[1] * 1.4, t[2] * 1.4) : GRAY;
    const css = `rgb(${r},${g},${b})`;
    if (t) this.chip.set(key, css); // 灰色不缓存，取到色调后自然换色
    return css;
  }

  /** 色雾：每首歌的封面色在世界坐标里晕开，叠加后模糊。世界或色调变了才重画（一张 384px 的小图）。 */
  private hazeOf(world: BoundedWorld, version: number): HTMLCanvasElement | null {
    if (this.haze && this.hazeWorld === world && this.hazeVersion === version) return this.haze;
    const N = 384;
    const R = world.radius;
    const k = N / (2 * R);
    const raw = document.createElement('canvas');
    raw.width = N;
    raw.height = N;
    const g = raw.getContext('2d');
    if (!g) return null;
    g.globalCompositeOperation = 'lighter';
    const rad = Math.max(4, 300 * k);
    for (let i = 0; i < world.cards.length; i++) {
      const t = toneOf(world.cards[i]!.track.cover);
      const [r, gg, b] = t ? oklabToRgb(0.5 + 0.35 * t[0], t[1] * 2.2, t[2] * 2.2) : GRAY;
      const x = (world.px[i]! + R) * k;
      const y = (world.py[i]! + R) * k;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(${r},${gg},${b},0.11)`);
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const out = document.createElement('canvas');
    out.width = N;
    out.height = N;
    const o = out.getContext('2d');
    if (!o) return null;
    o.filter = 'blur(7px)';
    o.drawImage(raw, 0, 0);
    this.haze = out;
    this.hazeWorld = world;
    this.hazeVersion = version;
    return out;
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
      if (size < 8) continue;
      const cy = this.coverY(p, f.boxH);
      const half = Math.max(size / 2, 5);
      if (Math.abs(x - p.sx) <= half && Math.abs(y - cy) <= half && p.u < bestU) {
        best = i;
        bestU = p.u;
      }
    }
    return best;
  }

  draw(f: StarFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { cam, world, delta, mounted, match } = f;
    this.fit(cam.vw, cam.vh);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cam.vw, cam.vh);
    let drew = false;

    // 色雾：缩小看全貌时才出现（缩放 0.34 → 0.14 渐入）；这时透镜已经退成平面，按线性换算即可
    const hazeA = 1 - smoothstep(0.14, 0.34, cam.zoom);
    if (hazeA > 0.02) {
      const haze = this.hazeOf(world, f.toneVersion);
      if (haze) {
        const R = world.radius;
        const z = cam.zoom;
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.85 * hazeA * (match ? 0.5 : 1);
        ctx.drawImage(haze, (-R - cam.x) * z, (-R - cam.y) * z, 2 * R * z, 2 * R * z);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        drew = true;
      }
    }

    // 小封面
    const p = this.p;
    const n = world.cards.length;
    let cur: { x: number; y: number; s: number } | null = null;
    for (let i = 0; i < n; i++) {
      const left = 1 - mounted[i]!;
      if (left <= 0.02) continue;
      project(world.px[i]!, world.py[i]!, cam, delta, p);
      const size = Math.max(3, CARD_WIDTH * p.s);
      const half = size * 0.6 + 4;
      if (p.sx < -half || p.sy < -half || p.sx > cam.vw + half || p.sy > cam.vh + half) continue;
      const edge = Math.min(p.sx, cam.vw - p.sx, p.sy, cam.vh - p.sy);
      const edgeA = smoothstep(-0.3 * size, 0.42 * size, edge);
      const airA = 1 - 0.4 * smoothstep(0.38, 1.05, p.u);
      let a = left * edgeA * airA;
      if (match) a *= match.has(i) ? 1 : 0.16;
      if (a <= 0.02) continue;
      const track = world.cards[i]!.track;
      const x = p.sx - size / 2;
      const y = this.coverY(p, f.boxH) - size / 2;
      const img = thumbOf(track.cover, size);
      ctx.globalAlpha = Math.min(1, a);
      if (img) {
        ctx.drawImage(img, x, y, size, size);
      } else {
        ctx.fillStyle = this.chipOf(track);
        ctx.beginPath();
        ctx.roundRect(x, y, size, size, Math.max(1, size * 0.08));
        ctx.fill();
      }
      if (track.id === f.currentId) cur = { x, y, s: size };
      drew = true;
    }
    ctx.globalAlpha = 1;

    // 正在播放的那一张：一圈细框
    if (cur) {
      const pad = Math.max(2, cur.s * 0.12);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(cur.x - pad, cur.y - pad, cur.s + 2 * pad, cur.s + 2 * pad, Math.max(2, (cur.s + 2 * pad) * 0.1));
      ctx.stroke();
    }

    // 按歌手：缩小时标星团名（4 首以上的歌手）。大星团先占位，和已放的名字重叠的就不写
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
        let a = labelA * (0.5 + 0.4 * smoothstep(4, 30, c.ids.length));
        if (match) a *= c.ids.some((id) => match.has(id)) ? 1.6 : 0.35;
        // 名字压在封面上，带一点暗影保证读得清
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = `rgba(240,242,248,${Math.min(1, a).toFixed(3)})`;
        ctx.fillText(c.name, p.sx, p.sy - 4);
        ctx.shadowBlur = 0;
      }
      drew = true;
    }
    this.empty = !drew;
  }
}
