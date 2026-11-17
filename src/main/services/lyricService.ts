import type { AdapterMap } from '../adapters/index';
import type {
  AlbumSummary,
  AlbumDetail,
  ArtistInfo,
  ArtistSearchHit,
  CommentResult,
  Lyric,
  Platform,
  SongDetail,
  Track,
} from '../types';
import { creditsFromLrc } from '../parsers/lyricParser';
import { matchScore } from './songResolver';
import { normalizeQuery, titleSimilarity } from '../adapters/mappers';
import { LyricCache } from './lyricCache';
import { withRequestScope, throwIfCancelled } from '../requestScope';
import { enrichAligned, lyricCoverage } from './lyricAlignment';


/** 歌词/评论统一入口：平台失败返回 null，不向上抛错。 */
/** 去掉搜索接口返回的高亮标签（<em>…</em> 等），并还原常见 HTML 实体。 */
function stripMarkup<T extends string | undefined>(v: T): T {
  if (typeof v !== 'string') return v;
  return v
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&') as T;
}

export class LyricService {
  constructor(
    private adapters: AdapterMap,
    private cache?: LyricCache,
  ) {}

  private lyricJobs=new Map<string,{control:AbortController;users:number;done:boolean;promise:Promise<Lyric|null>}>();
  async fetchLyric(track: Track, signal?:AbortSignal): Promise<Lyric | null> {
    if(signal?.aborted)return null;
    const cached=this.cache?.get(track.platform,track.sourceId);if(cached)return cached;
    const key=track.platform+':'+track.sourceId;
    const pending=this.lyricJobs.get(key);if(pending && !pending.control.signal.aborted)return this.consumeLyric(pending,signal);
    const job={control:new AbortController(),users:0,done:false,promise:Promise.resolve(null) as Promise<Lyric|null>};
    let best:Lyric|null=null;
    const task=withRequestScope(8500,async()=>{
      const fetch=async(t:Track,kind:'primary'|'fallback'):Promise<Lyric|null>=>{
        const lyric=await withRequestScope(3200,()=>this.adapters[t.platform].fetchLyric(t.sourceId,t.duration? t.duration*1000:undefined)).catch(()=>null);
        throwIfCancelled();
        return lyric?.lines?.length?{...lyric,identity:{platform:t.platform,sourceId:t.sourceId},provenance:[{platform:t.platform,sourceId:t.sourceId,kind}]}:null;
      };
      best=await fetch(track,'primary');
      const good=(l:Lyric|null):boolean=>{if(!l)return false;const c=lyricCoverage(l);return c.textLines>0 && c.wordLines/c.textLines>=.8 && c.translatedLines/c.textLines>=.8};
      if(good(best))return best;
      const sources=(['netease','qq','kugou'] as Platform[]).filter(p=>p!==track.platform && this.adapters[p]?.searchSongs);
      const candidates=await Promise.all(sources.map(async platform=>{
        try{
          const rows=await withRequestScope(1800,()=>this.adapters[platform].searchSongs!(`${track.title} ${track.artist}`.trim(),10));
          const match=rows.map(t=>({t,score:matchScore(t,track)})).filter(x=>x.score>=.9).sort((a,b)=>b.score-a.score)[0];
          return match?await fetch(match.t,'fallback'):null;
        }catch{return null;}
      }));
      throwIfCancelled();
      // 固定平台顺序合并，网络完成顺序不改变结果。
      for(const lyric of candidates){
        if(!lyric)continue;
        if(!best){
          // 无主源正文就无法验证跨源时间轴，只提供整句，保持未完成标志。
          best={...lyric,yrc:undefined,qrc:undefined,krc:undefined,incomplete:true};
        }else best=enrichAligned(best,lyric);
      }
      return best;
    },{detached:true,signal:job.control.signal}).catch(()=>best).then(lyric=>{
      if(!lyric || job.control.signal.aborted)return null;
      const coverage=lyricCoverage(lyric);
      const incomplete=lyric.incomplete || !coverage.textLines || coverage.wordLines/coverage.textLines<.8 || coverage.translatedLines/coverage.textLines<.8;
      const result={...lyric,coverage,incomplete};this.cache?.set(track.platform,track.sourceId,result);return result;
    }).finally(()=>{job.done=true;if(this.lyricJobs.get(key)===job)this.lyricJobs.delete(key);});
    job.promise=task;this.lyricJobs.set(key,job);return this.consumeLyric(job,signal);
  }

  private consumeLyric(job:{control:AbortController;users:number;done:boolean;promise:Promise<Lyric|null>},signal?:AbortSignal):Promise<Lyric|null> {
    job.users++;
    return new Promise(resolve=>{
      let settled=false;
      const finish=(value:Lyric|null)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);job.users--;if(!job.users && !job.done)job.control.abort();resolve(value);};
      const cancel=()=>finish(null);signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted)cancel();void job.promise.then(finish);
    });
  }

  async fetchComments(track: Track, page = 0): Promise<CommentResult | null> {
      try {
        const fn = this.adapters[track.platform].fetchComments;
        return fn ? await fn.call(this.adapters[track.platform], track.sourceId, page) : null;
      } catch (err) {
        console.warn("[LyricService] 评论获取失败:");
        return null;
      }
    }

  /** 歌手全部歌曲（netease/qq 分页拉全；未实现平台返回空数组）。 */
  async fetchArtistAllSongs(platform: Platform, artistId: string): Promise<Track[]> {
    try {
      const adapter = this.adapters[platform];
      return adapter.fetchArtistAllSongs ? await adapter.fetchArtistAllSongs(artistId) : [];
    } catch (err) {
      console.warn("[LyricService] 歌手全部歌曲失败:");
      return [];
    }
  }

  /**
   * 名字转译：按歌手名在网易云/QQ 搜歌手，返回最佳命中（供酷狗/汽水/Spotify
   * 等无歌手接口的平台点击歌手时路由到可展示的歌手页）。
   */
  async resolveArtistByName(name: string): Promise<ArtistSearchHit | null> {
    const clean = String(name || '').trim();
    if (!clean) return null;
    const hits = await this.searchArtists(clean, 8);
    const scored = hits
      .map((h) => ({ h, score: titleSimilarity(h.name, clean) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored[0]?.h ?? null;
  }

  /**
   * 专辑转译：按专辑名在网易云搜专辑，歌手名双重校验（歌手不一致降权但不直接排除，
   * 因为网易云专辑搜索结果里歌手字段可能为空）。
   */
  async resolveAlbumByTitle(title: string, artist?: string): Promise<AlbumSummary | null> {
    const clean = String(title || '').trim();
    if (!clean) return null;
    const nArtist = artist ? normalizeQuery(artist) : '';
    const albums = this.adapters.netease.searchAlbums
      ? await this.adapters.netease.searchAlbums(clean, 10)
      : [];
    const scored = albums
      .map((a) => {
        const score = titleSimilarity(a.name, clean);
        if (score <= 0) return { a, score: 0 };
        if (nArtist) {
          const albumArtist = normalizeQuery(a.artist ?? '');
          const artistHit =
            !!albumArtist &&
            (albumArtist === nArtist || albumArtist.includes(nArtist) || nArtist.includes(albumArtist));
          if (!artistHit) return { a, score: score * 0.4 };
        }
        return { a, score };
      })
      .filter((x) => x.score > 0.4)
      .sort((x, y) => y.score - x.score);
    return scored[0]?.a ?? null;
  }

  async fetchSongDetail(track: Track): Promise<SongDetail | null> {
    try {
      const adapter = this.adapters[track.platform];
      let detail = adapter.fetchSongDetail ? await adapter.fetchSongDetail(track.sourceId) : null;
      if (detail && !detail.credits?.length) {
        const lyric = await this.fetchLyric(track);
        if (lyric?.lrc) detail = { ...detail, credits: creditsFromLrc(lyric.lrc) };
      }
      return detail;
    } catch (err) {
      console.warn("[LyricService] 歌曲详情失败:");
      return null;
    }
  }

  async fetchArtistInfo(platform: Platform, artistId: string): Promise<ArtistInfo | null> {
    try {
      const adapter = this.adapters[platform];
      return adapter.fetchArtistInfo ? await adapter.fetchArtistInfo(artistId) : null;
    } catch (err) {
      console.warn("[LyricService] 歌手信息失败:");
      return null;
    }
  }

  async fetchArtistSongs(platform: Platform, artistId: string): Promise<Track[]> {
    try {
      const adapter = this.adapters[platform];
      return adapter.fetchArtistSongs ? await adapter.fetchArtistSongs(artistId) : [];
    } catch (err) {
      console.warn("[LyricService] 歌手歌曲失败:");
      return [];
    }
  }

  async fetchArtistAlbums(platform: Platform, artistId: string): Promise<AlbumSummary[]> {
    try {
      const adapter = this.adapters[platform];
      return adapter.fetchArtistAlbums ? await adapter.fetchArtistAlbums(artistId) : [];
    } catch (err) {
      console.warn("[LyricService] 歌手专辑失败:");
      return [];
    }
  }

  async fetchAlbumDetail(platform: Platform, albumId: string): Promise<AlbumDetail | null> {
    try {
      const adapter = this.adapters[platform];
      return adapter.fetchAlbumDetail ? await adapter.fetchAlbumDetail(albumId) : null;
    } catch (err) {
      console.warn("[LyricService] 专辑详情失败:");
      return null;
    }
  }

  /** 全网搜歌：网易云 + QQ（酷狗兜底），按页容量裁剪、去重。 */
  async searchSongs(keyword: string, pageSize = 8): Promise<Track[]> {
    const per = Math.max(2, Math.ceil(pageSize / 2));
    const out: Track[] = [];
    const seen = new Set<string>();
    const push = (t: Track) => {
      const key = `${t.platform}:${t.sourceId}`;
      if (seen.has(key)) return;
      seen.add(key);
      // 平台搜索接口会把命中词包成 <em>…</em>（QQ 尤其），界面上原样露出来；统一在这里清洗
      out.push({ ...t, title: stripMarkup(t.title), artist: stripMarkup(t.artist), album: stripMarkup(t.album) });
    };
    const sources = [this.adapters.netease, this.adapters.qq, this.adapters.kugou];
    await Promise.all(
      sources.map(async (adapter) => {
        if (!adapter.searchSongs) return;
        try {
          const list = await adapter.searchSongs(keyword, per);
          list.forEach(push);
        } catch (err) {
          console.warn("[LyricService] searchSongs");
        }
      }),
    );
    return out.slice(0, pageSize);
  }

  /** 全网搜歌手：网易云 + QQ。 */
  async searchArtists(keyword: string, pageSize = 5): Promise<ArtistSearchHit[]> {
    const per = Math.max(2, Math.ceil(pageSize / 2));
    const out: ArtistSearchHit[] = [];
    const seen = new Set<string>();
    const sources = [this.adapters.netease, this.adapters.qq];
    await Promise.all(
      sources.map(async (adapter) => {
        if (!adapter.searchArtists) return;
        try {
          const list = await adapter.searchArtists(keyword, per);
          for (const hit of list) {
            const key = `${hit.platform}:${hit.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ ...hit, name: stripMarkup(hit.name) });
          }
        } catch (err) {
          console.warn("[LyricService] searchArtists");
        }
      }),
    );
    return out.slice(0, pageSize);
  }
}
