import type { Track } from './catalog';

/**
 * 歌曲页面链接（设计审查第 17 条：右键菜单「复制链接」）。
 * 只给有公开网页的平台生成；本地歌曲、汽水、Spotify 等拿不到可靠的网页地址，返回 null，
 * 菜单据此禁用这一项，而不是复制一个打不开的链接。
 * sourceId 都要先校验字符集再拼进 URL，避免畸形 id 生成无效链接。
 */
export function trackShareLink(track: Track): string | null {
  const id = track.sourceId?.trim();
  if (!id) return null;
  switch (track.source) {
    case 'netease':
      return /^\d+$/.test(id) ? `https://music.163.com/song?id=${id}` : null;
    case 'qq':
      return /^[0-9A-Za-z]+$/.test(id) ? `https://y.qq.com/n/ryqq/songDetail/${id}` : null;
    case 'kugou':
      // 酷狗的 sourceId 是文件 hash（32 位十六进制）
      return /^[0-9a-fA-F]{32}$/.test(id) ? `https://www.kugou.com/song/#hash=${id}` : null;
    default:
      return null;
  }
}
