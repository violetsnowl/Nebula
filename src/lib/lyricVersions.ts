import type { DesktopLyricVersion } from './playlist/ipcClient';
import { platformName } from './quality';

/**
 * 歌词版本（手动换歌词）用到的纯文案函数：右栏「歌词版本」页的行说明、「关于这首歌」里「歌词」行的来源说明。
 * 单独成文件好单测（scripts/lyric-regression.mjs 用 esbuild 打包它）。
 */

/** 一条合并来源记录（后端 provenance 里前端用得到的部分）。 */
export interface LyricProvenanceItem {
  platform: string;
  kind: string;
  /** 这一家补了什么（只有 enrichment 有）。 */
  gain?: string[];
}

/** 当前歌词的来源摘要（useLyrics 的 lyricDebugInfo 里取）：「关于这首歌」里「歌词」行、版本页的「自动」行用。 */
export interface LyricSourceSummary {
  provenance?: LyricProvenanceItem[];
  /** 时间微调（毫秒，正数 = 推后）。 */
  offsetMs?: number;
}

/** 歌词版本页改了选择 / 微调后，通知歌词领域（useLyrics）立即重载当前这首（旧歌词留着直到新的到）。 */
export const LYRIC_RELOAD_EVENT = 'nebula:lyric-reload';
export function requestLyricReload(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LYRIC_RELOAD_EVENT));
}

/** 时间微调范围与档位（和后端一致）：±5 秒、0.1 秒一档。 */
export const LYRIC_OFFSET_MAX_MS = 5000;
export const LYRIC_OFFSET_STEP_MS = 100;

/** 来源的完整中文名（版本列表的行名）：平台中文名，AMLL 社区库。 */
export function lyricSourceName(platform: string): string {
  return platform === 'amll' ? 'AMLL 社区库' : platformName(platform);
}

const SHORT_NAMES: Record<string, string> = {
  netease: '网易云',
  qq: 'QQ',
  kugou: '酷狗',
  kuwo: '酷我',
  bodian: '波点',
  qishui: '汽水',
  applemusic: 'Apple',
  amll: 'AMLL',
};
/** 来源的短名（一句话里用）：网易云 / QQ / AMLL …；没登记的用完整名。 */
export function lyricSourceShort(platform: string): string {
  return SHORT_NAMES[platform] ?? lyricSourceName(platform);
}

const GAIN_LABELS: Record<string, string> = { words: '逐字', translation: '翻译', roman: '罗马音', bg: '和声' };

/**
 * 自动合并结果的来源说明：第一项是正文，后面每项写「X 补逐字」；能区分补了什么就写具体的（逐字 / 翻译 / 罗马音 / 和声），区分不了写「X 补全」。
 * short = true 时正文不带「正文」二字（「网易云 · QQ 补逐字」），给「关于这首歌」里那一行用。
 */
export function describeAutoSource(provenance: LyricProvenanceItem[] | undefined, short = false): string {
  const [head, ...rest] = provenance ?? [];
  if (!head) return '';
  const parts = [`${lyricSourceShort(head.platform)}${short ? '' : '正文'}`];
  for (const p of rest) {
    const labels = (p.gain ?? []).map((g) => GAIN_LABELS[g]).filter(Boolean);
    parts.push(`${lyricSourceShort(p.platform)} 补${labels.length ? labels.join('、') : '全'}`);
  }
  return parts.join(' · ');
}

/** 毫秒 → 0.1 秒一档的绝对值文案（300 → 「0.3」）。 */
const tenths = (ms: number): string => (Math.abs(ms) / 1000).toFixed(1);

/** 微调数值：「+0.3 秒」「−0.5 秒」，0 是「0.0 秒」。 */
export function formatLyricOffset(ms: number): string {
  if (!ms) return '0.0 秒';
  return `${ms > 0 ? '+' : '−'}${tenths(ms)} 秒`;
}

/** 微调一档（±0.1 秒），夹在 ±5 秒内，并消掉浮点误差。 */
export function stepLyricOffset(ms: number, dir: 1 | -1): number {
  const next = Math.round((ms + dir * LYRIC_OFFSET_STEP_MS) / LYRIC_OFFSET_STEP_MS) * LYRIC_OFFSET_STEP_MS;
  return Math.max(-LYRIC_OFFSET_MAX_MS, Math.min(LYRIC_OFFSET_MAX_MS, next)) || 0;
}

/**
 * 「关于这首歌」里「歌词」行右边的当前来源说明：
 * 自动 →「网易云 · QQ 补逐字」；手动 →「手动：QQ 音乐」；有微调再加「· 推后 0.3 秒」（负数写「提前」）。
 * 手动与否看 provenance 第一项是不是 manual（选中的那份取不到、退回自动时就不是）。还没有歌词来源时返回空串。
 */
export function describeLyricEntry(provenance: LyricProvenanceItem[] | undefined, offsetMs = 0): string {
  const head = provenance?.[0];
  const base = !head ? '' : head.kind === 'manual' ? `手动：${lyricSourceName(head.platform)}` : describeAutoSource(provenance, true);
  if (!offsetMs) return base;
  const shift = `${offsetMs > 0 ? '推后' : '提前'} ${tenths(offsetMs)} 秒`;
  return base ? `${base} · ${shift}` : shift;
}

/** 版本行的说明：逐字 62% / 只有整句 · 翻译 · 罗马音 · 和声 · 对唱 · 时长差 0.4 秒（≥2 秒提醒可能不是同一版本）。 */
export function describeVersion(v: Pick<DesktopLyricVersion, 'coverage' | 'durationDiffSec'>): string {
  const c = v.coverage;
  const total = Math.max(1, c.textLines);
  const parts: string[] = [c.wordLines > 0 ? `逐字 ${Math.round((c.wordLines / total) * 100)}%` : '只有整句'];
  if (c.translatedLines / total >= 0.5) parts.push('翻译');
  if (c.romanLines / total >= 0.5) parts.push('罗马音');
  if (c.bgLines > 0) parts.push('和声');
  if (c.agentLines > 0) parts.push('对唱');
  const d = v.durationDiffSec;
  if (d !== null && d !== undefined && Number.isFinite(d)) {
    const diff = `时长差 ${Math.round(Math.abs(d) * 10) / 10} 秒`;
    parts.push(Math.abs(d) >= 2 ? `${diff}，可能不是同一版本` : diff);
  }
  return parts.join(' · ');
}
