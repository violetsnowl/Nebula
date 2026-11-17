import type { AdapterMap } from '../adapters/index';
import type { Platform, ResolveResult, Track } from '../types';
import type { FallbackTarget } from './platformRouter';
import { matchScore, recordingMatch as filterCandidate } from './recordingMatch';
export { matchScore } from './recordingMatch';
import { mapQualityTo } from '../quality';
import { requestScope, RequestCancelled, throwIfCancelled, withRequestScope } from '../requestScope';

const PLAYABLE: Platform[] = ['netease', 'qq', 'kugou'];
const LEVELS: Record<string, string[]> = {
  netease: ['jymaster','hires','lossless','exhigh','standard'], qq: ['flac','320k','128k'], kugou: ['hires','flac','320','128'],
};
export type UrlProbe = (url: string, platform: Platform, signal?: AbortSignal) => Promise<boolean>;
export interface ResolveOptions { signal?: AbortSignal; forceRefresh?: boolean }
export interface ResolverPolicy { totalMs: number; primaryMs: number; searchMs: number; candidateMs: number; probeMs: number; cacheMs: number }
const POLICY: ResolverPolicy = { totalMs: 6000, primaryMs: 2300, searchMs: 1600, candidateMs: 2000, probeMs: 1000, cacheMs: 120000 };
type Job = { control: AbortController; users: number; done: boolean; promise: Promise<ResolveResult> };
type Timings = NonNullable<ResolveResult['timings']>;
let sequence = 0;
const failure = (t: Track, code: ResolveResult['code'] = 'NO_SOURCE'): ResolveResult => ({
  url: '', platform: t.platform, sourceId: t.sourceId, fallback: false, playable: false, code,
  error: code === 'CANCELLED' ? '播放请求已取消' : code === 'TIMEOUT' ? '音源解析超时' : '主平台与兜底平台均未获取到可播音源（含音源探测过滤）',
});
const codeOf = (e: unknown): 'TIMEOUT' | 'CANCELLED' | 'NO_SOURCE' => e instanceof RequestCancelled ? e.code : 'NO_SOURCE';
const remember = <T>(map: Map<string, T>, key: string, value: T, max = 256): void => {
  map.delete(key); map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value!);
};

/** 唯一解析入口：有界主源 → 并发安全候选 → 探测；缓存只保存已验证地址。 */
export class SongResolver {
  private fallbackTargets: (() => Promise<FallbackTarget[]>) | null = null;
  private cache = new Map<string, ResolveResult>();
  private matches = new Map<string, { at: number; tracks: Track[] }>();
  private jobs = new Map<string, Job>();
  private health = new Map<string, { failures: number; until: number }>();
  private epoch = 0;
  private policy: ResolverPolicy;
  constructor(private adapters: AdapterMap, private log: (m: string) => void = m => console.info('[SongResolver]', m), private probe?: UrlProbe, policy?: Partial<ResolverPolicy>) {
    this.policy = { ...POLICY, ...policy };
  }
  setFallbackTargets(getTargets: () => Promise<FallbackTarget[]>): void { this.fallbackTargets = getTargets; }
  invalidate(): void {
    this.epoch++; this.cache.clear(); this.matches.clear(); this.health.clear();
    for (const job of this.jobs.values()) job.control.abort(new RequestCancelled('CANCELLED'));
    this.jobs.clear();
  }
  private key(track: Track, quality?: string): string {
    return JSON.stringify([track.platform,track.sourceId,quality || '',track.title,track.artist,track.duration]);
  }
  resolve(track: Track, quality?: string, options: ResolveOptions = {}): Promise<ResolveResult> {
    if (options.signal?.aborted) return Promise.resolve(failure(track, 'CANCELLED'));
    const key = this.key(track,quality), hit = this.cache.get(key);
    if (!options.forceRefresh && hit?.expiresAt && hit.expiresAt > Date.now() + 5000) {
      return Promise.resolve({ ...hit, traceId: `play-${++sequence}`, timings: [{stage:'cache',platform:hit.platform,ms:0,outcome:'hit'}] });
    }
    this.cache.delete(key);
    const jobKey = key + (options.forceRefresh ? ':fresh' : ':normal');
    let job = this.jobs.get(jobKey);
    if (!job || job.control.signal.aborted) {
      if (options.forceRefresh) this.epoch++;
      const epoch = this.epoch;
      const created: Job = { control: new AbortController(), users: 0, done: false, promise: Promise.resolve(failure(track)) };
      created.promise = withRequestScope(this.policy.totalMs, () => this.run(track, quality), {
        signal: created.control.signal, forceRefresh: options.forceRefresh, detached: true,
      }).catch(e => failure(track,codeOf(e))).then(result => {
        if (result.url && result.playable && epoch === this.epoch && !created.control.signal.aborted) remember(this.cache,key,result);
        return result;
      }).finally(() => { created.done = true; if (this.jobs.get(jobKey) === created) this.jobs.delete(jobKey); });
      job = created; this.jobs.set(jobKey,created);
    }
    // 每位调用者独立取消；最后一位离开才中止共用请求（预取/前台不会互相取消）。
    const shared = job; shared.users++;
    return new Promise(resolve => {
      let finished = false;
      const finish = (result: ResolveResult) => {
        if (finished) return; finished = true;
        options.signal?.removeEventListener('abort',cancel);
        shared.users--; if (!shared.users && !shared.done) shared.control.abort(new RequestCancelled('CANCELLED'));
        resolve(result);
      };
      const cancel = () => finish(failure(track,'CANCELLED'));
      options.signal?.addEventListener('abort',cancel,{once:true});
      if (options.signal?.aborted) cancel();
      void shared.promise.then(finish);
    });
  }
  private async stage<T>(timings: Timings, stage: string, platform: string, ms: number, fn: () => Promise<T>): Promise<T> {
    const at = Date.now(); let outcome = 'ok';
    try { return await withRequestScope(ms,fn); }
    catch(e) { outcome=codeOf(e); throw e; }
    finally { timings.push({stage,platform,ms:Date.now()-at,outcome}); }
  }
  private async source(track: Track, platform: Platform, quality: string | undefined, fallback: boolean, timings: Timings): Promise<ResolveResult | null> {
    throwIfCancelled();
    const breaker = this.health.get(platform);
    // 用户主动点播始终给主源恢复机会；单曲超时不代表整个平台不可用。
    if (fallback && breaker && breaker.until > Date.now()) { timings.push({stage:'circuit',platform,ms:0,outcome:'open'}); return null; }
    try {
      const direct = await this.stage(timings,'fetch',platform,this.policy.candidateMs,() => this.adapters[platform].fetchSongUrl(
        track.sourceId, track.extra?.albumId == null ? undefined : String(track.extra.albumId), mapQualityTo(LEVELS[platform] || [],quality),track.extra,
      ));
      if (!direct?.url || direct.playable === false) { timings.push({stage:'availability',platform,ms:0,outcome:direct?.code || 'NO_SOURCE'}); return null; }
      const accepted = !this.probe || await this.stage(timings,'probe',platform,this.policy.probeMs,() => this.probe!(direct.url,platform,requestScope()?.signal));
      if (!accepted) { timings.push({stage:'availability',platform,ms:0,outcome:'PROBE_REJECTED'}); return null; }
      this.health.delete(platform);
      const now = Date.now();
      return { url:direct.url, fallback, platform, sourceId:track.sourceId, trial:direct.trial, trialEndTime:direct.trialEndTime,
        quality:direct.quality, playable:true, resolvedAt:now, expiresAt:Math.min(direct.expiresAt || Infinity, now+this.policy.cacheMs), ...(direct.trial ? {code:'TRIAL_ONLY' as const} : {}) };
    } catch(e) {
      if (codeOf(e) === 'NO_SOURCE') {
        const n=(this.health.get(platform)?.failures || 0)+1;
        this.health.set(platform,{failures:n,until:n>=3?Date.now()+30000:0});
      }
      throwIfCancelled();
      return null;
    }
  }
  private async run(track: Track, quality?: string, fallbackOnly = false): Promise<ResolveResult> {
    const traceId = `play-${++sequence}`, timings: Timings = [], start=Date.now();
    let direct: ResolveResult | null = null, result: ResolveResult;
    try {
      if (!fallbackOnly && PLAYABLE.includes(track.platform)) {
        try { direct=await this.stage(timings,'primary',track.platform,this.policy.primaryMs,()=>this.source(track,track.platform,quality,false,timings)); } catch { throwIfCancelled(); }
      }
      result = direct?.url && !direct.trial ? direct : await this.fallback(track,quality,timings) || direct || failure(track);
    } catch(e) { result=direct?.url ? direct : failure(track,codeOf(e)); }
    const complete={...result,traceId,timings:[...timings]};
    this.log(JSON.stringify({ traceId, ms:Date.now()-start, result:result.url?(result.trial?'TRIAL_ONLY':'OK'):result.code, platform:result.platform, fallback:result.fallback, timings }));
    return complete;
  }
  private async fallback(track: Track, quality: string | undefined, timings: Timings): Promise<ResolveResult | null> {
    let order: FallbackTarget[]=[];
    if (this.fallbackTargets) {
      try { order=await this.stage(timings,'priority','all',100,()=>this.fallbackTargets!()); } catch { throwIfCancelled(); }
    }
    const platforms = (order.length ? order.map(t=>t.platform) : PLAYABLE)
      .filter((p): p is Platform => PLAYABLE.includes(p as Platform) && p !== track.platform && !!this.adapters[p as Platform]?.searchSongs);
    const cancel = new AbortController();
    try {
      const tasks = [...new Set(platforms)].map(platform => withRequestScope(this.policy.totalMs,async()=> {
        const matchKey=this.key(track)+':'+platform, hit=this.matches.get(matchKey);
        let candidates: Track[];
        if (hit && Date.now()-hit.at<24*3600_000) candidates=hit.tracks;
        else {
          const rows=await this.stage(timings,'search',platform,this.policy.searchMs,()=>this.adapters[platform].searchSongs!(`${track.title} ${track.artist}`.trim(),12));
          candidates=rows.map(c=>({c,score:matchScore(c,track),guard:filterCandidate(c,track)}))
            .filter(x=>x.guard.ok && x.score>=.55).sort((a,b)=>a.guard.rank-b.guard.rank || b.score-a.score).slice(0,2).map(x=>x.c);
          if (candidates.length) remember(this.matches,matchKey,{at:Date.now(),tracks:candidates},512);
        }
        let trial: ResolveResult | null=null;
        for (const c of candidates) {
          throwIfCancelled();
          const result=await this.source(c,platform,quality,true,timings);
          if (result?.url && !result.trial) return result;
          trial ??= result;
        }
        return trial;
      },{signal:cancel.signal}).catch(()=>null));
      if (!tasks.length) return null;
      return await new Promise<ResolveResult | null>(resolve=> {
        let remaining=tasks.length, trial: ResolveResult | null=null;
        for (const task of tasks) void task.then(result=> {
          if (result?.url && !result.trial) { resolve(result); return; }
          trial ??= result;
          if (--remaining===0) resolve(trial);
        });
      });
    } finally { cancel.abort(new RequestCancelled('CANCELLED')); }
  }
  async resolveFallback(track: Track, quality?: string): Promise<ResolveResult | null> {
    return withRequestScope(this.policy.totalMs,()=>this.run(track,quality,true)).catch(e=>failure(track,codeOf(e)));
  }
  async enrichFallback(track: Track): Promise<Track> {
    const result=await this.resolveFallback(track);
    return {...track,originalUrl:'',fallbackUrl:result?.url || ''};
  }
}
