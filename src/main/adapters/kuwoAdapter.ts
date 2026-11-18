import type { HttpClient } from '../http';
import type { CookieStore } from '../cookieStore';
import type { Lyric, Playlist, PlaylistSummary, PlatformAdapter, QualityOption, SongUrl, Track } from '../types';
import { cleanMetadataText } from '../parsers/metadataText';

const PLAYLIST_API = 'http://nplserver.kuwo.cn/pl.svc';
const SONG_URL_API = 'http://antiserver.kuwo.cn/anti.s';
const COMMON_QUERY = 'encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1';
const PAGE_SIZE = 100;
const MAX_PAGES = 60;
/** 未授权 / 无版权的歌曲，取链接口仍返回 code 200，但给的是同一段短提示音（实测 181521 字节，约 11 秒）。 */
const PLACEHOLDER_URL = /\/588957081\.mp3(?:$|\?)/;
/** 实测匿名只拿得到 128k；其余档位（320kmp3 / 2000kflac）匿名返回的是上面的提示音。 */
const BR_BY_LEVEL: Record<string, string> = { '128': '128kmp3' };

export interface KuwoSession { uid: string; sid: string }

function readCookie(cookie: string | undefined | null, name: string): string {
  if (!cookie) return '';
  for (const seg of cookie.split(';')) {
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    if (seg.slice(0, eq).trim() === name) return seg.slice(eq + 1).trim();
  }
  return '';
}

/** 从酷我 cookie 取登录身份：userid 为非零数字，且有 sid 或 websid。缺任一返回 null。 */
export function parseKuwoSession(cookie: string | undefined | null): KuwoSession | null {
  const uid = readCookie(cookie, 'userid');
  if (!/^\d+$/.test(uid) || /^0+$/.test(uid)) return null;
  const sid = readCookie(cookie, 'sid') || readCookie(cookie, 'websid');
  if (!sid) return null;
  return { uid, sid };
}

export { readCookie as readKuwoCookie };

/** 酷我封面：专辑图 120 / 用户歌单图 150 放大到 500；保持 http（多级 CDN 的 https 证书不匹配）。 */
export function kuwoCoverUrl(raw: unknown): string {
  const url = String(raw ?? '').trim();
  if (!url) return '';
  return url.replace(/\/albumcover\/\d+\//, '/albumcover/500/').replace(/_(?:\d+)\.(jpg|png|webp)$/i, '_500.$1');
}

function mapKuwoTrack(item: Record<string, any>): Track | null {
  const rid = String(item?.id ?? '').trim();
  const title = cleanMetadataText(item?.name || item?.FSONGNAME);
  if (!/^\d+$/.test(rid) || !title) return null;
  const artists = cleanMetadataText(item.artist || item.FARTIST).split('&').map(s => s.trim()).filter(Boolean);
  return {
    id: `kuwo:${rid}`,
    title,
    artist: artists.join(' / ') || '未知歌手',
    artists,
    album: cleanMetadataText(item.album || item.FALBUM),
    cover: kuwoCoverUrl(item.albumpic || item.musicPic || item.artistPic),
    duration: Number(item.duration) || 0,
    platform: 'kuwo',
    sourceId: rid,
    originalUrl: '',
    fallbackUrl: '',
    extra: {
      albumId: String(item.albumid ?? ''),
      artistId: String(item.artistid ?? ''),
      durationSec: Number(item.duration) || 0,
    },
  };
}

/** getuserlist 条目 → 歌单摘要：丢掉没有标题的系统占位列表（PC_DEFAULT / RADIO / ORDER 等）。 */
export function mapKuwoMyPlaylists(items: Array<Record<string, any>>): PlaylistSummary[] {
  return items
    .filter(p => p && p.id && cleanMetadataText(p.title))
    .map(p => ({
      id: String(p.id),
      name: cleanMetadataText(p.title),
      cover: kuwoCoverUrl(p.pic),
      trackCount: Number(p.musicnum) || 0,
    }));
}

export class KuwoAdapter implements PlatformAdapter {
  readonly platform = 'kuwo' as const;

  constructor(
    private http: HttpClient,
    private cookies: CookieStore,
  ) {}

  async fetchPlaylist(playlistId: string): Promise<Playlist> {
    const pid = String(playlistId || '').trim();
    if (!/^\d+$/.test(pid)) throw new Error('无效的酷我歌单 ID');
    type Page = { result?: string; title?: string; pic?: string; info?: string; total?: number | string; musiclist?: Array<Record<string, any>> };
    const tracks: Track[] = [];
    let name = '';
    let cover = '';
    let description = '';
    let total = 0;
    for (let pn = 0; pn < MAX_PAGES; pn++) {
      const data = await this.http.requestJson<Page>(
        `${PLAYLIST_API}?op=getlistinfo&pid=${pid}&pn=${pn}&rn=${PAGE_SIZE}&${COMMON_QUERY}`,
        { platform: 'kuwo', timeoutMs: 10000 },
      );
      if (pn === 0) {
        name = cleanMetadataText(data?.title);
        cover = kuwoCoverUrl(data?.pic);
        description = cleanMetadataText(String(data?.info ?? '').replace(/<br\s*\/?>/gi, '\n'));
        total = Number(data?.total) || 0;
      }
      const rows = Array.isArray(data?.musiclist) ? data.musiclist : [];
      if (!rows.length) break;
      tracks.push(...rows.map(mapKuwoTrack).filter((t): t is Track => !!t));
      if (rows.length < PAGE_SIZE || (total && (pn + 1) * PAGE_SIZE >= total)) break;
    }
    if (!tracks.length) throw new Error('酷我歌单不存在、为空或未公开');
    return { id: pid, platform: 'kuwo', name: name || `酷我歌单 ${pid}`, cover, description: description || undefined, tracks };
  }

  /** 取链：失败 / 提示音 / 明显短于歌曲时长一律返回 null，让路由器去兜底平台。 */
  async fetchSongUrl(songId: string, _albumId?: string, quality?: string, extra?: Record<string, unknown>): Promise<SongUrl | null> {
    const rid = String(songId || '').trim();
    if (!/^\d+$/.test(rid)) return null;
    const level = quality && BR_BY_LEVEL[quality] ? quality : '128';
    try {
      const data = await this.http.requestJson<{ code?: number; url?: string }>(
        `${SONG_URL_API}?type=convert_url3&rid=${rid}&format=mp3&response=url&br=${BR_BY_LEVEL[level]}`,
        { platform: 'kuwo', timeoutMs: 6000 },
      );
      const url = String(data?.url ?? '').trim();
      if (data?.code !== 200 || !/^https?:\/\//i.test(url) || PLACEHOLDER_URL.test(url)) return null;
      if (!(await this.looksComplete(url, Number(extra?.durationSec) || 0, 128))) return null;
      return { url, quality: level };
    } catch {
      return null;
    }
  }

  /** 用 1 字节 Range 读总长，和「时长 × 码率」比；明显偏小就是试听 / 提示音。探测本身失败不拦截。 */
  private async looksComplete(url: string, durationSec: number, kbps: number): Promise<boolean> {
    if (!durationSec) return true;
    try {
      const res = await this.http.requestRaw(url, { platform: 'kuwo', headers: { Range: 'bytes=0-0' }, timeoutMs: 3000 });
      const total = Number(/\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1]);
      if (!total) return true;
      return total >= durationSec * kbps * 125 * 0.4;
    } catch {
      return true;
    }
  }

  async listQualities(): Promise<QualityOption[]> {
    return [{ level: '128', label: '标准 128k' }];
  }

  /** 首版不接酷我歌词；LyricService 在主源没有歌词时会去其他平台找。 */
  async fetchLyric(_songId: string): Promise<Lyric | null> {
    return null;
  }

  /** 我的歌单：用 cookie 里的 userid（有 sid 时一并带上，可能含私密歌单）。失败返回 []。 */
  async fetchMyPlaylists(): Promise<PlaylistSummary[]> {
    const session = parseKuwoSession(this.cookies.getHeader('kuwo'));
    if (!session) return [];
    try {
      const data = await this.http.requestJson<{ plist?: Array<Record<string, any>> }>(
        `${PLAYLIST_API}?op=getuserlist&uid=${encodeURIComponent(session.uid)}&sid=${encodeURIComponent(session.sid)}&pn=0&rn=500&${COMMON_QUERY}`,
        { platform: 'kuwo', timeoutMs: 10000 },
      );
      return mapKuwoMyPlaylists(Array.isArray(data?.plist) ? data.plist : []);
    } catch (err) {
      console.warn('[KuwoAdapter] 歌单获取失败:', err instanceof Error ? err.message : '');
      return [];
    }
  }
}
