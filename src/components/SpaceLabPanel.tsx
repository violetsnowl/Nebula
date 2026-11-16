import { memo, useEffect } from 'react';
import { runSpaceCommand, setSpaceLab, useSpaceLab, type StageMode } from '../lib/space/lab';
import { useToneProgress } from '../lib/space/tone';
import './space-lab.css';

/**
 * 舞台实验室（#133 主舞台方向原型）：开发者面板，默认隐藏，Ctrl+Shift+M 开关。
 * 在「现有 / A 色彩星图 / B 星团」之间切换，调透镜和倾角，用真实封面比较两个方向。
 * 只影响主舞台的布局；默认是现有卡片墙，平时用的样子不变。
 */
const MODES: { v: StageMode; label: string; hint: string }[] = [
  { v: 'classic', label: '现有', hint: '随机卡片墙（周期回绕 + 鱼眼）' },
  { v: 'chroma', label: 'A 色彩星图', hint: '按封面颜色排成一片色轮：中间是黑白灰，越鲜艳越靠外，同一圈按色相绕一周' },
  { v: 'cluster', label: 'B 星团', hint: '同一位歌手的歌聚成一团，歌越多越大、越靠中心；单曲歌手散在外圈' },
];

export const SpaceLabPanel = memo(function SpaceLabPanel({ songCount }: { songCount: number }) {
  const lab = useSpaceLab();
  const tones = useToneProgress();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyM') {
        e.preventDefault();
        setSpaceLab({ open: !lab.open });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lab.open]);

  if (!lab.open) return null;
  const bounded = lab.mode !== 'classic';
  const hint = MODES.find((m) => m.v === lab.mode)!.hint;
  const sampling = tones.total > 0 && tones.done < tones.total;

  return (
    <section className="space-lab glass-g3" aria-label="舞台实验室" onPointerDown={(e) => e.stopPropagation()}>
      <header className="sl-head">
        <h2>舞台实验室</h2>
        <button type="button" className="sl-x" aria-label="关闭" onClick={() => setSpaceLab({ open: false })}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
            <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
          </svg>
        </button>
      </header>

      <div className="sl-seg" role="group" aria-label="主舞台布局">
        {MODES.map((m) => (
          <button key={m.v} type="button" aria-pressed={lab.mode === m.v} onClick={() => setSpaceLab({ mode: m.v })}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="sl-hint">{hint}</p>

      <div className={`sl-body${bounded ? '' : ' is-off'}`} aria-disabled={!bounded}>
        <label className="sl-row">
          <span>透镜</span>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={lab.lens}
            disabled={!bounded}
            onChange={(e) => setSpaceLab({ lens: Number(e.target.value) })}
          />
          <em>{lab.lens === 0 ? '关' : `×${(1 + lab.lens).toFixed(2)}`}</em>
        </label>
        <label className="sl-row">
          <span>倾角</span>
          <input
            type="range"
            min={0}
            max={20}
            step={1}
            value={lab.tilt}
            disabled={!bounded}
            onChange={(e) => setSpaceLab({ tilt: Number(e.target.value) })}
          />
          <em>{lab.tilt}°</em>
        </label>
        <button type="button" className="sl-row sl-tg" aria-pressed={lab.tint} disabled={!bounded} onClick={() => setSpaceLab({ tint: !lab.tint })}>
          <span>环境色跟随镜头</span>
          <i aria-hidden="true" />
        </button>
        <div className="sl-actions">
          <button type="button" disabled={!bounded} onClick={() => runSpaceCommand('overview')}>
            看全貌
          </button>
          <button type="button" disabled={!bounded} onClick={() => runSpaceCommand('focusCurrent')}>
            回到正在播放
          </button>
        </div>
      </div>

      <footer className="sl-foot">
        {bounded && sampling
          ? `正在给封面取色 ${tones.done} / ${tones.total}（第一次要等一会儿，取完 A 会重新排一次）`
          : bounded
            ? `${songCount} 首 · 滚轮缩小看全貌，星星就是你的歌`
            : 'Ctrl+Shift+M 开关这个面板 · 只影响主舞台的布局'}
      </footer>
    </section>
  );
});
