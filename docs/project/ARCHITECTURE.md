# Music Nebula — 前端架构（App.tsx 收敛计划 v1）

> 本文档是 App.tsx 领域化重构的唯一架构真源，随迁移步骤同步更新。
> 依赖规则由 `scripts/check-arch.mjs` 机制化执行（`pnpm check:arch`，并随 `pnpm qa` 运行）。

---

## 1. 目标

2026-11 后端整修补充：`lib/audio/desktopPlayback.ts` 负责点播解析及音质请求接线，App 只注册解析器与回调。`AudioPlayer` 的播放代次隔离迟到异步结果；跨曲切换先停止旧媒体。`lib/playlist/ipcClient.ts` 保留平台元信息，远程临时地址不进入会话持久化。

- 把 1411 行的 App.tsx 收敛为「组合层」：领域 hooks 提供状态与行为，视图区块按 Z 轴组装，App 只做接线。
- 纯结构整理：**行为零变化**；不引入状态库、不重写 panEngine / AudioPlayer。
- 低成本重渲染隔离：App 顶层不再订阅全量播放器状态；高频值（currentTime/progress）留在叶子订阅。

## 2. 领域清单（12 hooks + 2 services）

### Services（lib 单例，非 React）

| Service | 职责 | 约束 |
| --- | --- | --- |
| `audioPlayer`（已有） | 播放/队列/模式 | 全局单例，leaf 可订阅 |
| `LibraryService`（新增 `src/lib/library.ts`） | **仅 track/catalog 数据**（songs） | **不持有 currentPlaylist**；`applyImported` 是唯一外部导入入口 |
| `lib/glass/`（2026-11 新增） | 光学材质：材质档位参数、位移贴图、GlassManager（每个 G1/G2 玻璃面、以及 G3 的两侧面板各一个 SVG 折射滤镜）、`useGlass` | 只写材质相关的 CSS 变量与 SVG 滤镜；主题由 `useInterfaceSettings` 调用 `applyGlassTheme` |
| `lib/environment.ts`（2026-11 新增） | 环境光取色（k-means）→ 根节点 `--e1/--e2/--e3/--ebase/--acc/--tint-adapt` | 由 `useBackground` 调用（背景领域"只写自己的环境光 CSS 变量"）；不触碰歌词状态 |
| `lib/listenMode.ts`（2026-11 新增） | 漫游 / 聆听注意力交接引擎（NEBULA_UI_SYSTEM §7.1）：静止检测、0→1 交接曲线，写根元素 `--lk/--lo/--ls` 与 `data-listen-*`；`listenBus` 供舞台帧循环读取「散开」位移 | 由 `useListenMode` 接线；只写交接相关的变量和属性，视觉由 CSS 完成；舞台通过 `onListenFrame` 订阅刷新 |
| `components/icons.tsx`（2026-11-14 新增） | 统一图标集（关闭、左右箭头、播放、爱心、勾、准星、音符），24 网格 1.7 线宽 | 界面里不再用字符当图标；播放器底栏的 `player/icons.tsx` 暂时独立 |
| `lib/metaOverlap.ts`、`lib/shareLink.ts`（2026-11-14 新增） | 星云卡片标题防压盖（四边形求交，纯函数）；歌曲分享链接（按平台生成页面地址） | 前者由 `useStage.handleFrame` 每帧调用；后者由右键菜单「复制链接」使用 |
| `lib/overlayScrollbar.ts`（2026-11-14 新增） | 悬浮滚动条（NEBULA_UI_SYSTEM §9.7）：隐藏原生滚动条，在滚动容器的定位祖先上叠一根细条，滚动 / 悬停时淡入、可拖动 | `useOverlayScrollbar(ref, active)`；侧面板、弹窗、播放队列、搜索结果在用；不改动元素的定位方式 |
| `components/EmptyNebula.tsx` + `empty-nebula.css`（2026-11-14 新增） | 首次启动空状态（§9.8）：空卡轮廓、标题与三个入口；`useEmptyPhase` 管淡出；`.app[data-no-song]` 时隐藏播放条与回到中心 | 由 App 在曲库为空且无会话可恢复时挂载；演示星云只在 `isDemoNebulaEnabled()`（`?demo=1`）时生成 |
| `components/modals.css`（2026-11-14 新增） | 信息弹窗（歌曲详情、评论、歌手、专辑）的全部样式（§9.4），`.mdl-*` | 由 `InfoModals.tsx` 引入；旧 `.info-modal` 内部样式已从 styles.css 删除，`.info-overlay` / `.info-veil` 仍在 styles.css |
| `lib/listen/`（2026-11-16 新增，Player P2） | 听音空间的歌词阅读栏（NEBULA_UI_SYSTEM §7.2）：`words.ts`（#124 抽出的逐字层：拆字、量宽、波浪、着色、每帧逐字状态，听音空间与星云上的空域歌词 `LyricsLayer`、设置预览共用；样式在 `components/listen/lyric-words.css`，作用于 `.lw` 根）、`engine.ts`（纯 DOM 引擎：弹簧滚动、景深、环境透色、逐字波浪、长音、快歌自适应、滚轮浏览）、`model.ts`（`LyricLineUI[]` → 引擎条目、间奏、密度、文字判断；`toEngineLine` 单句转换两边共用）、`settings.ts`（听音空间歌词设置 store，`music-nebula.listen-lyrics`）、`palette.ts`（封面 → 歌词主色 `--ly-a` / `--ly-b`，由 `environment.ts` 写到根元素）、`coverUrl.ts`（大封面换高清地址） | 引擎不依赖 React；歌词栏祖先不得建立层叠上下文（环境透色要和背后混合） |
| `public/fonts/` + `lib/fonts.ts`（2026-11-16 新增） | 随软件打包的字体（Newsreader、Inter、思源宋体 KR 分块）与 `fonts.css`、OFL 授权文件；`loadBundledFonts()` 在 `main.tsx` 渲染前插入指向 `fonts/fonts.css` 的样式表链接 | 放在 public 里由 Vite 原样复制到输出目录，不会被单文件构建内联；地址按页面地址解析，桌面版 file:// 和网页版都可用 |
| `lib/quality.ts` + `src/main/quality.ts`（2026-11-16 新增，#120） | 前端：各平台音质标识的中文名、播放条代号、平台名；后端：跨平台保真度阶梯 `mapQualityTo`（兜底到别的平台时把偏好换成同级档位）与环绕声效果版集合 `EFFECT_LEVELS` | 音质显示以实际供流为准：Track 的 `via` 记兜底平台，音质列表与切换都按它来 |
| `components/listen/`（2026-11-16 新增，Player P2） | `ListenSpace`（听音空间外壳：封面一镜到底、星云后退、左侧信息、右栏原地详情、翻译开关）、`LyricColumn`（引擎的 React 包装 + 平滑时钟）、`ListenPreview`（设置里的实时预览，同一引擎紧凑模式） | 取代 `NowPlayingPanel`（已删除）；由 `OverlayStack` 常驻挂载，`useOverlays.nowPlayingOpen` 控制开合；听音空间打开时 `useOverlays` 把详情 / 歌手 / 专辑 / 评论路由到右栏（`InfoPane`，`InfoModals` 的 pane 呈现方式） |
| `components/dock/`（2026-11 新增，非区块） | `SideDock`（两侧 Dock 机制与外壳：光痕、G2 小球、G3 固定侧面板、点外面 / Esc 关闭）+ `panel-kit.css`（面板共用基础件）+ `left-panel.css` / `right-panel.css` | 被 `PlaylistDock` / `AccountDock` 两个区块使用；只做外壳，内容由区块提供；样式限定在 `.sd-panel` 内 |
| `lib/perf.ts`（2026-11 新增） | 性能自动降级（NEBULA_UI_SYSTEM §3.7）：帧监测（每 10 秒采样 2 秒）+ 档位应用（材质交给 GlassManager，环境光漂移由根节点 `data-perf` 驱动 CSS） | 由 `useInterfaceSettings` 调用（「性能优先」开关 + 自动档位）；不触碰其他领域状态 |

> 概念边界：`LibraryService → PlaylistService/usePlaylist → audioPlayer`。第一阶段若只做一个 service，也**不得**让 LibraryService 变成万能音乐状态容器。

### Hooks（按领域目录 `src/hooks/<domain>/`）

| Hook | 领域 | 拥有 | 依赖 |
| --- | --- | --- | --- |
| `useAccounts` | 账号 | platforms / accounts / loginNonce / drawerPlatform；启动探活、refresh、requestLogin | 无 hook 依赖 |
| `useLibrary` | 曲库 | LibraryService 的 React 订阅适配层（**无业务逻辑**） | LibraryService |
| `usePlaylist` | 歌单生命周期/队列 | 当前歌单身份、playPlaylistFromStart / playSongFromList / insertNextSong | LibraryService + audioPlayer |
| `usePlaylistImport` | 导入流程 | importStatus / importMessage / importing / localBusy + 手动/平台/本地导入 | LibraryService（applyImported） |
| `useOverlays` | 浮层 | contextMenu / infoModal / nowPlayingOpen / modeToast | audioPlayer |
| `useLyrics` | 歌词运行态 | lyricLines / 拉取/归一化（随切歌） | audioPlayer（service） |
| `useBackground` | 背景/氛围 | bgSetting / bgCoverMode；产出 **VisualAtmosphere**（不直接改歌词/玻璃） | 无 hook 依赖 |
| `useInterfaceSettings` | 界面设置 | lyricSettings、uiHideCards、uiHideLyrics、lyricTranslationEnabled + 持久化 | 无 hook 依赖 |
| `useSearchCluster` | 搜索 | searchMatches + 定位/聚簇 handlers；歌曲数据来自 App 传参（songs prop） | 不依赖 usePlaylist |
| `useEdgePanels` | 边缘面板 | edge 状态 + 热点/防抖计时器 | 无 hook 依赖 |
| `useStage` | 画布（最后迁移） | hoveredId / visibleIds / failedIds / likedIds + 舞台接线 | LibraryService + audioPlayer |
| `useListenMode`（2026-11 新增） | 漫游 / 聆听交接 | 只做接线：创建 ListenDirector、按设置 configure；阻断条件由 App 汇总传入 | audioPlayer（service）；无 hook 依赖 |

## 3. 依赖图（DAG）

```
lib/（audioPlayer · LibraryService · atmosphere 纯函数 · 既有模块）
   ▲
   │ 全部 hooks 可依赖（Hook → Service/lib ✔）
hooks/（默认禁止跨领域；白名单为空集；逃生口：基础层被上层依赖，需登记）
   ▲
contexts（VisualAtmosphere / Playback / InterfaceSettings）只被组件消费
   ▲
view blocks（同层互不依赖，组合只由 App 完成）
```

跨域数据一律经 service / context / App 组合层传参；**不写死"hooks 永远不能互相调用"**，白名单机制保留。

## 4. Context 清单（仅这三个，禁止大全局 context）

| Context | 值 | 高频值 |
| --- | --- | --- |
| `PlaybackProvider` | `{ song, playing, mode, quality, loading, failed, error, qualities }` | 不含 currentTime / duration / progress |
| `InterfaceSettingsProvider` | `{ lyricSettings, uiHideCards, uiHideLyrics, lyricTranslationEnabled }` + setters | — |
| `VisualAtmosphereProvider` | `{ palette, sample, coverMode, effectiveBg }` | — |

高频订阅（`useAudioPlayer()` 叶子）：`LyricsLayer`（Z1 歌词进度）、`BottomPlayer`（进度条/时间）、`ListenSpace`（听音空间；歌词阅读栏按帧读 `audioPlayer.position()`，不靠 React 重渲染）。

> 实现注记：`PlaybackProvider` 挂在入口（`main.tsx`），因为 App 自身也消费低频播放状态——
> Provider 若由 App 渲染，则无法给 App 自身供值。其余两个 Provider 的值由 App 组合层
> 用 `useMemo` 生成并下传子区块，App 不消费它们。

## 5. 视图区块（按 Z 轴 + 功能边界）

| 区块 | 内容 | 备注 |
| --- | --- | --- |
| Z0 | `BackgroundLayer` | 已有组件 |
| Z1 | `LyricsOverlay` | 歌词层 + 隐藏开关 |
| Z2 | `StageCanvas` | stage-3d + 卡片渲染（收 useStage 数据） |
| Z3 | `BottomBar` + 回中按钮 | BottomBar 已有 |
| HUD | `TopBar` / `AccountDock` / `PlaylistDock` | 三者独立，**不合体** |
| Z4 | `OverlayStack` | NowPlaying + InfoModals + 右键菜单 + toast |
| Dev | `LyricSourceProbe` | 开发者工具：歌词来源 / 逐字覆盖面板（默认隐藏，Ctrl+Shift+L）；只读 `useLyrics` 的 `lyricDebugInfo`，不参与正式界面 |

## 6. Dependency Rules（check-arch 强制）

1. `lib` 不得 import `hooks` / `components`。
2. `hooks` 禁止跨领域依赖；基础层可被上层依赖，禁止反向；依赖以白名单为准。
3. 同层 UI 区块禁止互相依赖，组合只能由上层容器（App）完成。
4. Background 不得修改 Lyrics 状态（只经 VisualAtmosphere 中间层）。
5. Stage 不得接触 Account 状态。
6. `applyImported` 是曲库唯一外部导入入口，不演化成通用 mutation。
7. `components` 允许直接 import `lib` 纯函数/类型（例外保留）。

## 7. 迁移路线（插花式，每步 build + qa + 提交）

- [x] 1. `useAccounts`
- [x] 2. `LibraryService` + `useLibrary` + `usePlaylist` + `usePlaylistImport`（含 `lib/playlistTypes.ts` 共享类型；会话记忆效果暂留 App，随 Stage 步迁移）
- [x] 3. `useOverlays`
- [x] 4. 视图第一阶段（OverlayStack 抽取 + HUD/BottomBar memo 化 + 稳定回调接线）
- [x] 5. `useLyrics`（含 `lib/lyricSettings.ts` 共享类型；翻译开关更名 lyricTranslationEnabled）
- [x] 6. `useBackground`（含 VisualAtmosphere 中间层迁移）+ `useInterfaceSettings`
- [x] 7. `useSearchCluster` + `useEdgePanels`
- [x] 8. 视图第二阶段（三 Context 落地 + 区块化：Playback / InterfaceSettings / VisualAtmosphere；LyricsLayer / NowPlayingPanel 叶子化；OverlayStack props 收敛；check-arch 修扩展名解析）
- [x] 9. `useStage`（最后，最高风险：hovered/visible/failed/liked/渐进揭示/PanController/虚拟化数据全部收敛；App 仅剩组合接线）


## 后端整修 #B3：请求与媒体生命周期

- `src/main/requestScope.ts`：AsyncLocalStorage 传播父截止时间/取消，阶段结束回收子请求；调用者取消经 preload → IPC → resolver → HTTP/Axios/probe。
- `SongResolver`：总时限 6000ms、主源 3500ms、单次取链 2300ms、搜索 1600ms、探测 1600ms，全部受父预算约束；最多两个其他平台并发，每个平台最多两个安全候选。阶段值经 #B7 实测调整；主源慢响应仍受总预算约束。
- URL 解析缓存 256 项/120 秒（cachedUntil），匹配缓存 512 项/24 小时；缓存期限不截短返回音频 expiresAt。网易云 expi、QQ expiration 以秒转成请求时刻起的绝对期限；未提供期限时按 sourceLifetime 策略：网易云/酷狗15分钟、QQ30分钟，未知平台10分钟。AudioPlayer 按曲目/地址保留 resolvedAt/expiresAt，没有跨曲目 loadedAt；提前5秒或媒体实际出错才刷新。强制刷新绕过 URL/探测缓存；Cookie 更新和退出登录清空账号相关结果。
- `createFallbackPriorityProvider` 返回可 `invalidate()` 的函数；5 分钟后台权益刷新，单平台 2 秒，点播直接读快照。
- `AudioProxy.start()` 为 Promise，Electron 必须等监听成功；只回传当前实例代理地址。每实例 16 个活动请求、每协议代理最多 16 个 socket/每域 8 个。
- `resolveSong(track,quality,{requestId,forceRefresh})` 与 `cancelResolve(requestId)`：请求标识只在发起它的 webContents 内生效，销毁窗口会取消；旧调用方式仍可用。
- AudioPlayer 临近结束预取下一首，不预播放；新媒体接管前解除旧元素监听，始终只有当前媒体出声。


## 后端整修 #B5：歌词路由

实际供流 Track → 同身份主歌词（3200ms）→ QQ/酷狗/网易云其他来源并行搜索（1800ms）与取词（3200ms），全过程受 8500ms 截止时间约束。复用 recordingMatch；跨源以唯一正文锚点确认偏移（至少 3 个、覆盖半段以上、95% 残差≤180ms、最大≤500ms、偏移≤8s）。未通过则保留主源。

网易云内部 lyric_new/lyric 并发、每个 2800ms，早于服务阶段退出；一个接口挂起时保留另一个的合法结果。

`fetchLyric(track,{requestId})` 与播放共用所有者隔离的 `cancelResolve` 通道。Lyrics hook 的身份键包含实际供流平台/ID，来源变化立即清空旧歌词。`lyricAlignment.ts` 负责覆盖统计和合并，`timedLyrics.ts` 负责真实 QRC/KRC 转换；`LyricCache.flush()` 可用于测试/退出前持久化。

## 后端整修 #B6：封面元数据

导入 Track 带可选 `coverInfo`，候选 URL 不等于已验证尺寸。`nebulaAPI.coverInfo(track)` → `nebula:cover-info` → CoverService 返回 `{url,width?,height?,verified}`。仅 `verified=true` 的尺寸来自真实图像头；失败保留原图，不重采样。该接口按需使用，不阻塞播放，听音空间尺寸展示由主线接入。网易云匿名初始化在 Electron 启动预热；主平台不受兜底熔断阻止。
