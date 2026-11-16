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
 * 播放条上的音质代号（§9.1）：无损 = SQ、极高 = HQ；Hi-Res / 臻品等保留原名，标准、较高保留中文。
 * 各平台标签带格式后缀（「无损 FLAC」「极高 320k」），只取第一段判断；弹层里仍显示全称。
 */
function qualityCode(label: string): string {
  const head = label.trim().split(/\s+/)[0] ?? label;
  if (head === '无损') return 'SQ';
  if (head === '极高') return 'HQ';
  return head;
}

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
        aria-label={`音质：${qualityLabel}`}
        data-tip={open ? undefined : `音质：${qualityLabel}`}
        onClick={() => setOpen((o) => !o)}
      >
        {/* 按钮上写代号，悬停提示与弹层给全称（NEBULA_UI_SYSTEM §9.1） */}
        <span className="quality-badge">{qualityCode(qualityLabel)}</span>
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
