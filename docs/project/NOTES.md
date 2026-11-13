# Music Nebula — 踩坑记录与待办

## 已知坑（遇事优先查这里）

### 网易云接口（重要）

- **明文扫码接口已废弃**：`music.163.com/api/login/qrcode/unikey|client/login` 扫码确认后会报「请切换其他登录方式或升级新版本再试」。必须使用 eapi（`interface.music.163.com/eapi/...`，`type=3`）或 weapi 加密接口。
- eapi 请求必须带设备 Cookie（`osver / deviceId / WNMCID / _ntes_nnid / _ntes_nuid / appver`）与客户端 UA，否则可能触发风控或返回异常。
- 登录成功凭证可能在响应的 JSON `cookie` 字段，也可能在 Set-Cookie 头；两者都要收集合并。
- **网易云主路径已切换到成熟库 `@neteasecloudmusicapienhanced/api`**：直接 require 其 module 函数 + `util/request`（不用起 Express 服务）。启动前必须先写 `os.tmpdir()/anonymous_token`（空文件）并调 `generateConfig()`；esbuild 需 `--external:@neteasecloudmusicapienhanced/* --external:qrcode`。
- 歌单详情 v6 接口默认只回 10 首，需用 `trackIds` 分 100 首一批调 `/api/v3/song/detail` 补全。
- 无版权/VIP 时 `/api/song/enhance/player/url` 返回占位地址（`music.163.com/song/media/outer/url...`），需判定为失败并触发兜底。
- 取链音质：`song_url_v1` 的 level 体系（jymaster/sky 需 SVIP，hires/lossless 需 VIP），匿名仅 standard/exhigh；`freeTrialInfo` 存在即试听片段。
- 音频播放必须走主进程 `AudioProxy`（`http://127.0.0.1:port/api/audio?url=...`），禁止把平台原始 URL 直接喂给 `<audio>`；代理白名单外域名返回 403。
- Cookie 校验：netease 必须含 `MUSIC_U`；qq 必须含 `uin` + 播放票据（music_key/qm_keyst/p_skey/skey 至少其一），否则 `setCookie` IPC 拒绝写入。

### 构建 / 运行

- Windows PowerShell 下 pnpm 必须带 `$env:pnpm_config_verify_deps_before_run='false'`。
- 后端统一入口是 `dist-main/index.cjs`（由 `src/main/index.ts` 经 esbuild 打包）；改 `src/main` 后必须 `pnpm build:main` 才能让 Electron 和冒烟测试生效。
- `pnpm build` 会清空并重建 `../nebula-outputs/`（README 等内容需在构建后重写，见构建脚本说明）。
- **构建产物在仓库外**：`pnpm build` 输出到同级目录 `../nebula-outputs/index.html`（本机 `E:\CUFE\vibecoding\nebula-outputs`）；而 `pnpm qa` 正是读取这个文件，所以**必须先 build 再 qa**。两个工作区（main / UI）共用这一个路径、会互相覆盖——一个工作区刚 build 完，另一个若只跑 qa，测的是别人的产物。
- 项目已接入 git；远程已迁移到 `github.com/violetsnowl/nebula`（旧地址 `a161858970-ux/nebula` 自动重定向，本地 origin 已更新）；文档随提交维护（docs/）。

### 前端样式与舞台渲染（2026-11 沉淀）

- **全局元素选择器会污染新组件**：`button:hover` 这类全局规则会层叠到所有按钮上（P1 播放条的"乱发光"就是这样来的）。新组件的状态写在组件自己的类上，不要依赖全局规则兜底。
- **卡片滤镜会让卡片发虚**：只要 `filter` 不是 `none`（哪怕 `blur(0.3px)`），卡片就会先按原尺寸栅格化再放大。焦点圈内必须是 `filter: none`，不能是 `blur(0)`。
- **舞台状态别用 class 做命令式开关**：MusicCard 由 React 渲染，舞台帧循环又会命令式地改 DOM。React 重新渲染时会用自己（可能过期）的计算结果整串覆盖 `className`。景深一类随位置变化的状态，一律写成 CSS 变量（`--card-filter` / `--blur` / `--scale`），由帧循环统一写入。
- **舞台 `.stage-3d` 本身就是层叠上下文**（`position:absolute; z-index:10`）：hover 卡片的 `z-index:10000` 只在舞台内部比较，盖不住播放条。
- **backdrop-filter 嵌套会失效**：带 `backdrop-filter`（以及 filter、opacity<1、mask 等）的元素是它内部元素的"背景采样边界"，嵌在里面的弹层采不到边界外的画面。玻璃材质一律画在 `::before` 上（`.glass-g1::before`），元素本身不带 backdrop-filter。
- **`-webkit-backdrop-filter` 在 Chromium 里是 `backdrop-filter` 的别名**：两者都写时，后写的生效。带 `url(#滤镜)` 的无前缀写法必须放在最后，否则折射会被覆盖掉。
- **`<button>` 不写 `background` 会露出浏览器默认灰底**：旧播放键的"灰色实心圆"就是这样来的。所有自定义按钮都要显式写 `background: none`。
- **渐变填字（`background-clip:text` + `color:transparent`）时，`text-shadow` 画在字形上面**：深色阴影会给字蒙一层灰。中性描边或羽化用父元素的 `filter: drop-shadow()`；`text-shadow` 只留给有意要叠在字上的彩色柔光。
- **收起的面板里，输入框可能还留着焦点**：比如手动导入后左 Dock 收起，`document.activeElement` 仍是那个输入框。判断"用户是否正在打字"时，要同时检查输入框可见（`getClientRects().length > 0`），并且可操作（computed `pointer-events` 不是 `none`）。否则静止检测会被一直挡住。
- **根元素上命令式加的状态用 `data-*`，不用 class**：`.app` 的 `className` 由 React 管理，重新渲染时会被整串覆盖。交接引擎写的是 `data-listen-*` 属性和 `--lk` 这类 CSS 变量。
- **右 Dock 窗口没有高度上限**：原型块只给左 Dock 做了「固定高度 + 窗口内滚动」。设置页内容变高后，在 900px 高的窗口里会超出屏幕。已在文件末尾加覆盖规则（`max-height: calc(100vh - 180px)` 加内部滚动），原型块本身没改。
- **新组件的样式要限定作用域**：`styles.css` 里留着大量历史全局类名（`.row`、`.group`、`.pl-head`、`.dot`…），新面板沿用同名类会被它们层叠污染（例如 `.row` 被设成纵向排列）。侧面板的样式一律写成 `.sd-panel .xxx`，右侧专用类加 `rp-` 前缀。
- **"导入完成"和"歌已经能看"不是一回事**：按 id 导入歌单时，歌曲在请求返回的那一刻就写进曲库，但 `importStatus` 要等星云约 4 秒的卡片揭示结束才变成 done。界面判断"能不能显示歌曲列表"应看当前歌单是否已经切换，不要等导入状态。
- **G3 面板里再套一层毛玻璃不会生效**：侧面板自身带 `backdrop-filter`，里面的元素再写 `backdrop-filter` 时，背景模糊在 Chromium 里不起作用（无论放在滚动区里面还是外面，2026-11-13 实测）。面板里需要「浮在内容上的栏」时，栏直接落在面板玻璃上，把下面的内容用 `mask-image` 淡出（歌单详情紧凑栏的做法），不要做毛玻璃底条。
- **带内边距的滚动区里，`position: sticky; top: 0` 停在内边距以内**：`.sd-scroll` 顶部有 16px 内边距，sticky 元素停在离顶边 16px 处，不是贴边。需要贴边的浮层放到滚动区外面。
- **QA 的帧耗时受本机负载影响很大**：同一个构建，不同时间跑可能从 4ms 变成 9ms。判断某个改动有没有拖慢性能，要在同一时间段把改动前后的构建各跑一遍对比。
- **舞台卡片不要带 backdrop-filter**：旧卡片每张都有 `backdrop-filter: blur(14px)`，几十张同时渲染开销很大。P2 去掉后，空闲帧耗时从 6.6ms 降到 4.4ms。需要玻璃的只有 hover 时那颗播放球，而且只在 hover 时注册折射滤镜。
- **测试数据里的歌曲直链会过期**（网易云直链有效期约数小时，过期返回 403），真实数据截图前要先重新取数据。

### 工作区 / 多工作树（2026-10 沉淀）

- **共享 `.git`**：main 与 UI 服务两个工作区属于同一个仓库，在任一处 `git checkout` 会改变另一处的分支状态。现象：切了分支后另一个目录"像被回退到旧版本"。规避：两个目录各自固定在自己的分支上。
- **工作树目录改名 → 注册失效**：`git worktree list` 显示 `prunable`，旧路径下的 git 操作异常。解决：`git worktree repair <改名后的路径>`。
- **Windows 长路径导致工作树删不掉**：`git worktree remove --force` 删除含 `node_modules` 的工作树时报 `Filename too long`。解决顺序：① `git config core.longpaths true` 后重试；② 仍失败则用 `robocopy <空目录> <目标> /MIR /NFL /NDL /NJH /NJS /NP /R:0 /W:0` 清空（robocopy 原生支持超长路径），再用非递归方式删除空壳。注意 `Remove-Item -Recurse -Force` 在受管环境可能被安全策略拦截，可改用 `[System.IO.Directory]::Delete($path, $true)`。
- **删除前先确认远端有备份**：移除工作树或目录前，用 `git ls-remote --heads origin <branch>` 确认分支已推送；本地 `node_modules`、`dist` 都可再生。

### QA 脚本的本机依赖（换机器必改）

- `scripts/qa.cjs` 与 `scripts/desktop-play-smoke.mjs` 顶部硬编码了两处路径：Chrome 可执行文件、Codex runtime 的 `node_modules`（`playwright-core` / `pngjs`）。换机器或换 harness 需先改这两处，否则 QA 直接报错（与业务代码无关）。outputs 目录已于 2026-11 改为相对路径 `../nebula-outputs`（与 `vite.config.ts` 的 `outDir` 保持一致，改一处须同步另两处）。

### 平台登录

- QQ 扫码（ptlogin2）为实验性实现，可能随 QQ 风控变化失效。
- QQ“我的歌单”必须走 musicu.fcg POST（music.musicasset.PlaylistBaseRead/GetPlaylistByUin，备用 UserSonglistService）；旧的 fcg_user_created_diss 登录态下已返回空列表。
- QQ 退出登录需同时清空 `persist:qq-music-login` 分区（cookies+localstorage），否则官方登录窗口会残留旧账号自动登回。
- Spotify 需要 `SPOTIFY_CLIENT_ID` 环境变量，未配置时登录按钮提示失败。
- 酷狗登录：已完成（Electron 独立登录窗口 + 凭证捕获 + 分区 Cookie 清理）；四路取链 + VIP 探测已实现。
- 汽水登录：已完成（签名引擎 + 扫码 + 凭证捕获；曾遇 2046 二次验证，现正常）。汽水**取链已放弃**（服务端按出口 IP 风控），歌单播放走网易云/QQ 兜底 + 多平台 VIP 路由。

## 待办 / 后续方向

- [ ] 网易云 eapi 未来若被风控，接入 weapi 自动降级（weapi 通道已实测可用，代码已内置 `buildWeapiRequest`）。
- [ ] 登录 Cookie 加密存储（keytar / DPAPI）替代明文 JSON。
- [x] 歌词面板上下分区与高亮联动（NowPlayingPanel 已实现上下分区、当前行双高亮、翻译跟随）。
- [x] ~~收藏/喜欢状态持久化与“我喜欢”歌单联动~~ → **已废弃**（2026-08-30 用户决定彻底删除收藏功能：不做平台写回，也不做播放器内部收藏；随 Player P2 重写 NowPlayingPanel 时清除 `liked` 接线）。
- [x] 播放列表队列 UI（UI 分支 Player P1 已完成：常显入口 + 当前项/即将播放、点击跳播、仅即将播放可移除、「下一首播放」FIFO）。
- [x] 评论弹窗/面板渲染（已完成：底部条评论入口 → 评论页；后端 `fetchComments` 已就绪）。
- [x] 左右 Dock 重构（小球 → 胶囊 → 窗口已完成并整合主项目，见 `docs/design/UI_SPEC.md` §5.7）。
- [ ] Nebula Player 重构剩余阶段（P2–P8，见 UI 分支 `docs/design/PLAYER_IMPL_PLAN.md`）；挂起决策：播放模式循环顺序（现「顺序→单曲→随机」vs 文档「顺序→随机→单曲」）。
- [ ] 「液态玻璃」主题：已定为默认主题（`docs/design/NEBULA_UI_SYSTEM.md` §3，磨砂 / 液态为同一模型两组参数），随全局重构 P1 实施。
- [ ] **全局 UI 重构（当前主线）**：真源 `docs/design/NEBULA_UI_SYSTEM.md` v1.0 已于 2026-11-09 冻结；按其 §13 分批实施（P0 清障 → P1 材质与环境 → P2 星云卡片 → P3 歌词字体 → P4 面板与 Dock），全局重构验收合格后回到 Player P2。GPT 母稿已归档（`docs/design/archive/`，非真源）。
- [ ] `README.md` 目前是开发期版本；正式定稿与 CI/CD 流程留到收工阶段。

> 已废弃（不再排期）：Z1 大字号左→右长句「提前检测 + 提前入场」方案（旧第 9/10 点，2026-08-19 用户确认不需要，详见 `docs/design/LYRICS_SYSTEM.md` §8）。
