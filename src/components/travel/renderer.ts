import { program, uniforms } from './glCore';

/**
 * 穿行第二版的渲染器（TRAVEL_HANDOFF §9.7）。
 *
 * 两遍：① 背景（径向渐变，色相随颜色旅程，和 #287 同一套颜色）；② 所有小平面——封面、字、光点——
 * 由调用方按离镜头从远到近排好，一次实例化绘制画完。不用深度缓冲，靠从远到近的顺序得到真实的前后遮挡
 * （字从封面后面穿过时被挡住、半透明的封面后面还能隐约看见东西），所以字和封面可以任意穿插。
 *
 * 投影与 #287 完全一致：屏幕 x = vw/2 + (x − camX)·F/dz，屏幕 y = cy + (y − camY)·F/dz（世界 y 向下）。
 */

/** 每个小平面的浮点数个数（实例数据布局见 QUAD_VS 的 attribute） */
export const INST = 24;
export const KIND_COVER = 0;
export const KIND_GLYPH = 1;
export const KIND_LIGHT = 2;
export const KIND_CHIP = 3;
/** 光丝的一小段（句与句之间的那段路） */
export const KIND_STROKE = 4;

const BG_VS = `#version 300 es
precision highp float;
const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
uniform vec2 u_view;
out vec2 v_px;
void main() {
  vec2 p = P[gl_VertexID];
  gl_Position = vec4(p, 0.0, 1.0);
  v_px = vec2((p.x * 0.5 + 0.5) * u_view.x, (0.5 - p.y * 0.5) * u_view.y);
}`;

const BG_FS = `#version 300 es
precision highp float;
uniform vec2 u_center;
uniform float u_rad;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
in vec2 v_px;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float r = length(v_px - u_center) / u_rad;
  vec3 c = r < 0.55 ? mix(u_c0, u_c1, r / 0.55) : mix(u_c1, u_c2, clamp((r - 0.55) / 0.45, 0.0, 1.0));
  // 抖动去色带（暗背景上的大渐变很容易出台阶）
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;

const QUAD_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec3 a_pos;
layout(location = 2) in vec3 a_ax;
layout(location = 3) in vec3 a_ay;
layout(location = 4) in vec4 a_uv;
layout(location = 5) in vec3 a_kla;
layout(location = 6) in vec4 a_A;
layout(location = 7) in vec4 a_B;
uniform vec3 u_cam;
uniform vec2 u_view;
uniform float u_F;
uniform float u_cy;
uniform vec2 u_nf;
out vec2 v_uv;
out vec2 v_local;
flat out vec3 v_kla;
flat out vec4 v_A;
flat out vec4 v_B;
void main() {
  vec3 p = a_pos + a_ax * a_corner.x + a_ay * a_corner.y;
  float dz = p.z - u_cam.z;
  float n = u_nf.x;
  float f = u_nf.y;
  gl_Position = vec4(
    2.0 * u_F * (p.x - u_cam.x) / u_view.x,
    -(2.0 * u_F * (p.y - u_cam.y) + 2.0 * (u_cy - 0.5 * u_view.y) * dz) / u_view.y,
    (f + n) / (f - n) * dz - 2.0 * f * n / (f - n),
    dz);
  vec2 t = a_corner * 0.5 + 0.5;
  v_local = t;
  v_uv = vec2(mix(a_uv.x, a_uv.z, t.x), mix(a_uv.y, a_uv.w, t.y));
  v_kla = a_kla;
  v_A = a_A;
  v_B = a_B;
}`;

const QUAD_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_covers;
uniform sampler2D u_glyphs;
uniform vec2 u_atlas;
uniform vec4 u_sung;
uniform vec4 u_edge;
uniform vec4 u_un;
uniform vec4 u_rest;
uniform vec4 u_ink;
uniform vec4 u_tr;
uniform vec3 u_glow;
in vec2 v_uv;
in vec2 v_local;
flat in vec3 v_kla;
flat in vec4 v_A;
flat in vec4 v_B;
out vec4 o;

float rrect(vec2 q, float r) {
  vec2 d = abs(q) - vec2(1.0 - r);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}
vec4 pm(vec4 c) { return vec4(c.rgb * c.a, c.a); }

void main() {
  int kind = int(v_kla.x + 0.5);
  float alpha = v_kla.z;
  if (kind == 0 || kind == 3) {
    // 封面：圆角（14/172，与卡片同比例）、柔化（降饱和 .78、亮度 .86，同 #287）、字照亮、内侧亮边
    vec2 q = v_local * 2.0 - 1.0;
    float d = rrect(q, 0.163);
    float aa = max(fwidth(d), 1e-4);
    float m = clamp(0.5 - d / aa, 0.0, 1.0);
    if (m <= 0.0) discard;
    vec3 col;
    float ta = 1.0;
    if (kind == 0) {
      vec4 t = texture(u_covers, vec3(v_local, v_kla.y), v_A.y);
      ta = t.a;
      col = t.a > 0.001 ? t.rgb / t.a : vec3(0.0);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 0.78) * 0.86;
    } else {
      col = v_B.rgb;
    }
    col += col * v_A.x * 0.34;
    float rim = clamp(1.0 + d / (aa * 1.6), 0.0, 1.0) * v_A.z;
    col = mix(col, vec3(1.0), rim);
    float a = m * ta * alpha;
    o = vec4(col * a, a);
  } else if (kind == 1) {
    // 字：锐利的字形 + 从更粗 mipmap 层取的柔边（暗晕、发光、迎面飞出时的虚化）
    vec2 tx = v_uv * u_atlas;
    float lod = max(0.0, log2(max(length(dFdx(tx)), length(dFdy(tx)))));
    float sharp = texture(u_glyphs, v_uv).r;
    float soft = textureLod(u_glyphs, v_uv, lod + 2.6).r;
    float blurK = v_B.z;
    float a = mix(sharp, min(1.0, soft * 1.7), blurK);
    int mode = int(v_B.x + 0.5);
    vec4 c;
    if (mode == 1) {
      // 扫光：已唱 → 波前 → 未唱（与 lyric-words.css 同一套渐变，P 已换算成 --P，单位是这个字的宽）
      float x = mix(v_A.z, v_A.w, v_local.x);
      float P = v_A.x;
      float f = max(v_A.y, 1e-3);
      vec4 s = pm(u_sung);
      vec4 e = pm(u_edge);
      vec4 u = pm(u_un);
      vec4 cp = x < P - f ? s : x < P ? mix(s, e, (x - (P - f)) / f) : x < P + f ? mix(e, u, (x - P) / f) : u;
      c = cp;
    } else if (mode == 2) {
      c = pm(u_ink);
    } else if (mode == 3) {
      c = pm(u_tr);
    } else {
      c = pm(u_rest);
    }
    float ga = a * c.a;
    vec3 rgb = c.rgb * a;
    // 中性暗晕：压在亮封面上时把字托出来（同 #287 的 drop-shadow）
    float sh = soft * 0.46 * v_B.w * (1.0 - blurK);
    rgb += vec3(0.016, 0.024, 0.047) * sh * (1.0 - ga);
    float oa = ga + sh * (1.0 - ga);
    // 长音白光、唱完余光：加在字周围
    rgb += u_glow * soft * v_B.y;
    o = vec4(rgb, oa) * alpha;
  } else if (kind == 4) {
    // 光丝：横向高斯，叠加（不遮东西）
    float y = v_local.y * 2.0 - 1.0;
    float g = exp(-y * y * 3.0);
    o = vec4(v_A.rgb * g * alpha, 0.0);
  } else {
    // 光点：柔的高斯圆，叠加（不遮东西）
    vec2 q = v_local * 2.0 - 1.0;
    float g = exp(-dot(q, q) * 3.2);
    o = vec4(v_A.rgb * g * alpha, 0.0);
  }
}`;

export interface Palette {
  sung: number[];
  edge: number[];
  un: number[];
  rest: number[];
  ink: number[];
  tr: number[];
  glow: number[];
}

export class Renderer {
  private bg: WebGLProgram;
  private quad: WebGLProgram;
  private bgU;
  private qU;
  private vao: WebGLVertexArrayObject;
  private bgVao: WebGLVertexArrayObject;
  private inst: WebGLBuffer;
  private corner: WebGLBuffer;
  private cap = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.bg = program(gl, BG_VS, BG_FS);
    this.quad = program(gl, QUAD_VS, QUAD_FS);
    this.bgU = uniforms(gl, this.bg, ['u_view', 'u_center', 'u_rad', 'u_c0', 'u_c1', 'u_c2'] as const);
    this.qU = uniforms(gl, this.quad, [
      'u_cam', 'u_view', 'u_F', 'u_cy', 'u_nf', 'u_covers', 'u_glyphs', 'u_atlas',
      'u_sung', 'u_edge', 'u_un', 'u_rest', 'u_ink', 'u_tr', 'u_glow',
    ] as const);
    const bgVao = gl.createVertexArray();
    const vao = gl.createVertexArray();
    const inst = gl.createBuffer();
    const corner = gl.createBuffer();
    if (!bgVao || !vao || !inst || !corner) throw new Error('gl alloc failed');
    this.bgVao = bgVao;
    this.vao = vao;
    this.inst = inst;
    this.corner = corner;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    const stride = INST * 4;
    const attr = (loc: number, size: number, off: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(1, 3, 0);
    attr(2, 3, 3);
    attr(3, 3, 6);
    attr(4, 4, 9);
    attr(5, 3, 13);
    attr(6, 4, 16);
    attr(7, 4, 20);
    gl.bindVertexArray(null);
  }

  /** 画一帧。data 里前 count 个小平面已按从远到近排好。 */
  draw(o: {
    vw: number;
    vh: number;
    dpr: number;
    cy: number;
    cam: [number, number, number];
    F: number;
    near: number;
    far: number;
    bg: { c0: number[]; c1: number[]; c2: number[]; rad: number };
    pal: Palette;
    covers: WebGLTexture;
    glyphs: WebGLTexture;
    atlas: [number, number];
    data: Float32Array;
    count: number;
  }): void {
    const gl = this.gl;
    const W = Math.max(1, Math.round(o.vw * o.dpr));
    const H = Math.max(1, Math.round(o.vh * o.dpr));
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    // —— 背景 ——
    gl.disable(gl.BLEND);
    gl.useProgram(this.bg);
    gl.bindVertexArray(this.bgVao);
    gl.uniform2f(this.bgU.u_view, o.vw, o.vh);
    gl.uniform2f(this.bgU.u_center, o.vw / 2, o.cy);
    gl.uniform1f(this.bgU.u_rad, o.bg.rad);
    gl.uniform3fv(this.bgU.u_c0, o.bg.c0);
    gl.uniform3fv(this.bgU.u_c1, o.bg.c1);
    gl.uniform3fv(this.bgU.u_c2, o.bg.c2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!o.count) return;
    // —— 小平面：预乘透明度、从远到近 ——
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.quad);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    const bytes = o.count * INST * 4;
    if (bytes > this.cap) {
      this.cap = Math.max(bytes, this.cap * 2, 64 * INST * 4);
      gl.bufferData(gl.ARRAY_BUFFER, this.cap, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, o.data, 0, o.count * INST);
    const u = this.qU;
    gl.uniform3fv(u.u_cam, o.cam);
    gl.uniform2f(u.u_view, o.vw, o.vh);
    gl.uniform1f(u.u_F, o.F);
    gl.uniform1f(u.u_cy, o.cy);
    gl.uniform2f(u.u_nf, o.near, o.far);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, o.covers);
    gl.uniform1i(u.u_covers, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, o.glyphs);
    gl.uniform1i(u.u_glyphs, 1);
    gl.uniform2f(u.u_atlas, o.atlas[0], o.atlas[1]);
    gl.uniform4fv(u.u_sung, o.pal.sung);
    gl.uniform4fv(u.u_edge, o.pal.edge);
    gl.uniform4fv(u.u_un, o.pal.un);
    gl.uniform4fv(u.u_rest, o.pal.rest);
    gl.uniform4fv(u.u_ink, o.pal.ink);
    gl.uniform4fv(u.u_tr, o.pal.tr);
    gl.uniform3fv(u.u_glow, o.pal.glow);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, o.count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.bg);
    gl.deleteProgram(this.quad);
    gl.deleteBuffer(this.inst);
    gl.deleteBuffer(this.corner);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.bgVao);
  }
}
