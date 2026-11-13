import { memo, useEffect, useRef, useState } from 'react';

interface QualityControlProps {
  qualities: { level: string; label: string; needsVip?: boolean; needsSvip?: boolean }[];
  quality: string;
  onSelectQuality: (level: string) => void;
}

const FALLBACK_QUALITY_LABEL: Record<string, string> = {
  standard: '标准',
  exhigh: '极高',
  lossless: '无损',
  hires: 'Hi-Res',
};

/**
 * 音质：低权重文字徽章按钮；点击开关，弹层水平居中于按钮，选择后关闭，
 * 点击外部 / Escape 关闭。取代旧的 hover 弹窗（悬停间隙导致抽搐、常显关不掉）。
 */
export const QualityControl = memo(function QualityControl({
  qualities,
  quality,
  onSelectQuality,
}: QualityControlProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // 没有歌曲时 qualities 为空：用通用等级的中文名兜底，绝不把 'standard' 等原始英文标识露给用户
  const qualityLabel =
    qualities.find((o) => o.level === quality)?.label ?? FALLBACK_QUALITY_LABEL[quality] ?? '音质';

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
        data-tip={open ? undefined : '音质'}
        onClick={() => setOpen((o) => !o)}
      >
        {/* 完整显示中文标签，不截断（NEBULA_UI_SYSTEM §9.1） */}
        <span className="quality-badge">{qualityLabel}</span>
      </button>
      {open && (
        <div className="quality-pop glass-g3">
          <div className="queue-pop-title">音质</div>
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
