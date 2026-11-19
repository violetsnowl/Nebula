# Apple Music 接入交接（2026-11-18，#188）

> **2026-11-19 状态（#191）：已按路线 A 接入**，用户 2026-11-19 拍板路线 A。第五节的实验全部通过（MusicKit 在没有 Widevine 的 Electron 里能初始化、未登录能读目录、Apple ID 能在页面里登录、重启后仍登录），资料库用用户有订阅的日常账号实测通过。实现说明见 `ARCHITECTURE.md`「Apple Music（#191）」，踩坑见 `NOTES.md`「Apple Music」。和本文假设不同的实测结论：
> - Electron 43 下只有 `mk.api.music`，没有 `mk.api.v3`；登录在页面里完成，不弹新窗口。
> - 没有有效订阅时资料库接口一律 400 + `40015`（用户第一个测试号就是），所以「我的歌单」需要有效订阅。
> - 资料库曲目自身没有 isrc，要加 `include=catalog` 从对应的目录曲目拿；资料库歌单不给曲目数。
> - 自己上传、匹配不上目录的歌只有歌名，跨平台基本找不到。
> 剩下的：本平台逐字歌词（`syllable-lyrics`）、本平台出声（要原生宿主）、搜索——归第二阶段。下文保留为当时的调研记录。

> 用途：平台扩展的最后一家。上一轮会话（#180–#187，接完酷我、波点、YouTube Music）为 Apple Music 做的调研全部记在这里，新会话照着做，不必重新调研。
> 第一阶段目标和前三家一样：**能登录、能看到我的歌单、歌单里的歌能放**（歌从哪取、歌词从哪来不限，播放走跨平台兜底）。

## 一、已定的事

- 顺序：酷我 → 波点 → YouTube Music → **Apple Music（最后）**。前三家已接完并验收（YouTube Music 2026-11-18 用户登录成功、资料拉取正常，#187 修了重启掉登录）。
- 用户有 Apple ID 且订阅了 Apple Music，可以本人登录做实测（2026-11-18 回答）。
- 2026-11-18 问过用户「开发者令牌走哪条路」（官方开发者账号 / 借用网页播放器令牌 / 先放最后），用户选「先放最后」，**令牌路线还没定**——见第三节，开工前要请用户在推荐路线和备选之间确认。
- 用户偏好（适用于 Apple 登录的界面）：
  - 登录页要在软件里、风格统一（内嵌页面弹窗 `electron/embeddedSheet.cjs`，#183），不要另开带系统标题栏的窗口；
  - 需要浏览器授权的，用默认浏览器（复用浏览器里已有的登录），不开空白浏览器实例；
  - 步骤要写清楚，能一键的就一键（#186 设备码界面的做法）。
- 参考项目 folia 是 AGPL：**只借思路和参数，代码自己写**。

## 二、协议事实

- Apple Music API（`https://api.music.apple.com`）任何请求都要**开发者令牌**（JWT，最长 180 天，只能由 Apple Developer Program 账号的 MusicKit 密钥签出，年费 99 美元）。读用户资料库还要**用户令牌**（Music User Token，用户在 MusicKit 授权页登录后得到）。只有开发者令牌读不了个人资料库（Apple 开发者论坛有人提过需求，Apple 没给）。
- music.apple.com 网页播放器自带一个开发者令牌，页面里的 MusicKit JS 用它加用户登录后的用户令牌访问 API。Cider、Music Assistant 等开源播放器是从网页脚本里抓这个令牌来用的——违反 Apple 条款、改版会失效；上一轮在本机尝试抓取时被 Claude Code 的权限规则拦下（Unauthorized Access）。
- 页面内调用方式（folia 实测可用）：
  - `const mk = window.MusicKit.getInstance()`；新版 SDK 用 `mk.api.v3.music(path, query, { fetchOptions })`，旧版 `mk.api.music(path, query, fetchOptions)`，两种都要兼容。
  - 返回 `{ status, data }`；401 = 登录失效（要重新登录），403 = 这一次请求受限（地区、权益、这首歌），不是掉登录。
- 用得到的接口（路径都相对 `https://api.music.apple.com/`）：
  - 账号地区：`v1/me/storefront` → `data[0].id`（两位地区码，如 `cn`、`us`）；读不到 / 401 / 403 = 没登录。
  - 昵称头像：`v1/me/social-profile` → `data[0].attributes.name`（可能没有社交资料，那就没有昵称）。
  - 我的歌单：`v1/me/library/playlists?limit=&offset=&extend=tags`；`attributes.tags` 含 `favorited` 的是「喜爱」类歌单；分页看 `next`（相对地址，取里面的 `offset`），没有 `next` 就到头。
  - 歌单曲目：`v1/me/library/playlists/{id}/tracks?limit=&offset=`；只要总数用 `limit=1` 读 `meta.total`。
  - 资料库歌曲 / 专辑：`v1/me/library/songs?include=catalog`、`v1/me/library/albums`、`v1/me/library/albums/{id}/tracks?include=catalog`。
  - 目录（公开内容）：`v1/catalog/{地区}/songs/{id}`、`/albums/{id}`、`/albums/{id}/tracks`、`/artists/{id}`、`/artists/{id}/view/top-songs`、`/playlists/{id}`；逐字歌词 `v1/catalog/{地区}/songs/{id}/syllable-lyrics`（TTML，第二阶段值得接）。
- 曲目字段（`attributes`）：`name`、`artistName`、`albumName`、`durationInMillis`、`artwork.url`（模板，把 `{w}x{h}` 换成如 `1000x1000`）、**`isrc`**（跨平台找同一录音时非常有用，可直接用来匹配）、`playParams { id, kind, catalogId, isLibrary }`。资料库里的歌 id 是 `i.` 开头，目录 id 在 `playParams.catalogId` 或 `relationships.catalog.data[0].id`。
- 中国大陆网络：Apple 会把 `/cn` 以外的页面都重定向回 `/cn`。目录请求要用账号自己的地区（`v1/me/storefront` 读到的），不要用页面地区；页面地区和账号不一致时，MusicKit 只放试听或拒播（这条只影响 Apple 本平台播放，第一阶段不播 Apple 音频）。
- 本平台出声：音频有 DRM（Widevine / FairPlay）。官方 Electron 不带 Widevine CDM，内嵌页面放不了整首；folia 为此另做了原生宿主（macOS WKWebView、Windows WebView2，.NET Framework 4.8 + WebView2 Evergreen，用户 2026-11-04 在 Windows 11 实测能整首播放）。**第一阶段不做 Apple 本平台播放**，走跨平台兜底，与 Spotify / YouTube Music 一致。

## 三、令牌路线（开工前请用户确认）

| 路线 | 做法 | 好处 | 代价 |
|---|---|---|---|
| **A. 官方页面里读（推荐，folia 的做法）** | 用一个带独立持久分区的视图加载 music.apple.com，用户在 Apple 官方页面里登录；之后在页面里调 MusicKit 读资料库，结果（歌单、曲目）传回主进程。**令牌不离开页面、不提取、不落盘** | 免费；不抓令牌；登录在 Apple 自己的页面完成；资料库、目录、逐字歌词都能读 | 依赖网页播放器能在 Electron 里正常初始化（待实测）；Apple 改版可能要跟着改调用；后台要常驻一个隐藏页面 |
| B. 官方开发者账号 | 用户注册 Apple Developer Program（99 美元 / 年），生成 MusicKit 密钥，自己签开发者令牌；用户令牌通过 MusicKit JS 授权页取得 | 合规、稳定 | 要花钱；令牌最长 180 天要换；开发者令牌要随软件分发或由服务端签发 |
| C. 抓网页播放器令牌 | 从 music.apple.com 脚本里取内置令牌直接调 API（Cider 做法） | 免费、实现最简单 | 违反 Apple 条款；改版即失效；上一轮被本机权限规则拦下，**必须用户明确同意才能做** |

推荐 A：不花钱、不碰令牌、登录在官方页面，和前几家「官方页面登录」的体验一致。A 的第一个实验失败（见第五节）再请用户在 B、C 里选。

## 四、路线 A 的落地方案（沿用现有结构）

- 平台 ID 建议 `applemusic`，名称「Apple Music」，logo `docs/logo/Apple_Music_icon.svg.webp`，品牌色 `#fa243c`。改动点按 ARCHITECTURE「加一个平台要改的地方」逐项过；模板看前几家的接入提交：`git log --grep '#182'`（波点）、`git log --grep '#185'`（YouTube Music），再 `git show <提交>`。
- **页面引擎**：仿汽水签名引擎（`src/main/login/qishuiLogin.ts`、`electron/main.cjs` 里的汽水部分）——一个**从不挂到窗口上**的 `WebContentsView`，分区 `persist:applemusic-login`，加载 `https://music.apple.com/`；需要登录时把同一个视图交给 `sheetHost.open({ view })` 显示在内嵌弹窗里（`embeddedSheet.cjs` 支持接管外部视图，关闭时只摘下不销毁），登录完收起。
- **登录类型**：`kind: 'window'`（官方页面登录，和 QQ、酷我同类），成功判定 = 在页面里调 `v1/me/storefront` 拿到两位地区码。导航只放行 `music.apple.com`、`account.apple.com`、`appleid.apple.com`、`idmsa.apple.com`（folia 的白名单）。
- **读数据**：主进程用 `webContents.executeJavaScript` 在页面里执行一个受限的读取函数（只接受白名单里的操作和校验过的参数），返回精简后的 JSON；请求串行、带超时；页面还没准备好（`MusicKit` 不存在）时返回「未就绪」并重试。**任何时候都不把 musicUserToken 或开发者令牌带出页面、写日志或落盘**。
- **适配器**：
  - `getAccount`：storefront + social-profile → 昵称（没有社交资料就显示「Apple Music 用户」）、地区；401 → 过期。
  - `fetchMyPlaylists`：library/playlists 全量翻页；`favorited` 标签的排前面。
  - `fetchPlaylist`：library/playlists/{id}/tracks 翻页；Track 用 name / artistName / albumName / durationInMillis÷1000 / artwork 1000×1000 / isrc（放进 `extra`，以后给跨平台匹配用）。
  - `fetchSongUrl`、`fetchLyric` 返回 null（跨平台兜底），不要实现 `getAuthStatus`（理由同 YouTube Music：过期不该拒播）。
  - 链接导入：`music.apple.com/{地区}/playlist/{名字}/pl.xxx` → 目录歌单 `v1/catalog/{地区}/playlists/pl.xxx`（未登录时页面的开发者令牌应该也能读目录，待实测）。
- 封面域名 `*.mzstatic.com`（要加进 `coverService` 允许域名，并查跨域头）。
- 测试：新增 `scripts/applemusic-regression.mjs`（假的页面执行器，合成数据），接进 `qa:backend`；`import-regression` 加样例。

## 五、开工第一步：先做这个实验（需要用户配合登录）

1. 隔离空配置启动 Electron（参考 NOTES「真实数据测试的做法」和上一轮冒烟脚本的写法：`app.setPath('userData', 草稿目录)` 后 `require('electron/main.cjs')`），在内嵌弹窗里打开 `https://music.apple.com/`：
   - 页面能否正常加载，`window.MusicKit?.getInstance()` 是否存在（没有 Widevine 时 MusicKit 是否还肯初始化）；
   - 未登录时在页面里调 `v1/catalog/{地区}/playlists/{某公开歌单}` 能否读到。
2. 请用户在弹窗里用 Apple ID 登录：Apple 是否允许在 Electron 里登录（Google 不允许，Apple 未知）；双重认证弹窗是否正常。
3. 登录后在页面里调 `v1/me/storefront`、`v1/me/library/playlists`、某歌单 `/tracks`，只输出计数和字段名，不打印令牌和个人数据。
4. 关掉软件重开，确认分区里的登录还在（持久化）。

- 1–4 都通过 → 按第四节实现。
- 第 1 步 MusicKit 不初始化，或第 2 步登录被拒 → 停下，把结果告诉用户，请用户在路线 B / C 里选（或考虑 folia 那样的原生 WebView2 宿主，工作量大得多）。

## 六、参考资料位置

- folia 的 Apple 模块（临时目录，随时可能被清掉）：`C:\Users\LIU\AppData\Local\Temp\claude\1d5f8760457c2442\5b683da8-416a-4e84-8a51-668dbd7b2e6f\scratchpad\ref\folia\electron\appleMusic\`
  - `README.md`：总体设计（本文第二、三节已摘要）；
  - `companionRequests.cjs`：页面内读取函数（操作白名单、`mk.api.v3.music` / `mk.api.music` 兼容、各接口路径、分页校验、401/403 区分、字段精简）；
  - `companionStorefront.cjs`：账号地区对齐（只关系 Apple 本平台播放）；
  - `windows/`：WebView2 原生宿主（只有要做 Apple 本平台出声时才需要看）。
- 网上资料：Apple 开发者论坛「Feature Request: Long-Lived Access to Personal Apple Music Data」（developer.apple.com/forums/thread/777549）——只有开发者令牌读不了个人资料库；applemusic-mcp 项目说明——网页播放器令牌与 Cider、Music Assistant 同源。

## 七、规矩（与前几家一致）

- 真实账号测试只用账号配置的副本，不碰真实目录；副本里先删掉 `spotify` 一项（Spotify 续期令牌一次性，副本续期会吊销用户的登录）。
- 不打印、不提交任何令牌、Cookie、签名地址；凭据不进仓库。
- 每步 `pnpm build` + `pnpm qa:backend` + `pnpm qa` 全绿后独立提交，追加 CHANGE_LOG，同一次提交更新 `PLATFORM_MATRIX.md`（加「Apple Music」列）；推送到 main。
- 回复结尾附 `pnpm build:desktop`、`pnpm desktop` 两个命令块。
