import type { EngineLine, EngineUnit } from '../../lib/listen/model';

/**
 * 穿行第二版的字形贴图（TRAVEL_HANDOFF §9.3「字贴着路」）。
 *
 * 每句歌词在快要看见时按软件现有的歌词字体（`TYPO` 的字体栈、字重、字距）画进一张单通道大贴图：
 * 一个唱的单位（中日韩一个字、拉丁一个词）占一格，格子按阅读顺序排在一条横带里；同时记下每个字母的左右边界，
 * 所以之后在 3D 里可以一个字母一块平面地摆（路径文字：字本身不变形，只沿曲线摆放和转向）。
 * 字的发光、暗晕、迎面飞出时的虚化都在着色器里用更粗的 mipmap 层取，不另画模糊版本。
 *
 * 坐标：排版量都以「主字号的 em」为单位（与世界字号相乘就是世界坐标），贴图位置是纹素。
 */

/** 主字号的光栅尺寸（纹素 / em）：第二步起当前句开唱时屏幕上最大约 76px，乘 1.5 倍屏约 114px。 */
export const R_MAIN = 120;
/** 译文的光栅尺寸；显示时是主字号的 26/72（沿用 #287 的译文比例） */
const R_TR = 50;
export const TR_K = 26 / 72;
const ATLAS_W = 4096;
/** 半条横带的高度（纹素）；主文一行占两条（210 = 1.75em），译文一行占一条（105） */
const HALF = 105;
const HALVES = 30;
export const ATLAS_H = HALF * HALVES;
const LEVELS = 7;
/** 格子两端留白（本字号的 em）：发光与暗晕从更粗的 mipmap 层取，要有地方晕开 */
export const PAD = 0.22;
/** 横带顶到基线（em）；横带底在基线下 0.5em */
export const BASE_Y = 1.25;
export const BAND_EM = 1.75;

export interface GUnit {
  /** 逐字单位；整句 / 译文没有逐字时间时为 null */
  u: EngineUnit | null;
  /** 距一行开头（em，主字号） */
  left: number;
  w: number;
  /** 每个字母的边界（em，相对本单位左端），长度 = 字母数 + 1 */
  edges: number[];
  /** 本单位字形原点（第一个字母左端、横带顶）在贴图里的纹素位置 */
  ax: number;
  ay: number;
  /** 纹素 / em（主字号 em）：主文 = R_MAIN，译文 = R_TR / TR_K */
  px: number;
  /** 本单位所在横带的高度（em，主字号） */
  bandEm: number;
  /** 基线距横带顶（em，主字号） */
  baseEm: number;
}

export interface GLine {
  units: GUnit[];
  /** 主文总宽（em） */
  width: number;
  tr: GUnit[] | null;
  trWidth: number;
  /** 占用的半横带 */
  halves: number[];
}

export interface FontSpec {
  family: string;
  weight: number;
  /** 字距（em） */
  ls: number;
}

const TR_FONT: FontSpec = { family: "Inter,'Segoe UI','Noto Sans SC','Microsoft YaHei',sans-serif", weight: 400, ls: 0.02 };

/** 一句没有逐字时间时，按词 / 字拆成显示单位（只用来排版，不扫光） */
function plainUnits(text: string): Array<{ t: string; sp: boolean }> {
  const out: Array<{ t: string; sp: boolean }> = [];
  const re = /[⺀-鿿가-힯豈-﫿぀-ヿ]|[^\s⺀-鿿가-힯豈-﫿぀-ヿ]+|\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const t = m[0];
    if (/^\s+$/.test(t)) {
      if (out.length) out[out.length - 1]!.sp = true;
      continue;
    }
    out.push({ t, sp: false });
  }
  return out;
}

export class GlyphAtlas {
  readonly tex: WebGLTexture;
  private used: boolean[] = new Array(HALVES).fill(false);
  private ctx: CanvasRenderingContext2D;
  private dirty = false;

  constructor(private gl: WebGL2RenderingContext) {
    const tex = gl.createTexture();
    if (!tex) throw new Error('createTexture failed');
    this.tex = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, LEVELS, gl.R8, ATLAS_W, ATLAS_H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, LEVELS - 1);
    // 清零（新纹理内容未定义）
    const zero = new Uint8Array(ATLAS_W * HALF);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let i = 0; i < HALVES; i++) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, i * HALF, ATLAS_W, HALF, gl.RED, gl.UNSIGNED_BYTE, zero);
    gl.generateMipmap(gl.TEXTURE_2D);
    const mk = (h: number) => {
      const c = document.createElement('canvas');
      c.width = ATLAS_W;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('2d context failed');
      return ctx;
    };
    // 量字用一块小画布；画字用两块与横带同高的画布（显卡加速，画完整块拷进贴图）
    this.ctx = mk(8);
    this.rowPair = mk(HALF * 2);
    this.rowHalf = mk(HALF);
  }

  private rowPair: CanvasRenderingContext2D;
  private rowHalf: CanvasRenderingContext2D;

  get atlasW(): number {
    return ATLAS_W;
  }

  private alloc(pair: boolean): number {
    if (pair) {
      for (let i = 0; i + 1 < HALVES; i += 2) if (!this.used[i] && !this.used[i + 1]) return i;
      return -1;
    }
    // 单条优先用落单的奇数位，不拆整对
    for (let i = 1; i < HALVES; i += 2) if (!this.used[i] && this.used[i - 1]) return i;
    for (let i = 0; i < HALVES; i++) if (!this.used[i]) return i;
    return -1;
  }

  /**
   * 排一句并画进贴图。放不下（同时在看的句子太多）返回 null，调用方这一帧先不画它。
   * font 是主文字体；translation 为空则不排译文。
   */
  /** 最近几次排字的耗时（毫秒）：排版 / 光栅化 / 上传，探针用 */
  readonly timing: Array<[number, number, number]> = [];

  build(line: EngineLine, font: FontSpec, translation: string | null): GLine | null {
    const T0 = performance.now();
    const main = this.layout(line.units ? line.units.map((u) => ({ t: u.t, sp: u.sp, u })) : plainUnits(line.text).map((p) => ({ ...p, u: null })), font, R_MAIN, 1);
    const tr = translation ? this.layout(plainUnits(translation).map((p) => ({ ...p, u: null })), TR_FONT, R_TR, TR_K) : null;
    const halves: number[] = [];
    const release = () => halves.forEach((h) => (this.used[h] = false));
    const place = (lay: Layout, pair: boolean): boolean => {
      // 逐个格子往横带里排，排满一条换下一条
      let row = -1;
      let x = 0;
      const rows: number[] = [];
      for (const c of lay.cells) {
        if (row < 0 || x + c.cw > ATLAS_W) {
          row = this.alloc(pair);
          if (row < 0) return false;
          this.used[row] = true;
          if (pair) this.used[row + 1] = true;
          halves.push(row);
          if (pair) halves.push(row + 1);
          rows.push(row);
          x = 0;
        }
        c.unit.ax = x + PAD * lay.rs;
        c.unit.ay = row * HALF;
        c.row = rows.length - 1;
        x += c.cw;
      }
      lay.rows = rows;
      return true;
    };
    if (!place(main, true) || (tr && !place(tr, false))) {
      release();
      return null;
    }
    const T1 = performance.now();
    this.rasterMs = 0;
    this.uploadMs = 0;
    this.raster(main, font, true);
    if (tr) this.raster(tr, TR_FONT, false);
    this.timing.push([T1 - T0, this.rasterMs, this.uploadMs]);
    if (this.timing.length > 40) this.timing.shift();
    this.dirty = true;
    return { units: main.cells.map((c) => c.unit), width: main.width, tr: tr ? tr.cells.map((c) => c.unit) : null, trWidth: tr?.width ?? 0, halves };
  }

  release(g: GLine): void {
    for (const h of g.halves) this.used[h] = false;
  }

  /** 这一帧有新画的字：重算一次 mipmap（远处的小字、发光与暗晕都靠它） */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  private fontCss(f: FontSpec, rs: number): string {
    return `${f.weight} ${rs}px ${f.family}`;
  }

  /** 量过的宽度（同一首歌里副歌的字、词反复出现；中文走系统后备字体时每次量约 0.3ms） */
  private widths = new Map<string, number>();

  private layout(items: Array<{ t: string; sp: boolean; u: EngineUnit | null }>, font: FontSpec, rs: number, k: number): Layout {
    const ctx = this.ctx;
    const css = this.fontCss(font, rs);
    ctx.font = css;
    ctx.letterSpacing = `${font.ls * rs}px`;
    const key = `${css}|${font.ls}|`;
    const measure = (s: string): number => {
      let w = this.widths.get(key + s);
      if (w === undefined) {
        w = ctx.measureText(s).width;
        if (this.widths.size > 4000) this.widths.clear();
        this.widths.set(key + s, w);
      }
      return w;
    };
    const space = measure(' ') / rs;
    const toEm = k / 1; // 本字号的 em → 主字号的 em
    const cells: Cell[] = [];
    let x = 0;
    for (const it of items) {
      const chars = Array.from(it.t);
      const edges = [0];
      for (let i = 1; i <= chars.length; i++) edges.push((measure(chars.slice(0, i).join('')) / rs) * toEm);
      const w = edges[edges.length - 1]!;
      const unit: GUnit = { u: it.u, left: x, w, edges, ax: 0, ay: 0, px: rs / k, bandEm: ((pairH(k) / rs) * k), baseEm: BASE_Y * k };
      cells.push({ unit, t: it.t, cw: Math.ceil((w / toEm + 2 * PAD) * rs), row: 0 });
      x += w + (it.sp ? space * toEm : 0);
    }
    // 句末多出来的空格不算宽
    const last = items[items.length - 1];
    if (last?.sp) x -= space * toEm;
    return { cells, width: Math.max(0, x), rs, rows: [] };
  }

  private rasterMs = 0;
  private uploadMs = 0;

  /**
   * 光栅化一行：在显卡上的 2D 画布里黑底白字画好，整块直接拷进贴图的红通道（白字在黑底上，红通道就是字形覆盖率）。
   * 不再 getImageData 读回内存：那一步每句要 3–10ms，会在新句子出现时掉一帧（2026-11-27 实测）。
   * 一行占满整条横带宽，横带只属于这一句，所以整条覆盖没问题；主文两条半带、译文一条，各用一块同高的画布。
   */
  private raster(lay: Layout, font: FontSpec, pair: boolean): void {
    const gl = this.gl;
    const ctx = pair ? this.rowPair : this.rowHalf;
    const h = pair ? HALF * 2 : HALF;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    for (let r = 0; r < lay.rows.length; r++) {
      const cells = lay.cells.filter((c) => c.row === r);
      if (!cells.length) continue;
      const ta = performance.now();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, ATLAS_W, h);
      ctx.font = this.fontCss(font, lay.rs);
      ctx.letterSpacing = `${font.ls * lay.rs}px`;
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'alphabetic';
      for (const c of cells) ctx.fillText(c.t, c.unit.ax, BASE_Y * lay.rs);
      const tb = performance.now();
      this.rasterMs += tb - ta;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, cells[0]!.unit.ay, gl.RED, gl.UNSIGNED_BYTE, ctx.canvas);
      this.uploadMs += performance.now() - tb;
    }
  }

  dispose(): void {
    this.gl.deleteTexture(this.tex);
  }
}

/** 一行字所在横带的高度（纹素）：主文两条半带，译文一条 */
function pairH(k: number): number {
  return k === 1 ? HALF * 2 : HALF;
}

interface Cell {
  unit: GUnit;
  t: string;
  /** 格子宽（纹素） */
  cw: number;
  row: number;
}

interface Layout {
  cells: Cell[];
  width: number;
  rs: number;
  rows: number[];
}
