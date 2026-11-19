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

## 当前状态（2026-11-19 刷新，#192）

> 本节只写「现在是什么样、还剩什么」。每一步的背景、改动和验证都在 `docs/project/CHANGE_LOG.md`（按编号）和 git 提交里，2026-11-18 之前的逐日流水账已从本节移除。

### 工作区与分支

- 只有一个工作目录 `E:\CUFE\vibecoding\nebula`、一条分支 `main`；构建产物在同级 `nebula-outputs`。精确 HEAD 用 `git log -1` 取。
- 新功能直接在 main 上小步提交，每步 build + qa 全绿；实验性改动挂在默认隐藏的开发者开关后面；确需分支用短命分支，合并后即删。
- 远端 `github.com/violetsnowl/Nebula`，只有 `main`；标签 `v0.1.0-z1-random-checkpoint`、`archive/ui-nebula-design`（旧原型，不作为实现真源）。

### 现状（截至 #191）：没有做到一半的改动；Apple Music 等用户桌面验收

下面这些全部落地，并通过用户桌面验收（Apple Music 除外，见「待用户验收」）：

- **全局 UI 重构**（P0 清障 → P1 材质与环境 → P2 星云卡片 → P3 歌词字体 → P4 面板与 Dock）：真源 `docs/design/NEBULA_UI_SYSTEM.md`。两侧 Dock（歌单 / 导入，账号 / 设置），设置四分页（歌词 / 聆听 / 背景 / 外观）。
- **播放器（Player P2，#118–#131）**：新播放条；整屏听音空间（大封面一镜到底、右栏原地详情和评论）；歌词阅读栏引擎（`src/lib/listen/`）。
- **星云漫游歌词（Z1，#124–#125）**、**主舞台星云（#133–#140，真源 §8.0）**。
- **后端整修（#141–#156）**：播放代次与取消、有界取链、严格同录音兜底、QRC / KRC 解密、地址有效期、QQ 登录核验；完成度表 `docs/project/PLATFORM_MATRIX.md`。
- **听音空间细节（#158–#175）**：大封面清晰度、读音（韩语罗马音、日语罗马音与假名注音）、注音随字动、上场轻弹。
- **账号与平台**（现在 9 个平台：网易云、QQ、酷狗、酷我、波点、汽水、Spotify、YouTube Music、Apple Music）：
  - 登录过期提示（#157 / #162）；酷狗手机扫码（#164）；评论 / 详情跨平台兜底（#163 / #166）；
  - QQ 号登录自动续期（#178，用户日常确认不再掉登录）；
  - Spotify：默认浏览器授权（#183，解决 Google「此浏览器或应用不安全」），续期单飞（#181）；
  - 汽水：二维码在账号面板、二次验证在软件内弹窗（#183），封面修好（#183）；
  - 酷我（#180）、波点（#182）：登录、我的歌单、链接导入、播放；头像与「我喜欢听」空封面（#184）；
  - YouTube Music（#185–#187）：设备码登录（默认浏览器输入代码）、我的歌单、链接导入、跨平台播放、重启保持登录；
  - Apple Music（#191）：官方网页在软件内弹窗登录（令牌不出页面）、我的歌单（需有效订阅）、资料库 / 公开歌单导入、跨平台播放；用日常账号的实验配置副本实测通过；
  - 内嵌页面弹窗（#183）：QQ / 酷我登录页、汽水验证页、壁纸库都在软件内，登录页按宽度自动缩放（#184）。

### 活跃任务：平台扩展第一阶段完成，等 Apple Music 验收

- 顺序酷我 → 波点 → YouTube Music → Apple Music 已全部接完，平台列定住（九个）。用户 2026-11-18 定：第一阶段每家做到「能登录、能看到我的歌单、歌单能播放」；**第二阶段按功能横向补全**（歌词来源互补、内容页、搜索、会员识别等），从 PLATFORM_MATRIX 缺陷清单里按影响排。第二阶段先做哪项，等用户定。
- Apple Music（#191）：用户 2026-11-19 拍板路线 A（在官方页面里读，令牌不出页面）。调研与实测记录在 `docs/project/APPLE_MUSIC_HANDOFF.md` 顶部，实现在 ARCHITECTURE「Apple Music（#191）」，踩坑在 NOTES。
  - 用户有两个 Apple ID：一个没有订阅、没有歌单（只能测「没订阅」的提示）；日常账号有订阅、12 张歌单、1165 首歌。实测用的是实验时的独立配置（scratchpad 里的 userData-daily），不碰用户真实配置；那个临时目录随时可能被清。
  - 剩下的（第二阶段）：本平台逐字歌词（`syllable-lyrics`）、本平台出声（DRM，要原生宿主，工作量大）、搜索；自己上传的歌只有歌名，跨平台基本找不到。
- 本轮之前的关键决策（都经用户拍板）：
  - YouTube Music 用设备码登录（Google 只认 YouTube 电视端身份签的令牌）；「赞过的音乐」读不出，用「赞过的视频」代替，超过 15 分钟的视频不收；
  - **接 YouTube 本平台音频记为可选的下一项优化，暂不调研**；
  - 登录页一律在软件内弹窗；需要 Google 账号的走默认浏览器。
- 再加平台时：先探路；参照 folia（AGPL）只借思路和参数，代码自写；改动点见 ARCHITECTURE「加一个平台要改的地方」；模板用 `git log --grep '#185'`（YouTube Music）、`git log --grep '#191'`（Apple Music，页面引擎类）。

### 待用户验收：Apple Music（#191）

- 桌面版：账号面板里点 Apple Music →「打开 Apple Music 登录页」→ 在弹窗里登录日常账号 → 弹窗自动关闭、显示我的歌单 → 导入一张歌单播放；退出登录后再登录能换号。没订阅的号登录后账号面板应写明原因。


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
  - Apple Music 第二阶段：本平台逐字歌词、搜索（本平台出声要原生宿主，暂不排）；
  - 可选优化：YouTube Music 接本平台音频（用户 2026-11-18 定，暂不调研）；补「赞过的音乐」需要另加独立浏览器窗口登录；
  - 酷我：登录核验与过期提示、登录后高音质；波点：本平台逐字歌词接口、会员识别进路由（详见完成度表）。
- **界面**：
  - 约两成日语歌平台没给罗马音，标不了注音。用户 2026-11-18 决定：本地读音词典暂缓，先把歌词来源扩展到极致、多源互补，让各平台歌单的歌词效果接近；来源穷尽后仍有缺口再做词典；
  - 节奏光（加分项）：技术可行，表现要换，不做封面两侧随鼓点闪烁。
- **工程**：
  - 主舞台在 2K、0.57 倍缩放下帧耗时 p50 约 12.5ms，可改为直接写 transform；
  - QA 里播放用例从 soundhelix.com 取外网音频，「重新播放成功后置灰恢复」偶发失败（2026-11-18 出现过几次，重跑即过），可换成本地音频根治；
  - #137 拖动闪烁回归目前只跑在 16 首曲库上。

### 协作要点（新窗口先看）

- 用户在桌面版验收。**每一次回复**末尾都附两条运行命令（各占一个代码块，方便点击运行；2026-11-19 用户要求，不只交回时）：`pnpm build:desktop`、`pnpm desktop`。
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
