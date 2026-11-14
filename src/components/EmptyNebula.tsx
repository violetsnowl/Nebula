import { memo, useEffect, useState, type CSSProperties } from 'react';
import './empty-nebula.css';

/**
 * 首次启动空状态（样张 H 第一部分，2026-11-14 用户确认）：
 * 曲库里没有任何真实歌曲时，用「空卡轮廓 + 标题区」代替以前随机色相的演示星云。
 * 轮廓单色、低对比，排成星云的空间结构并缓慢漂移，中央用径向遮罩留出标题；
 * 导入开始（曲库有歌）后整体淡出，让位给星云逐批揭示的真实卡片。
 */

/** 淡出时长（ms）：和 CSS 里 .empty-nebula 的 opacity 过渡一致，到点后卸载。 */
const LEAVE_MS = 600;

interface GhostSpec {
  /** 以 1600×900 设计稿为基准的位置 / 边长，渲染时换成百分比和 vw，随窗口等比缩放。 */
  x: number;
  y: number;
  size: number;
  /** 轮廓不透明度（景深：远处小、淡；0.05–0.12）。 */
  a: number;
  /** 漂移周期（s）、漂移起点偏移（s）、入场淡入延迟（s）。 */
  d: number;
  dl: number;
  di: number;
}

/**
 * 抖动网格 + 景深。用样张同一套线性同余伪随机（种子固定），布局确定、和样张逐个对得上；
 * 5 行 × 9 列里随机缺 14%，约 39 个轮廓。
 */
function buildGhosts(): GhostSpec[] {
  let seed = 13;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const list: GhostSpec[] = [];
  let k = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 9; col++) {
      if (rand() < 0.14) continue;
      const z = rand();
      const size = Math.round(96 + 70 * z);
      const x = -110 + col * 214 + (row % 2) * 96 + (rand() - 0.5) * 60;
      const y = -70 + row * 208 + (rand() - 0.5) * 50;
      list.push({
        x,
        y,
        size,
        a: 0.05 + 0.07 * z,
        d: 16 + rand() * 12,
        dl: rand() * 20,
        di: 0.1 + k++ * 0.025,
      });
    }
  }
  return list;
}

const GHOSTS = buildGhosts();

export type EmptyPhase = 'on' | 'leaving' | 'off';

/**
 * 空状态的三个阶段：显示中 → 淡出中（show 变 false 后 LEAVE_MS）→ 已卸载。
 * 阶段由 App 持有（同时用来给 .app 打 data-empty，驱动中性环境光的进出），
 * 所以用「渲染期调整状态」而不是 effect：show 翻转的那一次渲染里 phase 就已经是 'leaving'，不会有一帧被卸载。
 */
export function useEmptyPhase(show: boolean): EmptyPhase {
  const [phase, setPhase] = useState<EmptyPhase>(show ? 'on' : 'off');
  if (show && phase !== 'on') setPhase('on');
  else if (!show && phase === 'on') setPhase('leaving');
  useEffect(() => {
    if (phase !== 'leaving') return;
    const t = window.setTimeout(() => setPhase((p) => (p === 'leaving' ? 'off' : p)), LEAVE_MS + 40);
    return () => window.clearTimeout(t);
  }, [phase]);
  return phase;
}

interface EmptyNebulaProps {
  phase: EmptyPhase;
  onLogin: () => void;
  onPasteLink: () => void;
  onLocal: () => void;
}

export const EmptyNebula = memo(function EmptyNebula({ phase, onLogin, onPasteLink, onLocal }: EmptyNebulaProps) {
  if (phase === 'off') return null;
  const show = phase === 'on';

  return (
    <section
      className={`empty-nebula${show ? '' : ' is-leaving'}`}
      aria-label="首次启动"
      aria-hidden={!show}
      data-testid="empty-nebula"
    >
      <div className="en-ghosts" aria-hidden="true">
        {GHOSTS.map((g, i) => (
          <span
            key={i}
            style={
              {
                left: `${(g.x / 16).toFixed(3)}%`,
                top: `${(g.y / 9).toFixed(3)}%`,
                width: `${(g.size / 16).toFixed(3)}vw`,
                '--a': g.a.toFixed(3),
                '--d': `${g.d.toFixed(1)}s`,
                '--dl': `-${g.dl.toFixed(1)}s`,
                '--di': `${g.di.toFixed(2)}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="en-hero">
        <h2>把你的歌，放进星云</h2>
        <p>登录一个音乐平台，你的歌单会自动出现在左侧；也可以直接粘贴一个歌单链接，或者选一个本地文件夹。</p>
        <div className="en-acts">
          <button type="button" className="en-btn en-btn--primary" onClick={onLogin}>
            登录音乐平台
          </button>
          <button type="button" className="en-btn en-btn--sec" onClick={onPasteLink}>
            粘贴歌单链接
          </button>
          <button type="button" className="en-btn en-btn--text" onClick={onLocal}>
            本地文件夹…
          </button>
        </div>
        <div className="en-supports">网易云音乐 · QQ 音乐 · 酷狗音乐 · 汽水音乐 · Spotify</div>
      </div>
    </section>
  );
});
