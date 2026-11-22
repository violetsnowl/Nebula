import type { HttpClient } from '../http';
import type { CookieStore } from '../cookieStore';
import type {
  AlbumSummary,
  AlbumDetail,
  ArtistSearchHit,
  ArtistInfo,
  CommentResult,
  Lyric,
  Playlist,
  PlatformAdapter,
  QualityOption,
  SongDetail,
  SongUrl,
  Track,
} from '../types';
import { mergeLyric } from '../parsers/lyricParser';
import { mapQQTrack } from './mappers';
import { throwIfCancelled } from '../requestScope';
import { decodeQqLyric, fromTimed } from '../parsers/timedLyrics';
import { expiresAfterSeconds, sourceTiming } from '../../lib/audio/sourceLifetime';
import { QQ_AUTH_EXPIRED, qqComm, qqCredential, qqLoginProbe, qqSession } from '../services/qqSession';

export function cleanQqComment(text:string):string {
  return String(text || '').replace(/\[em\]([\s\S]*?)\[\/em\]/gi,(_,code)=>/^[\p{Extended_Pictographic}\uFE0F\u200D]+$/u.test(code)?code:'［表情］').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
}

function decodeMaybeBase64(s: string): string {
  if (!s) return '';
  try {
    if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 40) {
      const decoded = Buffer.from(s, 'base64').toString('utf-8');
      if (decoded.includes('[')) return decoded;
    }
  } catch {
    /* not base64, return as-is */
  }
  return s;
}

interface QqPlaylistResp {
  cdlist?: Array<{
    disstid?: number | string;
    dissname?: string;
    logo?: string;
    desc?: string;
    songlist?: Array<Record<string, any>>;
  }>;
}

/** QQ quality tiers: filename prefix + label. */
const QQ_QUALITY_TIERS: Array<{ level: string; label: string; prefix: string }> = [
  { level: 'flac', label: '无损 FLAC', prefix: 'F000' },
  { level: '320k', label: 'HQ 320k', prefix: 'M800' },
  { level: '128k', label: '标准 128k', prefix: 'M500' },
];

/** musicu.fcg Web comm（歌单/详情/歌手等接口需要）。 */
const QQ_COMM = {
  ct: 24,
  cv: 4747474,
  platform: 'yqq.json',
  chid: '0',
  uin: '0',
  g_tk: 5381,
  g_tk_new_20200303: 5381,
  format: 'json',
  inCharset: 'utf-8',
  outCharset: 'utf-8',
  notice: 0,
  need_new_code: 1,
};

async function musicuPost(
  http: HttpClient,
  module: string,
  method: string,
  param: Record<string, unknown>,
): Promise<Record<string, any> | null> {
  try {
    const data = await http.requestJson<{ req_0?: Record<string, any> }>(
      'https://u.y.qq.com/cgi-bin/musicu.fcg',
      {
        platform: 'qq',
        method: 'POST',
        body: { comm: QQ_COMM, req_0: { module, method, param } },
        timeoutMs: 12000,
      },
    );
    return data?.req_0 ?? null;
  } catch {
    return null;
  }
}

/**
 * QQ music adapter:
 * - playlist: qzone fcg;
 * - audio: musicu.fcg 批量 filename + media_mid + 登录 authst；
 * - failures return explicit errors (never a silent empty url);
 * - keyword search supports cross-platform fallback.
 */
export class QqAdapter implements PlatformAdapter {
  readonly platform = 'qq' as const;

  constructor(
    private http: HttpClient,
    private cookies: CookieStore,
  ) {}

  async fetchPlaylist(playlistId: string): Promise<Playlist> {
    const data = await this.http.requestJson<QqPlaylistResp>(
      `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${encodeURIComponent(playlistId)}&format=json&g_tk=5381`,
      { platform: 'qq' },
    );
    const cd = data?.cdlist?.[0];
    if (!cd || !Array.isArray(cd.songlist)) {
      throw new Error('QQ 歌单不存在或已失效');
    }
    return {
      id: String(cd.disstid ?? playlistId),
      platform: 'qq',
      name: cd.dissname ?? '未命名歌单',
      cover: cd.logo ?? '',
      description: cd.desc,
      tracks: cd.songlist.map(mapQQTrack).filter((t): t is NonNullable<typeof t> => !!t),
    };
  }

  private mediaIds = new Map<string,string>();
  getAuthStatus() {return qqSession(this.http).peek(this.cookies.getHeader('qq') || '');}
  async fetchSongUrl(songmid: string, _albumId?: string, quality?: string, extra?: Record<string, unknown>): Promise<SongUrl | null> {
    const cookie=this.cookies.getHeader('qq') || '';
    const credential=qqCredential(cookie),{uin,key}=credential,session=qqSession(this.http);
    if(session.peek(cookie)==='expired')return {url:'',playable:false,code:'AUTH_EXPIRED',error:QQ_AUTH_EXPIRED};
    let media=String(extra?.mediaMid || this.mediaIds.get(songmid) || '');
    if (!media) {
      const detail=await musicuPost(this.http,'music.pf_song_detail_svr','get_song_detail_yqq',{song_mid:songmid});
      media=String(detail?.data?.track_info?.file?.media_mid || '');
      if (media) { this.mediaIds.set(songmid,media);if(this.mediaIds.size>512)this.mediaIds.delete(this.mediaIds.keys().next().value!); }
    }
    throwIfCancelled();
    const index=QQ_QUALITY_TIERS.findIndex(t=>t.level===quality);
    const tiers=QQ_QUALITY_TIERS.slice(index<0?0:index);
    const mediaIds=[...new Set([media,songmid].filter(Boolean))];
    const files=tiers.flatMap(t=>mediaIds.map(id=>({name:t.prefix+id+(t.level==='flac'?'.flac':'.mp3'),level:t.level})));
    const guid=String(Math.floor(1e9+Math.random()*8e9));
    try {
      const probeLogin=session.needsProbe(cookie);
      const body={comm:qqComm(credential,key?19:24),...(probeLogin?{req_login:qqLoginProbe()}:{}),req_0:{
        module:'vkey.GetVkeyServer',method:'CgiGetVkey',param:{
          guid,uin,loginflag:1,platform:'20',songmid:files.map(()=>songmid),songtype:files.map(()=>0),filename:files.map(f=>f.name),
        },
      }};
      const requestedAt=Date.now();
      const data=await this.http.requestJson<Record<string,any>>('https://u.y.qq.com/cgi-bin/musicu.fcg',{platform:'qq',method:'POST',cookie,body,timeoutMs:2000});
      if(probeLogin)session.observe(cookie,data?.req_login);
      // 通用鉴权失败码与登录探针分开；空purl、1901和参数错误不证明票据过期。
      if(key && [1000,104401].includes(Number(data?.req_0?.code || data?.code)))session.remember(cookie,'expired');
      if(session.peek(cookie)==='expired')return {url:'',playable:false,code:'AUTH_EXPIRED',error:QQ_AUTH_EXPIRED};
      const payload=data?.req_0?.data;
      const rows=Array.isArray(payload?.midurlinfo)?payload.midurlinfo:[];
      for (const file of files) {
        const row=rows.find((r:Record<string,any>)=>r.filename===file.name && r.purl);
        if (!row) continue;
        const sip=(payload.sip || []).find((v:unknown)=>typeof v==='string' && /^https?:/.test(v)) || 'https://ws.stream.qqmusic.qq.com/';
        const url=new URL(row.purl,sip).href.replace(/^http:/,'https:');
        // 档位按服务端实际文件名识别，拒绝无法识别或不属于本次请求的文件。
        const actual=QQ_QUALITY_TIERS.find(t=>new URL(url).pathname.split('/').pop()?.startsWith(t.prefix));
        if(!actual)continue;
        return {url,quality:actual.level,playable:true,trial:false,...sourceTiming('qq',requestedAt,expiresAfterSeconds(payload.expiration,requestedAt))};
      }
      const missing=uin==='0' || !key;
      if(missing)return {url:'',playable:false,code:'LOGIN_REQUIRED',error:'QQ 音乐播放票据不完整，请重新登录'};
      if(Number(data?.req_0?.code || data?.code || 0)!==0)
        return {url:'',playable:false,code:'UPSTREAM_ERROR',error:'QQ 取链接口返回异常，不能据此判断会员权限'};
      const verified=session.peek(cookie)==='valid';
      return {url:'',playable:false,code:verified?'RIGHTS_OR_UNAVAILABLE':'AUTH_UNVERIFIED',error:verified
        ?'QQ 登录有效，但当前歌曲未返回可用音源（版权、地区、音质或单曲授权）'
        :'QQ 登录状态暂未核验，无法判断是播放票据还是歌曲授权问题'};
    } catch {
      throwIfCancelled();
      return {url:'',playable:false,code:'NETWORK',error:'QQ 取链接口暂时不可用'};
    }
  }

  async listQualities(): Promise<QualityOption[]> {
    return QQ_QUALITY_TIERS.map(({ level, label }) => ({ level, label }));
  }

  /** QQ keyword search (for SongResolver / LyricService fallback). */
  async searchSongs(keyword: string, pageSize = 10): Promise<Track[]> {
    try {
      const data = await this.http.requestJson<{
        data?: { song?: { list?: Array<Record<string, any>> } };
      }>(
        `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(keyword)}&t=0&p=1&n=${pageSize}&format=json&inCharset=utf-8&outCharset=utf-8&cr=1`,
        { platform: 'qq' },
      );
      return (data?.data?.song?.list ?? []).map(mapQQTrack).filter((t): t is Track => !!t);
    } catch (err) {
      console.warn("[QqAdapter] search failed:");
      return [];
    }
  }

  /**
   * 关键词搜歌手：`soso/client_search_cp` 的 `t=1` 早已废弃（实测恒定返回 0 条，2026-11-21 复核），
   * 改用 smartbox 联想接口（#228）：给 id / mid / name / pic，pic 就是歌手头像。
   */
  async searchArtists(keyword: string, pageSize = 5): Promise<ArtistSearchHit[]> {
    try {
      const data = await this.http.requestJson<{
        data?: { singer?: { itemlist?: Array<Record<string, any>> } };
      }>(
        `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=${encodeURIComponent(keyword)}&format=json&inCharset=utf-8&outCharset=utf-8`,
        { platform: 'qq' },
      );
      const list = data?.data?.singer?.itemlist ?? [];
      return list
        .slice(0, pageSize)
        .map((a) => ({
          platform: 'qq' as const,
          id: String(a.mid || a.id || ''),
          name: String(a.name ?? ''),
          avatar: String(a.pic ?? ''),
        }))
        .filter((a) => a.id && a.name);
    } catch (err) {
      console.warn('[QqAdapter] searchArtists failed:');
      return [];
    }
  }

  /**
   * 关键词搜专辑（供跨平台专辑转译与专辑页兜底）：
   * client_search_cp 的 t=8 才是专辑搜索（t=10 / 默认 0 都不返回专辑），字段为
   * albumMID / albumName / singerName / publicTime / song_count。
   */
  async searchAlbums(keyword: string, pageSize = 8): Promise<AlbumSummary[]> {
    try {
      const data = await this.http.requestJson<{
        data?: { album?: { list?: Array<Record<string, any>> } };
      }>(
        `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(keyword)}&t=8&p=1&n=${pageSize}&format=json&inCharset=utf-8&outCharset=utf-8&cr=1`,
        { platform: 'qq' },
      );
      return (data?.data?.album?.list ?? [])
        .map((a) => {
          const mid = String(a.albumMID ?? a.album_mid ?? '');
          const singers = Array.isArray(a.singer_list)
            ? a.singer_list.map((s: Record<string, any>) => String(s?.name ?? '')).filter(Boolean)
            : [];
          return {
            platform: 'qq' as const,
            id: mid,
            name: String(a.albumName ?? a.album_name ?? ''),
            cover: mid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${mid}.jpg` : '',
            artist: singers.length ? singers.join('/') : String(a.singerName ?? a.singer_name ?? ''),
            year: a.publicTime ? Number(String(a.publicTime).slice(0, 4)) || undefined : undefined,
            songCount: Number(a.song_count ?? a.songCount) || undefined,
          };
        })
        .filter((a) => a.id && a.name);
    } catch (err) {
      console.warn("[QqAdapter] searchAlbums failed:");
      return [];
    }
  }

  /**
   * QQ 逐字歌词：music.musichallSong.PlayLyricInfo/GetPlayLyricInfo
   * 返回 lyric(LRC) / trans / roma / qrc（均可能 base64），qrc 作为字级歌词返回，
   * 前端会把 qrc 映射进 yrc 统一走 parseYrcText。
   */
  async fetchLyric(songmid: string): Promise<Lyric | null> {
    const detail=await musicuPost(this.http,'music.pf_song_detail_svr','get_song_detail_yqq',{song_mid:songmid});
    const songId=detail?.data?.track_info?.id;
    try {
      const data = await this.http.requestJson<{
        req_0?: {
          code?: number;
          data?: { lyric?: string; trans?: string; roma?: string; qrc?: string };
        };
      }>('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        platform: 'qq',
        method: 'POST',
        body: {
          comm: {ct:19,cv:2111},
          req_0: {
            module: 'music.musichallSong.PlayLyricInfo',
            method: 'GetPlayLyricInfo',
            param: { songMID:songmid, songID:songId, crypt:0, ct:19, cv:2111, qrc:1, qrc_t:0, lrc_t:0, trans:1, trans_t:0, roma:1, roma_t:0, type:0 },
          },
        },
      });
      const d = data?.req_0?.data;
      if (d) {
        const lrc = decodeQqLyric(d.lyric);
        const tlyric = decodeQqLyric(d.trans);
        const roma = decodeQqLyric(d.roma);
        const qrc = decodeQqLyric(d.qrc);
        const timed=fromTimed(qrc || lrc,'qrc',tlyric,roma);
        if(timed)return timed;
        if (lrc || qrc) {
          return {
            lines: mergeLyric(lrc, tlyric),
            raw: lrc,
            translationRaw: tlyric,
            romanRaw: roma,
            source: 'qq',
            lrc,
            tlyric,
            romalrc: roma,
            qrc,
          };
        }
      }
    } catch (err) {
      console.warn("[QqAdapter] PlayLyricInfo failed:");
    }
    try {
      const data = await this.http.requestJson<{ lyric?: string; trans?: string }>(
        `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(songmid)}&format=json&nobase64=1`,
        { platform: 'qq' },
      );
      const raw = decodeMaybeBase64(data?.lyric ?? '');
      if (!raw) return null;
      const trans = decodeMaybeBase64(data?.trans ?? '');
      return { lines: mergeLyric(raw, trans), raw, translationRaw: trans, source: 'qq', lrc: raw, tlyric: trans };
    } catch (err) {
      console.warn("[QqAdapter] lyric failed:");
      return null;
    }
  }

  /**
   * QQ 评论：topid 需要数字 songid（songmid 无效）；cmd=6 热门 / cmd=8 全部（最新），
   * comment.commenttotal 为总数、morecomment 表示是否还有下一页。
   */
  async fetchComments(songmid: string, page = 0): Promise<CommentResult | null> {
    try {
      const req = await musicuPost(this.http, 'music.pf_song_detail_svr', 'get_song_detail_yqq', {
        song_mid: songmid,
      });
      const songId = (req?.data?.track_info as { id?: number | string } | undefined)?.id;
      if (!songId) return null;
      const q = (cmd: number, pagenum: number) =>
        `https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg?g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&cid=205360772&reqtype=2&biztype=1&topid=${encodeURIComponent(String(songId))}&cmd=${cmd}&needmusiccrit=0&pagenum=${pagenum}&pagesize=25&domain=qq.com&ct=24`;
      const map = (list: Array<Record<string, any>> | undefined) =>
        (list ?? []).map((c) => ({
          id: String(c.commentid ?? ''),
          nickname: c.rootcommentnick || c.nick || '匿名用户',
          avatarUrl: String(c.avatarurl ?? '').replace(/^http:\/\//, 'https://'),
          content: cleanQqComment(c.rootcommentcontent || c.middlecommentcontent || ''),
          likedCount: c.praisenum ?? c.rootcommentlikenum ?? 0,
        }));

      const [latestData, hotData] = page === 0
        ? await Promise.all([
            this.http.requestJson<{ comment?: { commentlist?: Array<Record<string, any>>; commenttotal?: number }; morecomment?: number }>(q(8, 1), { platform: 'qq' }),
            this.http.requestJson<{ comment?: { commentlist?: Array<Record<string, any>> } }>(q(6, 1), { platform: 'qq' }),
          ])
        : [await this.http.requestJson<{ comment?: { commentlist?: Array<Record<string, any>>; commenttotal?: number }; morecomment?: number }>(q(8, page + 1), { platform: 'qq' }), null];

      return {
        hot: map(hotData?.comment?.commentlist),
        latest: map(latestData?.comment?.commentlist),
        latestTotal: latestData?.comment?.commenttotal,
        hasMoreLatest: (latestData?.morecomment ?? 0) > 0,
      };
    } catch (err) {
      console.warn("[QqAdapter] comments failed:");
      return null;
    }
  }

  async fetchSongDetail(songmid: string): Promise<SongDetail | null> {
    const req = await musicuPost(this.http, 'music.pf_song_detail_svr', 'get_song_detail_yqq', {
      song_mid: songmid,
    });
    const t = req?.data?.track_info as Record<string, any> | undefined;
    if (!t) return null;
    return {
      platform: 'qq',
      title: t.name ?? t.title ?? '',
      artists: (t.singer ?? []).map((s: Record<string, any>) => ({
        id: String(s.mid ?? s.id ?? ''),
        name: s.name ?? '',
      })),
      album: {
        id: String(t.album?.mid ?? ''),
        name: t.album?.name ?? '',
        cover: t.album?.mid
          ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${t.album.mid}.jpg`
          : '',
        publishDate: t.album?.time_public || undefined,
      },
      duration: t.interval,
    };
  }

  async fetchArtistInfo(artistId: string): Promise<ArtistInfo | null> {
    const req = await musicuPost(this.http, 'music.musichallSinger.SingerInfoInter', 'GetSingerDetail', {
      singer_mids: [artistId],
      group_singer: 1,
      wiki_singer: 1,
      ex_singer: 1,
      pic: 1,
      photos: 1,
    });
    const singer = (req?.data?.singer_list as Array<Record<string, any>> | undefined)?.[0];
    const basic = singer?.basic_info as Record<string, any> | undefined;
    if (!basic) return null;
    const pmid = String(basic.singer_pmid ?? '');
    return {
      platform: 'qq',
      id: String(basic.singer_mid ?? artistId),
      name: basic.name ?? '',
      avatar: pmid ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${pmid}.jpg` : '',
      description: singer?.ex_info?.desc || undefined,
    };
  }

  async fetchArtistSongs(artistId: string): Promise<Track[]> {
    const req = await musicuPost(this.http, 'musichall.song_list_server', 'GetSingerSongList', {
      singerMid: artistId,
      order: 1,
      number: 50,
      begin: 0,
    });
    return ((req?.data?.songList as Array<Record<string, any>> | undefined) ?? [])
      .map((item) => {
        const s = (item.songInfo ?? item) as Record<string, any>;
        // artist songInfo 形状 → 搜索形状（songmid/songname）
        return mapQQTrack({
          songmid: s.mid ?? s.songmid,
          songname: s.name ?? s.title ?? s.songname,
          singer: s.singer,
          albummid: s.album?.mid ?? s.albummid,
          albumname: s.album?.name ?? s.albumname,
          interval: s.interval,
        });
      })
      .filter((t): t is Track => !!t);
  }

  async fetchArtistAlbums(artistId: string): Promise<AlbumSummary[]> {
    const req = await musicuPost(this.http, 'music.musichallAlbum.AlbumListServer', 'GetAlbumList', {
      singerMid: artistId,
      order: 1,
      number: 50,
      begin: 0,
    });
    return ((req?.data?.albumList as Array<Record<string, any>> | undefined) ?? []).map((a) => ({
      platform: 'qq' as const,
      id: String(a.albumMid ?? a.albumID ?? ''),
      name: a.albumName ?? '',
      cover: a.pmid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${a.pmid}.jpg` : '',
      year: a.publishDate ? Number(String(a.publishDate).slice(0, 4)) || undefined : undefined,
      songCount: a.totalNum,
    }));
  }

  /** 歌手全部歌曲：GetSingerSongList 分页拉全（接口单页上限 30，按 totalNum 拉全，上限 1000 首）。 */
  async fetchArtistAllSongs(artistId: string): Promise<Track[]> {
    const out: Track[] = [];
    const seen = new Set<string>();
    try {
      for (let begin = 0; begin < 1000; begin += 30) {
        const req = await musicuPost(this.http, 'musichall.song_list_server', 'GetSingerSongList', {
          singerMid: artistId,
          order: 1,
          number: 30,
          begin,
        });
        const list = (req?.data?.songList as Array<Record<string, any>> | undefined) ?? [];
        const totalNum = Number(req?.data?.totalNum) || 0;
        let added = 0;
        for (const item of list) {
          const s = (item.songInfo ?? item) as Record<string, any>;
          const t = mapQQTrack({
            songmid: s.mid ?? s.songmid,
            songname: s.name ?? s.title ?? s.songname,
            singer: s.singer,
            albummid: s.album?.mid ?? s.albummid,
            albumname: s.album?.name ?? s.albumname,
            interval: s.interval,
          });
          if (!t) continue;
          if (seen.has(t.sourceId)) continue;
          seen.add(t.sourceId);
          out.push(t);
          added++;
        }
        if (list.length < 30 || added === 0 || out.length >= totalNum) break;
      }
    } catch (err) {
      console.warn("[QqAdapter] 歌手全部歌曲失败:");
    }
    return out;
  }

  /**
   * 专辑详情：legacy fcg_v8_album_info_cp.fcg（albummid 参数），
   * 返回基本信息 + 完整曲目列表（songmid/singer/albummid 与 mapQQTrack 兼容）。
   */
  async fetchAlbumDetail(albumId: string): Promise<AlbumDetail | null> {
    try {
      const data = await this.http.requestJson<{
        code?: number;
        data?: {
          mid?: string;
          name?: string;
          singermid?: string;
          singername?: string;
          aDate?: string;
          list?: Array<Record<string, any>>;
        };
      }>(
        `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?albummid=${encodeURIComponent(albumId)}&format=json&inCharset=utf-8&outCharset=utf-8&platform=yqq.json&needNewCode=1&g_tk=5381`,
        { platform: 'qq' },
      );
      const d = data?.data;
      if (!d || !Array.isArray(d.list)) return null;
      const tracks = d.list.map(mapQQTrack).filter((t): t is Track => !!t);
      return {
        platform: 'qq',
        id: String(d.mid ?? albumId),
        name: d.name ?? '',
        cover: d.mid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${d.mid}.jpg` : '',
        year: d.aDate ? Number(String(d.aDate).slice(0, 4)) || undefined : undefined,
        artist: d.singername || undefined,
        tracks,
      };
    } catch (err) {
      console.warn("[QqAdapter] 专辑详情失败:");
      return null;
    }
  }
}
