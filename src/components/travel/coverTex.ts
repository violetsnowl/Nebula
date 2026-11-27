import { thumbOf } from '../../lib/space/thumbs';
import { bigUrl } from './covers';

/**
 * 穿行第二版的封面贴图：一张 256×256 × LAYERS 层的纹理数组，按最近使用分配层。
 * 先用星云已经下好的 72px 缩略图顶上（立刻有图），约 300px 的大图到了再替换。
 *
 * 不卡帧的做法（2026-11-27 实测：一首歌开头几秒要上几十张封面，同步解码 + 整个数组重算 mipmap 会把帧耗时推到 5ms 以上）：
 *   - 图片先用 createImageBitmap 在后台裁成正方形、缩到 256（异步，不占这一帧）；
 *   - 每帧最多上传 2 张，上传 ImageBitmap 很快；
 *   - mipmap 只给这一层单独生成（逐级 blitFramebuffer 缩一半），不碰其他层。
 * 圆角、柔化（降饱和与亮度）、内侧亮边都在着色器里做，这里只放原图。
 */
const SIZE = 256;
const LEVELS = 9;
const LAYERS = 128;
const CONCURRENCY = 6;

interface Entry {
  layer: number;
  used: number;
  /** 0 = 还没图，1 = 缩略图，2 = 大图 */
  q: 0 | 1 | 2;
  /** 缩略图：0 没做，1 做位图中，2 好了 */
  th: 0 | 1 | 2;
  /** 大图：0 没请求，1 下载中，2 好了，3 失败 */
  big: 0 | 1 | 2 | 3;
}

interface Upload {
  url: string;
  bmp: ImageBitmap;
  q: 1 | 2;
}

function squareBitmap(src: CanvasImageSource & { width: number; height: number }): Promise<ImageBitmap> {
  const w = src.width;
  const h = src.height;
  const s = Math.min(w, h);
  return createImageBitmap(src as ImageBitmapSource, (w - s) / 2, (h - s) / 2, s, s, {
    resizeWidth: SIZE,
    resizeHeight: SIZE,
    resizeQuality: 'high',
    premultiplyAlpha: 'premultiply',
  });
}

export class CoverTextures {
  readonly tex: WebGLTexture;
  private map = new Map<string, Entry>();
  private free: number[] = [];
  private owner: (string | null)[] = new Array(LAYERS).fill(null);
  private uploads: Upload[] = [];
  private loading: string[] = [];
  private running = 0;
  private dead = false;
  private readFb: WebGLFramebuffer | null;
  private drawFb: WebGLFramebuffer | null;
  /** 逐层 blit 生成 mipmap 失败过（个别驱动），退回整组 generateMipmap */
  private blitOk = true;
  private blitChecked = false;

  constructor(private gl: WebGL2RenderingContext) {
    const tex = gl.createTexture();
    if (!tex) throw new Error('createTexture failed');
    this.tex = tex;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, LEVELS, gl.RGBA8, SIZE, SIZE, LAYERS);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // 内倾的封面是斜着看的：各向异性过滤让斜面不糊
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number));
    for (let i = LAYERS - 1; i >= 0; i--) this.free.push(i);
    this.readFb = gl.createFramebuffer();
    this.drawFb = gl.createFramebuffer();
  }

  /** 这张封面在纹理数组里的层；还没有图返回 -1（调用方先画占位色）。frame 用来按最近使用淘汰。 */
  layerOf(url: string, frame: number): number {
    let e = this.map.get(url);
    if (!e) {
      e = { layer: -1, used: frame, q: 0, th: 0, big: 0 };
      this.map.set(url, e);
    }
    e.used = frame;
    if (e.q === 0 && e.th === 0) {
      const th = thumbOf(url, 72) as (CanvasImageSource & { width: number; height: number }) | null;
      if (th) {
        e.th = 1;
        const ent = e;
        squareBitmap(th)
          .then((bmp) => {
            ent.th = 2;
            if (this.dead || ent.q >= 1) bmp.close();
            else this.uploads.push({ url, bmp, q: 1 });
          })
          .catch(() => (ent.th = 2));
      }
    }
    if (e.big === 0) {
      e.big = 1;
      this.loading.push(url);
      this.pumpLoads();
    }
    return e.q ? e.layer : -1;
  }

  /** 下大图（后进先出：每帧从远往近请求，最近的最后进队、最先取）。 */
  private pumpLoads(): void {
    while (this.running < CONCURRENCY && this.loading.length) {
      const url = this.loading.pop()!;
      const e = this.map.get(url);
      if (!e || e.big !== 1) continue;
      this.running++;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      const done = (bmp: ImageBitmap | null) => {
        this.running--;
        if (this.dead) {
          bmp?.close();
          return;
        }
        e.big = bmp ? 2 : 3;
        if (bmp) this.uploads.push({ url, bmp, q: 2 });
        this.pumpLoads();
      };
      img.onload = () => {
        squareBitmap(img).then(done, () => done(null));
      };
      img.onerror = () => done(null);
      img.src = bigUrl(url);
    }
  }

  private allocLayer(frame: number): number {
    const f = this.free.pop();
    if (f !== undefined) return f;
    // 没空层：淘汰最久没用、且这两帧没画到的
    let best = -1;
    let bestUsed = Infinity;
    for (const e of this.map.values()) {
      if (e.layer >= 0 && e.used < frame - 2 && e.used < bestUsed) {
        best = e.layer;
        bestUsed = e.used;
      }
    }
    if (best < 0) return -1;
    const old = this.owner[best];
    if (old) {
      const oe = this.map.get(old);
      if (oe) {
        oe.layer = -1;
        oe.q = 0;
        oe.th = 0;
        // 被淘汰的大图下次用到时重新取（浏览器缓存里还有，很快）
        if (oe.big === 2) oe.big = 0;
      }
    }
    return best;
  }

  /** 这一层的 mipmap：逐级缩一半（只动这一层） */
  private mipLayer(layer: number): void {
    const gl = this.gl;
    if (!this.blitOk || !this.readFb || !this.drawFb) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.readFb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.drawFb);
    for (let l = 0; l + 1 < LEVELS; l++) {
      const s = SIZE >> l;
      const s2 = Math.max(1, s >> 1);
      gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.tex, l, layer);
      gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.tex, l + 1, layer);
      gl.blitFramebuffer(0, 0, s, s, 0, 0, s2, s2, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    // 只在第一次检查（getError 会让 CPU 等显卡）
    if (!this.blitChecked) {
      this.blitChecked = true;
      if (gl.getError() !== gl.NO_ERROR) this.blitOk = false;
    }
  }

  /** 每帧调用：上传至多 max 张（大图优先），并生成这些层的 mipmap。 */
  pump(frame: number, max = 2): number {
    if (!this.uploads.length) return 0;
    const gl = this.gl;
    let n = 0;
    // 大图优先（pop 取末尾）
    this.uploads.sort((a, b) => a.q - b.q);
    while (n < max && this.uploads.length) {
      const up = this.uploads.pop()!;
      const e = this.map.get(up.url);
      if (!e || e.q >= up.q) {
        up.bmp.close();
        continue;
      }
      if (e.layer < 0) {
        e.layer = this.allocLayer(frame);
        if (e.layer < 0) {
          up.bmp.close();
          continue;
        }
        this.owner[e.layer] = up.url;
      }
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      try {
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, e.layer, SIZE, SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, up.bmp);
        e.q = up.q;
        this.mipLayer(e.layer);
        n++;
      } catch {
        // 跨域等原因读不了：放弃这张（占位色顶着）
        e.big = 3;
      }
      up.bmp.close();
    }
    if (n && !this.blitOk) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    }
    return n;
  }

  stats(): { layers: number; ready: number; queued: number } {
    let ready = 0;
    for (const e of this.map.values()) if (e.q) ready++;
    return { layers: LAYERS - this.free.length, ready, queued: this.uploads.length + this.loading.length };
  }

  dispose(): void {
    this.dead = true;
    for (const u of this.uploads) u.bmp.close();
    this.gl.deleteTexture(this.tex);
    this.gl.deleteFramebuffer(this.readFb);
    this.gl.deleteFramebuffer(this.drawFb);
    this.map.clear();
    this.uploads = [];
    this.loading = [];
  }
}
