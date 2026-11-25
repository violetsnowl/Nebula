import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useAudioPlayer } from '../../lib/audio/useAudioPlayer';
import type { Track } from '../../lib/catalog';
import type { LyricLineUI } from '../../lib/lyrics';
import type { DesktopTrack } from '../../lib/playlist/ipcClient';
import type { LyricSourceSummary } from '../../lib/lyricVersions';
import { setListenSettings, useListenSettings, type ListenSettings } from '../../lib/listen/settings';
import { useBigCover } from '../../lib/listen/bigCover';
import { applyListenLayout } from '../../lib/listen/layout';
import { placeholderBg } from '../../lib/coverPlaceholder';
import { qualityName } from '../../lib/quality';
import { InfoPane, type InfoPaneState } from '../InfoModals';
import { IconChevronRight } from '../icons';
import { LyricColumn } from './LyricColumn';
import './listen-space.css';

/**
 * 听音空间（NEBULA_UI_SYSTEM §9.9，样张 I + J）：整屏，不是弹窗。
 *
 * 层级：
 *   - `.ls-root`（z 45）：在舞台、星云歌词之上，播放条（z 50）之下。里面依次是遮罩（模糊压暗背后的星云）、
 *     封面光、左侧信息、右侧歌词栏 / 详情。根层本身不设 opacity / filter / mask：
 *     遮罩的 backdrop-filter 要能采到背后的星云，歌词的环境透色（plus-lighter）要能和遮罩混合。
 *   - `.ls-hero`（z 55）：大封面单独一层，高于播放条——飞回播放条时全程在玻璃之上，不会被播放条的雾层糊住。
 *
 * 进入 / 收起都是同一个大封面元素逐帧插值（一镜到底）：收起时每帧重新量播放条封面的真实位置（播放条同时在展开），
 * 落地那一帧和小封面重合并直接交接。
 */

type Phase = 'closed' | 'in' | 'open' | 'out';

interface Rect {
  x: number;
  y: number;
  w: number;
}

const FLY_MS = 600;
const SH_BIG = [30, 70, 0.5] as const;
const SH_SMALL = [4, 14, 0.35] as const;
const R_BIG = 18;
const R_SMALL = 10;

/** cubic-bezier(0.2, 0, 0, 1)：按 x 二分求 y（ease-std）。 */
function easeStd(x: number): number {
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
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function barCover(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-np-cover]');
}
function rectOf(el: Element | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  return { x: r.left, y: r.top, w: r.width };
}

/** 大封面的画面：有图用图，没图用占位渐变。key 用来判断是不是换了一张。 */
interface Art {
  key: string;
  url: string;
  style: CSSProperties;
}
const ART_FADE_MS = 700;

/**
 * 切歌时大封面交叉淡化（#131）：新封面先在后台解码好，再一次性换上；旧封面盖在上面 0.7 秒淡出。
 * 解码完成前一直显示旧封面，不会闪空白；连续切歌时只认最后一次。
 */
function useArtCrossfade(art: Art): { cur: Art; prev: Art | null } {
  const [cur, setCur] = useState(art);
  const [prev, setPrev] = useState<Art | null>(null);
  const curRef = useRef(cur);
  curRef.current = cur;
  useEffect(() => {
    if (art.key === curRef.current.key) return;
    let cancelled = false;
    let timer = 0;
    const swap = () => {
      if (cancelled) return;
      setPrev(curRef.current);
      setCur(art);
      timer = window.setTimeout(() => setPrev(null), ART_FADE_MS + 100);
    };
    if (art.url) {
      const img = new Image();
      img.src = art.url;
      img.decode().then(swap, swap);
    } else swap();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art.key]);
  return { cur, prev };
}

/**
 * 读音开关（#161 罗马音，#172 日语假名注音，#173 面板）：歌词栏右下角、翻译按钮左边，图标是带长音符号的 ā。
 * 点 = 开关读音。日语歌悬停 0.25 秒或右键弹出小面板：「罗马音」「汉字注音」各自勾选，可以一起开，至少留一个；
 * 在面板里勾选时顺便打开读音。悬停打开的移开就收；右键打开的点别处或 Esc 才收。
 */
function ReadingButton({ settings, japanese, solo }: { settings: ListenSettings; japanese: boolean; solo: boolean }) {
  const [pop, setPop] = useState<'hover' | 'pinned' | null>(null);
  const timer = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (pop !== 'pinned') return;
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setPop(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      setPop(null);
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, [pop]);
  const enter = () => {
    if (japanese && pop !== 'pinned') later(() => setPop((p) => p ?? 'hover'), 250);
  };
  const leave = () => {
    if (pop !== 'pinned') later(() => setPop((p) => (p === 'hover' ? null : p)), 250);
    else window.clearTimeout(timer.current);
  };
  const pick = (key: 'jaRoman' | 'jaKana') => {
    const next = !settings[key];
    // 至少留一种：最后一个勾不掉
    if (!next && !(key === 'jaRoman' ? settings.jaKana : settings.jaRoman)) return;
    setListenSettings(next && !settings.roman ? { [key]: next, roman: true } : { [key]: next });
  };
  const rows: Array<{ key: 'jaRoman' | 'jaKana'; label: string; hint: string }> = [
    { key: 'jaKana', label: '汉字注音', hint: '汉字上方标平假名' },
    { key: 'jaRoman', label: '罗马音', hint: '原文下面一行' },
  ];
  return (
    <div className={`ls-rdwrap${solo ? ' is-solo' : ''}`} ref={wrapRef} onMouseEnter={enter} onMouseLeave={leave}>
      {pop && (
        <div className="ls-rdpop glass-g3" role="menu" aria-label="日语读音">
          <div className="ls-rdpop-title">日语读音</div>
          {rows.map((r) => {
            const on = settings[r.key];
            const last = on && !(r.key === 'jaRoman' ? settings.jaKana : settings.jaRoman);
            return (
              <button
                key={r.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                className={`ls-rdpop-item${on ? ' is-on' : ''}${last ? ' is-last' : ''}`}
                data-tip={last ? '至少留一种' : undefined}
                onClick={() => pick(r.key)}
              >
                <span className="ls-rdpop-lbl">
                  {r.label}
                  <small>{r.hint}</small>
                </span>
                <svg className="ls-rdpop-ck" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        className="ls-trb ls-rob"
        aria-pressed={settings.roman}
        aria-label="读音"
        aria-haspopup={japanese ? 'menu' : undefined}
        data-tip={pop ? undefined : settings.roman ? '读音：开' : '读音：关'}
        onClick={() => setListenSettings({ roman: !settings.roman })}
        onContextMenu={(e) => {
          if (!japanese) return;
          e.preventDefault();
          window.clearTimeout(timer.current);
          setPop((p) => (p === 'pinned' ? null : 'pinned'));
        }}
      >
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8.2 5.5h7.6" />
          <path d="M15.6 14.6a3.6 3.6 0 1 1-7.2 0a3.6 3.6 0 1 1 7.2 0M15.6 10.6v7.9" />
        </svg>
      </button>
    </div>
  );
}

interface ListenSpaceProps {
  open: boolean;
  onClose: () => void;
  lines: LyricLineUI[];
  /** 右栏正在显示的详情（null = 歌词）。 */
  pane: InfoPaneState | null;
  onPaneBack: () => void;
  onOpenSongDetail: () => void;
  /** 歌词栏上右键 / 「关于这首歌」里的「歌词」行：右栏换到「歌词版本」。 */
  onOpenLyricVersions: () => void;
  /** 当前歌词的来源摘要（来自 useLyrics 的 lyricDebugInfo）。 */
  lyricInfo: LyricSourceSummary | null;
  onOpenArtistByName: (name: string, track?: Track) => void;
  onOpenArtist: (platform: string, artistId: string, name: string) => void;
  onOpenAlbum: (platform: string, albumId: string, albumName: string, artistName?: string) => void;
  onOpenComments: (track: Track) => void;
  onPlayArtistTrack: (track: DesktopTrack) => void;
}

export const ListenSpace = memo(function ListenSpace({
  open,
  onClose,
  lines,
  pane,
  onPaneBack,
  onOpenSongDetail,
  onOpenLyricVersions,
  lyricInfo,
  onOpenArtistByName,
  onOpenArtist,
  onOpenAlbum,
  onOpenComments,
  onPlayArtistTrack,
}: ListenSpaceProps) {
  const state = useAudioPlayer();
  const settings = useListenSettings();
  const song = state.song;
  const [phase, setPhase] = useState<Phase>('closed');
  const heroRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const curRef = useRef<Rect | null>(null);

  // 大封面用实测够清楚的原图（#158）：先小图，大图后台解码好再淡入换上
  const cover = useBigCover(song ?? null, open);
  // 没有封面图的歌（本地 / 演示 / 后端没拿到）：和播放条封面同一个低饱和占位
  const art = useArtCrossfade(
    cover
      ? { key: cover, url: cover, style: { backgroundImage: `url(${JSON.stringify(cover)})` } }
      : { key: `ph-${song?.hue1 ?? ''}-${song?.hue2 ?? ''}`, url: '', style: { background: placeholderBg(song?.hue1, song?.hue2) } },
  );
  const hasTranslation = lines.some((l) => !!l.translation);
  // 有读音（罗马音或假名注音，#172）才出现读音开关
  const hasRoman = lines.some((l) => !!l.roman || !!l.ruby?.length);
  // 日语歌（#173）：读音按钮带一个悬停 / 右键小面板，选罗马音、汉字注音
  const hasJa = lines.some((l) => !!l.ja);

  // 大封面逐帧插值：只改 transform / 圆角 / 阴影（都按真实尺寸换算），封面本身不做任何模糊或变暗
  const paint = useCallback((r: Rect, slot: Rect) => {
    const hero = heroRef.current;
    if (!hero) return;
    const s = r.w / slot.w;
    const big = Math.min(1, Math.max(0, (r.w - 48) / Math.max(1, slot.w - 48)));
    const radius = lerp(R_SMALL, R_BIG, big);
    const oy = lerp(SH_SMALL[0], SH_BIG[0], big);
    const bl = lerp(SH_SMALL[1], SH_BIG[1], big);
    const al = lerp(SH_SMALL[2], SH_BIG[2], big);
    hero.style.transform = `translate(${(r.x - slot.x).toFixed(2)}px, ${(r.y - slot.y).toFixed(2)}px) scale(${s.toFixed(5)})`;
    hero.style.borderRadius = `${(radius / s).toFixed(2)}px`;
    hero.style.boxShadow = `0 ${(oy / s).toFixed(2)}px ${(bl / s).toFixed(2)}px rgba(0,0,0,${al.toFixed(3)})`;
  }, []);

  const clearPaint = useCallback(() => {
    const hero = heroRef.current;
    if (!hero) return;
    hero.style.transform = '';
    hero.style.borderRadius = '';
    hero.style.boxShadow = '';
  }, []);

  const fly = useCallback(
    (dir: 'in' | 'out') => {
      cancelAnimationFrame(rafRef.current);
      const slot = rectOf(slotRef.current);
      const bc = barCover();
      if (!slot) return;
      const from = curRef.current ?? (dir === 'in' ? rectOf(bc) : slot) ?? slot;
      if (bc) bc.style.visibility = 'hidden';
      // 起点先同步摆好（在浏览器绘制之前），否则大封面会在终点位置闪一帧
      paint(from, slot);
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / FLY_MS);
        const e = easeStd(k);
        // 收起：落点每帧重新量（播放条在展开）；量不到时退回大封面原位
        const to = dir === 'in' ? slot : rectOf(barCover()) ?? slot;
        const r = { x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e), w: lerp(from.w, to.w, e) };
        curRef.current = r;
        paint(r, slot);
        if (k < 1) {
          rafRef.current = requestAnimationFrame(step);
          return;
        }
        curRef.current = null;
        if (dir === 'in') {
          clearPaint();
          setPhase('open');
        } else {
          // 落地这一帧：小封面显示、大封面卸下，同一帧交接，没有淡入淡出。
          // 收起分支不提前 clearPaint：React 卸载若晚一帧，清空 transform 会让大封面在左侧槽原位闪一帧残影。
          const b = barCover();
          if (b) b.style.visibility = '';
          setPhase('closed');
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [paint, clearPaint],
  );

  // 水平布局按窗口尺寸算（#129）：起飞前就要写好，位置槽要按它量
  useLayoutEffect(() => {
    applyListenLayout();
    window.addEventListener('resize', applyListenLayout);
    return () => window.removeEventListener('resize', applyListenLayout);
  }, []);

  // open 变化 → 起飞。phase 先切到 in/out 让 DOM 就位，下一帧再量位置
  useEffect(() => {
    if (open && (phase === 'closed' || phase === 'out')) setPhase('in');
    else if (!open && (phase === 'open' || phase === 'in')) setPhase('out');
  }, [open, phase]);
  // 布局完成、绘制之前起飞：这时位置槽已经在 DOM 里，可以量
  useLayoutEffect(() => {
    if (phase === 'in' || phase === 'out') fly(phase);
  }, [phase, fly]);
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      const b = barCover();
      if (b) b.style.visibility = '';
    },
    [],
  );

  // Esc：右栏有详情先回歌词，再收起听音空间；其他浮层（队列 / 音质 / 音量弹层、右键菜单、打开的侧面板）开着时让给它们
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.queue-pop, .quality-pop, .vol-pop, .ctx-menu, .sd-panel.is-open, .info-overlay, .ls-rdpop')) return;
      if (pane) onPaneBack();
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pane, onPaneBack, onClose]);

  if (phase === 'closed') return null;
  const shown = phase === 'in' || phase === 'open';
  const heroStyle = art.cur.style;
  const prevArt = art.prev && <i key={art.prev.key} className="ls-art-prev" style={art.prev.style} aria-hidden="true" />;
  const artistName = song?.artist ?? '';
  const albumLine = [song?.album, qualityName(song?.quality)].filter(Boolean).join(' · ');

  return (
    <>
      <div className={`ls-root${shown ? ' is-shown' : ''}${pane ? ' has-pane' : ''}`} data-playing={state.playing ? '1' : '0'} data-font={settings.font}>
        <div className="ls-veil" aria-hidden="true" />
        <div className="ls-light" aria-hidden="true" />
        <button type="button" className="ls-exit" aria-label="收起听音空间" data-tip="收起（Esc）" data-tip-side="right" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9.5l6 6 6-6" />
          </svg>
        </button>
        {/* 大封面的位置槽：飞行的起点 / 终点按它量；它身后是封面自己的发光副本 */}
        <div className="ls-slot" ref={slotRef}>
          <div className="ls-glow" style={heroStyle} aria-hidden="true">
            {prevArt}
          </div>
        </div>
        <div className="ls-meta">
          <button type="button" className="ls-link ls-title" onClick={onOpenSongDetail} disabled={!song}>
            <span>{song?.title ?? ''}</span>
            <IconChevronRight size={18} />
          </button>
          <button type="button" className="ls-link ls-artist" onClick={() => song && onOpenArtistByName(artistName.split(/[\/、&,，]/)[0]!.trim(), song)} disabled={!artistName}>
            <span>{artistName}</span>
            <IconChevronRight size={14} />
          </button>
          {albumLine && (
            <button
              type="button"
              className="ls-link ls-album"
              disabled={!song?.album}
              onClick={() => song?.album && onOpenAlbum(song.source, '', song.album, artistName.split(/[\/、&,，]/)[0]!.trim())}
            >
              <span>{albumLine}</span>
              <IconChevronRight size={12} />
            </button>
          )}
        </div>
        {/* 歌词栏上右键 = 歌词版本（阻止系统菜单）；读音 / 翻译按钮上不触发，读音按钮自己的右键面板不受影响 */}
        <div
          className="ls-col"
          onContextMenu={(e) => {
            if ((e.target as Element).closest('.ls-rdwrap, .ls-trb')) return;
            e.preventDefault();
            onOpenLyricVersions();
          }}
        >
          <LyricColumn className="ls-lyrics" lines={lines} settings={settings} />
          {hasRoman && <ReadingButton settings={settings} japanese={hasJa} solo={!hasTranslation} />}
          {hasTranslation && (
            <button
              type="button"
              className="ls-trb"
              aria-pressed={settings.translation}
              aria-label="翻译"
              data-tip={settings.translation ? '翻译：开' : '翻译：关'}
              onClick={() => setListenSettings({ translation: !settings.translation })}
            >
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3.5 6h9M8 4v2M5.5 6c.7 2.8 2.5 4.9 5 6M10.5 6c-.8 3-2.8 5.3-6 6.5" />
                <path d="M12.5 20.5l4-9.5 4 9.5M13.9 17.5h5.2" />
              </svg>
            </button>
          )}
        </div>
        <div className="ls-pane-host">
          {pane && (
            <InfoPane
              key={`${pane.kind}-${pane.artistId ?? ''}-${pane.albumId ?? ''}-${pane.albumName ?? ''}`}
              pane={pane}
              onBack={onPaneBack}
              onOpenArtist={onOpenArtist}
              onOpenAlbum={onOpenAlbum}
              onOpenComments={onOpenComments}
              onOpenLyrics={onOpenLyricVersions}
              lyricInfo={lyricInfo}
              onPlayArtistTrack={onPlayArtistTrack}
            />
          )}
        </div>
      </div>
      {song && (
        <div
          ref={heroRef}
          className={`ls-hero${phase === 'open' ? ' is-rest' : ''}`}
          style={heroStyle}
          aria-hidden="true"
        >
          {prevArt}
        </div>
      )}
    </>
  );
});

