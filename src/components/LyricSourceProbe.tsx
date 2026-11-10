import { memo, useEffect, useState } from 'react';

/**
 * 开发者工具：当前歌曲的歌词来源与逐字覆盖（YRC / QRC / LRC 行级）。
 * 用于排查"逐字歌词覆盖不足"。不属于正式界面（NEBULA_UI_SYSTEM §5.5）：
 * 默认隐藏，Ctrl+Shift+L 开关，开关状态记在 localStorage；不拦截鼠标。
 */

interface ProbeInfo {
  source: string;
  hasYrc: boolean;
  hasQrc: boolean;
  totalLines: number;
  wordLines: number;
}

const STORAGE_KEY = 'music-nebula.dev.lyric-probe';

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
  } catch {
    /* 存储不可用时只在本次会话生效 */
  }
}

export const LyricSourceProbe = memo(function LyricSourceProbe({ info }: { info: ProbeInfo | null }) {
  const [open, setOpen] = useState(readOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyL') {
        e.preventDefault();
        setOpen((prev) => {
          writeOpen(!prev);
          return !prev;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  const pct = info && info.totalLines > 0 ? Math.round((info.wordLines / info.totalLines) * 100) : 0;
  const level = !info ? '' : info.wordLines > 0 ? '逐字' : '行级（LRC）';

  return (
    <aside className="lyric-probe" aria-label="歌词来源（开发者工具）">
      <div className="lyric-probe-title">歌词来源 · Ctrl+Shift+L 隐藏</div>
      {info ? (
        <>
          <div>来源：{info.source}</div>
          <div>
            级别：<span className={info.wordLines > 0 ? 'ok' : 'no'}>{level}</span>
          </div>
          <div>
            YRC：<span className={info.hasYrc ? 'ok' : 'no'}>{info.hasYrc ? '✓' : '✗'}</span>
            {'　'}QRC：<span className={info.hasQrc ? 'ok' : 'no'}>{info.hasQrc ? '✓' : '✗'}</span>
          </div>
          <div>
            逐字：{info.wordLines}/{info.totalLines}（{pct}%）
          </div>
        </>
      ) : (
        <div>歌词：无数据</div>
      )}
    </aside>
  );
});
