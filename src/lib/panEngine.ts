import { wrap } from './layout';

export interface PanFrame {
  x: number;
  y: number;
  vw: number;
  vh: number;
  zoom: number;
}

export interface PanControllerOptions {
  initialX: number;
  initialY: number;
  initialZoom?: number;
  /**
   * 主舞台星云（#133–#136）：画布首尾相接（周期 period，正方形），没有边界、没有中心；
   * 滚轮缩放以屏幕中心为锚（透镜中心）；拖动按手下那一点的局部放大率换算，手下的卡片跟着手走；
   * 飞行（搜索、回到正在播放）走首尾相接里最近的那条路。最小缩放随窗口大小变。
   */
  bounded: {
    period: number;
    /** 最小缩放 */
    zoomMin: (vw: number, vh: number) => number;
    zoomMax: number;
    worldPerPixel: (sx: number, sy: number, frame: PanFrame) => number;
  };
  /** 每帧回调：用于视口查询与卡片 CSS 变量更新（含静止后的最后一帧）。 */
  onFrame: (frame: PanFrame) => void;
  /** 拖拽真正开始（越过阈值）时回调，用于清除 hover。 */
  onPanStart?: () => void;
}

type Mode = 'idle' | 'dragging' | 'inertia';

const DRAG_THRESHOLD = 5;
const INERTIA_MIN_VELOCITY = 0.12;
const INERTIA_DECAY = 4.6;
const MAX_INERTIA_VELOCITY = 7;
const WHEEL_SETTLE_MS = 160;
const SAMPLE_WINDOW_MS = 120;
const ANIMATE_MS = 950;

/**
 * 无限平移引擎（Pointer + Wheel + 惯性 + 周期回绕）。
 * 只负责 pan 状态与手势，渲染由 onFrame 驱动。
 */
export class PanController {
  readonly pan = { x: 0, y: 0 };
  zoom = 1;

  private velocity = { x: 0, y: 0 };
  private mode: Mode = 'idle';
  private raf = 0;
  private lastFrame = 0;
  private lastWheelAt = -1e9;
  private activePointer: { id: number; x: number; y: number; t: number } | null = null;
  private downPos = { x: 0, y: 0 };
  private dragging = false;
  private samples: { x: number; y: number; t: number }[] = [];
  private disposed = false;
  /** 拖动换算：1 屏幕像素 = 多少世界坐标（按手下那一点的局部放大率算）。 */
  private dragK = 1;
  private anim = 0;

  constructor(
    private container: HTMLElement,
    private opts: PanControllerOptions,
  ) {
    this.pan.x = opts.initialX;
    this.pan.y = opts.initialY;
    this.zoom = opts.initialZoom ?? 1;
  }

  private size(): { vw: number; vh: number } {
    return {
      vw: this.container.clientWidth || window.innerWidth,
      vh: this.container.clientHeight || window.innerHeight,
    };
  }

  /** 平滑飞到某个镜头中心（世界坐标），可同时改缩放（搜索、回到正在播放）。 */
  animateToCenter(cx: number, cy: number, zoom = this.zoom, ms = ANIMATE_MS): void {
    this.mode = 'idle';
    this.velocity = { x: 0, y: 0 };
    const { vw, vh } = this.size();
    const z0 = this.zoom;
    const c0x = this.pan.x + vw / (2 * z0);
    const c0y = this.pan.y + vh / (2 * z0);
    // 首尾相接：目标取离当前镜头最近的那一份，走最短的路
    const T = this.opts.bounded.period;
    cx = c0x + (cx - c0x - T * Math.round((cx - c0x) / T));
    cy = c0y + (cy - c0y - T * Math.round((cy - c0y) / T));
    const start = performance.now();
    const token = ++this.anim;
    const step = (now: number): void => {
      if (token !== this.anim || this.disposed) return;
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // 缩放按对数插值，远近变化听起来是匀速的
      const z = Math.exp(Math.log(z0) + (Math.log(zoom) - Math.log(z0)) * e);
      const { vw: w, vh: h } = this.size();
      this.zoom = z;
      this.pan.x = c0x + (cx - c0x) * e - w / (2 * z);
      this.pan.y = c0y + (cy - c0y) * e - h / (2 * z);
      this.requestFrame();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  start(): void {
    const el = this.container;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('resize', this.onResize);
    this.lastFrame = performance.now();
    this.requestFrame();
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    const el = this.container;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
  }

  /** 回到画布中心。 */
  reset(): void {
    const vw = this.container.clientWidth || window.innerWidth;
    const vh = this.container.clientHeight || window.innerHeight;
    this.anim++;
    // 回到星云中心
    this.zoom = Math.max(0.62, this.opts.bounded.zoomMin(vw, vh));
    this.pan.x = -vw / (2 * this.zoom);
    this.pan.y = -vh / (2 * this.zoom);
    this.velocity = { x: 0, y: 0 };
    this.mode = 'idle';
    this.container.classList.remove('is-panning', 'is-grabbing');
    this.requestFrame();
  }

  /** 主动触发一次布局帧（渐进揭示、数据更新等场景使用）。 */
  refresh(): void {
    this.requestFrame();
  }

  private requestFrame(): void {
    if (!this.raf && !this.disposed) {
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.activePointer) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 手一按下就停住正在进行的飞行；按手下那一点的放大率换算拖动距离
    this.anim++;
    const { vw, vh } = this.size();
    this.dragK = this.opts.bounded.worldPerPixel(e.clientX, e.clientY, { x: this.pan.x, y: this.pan.y, vw, vh, zoom: this.zoom });
    this.activePointer = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    this.downPos = { x: e.clientX, y: e.clientY };
    this.dragging = false;
    this.velocity = { x: 0, y: 0 };
    this.samples = [];
    this.mode = 'dragging';
    this.requestFrame();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const active = this.activePointer;
    if (!active || e.pointerId !== active.id) return;

    const now = performance.now();
    const dx = e.clientX - active.x;
    const dy = e.clientY - active.y;

    if (!this.dragging) {
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      if (moved > DRAG_THRESHOLD) {
        this.dragging = true;
        this.container.classList.add('is-panning', 'is-grabbing');
        this.opts.onPanStart?.();
      }
    }

    if (this.dragging) {
      this.pan.x -= dx * this.dragK;
      this.pan.y -= dy * this.dragK;
      this.samples.push({ x: e.clientX, y: e.clientY, t: now });
      this.trimSamples(now);
      this.requestFrame();
    }

    active.x = e.clientX;
    active.y = e.clientY;
    active.t = now;
  };

  private onPointerUp = (e: PointerEvent): void => {
    const active = this.activePointer;
    if (!active || e.pointerId !== active.id) return;
    this.activePointer = null;
    this.container.classList.remove('is-grabbing');

    if (this.dragging) {
      const v = this.computeVelocity();
      this.velocity = v;
      if (Math.hypot(v.x, v.y) >= INERTIA_MIN_VELOCITY) {
        this.mode = 'inertia';
      } else {
        this.mode = 'idle';
        this.velocity = { x: 0, y: 0 };
      }
    } else {
      this.mode = 'idle';
    }
    this.dragging = false;
    this.requestFrame();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.mode === 'inertia') {
      this.mode = 'idle';
      this.velocity = { x: 0, y: 0 };
    }
    const delta =
      e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * this.container.clientHeight : e.deltaY;
    const factor = Math.exp(-delta * 0.0014);
    // 以屏幕中心（透镜中心）为锚缩放，镜头中心不动
    const b = this.opts.bounded;
    this.anim++;
    const { vw, vh } = this.size();
    const nextZoom = Math.min(b.zoomMax, Math.max(b.zoomMin(vw, vh), this.zoom * factor));
    const cx = this.pan.x + vw / (2 * this.zoom);
    const cy = this.pan.y + vh / (2 * this.zoom);
    this.zoom = nextZoom;
    this.pan.x = cx - vw / (2 * nextZoom);
    this.pan.y = cy - vh / (2 * nextZoom);
    this.lastWheelAt = performance.now();
    this.requestFrame();
  };

  private onResize = (): void => {
    this.requestFrame();
  };

  private tick = (now: number): void => {
    this.raf = 0;
    let keep = false;

    if (this.mode === 'dragging') {
      keep = true;
    } else if (this.mode === 'inertia') {
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
      this.pan.x += this.velocity.x * dt * 1000 * this.dragK;
      this.pan.y += this.velocity.y * dt * 1000 * this.dragK;
      const decay = Math.exp(-INERTIA_DECAY * dt);
      this.velocity.x *= decay;
      this.velocity.y *= decay;
      if (Math.hypot(this.velocity.x, this.velocity.y) < INERTIA_MIN_VELOCITY) {
        this.mode = 'idle';
        this.velocity = { x: 0, y: 0 };
      } else {
        keep = true;
      }
    }

    if (now - this.lastWheelAt < WHEEL_SETTLE_MS) keep = true;

    const b = this.opts.bounded;
    const { vw, vh } = this.size();
    // 缩放不低于下限（窗口变大后下限会变高）；以屏幕中心为锚
    const zMin = b.zoomMin(vw, vh);
    if (this.zoom < zMin) {
      const ccx = this.pan.x + vw / (2 * this.zoom);
      const ccy = this.pan.y + vh / (2 * this.zoom);
      this.zoom = zMin;
      this.pan.x = ccx - vw / (2 * zMin);
      this.pan.y = ccy - vh / (2 * zMin);
    }
    // 首尾相接：把 pan 收进一个周期（世界是周期的，收回来看不出任何变化）
    this.pan.x = wrap(this.pan.x, b.period);
    this.pan.y = wrap(this.pan.y, b.period);

    this.opts.onFrame({
      x: this.pan.x,
      y: this.pan.y,
      vw: this.container.clientWidth || window.innerWidth,
      vh: this.container.clientHeight || window.innerHeight,
      zoom: this.zoom,
    });

    if (keep) {
      this.requestFrame();
    } else {
      this.container.classList.remove('is-panning');
    }
    this.lastFrame = now;
  };

  private computeVelocity(): { x: number; y: number } {
    const s = this.samples;
    if (s.length < 2) return { x: 0, y: 0 };
    const first = s[0]!;
    const last = s[s.length - 1]!;
    const dt = last.t - first.t;
    if (dt < 8) return { x: 0, y: 0 };
    let vx = (last.x - first.x) / dt;
    let vy = (last.y - first.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_INERTIA_VELOCITY) {
      const k = MAX_INERTIA_VELOCITY / speed;
      vx *= k;
      vy *= k;
    }
    return { x: -vx, y: -vy };
  }

  private trimSamples(now: number): void {
    const cutoff = now - SAMPLE_WINDOW_MS;
    while (this.samples.length > 1 && this.samples[0]!.t < cutoff) {
      this.samples.shift();
    }
  }
}
