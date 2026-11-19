# Music Nebula — 项目总览与开发手册

> 可视化 3D 音乐播放器（桌面版 Electron + 前端 3D 卡片星云墙）。
> 本文档与 `HANDOFF.md`、`CHANGE_LOG.md`、`NOTES.md`、`NEBULA_UI_SYSTEM.md`（全局 UI 真源）、`LYRICS_SYSTEM.md` 配套维护：每次代码变更必须同步追加变更日志；跨模型/跨 agent 接手先读 `HANDOFF.md`。

## 1. 项目定位

一个全屏的音乐星云播放器：

- 主界面是一片首尾相接、没有尽头的封面星云（`NEBULA_UI_SYSTEM` §8.0）：三种排法（按颜色默认 / 按歌手 / 随机），镜头中心有透镜，可拖动、缩放（有上下限），搜索时镜头飞到命中的星团。旧的「周期回绕卡片墙 + 径向鱼眼」已在 #139 删除。
- 底部播放条（液态 / 磨砂玻璃），全局 AudioPlayer 单例驱动；点封面进入整屏听音空间（大封面一镜到底、歌词阅读栏、右栏原地详情和评论）。
- 支持网易云 / QQ 音乐 / 酷狗 / 酷我 / 波点 / 汽水 / Spotify / YouTube Music / Apple Music 九个平台账号登录，登录后自动拉取「我的歌单」；左侧 Dock 管歌单与导入，右侧 Dock 管账号与设置。
- 歌单、音源、歌词、评论、歌曲详情通过统一 Adapter 接入；本平台取不到时按「同一录音」跨平台兜底（SongResolver / LyricService），完成度见 `PLATFORM_MATRIX.md`。
- 歌曲详情 / 歌手主页 / 专辑页 / 评论页已接入。

## 2. 技术栈与结构

React 18 + TypeScript + Vite（单文件构建）+ Electron 43 + esbuild（主进程打包）。

```
music-nebula/
├─ src/
│  ├─ main/                    # 主进程 / Node 后端逻辑（纯 TS，可独立于 Electron 运行）
│  │  ├─ adapters/             # 平台适配器：netease / qq / kugou / spotify + 字段映射 mappers
│  │  ├─ encrypt/ncmCrypto.ts  # 网易云 weapi / eapi 加密（AES/RSA/MD5，登录与后续加密接口共用）
│  │  ├─ login/                # 多平台登录适配器（neteaseLogin / qqLogin / index）
│  │  ├─ parsers/              # LRC 歌词解析、双语时间轴归并
│  │  ├─ services/             # SongResolver（音源兜底）、LyricService
│  │  ├─ cookieStore.ts        # 按平台隔离 + 原子写入持久化
│  │  ├─ http.ts               # 统一请求层：Referer/UA 伪造 + Cookie 注入 + JSON/表单
│  │  ├─ ipc.ts                # IPC 处理器（playlist / login / cookie / lyric / comment）
│  │  └─ index.ts              # 后端统一出口（esbuild 打包为 dist-main/index.cjs）
│  ├─ components/              # 视图区块：舞台、歌词层、两侧 Dock、听音空间（listen/）、播放条（player/）、弹窗
│  ├─ hooks/                   # 领域 hooks（按 src/hooks/<domain>/，见 ARCHITECTURE.md）
│  ├─ lib/                     # 前端核心：space/（星云）/ listen/（歌词阅读栏）/ glass/（材质）/ panEngine / audio / playlist
│  └─ App.tsx 等
├─ electron/
│  ├─ main.cjs                 # Electron 主进程：窗口、网络拦截（防盗链）、登录接线
│  └─ preload.cjs              # contextBridge 暴露 nebulaAPI
├─ scripts/
│  ├─ backend-smoke.mjs        # 后端冒烟测试（解析/映射/加密/兜底/IPC）
│  ├─ qa.cjs                   # 前端自动化 QA（无头 Chrome：密度/鱼眼/平移/播放/容错）
│  ├─ desktop-check.mjs        # 桌面版启动前环境自检
│  ├─ desktop-play-smoke.mjs   # 桌面版播放链路冒烟（需 Playwright）
│  ├─ check-arch.mjs           # 架构依赖守卫（Dependency Rules 机制化执行）
│  ├─ live-check-new.mjs       # 在线链路验证（转译路由/歌手全曲/评论分页/头像）
│  └─ qq-live-check.mjs        # QQ 实账号链路验证（需自备 Cookie）
├─ docs/                       # 项目文档：project / design / meta 三类（入口 docs/README.md）
├─ AGENTS.md                   # AI 协作者自动加载的恢复入口与硬性约定
├─ README.md                   # GitHub 展示版（开发期，随进度更新）
├─ dist/                       # 桌面版前端构建产物
├─ dist-main/                  # 主进程打包产物
└─ ../nebula-outputs/          # QA/预览产物（在仓库外的同级目录，pnpm build 每次重建）
```

## 3. 常用命令（Windows PowerShell）

```powershell
$env:pnpm_config_verify_deps_before_run='false'   # pnpm 环境必带

pnpm build            # tsc 类型检查 + vite 构建 -> ../nebula-outputs/index.html
pnpm build:main       # 仅打包主进程 -> dist-main/index.cjs
pnpm build:desktop    # 完整桌面构建（dist + dist-main）
pnpm desktop          # 环境自检后启动 Electron 桌面版
pnpm qa:backend       # 后端冒烟测试（自动先 build:main）
pnpm qa               # 前端自动化 QA（无头 Chrome，需本机 Chrome）
pnpm check:arch       # 架构依赖守卫（pnpm qa 已包含）
pnpm qa:live-new      # 在线链路验证（跨平台转译 / 歌手全曲 / 评论分页 / 头像）
pnpm qa:qq-session    # QQ 脱敏诊断（必须传 --profile=仓库外凭据副本目录）
pnpm qa:desktop-play  # 桌面播放链路冒烟
pnpm qa:playback-live # 默认 108 条公开跨平台挑战样本联网统计
```

播放回归：`node scripts/player-regression.mjs`（已纳入 `qa:backend`）。联网统计：`pnpm qa:playback-live` 默认读取已提交的 108 条公开挑战样本，统计写到仓库同级 `benchmark-result.json`。需要重新采集搜索样本时，先 `pnpm build:main`，再 `node scripts/playback-benchmark.mjs --prepare`，然后用 `--samples=../benchmark-samples.json` 显式选择新数据集。也可用 `--samples=... --out=... --backend=... --profile=...` 指定同一测试集、冻结后端或只含测试凭据副本的目录；脚本不打印直链或歌词原文。

换机器运行浏览器 QA 时，可设置 `NEBULA_QA_MODULES` 为包含 `playwright-core` 与 `pngjs` 的依赖目录，`NEBULA_CHROME` 为 Chromium/Chrome 可执行文件；不设置时保留原机器路径。也可在项目本地安装这两个测试依赖。演示曲目的音频地址仍是 SoundHelix，但 QA 里由本地静音 WAV 代替（#193），不需要联网。

> Node 运行时：`C:\Users\LIU\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`
>
> 产物路径易踩：`pnpm build` 输出到仓库外的同级目录 `../nebula-outputs/`（本机 `E:\CUFE\vibecoding\nebula-outputs`），桌面版则用 `pnpm build:desktop`（输出到 `dist/` + `dist-main/`）。`pnpm qa` 读取的是 outputs 里那份产物，**先 build 再 qa**。
>
> 远程仓库：`github.com/violetsnowl/Nebula`（2026-11-14 改名；2026-10 由 `a161858970-ux/nebula` 迁移；旧地址都自动重定向）。

## 4. 关键架构决策（改动前必读）

### 4.1 布局 / 视觉（前端）

- 星云由 `src/lib/space/` 实现（`world.ts` 首尾相接的画布与排法、`lens.ts` 透镜、`stars.ts` 小封面画布），`useStage` 的帧循环驱动；屏幕上 56px 以下的卡片画在画布上，DOM 卡片上限 140 张（见 NOTES「舞台卡片的 DOM 成本」）。视觉与参数以 `NEBULA_UI_SYSTEM` §8 为准。
- 背景系统：环境光（封面取色）/ 雾中封面 / 自定义图片 / 壁纸库，选择持久化到 localStorage。

### 4.2 登录（重要！易踩坑）

- **网易云登录必须走 eapi 加密接口**（`POST https://interface.music.163.com/eapi/login/qrcode/unikey` 等，参数 `type=3`），旧明文接口 `music.163.com/api/login/qrcode/*` 已废弃：扫码确认后返回“请切换其他登录方式或升级新版本再试”。
- eapi 请求需携带设备 Cookie（osver / deviceId / WNMCID / appver 等）与客户端 UA，见 `src/main/encrypt/ncmCrypto.ts`。
- 扫码流程：`createQr()` 返回 `{ unikey, payload }` → 前端本地生成二维码 → `pollLogin(unikey)` 轮询（801 等待 / 802 已扫待确认 / 803 成功）。
- 登录成功后 cookie 存入 `CookieStore`（按平台隔离，明文 JSON，位于 `app.getPath('userData')`）。
- QQ 走官方登录页（独立分区 `persist:qq-music-login`）扫码，读取分区 Cookie 落库；ptlogin2 扫码为实验性。
- 酷狗：手机端扫码登录（#164），歌单接口只认手机端票据。
- 汽水：扫码登录（签名引擎）。
- Spotify：OAuth，默认用 Spotify 桌面客户端的公开 Client ID（#165），设了 `SPOTIFY_CLIENT_ID` 环境变量则用自己的；账号和歌单走 Spotify 自家查询服务（#171）。

### 4.3 音源 / 防盗链

- Electron 主进程用 `webRequest.onBeforeSendHeaders` 对音乐平台域名注入 Referer/Origin/UA，并放开 CORS 响应头。
- 音源失败链路：主平台取 URL → 失败则 SongResolver 用歌名+歌手跨平台搜索兜底 → 前端 `<audio>` onerror 触发 skipNext + 卡片置灰。

### 4.4 测试约定

- 后端整修回归：`pnpm qa:backend` 包括播放代次、路由/代理、录音匹配、QQ 契约、歌词、封面隐私、五平台导入。
- 联网统计：`pnpm qa:playback-live --samples=scripts/fixtures/public-playlists.json`（100 首公开榜单）；`public-benchmark.json` 为 108 首跨平台挑战集。输出默认在仓库外；切勿提交私人账号的歌曲列表或原始凭据。
- 原生媒体：先 build，再 `pnpm qa:media`；可传 `--baseline=../baseline-ui` 比较归档源码。固定本地 WAV 与延时，输出媒体事件间隔和舞台帧时间，不宣称声卡实际延迟。
- 原生桌面：`pnpm qa:electron` 使用仓库外隔离 userData、隐藏窗口与合成 WAV，不碰原账号文件。
- 界面播放回归：`pnpm qa:ui-playback`（已纳入 qa）以真实 React/Chrome 运行生产组件，覆盖歌词中段切歌的旧下标竞态、加载/缓冲按钮意图和QQ过期提示，不依赖在线演示音频。
- 有效期真实对照：`pnpm qa:valid-source --baseline=dist-main/round1.cjs`，真实等待125秒后暂停续播和拖动；冻结后端必须由41c1404构建，未传baseline时只测当前版。
- QQ会话诊断：`pnpm qa:qq-session --profile=../qq-copy --samples=../qq-samples.json --out=../qq-session.json`。只读取仓库外凭据副本；样本可选，默认最多10首QQ曲目、各三档。仅输出字段存在性、接口码、会员/登录状态、可播统计；缺凭据明确未运行，不当通过。自动续期评估见整修报告§13.5。
- 长暂停：先 build，再 `pnpm qa:long-pause`；真实等待 31 分钟，验证过期地址重取与拖动。
- 封面统计：`node scripts/playback-benchmark.mjs --covers-only`；加 `--baseline-cover` 测原 URL。仅输出实测像素，不输出下载图片。
- 交付报告与证据：`docs/project/BACKEND_OVERHAUL.md`；`node scripts/summarize-overhaul.cjs` 可从随报告提交的脱敏 JSON 重算对照指标。`unavailable-public.json` 是另列的公开不可用案例，不混入原来的两组样本分母。

- 任何后端改动：`pnpm qa:backend` 必须通过；加密类改动需同步在 `backend-smoke.mjs` 补充断言。
- 任何前端交互改动：`pnpm qa` 必须通过（有严格阈值断言）。
- 每次改动后同步更新 `docs/project/CHANGE_LOG.md`（见第 5 节）。

## 5. 文档维护约定

1. 每次会话/每次改动完成时，向 `docs/project/CHANGE_LOG.md` 追加一条记录（日期、目标、改动、验证、遗留）。
2. 若出现新的踩坑经验或平台接口变动，同步更新 `docs/project/NOTES.md`。
3. 架构级变化（新模块、新目录、新依赖）同步更新本文件第 2/3 节。
