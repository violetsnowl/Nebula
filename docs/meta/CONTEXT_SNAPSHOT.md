# Nebula 上下文快照（CONTEXT SNAPSHOT）

> 用途：任何新会话 / 新 agent 用最小 token 恢复上下文；"上下文压缩迭代"的载体。
> 维护：重大里程碑或会话结束时刷新「当前状态」；历史只保留最近 1–2 条，避免膨胀。

---

## 恢复路径（按序读完即可动手）

1. `AGENTS.md`（仓库根，Codex 自动加载）— 硬性约定与恢复入口
2. `docs/meta/HANDOFF.md` — 协作规则 + 工作区拓扑
3. `docs/meta/USER_PROFILE.md` — 用户画像与审美偏好
4. 本文件「当前状态」
5. `docs/project/PROJECT.md` + `docs/project/ARCHITECTURE.md`
6. `docs/design/*`（`NEBULA_UI_SYSTEM`（全局 UI 真源）/ `LYRICS_SYSTEM` / 播放器三份母稿；`UI_SPEC` 已被取代）
7. `docs/project/CHANGE_LOG.md` 最近 20 条 + `docs/project/NOTES.md`

## 模型迭代与连续性（为什么这份文件存在）

- 底层模型可能随供应商版本迭代被替换；同一线程的上下文窗口也会被 **compaction** 压缩（官方说明：compaction 降低上下文体积、保留后续轮次所需状态，但压缩项是不透明摘要，细节会损失）。
- 连续性因此分三层：① 线程对话历史（会在压缩中损失细节）；② 仓库文档（本目录 + CHANGE_LOG + 冻结设计规格，人类可读、可无限增长）；③ git 提交历史（事实基准）。
- **协议**：新会话 / 新 agent / 换模型后按上面「恢复路径」读完再动手；重大里程碑或会话结束时刷新本文件「当前状态」小节。`AGENTS.md` 已配置自动指向这条路径。

## 当前状态（2026-11-18 刷新）

> 本节只写「现在是什么样、还剩什么」。每一步的背景、改动和验证都在 `docs/project/CHANGE_LOG.md`（按编号）和 git 提交里，2026-11-18 之前的逐日流水账已从本节移除。

### 工作区与分支

- 只有一个工作目录 `E:\CUFE\vibecoding\nebula`、一条分支 `main`；构建产物在同级 `nebula-outputs`。精确 HEAD 用 `git log -1` 取。
- 新功能直接在 main 上小步提交，每步 build + qa 全绿；实验性改动挂在默认隐藏的开发者开关后面；确需分支用短命分支，合并后即删。
- 远端 `github.com/violetsnowl/Nebula`，只有 `main`；标签 `v0.1.0-z1-random-checkpoint`、`archive/ui-nebula-design`（旧原型，不作为实现真源）。

### 现状：已收敛，没有进行中的任务，也没有待验收的改动（截至 #175）

下面这些全部落地，并通过用户桌面验收：

- **全局 UI 重构**（P0 清障 → P1 材质与环境 → P2 星云卡片 → P3 歌词字体 → P4 面板与 Dock）：真源 `docs/design/NEBULA_UI_SYSTEM.md`。两侧 Dock（歌单 / 导入，账号 / 设置），设置四分页（歌词 / 聆听 / 背景 / 外观）。
- **播放器（Player P2，#118–#131）**：新播放条；整屏听音空间（大封面一镜到底、右栏原地详情和评论）；歌词阅读栏引擎（`src/lib/listen/`）。
- **星云漫游歌词（Z1，#124–#125）**：共用听音空间的逐字层，漫游时氛围 / 字幕 / 都显示，沉降 / 散开 / 退潮。
- **主舞台星云（#133–#140，真源 §8.0）**：首尾相接、没有尽头的画布；三种排法（按颜色默认 / 按歌手 / 随机）；透镜、缩放上下限；搜索飞到星团；按歌手时歌手名随机放在团的上方、下方或中间。旧卡片墙已删除。
- **后端整修（#141–#156，Codex 两轮 + 分叉会话复核合入）**：
  - 播放代次与取消、有界取链（中位 0.46 秒）、严格同录音兜底、QRC / KRC 解密、地址有效期、QQ 登录核验。
  - 平台 × 功能完成度表 `docs/project/PLATFORM_MATRIX.md`：每格写「本平台 → 兜底」，空白即缺陷。
- **账号与平台**：
  - 登录过期提示（账号区、歌单面板、播放条，#157 / #162）；
  - 酷狗手机扫码登录和头像（#164 / #171）；
  - Spotify 桌面客户端身份登录，资料和歌单走 Spotify 自家查询服务（#165 / #170 / #171）；
  - 评论、歌曲详情跨平台兜底，标「来自 X」（#163 / #166）。
- **听音空间细节**：
  - 大封面按需要的尺寸取实测够清楚的图（#158）。
  - 读音（#161–#173）：ā 按钮，默认关。韩语罗马音按原文的词分组；日语罗马音（原文下方）和汉字假名注音（`src/lib/furigana.ts`，由平台罗马音反推）可同时开；日语歌悬停或右键 ā 按钮弹出小面板。
  - 注音挂在所属汉字的逐字单元里，跟着字一起动（#174）。
  - 上场轻弹改为临界阻尼，不再整句左右抖（#175）。

### 活跃任务：平台扩展（用户 2026-11-18 定）

- 顺序：酷我 → 波点 → YouTube Music → Apple Music（最后）。第一阶段每家做到「能登录、能看到我的歌单、歌单能播放」，歌从哪取、歌词从哪来不限；各家都接完、平台列定住后，第二阶段再按功能横向补全（歌词来源互补、内容页、搜索、会员识别等）。
- 每家开工前先探路；参照 folia（AGPL）只借思路和参数，代码自写；MIT 许可的库可以直接用（如 youtubei.js、PyBodian 的协议参考）。加一个平台要改的地方见 ARCHITECTURE「加一个平台要改的地方」。
- 进度：
  - 酷我 #180 用户验收通过；#184 修头像 / 昵称，「我喜欢听」用首歌封面补；
  - 波点 #182 用户验收通过（登录 → 我的歌单 → 分享链接导入 → 整曲播放）；#184 头像改从自建歌单作者字段读；
  - YouTube Music：Google 不允许在 Electron 窗口登录，参照 folia 用系统 Chrome / Edge 独立配置目录登录，再无窗口读取 Cookie；接口用 youtubei.js（MIT）；播放先走跨平台；
  - Apple Music：参照 folia 在官方 music.apple.com 页面里登录和读资料库，不提取令牌；放最后。
- 素材已到：四个平台的 logo 在 `docs/logo/`；波点分享链接格式 `h5app.kuwo.cn/m/bodian/collection.html?uid=…&playlistId=…&source=…`。
- 内嵌窗口（用户 2026-11-18 提）：#183 已做并验收通过（弹窗样式、汽水、壁纸库、Spotify 默认浏览器授权）。用户反馈登录页只露左上角要拖横向滚动条，#184 弹窗放宽到 1100 并按页面宽度自动缩放，待用户验收。
- YouTube Music 登录（用户希望复用默认浏览器里的登录，不开空白浏览器）：唯一可行的是 Google 设备码登录（默认浏览器打开 google.com/device 输入代码），需要 Google OAuth 客户端——自建 Google Cloud 项目（未审核前上限 100 名测试用户）或借 YouTube 电视端身份（据报 2025-09 后范围有变，能否读 YouTube Music 资料库待实测）。读用户浏览器里的 Cookie 不做（Chrome 应用绑定加密，且属读取凭据）。做 YouTube Music 时先实测再给用户选。

### 已落地、待用户确认（#177 之后）

- **#177 文档刷新**：README / PROJECT / NOTES 等过时说法改为现状。
- **#178 QQ 登录自动续期**：QQ 号登录票据用满 2 天或确认过期时自动续（`src/main/services/qqRenew.ts`）。用户配置副本桌面实测通过：启动 20 秒后续上，新票据核验有效、取链 320k 完整播放，旧票据也仍有效。用户日常使用中确认：几周后不再出现「QQ 登录已过期」。

### 代码地图（改哪儿看哪儿）

| 区域 | 代码 | 真源 |
|---|---|---|
| 主舞台星云 | `src/lib/space/`、`src/hooks/stage/useStage.ts` | NEBULA_UI_SYSTEM §8.0 |
| 听音空间 / 歌词阅读栏 | `src/components/listen/`、`src/lib/listen/`（`engine.ts`、`words.ts`、`bigCover.ts`） | §9.9、§7.2 |
| 星云漫游歌词（Z1） | `src/components/LyricsLayer.tsx`（逐字层共用 `src/lib/listen/words.ts`） | §7.1、LYRICS_SYSTEM |
| 歌词解析 / 读音 | `src/lib/lyrics.ts`、`src/lib/furigana.ts`、`src/hooks/lyrics/useLyrics.ts` | §7.2 |
| 账号 / 设置面板 | `src/components/AccountDock.tsx`、`src/hooks/accounts/useAccounts.ts` | §9.5 |
| 播放条 | `src/components/player/BottomPlayer.tsx` | §9.1 |
| 后端（主进程） | `src/main/`（adapters / services / login / parsers），入口 `electron/main.cjs` | PLATFORM_MATRIX |
| 测试 | `scripts/qa.cjs`（主套件）、`pnpm qa:backend` | — |

### 待办与排期

- **后端**（按 `PLATFORM_MATRIX.md` 缺陷清单，影响从大到小）：
  - 逐字歌词源 AMLL TTML DB；
  - 专辑页兜底；
  - 汽水取链（`qishui-music-api`，车机协议）；
  - 酷狗 / 汽水会员识别；
  - ~~QQ 登录自动续期~~：QQ 号登录已做（#178）；剩微信登录续期，以及 QQ 授权本身到期（用户这次是 2027-01-16）后能不能续，要到期才知道；
  - 搜索补平台；
  - 新平台（波点 / YouTube Music / Apple Music）至少做到「歌单来源」。
- **界面**：
  - 约两成日语歌平台没给罗马音，标不了注音。用户 2026-11-18 决定：本地读音词典暂缓，先把歌词来源扩展到极致、多源互补，让各平台歌单的歌词效果接近；来源穷尽后仍有缺口再做词典；
  - 节奏光（加分项）：技术可行，表现要换，不做封面两侧随鼓点闪烁。
- **工程**：
  - 主舞台在 2K、0.57 倍缩放下帧耗时 p50 约 12.5ms，可改为直接写 transform；
  - QA 里其他播放用例仍从 soundhelix.com 取外网音频，可换成本地音频去掉偶发失败；
  - #137 拖动闪烁回归目前只跑在 16 首曲库上。

### 协作要点（新窗口先看）

- 用户在桌面版验收。每次交回都附两条运行命令：`pnpm build:desktop`、`pnpm desktop`。
- 真实数据测试只用资料副本，做法见 `docs/project/NOTES.md`「真实数据测试的做法」。
- 多会话并行规则见 HANDOFF §1 第 9 条：提交前一刻再读日志顶部取号，只提交自己的文件。2026-11-17~18 的后端分叉会话已结项。
- 样张（私有页面，只用于做决定）：
  - 设计审查 <https://claude.ai/artifact/Kc9s3unScWUHbHSGsDQYLQ>
  - 播放器 I <https://claude.ai/artifact/SBNmfHR725ds1nE6H7PDDH>
  - 歌词 J <https://claude.ai/artifact/PHVmyDCvqnVn7R3JhnFQUa>
  - 漫游歌词 K <https://claude.ai/artifact/6F2PnRcE6fcacYfUAvLtPv>
  - 设置面板 L <https://claude.ai/artifact/JC3mxeaZpovAVX6EykGm2K>
- 参照：Mineradio（材质）、Folia（歌词、Spotify / 汽水路线）是 GPL / AGPL，只借思路不搬代码。

### 已废弃 / 不再排期

- 汽水音乐取链（服务端按出口 IP 风控）→ 歌单播放走网易云 / QQ 兜底 + 多平台 VIP 路由；2026-11-17 找到新路线 `qishui-music-api`（车机协议），已列入完成度表待做，不再算废弃。
- 播放器内收藏 / 喜欢功能；
- "先做独立原型再搬代码"路线（原型归档在标签 `archive/ui-nebula-design` 的 `prototype/`，不作为实现真源）。

### 验证命令与产物路径（易踩）

- 本仓库：`pnpm build` + `pnpm qa`；后端改动另加 `pnpm qa:backend`。
- 桌面验收（在 `E:\CUFE\vibecoding\nebula`）：`pnpm build:desktop && pnpm desktop`。
- `pnpm build` 产物在**仓库外**的同级目录 `../nebula-outputs/`（本机 `E:\CUFE\vibecoding\nebula-outputs`）；`pnpm qa` 读取该产物，所以必须**先 build 再 qa**。

### 文档边界

- `docs/project/CHANGE_LOG.md`（90KB+）按约定只精读「最近 20 条 + 全量条目索引」，历史细节按条目日期回读。
