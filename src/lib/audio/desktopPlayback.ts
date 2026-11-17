import { audioPlayer, type ResolveContext } from './AudioPlayer';
import type { Track } from '../catalog';
import { hasDesktopAPI, streamTrack, toBackendTrack, toFrontendTrack, viaOf } from '../playlist/ipcClient';
import { preferredQuality } from '../preferences';
import { qualityName } from '../quality';

/** 一次点播只走一次统一解析路由；失败不再启动第二轮跨平台兜底。 */
export async function resolveTrackForPlay(track: Track, _reason: 'empty' | 'error', context?: ResolveContext): Promise<Track | null> {
  if (!hasDesktopAPI() || context?.signal.aborted) return null;
  const res = await window.nebulaAPI!.resolveSong(toBackendTrack(track), preferredQuality() || undefined);
  if (context?.signal.aborted || !res.ok || !res.data?.url || res.data.playable === false) return null;
  return toFrontendTrack({ ...toBackendTrack(track), originalUrl: res.data.url }, track.id, {
    trial: res.data.trial, trialEndTime: res.data.trialEndTime, quality: res.data.quality,
    via: viaOf(res.data), resolvedAt: res.data.resolvedAt, expiresAt: res.data.expiresAt,
  });
}

let qualitySequence = 0;
export function selectQuality(level: string): void {
  try { localStorage.setItem('music-nebula.quality', level); } catch { /* 私密模式 */ }
  const song = audioPlayer.getState().song;
  if (!song || !hasDesktopAPI() || !song.sourceId || song.quality === level) return;
  const generation = audioPlayer.getGeneration(), seq = ++qualitySequence;
  const current = () => seq === qualitySequence && generation === audioPlayer.getGeneration();
  void window.nebulaAPI!.resolveSong(streamTrack(song), level).then(res => {
    if (!current()) return;
    if (!res.ok || !res.data?.url || res.data.playable === false) {
      audioPlayer.setError('该音质暂不可用，已保持当前音质'); return;
    }
    const got = res.data.quality || '';
    audioPlayer.switchSource(res.data.url, { quality: got, keepTime: true, via: res.data.fallback ? viaOf(res.data) : song.via });
    if (got && got !== level && qualityName(got) && qualityName(level)) {
      const msg = `这首歌没有「${qualityName(level)}」，已切到「${qualityName(got)}」`;
      const installed = audioPlayer.getGeneration();
      audioPlayer.setError(msg);
      window.setTimeout(() => {
        if (installed === audioPlayer.getGeneration() && audioPlayer.getState().error === msg) audioPlayer.setError(null);
      }, 3200);
    }
  }).catch(() => { if (current()) audioPlayer.setError('音质切换失败'); });
}
