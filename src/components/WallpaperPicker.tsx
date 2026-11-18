import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useOverlayScrollbar } from '../lib/overlayScrollbar';
import { IconClose } from './icons';
import './modals.css';
import type { DesktopWallpaperItem, DesktopWallpaperSetResult } from '../lib/playlist/ipcClient';
import { hasDesktopAPI } from '../lib/playlist/ipcClient';

interface WallpaperPickerProps {
  onClose: () => void;
  onApply: (item: DesktopWallpaperItem, result: DesktopWallpaperSetResult) => void;
}

function kindLabel(item: DesktopWallpaperItem): string {
  if (item.playable && item.mediaType === 'video') return '视频壁纸';
  if (item.playable && item.mediaType === 'image') return '静态壁纸';
  if (item.enginePlayable) return '场景壁纸 · 需 Wallpaper Engine';
  return '网页/交互壁纸 · 暂不支持';
}

const SHELL_STYLE = { '--mdl-w': '1100px' } as CSSProperties;

/**
 * 本机 Wallpaper Engine 壁纸库（Steam 创意工坊 + 本地项目）。
 * 外壳与信息弹窗同一套（NEBULA_UI_SYSTEM §9.4）：遮罩是同级的独立一层，Esc / 点遮罩 / 右上角关闭，
 * 进出 = 透明度 + 8px 位移；网格是唯一的滚动容器。
 */
export function WallpaperPicker({ onClose, onApply }: WallpaperPickerProps) {
  const [items, setItems] = useState<DesktopWallpaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [weInstalled, setWeInstalled] = useState(false);
  const [weLaunchUrl, setWeLaunchUrl] = useState('');
  const [hint, setHint] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef(0);
  useOverlayScrollbar(gridRef);

  /** 收起：先播 0.28s 退出动画，再通知上层卸载。 */
  const requestClose = useCallback(() => {
    if (leaveTimer.current) return;
    setLeaving(true);
    leaveTimer.current = window.setTimeout(onClose, 280);
  }, [onClose]);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  // §9.4：Esc 关闭；关闭后焦点回到打开它的元素
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [requestClose]);

  useEffect(() => {
    if (!hasDesktopAPI()) {
      setError('壁纸库仅桌面版可用');
      setLoading(false);
      return;
    }
    let cancelled = false;
    window.nebulaAPI!
      .wallpaperList()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setItems(res.data);
        else setError(res.error);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    window.nebulaAPI!
      .wallpaperInfo()
      .then((res) => {
        if (!cancelled && res.ok) {
          setWeInstalled(res.data.weInstalled);
          setWeLaunchUrl(res.data.weLaunchUrl);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 性能：仅播放视野内的预览视频，降低解码压力与滚动卡顿
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const v = entry.target.querySelector('video');
          if (!v) continue;
          if (entry.isIntersecting) void v.play().catch(() => {});
          else v.pause();
        }
      },
      { root: grid, rootMargin: '140px' },
    );
    for (const card of grid.querySelectorAll<HTMLElement>('.wp-card')) io.observe(card);
    return () => io.disconnect();
  }, [items.length]);

  const apply = async (item: DesktopWallpaperItem): Promise<void> => {
    setHint('');
    if (!hasDesktopAPI()) return;
    const res = await window.nebulaAPI!.wallpaperSet(item.id);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if ('unsupported' in res.data) {
      // 场景壁纸：启动 Wallpaper Engine（完整注入为独立子系统）
      if (item.enginePlayable && weInstalled && weLaunchUrl) {
        void window.nebulaAPI!.openExternal(weLaunchUrl);
        setHint('已启动 Wallpaper Engine，请在 WE 中选择该壁纸应用');
      } else {
        setHint(res.data.reason);
      }
      return;
    }
    onApply(item, res.data);
    requestClose();
  };

  return (
    <div className={`info-overlay${leaving ? ' is-out' : ''}`}>
      {/* 遮罩独立一层：点它关闭；面板不以它为祖先，G3 玻璃才能采到背后画面 */}
      <div className="info-veil" onPointerDown={requestClose} />
      <div className="info-modal glass-g3 wps-panel" style={SHELL_STYLE} role="dialog" aria-label="Wallpaper Engine 壁纸库">
        <button type="button" className="mdl-x" aria-label="关闭" onClick={requestClose}>
          <IconClose size={18} />
        </button>
        <div className="sht-head">
          <div className="sht-text">
            <h2 className="sht-title">Wallpaper Engine 壁纸库</h2>
          </div>
        </div>
        {hint && <div className="wps-hint is-note">{hint}</div>}
        {loading && <div className="wps-hint">正在扫描本机壁纸…</div>}
        {error && <div className="wps-hint is-error">{error}</div>}
        {!loading && !error && items.length === 0 && (
          <div className="wps-hint">未发现壁纸（检查 Steam 创意工坊 431960 或本地项目目录）</div>
        )}
        <div className="wp-grid" ref={gridRef}>
          {items.map((item) => (
            <button
              key={item.id}
              className="wp-card"
              onClick={() => void apply(item)}
              data-tip={item.playable ? '点击设为背景' : kindLabel(item)}
            >
              <div className="wp-preview">
                {item.playable && item.mediaType === 'video' && item.mediaUrl ? (
                  <video src={item.mediaUrl} autoPlay muted loop playsInline />
                ) : item.previewUrl ? (
                  <img src={item.previewUrl} alt="" loading="lazy" />
                ) : (
                  <span className="wp-ph" />
                )}
                {!item.playable && <span className="wp-badge">不可播放</span>}
              </div>
              <div className="wp-meta">
                <span className="wp-name">{item.title}</span>
                <span className="wp-kind">{kindLabel(item)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
