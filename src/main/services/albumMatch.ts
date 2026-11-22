import type { AlbumSummary, Platform } from '../types';
import { normalizeQuery, titleSimilarity } from '../adapters/mappers';

/**
 * 专辑名匹配：跨平台专辑兜底（专辑页 / 歌曲详情点专辑）共用的打分规则。
 *
 * 背景：以前只有网易云一家参与专辑转译，且「歌手对不上」时把分数乘 0.4 后被 `> 0.4`
 * 的阈值整批过滤掉——只要歌手写法不同（译名、合作名单、频道名）就必然返回 null，
 * 专辑页因此长期为空。现在的规则：
 * - 歌名（专辑名）相似度是基础分，`titleSimilarity` 只给 1 / 0.85 / 0，太粗；
 * - 歌手对得上（包含关系、同一文字下的子集）加满，对不上一律降权但不直接丢弃；
 * - 有一年之内的年份、曲目数接近时轻加分，用来在「同名不同版」里挑更像的那个；
 * - 只有基础分过阈值才有资格，防止「专辑名碰巧包含」的串味。
 */

/** 去掉括注、标点后的专辑名，用于比较。 */
export function albumTitleKey(name: string): string {
  return normalizeQuery(String(name || ''));
}

/**
 * 歌手是否算对上。宽松但保守：
 * - 归一化后相等；
 * - 一方是另一方的子串，且短的那边至少 2 个字符（中文）/ 3 个字符（拉丁）；
 * - 「甲 / 乙」这种多人名单里至少有一位与另一边的主唱相同（`/`、`、`、`&`、`feat.` 切分）。
 */
export function albumArtistHit(albumArtist: string | undefined, wanted: string | undefined): boolean {
  const a = albumTitleKey(albumArtist ?? '');
  const b = albumTitleKey(wanted ?? '');
  if (!a || !b) return false;
  if (a === b) return true;
  const pieces = (s: string) => s.split(/\s+(?:and|feat|x)\s+|,|\/|、|&/i).map((x) => x.trim()).filter(Boolean);
  const ap = pieces(a);
  const bp = pieces(b);
  // 多对多：任一对得上即算（「甲 / 乙」对「甲」认）
  for (const x of ap) {
    for (const y of bp) {
      if (x === y) return true;
      const min = Math.min(x.length, y.length);
      const latin = /[a-z]/i.test(x + y);
      if (min >= (latin ? 3 : 2) && (x.includes(y) || y.includes(x))) return true;
    }
  }
  return false;
}

export interface AlbumCandidateRank {
  album: AlbumSummary;
  score: number;
  titleScore: number;
  artistHit: boolean;
}

/**
 * 给一批专辑候选打分排序。`preferred` 是同一张专辑更可信的平台（默认网易云，和详情链路一致）。
 * 返回按分数降序；`titleScore` 为 0 的候选一律不进结果。
 */
export function rankAlbumCandidates(
  albums: AlbumSummary[],
  wanted: { name: string; artist?: string; year?: number; songCount?: number },
  preferred: Platform[] = ['netease', 'qq'],
): AlbumCandidateRank[] {
  const wantName = String(wanted.name || '').trim();
  if (!wantName) return [];
  const seen = new Set<string>();
  const out: AlbumCandidateRank[] = [];
  for (const album of albums) {
    if (!album?.id || !album?.name) continue;
    const key = `${album.platform}:${album.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const titleScore = titleSimilarity(album.name, wantName);
    if (titleScore <= 0) continue;

    const artistHit = albumArtistHit(album.artist, wanted.artist);
    // 基础分：专辑名完全一致 1、包含 0.85；歌手对上加 0.35，对不上只留 0.15（仍有资格，排后面）
    let score = titleScore + (artistHit ? 0.35 : 0.05);
    if (artistHit && albumTitleKey(album.name) === albumTitleKey(wantName)) score += 0.1;
    // 年份接近：用来区分「同名」的原版与 N 年后的精选 / 翻唱合集
    if (wanted.year && album.year && Math.abs(album.year - wanted.year) <= 1) score += 0.08;
    // 曲目数接近：同名不同版里挑更像的（差值按比例，最多 0.06）
    if (wanted.songCount && album.songCount && wanted.songCount > 0) {
      const ratio = Math.abs(album.songCount - wanted.songCount) / wanted.songCount;
      if (ratio <= 0.2) score += 0.06 * (1 - ratio / 0.2);
    }
    // 平台偏好：同分时能走过「本平台可直接打开详情」的那家
    const pref = preferred.indexOf(album.platform);
    if (pref >= 0) score += 0.02 * (preferred.length - pref);

    out.push({ album, score, titleScore, artistHit });
  }
  return out.sort((a, b) => b.score - a.score);
}
