/**
 * 漫游 / 聆听注意力交接引擎（docs/design/NEBULA_UI_SYSTEM.md §7.1）。
 *
 * 音乐在播放、用户静止 N 秒后进入「聆听」：星云让开，歌词成为主角；一动就回到「漫游」。
 * 引擎只做三件事：判断静止、跑 0→1 的交接曲线、把结果写到根元素上：
 *   --lk  交接进度（0 = 漫游，1 = 聆听）
 *   --lo  歌词层亮度（漫游 .82 → 聆听 1；「沉降」换层时先淡一下）
 *   --ls  歌词层缩放
 *   data-listen-style / data-listen-bar / data-listen / data-lk / data-lyr-top
 * 视觉全部由 CSS 读这些变量完成；「散开」的卡片位移由舞台帧循环读 listenBus 计算。
 * 用 data-* 而不用 class：根元素的 className 由 React 管理，命令式加的 class 可能被覆盖。
 */

export type ListenStyle = 'sink' | 'part' | 'ebb';

export interface ListenConfig {
  /** 交接是否启用（设置开关，且卡片层、歌词层都没有被隐藏）。 */
  enabled: boolean;
  /** 静止多久进入聆听（毫秒）。 */
  delayMs: number;
  style: ListenStyle;
  /** 聆听时播放条一起变淡。 */
  dimBar: boolean;
  /** 歌词图层在卡片之下（决定「沉降」是否需要换层）。 */
  lyricsUnder: boolean;
  /** 歌词三句布局（决定「散开」的让开中心）。 */
  layout: 'stacked' | 'offset';
}

/** 舞台帧循环读取的交接状态（对象引用恒定，字段原地更新）。 */
export interface ListenBus {
  k: number;
  style: ListenStyle;
  layout: 'stacked' | 'offset';
}

export const listenBus: ListenBus = { k: 0, style: 'sink', layout: 'stacked' };

const frameSubs = new Set<() => void>();

/** 交接进行中每帧通知一次（舞台据此刷新「散开」的卡片位置）。 */
export function onListenFrame(fn: () => void): () => void {
  frameSubs.add(fn);
  return () => {
    frameSubs.delete(fn);
  };
}

/** 交接曲线时长：进入像灯光调暗，回来不让人等。 */
const ENTER_MS = 1600;
const EXIT_MS = 380;
/** 漫游时歌词层亮度。 */
const LYR_ROAM = 0.82;
/** 「沉降」换层时歌词先淡到的亮度。 */
const LYR_DIP = 0.22;
/** 鼠标在 400ms 内累计移动超过这个距离才算"动了"（过滤手抖和触控板噪声）。 */
const MOVE_PX = 6;
const MOVE_WINDOW_MS = 400;
const CHECK_MS = 250;
/** 这些弹层存在时不进入聆听（正在操作）。 */
const BUSY_SELECTOR = '.queue-pop, .quality-pop, .vol-pop, .ctx-menu, .info-modal, .now-playing-overlay';

/**
 * 「散开」：把屏幕坐标 (x, y) 处的卡片中心向外推。返回推开后的位置和推开量（0~1，用于压暗）。
 * 让开区域是以歌词区为中心的椭圆；越靠近中心推得越多，映射单调，不会让卡片交换前后顺序。
 */
export function partOffset(
  x: number,
  y: number,
  vw: number,
  vh: number,
  k: number,
  layout: 'stacked' | 'offset',
  seed: number,
): { x: number; y: number; push: number } {
  if (k <= 0) return { x, y, push: 0 };
  const px = vw * 0.5;
  const py = vh * (layout === 'offset' ? 0.5 : 0.37);
  // 真实星云的焦点卡片比样张大（172px × 鱼眼放大），让开区域按真实尺寸取：
  // 中心处的卡片被推到 0.95 个半径外，卡片上沿刚好离开当前句（0.5vh）
  const rx = Math.min(vw * 0.4, vh * 0.85);
  const ry = vh * 0.38;
  const A = 0.95;
  const sigma = 0.9;
  const dx = (x - px) / rx;
  const dy = (y - py) / ry;
  const e = Math.hypot(dx, dy);
  // 正好在中心的卡片没有方向：按卡片自身的种子给一个固定方向
  const ux = e > 1e-3 ? dx / e : Math.cos(seed);
  const uy = e > 1e-3 ? dy / e : Math.sin(seed);
  const e2 = e + k * A * Math.exp(-((e / sigma) ** 2));
  return { x: px + ux * e2 * rx, y: py + uy * e2 * ry, push: (e2 - e) / A };
}

export interface ListenDirectorDeps {
  isPlaying: () => boolean;
  /** 应用层的阻断条件（悬停卡片、弹窗、面板、导入中等）。 */
  isBlocked: () => boolean;
}

interface Tween {
  from: number;
  to: number;
  t0: number;
  dur: number;
  lyrFrom: number;
  needSwap: boolean;
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 有可见、可操作的输入框处于焦点（正在打字）。收起的面板里残留焦点的输入框不算（面板收起后 pointer-events 为 none）。 */
function editableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (!(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable)) return false;
  return el.getClientRects().length > 0 && getComputedStyle(el).pointerEvents !== 'none';
}

export class ListenDirector {
  private cfg: ListenConfig = {
    enabled: false,
    delayMs: 6000,
    style: 'sink',
    dimBar: true,
    lyricsUnder: true,
    layout: 'stacked',
  };
  private mode: 'roam' | 'listen' = 'roam';
  private lastAct = performance.now();
  private moveAcc = 0;
  private lastX: number | null = null;
  private lastY = 0;
  private lastMoveT = 0;
  private k = 0;
  private lyrOp = 1;
  private lyrTop = false;
  private tw: Tween | null = null;
  private raf = 0;
  private timer = 0;
  private readonly reduce =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: ListenDirectorDeps,
  ) {}

  start(): void {
    window.addEventListener('pointermove', this.onMove, { passive: true, capture: true });
    for (const t of ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const) {
      window.addEventListener(t, this.onActivity, { passive: true, capture: true });
    }
    this.timer = window.setInterval(this.check, CHECK_MS);
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.onMove, { capture: true });
    for (const t of ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const) {
      window.removeEventListener(t, this.onActivity, { capture: true });
    }
    window.clearInterval(this.timer);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clearRoot();
  }

  configure(cfg: ListenConfig): void {
    const prev = this.cfg;
    this.cfg = cfg;
    listenBus.style = cfg.style;
    listenBus.layout = cfg.layout;
    if (!cfg.enabled) {
      this.mode = 'roam';
      this.k = 0;
      this.tw = null;
      this.lyrTop = false;
      this.lyrOp = 1;
      this.clearRoot();
      this.emit();
      return;
    }
    const d = this.root.dataset;
    d.listenStyle = cfg.style;
    d.listenBar = cfg.dimBar ? 'dim' : 'keep';
    if (!prev.enabled) {
      this.lastAct = performance.now();
      this.lyrOp = LYR_ROAM;
    } else if (prev.style !== cfg.style || prev.lyricsUnder !== cfg.lyricsUnder || prev.layout !== cfg.layout) {
      // 换方式时直接落到当前状态的终点，不做过渡
      const on = this.mode === 'listen';
      this.tw = null;
      this.k = on ? 1 : 0;
      this.lyrOp = on ? 1 : LYR_ROAM;
      this.lyrTop = on && this.needsTop();
    }
    this.write();
    this.emit();
  }

  private needsTop(): boolean {
    return this.cfg.style === 'sink' && this.cfg.lyricsUnder;
  }

  private clearRoot(): void {
    const d = this.root.dataset;
    delete d.listenStyle;
    delete d.listenBar;
    delete d.listen;
    delete d.lk;
    delete d.lyrTop;
    for (const v of ['--lk', '--lo', '--ls']) this.root.style.removeProperty(v);
    listenBus.k = 0;
  }

  private onMove = (e: PointerEvent): void => {
    const now = performance.now();
    if (this.lastX === null || now - this.lastMoveT > MOVE_WINDOW_MS) this.moveAcc = 0;
    if (this.lastX !== null) this.moveAcc += Math.hypot(e.clientX - this.lastX, e.clientY - this.lastY);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastMoveT = now;
    if (this.moveAcc > MOVE_PX) {
      this.moveAcc = 0;
      this.onActivity();
    }
  };

  private onActivity = (): void => {
    this.lastAct = performance.now();
    if (this.mode === 'listen') this.setMode('roam');
  };

  private blocked(): boolean {
    return this.deps.isBlocked() || editableFocused() || !!document.querySelector(BUSY_SELECTOR);
  }

  private check = (): void => {
    if (!this.cfg.enabled) return;
    const now = performance.now();
    const ok = this.deps.isPlaying() && !this.blocked();
    if (this.mode === 'listen') {
      if (!ok) this.setMode('roam');
      return;
    }
    // 条件不满足期间计时清零：恢复播放、关掉弹层后重新数
    if (!ok) {
      this.lastAct = now;
      return;
    }
    if (now - this.lastAct >= this.cfg.delayMs) this.setMode('listen');
  };

  private setMode(m: 'roam' | 'listen'): void {
    if (this.mode === m) return;
    this.mode = m;
    if (m === 'listen') this.root.dataset.listen = 'on';
    else delete this.root.dataset.listen;
    const to = m === 'listen' ? 1 : 0;
    const base = m === 'listen' ? ENTER_MS : EXIT_MS;
    this.tw = {
      from: this.k,
      to,
      t0: performance.now(),
      dur: this.reduce ? 1 : base * Math.max(0.35, Math.abs(to - this.k)),
      lyrFrom: this.lyrOp,
      needSwap: this.needsTop() && (m === 'listen') !== this.lyrTop,
    };
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.raf = 0;
    const tw = this.tw;
    if (!tw) return;
    const t = Math.min(1, Math.max(0, (now - tw.t0) / tw.dur));
    const into = tw.to === 1;
    const ease = into ? easeInOut(t) : easeOut(t);
    this.k = lerp(tw.from, tw.to, ease);
    const target = into ? 1 : LYR_ROAM;
    if (tw.needSwap) {
      // 沉降换层：先淡到 22%，在最暗处换层，再亮起来
      const cut = into ? 0.22 : 0.4;
      if (t < cut) {
        this.lyrOp = lerp(tw.lyrFrom, LYR_DIP, t / cut);
      } else {
        this.lyrTop = into;
        this.lyrOp = lerp(LYR_DIP, target, easeOut((t - cut) / (1 - cut)));
      }
    } else {
      this.lyrOp = lerp(tw.lyrFrom, target, ease);
    }
    this.write();
    this.emit();
    if (t < 1) this.raf = requestAnimationFrame(this.tick);
    else this.tw = null;
  };

  private write(): void {
    const s = this.root.style;
    const d = this.root.dataset;
    s.setProperty('--lk', this.k.toFixed(4));
    s.setProperty('--lo', this.lyrOp.toFixed(4));
    s.setProperty('--ls', (1 + (this.cfg.style === 'sink' ? 0.04 : 0.03) * this.k).toFixed(4));
    if (this.k > 0.001) d.lk = 'on';
    else delete d.lk;
    if (this.lyrTop) d.lyrTop = 'on';
    else delete d.lyrTop;
    listenBus.k = this.k;
  }

  private emit(): void {
    for (const fn of frameSubs) fn();
  }
}
