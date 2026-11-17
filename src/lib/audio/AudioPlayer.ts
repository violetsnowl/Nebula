import type { Track } from '../catalog';
import { sourceTiming, type SourceTiming } from './sourceLifetime';

export type PlayMode = 'sequential' | 'repeat-one' | 'random';

export interface AudioPlayerState {
  song: Track | null;
  playing: boolean;
  /** 用户希望播放；取链/缓冲时仍为true，实际出流仍由playing表示。 */
  playIntent: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  /** 当前曲目音频加载失败（用于 UI 置灰）。 */
  failed: boolean;
  /** 最近一次播放失败原因（供底部播放条提示）。 */
  error: string | null;
  /** 当前歌曲可用的音质档位。*/
  qualities: { level: string; label: string; needsVip?: boolean; needsSvip?: boolean }[];
  /** 当前音质档位。*/
  quality: string;
  /** 播放模式：顺序 / 单曲循环 / 随机。 */
  mode: PlayMode;
}

type Listener = () => void;
export interface ResolveContext { signal: AbortSignal; forceRefresh: boolean }

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 全局单例 HTML5 Audio 播放器。
 * - 事件驱动：订阅者可实时拿到 playing / currentTime / duration / 错误等状态；
 * - 自动队列：playSong(track, queue) 后 next/prev 在队列内循环；
 * - 容错：音频加载失败自动跳过下一首（连续失败达到队列长度则停止）。
 */
/** 换歌单后仍在播放的旧歌单曲目使用的 id：不与任何曲库下标冲突（见 adoptQueue）。 */
export const FOREIGN_SONG_ID = -1;

class AudioPlayer {
  el: HTMLAudioElement;
  private listeners = new Set<Listener>();
  private queue: Track[] = [];
  /** 当前播放顺序（queue 下标序列）：顺序模式为恒等序，随机模式为 Fisher-Yates 洗牌序。 */
  private order: number[] = [];
  /** 在 order 中的当前位置。 */
  private pos = -1;
  /** 通过「下一首播放」插入、尚在等待播放的 queue 下标集合（FIFO 段标记）。 */
  private viaNextIdx = new Set<number>();
  private mode: PlayMode = 'sequential';
  private failStreak = 0;
  private consecutiveSkips = 0;
  private retriedSongId: number | null = null;
  private trialEndedId: number | null = null;
  private stallTimer: number | null = null;
  private generation = 0;
  private request: AbortController | null = null;
  private skipTimer: number | null = null;
  private wantsPlay = false;
  private activeSource = false;
  private pendingSeek = 0;
  private sourceTimes = new WeakMap<Track, SourceTiming & { url:string }>();
  private warm: { key:string; control:AbortController; track?:Track; el?:HTMLAudioElement } | null = null;
  /** 临时单曲（网络搜索点播）备份：播放结束后自动接回原队列。 */
  private transientBackup: { queue: Track[]; order: number[]; pos: number } | null = null;

  /**
   * 音源失败重试器（由 App 注入）：
   * 主平台取流失败 / <audio> onerror 时，先尝试兜底检索再决定是否跳歌。
   */
  retryResolver?: (track: Track, reason: 'empty' | 'error', context?: ResolveContext) => Promise<Track | null>;
  /** 空音源快速解析器（next/prev/ended 遇未解析歌曲时走主平台取链，避免搜索兜底拖慢切歌）。 */
  emptyResolver?: (track: Track, reason: 'empty' | 'error', context?: ResolveContext) => Promise<Track | null>;

  state: Omit<AudioPlayerState, 'playIntent'> = {
    song: null,
    playing: false,
    loading: false,
    currentTime: 0,
    duration: 0,
    volume: 0.9,
    muted: false,
    failed: false,
    error: null,
    qualities: [],
    quality: '',
    mode: 'sequential',
  };

  constructor() {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.volume = 0.9;
    this.bindMedia(this.el, true);
  }

  private bindMedia(el: HTMLAudioElement, add: boolean): void {
    const events = {timeupdate:this.onTimeUpdate,loadedmetadata:this.onMeta,durationchange:this.onMeta,play:this.onPlay,
      playing:this.onPlaying,pause:this.onPause,waiting:this.onWaiting,ended:this.onEnded,error:this.onError,volumechange:this.onVolume};
    for (const [name,handler] of Object.entries(events)) {
      if (add) el.addEventListener(name,handler); else el.removeEventListener(name,handler);
    }
  }
  private identity(t: Track): string { return `${t.source}:${t.sourceId || t.id}`; }
  private upcoming(): Track | undefined {
    if (this.mode === 'repeat-one' && !this.transientBackup) return undefined;
    const b = this.transientBackup;
    const queue=b?.queue ?? this.queue, order=b?.order ?? this.order, pos=b?.pos ?? this.pos;
    if (!order.length || (this.mode==='random' && pos+1>=order.length)) return undefined;
    return queue[order[(pos+1)%order.length]!];
  }
  private discardWarm(): void {
    const warm=this.warm; this.warm=null;
    warm?.control.abort();
    if (warm?.el) { warm.el.pause();warm.el.removeAttribute('src');warm.el.load(); }
  }
  /** 只预取下一首，临近结束才缓冲；第二个元素永远不提前播放。 */
  private prefetch(): void {
    const next=this.upcoming(), key=next && this.identity(next);
    if (this.warm && this.warm.key!==key) this.discardWarm();
    if (!next || this.warm || !this.state.playing || this.state.duration-this.state.currentTime>45) return;
    const warm={key:key!,control:new AbortController()} as NonNullable<AudioPlayer['warm']>;
    this.warm=warm;
    const resolver=this.emptyResolver ?? this.retryResolver;
    void Promise.resolve(next.audio && !this.expired(next) ? next : resolver?.(next,'empty',{signal:warm.control.signal,forceRefresh:false})).then(track=>{
      if (this.warm!==warm || warm.control.signal.aborted || !track?.audio) return;
      warm.track={...track,...this.timingFor(track)};
      warm.el=new Audio();warm.el.preload='auto';warm.el.volume=this.el.volume;warm.el.muted=this.el.muted;
      warm.el.src=track.audio;warm.el.load();
    }).catch(()=>{});
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState(): AudioPlayerState {
    return { ...this.state, playIntent: this.wantsPlay };
  }

  /** 音质等异步操作必须绑定当前播放代次，曲目 id 本身可能被曲库复用。 */
  getGeneration(): number { return this.generation; }

  /** 当前播放位置（秒）：直接读音频元素，比 state.currentTime（timeupdate 约 4Hz）更实时；没有音源时退回 state。 */
  position(): number {
    if (!this.el.getAttribute('src')) return this.state.currentTime;
    return this.el.currentTime || 0;
  }

  /** 播放指定歌曲；可选传入整个队列用于上一首/下一首。 */
  playSong(track: Track, queue?: Track[]): void {
    this.transientBackup = null;
    this.viaNextIdx.clear();
    if (queue && queue.length) {
      this.queue = queue;
    }
    if (!this.queue.length) {
      this.queue = [track];
    }
    const trackIdx = this.queue.findIndex((t) => t.id === track.id);
    const startIdx = trackIdx < 0 ? 0 : trackIdx;
    if (this.mode === 'random') {
      this.order = this.buildRandomOrder(false);
      const at = this.order.indexOf(startIdx);
      if (at > 0) {
        this.order.splice(at, 1);
        this.order.unshift(startIdx);
      }
      this.pos = 0;
    } else {
      this.order = this.buildIdentityOrder();
      this.pos = this.order.indexOf(startIdx);
      if (this.pos < 0) this.pos = 0;
    }
    this.failStreak = 0;
    this.retriedSongId = null;
    this.trialEndedId = null;
    this.consecutiveSkips = 0;
    this.loadAtOrder(this.pos);
  }

  /**
   * 播放单曲（网络搜索点播等）：不替换当前播放队列、不影响 Z2 卡片；
   * 该曲播放结束后（或用户切下一首时）自动接回原队列继续。
   */
  playTransient(track: Track): void {
    if (!this.queue.length || !this.state.song) {
      this.playSong(track, [track]);
      return;
    }
    this.viaNextIdx.clear();
    this.transientBackup ??= { queue: this.queue, order: [...this.order], pos: this.pos };
    this.queue = [track];
    this.order = [0];
    this.pos = 0;
    this.failStreak = 0;
    this.consecutiveSkips = 0;
    this.retriedSongId = null;
    this.trialEndedId = null;
    this.loadAtOrder(0);
  }

  /**
   * 换歌单但不打断当前播放（2026-11-14 用户确认）：新歌单成为播放队列，位置停在第一首之前（pos = -1）。
   * 当前这首继续播（暂停着就继续暂停）；它播完、出错跳过，或用户点「下一首」时，从新歌单第一首接上，
   * 语义等同「播放全部」（随机模式下按随机顺序）。用户直接点新歌单里的歌则照常播放。
   * 当前曲换成不会冲突的 id：曲目 id 是曲库下标，新曲库里同一下标是另一首歌，不能让星云把它标成「正在播放」。
   */
  adoptQueue(tracks: Track[]): void {
    this.transientBackup = null;
    this.viaNextIdx.clear();
    this.queue = tracks;
    this.order = this.mode === 'random' ? this.buildRandomOrder(false) : this.buildIdentityOrder();
    this.pos = -1;
    const cur = this.state.song;
    if (cur) {
      // 正在播的这首也在新歌单里（例如重新载入同一个歌单）：对上它在新队列里的位置，播完接它的下一首
      const idx = cur.sourceId
        ? tracks.findIndex((t) => t.source === cur.source && t.sourceId === cur.sourceId)
        : -1;
      if (idx >= 0) {
        if (this.mode === 'random') {
          this.order.splice(this.order.indexOf(idx), 1);
          this.order.unshift(idx);
        }
        this.pos = this.order.indexOf(idx);
        this.state.song = { ...cur, id: tracks[idx]!.id };
      } else {
        this.state.song = { ...cur, id: FOREIGN_SONG_ID };
      }
    }
    this.emit();
  }

  /**
   * 会话恢复「插播歌」：上次退出时正在播的歌不在歌单里（搜索 / 专辑 / 歌手页点播，或换歌单后留下的那首）。
   * 按插播的方式还原：屏幕上是那首歌，播完后接回歌单，从 resumeAfter 的下一首继续（-1 = 从第一首开始）。
   */
  restoreTransient(track: Track, queue: Track[], resumeAfter: number): void {
    this.cancelLoad();
    this.viaNextIdx.clear();
    const order = this.buildIdentityOrderFor(queue.length);
    this.transientBackup = { queue, order, pos: resumeAfter >= 0 && resumeAfter < queue.length ? resumeAfter : -1 };
    this.queue = [track];
    this.order = [0];
    this.pos = 0;
    this.state.song = track;
    this.state.currentTime = 0;
    this.state.duration = track.duration ?? 0;
    this.state.playing = false;
    this.state.loading = false;
    this.state.failed = false;
    this.state.error = null;
    this.emit();
  }

  /**
   * 会话记忆用：当前歌不在歌单里时，播完它之后歌单从哪首接着放。
   * 返回「已经播到的那首」的队列下标（-1 = 从第一首开始）；当前歌就在歌单里时返回 null。
   */
  getResumeIndex(): number | null {
    const b = this.transientBackup;
    if (b) return b.pos >= 0 && b.pos < b.order.length ? b.order[b.pos]! : -1;
    if (this.pos < 0) return -1;
    return null;
  }

  /** 恢复上次会话：设置当前歌曲与队列，但不自动播放、不加载音源。 */
  restore(track: Track, queue?: Track[]): void {
    this.cancelLoad();
    this.viaNextIdx.clear();
    if (queue && queue.length) {
      this.queue = queue;
    }
    if (!this.queue.length) this.queue = [track];
    this.order = this.buildIdentityOrder();
    const idx = this.queue.findIndex((t) => t.id === track.id);
    this.pos = idx < 0 ? 0 : idx;
    this.state.song = this.queue[this.pos] ?? track;
    this.state.currentTime = 0;
    this.state.duration = this.state.song.duration ?? 0;
    this.state.playing = false;
    this.state.loading = false;
    this.state.failed = false;
    this.state.error = null;
    this.emit();
  }

  /** 把歌曲插入到「下一首」段尾部（FIFO：先添加的先播；不打断当前播放）。 */
  insertNext(track: Track): void {
    if (!this.queue.length) {
      this.queue = [track];
      this.order = [0];
      this.pos = 0;
      this.viaNextIdx.clear();
      this.state.song = track;
      this.emit();
      return;
    }
    let idx = this.queue.findIndex((t) => t.id === track.id);
    if (idx < 0) {
      idx = this.queue.length;
      this.queue.push(track);
    }
    const existingAt = this.order.indexOf(idx);
    // 正在播放的就是它：不需要插队（以前会把当前项挪走，队列快照里的「当前」错位）
    if (existingAt === this.pos) return;
    if (existingAt >= 0) {
      this.order.splice(existingAt, 1);
      // 删掉的位置在当前曲之前：当前曲在 order 里的位置随之前移一位
      if (existingAt < this.pos) this.pos--;
    }
    // this.pos 本身就是当前曲在 order 里的位置（以前误写成 order.indexOf(pos)，只有顺序模式且未插过队时才碰巧对）。
    // 跳过已插入的「下一首」段，插到段尾，保证多首按添加顺序播放
    let insertAt = this.pos + 1;
    while (insertAt < this.order.length && this.viaNextIdx.has(this.order[insertAt]!)) insertAt++;
    this.order.splice(insertAt, 0, idx);
    this.viaNextIdx.add(idx);
    this.emit();
  }

  /** 队列快照（按实际播放顺序）：当前曲 + 即将播放。 */
  getQueueSnapshot(): { current: Track | null; upcoming: Track[] } {
    if (this.pos < 0 && this.queue.length) {
      // 刚换了歌单：当前曲是旧歌单留下的那首，即将播放 = 整份新队列
      return {
        current: this.state.song,
        upcoming: this.order.map((i) => this.queue[i]).filter((t): t is Track => !!t),
      };
    }
    if (this.pos < 0 || !this.queue.length || this.pos >= this.order.length) {
      return { current: null, upcoming: [] };
    }
    const current = this.queue[this.order[this.pos]!] ?? null;
    const upcoming = this.order
      .slice(this.pos + 1)
      .map((i) => this.queue[i])
      .filter((t): t is Track => !!t);
    return { current, upcoming };
  }

  /** 从「即将播放」中移除（当前项不可移除）。 */
  removeUpcoming(trackId: number): void {
    const qIdx = this.queue.findIndex((t) => t.id === trackId);
    if (qIdx < 0) return;
    const at = this.order.indexOf(qIdx);
    if (at <= this.pos) return;
    this.order.splice(at, 1);
    this.queue.splice(qIdx, 1);
    // 队列删除导致下标前移：统一重映射 order 与 viaNext 段
    this.order = this.order.map((i) => (i > qIdx ? i - 1 : i));
    const remapped = new Set<number>();
    for (const i of this.viaNextIdx) {
      if (i === qIdx) continue;
      remapped.add(i > qIdx ? i - 1 : i);
    }
    this.viaNextIdx = remapped;
    this.emit();
  }

  /** 跳转到队列中的指定曲目并播放（队列 UI 点击）。 */
  playQueueItem(trackId: number): void {
    const qIdx = this.queue.findIndex((t) => t.id === trackId);
    if (qIdx < 0) return;
    const at = this.order.indexOf(qIdx);
    if (at < 0) return;
    this.loadAtOrder(at);
  }

  toggle(): void {
    if (!this.state.song) return;
    if (this.wantsPlay && this.state.loading) {
      this.cancelLoad();
      this.state.loading = false;
      this.state.playing = false;
      this.state.error = null;
      this.emit();
      return;
    }
    // 会话恢复（restore）只设状态、不加载音源：第一次点播放时走完整的加载流程（解析音源、卡顿计时），
    // 以前直接对空 src 调 play()，会卡在「播放中 + 加载中」且没有声音
    if (!this.el.getAttribute('src')) {
      // 换歌单后留下的那首（pos < 0）不在队列里：直接加载屏幕上显示的这首
      if (this.pos < 0) this.loadTrack(this.state.song);
      else this.loadAtOrder(this.pos);
      return;
    }
    if (this.el.paused) {
      if (this.expired(this.state.song)) {
        this.loadTrack(this.state.song, this.el.currentTime || this.state.currentTime, true);
      } else {
        this.wantsPlay = true;
        this.state.loading = true;
        this.armStallTimer();
        this.playCurrent(this.generation);
      }
    } else {
      this.wantsPlay = false;
      this.clearStallTimer();
      this.el.pause();
    }
    this.emit();
  }

  next(): void {
    if (this.transientBackup) {
      const b = this.transientBackup;
      this.transientBackup = null;
      this.queue = b.queue;
      this.order = b.order;
      this.pos = b.pos;
    }
    if (!this.queue.length) return;
    if (this.queue.length === 1) {
      this.loadAtOrder(0);
      return;
    }
    this.pos++;
    if (this.pos >= this.order.length) {
      if (this.mode === 'random') {
        // 全歌单播完一轮后再洗牌，保证整轮内不重复
        this.order = this.buildRandomOrder(false);
      }
      this.pos = 0;
    }
    // 当前曲已消费：不再是「下一首」段
    this.viaNextIdx.delete(this.order[this.pos]!);
    this.loadAtOrder(this.pos);
  }

  prev(): void {
    if (!this.queue.length) return;
    // 当前曲是换歌单前留下的那首：没有「上一首」，回到它的开头
    if (this.pos < 0) {
      this.el.currentTime = 0;
      return;
    }
    if (this.queue.length === 1) {
      this.loadAtOrder(0);
      return;
    }
    this.pos = (this.pos - 1 + this.order.length) % this.order.length;
    this.loadAtOrder(this.pos);
  }

  seek(time: number): void {
    const d = this.state.duration;
    if (!(d > 0)) return;
    if (!Number.isFinite(time)) return;
    const at = Math.min(d, Math.max(0, time));
    if (this.state.song && this.expired(this.state.song)) {
      const play = this.wantsPlay;
      this.loadTrack(this.state.song, at, true, play);
    } else if (this.activeSource) {
      this.pendingSeek = at;
      this.el.currentTime = at;
      this.state.currentTime = at;
    } else {
      this.pendingSeek = at;
      this.state.currentTime = at;
    }
    this.emit();
  }

  setVolume(v: number): void {
    this.el.volume = Math.min(1, Math.max(0, v));
  }

  toggleMute(): void {
    this.el.muted = !this.el.muted;
  }

  setMode(mode: PlayMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.queue.length && this.state.song && this.pos < 0) {
      // 当前曲不属于这份队列（刚换了歌单）：只重排队列，位置仍停在第一首之前
      this.order = mode === 'random' ? this.buildRandomOrder(false) : this.buildIdentityOrder();
    } else if (this.queue.length && this.state.song) {
      const cur = this.pos >= 0 && this.pos < this.order.length ? this.order[this.pos] : 0;
      if (mode === 'random') {
        this.order = this.buildRandomOrder(true);
        this.pos = 0;
      } else {
        this.order = this.buildIdentityOrder();
        this.pos = this.order.indexOf(cur);
        if (this.pos < 0) this.pos = 0;
      }
    }
    this.state.mode = mode;
    this.emit();
  }

  /** 顺序播放 → 全局随机 → 单曲循环 循环切换（2026-11-13 用户拍板，与播放器母稿一致）。 */
  cycleMode(): void {
    const next: Record<PlayMode, PlayMode> = {
      sequential: 'random',
      random: 'repeat-one',
      'repeat-one': 'sequential',
    };
    this.setMode(next[this.mode]);
  }

  private buildIdentityOrder(): number[] {
    return this.queue.map((_, i) => i);
  }

  private buildIdentityOrderFor(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i);
  }

  /** Fisher-Yates 洗牌；keepCurrent 时把当前曲目固定到队首。 */
  private buildRandomOrder(keepCurrent: boolean): number[] {
    const n = this.queue.length;
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    if (keepCurrent && this.pos >= 0 && this.pos < this.order.length) {
      const cur = this.order[this.pos];
      const at = idx.indexOf(cur);
      if (at > 0) {
        idx.splice(at, 1);
        idx.unshift(cur);
      }
    }
    return idx;
  }

  private loadAtOrder(p: number): void {
    if (p < 0 || p >= this.order.length) return;
    this.pos = p;
    this.loadAt(this.order[p]);
  }

  setQualities(list: { level: string; label: string; needsVip?: boolean; needsSvip?: boolean }[]): void {
    this.state.qualities = list;
    this.emit();
  }

  /** 不中断播放地切换音源（音质切换用），保留当前进度与播放状态。 */
  switchSource(url: string, opts?: { quality?: string; keepTime?: boolean; via?: Track['via']; resolvedAt?:number; expiresAt?: number }): void {
    if (!this.state.song) return;
    const keep = opts?.keepTime !== false ? this.el.currentTime || 0 : 0;
    const wasPlaying = this.wantsPlay;
    this.state.song = {
      ...this.state.song,
      audio: url,
      quality: opts?.quality ?? this.state.song.quality,
      via: opts && 'via' in opts ? opts.via : this.state.song.via,
    };
    const track = this.state.song;
    (track as Track & {resolvedAt?:number}).resolvedAt=opts?.resolvedAt ?? Date.now();
    (track as Track & {expiresAt?:number}).expiresAt=opts?.expiresAt;
    this.cancelLoad();
    this.wantsPlay = wasPlaying;
    this.acceptResolved(track, this.generation, keep);
  }

  /** 手动设置提示信息（如音质切换失败）。 */
  setError(msg: string | null): void {
    this.state.error = msg;
    this.emit();
  }

  /** 停止并清空播放状态（导入新歌单时调用）。 */
  stop(): void {
    this.cancelLoad();
    this.transientBackup = null;
    this.queue = [];
    this.order = [];
    this.pos = -1;
    this.failStreak = 0;
    this.state = {
      song: null,
      playing: false,
      loading: false,
      currentTime: 0,
      duration: 0,
      volume: this.el.volume,
      muted: this.el.muted,
      failed: false,
      error: null,
      qualities: [],
      quality: '',
      mode: this.mode,
    };
    this.emit();
  }

  private loadAt(i: number): void {
    if (i < 0 || i >= this.queue.length) return;
    this.loadTrack(this.queue[i]!);
  }

  /** 取消这一代的网络、计时器与媒体；先静音，再发布新曲目信息。 */
  private cancelLoad(): void {
    this.discardWarm();
    this.generation++;
    this.request?.abort();
    this.request = null;
    this.clearStallTimer();
    if (this.skipTimer !== null) window.clearTimeout(this.skipTimer);
    this.skipTimer = null;
    this.wantsPlay = false;
    this.activeSource = false;
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
  }

  private timingFor(track: Track): SourceTiming {
    const metadata=track as Track & Partial<SourceTiming>;
    const known=this.sourceTimes.get(track);
    const same=known?.url===track.audio ? known : undefined;
    const resolvedAt=Number.isFinite(metadata.resolvedAt) && metadata.resolvedAt!>0 ? metadata.resolvedAt! : same?.resolvedAt ?? Date.now();
    const timing=sourceTiming(track.via?.platform || track.source || '',resolvedAt,metadata.expiresAt ?? same?.expiresAt);
    this.sourceTimes.set(track,{...timing,url:track.audio});
    return timing;
  }

  private expired(track: Track): boolean {
    if (track.source === 'local' || track.source === 'demo') return false;
    if (!track.audio) return false;
    return this.timingFor(track).expiresAt <= Date.now() + 5000;
  }

  private loadTrack(track: Track, at = 0, forceRefresh = false, play = true): void {
    const refresh = forceRefresh || this.expired(track);
    const warm=!forceRefresh && this.warm?.key===this.identity(track) && this.warm.track && !this.expired(this.warm.track) && !this.warm.el?.error ? this.warm : null;
    if (warm) this.warm=null;
    this.cancelLoad();
    if (warm?.el && warm.track) {
      this.bindMedia(this.el,false);
      warm.el.volume=this.state.volume;warm.el.muted=this.state.muted;
      this.el=warm.el;this.bindMedia(this.el,true);
      track={...warm.track,id:track.id};
    }
    this.wantsPlay = play;
    this.pendingSeek = at;
    this.retriedSongId = null;
    this.trialEndedId = null;
    this.state.song = track;
    this.state.currentTime = at;
    this.state.duration = track.duration ?? 0;
    this.state.playing = false;
    this.state.loading = true;
    this.state.failed = false;
    this.state.qualities = [];
    this.state.quality = track.quality ?? '';
    this.state.error = !track.audio || refresh ? '正在获取音源…' : null;
    this.emit();
    if (!track.audio || (refresh && !warm)) this.resolveTrack(track, refresh ? 'error' : 'empty', refresh);
    else this.acceptResolved(track, this.generation, at);
  }

  private resolveTrack(track: Track, reason: 'empty' | 'error', forceRefresh: boolean): void {
    const resolver = reason === 'error' ? this.retryResolver ?? this.emptyResolver : this.emptyResolver ?? this.retryResolver;
    if (!resolver) { this.skipAfterFail(); return; }
    const generation = this.generation;
    const request = new AbortController();
    this.request?.abort();
    this.request = request;
    this.armStallTimer();
    void Promise.resolve().then(() => resolver(track, reason, { signal: request.signal, forceRefresh })).then(resolved => {
      if (generation !== this.generation || request.signal.aborted) return;
      this.request = null;
      if (!resolved?.audio) { this.skipAfterFail(); return; }
      // 换歌单会重映射曲库下标；异步结果不能把旧下标写回。
      this.acceptResolved({ ...resolved, id: this.state.song?.id ?? resolved.id }, generation, this.pendingSeek);
    }).catch((error:unknown) => {
      if (generation === this.generation && !request.signal.aborted) this.skipAfterFail(error instanceof Error ? error.message : undefined);
    });
  }

  private acceptResolved(track: Track, generation: number, at: number): void {
    if (generation !== this.generation) return;
    this.clearStallTimer();
    this.state.song = {...track,...this.timingFor(track)};
    this.state.quality = track.quality ?? '';
    this.state.failed = false;
    this.state.loading = this.wantsPlay;
    this.state.playing = false;
    this.state.error = null;
    this.pendingSeek = at;
    this.activeSource = true;
    if (this.el.getAttribute('src') !== track.audio) this.el.src = track.audio;
    try { this.el.currentTime = at; } catch { /* 元数据就绪时再定位 */ }
    this.emit();
    if (this.wantsPlay) { this.armStallTimer(); this.playCurrent(generation); }
  }

  private playCurrent(generation: number): void {
    void this.el.play()?.catch((error: unknown) => {
      if (generation !== this.generation || !this.wantsPlay) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        this.wantsPlay = false;
        this.clearStallTimer();
        this.el.pause();
        this.state.playing = false;
        this.state.loading = false;
        this.state.error = '请点播放继续';
        this.emit();
      } else this.onError();
    });
  }

  private emit(): void { this.prefetch(); for (const fn of this.listeners) fn(); }

  private onTimeUpdate = (): void => {
    if (!this.activeSource || !this.el.getAttribute('src')) return;
    this.state.currentTime = this.el.currentTime || 0;
    const song = this.state.song;
    if (song?.trialEndTime && this.wantsPlay && this.state.currentTime * 1000 >= song.trialEndTime) {
      this.endTrial();
      return;
    }
    this.emit();
  };

  private onMeta = (): void => {
    if (!this.activeSource) return;
    if (Number.isFinite(this.el.duration)) this.state.duration = this.el.duration;
    if (this.pendingSeek > 0) {
      try {
        this.el.currentTime = Math.min(this.pendingSeek, this.state.duration || this.pendingSeek);
        this.state.currentTime = this.el.currentTime;
        this.pendingSeek = 0;
      } catch { /* 等待下一次有效元数据 */ }
    }
    this.emit();
  };

  private onPlay = (): void => {
    if (!this.activeSource || !this.wantsPlay) return;
    // play 只表示收到播放请求，真正出流由 playing 事件确认。
    this.state.loading = true;
    this.emit();
  };

  private onPlaying = (): void => {
    if (!this.activeSource || !this.wantsPlay || this.el.paused) return;
    this.state.loading = false;
    this.state.failed = false;
    this.state.playing = true;
    this.failStreak = 0;
    this.consecutiveSkips = 0;
    this.state.error = null;
    this.clearStallTimer();
    this.emit();
  };

  private onPause = (): void => {
    if (!this.activeSource || !this.el.paused) return;
    this.state.playing = false;
    if (!this.wantsPlay) this.state.loading = false;
    this.emit();
  };

  private onWaiting = (): void => {
    if (!this.activeSource || !this.wantsPlay) return;
    this.state.playing = false;
    this.state.loading = true;
    this.armStallTimer();
    this.emit();
  };

  private endTrial(): void {
    if (this.trialEndedId === this.state.song?.id) return;
    this.trialEndedId = this.state.song?.id ?? null;
    this.wantsPlay = false;
    this.clearStallTimer();
    this.el.pause();
    this.state.playing = false;
    this.state.loading = false;
    this.state.error = '试听片段已结束（完整播放需更高会员权益或登录）';
    this.emit();
  }

  private onEnded = (): void => {
    if (!this.activeSource || !this.wantsPlay || !this.el.ended) return;
    if (this.state.song?.trial) { this.endTrial(); return; }
    this.state.playing = false;
    this.emit();
    if (this.mode === 'repeat-one' && !this.transientBackup && this.pos >= 0) {
      if (this.state.song && !this.expired(this.state.song)) { this.el.currentTime=0;this.playCurrent(this.generation); }
      else if (this.state.song) this.loadTrack(this.state.song);
      return;
    }
    this.next();
  };

  private onVolume = (): void => {
    this.state.volume = this.el.volume;
    this.state.muted = this.el.muted;
    this.emit();
  };

  private onError = (): void => {
    if (!this.activeSource || !this.wantsPlay) return;
    const track = this.state.song;
    if (!track) return;
    const at = this.el.currentTime || this.state.currentTime;
    this.activeSource = false;
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    this.state.playing = false;
    this.state.loading = true;
    this.state.error = '音源中断，正在重新获取…';
    this.pendingSeek = at;
    this.emit();
    if (this.retriedSongId === track.id) { this.skipAfterFail(); return; }
    this.retriedSongId = track.id;
    this.resolveTrack(track, 'error', true);
  };

  private skipAfterFail(reason?:string): void {
    const continueQueue = this.wantsPlay;
    this.cancelLoad();
    const generation = this.generation;
    this.state.failed = true;
    this.state.loading = false;
    this.state.playing = false;
    this.state.error = reason || '未获取到可播音源';
    this.failStreak++;
    this.consecutiveSkips++;
    if (this.consecutiveSkips >= 6 || this.failStreak >= Math.max(1, this.queue.length)) {
      this.state.error = reason || `连续 ${this.failStreak} 首播放失败，已停止自动跳歌`;
      this.emit();
      return;
    }
    this.emit();
    if (continueQueue) this.skipTimer = window.setTimeout(() => {
      this.skipTimer = null;
      if (generation === this.generation && this.state.failed) this.next();
    }, 350);
  }

  /** 取链与播放缓冲均有上限；waiting 时也重新启动保护。 */
  private armStallTimer(): void {
    this.clearStallTimer();
    const generation = this.generation;
    this.stallTimer = window.setTimeout(() => {
      this.stallTimer = null;
      if (generation !== this.generation || !this.state.loading) return;
      if (this.activeSource) this.onError();
      else this.skipAfterFail();
    }, 10000);
  }

  private clearStallTimer(): void {
    if (this.stallTimer !== null) window.clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }
}

export const audioPlayer = new AudioPlayer();
