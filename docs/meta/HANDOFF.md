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
5. `docs/project/PROJECT.md` + `docs/project/ARCHITECTURE.md` — 总览、命令、架构与依赖规则
6. `docs/design/UI_SPEC.md` — UI 设计语言、Hover 规范、液态玻璃预留
7. `docs/design/LYRICS_SYSTEM.md` — Z1 穿梭歌词设计规格（参数与已废弃决策）
8. `docs/project/CHANGE_LOG.md` 最近 20 条 — 了解最近改动脉络与验证方式
9. `docs/project/NOTES.md` — 踩坑记录与待办

> 播放器重构的三份设计母稿（`NEBULA_PLAYER_DESIGN_SPEC` / `PLAYER_AGENT_BRIEF` / `PLAYER_IMPL_PLAN`）当前只在 UI 分支的 `docs/design/` 下，接手 Player 相关任务时先切到 UI 工作区再读。

---

## 1. 与用户协作的基本规则

1. **重大改动先沟通，确认后执行**。用户的惯例是：改动量大、方向性强时要求"先沟通明确项目需求，等我确认之后再做下一步执行"。小改动 / 明确请求直接做，不要反复确认。
2. **架构与重构：行为零变化**。重构只做结构整理，不改变视觉与行为；每步 `pnpm build` + `pnpm check:arch` + `pnpm qa` 全绿后独立提交，再继续下一步。
3. **UI 以现有实现为唯一真源**。项目曾发生过"参考 Prototype 重新设计导致整合爆炸"的教训；不允许为了"适配"而改变已确认的视觉结构。审美与参数先查 `UI_SPEC.md`，不要自由发挥。
4. **不要输出截图 png**。用户明确不需要 output 目录里的截图产物。
5. **git 每步提交 + 推送**。远程 `origin/main`（`github.com/violetsnowl/nebula.git`；旧地址 `a161858970-ux/nebula` 已迁移，会自动重定向）；文档与代码一起提交。
6. **文档同步**：每次改动追加 `docs/project/CHANGE_LOG.md`；踩坑更新 `docs/project/NOTES.md`；架构变化更新 `docs/project/ARCHITECTURE.md`；UI 规范变化更新 `docs/design/UI_SPEC.md`。
7. **搜索优先 `rg`**；本项目 Windows PowerShell 下不可用时改用 `Select-String`。
8. **沟通语言**：中文；结论先行，给可执行步骤。用户自述 git / 工程操作为新手，但产品与审美判断力强——技术细节按新手水平解释，方向性判断尊重用户。

---

## 2. 工作区拓扑与接手流程

**当前只有两个工作目录**（同一个 git 仓库的两个工作区，共享 `.git`）：

| 目录 | 分支 | 用途 |
|---|---|---|
| `wo/work/music-nebula` | `main` | 主项目 / 生产线 |
| `wo/work/music-nebula-ui Created by deepseek-codex` | `ui/nebula-design-deepseek-codex` | UI 设计线（播放器重构），当前为 main 的超集 |

- 因为共享 `.git`，**在任一处 `git checkout` 都会改变另一处的分支**；两个目录各自固定在自己的分支上，不要来回切。
- 远端三条分支：`main` / `ui/nebula-design-deepseek-codex`（活跃 UI 线）/ `ui/nebula-design`（原型归档，不参与迭代）。
- UI 分支已是 main 的超集，`git merge-tree` 预演确认将来 branch → main 合并零冲突。

**接手流程（建议照做）**

1. 按 §0 顺序读文档（约 10 分钟，token 预算可控）；
2. `git status` + `git log --oneline -5` + `git worktree list` 确认现场；
3. `pnpm build && pnpm qa` 确认环境健康（UI 工作树同理）；
4. 打开 `docs/meta/CONTEXT_SNAPSHOT.md` 的「当前状态」，按其指示的下一步继续；
5. 收尾按用户惯用清单：检查构建与 git → 固化文档 → 提交推送 → 按四问汇报（完成了什么 / 下一步 / 待拍板 / 风险）。

---

## 3. 用户反复强调的产品原则

- **Z1 歌词系统是项目特殊难点**："歌词播放沿时间推进，但视觉是多句并行；设计逻辑时不能只按传统垂直滚播考虑当前句，必须同时计算前后 1–2 句与已发生状态来调整整个匹配系统。"这是 Z1 的底层法则（详见 `docs/design/LYRICS_SYSTEM.md`）。
- **高级感 = 克制**：不滥用发光 / 跳动；玻璃是"载体"不是"装饰"；一切材质、颜色、动效参数走 CSS 变量，为未来「液态玻璃」第二套主题留路。
- **前瞻可读性优先**：当前句 + 下一句 + 下下句三句结构已锁定，不要退回纯随机穿梭。

---

## 4. 当前状态速览

- 架构收敛 9 步全部完成，App.tsx 从 1411 行收敛到 587 行；依赖规则由 `scripts/check-arch.mjs` 机制化强制。
- **最新状态一律以 `docs/meta/CONTEXT_SNAPSHOT.md` 为准**（本段仅为 2026-08-19 的历史快照锚点）。
- 当前活跃任务是「Nebula Player 重构」：P1（Bottom Player）已完成待用户复验，下一步等用户的全局 UI 底层重构母稿，再回 P2。
- 主要待办见 `docs/project/NOTES.md`；已废弃决策见 `docs/design/LYRICS_SYSTEM.md` §8「明确不做」。

---

## 5. 环境速查

- pnpm 需带 `$env:pnpm_config_verify_deps_before_run='false'`（Windows PowerShell）。
- Node 运行时与 QA 用本机 Chrome 的路径见 `PROJECT.md` §3 与 `scripts/qa.cjs` 顶部。
- 改动 `src/main`（后端）后必须 `pnpm build:main` 才能让 Electron 与冒烟测试生效。
- `pnpm build` 产物在**仓库外** `wo/outputs/music-nebula/`，两个工作区共用该路径、会互相覆盖；`pnpm qa` 读取该产物，所以**先 build 再 qa**。
- **换机器的坑**：`scripts/qa.cjs` 与 `scripts/desktop-play-smoke.mjs` 硬编码了三处本机路径（Chrome 可执行文件、Codex runtime 的 `node_modules`（playwright-core / pngjs）、outputs 目录），跨机器接手需先改这三处。
- **Windows 工作树坑**：删除含 `node_modules` 的工作树可能报 `Filename too long`——先 `git config core.longpaths true`，仍失败则用 robocopy 镜像空目录清空后再删；目录被改名导致注册失效时用 `git worktree repair <新路径>` 修复。
- 凭证：`qq-cookie.txt` / `.env` 均被 `.gitignore` 排除，切勿提交；仓库内现无任何真实凭证（旧的已过期 `qq-cookie.txt` 已于 2026-10-14 删除，重新做实账号验证需重新导出）。
