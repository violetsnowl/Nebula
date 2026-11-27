import type {
  AltSource,
  MergeSourceRef,
  MergedPlaylistStats,
  Platform,
  Track,
} from '../types';
import { coverCandidates } from './coverService';
import { recordingMatch, titleKeys } from './recordingMatch';
import { SOURCE_ORDER } from './searchGroup';

export interface AccountRightsSnapshot {
  loggedIn?: boolean;
  isVip?: boolean;
  isSvip?: boolean;
}

export type AccountRightsMap = Partial<Record<Platform, AccountRightsSnapshot>>;

export interface MergeSourceInput {
  source: MergeSourceRef;
  tracks: Track[];
}

export interface MergeResult {
  tracks: Track[];
  covers: string[];
  stats: MergedPlaylistStats;
}

const DIRECT_PLAYABLE = new Set<Platform>(['netease', 'qq', 'kugou', 'kuwo', 'bodian']);
const MAX_ALT_SOURCES = 6;
const ALT_EXTRA_KEYS = [
  'mediaMid',
  'albumId',
  'resHash',
  'sqHash',
  'hqHash',
  'durationSec',
  'freeSign',
  'isrc',
  'catalogId',
  'storefront',
] as const;

function pickAltExtra(raw?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const picked: Record<string, unknown> = {};
  let hasAny = false;
  for (const key of ALT_EXTRA_KEYS) {
    const val = raw[key];
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      picked[key] = val;
      hasAny = true;
    }
  }
  return hasAny ? picked : undefined;
}

/**
 * 计算音源作为主条目时的优先级分值：
 * 直接可播五平台 SVIP/VIP > 已登录直连 > 汽水（车机）> 未登录直连 > 仅元数据来源（spotify/ytmusic/applemusic）。
 */
export function sourcePriorityScore(platform: Platform, accounts: AccountRightsMap = {}): number {
  const acc = accounts[platform];
  const orderIndex = SOURCE_ORDER.indexOf(platform);
  const orderTieBreaker = orderIndex >= 0 ? SOURCE_ORDER.length - orderIndex : 0;

  let tier = 20;
  if (DIRECT_PLAYABLE.has(platform)) {
    if (acc?.loggedIn) {
      tier = acc.isSvip ? 400 : acc.isVip ? 300 : 200;
    } else {
      tier = 100;
    }
  } else if (platform === 'qishui') {
    tier = acc?.loggedIn ? 150 : 80;
  } else if (acc?.loggedIn) {
    tier = 50;
  }

  return tier * 16 + orderTieBreaker;
}

function toAltSource(track: Track): AltSource {
  const extra = pickAltExtra(track.extra);
  return {
    platform: track.platform,
    sourceId: track.sourceId,
    ...(track.album ? { album: track.album } : {}),
    ...(track.extra?.albumId != null ? { albumId: String(track.extra.albumId) } : {}),
    ...(track.duration > 0 ? { duration: track.duration } : {}),
    ...(extra ? { extra } : {}),
  };
}

function sortAltSources(list: AltSource[], accounts: AccountRightsMap): AltSource[] {
  return [...list].sort(
    (a, b) => sourcePriorityScore(b.platform, accounts) - sourcePriorityScore(a.platform, accounts),
  );
}

function withResolvedCoverInfo(track: Track): Track {
  if (track.coverInfo) return track;
  if (!track.cover) return track;
  return {
    ...track,
    coverInfo: { url: coverCandidates(track)[0] || track.cover, verified: false },
  };
}

function collectAltSources(track: Track): AltSource[] {
  const result: AltSource[] = [];
  if (Array.isArray(track.altSources)) {
    for (const alt of track.altSources) {
      if (!alt?.platform || !alt?.sourceId) continue;
      const clean: AltSource = {
        platform: alt.platform,
        sourceId: alt.sourceId,
        ...(alt.album ? { album: alt.album } : {}),
        ...(alt.albumId ? { albumId: alt.albumId } : {}),
        ...(typeof alt.duration === 'number' && alt.duration > 0 ? { duration: alt.duration } : {}),
      };
      const extra = pickAltExtra(alt.extra);
      if (extra) clean.extra = extra;
      result.push(clean);
    }
  }
  return result;
}

export function collectCollageCovers(
  tracks: ReadonlyArray<Pick<Track, 'cover' | 'coverInfo'>>,
  sources: ReadonlyArray<MergeSourceRef> = [],
  limit = 4,
): string[] {
  const picked: string[] = [];
  const seen = new Set<string>();
  const addUrl = (raw?: string) => {
    const url = String(raw || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    picked.push(url);
  };
  for (const t of tracks) {
    addUrl(t.coverInfo?.url || t.cover);
    if (picked.length >= limit) return picked;
  }
  for (const s of sources) {
    addUrl(s.cover);
    if (picked.length >= limit) return picked;
  }
  return picked;
}

const PLATFORM_SHORT_NAME: Record<Platform, string> = {
  netease: '网易云',
  qq: 'QQ',
  kugou: '酷狗',
  kuwo: '酷我',
  bodian: '波点',
  qishui: '汽水',
  spotify: 'Spotify',
  ytmusic: 'YouTube Music',
  applemusic: 'Apple Music',
};

interface Slot {
  primary: Track;
  alts: AltSource[];
  originSourceIdx: number;
}

/**
 * 按勾选顺序稳定拼接多个歌单，并用 `titleKeys` 分桶 + `recordingMatch` 做 $O(N)$ 同录音去重。
 * 当同一录音在后续歌单出现更高优先级的音源时，在原位置升级 `primary` 并把旧来源记入 `altSources`。
 */
export function mergeTrackLists(
  inputs: MergeSourceInput[],
  accounts: AccountRightsMap = {},
): MergeResult {
  const slots: Slot[] = [];
  const keyBuckets = new Map<string, number[]>();
  const idIndex = new Map<string, number>();
  const pairOverlaps = new Map<string, number>();

  let rawTotal = 0;
  let exactIdDupes = 0;
  let crossMatchDupes = 0;

  const indexKeys = (track: Track, slotIdx: number) => {
    for (const k of titleKeys(track)) {
      let bucket = keyBuckets.get(k);
      if (!bucket) {
        bucket = [];
        keyBuckets.set(k, bucket);
      }
      if (!bucket.includes(slotIdx)) bucket.push(slotIdx);
    }
  };

  const addAltToSlot = (slot: Slot, alt: AltSource) => {
    if (!alt.sourceId) return;
    if (alt.platform === slot.primary.platform && alt.sourceId === slot.primary.sourceId) return;
    if (slot.alts.some((x) => x.platform === alt.platform && x.sourceId === alt.sourceId)) return;
    slot.alts.push(alt);
  };

  const bumpPair = (srcA: number, srcB: number) => {
    if (srcA === srcB) return;
    const lo = Math.min(srcA, srcB);
    const hi = Math.max(srcA, srcB);
    const key = `${lo}:${hi}`;
    pairOverlaps.set(key, (pairOverlaps.get(key) ?? 0) + 1);
  };

  inputs.forEach((entry, srcIdx) => {
    for (const rawTrack of entry.tracks) {
      if (!rawTrack || !rawTrack.title) continue;
      rawTotal++;
      const candidate = withResolvedCoverInfo(rawTrack);
      const idKey = candidate.sourceId ? `${candidate.platform}:${candidate.sourceId}` : '';

      if (idKey && idIndex.has(idKey)) {
        const slotIdx = idIndex.get(idKey)!;
        exactIdDupes++;
        bumpPair(slots[slotIdx]!.originSourceIdx, srcIdx);
        continue;
      }

      const candidateKeys = titleKeys(candidate);
      const tested = new Set<number>();
      let matchedSlotIdx = -1;

      for (const k of candidateKeys) {
        const bucket = keyBuckets.get(k);
        if (!bucket) continue;
        for (const slotIdx of bucket) {
          if (tested.has(slotIdx)) continue;
          tested.add(slotIdx);
          if (recordingMatch(slots[slotIdx]!.primary, candidate).ok) {
            matchedSlotIdx = slotIdx;
            break;
          }
        }
        if (matchedSlotIdx >= 0) break;
      }

      if (matchedSlotIdx >= 0) {
        const slot = slots[matchedSlotIdx]!;
        crossMatchDupes++;
        bumpPair(slot.originSourceIdx, srcIdx);

        const candScore = sourcePriorityScore(candidate.platform, accounts);
        const currScore = sourcePriorityScore(slot.primary.platform, accounts);

        if (candScore > currScore) {
          const oldPrimary = slot.primary;
          // Preserve cover / album metadata when the higher-priority source lacks one.
          const mergedPrimary: Track = {
            ...candidate,
            cover: candidate.cover || oldPrimary.cover,
            coverInfo: candidate.coverInfo || oldPrimary.coverInfo,
            album: candidate.album || oldPrimary.album,
            altSources: undefined,
          };
          // 先切换 slot.primary，再把被降级的旧主源放入 alts，否则 addAltToSlot 会误判与当前主源相同而跳过。
          slot.primary = mergedPrimary;
          slot.alts = slot.alts.filter(
            (x) => !(x.platform === mergedPrimary.platform && x.sourceId === mergedPrimary.sourceId),
          );
          addAltToSlot(slot, toAltSource(oldPrimary));
          for (const extraAlt of collectAltSources(candidate)) {
            addAltToSlot(slot, extraAlt);
          }
          if (idKey) idIndex.set(idKey, matchedSlotIdx);
          indexKeys(mergedPrimary, matchedSlotIdx);
        } else {
          addAltToSlot(slot, toAltSource(candidate));
          for (const extraAlt of collectAltSources(candidate)) {
            addAltToSlot(slot, extraAlt);
          }
          if (idKey && !idIndex.has(idKey)) idIndex.set(idKey, matchedSlotIdx);
        }
      } else {
        const slotIdx = slots.length;
        const cleanPrimary: Track = { ...candidate };
        delete cleanPrimary.altSources;
        const slot: Slot = {
          primary: cleanPrimary,
          alts: [],
          originSourceIdx: srcIdx,
        };
        for (const extraAlt of collectAltSources(candidate)) {
          addAltToSlot(slot, extraAlt);
        }
        slots.push(slot);
        if (idKey) idIndex.set(idKey, slotIdx);
        indexKeys(cleanPrimary, slotIdx);
      }
    }
  });

  const tracks = slots.map((slot): Track => {
    const sortedAlts = sortAltSources(slot.alts, accounts).slice(0, MAX_ALT_SOURCES);
    return sortedAlts.length ? { ...slot.primary, altSources: sortedAlts } : slot.primary;
  });

  const dedupCount = exactIdDupes + crossMatchDupes;
  let overlapPairSummary: string | undefined;
  if (dedupCount > 0 && pairOverlaps.size > 0) {
    let topKey = '';
    let topCount = 0;
    for (const [k, count] of pairOverlaps) {
      if (count > topCount) {
        topCount = count;
        topKey = k;
      }
    }
    if (topKey && topCount > 0) {
      const [iStr, jStr] = topKey.split(':');
      const a = inputs[Number(iStr)]?.source;
      const b = inputs[Number(jStr)]?.source;
      if (a && b) {
        const labelA = `${PLATFORM_SHORT_NAME[a.platform] ?? a.platform}「${a.name}」`;
        const labelB = `${PLATFORM_SHORT_NAME[b.platform] ?? b.platform}「${b.name}」`;
        overlapPairSummary =
          inputs.length === 2
            ? `${labelA}与${labelB}有 ${topCount} 首重合`
            : `共去重 ${dedupCount} 首，其中${labelA}与${labelB}重合 ${topCount} 首`;
      }
    }
  }

  return {
    tracks,
    covers: collectCollageCovers(tracks, inputs.map((i) => i.source)),
    stats: {
      rawTotal,
      dedupCount,
      exactIdDupes,
      crossMatchDupes,
      ...(overlapPairSummary ? { overlapPairSummary } : {}),
    },
  };
}
