import { thumbOf } from '../../lib/space/thumbs';
import { bigUrl } from './covers';

/**
 * 穿行第二版的封面贴图：一张 256×256 × LAYERS 层的纹理数组，按最近使用分配层。
 * 先用星云已经下好的 72px 缩略图顶上（立刻有图），约 300px 的大图到了再替换。
 * 每帧只上传有限几张（pump 的预算），上传过的那一帧统一重算一次 mipmap（远处的小封面不闪）。
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
  /** 大图：0 没请求，1 下载中，2 好了，3 失败 */
  big: 0 | 1 | 2 | 3;
}

interface Upload {
  url: string;
  src: CanvasImageSource & { width: number; height: number };
  q: 1 | 2;
}

export class CoverTextures {
  readonly tex: WebGLTexture;
  private map = new Map<string, Entry>();
  private free: number[] = [];
  private owner: (string | null)[] = new Array(LAYERS).fill(null);
  private uploads: Upload[] = [];
  private loading: string[] = [];
  private running = 0;
  private scratch: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private dead = false;

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
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2d context failed');
    ctx.imageSmoothingQuality = 'high';
    this.scratch = c;
    this.sctx = ctx;
  }

  /** 这张封面在纹理数组里的层；还没有图返回 -1（调用方先画占位色）。frame 用来按最近使用淘汰。 */
  layerOf(url: string, frame: number): number {
    let e = this.map.get(url);
    if (!e) {
      e = { layer: -1, used: frame, q: 0, big: 0 };
      this.map.set(url, e);
    }
    e.used = frame;
    if (e.q === 0) {
      const th = thumbOf(url, 72) as (CanvasImageSource & { width: number; height: number }) | null;
      if (th && !this.uploads.some((u) => u.url === url)) this.uploads.push({ url, src: th, q: 1 });
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
      const done = (ok: boolean) => {
        this.running--;
        if (this.dead) return;
        e.big = ok ? 2 : 3;
        if (ok) this.uploads.push({ url, src: img, q: 2 });
        this.pumpLoads();
      };
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.src = bigUrl(url);
    }
  }

  private allocLayer(frame: number): number {
    const f = this.free.pop();
    if (f !== undefined) return f;
    // 没空层：淘汰最久没用、且这两帧没画到的
    let best = -1;
    let bestUsed = Infinity;
    for (const [url, e] of this.map) {
      if (e.layer >= 0 && e.used < frame - 2 && e.used < bestUsed) {
        best = e.layer;
        bestUsed = e.used;
        void url;
      }
    }
    if (best < 0) return -1;
    const old = this.owner[best];
    if (old) {
      const oe = this.map.get(old);
      if (oe) {
        oe.layer = -1;
        oe.q = 0;
      }
    }
    return best;
  }

  /** 每帧调用：上传至多 max 张（大图优先、离镜头近的后请求先上），有上传就重算 mipmap。 */
  pump(frame: number, max = 3): number {
    if (!this.uploads.length) return 0;
    const gl = this.gl;
    let n = 0;
    // 大图优先
    this.uploads.sort((a, b) => a.q - b.q);
    while (n < max && this.uploads.length) {
      const up = this.uploads.pop()!;
      const e = this.map.get(up.url);
      if (!e || e.q >= up.q) continue;
      if (e.layer < 0) {
        e.layer = this.allocLayer(frame);
        if (e.layer < 0) continue;
        this.owner[e.layer] = up.url;
      }
      const { width: w, height: h } = up.src;
      if (!w || !h) continue;
      // 不是正方形的图居中裁成正方形
      const s = Math.min(w, h);
      this.sctx.clearRect(0, 0, SIZE, SIZE);
      this.sctx.drawImage(up.src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, SIZE, SIZE);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, e.layer, SIZE, SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.scratch);
        e.q = up.q;
        n++;
      } catch {
        // 跨域等原因读不了：放弃这张（占位色顶着）
        e.big = 3;
      }
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }
    if (n) {
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
    this.gl.deleteTexture(this.tex);
    this.map.clear();
    this.uploads = [];
    this.loading = [];
  }
}
