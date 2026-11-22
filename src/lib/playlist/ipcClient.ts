import type { Track } from '../catalog';

/** 与 src/main/types.ts 对齐的桌面端数据结构（渲染进程侧只读映射）。 */
export interface DesktopCoverInfo {url:string;width?:number;height?:number;verified:boolean}

export interface DesktopTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  coverInfo?: DesktopCoverInfo;
  duration: number;
  platform: string;
  sourceId: string;
  originalUrl: string;
  fallbackUrl: string;
  quality?: string;
  artists?: string[];
  extra?: Record<string, unknown>;
}

export interface PlaybackMetadata {
  coverInfo?: DesktopCoverInfo;
  artists?: string[];
  extra?: Record<string, unknown>;
  resolvedAt?: number;
  expiresAt?: number;
}

export interface DesktopResolveResult {
  url: string;
  fallback: boolean;
  platform: string;
  sourceId: string;
  trial?: boolean;
  trialEndTime?: number;
  quality?: string;
  playable?: boolean;
  error?: string;
  code?: string;
  resolvedAt?: number;
  expiresAt?: number;
}

export interface DesktopQualityOption {
  level: string;
  label: string;
  needsVip?: boolean;
  needsSvip?: boolean;
}

export interface DesktopPlaylistResult {
  platformName: string;
  name: string;
  cover: string;
  tracks: DesktopTrack[];
}

export interface DesktopPlaylistSummary {
  id: string;
  name: string;
  cover: string;
  trackCount: number;
}

export interface DesktopLoginPlatform {
  platform: string;
  name: string;
  kind: 'qr' | 'oauth' | 'window' | 'device' | 'unavailable';
  unavailableReason: string | null;
}

export interface DesktopAccountInfo {
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

export interface DesktopWallpaperItem {
  id: string;
  title: string;
  projectType: string;
  mediaType: 'video' | 'image' | '';
  playable: boolean;
  enginePlayable: boolean;
  previewOnly: boolean;
  hasPreview: boolean;
  source: string;
  previewUrl: string;
  mediaUrl: string;
}

export type DesktopWallpaperSetResult =
  | { url: string; type: 'video' | 'image' }
  | { unsupported: true; reason: string };

export interface DesktopArtistRef {
  id: string;
  name: string;
}

export interface DesktopSongDetail {
  platform: string;
  title: string;
  artists: DesktopArtistRef[];
  album: { id: string; name: string; cover: string; publishDate?: string };
  duration?: number;
  credits?: Array<{ role: string; name: string }>;
  /** 详情实际来源；fallback=true 表示本平台取不到，用的是同一录音在该平台的详情。 */
  source?: DesktopContentSource;
  /** 制作团队单独从其他平台补来时的平台。 */
  creditsFrom?: string;
}

export interface DesktopContentSource {
  platform: string;
  sourceId: string;
  fallback: boolean;
}

export interface DesktopArtistInfo {
  platform: string;
  id: string;
  name: string;
  avatar: string;
  description?: string;
}

export interface DesktopAlbumSummary {
  platform: string;
  id: string;
  name: string;
  cover: string;
  artist?: string;
  year?: number;
  songCount?: number;
}

/** 专辑详情（歌手页专辑点击进入）。 */
export interface DesktopAlbumDetail {
  platform: string;
  id: string;
  name: string;
  cover: string;
  year?: number;
  artist?: string;
  tracks: DesktopTrack[];
  /** 详情实际来自哪个平台（本平台取不到时按专辑名 + 歌手转到别家）。 */
  source?: { platform: string; sourceId: string; fallback: boolean };
}

/** 全网歌手搜索命中（含平台定位，可直接打开歌手页）。 */
export interface DesktopArtistHit {
  platform: string;
  id: string;
  name: string;
  avatar?: string;
}

export interface DesktopCommentItem {
  nickname: string;
  avatarUrl: string;
  content: string;
  likedCount: number;
}

export interface DesktopCommentResult {
  hot: DesktopCommentItem[];
  latest: DesktopCommentItem[];
  latestTotal?: number;
  hasMoreLatest?: boolean;
  /** 评论实际来源；fallback=true 表示本平台没有，取的是同一录音在该平台的评论。 */
  source?: DesktopContentSource;
}

/** 手动选定的歌词来源（AMLL 的 sourceId 是 `matchedBy:id`）。 */
export interface DesktopLyricPick {
  platform: string;
  sourceId: string;
}
/** 「歌词版本」列表里的一份（后端 listLyricVersions）。 */
export interface DesktopLyricVersion extends DesktopLyricPick {
  coverage: { textLines: number; wordLines: number; translatedLines: number; romanLines: number; bgLines: number; agentLines: number };
  /** 时长和当前这首差几秒；按 id 确认同一录音的、没有时长的为 null。 */
  durationDiffSec: number | null;
}
export interface DesktopLyricVersions {
  pick: DesktopLyricPick | null;
  offsetMs: number;
  versions: DesktopLyricVersion[];
}

type IpcResult<T> = Promise<{ ok: true; data: T } | { ok: false; error: string }>;

/** 主进程要求显示的内嵌页面弹窗。 */
export interface DesktopSheetOpen {
  id: number;
  platform: string;
  title: string;
  /** 页头一句话说明；缺省按平台取登录说明。 */
  hint?: string;
  /** 页面画出来之前的占位文字。 */
  placeholder?: string;
}

/** 弹窗正文区位置（CSS 像素 = DIP，相对窗口内容区左上角）。 */
export interface DesktopSheetBounds {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopApi {
  importPlaylist: (url: string) => IpcResult<DesktopPlaylistResult>;
  resolveSong: (track: DesktopTrack, quality?: string, options?: { requestId?: string; forceRefresh?: boolean }) => IpcResult<DesktopResolveResult | null>;
  cancelResolve?: (requestId: string) => IpcResult<boolean>;
  songQualities: (track: DesktopTrack) => IpcResult<DesktopQualityOption[]>;
  fallbackSong: (track: DesktopTrack) => IpcResult<DesktopTrack | null>;
  /** origin：兜底播放时用户点的原曲，只给 AMLL / Apple 歌词来源提供查询 id（缓存键和身份仍按 track）。 */
  fetchLyric: (track: DesktopTrack, options?: {requestId?:string; origin?: DesktopTrack}) => IpcResult<unknown>;
  /** 歌词版本列表（手动换歌词）：requestId 可取消；origin 同 fetchLyric。 */
  lyricVersions: (track: DesktopTrack, options?: {requestId?:string; origin?: DesktopTrack}) => IpcResult<DesktopLyricVersions>;
  /** 手动换歌词：pick = null 恢复自动合并；offsetMs 缺省 = 保持原来的微调（范围 ±5000，0.1 秒一档）。 */
  chooseLyric: (track: DesktopTrack, choice: {pick: DesktopLyricPick | null; offsetMs?: number}) => IpcResult<boolean>;
  coverInfo?: (track:DesktopTrack) => IpcResult<DesktopCoverInfo|null>;
  fetchComments: (track: DesktopTrack, page?: number) => IpcResult<DesktopCommentResult | null>;
  songDetail: (track: DesktopTrack, opts?: { withCredits?: boolean }) => IpcResult<DesktopSongDetail | null>;
  artistInfo: (platform: string, artistId: string) => IpcResult<DesktopArtistInfo | null>;
  artistSongs: (platform: string, artistId: string) => IpcResult<DesktopTrack[]>;
  artistSongsAll: (platform: string, artistId: string) => IpcResult<DesktopTrack[]>;
  artistAlbums: (platform: string, artistId: string) => IpcResult<DesktopAlbumSummary[]>;
  albumDetail: (platform: string, albumId: string, hint?: { name?: string; artist?: string }) => IpcResult<DesktopAlbumDetail | null>;
  searchSongs: (keyword: string, pageSize?: number) => IpcResult<DesktopTrack[]>;
  searchArtists: (keyword: string, pageSize?: number) => IpcResult<DesktopArtistHit[]>;
  resolveArtistByName: (name: string) => IpcResult<DesktopArtistHit | null>;
  resolveAlbumByTitle: (title: string, artist?: string) => IpcResult<DesktopAlbumSummary | null>;
  loginQr: () => IpcResult<{ unikey: string; payload: string }>;
  loginPoll: (unikey: string) => IpcResult<{ ok: boolean; message: string }>;
  loginPlatforms: () => IpcResult<DesktopLoginPlatform[]>;
  loginQrFor: (platform: string) => IpcResult<{ unikey: string; payload: string; imageDataUrl?: string; userCode?: string; verificationUrl?: string; expiresIn?: number; interval?: number }>;
  loginPollFor: (platform: string, unikey: string) => IpcResult<{ ok: boolean; message: string; final?: boolean }>;
  loginAccount: (platform: string) => IpcResult<DesktopAccountInfo | null>;
  loginPlaylists: (platform: string) => IpcResult<DesktopPlaylistSummary[]>;
  importPlaylistId: (platform: string, id: string) => IpcResult<DesktopPlaylistResult>;
  spotifyLoginStart: () => IpcResult<boolean>;
  spotifyLoginStatus: () => IpcResult<boolean>;
  qqLoginWindow: () => IpcResult<{ ok: boolean; message?: string; error?: string }>;
  kugouLoginWindow: () => IpcResult<{ ok: boolean; message?: string; error?: string }>;
  kuwoLoginWindow: () => IpcResult<{ ok: boolean; message?: string; error?: string }>;
  applemusicLoginWindow: () => IpcResult<{ ok: boolean; message?: string; error?: string }>;
  /** 汽水车机协议的抖音扫码授权（#212）：授权后汽水的歌能在汽水本平台出声（只有标准音质）。和汽水登录互相独立。 */
  qishuiCarLoginQr?: () => IpcResult<{ unikey: string; payload: string; imageDataUrl?: string; expiresIn?: number }>;
  qishuiCarLoginPoll?: (unikey: string) => IpcResult<{ ok: boolean; message: string; final?: boolean; state?: string }>;
  qishuiCarLoginStatus?: () => IpcResult<{ state: 'authorized' | 'unauthorized' | 'expired'; nickname?: string; isVip?: boolean; expiresAt?: number }>;
  qishuiCarLogout?: () => IpcResult<boolean>;
  openLocalDirectory: () => IpcResult<{ tracks: DesktopTrack[]; canceled?: boolean }>;
  openExternal: (url: string) => IpcResult<boolean>;
  wallpaperList: () => IpcResult<DesktopWallpaperItem[]>;
  wallpaperInfo: () => IpcResult<{ weInstalled: boolean; weLaunchUrl: string }>;
  wallpaperSet: (id: string) => IpcResult<DesktopWallpaperSetResult>;
  /** 内嵌页面弹窗（登录页 / 验证页）：主进程请求渲染进程画外壳，渲染进程回报正文区位置、用户关闭。 */
  onSheetOpen: (cb: (sheet: DesktopSheetOpen) => void) => () => void;
  onSheetClosed: (cb: (sheet: { id: number }) => void) => () => void;
  sheetBounds: (payload: DesktopSheetBounds) => void;
  sheetClose: (id: number) => void;
  setCookie: (platform: string, cookie: string, token?: string, nickname?: string) => IpcResult<boolean>;
  getCookie: (platform: string) => IpcResult<unknown>;
  clearCookie: (platform: string) => IpcResult<boolean>;
}

declare global {
  interface Window {
    nebulaAPI?: DesktopApi;
  }
}

export function hasDesktopAPI(): boolean {
  return typeof window !== 'undefined' && !!window.nebulaAPI?.importPlaylist;
}

function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** 后端标准 Track → 前端 Track（保留平台 sourceId 供后续取流/歌词/评论）。 */
export function toFrontendTrack(
  t: DesktopTrack,
  index: number,
  extra?: { trial?: boolean; trialEndTime?: number; quality?: string; via?: Track['via']; resolvedAt?: number; expiresAt?: number },
): Track & PlaybackMetadata {
  const hue = hueFromId(t.id);
  return {
    id: index,
    title: t.title,
    artist: t.artist,
    style: t.platform,
    hue1: hue,
    hue2: (hue + 80) % 360,
    // 旧会话留下的随机代理端口不能跨进程恢复；实时解析时 extra 明确标识本次结果。
    audio: !extra && t.platform !== 'local' && /^http:\/\/127\.0\.0\.1:\d+\/api\/audio/.test(t.originalUrl)
      ? '' : t.originalUrl || t.fallbackUrl || '',
    source: t.platform,
    sourceId: t.sourceId,
    album: t.album,
    cover: t.cover,
    coverInfo: t.coverInfo,
    duration: t.duration,
    trial: extra?.trial,
    trialEndTime: extra?.trialEndTime,
    quality: extra?.quality ?? t.quality,
    via: extra?.via,
    artists: t.artists,
    extra: t.extra,
    resolvedAt: extra?.resolvedAt,
    expiresAt: extra?.expiresAt,
  };
}

/** 解析结果里的兜底平台（主平台直取时为空）。 */
export function viaOf(r: DesktopResolveResult): Track['via'] {
  return r.fallback && r.platform && r.sourceId ? { platform: r.platform, sourceId: r.sourceId } : undefined;
}

/** 实际供流平台上的这首歌（音质列表 / 音质切换用）：有兜底平台时换成兜底平台的身份，不带旧地址。 */
export function streamTrack(t: Track): DesktopTrack {
  const b = toBackendTrack(t);
  if (!t.via) return { ...b, originalUrl: '' };
  return { ...b, id: `${t.via.platform}:${t.via.sourceId}`, platform: t.via.platform, sourceId: t.via.sourceId, originalUrl: '', extra: undefined };
}

/** 前端 Track → 后端标准 Track（IPC 用）。 */
export function toBackendTrack(t: Track): DesktopTrack {
  return {
    id: `${t.source}:${t.sourceId ?? t.id}`,
    title: t.title,
    artist: t.artist,
    album: t.album ?? '',
    cover: t.cover ?? '',
    duration: t.duration ?? 0,
    platform: t.source,
    sourceId: t.sourceId ?? String(t.id),
    // 远程音源只在内存使用：IPC 重取与会话记忆均不携带过期直链/随机代理端口。
    originalUrl: t.source === 'local' || t.source === 'demo' ? t.audio : '',
    fallbackUrl: '',
    coverInfo: (t as Track & PlaybackMetadata).coverInfo,
    artists: (t as Track & PlaybackMetadata).artists,
    extra: (t as Track & PlaybackMetadata).extra,
  };
}
