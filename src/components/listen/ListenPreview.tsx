import { memo, useMemo, type CSSProperties } from 'react';
import { useAudioPlayer } from '../../lib/audio/useAudioPlayer';
import type { LyricLineUI } from '../../lib/lyrics';
import type { ListenSettings } from '../../lib/listen/settings';
import { hiResCover } from '../../lib/listen/coverUrl';
import { LyricColumn } from './LyricColumn';

/**
 * 设置 › 歌词 › 听音空间的实时预览（NEBULA_UI_SYSTEM §9.9）：当前封面模糊作底，用和听音空间同一个引擎唱三句，
 * 动效完整（用户要求「满血版」）。正在放带歌词的歌时跟着真实播放唱；没放歌、没歌词或暂停时，用一段原创占位歌词循环演示。
 */

// 原创占位歌词，逐字时间按慢歌节奏合成；「亮」是长音（≥1 秒），演示放大和白光
const DEMO: Array<[string, number[]?]> = [
  ['路灯一盏一盏替我数着心跳'],
  ['风经过的地方，都亮了', [0, 0, 0, 0, 0, 0, 0, 1.4, 0]],
  ['我把没说完的话折成纸船'],
  ['放进凌晨四点的河'],
  ['你说城市太吵，听不见星星'],
];
function demoLines(): LyricLineUI[] {
  let t = 600;
  const out: LyricLineUI[] = [];
  for (const [text, holds] of DEMO) {
    const chars = [...text];
    const words: LyricLineUI['words'] = [];
    let wi = 0;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      // 标点并入前一个字
      if (/[，。、！？]/.test(ch) && words.length) {
        words[words.length - 1]!.text += ch;
        continue;
      }
      const hold = holds?.[wi] ?? 0;
      const dur = hold > 0 ? hold * 1000 : 300 + ((i * 37) % 90);
      words.push({ text: ch, startMs: t, duration: dur });
      t += dur;
      wi++;
    }
    out.push({ timeMs: words[0]!.startMs, text, words, duration: t - words[0]!.startMs });
    t += 420;
  }
  return out;
}

export const ListenPreview = memo(function ListenPreview({ lines, settings }: { lines: LyricLineUI[]; settings: ListenSettings }) {
  const state = useAudioPlayer();
  const demo = useMemo(demoLines, []);
  // 跟真实播放：正在播放、并且有歌词
  const live = state.playing && lines.length > 0;
  const cover = state.song?.cover ? hiResCover(state.song.cover) : '';
  const bg: CSSProperties = cover ? { backgroundImage: `url(${JSON.stringify(cover)})` } : {};
  return (
    <div className="lsp-prev">
      <i className="lsp-prev-bg" style={bg} aria-hidden="true" />
      <LyricColumn className="lsp-prev-ly" lines={live ? lines : demo} settings={settings} compact demo={!live} />
      <span className="lsp-prev-tag">{live ? '实时预览 · 当前歌曲' : '实时预览'}</span>
    </div>
  );
});
