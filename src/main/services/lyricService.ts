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
import { creditsFromLrc, parseLrc } from '../parsers/lyricParser';
import { lrcAt } from '../parsers/timedLyrics';
import { hasHangul, romanizeKorean } from '../parsers/romanizeKorean';
import { matchScore } from './songResolver';
import { recordingMatch, searchKeyword } from './recordingMatch';
import { normalizeQuery, titleSimilarity } from '../adapters/mappers';
import { LyricCache } from './lyricCache';
import { withRequestScope, throwIfCancelled, requestScope } from '../requestScope';
import { enrichAligned, lyricComplete, lyricCoverage, snapLinesToWords } from './lyricAlignment';
import type { AmllSource } from './amllLyrics';
import type { AppleLyricsSource } from './appleMusicLyrics';
import { LYRIC_ID_ORDER, lyricIdsOf, mergeLyricIds, type LyricIdKey, type LyricIds } from './lyricSourceIds';


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

/**
 * 韩语歌缺罗马音的行用本地转写补上（平台常只给部分行；实测 QQ 韩语歌只有约两成完整）。
 * 平台给了的行保留原样；至少两行含韩文才算韩语歌。补了多少行记在 romanGenerated。
 */
export function withKoreanRoman(l: Lyric): Lyric {
  // 「曲：안지영」这类署名行不转写
  const rows = l.lines.filter((x) => x.text.trim() && hasHangul(x.text) && !/^[^:：]{1,24}[:：]/.test(x.text.trim()));
  if (rows.length < 2) return l;
  const existing = parseLrc(l.romalrc || l.romanRaw || '').filter((r) => r.text.trim());
  const missing = rows.filter((r) => !existing.some((e) => Math.abs(e.timeMs - r.timeMs) <= 250));
  if (!missing.length) return l;
  const merged = [...existing, ...missing.map((r) => ({ timeMs: r.timeMs, text: romanizeKorean(r.text) }))].sort(
    (a, b) => a.timeMs - b.timeMs,
  );
  const romalrc = merged.map((r) => lrcAt(r.timeMs, r.text)).join('\n');
  return { ...l, romalrc, romanRaw: romalrc, romanGenerated: missing.length };
}

/** 逐字歌词的额外来源（构造时注入，测试里可以换成假的）。 */
export interface LyricExtraSources {
  /** AMLL 社区逐字歌词库。 */
  amll?: AmllSource;
  /** Apple Music 逐字歌词（需要用户登录过 Apple Music）。 */
  appleMusic?: AppleLyricsSource;
}

/** 新来源各自的预算（毫秒）：AMLL 第一轮与搜索并行；第二轮在搜索结束后，只用剩下的时间。 */
const AMLL_BUDGET_MS = 3500;
const AMLL_SECOND_BUDGET_MS = 2500;
const APPLE_BUDGET_MS = 4200;
/** 主歌词已经够好时顺手再查一次 AMLL（只为补和声 / 对唱归属，#199）：预算很小，不能拖慢一首本来就齐的歌。 */
const AMLL_RICH_BUDGET_MS = 1200;

/** 待合并的一份歌词：trusted = 按 id 确认是同一录音（AMLL、Apple 目录 id），不再要求时长差 ≤2 秒。 */
interface LyricHit { lyric: Lyric; duration: number; trusted: boolean }

export class LyricService {
  constructor(
    private adapters: AdapterMap,
    private cache?: LyricCache,
    private extra: LyricExtraSources = {},
  ) {}

  /** AMLL 查一次；任何失败都当没有。failed=true 表示来源出错 / 超时（不同于「没收录」），调用方不要再试第二轮。 */
  /**
   * fromSearch：第二轮用的是「按歌名搜到的网易云 / QQ 那首」的 id——那首只是歌名评分过线、不是严格确认的同一录音，
   * 所以命中后不算 trusted，时长取那首的时长，照常按「时长差 ≤2 秒」判断能不能保留逐字。
   */
  private async amllHit(ids: LyricIds, budgetMs: number, fromSearch?: (key: LyricIdKey, id: string) => number): Promise<{ hit: LyricHit | null; failed: boolean }> {
    if (!this.extra.amll || !LYRIC_ID_ORDER.some((k) => ids[k] !== undefined)) return { hit: null, failed: false }; // 没有任何可查的 id 就不查
    const amll = this.extra.amll;
    try {
      // 自己再卡一道预算：来源卡住也只拖到预算为止，不会拖到整体 8.5 秒把别的结果一起丢掉
      const hit = await withRequestScope(budgetMs, () => amll.lookup(ids));
      if (!hit?.lyric?.lines?.length) return { hit: null, failed: false };
      const sourceId = `${hit.matchedBy}:${hit.id}`;
      const lyric = { ...hit.lyric, identity: { platform: 'amll', sourceId }, provenance: [{ platform: 'amll', sourceId, kind: 'fallback' as const }] };
      if (fromSearch) return { hit: { lyric, duration: fromSearch(hit.matchedBy, hit.id) || 0, trusted: false }, failed: false };
      return { hit: { lyric, duration: 0, trusted: true }, failed: false };
    } catch {
      return { hit: null, failed: true };
    }
  }

  /** Apple Music 查一次；任何失败都当没有。 */
  private async appleHit(track: Track, origin?: Track): Promise<LyricHit | null> {
    if (!this.extra.appleMusic) return null;
    const apple = this.extra.appleMusic;
    try {
      const hit = await withRequestScope(APPLE_BUDGET_MS, () => apple.lookup(track, origin));
      if (!hit?.lyric?.lines?.length) return null;
      return {
        lyric: { ...hit.lyric, identity: { platform: 'applemusic', sourceId: hit.catalogId }, provenance: [{ platform: 'applemusic', sourceId: hit.catalogId, kind: 'fallback' }] },
        duration: Number(hit.duration) || 0,
        trusted: hit.via === 'id',
      };
    } catch {
      return null;
    }
  }

  private lyricJobs=new Map<string,{control:AbortController;users:number;done:boolean;promise:Promise<Lyric|null>}>();
  /**
   * origin：兜底播放时用户点的原曲（只用来提供 AMLL / Apple 查询用的 id）；缓存键和歌词身份仍按 track（实际供流那首）。
   */
  async fetchLyric(track: Track, signal?:AbortSignal, origin?: Track): Promise<Lyric | null> {
    if(signal?.aborted)return null;
    const cached=this.cache?.get(track.platform,track.sourceId);if(cached)return withKoreanRoman(cached);
    const key=track.platform+':'+track.sourceId;
    const pending=this.lyricJobs.get(key);if(pending && !pending.control.signal.aborted)return this.consumeLyric(pending,signal);
    const job={control:new AbortController(),users:0,done:false,promise:Promise.resolve(null) as Promise<Lyric|null>};
    let best:Lyric|null=null;
    const task=withRequestScope(8500,async()=>{
      const fetch=async(t:Track,kind:'primary'|'fallback'):Promise<Lyric|null>=>{
        const lyric=await withRequestScope(3200,()=>this.adapters[t.platform].fetchLyric(t.sourceId,t.duration? t.duration*1000:undefined)).catch(()=>null);
        throwIfCancelled();
        // 同一份歌词里普通行和逐字行开头差几百毫秒的，先把行时间校准到逐字（#196），否则自带的逐字会被当成没有
        return lyric?.lines?.length?snapLinesToWords({...lyric,identity:{platform:t.platform,sourceId:t.sourceId},provenance:[{platform:t.platform,sourceId:t.sourceId,kind}]}):null;
      };
      best=await fetch(track,'primary');
      // 够好就不去别家补：判定按语种（中文不要求翻译，日语要罗马音，见 lyricComplete）
      if(best && lyricComplete(best)){
        // 只按已知 id 查一次 AMLL（不查 Apple、不搜别的平台）：它带和声 / 对唱归属，主歌词没有这两样；只补缺的层，不动已有的。没命中 / 失败照旧返回
        const {hit}=await this.amllHit(mergeLyricIds(lyricIdsOf(track),lyricIdsOf(origin)),AMLL_RICH_BUDGET_MS);
        throwIfCancelled();
        return hit?enrichAligned(best,hit.lyric):best;
      }
      const sources=(['netease','qq','kugou'] as Platform[]).filter(p=>p!==track.platform && this.adapters[p]?.searchSongs);
      // AMLL / Apple 和网易云 / QQ / 酷狗的搜索并行；新来源失败或超时只当没有，不影响其余。
      const ids=mergeLyricIds(lyricIdsOf(track),lyricIdsOf(origin));
      const amllFirst=this.amllHit(ids,AMLL_BUDGET_MS),apple=this.appleHit(track,origin);
      const candidates=await Promise.all(sources.map(async platform=>{
        try{
          const rows=await withRequestScope(1800,()=>this.adapters[platform].searchSongs!(searchKeyword(track),10));
          const match=rows.map(t=>({t,score:matchScore(t,track)})).filter(x=>x.score>=.9).sort((a,b)=>b.score-a.score)[0];
          const lyric=match?await fetch(match.t,'fallback'):null;
          return match?{lyric,from:match.t}:null;
        }catch{return null;}
      }));
      throwIfCancelled();
      const first=await amllFirst;
      let amll=first.hit;
      if(!amll && !first.failed && this.extra.amll){
        // 第一轮没命中：搜到的网易云 / QQ 同一首带来了新 id，再查一次。
        const found=mergeLyricIds(ids,...candidates.map(c=>c?lyricIdsOf(c.from):undefined));
        // 第二轮只用整体截止前剩下的时间（留 600ms 给合并），不够就不查
        const left=(requestScope()?.deadline??Infinity)-Date.now()-600;
        // 命中的 id 来自哪首搜到的歌，就用那首的时长核对（见 amllHit 的 fromSearch）
        const durationOf=(k:LyricIdKey,id:string)=>Number(candidates.find(c=>c && lyricIdsOf(c.from)[k]===id)?.from.duration)||0;
        if(LYRIC_ID_ORDER.some(k=>found[k]!==ids[k]) && left>=500)amll=(await this.amllHit(found,Math.min(AMLL_SECOND_BUDGET_MS,left),durationOf)).hit;
      }
      const appleResult=await apple;
      throwIfCancelled();
      // 固定顺序合并：AMLL → Apple → 网易云 → QQ → 酷狗，网络完成顺序不改变结果。
      const hits:Array<LyricHit|null>=[amll,appleResult,...candidates.map(c=>c?.lyric?{lyric:c.lyric,duration:Number(c.from.duration),trusted:false}:null)];
      const primary=best;
      for(const hit of hits){
        if(!hit)continue;
        const {lyric}=hit;
        if(!best){
          // 无主源正文时无法用正文锚点核对跨源时间轴：按 id 确认的同一录音，或同一录音且时长差 ≤2 秒才保留逐字，否则只给整句。
          const diff=Math.abs(hit.duration-Number(track.duration));
          const sameTimeline=hit.trusted || (hit.duration>0 && Number(track.duration)>0 && diff<=2);
          best=sameTimeline?{...lyric,incomplete:true}:{...lyric,yrc:undefined,qrc:undefined,krc:undefined,incomplete:true};
        }else best=enrichAligned(best,lyric);
      }
      // 依次合并有时会被前面的来源「占住」：先合并的只补上一部分行、挪了行时间，后面本来能补全的来源就对不上了（#196 实测）。
      // 所以有主歌词时，再算一遍「主歌词只配一个来源」各自的结果，逐字行比依次合并的多才换（同样按固定顺序比，结果不随网络先后变）。
      if(primary && best){
        let words=lyricCoverage(best).wordLines,pick=-1;
        hits.forEach((hit,i)=>{
          if(!hit)return;
          const single=enrichAligned(primary,hit.lyric),w=lyricCoverage(single).wordLines;
          if(w>words){best=single;words=w;pick=i;}
        });
        // 换成了单一来源：其余来源再按顺序补一遍（只补缺的翻译 / 罗马音 / 逐字），不让换来源把它们丢掉（#197）
        if(pick>=0)hits.forEach((hit,i)=>{
          if(!hit || i===pick)return;
          const next=enrichAligned(best!,hit.lyric);
          if(lyricCoverage(next).wordLines>=words)best=next;
        });
      }
      return best;
    },{detached:true,signal:job.control.signal}).catch(()=>best).then(lyric=>{
      if(!lyric || job.control.signal.aborted)return null;
      const coverage=lyricCoverage(lyric);
      const incomplete=!!lyric.incomplete || !lyricComplete(lyric);
      const result=withKoreanRoman({...lyric,coverage,incomplete});this.cache?.set(track.platform,track.sourceId,result);return result;
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

  /** 同一录音在其他平台的对应曲目（评论、详情兜底用），按 order 优先；结果缓存 6 小时。 */
  private counterparts = new Map<string, { at: number; track: Track | null }>();
  private async counterpart(track: Track, order: Platform[] = ['netease', 'qq']): Promise<Track | null> {
    const key = `${track.platform}:${track.sourceId}`;
    const hit = this.counterparts.get(key);
    if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.track;
    const platforms = order.filter((p) => p !== track.platform && this.adapters[p]?.searchSongs);
    const found = await Promise.all(
      platforms.map(async (p) => {
        try {
          const rows = await withRequestScope(2500, () => this.adapters[p].searchSongs!(searchKeyword(track), 10));
          const best = rows
            .map((c) => ({ c, m: recordingMatch(c, track) }))
            .filter((x) => x.m.ok)
            .sort((a, b) => a.m.rank - b.m.rank || b.m.score - a.m.score)[0];
          return best?.c ?? null;
        } catch {
          return null;
        }
      }),
    );
    const result = found.find(Boolean) ?? null;
    this.counterparts.set(key, { at: Date.now(), track: result });
    if (this.counterparts.size > 256) this.counterparts.delete(this.counterparts.keys().next().value!);
    return result;
  }

  private async ownComments(t: Track, page: number): Promise<CommentResult | null> {
    const adapter = this.adapters[t.platform];
    if (!adapter?.fetchComments) return null;
    try {
      return await adapter.fetchComments.call(adapter, t.sourceId, page);
    } catch {
      console.warn('[LyricService] 评论获取失败');
      return null;
    }
  }

  /** 第 0 页决定评论来源，翻页沿用同一来源，避免一页本平台一页别的平台。 */
  private commentSources = new Map<string, Track | null>();
  async fetchComments(track: Track, page = 0): Promise<CommentResult | null> {
    const key = `${track.platform}:${track.sourceId}`;
    const filled = (r: CommentResult | null) => !!r && (r.hot.length > 0 || r.latest.length > 0);
    if (page > 0) {
      const alt = this.commentSources.get(key);
      const from = alt ?? track;
      const res = await this.ownComments(from, page);
      return res ? { ...res, source: { platform: from.platform, sourceId: from.sourceId, fallback: !!alt } } : null;
    }
    const own = await this.ownComments(track, 0);
    if (filled(own)) {
      this.commentSources.set(key, null);
      return { ...own!, source: { platform: track.platform, sourceId: track.sourceId, fallback: false } };
    }
    // 本平台没有评论接口、取失败或为空：按同一录音去网易云 → QQ 取。
    const alt = await this.counterpart(track);
    const res = alt ? await this.ownComments(alt, 0) : null;
    if (alt && filled(res)) {
      this.commentSources.set(key, alt);
      if (this.commentSources.size > 256) this.commentSources.delete(this.commentSources.keys().next().value!);
      return { ...res!, source: { platform: alt.platform, sourceId: alt.sourceId, fallback: true } };
    }
    return own ? { ...own, source: { platform: track.platform, sourceId: track.sourceId, fallback: false } } : null;
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

  private async ownDetail(t: Track): Promise<SongDetail | null> {
    const adapter = this.adapters[t.platform];
    if (!adapter?.fetchSongDetail) return null;
    try {
      return await adapter.fetchSongDetail(t.sourceId);
    } catch {
      console.warn('[LyricService] 歌曲详情失败');
      return null;
    }
  }

  /** 制作团队：先看详情，再看本曲歌词头部署名。 */
  private async creditsOf(t: Track, detail: SongDetail | null): Promise<SongDetail['credits']> {
    if (detail?.credits?.length) return detail.credits;
    const lyric = await this.fetchLyric(t).catch(() => null);
    const credits = lyric?.lrc ? creditsFromLrc(lyric.lrc) : [];
    return credits.length ? credits : undefined;
  }

  /**
   * 歌曲详情：本平台优先；本平台没有详情接口或取不到时，取同一录音在网易云 → QQ 的详情（歌手、专辑链接随之指向该平台）。
   * withCredits：详情页要显示制作团队时传 true，本平台缺制作团队再去别的平台补（有 3 秒上限）；只为找歌手 id 的调用不付这笔延迟。
   */
  async fetchSongDetail(track: Track, options: { withCredits?: boolean } = {}): Promise<SongDetail | null> {
    const own = await this.ownDetail(track);
    if (own) {
      let detail: SongDetail = { ...own, source: { platform: track.platform, sourceId: track.sourceId, fallback: false } };
      if (!options.withCredits) return detail;
      const credits = await this.creditsOf(track, own);
      if (credits?.length) return { ...detail, credits };
      const borrowed = await withRequestScope(3000, async () => {
        const alt = await this.counterpart(track);
        if (!alt) return null;
        const c = await this.creditsOf(alt, await this.ownDetail(alt));
        return c?.length ? { credits: c, from: alt.platform } : null;
      }).catch(() => null);
      if (borrowed) detail = { ...detail, credits: borrowed.credits, creditsFrom: borrowed.from };
      return detail;
    }
    const alt = await this.counterpart(track);
    const altDetail = alt ? await this.ownDetail(alt) : null;
    if (!alt || !altDetail) return null;
    const detail: SongDetail = { ...altDetail, source: { platform: alt.platform, sourceId: alt.sourceId, fallback: true } };
    if (!options.withCredits) return detail;
    const credits = await this.creditsOf(alt, altDetail);
    return credits?.length ? { ...detail, credits } : detail;
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
