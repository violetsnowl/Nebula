import type { AdapterMap } from '../adapters/index';
import type { Platform, PlaybackSourceOption, ResolveResult, Track } from '../types';
import type { FallbackTarget } from './platformRouter';
import { matchScore, recordingMatch as filterCandidate, searchKeyword } from './recordingMatch';
export { matchScore } from './recordingMatch';
import { mapQualityTo } from '../quality';
import { requestScope, RequestCancelled, throwIfCancelled, withRequestScope } from '../requestScope';
import { sourceTiming } from '../../lib/audio/sourceLifetime';
import { QQ_AUTH_EXPIRED } from './qqSession';

const PLAYABLE: Platform[] = ['netease', 'qq', 'kugou', 'kuwo', 'bodian'];
/** 能当本平台主源的：可兜底的五家 + 汽水（#212 车机协议；抖音扫码授权后才有地址，不参与给别的平台兜底）。 */
const PRIMARY: Platform[] = [...PLAYABLE, 'qishui'];
const LEVELS: Record<string, string[]> = {
  netease: ['jymaster','hires','lossless','exhigh','standard'], qq: ['flac','320k','128k'], kugou: ['hires','flac','320','128'],
  kuwo: ['flac','320','128'], // #229 起适配器支持逐档降级（无权限自动落回 128k）
  bodian: ['flac','320','128'],
  qishui: ['standard'], // 车机协议只给未加密的标准音质 // 对应 flac/2000kflac、mp3/320kmp3、mp3/128kmp3；取不到时适配器自己依次降档
};
export type UrlProbe = (url: string, platform: Platform, signal?: AbortSignal) => Promise<boolean>;
export interface ResolveOptions { signal?: AbortSignal; forceRefresh?: boolean; preferPlatform?: Platform }
export interface ResolverPolicy { totalMs: number; primaryMs: number; searchMs: number; candidateMs: number; probeMs: number; cacheMs: number }
const POLICY: ResolverPolicy = { totalMs: 6000, primaryMs: 3500, searchMs: 1600, candidateMs: 2300, probeMs: 1600, cacheMs: 120000 };
type Job = { control: AbortController; users: number; done: boolean; promise: Promise<ResolveResult> };
type Timings = NonNullable<ResolveResult['timings']>;
let sequence = 0;
const failure = (t: Track, code: ResolveResult['code'] = 'NO_SOURCE'): ResolveResult => ({
  url: '', platform: t.platform, sourceId: t.sourceId, fallback: false, playable: false, code,
    error: code === 'AUTH_EXPIRED' ? QQ_AUTH_EXPIRED : code === 'CANCELLED' ? '播放请求已取消' : code === 'TIMEOUT' ? '音源解析超时' : '主平台与兜底平台均未获取到可播音源（含音源探测过滤）',
});
const codeOf = (e: unknown): 'TIMEOUT' | 'CANCELLED' | 'NO_SOURCE' => e instanceof RequestCancelled ? e.code : 'NO_SOURCE';
const remember = <T>(map: Map<string, T>, key: string, value: T, max = 256): void => {
  map.delete(key); map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value!);
};

/** 唯一解析入口：有界主源 → 并发安全候选 → 探测；缓存只保存已验证地址。 */
export class SongResolver {
  private fallbackTargets: (() => Promise<FallbackTarget[]>) | null = null;
  private cache = new Map<string, { result: ResolveResult; cachedUntil: number }>();
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
  private hasLiveAltSource(track: Track): boolean {
    return (
      Array.isArray(track.altSources) &&
      track.altSources.some(
        (a) =>
          !!a?.sourceId &&
          a.platform !== track.platform &&
          PLAYABLE.includes(a.platform) &&
          !!this.adapters[a.platform]?.fetchSongUrl &&
          this.adapters[a.platform]?.getAuthStatus?.() !== 'expired',
      )
    );
  }
  resolve(track: Track, quality?: string, options: ResolveOptions = {}): Promise<ResolveResult> {
    if (options.signal?.aborted) return Promise.resolve(failure(track, 'CANCELLED'));
    // 用户为这首歌手动选过优先播放平台（#323）：先在指定平台按同录音取链，拿不到整曲再无缝回落正常路由。
    if (options.preferPlatform && options.preferPlatform !== track.platform && PRIMARY.includes(options.preferPlatform)) {
      const target = options.preferPlatform;
      return this.resolveOnPlatform(track, target, quality, { signal: options.signal, forceRefresh: options.forceRefresh }).then(
        (hit) => (hit.url && !hit.trial ? hit : this.resolve(track, quality, { signal: options.signal, forceRefresh: options.forceRefresh })),
      );
    }
    const primaryExpired = this.adapters[track.platform]?.getAuthStatus?.() === 'expired';
    if (primaryExpired && !this.hasLiveAltSource(track)) {
      const result={...failure(track,'AUTH_EXPIRED'),traceId:`play-${++sequence}`,timings:[{stage:'auth',platform:track.platform,ms:0,outcome:'AUTH_EXPIRED'}]};
      this.report(result,Date.now());return Promise.resolve(result);
    }
    const key = this.key(track,quality), hit = this.cache.get(key);
    if (!options.forceRefresh && hit && hit.cachedUntil > Date.now() && (hit.result.expiresAt ?? 0) > Date.now() + 5000) {
      const result:ResolveResult={ ...hit.result, traceId: `play-${++sequence}`, timings: [{stage:'cache',platform:hit.result.platform,ms:0,outcome:'hit'}] };
      this.report(result,Date.now());return Promise.resolve(result);
    }
    this.cache.delete(key);
    const jobKey = key + (options.forceRefresh ? ':fresh' : ':normal');
    let job = this.jobs.get(jobKey);
    if (!job || job.control.signal.aborted) {
      if (options.forceRefresh) this.epoch++;
      const epoch = this.epoch;
      const traceId=`play-${++sequence}`,timings:Timings=[],start=Date.now();
      const created: Job = { control: new AbortController(), users: 0, done: false, promise: Promise.resolve(failure(track)) };
      created.promise = withRequestScope(this.policy.totalMs, () => this.run(track, quality, primaryExpired, traceId, timings), {
        signal: created.control.signal, forceRefresh: options.forceRefresh, detached: true,
      }).catch(e => ({...failure(track,codeOf(e)),traceId,timings:[...timings,{stage:'budget',platform:track.platform,ms:Date.now()-start,outcome:codeOf(e)}]})).then(result => {
        this.report(result,start);
        if (result.url && result.playable && epoch === this.epoch && !created.control.signal.aborted) remember(this.cache,key,{result,cachedUntil:Date.now()+this.policy.cacheMs});
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
  private report(result:ResolveResult,start:number):void {
    this.log(JSON.stringify({traceId:result.traceId,ms:Date.now()-start,result:result.url?(result.trial?'TRIAL_ONLY':'OK'):result.code,platform:result.platform,fallback:result.fallback,timings:result.timings}));
  }
  private async stage<T>(timings: Timings, stage: string, platform: string, ms: number, fn: () => Promise<T>): Promise<T> {
    const at = Date.now(); let outcome = 'ok';
    try { return await withRequestScope(ms,fn); }
    catch(e) { outcome=codeOf(e); throw e; }
    finally { timings.push({stage,platform,ms:Date.now()-at,outcome}); }
  }
  private async source(
    track: Track,
    platform: Platform,
    quality: string | undefined,
    fallback: boolean,
    timings: Timings,
    opts?: { candidateMs?: number; probeMs?: number; skipBreaker?: boolean },
  ): Promise<ResolveResult | null> {
    throwIfCancelled();
    const breaker = this.health.get(platform);
    // 用户主动点播（主源或手动指定平台）始终给该平台恢复机会；单曲超时不代表整个平台不可用。
    if (fallback && !opts?.skipBreaker && breaker && breaker.until > Date.now()) {
      timings.push({ stage: 'circuit', platform, ms: 0, outcome: 'open' });
      return null;
    }
    const candidateMs = opts?.candidateMs ?? this.policy.candidateMs;
    const probeMs = opts?.probeMs ?? this.policy.probeMs;
    try {
      const direct = await this.stage(timings, 'fetch', platform, candidateMs, () => this.adapters[platform].fetchSongUrl(
        track.sourceId, track.extra?.albumId == null ? undefined : String(track.extra.albumId), mapQualityTo(LEVELS[platform] || [],quality),track.extra,
      ));
      if (!direct?.url || direct.playable === false) {
        timings.push({stage:'availability',platform,ms:0,outcome:direct?.code || 'NO_SOURCE'});
        return direct?.code==='AUTH_EXPIRED'?failure(track,'AUTH_EXPIRED'):null;
      }
      const accepted = !this.probe || await this.stage(timings, 'probe', platform, probeMs, () => this.probe!(direct.url, platform, requestScope()?.signal));
      if (!accepted) { timings.push({stage:'availability',platform,ms:0,outcome:'PROBE_REJECTED'}); return null; }
      this.health.delete(platform);
      const now = Date.now();
      return { url:direct.url, fallback, platform, sourceId:track.sourceId, trial:direct.trial, trialEndTime:direct.trialEndTime,
        quality:direct.quality, playable:true, ...sourceTiming(platform,now,direct.expiresAt), ...(direct.trial ? {code:'TRIAL_ONLY' as const} : {}) };
    } catch(e) {
      if (codeOf(e) === 'NO_SOURCE') {
        const n=(this.health.get(platform)?.failures || 0)+1;
        this.health.set(platform,{failures:n,until:n>=3?Date.now()+30000:0});
      }
      throwIfCancelled();
      return null;
    }
  }
  private async run(track: Track, quality?: string, fallbackOnly = false,traceId=`play-${++sequence}`,timings:Timings=[]): Promise<ResolveResult> {
    let direct: ResolveResult | null = null, result: ResolveResult;
    try {
      if (!fallbackOnly && PRIMARY.includes(track.platform)) {
        try { direct=await this.stage(timings,'primary',track.platform,this.policy.primaryMs,()=>this.source(track,track.platform,quality,false,timings)); } catch { throwIfCancelled(); }
      }
      result = (direct?.code==='AUTH_EXPIRED' && !this.hasLiveAltSource(track)) || (direct?.url && !direct.trial) ? direct : await this.fallback(track,quality,timings) || direct || failure(track);
    } catch(e) { result=direct?.url ? direct : failure(track,codeOf(e)); }
    if(!result.url && result.code==='NO_SOURCE'){
      const cause=timings.find(t=>t.stage==='availability'&&t.platform===track.platform)?.outcome;
      if(cause==='LOGIN_REQUIRED')result.error='当前平台需要登录，其他平台也未找到可用音源';
      if(cause==='RIGHTS_OR_UNAVAILABLE')result.error='当前账号没有可用音源，可能受权限或版权限制；其他平台也不可用';
      if(cause==='NETWORK')result.error='平台连接失败，其他平台也暂时不可用';
      if(cause==='AUTH_UNVERIFIED')result.error='QQ 登录状态暂未核验，无法判定歌曲授权；其他平台也未找到可用音源';
      if(cause==='UPSTREAM_ERROR')result.error='QQ 取链接口返回异常，其他平台也未找到可用音源';
    }
    const complete={...result,traceId,timings:[...timings]};
    return complete;
  }
  private async fallback(track: Track, quality: string | undefined, timings: Timings): Promise<ResolveResult | null> {
    let order: FallbackTarget[]=[];
    if (this.fallbackTargets) {
      try { order=await this.stage(timings,'priority','all',100,()=>this.fallbackTargets!()); } catch { throwIfCancelled(); }
    }
    const orderRank = new Map<string, number>();
    order.forEach((t, i) => orderRank.set(t.platform, i));

    let trial: ResolveResult | null = null;
    const seenAlt = new Set<string>();
    const altList = Array.isArray(track.altSources)
      ? track.altSources
          .filter((a) => {
            if (
              !a?.sourceId ||
              a.platform === track.platform ||
              !PLAYABLE.includes(a.platform) ||
              !this.adapters[a.platform]?.fetchSongUrl ||
              this.adapters[a.platform]?.getAuthStatus?.() === 'expired'
            ) {
              return false;
            }
            const key = `${a.platform}:${a.sourceId}`;
            if (seenAlt.has(key)) return false;
            seenAlt.add(key);
            return true;
          })
          .sort((a, b) => (orderRank.get(a.platform) ?? 99) - (orderRank.get(b.platform) ?? 99))
      : [];

    if (altList.length > 0) {
      const altBudgetMs = Math.min(this.policy.totalMs, Math.max(this.policy.candidateMs, 2600));
      const altCancel = new AbortController();
      let altHit: ResolveResult | null = null;
      try {
        altHit = await new Promise<ResolveResult | null>((resolve) => {
          let remaining = altList.length;
          let settled = false;
          const finish = (hit: ResolveResult | null) => {
            if (settled) return;
            settled = true;
            resolve(hit);
          };
          for (const alt of altList) {
            const altTrack: Track = {
              ...track,
              platform: alt.platform,
              sourceId: alt.sourceId,
              album: alt.album ?? track.album,
              duration: alt.duration ?? track.duration,
              extra: alt.extra ?? (alt.albumId ? { albumId: alt.albumId } : undefined),
            };
            const started = Date.now();
            void withRequestScope(
              altBudgetMs,
              async () => {
                const result = await this.source(altTrack, alt.platform, quality, true, timings);
                timings.push({
                  stage: 'alt-source',
                  platform: alt.platform,
                  ms: Date.now() - started,
                  outcome: result?.url ? (result.trial ? 'trial' : 'hit') : (result?.code || 'miss'),
                });
                return result;
              },
              { signal: altCancel.signal },
            )
              .catch(() => null)
              .then((result) => {
                if (result?.url && !result.trial) {
                  finish(result);
                  return;
                }
                if (result?.url) trial ??= result;
                if (--remaining === 0) finish(null);
              });
          }
        });
      } finally {
        altCancel.abort(new RequestCancelled('CANCELLED'));
      }
      if (altHit) return altHit;
      throwIfCancelled();
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
          const search=(stage:string)=>this.stage(timings,stage,platform,this.policy.searchMs,()=>this.adapters[platform].searchSongs!(searchKeyword(track),12));
          let rows:Track[]=[];
          try { rows=await search('search'); } catch { throwIfCancelled(); }
          // 平台搜索偶尔返回空列表或超时（#205：261 首找不到的歌里 14 首重搜一次就找到了），隔一下再搜一次
          if (!rows.length) { await new Promise(r=>setTimeout(r,Math.min(250,this.policy.searchMs/4))); throwIfCancelled(); rows=await search('search-retry'); }
          candidates=rows.map(c=>({c,score:matchScore(c,track),guard:filterCandidate(c,track)}))
            .filter(x=>x.guard.ok && x.score>=.55).sort((a,b)=>a.guard.rank-b.guard.rank || b.score-a.score).slice(0,2).map(x=>x.c);
          if (candidates.length) remember(this.matches,matchKey,{at:Date.now(),tracks:candidates},512);
        }
        let localTrial: ResolveResult | null=null;
        for (const c of candidates) {
          throwIfCancelled();
          const result=await this.source(c,platform,quality,true,timings);
          if (result?.url && !result.trial) return result;
          if (result?.url) localTrial ??= result;
        }
        return localTrial;
      },{signal:cancel.signal}).catch(()=>null));
      if (!tasks.length) return trial;
      return await new Promise<ResolveResult | null>(resolve=> {
        let remaining=tasks.length, resolvedTrial: ResolveResult | null=trial;
        for (const task of tasks) void task.then(result=> {
          if (result?.url && !result.trial) { resolve(result); return; }
          if (result?.url) resolvedTrial ??= result;
          if (--remaining===0) resolve(resolvedTrial);
        });
      });
    } finally { cancel.abort(new RequestCancelled('CANCELLED')); }
  }
  async resolveFallback(track: Track, quality?: string): Promise<ResolveResult | null> {
    const start=Date.now(),traceId=`play-${++sequence}`,timings:Timings=[];
    const result=await withRequestScope(this.policy.totalMs,()=>this.run(track,quality,true,traceId,timings)).catch(e=>({...failure(track,codeOf(e)),traceId,timings:[...timings]}));
    this.report(result,start);return result;
  }
  async enrichFallback(track: Track): Promise<Track> {
    const result=await this.resolveFallback(track);
    return {...track,originalUrl:'',fallbackUrl:result?.url || ''};
  }

  /**
   * 列出当前曲目可手动切换的播放平台（#323）：原平台（若可直取）排第一，其余按用户已登录 VIP 档位排序。
   * 读取的是 platformRouter 的 5 分钟内存快照，零额外网络等待。
   */
  async listPlayableSources(track: Track): Promise<PlaybackSourceOption[]> {
    let targets: FallbackTarget[] = [];
    if (this.fallbackTargets) {
      try { targets = await withRequestScope(150, () => this.fallbackTargets!()); } catch { /* 沿用默认 */ }
    }
    const tierBy = new Map<string, FallbackTarget['tier']>();
    for (const t of targets) tierBy.set(t.platform, t.tier);
    const rank: Record<FallbackTarget['tier'], number> = { svip: 0, vip: 1, free: 2, guest: 3 };
    const candidates: Platform[] = [];
    if (PRIMARY.includes(track.platform) && typeof this.adapters[track.platform]?.fetchSongUrl === 'function') {
      candidates.push(track.platform);
    }
    for (const p of PLAYABLE) {
      if (p === track.platform || typeof this.adapters[p]?.fetchSongUrl !== 'function') continue;
      if (this.adapters[p]?.getAuthStatus?.() === 'expired') continue;
      // 波点游客无整曲权限，仅登录后列出
      if (p === 'bodian' && (tierBy.get(p) ?? 'guest') === 'guest') continue;
      candidates.push(p);
    }
    const rest = candidates
      .filter((p) => p !== track.platform)
      .sort((a, b) => rank[tierBy.get(a) ?? 'guest'] - rank[tierBy.get(b) ?? 'guest']);
    const ordered = candidates.includes(track.platform) ? [track.platform, ...rest] : rest;
    return ordered.map((platform) => {
      const isOriginal = platform === track.platform;
      const alt = track.altSources?.find((a) => a.platform === platform);
      const cached = this.matches.get(`${this.key(track)}:${platform}`)?.tracks?.[0];
      return {
        platform,
        tier: tierBy.get(platform) ?? 'guest',
        isOriginal,
        sourceId: isOriginal ? track.sourceId : (alt?.sourceId ?? cached?.sourceId),
      };
    });
  }

  /**
   * 严格在用户指定的单一平台上解析同一录音（#323）：不静默跳回其他平台，
   * 找不到同录音或无可用整曲时返回明确失败，由前端保持当前播放并提示用户。
   */
  async resolveOnPlatform(track: Track, targetPlatform: Platform, quality?: string, options: ResolveOptions = {}): Promise<ResolveResult> {
    if (options.signal?.aborted) return failure(track, 'CANCELLED');
    const adapter = this.adapters[targetPlatform];
    if (!adapter?.fetchSongUrl || !PRIMARY.includes(targetPlatform)) {
      return { ...failure(track, 'NO_SOURCE'), platform: targetPlatform, error: '该平台不支持直接播放' };
    }
    if (adapter.getAuthStatus?.() === 'expired') {
      return { ...failure(track, 'AUTH_EXPIRED'), platform: targetPlatform };
    }
    const start = Date.now();
    const traceId = `play-${++sequence}`;
    const timings: Timings = [];
    const fallback = targetPlatform !== track.platform;
    // 手动单平台切换：用户明确在等这一家，比后台 5 平台竞速兜底给足预算（QQ 搜索常在 1.3–2.5s），并做 1 次重搜。
    // 单元测试注入小预算（< 1s）时沿用注入值，不拖慢测试。
    const manual = this.policy.totalMs >= 1000;
    const totalMs = manual ? Math.max(this.policy.totalMs, 10000) : this.policy.totalMs;
    const searchMs = manual ? Math.max(this.policy.searchMs, 4000) : this.policy.searchMs;
    const candidateMs = manual ? Math.max(this.policy.candidateMs, 4500) : this.policy.candidateMs;
    const probeMs = manual ? Math.max(this.policy.probeMs, 2500) : this.policy.probeMs;
    try {
      const res = await withRequestScope(
        totalMs,
        async (): Promise<ResolveResult> => {
          let candidates: Track[] = [];
          let searchTimedOut = false;
          if (!fallback) {
            candidates = [track];
          } else {
            const alt = track.altSources?.find((a) => a.platform === targetPlatform && a.sourceId);
            if (alt) {
              candidates = [{
                ...track,
                platform: targetPlatform,
                sourceId: alt.sourceId,
                album: alt.album ?? track.album,
                duration: alt.duration ?? track.duration,
                extra: alt.extra ?? (alt.albumId ? { albumId: alt.albumId } : undefined),
              }];
            } else {
              const matchKey = `${this.key(track)}:${targetPlatform}`;
              const hit = this.matches.get(matchKey);
              if (hit && Date.now() - hit.at < 24 * 3600_000) {
                candidates = hit.tracks;
              } else if (adapter.searchSongs) {
                const runSearch = async (stage: string): Promise<Track[]> => {
                  try {
                    const found = await this.stage(timings, stage, targetPlatform, searchMs, () =>
                      adapter.searchSongs!(searchKeyword(track), 12),
                    );
                    searchTimedOut = false;
                    return found;
                  } catch (e) {
                    throwIfCancelled();
                    if (codeOf(e) === 'TIMEOUT') searchTimedOut = true;
                    return [];
                  }
                };
                let rows = await runSearch('search');
                if (!rows.length) {
                  await new Promise((r) => setTimeout(r, Math.min(250, Math.max(5, searchMs / 4))));
                  throwIfCancelled();
                  rows = await runSearch('search-retry');
                }
                candidates = rows
                  .map((c) => ({ c, score: matchScore(c, track), guard: filterCandidate(c, track) }))
                  .filter((x) => x.guard.ok && x.score >= 0.55)
                  .sort((a, b) => a.guard.rank - b.guard.rank || b.score - a.score)
                  .slice(0, 2)
                  .map((x) => x.c);
                if (candidates.length) remember(this.matches, matchKey, { at: Date.now(), tracks: candidates }, 512);
              }
            }
          }
          let trial: ResolveResult | null = null;
          for (const c of candidates) {
            throwIfCancelled();
            const got = await this.source(c, targetPlatform, quality, fallback, timings, {
              candidateMs,
              probeMs,
              skipBreaker: true,
            });
            if (got?.code === 'AUTH_EXPIRED') return { ...got, platform: targetPlatform };
            if (got?.url && !got.trial) return got;
            if (got?.url) trial ??= got;
          }
          if (!candidates.length && searchTimedOut) {
            return { ...failure(track, 'TIMEOUT'), platform: targetPlatform, error: '该平台搜索超时，请稍后再试' };
          }
          return trial ?? { ...failure(track, 'NO_SOURCE'), platform: targetPlatform, error: '该平台暂无此录音的可用音源' };
        },
        { signal: options.signal, forceRefresh: true },
      );
      const complete = { ...res, traceId, timings };
      this.report(complete, start);
      return complete;
    } catch (e) {
      const complete = { ...failure(track, codeOf(e)), platform: targetPlatform, traceId, timings };
      this.report(complete, start);
      return complete;
    }
  }
}
