import type { AdapterMap } from '../adapters/index';
import type {
  AlbumSummary,
  AlbumDetail,
  ArtistInfo,
  ArtistSearchHit,
  CommentResult,
  Lyric,
  Platform,
  SearchSongGroup,
  SongDetail,
  Track,
} from '../types';
import { creditsFromLrc, parseLrc } from '../parsers/lyricParser';
import { lrcAt } from '../parsers/timedLyrics';
import { hasHangul, romanizeKorean } from '../parsers/romanizeKorean';
import { romanizeJapaneseLines } from '../parsers/romanizeJapanese';
import { recordingMatch, searchKeyword } from './recordingMatch';
import { titleSimilarity } from '../adapters/mappers';
import { rankAlbumCandidates } from './albumMatch';
import { groupSearchResults } from './searchGroup';
import { LyricCache } from './lyricCache';
import { LyricOverrides, clampLyricOffset } from './lyricOverrides';
import { applyLyricOffset } from './lyricOffset';
import { withRequestScope, throwIfCancelled, requestScope } from '../requestScope';
import { closeBrackets, enrichAligned, lyricComplete, lyricCoverage, lyricScript, lyricTruncated, snapLinesToWords } from './lyricAlignment';
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

/**
 * 日语歌缺罗马音的行用本地转写补上（#209，kuromoji 分词 + 平文式）：只补别家补完后仍缺的行，平台给了的不动。
 * 整首按语种判定是日语才做；署名行（「作词：…」）不转；某行有汉字查不到读音就跳过那行。补了多少行累加到 romanGenerated。
 */
export async function withJapaneseRoman(l: Lyric): Promise<Lyric> {
  if (lyricScript(l) !== 'ja') return l;
  const rows = l.lines.filter((x) => x.text.trim() && /[ぁ-ヿ\p{Script=Han}]/u.test(x.text) && !/^[^:：]{1,24}[:：]/.test(x.text.trim()));
  const existing = parseLrc(l.romalrc || l.romanRaw || '').filter((r) => r.text.trim());
  const missing = rows.filter((r) => !existing.some((e) => Math.abs(e.timeMs - r.timeMs) <= 250));
  if (!missing.length) return l;
  const romans = await romanizeJapaneseLines(missing.map((r) => r.text));
  const made = missing.map((r, i) => ({ timeMs: r.timeMs, text: romans[i] })).filter((r): r is { timeMs: number; text: string } => !!r.text);
  if (!made.length) return l;
  const romalrc = [...existing, ...made].sort((a, b) => a.timeMs - b.timeMs).map((r) => lrcAt(r.timeMs, r.text)).join('\n');
  return { ...l, romalrc, romanRaw: romalrc, romanGenerated: (l.romanGenerated || 0) + made.length };
}
/** 本地补罗马音：韩语（同步转写）、日语（词典分词）。 */
const withLocalRoman = (l: Lyric): Promise<Lyric> => withJapaneseRoman(withKoreanRoman(l));

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
/** 提前搜网易云同一首（拿网易云 id 查 AMLL 的和声 / 对唱）的预算：和主歌词并行，够好时最多多等这么久。 */
const NCM_PRESEARCH_MS = 1500;

/** 待合并的一份歌词：trusted = 按 id 确认是同一录音（AMLL、Apple 目录 id），不再要求时长差 ≤2 秒。 */
interface LyricHit { lyric: Lyric; duration: number; trusted: boolean }

/** 手动选定的歌词来源（platform + 该来源里的 id；AMLL 的 id 是 `matchedBy:id`）。 */
export interface LyricPick { platform: string; sourceId: string }
/** 「歌词版本」列表里的一份：来源、覆盖率，以及时长和当前这首差多少秒（按 id 确认同一录音的、或没有时长的为 null）。 */
export interface LyricVersion { platform: string; sourceId: string; coverage: ReturnType<typeof lyricCoverage>; durationDiffSec: number | null }
export interface LyricVersions { pick: LyricPick | null; offsetMs: number; versions: LyricVersion[] }

/** 列版本的整体时限。 */
const VERSIONS_BUDGET_MS = 9000;
/** 列出过的候选歌词在内存里留多久（选中时不用重取）、最多几份。 */
const VERSION_TTL_MS = 30 * 60_000;
const VERSION_CACHE_MAX = 64;

export class LyricService {
  constructor(
    private adapters: AdapterMap,
    private cache?: LyricCache,
    private extra: LyricExtraSources = {},
    private overrides?: LyricOverrides,
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
  /** 一首歌的键：缓存、覆盖、进行中的任务都按实际供流那首（platform:sourceId）。 */
  private keyOf(t: Pick<Track, 'platform' | 'sourceId'>): string { return t.platform+':'+t.sourceId; }

  /** 按平台取一份歌词（带身份与来源记录，行时间校准到逐字）；kind 写进 provenance。取不到返回 null，不抛错（只在整体被取消 / 超时时抛）。 */
  private async fetchOne(t: Track, kind: 'primary'|'fallback'|'manual'): Promise<Lyric|null> {
    const lyric=await withRequestScope(3200,()=>this.adapters[t.platform].fetchLyric(t.sourceId,t.duration? t.duration*1000:undefined)).catch(()=>null);
    throwIfCancelled();
    // 同一份歌词里普通行和逐字行开头差几百毫秒的，先把行时间校准到逐字（#196），否则自带的逐字会被当成没有
    // 只有左括号的句子补上右括号（#202）
    return lyric?.lines?.length?snapLinesToWords(closeBrackets({...lyric,identity:{platform:t.platform,sourceId:t.sourceId},provenance:[{platform:t.platform,sourceId:t.sourceId,kind}]})):null;
  }

  /**
   * 收集别家的候选歌词（fetchLyric 的补全与 listLyricVersions 共用同一段）：AMLL / Apple 和网易云 / QQ / 酷狗（排除本平台）的搜索并行；
   * 新来源失败或超时只当没有，不影响其余。固定顺序 [AMLL, Apple, 网易云, QQ, 酷狗, 酷我, Spotify]，网络完成顺序不改变结果；没有的位置是 null。
   * 必须在 withRequestScope 里调用（取消 / 整体截止由外层负责）。
   */
  private async gatherHits(track: Track, origin?: Track, preNetease?: Promise<Track[]|null>, preAmll?: ReturnType<LyricService['amllHit']>): Promise<Array<LyricHit|null>> {
      // 酷我（#206 接搜歌后加入；逐字覆盖约 93%）放最后；酷我 / 波点同一曲库，本平台是其中一家时不再搜酷我
      const sameCatalog=(p:Platform)=>p===track.platform || (p==='kuwo' && track.platform==='bodian');
      const sources=(['netease','qq','kugou','kuwo'] as Platform[]).filter(p=>!sameCatalog(p) && this.adapters[p]?.searchSongs);
      // AMLL / Apple 和网易云 / QQ / 酷狗的搜索并行；新来源失败或超时只当没有，不影响其余。
      const ids=mergeLyricIds(lyricIdsOf(track),lyricIdsOf(origin));
      // AMLL 第一轮可能已经在取主歌词时并行发出（见 fetchLyricBase），直接复用
      const amllFirst=preAmll ?? this.amllHit(ids,AMLL_BUDGET_MS),apple=this.appleHit(track,origin);
      // 原曲平台自家的歌词，按原曲 id 取（同一录音）：Spotify（#210，只有逐行）、汽水（#216，车机曲目信息里的逐字 + 翻译，不需要授权）；
      // 实际出声那首就是它时已经是主歌词，不重复取。排在所有来源最后
      const own=origin && origin!==track && origin.platform!==track.platform && (origin.platform==='spotify' || origin.platform==='qishui') ? origin
        : track.platform==='spotify' ? track : undefined;
      const sp=own;
      const spotify=sp && this.adapters[sp.platform] ? this.fetchOne(sp,'fallback').catch(()=>null) : Promise.resolve(null);
      const candidates=await Promise.all(sources.map(async platform=>{
        try{
          // 网易云那一路可能已经提前搜过（见 fetchLyricBase：补和声 / 对唱要的网易云 id），直接复用
          const rows=platform==='netease' && preNetease ? await preNetease : await withRequestScope(1800,()=>this.adapters[platform].searchSongs!(searchKeyword(track),10));
          if(!rows)return null;
          // 和取链兜底同一套排位（#205）：歌手完全一致的优先，放宽认上的排后
          const match=rows.map(t=>({t,m:recordingMatch(t,track)})).filter(x=>x.m.ok && x.m.score>=.9).sort((a,b)=>a.m.rank-b.m.rank || b.m.score-a.m.score)[0];
          const lyric=match?await this.fetchOne(match.t,'fallback'):null;
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
      const appleResult=await apple,spotifyLyric=await spotify;
      throwIfCancelled();
      // 固定顺序合并：AMLL → Apple → 网易云 → QQ → 酷狗 → 酷我 → 原曲平台（Spotify / 汽水），网络完成顺序不改变结果。
      return [amll,appleResult,...candidates.map(c=>c?.lyric?{lyric:c.lyric,duration:Number(c.from.duration),trusted:false}:null),
        spotifyLyric?{lyric:spotifyLyric,duration:Number(sp!.duration)||0,trusted:true}:null];
  }

  /** 自动合并的歌词（缓存里存的就是这一份，没有时间微调）；用户指定了来源就用指定的那份做正文。 */
  private async fetchLyricBase(track: Track, signal?:AbortSignal, origin?: Track): Promise<Lyric|null> {
    if(signal?.aborted)return null;
    const cached=this.cache?.get(track.platform,track.sourceId);if(cached)return withLocalRoman(cached);
    const key=this.keyOf(track);
    const pending=this.lyricJobs.get(key);if(pending && !pending.control.signal.aborted)return this.consumeLyric(pending,signal);
    const job={control:new AbortController(),users:0,done:false,promise:Promise.resolve(null) as Promise<Lyric|null>};
    let best:Lyric|null=null;
    const chosen=this.overrides?.get(key)?.pick;
    // 选中的那一份取到了才算 manual；取不到就退回自动（不能让这首歌没歌词）
    let manual=false;
    const isChosen=(l:Lyric|undefined)=>manual && !!chosen && l?.identity?.platform===chosen.platform && l.identity.sourceId===chosen.sourceId;
    const task=withRequestScope(8500,async()=>{
      // AMLL 大多只按网易云 id 收录：不是网易云出声、手上也没有网易云 id 的歌，一开始就并行搜一次网易云同一首（#206）。
      // 主歌词够好时用它的 id 查 AMLL 补和声 / 对唱；不够好时补全直接复用这次搜索，不多发请求。
      const ids=mergeLyricIds(lyricIdsOf(track),lyricIdsOf(origin));
      const ne=this.adapters.netease;
      const preNetease=!ids.ncm && this.extra.amll && track.platform!=='netease' && ne?.searchSongs
        ? withRequestScope(NCM_PRESEARCH_MS,()=>ne.searchSongs!(searchKeyword(track),10)).catch(()=>null) : undefined;
      // AMLL 按已知 id 的那一轮和取主歌词同时发（#213）：够好时补和声 / 对唱不再多等一整轮；不够好时补全复用它
      const amllEarly=this.amllHit(ids,AMLL_BUDGET_MS);
      if(chosen){
        best=await this.fetchPicked(track,chosen);
        throwIfCancelled();
        manual=!!best;
      }
      if(!best)best=await this.fetchOne(track,'primary');
      // 够好就不去别家补：判定按语种（中文不要求翻译，日语要罗马音，见 lyricComplete）
      if(best && lyricComplete(best) && !lyricTruncated(best,track.duration)){
        // 只按已知 id 查一次 AMLL（不查 Apple、不搜别的平台）：它带和声 / 对唱归属，主歌词没有这两样；只补缺的层，不动已有的。没命中 / 失败照旧返回
        // 主歌词回来后最多再等 AMLL_RICH_BUDGET_MS（它早就在路上了）
        const early=await Promise.race([amllEarly,new Promise<null>(r=>setTimeout(()=>r(null),AMLL_RICH_BUDGET_MS))]);
        let hit=early?.hit??null;
        if(!hit && early && !early.failed){
          // 按已知 id 没收录：用提前搜到的网易云同一首的 id 再查一次（AMLL 大多只按网易云 id 收录）
          const rows=preNetease?await preNetease:null;
          const same=(rows||[]).map(t=>({t,m:recordingMatch(t,track)})).filter(x=>x.m.ok).sort((a,b)=>a.m.rank-b.m.rank || b.m.score-a.m.score)[0];
          const ncm=same?lyricIdsOf(same.t).ncm:undefined;
          if(ncm && ncm!==ids.ncm)hit=(await this.amllHit({ncm},AMLL_RICH_BUDGET_MS)).hit;
        }
        throwIfCancelled();
        return hit && !isChosen(hit.lyric)?enrichAligned(best,hit.lyric):best;
      }
      // 补丁里跳过选中的那一份（它已经是正文）
      let hits=(await this.gatherHits(track,origin,preNetease,amllEarly)).map(h=>h && isChosen(h.lyric)?null:h);
      // 主歌词被截断（#201）：别家有一份明显更全的（句数多一半以上、往后多出 20 秒以上）就改用它做正文——合并只往已有的句子上补，补不出缺的后半段。
      // 手动选的不换。更全的那份挪到最前面当正文，其余照固定顺序补；截断的主歌词不再参与。
      if(best && !manual && lyricTruncated(best,track.duration)){
        const own=lyricCoverage(best).textLines,ownLast=Math.max(...best.lines.filter(x=>x.text.trim()).map(x=>x.timeMs));
        const fuller=hits.findIndex(h=>{
          if(!h)return false;
          const rows=h.lyric.lines.filter(x=>x.text.trim());
          return lyricCoverage(h.lyric).textLines>=Math.max(own*1.5,own+5) && Math.max(...rows.map(x=>x.timeMs))>ownLast+20000;
        });
        if(fuller>=0){best=null;hits=[hits[fuller]!,...hits.filter((_,i)=>i!==fuller)];}
      }
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
    },{detached:true,signal:job.control.signal}).catch(()=>best).then(async lyric=>{
      if(!lyric || job.control.signal.aborted)return null;
      const coverage=lyricCoverage(lyric);
      const incomplete=!!lyric.incomplete || !lyricComplete(lyric) || lyricTruncated(lyric,track.duration);
      const result=await withLocalRoman({...lyric,coverage,incomplete});
      if(job.control.signal.aborted)return null;
      // 选中的那份这次没取到、退回了自动：不写缓存，否则自动结果会盖住用户的选择最长 30 天；下次再按选择重试
      if(!(chosen && !manual))this.cache?.set(track.platform,track.sourceId,result);
      return result;
    }).finally(()=>{job.done=true;if(this.lyricJobs.get(key)===job)this.lyricJobs.delete(key);});
    job.promise=task;this.lyricJobs.set(key,job);return this.consumeLyric(job,signal);
  }

  /**
   * 歌词入口。origin：兜底播放时用户点的原曲（只用来提供 AMLL / Apple 查询用的 id）；缓存键和歌词身份仍按 track（实际供流那首）。
   * 用户手动选过来源（chooseLyric）时，正文取选中的那份；时间微调只在这里输出时平移（缓存、进行中的任务里都是没平移的）。
   */
  async fetchLyric(track: Track, signal?:AbortSignal, origin?: Track): Promise<Lyric | null> {
    const lyric=await this.fetchLyricBase(track,signal,origin);
    const offsetMs=this.overrides?.get(this.keyOf(track))?.offsetMs;
    return lyric && offsetMs?applyLyricOffset(lyric,offsetMs):lyric;
  }

  /** 列版本时取到的候选歌词，选中时直接用（键：供流那首 + 候选来源）。 */
  private versionCache=new Map<string,{at:number;lyric:Lyric}>();
  private versionKey(track:Track,pick:LyricPick):string { return `${this.keyOf(track)}|${pick.platform}:${pick.sourceId}`; }
  private rememberVersion(track:Track,lyric:Lyric):void {
    if(!lyric.identity)return;
    const k=this.versionKey(track,lyric.identity);
    this.versionCache.delete(k);this.versionCache.set(k,{at:Date.now(),lyric});
    while(this.versionCache.size>VERSION_CACHE_MAX)this.versionCache.delete(this.versionCache.keys().next().value!);
  }

  /** 取用户选中的那一份（kind 记 manual）：先查内存里的候选缓存，没有再按来源重取；取不到返回 null。 */
  private async fetchPicked(track: Track, pick: LyricPick): Promise<Lyric|null> {
    const mark=(l:Lyric|null):Lyric|null=>l?{...l,provenance:[{platform:pick.platform,sourceId:pick.sourceId,kind:'manual'}]}:null;
    const k=this.versionKey(track,pick),hit=this.versionCache.get(k);
    if(hit && Date.now()-hit.at<VERSION_TTL_MS)return mark(hit.lyric);
    this.versionCache.delete(k);
    if(pick.platform==='amll'){
      const m=/^([a-z]+):(.+)$/.exec(pick.sourceId),key=m?.[1] as LyricIdKey|undefined;
      if(!m || !key || !LYRIC_ID_ORDER.includes(key))return null;
      return mark((await this.amllHit({[key]:m[2]},AMLL_BUDGET_MS)).hit?.lyric ?? null);
    }
    if(pick.platform==='applemusic'){
      // Apple 按目录 id 重取：把它当「原曲」传给 lookup（appleCatalogIdOf(origin) 优先），走的就是按 id 直取的那条路，不搜
      const asOrigin:Track={...track,platform:'applemusic',sourceId:pick.sourceId,extra:{catalogId:pick.sourceId}};
      return mark((await this.appleHit(track,asOrigin))?.lyric ?? null);
    }
    if(!this.adapters[pick.platform as Platform]?.fetchLyric)return null;
    return mark(await this.fetchOne({...track,platform:pick.platform as Platform,sourceId:pick.sourceId},'manual'));
  }

  /**
   * 「歌词版本」列表：本平台自己的歌词（有正文才算）+ 别家的候选（AMLL / Apple / 网易云 / QQ / 酷狗，和 fetchLyric 补全用的是同一段收集）。
   * 各来源失败只当没有，整体 9 秒；取到的每份候选按「供流那首 + 来源」在内存缓存 30 分钟，选它时不用重取。
   */
  async listLyricVersions(track: Track, signal?: AbortSignal, origin?: Track): Promise<LyricVersions> {
    const choice=this.overrides?.get(this.keyOf(track));
    let own:Lyric|null=null,hits:Array<LyricHit|null>=[];
    // 谁先到谁先落地：整体超时 / 取消时，已经取到的仍然保留
    await withRequestScope(VERSIONS_BUDGET_MS,async()=>{
      await Promise.all([
        this.fetchOne(track,'primary').then(v=>{own=v;}).catch(()=>{}),
        this.gatherHits(track,origin).then(v=>{hits=v;}).catch(()=>{}),
      ]);
    },{detached:true,signal}).catch(()=>{});
    const versions:LyricVersion[]=[];
    const push=(lyric:Lyric,durationDiffSec:number|null)=>{
      const coverage=lyricCoverage(lyric);
      if(!coverage.textLines || !lyric.identity)return;
      this.rememberVersion(track,lyric);
      versions.push({platform:lyric.identity.platform,sourceId:lyric.identity.sourceId,coverage,durationDiffSec});
    };
    // 赋值发生在上面的闭包里，TS 看不到，显式声明类型
    const ownLyric=own as Lyric|null;
    if(ownLyric)push(ownLyric,null);
    for(const h of hits){
      if(!h)continue;
      // 按 id 确认的同一录音、或没有时长的不给时长差
      const known=!h.trusted && h.duration>0 && Number(track.duration)>0;
      push(h.lyric,known?Math.round(Math.abs(h.duration-Number(track.duration))*10)/10:null);
    }
    return {pick:choice?.pick ?? null,offsetMs:choice?.offsetMs ?? 0,versions};
  }

  /**
   * 手动换歌词：写入这首的选择（pick = null 恢复自动合并；offsetMs 缺省 = 保持原来的微调）。
   * 来源变了就删掉这首的歌词缓存并作废进行中的任务，下次取歌词按新选择重来；只改微调不动缓存（微调在输出时才平移）。
   */
  chooseLyric(track: Track, choice: { pick: LyricPick | null; offsetMs?: number }): void {
    if(!this.overrides)return;
    const key=this.keyOf(track),before=this.overrides.get(key);
    const pick=choice.pick && typeof choice.pick.platform==='string' && choice.pick.platform && typeof choice.pick.sourceId==='string' && choice.pick.sourceId?{platform:choice.pick.platform,sourceId:choice.pick.sourceId}:undefined;
    const offsetMs=choice.offsetMs===undefined?before?.offsetMs ?? 0:clampLyricOffset(choice.offsetMs);
    this.overrides.set(key,{pick,offsetMs});
    if(before?.pick?.platform===pick?.platform && before?.pick?.sourceId===pick?.sourceId)return;
    this.cache?.delete(track.platform,track.sourceId);
    const job=this.lyricJobs.get(key);
    if(job){job.control.abort();this.lyricJobs.delete(key);}
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
   * 专辑转译：按「专辑名（+ 歌手名）」在网易云、QQ 两边搜专辑，按 albumMatch 打分挑最像的。
   * 以前只有网易云一家、且歌手对不上时整批被阈值过滤（搜《范特西》+ 周杰伦 返回 null），
   * 专辑页兜底因此长期失效；现在两边并行、歌手只降权不排除。
   */
  async resolveAlbumByTitle(
    title: string,
    artist?: string,
    opts: { year?: number; songCount?: number } = {},
  ): Promise<AlbumSummary | null> {
    const clean = String(title || '').trim();
    if (!clean) return null;
    // QQ 的专辑搜索把歌手一起给定更准（「范特西 周杰伦」），网易云用纯专辑名召回更多
    const keywordFor = (platform: 'netease' | 'qq') => (platform === 'qq' && artist ? `${clean} ${artist}` : clean);
    const sources = await Promise.all(
      (['netease', 'qq'] as const).map(async (platform) => {
        const adapter = this.adapters[platform];
        if (!adapter?.searchAlbums) return [] as AlbumSummary[];
        try {
          return await adapter.searchAlbums(keywordFor(platform), 10);
        } catch {
          console.warn('[LyricService] 专辑搜索失败');
          return [] as AlbumSummary[];
        }
      }),
    );
    const ranked = rankAlbumCandidates(sources.flat(), { name: clean, artist, year: opts.year, songCount: opts.songCount });
    const best = ranked[0];
    // 只要专辑名差得太远（没有任何候选真正同名或包含）就不给结果，避免串到别的专辑
    if (!best || best.titleScore <= 0) return null;
    return best.album;
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

  /**
   * 专辑详情：本平台优先；本平台没有详情接口或取不到（歌下架、接口异常、平台压根没有这一页）时，
   * 按「专辑名 + 歌手」转到网易云 → QQ 拿同一张专辑，返回里用 source 标出来源。
   * 与歌曲详情（#163）同一套思路：宁可给别家的可用内容，也不给空白页。
   */
  async fetchAlbumDetail(
    platform: Platform,
    albumId: string,
    hint: { name?: string; artist?: string } = {},
  ): Promise<AlbumDetail | null> {
    const own = await this.ownAlbumDetail(platform, albumId);
    if (own && own.tracks.length) {
      return { ...own, source: { platform, sourceId: String(own.id), fallback: false } };
    }
    // 本平台取不到：先它自己返回的空专辑（有名字/歌手可用当线索），再退回调用方给的提示
    const name = (own?.name || hint.name || '').trim();
    const artist = (own?.artist || hint.artist || '').trim();
    if (!name) return own ?? null;
    const target = await this.alternateAlbum(platform, name, artist, own);
    return target ?? own ?? null;
  }

  /** 本平台专辑详情：接口失败 / 没有该方法一律 null，不向上抛。 */
  private async ownAlbumDetail(platform: Platform, albumId: string): Promise<AlbumDetail | null> {
    const adapter = this.adapters[platform];
    if (!adapter?.fetchAlbumDetail) return null;
    try {
      return await adapter.fetchAlbumDetail(String(albumId));
    } catch {
      console.warn('[LyricService] 专辑详情失败');
      return null;
    }
  }

  /**
   * 换平台拿同一张专辑：网易云、QQ 都能直接开详情页，按 albumMatch 挑同名同歌手的一张，
   * 再回来取它的详情。曲目为空的不算找到。
   */
  private async alternateAlbum(
    from: Platform,
    name: string,
    artist: string,
    own: AlbumDetail | null,
  ): Promise<AlbumDetail | null> {
    // 能直接开详情页的：网易云、QQ，以及 Spotify（#226 补了 searchAlbums，需登录令牌）
    const candidates = (['netease', 'qq', 'spotify'] as const).filter(
      (p) => p !== from && this.adapters[p]?.searchAlbums && this.adapters[p]?.fetchAlbumDetail,
    );
    if (!candidates.length) return null;
    const lists = await Promise.all(
      candidates.map(async (p) => {
        try {
          return await this.adapters[p]!.searchAlbums!(p === 'qq' && artist ? `${name} ${artist}` : name, 10);
        } catch {
          return [] as AlbumSummary[];
        }
      }),
    );
    const ranked = rankAlbumCandidates(lists.flat(), {
      name,
      artist: artist || undefined,
      year: own?.year,
      songCount: own?.tracks.length || undefined,
    });
    // 最多试 3 个候选：第一次可能撞上同名精选 / 翻唱合集，取不到曲目再往下
    for (const cand of ranked.slice(0, 3)) {
      // 专辑名必须真的对上（包含也算），只是歌手对不上的不接受，免得给用户看错专辑
      if (cand.titleScore <= 0) continue;
      if (artist && !cand.artistHit && cand.titleScore < 1) continue;
      const detail = await this.ownAlbumDetail(cand.album.platform, cand.album.id);
      if (detail && detail.tracks.length) {
        return {
          ...detail,
          source: { platform: cand.album.platform, sourceId: String(cand.album.id), fallback: from !== cand.album.platform },
        };
      }
    }
    return null;
  }

  /**
   * 全网搜歌：网易云 + QQ + 酷狗，酷我、波点（#224），Spotify（登录后）。
   * 结果按平台**交错**取用（每家先出一条再进下一轮），慢的平台不会被快的挤掉；
   * 最后按**同一录音**合并成一条（#227），同一首歌在多个平台只显示一行，
   * 展开才看到各平台来源。
   */
  async searchSongs(keyword: string, pageSize = 8): Promise<SearchSongGroup[]> {
    // 每家的取回量：交错后每家至少能出 1 条，取 ceil(pageSize / 2) 保底
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
    const sources = [
      this.adapters.netease,
      this.adapters.qq,
      this.adapters.kugou,
      this.adapters.kuwo,
      this.adapters.bodian,
    ].filter(Boolean);
    // Spotify 只有登录后才有令牌；没有就跳过，省一次必然失败的请求（未登录时搜索接口回空）
    const spotify = this.adapters.spotify;
    if (spotify?.searchSongs) sources.push(spotify);
    // Apple Music（#232）：适配器内部已判断「没登录就返回空」
    const apple = this.adapters.applemusic;
    if (apple?.searchSongs) sources.push(apple);
    // 各家并行，但结果按「轮流取一条」交错：谁先返回谁先占满的话，快的酷狗 / 酷我会把
    // 网易云、QQ 挤掉（实测搜「周杰伦」6 条全是酷狗 + 酷我）。
    const lists = await Promise.all(
      sources.map(async (adapter) => {
        if (!adapter.searchSongs) return [] as Track[];
        try {
          const list = await adapter.searchSongs(keyword, per);
          return list.map((t) => ({
            ...t,
            title: stripMarkup(t.title),
            artist: stripMarkup(t.artist),
            album: stripMarkup(t.album),
          }));
        } catch (err) {
          console.warn('[LyricService] searchSongs');
          return [] as Track[];
        }
      }),
    );
    // 交错取用：每轮先让「每家一条」，再进下一轮。这样快的平台不会靠前 3 条把名额吃光，
    // 慢的网易云（约 1.2 秒）也一定能在自己那一格出现。
    // 注意：这里不能按 pageSize 提前截断——同一首歌的多个平台来源会被合并成一条，
    // 提前截断会让「合并后只剩 3 条」这种结果出现，名额按合并后的组数算（#227）。
    const active = lists.filter((l) => l.length > 0);
    const rounds = Math.max(0, ...active.map((l) => l.length));
    for (let i = 0; i < rounds; i++) {
      for (const list of active) {
        const t = list[i];
        if (t) push(t);
      }
    }
    return groupSearchResults(out, pageSize);
  }

  /**
   * 全网搜歌手：网易云 + QQ + 酷狗（#224）。
   * 各家并行，但结果**按平台交错**取用（每家先出一条再进下一条）：
   * 酷狗返回最快、一次给十几条，谁先完成谁先 push 的话，网易云（约 1.2 秒）和 QQ
   * 会被整批挤掉——实测搜「周杰伦」曾只剩酷狗一家（#228）。
   */
  async searchArtists(keyword: string, pageSize = 5): Promise<ArtistSearchHit[]> {
    const per = Math.max(2, Math.ceil(pageSize / 2));
    const sources = [this.adapters.netease, this.adapters.qq, this.adapters.kugou].filter(Boolean);
    const lists = await Promise.all(
      sources.map(async (adapter) => {
        if (!adapter.searchArtists) return [] as ArtistSearchHit[];
        try {
          return (await adapter.searchArtists(keyword, per)).map((h) => ({ ...h, name: stripMarkup(h.name) }));
        } catch (err) {
          console.warn('[LyricService] searchArtists');
          return [] as ArtistSearchHit[];
        }
      }),
    );
    const out: ArtistSearchHit[] = [];
    const seen = new Set<string>();
    const active = lists.filter((l) => l.length > 0);
    const rounds = Math.max(0, ...active.map((l) => l.length));
    // 交错时不做「同名合并」（用户 2026-11-21 定：周杰伦 / 周杰伦. / 周杰伦♚ 可能是不同的人），
    // 只按 平台:id 去重。
    for (let i = 0; i < rounds && out.length < pageSize; i++) {
      for (const list of active) {
        const hit = list[i];
        if (!hit) continue;
        const key = `${hit.platform}:${hit.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(hit);
        if (out.length >= pageSize) break;
      }
    }
    return out;
  }
}
