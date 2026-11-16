import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useAudioPlayer } from '../../lib/audio/useAudioPlayer';
import type { Track } from '../../lib/catalog';
import type { LyricLineUI } from '../../lib/lyrics';
import type { DesktopTrack } from '../../lib/playlist/ipcClient';
import { setListenSettings, useListenSettings } from '../../lib/listen/settings';
import { hiResCover } from '../../lib/listen/coverUrl';
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

interface ListenSpaceProps {
  open: boolean;
  onClose: () => void;
  lines: LyricLineUI[];
  /** 右栏正在显示的详情（null = 歌词）。 */
  pane: InfoPaneState | null;
  onPaneBack: () => void;
  onOpenSongDetail: () => void;
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

  const cover = song?.cover ? hiResCover(song.cover) : '';
  const hasTranslation = lines.some((l) => !!l.translation);

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
          // 落地这一帧：小封面显示、大封面卸下，同一帧交接，没有淡入淡出
          const b = barCover();
          if (b) b.style.visibility = '';
          clearPaint();
          setPhase('closed');
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [paint, clearPaint],
  );

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
      if (document.querySelector('.queue-pop, .quality-pop, .vol-pop, .ctx-menu, .sd-panel.is-open, .info-overlay')) return;
      if (pane) onPaneBack();
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pane, onPaneBack, onClose]);

  if (phase === 'closed') return null;
  const shown = phase === 'in' || phase === 'open';
  // 没有封面图的歌（本地 / 演示）：和播放条封面一样用色相渐变
  const heroStyle: CSSProperties = cover
    ? { backgroundImage: `url(${JSON.stringify(cover)})` }
    : { background: `linear-gradient(135deg, hsl(${song?.hue1 ?? 220} 70% 58%), hsl(${song?.hue2 ?? 280} 72% 34%))` };
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
          <div className="ls-glow" style={heroStyle} aria-hidden="true" />
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
        <div className="ls-col">
          <LyricColumn className="ls-lyrics" lines={lines} settings={settings} />
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
        />
      )}
    </>
  );
});

