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
  /**
   * 进入聆听后常驻（2026-11-22 用户要求）：动鼠标、点击、滚轮都不再退出，像听音空间一样待着；
   * 按 Esc 或左上角收起键（exit）离开。常驻期间不因暂停、在输入框打字、两侧面板开着而退出；打开听音空间时底层舞台保持常驻聆听（k=1）原地待命，
   * 只在硬阻断条件（右键菜单、信息弹窗、壁纸、登录、导入）出现时暂退漫游并在解除后恢复。根元素带 data-listen-pin：光标、两侧边缘入口、播放条照常（styles.css）。
   */
  pin: boolean;
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
  /** 交接是否启用。没启用时没有「聆听」，空域歌词按聆听时的样子常显（不退成氛围）。 */
  enabled: boolean;
}

export const listenBus: ListenBus = { k: 0, style: 'sink', layout: 'stacked', enabled: false };

const frameSubs = new Set<() => void>();

/** 交接进行中每帧通知一次（舞台据此刷新「散开」的卡片位置）。 */
export function onListenFrame(fn: () => void): () => void {
  frameSubs.add(fn);
  return () => {
    frameSubs.delete(fn);
  };
}

/**
 * 聆听中由别处（漫游歌词的段落开合、字照亮空间）请舞台刷新一帧：交接曲线跑完后舞台不会自己每帧刷新。
 * 只在交接启用、正在聆听或交接进行中时有效。
 */
export function pokeListenFrame(): void {
  if (!listenBus.enabled || listenBus.k <= 0.001) return;
  for (const fn of frameSubs) fn();
}

/** 交接曲线时长：进入像灯光调暗，回来不让人等。 */
const ENTER_MS = 1600;
const EXIT_MS = 380;
/** 漫游时歌词层亮度。 */
/** 漫游时歌词层的整体亮度。#124 起漫游的「氛围 / 字幕」由歌词层自己按 --lk 处理，这里不再压暗。 */
const LYR_ROAM = 1;
/** 「沉降」换层时歌词先淡到的亮度。 */
const LYR_DIP = 0.22;
/** 鼠标在 400ms 内累计移动超过这个距离才算"动了"（过滤手抖和触控板噪声）。 */
const MOVE_PX = 6;
const MOVE_WINDOW_MS = 400;
const CHECK_MS = 250;
/**
 * 这些弹层存在时不进入聆听（硬阻断）：信息弹窗和右键菜单。听音空间由 isListenSpaceOpen 单独传入（含 .ls-root.is-shown 兜底）。
 * 侧栏、设置、播放队列 / 音质 / 音量小弹层里鼠标不动也算静止（#125，用户反馈「在设置面板里一直不进入」）。
 */
const HARD_BUSY_SELECTOR = '.ctx-menu, .info-modal';
/** 这些输入框获得焦点才算「正在打字」；滑杆、复选框、按钮点过后留着焦点不算。 */
const TEXT_INPUT = /^(text|search|email|url|tel|password|number)$/;

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
  /** 应用层的硬阻断条件（右键菜单、信息弹窗、壁纸、登录、导入中等；不含听音空间）。 */
  isBlocked: () => boolean;
  /** 听音空间是否打开（由 React 状态直传，避免轮询 DOM 的首帧/收起尾帧竞态）。 */
  isListenSpaceOpen?: () => boolean;
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

/**
 * 有可见、可操作的文字输入框处于焦点（正在打字）。收起的面板里残留焦点的输入框不算（面板收起后 pointer-events 为 none）。
 * 只认打字用的输入框：设置里拖过的滑杆（input[type=range]）、点过的颜色框会一直留着焦点，以前因此一直不进入聆听（#125）。
 */
function editableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  const typing =
    tag === 'TEXTAREA' || el.isContentEditable || (tag === 'INPUT' && TEXT_INPUT.test((el as HTMLInputElement).type));
  if (!typing) return false;
  return el.getClientRects().length > 0 && getComputedStyle(el).pointerEvents !== 'none';
}

export class ListenDirector {
  private cfg: ListenConfig = {
    enabled: false,
    delayMs: 6000,
    style: 'sink',
    dimBar: true,
    pin: false,
    lyricsUnder: true,
    layout: 'stacked',
  };
  private mode: 'roam' | 'listen' = 'roam';
  /** 常驻聆听被阻断条件打断（比如打开了听音空间）：条件解除时直接回到聆听，不重新计静止时间。 */
  private resume = false;
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
    for (const t of ['pointerdown', 'wheel', 'touchstart'] as const) {
      window.addEventListener(t, this.onActivity, { passive: true, capture: true });
    }
    window.addEventListener('keydown', this.onKey, { passive: true, capture: true });
    this.timer = window.setInterval(this.check, CHECK_MS);
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.onMove, { capture: true });
    for (const t of ['pointerdown', 'wheel', 'touchstart'] as const) {
      window.removeEventListener(t, this.onActivity, { capture: true });
    }
    window.removeEventListener('keydown', this.onKey, { capture: true });
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
    listenBus.enabled = cfg.enabled;
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
    if (this.mode === 'listen' && cfg.pin) d.listenPin = 'on';
    else delete d.listenPin;
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
    if (this.mode === 'listen' && !cfg.pin && this.lsOpen()) {
      this.resume = false;
      this.setMode('roam', true);
      return;
    }
    this.write();
    this.emit();
  }

  /** 应用层阻断条件或听音空间开关变化时立即复核，不等 250ms 轮询。 */
  notify(): void {
    this.check();
  }

  /** 沉降、退潮都把歌词换到卡片之上（退潮时卡片化成薄雾，留在下面会被挡住，#124）。 */
  private needsTop(): boolean {
    return (this.cfg.style === 'sink' || this.cfg.style === 'ebb') && this.cfg.lyricsUnder;
  }

  private travelDirect = false;

  private clearTravelDirect(): void {
    if (!this.travelDirect) return;
    this.travelDirect = false;
    const r = this.root;
    for (const sel of ['.stage-3d', '.lyrics-layer', '.lyrics-intro', '.center-btn', '.listen-exit']) {
      const el = r.querySelector<HTMLElement>(sel);
      if (el) el.style.opacity = '';
    }
    const ps = r.querySelector<HTMLElement>('.player-surface');
    if (ps) ps.style.removeProperty('--lk');
  }

  private clearRoot(): void {
    this.clearTravelDirect();
    const d = this.root.dataset;
    delete d.listenStyle;
    delete d.listenBar;
    delete d.listen;
    delete d.lk;
    delete d.lkFull;
    delete d.lyrTop;
    delete d.listenPin;
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
    if (this.mode === 'listen' && !this.cfg.pin) this.setMode('roam');
  };

  /** 常驻聆听：Esc 离开（别的浮层——听音空间、队列 / 音质 / 音量弹层、右键菜单、打开的侧面板、信息弹窗——开着时让给它们）。 */
  private onKey = (e: KeyboardEvent): void => {
    if (this.cfg.pin && this.mode === 'listen' && e.key === 'Escape') {
      if (
        this.lsOpen() ||
        document.querySelector('.queue-pop, .quality-pop, .vol-pop, .ctx-menu, .sd-panel.is-open, .info-overlay, .ls-root.is-shown')
      ) {
        return;
      }
      this.exit();
      return;
    }
    this.onActivity();
  };

  /** 离开聆听（常驻聆听的收起键、Esc）：回到漫游，重新开始计静止时间。 */
  exit(): void {
    this.resume = false;
    this.lastAct = performance.now();
    if (this.mode === 'listen') this.setMode('roam');
  }

  private lsOpen(): boolean {
    return !!this.deps.isListenSpaceOpen?.() || !!document.querySelector('.ls-root.is-shown');
  }

  private hardBlocked(): boolean {
    return this.deps.isBlocked() || !!document.querySelector(HARD_BUSY_SELECTOR);
  }

  private check = (): void => {
    if (!this.cfg.enabled) return;
    const now = performance.now();
    const hard = this.hardBlocked();
    const ls = this.lsOpen();
    const ok = this.deps.isPlaying() && !hard && !ls && !editableFocused();
    if (this.mode === 'listen') {
      if (this.cfg.pin) {
        // 常驻聆听：打开听音空间时底层舞台保持 k=1 原地待命（不改根元素 --lk、收起后直接飞回常驻舞台不闪星云）；
        // 只有硬阻断条件出现时才暂退漫游，条件解除后自动恢复
        if (hard) {
          this.resume = true;
          this.setMode('roam');
        } else {
          this.resume = false;
        }
      } else if (!ok) {
        // 非常驻聆听因听音空间打开而退回漫游时直接落位（避免 0.38s 退场每帧改根元素 --lk 重算整棵页面）
        this.setMode('roam', ls);
      }
      return;
    }
    // 常驻聆听被硬阻断打断后，硬阻断与听音空间都收起时直接回到聆听
    if (this.resume) {
      if (!this.cfg.pin) this.resume = false;
      else if (!hard && !ls) {
        this.resume = false;
        this.setMode('listen');
        return;
      }
    }
    // 条件不满足期间计时清零：恢复播放、关掉弹层后重新数
    if (!ok) {
      this.lastAct = now;
      return;
    }
    if (now - this.lastAct >= this.cfg.delayMs) this.setMode('listen');
  };

  private setMode(m: 'roam' | 'listen', instant = false): void {
    if (this.mode === m) return;
    this.mode = m;
    if (m === 'listen') this.root.dataset.listen = 'on';
    else delete this.root.dataset.listen;
    if (m === 'listen' && this.cfg.pin) this.root.dataset.listenPin = 'on';
    else delete this.root.dataset.listenPin;
    const to = m === 'listen' ? 1 : 0;
    const base = m === 'listen' ? ENTER_MS : EXIT_MS;
    this.tw = {
      from: this.k,
      to,
      t0: performance.now(),
      dur: this.reduce || instant ? 1 : base * Math.max(0.35, Math.abs(to - this.k)),
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
    const isTravel = document.documentElement.dataset.stageMode === 'travel';
    const mid = this.k > 0.001 && this.k < 0.999;
    if (isTravel && mid) {
      // 穿行过渡期（0<k<1）：直接写 5 个合成层节点的 opacity，避免每帧在 .app 上改 --lk/--lo/--ls 导致整棵 140 卡星云子树全量样式重算
      this.travelDirect = true;
      const r = this.root;
      const inv = (1 - this.k).toFixed(4);
      const ks = this.k.toFixed(4);
      const st = r.querySelector<HTMLElement>('.stage-3d');
      if (st) st.style.opacity = inv;
      const ly = r.querySelector<HTMLElement>('.lyrics-layer');
      if (ly) ly.style.opacity = inv;
      const intro = r.querySelector<HTMLElement>('.lyrics-intro');
      if (intro) intro.style.opacity = (0.92 * (1 - this.k)).toFixed(4);
      const cb = r.querySelector<HTMLElement>('.center-btn');
      if (cb) cb.style.opacity = inv;
      if (this.cfg.pin) {
        const ex = r.querySelector<HTMLElement>('.listen-exit');
        if (ex) ex.style.opacity = ks;
      } else if (this.cfg.dimBar) {
        const ps = r.querySelector<HTMLElement>('.player-surface');
        if (ps) ps.style.setProperty('--lk', ks);
      }
      if (!d.lk) d.lk = 'on';
      if (this.k >= 0.98) d.lkFull = 'on';
      else delete d.lkFull;
      listenBus.k = this.k;
      return;
    }
    this.clearTravelDirect();
    s.setProperty('--lk', this.k.toFixed(4));
    s.setProperty('--lo', this.lyrOp.toFixed(4));
    s.setProperty('--ls', (1 + (this.cfg.style === 'sink' ? 0.04 : 0.03) * this.k).toFixed(4));
    if (this.k > 0.001) d.lk = 'on';
    else delete d.lk;
    if (this.k >= 0.98) d.lkFull = 'on';
    else delete d.lkFull;
    if (this.lyrTop) d.lyrTop = 'on';
    else delete d.lyrTop;
    listenBus.k = this.k;
  }

  private emit(): void {
    for (const fn of frameSubs) fn();
  }
}
