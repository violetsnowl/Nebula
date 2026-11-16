import { memo, useEffect, useRef, useState } from 'react';
import { qualityCode, qualityName } from '../../lib/quality';

interface QualityControlProps {
  qualities: { level: string; label: string; needsVip?: boolean; needsSvip?: boolean }[];
  quality: string;
  /** 跨平台兜底供流时的平台名：弹层标题下注明档位来自哪个平台 */
  source?: string;
  onSelectQuality: (level: string) => void;
}

/**
 * 音质：低权重文字徽章按钮；点击开关，弹层水平居中于按钮，选择后关闭，
 * 点击外部 / Escape 关闭。取代旧的 hover 弹窗（悬停间隙导致抽搐、常显关不掉）。
 */
export const QualityControl = memo(function QualityControl({
  qualities,
  quality,
  source,
  onSelectQuality,
}: QualityControlProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // 列表里没有当前档位（没有歌曲、或平台给了列表外的一档）时用通用中文名兜底，绝不把原始英文标识露给用户
  const qualityLabel = qualities.find((o) => o.level === quality)?.label ?? (qualityName(quality) || '音质');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="quality-ctl" ref={rootRef}>
      <button
        className={`bp-ctrl bp-quality${open ? ' is-active' : ''}`}
        aria-label={`音质：${qualityLabel}`}
        data-tip={open ? undefined : `音质：${qualityLabel}`}
        onClick={() => setOpen((o) => !o)}
      >
        {/* 按钮上写代号，悬停提示与弹层给全称（NEBULA_UI_SYSTEM §9.1） */}
        <span className="quality-badge">{qualityCode(qualityLabel)}</span>
      </button>
      {open && (
        <div className="quality-pop glass-g3">
          <div className="queue-pop-title">
            音质
            {source && <span className="quality-src">{source}音源</span>}
          </div>
          {qualities.map((o) => (
            <button
              key={o.level}
              className={`quality-item${o.level === quality ? ' is-current' : ''}`}
              onClick={() => {
                onSelectQuality(o.level);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
