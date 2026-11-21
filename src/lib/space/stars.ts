import type { Track } from '../catalog';
import { CARD_HEIGHT, CARD_WIDTH } from '../layout';
import { applyXf, project, type CamLike, type Proj, type ScreenXf } from './lens';
import { thumbOf } from './thumbs';
import { oklabToRgb, toneOf } from './tone';
import { placeholderFill } from '../coverPlaceholder';
import { airAlpha } from './active';
import { labelFontPx, type SpaceWorld } from './world';

/**
 * 封面层（#133 星层 → #134 重做）：画在 DOM 卡片下面的一张画布，承接所有「不挂 DOM」的歌。
 *
 * #133 缩到全貌时把每首歌画成一样的发光点，加上向日葵点阵的螺旋，看起来像万花筒、LED 点阵，
 * 和这个软件没有关系（用户反馈）。现在：
 *   - 一直画真封面：屏幕上 72px 以下到最远的 6px 左右，都是圆角小封面（远处用 18px 的小图）；
 *     和 DOM 卡片同位置、同圆角、同样的外圈略暗，56–72px 之间和 DOM 卡片交叉淡化；
 *     #137：屏幕边缘不再淡出（边缘像一扇窗，拖过去自然看见）；
 *     缩略图还没到时先画一块封面代表色的小方块，到了自然换成封面；
 *   - #135：不再允许缩到看见整片星云（最远约 0.28 倍，封面约 48px），看全貌用的色雾去掉；
 *   - 按歌手时标出较大星团（6 首以上）的歌手名：正常缩放下很淡，拉远时清楚一些；大星团先占位，重叠的不写。
 *     #138：名字按歌手随机放在星团上方、下方或中间，位置和空地由排布时定好（world.ts ClusterLabel），封面不会压住名字。
 */
const GRAY: [number, number, number] = [96, 100, 112];

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface StarFrame {
  world: SpaceWorld;
  cam: CamLike;
  delta: number;
  /** 每首歌已经作为 DOM 卡片显示的程度（0–1，只按大小算，不含边缘淡出），画布按 1 − 它画 */
  mounted: Float32Array;
  /** 卡片 DOM 盒的实际高度（封面 + 标题区）：缩放以盒中心为原点，算封面中心要用 */
  boxH: number;
  match: ReadonlySet<number> | null;
  currentId: number | null;
  /** 投影之后的屏幕变换（聆听「沉降」），没有为 null */
  xf: ScreenXf | null;
  /** 封面色调的版本（取完一批加一） */
  toneVersion: number;
}

export class StarField {
  private ctx: CanvasRenderingContext2D | null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private chip = new Map<string, string>();
  private p: Proj = { sx: 0, sy: 0, s: 0, u: 0 };

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

  /** 缩略图没到时的小方块颜色：封面代表色（略提亮），没有色调先用灰；没有封面的歌用和卡片占位一样的深色。 */
  private chipOf(track: Track): string {
    if (!track.cover) return placeholderFill(track.hue1);
    const key = track.cover;
    const hit = this.chip.get(key);
    if (hit) return hit;
    const t = toneOf(track.cover);
    const [r, g, b] = t ? oklabToRgb(0.25 + 0.7 * t[0], t[1] * 1.4, t[2] * 1.4) : GRAY;
    const css = `rgb(${r},${g},${b})`;
    if (t) this.chip.set(key, css); // 灰色不缓存，取到色调后自然换色
    return css;
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
      applyXf(project(f.world.px[i]!, f.world.py[i]!, f.cam, f.delta, p, f.world.period), f.xf);
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

    // 小封面
    const p = this.p;
    const n = world.cards.length;
    let cur: { x: number; y: number; s: number } | null = null;
    for (let i = 0; i < n; i++) {
      const left = 1 - mounted[i]!;
      if (left <= 0.02) continue;
      applyXf(project(world.px[i]!, world.py[i]!, cam, delta, p, world.period), f.xf);
      const size = Math.max(3, CARD_WIDTH * p.s);
      const half = size * 0.6 + 4;
      if (p.sx < -half || p.sy < -half || p.sx > cam.vw + half || p.sy > cam.vh + half) continue;
      let a = left * airAlpha(p.u);
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

    // 按歌手：标星团名（6 首以上的歌手）。大星团先占位，和已放的名字重叠的就不写
    // #136：正常缩放下也淡淡写出歌手名（像地图上的地名），一眼知道这一团是谁；拉远时清楚一些
    // #138：位置（上方 / 下方 / 星团中间）和名字的空地在排布时定好；字号比封面放大得慢，放不进空地就缩字
    const labelA = world.mode === 'cluster' ? 0.42 + 0.58 * (1 - smoothstep(0.32, 0.6, cam.zoom)) : 0;
    if (labelA > 0.02) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const taken: number[] = [];
      for (const c of world.clusters) {
        const L = c.label;
        if (!L) continue;
        applyXf(project(L.x, L.y, cam, delta, p, world.period), f.xf);
        if (p.sx < -400 || p.sy < -80 || p.sx > cam.vw + 400 || p.sy > cam.vh + 80) continue;
        let size = labelFontPx(L.font, p.s);
        ctx.font = `600 ${size.toFixed(1)}px Inter, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
        let w = ctx.measureText(c.name).width;
        // 排布时按估算的字宽留的空地；量出来更宽就缩字，保证不出空地、不被封面压住
        const room = L.w * p.s;
        if (w > room) {
          size *= room / w;
          w = room;
          ctx.font = `600 ${size.toFixed(1)}px Inter, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
        }
        const x0 = p.sx - w / 2 - 6;
        const x1 = p.sx + w / 2 + 6;
        const y0 = p.sy - size / 2 - 4;
        const y1 = p.sy + size / 2 + 4;
        let overlap = false;
        for (let k = 0; k < taken.length; k += 4) {
          if (x0 < taken[k + 2]! && x1 > taken[k]! && y0 < taken[k + 3]! && y1 > taken[k + 1]!) {
            overlap = true;
            break;
          }
        }
        if (overlap) continue;
        taken.push(x0, y0, x1, y1);
        let a = labelA * (0.55 + 0.3 * smoothstep(6, 30, c.ids.length));
        if (match) a *= c.ids.some((id) => match.has(id)) ? 1.6 : 0.35;
        // 带一点暗影：缩远时名字边上可能挨着小封面，保证读得清
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = `rgba(240,242,248,${Math.min(1, a).toFixed(3)})`;
        ctx.fillText(c.name, p.sx, p.sy);
        ctx.shadowBlur = 0;
      }
    }
  }
}
