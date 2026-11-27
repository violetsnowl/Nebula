/**
 * 主舞台（版面 / 漫游歌词 / 底部字幕）↔ 听音空间的一镜到底转场引擎。
 *
 * 设计要点：
 * 1. 统一接管权判定（isPageStageActive）：版面模式只在真正进入聆听态（k > 0.5）时由 LyricPage 接管转场；
 *    漫游模式及版面模式的漫游态（k ≤ 0.5）一律由 LyricsLayer 接管，两边天然互斥，不重复起飞、不闪隐藏版面。
 * 2. 克隆保真：剥离歌词栏作用域外的注释节点（.ly-rb 假名注音 / 罗马音 / 翻译 / 和声），
 *    同时把非扫光句（已唱句 .is-past、待唱句、整句歌词 .ly-whole/.fl-whole）的计算后实色写入克隆，杜绝脱离 .lc-root 后闪白。
 * 3. 歌词栏对齐：按去掉 .ly-rb 假名注音后的纯正文匹配（WeakMap 缓存），等歌词栏标出 .is-cur 后立即配对可见句，与大封面同步起飞（600ms easeStd）。
 */

/** 一个字（或整句单元）在一端的快照与排版环境。 */
export interface FlySide {
  el: HTMLElement;
  /** 克隆外层环境类名：版面 lpm-b、歌词栏 lpm-c、漫游/字幕 lpm-r，以及 is-grad 等状态类。 */
  ctx: string;
  /** 倾斜角（度）。 */
  rot: number;
  /** 是否竖排。 */
  vert: boolean;
  /** 终点所在句子的透明度宿主（歌词栏按景深写、漫游按氛围写）：落地前收敛到它。 */
  opEl?: HTMLElement;
  /** 显式指定的终点收敛透明度（如底部字幕由 --cap-o 控制时直接传入，不依赖 DOM transition）。 */
  endOpacity?: number;
  /** 混合模式（歌词栏非当前句用 plus-lighter 透出环境色）。 */
  blend?: string;
  /** 起点克隆的基础不透明度（漫游氛围句约 0.5，版面/聆听默认 1）。 */
  opacity?: number;
  /** 看上去的位置和盒子的差（屏幕像素）与两个方向的压扁：版面「断层」错开的那半、「回声滚筒」上的行。 */
  adj?: () => { dx: number; dy: number; sx: number; sy: number } | null;
  /**
   * 版面「色场」页：这个字有一部分落在色块里，色块里的真字是深墨（色块那份副本）。替身另叠一份深墨克隆、按色块边线裁剪，
   * 和真字一致（2026-11-26：原来替身是原文的浅色，落地换真字时才变深）。field = 色块元素；color = --lp-field-ink 的值。
   */
  ink?: { field: HTMLElement; vert: boolean; color: string };
}

export interface FlyPair {
  from: FlySide;
  /** 终点：打开听音空间时初始可为 null，由 retarget 在歌词栏就绪后补上。 */
  to: FlySide | null;
}

interface FlyPlace {
  x: number;
  y: number;
  f: number;
  rot: number;
  /** 两个方向的压扁（滚筒），平常是 1。 */
  sx: number;
  sy: number;
}

interface Live {
  p: FlyPair;
  a: HTMLElement;
  ac: HTMLElement;
  b: HTMLElement | null;
  bc: HTMLElement | null;
  fsA: number;
  fsB: number;
  aw: number;
  ah: number;
  bw: number;
  bh: number;
  /** 起点：中心坐标、视觉字号、旋转角。 */
  s: FlyPlace;
  /** 最近一次量到的终点位置。 */
  t: FlyPlace | null;
  /** 接上终点时的飞行进度与起点当时透明度，晚接上的字从当前进度平滑飞完，不跳变。 */
  e0: number;
  a0: number;
  /** 起点基础透明度。 */
  sOp: number;
  /** 色场页那一侧的深墨克隆（起点 / 终点各自可有）。 */
  ai?: InkClone;
  bi?: InkClone;
}

interface InkClone {
  wrap: HTMLElement;
  clone: HTMLElement;
  ctx: HTMLElement;
  side: FlySide;
}

/** 色场页的深墨克隆：同一侧的类名与字体，外层加 lpm-field（配色见 lyric-page-tpl-b.css），裁剪每帧按色块边线写。 */
function makeInk(layer: HTMLElement, side: FlySide, fs: number): InkClone | undefined {
  if (!side.ink) return undefined;
  const ctx = document.createElement('div');
  ctx.className = `lpm-ctx ${side.ctx} lpm-field`;
  ctx.style.setProperty('--lp-field-ink', side.ink.color);
  const wrap = document.createElement('span');
  wrap.className = side.vert ? 'lpm-u is-v' : 'lpm-u';
  const clone = cleanClone(side.el.cloneNode(true) as HTMLElement);
  wrap.appendChild(clone);
  ctx.appendChild(wrap);
  layer.appendChild(ctx);
  copyTypeAndColor(wrap, side.el, side.ctx);
  wrap.style.fontSize = `${fs}px`;
  fitWholeCloneBox(wrap, side.el);
  return { wrap, clone, ctx, side };
}

/** 深墨克隆跟着它那一侧：同步逐帧状态、透明度、变换，裁成色块那一边（坐标相对替身层，替身层铺满视口）。 */
function stepInk(ink: InkClone | undefined, edge: number | undefined, opacity: string, lw: string, transform: string): void {
  if (!ink || edge === undefined) return;
  syncUnitClone(ink.side.el, ink.clone);
  ink.ctx.style.opacity = opacity;
  ink.ctx.style.setProperty('--lw', lw);
  const e = edge.toFixed(2);
  ink.ctx.style.clipPath = ink.side.ink!.vert
    ? `polygon(-9999px ${e}px, 99999px ${e}px, 99999px 99999px, -9999px 99999px)`
    : `polygon(${e}px -9999px, 99999px -9999px, 99999px 99999px, ${e}px 99999px)`;
  ink.wrap.style.transform = transform;
}

const fsOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).fontSize) || 16;
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** cubic-bezier(0.2, 0, 0, 1)：与 ListenSpace 大封面 / 遮罩保持同曲线同步起飞。 */
export function easeStd(x: number): number {
  let lo = 0;
  let hi = 1;
  let m = x;
  for (let i = 0; i < 22; i++) {
    m = (lo + hi) / 2;
    const bx = 3 * (1 - m) * (1 - m) * m * 0.2 + m * m * m;
    if (bx < x) lo = m;
    else hi = m;
  }
  return 3 * (1 - m) * m * m + m * m * m;
}

/** 版面模式只有在真正进入聆听态（k > 0.5）时才接管舞台；漫游态仍归 LyricsLayer。 */
export function isPageStageActive(pageMode: boolean, listenEnabled: boolean, listenK: number): boolean {
  return pageMode && listenEnabled && listenK > 0.5;
}

export const normLyricText = (s: string): string => s.replace(/\s+/g, '');

/** 把原元素的行内样式与类名（含拆字子节点）同步到克隆节点。 */
export function syncUnitClone(from: HTMLElement, to: HTMLElement): void {
  if (to.style.cssText !== from.style.cssText) to.style.cssText = from.style.cssText;
  if (to.className !== from.className) to.className = from.className;
  const fc = from.children;
  const tc = to.children;
  for (let i = 0; i < fc.length && i < tc.length; i++) {
    syncUnitClone(fc[i] as HTMLElement, tc[i] as HTMLElement);
  }
}

/** 剥离歌词栏内部的注音/翻译/和声子节点，防止替身挂在 body 上时脱离 .lc-root 作用域而露出假名。 */
function cleanClone(el: HTMLElement): HTMLElement {
  el.querySelectorAll('.ly-rb, .ly-ro, .ly-tr, .ly-bg').forEach((n) => n.remove());
  return el;
}

/** 整句替身若来自可自动折行的宿主（如窄栏长整句），让替身外框沿用相同换行宽度。 */
function fitWholeCloneBox(wrapper: HTMLElement, src: HTMLElement): void {
  if (
    !src.classList.contains('ly-whole') &&
    !src.classList.contains('lp-whole') &&
    !src.classList.contains('fl-whole')
  ) {
    return;
  }
  const cs = getComputedStyle(src);
  if (cs.whiteSpace !== 'nowrap' && cs.whiteSpace !== 'pre' && src.offsetWidth > 0) {
    wrapper.style.whiteSpace = cs.whiteSpace;
    wrapper.style.width = `${Math.ceil(src.offsetWidth) + 1}px`;
  }
}

/** 复制原字的计算后排版属性与颜色状态（含非扫光句 .is-past / 整句节点的精确实色）。 */
function copyTypeAndColor(to: HTMLElement, from: HTMLElement, ctxClass: string): void {
  const cs = getComputedStyle(from);
  to.style.fontFamily = cs.fontFamily;
  to.style.fontWeight = cs.fontWeight;
  to.style.fontStyle = cs.fontStyle;
  to.style.letterSpacing = cs.letterSpacing;
  to.style.lineHeight = cs.lineHeight;
  to.style.textTransform = cs.textTransform;
  const toProp = cs.getPropertyValue('text-orientation');
  if (toProp) to.style.setProperty('text-orientation', toProp);
  for (const v of ['--lc-rest', '--lp-ink', '--lc-a', '--lp-pc', '--sung', '--edge', '--un']) {
    const val = cs.getPropertyValue(v);
    if (val) to.style.setProperty(v, val);
  }
  const isWhole =
    from.classList.contains('fl-whole') ||
    from.classList.contains('ly-whole') ||
    from.classList.contains('lp-whole');
  const isGrad = /\bis-grad\b/.test(ctxClass) && !isWhole;
  if (!isGrad && cs.color && cs.color !== 'rgba(0, 0, 0, 0)' && cs.color !== 'transparent') {
    to.style.setProperty('--lc-rest', cs.color);
  }
}

/** 量取单元扣除自身波浪浮起 / 长音缩放后的静止盒子中心与视觉字号。 */
function placeOf(
  el: HTMLElement,
  side: FlySide,
  w: number,
  h: number,
  fs: number,
): FlyPlace | null {
  const r = el.getBoundingClientRect();
  if (!(r.width > 0)) return null;
  const adj = side.adj?.() ?? null;
  const qx = adj?.sx ?? 1;
  const qy = adj?.sy ?? 1;
  const th = (side.rot * Math.PI) / 180;
  const cos = Math.abs(Math.cos(th));
  const sin = Math.abs(Math.sin(th));
  const vs = (r.width + r.height) / ((w * qx + h * qy) * (cos + sin) || 1);
  let dx = 0;
  let dy = 0;
  let sc = 1;
  const mayShift = side.ctx.includes('is-grad') || el.classList.contains('fl-whole') || el.classList.contains('ly-whole');
  const tf = mayShift ? getComputedStyle(el).transform : '';
  if (tf && tf !== 'none') {
    const m = new DOMMatrixReadOnly(tf);
    sc = Math.hypot(m.a, m.b) || 1;
    const oy = side.vert ? 0.5 : 0.85;
    const lx = m.e;
    const ly = m.f + (0.5 - oy) * h * (sc - 1);
    dx = (lx * Math.cos(th) - ly * Math.sin(th)) * (vs / sc);
    dy = (lx * Math.sin(th) + ly * Math.cos(th)) * (vs / sc);
  }
  return {
    x: r.left + r.width / 2 - dx * qx + (adj?.dx ?? 0),
    y: r.top + r.height / 2 - dy * qy + (adj?.dy ?? 0),
    f: fs * (vs / sc),
    rot: side.rot,
    sx: qx,
    sy: qy,
  };
}

export class LsFly {
  private layer: HTMLElement;
  private lives: Live[] = [];
  private t0 = performance.now();
  private hidden: HTMLElement[] = [];
  done = false;
  readonly cost: number[] = [];

  get progress(): number {
    return Math.min(1, (performance.now() - this.t0) / this.dur);
  }

  constructor(
    pairs: FlyPair[],
    private retarget: (p: FlyPair, k: number) => FlySide | null,
    private dur: number,
    private hide: (els: HTMLElement[], on: boolean) => void = hideFlyElements,
    private easeFn: (t: number) => number = ease,
  ) {
    this.dur *= (window as unknown as { __nebulaFlySlow?: number }).__nebulaFlySlow || 1;
    this.layer = document.createElement('div');
    this.layer.className = 'lp-morph lp-lsfly lw';
    this.layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.layer);

    for (const p of pairs) {
      const a = document.createElement('span');
      a.className = p.from.vert ? 'lpm-u is-v' : 'lpm-u';
      const ctxA = document.createElement('div');
      ctxA.className = `lpm-ctx ${p.from.ctx}`;
      const ac = cleanClone(p.from.el.cloneNode(true) as HTMLElement);
      a.appendChild(ac);
      ctxA.appendChild(a);
      this.layer.appendChild(ctxA);
      copyTypeAndColor(a, p.from.el, p.from.ctx);
      const fsA = fsOf(p.from.el);
      a.style.fontSize = `${fsA}px`;
      fitWholeCloneBox(a, p.from.el);
      const ra = a.getBoundingClientRect();
      const aw = ra.width || 1;
      const ah = ra.height || 1;
      const measured = placeOf(p.from.el, p.from, aw, ah, fsA);
      if (!measured) {
        // 起点不可测量（被 display:none 等隐藏）的单元直接丢弃，绝不塞到屏幕正中心制造假飞行
        ctxA.remove();
        continue;
      }
      const live: Live = {
        p,
        a,
        ac,
        b: null,
        bc: null,
        fsA,
        fsB: fsA,
        aw,
        ah,
        bw: 1,
        bh: 1,
        s: measured,
        t: null,
        e0: 0,
        a0: 1,
        sOp: p.from.opacity ?? 1,
      };
      live.ai = makeInk(this.layer, p.from, fsA);
      this.lives.push(live);
      this.hidden.push(p.from.el);
    }
    if (!this.lives.length) {
      this.done = true;
      this.layer.remove();
      return;
    }
    this.hide(this.hidden, true);
  }

  private attach(l: Live, to: FlySide): void {
    l.p.to = to;
    const b = document.createElement('span');
    b.className = to.vert ? 'lpm-u is-v' : 'lpm-u';
    const ctxB = document.createElement('div');
    ctxB.className = `lpm-ctx ${to.ctx}`;
    if (to.blend) ctxB.style.mixBlendMode = to.blend;
    const bc = cleanClone(to.el.cloneNode(true) as HTMLElement);
    b.appendChild(bc);
    ctxB.appendChild(b);
    this.layer.appendChild(ctxB);
    copyTypeAndColor(b, to.el, to.ctx);
    l.fsB = fsOf(to.el);
    b.style.fontSize = `${l.fsB}px`;
    fitWholeCloneBox(b, to.el);
    const rb = b.getBoundingClientRect();
    l.b = b;
    l.bc = bc;
    l.bw = rb.width || 1;
    l.bh = rb.height || 1;
    l.bi = makeInk(this.layer, to, l.fsB);
    this.hidden.push(to.el);
    this.hide([to.el], true);
  }

  step(now: number): boolean {
    if (this.done) return true;
    const k = Math.min(1, (now - this.t0) / this.dur);
    const c0 = performance.now();
    this.render(k);
    this.cost.push(performance.now() - c0);
    (window as unknown as { __nebulaFlyCost?: number[] }).__nebulaFlyCost = this.cost;
    if (k >= 1) this.end();
    return this.done;
  }

  render(k: number): void {
    if (this.done) return;
    const e = this.easeFn(k);
    const lwA = (1 - smooth(e / 0.2)).toFixed(3);
    const waitOp = 1 - smooth(k / 0.55);
    const opCache = new Map<HTMLElement, number>();
    // 第一遍集中补找终点并挂载
    for (const l of this.lives) {
      if (!l.b) {
        const to = l.p.to ?? this.retarget(l.p, k);
        if (to) {
          this.attach(l, to);
          l.e0 = e < 0.999 ? e : 0;
          l.a0 = (k > 0.08 ? waitOp : 1) * l.sOp;
        }
      }
    }
    // 第二遍集中测量终点位置与整句透明度，避免读写交错重排
    for (const l of this.lives) {
      if (!l.b || !l.p.to) continue;
      const m = placeOf(l.p.to.el, l.p.to, l.bw, l.bh, l.fsB);
      if (m) l.t = m;
      const oe = l.p.to.opEl;
      if (oe && l.p.to.endOpacity === undefined && !opCache.has(oe)) {
        opCache.set(oe, parseFloat(getComputedStyle(oe).opacity));
      }
    }
    // 色场页的色块边线（集中读）：横排左缘、竖排上缘，相对替身层
    const lb = this.layer.getBoundingClientRect();
    const edges = new Map<HTMLElement, number>();
    for (const l of this.lives) for (const ink of [l.ai, l.bi]) {
      const fe = ink?.side.ink?.field;
      if (fe && !edges.has(fe)) {
        const fr = fe.getBoundingClientRect();
        edges.set(fe, ink!.side.ink!.vert ? fr.top - lb.top : fr.left - lb.left);
      }
    }
    // 第三遍集中写样式
    for (const l of this.lives) {
      const le = l.b ? Math.min(1, Math.max(0, (e - l.e0) / Math.max(0.001, 1 - l.e0))) : 0;
      const lq = smooth((le - 0.2) / 0.6);
      syncUnitClone(l.p.from.el, l.ac);
      const ctxA = l.a.parentElement!;
      ctxA.style.opacity = l.b ? (l.a0 * (1 - lq)).toFixed(3) : (waitOp * l.sOp).toFixed(3);
      ctxA.style.setProperty('--lw', lwA);
      let T = l.t;
      if (l.b && l.bc && l.p.to) {
        syncUnitClone(l.p.to.el, l.bc);
        const ctxB = l.b.parentElement!;
        const op = l.p.to.endOpacity ?? (l.p.to.opEl ? (opCache.get(l.p.to.opEl) ?? 1) : 1);
        const opK = Number.isNaN(op) ? 1 : 1 + (op - 1) * smooth((le - 0.7) / 0.3);
        ctxB.style.opacity = (lq * opK).toFixed(3);
        ctxB.style.setProperty('--lw', smooth((le - 0.8) / 0.2).toFixed(3));
        T = l.t;
      }
      const S = l.s;
      const to = T ?? S;
      const x = S.x + (to.x - S.x) * le;
      const y = S.y + (to.y - S.y) * le;
      const f = S.f + (to.f - S.f) * le;
      const rot = S.rot + (to.rot - S.rot) * le;
      const qx = S.sx + (to.sx - S.sx) * le;
      const qy = S.sy + (to.sy - S.sy) * le;
      const sA = f / l.fsA;
      l.a.style.transform = `translate(${(x - l.aw / 2).toFixed(3)}px, ${(y - l.ah / 2).toFixed(3)}px) scale(${(sA * qx).toFixed(5)}, ${(sA * qy).toFixed(5)}) rotate(${rot.toFixed(3)}deg)`;
      if (l.ai) stepInk(l.ai, edges.get(l.ai.side.ink!.field), ctxA.style.opacity, lwA, l.a.style.transform);
      if (l.b) {
        const sB = f / l.fsB;
        l.b.style.transform = `translate(${(x - l.bw / 2).toFixed(3)}px, ${(y - l.bh / 2).toFixed(3)}px) scale(${(sB * qx).toFixed(5)}, ${(sB * qy).toFixed(5)}) rotate(${rot.toFixed(3)}deg)`;
        const ctxB = l.b.parentElement!;
        if (l.bi) stepInk(l.bi, edges.get(l.bi.side.ink!.field), ctxB.style.opacity, ctxB.style.getPropertyValue('--lw'), l.b.style.transform);
      }
    }
  }

  /** 外部平滑淡出替身层（例如穿行 WebGL2 落地最后 20% 与着色器字形交叉淡化，不改变定位测量）。 */
  setLayerOpacity(op: number): void {
    if (this.done) return;
    const v = op <= 0.001 ? '0' : op >= 0.999 ? '1' : op.toFixed(3);
    if (this.layer.style.opacity !== v) this.layer.style.opacity = v;
  }

  /** 起点真实坐标列表（QA 用：验证底部字幕 / 漫游句从真实位置起飞，而非屏幕中心兜底）。 */
  starts(): Array<{ x: number; y: number; f: number; rot: number }> {
    return this.lives.map((l) => ({ ...l.s }));
  }

  /** 已接上终点的目标单元列表（QA 用：检查是否飞出歌词栏可视区）。 */
  targets(): HTMLElement[] {
    return this.lives.filter((l) => l.p.to).map((l) => l.p.to!.el);
  }

  /** 终点克隆与终点真字的中心像素偏差（QA 用）。 */
  probe(): number[][] {
    return this.lives
      .filter((l) => l.bc && l.p.to)
      .map((l) => {
        const a = l.bc!.getBoundingClientRect();
        const b = l.p.to!.el.getBoundingClientRect();
        const o = l.p.to!.adj?.() ?? null;
        return [a.left + a.width / 2 - (b.left + b.width / 2) - (o?.dx ?? 0), a.top + a.height / 2 - (b.top + b.height / 2) - (o?.dy ?? 0)].map(
          (v) => Math.round(v * 100) / 100,
        );
      });
  }

  end(): void {
    if (this.done) return;
    this.done = true;
    this.layer.remove();
    this.hide(this.hidden, false);
  }
}

export function hideFlyElements(els: HTMLElement[], on: boolean): void {
  for (const el of els) el.toggleAttribute('data-flyhide', on);
}

const plainMainCache = new WeakMap<HTMLElement, string>();

/** 提取听音空间歌词栏一句的纯正文（跳过 .ly-rb 日语假名注音文本节点，按 WeakMap 缓存）。 */
export function plainColumnText(colLine: HTMLElement): string {
  const main = colLine.querySelector<HTMLElement>('.ly-main');
  if (!main) return '';
  const hit = plainMainCache.get(main);
  if (hit !== undefined) return hit;
  let s = '';
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n.parentElement?.closest('.ly-rb')) continue;
    s += n.nodeValue ?? '';
  }
  const out = normLyricText(s);
  plainMainCache.set(main, out);
  return out;
}

export function queryColumnLines(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.ls-col .ly-line:not(.is-gapline)')];
}

export function columnUnitsOf(colLine: HTMLElement | null): HTMLElement[] {
  return colLine ? [...colLine.querySelectorAll<HTMLElement>(':scope > .ly-main > .u, :scope > .ly-main.ly-whole')] : [];
}

export function columnSideOf(colLine: HTMLElement, unitEl: HTMLElement): FlySide {
  return {
    el: unitEl,
    ctx: `lpm-c${colLine.classList.contains('is-grad') ? ' is-grad' : ''}`,
    rot: 0,
    vert: false,
    opEl: colLine,
    blend: colLine.classList.contains('is-cur') ? undefined : 'plus-lighter',
  };
}

/** 歌词栏一句是否至少 3/4 高度落在 .ls-col 可视范围内（不按刚打开时的淡入透明度误筛）。 */
export function isColumnLineVisible(colLine: HTMLElement, box?: DOMRect | null): boolean {
  const b = box ?? document.querySelector('.ls-col')?.getBoundingClientRect();
  const r = colLine.getBoundingClientRect();
  if (!b || !(r.height > 0)) return false;
  const vis = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
  return vis >= r.height * 0.75;
}

export interface ColumnMatchQuery {
  text: string;
  /** 相对当前句的行偏移（0 = 当前句，1 = 下一句，-1 = 上一句）。 */
  offsetFromCur: number;
}

/**
 * 在听音空间歌词栏中为一组舞台句子匹配可见的目标行（公共子集规则）。
 * 等歌词栏标出 .is-cur 后再匹配；按当前句偏移优先查找前后两句，偏移不准（如过滤了署名行）时按最近可见同文行兜底，每行只配一次。
 */
export function matchColumnLines(queries: ColumnMatchQuery[]): (HTMLElement | null)[] {
  const cols = queryColumnLines();
  if (!cols.length || !cols.some((c) => c.classList.contains('is-cur'))) {
    return queries.map(() => null);
  }
  const texts = cols.map(plainColumnText);
  const box = document.querySelector('.ls-col')?.getBoundingClientRect() ?? null;
  const visCache = new Map<number, boolean>();
  const visAt = (j: number): boolean => {
    let v = visCache.get(j);
    if (v === undefined) {
      v = isColumnLineVisible(cols[j]!, box);
      visCache.set(j, v);
    }
    return v;
  };
  const curC = Math.max(0, cols.findIndex((c) => c.classList.contains('is-cur')));
  const used = new Set<number>();
  return queries.map((q) => {
    const want = normLyricText(q.text);
    if (!want) return null;
    const guess = curC + q.offsetFromCur;
    const near: number[] = [];
    if (guess >= 0 && guess < texts.length) near.push(guess);
    for (let d = 1; d <= 2; d++) {
      if (guess - d >= 0) near.push(guess - d);
      if (guess + d < texts.length) near.push(guess + d);
    }
    let best = -1;
    for (const j of near) {
      if (!used.has(j) && visAt(j) && texts[j] === want) {
        best = j;
        break;
      }
    }
    if (best < 0) {
      let dist = Infinity;
      for (let j = 0; j < texts.length; j++) {
        if (used.has(j) || texts[j] !== want || !visAt(j)) continue;
        const d = Math.abs(j - guess);
        if (d < dist) {
          dist = d;
          best = j;
        }
      }
    }
    if (best >= 0) used.add(best);
    return best >= 0 ? cols[best]! : null;
  });
}

export interface StageOutLine {
  text: string;
  offsetFromCur: number;
  units: HTMLElement[];
  sideOf: (el: HTMLElement) => FlySide;
}

/**
 * 启动「舞台 → 听音空间歌词栏」的飞行实例：
 * 与大封面同步立即起飞（600ms easeStd），不再额外等待或重计时。
 */
export function launchStageToListenFly(
  lines: StageOutLine[],
  opts?: { flightMs?: number; onMatchChange?: (matched: number, total: number, progress: number) => void },
): LsFly | null {
  if (!lines.length) return null;
  const flightMs = opts?.flightMs ?? 600;
  interface IndexedPair extends FlyPair {
    li: number;
    ui: number;
  }
  const pairs: IndexedPair[] = [];
  lines.forEach((line, li) => {
    line.units.forEach((el, ui) => {
      pairs.push({ from: line.sideOf(el), to: null, li, ui });
    });
  });
  if (!pairs.length) return null;
  const queries: ColumnMatchQuery[] = lines.map((l) => ({ text: l.text, offsetFromCur: l.offsetFromCur }));
  let cols: (HTMLElement | null)[] = lines.map(() => null);
  let colsAt = -1;
  let fly: LsFly | null = null;
  fly = new LsFly(
    pairs,
    (p, k) => {
      const q = p as IndexedPair;
      if (k < 0.999 && k > 0.6) return null;
      const now = performance.now();
      if (now - colsAt > 8) {
        colsAt = now;
        const before = cols.filter(Boolean).length;
        cols = matchColumnLines(queries);
        const after = cols.filter(Boolean).length;
        if (after !== before) opts?.onMatchChange?.(after, lines.length, fly?.progress ?? 0);
      }
      const col = cols[q.li] ?? null;
      const us = columnUnitsOf(col);
      if (!col || us.length !== lines[q.li]!.units.length) return null;
      return columnSideOf(col, us[q.ui]!);
    },
    flightMs,
    hideFlyElements,
    easeStd,
  );
  if (fly.done) return null;
  return fly;
}
