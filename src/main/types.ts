/** Unified data model shared by every platform adapter. */

export type Platform = 'netease' | 'qq' | 'kugou' | 'spotify' | 'qishui' | 'kuwo' | 'bodian' | 'ytmusic' | 'applemusic';

export interface CoverInfo { url:string; width?:number; height?:number; verified:boolean }

export interface Track {
  /** Unified id (`${platform}:${sourceId}`, stable across platforms). */
  id: string;
  title: string;
  artist: string;
  artists?: string[];
  album: string;
  /** https cover URL (empty when none). */
  cover: string;
  coverInfo?: CoverInfo;
  /** Duration in seconds. */
  duration: number;
  platform: Platform;
  /** Platform-native song id (netease song id / QQ songmid / kugou hash). */
  sourceId: string;
  /** Primary platform direct URL (may be empty; filled by SongResolver). */
  originalUrl: string;
  /** Downgraded backup direct URL (kugou etc. fallback platform). */
  fallbackUrl: string;
  quality?: string;
  /** Platform-specific extra fields (e.g. kugou AlbumID). */
  extra?: Record<string, unknown>;
}

export interface LyricLine {
  timeMs: number;
  text: string;
  /** Translation bound to the same timeline. */
  translation?: string;
  /** 对唱时这一句是谁唱（只有一位歌手的歌不标）：v1 第一位、v2 其余、both 合唱。 */
  agent?: 'v1' | 'v2' | 'both';
  /** 这一句的和声（背景人声）；词时间是绝对毫秒，没有逐字时只有 text。 */
  bg?: { text: string; words?: Array<{ text: string; startMs: number; duration: number }> };
}

export interface Lyric {
  lines: LyricLine[];
  raw: string;
  translationRaw?: string;
  /** Romanized lyric (netease lyric romalrc). */
  romanRaw?: string;
  /** Source platform, e.g. netease / qq / kugou. */
  source?: string;
  /** Raw LRC text matching the primary source (for frontend). */
  lrc?: string;
  tlyric?: string;
  romalrc?: string;
  /** 本地转写补上的罗马音行数（韩语，平台没给的行）。 */
  romanGenerated?: number;
  /** Raw word-level lyric (netease YRC). */
  yrc?: string;
  /** Netease word-level translation (ytlrc). */
  ytlrc?: string;
  /** QQ raw QRC (word-level); frontend maps it into `yrc` when yrc is absent. */
  qrc?: string;
  krc?: string;
  /** 实际取歌词的身份及跨源增强证据；UI 可用于来源探针。 */
  identity?: { platform: string; sourceId: string };
  provenance?: Array<{ platform:string; sourceId:string; kind:'primary'|'fallback'|'enrichment'|'manual'; offsetMs?:number; anchors?:number; gain?:Array<'words'|'translation'|'roman'|'bg'> }>;
  /** 用户设了时间微调（毫秒，正数 = 推后）时，输出的歌词已经整体平移过；没设不带这个字段。 */
  lyricOffsetMs?: number;
  coverage?: { wordLines:number; textLines:number; translatedLines:number; romanLines?:number; bgLines?:number; agentLines?:number };
  incomplete?: boolean;
}

export interface CommentItem {
  id: string;
  nickname: string;
  avatarUrl: string;
  content: string;
  likedCount: number;
}

export interface CommentResult {
  hot: CommentItem[];
  latest: CommentItem[];
  /** 最新评论总数（平台返回时；用于前端显示）。 */
  latestTotal?: number;
  /** 是否还有更多最新评论可分页加载。 */
  hasMoreLatest?: boolean;
  /** 评论实际来自哪个平台；fallback=true 表示本平台没有，取的是同一录音在该平台的评论。 */
  source?: ContentSource;
}

/** 内容页（评论、详情）的实际来源。 */
export interface ContentSource {
  platform: Platform;
  sourceId: string;
  fallback: boolean;
}

export interface Playlist {
  id: string;
  platform: Platform;
  name: string;
  cover: string;
  description?: string;
  tracks: Track[];
}

export interface SongUrl {
  url: string;
  quality?: string;
  level?: string;
  /** Whether this is a trial segment (freeTrialInfo). */
  trial?: boolean;
  /** Trial segment end time (ms, freeTrialInfo.endTime). */
  trialEndTime?: number;
  playable?: boolean;
  /** Explicit fetch failure reason (never a silent empty url). */
  error?: string;
  code?: string;
  expiresAt?: number;
}

export interface ResolveResult {
  url: string;
  /** true when the source came from a fallback platform (kugou etc.). */
  fallback: boolean;
  platform: Platform;
  sourceId: string;
  trial?: boolean;
  trialEndTime?: number;
  quality?: string;
  playable?: boolean;
  error?: string;
  code?: 'NO_SOURCE' | 'TIMEOUT' | 'CANCELLED' | 'TRIAL_ONLY' | 'AUTH_EXPIRED';
  resolvedAt?: number;
  expiresAt?: number;
  traceId?: string;
  timings?: Array<{ stage: string; platform: string; ms: number; outcome: string }>;
}

/** Quality option surfaced to the frontend quality picker. */
export interface QualityOption {
  level: string;
  label: string;
  needsVip?: boolean;
  needsSvip?: boolean;
}

/** Unified platform adapter interface. */
export interface PlatformAdapter {
  platform: Platform;
  /** 已核验的会话状态；不发网络请求，用于阻止失效账号复用解析缓存。 */
  getAuthStatus?(): 'missing' | 'valid' | 'expired' | 'unknown';
  fetchPlaylist(playlistId: string): Promise<Playlist>;
  /** 歌单没有封面时用来补的图（第一首歌的封面）；只取一首，比整份 fetchPlaylist 省。没实现的平台由 IPC 退回 fetchPlaylist。 */
  fetchPlaylistFirstCover?(playlistId: string): Promise<string>;
  fetchSongUrl(songId: string, albumId?: string, quality?: string, extra?: Record<string, unknown>): Promise<SongUrl | null>;
  fetchLyric(songId: string, timeMs?: number): Promise<Lyric | null>;
  fetchComments?(songId: string, page?: number): Promise<CommentResult | null>;
  fetchSongDetail?(songId: string): Promise<SongDetail | null>;
  fetchArtistInfo?(artistId: string): Promise<ArtistInfo | null>;
  fetchArtistSongs?(artistId: string): Promise<Track[]>;
  fetchArtistAlbums?(artistId: string): Promise<AlbumSummary[]>;
  /** 专辑详情（netease/spotify/qq 实现；kugou/qishui 未接入返回 null）。 */
  fetchAlbumDetail?(albumId: string): Promise<AlbumDetail | null>;
  /** Only fallback platforms (kugou) implement: keyword search. */
  searchSongs?(keyword: string, pageSize?: number): Promise<Track[]>;
  /** 关键词搜歌手（netease/qq），返回带平台定位的命中。 */
  searchArtists?(keyword: string, pageSize?: number): Promise<ArtistSearchHit[]>;
  /** 关键词搜专辑（netease），返回专辑摘要（供跨平台专辑转译路由）。 */
  searchAlbums?(keyword: string, pageSize?: number): Promise<AlbumSummary[]>;
  /** 歌手全部歌曲（分页拉全，供歌手页「查看全部歌曲」）。 */
  fetchArtistAllSongs?(artistId: string): Promise<Track[]>;
  /** Quality options available for the current account (netease/qq). */
  listQualities?(songId?: string): Promise<QualityOption[]>;
}

/** User playlist summary (shown after login). */
export interface PlaylistSummary {
  id: string;
  name: string;
  cover: string;
  trackCount: number;
}

export interface AccountInfo {
  /** Login probe result: false means cookie invalid / not logged in. */
  loggedIn: boolean;
  authStatus?: 'missing' | 'valid' | 'expired' | 'unknown';
  error?: string;
  userId?: string;
  nickname?: string;
  avatarUrl?: string;
  vipType?: number;
  isVip?: boolean;
  isSvip?: boolean;
}

export interface ArtistRef {
  id: string;
  name: string;
}

/** 全网歌手搜索命中：含平台定位，可直接打开歌手页。 */
export interface ArtistSearchHit {
  platform: Platform;
  id: string;
  name: string;
  avatar?: string;
}

export interface SongDetail {
  platform: Platform;
  title: string;
  artists: ArtistRef[];
  album: { id: string; name: string; cover: string; publishDate?: string };
  duration?: number;
  /** 制作团队（作词/作曲/编曲/制作人等，取自 LRC 元数据）。 */
  credits?: Array<{ role: string; name: string }>;
  /** 详情实际来自哪个平台（本平台取不到时为同一录音在其他平台的详情）。 */
  source?: ContentSource;
  /** 制作团队单独从其他平台补来时的来源平台。 */
  creditsFrom?: Platform;
}

export interface ArtistInfo {
  platform: Platform;
  id: string;
  name: string;
  avatar: string;
  description?: string;
}

  export interface AlbumSummary {
    platform: Platform;
    id: string;
    name: string;
    cover: string;
    /** 专辑歌手名（用于跨平台专辑转译的歌手校验）。 */
    artist?: string;
    year?: number;
    songCount?: number;
  }

/** 专辑详情（供歌手页专辑点击进入）。 */
export interface AlbumDetail {
  platform: Platform;
  id: string;
  name: string;
  cover: string;
  year?: number;
  artist?: string;
  /** 专辑内歌曲（点播走既有取链/兜底链路）。 */
  tracks: Track[];
}
