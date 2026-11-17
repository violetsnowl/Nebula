import { audioPlayer, PlaybackResolutionError, type ResolveContext } from './AudioPlayer';
import type { Track } from '../catalog';
import { hasDesktopAPI, streamTrack, toBackendTrack, toFrontendTrack, viaOf, type DesktopTrack } from '../playlist/ipcClient';
import { preferredQuality } from '../preferences';
import { qualityName } from '../quality';

let requestSequence = 0;
async function resolveDesktop(track: DesktopTrack, quality?: string, signal?: AbortSignal, forceRefresh = false) {
  const requestId = `renderer-${++requestSequence}`;
  const cancel = () => { void window.nebulaAPI?.cancelResolve?.(requestId).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try { return await window.nebulaAPI!.resolveSong(track, quality, {requestId,forceRefresh}); }
  finally { signal?.removeEventListener('abort', cancel); }
}

/** 一次点播只走一次统一解析路由；失败不再启动第二轮跨平台兜底。 */
export async function resolveTrackForPlay(track: Track, _reason: 'empty' | 'error', context?: ResolveContext): Promise<Track | null> {
  if (!hasDesktopAPI() || context?.signal.aborted) return null;
  const res = await resolveDesktop(toBackendTrack(track), preferredQuality() || undefined, context?.signal, !!context?.forceRefresh);
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
