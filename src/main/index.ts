/** 桌面后端统一出口：Electron 主进程与 Node 冒烟测试均从这里引入。 */

export * from './types';
export * from './cookieStore';
export * from './http';
export * from './requestScope';
export * from './audioProxy';
export * from './audioProbe';
export * from './ncm/ncmApi';
export * from './encrypt/ncmCrypto';
export * from './parsers/lyricParser';
export * from './parsers/kuwoLyric';
export * from './adapters/mappers';
export * from './adapters/index';
export * from './adapters/neteaseAdapter';
export * from './adapters/qqAdapter';
export * from './adapters/kugouAdapter';
export * from './adapters/qishuiCar';
export * from './adapters/kuwoAdapter';
export * from './adapters/bodianAdapter';
export * from './adapters/spotifyAdapter';
export * from './adapters/ytmusicAdapter';
export * from './adapters/applemusicAdapter';
export * from './quality';
export * from './services/songResolver';
export * from './services/lyricService';
export * from './services/lyricCache';
export * from './services/lyricOverrides';
export * from './services/wallpaperLibrary';
export * from './services/qqRights';
export * from './services/qqSession';
export * from './services/qqRenew';
export * from './services/platformRouter';
export * from './login/index';
export { registerIpcHandlers, firstTrackCover } from './ipc';
export type { IpcLike, IpcDeps } from './ipc';

export { recordingMatch, identityText, searchKeyword } from './services/recordingMatch';

export * from './parsers/timedLyrics';

export * from './parsers/ttml';

export * from './services/amllLyrics';
export * from './services/appleMusicLyrics';
export * from './services/lyricSourceIds';

export * from './services/lyricAlignment';

export * from './services/coverService';

export { romanizeKorean, hasHangul } from './parsers/romanizeKorean';
export { kanaToRomaji, romanizeTokens, romanizeJapaneseLines } from './parsers/romanizeJapanese';

export { qishuiCoverUrl, QISHUI_TRACK_COVER } from './adapters/qishuiAdapter';
