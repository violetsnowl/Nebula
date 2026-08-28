# Nebula Player 重构 — 实施计划（决策固化）

> 状态：设计已冻结，进入实现。单一事实来源 = `NEBULA_PLAYER_DESIGN_SPEC.md` + `PLAYER_AGENT_BRIEF.md`。
> 本文档记录 grill 对齐结论（R1/R2）、架构决策与阶段跟踪；与 CHANGE_LOG 同步维护。

---

## 1. Grill 决策记录（用户确认）

| # | 决策 | 结论 |
|---|---|---|
| R1-Q1 | 改动边界 | 只动 BottomBar / NowPlayingPanel / 播放器新组件与 hooks / styles.css 播放器段 / AudioPlayer（队列+能量输入）/ 设置面板；Z1 歌词层、StageCanvas、InfoModals、dock、搜索、背景层一律不碰 |
| R1-Q2 | 验收节奏 | 每阶段用户亲自 `cd music-nebula-ui Created by deepseek-codex` + `pnpm build:desktop` + `pnpm desktop` 桌面端验收；不做截图；阶段通过后提交 |
| R1-Q3 | Listening Space 歌词默认形态 | 默认 Spatial；Spatial/Inner 切换控件置于右下角 |
| R1-Q4 | Bottom→Listening 变形 | 单一 PlayerSurface 身份 + FLIP 连续变形；**禁止**独立 modal 伪装；主舞台 backdrop 退场（blur/dim/降饱和，保持隐约可感知） |
| R1-Q5 | 收藏 | **彻底删除**（不做平台写回，也不做内部收藏） |
| R1-Q5 | 翻译 | 仅 Inner 模式显示翻译为次要小字；翻译开关与 Spatial/Inner 切换 pill 并列右下角；Spatial 模式下翻译 pill 禁用态 |
| R1-Q6 | 设置落点 | 并入「界面设置」tab 新增「播放器」分组（外观/歌词呈现/行为/环境 + Restore Default 置顶）；不新增 dock tab |
| R1-Q7 | Auto-hide | 默认关闭；设置提供持久开关；开启后底部残留细边缘条可点击唤醒/暂隐 |
| R1-Q8 | 队列 | 仅「即将播放」项可移除；「下一首播放」多首 FIFO（先加先播） |
| R2-Q9 | 全局设置拆分 | 本次并入界面设置；未来（不在此任务）重构为 外观/歌词/系统 三大类 + 基础/高级两级 DIY |
| R2-Q10 | 播放器歌词设置 | 与现有 Z1 `lyricSettings` **完全解耦**，独立设置组，互不影响 |
| R2-Q11 | Listening Space 退出 | 仅 Escape + 点击主舞台空白；**不做**收起图标 |
| R2-Q11 | Listening Space 内 Song/Artist | 纯信息，不可点击（详情/歌手入口保留在底部条） |
| R2-Q12 | Bottom Player 工具簇 | 播放模式（常显）→ 音量（图标常显+上方细滑杆）→ 队列（常显）→ 音质（低权重文字徽章）→ 评论（末位低权重）；翻译按钮从底部条移除 |

---

## 2. 架构决策

### 2.1 PlayerSurface 单一身份

- 一个组件 `PlayerSurface` 持有两种呈现态：`compact`（Bottom Player）与 `expanded`（Listening Space）。
- 同一 DOM 根元素切换 class + 内部组合；变形用 FLIP / 几何过渡，禁止卸载重挂。
- Phase 1 只实现 compact；expanded 在 Phase 2 加入，结构上先留好开关。

### 2.2 材料系统（Frosted，Liquid 兼容）

- CSS 变量承载材料参数（表面色/模糊/饱和/高光/阴影），Liquid 未来只换变量不换结构。
- Balanced Frost：背景色与光可感知、细节扩散、低环境 tint、无常显边框、弱环境边缘响应、弱内反射、弱接触+环境阴影、微小厚度；禁止嵌套玻璃。
- 从现有"液态玻璃 V2 渐变边框"组中移除 bottom bar（禁止常显边框）。

### 2.3 反模式自检清单（实施时逐项对照）

禁：常显发光边框 / 霓虹渐变场 / 粒子星点 / 巨型播放键 / 等宽按钮游行 / 默认 marquee / modal 换页 / 切歌闪光 / Orb 漂移 / 文字自发光 / 拖拽歌词 / Frosted=最大 blur。

### 2.4 性能与降级

降级顺序：大 blur → 背景氛围层 → 歌词 blur 深度 → Orb 连续运动 → 氛围事件 → 高成本材料响应。保留：歌名/歌手、播放状态、当前歌词可读性、核心交互。

---

## 3. 阶段计划（每阶段后用户桌面端验收）

| 阶段 | 内容 | 状态 |
|---|---|---|
| P1 | Bottom Player 结构（几何/三区/进度/工具簇/队列+FIFO insertNext） | 完成，待用户桌面端验收 |
| P2 | Listening Space shell / Bottom→Listening morph / 主舞台退场 | 待做 |
| P3 | Music Orb（锚点稳定/进度轨道/暂停静默/恢复唤醒/切歌过渡） | 待做 |
| P4 | Spatial Lyrics（外置、上下同当前行、稳定轴、深度） | 待做 |
| P5 | Inner Lyrics（左对齐、5–7 行、滚动/点击 seek/回到当前、逐字高亮/长音擦除） | 待做 |
| P6 | 状态与 morph 编排（Spatial↔Inner、Bottom↔Listening、播放/暂停/切歌状态机） | 待做 |
| P7 | Atmosphere / energy / airflow（三场域、独立气流、能量映射、低频谱事件） | 待做 |
| P8 | Frosted 打磨 + 性能 + 设置/DIY + Restore Default + 自动隐藏 | 待做 |

---

## 4. 现状映射与改动点

- `src/components/BottomBar.tsx` → 删除，由 `src/components/player/PlayerSurface.tsx`（compact）+ `BottomPlayer.tsx` 取代。
- `src/components/NowPlayingPanel.tsx` → Phase 2 由 Listening Space 取代（文件保留至 P2）。
- `src/lib/audio/AudioPlayer.ts`：
  - `insertNext` 改为 FIFO（viaNext 段标记）；
  - 新增 `getQueueSnapshot()` / `removeUpcoming(trackId)` / `playQueueItem(trackId)`；
  - Phase 7 新增能量输入（AnalyserNode，独立于 airflow）。
- `liked`：Phase 2 随 NowPlayingPanel 重写时清除（App/OverlayStack/useStage 相关接线）。
- 设置：`AccountDock` 界面设置 tab 内新增「播放器」分组（P8 落地）。

---

## 5. 未来/开放项（不在本次任务）

Liquid Glass；高级音频分析（onset/BPM/分节）；进阶频谱切歌；环境光学；背景复杂度自适应 blur；队列高级视觉；全局设置重构（外观/歌词/系统）。
