import { useEffect, useRef } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import { LyricEngine } from '../../lib/listen/engine';
import { buildEntries, detectScript, type EngineEntry } from '../../lib/listen/model';
import type { ListenSettings } from '../../lib/listen/settings';
import type { LyricLineUI } from '../../lib/lyrics';
import './lyric-words.css';
import './lyric-column.css';

/**
 * 听音空间的歌词阅读栏（NEBULA_UI_SYSTEM §7.2）。React 只负责挂载、传数据、跑时钟；
 * 所有动效在 lib/listen/engine.ts 里。
 *
 * 注意：本组件的根元素及其所有祖先都不能建立层叠上下文 / 隔离组（z-index、mask、filter、opacity<1），
 * 否则不在唱的句子的 plus-lighter 环境透色会失效。
 */
export interface LyricColumnProps {
  lines: LyricLineUI[];
  settings: ListenSettings;
  /** 设置里的预览：小尺寸、三句可见，动效与正式版一致。 */
  compact?: boolean;
  /** 不读播放器，内部时钟循环播放传入的歌词（预览在没播歌 / 没歌词时用）。 */
  demo?: boolean;
  className?: string;
}

export function LyricColumn({ lines, settings, compact, demo, className }: LyricColumnProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<LyricEngine | null>(null);
  // 最新的 props，供引擎重建 / 时钟循环读取
  const latest = useRef({ lines, settings, demo: !!demo });
  latest.current = { lines, settings, demo: !!demo };
  // 已经喂给引擎的内容；演示循环需要知道歌词的起止
  const applied = useRef<{ lines: LyricLineUI[] | null; entries: EngineEntry[]; settings: ListenSettings | null }>({
    lines: null,
    entries: [],
    settings: null,
  });

  const sync = () => {
    const eng = engineRef.current;
    if (!eng) return;
    const cur = latest.current;
    const a = applied.current;
    if (
      a.settings?.scheme !== cur.settings.scheme ||
      a.settings.font !== cur.settings.font ||
      a.settings.translation !== cur.settings.translation ||
      a.settings.roman !== cur.settings.roman ||
      a.settings.jaRoman !== cur.settings.jaRoman ||
      a.settings.jaKana !== cur.settings.jaKana
    ) {
      eng.setSettings(cur.settings);
      a.settings = cur.settings;
    }
    if (a.lines !== cur.lines) {
      a.entries = buildEntries(cur.lines);
      eng.setLyrics(a.entries, detectScript(cur.lines));
      a.lines = cur.lines;
    }
  };

  // 建引擎 + 时钟循环（compact 变了要重建）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const eng = new LyricEngine(host, {
      compact,
      onSeek: (sec) => {
        if (!latest.current.demo) audioPlayer.seek(sec);
      },
    });
    engineRef.current = eng;
    applied.current = { lines: null, entries: [], settings: null };
    sync();

    // 尺寸变化：ResizeObserver 在每帧绘制前合并回调，天然节流
    const ro = new ResizeObserver(() => eng.resize());
    ro.observe(host);

    // 平滑时钟：audio.currentTime 在音频线程推进，读数常常连续几帧不变——数值没变且在播放时按 dt 外推（最多 0.25s）
    let raf = 0;
    let lastNow = 0;
    let lastPos = -1;
    let extrap = 0;
    let smooth = 0;
    let demoStart = 0;
    let demoKey: EngineEntry[] | null = null;
    // 挂载当帧立即同步落到当前播放句，避免等首帧 rAF 时一镜到底先按第 0 句起飞或空等
    if (!latest.current.demo) {
      const pos0 = audioPlayer.position();
      lastPos = pos0;
      smooth = pos0;
      eng.frame(pos0, audioPlayer.state.playing, performance.now());
    }
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 1 / 60;
      lastNow = now;
      let t: number;
      let playing: boolean;
      if (latest.current.demo) {
        // 演示：内部时钟，从第一句前一点开始，唱完最后一句后循环
        const entries = applied.current.entries;
        const body = entries.filter((e) => e.kind === 'line');
        const first = body[0]?.s ?? 0;
        const last = body.reduce((m, e) => Math.max(m, e.e), 0);
        if (demoKey !== entries) {
          demoKey = entries;
          demoStart = now;
        }
        const from = Math.max(0, first - 0.5);
        const span = Math.max(1, last + 1.5 - from);
        t = from + (((now - demoStart) / 1000) % span);
        playing = true;
      } else {
        // 播放状态直接读播放器当前值，不为每帧复制一份状态对象
        playing = audioPlayer.state.playing;
        const pos = audioPlayer.position();
        if (playing && pos === lastPos) extrap = Math.min(0.25, extrap + dt);
        else extrap = 0;
        lastPos = pos;
        let cand = playing ? pos + extrap : pos;
        // 读数刚更新时可能比外推值略小：保持单调，别让波浪往回抖
        if (playing && cand < smooth && smooth - cand < 0.15) cand = smooth;
        smooth = cand;
        t = smooth;
      }
      eng.frame(t, playing, now);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      eng.destroy();
      if (engineRef.current === eng) engineRef.current = null;
    };
    // sync 只读 ref，不需要进依赖
  }, [compact]);

  // 歌词 / 设置变化
  useEffect(() => {
    sync();
  }, [lines, settings.scheme, settings.font, settings.translation, settings.roman, settings.jaRoman, settings.jaKana]);

  return <div ref={hostRef} className={className ? `lc-root ${className}` : 'lc-root'} />;
}
