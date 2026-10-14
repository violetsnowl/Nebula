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
- `pnpm build` 会清空并重建 `outputs/music-nebula/`（README 等内容需在构建后重写，见构建脚本说明）。
- **构建产物在仓库外**：`pnpm build` 输出到 `wo/outputs/music-nebula/index.html`；而 `pnpm qa` 正是读取这个文件，所以**必须先 build 再 qa**。两个工作区（main / UI）共用这一个路径、会互相覆盖——一个工作区刚 build 完，另一个若只跑 qa，测的是别人的产物。
- 项目已接入 git；远程已迁移到 `github.com/violetsnowl/nebula`（旧地址 `a161858970-ux/nebula` 自动重定向，本地 origin 已更新）；文档随提交维护（docs/）。

### 工作区 / 多工作树（2026-10 沉淀）

- **共享 `.git`**：main 与 UI 服务两个工作区属于同一个仓库，在任一处 `git checkout` 会改变另一处的分支状态。现象：切了分支后另一个目录"像被回退到旧版本"。规避：两个目录各自固定在自己的分支上。
- **工作树目录改名 → 注册失效**：`git worktree list` 显示 `prunable`，旧路径下的 git 操作异常。解决：`git worktree repair <改名后的路径>`。
- **Windows 长路径导致工作树删不掉**：`git worktree remove --force` 删除含 `node_modules` 的工作树时报 `Filename too long`。解决顺序：① `git config core.longpaths true` 后重试；② 仍失败则用 `robocopy <空目录> <目标> /MIR /NFL /NDL /NJH /NJS /NP /R:0 /W:0` 清空（robocopy 原生支持超长路径），再用非递归方式删除空壳。注意 `Remove-Item -Recurse -Force` 在受管环境可能被安全策略拦截，可改用 `[System.IO.Directory]::Delete($path, $true)`。
- **删除前先确认远端有备份**：移除工作树或目录前，用 `git ls-remote --heads origin <branch>` 确认分支已推送；本地 `node_modules`、`dist` 都可再生。

### QA 脚本的本机依赖（换机器必改）

- `scripts/qa.cjs` 与 `scripts/desktop-play-smoke.mjs` 顶部硬编码了三处路径：Chrome 可执行文件、Codex runtime 的 `node_modules`（`playwright-core` / `pngjs`）、`wo/outputs/music-nebula` 目录。换机器或换 harness 需先改这三处，否则 QA 直接报错（与业务代码无关）。

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
- [ ] 未来「液态玻璃」第二套主题（见 `docs/design/UI_SPEC.md` §9，两套主题布局一致、仅材质差异）。
- [ ] **等用户的全局 UI 底层重构母稿**：母稿到位后先做全局底层 UI 重构（验收合格），再回到 Player P2；这是当前唯一阻塞项。
- [ ] `README.md` 目前是开发期版本；正式定稿与 CI/CD 流程留到收工阶段。

> 已废弃（不再排期）：Z1 大字号左→右长句「提前检测 + 提前入场」方案（旧第 9/10 点，2026-08-19 用户确认不需要，详见 `docs/design/LYRICS_SYSTEM.md` §8）。
