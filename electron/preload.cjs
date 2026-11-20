const { contextBridge, ipcRenderer } = require('electron');

/** 渲染进程唯一入口：所有能力经 IPC 走主进程，Node 能力不暴露给页面。 */
contextBridge.exposeInMainWorld('nebulaAPI', {
  importPlaylist: (url) => ipcRenderer.invoke('nebula:import-playlist', { url }),
  resolveSong: (track, quality, options) => ipcRenderer.invoke('nebula:resolve-song', { track, quality, ...options }),
  cancelResolve: (requestId) => ipcRenderer.invoke('nebula:cancel-resolve', { requestId }),
  songQualities: (track) => ipcRenderer.invoke('nebula:song-qualities', { track }),
  fallbackSong: (track) => ipcRenderer.invoke('nebula:fallback-song', { track }),
  fetchLyric: (track, options) => ipcRenderer.invoke('nebula:lyric', { track, ...options }),
  lyricVersions: (track, options) => ipcRenderer.invoke('nebula:lyric-versions', { track, ...options }),
  chooseLyric: (track, choice) => ipcRenderer.invoke('nebula:lyric-choose', { track, ...choice }),
  fetchComments: (track, page) => ipcRenderer.invoke('nebula:comments', { track, page }),
  coverInfo: (track) => ipcRenderer.invoke('nebula:cover-info', { track }),
  songDetail: (track, opts) => ipcRenderer.invoke('nebula:song-detail', { track, withCredits: !!opts?.withCredits }),
  artistInfo: (platform, artistId) => ipcRenderer.invoke('nebula:artist-info', { platform, artistId }),
  artistSongs: (platform, artistId) => ipcRenderer.invoke('nebula:artist-songs', { platform, artistId }),
  artistSongsAll: (platform, artistId) => ipcRenderer.invoke('nebula:artist-songs-all', { platform, artistId }),
  artistAlbums: (platform, artistId) => ipcRenderer.invoke('nebula:artist-albums', { platform, artistId }),
  albumDetail: (platform, albumId) => ipcRenderer.invoke('nebula:album-detail', { platform, albumId }),
  searchSongs: (keyword, pageSize) => ipcRenderer.invoke('nebula:search-songs', { keyword, pageSize }),
  searchArtists: (keyword, pageSize) => ipcRenderer.invoke('nebula:search-artists', { keyword, pageSize }),
  resolveArtistByName: (name) => ipcRenderer.invoke('nebula:resolve-artist-by-name', { name }),
  resolveAlbumByTitle: (title, artist) => ipcRenderer.invoke('nebula:resolve-album-by-title', { title, artist }),
  loginQr: () => ipcRenderer.invoke('nebula:login:qr'),
  loginPoll: (unikey) => ipcRenderer.invoke('nebula:login:poll', { unikey }),
  loginPlatforms: () => ipcRenderer.invoke('nebula:login:platforms'),
  loginQrFor: (platform) => ipcRenderer.invoke('nebula:login:qr-platform', { platform }),
  loginPollFor: (platform, unikey) => ipcRenderer.invoke('nebula:login:poll-platform', { platform, unikey }),
  loginAccount: (platform) => ipcRenderer.invoke('nebula:login:account', { platform }),
  loginPlaylists: (platform) => ipcRenderer.invoke('nebula:login:playlists', { platform }),
  importPlaylistId: (platform, id) => ipcRenderer.invoke('nebula:import-playlist-id', { platform, id }),
  spotifyLoginStart: () => ipcRenderer.invoke('nebula:login:spotify:start'),
  spotifyLoginStatus: () => ipcRenderer.invoke('nebula:login:spotify:status'),
  qqLoginWindow: () => ipcRenderer.invoke('nebula:login:qq:window'),
  kugouLoginWindow: () => ipcRenderer.invoke('nebula:login:kugou:window'),
  kuwoLoginWindow: () => ipcRenderer.invoke('nebula:login:kuwo:window'),
  applemusicLoginWindow: () => ipcRenderer.invoke('nebula:login:applemusic:window'),
  qishuiCarLoginQr: () => ipcRenderer.invoke('nebula:login:qishui-car:qr'),
  qishuiCarLoginPoll: (unikey) => ipcRenderer.invoke('nebula:login:qishui-car:poll', { unikey }),
  qishuiCarLoginStatus: () => ipcRenderer.invoke('nebula:login:qishui-car:status'),
  qishuiCarLogout: () => ipcRenderer.invoke('nebula:login:qishui-car:logout'),
  openLocalDirectory: () => ipcRenderer.invoke('nebula:open-local-directory'),
  openExternal: (url) => ipcRenderer.invoke('nebula:open-external', { url }),
  wallpaperList: () => ipcRenderer.invoke('nebula:wallpaper:list'),
  wallpaperInfo: () => ipcRenderer.invoke('nebula:wallpaper:info'),
  wallpaperSet: (id) => ipcRenderer.invoke('nebula:wallpaper:set', { id }),
  onSheetOpen: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('nebula:sheet:open', listener);
    return () => ipcRenderer.removeListener('nebula:sheet:open', listener);
  },
  onSheetClosed: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('nebula:sheet:closed', listener);
    return () => ipcRenderer.removeListener('nebula:sheet:closed', listener);
  },
  sheetBounds: (payload) => ipcRenderer.send('nebula:sheet:bounds', payload),
  sheetClose: (id) => ipcRenderer.send('nebula:sheet:close', { id }),
  setCookie: (platform, cookie, token, nickname) =>
    ipcRenderer.invoke('nebula:cookie:set', { platform, cookie, token, nickname }),
  getCookie: (platform) => ipcRenderer.invoke('nebula:cookie:get', { platform }),
  clearCookie: (platform) => ipcRenderer.invoke('nebula:cookie:clear', { platform }),
});
