# Music Nebula — 新接手者交接手册（HANDOFF）

> 用途：跨模型 / 跨 agent harness 接手本项目的必读入口。
> 本文档回答「项目是什么」之外的三个问题：怎么和用户协作、接手时先读什么、有哪些隐性约定。
> 维护：本文件有修改时同步追加 `CHANGE_LOG.md`。

---

## 0. 必读顺序（未读完全前不写代码）

1. `AGENTS.md`（仓库根）— Codex 自动加载的硬性约定与恢复入口
2. 本文件（HANDOFF.md）— 协作规则 + 工作区拓扑
3. `docs/meta/USER_PROFILE.md` — 用户画像与审美偏好
4. `docs/meta/CONTEXT_SNAPSHOT.md` — 当前状态与活跃任务
5. `docs/project/PROJECT.md` + `docs/project/ARCHITECTURE.md` — 总览、命令、架构与依赖规则；**后端先看 ARCHITECTURE「后端链路总览」**（播放、歌词、评论 / 详情三条链路的总图，2026-11-19 起）
6. `docs/design/NEBULA_UI_SYSTEM.md` — 全局 UI 真源（2026-11 冻结）：光学材质（液态 / 磨砂）、环境光、token、交互状态、卡片、组件、实施批次。旧的 `UI_SPEC.md` 已被取代
7. `docs/design/LYRICS_SYSTEM.md` — Z1 穿梭歌词设计规格（参数与已废弃决策）
8. `docs/project/CHANGE_LOG.md` 最近 20 条 — 了解最近改动脉络与验证方式
9. `docs/project/NOTES.md` — 踩坑记录与待办

> 播放器重构的三份设计母稿（`NEBULA_PLAYER_DESIGN_SPEC` / `PLAYER_AGENT_BRIEF` / `PLAYER_IMPL_PLAN`）在 `docs/design/` 下（2026-11-16 随 UI 分支合入 main），其中被推翻的部分以 `NEBULA_UI_SYSTEM.md` §9.9 为准。

---

## 1. 与用户协作的基本规则

1. **重大改动先沟通，确认后执行**。用户的惯例是：改动量大、方向性强时要求"先沟通明确项目需求，等我确认之后再做下一步执行"。小改动 / 明确请求直接做，不要反复确认。
2. **架构与重构：行为零变化**。重构只做结构整理，不改变视觉与行为；每步 `pnpm build` + `pnpm check:arch` + `pnpm qa` 全绿后独立提交，再继续下一步。
3. **UI 以冻结真源为准**。全局 UI 的视觉与参数以 `docs/design/NEBULA_UI_SYSTEM.md` 为唯一真源（2026-11 起，取代"以现有实现为真源"）；其中没写到的，以现有实现为准，不要自由发挥。项目曾发生过"参考 Prototype 重新设计导致整合爆炸"的教训：视觉样张只用于做决定，实现必须在分支里原生编写，不允许为了"适配"而改变已确认的视觉结构。
4. **不要输出截图 png**。用户明确不需要 output 目录里的截图产物。用户主动要截图验收时（2026-11-21 起），截图放草稿目录直接发给用户，不进仓库。
5. **git 每步提交 + 推送**。远程 `origin/main`（`github.com/violetsnowl/Nebula.git`，2026-11-14 改名；旧地址 `violetsnowl/nebula`、`a161858970-ux/nebula` 会自动重定向）；文档与代码一起提交。
6. **文档同步**：每次改动追加 `docs/project/CHANGE_LOG.md`；踩坑更新 `docs/project/NOTES.md`；架构变化更新 `docs/project/ARCHITECTURE.md`；全局 UI 规范变化更新 `docs/design/NEBULA_UI_SYSTEM.md`（已冻结，改动须经用户确认）。
7. **搜索优先 `rg`**；本项目 Windows PowerShell 下不可用时改用 `Select-String`。
8. **沟通语言**：回复和过程说明一律简体中文（上下文变长、上文出现英文时也不切换，2026-11-18 用户提醒过）；结论先行，给可执行步骤。用户是本产品的开发者，产品与审美判断力强：不要讲得太浅（2026-11-18 用户纠正），也不要太技术性，讲到功能和效果层面、少堆实现细节和术语（2026-11-19），git 操作可以多说一句做了什么；方向性判断尊重用户。
9. **多个会话并行时**（2026-11-17 起常见：主对话做界面，分叉会话做后端，同一目录、同一条 main）：
   - **提交前一刻**重读 `CHANGE_LOG.md` 顶部最新编号再取号，日志和提交信息同时用这个号。提前想好的号会因对方先提交而过期，11-17 就撞过 #159 / #160。
   - 只提交自己的文件（`git commit --only <路径>`），对方可能有没提交的改动。推送后告诉对方下一个空号。
   - 改对方负责的界面文件之前先打招呼。主对话的界面约定（如来源小字只用现有弱文字）以主对话为准。
10. **真实账号测试**：用户已授权用他的登录和歌单做测试，但只能用配置的副本，做法见 `docs/project/NOTES.md`「真实数据测试的做法」。凭据、歌单数据、统计结果都不进仓库。

---

## 2. 工作区拓扑与接手流程

**约定是一条主线**（2026-11-16 起，用户要求），但**现场目前有两个工作树**：

| 目录 | 分支 | 用途 | 状态 |
|---|---|---|---|
| `E:\CUFE\vibecoding\nebula` | `main` | 主开发线（后端、平台接入、共享 UI） | 本轮工作的位置 |
| `E:\CUFE\vibecoding\fe\nebula` | `fe/next` | 前端歌词 / 版面（样张 M / N、段落引擎、逐字波浪） | **并行窗口在维护，领先 main 约 19 个提交；未推送** |

- **在 main 上工作时只碰 main 的文件**。看到 `fe/next` 或 `E:\CUFE\vibecoding\fe\nebula` 的东西，不要清理、不要提交、不要合并——那是另一个窗口的活。
- 那个分支是否合回 main、是否保留，**先问用户**（2026-11-22 收尾时它已经存在且在工作，我没动）。
- 新功能在 main 上小步提交，每步 `pnpm build` + `pnpm qa` 全绿后提交并推送。
- 实验性改动（如主舞台方向原型）挂在默认隐藏的开发者开关后面，默认体验不变。
- 确需分支时用短命分支，合并后立即删除；除上面的 `fe/next` 外不再开长期分支。
- 远端只有 `main`（`fe/next` 未推）。标签：`v0.1.0-z1-random-checkpoint`；`archive/ui-nebula-design`（原 `ui/nebula-design` 分支：mimo-hermes 独立 HTML 原型、旧 Dock 原型，不作为实现真源；取回用 `git checkout archive/ui-nebula-design -- prototype/`）。

> 历史：2026-11 用户把工作区从 `C:\Users\LIU\Documents\Codex\2026-08-10\wo\work\` 迁到 `E:\CUFE\vibecoding\`，构建产物在同级 `nebula-outputs`；脚本里尽量用相对路径。2026-11-16 UI 分支 `ui/nebula-design-deepseek-codex` 快进合入 main 后删除，`nebula-ui` 工作树收掉。2026-11-22 记录 `fe/next` 的存在（见上表）。

**接手流程（建议照做）**

1. 按 §0 顺序读文档（约 10 分钟，token 预算可控）；
2. `git status` + `git log --oneline -5` + `git worktree list` 确认现场；
3. `pnpm build && pnpm qa` 确认环境健康；
4. 打开 `docs/meta/CONTEXT_SNAPSHOT.md` 的「当前状态」，按其指示的下一步继续；
5. 收尾按用户惯用清单：检查构建与 git → 固化文档 → 提交推送 → 按四问汇报（完成了什么 / 下一步 / 待拍板 / 风险）。

---

## 3. 用户反复强调的产品原则

- **Z1 歌词系统是项目特殊难点**："歌词播放沿时间推进，但视觉是多句并行；设计逻辑时不能只按传统垂直滚播考虑当前句，必须同时计算前后 1–2 句与已发生状态来调整整个匹配系统。"这是 Z1 的底层法则（详见 `docs/design/LYRICS_SYSTEM.md`）。
- **高级感 = 克制**：不滥用发光 / 跳动；玻璃是"载体"不是"装饰"；一切材质、颜色、动效参数走 CSS 变量，为未来「液态玻璃」第二套主题留路。
- **前瞻可读性优先**：当前句 + 下一句 + 下下句三句结构已锁定，不要退回纯随机穿梭。
- **全平台开发者视角**（2026-11-18）：软件面向各平台的所有用户，后端排优先级看「全平台 × 全功能」，不看开发者自己登录了哪些账号；每次后端变更在同一次提交里更新 `PLATFORM_MATRIX.md`，表的写法不变。
- **登录体验**（2026-11-18）：官方网页登录放在软件内的弹窗里（`electron/embeddedSheet.cjs`），风格与其他弹窗一致，不另开带系统标题栏的窗口；Google 这类不允许内嵌登录的，用用户的默认浏览器（复用浏览器里已有的登录），不开空白浏览器实例；陌生的登录方式要把步骤写清楚、能一键的做成一键。

---

## 4. 当前状态速览

- **最新状态、活跃任务和待办一律以 `docs/meta/CONTEXT_SNAPSHOT.md` 为准**，本节不再记进度。
- 架构收敛 9 步全部完成；依赖规则由 `scripts/check-arch.mjs` 机制化强制（随 `pnpm qa` 运行）。
- 平台功能缺口见 `docs/project/PLATFORM_MATRIX.md`；踩坑见 `docs/project/NOTES.md`；已废弃决策见 `docs/design/LYRICS_SYSTEM.md` §8「明确不做」。

---

## 5. 环境速查

- pnpm 需带 `$env:pnpm_config_verify_deps_before_run='false'`（Windows PowerShell）。
- Node 运行时与 QA 用本机 Chrome 的路径见 `PROJECT.md` §3 与 `scripts/qa.cjs` 顶部。
- 改动 `src/main`（后端）后必须 `pnpm build:main` 才能让 Electron 与冒烟测试生效。
- `pnpm build` 产物在**仓库外**的同级目录 `../nebula-outputs/`（本机 `E:\CUFE\vibecoding\nebula-outputs`）；`pnpm qa` 读取该产物，所以**先 build 再 qa**。
- **换机器的坑**：`scripts/qa.cjs` 经 `scripts/qa-env.cjs` 找依赖，可用 `NEBULA_QA_MODULES` / `NEBULA_CHROME` 两个环境变量覆盖（默认仍指本机的 Codex runtime 和 Chrome）；`scripts/desktop-play-smoke.mjs` 可能仍是硬编码，换机先核对。outputs 目录是相对仓库的 `../nebula-outputs`（与 `vite.config.ts` 的 `outDir` 一致）。
- `pnpm qa:backend` 现在跑十几套后端回归（取链、路由、录音匹配、地址寿命、QQ 会话与续期、歌词、韩语罗马音、八平台导入契约、酷我、波点、YouTube Music、汽水扫码、内嵌页面宿主、Spotify 令牌等），全部离线，不需要账号。
- `pnpm qa` 不再依赖外网：演示曲目的音频（soundhelix.com）由 QA 脚本就地拦下、换成本地静音 WAV（#193）。以前「重新播放成功后置灰恢复」网慢时偶发失败（2026-11-18～19 出现过多次），已根治；现在 `pnpm qa` 再出红就是真问题，不要靠重跑。
- **Windows 工作树坑**：删除含 `node_modules` 的工作树可能报 `Filename too long`——先 `git config core.longpaths true`，仍失败则用 robocopy 镜像空目录清空后再删；目录被改名导致注册失效时用 `git worktree repair <新路径>` 修复。
- 凭证：`qq-cookie.txt` / `.env` 均被 `.gitignore` 排除，切勿提交；仓库内现无任何真实凭证（旧的已过期 `qq-cookie.txt` 已于 2026-10-14 删除，重新做实账号验证需重新导出）。
