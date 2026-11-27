import type { Platform, SearchSongGroup, Track } from '../types';
import { recordingMatch } from './recordingMatch';

/**
 * 组内「默认来源」的偏好顺序：点整条就按这家优先播。排前面的能直接取链、音质稳、歌词全。
 * 只决定默认用哪家、以及展开列表的展示顺序，不影响用户自己挑。
 */
export const SOURCE_ORDER: Platform[] = ['netease', 'qq', 'kugou', 'kuwo', 'bodian', 'spotify', 'qishui', 'ytmusic', 'applemusic'];
const rank = (p: Platform): number => {
  const i = SOURCE_ORDER.indexOf(p);
  return i < 0 ? SOURCE_ORDER.length : i;
};

/**
 * 把「全网搜歌」的扁平结果按**同一录音**合并成一条（#227）。
 *
 * 为什么不是「歌名一样就合并」：同一个歌名在不同平台常对应不同版本（Live / Remix / 伴奏 / 翻唱），
 * 硬按字符串去重会把它们吃掉。这里复用播放兜底与歌词补全同一套 `recordingMatch`
 * （歌名 + 歌手 + 时长 + 版本约束），判定标准全项目一致。
 *
 * 组内来源按 `SOURCE_ORDER` 排序，第一位作为 `primary`（点按默认播的那家）；
 * 组的先后顺序保持搜索结果原本出现的顺序，避免去重后列表跳来跳去。
 */
export function groupSearchResults(tracks: Track[], limit?: number): SearchSongGroup[] {
  const groups: Track[][] = [];
  for (const track of tracks) {
    const home = groups.find((g) => recordingMatch(track, g[0]!).ok);
    if (home) home.push(track);
    else groups.push([track]);
  }
  const merged: SearchSongGroup[] = groups.map((items) => {
    const sources = [...items].sort((a, b) => rank(a.platform) - rank(b.platform));
    return { primary: sources[0]!, sources };
  });
  return limit && limit > 0 ? merged.slice(0, limit) : merged;
}
