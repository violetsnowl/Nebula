/**
 * 搜索匹配。
 *
 * 匹配规则：对歌曲名（title）或歌手（artist）做不区分大小写的子串匹配；
 * 结果排序：歌名前缀 > 歌名子串 > 歌手匹配；同一首歌只出现一次。
 */

export interface SearchMatch {
  /** 歌曲在 songs/cards 中的下标。 */
  index: number;
  title: string;
  artist: string;
  /** 命中类型：title / artist。 */
  kind: 'title' | 'artist';
  cover?: string;
  hue1?: number;
}

export interface SearchableSong {
  title: string;
  artist: string;
  cover?: string;
  hue1?: number;
}

const norm = (s: string): string => s.trim().toLowerCase();

/** 实时匹配：query 为空返回 []。 */
export function matchSongs(query: string, songs: SearchableSong[]): SearchMatch[] {
  const q = norm(query);
  if (!q) return [];

  const scored: Array<SearchMatch & { score: number }> = [];
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i]!;
    const title = song.title ?? '';
    const artist = song.artist ?? '';
    const tl = norm(title);
    const al = norm(artist);
    if (tl === q || al === q) {
      scored.push({ index: i, title, artist, kind: tl === q ? 'title' : 'artist', score: 0, cover: song.cover, hue1: song.hue1 });
      continue;
    }
    if (tl.startsWith(q)) {
      scored.push({ index: i, title, artist, kind: 'title', score: 1, cover: song.cover, hue1: song.hue1 });
      continue;
    }
    if (tl.includes(q)) {
      scored.push({ index: i, title, artist, kind: 'title', score: 2, cover: song.cover, hue1: song.hue1 });
      continue;
    }
    if (al.startsWith(q) || al.includes(q)) {
      scored.push({ index: i, title, artist, kind: 'artist', score: 3, cover: song.cover, hue1: song.hue1 });
    }
  }

  return scored.sort((a, b) => a.score - b.score || a.index - b.index);
}
