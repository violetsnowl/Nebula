# AGENTS.md — Music Nebula

> Codex 会自动加载本文件。用途：任何新会话 / 新 agent / 换模型后，**动手前先恢复项目上下文**。

## 恢复上下文（按序读，读完再动手）

1. `docs/meta/HANDOFF.md` — 协作规则与隐性约定
2. `docs/meta/USER_PROFILE.md` — 用户画像、审美偏好、反模式
3. `docs/meta/CONTEXT_SNAPSHOT.md` — 当前状态、活跃任务、挂起决策
4. `docs/project/ARCHITECTURE.md`（后端先看「后端链路总览」）+ `docs/project/CHANGE_LOG.md` 最近 20 条
5. `docs/README.md` — 文档索引与维护约定

## 硬性约定（不可自行放宽）

- 每步改动：`pnpm build` + `pnpm qa`（后端改动加 `pnpm qa:backend`）全绿后独立提交；每次改动追加 `docs/project/CHANGE_LOG.md`。
- `docs/design/*` 是冻结真源（NEBULA_UI_SYSTEM / LYRICS_SYSTEM / NEBULA_PLAYER_DESIGN_SPEC / PLAYER_AGENT_BRIEF / PLAYER_IMPL_PLAN）；不得自由发挥，不得静默改交互语义。全局 UI（材质、颜色、字体、hover、层级、组件外观）以 `NEBULA_UI_SYSTEM.md` 为准；`UI_SPEC.md` 已被取代，`NEBULA_DESIGN_REVIEW.md` 是审查记录，`archive/` 下是归档，三者都不是开工依据。
- Hover 反馈必须由元素自身呈现（文字 / 图标变亮、轻微 scale）；禁止圆形背景、外圈方框、通用发光。
- 颜色优先系统取色（封面 / 背景采样），禁止硬编码蓝。
- 不交付截图 png。
- 分支纪律（2026-11-16 起单主线，用户要求）：只有一个工作目录 `E:\CUFE\vibecoding\nebula`、一条主线 `main`。新功能直接在 main 上小步提交，每步 build + qa 全绿；实验性改动挂在默认隐藏的开发者开关后面，默认体验不变。确需分支时用短命分支，合并后立即删除；不再开长期分支或第二个工作树。旧原型只留标签 `archive/ui-nebula-design`（不作为实现真源）。
