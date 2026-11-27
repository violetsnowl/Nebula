import type { RNG } from './rng';
import { int, pick } from './rng';
import { sampleAudioFor } from './audio/sampleUrls';

const TITLE_A = [
  'Midnight', 'Neon', 'Crystal', 'Velvet', 'Solar', 'Lunar', 'Chrome',
  'Silk', 'Cosmic', 'Electric', 'Golden', 'Frozen', 'Wild', 'Soft',
  'Urban', 'Hollow', 'Liquid', 'Starlit', 'Paper', 'Glass',
] as const;

const TITLE_B = [
  'Dreams', 'Horizon', 'Mirage', 'Signal', 'Bloom', 'Echo', 'Pulse',
  'Drift', 'Glow', 'Motion', 'Waves', 'Flame', 'Rain', 'City',
  'Garden', 'Static', 'Haze', 'Orbit', 'Vapor', 'Nocturne',
] as const;

const ARTIST_A = [
  'Aurora', 'Nova', 'Kai', 'Mira', 'Luna', 'Rex', 'Iris', 'Noir',
  'Juno', 'Vale', 'Onyx', 'Zephyr', 'Sable', 'Lyra', 'Echo',
] as const;

const ARTIST_B = [
  'Waves', 'Systems', 'District', 'Tape', 'Club', 'Lab', 'Sky',
  'Union', 'Pulse', 'Field', 'Collective', 'Orchestra', 'Radio', 'Grid',
] as const;

const STYLES = [
  'Dream Pop', 'Synthwave', 'Ambient', 'Lo-Fi', 'Future Bass', 'Neo Soul',
  'Vaporwave', 'Chillhop', 'Progressive House', 'Cinematic', 'Jazz Fusion',
] as const;

export interface Track {
  id: number;
  title: string;
  artist: string;
  style: string;
  hue1: number;
  hue2: number;
  /** 音频直链（MP3 CDN）。 */
  audio: string;
  /** 来源：qq / netease / demo 等。 */
  source: string;
  /** 平台内歌曲 ID（桌面端解析后回填）。 */
  sourceId?: string;
  album?: string;
  cover?: string;
  duration?: number;
  /** 是否为试听片段（freeTrialInfo）。 */
  trial?: boolean;
  /** 试听片段结束时间（毫秒）。 */
  trialEndTime?: number;
  /** Current quality tier (netease level / qq flac|320k|128k). */
  quality?: string;
  /**
   * 实际供流的平台：主平台取不到链、跨平台兜底命中时记下兜底平台与它的歌曲 id。
   * 音质列表与切换都要按这个平台来（档位是它的），否则菜单列的是原平台的档位、和正在放的对不上。
   */
  via?: { platform: string; sourceId: string };
  /** 整合歌单跨平台/多来源去重后留存的已知同录音备用源，供播放兜底优先直取。 */
  altSources?: TrackAltSource[];
}

export interface TrackAltSource {
  platform: string;
  sourceId: string;
  album?: string;
  albumId?: string;
  duration?: number;
  extra?: Record<string, unknown>;
}

/**
 * 演示星云开关（仅开发 / QA 用）：页面 URL 带 `?demo=1`，或 localStorage `music-nebula.dev.demo-nebula = '1'`。
 * 首次启动默认不再生成演示曲库（随机色相的占位方块不来自音乐，见「首次启动」空状态），
 * 但 QA 的舞台测试（总数 1000、挂载数、鱼眼、拖拽、滚轮）依赖这片星云，所以保留一个显式开关。
 */
export function isDemoNebulaEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('demo') === '1') return true;
    return window.localStorage.getItem('music-nebula.dev.demo-nebula') === '1';
  } catch {
    return false;
  }
}

/** 伪随机生成整片“星云”的歌单（封面配色、标题、艺人全部确定性生成，零网络依赖）。 */
export function generateTracks(
  rng: RNG,
  count: number,
  source: string = 'demo',
  audioOffset: number = 0,
): Track[] {
  const tracks: Track[] = [];
  for (let i = 0; i < count; i++) {
    const hue1 = int(rng, 0, 359);
    const hue2 = (hue1 + int(rng, 40, 140)) % 360;
    tracks.push({
      id: i,
      title: `${pick(rng, TITLE_A)} ${pick(rng, TITLE_B)}`,
      artist: `${pick(rng, ARTIST_A)} ${pick(rng, ARTIST_B)}`,
      style: pick(rng, STYLES),
      hue1,
      hue2,
      audio: sampleAudioFor(i + audioOffset),
      source,
    });
  }
  return tracks;
}
