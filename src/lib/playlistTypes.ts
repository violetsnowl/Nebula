/** 导入流程状态（docs/project/ARCHITECTURE.md：跨域共享类型，hooks/组件均从 lib 取）。 */
export type ImportStatus = 'idle' | 'parsing' | 'done' | 'warn' | 'error';

export interface MergeSourceRef {
  platform: string;
  id: string;
  name: string;
  cover?: string;
}

export interface MergedPlaylistStats {
  rawTotal: number;
  dedupCount: number;
  exactIdDupes: number;
  crossMatchDupes: number;
  overlapPairSummary?: string;
}

export interface MergedPlaylistSummary {
  id: string;
  name: string;
  covers: string[];
  sources: MergeSourceRef[];
  trackCount: number;
  dedupCount: number;
  createdAt: number;
  updatedAt: number;
}

/** 歌单身份（LibraryService 不持有；类型归 lib 供 playlists/import 领域共享）。 */
export interface PlaylistMeta {
  platform: string;
  id: string;
  name: string;
  cover: string;
  covers?: string[];
  sources?: MergeSourceRef[];
  dedupCount?: number;
}
