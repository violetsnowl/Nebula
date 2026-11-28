import type { HttpClient } from '../http';
import type { CookieStore } from '../cookieStore';
import type { ArtistSearchHit, Lyric, Playlist, PlaylistSummary, PlatformAdapter, QualityOption, SongUrl, Track } from '../types';
import { cleanMetadataText } from '../parsers/metadataText';
import { decodeKuwoLyric, kuwoLyricUrl, parseKuwoLyric } from '../parsers/kuwoLyric';

const PLAYLIST_API = 'http://nplserver.kuwo.cn/pl.svc';
const SONG_URL_API = 'http://antiserver.kuwo.cn/anti.s';
const COMMON_QUERY = 'encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1';
/** 网页搜索接口（https 才返回合法 JSON；http 会 301，而 search.kuwo.cn/r.s 返回的是单引号伪 JSON）。 */
const SEARCH_API = 'https://www.kuwo.cn/search/searchMusicBykeyWord';
const SEARCH_QUERY = 'vipver=1&client=kt&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&mobi=1&issubtitle=1&show_copyright_off=1';
const PAGE_SIZE = 100;
const MAX_PAGES = 60;
/** 未授权 / 无版权的歌曲，取链接口仍返回 code 200，但给的是同一段短提示音（实测 181521 字节，约 11 秒）。 */
const PLACEHOLDER_URL = /\/588957081\.mp3(?:$|\?)/;
/**
 * 各档位对应的 `br` 参数（#229）。匿名实测：128k 给真音频，320k / 2000kflac 一律返回
 * 上面那段提示音——所以**不能靠档位名判断成败**，每档都要按「是不是提示音 / 长度够不够」校验，
 * 校验不过就自动降一档重试。登录后能不能真的拿到 320k / flac 由真实账号决定，
 * 这里只负责「有就给、没有就降」，不会因为请求高档位而把能放的歌变成放不了。
 */
const BR_BY_LEVEL: Record<string, string> = { '128': '128kmp3', '320': '320kmp3', 'flac': '2000kflac' };
/** 从高到低：请求哪个档位，就从这个档位开始往下试。 */
const LEVEL_ORDER = ['flac', '320', '128'] as const;
/** 各档位估算码率（Kbps），用于按歌曲时长核对文件大小是不是完整音频。 */
const KBPS_BY_LEVEL: Record<string, number> = { '128': 128, '320': 320, flac: 900 };

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

/** 酷我歌手头像：支持完整地址与 `120/s4s56/...` 短路径，放大到 300。 */
export function kuwoArtistAvatarUrl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const full = /^https?:\/\//i.test(s) ? s : `http://img4.kuwo.cn/star/starheads/${s.replace(/^\/+/, '')}`;
  return full.replace(/\/starheads\/\d+\//, '/starheads/300/');
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

/**
 * 搜索结果一行 → Track：先整理成歌单接口的字段形状，再走同一个 mapKuwoTrack（字段口径一致）。
 * 标题用 SONGNAME（带「(Live)」「(DJ版)」等版本后缀，跨平台匹配要靠它区分录音），NAME 是不带后缀的歌名，只作兜底；
 * 歌曲 id 取 DC_TARGETID，没有就从 MUSICRID（MUSIC_123）里取。封面接口只给短路径（120/s3s94/…），拼上专辑图域名后同样放大到 500。
 */
function mapKuwoSearchRow(row: Record<string, any>): Track | null {
  const short = String(row?.web_albumpic_short ?? '').trim();
  const albumpic = /^https?:\/\//i.test(short) ? short : short ? `http://img1.kuwo.cn/star/albumcover/${short.replace(/^\/+/, '')}` : '';
  return mapKuwoTrack({
    id: String(row?.DC_TARGETID || '').trim() || String(row?.MUSICRID ?? '').replace(/^MUSIC_/i, ''),
    name: row?.SONGNAME || row?.NAME,
    artist: row?.ARTIST || row?.FARTIST,
    album: row?.ALBUM,
    albumpic,
    duration: row?.DURATION,
    albumid: row?.ALBUMID,
    artistid: row?.ARTISTID,
  });
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

/** 酷我 / 波点共用的歌词请求（两家歌曲 id 相同）。 */
export async function fetchKuwoLyric(http: HttpClient, songId: string): Promise<Lyric | null> {
  if (!/^\d+$/.test(songId)) return null;
  try {
    const buf = await http.requestBytes(kuwoLyricUrl(songId), { platform: 'kuwo', cookie: '', timeoutMs: 3000 });
    const text = decodeKuwoLyric(buf);
    return text ? parseKuwoLyric(text) : null;
  } catch {
    return null;
  }
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
    return { id: pid, platform: 'kuwo', name: name || `酷我歌单 ${pid}`, cover: cover || tracks.find(t => t.cover)?.cover || '', description: description || undefined, tracks };
  }

  /** 「我喜欢听」这类系统歌单没有封面：只取第一首的专辑图。 */
  async fetchPlaylistFirstCover(playlistId: string): Promise<string> {
    const pid = String(playlistId || '').trim();
    if (!/^\d+$/.test(pid)) return '';
    const data = await this.http.requestJson<{ musiclist?: Array<Record<string, any>> }>(
      `${PLAYLIST_API}?op=getlistinfo&pid=${pid}&pn=0&rn=5&${COMMON_QUERY}`,
      { platform: 'kuwo', timeoutMs: 8000 },
    );
    const rows = Array.isArray(data?.musiclist) ? data.musiclist : [];
    for (const row of rows) {
      const cover = mapKuwoTrack(row)?.cover;
      if (cover) return cover;
    }
    return '';
  }

  /**
   * 取链（#229）：从请求的档位开始逐档往下试，每档都按「是不是提示音 / 长度够不够」校验。
   * 以前直接写死只请求 128k，登录后能拿到的更高档位等于白丢；现在登录态下会真的用上
   * 320k / flac，拿不到才降档——绝不会因为请求高档位而让本来能放的歌变成放不了。
   * 失败 / 提示音 / 明显短于歌曲时长一律返回 null，让路由器去兜底平台。
   */
  async fetchSongUrl(songId: string, _albumId?: string, quality?: string, extra?: Record<string, unknown>): Promise<SongUrl | null> {
    const rid = String(songId || '').trim();
    if (!/^\d+$/.test(rid)) return null;
    const durationSec = Number(extra?.durationSec) || 0;
    // 请求档位不在已知集合里时从 128 起（保守）
    const startAt = LEVEL_ORDER.indexOf((quality ?? '128') as (typeof LEVEL_ORDER)[number]);
    const levels = LEVEL_ORDER.slice(startAt < 0 ? LEVEL_ORDER.indexOf('128') : startAt);
    for (const level of levels) {
      const url = await this.requestLevel(rid, BR_BY_LEVEL[level]!);
      if (!url) continue;
      if (PLACEHOLDER_URL.test(url)) continue;
      if (!(await this.looksComplete(url, durationSec, KBPS_BY_LEVEL[level]!))) continue;
      return { url, quality: level };
    }
    return null;
  }

  /** 单档取地址：接口异常 / 非 200 / 非 http(s) 一律 null。 */
  private async requestLevel(rid: string, br: string): Promise<string | null> {
    try {
      const data = await this.http.requestJson<{ code?: number; url?: string }>(
        `${SONG_URL_API}?type=convert_url3&rid=${rid}&format=mp3&response=url&br=${br}`,
        { platform: 'kuwo', timeoutMs: 6000 },
      );
      const url = String(data?.url ?? '').trim();
      if (data?.code !== 200 || !/^https?:\/\//i.test(url)) return null;
      return url;
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

  /**
   * 音质档位（#229）：三档都列出来，取链时逐档向下校验。
   * 匿名只能真正拿到 128k，但列表要不要显示高档位取决于「能不能取到」而不是「能不能选」——
   * 选 320k 时若登录态不够，会自动降回 128k 并照常播，不会失败。
   */
  async listQualities(): Promise<QualityOption[]> {
    return [
      { level: 'flac', label: '无损' },
      { level: '320', label: '较高 320k' },
      { level: '128', label: '标准 128k' },
    ];
  }

  /**
   * 关键词搜歌（跨平台兜底用）：匿名（不带登录信息）的网页搜索接口，返回合法 JSON、带时长与专辑图。
   * 失败 / 无结果返回 []，由调用方换别的平台。
   */
  async searchSongs(keyword: string, pageSize = 10): Promise<Track[]> {
    const word = String(keyword ?? '').trim();
    if (!word) return [];
    try {
      const data = await this.http.requestJson<{ abslist?: Array<Record<string, any>> }>(
        `${SEARCH_API}?${SEARCH_QUERY}&pn=0&rn=${Math.max(1, Math.min(50, Math.floor(pageSize) || 10))}&all=${encodeURIComponent(word)}`,
        { platform: 'kuwo', cookie: '', timeoutMs: 6000 },
      );
      return (Array.isArray(data?.abslist) ? data.abslist : []).map(mapKuwoSearchRow).filter((t): t is Track => !!t);
    } catch (err) {
      console.warn('[KuwoAdapter] 搜索失败:', err instanceof Error ? err.message : '');
      return [];
    }
  }

  /** 关键词搜歌手（匿名网页接口 ft=artist，返回 ID / 歌手名 / 头像）。 */
  async searchArtists(keyword: string, pageSize = 5): Promise<ArtistSearchHit[]> {
    const word = String(keyword ?? '').trim();
    if (!word) return [];
    const rn = Math.max(1, Math.min(20, Math.floor(pageSize) || 5));
    try {
      const q = SEARCH_QUERY.replace('ft=music', 'ft=artist');
      const data = await this.http.requestJson<{ abslist?: Array<Record<string, any>> }>(
        `${SEARCH_API}?${q}&pn=0&rn=${rn}&all=${encodeURIComponent(word)}`,
        { platform: 'kuwo', cookie: '', timeoutMs: 6000 },
      );
      return (Array.isArray(data?.abslist) ? data.abslist : [])
        .map((r): ArtistSearchHit | null => {
          const id = String(r?.ARTISTID || r?.DC_TARGETID || '').trim();
          const name = cleanMetadataText(r?.ARTIST || r?.FARTIST);
          if (!/^\d+$/.test(id) || !name) return null;
          return {
            platform: 'kuwo',
            id,
            name,
            avatar: kuwoArtistAvatarUrl(r?.hts_PICPATH || r?.PICPATH || r?.pic),
          };
        })
        .filter((x): x is ArtistSearchHit => !!x);
    } catch (err) {
      console.warn('[KuwoAdapter] 搜歌手失败:', err instanceof Error ? err.message : '');
      return [];
    }
  }

  /** 本平台歌词（#204）：逐字 + 翻译，接口匿名（不带登录信息）。取不到返回 null，LyricService 会去别的平台补。 */
  async fetchLyric(songId: string): Promise<Lyric | null> {
    return fetchKuwoLyric(this.http, songId);
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
