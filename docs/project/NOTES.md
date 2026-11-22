# Music Nebula — 踩坑记录与待办

## 已知坑（遇事优先查这里）

- **URL缓存期限不等于音频失效期限（#B11）**：解析缓存两分钟仅决定是否重用解析结果，不得用 min(cacheTTL, upstreamExpiry) 给播放器写 expiresAt。播放器按每首每个URL记取源时间，不能沿用上一首的全局 loadedAt。无上游期限时的平台默认值只是客户端保守策略，不是实测CDN承诺；真实125秒对照可用 `qa:valid-source` 复测。
- **QQ网页授权、音乐登录、会员和单曲授权是不同证据（#B13）**：有uin或公开昵称不能证明音乐票据有效；p_skey/skey及OAuth token不能替代authst。统一使用qqCredential取身份/播放票据，会员查询只解析当前账号块；空purl本身不能证明过期或无会员。明确AUTH_EXPIRED停止兜底/自动跳歌；未知保持unknown。诊断用 `qa:qq-session --profile=仓库外副本 --out=仓库外结果`，不要在命令行粘贴真实Cookie。

### 网易云接口（重要）

- **明文扫码接口已废弃**：`music.163.com/api/login/qrcode/unikey|client/login` 扫码确认后会报「请切换其他登录方式或升级新版本再试」。必须使用 eapi（`interface.music.163.com/eapi/...`，`type=3`）或 weapi 加密接口。
- eapi 请求必须带设备 Cookie（`osver / deviceId / WNMCID / _ntes_nnid / _ntes_nuid / appver`）与客户端 UA，否则可能触发风控或返回异常。
- 登录成功凭证可能在响应的 JSON `cookie` 字段，也可能在 Set-Cookie 头；两者都要收集合并。
- **网易云主路径已切换到成熟库 `@neteasecloudmusicapienhanced/api`**：直接 require 其 module 函数 + `util/request`（不用起 Express 服务）。启动前必须先写 `os.tmpdir()/anonymous_token`（空文件）并调 `generateConfig()`；esbuild 需 `--external:@neteasecloudmusicapienhanced/* --external:qrcode`。
- 歌单详情 v6 接口默认只回 10 首，需用 `trackIds` 分 100 首一批调 `/api/v3/song/detail` 补全。
- 无版权/VIP 时 `/api/song/enhance/player/url` 返回占位地址（`music.163.com/song/media/outer/url...`），需判定为失败并触发兜底。
- 取链音质：`song_url_v1` 的 level 体系（jymaster/sky 需 SVIP，hires/lossless 需 VIP），匿名仅 standard/exhigh；`freeTrialInfo` 存在即试听片段。
- 音频播放必须走主进程 `AudioProxy`（`http://127.0.0.1:port/api/audio?url=...`），禁止把平台原始 URL 直接喂给 `<audio>`；代理白名单外域名返回 403。
- Cookie 校验：netease 必须含 `MUSIC_U`；qq 必须含有效音乐账号（uin/wxuin或成对musicid）与音乐播放票据（qm_keyst/qqmusic_key/music_key/musickey/wxskey），否则 `setCookie` IPC 拒绝写入。p_skey/skey不再算音乐登录成功。

### 构建 / 运行

- Windows PowerShell 下 pnpm 必须带 `$env:pnpm_config_verify_deps_before_run='false'`。
- 后端统一入口是 `dist-main/index.cjs`（由 `src/main/index.ts` 经 esbuild 打包）；改 `src/main` 后必须 `pnpm build:main` 才能让 Electron 和冒烟测试生效。
- `pnpm build` 会清空并重建 `../nebula-outputs/`（README 等内容需在构建后重写，见构建脚本说明）。
- **构建产物在仓库外**：`pnpm build` 输出到同级目录 `../nebula-outputs/index.html`（本机 `E:\CUFE\vibecoding\nebula-outputs`）；而 `pnpm qa` 正是读取这个文件，所以**必须先 build 再 qa**。
- 项目已接入 git；远程为 `github.com/violetsnowl/Nebula`（2026-11-14 改名；旧地址 `violetsnowl/nebula`、`a161858970-ux/nebula` 自动重定向，本地 origin 已更新）；文档随提交维护（docs/）。

### 在线搜索补平台（2026-11-21，#224）

- **酷狗的歌手相关接口都在 `mobilecdn.kugou.com`，且只有 http 通**：`https://mobilecdn.kugou.com/api/v3/search/singer` 报 `fetch failed`，同一路径换 `http://` 就有数据。`singer/info`、`singer/album` 同理。别顺手统一改成 https。
- **酷狗没有「按歌手列全曲」的公开接口**：`singer/songs`、`singer/songlist` 都返回 `Access Denied`（HTML，不是 JSON）。歌手页的歌曲只能用「搜歌手名」代用，所以不会是全量。
- **酷狗歌手头像 `imgurl` 带 `{size}` 占位符**（`/softhead/{size}/...`），要替换成 `240` 才是真地址；不换会 404。
- **搜索「谁先返回谁占位」会让快平台吃掉全部名额**：酷狗 / 酷我约 130ms，网易云约 1.2 秒，直接并行 push 的结果是搜「周杰伦」6 条全是酷我 + 酷狗。必须按平台交错（每轮每家一条）再截断。
- **探针改了源码却没生效时，先看打包产物**：`esbuild` 打包的探针会把当时代码内联进去，改完 `src/` 必须重新打包探针才会变；另外 esbuild 会剥掉注释，用注释做「产物里有没有新逻辑」的判据会误判成没构建。

### 跨平台专辑兜底（2026-11-21，#223）

- **QQ 专辑搜索的 type 是 8，不是 10**：`client_search_cp` 传 `t=2`、`t=10` 都不返回专辑（`data.album` 缺失），只有 `t=8` 有。字段是 `albumMID / albumName / singerName / publicTime / song_count`，歌名里带 `<em>` 高亮标签要清。搜索词带歌手名召回更准（「范特西 周杰伦」）。
- **降权乘出来的分数会正好压在阈值上**：旧 `resolveAlbumByTitle` 在歌手对不上时乘 0.4，再 `filter(score > 0.4)`——乘完正好 0.4，一条不剩。实测搜《范特西》+ 周杰伦返回 null 就是这个原因。改打分规则时，降权系数和阈值要一起看，别让「正好等于」变成静默全灭。
- **「有专辑接口」不等于「能用」**：`fetchAlbumDetail` 只在有 `fetchAlbumDetail` 的适配器上生效，酷狗 / 酷我 / 波点 / 汽水都没有；前端却对每个平台都调这个 IPC，所以这些平台的专辑页本来就是空白，不是接口坏了。
- **专辑名带括注会优先撞上豪华版 / 精选集**：网易云搜 `1989` 会把 `1989 (Deluxe)` 排在前面。`albumTitleKey` 去掉括注是为了让「同名不同写法」能对上，代价是同名不同版更容易混淆；目前靠年份 ±1 和曲目数接近兜，仍不完美。

### 前端小坑（2026-11-21，#217–#221）

- **给带裁剪的容器整体缩放会露空**（#217）：`.stage-3d` 自带 `overflow:hidden`，星层画布和挂卡片范围都只有一屏大；整体 CSS `scale(0.86)` 后可见范围跟着缩，四周露空、边缘卡片被切。要「整片后退」就在舞台帧循环里按屏幕坐标算（`lens.applyXf`），和散开 / 退潮同一条路。
- **网格的 auto 列会被长文字撑宽**（#219）：`display:grid` 不写 `grid-template-columns` 时，子元素的 `max-width:100%` 会跟着失效、文字越界。锁成 `minmax(0, 1fr)`。
- **居中的父级会让列表也居中**（#221）：账号详情页 `.rp-detail` 是 `text-align:center`，里面的 `ol` 继承后序号和文字错位。列表、说明要自己写 `text-align:left`。末行只剩一个字用 `text-wrap: pretty`（Electron 支持）。
- **尾韵颜色要往「更亮」走**（#217）：同色系模式唱过 = 白、没唱 = 主色；尾韵若往主色褪，扫白的字会先变回主色再二次变白。
- **播放器里碰 `window` 要判断方法存在**（#220）：`scripts/player-regression.mjs` 用的模拟 window 没有 `addEventListener`，直接调用会让 `qa:backend` 挂掉。**改 `src/lib/audio/` 也要跑 `pnpm qa:backend`**（播放器回归在里面），不只是前端 QA。

### 不碰用户登录的截图 / 实测方法（2026-11-21）

- **看未登录界面的截图**：用户登录着、不方便退出时，仿 `scripts/electron-regression.cjs`：写一个 bootstrap 先 `app.setPath('userData', 空目录)`，再把 `BrowserWindow` 包成 `show:false`、1440×900，用 playwright 的 `_electron.launch` 启动 `electron/main.cjs`，对 `.sd-panel.sd-right` 截图。先 `pnpm build:desktop`（加载的是 `dist/`）。浏览器预览（`pnpm dev`）没有 `window.nebulaAPI`，登录页只显示标题，看不出真实样子。截图放草稿目录、用 SendUserFile 发给用户，**不进仓库**。
- **前端逻辑在真实数据上量化**（#218 长音统计）：把 `%APPDATA%\music-nebula\lyric-cache.json` 复制到草稿目录（最近听过的歌、最终合并后的歌词，最多 500 首），写一个 TS 脚本直接 import `src/lib/lyrics.ts` 的 `normalizeLyricLines` 和 `src/lib/listen/model.ts`，用仓库里的 `node_modules/.bin/esbuild --bundle --platform=node` 打包后跑。不联网、不碰真实配置。缓存样本偏 QQ 和英日文，韩语、小语种很少。

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
- **G3 面板里再套一层毛玻璃不会生效**：侧面板自身带 `backdrop-filter`，里面的元素再写 `backdrop-filter` 时，背景模糊在 Chromium 里不起作用（无论放在滚动区里面还是外面，2026-11-13 实测）。G3 的材质不能像 G1 那样挪到 `::before` 上解决：播放队列弹层自己是滚动容器，伪元素会跟着内容滚走。面板里需要「浮在内容上的栏」时，栏直接落在面板玻璃上，把下面的内容用 `mask-image` 淡出（歌单详情紧凑栏的做法），不要做毛玻璃底条。
- **订阅外部状态时，订阅后要立即同步一次**（2026-11-14，#106）：`PlaybackProvider` 在自己的 useEffect 里订阅 `audioPlayer`，而子组件的副作用先于它运行，会话恢复里 `audioPlayer.restore()` 发出的通知就丢了。App 因此一直以为没有当前歌，启动时把会话里的当前歌抹掉，下次启动只能从第一首开始。`useSyncExternalStore` 或「订阅后 sync 一次」都能避免。
- **CSS 自定义属性会继承**（#106）：`--glass-filter` 写在播放条上，嵌在里面的 G3 弹层 `backdrop-filter: … var(--glass-filter) …` 就用上了播放条的折射贴图。给容器写自定义属性时，要想到所有后代都会拿到它。
- **曲目 id 就是曲库下标**（#106）：换了曲库之后，旧的 id 指向的是新曲库里同一位置的另一首歌。播放器里留着旧歌（载入新歌单不打断播放、插播歌）时，用 `FOREIGN_SONG_ID`（-1），别让星云把不相干的卡片标成「正在播放」。
- **真实数据才会暴露的问题**（#106）：真实搜索接口会把命中词包成 `<em>…</em>`，QQ 评论里有 `[em]e400835[/em]` 表情代码，真实队列有七八百首。用户已允许用真实数据测试：复制一份用户数据目录到临时目录，用包装脚本 `app.setPath('userData', 副本)` 启动，不碰真实目录。
- **QA 里只打印、不断言的步骤等于没测**（2026-11-13，#105）：底部进度条从来没挂上 ref、点了不跳转，而 `qa.cjs` 的 seek 步骤只打印 currentTime，一直显示「通过」。新增或改动 QA 步骤时，每一步都要进 `failed` 条件。网络音频刚缓冲时浏览器不允许远距离跳转，所以进度条的断言看的是 `seek` 的调用参数，不是 currentTime。
- **`AudioPlayer` 里 `pos` 是播放顺序 `order` 的下标，不是队列下标**（#105）：`order[pos]` 才是队列下标。`insertNext` 曾误写成 `order.indexOf(pos)`，只有顺序模式、没插过队时才碰巧对。
- **遮罩下面的弹窗不要挂折射滤镜**（2026-11-13，#103）：给评论弹窗加了 G3 边缘折射后，用户桌面上一打开评论就整窗黑屏，重开依旧。本机用同一份构建、复制过来的用户设置、同一首 QQ 歌和真实评论，真实屏幕截图都正常，没能复现。弹窗下面是全窗口的遮罩（`backdrop-filter: blur + brightness`），弹窗的 SVG 折射滤镜要叠在它的结果上，这是和侧面板唯一不同的地方，于是撤掉弹窗的折射。如果以后又出现，先看是不是叠了两层背景滤镜。
- **带内边距的滚动区里，`position: sticky; top: 0` 停在内边距以内**：`.sd-scroll` 顶部有 16px 内边距，sticky 元素停在离顶边 16px 处，不是贴边。需要贴边的浮层放到滚动区外面。
- **QA 的帧耗时受本机负载影响很大**：同一个构建，不同时间跑可能从 4ms 变成 9ms。判断某个改动有没有拖慢性能，要在同一时间段把改动前后的构建各跑一遍对比。
- **舞台卡片不要带 backdrop-filter**：旧卡片每张都有 `backdrop-filter: blur(14px)`，几十张同时渲染开销很大。P2 去掉后，空闲帧耗时从 6.6ms 降到 4.4ms。需要玻璃的只有 hover 时那颗播放球，而且只在 hover 时注册折射滤镜。
- **测试数据里的歌曲直链会过期**（网易云直链有效期约数小时，过期返回 403），真实数据截图前要先重新取数据。

### 舞台卡片的 DOM 成本（2026-11-16，#133 方向原型）

- 一张卡片（article + 封面 + 标题 + 播放球，约 8 个节点）每帧改 CSS 变量 / transform，样式重算约 50µs。几百张同时变动（缩小看一大片时）拖动每帧 40ms 以上。
- 对照实验排除了：封面阴影、will-change、透明度、`transform-style: preserve-3d`、逐帧改 z-index，都不是原因。
- 做法：屏幕上 56px 以下的卡片不挂 DOM，改在画布上画圆角缩略图（drawImage 很便宜），56–72px 交叉淡化。DOM 卡片上限 140 张。
- 卡片组件在 pan / zoom 变化时不必重渲染（位置由帧循环写）；React 初始样式里不要写由帧循环管理的值（比如透明度），否则每次重渲染都会被打回初始值。

### 听音空间：混合模式与背景模糊（2026-11-16，Player P2）
- **`mix-blend-mode`（环境透色）和 `backdrop-filter`（遮罩）都只在「同一个合成组」里起作用**。任何建立层叠上下文的祖先（`position: fixed`、带 `z-index` 的定位元素、`opacity<1`、`transform`、`filter`、`mask`）都会把子树隔离成一组：组里的混合只和组内已画的东西混；组里一旦有混合，这个组还会变成单独的渲染面，组内 `backdrop-filter` 就采不到组外的画面（遮罩等于没模糊）。
- 实际踩到的：听音空间根层最初是 `position: fixed; z-index: 45`，歌词一开始混合，遮罩就失效——背后的星云清清楚楚、歌词读不了；打开右栏详情时歌词隐藏、没有混合，遮罩又正常了。
- 现在的做法：根层 `position: absolute`、不设 z-index，和舞台同在 `.app`（fixed，整页一组）里；听音空间存在期间用 `.app:has(.ls-root) .stage-3d { z-index: 0 }` 把舞台从 10 降到 0，按 DOM 顺序叠在下面。需要盖过播放条的飞行大封面单独一层（fixed、z 55），它不参与混合。
- 星云上的漫游歌词带聆听模式逐帧写的内联透明度，样式表要 `!important` 才压得住。

### 歌词字体回退（2026-11-16）
- 字体栈里拉丁字体必须排在中日韩字体前面。Newsreader / Inter 没装时，如果下一个就是思源宋体，弯引号 ’ 会用中文字体的全角字形，`I’m` 中间出现一大段空。现在回退到系统的 Georgia / Segoe UI。
- 逐字歌词解析时 text 会 trim，英文靠 `LyricWordUI.space`（原文这个词后面有没有空格）还原词间空格；没有这个信息时才对照整行文本推断。「stronger.」这类带标点的英文词以前会被判成非拉丁，空格全丢。

### 打包字体（2026-11-16）
- 单文件构建会把 import 进来的 CSS 里的 `url()` 资源全部内联成 base64，字体不能这样放（6MB 会塞进 index.html）。现在字体文件和 `fonts.css` 放在 `public/fonts/`，由 `lib/fonts.ts` 在运行时插 `<link>`，Vite 不处理。
- 用 Python 补丁写正则时，「两个反斜杠加 b」在传递中会被收成一个，Python 再把它当成退格符（0x08）写进文件，正则静默失效。改完正则要查一下文件里有没有 0x08。



- **共享 `.git`**（两工作区时期的记录；2026-11-16 起只剩一个工作区）：main 与 UI 服务两个工作区属于同一个仓库，在任一处 `git checkout` 会改变另一处的分支状态。现象：切了分支后另一个目录"像被回退到旧版本"。规避：两个目录各自固定在自己的分支上。
- **工作树目录改名 → 注册失效**：`git worktree list` 显示 `prunable`，旧路径下的 git 操作异常。解决：`git worktree repair <改名后的路径>`。
- **Windows 长路径导致工作树删不掉**：`git worktree remove --force` 删除含 `node_modules` 的工作树时报 `Filename too long`。解决顺序：① `git config core.longpaths true` 后重试；② 仍失败则用 `robocopy <空目录> <目标> /MIR /NFL /NDL /NJH /NJS /NP /R:0 /W:0` 清空（robocopy 原生支持超长路径），再用非递归方式删除空壳。注意 `Remove-Item -Recurse -Force` 在受管环境可能被安全策略拦截，可改用 `[System.IO.Directory]::Delete($path, $true)`。
- **删除前先确认远端有备份**：移除工作树或目录前，用 `git ls-remote --heads origin <branch>` 确认分支已推送；本地 `node_modules`、`dist` 都可再生。

### QA 脚本的本机依赖（换机器必改）

- `scripts/qa.cjs` 已改为经 `scripts/qa-env.cjs` 找依赖（后端整修 #B1）：可用环境变量 `NEBULA_QA_MODULES`（playwright-core / pngjs 所在的 node_modules）和 `NEBULA_CHROME`（Chrome 路径）覆盖，默认仍指向本机。`scripts/desktop-play-smoke.mjs` 是否同步未核对。outputs 目录已于 2026-11 改为相对路径 `../nebula-outputs`（与 `vite.config.ts` 的 `outDir` 保持一致，改一处须同步另两处）。

### 平台登录

- QQ 扫码（ptlogin2）为实验性实现，可能随 QQ 风控变化失效。
- QQ“我的歌单”必须走 musicu.fcg POST（music.musicasset.PlaylistBaseRead/GetPlaylistByUin，备用 UserSonglistService）；旧的 fcg_user_created_diss 登录态下已返回空列表。
- QQ 退出登录需同时清空 `persist:qq-music-login` 分区（cookies+localstorage），否则官方登录窗口会残留旧账号自动登回。
- Spotify（#165 起）：默认用 Spotify 桌面客户端的公开 Client ID（开源播放器 librespot 等都用它），不用注册；设了 `SPOTIFY_CLIENT_ID` 环境变量则用自己的。回调地址必须是 `http://127.0.0.1:5588/login`。**Spotify 在用户登录之后才检查回调地址**，不登录无法验证它接不接受。旧代码续期读的是那个从没配过的环境变量，登上一小时后必失效（#165 已修）。
- 酷狗登录（#164 起）：改为手机端扫码。网页登录窗口拿到的是网页票据，「我的歌单」接口（`v7/get_all_list`，云歌单服务）只认手机端票据，网页票据一律返回 20017。旧代码把错误吞掉返回空列表，登录状态又只看本地有没有 Cookie，所以长期「已登录但歌单是空的」。签名排查口诀：签名错误返回 20006，签名对了但票据不认返回 20017。手机端签名是参数按 key 排序后直接拼接，**不加 &**；取链第四路 `fetchGateway` 的旧 `androidSign` 用了 &，大概率一直失败，没改。扫码成功后的路径要用户扫一次才能验证。
- 汽水登录：已完成（签名引擎 + 扫码 + 凭证捕获；曾遇 2046 二次验证，现正常）。汽水取链曾因服务端按出口 IP 风控放弃，歌单播放走网易云 / QQ 兜底。新的可行路线（2026-11-17 调研，未做）：folia 用的 `qishui-music-api`（MIT）走车机协议，只给未加密的标准音质，需要单独抖音扫码授权。

### YouTube Music（2026-11-18，#185）

- **OAuth 只认电视端身份**：自建 Google Cloud 客户端、YouTube Music 网页端身份带 OAuth 令牌一律 400（ytmusicapi、yt-dlp 都因此放弃了 OAuth）。电视端身份 + 设备码能用，用户在默认浏览器的 google.com/device 输入代码，复用浏览器里的 Google 登录。
- **电视端读得到 / 读不到**：资料库（`FEplaylist_aggregation`）、YouTube Music 资料库（`FEmusic_liked_playlists`，返回的是二级导航里的「播放列表」页签）、赞过的视频 `VLLL`、普通歌单 `VLPL…` 都能读；「赞过的音乐」`VLLM` 只有头部，正文是「此播放列表中尚无视频」，换播放队列（`next` + playlistId LM）也是空的。自动合辑 `RD…` 打开报错。资料库的 continuation 返回同一批，不用翻页。
- **赞过的视频混着普通视频**：用户实测里有播客、几个小时的游戏实况，既不是歌也找不到音源，所以 LL 丢掉超过 15 分钟的视频。
- **跨平台兜底的边界**：副本抽查里真正的歌都命中了 QQ；找不到的是翻唱合唱、现场版、YouTube 上用罗马音写的日文歌名（如「Ame Wo Matsu」= 「雨を待つ」）。
- **令牌**：访问令牌实测约 23 小时有效（expires_in 约 83000 秒），仍按 50 分钟提前续；续期响应不带新 refresh_token。无效 access_token → youtubei HTTP 401；无效 refresh_token → HTTP 400 `invalid_grant`；轮询等待中是 HTTP 200 + `authorization_pending`。
- **封面**：`i.ytimg.com`、`yt3.ggpht.com`、`yt3.googleusercontent.com` 都带 `Access-Control-Allow-Origin: *`，不用补跨域头；视频缩略图是 16:9。

### 歌词判定按语种、日语补罗马音（2026-11-19，#197）

- **「够好」不能一刀切要求翻译**：中文歌本来没有翻译，以前也被判「不够好」，每首都去三家搜一遍、只能缓存 6 小时。现在按正文语种判（`lyricComplete`）：中文只看逐字；外语还要翻译；日语还要罗马音。
- **日语罗马音按「要注音的行」算**：日语歌里常夹英文句，英文句本来就没有罗马音，按全部行算八成会把这类歌永远判成不够好（试跑时发现）。只算含假名 / 汉字的行。
- **复制正在运行的软件的配置**：软件开着时，Chromium 的 Cookies 数据库（主分区、`Partitionspplemusic-login`、汽水验证分区）被独占锁住，任何方式都读不出来；robocopy 默认对锁住的文件无限重试（每次等 30 秒），看起来像卡死。复制时加 `/R:0 /W:0`；要 Apple 的登录就得等用户关掉软件再补这几个文件。
- **Spotify 的访问令牌只有 1 小时**：副本里去掉续期令牌后，访问令牌一过期就读不了 Spotify 歌单。要用 Spotify 歌单时，趁令牌还新先把曲目列表存到本地，后面的实测只用这份列表（兜底播放、歌词都不需要 Spotify 令牌）。

### 批量实测打到真实账号的限流（2026-11-19，#203）

- **不要批量取播放地址**：按 app 真实流程（先解析播放地址）跑 1472 首 QQ 歌单、并发 2，约 600 次后 QQ 取链接口返回 `req_0.code 104009`（我们报 UPSTREAM_ERROR），QQ 搜索、歌词补丁也跟着停了；用户真实 app 用同一张票据，一起受影响，约 45 分钟后自己恢复。批量统计歌词时，实际出声那首按匹配推断（`searchKeyword` + `recordingMatch` + `matchScore≥.55`，网易云优先），不取地址。
- **跑之前先告诉用户要请求多少次**；脚本带看门狗：每 40 首探一次网易云和 QQ 搜索，不通停 10 分钟，再不通就整轮停。抽样（每平台 300 首）足够看出缺口，压力只有全量的四分之一。
- **实测期间别让 QA 改掉实测用的包**：`qa:backend` 会重新打 `dist-main/index.cjs`，后台实测每换一个平台重新加载它；实测前先复制一份（放在 `dist-main/` 里，已被忽略）专门给实测用，用完删。
- 网易云搜索第一次请求冷启动要近 2 秒；脚本里先调 `primeNcmApi()`，探测失败重试一次再判不通。

- **真取地址的实测可以做，但要慢**（#212）：9 平台各 30 首、并发 1、每首间隔 3 秒、看门狗盯 QQ 104009，全程没触发限流。副本里删掉 Spotify 续期令牌、不建 QQ 自动续期服务（在副本上续期会顶掉用户真实 app 的票据）；只想用 Spotify 访问令牌探接口时，把记录里的 `token`（续期令牌）清空即可，副本就没法续期。

### 收尾轮的经验（2026-11-20，#206–#216）

- **先逐首看失败原因，再改**：酷狗 7 首放不了，查下来是酷狗歌名带着「歌手、歌手 - 」（整个歌单 34% 的歌），修一处找回 5 首；网易云逐字缺口逐行分类后才发现「拆句」「对方一行里的一段」「局部偏移」三类能补、「版本不同」不能补。
- **改了合并规则要看上一层有没有用到**：#214 的逐行补配在固定偏移那条路上根本没被调用（整份换只要比现在多就直接用），单测过了、实际不生效；要拿真实歌逐步复现到最终结果。
- **放宽匹配看「人数」这类结构特征**：#211 放开英文歌名的不同文字歌手名，认错的两首都是两边歌手人数不同，加这一条就挡住了。
- QQ、酷狗、酷我对很多歌给的是同一份歌词（同一个歌词供应方），多一个来源不一定多一份数据。
- **汽水车机协议**（#212–#216）：
  - 音频 CDN 见到 `Referer: https://www.qishui.com/` 就回 403（不带头、只带 Origin / UA 都是 206）。取音频一律走 `http.mediaHeaders`，不要直接用 `PLATFORM_HEADERS`；这个问题回归测不出来，只有扫码后真取地址才看得到。
  - 汽水网页 SEO 歌词接口（`seo_track`）现在只回 `status_info`，没有歌词；歌词在车机 `/media/mget/` 的 `display_info.lyric_info` 里，**匿名就能取**（随机设备 id、不带 user_id）。
  - 取播放信息的 `vod-luna.douyin.com` 偶尔连接被重置（5 秒超时），隔一会儿就好；失败返回 null 交给兜底。
  - 拿用户真实授权测时：只拷 `qishui-car` 一条、先看离过期还有多久（到期前 1 小时内才会续期，续期会换票据），用完删副本。
- **agent 改文件别在 shell 里内联代码**：在 bash heredoc / `node -e` / python 里写含 `\b`、`\d`、`\n`、反引号的替换内容，反斜杠和反引号多次被吃掉或被当成命令替换（正则失效、字符串里换行断开、组件文件被写坏），而且类型检查不一定能发现（`/^d{1,30}$/` 照样合法）。要么用编辑工具，要么把脚本写进文件再运行。

### 逐字被自己的规则丢掉（2026-11-19，#196）

- **网易云的普通歌词和逐字歌词开头不一样**：同一首歌两份正文相同，但每行开头常差几百毫秒（实测 44 首 2471 行里 1330 行文字一样、只是差超过 250ms，中位 430ms，九成在 1.1 秒内），逐字那份更准。以前前后端都要求 250ms 内才挂逐字，网易云自带逐字的歌有一半以上的行显示不出逐字。现在后端统一把行时间校准到逐字（1.2 秒窗口、正文相同、顺序一致）。
- **跨平台分句不同很常见**：不同平台同一首歌通常只有 55%～75% 的行正文完全一样，以前「整首八成对上才采用」导致整首放弃；现在逐行补。剩下补不上的多是两边歌词版本真的不同（如某首网易云 62 行只有 24 行能在 QQ 找到）。
- **对比脚本的坑**：在草稿目录里打包的旧后端，运行时依赖（网易云接口模块）找不到，网易云请求全部失败但不报错——会把「改动前」测得很怪（全部 4 秒超时、只剩 QQ）。Electron 主进程也不认 `NODE_PATH`。旧包要放进仓库的 `dist-main/`（已被忽略）里跑，用完删掉；两份后端不要放在同一个进程里跑。

### 歌词新来源（2026-11-19，#195）

- **AMLL 接口**：`api.amll.dev/v1/lyrics/get` 支持 `ncmMusicId`、`qqMusicId`（只认数字 songid，songmid 返回 404）、`appleMusicId`、`spotifyId`、`isrc`；没收录是 HTTP 404；`/v1/lyrics/search?q=` 能按文字搜，记录里同时带各平台 id。约 0.5 秒。根路径 404 是正常的。
- **AMLL 覆盖**：用户网易云歌单抽 150 首命中 24 首（16%），命中的全是逐字、17 首带翻译——覆盖不广但质量高（社区手工打轴，有背景人声、对唱标记）。真实文件实测：日文歌带翻译 + 罗马音、英文歌带翻译都能完整解析；背景人声里的翻译随背景人声一起丢掉（如某首 82 条翻译、63 行正文）。
- **Apple 逐字歌词覆盖**：用户 Apple 资料库 60 首 59 首有歌词（37 逐字、22 只有逐行），13 首有背景人声，多数带演唱者标记；带 `l=zh-Hans-CN&extend=ttmlLocalizations` 时约一半附中文翻译；约 0.8 秒一首。用网易云的歌按「歌名 + 第一个歌手」去 Apple 目录搜，40 首配上 33 首、21 首拿到逐字（中日韩歌 24 首里 9 首）。没订阅的号读不了（同资料库）。
- **测 Apple 要连 Cookie 加密密钥一起复制**：Electron 的 Cookie 用配置根目录 `Local State` 里的密钥加密，只复制 `Partitions\applemusic-login` 读不出登录。
- **参考项目的 TTML 解析库 `@applemusic-like-lyrics/ttml` 是 AGPL**，只能借思路。

### Apple Music（2026-11-19，#191）

- **Electron 里能用**：官方 Electron 不带 Widevine，但 music.apple.com 照样加载、MusicKit 照样初始化（版本 `playback/AppleMusic-2646.4.0-external`），只是不能出声；只有 `mk.api.music`，没有 `mk.api.v3`。Apple ID 在页面里直接登录（不弹新窗口，Apple 没拦），分区持久化后重启仍登录。UA 要去掉 Electron 片段。
- **没有订阅读不了资料库**：`/v1/me/library/*` 一律 400 + `40015`（`privilege: CloudLibrary`），最近播放是 `ListeningHistory`；`/v1/me/account?meta=subscription` 的 `meta.subscription.active` 能直接看订阅状态。这不是掉登录。用户第一个测试号就是这种情况。
- **资料库曲目没有 isrc**：要在 tracks 请求上加 `include=catalog`，从 `relationships.catalog.data[0].attributes.isrc` 拿。资料库曲目 id 有 `i.`、`a.` 两种开头；`catalogId` 在 `playParams` 里，自己上传、匹配不上目录的歌没有，而且歌手、专辑、封面基本是空的（只有歌名），跨平台很难找到。
- **歌单列表不给曲目数**（attributes 里没有 trackCount）。逐张读 `tracks?limit=1` 的 `meta.total` 能拿到（实测 12 张全对，单个约 1–1.5 秒），在页面里并行读 12 张只多约 0.4 秒（#192）。`meta.total` 把歌单里重复的歌也算进去（如 646），导入后去重是 644。
- **分页**：`next` 是相对地址（如 `/v1/me/library/playlists/{id}/tracks?offset=100`），每页 100 首约 1 秒；644 首歌单约 10 秒。
- **社交资料常为空**：`/v1/me/social-profile` 200 但 data 为空数组，昵称只能回退「Apple Music 用户」。
- **测试**：真实账号测试用实验时的空配置（独立 userData），登录只在那份配置的分区里，不碰用户的真实配置。

### 酷我 / 波点头像、空封面歌单、登录页宽度（2026-11-18，#184）

- **酷我 Cookie 值带双引号**：官网写的 `pic3`（头像）是 URL 编码后再包一层 `"…"`，以前按「以 http 开头」判断，整条被丢掉。昵称在 `uname3`，不是 `username`。第三方登录（`t3=weixin` / qq）时头像是 `thirdwx.qlogo.cn` / `thirdqq.qlogo.cn`，末段 `/132` 是缩略图，换 `/0` 取原图，可升 https；酷我自己的图床仍保持 http。
- **波点 `users/login` 不能用来读资料**：GET（签名与否）一律 HTTP 500 `Service error`，只有扫码换凭证（POST + authType 10）能用。`/api/ucenter/users/info`、`profile`、`detail` 等猜测路径同样 500 / 404。资料改从 `playlist/userCreate` 读：每个歌单带 `author { id, name, icon, isVip }` 和平铺的 `creatorId / creatorName / creatorIcon`，取作者是本人的那一条。没有自建歌单时没有头像，昵称回退到登录时存的。
- **没封面的歌单**：酷我「我喜欢听」的 `pic` 为空。`nebula:login:playlists` 对空封面的歌单（最多 8 张）补第一首的封面，进程内缓存；适配器有 `fetchPlaylistFirstCover` 就用（酷我只取 5 首），没有就退回整份 `fetchPlaylist`。歌单详情 / 导入同样兜底。
- **内嵌登录页按宽度适配**：官网首页按桌面宽度排版（QQ、酷我约 1000–1050 CSS 像素），弹窗正文区装不下时只露左上角。`embeddedSheet.cjs` 的 `createWidthFitter` 量 `scrollWidth` 与 `clientWidth`，溢出就整页缩小（下限 0.5），弹窗变宽回到 100% 重量。不能沿用记下的最大宽度：酷我页面宽度跟着视口走，缩放过程中一瞬间的溢出会被记成排版宽度，之后放不大回去。登录弹窗宽度同时从 900 放到 1100（与壁纸库一致）；1440×900 窗口下两家都是 100% 无溢出，最小窗口（1024）下约 0.87。

### 汽水封面（2026-11-18，#183）

- **图床不认不带尺寸后缀的地址**：`p3-luna.douyinpic.com/img/<uri>` 直接请求返回 400 JSON；`~c5_宽x高.jpg` 正常（超过原图时给原图），`~tplv-obj.image` / `~noop.image` 给原图。以前歌曲封面没补后缀，导致歌曲和借用首歌封面的歌单全都空白。现在歌曲补 500、歌单补 300，大封面原图候选用 `~tplv-obj.image`。
- **图床不带跨域头**：星云小封面、取色按跨域方式加载（`crossOrigin='anonymous'`），没有 `Access-Control-Allow-Origin` 会整张加载失败。主进程给 `*.douyinpic.com` 的响应补跨域头。

### Spotify 续期（2026-11-18，#181）

- **refresh_token 是一次性的**：每续一次换一张新的，旧的作废；拿作废的去续返回 `400 invalid_grant / Refresh token revoked`。所以续期必须全局只有一个在进行：启动时账号页、兜底排序会同时查 Spotify，以前并发的几个 401 各自续期，第二个拿旧令牌去续就会失败，甚至把整组登录吊销。现在 `refreshToken` 单飞，401 时先看令牌是否已被别的请求换掉，是就直接重试。
- 访问令牌 1 小时有效；写入超过 55 分钟就在请求前先续。

### 酷我（2026-11-18，#180）

- **取链返回 200 也可能是提示音**：无版权、会员或不存在的歌，`antiserver.kuwo.cn/anti.s?type=convert_url3` 照样回 `code:200` 和地址，地址指向同一个约 11 秒的提示音文件（`…/588957081.mp3`）。适配器先按文件名拒绝，再用 1 字节 Range 读总长，比「时长 × 128k × 0.4」小就当成不完整，交给跨平台兜底。
- **匿名只有 128k**：320kmp3、2000kflac 匿名返回提示音，`format=flac` 直接拒绝。登录后能不能拿到高音质待真实账号核验。
- **网页版没有「我的歌单」和登录核验接口**：官网登录后只写 `userid`、`sid`、`websid` 等 Cookie。「我的歌单」用歌单服务 `nplserver.kuwo.cn/pl.svc?op=getuserlist&uid=…`，只给 uid 也能读到公开歌单；列表里混有无标题的系统占位项（PC_DEFAULT / RADIO / ORDER），要过滤。
- 打开 `https://www.kuwo.cn/?login=open` 会自动弹出登录框。
- 封面和头像保留 http：酷我多级 CDN 的 https 证书不匹配。专辑图 `/albumcover/120/` 改 `/500/`、歌单图 `_150.jpg` 改 `_500.jpg` 都可用。

### QQ 登录续期（2026-11-18，#178）

- **官方网页不给 QQ 号登录续期**：y.qq.com 前端脚本里只有读 Cookie、过期就登出，以及微信登录换 access_token 的 `login_get_musickey.fcg`。所以「后台开官方网页让它自己续」走不通，只能直接调 `music.login.LoginServer/Login`。
- **网页登录没有 refresh_key 也能续**：传 openid（psrf_qqopenid）、access_token、refresh_token、musickey、musicid、expired_in（psrf_access_token_expiresAt）、loginMode=2，comm 里 tmeLoginType=2。返回新 musickey、musickeyCreateTime、keyExpiresIn=259200（3 天）、expired_at（授权到期，不变）。续完后旧票据仍然有效（实测）。
- **两套登录类型编号**：Cookie 的 `login_type` 1 = QQ、2 = 微信；TME 接口的 `tmeLoginType` 2 = QQ、1 = 微信，Cookie 里也带着 `tmeLoginType`。`qqComm` 现在把 login_type 原样当 tmeLoginType 发（QQ 号发成 1），播放、核验、会员查询都正常，没改；续期请求单独写成 2。
- **keyExpiresIn 不是硬期限**：服务器建议 3 天，但旧票据实际能用几周。续期按「用满 2 天」提前续，不靠它判断过期；过期以 GetLoginUserInfo 的 1000 / 104400 / 104401 为准。
- 实测脚本只在会话草稿目录：先复制配置，只打印返回码、字段名、长度、是否和旧值相同、时间戳。

### 跨平台歌词与内容（2026-11-17，#163）

- **两平台歌词时间轴不是固定偏移**：网易云和 QQ 是两套人工打的时间轴，同一句开头常差几百毫秒，而且每句差得不一样。原来的固定偏移对齐要求 95% 的行误差 ≤180ms，所以几乎全部失败：网易云来源的歌只有 15% 有逐字，补全也救不回来。现在固定偏移失败后再按正文逐行配对（`retimeByText`）。
- **署名行写法五花八门**：「制作人: X」「音乐设计/监制: X」「Lyrics by：X」，以及没有冒号的「编曲정준일」。它们会拉低配对比例、虚增分母，正文行要把「短标签 + 冒号」的行排除。没有冒号的那种由前端在正文开始前过滤（#167）。
- **QQ 登录过期时整库 QQ 歌停在「请重新登录」**，不兜底、不跳歌。这是按第二轮任务书故意这么做的；#178 起 QQ 号登录会自动续期，只有续不上时才会走到这里。
- **QQ 歌词的罗马音只给部分行**：韩语歌只有约两成完整；QQ 自带的罗马音是「一个音节一段」的写法。后端补的是按词的写法，前端按原文逐字对齐拼回（#167）。

### 真实数据测试的做法（2026-11-17）

- **副本里必须去掉 Spotify 的令牌**（2026-11-18 教训，#181）：Spotify 的 refresh_token 用一次就换新、旧的立即作废。副本里的软件一续期，用户真实配置里的那张就被吊销，用户那边显示「登录已过期」、只能重新授权。除非专门测 Spotify 且已告知用户，复制配置后先删掉 `cookies.json` 里的 `spotify` 一项。QQ 续期实测过旧票据仍有效，不受此限。
- **Apple Music 的登录不在 `cookies.json` 里**（2026-11-19，#191）：`cookies.json` 只有一条不含凭据的标记，真正的登录在官方页面的分区 `Partitions\applemusic-login`。测 Apple 时要连这个分区一起复制（可跳过其中的 Cache / Code Cache / GPUCache）；只复制 `cookies.json` 的话，软件会认为已登录但页面里没登录，读资料库会报过期。用户 2026-11-19 定：以后开发直接用他当前登录着的账号（真实配置的副本）测试，不再单独开实验配置登录。
- 只用账号配置的副本（`%APPDATA%\music-nebula` 复制到草稿目录），绝不碰真实目录。脚本 `require('dist-main/index.cjs')` 后先 `setCookieDataDir(副本)`，并把 console 全部屏蔽，只输出统计数字，不打印 Cookie、票据或带签名的地址。
- 全库统计跑得很快：1442 首歌词约 3.4 分钟（并发 3），没有遇到限流。这类脚本交给便宜的子代理就能完成。
- 临时目录（`%TEMP%`）里的工作树或 node_modules 可能被系统清理掉一部分（缺 rollup、react 开发版文件）。构建报「找不到模块」时，先删 node_modules 重装。

## 待办 / 后续方向

- [ ] 网易云 eapi 未来若被风控，接入 weapi 自动降级（weapi 通道已实测可用，代码已内置 `buildWeapiRequest`）。
- [ ] 登录 Cookie 加密存储（keytar / DPAPI）替代明文 JSON。
- [x] 歌词面板上下分区与高亮联动（NowPlayingPanel 已实现上下分区、当前行双高亮、翻译跟随）。
- [x] ~~收藏/喜欢状态持久化与“我喜欢”歌单联动~~ → **已废弃**（2026-08-30 用户决定彻底删除收藏功能：不做平台写回，也不做播放器内部收藏；随 Player P2 重写 NowPlayingPanel 时清除 `liked` 接线）。
- [x] 播放列表队列 UI（UI 分支 Player P1 已完成：常显入口 + 当前项/即将播放、点击跳播、仅即将播放可移除、「下一首播放」FIFO）。
- [x] 评论弹窗/面板渲染（已完成：底部条评论入口 → 评论页；后端 `fetchComments` 已就绪）。
- [x] 左右 Dock 重构（小球 → 胶囊 → 窗口已完成并整合主项目，见 `docs/design/UI_SPEC.md` §5.7）。
- [x] Nebula Player 重构（`docs/design/PLAYER_IMPL_PLAN.md` §3）：P2 听音空间、P5 歌词阅读栏已完成（#118–#131），P3 Music Orb 取消，P4 并入星云漫游歌词，P6 / P8 基本完成，P7 氛围暂缓（节奏光列为加分项）。播放模式循环顺序「顺序→随机→单曲」（2026-11-13）。
- [x] 「液态玻璃」主题：默认主题（`docs/design/NEBULA_UI_SYSTEM.md` §3，磨砂 / 液态为同一模型两组参数），已随材质主题全局化落地并验收。
- [x] **全局 UI 重构**：真源 `docs/design/NEBULA_UI_SYSTEM.md` v1.0（2026-11-09 冻结），§13 的 P0–P4 全部落地并通过桌面验收。GPT 母稿已归档（`docs/design/archive/`，非真源）。
- [ ] `README.md` 目前是开发期版本；正式定稿与 CI/CD 流程留到收工阶段。
- [ ] **平台功能缺口**（明细与优先级见 `docs/project/PLATFORM_MATRIX.md` 缺陷清单）：
  - 逐字歌词源（AMLL TTML DB）、专辑页兜底、汽水取链（qishui-music-api）；
  - 酷狗、汽水会员识别；QQ 微信登录续期（QQ 号登录已在 #178 做完）；搜索接入汽水 / Spotify；
  - 酷狗取链第四路签名；
  - 新平台（波点 / YouTube Music / Apple Music）至少做到歌单来源。
- [x] ~~待用户实测：酷狗扫码登录后能否读到歌单（#164）；Spotify 授权后能否读到歌单（#165）~~ → 酷狗 2026-11-17、Spotify 2026-11-18（#171）用户验收通过。

> 已废弃（不再排期）：Z1 大字号左→右长句「提前检测 + 提前入场」方案（旧第 9/10 点，2026-08-19 用户确认不需要，详见 `docs/design/LYRICS_SYSTEM.md` §8）。


## 后端整修 #B6：线上复测和封面

### 第二轮 #B10：显示归一化必须早于身份拆分

- `<em>`/`</em>` 必须先去掉再按 `/` 拆艺术家，否则闭合标签会造出假歌手。适配器映射与录音门禁两层都清理，不能依赖UI的stripMarkup。
- 标题译名/Explicit和艺术家读音括注不是录音版本。只用明确版本词建立版本约束；不得为单首歌曲再加专用匹配分支。合作歌手 #205 起允许一方只写主唱（排在完全一致的后面），但写得全那边的主唱必须在另一边。

### #B8 交付复测口径

- 安全的后端失败文案不能在渲染端转换为无原因的 null；现有错误位置应保留登录/权限/连接原因，同时保持有限失败出口。
- 音源耗时是取得通过签名探测的地址，Chrome ended→playing 是媒体事件；两者都不能写成声卡出声/静音时间。成功和失败分开统计，并同时报告成功样本数。
- 逐字必须区分原始字段存在和正文时间对齐后可用。对原版用当前测量器重算时应明确口径，不能冒充原版 UI 观测。
- 公开曲单权限字段 fee、st、pl、dl 是当次接口返回，不自动等于法律版权结论。无账号结果不代替会员验收。完整步骤与脱敏原始统计见 `BACKEND_OVERHAUL.md`。

### #B7 补充

- 完整 512 字节 Range 也调用 destroy 会破坏 keep-alive；现在有明确完整长度时等 end，超量或未知长度才截断。真实 3 次探测的新增连接数≤1。
- 初始短预算能误杀已取到 URL 但尚在探测的歌曲；阶段预算按实测修订，总预算仍 6 秒。失败耗时与成功耗时必须分别报告，不能靠减少成功样本美化分位数。
- 网易云 lyric_new/lyric 原先串行，后一个慢请求可使整阶段丢弃前一个成功结果；改为并发独立限时，并添加一方永久挂起的回归。
- Spotify 官方现行字段是 `items.items[].item`，旧 `tracks.items[].track` 已弃用；兼容两者和 next 分页。官方 [Get Playlist](https://developer.spotify.com/documentation/web-api/reference/get-playlist) 与 [Get Playlist Items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items) 说明条目访问受拥有/协作权限限制。无条目权限不返回假空歌单；100 页/5000 首、60 秒上限，超限明确报错。本机没有 OAuth 授权，线上行为待复测。

- 取链阶段超时不能作为整个平台失效的证据；主源点播总要获得恢复机会。只有非取消/非超时异常计入兜底平台 30 秒熔断。
- 网易云库 generateConfig 串行注册匿名身份和更新公钥，首次请求原先会等待它；复用 24 小时内的匿名文件，桌面启动预热。不存在/过期时仍有 5 秒初始化上限与播放总预算，不能硬编码匿名令牌。
- coverInfo 字段 `{url,width?,height?,verified}`；像素通过受限 GET 读取 PNG/JPEG/WebP/GIF 头确认，最大 64 KiB、总预算 5 秒、4 个并发、500 项/24 小时缓存。URL 中的 800/1000 不算实际尺寸；失败只返回 unverified，前端不能展示虚构像素。
- 登录日志只保留事件类型；不输出原始错误对象、Cookie 前缀、响应体、签名直链或页面调试内容。QQ 评论未知 `[em]...[/em]` 显示「［表情］」，真实 emoji 保留。

## 后端整修 #B4：平台接口与匹配

- QQ 旧 express_mobile3 不再调用；musicu 的取链参数必须有 filename，文件 ID 优先 file.media_mid，不能把所有 songmid 当 media_mid。登录播放票据放 comm.authst，与 uin/Cookie 配套。只借鉴 Mineradio 的协议参数，无复制实现。
- QQ 无 purl 时区分 LOGIN_REQUIRED / RIGHTS_OR_UNAVAILABLE / NETWORK；不能将没有 purl 一律视为版权缺失，也不能用匿名结果确认会员能力。
- 网易云旧 search/get/web 在本机返回空结果，成熟库 cloudsearch 返回候选；取流与查询都继承 RequestScope。
- 酷狗不同档位对应不同 hash，不能无视 quality 总选最高 hash；bitRate 同时兼容 bit/s 与 kbit/s。
- 兜底采用“宁缺毋滥”：recordingMatch 拒绝歌手对不上、版本不一致、时长差超过 max(2s,min(6s,2%)) 的结果；无时长还需同专辑。歌词补全必须复用该门禁。
- （#205，用户 2026-11-19 定）「宁缺毋滥」放宽了一档：歌手子集（主唱相同）、频道名开头相同、不同文字的歌手名（时长相同）也认，排在完全一致的后面。放宽前先在真实候选上量化：261 首里原样放宽「中日韩歌名 + 时长 ≤1 秒」会认错 5–7 首（翻唱、卡拉 OK），所以加了「歌手名不同文字 + 时长相同」两道限制。以后再放宽也要先这样量化、人工核对配对。


## 后端整修 #B5：歌词格式与来源

- 网易云 `lyric_new` 常把 JSON 制作信息与普通 LRC 混在一起。检测到任何 JSON 后只解析 JSON 会丢掉正文，连带导致翻译无法附着。现在逐行分别解析。
- QQ `qrc` 返回值可能是数字标志，真正加密文本位于 `lyric`。需要 songID、qrc=1、trans=1、roma=1；QQ 使用非标准 DES，Node 标准 3DES 无法解开。使用独立 MIT 依赖 `qrc-decoder@1.0.2`，上游 https://github.com/apoint123/qrc-decoder ，其来源 https://github.com/SuJiKiNen/LyricDecoder 亦为 MIT；传递依赖 pako@2.2.0（MIT/Zlib）。许可证已逐一读取，没有复制 Mineradio/Folia 的 GPL/AGPL 实现。
- QQ QRC 毫秒与翻译 LRC 十毫秒截断的差异实测为 0–9ms；同源允许 80ms 最近邻，不能据此放松跨源版本与正文锚点验证。
- 酷狗原路径下载 fmt=lrc，任务书“已有 KRC”线索被实际代码推翻；现用 fmt=krc，经 krc1/XOR/zlib 解码，并提取 language 标签的翻译/罗马音。KRC 相对时间与 QRC 绝对时间分别转换，禁止启发式混用。
- 新增字段 `Lyric.identity/provenance/coverage/incomplete/krc`；统一 yrc 为绝对毫秒，前端只补空格，不改变逐字节奏。无真实时间的行没有 words。
- 新歌词缓存 schema=3（#197 起；2 是 #B5 那版）；旧缓存只失效，不修改用户原文件的历史副本。开发/评估应使用独立 profile。
