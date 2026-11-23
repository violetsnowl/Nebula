import { syncClone } from './kit';

/**
 * 版面 ↔ 听音空间的一镜到底（2026-11-22 用户要求）：常驻聆听时在版面上点开听音空间，版面这一页上的句子
 * 逐字飞到听音空间歌词栏里对应的字上；收起时反过来飞回版面。和漫游 → 版面的「克隆替身」同一个办法：
 *   每个字两份克隆——起点那份（原样复制起点的字）、终点那份（原样复制终点的字）——沿同一条路线飞（中心、视觉字号、倾斜插值），
 *   途中 .2 → .8 交叉渐变；终点那份按终点真字没浮起时的盒子落位，飞完和真字重合，直接换成真字。
 * 起点在起飞那一刻量好（起点那一层接着就淡出了），终点每帧重新量（歌词栏在弹簧滚动、版面在升起）。
 * 替身层挂在 body 上、在所有层之上（听音空间没有自己的层叠上下文）。飞行期间起点、终点两边的真字都藏起来。
 */

/** 一个字在一边的样子：元素、所在排版环境的类名（决定扫光、留白规则）、倾斜。 */
export interface FlySide {
  el: HTMLElement;
  /** 克隆所在环境的类名：版面那边带 lpm-b（版面的上色留白）和这一句的状态类，歌词栏那边带 lpm-c 和 is-grad。 */
  ctx: string;
  /** 倾斜（度）：版面里整句旋转 / 沿弧线摆的字。 */
  rot: number;
  /** 竖排的字（版面竖排页）。 */
  vert: boolean;
  /** 这个字所在句子的整句透明度（歌词栏按景深逐句写）：终点那份克隆乘上它，落地时亮度和真字一致。 */
  opEl?: HTMLElement;
  /** 混合模式（歌词栏不在唱的句子用 plus-lighter 透出环境色）。 */
  blend?: string;
}

export interface FlyPair {
  from: FlySide;
  /** 终点：找不到时由 retarget 每帧再找。 */
  to: FlySide | null;
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
  /** 起点：中心、视觉字号、倾斜。 */
  s: { x: number; y: number; f: number; rot: number };
  /** 上一次量到的终点。 */
  t: { x: number; y: number; f: number; rot: number } | null;
}

const fsOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).fontSize) || 16;
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** 克隆的排版环境照抄原字算出来的值（字体、字重、字距、行高、斜体、大小写、颜色变量）。 */
function copyType(to: HTMLElement, from: HTMLElement): void {
  const cs = getComputedStyle(from);
  to.style.fontFamily = cs.fontFamily;
  to.style.fontWeight = cs.fontWeight;
  to.style.fontStyle = cs.fontStyle;
  to.style.letterSpacing = cs.letterSpacing;
  to.style.lineHeight = cs.lineHeight;
  to.style.textTransform = cs.textTransform;
  for (const v of ['--lc-rest', '--lp-ink', '--lc-a', '--sung', '--edge', '--un']) {
    const val = cs.getPropertyValue(v);
    if (val) to.style.setProperty(v, val);
  }
}

/** 视觉位置：外接框中心（扣掉字自己的浮起 / 放大）与视觉字号（按倾斜反推）。 */
function placeOf(el: HTMLElement, side: FlySide, w: number, h: number, fs: number): { x: number; y: number; f: number; rot: number } | null {
  const r = el.getBoundingClientRect();
  if (!(r.width > 0)) return null;
  const th = (side.rot * Math.PI) / 180;
  const cos = Math.abs(Math.cos(th));
  const sin = Math.abs(Math.sin(th));
  const vs = (r.width + r.height) / ((w + h) * (cos + sin) || 1);
  let dx = 0;
  let dy = 0;
  let sc = 1;
  const tf = getComputedStyle(el).transform;
  if (tf && tf !== 'none') {
    const m = new DOMMatrixReadOnly(tf);
    sc = m.a || 1;
    const oy = side.vert ? 0.5 : 0.85;
    const lx = m.e;
    const ly = m.f + (0.5 - oy) * h * (m.a - 1);
    dx = (lx * Math.cos(th) - ly * Math.sin(th)) * (vs / sc);
    dy = (lx * Math.sin(th) + ly * Math.cos(th)) * (vs / sc);
  }
  return { x: r.left + r.width / 2 - dx, y: r.top + r.height / 2 - dy, f: fs * (vs / sc), rot: side.rot };
}

export class LsFly {
  private layer: HTMLElement;
  private lives: Live[] = [];
  private t0 = performance.now();
  private hidden: HTMLElement[] = [];
  done = false;
  /** 飞行进度 0–1（版面按它淡出译文、装饰）。 */
  get progress(): number {
    return Math.min(1, (performance.now() - this.t0) / this.dur);
  }

  constructor(
    pairs: FlyPair[],
    /** 每帧补找还没找到的终点（歌词栏刚建好时可能还没有字）。 */
    private retarget: (p: FlyPair) => FlySide | null,
    /** 飞行时长（毫秒）。 */
    private dur: number,
    /** 飞行期间要藏起来的真字（起点、终点两边）；结束时还原。 */
    private hide: (els: HTMLElement[], on: boolean) => void,
  ) {
    // 开发排查：window.__nebulaFlySlow = 倍数，放慢飞行
    this.dur *= (window as unknown as { __nebulaFlySlow?: number }).__nebulaFlySlow || 1;
    this.layer = document.createElement('div');
    this.layer.className = 'lp-morph lp-lsfly lw';
    this.layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.layer);
    for (const p of pairs) {
      const a = document.createElement('span');
      a.className = 'lpm-u';
      const ctxA = document.createElement('div');
      ctxA.className = `lpm-ctx ${p.from.ctx}`;
      const ac = p.from.el.cloneNode(true) as HTMLElement;
      if (p.from.vert) a.classList.add('is-v');
      a.appendChild(ac);
      ctxA.appendChild(a);
      this.layer.appendChild(ctxA);
      copyType(a, p.from.el);
      const fsA = fsOf(p.from.el);
      a.style.fontSize = `${fsA}px`;
      const ra = a.getBoundingClientRect();
      const live: Live = { p, a, ac, b: null, bc: null, fsA, fsB: fsA, aw: ra.width || 1, ah: ra.height || 1, bw: 1, bh: 1, s: { x: 0, y: 0, f: fsA, rot: 0 }, t: null };
      live.s = placeOf(p.from.el, p.from, live.aw, live.ah, fsA) ?? { x: innerWidth / 2, y: innerHeight / 2, f: fsA, rot: 0 };
      this.lives.push(live);
      this.hidden.push(p.from.el);
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
    const bc = to.el.cloneNode(true) as HTMLElement;
    b.appendChild(bc);
    ctxB.appendChild(b);
    this.layer.appendChild(ctxB);
    copyType(b, to.el);
    l.fsB = fsOf(to.el);
    b.style.fontSize = `${l.fsB}px`;
    const rb = b.getBoundingClientRect();
    l.b = b;
    l.bc = bc;
    l.bw = rb.width || 1;
    l.bh = rb.height || 1;
    this.hidden.push(to.el);
    this.hide([to.el], true);
  }

  /** 推进一帧；飞完返回 true（替身已拆、真字已还原）。 */
  step(now: number): boolean {
    if (this.done) return true;
    const k = Math.min(1, (now - this.t0) / this.dur);
    this.render(k);
    if (k >= 1) this.end();
    return this.done;
  }

  /** 按进度 k（0–1）摆一帧（QA 可以直接推到终点量落位）。 */
  render(k: number): void {
    const e = ease(k);
    const q = smooth((e - 0.2) / 0.6);
    const lwA = (1 - smooth(e / 0.2)).toFixed(3);
    const lwB = smooth((e - 0.8) / 0.2).toFixed(3);
    for (const l of this.lives) {
      if (!l.b) {
        const to = l.p.to ?? this.retarget(l.p);
        if (to) this.attach(l, to);
      }
      syncClone(l.p.from.el, l.ac);
      const ctxA = l.a.parentElement!;
      ctxA.style.opacity = l.b ? (1 - q).toFixed(3) : (1 - e).toFixed(3);
      ctxA.style.setProperty('--lw', lwA);
      let T = l.t;
      if (l.b && l.bc && l.p.to) {
        syncClone(l.p.to.el, l.bc);
        const ctxB = l.b.parentElement!;
        const op = l.p.to.opEl ? parseFloat(getComputedStyle(l.p.to.opEl).opacity) || 1 : 1;
        ctxB.style.opacity = (q * op).toFixed(3);
        ctxB.style.setProperty('--lw', lwB);
        const m = placeOf(l.p.to.el, l.p.to, l.bw, l.bh, l.fsB);
        if (m) T = l.t = m;
      }
      const S = l.s;
      const to = T ?? S;
      const x = S.x + (to.x - S.x) * e;
      const y = S.y + (to.y - S.y) * e;
      const f = S.f + (to.f - S.f) * e;
      const rot = S.rot + (to.rot - S.rot) * e;
      const sA = f / l.fsA;
      l.a.style.transform = `translate(${(x - l.aw / 2).toFixed(3)}px, ${(y - l.ah / 2).toFixed(3)}px) scale(${sA.toFixed(5)}) rotate(${rot.toFixed(3)}deg)`;
      if (l.b) {
        const sB = f / l.fsB;
        l.b.style.transform = `translate(${(x - l.bw / 2).toFixed(3)}px, ${(y - l.bh / 2).toFixed(3)}px) scale(${sB.toFixed(5)}) rotate(${rot.toFixed(3)}deg)`;
      }
    }
  }

  /** 落地误差（QA 用）：每个字终点那份克隆与终点真字的中心差（像素）。 */
  probe(): number[][] {
    return this.lives
      .filter((l) => l.bc && l.p.to)
      .map((l) => {
        const a = l.bc!.getBoundingClientRect();
        const b = l.p.to!.el.getBoundingClientRect();
        return [a.left + a.width / 2 - (b.left + b.width / 2), a.top + a.height / 2 - (b.top + b.height / 2)].map((v) => Math.round(v * 100) / 100);
      });
  }

  end(): void {
    if (this.done) return;
    this.done = true;
    this.layer.remove();
    this.hide(this.hidden, false);
  }
}
