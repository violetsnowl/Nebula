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
6. `docs/design/*`（`UI_SPEC` / `LYRICS_SYSTEM`；UI 分支另有播放器三份母稿）
7. `docs/project/CHANGE_LOG.md` 最近 20 条 + `docs/project/NOTES.md`

## 模型迭代与连续性（为什么这份文件存在）

- 底层模型可能随供应商版本迭代被替换；同一线程的上下文窗口也会被 **compaction** 压缩（官方说明：compaction 降低上下文体积、保留后续轮次所需状态，但压缩项是不透明摘要，细节会损失）。
- 连续性因此分三层：① 线程对话历史（会在压缩中损失细节）；② 仓库文档（本目录 + CHANGE_LOG + 冻结设计规格，人类可读、可无限增长）；③ git 提交历史（事实基准）。
- **协议**：新会话 / 新 agent / 换模型后按上面「恢复路径」读完再动手；重大里程碑或会话结束时刷新本文件「当前状态」小节。`AGENTS.md` 已配置自动指向这条路径。

## 当前状态（2026-11-09 刷新；下方 10-14 小结为历史）

### 工作区拓扑（只有两个，勿再增加）

| 目录 | 分支 | 用途 |
|---|---|---|
| `E:\CUFE\vibecoding\nebula` | `main` | 主项目 / 生产线 |
| `E:\CUFE\vibecoding\nebula-ui` | `ui/nebula-design-deepseek-codex` | UI 设计线（Player 重构），**当前是 main 的超集** |

- 2026-11 用户把两个工作区从 `C:\Users\LIU\Documents\Codex\2026-08-10\wo\work\` 迁到 `E:\CUFE\vibecoding\`；构建产物在同级 `nebula-outputs`。路径以 `git worktree list` 为准。

- 两个工作区共享同一个 `.git`：**在任一处切换分支都会改变另一处的分支状态**；不要在两处同时切分支。
- 精确 HEAD 用 `git log -1` 取，本文件不记录会过期的哈希。
- 归档工作树（mimo-hermes）及目录已于 2026-10 删除，内容保存在远端分支 `ui/nebula-design`。

### 远端与分支

- 远端：`github.com/violetsnowl/nebula`（由 `a161858970-ux/nebula` 迁移，旧地址自动重定向；本地 `origin` 已更新）。
- 三条远端分支：`main`（生产线）、`ui/nebula-design-deepseek-codex`（活跃 UI 线）、`ui/nebula-design`（原型归档，仅留档、不再迭代）。

### 基线状态（2026-10-14 预合并）

- UI 分支已并入 main 的全部文档提交，成为 main 的超集；`git merge-tree main ui/nebula-design-deepseek-codex` 预演返回 0 —— **将来 branch → main 合并零冲突**，只差执行一次合并。

### 活跃任务：Nebula Player 重构（8 阶段，见 `docs/design/PLAYER_IMPL_PLAN.md`）

- **P1 Bottom Player**：已实现并两轮打磨（`2d18039` 结构重构 → `7e38760` 打磨 → `f79b65a` 二轮打磨）。用户验收时发现**旧 UI 遗留问题严重污染新组件**，视觉质量远未达预期，因此停手——先重做全局 UI 语言，再回到 P2。
- **挂起决策**：播放模式循环顺序（现「顺序→单曲→随机」vs 母稿「顺序→随机→单曲」）——留到全局 UI 重构那轮一并拍板。

### 主线任务：全局 UI 重构（2026-11-09 起）

- **GPT 母稿已交付但不是真源**：`docs/design/NEBULA_GLOBAL_UI_MASTER.md`（v1.3，G1–G133，2026-10-31 冻结）由 ChatGPT 逐题追问（grill）、用户逐题拍选项产出，**目前未入库**。过程材料（逐字台账 / 状态账本 / 旧 UI 判定表 / 组件规格源）在旧目录 `C:\Users\LIU\Documents\Codex\2026-08-10\wo\work\nebula-设计决策回收\`。
- **用户决定（2026-11-09）**：不直接把 GPT 母稿当真源开工。由 Claude 以独立前端设计师身份重新审视、重新设计；Claude 对母稿与现有 UI 有处置权，可修改甚至推翻。审查定稿、用户确认后，才产生新的全局 UI 真源，再开工。
- **项目初衷（用户原话要点）**：功能赛道已饱和，前端视觉要足够惊艳、高级才能脱颖而出（用户提到的参照：Mineradio、Folia）。用户不是专业工程师 / 设计师，难以用语言精确描述心中画面，所以借 AI 来完成"设计"本身。
- **下一步**：Claude 提出设计审查方案（勘察现状 → 诊断 → 视觉方向 → 定稿），用户确认后执行。

### 已废弃 / 不再排期

- 汽水音乐取链（服务端按出口 IP 风控）→ 歌单播放走网易云 / QQ 兜底 + 多平台 VIP 路由；
- 播放器内收藏 / 喜欢功能；
- "先做独立原型再搬代码"路线（原型归档在 `ui/nebula-design` 分支 `prototype/`，不作为实现真源）。

### 本窗口小结（2026-10-13 ~ 10-14）

1. **换模型后冷启动**：全量精读 docs；修正 NOTES 四处过时项；补 `AGENTS.md`（自动加载的恢复入口）与本文档「模型迭代与连续性」协议。
2. **main 新增开发期 `README.md`**：GitHub 展示版，含平台能力矩阵、架构、命令、已知限制、路线图与免责声明。
3. **UI 分支首次推送远端**做异地备份；记录仓库迁移与 origin 地址更新。
4. **接管并归档另一个 agent 的废弃工作窗**：产物提交为远端分支 `ui/nebula-design`（含独立 HTML 原型），随后删除其工作目录。
5. **工作区清理**：旧 Dock 原型归档到归档分支后删除本地副本；删除 `wo/outputs`（可再生）、过期 `qq-cookie.txt`、空 `.opencode/`。
6. **预合并**：main 文档并入 UI 分支，解决 CHANGE_LOG / CONTEXT_SNAPSHOT 冲突，消除将来合并冲突面。

### 验证命令与产物路径（易踩）

- 本仓库：`pnpm build` + `pnpm qa`；后端改动另加 `pnpm qa:backend`。
- 桌面验收在 UI 工作树：`pnpm build:desktop && pnpm desktop`。
- `pnpm build` 产物在**仓库外**的同级目录 `../nebula-outputs/`（本机 `E:\CUFE\vibecoding\nebula-outputs`），**两个工作区共用该路径、会互相覆盖**；`pnpm qa` 读取该产物，所以必须**先 build 再 qa**。

### 文档边界

- `docs/project/CHANGE_LOG.md`（90KB+）按约定只精读「最近 20 条 + 全量条目索引」，历史细节按条目日期回读。
