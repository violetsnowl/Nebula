import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconLocate } from './components/icons';
import { BackgroundLayer } from './components/BackgroundLayer';
  import { PlayerSurface } from './components/player/PlayerSurface';
  import { BottomPlayer, lapsedPlatformOf } from './components/player/BottomPlayer';
import { SearchBar } from './components/SearchBar';
import { LyricsLayer } from './components/LyricsLayer';
import { LyricPage } from './components/LyricPage';
import { StageCanvas } from './components/StageCanvas';
import { TopBar } from './components/TopBar';
import { AccountDock } from './components/AccountDock';
import { PlaylistDock } from './components/PlaylistDock';
import { LoginSheet } from './components/LoginSheet';
import { OverlayStack } from './components/OverlayStack';
import { TooltipLayer } from './components/TooltipLayer';
import { LyricSourceProbe } from './components/LyricSourceProbe';
import { SpaceLabPanel } from './components/SpaceLabPanel';
import type { StageLayout } from './lib/space/lab';
import type { SpaceWorld } from './lib/space/world';
import { audioPlayer } from './lib/audio/AudioPlayer';
import type { PanController } from './lib/panEngine';
import { SEED } from './lib/layout';
import type { BackgroundSetting } from './lib/backgrounds';
import { generateTracks, isDemoNebulaEnabled } from './lib/catalog';
import type { Track } from './lib/catalog';
import { EmptyNebula, useEmptyPhase } from './components/EmptyNebula';
import { mulberry32 } from './lib/rng';
import { hasDesktopAPI, streamTrack, toBackendTrack, type DesktopTrack } from './lib/playlist/ipcClient';
import { resolveTrackForPlay, selectQuality } from './lib/audio/desktopPlayback';
import type { DesktopWallpaperItem, DesktopWallpaperSetResult } from './lib/playlist/ipcClient';
import { preferredQuality } from './lib/preferences';
import { useAccounts } from './hooks/accounts/useAccounts';
import { useLibrary } from './hooks/library/useLibrary';
import { usePlaylist } from './hooks/playlist/usePlaylist';
import { usePlaylistImport, type ImportCommit } from './hooks/playlistImport/usePlaylistImport';
import { useOverlays } from './hooks/overlays/useOverlays';
import { useLyrics } from './hooks/lyrics/useLyrics';
import { useBackground } from './hooks/background/useBackground';
import { useInterfaceSettings } from './hooks/interfaceSettings/useInterfaceSettings';
import { usePlayback } from './hooks/playback/PlaybackContext';
import { InterfaceSettingsProvider } from './hooks/interfaceSettings/InterfaceSettingsContext';
import { VisualAtmosphereProvider } from './hooks/background/VisualAtmosphereContext';
import { useEdgePanels } from './hooks/edgePanels/useEdgePanels';
import { useSearchCluster } from './hooks/searchCluster/useSearchCluster';
import { useStage } from './hooks/stage/useStage';
import { useListenMode } from './hooks/listen/useListenMode';
import { useGlass } from './lib/glass';
import { libraryService } from './lib/library';

/** 演示曲库量（仅 `?demo=1` 开发 / QA 开关打开时生成）：渲染成本与它无关，仅影响数据生成与空间索引（线性）。 */
const CARD_COUNT = 1000;

/** localStorage 里是否有可恢复的会话歌单（同步嗅探，只用于决定首帧要不要闪一下空状态）。 */
function hasSavedSession(): boolean {
  try {
    const raw = localStorage.getItem('music-nebula.session');
    if (!raw) return false;
    const s = JSON.parse(raw) as { tracks?: unknown[] };
    return Array.isArray(s.tracks) && s.tracks.length > 0;
  } catch {
    return false;
  }
}

declare global {
  interface Window {
    __nebula?: {
      reset: () => void;
      pan: () => { x: number; y: number };
      total: number;
      visible: () => number;
      revealed: () => number;
      player: typeof audioPlayer;
      songsData: () => Track[];
      setSongAudio: (id: number, url: string) => void;
      search: (q: string) => void;
      zoom: () => number;
      /** 切换星云排法、读镜头状态（QA / 调试用） */
      stageMode: (m: StageLayout) => void;
      space: () => {
        mode: StageLayout;
        zoom: number;
        center: { x: number; y: number } | null;
        period: number;
        clusters: number;
        /** 按歌手时的歌手名位置（#138） */
        labels: { name: string; kind: 'top' | 'bottom' | 'inside'; x: number; y: number; songs: number }[];
      };
      /** 镜头飞到世界坐标 (x, y)，缩放 zoom（QA / 调试用） */
      lookAt: (x: number, y: number, zoom: number) => void;
    };
  }
}

export default function App() {
  // 曲库初始化：默认不预置任何歌曲（首次启动显示空状态，后续由导入 / 会话恢复接管）。
  // 演示星云只在 `?demo=1` 开发 / QA 开关打开时生成（舞台测试依赖它）。
  const [demoNebula] = useState(isDemoNebulaEnabled);
  useState(() => {
    if (demoNebula && libraryService.getState().songs.length === 0) {
      libraryService.applyImported(generateTracks(mulberry32(SEED), CARD_COUNT));
    }
  });
  const { songs } = useLibrary();
  // 会话恢复在 useStage 的挂载 effect 里做（首帧曲库仍是空的）：有会话时首帧不能闪空状态，
  // 所以先同步嗅探 localStorage，等恢复 effect 跑完（下面那个 effect 在它之后）再放开
  const [sessionPending, setSessionPending] = useState(hasSavedSession);

  // ---------- 多平台账号状态（领域 hook：useAccounts） ----------
  const {
    platforms,
    accounts,
    loginNonce,
    drawerPlatform,
    refreshAccount,
    setDrawerPlatform,
    requestLogin,
  } = useAccounts();
  // ---------- 歌单/导入领域（组合层接线） ----------
  const playlist = usePlaylist();
  // 转发 ref：打破 TDZ，保持 hook 调用顺序稳定（resetImportState / beginImport 在其后定义）
  const sessionStartRef = useRef<() => void>(() => {});
  const commitRef = useRef<(c: ImportCommit) => void>(() => {});
  const handleImportSessionStart = useCallback(() => sessionStartRef.current(), []);
  const handleImportCommitted = useCallback((c: ImportCommit) => commitRef.current(c), []);
  const importer = usePlaylistImport({
    onSessionStart: handleImportSessionStart,
    onImported: handleImportCommitted,
  });
  const { complete: completeImport } = importer;
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  // 内嵌登录 / 验证弹窗（第三方页面叠在弹窗里，见 LoginSheet）：打开时和其他全局弹窗一样不进入聆听
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);
  // ---------- 浮层领域（useOverlays） ----------
  const overlays = useOverlays();
  const {
    contextMenu,
    contextMenuRef,
    infoModal,
    listenPane,
    setListenPane,
    nowPlayingOpen,
    modeToast,
    openContextMenu,
    closeContextMenu,
    copyTrackLink,
    openCommentsModal,
    openCommentsFor,
    openSongDetailModal,
    openLyricVersions,
    openArtistByName,
    openArtistFromChip,
    openAlbum,
    playArtistTrack,
    setNowPlayingOpen,
    setModeToast,
    setInfoModal,
  } = overlays;
  // 浮层稳定回调（供 memo 区块与后续领域 hook 使用）
  const openNowPlaying = useCallback(() => setNowPlayingOpen(true), [setNowPlayingOpen]);
  const closeNowPlaying = useCallback(() => setNowPlayingOpen(false), [setNowPlayingOpen]);
  const closeListenPane = useCallback(() => setListenPane(null), [setListenPane]);
  const openWallpapers = useCallback(() => setWallpaperOpen(true), []);
  const closeWallpaper = useCallback(() => setWallpaperOpen(false), []);
  const closeInfo = useCallback(() => setInfoModal(null), [setInfoModal]);
  // ---------- 歌词领域（useLyrics） ----------
  const lyrics = useLyrics();
  const {
    lyricLines,
    lyricSettings,
    lyricTranslationEnabled,
    handleLyricFontSize,
    handleLayerMode,
    handleCurrentScale,
    handleLyricLayout,
    handleLyricColorSource,
    handleCustomColor,
    handleLyricBold,
    handleListenSettings,
    toggleTranslation,
    lyricDebugInfo,
  } = lyrics;

  // ---------- 边缘感应面板（useEdgePanels） ----------
  const edgePanels = useEdgePanels({ contextMenuRef });
  const { edge, near, showPanel, enterTop, leaveTop, enterRight, leaveRight, enterLeft, leaveLeft, pinLeft, pinRight } =
    edgePanels;

  // 低频播放状态（不含 currentTime/duration；高频值由叶子组件订阅）
  const playerState = usePlayback();

  // ---------- 背景/界面设置领域（useBackground 产出 VisualAtmosphere；useInterfaceSettings） ----------
  const background = useBackground({
    coverKey: playerState.song?.cover ?? '',
  });
  const {
    bgSetting,
    bgCoverMode,
    atmosphere,
    handleSelectBg,
    handleCoverMode,
    applyWallpaperResult,
    handleBgFile,
  } = background;
  const interfaceSettings = useInterfaceSettings();
  const {
    uiHideCards,
    uiHideLyrics,
    toggleHideCards,
    toggleHideLyrics,
    glassTheme,
    setGlassTheme,
    perfPriority,
    setPerfPriority,
    perfAutoLevel,
  } = interfaceSettings;

  // ---------- 搜索聚簇 + 舞台（useSearchCluster 先声明 refs，useStage 渲染时填充） ----------
  const controllerRef = useRef<PanController | null>(null);
  // 值在 useStage 渲染时填充；null! 仅为早期声明（运行时 action 时已赋值）
  const worldRef = useRef<SpaceWorld>(null!);
  const searchCluster = useSearchCluster({ controllerRef, worldRef });
  const {
    searchMatches,
    applySearch,
    handleSearchPick,
    handleSearchAll,
    handleSearchQueryChange,
  } = searchCluster;

  const currentSongId = playerState.song?.id ?? null;
  const stage = useStage({
    controllerRef,
    songs,
    searchMatches,
    applySearch,
    contextMenuRef,
    completeImport,
    currentSongId,
    worldRef,
  });
  const {
    stageRef,
    starCanvasRef,
    tintRef,
    matchSet,
    tilt,
    frameBusRef,
    panRef,
    importing,
    hoveredId,
    visibleIds,
    failedIds,
    effectiveCards,
    registerEl,
    handleHoverChange,
    handleCardPlay,
    handleReset,
    beginImport,
    resetImportState,
  } = stage;

  // 必须声明在 useStage 之后：同一次提交里 effect 按声明顺序执行，会话恢复先写入曲库，这里再放开空状态，
  // 两次 setState 合并成一次渲染（有会话时空状态一帧都不出现）
  useEffect(() => setSessionPending(false), []);
  /** 首次启动空状态：曲库里没有任何真实歌曲（演示开关打开时从不显示）。 */
  const showEmpty = !demoNebula && songs.length === 0 && !sessionPending;
  const emptyPhase = useEmptyPhase(showEmpty);

  // 回到中心 = G2 透镜圆按钮（NEBULA_UI_SYSTEM §3.3）
  const centerRef = useRef<HTMLButtonElement>(null);
  useGlass(centerRef, 'g2');

  // ---------- 漫游 / 聆听交接（useListenMode，NEBULA_UI_SYSTEM §7.1） ----------
  const appRef = useRef<HTMLElement>(null);
  const listenConfig = useMemo(
    () => ({
      enabled: lyricSettings.listenHandoff && !uiHideCards && !uiHideLyrics,
      delayMs: lyricSettings.listenDelay * 1000,
      style: lyricSettings.listenStyle,
      dimBar: lyricSettings.listenDimBar,
      pin: lyricSettings.listenPin,
      lyricsUnder: lyricSettings.layerMode === 'under',
      layout: lyricSettings.lyricLayout,
    }),
    [lyricSettings, uiHideCards, uiHideLyrics],
  );
  // 不进入聆听的情况只剩：右键菜单、覆盖全局的页面（信息弹窗、听音空间、壁纸）、导入中。
  // 指针静止在卡片上也能进入聆听（2026-11-14 用户确认，NEBULA_UI_SYSTEM §7.1）：悬停不再阻断；
  // 聆听中悬停态由 CSS 压回普通态（.app[data-lk] .music-card.is-hovered），一动鼠标自然恢复。
  // 侧栏 / 设置 / 顶部搜索面板开着、鼠标不动也算静止（#125，用户确认）；在搜索框里打字由引擎的输入框判断挡住
  const listenBlocked = !!contextMenu || !!infoModal || nowPlayingOpen || wallpaperOpen || loginSheetOpen || importing;
  const exitListen = useListenMode(appRef, listenConfig, listenBlocked);

  /** 全网搜索点播：仅播放该曲，不影响当前队列；播完自动接回歌单（playTransient）。 */
  const handlePlayNetworkSong = useCallback((track: Track) => {
    audioPlayer.playTransient(track);
  }, []);

  // 会话记忆：导入歌单 + 当前播放歌曲（退出后重开自动恢复）
  useEffect(() => {
    try {
      if (!songs.length || songs[0]?.source === 'demo') return;
      const song = playerState.song;
      // 当前歌是否就是歌单里的那一首（曲目 id = 曲库下标；插播歌 / 换歌单后留下的那首不在歌单里）
      const listed =
        !!song &&
        song.id >= 0 &&
        songs[song.id]?.source === song.source &&
        songs[song.id]?.sourceId === song.sourceId;
      localStorage.setItem(
        'music-nebula.session',
        JSON.stringify({
          tracks: songs.map((s) => toBackendTrack(s)),
          currentId: listed ? song!.id : undefined,
          // 不在歌单里的当前歌：存下这首歌本身，以及播完后歌单从哪首接着放（重开后按插播还原）
          currentTrack: song && !listed ? toBackendTrack(song) : undefined,
          resumeAfter: song && !listed ? (audioPlayer.getResumeIndex() ?? -1) : undefined,
          // 歌单身份随会话保存：刷新后列表里才能标出「当前」，点它不会重新导入、打断恢复出来的当前歌
          playlist: playlist.currentPlaylist,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [songs, playerState.song?.id, playerState.song?.sourceId, playlist.currentPlaylist]);

  // 音质档位：随当前歌曲变化拉取可用列表（桌面版）。兜底到别的平台供流时，列的是那个平台的档位
  useEffect(() => {
    const song = playerState.song;
    if (!song || !hasDesktopAPI() || !song.sourceId) return;
    let cancelled = false;
    window.nebulaAPI!
      .songQualities(streamTrack(song))
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data?.length) {
          audioPlayer.setQualities(res.data);
          if (!preferredQuality()) {
            try {
              localStorage.setItem('music-nebula.quality', res.data[0]!.level);
            } catch {
              /* ignore */
            }
          }
        }
      })
      .catch(() => {
        /* 无音质列表时隐藏切换入口 */
      });
    return () => {
      cancelled = true;
    };
  }, [playerState.song?.id, playerState.song?.sourceId, playerState.song?.via?.platform]);

  // 组合层接线：导入会话开始 → resetImportState；导入成功 → 曲库 + 歌单身份 + 渐进揭示
  sessionStartRef.current = resetImportState;
  commitRef.current = (c) => {
    playlist.setCurrent(c.meta);
    beginImport(c.adapterName, c.tracks, c.simulated, c.note);
  };

  useEffect(() => {
    audioPlayer.retryResolver = resolveTrackForPlay;
    audioPlayer.emptyResolver = resolveTrackForPlay;
  }, []);

  const handleQualitySelect = selectQuality;
  /** 歌单列表：双击播放某首 → 回到该歌曲卡片中心。 */
  const playSongFromList = useCallback(
    (index: number) => {
      playlist.playFromList(index);
      handleReset();
    },
    [playlist, handleReset],
  );

  const playPlaylistFromStart = useCallback(() => {
    playlist.playFromStart();
    handleReset();
  }, [playlist, handleReset]);

  const insertNextSong = useCallback((track: Track) => playlist.insertNext(track), [playlist]);

  // 右键菜单（审查第 17 条）：立即播放走和点击卡片相同的路径（handleCardPlay）；
  // 歌手 / 专辑复用二级页的打开逻辑（多歌手只取第一位，其余歌手可在歌手页 / 详情里进入）
  const playTrackNow = useCallback((track: Track) => void handleCardPlay(track.id), [handleCardPlay]);
  const viewTrackArtist = useCallback(
    (track: Track) => openArtistByName(track.artist.split(/[\/、&,，]/)[0]!.trim(), track),
    [openArtistByName],
  );
  const viewTrackAlbum = useCallback(
    (track: Track) => {
      if (track.album) openAlbum(track.source, '', track.album, track.artist.split(/[\/、&,，]/)[0]!.trim());
    },
    [openAlbum],
  );

  /** 歌手页点播：overlays.playArtistTrack + 回到中心（组合层接线）。 */
  const handlePlayArtistTrack = useCallback(
    (t: DesktopTrack) => {
      playArtistTrack(t);
      handleReset();
    },
    [playArtistTrack, handleReset],
  );

  const cycleModeWithToast = useCallback(() => {
    audioPlayer.cycleMode();
    const m = audioPlayer.getState().mode;
    const label = m === 'sequential' ? '顺序播放' : m === 'repeat-one' ? '单曲循环' : '随机播放';
    setModeToast(label); // 停留时长由 useOverlays 统一计时（2.4s）
  }, []);

  /** 组合层接线：壁纸应用结果 → useBackground 设背景（壁纸库自己播完退出动画后关闭）。 */
  const handleWallpaperApply = useCallback(
    (_item: DesktopWallpaperItem, result: DesktopWallpaperSetResult) => applyWallpaperResult(result),
    [applyWallpaperResult],
  );

  /** 组合层接线：账号域 requestLogin + 边缘面板 showPanel。 */
  const handleGoLogin = useCallback(
    (platform: string) => {
      requestLogin(platform);
      showPanel('right');
    },
    [requestLogin, showPanel],
  );

  // 播放时才发现登录过期（#157）：马上重查这个平台的账号，账号区和歌单面板跟着显示「登录已过期」
  const lapsedPlatform = lapsedPlatformOf(playerState.error, playerState.song?.source);
  useEffect(() => {
    if (lapsedPlatform) void refreshAccount(lapsedPlatform);
  }, [lapsedPlatform, refreshAccount]);

  /** 空状态「登录音乐平台」：打开右侧账号页、停在平台列表（第一次用，不替用户选平台）。 */
  const [accountListNonce, setAccountListNonce] = useState(0);
  const handleEmptyLogin = useCallback(() => {
    setAccountListNonce((n) => n + 1);
    showPanel('right');
  }, [showPanel]);
  /** 空状态「粘贴歌单链接」：左侧 Dock 的「导入」页 + 输入框聚焦。 */
  const [playlistDockRequest, setPlaylistDockRequest] = useState<
    { panel: 'import'; focusInput: boolean; nonce: number } | undefined
  >(undefined);
  const handleEmptyPasteLink = useCallback(() => {
    setPlaylistDockRequest((r) => ({ panel: 'import', focusInput: true, nonce: (r?.nonce ?? 0) + 1 }));
    showPanel('left');
  }, [showPanel]);

  /** 全平台歌单一键刷新：只刷新已登录平台，账号信息与歌单一并重新拉取。 */
  const handleRefreshAll = useCallback(() => {
    const targets = Object.keys(accounts).filter((p) => accounts[p].loggedIn);
    if (!targets.length) return;
    void Promise.all(targets.map((p) => refreshAccount(p))).catch(() => {
      /* 单个平台刷新失败不影响其他平台 */
    });
  }, [accounts, refreshAccount]);

  const effectiveBgSetting: BackgroundSetting =
    bgSetting.type === 'cover'
      ? playerState.song?.cover
        ? { type: 'image', url: playerState.song.cover }
        : { type: 'preset', id: 'midnight' }
      : bgSetting;

  // 界面设置 context（低频；App 组合层持有状态与 setter）
  const interfaceSettingsValue = useMemo(
    () => ({
      lyricSettings,
      uiHideCards,
      uiHideLyrics,
      lyricTranslationEnabled,
      toggleHideCards,
      toggleHideLyrics,
      toggleTranslation,
    }),
    [
      lyricSettings,
      uiHideCards,
      uiHideLyrics,
      lyricTranslationEnabled,
      toggleHideCards,
      toggleHideLyrics,
      toggleTranslation,
    ],
  );

  // 视觉氛围 context（useBackground 只产出氛围数据，消费端自行推导歌词色板）
  const atmosphereValue = useMemo(
    () => ({
      palette: atmosphere.palette,
      sample: atmosphere.sample,
      coverMode: bgCoverMode,
      effectiveBg: effectiveBgSetting,
    }),
    [atmosphere.palette, atmosphere.sample, bgCoverMode, effectiveBgSetting],
  );

  // 稳定 searchSlot（TopBar memo 化需要引用稳定）
  const searchSlot = useMemo(
    () => (
      <SearchBar
        songs={songs}
        onPick={handleSearchPick}
        onSearchAll={handleSearchAll}
        onQueryChange={handleSearchQueryChange}
        onPlayNetworkSong={handlePlayNetworkSong}
        onOpenArtist={openArtistFromChip}
      />
    ),
    [songs, handleSearchPick, handleSearchAll, handleSearchQueryChange, handlePlayNetworkSong, openArtistFromChip],
  );

  return (
    <InterfaceSettingsProvider value={interfaceSettingsValue}>
      <VisualAtmosphereProvider value={atmosphereValue}>
        {/* data-no-song：还没有当前歌时播放条和「回到中心」先不出现；data-empty：空状态期间的中性环境光（empty-nebula.css） */}
        <main
          className="app"
          ref={appRef}
          data-no-song={playerState.song ? undefined : ''}
          data-empty={emptyPhase === 'off' ? undefined : emptyPhase}
          data-ls={nowPlayingOpen ? '' : undefined}
        >
      <BackgroundLayer setting={effectiveBgSetting} coverMode={bgSetting.type === 'cover' ? bgCoverMode : undefined} />

      {!uiHideLyrics && (
        <LyricsLayer
          lines={lyricLines}
          frameBus={frameBusRef.current}
          songKey={
            playerState.song
              ? `${playerState.song.source}:${playerState.song.sourceId ?? playerState.song.id}`
              : 'none'
          }
          songTitle={playerState.song?.title}
          songArtist={playerState.song?.artist}
        />
      )}
      {/* 版面（样张 M）：舞台实验室选「版面」时，聆听中取代漫游歌词 */}
      {!uiHideLyrics && (
        <LyricPage
          lines={lyricLines}
          songKey={playerState.song ? `${playerState.song.source}:${playerState.song.sourceId ?? playerState.song.id}` : 'none'}
          lsOpen={nowPlayingOpen}
        />
      )}

      <StageCanvas
        stageRef={stageRef}
        starCanvasRef={starCanvasRef}
        tintRef={tintRef}
        tilt={tilt}
        matchSet={matchSet}
        importing={importing}
        uiHideCards={uiHideCards}
        visibleIds={visibleIds}
        effectiveCards={effectiveCards}
        pan={panRef.current}
        zoom={frameBusRef.current.zoom}
        hoveredId={hoveredId}
        currentSongId={currentSongId}
        failedIds={failedIds}
        onPlay={handleCardPlay}
        onContextMenu={openContextMenu}
        onHoverChange={handleHoverChange}
        registerEl={registerEl}
      />

      <EmptyNebula
        phase={emptyPhase}
        onLogin={handleEmptyLogin}
        onPasteLink={handleEmptyPasteLink}
        onLocal={importer.openLocal}
      />

      <TopBar
        visible={edge.top}
        localBusy={importer.localBusy}
        searchSlot={searchSlot}
        onEnter={enterTop}
        onLeave={leaveTop}
        onOpenLocal={importer.openLocal}
      />

      <AccountDock
        visible={edge.right}
        selectedPlatform={drawerPlatform}
        loginNonce={loginNonce}
        accountListNonce={accountListNonce}
        platforms={platforms}
        accounts={accounts}
        bgSetting={bgSetting}
        coverMode={bgCoverMode}
        lyricSettings={lyricSettings}
        uiHideCards={uiHideCards}
        uiHideLyrics={uiHideLyrics}
        onEnter={enterRight}
        onLeave={leaveRight}
        onSelectPlatform={setDrawerPlatform}
        onRefreshAccount={refreshAccount}
        onSelectBg={handleSelectBg}
        onFile={handleBgFile}
        onCoverMode={handleCoverMode}
        onFontSize={handleLyricFontSize}
        onLayerMode={handleLayerMode}
        onCurrentScale={handleCurrentScale}
        onLyricLayout={handleLyricLayout}
        onLyricColorSource={handleLyricColorSource}
        onCustomColor={handleCustomColor}
        onLyricBold={handleLyricBold}
        onListenSettings={handleListenSettings}
        onToggleHideCards={toggleHideCards}
        onToggleHideLyrics={toggleHideLyrics}
        onOpenWallpapers={openWallpapers}
        glassTheme={glassTheme}
        onGlassTheme={setGlassTheme}
        perfPriority={perfPriority}
        onPerfPriority={setPerfPriority}
        perfAutoLevel={perfAutoLevel}
        near={near.right}
        coverUrl={playerState.song?.cover ?? ''}
        lyricLines={lyricLines}
        onPinChange={pinRight}
      />

      <PlaylistDock
        visible={edge.left}
        accounts={accounts}
        importStatus={importer.importStatus}
        importMessage={importer.importMessage}
        onEnter={enterLeft}
        onLeave={leaveLeft}
        onImportPlaylist={importer.importPlaylistId}
        onImportUrl={importer.importUrl}
        onGoLogin={handleGoLogin}
        onRefreshAll={handleRefreshAll}
        songs={songs}
        currentPlaylist={playlist.currentPlaylist}
        onPlaySongFromList={playSongFromList}
        onPlayPlaylist={playPlaylistFromStart}
        onSongContextMenu={openContextMenu}
        onOpenLocal={importer.openLocal}
        near={near.left}
        onPinChange={pinLeft}
        openRequest={playlistDockRequest}
      />

      <button ref={centerRef} className="center-btn glass-g2" onClick={handleReset} aria-label="回到中心" data-tip="回到中心">
        {/* 准星（审查第 18 条），统一图标集 */}
        <span>
          <IconLocate size={18} />
        </span>
      </button>

      {/* 常驻聆听的收起键（2026-11-22）：和听音空间左上角的收起键同一个样子，只在常驻聆听时出现（styles.css .listen-exit） */}
      <button type="button" className="listen-exit" onClick={exitListen} aria-label="离开聆听" data-tip="收起（Esc）" data-tip-side="right">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9.5l6 6 6-6" />
        </svg>
      </button>

      {/* 开发者工具：歌词来源面板（默认隐藏，Ctrl+Shift+L 开关） */}
      <LyricSourceProbe info={lyricDebugInfo} />
      <SpaceLabPanel songCount={songs.length} />

      <PlayerSurface variant="compact">
        <BottomPlayer
          qualities={playerState.qualities}
          quality={playerState.quality || preferredQuality()}
          mode={playerState.mode}
          onSelectQuality={handleQualitySelect}
          onCycleMode={cycleModeWithToast}
          onOpenNowPlaying={openNowPlaying}
          onOpenComments={openCommentsModal}
          onOpenSongDetail={openSongDetailModal}
          onOpenArtist={openArtistByName}
          onRelogin={handleGoLogin}
        />
      </PlayerSurface>

      <OverlayStack
        nowPlayingOpen={nowPlayingOpen}
        lines={lyricLines}
        listenPane={listenPane}
        onListenPaneBack={closeListenPane}
        onOpenSongDetail={openSongDetailModal}
        onOpenLyricVersions={openLyricVersions}
        lyricInfo={lyricDebugInfo}
        onOpenArtistByName={openArtistByName}
        wallpaperOpen={wallpaperOpen}
        infoModal={infoModal}
        modeToast={modeToast}
        contextMenu={contextMenu}
        onCloseNowPlaying={closeNowPlaying}
        onCloseWallpaper={closeWallpaper}
        onApplyWallpaper={handleWallpaperApply}
        onCloseInfo={closeInfo}
        onOpenComments={openCommentsFor}
        onOpenArtist={openArtistFromChip}
        onOpenAlbum={openAlbum}
        onPlayArtistTrack={handlePlayArtistTrack}
        onCloseContextMenu={closeContextMenu}
        onInsertNext={insertNextSong}
        onPlayNow={playTrackNow}
        onViewArtist={viewTrackArtist}
        onViewAlbum={viewTrackAlbum}
        onCopyLink={copyTrackLink}
      />
      <LoginSheet onOpenChange={setLoginSheetOpen} />
      <TooltipLayer />
        </main>
      </VisualAtmosphereProvider>
    </InterfaceSettingsProvider>
  );
}
