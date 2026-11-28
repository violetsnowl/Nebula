import { audioPlayer, PlaybackResolutionError, type ResolveContext } from './AudioPlayer';
import type { Track } from '../catalog';
import {
  hasDesktopAPI,
  streamTrack,
  toBackendTrack,
  toFrontendTrack,
  viaOf,
  type DesktopPlaybackSourceOption,
  type DesktopTrack,
} from '../playlist/ipcClient';
import { getPreferredSource, preferredQuality, setPreferredSource } from '../preferences';
import { platformName, qualityName } from '../quality';

let requestSequence = 0;
async function resolveDesktop(
  track: DesktopTrack,
  quality?: string,
  signal?: AbortSignal,
  forceRefresh = false,
  preferPlatform?: string,
) {
  const requestId = `renderer-${++requestSequence}`;
  const cancel = () => { void window.nebulaAPI?.cancelResolve?.(requestId).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try { return await window.nebulaAPI!.resolveSong(track, quality, { requestId, forceRefresh, preferPlatform }); }
  finally { signal?.removeEventListener('abort', cancel); }
}

/** 一次点播只走一次统一解析路由；若用户曾为这首歌手动指定过平台，优先从指定平台取链。 */
export async function resolveTrackForPlay(track: Track, _reason: 'empty' | 'error', context?: ResolveContext): Promise<Track | null> {
  if (!hasDesktopAPI() || context?.signal.aborted) return null;
  const trackKey = track.sourceId ? `${track.source}:${track.sourceId}` : '';
  const prefer = trackKey ? getPreferredSource(trackKey) : '';
  const preferPlatform = prefer && prefer !== track.source ? prefer : undefined;
  const res = await resolveDesktop(
    toBackendTrack(track),
    preferredQuality() || undefined,
    context?.signal,
    !!context?.forceRefresh,
    preferPlatform,
  );
  if (context?.signal.aborted) return null;
  if (!res.ok || !res.data?.url || res.data.playable === false)
    throw new PlaybackResolutionError(res.ok ? res.data?.error || '未获取到可播音源' : '播放服务暂时不可用',res.ok && res.data?.code==='AUTH_EXPIRED');
  return toFrontendTrack({ ...toBackendTrack(track), originalUrl: res.data.url }, track.id, {
    trial: res.data.trial, trialEndTime: res.data.trialEndTime, quality: res.data.quality,
    via: viaOf(res.data), resolvedAt: res.data.resolvedAt, expiresAt: res.data.expiresAt,
  });
}

let qualitySequence = 0;
let qualityRequest: AbortController | null = null;
export function selectQuality(level: string): void {
  try { localStorage.setItem('music-nebula.quality', level); } catch { /* 私密模式 */ }
  const song = audioPlayer.getState().song;
  if (!song || !hasDesktopAPI() || !song.sourceId || song.quality === level) return;
  const generation = audioPlayer.getGeneration(), seq = ++qualitySequence;
  qualityRequest?.abort();
  const control = new AbortController(); qualityRequest = control;
  const unsubscribe = audioPlayer.subscribe(() => { if (generation !== audioPlayer.getGeneration()) control.abort(); });
  const current = () => seq === qualitySequence && generation === audioPlayer.getGeneration();
  void resolveDesktop(streamTrack(song), level, control.signal, true).then(res => {
    unsubscribe();
    if (!current()) return;
    if (!res.ok || !res.data?.url || res.data.playable === false) {
      if(res.ok && res.data?.code==='AUTH_EXPIRED'){audioPlayer.setError(res.data.error || 'QQ 登录已过期，请重新登录');return;}
      audioPlayer.setError('该音质暂不可用，已保持当前音质'); return;
    }
    const got = res.data.quality || '';
    audioPlayer.switchSource(res.data.url, { quality: got, keepTime: true, via: res.data.fallback ? viaOf(res.data) : song.via, resolvedAt:res.data.resolvedAt, expiresAt:res.data.expiresAt });
    if (got && got !== level && qualityName(got) && qualityName(level)) {
      const msg = `这首歌没有「${qualityName(level)}」，已切到「${qualityName(got)}」`;
      const installed = audioPlayer.getGeneration();
      audioPlayer.setError(msg);
      window.setTimeout(() => {
        if (installed === audioPlayer.getGeneration() && audioPlayer.getState().error === msg) audioPlayer.setError(null);
      }, 3200);
    }
  }).catch(() => { if (current()) audioPlayer.setError('音质切换失败'); }).finally(unsubscribe);
}

/** 音质弹层打开时按需拉取当前曲目可手动切换的平台列表。 */
export async function loadPlaybackSources(): Promise<DesktopPlaybackSourceOption[]> {
  const song = audioPlayer.getState().song;
  if (!song || !hasDesktopAPI() || !song.sourceId || !window.nebulaAPI?.songSources) return [];
  if (song.source === 'local' || song.source === 'demo') return [];
  try {
    const res = await window.nebulaAPI.songSources(toBackendTrack(song));
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch {
    return [];
  }
}

export interface PlaybackSourceSwitchResult {
  ok: boolean;
  status: 'switched' | 'noop' | 'cancelled' | 'trial' | 'unavailable' | 'auth_expired' | 'timeout' | 'error';
  message?: string;
  quality?: string;
}

/** 手动切换当前歌曲的播放平台（#323 / #324）：保持当前播放进度，成功后记住该曲选择；失败时保持原播放并给出清晰反馈。 */
export function selectPlaybackSource(
  targetPlatform: string,
  onNotify?: (message: string) => void,
): Promise<PlaybackSourceSwitchResult> {
  const song = audioPlayer.getState().song;
  if (!song || !hasDesktopAPI() || !song.sourceId || !window.nebulaAPI?.resolveOnPlatform) {
    return Promise.resolve({ ok: false, status: 'noop' });
  }
  const activePlatform = song.via?.platform ?? song.source;
  if (targetPlatform === activePlatform) return Promise.resolve({ ok: true, status: 'noop' });
  const generation = audioPlayer.getGeneration(), seq = ++qualitySequence;
  qualityRequest?.abort();
  const control = new AbortController(); qualityRequest = control;
  const unsubscribe = audioPlayer.subscribe(() => { if (generation !== audioPlayer.getGeneration()) control.abort(); });
  const current = () => seq === qualitySequence && generation === audioPlayer.getGeneration();
  const requestId = `renderer-${++requestSequence}`;
  const cancel = () => { void window.nebulaAPI?.cancelResolve?.(requestId).catch(() => {}); };
  control.signal.addEventListener('abort', cancel, { once: true });
  const flash = (msg: string, ms = 2800) => {
    const installed = audioPlayer.getGeneration();
    audioPlayer.setError(msg);
    window.setTimeout(() => {
      if (installed === audioPlayer.getGeneration() && audioPlayer.getState().error === msg) audioPlayer.setError(null);
    }, ms);
  };
  const label = platformName(targetPlatform);
  flash(`正在切换至 ${label}…`, 8000);
  return window.nebulaAPI
    .resolveOnPlatform(toBackendTrack(song), targetPlatform, preferredQuality() || undefined, { requestId })
    .then((res): PlaybackSourceSwitchResult => {
      if (!current()) return { ok: false, status: 'cancelled' };
      if (!res.ok || !res.data?.url || res.data.playable === false || res.data.trial) {
        if (res.ok && res.data?.code === 'AUTH_EXPIRED') {
          const msg = res.data.error || `${label} 登录已过期，请重新登录`;
          audioPlayer.setError(msg);
          onNotify?.(msg);
          return { ok: false, status: 'auth_expired', message: msg };
        }
        if (res.ok && res.data?.code === 'TIMEOUT') {
          const msg = `${label}请求超时，已保持当前播放`;
          flash(msg, 3200);
          onNotify?.(msg);
          return { ok: false, status: 'timeout', message: msg };
        }
        const isTrial = Boolean(res.ok && res.data?.trial);
        const reason = isTrial ? '仅有试听片段' : '暂无可用整曲音源';
        const msg = `${label}${reason}，已保持当前播放`;
        flash(msg, 3200);
        onNotify?.(msg);
        return { ok: false, status: isTrial ? 'trial' : 'unavailable', message: msg };
      }
      const key = `${song.source}:${song.sourceId}`;
      setPreferredSource(key, targetPlatform === song.source ? null : targetPlatform);
      const got = res.data.quality || '';
      audioPlayer.switchSource(res.data.url, {
        quality: got,
        keepTime: true,
        via: targetPlatform === song.source ? undefined : { platform: res.data.platform, sourceId: res.data.sourceId },
        resolvedAt: res.data.resolvedAt,
        expiresAt: res.data.expiresAt,
      });
      const qText = qualityName(got);
      const msg = qText ? `已切至 ${label}（${qText}）` : `已切至 ${label}`;
      flash(msg);
      onNotify?.(msg);
      return { ok: true, status: 'switched', message: msg, quality: got };
    })
    .catch((): PlaybackSourceSwitchResult => {
      if (!current()) return { ok: false, status: 'cancelled' };
      const msg = `切换至 ${label} 失败，已保持当前播放`;
      flash(msg, 3200);
      onNotify?.(msg);
      return { ok: false, status: 'error', message: msg };
    })
    .finally(() => {
      unsubscribe();
      control.signal.removeEventListener('abort', cancel);
    });
}
