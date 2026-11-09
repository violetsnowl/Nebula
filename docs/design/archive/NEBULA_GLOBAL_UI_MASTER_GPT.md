> **归档说明（2026-11-09）**：这是 ChatGPT 与用户通过 133 道选择题（G1–G133）产出的全局 UI 母稿 v1.3，**不是真源**。
> 用户决定由 Claude 独立重新审视；审查过程见 `../NEBULA_DESIGN_REVIEW.md`，定稿见 `../NEBULA_UI_SYSTEM.md`。本文只作参考：其中的离散数值分档、层级治理、焦点与浮层生命周期、发光授权等思想已被定稿吸收。
> 正文保持原样未改；文中提到的逐字台账、状态账本、旧 UI 判定表在仓库外（用户本机的设计决策回收目录）。

# NEBULA · Global UI Master Specification
### v1.3 · G1–G133 全量冻结版（原则层 + 16 张数值表 + C1–C10 组件规格 · 单文件版）

| 项目 | 值 |
|---|---|
| 状态 | **DESIGN FROZEN v1.0** · 133 条决策全部已拍板（全部 D 方案） |
| 冻结日期 | 2026-10-31 |
| 适用范围 | Nebula 桌面端全部非 Player 界面（Global UI 层） |
| 不适用范围 | Bottom Player / Listening Space / Spatial Lyrics / Inner Lyrics / Music Orb —— 以各自冻结母稿为准 |
| 来源 | ChatGPT 导出原文 131 条（2026-10-22）＋ 跨会话补拍 G132 / G133（2026-10-31） |
| 逐字台账 | `NEBULA_GLOBAL_UI_MASTER_G1-G131.md`（每条原文 + 消息序号） |
| 状态账本 | `LEDGER_GlobalUI.md`（🔒 / 🟡 / 🔴） |
| 数值与清单 | 第 3 节，🔒 FROZEN（2026-10-31） |

---

## 0 · 怎么用这份文档

**读者是执行 Agent，不是人。** 它必须能回答一个具体动作：

> 我要新做一个 Nebula 页面 / Button / Card / Input / Modal / Menu / List Item，到底该怎么做？

### 0.1 真源优先级

```text
Stage / Component Spec（Player、Listening Space 等已冻结母稿）   ← 最高
        ↑
Global UI Master Specification（本文档）
        ↑
Q1–Q151 探索素材（不是规范，不得直接引用为规则）
```

- **Specific beats General**：Player 母稿与本文件冲突时按 Player 执行，再问「是 Global 太粗暴，还是 Player 需要一条专项例外」。
- **Q 系列不是规范**：Q1–Q151 是探索素材，只作背景理解。
- **每条规则都可追溯**：引用时必须带编号（例：「按 G21，hover 不做 scale」）。

### 0.2 三层结构（G1）

```text
NEBULA GLOBAL UI SYSTEM
├─ Foundation             视觉底色与基础规则
│   Color / Light / Material / Typography / Icon
│   Spacing / Radius / Motion / Interaction / Accessibility
├─ Shared Components      全项目通用标准组件
│   Button / Input / Select / Toggle / Checkbox / Radio
│   List Item / Card / Chip / Badge / Menu / Tooltip
│   Toast / Dialog / Sheet / Scroll affordance
└─ Stage-owned Components  有明确艺术语义的专项空间
    Button Player / Listening Space / Lyrics / Orb
```

### 0.3 一句话系统观

> **Global UI System 是整个 Nebula 的系统底色（System Ground / Visual Baseline）。不是所有页面都必须长得一样，而是所有页面都必须生活在同一个 Nebula 里。**

---

## 1 · 系统总纲

### 1.1 十条根原则

**1. Specific beats General** —— 专项母稿优先于全局规则；全局提供能力、边界与语言。

**2. One World, One Light** —— 整个软件共享同一套光与空间逻辑，不允许某个模块自带一套光照。

**3. Semantic over decorative** —— 颜色、层级、动效、发光都先回答「表达什么意义」，再谈好不好看。

**4. Discrete core + optical correction** —— 基础值离散、可治理；只允许极小光学校正，不允许组件发明几何。

**5. Capability, not style** —— 动效、发光、状态表达都是被授予的能力，不是随手可用的样式属性。

**6. Default silence** —— 默认不动、默认不发光、默认不加阴影；额外表达必须有语义理由。

**7. Attention is budgeted** —— 每个状态的通道、强度、面积、时长都受 Expression Budget 约束。

**8. Preserve meaning, not shape** —— 空间连续性与身份连续性都服务于「用户是否还认得这是什么」。

**9. Sources propose, Environment decides** —— 任何来源只能提 Influence，不能直接写环境。

**10. Accessibility is first-class** —— Focus 与 Reduced Motion 是系统的一等状态，不是补丁。

### 1.2 术语表

| 术语 | 含义 | 出处 |
|---|---|---|
| System Ground | 整个软件的视觉底色与基础规则层 | G1 |
| Surface Ground | 内容「坐在哪里」的地面，而不是一块可见面板 | G3 |
| Spatial Separation | 靠空间关系而非边框表达层级 | G4 |
| Radius Family | 离散圆角家族，任何圆角必须归属其中之一 | G5/G6 |
| Expression Budget | 单个状态允许占用的通道、强度、面积、时长总量 | G68 |
| Emission Capability | 发光权：只有被授予的语义角色才能发光 | G133 |
| Semantic Anchoring | 浮层在视觉与语义上归属于触发对象 | G30 |
| Identity Continuity | 形态改变后是否仍是同一个对象 | G132 |

---

## 2 · 领域规则书

> 结构：**定位 → Agent 硬约束 → 该领域全部冻结决策（核心规则 / 说明 / 原文定位）**。


## A · 底座：System Ground 与 Surface 世界

定义 Global UI 的身份、边界和「地面」。所有页面的第一层判断都来自这里。

**Agent 硬约束**

- Global 只提供三层：Foundation / Shared Components / Stage-owned；Stage 拥有自己的艺术表达权。
- 普通页面默认落在 Base Surface；玻璃只用于需要空间关系、或需要「浮起」的地方。
- 层级靠 Surface Ground + Spatial Separation + Material 响应表达，不靠硬边框把页面切成格子。

#### G1 · Global UI 的边界

**D · Global Foundation + Explicit Stage Ownership**

> **Global UI System 是整个 Nebula 的系统底色（System Ground / Visual Baseline）。**

不是“所有页面都必须长得一样”，而是：

> **所有页面都必须生活在同一个 Nebula 里。**

这样三层关系最终就很清楚了：

```text
NEBULA GLOBAL UI SYSTEM
│
├─ Foundation
│   └─ 整个软件的视觉底色与基础规则
│
├─ Shared Components
│   └─ 全项目通用的标准组件
│
└─ Stage-owned Components
    └─ 有明确艺术语义的专项空间
```

而且这个“底色”非常重要：**旧 UI 的问题不是“某几个按钮长得丑”，而是它们根本没有共享同一个世界。

<sub>原文台账 G1（消息 430）</sub>

#### G2 · Global System 最核心的“Surface World”应该是什么？

**D · Contextual Layered Material System**

这次我希望它成为真正的 Global Foundation 核心：

> **Global UI 不是一个 Material，而是一套有层级、有语义、有上下文的 Material System。**

基础上存在稳定的：

**Surface Layers**

但具体表现可以根据：

**Component Role**  
**Elevation**  
**Context**  
**Content Density**  
**Environment**  
**Interaction State**

进行有限调制。

比如：

**普通 Settings Page**

→ 非常稳定、低 optical activity。

**Search Overlay**

→ 更高层、更透明、更明确的 material separation。

**Dropdown**

→ Elevated / Overlay Surface。

**Tooltip**

→ 小而明确，不需要做成一块“玻璃艺术品”。

**Button Player**

→ 使用自己的专项 Material Definition。

**Listening Space**

→ 使用专项母稿里的 Material Definition。

所以最终：

> **Global System 给所有 Surface 一个共同的“材料物理学”；具体页面再决定它们处于这个世界中的哪一层。**

这尤其重要，因为我们现在正要处理的**旧 UI**很可能存在这种问题：

正式确定。

<sub>原文台账 G2（消息 433）</sub>

#### G3 · Global Surface 层级到底应该有多“实”？

**D · Contextual Surface Ground**

但它和 B 有一个很大的区别：

**Nebula 应该有一个“Surface Ground”，但这个 Ground 不一定表现成一整块看得见的背景板。**

也就是说：

> **Surface Ground 是结构层，不一定是视觉层。**

在某些页面，它可以接近实体 / 稳定的 Base Surface。

在另一些空间，它可以几乎与 Environment 融合。

最终由：

**Stage / Density / Content Type / Focus / Environment / Window Size**

共同决定它的可见程度。

例如：

**Settings / Dense Data UI**

→ Ground 更明确、更稳定。

**Library**

→ Ground 可以弱一些，让内容与 Environment 联系更紧。

**Artwork-heavy Editorial Page**

→ Ground 可以进一步退让。

**Listening Space**

→ 不走 Global Ground，而由自己的 Stage Material 规则接管。

所以我真正想定的不是：

> “Nebula 到底有没有 Base Surface。”

而是：

> **Base Surface 是 Nebula 的结构性地面，但它是否“看得见”，取决于空间。**

这会避免两个极端：

**所有东西浮在背景上 → 像概念设计稿。**

**整个 App 都铺一层玻璃板 → 像玻璃后台管理系统。**

我倾向 **D**，而且这会成为以后我们处理旧 UI 时非常重要的一条判断标准。

<sub>原文台账 G3（消息 436）</sub>

#### G4 · Global UI 如何表现“层级分离”？

**D · Hierarchical Separation**

我们已经把 Global Surface World 的第一层骨架搭起来了：

**Surface Ground**  
→ 决定“东西坐在哪里”

**Spatial Separation**  
→ 决定“东西为什么属于不同层”

**Material / Optical Response**  
→ 强化这种层级

而不是靠一堆边框把页面切成格子。

现在继续，但我会控制范围——**我们开始进入真正的 Global Foundation token。

<sub>原文台账 G4（消息 439）</sub>


## B · 几何：Radius / Curvature / Spacing / Density

几何是「关系」的语言，不是数值表。它决定同一空间里的东西看起来是否属于同一家族。

**Agent 硬约束**

- 任何 radius 必须能回答「它属于哪个 Radius Family」，答不上来就回退；同一空间内相关对象共享 curvature language。
- 允许 ±1px 级别的光学校正，不允许组件自己发明几何。
- Spacing 先定语义关系（图标↔文字=紧、区块↔区块=松）再取 token；Density 是系统能力，不是排版手感。

#### G5 · Nebula 的圆角应该是什么？

**D · Semantic Geometry System**

> **Radius 首先是几何语义，而不是装饰参数。**

Global Foundation 定义有限的 Radius Family，但具体取值由：

**Component Role**  
**Spatial Scale**  
**Material Layer**  
**Content Density**  
**Geometry Relationship**

共同决定。

例如：

**Micro Controls**
→ 小 radius / 更接近紧凑几何

**Standard Controls**
→ 中等 radius

**Cards / Panels**
→ 更大的 curvature

**Large Floating Surfaces**
→ 更高 curvature

但还有一个非常重要的原则：

> **同一空间里，相关对象必须共享 curvature language。**

也就是说，一个 Panel 里面的 Button 不能是 8px，而旁边的 Input 突然 20px，彼此没有任何几何关系。

同时：

> **Nebula 的圆角应该“有重量感”，而不是“所有东西都是胶囊”。**

这也和我们之前已经定好的 **Button Player 是 rounded rectangle、不是 pill** 的方向完全一致。

我倾向 **D**。

**G5，你定。**

<sub>原文台账 G5（消息 444）</sub>

#### G6 · Radius 的“连续性”要不要允许？

**D · Semantic Curvature Field**

> **Geometry 的基础值是离散、稳定、可复用的；最终视觉曲率可以在非常有限的范围内根据空间尺度和相邻对象进行 Optical Adjustment。**

所以：

```text
Semantic Role
    ↓
Radius Family
    ↓
Scale / Context
    ↓
Small Optical Correction
    ↓
Final Curvature
```

不是任意连续计算。

这样我们既不会陷入：

> “所有东西只能是 8 / 12 / 16 / 20”

的机械感，

也不会变成：

> “每个组件都拥有一个自己算出来的 13.7px。”

最终原则就是：

> **离散的几何语言 + 连续但极小的光学校正。**

这应该能让 Global Geometry 既统一，又不会僵硬。

<sub>原文台账 G6（消息 447）</sub>

#### G7 · Spacing 应该采用什么语言？

**D · Semantic Spacing System**

我觉得它应该和 G5/G6 一样成为 Foundation：

> **Spacing 不是纯数字，而是关系。**

系统定义有限的 **Spacing Families / Rhythms**，但最终间距由对象之间的语义关系决定。

例如：

**Icon ↔ Label**  
→ Tight relationship

**Title ↔ Subtitle**  
→ Close relationship

**Section ↔ Section**  
→ Clear separation

**Content ↔ Content**  
→ Compositional spacing

**Content ↔ Environment**  
→ Negative Space / Breathing room

所以不是：

> “所有东西之间都用 16px。”

而是：

> **“这些东西为什么应该离这么远？”**

并且我们之前确定的 Dynamic Negative Space 在这里会正式发挥作用：

> **系统可以为了形成 Attention / Composition，而增加空间；但这个增加也必须属于已知的 Spacing Rhythm，而不是临时乱塞。**

我会特别想避免一种结果：

> “因为 Nebula 很高级，所以把所有地方 padding 40px。”

那会变成**昂贵感，而不是高级感**。

我倾向 **D**。

<sub>原文台账 G7（消息 450）</sub>

#### G8 · Nebula 要不要有明确的 Density System？

**D · Semantic Density System**

Nebula 不定义“一个全局密度”，而是建立少量有明确语义的 Density Bands：

**Compact**  
→ 高信息效率

**Balanced**  
→ Nebula 默认工作状态

**Spacious**  
→ 高沉浸 / 高可读 / 强 Editorial

必要时可以存在特殊的：

**Dense Data / Expanded Editorial**

但它们不是随便选。

Density 应该由：

**Stage**  
**User Task**  
**Content Complexity**  
**Available Space**  
**Focus**

共同决定。

而且非常重要的一点：

> **Density 改变的是信息之间的关系，不只是把 padding 全部缩小。**

所以 Compact 不应该等于：

> “所有东西 -4px。”

它可以体现为：

**减少装饰性留白**  
**压缩次级 metadata**  
**缩短相关元素之间的距离**  
**降低低价值内容存在感**

而核心内容的阅读空间未必跟着缩。

反过来 Spacious 也不是：

> “所有东西 padding +12px。”

而是：

**让重要内容之间拥有更充分的 Negative Space。**

<sub>原文台账 G8（消息 453）</sub>


## C · 色彩 · 光学 · 层级

语义色管意义，氛围色管空气；Border / Shadow / Blur / Transparency 都是层级证据。

**Agent 硬约束**

- 语义色不随封面变化；氛围色可以流动，但不得改变语义与可读性。
- Elevation ≠ Shadow 强度：可以用 Material / Light / Blur / Edge 表达浮起，不必堆黑影。
- 嵌套 Surface 必须继承父级世界；Overlay 出现时底层 World 要「退让」而不是消失。

#### G9 · Global Color System 到底应该怎么建立？

**D · Stable Semantic Color System + Contextual Atmospheric Color**

这应该和我们现在的 **One World, One Light** 明确区分：

**Global UI Color**  
→ 稳定、语义化、可预测

**Atmospheric Color**  
→ 可以被 Artwork / Music / Stage 改变

两者不是同一个 Color Layer。

<sub>原文台账 G9（消息 456）</sub>

#### G10 · Nebula 的 Semantic Color，应该有多“彩”？

**D · Controlled Chromatic Semantics**

> **Nebula 的 Semantic Color 可以有色彩，但色彩必须服务于语义，而不是装饰。**

默认：

**Neutral-first**

然后存在受控的：

**Accent**  
**Positive**  
**Warning**  
**Error**  
**Information**  
**Focus**

它们各自有完整的语义色阶。

但整体视觉上：

**彩度受控**  
**数量受控**  
**面积受控**

而且颜色表现也可以根据 Surface / Light / Contrast Context 做很小的 optical adjustment。

例如一个 Error 不一定是“亮红色大面积警报”，可以是：

> 一小块准确、克制、具有足够辨识度的红色语义信号。

反过来，Atmosphere 可以有：

> 更丰富、更柔和、更连续的色彩。

所以最终会形成一个很重要的区别：

> **Semantic Color 要“准确”；Atmospheric Color 才可以“诗意”。**

这会让 Nebula 的 UI 保持冷静，同时环境仍然有丰富的艺术空间。

我倾向 **D**。

<sub>原文台账 G10（消息 459）</sub>

#### G11 · Neutral 本身要不要有“温度”？

**D · Stable Neutral Core + Optical Temperature**

> **Global Neutral 本身保持稳定，但允许非常微弱的 Optical Temperature 调制。**

也就是说：

```text
Global Neutral Core
        ↓
Stable semantic baseline
        ↓
very subtle environmental temperature influence
        ↓
final perceptual neutral
```

例如：

冷色 Artwork / 夜间环境：

> Surface 可以产生非常轻微的冷感。

暖色 Artwork：

> Surface 可以有非常轻微的暖感。

但这个变化必须小到：

> **用户不会觉得“UI 颜色变了”，只会觉得“整个空间的空气不太一样”。**

而且必须遵守：

> **Semantic colors remain stable.**

Error 还是 Error，Success 还是 Success，Text hierarchy 还是原来的 hierarchy。

所以我更希望 Nebula 的 Neutral 是：

> **稳定的骨架 + 可以被环境轻轻触碰的感知温度。**

这会让我们刚刚确定的 **Atmospheric Color** 真正渗透到 Global UI，但不会把 Global Color System 变成动态主题系统。

<sub>原文台账 G11（消息 462）</sub>

#### G12 · Contrast 到底由谁负责？

**D · Stable Semantic Contrast + Contextual Optical Compensation**

> **语义层级拥有稳定的 Contrast Floor；环境变化只允许做有限的 Optical Compensation。**

也就是说：

**Primary Text** 有硬性最低可读性底线。  
**Secondary Text** 可以更安静，但不能因为 Atmosphere 一变化就突然看不清。  
**Disabled** 可以降低表达，但也必须有明确下限。  
**Icon / Control** 同样有自己的最低辨识标准。

然后如果 Atmosphere 让背景变复杂：

不是直接：

> “把文字变亮 30%。”

而是优先通过：

**局部 Surface separation**  
**Material adjustment**  
**微弱 background quieting**  
**edge / luminance separation**

来解决。

实在需要时才对文字 / Icon 做小幅 optical compensation。

这样就不会出现一种非常糟糕的现象：

> Artwork 一换，文字颜色跟着疯狂变亮变暗。

---

而且这一题我觉得最好直接成为我们之后的一个检查标准：

> **Nebula 可以让环境变化，但不能让用户重新学习怎么读 UI。**

**G12 你定。**

<sub>原文台账 G12（消息 465）</sub>

#### G13 · Border 应该在 Global UI 里扮演什么角色？

**D · Contextual Edge System**

> **Border 不再被视为一个装饰属性，而是 Global Material System 的“边缘表达通道”。**

默认层级：

**Spatial Separation**  
→ **Surface Difference**  
→ **Optical Edge / Light**  
→ **Minimal Border**

只有当：

- 材质本身不足以表达边界
- Input / Focus 需要额外辨识
- Accessibility 需要更明确提示
- 特定结构确实需要封闭边界

才允许 Border 提升存在感。

而且 Border 本身不能随便选一个颜色。

它应该属于：

> **Global Edge Language**

也就是说：

**亮度 / 透明度 / thickness / interaction response / radius relationship**

都服从同一套规则。

这会直接解决旧 UI 那种：

的专项 Material / Spatial rules，不被 Global Shadow token 强行覆盖。

<sub>原文台账 G13（消息 468）</sub>

#### G14 · Shadow / Elevation 在 Nebula 里应该是什么？

**D · Contextual Elevation System**

> **Elevation 是“这个东西在空间里离 Environment 多远”的感知结果，而 Shadow 只是它的一种视觉证据。**

因此一个 Surface 是否需要 Shadow，以及 Shadow 多强，由：

**Surface Layer**  
**Spatial Relationship**  
**Material**  
**Global Light Direction**  
**Context**  
**Interaction State**

共同决定。

例如：

**Base Surface**
→ 通常没有明显 Shadow。

**Elevated Card**
→ 很轻的 spatial separation，可由 subtle shadow + edge 完成。

**Floating Menu**
→ 更明确的 elevation。

**Dialog**
→ 明确与底层空间脱离。

**Player / Listening Space**
→ 采用各自已经冻结的专项 Material / Spatial rules，不被 Global Shadow token 强行覆盖。

然后同样有一个重要边界：

> **Elevation ≠ Shadow strength。**

一个东西可以通过 Material / Light / Blur / Edge 显得浮起来，而不需要一坨深黑阴影。

最终想达到的是：

> **你感觉它“浮着”，但看不到一个巨大的 Photoshop Drop Shadow。**

而这又和 G4 的层级分离直接接上：

**Spatial Separation → Material Difference → Optical Edge / Light → Shadow → Border**

也就是说，Shadow 不是第一选择，而是整个空间层级语言中的一个通道。

**G14 你定。**

<sub>原文台账 G14（消息 471）</sub>

#### G15 · Blur 在 Global UI 里到底是什么？

**D · Contextual Optical Blur**

> **Blur 不是“玻璃感滤镜”，而是一种 Optical Separation / Environmental Integration 工具。**

它是否存在、存在多少，取决于：

**Surface Role**  
**Depth / Elevation**  
**Background Complexity**  
**Content Density**  
**Environment**  
**Performance Budget**

并且：

> **Blur 不能独立决定一个 Surface 是不是 Glass。**

比如一个普通 Settings Panel 即使有一点背景模糊，也不意味着它必须变成 Liquid Glass。

同样，一个没有明显 Blur 的 Base Surface，也完全可以属于 Nebula Material System。

最终我们会希望：

**Blur 服务于空间。**

而不是：

**空间服务于 Blur。**

尤其考虑到你现在项目里的旧 UI 很可能有大量 `backdrop-filter: blur(...)`，这一条以后会是清理旧样式时非常好用的审查标准。

我倾向 **D**。

<sub>原文台账 G15（消息 474）</sub>

#### G16 · Transparency 应该是什么角色？

**D · Contextual Optical Transparency**

> **Transparency 是“Surface 与 Environment 之间的关系”控制，而不是单纯的 alpha 数值。**

也就是说系统先判断：

> 这个 Surface 此刻需要多强的“自我存在感”？

再决定透明程度。

例如：

**Dense Settings UI**  
→ 更稳定、更实体。

**Floating Menu**  
→ 可以更透明，让环境参与。

**Artwork-heavy 页面**  
→ 可以适度退让，让 Artwork 进入 Surface。

**高密度内容区域**  
→ 必要时提高 Surface solidity，保护可读性。

而且 Transparency 必须同时考虑：

**Blur**  
**Contrast**  
**Edge**  
**Elevation**  
**Background Complexity**

不能出现：

> “透明度降了，所以看起来就高级。”

最终希望的是：

> **Surface 不是透明或不透明两种状态，而是在 Environment 与 UI 之间决定自己要站多近。**

这其实也进一步强化了 G2：

> **Glass 是 Environment ↔ UI 的接口。**

只是这里的“玻璃感”终于不再依赖几个 CSS 参数，而变成完整的 Optical Relationship。

**G16，你定。**

<sub>原文台账 G16（消息 477）</sub>

#### G17 · Global UI 要不要建立明确的 Surface Roles？

**D · Layer + Semantic Role**

这应该成为 Global Material System 的结构：

> **Layer 决定“空间高度”，Role 决定“为什么存在”。**

例如：

```text
Surface
│
├─ Layer
│   ├─ Ground
│   ├─ Base
│   ├─ Elevated
│   └─ Overlay
│
└─ Semantic Role
    ├─ Content
    ├─ Interactive
    ├─ Floating
    ├─ Navigation
    ├─ Utility
    └─ Feedback
```

于是一个 Dropdown 可以是：

> **Overlay + Utility**

一个 Card 可以是：

> **Base / Elevated + Content**

一个 Button 可以是：

> **Base + Interactive**

一个 Dialog 可以是：

> **Overlay + Feedback / Decision**

这样 Agent 新建组件时就不是：

> “我感觉这个应该做成玻璃。”

而是先回答：

> **“它是什么 Role？”**
> **“它处在哪个 Layer？”**

然后 Material、Transparency、Blur、Edge、Elevation 才由这两个条件继续推导。

这会是一个很重要的治理层。

**G17 你定。**

<sub>原文台账 G17（消息 480）</sub>

#### G18 · 嵌套 Surface 怎么处理？

**D · Contextual Material Inheritance**

这和我们现在建立的整个体系完全一致：

> **嵌套 Surface 不拥有完全独立的 Material World。**

父级提供：

**Environment / Light / Blur Context / Optical Temperature / Depth Context**

子级根据自己的：

**Semantic Role + Local Importance**

只获得**必要的局部 Material Variation**。

例如：

**Page → Content Surface → Card**

不会是三层各自：

> blur + transparency + shadow。

<sub>原文台账 G18（消息 483）</sub>

#### G19 · Surface 是否应该允许“完全脱离父级世界”？

**D · Contextual Material Boundary**

> **Surface 默认继承父级 Material World；只有跨越明确的 Semantic Boundary，才允许建立新的 Material Context。**

例如：

**普通 Card**
→ 不允许脱离。

**Dropdown**
→ 仍然属于当前 World，只提高 Layer。

**Context Menu**
→ 可以进入独立的 Overlay Context，但仍继承 Global Light / Color / Geometry language。

**Modal**
→ 可以建立更强的 Material Separation，甚至暂时压低底层 Environment，但仍然不是“另一个主题”。

**Listening Space**
→ 这是明确的 Stage Boundary，可以拥有专项 Material Interpretation。

所以即使发生“脱离”：

> **脱离的是局部 Material Context，不是脱离 Nebula。**

我觉得这会是非常重要的一道边界：

> **A boundary may create a new material context, never a new visual universe.**

这样以后我们遇到任何特殊浮层，都可以问：

**它真的跨越了 Semantic Boundary 吗？**

如果没有，就不要给它单独造世界。

<sub>原文台账 G19（消息 486）</sub>

#### G20 · Overlay 出现时，底层 World 应该怎么退让？

**D · Contextual Overlay Veil**

> **Overlay 出现时，系统不是“给页面盖黑布”，而是建立一个临时的 Overlay Veil。**

这个 Veil 的任务不是单纯变暗，而是：

**降低底层视觉竞争**  
**保护 Overlay 可读性**  
**保留 Nebula 的 World Light / Atmosphere continuity**  
**明确建立空间层级**

因此可能组合使用：

**轻微 luminance attenuation**  
**局部 contrast reduction**  
**Optical separation**  
**Blur / depth adjustment**  
**Material elevation**

但具体强度由 Overlay 的语义决定。

例如：

**Tooltip**
→ 几乎不需要 Veil。

**Context Menu**
→ 很轻。

**Command Menu**
→ 中等，让用户快速集中注意力。

**Modal / Decision Dialog**
→ 可以明显压低底层，但仍保留一点世界的存在感。

而且这里有一个很重要的边界：

> **Overlay 可以让世界安静，但不应该让世界消失。**

这会和我们前面一直坚持的 **Contextual Focus / Visual Silence / One World, One Light** 完全一致。

我觉得 G20 是一个非常值得落地的 Global Rule。

<sub>原文台账 G20（消息 489）</sub>


## D · 交互状态

Hover / Press / Selected / Disabled / Loading / Error 是一套语义，不是六种皮肤。

**Agent 硬约束**

- Hover 默认不 scale、不 glow、不推动邻居、不改 layout；它只负责「被注意到」。
- Press 比 Hover 更实；Selected 是持续状态而非瞬时反馈；Disabled 要保留可读性与「为什么不能用」。
- Loading 只用一个主进度表达；Error 先局部、后全局。

#### G21 · Global UI 的 Hover 到底应该是什么？

**D · Contextual Hover Response + C-biased Micro Transformation**

> **Hover 不是一种视觉样式，而是一种“对象被即时注意到”的输入事件。**

系统先感知 Hover：

**Awareness = Immediate**

再根据：

**Component Role**  
**Current Focus**  
**Material Layer**  
**Semantic Importance**  
**Pointer Confidence**  
**Motion Budget**

决定表达。

所以：

**普通 Button**
→ 轻微 Material / Edge response

**Icon Button**
→ Icon stroke / luminance 的细微变化

**Card**
→ 可以出现局部 Material / Elevation shift

**重要当前内容**
→ 可以获得稍高的响应

**装饰对象**
→ 甚至可以完全没有 Hover Response

而且全局默认明显偏向你前面 Typography Motion 的那个方向：

> **B 的安全区。**

也就是说：

**Hover 不应该默认 scale。**  
**Hover 不应该默认 Glow。**  
**Hover 不应该让邻居一起动。**  
**Hover 不应该改变 Layout。**

最重要的是：

> **Hover 的存在是为了确认用户的意图，不是为了表演动画。**

我倾向 **D**。

<sub>原文台账 G21（消息 492）</sub>

#### G22 · Press / Active 的表达应该比 Hover 更“实”吗？

**D · Contextual Press Response**

**C-biased Micro Compression** 作为默认表现。

这样 Hover → Press 的区别也很清楚了：

> **Hover：对象意识到用户接近。**
> **Press：对象确认已经接住用户的操作。**

所以 Press 可以比 Hover 更“实”，但不是更“夸张”。

默认：

**Material / Edge Response**  
→ **轻微 Compression**  
→ **即时确认**  
→ **Natural Settle**

而且 Card、Toggle、Button、Icon Button 不会共享一套“按下缩小”动画，而是由各自 Semantic Role 决定表达通道。

<sub>原文台账 G22（消息 495）</sub>

#### G23 · Selected / Active 应该是什么？

**D · Hierarchical Active State**

这次和之前的 Q82 不重复，而是把它正式**下沉成 Global Shared Interaction Rule**：

> **Active / Selected 是持续的语义状态，不是某一种固定视觉样式。**

所以现在 Global UI 里已经明确区分：

**Hover** → “你正在接近我”  
**Press** → “我接住了你的操作”  
**Selected / Active** → “我现在处于这个状态”

三者的时间性和表达逻辑不再混在一起。

而且这里有一个我很想保留的硬约束：

> **克制不等于不可见。**

Global UI 可以很安静，但 Selected / Active 作为持续语义，必须达到足够的辨识度。

<sub>原文台账 G23（消息 498）</sub>

#### G24 · Disabled State 应该是什么？

**D · Contextual Disabled State**

它应该延续我们现在的整套规则：

> **Disabled 是一种受语义约束的低表达状态，而不是“把东西变灰”。**

系统根据：

**Component Role**  
**Current Context**  
**Material Layer**  
**Accessibility**  
**Semantic Importance**

决定它如何降低表达。

例如：

**Button**
→ 降低 Interactive Response + Contrast

**Icon**
→ 降低 luminance / weight，但不能彻底消失

**Card**
→ 可能只是失去 Hover / Press / Material Response

**Selected but Disabled**
→ 不能因为 Disabled 把 Selected 语义一起抹掉

**Disabled Control in an Active Surface**
→ 可以安静，但仍然必须明确“这里存在一个不能操作的控件”

而且我会给它一个 Global 禁区：

> **Disabled 不允许使用“模糊掉 / 半透明到看不见 / 完全消失”作为默认表达。**

因为 Disabled 的本质是：

> **存在，但暂时没有交互资格。**

它和“隐藏”是完全不同的语义。

这也是 Global System 真正需要解决的东西之一。

<sub>原文台账 G24（消息 501）</sub>

#### G25 · Loading State 应该是什么？

**D · Contextual Loading State**

> **Loading 不是一种动画，而是一种“内容尚未就绪”的空间状态。**

根据：

**Component Role**  
**Expected Wait Duration**  
**Content Type**  
**Current Focus**  
**Stage**  
**User Intent**

决定表达方式。

例如：

**短操作**

→ 小而明确的 progress / activity indication。

**列表加载**

→ 尽可能保持既有结构，用低干扰的 Progressive Reveal 或轻量 Skeleton。

**Artwork 加载**

→ 保留原有空间与环境关系，让内容逐渐进入，而不是突然插入一块白色占位卡。

**整页初始化**

→ 尽量保留 Nebula World / Surface Ground，不应该让整个 App 变成一个空白 Spinner 页面。

**核心交互正在处理**

→ 控件可以进入明确的 temporary disabled / progress state，但仍保持空间稳定。

而且 Loading 的 Motion 必须遵循我们刚才已经确定的原则：

> **不要为了表示“还在加载”而制造持续、明显、周期性的视觉噪音。**

尤其禁止：

**全屏不停转**  
**所有 Skeleton 同步闪烁**  
**Glow 呼吸无限循环**  
**Material 因 Loading 持续活跃**

Loading 的目标是：

> **让等待可理解，而不是让等待变得更显眼。**

这会是 Global UI 很重要的一条。

<sub>原文台账 G25（消息 504）</sub>

#### G26 · Error State 应该是什么？

**D · Contextual Error State**

并且它和我们整个 Global System 的思路完全一致：

> **Error 的表达强度由“后果”而不是由“错误这个词”决定。**

系统根据：

**Severity**  
**Recoverability**  
**User Action Required**  
**Scope**  
**Current Focus**  
**Context**

决定它应该占用多少表达权。

例如：

**字段填写错误**

→ 局部、准确、低干扰。

**网络请求失败**

→ 清晰说明发生了什么，并提供恢复路径。

**Artwork 加载失败**

→ 内容区域知道“这里没成功”，但不破坏整个空间。

**无法执行用户当前核心操作**

→ 可以获得更明确的 Focus / Contrast。

**影响整个 App 的 Critical Failure**

→ 才允许建立更高层级的 Overlay / Veil / Strong Semantic Color。

同时继续遵守：

**Semantic Red ≠ Atmospheric Red**

错误状态可以调用 Global Error Color，但不能因为一个错误就把整个 Environment 染成红色。

Motion 也同样：

> **Error 可以明确，但不需要戏剧化。**

默认禁止：

**持续抖动**  
**无限闪烁**  
**大面积红色呼吸**  
**无意义的 Alert Glow**

最终想要的是：

> **用户一眼知道“出了什么问题、影响多大、我该不该处理”，但不会被 UI 吓到。**

这一题实际上是在决定 **Nebula 的“负向语义”应该有多成熟**。

**G26 你定。**

<sub>原文台账 G26（消息 507）</sub>

#### G27 · Success / Confirmation State 怎么表达？

**D · Contextual Success State**

> **Success 的职责首先是确认“事情已经完成”，其次才是表达积极情绪。**

根据：

**Action Importance**  
**Persistence**  
**User Need for Confirmation**  
**Recoverability**  
**Current Focus**  
**Stage**

决定表达方式。

例如：

**复制成功**

→ 一个极轻的即时确认即可。

**设置保存成功**

→ 状态本身发生变化，未必需要额外 Toast。

**下载完成**

→ 内容状态改变，可以通过列表 / Item 状态表达。

**关键操作完成**

→ 可以留下一个短暂但明确的 Semantic Confirmation。

同时：

> **Success 不需要“庆祝动画”。**

默认不采用：

**爆炸粒子**  
**大面积绿色**  
**持续 Pulse**  
**巨大 Checkmark**

而是：

> **状态完成本身就是反馈。**

这样就与 G25 的：

> **让等待可理解，而不是让等待变得更显眼**

形成对应：

> **让完成可确认，而不是让完成变得更喧闹。**

**G27，你定。**

<sub>原文台账 G27（消息 510）</sub>


## E · 浮层与锚定

浮层不是「弹窗」，而是「临时空间」，必须说明它从哪里来。

**Agent 硬约束**

- Tooltip 是最轻一层，不承载操作；Popover / Menu / Dropdown 必须有 semantic anchoring。
- Dropdown / Select 属于临时空间，不当成普通 Dialog 处理。
- 浮层的视觉归属由触发对象决定，不能只是「刚好出现在附近」。

#### G28 · Tooltip / Hover Hint 应该属于哪一种空间层级？

**D · Contextual Informational Surface**

> **Tooltip 是一种短暂的 Informational Surface，它拥有 Overlay 的空间层级，但不一定拥有 Overlay 的视觉重量。**

根据：

**Information Importance**  
**Content Length**  
**Current Context**  
**Pointer / Keyboard Context**  
**Background Complexity**

决定最终表现。

例如：

普通 Icon tooltip：

→ 小、轻、快速出现。

复杂解释：

→ 可以变成更明确的 Popover，而不是硬塞进 Tooltip。

Keyboard navigation：

→ 也必须能够获得同样的信息。

而且它不应该：

**改变当前 Focus**  
**启动大范围 Atmosphere**  
**造成明显的页面 Recomposition**

最多只是：

**局部 Material Separation + Soft Arrival**

还有一个很重要的边界：

> **Tooltip 是解释界面，不是界面本身。**

所以它应该尽可能安静地出现、准确地说明，然后安静地消失。

**G28 我倾向 D。**

<sub>原文台账 G28（消息 513）</sub>

#### G29 · Popover / Context Menu 的关系怎么定？

**D · Contextual Floating Surface System**

> **Floating Surface 是 Global Foundation；Tooltip / Popover / Context Menu 是不同的 Semantic Roles。**

它们共享：

**Material World**  
**Elevation Logic**  
**Geometry Language**  
**Edge Language**  
**Temporal Grammar**

但拥有不同的：

**Information density**  
**Interaction authority**  
**Spatial relationship**  
**Dismissal behavior**  
**Focus behavior**

例如：

**Tooltip**
→ Informational  
→ 最轻  
→ 不夺取操作权

**Popover**
→ Contextual Information / Light Interaction  
→ 可以承载更多内容  
→ 可以短暂建立自己的 Interaction Focus

**Context Menu**
→ Action Surface  
→ 明确的 Input Focus  
→ 操作优先级高  
→ 必要时压低背景竞争

于是我们不会得到三个完全不同的“小玻璃盒子”，而是：

> **同一个 Nebula Floating World 下，三个不同语义角色。**

这也正好继承 G17：

> **Layer 决定它处在哪；Role 决定它为什么存在。**

**G29 你定。**

<sub>原文台账 G29（消息 516）</sub>

#### G30 · Floating Surface 与它的触发对象，应该保持多强的空间关系？

**D · Semantic Anchoring**

> **Floating Surface 默认具有语义锚点，而不是绝对几何锚点。**

系统优先保持：

**Trigger ↔ Surface 的语义关系**

然后再根据：

**Available Space**  
**Window Edge**  
**Spatial Gravity**  
**Current Focus**  
**Content Size**  
**Stage**

选择具体几何位置。

所以：

Tooltip  
→ 尽量贴近对应对象。

Popover  
→ 可以根据空间向侧边展开。

Context Menu  
→ 可以在光标附近出现，但必要时可以调整位置。

而当空间不足时，不是死守：

> “必须在按钮右边 8px。”

而是：

> **只要用户仍然一眼能理解“这个浮层属于谁”，几何位置就可以让步。**

同时必须避免：

**Floating Surface 无缘无故漂到很远**  
**没有视觉 / 语义关联的突然出现**  
**为了避免边缘而破坏与 Trigger 的认知关系**

所以可以把它总结成：

> **Anchor the meaning first, the geometry second.**

这会和我们已经确定的 **Semantic Spatial Radius / Spatial Gravity / Composition Field** 很自然地接起来。

**G30 你定。**

<sub>原文台账 G30（消息 519）</sub>

#### G31 · Dropdown / Select 应该是什么身份？

**D · Contextual Selection Surface**

> **Dropdown 是一个“Selection Surface”，它由一个 Input / Control 唤起，但在打开后拥有独立的 Overlay + Interaction Context。**

因此它同时继承：

**Trigger 的 Semantic Relationship**  
**Overlay Layer**  
**Floating Material**  
**Input / Selection semantics**

但打开以后：

- 可以建立独立的 **Input Focus**
- 可以拥有自己的 **Keyboard Navigation**
- 可以拥有明确的 **Selected / Active** 状态
- 可以根据空间重新定位
- 不应该改变整个 Stage 的 Visual Focus
- 关闭后，Selection State 回写到 Trigger

这样我们不会把 Dropdown 简单做成：

> “一个小弹窗。”

而是：

> **一个短暂建立起来的选择空间。**

这也让它和 G29 / G30 连得很好：

**为什么它出现？** → Selection Role  
**从哪里出现？** → Semantic Anchor  
**处在哪一层？** → Overlay  
**怎么长？** → Global Material System  
**怎么操作？** → Selection Interaction Context

我倾向 **D**。

<sub>原文台账 G31（消息 522）</sub>


## F · 控件

Button / Control / Icon / Input / Binary Control 是 Agent 最常新建、也最容易长歪的东西。

**Agent 硬约束**

- Global Button 的实体感是「可点」而不是「立体」；同组控件内部节奏一致。
- Control 的高度与宽度分开治理；Icon 有统一几何与视觉重量，Filled↔Outline 只在语义改变时切换。
- Input 默认是 Surface，不是描边盒子；Checkbox / Radio / Toggle 共享一套视觉逻辑。

#### G32 · Global Button 应该有多少“实体感”？

**D · Contextual Action Surface**

> **Button 的“实体感”不是 Button 类型决定的，而是由它承担的 Action Role 决定。**

所以 Global Button 不应该简单定义成：

> “所有 Button 都长这样。”

而是首先判断：

**Primary Action**  
**Secondary Action**  
**Tertiary / Quiet Action**  
**Destructive Action**  
**Icon-only Action**

然后再决定：

**Surface presence**  
**Material strength**  
**Edge**  
**Contrast**  
**Hover response**  
**Press compression**

例如：

**Primary Action**
→ 足够明确的 Surface / Contrast

**Secondary**
→ 可以明显轻一些

**Tertiary**
→ 可以接近无 Surface

**Icon Action**
→ 尽量减少容器感，让 Icon 本身成为交互对象

同时：

> **Button 的层级不能主要靠“越重要越亮”。**

还可以通过：

**尺寸 / 留白 / Typography / Position / Grouping**

来表达重要性。

这样就不会重新走回传统 Design System 那套：

> Primary = 蓝色实心
> Secondary = 白色描边
> Tertiary = 纯文字

Nebula 的 Button 应该属于同一个 Material World，只是拥有不同的**Action Presence**。

**G32，我倾向 D。**

<sub>原文台账 G32（消息 525）</sub>

#### G33 · Global Controls 的尺寸体系应该怎么定？

**D · Semantic Control Geometry**

它和 G5/G7/G8 完全一致：

> **Control 尺寸首先是一个 Semantic Geometry 问题。**

Global Foundation 定义少量稳定的 **Control Size Families**，再由：

**Semantic Role**  
**Density**  
**Content Type**  
**Available Space**  
**Interaction Method**

决定最终尺寸。

比如：

**Standard Action**  
→ 一个稳定的标准 Control Family

**Compact Utility**  
→ 更紧凑

**Primary Action**  
→ 可以获得更充分的空间与触控 / 点击余量

**Icon-only Control**  
→ 尽管视觉上很小，也必须拥有稳定的 Interaction Hit Area

而且这里有一个非常重要的边界：

> **视觉尺寸 ≠ Interaction Hit Area。**

一个视觉上只有很小 Icon 的按钮，也可以拥有足够大的实际可交互区域，而不需要把视觉容器做成一个巨大的圆形 / 胶囊。

这样既能保持 Nebula 的精致感，也不会牺牲可操作性。

<sub>原文台账 G33（消息 528）</sub>

#### G34 · Control 的“高度”和“宽度”要不要分开治理？

**D · Semantic Control Geometry — Independent Axes**

这和 G33 是直接连续的：

> **Height 与 Width 都属于 Semantic Geometry，但它们不是同一种约束。**

**Height** 更接近：

> **Interaction Rhythm**

决定：

**点击节奏 / 控件密度 / 视觉基线 / Hit Area**

所以高度由：

**Role + Density + Interaction Method**

严格治理。

而 **Width** 更接近：

> **Content Accommodation**

由：

**Semantic Role + Content Length + Available Space + Layout Context**

共同决定。

例如：

**Icon Button**
→ Width ≈ Height，但实际 Hit Area 独立处理。

**Text Button**
→ Height 稳定，Width 由 label + horizontal padding 决定。

**Input**
→ Height 有标准族，Width 可以由 Layout / Content Requirement 决定。

**Select**
→ 高度稳定，宽度根据当前内容和可用空间计算。

**Primary Action**
→ 可以拥有更大的最小宽度，但不是所有 Primary Button 都必须做成固定长条。

这意味着我们不会得到：

> “Nebula Button 全部 120 × 40。”

而是：

> **共同的 Interaction Rhythm + 自然的 Content Geometry。**

同时仍然有一个 Global Ceiling：

> **任何 Control 都不能为了容纳内容无限扩张到破坏 Composition。**

空间不足时，就回到我们已经定义好的：

**Compression → Migration → Hide（少量低优先级内容）→ Minimum Constraint**

<sub>原文台账 G34（消息 531）</sub>

#### G35 · Control Group 应该如何建立内部节奏？

**D · Semantic Control Group**

> **Control Group 本身是一个有语义的空间对象，而不是几个控件简单排列。**

Group 首先判断：

**它们是在一起完成一个 Action？**  
**是在表达一个 Setting？**  
**是在进行一组筛选？**  
**还是属于同一个 Input？**

然后由：

**Semantic Relationship**  
**Density**  
**Alignment**  
**Control Geometry**  
**Action Priority**

共同决定内部结构。

例如：

**Form Field**

`Label → Input → Helper / Error`

是一个完整的 Semantic Group。

因此 Label 与 Input 不应该只是“各自 margin-bottom 16px”。

---

**Action Group**

`Cancel / Save`

应该有明确的：

**Primary / Secondary hierarchy**  
**shared baseline**  
**controlled spacing**

而不是两个独立 Button。

---

**Toolbar Group**

`Search / Filter / Sort`

应该共享：

**Control Height**  
**Alignment**  
**Curvature Language**

并通过 Group Spacing 表现它们是同一工具组。

同时：

> **Group 内部的对象可以共享 Geometry，但不需要完全同形。**

这又会回到 G5：

> **相关对象共享 Curvature Language，而不是所有对象拥有同一个 Radius。**

最终：

> **Component defines itself; Group defines their relationship.**

<sub>原文台账 G35（消息 534）</sub>

#### G36 · Iconography 应该采用什么统一语言？

**D · Semantic Iconography System**

> **Icon 首先是 Semantic Symbol，其视觉形式由它承担的语义角色决定，而不是所有 Icon 强行一个画法。**

Global Foundation 先建立统一的：

**Stroke / Fill vocabulary**  
**Stroke character**  
**Cap / Join**  
**Optical weight**  
**Grid / bounding-box logic**  
**Corner character**

然后根据 Role 选择表现：

**Navigation / General Action**  
→ 倾向轻量 Stroke

**Selected / Active**  
→ 可以增加 optical weight，必要时转向更强的 fill treatment

**Status / State**  
→ 根据语义允许更明确的 silhouette

**Brand / Special Symbol**  
→ 可以拥有自己的形态，但必须遵守整体 optical weight

而且和 G21 完全一致：

> **Icon 的 Hover 可以改变表达，但不应该改变它的身份。**

例如：

普通：

`♡`

Hover：

> stroke 稍微加重 / luminance 提高 / 极轻 material response

而不是：

`♡ → 💗 → 发光 → 爆炸`

<sub>原文台账 G36（消息 537）</sub>

#### G37 · Icon 的尺寸，应该怎么治理？

**D · Semantic Icon Geometry**

> **Icon 有稳定的 Geometry Families，同时真正控制的是“感知尺寸”而不是 SVG 的数学尺寸。**

也就是说：

```text
Semantic Role
      ↓
Icon Size Family
      ↓
View Box / Stroke Geometry
      ↓
Optical Weight Correction
      ↓
Final Perceptual Size
```

例如：

一个 20px 的 Search Icon 和一个 20px 的 Heart Icon，不能因为都写了 `20px`，就认为它们已经统一。

系统还需要考虑：

**Stroke density**  
**Visual mass**  
**Negative space**  
**Silhouette**  
**Cap / terminal geometry**

所以可能：

- Search 看起来就是 20px
- Heart 几何尺寸也是 20px，但需要略小一点的视觉占比
- 某些很密集的 Filled Icon 可能需要进一步收缩

但这不是让每个组件随便修，而是：

> **Icon Library / Icon Role 自己拥有 Optical Normalization。**

这样 Agent 使用 Icon 时只需要：

> “我要一个 Standard Action Icon。”

而不是：

> “我感觉这个 SVG 太小，我给它加 2px。”

这会进一步把 Icon 和 G6 的 **Semantic Iconography System** 闭起来。

而且我特别希望保持：

> **Icon Size 应该和 Typography / Control Geometry 成为一个共同的视觉尺度体系。**

这样 16px 字配出来的 Icon，不会莫名其妙显得像 24px 的视觉重量。

**G37，我倾向 D。**

<sub>原文台账 G37（消息 540）</sub>

#### G38 · Icon 与 Icon 的“视觉重量”应该怎么统一？

**D · Semantic Optical Weight**

> **Icon 的视觉重量由“形状本身 × Stroke / Fill × Semantic Role × 邻近元素”共同决定。**

也就是说，Global System 不追求：

> “所有 Icon 看起来一样粗。”

而追求：

> **“所有 Icon 在自己所在语境中拥有合理且一致的视觉重量。”**

因此一个 Navigation Icon 即使和一个 Action Icon 使用同样的 stroke token，也可能通过 Optical Correction 保持前者更安静。

同时会考虑：

**相邻 Typography Weight**  
**Control Size**  
**Surface Layer**  
**Icon Density**  
**Interaction State**

比如：

普通 metadata 旁边的 icon  
→ 不应该比 metadata 本身更抢眼。

Primary Action 的 icon  
→ 可以稍微提升 weight。

Selected Navigation  
→ 可以通过 optical weight 提升辨识度，但不需要突然从 outline 变成巨大的 filled icon。

这最终形成的不是：

> 一套“粗 / 中 / 细”图标。

而是：

> **一套感知重量相互平衡的 Icon Ecology。**

这会继续保持 Nebula 的一个核心特征：

**Icon 是安静的，但不是虚弱的。**

<sub>原文台账 G38（消息 543）</sub>

#### G39 · Icon 是否允许 Filled ↔ Outline 状态切换？

**D · Contextual Icon State Transformation**

> **Outline ↔ Filled 本身也是一种语义表达通道，但它必须经过 Context 批准。**

例如：

**Favorite / Saved**
→ 可以用 Fill 表示“持久状态已成立”。

**Current Selection**
→ 可以允许更强的 Filled / silhouette treatment。

**Transient Hover**
→ 通常不应突然 Fill。

**Press**
→ 不应该仅仅因为按了一下就换成 Filled。

**Navigation Active**
→ 可以通过 Optical Weight、Fill 或其他方式表达，但整个 Navigation System 应保持一致。

并且：

> **Shape continuity 优先于 Fill transformation。**

也就是说，Outline 和 Filled 应该仍然明显属于**同一个 Icon family**，不能出现一种状态像换了另一个完全不同的图标。

这尤其适合 Nebula：

> **状态可以改变 Icon 的“重量”，但不应该改变 Icon 的“身份”。**

这样 G36–G39 就形成了一套非常完整的 Icon State Grammar。

<sub>原文台账 G39（消息 546）</sub>

#### G40 · Icon State Transformation 应该怎么“动”？

**D · Contextual Icon Transition**

> **Icon State Transformation 的过渡方式，由状态语义与视觉连续性决定，而不是统一规定所有 Icon 都 Morph。**

例如：

**Favorite / Saved**
→ 可以使用极短、克制的 shape transition / fill transition。

**Play ↔ Pause**
→ 可以有明确但非常短的形态过渡，因为两个状态本身具有强连续关系。

**Navigation Active**
→ 更倾向 material / weight / fill state 的平滑变化。

**普通 Selected**
→ 可能根本不需要独立 Icon Animation。

**快速连续操作**
→ 直接向最新状态重新目标化，不产生动画队列。

并且严格继承前面：

**Immediate Awareness**  
**Contextual Arrival**  
**Event Coalescing**  
**Motion Ceiling**

也就是说：

> **图标状态改变可以有连续性，但不能为了“好看”强行制造 Motion。**

我甚至会加一条：

> **Morph requires semantic continuity.**

两个状态如果不是同一个符号的自然演化，就不要为了炫技把它们 Morph 在一起。

比如：

**Heart Outline → Heart Filled**

有资格。

但：

**Search → Filter**

就不应该硬做 Morph，只为了证明设计师会做 SVG 动画。

**G40 你定。**

<sub>原文台账 G40（消息 549）</sub>

#### G41 · Input / Text Field 的默认身份是什么？

**D · Contextual Input Surface**

> **Input 是一个有“输入语义”的 Interactive Surface，但它的视觉实体感由 Context 决定。**

也就是说：

**静止、未聚焦**
→ 可以很安静，Surface / Edge 都弱。

**Hover**
→ 只获得轻微 Material / Edge response。

**Focus**
→ 明确提高可识别性，但不需要突然出现传统蓝色粗框。

**Typing**
→ Focus State 持续稳定，不因为每个字符变化而重新播放视觉效果。

**Error**
→ 局部 Semantic Error 表达。

**Disabled**
→ Contextual Disabled。

**Search Input**
→ 在 Search Context 中可以获得更高 Surface Presence。

而且和 G13 一样：

> **Border 是 Edge channel，不是 Input 的默认装饰。**

所以 Nebula Input 最终可能是：

**稳定的 Surface Ground**  
+ **非常轻的 Material differentiation**  
+ **Focus 时更明确的 Edge / Contrast**  
+ **清晰的 caret**

而不是：

> 灰色矩形 + 1px border + 蓝色 focus outline。

<sub>原文台账 G41（消息 552）</sub>

#### G42 · Tabs / Segmented Navigation 应该如何表达？

**D · Contextual Navigation State**

> **Tabs / Segmented Navigation 首先是一个“导航关系”，而不是一组 Button。**

因此它的表现由：

**Navigation Role**  
**Current Selection**  
**Density**  
**Available Space**  
**Context**

决定。

例如：

**普通页面 Tabs**
→ 倾向安静的 Typography + Optical Indicator。

**强分组 / Segmented Choice**
→ 可以让 Active 获得轻微 Material Presence。

**Active Transition**
→ 可以有非常克制的 spatial / material transition，但不要求每次都播放“滑块动画”。

**当前选项**
→ 必须持续清晰可见。

**Hover**
→ 只影响当前 Tab，不应该提前“抢走” Active 状态。

同时我会特别保留一个边界：

> **Tab 不是一排互相竞争的 Button。**

它们共同组成一个**Selection Field**。

所以 Active 的表达更应该体现：

> **“我目前处在这里。”**

而不是：

> **“我是这一排里最亮的那个按钮。”**

这会让 Navigation 的气质更符合 Nebula，也能继续复用 G23 的 **Hierarchical Active State**。

**G42，你定。**

<sub>原文台账 G42（消息 555）</sub>

#### G43 · Checkbox / Radio / Toggle 这类 Binary Control 要不要共享一套视觉逻辑？

**D · Contextual Binary Control System**

> **Binary Controls 共享的是 State Grammar，而不是外形。**

统一的是：

**Geometry family**  
**Focus behavior**  
**Checked / Unchecked transition**  
**Disabled behavior**  
**Semantic Color**  
**Motion ceiling**  
**Accessibility**

而具体形态由语义决定：

**Checkbox**
→ “这个项目被选中了”

**Radio**
→ “这个选项成为当前唯一选择”

**Toggle**
→ “这个功能当前开启 / 关闭”

所以：

Checked Checkbox ≠ On Toggle ≠ Selected Radio

它们虽然都可以调用：

**Accent / Fill / Weight / Edge / Micro Transition**

但最终表现不同。

尤其 Toggle：

> 不应该只是一个“长条 Checkbox”。

Radio：

> 不应该只是一个“圆形 Checkbox”。

同时状态变化遵循我们刚才 G39–G40 的规则：

> **状态改变可以有 Transition，但只在具有语义连续性的地方使用。**

例如：

`○ → ●`

天然可以非常轻地发生变化。

`OFF → ON`

可以有有限的 Thumb / Material movement。

但这些都不需要发光、弹跳、粒子庆祝。

核心原则：

> **Share the grammar, not the costume.**

这应该能很好地把 Binary Controls 纳入 Global System，而又不制造一堆视觉同质化组件。

**G43，你定。**

<sub>原文台账 G43（消息 558）</sub>


## G · 内容容器

Card 与 List Row 是内容归属单位，不是装饰。

**Agent 硬约束**

- Card 表达「这些内容属于一起」；List Row 密度更高但同源。
- Hover / Selected 作用于整行语义，不做局部闪烁。

#### G44 · Card 到底应该是什么？

**D · Contextual Content Surface**

> **Card 不是一种固定组件皮肤，而是一种“Content Surface Role”。**

它只有在内容确实需要：

**空间边界**  
**视觉聚合**  
**层级隔离**  
**内容锚定**  
**或独立交互对象身份**

时才成立。

因此一个 Card 可以是：

**Passive Content Surface**  
→ 只是承载一组相关内容。

**Selectable Content Surface**  
→ 可以被选中。

**Interactive Content Surface**  
→ 本身就是一个导航 / 操作对象。

**Editorial Content Surface**  
→ 特殊 Stage 下承担构图职责。

但必须明确：

> **Card ≠ Clickable by default.**

一个只是承载文字的 Card，不能因为“Card 看起来像可以点”就自动获得 Hover / Press / Elevation。

反过来，一个真正可以点击的 Card，也必须通过：

**Interaction Response + Affordance + State**

让用户知道它可以操作。

而且这又和 G18 直接连接：

> Card 不应该自己创造一层独立玻璃世界。

它只是：

**Content Role + Surface Layer**

最终 Material 从 Global System 推导。

这样可以从根上避免：

> `Card → Glass → Shadow → Border → Hover Scale → Glow`

这种“万能卡片套餐”。

我倾向 **D**。

**G44，你定。**

<sub>原文台账 G44（消息 561）</sub>

#### G45 · List Item 应该和 Card 是什么关系？

**D · Semantic List Row System**

> **List Row 和 Card 是两种不同的 Semantic Content Structure。**

List Row 首先表达：

> **“这些对象属于同一个连续集合。”**

所以默认：

**共享基线**  
**共享列结构**  
**共享高度 / Density**  
**共享左右边界**  
**共享 Curvature Language**

但**不逐项制造独立 Surface**。

单个 Row 只有在需要时才可以临时获得：

**Hover Response**  
**Selected State**  
**Interactive Surface**  
**Contextual Elevation**

而且这个变化应尽量保持在**列表内部语境**中。

<sub>原文台账 G45（消息 564）</sub>

#### G46 · List Row 的 Hover / Selected 应该影响整行还是局部区域？

**D · Semantic Row Interaction**

> **List Row 是否作为整体响应，首先由它的 Semantic Role 决定。**

例如：

**纯信息 Row**
→ Pointer 经过某个字段，不必让整行都动。

**可点击 Row**
→ Row 可以作为一个完整 Interactive Surface，Hover / Press 可以在整行范围内体现。

**包含独立 Action 的 Row**
→ 主体区域与右侧操作区可以拥有不同 Interaction Ownership。

例如：

了。

<sub>原文台账 G46（消息 567）</sub>


## H · 导航

导航回答「我在哪」，页面标题回答「我在看什么」，两者不可互相替代。

**Agent 硬约束**

- Active indicator 的强度受层级约束，不靠常亮强调。
- 导航的存在感可以随上下文变化，但语义位置必须稳定。

#### G47 · Navigation 应该是什么？

**D · Semantic Navigation Field**

> **Navigation 不是一块 Sidebar，也不是一堆 Button，而是一个长期存在的 Navigation Field。**

它同时具有：

**Spatial Skeleton Role**  
→ 稳定定义“我在哪里”

**Semantic Selection Role**  
→ 告诉用户“我当前在哪里”

**Interaction Field**  
→ 承担 Navigation 操作

因此：

这一条我很满意，因为它把 Navigation 从“一个 Sidebar 组件”提升成了 **Nebula 的空间坐标系**。

<sub>原文台账 G47（消息 570）</sub>

#### G48 · Navigation 的 Active Indicator 到底应该有多强？

**D · Hierarchical Navigation Expression**

> **Active Navigation 没有固定 Indicator 形式，而是在一个统一的 Hierarchical State 里，根据 Context 选择最合适的表达 Channel。**

可能是：

**Typography Weight**  
**Icon Weight**  
**Accent**  
**Subtle Surface**  
**Edge / Light**  
**Indicator**

但有一个非常明确的优先级：

> **至少一个通道必须足够清晰，让用户无需猜测当前页面。**

同时：

**Hover 不可以抢走 Active 的语义。**

**Animation 不可以成为 Active 的唯一证据。**

**Accent 可以有，但面积必须克制。**

<sub>原文台账 G48（消息 572）</sub>

#### G49 · Navigation 的“存在感”应该是恒定的吗？

**D · Contextual Navigation Presence**

但和 C 有一个重要区别：

> **Navigation 的“语义存在”始终保持，视觉存在可以变化。**

也就是说，Navigation 作为 Spatial Skeleton 永远存在于系统结构中；但它不一定永远以完整、明确的 Sidebar 形式占据画面。

例如：

**普通 Library**

→ Navigation 保持稳定但安静的 Presence。

**Listening Space**

→ Navigation 可以显著退让，给核心空间更多空气，但不能让用户失去方向感。

**窗口变窄**

→ 可以进入 Compact Navigation。

**极窄但仍处于合法窗口范围**

→ 可以进一步折叠到更紧凑的形式。

**特殊沉浸 Stage**

→ 可以暂时降低视觉存在感，甚至转入更轻的 contextual access。

但是有一个硬约束：

> **Navigation 可以退让，但不能制造“我是不是离开了这个 App”的迷失感。**

而且这和 Q130 的：

> **Stable Skeleton + Contextual Elastic Regions**

直接对应。

Navigation 是 Skeleton 的一部分，所以它拥有比普通 UI 更高的稳定性；它可以**变形、压缩、安静化**，但不能随便消失。

我觉得这会比简单规定“Sidebar 永远存在”更适合 Nebula。

**G49，我倾向 D。**

<sub>原文台账 G49（消息 575）</sub>


## I · 排版

Typography 是 Global UI 的骨相：角色稳定、层级离散、节奏可控。

**Agent 硬约束**

- 页面标题可以参与构图，但不能让用户失去「这是哪个页面」的判断。
- Type Scale 离散、Weight 分级、行高有节奏；字距只在需要时做光学微调。
- Typography Role 有词典，允许受控 variant，不允许跨组件乱用。

#### G50 · 页面标题（Page Title）应该是什么角色？

**D · Semantic Page Heading**

> **Page Title 是页面的语义入口，同时是一级 Content Anchor；它拥有稳定的 Global Typography Role，但具体空间位置属于当前 Stage 的 Composition。**

也就是说：

**Typography Role 稳定**

→ `Page Heading`

但：

**几何位置不一定固定**

例如：

**Settings**

可以非常稳定、靠近页面结构顶部。

**Library**

标题可以和主要 Content Field 建立更紧密的关系。

**Search**

搜索本身可能就是页面的主要 Anchor，因此标题可以退居 secondary position。

**Editorial / Content-heavy Stage**

标题甚至可以获得更大的 Composition 权重。

但有一个非常重要的边界：

> **Page Title 可以参与构图，但不能因为构图而让用户失去“这是哪个页面”的判断。**

所以它与 Navigation Active State 是两个不同的语义：

**Navigation** → 我在哪里  
**Page Title** → 我正在看什么

二者可以协同，但不能互相替代。

我倾向 **D**。

**G50，你定。**

<sub>原文台账 G50（消息 578）</sub>

#### G51 · Global Typography 的默认字体气质

**D · Semantic Typography Personality**

这里不直接选某一个具体字体家族。

Global System 先定义：

> **Nebula 的 Typography Personality**

而不是：

> “全项目必须使用 Font X。”

核心气质：

**Neutral foundation**  
+ **Subtle editorial character**  
+ **High legibility**  
+ **Quiet sophistication**

然后再通过 Typeface Roles 分配：

**UI System**  
→ 稳定、中性、精确

**Content Display**  
→ 可以带一点 Editorial Character

**Reading**  
→ 以阅读舒适为最高优先级

**Special Editorial**  
→ 特殊 Stage 才允许更明显的字体人格

这样最终我们甚至可以在实际选字体时拥有一定自由：

> 只要它符合 Nebula 的 Typography Personality，就可以进入候选。

而不是现在就把 Design System 锁死在某一个具体字体。

我尤其不希望 Nebula 出现：

> **“用了某个很贵的字体，所以看起来高级。”**

真正的身份应该来自：

**角色、层级、比例、Spacing、排版秩序**

而不是字体品牌本身。

我倾向 **D**。

<sub>原文台账 G51（消息 584）</sub>

#### G52 · Global Type Scale 应该怎么建立？

**D · Hierarchical Type Scale**

> **Global Type Scale 是稳定的离散骨架；最终字号属于 Semantic Role，并允许在有限范围内由 Density / Spatial Context 做受控调整。**

也就是：

```text
Typography Personality
        ↓
Type Scale
        ↓
Semantic Role
        ↓
Density / Context
        ↓
Small Optical Adjustment
        ↓
Final Type Size
```

例如：

**Page Heading**

有自己的基础范围。

**Section Heading**

属于另一个稳定层级。

**Body**

保持非常稳定。

**Metadata**

可以根据 Density 稍微收紧。

但不会出现：

> 窗口缩小 → 所有文字一起按 0.87 缩放。

这和我们之前的 **Semantic Type Field** 是一致的：

> **Typography 可以适应空间，但不能失去自己的层级身份。**

同时我建议这里继续延续你之前对安全性的倾向：

**默认以离散 Type Scale 为主。**

真正的 Contextual 调整只发生在有明确空间理由的时候，而且幅度很小。

这样最终既有灵活性，又不会出现“整个 Nebula 的字一直在呼吸、一直在变大小”的视觉不稳定。

**G52，我倾向 D。**

<sub>原文台账 G52（消息 587）</sub>

#### G53 · Typography Weight 应该怎么建立？

**D · Semantic Weight Hierarchy**

> **Weight 是 Semantic Hierarchy 的一个稳定维度，拥有有限的 Weight Families；Context 可以调整表达权，但不能随意创造新的“粗细状态”。**

例如：

**Display / Page Heading**
→ 可以使用较高 Weight，但不要求全部 Bold。

**Section Heading**
→ 中高 Weight。

**Body**
→ 稳定 Regular / Book 区间。

**Metadata**
→ 通常较轻。

**Interactive Label**
→ 可以略高于普通正文，以提高可操作识别。

**Selected / Active**
→ 可以通过 Weight 提升表达，但不一定需要换颜色。

而且：

> **Weight 不应该单独承担重要性。**

一个重要标题不一定非要 700；它可以通过：

**Scale + Position + Negative Space + Contrast + Weight**

共同获得权重。

特别是 Nebula 的 UI，我会明显偏向：

> **少用极粗字重，多用空间和比例制造层级。**

这样 Typography 才不会越来越“黑”，而是越来越“有秩序”。

**G53，我倾向 D。**

<sub>原文台账 G53（消息 590）</sub>

#### G54 · Line Height 应该怎么治理？

**D · Semantic Reading Rhythm**

> **Line Height 首先服务于“阅读节奏”，而不是单纯服从字号比例。**

Global System 建立有限的 **Line-height Families**，但最终由：

**Semantic Role**  
**Typeface Role**  
**Language / Script**  
**Density**  
**Reading Context**  
**Adjacent Elements**

共同决定。

例如：

**Display / Page Heading**
→ 可以更紧，强化整体轮廓。

**Section Heading**
→ 稍微舒展。

**Body**
→ 优先阅读舒适。

**Metadata**
→ 可以紧凑，但不能挤成一团。

**Button / Control Label**
→ 更强调垂直居中和 Control Geometry，而不是“文本段落式”的 line-height。

而且这一条对多语言尤其重要：

> **Line Height 不应该简单复制英文的数学比例到中文、日文、韩文。**

因为不同 Script 的实际字面高度和上下延伸空间并不一样。

所以 Typography System 最终应该追求的是：

> **同样的语义角色，在不同语言下拥有相似的感知阅读节奏。**

而不是：

> `line-height = font-size × 1.4`

永远不变。

<sub>原文台账 G54（消息 593）</sub>

#### G55 · Letter Spacing / Tracking 应该怎么处理？

**D · Semantic Optical Tracking**

> **Tracking 是 Typography 的光学修正工具，不是独立的装饰风格。**

Global System 建立有限的 Tracking Grammar，但最终值主要受：

**Typeface**  
**Semantic Role**  
**Font Size**  
**Weight**  
**Script**  
**Optical Density**

影响。

例如：

**UI Text**
→ 接近自然字距，优先清晰。

**Display / Song Title**
→ 可以有非常轻微的 Optical Tracking。

**Uppercase / Small Labels**
→ 可以适度增加字距改善识别。

**Reading / Lyrics**
→ 原则上保持自然、稳定，不拿 Tracking 做艺术表现。

而且一个很重要的规则：

> **Tracking 的调整不能代替 Typography Hierarchy。**

如果一个标题不够重要，不能靠 `letter-spacing: 0.12em` 假装它高级。

同样，不能靠把 Metadata 拉得特别开来“制造精致感”。

我会让 Nebula 的默认 Tracking 总体偏**接近自然排版**，真正明显的 Tracking 只在少数特殊角色、特殊 Script 或 Editorial Context 中出现。

最终：

> **Typography 应该先像优秀的排版，再像设计。**

**G55 你定。**

<sub>原文台账 G55（消息 596）</sub>

#### G56 · Text Color Hierarchy 怎么建立？

**D · Semantic Text Hierarchy**

> **Text Color 首先属于 Semantic Role，而不是“透明度等级”。**

系统建立稳定的：

**Primary Text**  
**Secondary Text**  
**Tertiary / Supporting Text**  
**Disabled Text**  
**Inverse Text**  
**Accent Text**  
**Semantic Feedback Text**

然后根据：

**Typography Role**  
**Surface Layer**  
**Contrast Context**  
**Density**  
**Atmospheric Background**

进行有限的 Optical Compensation。

这意味着：

一个 Secondary Text 不一定永远就是：

> `rgba(255,255,255,.6)`

它首先是：

> **Secondary Semantic Text**

最终颜色再根据它所在的 Surface / Environment 得到合适的感知表现。

<sub>原文台账 G56（消息 599）</sub>

#### G57 · Global Typography Role 是否应该有明确的“角色词典”？

**D · Semantic Typography Role System**

> **Global Typography 应拥有一套有限、稳定、语义化的 Role Vocabulary；角色描述“文字为什么存在”，而不是它出现在哪个组件里。**

例如可以形成这样的方向：

**Display**
→ 非常特殊的展示性文字

**Page Heading**
→ 页面一级标题

**Section Heading**
→ 页面内部主要分组标题

**Body**
→ 普通信息正文

**Supporting**
→ 辅助解释 / 次级信息

**Label**
→ 控件 / 字段 / 分类标签

**Metadata**
→ 时间、作者、状态、附加信息等

**Caption**
→ 更低优先级的说明

**Micro**
→ 极小但仍有功能意义的信息

然后：

> **Button / Input / List Row / Navigation 并不是 Typography Roles。**

它们引用某个 Role。

例如：

`Navigation Item → Label`

`Button → Label`

`List metadata → Metadata`

`Page Header → Page Heading`

这样如果未来我们改 Label 的 Typography，所有相关组件都能自然同步。

同时仍允许：

> **Stage-owned Typography Role**

例如 Listening Space 的 Lyrics，可以拥有自己的专项 Role；但它不应该把自己定义成一个完全脱离 Global System 的字体世界。

这一步的核心是：

> **先建立词典，再允许组件引用词典。**

这样以后 Agent 再也不能因为“这一行感觉有点特殊”就凭空创造一个 `font-size: 13px; font-weight: 500; opacity: .73` 的新 Typography Variant。

**G57 我倾向 D。**

<sub>原文台账 G57（消息 602）</sub>

#### G58 · Typography Role 是否允许拥有多个受控 Variant？

**D · Semantic Role + Controlled Variant Envelope**

> **Role 是身份，Variant 是受控表达范围。**

也就是说：

`Metadata` 仍然只有一个 Semantic Role，但可以拥有少量经过定义的 Variant：

**Default**  
**Compact**  
**Quiet / Reduced-emphasis**

Variant 的产生依据必须是：

**Density**  
**Spatial Context**  
**Surface Context**  
**Accessibility**

而不是：

> “这个页面设计师觉得这里应该有一点不一样。”

并且一个 Role 的 Variant 数量应该是**有限且封闭的**。Agent 不能随意创建：

`Metadata-soft`  
`Metadata-subtle`  
`Metadata-light`  
`Metadata-dim`  
`Metadata-quiet-2`

这种最终一定会失控的东西。

<sub>原文台账 G58（消息 605）</sub>

#### G59 · Typography Role 是否允许跨组件复用？

**D · Semantic Role Federation**

> **Typography Role 本身属于 Global Semantic Layer，可以跨组件复用；组件不拥有 Typography，只拥有“使用哪个 Role”的权限。**

例如：

```text
Navigation Item
Button
Input Label
Filter Label
      ↓
    Label Role
```

它们虽然视觉结果不一定百分之百相同，但差异只能来自：

**Density**  
**Surface Context**  
**Interaction State**  
**Available Space**

而不是某个组件偷偷复制一份：

> “其实和 Label 差不多，只是我这里 13px、那里 13.5px。”

因此最终形成：

> **Semantic Role is reusable; Component context is contextual.**

并且：

**相同语义 → 默认共享 Role**  
**不同语义 → 不为了视觉相似而强行共用 Role**

这会特别适合 Nebula，因为它可以让整个 App 的文字真正拥有一种“家族关系”。

<sub>原文台账 G59（消息 608）</sub>


## J · 组件与 Token 治理

这一层决定 Agent 有没有「自己发明」的空间——绝大多数旧 UI 污染都是从这里漏出去的。

**Agent 硬约束**

- 组件必须能归入 Shared Component Inventory，不允许「临时组件」进主界面。
- Token 三层：Semantic → Canonical Value → Allowed Range；组件里不得出现裸数值。
- Local Token 可以有，但升级为 Global 要过 promotion 门槛（G66）；状态有优先级，表达通道受预算约束（G67/G68）。

#### G60 · Shared Component Inventory 应该怎么建立？

**D · Semantic Component Taxonomy**

这次我认为它特别适合我们当前的项目阶段：

> **Global Component Inventory 不追求“把所有 UI 元素提前做完”，而是按照 Semantic Role 建立有限的组件族。**

先从几个大类管理：

```text
Navigation
Action
Input
Selection
Content
Feedback
Overlay
Utility
Data / Collection
```

然后每个族里只纳入**真正具有跨页面复用价值**的组件。

<sub>原文台账 G60（消息 611）</sub>

#### G61 · Shared Component 的构成方式

**D · Semantic Composition System**

> **Shared Component = Semantic Structure + Global Primitives + Controlled Local Rules。**

也就是三层：

```text id="7qjv2x"
Semantic Component
        ↓
Global Primitive
        ↓
Controlled Local Rule
```

例如一个 Button：

**Semantic Structure**
→ “这是一个 Primary Action”

↓

**Global Primitives**
→ Material / Typography / Geometry / Icon / Motion / Color

↓

**Controlled Local Rule**
→ Primary Action 需要更明确的 Surface Presence

而这个 Local Rule **不能重新发明世界**。

它只能在 Global System 给出的范围内选择、组合和轻微调整。

例如：

> Button 可以决定自己需要多少 Action Presence。

但不能决定：

> “我觉得 13px radius 配蓝色 Glow 很酷。”

---

这样以后：

**Card**
→ Content Surface Role

**List Row**
→ Collection Member Role

**Button**
→ Action Role

**Select**
→ Selection Surface Role

它们最终都由同一套 Global Foundation 拼起来。

<sub>原文台账 G61（消息 615）</sub>

#### G62 · Global Primitive 应该暴露到什么程度？

**D · Semantic Capability Boundary**

> **Global System 不只是提供 Token，还定义“谁有资格使用什么能力”。**

也就是说：

```text
Raw Foundations
        ↓
Semantic Tokens
        ↓
Component Capabilities
        ↓
Stage Capabilities
```

例如普通 Button 可以拥有：

**Action Surface**  
**Semantic Color**  
**Standard Geometry**  
**Hover / Press**

但不能自己调用：

**Atmospheric Color Field**

Card 可以拥有：

**Content Surface**  
**Elevation**

但不能直接驱动：

**Global Light**

普通 Shared Component 不能直接决定：

**Atmosphere intensity**  
**global blur field**  
**large-scale spatial motion**

这些能力属于更高层。

而 Stage-owned Component 才可以在明确许可下调用更高能力。

这和我们前面确定的：

> **Expression must be earned**

其实正好形成完整的工程版：

> **Capability must be earned.**

因此以后 Agent 不是“不能写”，而是**架构上就不应该轻易拿到那把钥匙**。

例如：

```text id="c8v6ym"
Button
  ✓ semantic.color
  ✓ material.action
  ✓ motion.micro
  ✗ atmosphere.write
  ✗ globalLight.write
  ✗ layout.skeleton.write
```

<sub>原文台账 G62（消息 618）</sub>

#### G63 · Global Token 应该不应该允许直接出现具体数值？

**D · Semantic Token + Canonical Value + Allowed Range**

> **每一个真正重要的 Global Token 都拥有一个 Canonical Value，同时允许非常明确的有限调整范围。**

例如：

```text
radius.panel
Canonical: 20
Allowed: 18–22

spacing.section
Canonical: 24
Allowed: 22–28

text.body
Canonical: ...
Allowed: ...
```

这样：

**Canonical Value**  
是 Nebula 的默认真值。

**Allowed Range**  
是考虑到不同 Typeface、Density、Window、Optical Correction 后留下的受控弹性。

同时，不是所有 Token 都允许 Range。

有些东西必须是：

> **Exact Token**

例如某些：

**Control Height**  
**Icon Size Family**  
**Focus Thickness**  
**Accessibility Contrast Floor**

不能让 Agent 自己“差不多”。

所以 Token 实际上分成：

**Fixed**  
**Canonical + Bounded**  
**Contextual / Derived**

三类。

这样最终的 Global Spec 既不会变成：

> “一切都是 16px，谁都不能碰。”

也不会变成：

> “大概差不多，你自己体会。”

而是：

> **Nebula 有明确的标准答案，也明确告诉 Agent 哪些地方允许偏离、偏离多少、为什么。**

这会直接影响以后我们最终母稿的可执行程度。

**G63，我倾向 D。**

<sub>原文台账 G63（消息 621）</sub>

#### G64 · Token 本身应该怎么分类？

**D · Three-layer Semantic Token Architecture**

这一步其实非常关键，因为现在我们已经不只是规定“看起来应该怎样”，而是在规定：

> **Nebula 的视觉知识应该如何被组织，才能长期不腐化。**

以后一个值从哪里来，会有明确的路径：

**Foundation → Semantic → Component / Stage**

而 Shared Component 原则上只消费 **Semantic Token**。这对 Agent 尤其重要。

<sub>原文台账 G64（消息 624）</sub>

#### G65 · Component 能不能创建自己的 Local Token？

**D · Semantic Local Token Governance**

> **Local Token 可以存在，但必须有明确的语义来源、作用范围和生命周期。**

一个组件只有在：

**Global Semantic Token 无法合理表达该组件的特殊需求**

时，才可以创建 Local Token。

并且 Local Token 必须：

**有明确语义名称**  
**有 Parent / Source Token**  
**有 Scope**  
**有 Allowed Range**  
**不能被其他组件随意复用**  
**不能创造新的 Global Visual Language**

<sub>原文台账 G65（消息 627）</sub>

#### G66 · 一个 Local Rule / Local Token 什么时候应该“升级”为 Global？

**D · Semantic Promotion Governance**

> **是否升级 Global，不看“用了几次”，而看它是不是已经表现出稳定、跨组件的语义规律。**

判断可以看：

**Semantic Recurrence**  
→ 是否在不同组件 / Stage 反复出现同一种需求？

**Cross-context validity**  
→ 换一个页面、组件、Density 后，这条规则仍然成立吗？

**Foundation alignment**  
→ 能不能从已有 Global Foundation 自然推导？

**Stability**  
→ 它是长期规律，还是某个页面的一次性设计？

**Ownership**  
→ 这条规则到底属于 Component、Stage，还是整个 Nebula？

<sub>原文台账 G66（消息 630）</sub>

#### G67 · Component State 是否应该存在明确的状态优先级？

**D · Contextual State Composition**

> **组件状态不是简单的“谁覆盖谁”，而是多个正交语义 Channel 的组合；最终表现经过 Contextual State Composition 得出。**

例如：

```text
Availability
├─ Enabled
├─ Disabled
└─ Loading

Selection
├─ None
├─ Selected
└─ Active

Interaction
├─ Rest
├─ Hover
└─ Press

Focus
├─ None
├─ Visual
└─ Keyboard
```

然后系统根据组件当前 Context 决定：

**哪些状态可以同时表达**  
**哪些状态必须让位**  
**哪些状态只保留语义、不增加额外视觉**

例如：

**Selected + Hover**
→ Selected 是持续状态；Hover 只提供很小的即时反馈。

**Selected + Keyboard Focus**
→ 两者都应该可识别，但尽量复用同一表达通道。

**Loading + Hover**
→ Loading 取得更高优先级，Hover 不应该再增加一套视觉响应。

**Disabled + Hover**
→ Disabled 保留；Hover Response 通常被抑制。

所以不是：

> `loadingStyle + hoverStyle + focusStyle`

机械叠加。

而是：

> **State Composition → Expression Resolution → Final Visual State**

这和我们前面整个 Nebula 的思想是高度一致的：

> **内部状态可以很多，外部表达必须被重新组织。**

而且这会直接解决 Shared Components 最容易出 bug 的地方之一：

> **状态越多，不代表视觉效果越多。**

我倾向 **D**。

<sub>原文台账 G67（消息 633）</sub>

#### G68 · 状态解析之后，应该允许同时使用多少种表达通道？

**D · Contextual Expression Budget**

> **Global System 不规定“所有状态最多只能用两种效果”，而是规定每种状态拥有一个受控的 Expression Budget。**

例如：

**Hover**

通常：

> 1 个主要通道 + 极轻辅助响应

**Press**

> 主要 Material / Compression + 必要的即时确认

**Selected**

> 可以同时使用 Typography + Surface，必要时再有 Accent / Indicator

**Keyboard Focus**

> 必须保留明确 Focus Evidence，同时可以使用 Material / Edge 做辅助

**Error**

> Semantic Color + 必要的局部结构 / Text，严重时才扩大表达范围

**Loading**

> 一个主要进度表达 + 极少量辅助变化

而且 Budget 不只是“数量”，还包括：

**Intensity**  
**Spatial Scope**  
**Duration**  
**Persistence**

也就是说：

> 一个状态即使只用了两个通道，也可能仍然太吵。

比如：

`Color + Glow`

如果 Glow 很大、面积很广，仍然超预算。

因此真正的规则是：

> **Expression Budget governs how much attention a state is allowed to consume, not merely how many effects it may use.**

这和我们之前的 **Expression Ceiling** 正好形成层级：

**Global Expression Ceiling**  
→ 整个 Nebula 的总上限

**Component Expression Budget**  
→ 某个组件 / 状态此刻可以消耗多少表达资源

<sub>原文台账 G68（消息 636）</sub>

#### G69 · 所有 Shared Component 是否都应该拥有完整的状态能力？

**D · Semantic State Capability**

> **状态也是一种 Capability。Component 只有在语义上有资格时，才获得对应 State。**

例如：

```text id="state-capability"
Button
✓ Interaction
✓ Availability
✓ Focus
✓ Selection（特定 Button）
✓ Loading
✓ Feedback

Passive Card
△ Hover（如果需要）
△ Focus（如果可聚焦）
✗ Press
✗ Loading

Tooltip
✓ Visibility
✓ Dismissal
✗ Selection
✗ Press
```

这样就不会为了“设计系统完整”，强行让每一个组件支持一整套状态。

更重要的是：

> **状态 Capability 决定“可以表达什么”，Expression Budget 决定“这次应该表达多少”。**

这两层不能混：

**Capability**
→ 有没有资格表达

**Budget**
→ 有资格以后，消耗多少注意力

于是整个逻辑变成：

```text id="state-resolution"
Semantic Role
      ↓
State Capability
      ↓
Active State Channels
      ↓
Contextual State Composition
      ↓
Expression Budget
      ↓
Final Visual Expression
```

这个我觉得已经非常接近最终可以交给 Agent 的真实架构了，而不是纯设计概念。

**G69，我倾向 D。**

<sub>原文台账 G69（消息 639）</sub>


## K · 动效基础

动效是能力，不是装饰；默认倾向静止。

**Agent 硬约束**

- 时间语言统一（Temporal System），不与具体组件绑定。
- 默认静止倾向：能不动就不动，动必须有理由。
- Reduced Motion 是一等公民，不是事后补丁。

#### G70 · Global Motion 要不要成为所有组件的默认能力？

**D · Contextual Motion Capability**

> **Motion 不是 Shared Component 的默认能力，而是一种需要语义资格的 Contextual Capability。**

例如：

**Button**
→ 可以拥有非常轻的 Hover / Press Motion。

**Toggle**
→ 状态本身具有连续变化语义，所以可以拥有明确但克制的 Transition。

**Navigation**
→ Active 可以有平滑 State Transition。

**Card**
→ 如果只是信息展示，可能根本没有 Motion Capability。

**Metadata**
→ 通常不应该因为 Hover / Context 而自己动。

**Tooltip**
→ 允许 Arrival / Exit，但这是它作为 transient surface 的生命周期，而不是“Tooltip 自己很会动”。

同时：

> **拥有 Motion Capability ≠ 每次状态变化都必须动。**

还必须继续经过：

**Context**  
**Motion Layer**  
**Event Importance**  
**Expression Budget**  
**Reduced Motion / Accessibility**

<sub>原文台账 G70（消息 642）</sub>

#### G71 · Global Motion 的“时间语言”怎么落地？

**D · Semantic Temporal System**

> **Global Motion 不规定“Button 必须 180ms”，而是规定 Motion 的语义时间类别。**

例如：

**Immediate**
→ 用户操作需要瞬时被接收  
如 Hover awareness、Press acknowledgement

**Responsive**
→ 需要让用户感觉到变化，但不能迟滞  
如 Selection / Navigation state change

**Transformative**
→ 真正发生空间或 Material 重组  
如 Overlay appearance、Content transition

**Settling**
→ 状态已经确定，只是在寻找自然稳定点  
如 Material / spatial settle

**Ambient**
→ 环境运动自己的时间尺度，不参与交互反馈

然后每一类拥有：

**Canonical Timing Character**  
+ **有限允许区间**

真正数值以后才落到 Token 层。

所以不会得到：

> “所有动画 200ms。”

而会得到：

> **“这个事件属于 Responsive Temporal Role，因此应该迅速、短促、有明确 arrival，而不是采用 Ambient 的慢节奏。”**

并且继续继承我们已经确定的：

**Event Coalescing**  
**Contextual Interruption**  
**Motion Capability**  
**Expression Budget**

所以如果连续发生多个事件：

> 不应该为了把每个动画都播完而拖慢当前状态。

我尤其倾向把这一条写成 Global Spec 的核心句：

> **Nebula standardizes temporal character, not arbitrary milliseconds.**

<sub>原文台账 G71（消息 645）</sub>

#### G72 · Global Motion 是否应该有一个“默认静止倾向”？

**D · Contextual Motion Restraint**

这不是简单的“少做动画”。

> **Nebula 的默认状态应该天然偏向静止；Motion 必须因为语义、连续性或可理解性获得存在资格。**

也就是说：

**状态不变 → 不需要运动**

**状态改变，但变化本身已经足够明确 → 不一定需要运动**

**运动能够显著提升连续性 / 可理解性 → 才使用**

**运动只是为了让界面“显得高级 / 有生命” → 不使用**

而且这个“静止倾向”不是让 Nebula 死气沉沉。

真正有价值的：

**Artwork Transition**  
**Listening Space transformation**  
**Selection transition**  
**Toggle transition**  
**Overlay arrival**  
**Ambient atmosphere**

依然可以很漂亮。

但它们之所以动，是因为：

> **这个变化值得拥有时间。**

我觉得这句话甚至可以成为 Motion System 的第二句总原则：

> **Stillness is the default; motion must earn its presence.**

这样我们前面确定的 Editorial / Quiet / Expression Ceiling / Semantic Capability 就真正闭环了。

**G72，你定。**

<sub>原文台账 G72（消息 648）</sub>

#### G73 · Reduced Motion 应该怎么进入 Global System？

**D · Contextual Reduced Motion**

> **Reduced Motion 不是一个简单的“Animation = false”，而是一套全局 Motion Reinterpretation Mode。**

系统根据 Motion 的语义角色重新解释：

**Immediate / Responsive**
→ 可以保留非常短、非常直接的状态变化。

**Transformative**
→ 减少位移与形变，必要时转换成 Fade / State Change。

**Ambient**
→ 大幅降低甚至停止。

**Expressive**
→ 优先削减。

**Attention / Feedback**
→ 保留最必要的可理解性信号。

例如：

普通 Hover：

> 可以保留轻微视觉变化，不需要 Scale。

Dialog 出现：

> 不做明显位移，可以直接进入最终状态或用极轻 Fade。

Listening Space 的复杂空间转换：

> 由它自己的专项 Reduced Motion 规则处理，但必须服从 Global Reduced Motion。

而且必须有一条很硬的原则：

> **Reduced Motion 改变的是表达方式，不应该改变产品的信息架构。**

不能因为不开动画，用户就不知道：

**哪里打开了、哪里选中了、操作有没有成功。**

所以它和我们前面的整个架构非常一致：

**Motion Capability**  
→ **Temporal Role**  
→ **Expression Budget**  
→ **Reduced Motion Reinterpretation**

<sub>原文台账 G73（消息 651）</sub>


## L · 焦点与键盘可达性

Focus 是键盘用户的「指针」，必须比鼠标态更确定。

**Agent 硬约束**

- Focus 必须有明确证据，且在深色 / 玻璃背景上依然可见。
- Focus 跟随对象，但视口只移动必要距离，并避开固定栏遮挡。
- 键盘顺序由空间与语义决定，不由 DOM 顺序决定；Overlay 内焦点受困，关闭后回到触发点。

#### G74 · Keyboard Focus 应该有多强的视觉存在？

**D · Contextual Keyboard Focus**

> **Keyboard Focus 是一个 Global Semantic State，必须拥有可靠的 Focus Evidence；具体表现形式由 Context 决定，但不能被其他视觉状态吞掉。**

例如：

**普通 Button**
→ 可以是轻微 Edge + Contrast + 微量 Accent。

**Input**
→ 可以提高 Edge / Surface separation。

**Navigation**
→ 可以结合当前 Active State，但必须另外保证 Keyboard Focus 可辨认。

**复杂 Card**
→ 如果整个 Card 可聚焦，Focus 可以是局部 Surface / Edge，而不是给整个页面套一个巨大的 outline。

**高视觉复杂度 / Glass Surface**
→ 可以使用更明确的 Focus Indicator，必要时牺牲一点“视觉纯度”。

而最重要的一条：

> **Keyboard Focus 必须比 Hover 更稳定，也比 Atmosphere 更有优先级。**

它不能：

**依赖动画才能看到**  
**依赖鼠标悬停才能显现**  
**因为页面很漂亮而被压低到几乎不可见**

同时它也不应该直接等于：

> **“所有组件统一一个蓝色 2px 圆角框。”**

而是：

> **同一个语义状态，在不同组件中拥有不同的合理表达，但共享同一个 Focus Language。**

这实际上就是 **G69 State Capability + G68 Expression Budget + G73 Reduced Motion** 在 Accessibility 层的汇合。

我倾向 **D**。

<sub>原文台账 G74（消息 654）</sub>

#### G75 · Global Focus Indicator 要不要拥有一个“品牌性格”？

**D · Semantic Focus Language**

> **Focus Indicator 应该拥有 Nebula 自己的视觉语言，但它首先是 Accessibility Signal，其品牌化只能发生在“可辨识性已经满足”之后。**

也就是说，它可以使用：

**Contextual Edge**  
**Semantic Accent**  
**Surface Lift**  
**Optical Contrast**  
**Light Response**

来构成 Nebula 风格的 Focus。

但系统必须有一个**可靠的 Focus Minimum Expression**：

如果当前背景 / Glass / Atmosphere 太复杂，

> 就允许 Focus Indicator 暂时比平常更“明确”，甚至牺牲一点纯净的 Editorial 感。

这条我觉得非常重要：

> **Accessibility 是 Nebula Visual System 的约束，不是 Nebula Visual System 之外的一块补丁。**

所以不会出现：

> “平时很好看，一按 Tab 就突然套一个完全不同风格的浏览器蓝框。”

但也绝不会为了“高级”而让 Focus 变成：

> “我觉得这里好像有一点光？”

最终目标是：

> **用户能一眼认出 Focus 在哪里，而同时觉得这个 Focus 天然属于 Nebula。**

我倾向 **D**。

<sub>原文台账 G75（消息 657）</sub>

#### G76 · Focus 的视觉强度应该始终一样吗？

**D · Contextual Focus Visibility**

> **Focus 的语义不变，但其“可见强度”应该根据当前视觉环境动态补偿。**

系统先确定：

> **用户必须明显知道 Focus 在哪里。**

然后才决定最合适的视觉路径。

例如：

**安静的普通 Button**
→ 非常轻的 Focus Evidence 就够了。

**复杂 Glass Surface**
→ 可能需要更明显的 Edge / Contrast。

**Atmosphere 很复杂的 Artwork 区域**
→ Focus 可以暂时提高 Contrast / Edge Presence。

**高密度列表**
→ Focus 可能更依赖 Indicator / Position。

但这里有一个非常重要的限制：

> **Focus Strength 可以变化，Focus Identity 不变化。**

用户应该逐渐形成一种肌肉记忆：

> “这个东西就是 Nebula 的 Focus。”

而不是每个页面都有完全不同的 Focus 视觉。

<sub>原文台账 G76（消息 660）</sub>

#### G77 · Focus 应该“跟着对象走”，还是尽量保持固定的空间锚点？

**D · Semantic Focus Tracking**

> **Focus 永远属于当前对象，几何表现可以借助连续运动增强空间连续性，但不能让 Focus Indicator 看起来像脱离对象独立存在。**

例如：

**Tab Navigation**

Focus 从 A → B：

→ 可以平滑迁移，但最终一定明确落在 B。

**List Navigation**

Focus 从 Row 4 → Row 5：

→ 可以有非常轻的 spatial transition，但 Row 4 和 Row 5 都不能同时像“拥有 Focus”。

**内容动态变化**

如果对象发生位置变化：

→ Focus 跟随对象的语义身份，而不是停留在旧坐标。

这和我们之前确定的：

**Semantic Anchoring**

其实是同一种思想：

> **Anchor the meaning first, the geometry second.**

同时继续服从 Motion System：

**Reduced Motion**
→ 可以直接重定位，不依赖移动动画。

**Rapid navigation**
→ 不排队播放 A → B → C 的完整 Focus animation，而是直接追踪用户最新意图。

所以 Focus 最终是：

> **Object-owned, Contextually positioned, Semantically tracked.**

我倾向 **D**。

<sub>原文台账 G77（消息 663）</sub>

#### G78 · Keyboard Navigation 的空间顺序应该由什么决定？

**D · Semantic Navigation Order**

> **Keyboard Focus Order 应首先遵循语义阅读与任务顺序，几何位置只是重要参考，而不是唯一依据。**

例如一个普通 Settings 页面：

```text
Heading
↓
Section
↓
Field A
↓
Field B
↓
Save
```

即使视觉构图为了 Editorial 感让某个按钮稍微偏到右边，它仍然应该按照**任务逻辑**进入 Focus 顺序。

而在 Navigation：

> Primary Navigation → Secondary Navigation → Main Content

这种结构优先于单纯的屏幕坐标。

在一个特殊 Editorial Stage：

> Focus 顺序可以由 Stage 明确定义，但仍然必须符合语义阅读 / 操作逻辑。

同时有一个硬约束：

> **视觉上的“漂亮错位”不能制造键盘导航上的逻辑错位。**

而且这和 G77 完全一致：

**Geometry 可以自由。**  
**Semantic Order 必须稳定。**

这样 Keyboard Navigation 就不会成为 Global Visual System 的敌人，而是成为它的一个隐藏骨架。

**G78，我倾向 D。**

<sub>原文台账 G78（消息 666）</sub>

#### G79 · Overlay / Dialog 打开后，Keyboard Focus 应该怎么处理？

**D · Semantic Focus Boundary**

> **Overlay 是否建立 Focus Boundary，由它的 Semantic Interaction Authority 决定，而不是由“它是不是一个弹窗”决定。**

例如：

**Tooltip**
→ 不获取独立 Focus，不建立 Boundary。

**Popover**
→ 如果只是补充信息，可以保持轻量；如果包含可操作内容，则建立局部 Focus Context。

**Dropdown / Select**
→ 打开后进入 Selection Focus Context；键盘操作集中在选项集合中。

**Context Menu**
→ 建立明确的 Action Focus Context。

**Dialog / Modal**
→ 建立真正的 Focus Boundary；底层暂时退出 Keyboard Navigation。

关闭之后：

> **Focus 返回原来的 Semantic Anchor。**

而不是简单地回到页面顶部或某个默认控件。

这和 G30 的 **Semantic Anchoring**、G77 的 **Semantic Focus Tracking** 是同一套思想：

> **Focus 的真正锚点是语义关系，不是某个坐标。**

同时还要有一个硬约束：

> **Overlay 不能让用户陷入 Focus。**

无论是 Escape、关闭按钮还是完成操作，都必须存在清晰的退出路径。

这样就完成了一个很重要的链条：

**Trigger**  
→ **Overlay Boundary**  
→ **Local Focus Context**  
→ **User Interaction**  
→ **Dismiss / Complete**  
→ **Return Focus to Semantic Anchor**

我倾向 **D**。

<sub>原文台账 G79（消息 669）</sub>


## M · 反馈与结构

Toast / Dialog / Sheet / Empty / Badge / Progress / Collection 是页面的「语法部件」。

**Agent 硬约束**

- Toast 不承载需要决策的信息；Dialog 只用于必须现在决定的事。
- Empty State 要说明「为什么空 + 下一步做什么」；Badge / Chip / Tag 语义不同，不能混用。
- Progress 表达「还要多久」，不表达「我在忙」。

#### G80 · Overlay 的关闭方式应该怎么处理？

**D · Semantic Dismissal System**

> **关闭方式由 Overlay 的语义与风险决定，而不是由“这是个弹层”决定。**

例如：

**Tooltip**
→ Pointer / Focus 离开后自然消失。

**Popover**
→ 通常 Outside Click / Escape 可以关闭。

**Dropdown**
→ 选择完成可以关闭；Escape 可以取消；必要时点击外部关闭。

**Context Menu**
→ 完成操作、点击外部、Escape 都可以结束。

**Dialog**
→ 是否允许 Outside Click 关闭，取决于它是不是可安全取消的任务；  
> **不能把所有 Dialog 都强制做成“点外面就消失”。**

而且：

> **Dismissal 本身应该维护语义连续性。**

例如用户打开一个 Select：

`Trigger → Selection Surface → 选择 Option → Close`

关闭以后，Trigger 继续保持新的 Selected State。

而不是：

> 浮层消失了，但 Focus / Selection / 状态关系断掉。

同时保留一个重要原则：

> **Dismissal should be predictable, reversible where appropriate, and never strand the user.**

这样 Dismissal 也不再是一堆零散的 `onClickOutside`、`onKeyDown(Escape)`，而成为 Global Interaction Grammar 的一部分。

**G80，我倾向 D。**

<sub>原文台账 G80（消息 672）</sub>

#### G81 · Toast / Notification 应该是什么？

**D · Semantic Notification System**

> **Notification 首先判断“这个信息应该属于哪里”，然后才决定用什么载体。**

可以形成：

**Inline Feedback**
→ 归属于原操作 / 原内容。

**Transient Toast**
→ 短暂、无需持续关注的系统确认。

**Persistent Banner**
→ 需要用户知道，但不值得打断当前任务。

**Actionable Notification**
→ 用户需要明确处理时，才升级到更强的表现。

**Modal / Dialog**
→ 只有真的跨越任务边界、需要明确决策时才进入。

于是：

> “复制成功”
可能根本不需要 Toast，按钮本身变化就够。

> “网络暂时断开”
可能需要一个持续但安静的状态提示。

> “无法删除这个项目”
如果需要用户处理原因，可以在原处反馈。

> “检测到必须重新登录”
才可能升级成明确的 Overlay / Dialog。

核心原则：

> **Notification should have an owner.**

一个通知必须能回答：

> **“这条信息属于哪个动作、哪个对象、哪个上下文？”**

如果它没有明确归属，才考虑把它提升为真正的系统级 Notification。

<sub>原文台账 G81（消息 675）</sub>

#### G82 · Dialog / Modal 应该是什么？

**D · Contextual Decision Surface**

> **Dialog 是一种拥有明确 Interaction Authority 的临时 Decision Surface。**

它出现的核心条件不是：

> “我需要一个弹窗。”

而是：

> **当前任务是否真的需要用户暂停当前空间、集中注意力并做出决定？**

所以：

**Confirm / Delete / Irreversible Action**
→ 可以建立明确 Decision Surface。

**需要用户填写一组内容**
→ 可以形成 Task Surface，但如果任务很复杂，不应该硬塞进小 Dialog。

**简单信息提示**
→ 优先 Inline / Toast / Popover，而不是升级 Dialog。

**复杂工作流**
→ 可以升级为更大的 Sheet / dedicated Stage，而不是让 Dialog 无限变大。

视觉上：

Dialog 拥有更高的：

**Surface Presence**  
**Elevation**  
**Contrast Protection**  
**Focus Authority**

但仍然继承：

**Global Material World**  
**Global Geometry Language**  
**Global Typography**  
**Global Semantic Color**  
**Global Light**

它不会因为“我是 Modal”就突然拥有另一套 Glass。

同时：

> **Dialog 的视觉重量应该与任务风险成正比。**

轻量确认：

→ 简洁、安静。

高风险 / 不可逆决策：

→ 可以更明确，但仍然不需要戏剧化。

而且我特别想锁一条：

> **Dialog 不应该成为“内容塞不下时的万能大盒子”。**

如果已经膨胀成复杂页面，它就应该承认自己是 **Task Space**，而不是继续伪装成 Dialog。

<sub>原文台账 G82（消息 678）</sub>

#### G83 · Sheet / Drawer 应该是什么？

**D · Contextual Secondary Space**

> **Sheet / Drawer 是当前 Stage 的临时 Secondary Space，而不是更大的 Dialog。**

它可以：

**从边缘 / Anchor 附近进入**  
**拥有自己的 Surface Layer**  
**承载较连续的操作**  
**暂时提高自己的 Focus Authority**

但它仍然：

**继承当前 World**  
**继承 Global Material / Geometry / Typography**  
**保留与原 Stage 的空间关系**

因此：

**Settings 的详细编辑**
→ 可以是 Sheet。

**歌曲详情 / Queue**
→ 很适合 Secondary Space。

**复杂的筛选 / 排序**
→ 可以通过 Sheet 扩展，而不是做超大的 Popover。

但：

> 如果一个 Sheet 最终承载了完整、长期、独立的任务，它就应该晋升为真正的 Stage，而不是永远作为 Drawer 藏在另一个页面旁边。

这样我们又得到一条很重要的边界：

> **Popover 是临时信息 / 轻操作。**
> **Sheet 是临时次级空间。**
> **Dialog 是临时决策空间。**
> **Stage 是真正的独立空间。**

这四者以后不会再靠“大小”区分，而靠**Semantic Authority** 区分。

**G83 我倾向 D。**

<sub>原文台账 G83（消息 681）</sub>

#### G84 · Empty State 应该是什么？

**D · Semantic Empty State System**

> **Empty State 首先说明“为什么空”，然后决定用户“下一步是什么”，最后才决定需要多少视觉表达。**

例如：

**首次使用**
→ 可以稍微引导用户采取第一步。

**Search No Result**
→ 简洁说明没有匹配，不应该像系统故障一样报警。

**Filter No Result**
→ 明确是当前筛选条件造成的空状态，并给出恢复路径。

**真正 Error**
→ 不应该伪装成 Empty State，而应该进入 G26 Error System。

**自然空状态**
→ 甚至可能只需要一句安静的文字。

所以 Empty State 可以拥有：

**Typography**  
**Icon / Illustration**  
**Action**  
**Contextual Surface**

但它的 Expression Budget 应根据语义决定。

而且一个很重要的边界：

> **Empty State 不应该为了填满空白而制造内容。**

Nebula 已经把 **Dynamic Negative Space** 定为正式设计语言，那么空白本身可以是正确答案。

也就是说：

> **“这里什么都没有”有时候就是一个完整、安静、成立的视觉状态。**

我倾向 **D**。

<sub>原文台账 G84（消息 684）</sub>

#### G85 · Badge / Chip / Tag 应该怎么定义？

**D · Semantic Tagging System**

> **Badge / Chip / Tag 是一套 Semantic Tagging System，但三个词不代表三个独立皮肤。**

它们共享：

**Typography Role**  
**Geometry Language**  
**Spacing / Density**  
**Semantic Color**  
**Interaction Grammar**

然后依据语义分化：

**Badge**
→ 紧凑、辅助性强，主要用于**状态 / 数量 / 属性提示**。

**Tag**
→ 表示一个具有稳定语义的**分类 / 属性标签**。

**Chip**
→ 更偏**可交互或可移除的选择对象**。

所以：

`FLAC` → Badge / Tag 语义  
`Jazz` → Tag  
`Selected Filter` → Interactive Chip  
`3` → Badge

而不是：

> “它们都是一个圆角小胶囊，只是颜色不同。”

同时继续继承 G5：

> **它们的 Curvature 应该属于 Nebula 的 Geometry Family，不允许默认无限向 Pill 演化。**

尤其当内容很短时，也不能为了“精致”自动把左右 padding 拉得巨大。

而且 Chip 如果可以交互：

> **Chip 是对象，不是 Button 的迷你版。**

它可以拥有自己的 Selection / Remove / Focus 语义。

最终原则：

> **短小不等于装饰；标签必须有语义身份。**

**G85 = 我倾向 D。**

<sub>原文台账 G85（消息 687）</sub>

#### G86 · Progress / Progress Indicator 应该是什么？

**D · Semantic Progress System**

> **Progress 首先是量化状态的语义通道；视觉形式根据任务 Context 决定，但“完成程度”必须始终可读。**

系统可以使用：

**Track / Fill**  
**Indicator**  
**Typography**  
**Icon**  
**Material response**

中的一个或多个，但要根据：

**Precision Need**  
**Task Duration**  
**Current Focus**  
**Space Available**  
**Indeterminate / Determinate**

决定。

例如：

**短暂、无需精确知道百分比**
→ 极简 Activity Indicator 就够。

**下载 / 导入**
→ Determinate Progress，需要明确显示进度。

**音频缓冲**
→ 可以使用非常轻的局部 Progress，不应该把整个播放器搞得像下载管理器。

**长时间任务**
→ 可以有百分比 / 已完成量等辅助信息。

如果是：

> **Indeterminate**

就不能假装自己知道百分比。

而且 Motion 继续服从 G70–G72：

> Progress 可以动态，但不能靠不停闪烁制造“它在工作”的错觉。

核心原则：

> **Progress 让“进行到哪里”可理解，而不是让“正在进行”变得更喧闹。**

这和 G25 的 Loading 恰好形成一对：

**Loading → State exists, completion unknown**  
**Progress → State exists, completion measurable**

**G86 我倾向 D。**

<sub>原文台账 G86（消息 690）</sub>

#### G87 · Grid / Collection 应该是什么？

**D · Semantic Collection Field**

> **Grid 首先是一种 Collection Field；Card、Artwork Tile、Media Item 只是这个 Field 中不同的成员。**

也就是说：

```text id="collection-field"
Collection Field
│
├─ Collection semantics
├─ Spatial rhythm
├─ Column / row grammar
├─ Density
├─ Ordering
└─ Item interaction
```

然后具体 Item 再决定自己的语义：

**Passive Media Item**  
**Selectable Media Item**  
**Interactive Media Item**  
**Editorial Media Item**

所以一个专辑 Grid Item：

> 不必天然成为一个“Card”。

它可以只是：

**Artwork + Title + Metadata**

通过整个 Grid 的：

**Alignment / Spacing / Density / Typography**

形成结构。

只有当它确实需要独立 Surface Identity 时，才调用 G44 的 **Contextual Content Surface**。

而 Responsive 也不应该简单是：

> 1200px = 5 列
> 900px = 4 列
> 700px = 3 列

而是根据：

**Item Minimum**  
**Content Priority**  
**Density**  
**Available Space**  
**Composition**

决定当前 Collection Field 如何重组。

这也和我们之前的 **Contextual Responsive Field** 完全衔接。

<sub>原文台账 G87（消息 693）</sub>

#### G88 · Collection Item 的尺寸应该怎么决定？

**D · Semantic Collection Geometry**

> **Item 尺寸属于 Collection Geometry，但具体尺寸由 Item Role + Content Density + Available Space + Composition 共同决定。**

例如：

**Album Artwork Item**
→ 可以有比较明确的视觉比例与尺寸范围。

**Artist Item**
→ 可能需要更小的视觉重量。

**Playlist**
→ 如果信息比 Artwork 更重要，允许文字区域获得更多空间。

**Editorial Item**
→ 在特殊 Stage 中可以突破普通 Collection Geometry，但必须拥有明确的 Stage ownership。

同时，不要求所有 Item 永远“等宽等高”。

真正需要稳定的是：

**视觉节奏**  
**边缘对齐**  
**密度关系**  
**主要视觉尺度**

而不是：

> 每一个内容对象都必须塞进 180×240 的格子。

这和 G34 的 Independent Axes 以及 G8 的 Semantic Density 完全一致：

> **Geometry 有系统，内容有自由。**

并且当空间不足时，应该优先调整：

**Column Count → Item Scale → Metadata Density → Layout**

而不是直接把 Item 压缩到失去可读性。

我倾向 **D**。

<sub>原文台账 G88（消息 696）</sub>

#### G89 · Collection 的排序 / 重排应该是什么性质？

**D · Semantic Collection Recomposition**

> **Collection 的排序变化不是单纯的数据变化，而是集合空间关系发生改变。系统根据变化语义决定是否以及如何保持空间连续性。**

例如：

**轻微排序变化**
→ 可以保留 Item 的空间身份，让它们自然迁移到新位置。

**切换完全不同的排序模式**
→ 不必让几十个 Item 排队慢慢跑遍屏幕；可以快速重组到新的 Collection State。

**筛选导致大量 Item 消失**
→ 优先保持剩余 Item 的空间连续性，但不人为给消失内容安排复杂 Exit。

**拖拽自定义排序**
→ 这是用户直接操作空间，因此可以有更明确的实时位置反馈。

同时必须继承 G70–G72：

> **Motion 是为了帮助用户理解“集合怎么变了”，而不是为了展示 Masonry / FLIP / Spring 动画。**

尤其禁止：

> 一次排序，几十张专辑同时弹跳、错位、回弹。

那会立刻把 Nebula 从 Editorial UI 拉成演示动画。

核心原则：

> **Preserve object identity when it helps comprehension; prioritize the latest collection state when it does not.**

这和之前我们在 Focus、Motion、Composition 里定下的思想是一脉相承的。

**G89，我倾向 D。**

<sub>原文台账 G89（消息 699）</sub>


## N · 滚动与响应式

滚动是持续的空间行为；响应式是「重排」，不是「缩放」。

**Agent 硬约束**

- 断点按内容与结构决定，不按设备型号。
- 重排有保护优先级：先保语义与可读性，再保几何关系。
- 允许非对称变化，但不允许两个轴各自为政。

#### G90 · Scroll 应该是什么？

**D · Semantic Scroll System**

> **Scroll 首先是空间导航能力，而不是一个视觉组件。Scrollbar / Scroll Affordance 只是它的辅助表达。**

Global System 统一的是：

**Scroll Behavior**  
**Scroll Ownership**  
**Overscroll Philosophy**  
**Scroll Affordance**  
**Keyboard / Wheel / Touchpad Interaction**  
**Focus Interaction**

而不是强行规定一个漂亮的 Scrollbar。

例如：

**普通页面**

→ Scrollbar 可以非常安静，甚至只有交互时短暂出现。

**高密度列表**

→ 可以提供更明确的 Scroll Affordance，让用户知道当前位置。

**横向 Collection**

→ 必要时通过 edge fade / clipping / partial next item 等方式提示“这里可以继续”。

**Keyboard Navigation**

→ Focus 自动迁移时，Scroll 应该让目标进入可见区域，但不要为了追踪 Focus 制造剧烈跳动。

**快速滚动**

→ 优先保证内容跟手和位置可预测，不播放多余的 decorative motion。

**Nested Scroll**

→ 必须明确哪个 Scroll Container 当前拥有 Scroll Ownership，避免滚轮事件到处传播。

而 Scrollbar 本身：

> **可以是 Nebula Material System 的一部分，但不应该抢过内容。**

尤其我不希望出现：

> 细长发光 Scrollbar 常驻在页面边缘。

它应该更像一个**空间导航提示**，而不是装饰条。

还有一条很重要：

> **Scrollbar 消失 ≠ Scroll 能力消失。**

<sub>原文台账 G90（消息 702）</sub>

#### G91 · Responsive System 应该以什么作为断点依据？

**D · Semantic Responsive Thresholds**

> **Nebula 不建立一套以设备尺寸为中心的“断点表”，而是建立以“空间还能否维持当前语义关系”为核心的 Responsive Threshold。**

也就是说，系统真正判断的是：

> **当前 Composition 还能不能成立？**

例如：

**Navigation + Main Content**

只要还能维持合理的：

**Minimum Width + Content Measure + Interaction Space**

就保持当前布局。

当再压缩会导致：

> Navigation 失去可用性
> Content 开始拥挤
> Control Group 断裂
> Typography hierarchy 被破坏
> Negative Space 消失

这时候才触发下一阶段：

**Compression**

再不行：

**Migration / Recomposition**

再不行：

**Minimum Constraint**

所以不是：

> “到了 1024px，Sidebar 必须缩成这样。”

而是：

> **“当前空间已经无法继续维持这个 Semantic Layout，所以系统需要改变结构。”**

当然，工程上最后依然会有具体 breakpoint / media query。

但那些应该是：

> **Semantic Threshold 的 implementation encoding**

而不是设计本身。

这会直接继承我们之前已经确定的 **Contextual Responsive Field**，同时也能避免 Agent 未来因为“常见 breakpoint 就是 768 / 1024 / 1280”而机械套模板。

核心原则可以直接写进最终规范：

> **Breakpoints are implementation thresholds for semantic constraints, not arbitrary device categories.**

<sub>原文台账 G91（消息 705）</sub>

#### G92 · Responsive Recomposition 时，什么应该优先被保护？

**D · Semantic Preservation Hierarchy**

> **Responsive Recomposition 不保护某一个固定元素，而是保护“语义关系”的优先级。**

系统首先保护：

**1. Core User Task**  
→ 用户此刻最需要完成什么？

**2. Interaction Integrity**  
→ 操作路径、Hit Area、Focus、反馈不能被破坏。

**3. Primary Content Comprehension**  
→ 核心内容必须仍然可读、可理解。

**4. Spatial Orientation**  
→ Navigation / Page identity / 当前空间关系不能丢。

**5. Compositional Character**  
→ Editorial spacing、Negative Space、Artwork balance 尽量保留。

**6. Secondary Content / Decorative Expression**  
→ 最先压缩、迁移、隐藏。

所以假设窗口越来越窄：

不是简单：

> “大家一起缩小。”

<sub>原文台账 G92（消息 708）</sub>

#### G93 · Responsive Recomposition 的“改变方式”是否也应该分级？

**D · Progressive Recomposition**

> **Responsive 不是一次性的“切换布局”，而是一套逐级 Recomposition 策略。**

空间压力增加时依次考虑：

```text id="1cpq9s"
Current Composition
        ↓
1. Local Compression
        ↓
2. Reflow
        ↓
3. Content Migration
        ↓
4. Priority Reduction
        ↓
5. Structural Recomposition
        ↓
6. Minimum Constraint
```

也就是说：

**先在局部解决问题。**

例如缩短间距、压缩低优先级 metadata。

如果仍然不够：

> **改变排列方式。**

再不够：

> **把次级信息移动到 Sheet / Popover / Secondary Space。**

再不够：

> **降低次级内容存在感。**

最后才：

> **改变整个 Stage 的结构。**

这比传统 breakpoint 思维强很多，因为它允许 Nebula 在不同尺寸之间拥有**连续的设计状态**，而不是突然从“Desktop UI”跳成另一套“Mobile UI”。

同时必须继承 G92：

> **Recomposition 首先保护语义，再保护表现。**

以及之前已经确定的：

> **Composition Continuity**

所以即便发生很大的结构变化，用户也应该能感觉：

> **“这是同一个 Nebula，只是空间紧了，它重新组织了一下。”**

而不是：

> **“怎么突然换了一套界面？”**

我倾向 **D**。

<sub>原文台账 G93（消息 711）</sub>

#### G94 · Responsive Recomposition 要不要允许“非对称变化”？

**D · Semantic Elasticity Field**

> **Responsive 空间不是一个统一缩放场，而是一组具有不同 Elasticity 的 Semantic Regions。**

也就是说，每个区域都有自己的：

**Stability**  
**Elasticity**  
**Minimum Constraint**  
**Migration Permission**

<sub>原文台账 G94（消息 714）</sub>

#### G95 · Layout Region 应该拥有自己的“语义身份”吗？

**D · Semantic Spatial Region System**

> **Layout Region 本身就是 Global Spatial System 的语义对象。**

它不只是一个“盒子”，而是拥有：

**Semantic Role**  
**Priority**  
**Elasticity**  
**Minimum Constraint**  
**Migration Permission**  
**Attention Affinity**  
**Spatial Relationship**

<sub>原文台账 G95（消息 717）</sub>


## O · 环境

Environment 是 Nebula 的最低层视觉空间，也是「活」的来源。

**Agent 硬约束**

- 它可以改变空气（冷暖、光场、深度），不可以改变语义、抢焦点、推动 layout、让文字可读性波动。
- 所有来源只能提 Influence，由编排器合成；性能不足时先牺牲装饰，最后才牺牲能力。

#### G96 · Background / Environment 应该是什么性质？

**D · Living Environment System**

> **Environment 是 Nebula 的最低层视觉空间，不只是 Background Image。**

它拥有自己的：

**Base Field**  
**Light Field**  
**Atmospheric Color**  
**Optical Temperature**  
**Subtle Spatial Motion**

并且可以受到：

**Artwork**  
**Music**  
**Stage**  
**User Context**

影响。

但它有非常严格的边界：

> **Environment 可以“活”，但不能成为内容。**

也就是说，它可以：

**改变空气**  
**改变冷暖**  
**改变局部光场**  
**产生极轻的深度 / 流动**

但不能：

**抢 Focus**  
**推动 Layout**  
**制造强烈动画**  
**让文字可读性波动**  
**改变 Semantic Color**  
**因为某张封面而突然换成一个完整 Theme**

<sub>原文台账 G96（消息 720）</sub>

#### G97 · Environment 的动态影响应该由谁拥有？

**D · Semantic Environment Orchestration**

> **Environment 不接受“谁想改就改”的直接写入，而是通过统一的 Semantic Environment Orchestration 进行合成。**

各输入只能提出：

> **Influence**

而不是：

> **Command**

<sub>原文台账 G97（消息 723）</sub>

#### G98 · Environment Influence 应该怎样互相叠加？

**D · Semantic Influence Arbitration**

> **Environment Influence 不是简单叠加，而是先按“影响什么、为什么影响、持续多久、应该有多大”进行仲裁，再形成最终 Environment State。**

可以理解成：

```text id="env-arbitration"
Source
  ↓
Influence
  ↓
Channel / Semantic Intent
  ↓
Priority + Persistence + Confidence + Budget
  ↓
Arbitration
  ↓
Final Environment State
```

例如：

**Artwork**
→ 主要影响 Atmospheric Color / Temperature

**Music**
→ 更适合影响 Light Character / Ambient Motion

**Stage**
→ 决定当前允许的 Environment Expression Ceiling

**Interaction**
→ 只获得短暂、局部、低持续性的 Influence

这样即使多个来源同时存在：

> 它们也不是在“争夺背景”，而是在不同维度上协作。

如果两个来源确实竞争同一个 Channel：

**Stage Authority / Context**  
→ 先决定允许范围

再由：

**Source Priority + Persistence + Confidence**

决定最终结果。

同时仍有一个总闸门：

> **Environment Influence 不能突破 Global Expression Ceiling。**

所以哪怕某一首音乐特别激烈，它也没有资格把整个 Nebula 变成动态霓虹舞台。

我倾向 **D**。

<sub>原文台账 G98（消息 726）</sub>

#### G99 · Environment Influence 要不要有“记忆”？

**D · Contextual Environmental Memory**

> **Environment 不仅响应当前 Influence，也保留有限的“环境惯性”，使空间变化具有连续性。**

也就是说：

```text id="env-memory"
Current Influence
      +
Recent Environmental State
      ↓
Contextual Memory
      ↓
Arbitration
      ↓
New Environment State
```

例如：

**Artwork 切换**

不是：

> A 的红色 → B 的蓝色瞬间切换。

而是：

> 原有环境逐渐让位给新的环境特征。

---

**Music Influence**

如果音乐短暂进入一个高能段落：

> Environment 可以响应。

音乐马上回落：

> 不一定一帧之内恢复原状。

它可以有一个非常轻的：

> **Temporal Hysteresis**

让空间感觉“记得刚才发生了什么”。

---

**Interaction Influence**

则完全不同：

> Hover / Focus 的环境影响应该几乎没有长记忆。

用户移开后：

> 快速回归。

所以不同 Source 的 Memory 可以不同：

**Artwork**
→ 高 Persistence

**Music**
→ 中等 / 音乐语义决定

**Stage**
→ 高 Persistence

**Interaction**
→ 极低 Persistence

这又能和我们以前的 **Hysteretic Restoration** 形成统一语言。

而且这里有一个我认为特别重要的边界：

> **Environmental Memory should preserve continuity, not accumulate history.**

也就是说，Environment 可以有**惯性**，但不能越积越多。

它不会：

> 今天用了红色 → 明天叠一点蓝色 → 后天再叠一点紫色。

<sub>原文台账 G99（消息 729）</sub>

#### G100 · Global Environment 的性能边界

**D · Semantic Performance Governance**

> **性能不是单独的一层“优化规则”，而是 Environment Expression System 的组成部分。**

也就是说，每个 Environment Capability 都应该有自己的：

**Visual Value**  
**Computational Cost**  
**Priority**  
**Fallback**

<sub>原文台账 G100（消息 732）</sub>


## P · 媒体

音乐产品里 Artwork 是内容主角之一，它在 Global UI 里有身份、有框定规则。

**Agent 硬约束**

- Crop / Framing 由语义与容器决定，不由图片本身决定。
- 加载与失败都要有体面表现，不留破图、不留空白跳动。

#### G101 · Media / Artwork 在 Global UI 里是什么身份？

**D · Semantic Media Surface System**

> **Artwork 不是“放进去的一张图片”，而是一个拥有 Semantic Media Role 的视觉内容对象。**

也就是说，系统先判断：

**它是什么？**

例如：

**Album Artwork**
→ Identity / Cover

**Artist Image**
→ Person / Subject

**Playlist Artwork**
→ Collection Identity

**Thumbnail**
→ Secondary Content Preview

**Background Artwork**
→ Environmental Source

然后再决定：

**Aspect Ratio**  
**Crop Strategy**  
**Object Position**  
**Radius Family**  
**Surface Relationship**  
**Overlay / Legibility Treatment**  
**Interaction Capability**

所以一张 Album Cover：

> 可以拥有比较强的视觉完整性。

但一个很小的 List Thumbnail：

> 不需要为了“统一”套一圈厚玻璃和复杂 Overlay。

而且我想把一条边界提前锁进去：

> **Media Treatment 不应该改变 Artwork 本身的视觉人格。**

Nebula 可以进行：

**Crop**  
**Mask**  
**Surface integration**  
**Light adaptation**  
**Legibility overlay**

但不应该随便：

**把封面加一层永久滤镜**  
**过度调色**  
**人为染成品牌色**  
**为了 UI 统一把所有 Artwork 变成同一种风格**

<sub>原文台账 G101（消息 735）</sub>

#### G102 · Media Crop / Framing 应该由谁决定？

**D · Semantic Framing System**

> **Crop 不是图片组件的固定属性，而是 Media Role × Spatial Context 下的 Framing Decision。**

系统先判断：

**当前这张图是身份载体，还是辅助视觉？**

然后决定：

**完整性优先**  
还是  
**填充空间优先**。

例如：

**Album Cover / Identity Media**
→ 通常优先保持完整识别，Crop 必须非常谨慎。

**Large Editorial Artwork**
→ 可以允许更大胆的 Framing，但应保留视觉主体。

**List Thumbnail**
→ 可以为了空间效率进行适度 Crop。

**Background Artwork**
→ 可以有较强 Crop，因为它的职责不是完整展示，而是提供 Environment Source。

**Portrait / Artist Image**
→ 应更重视人物主体与 Focal Point。

而且这里有一条我觉得非常重要：

> **Crop 应该优先保护语义主体，而不是优先填满容器。**

如果能知道：

**Focal Point**

就尽可能围绕主体构图。

如果不知道：

> 系统应该采用保守 Framing，而不是猜一个激进裁切。

这也和我们的整体哲学一致：

**Content 有自己的身份**  
→ **Layout 为 Content 服务**  
→ **Environment 可以围绕 Content 变化**

而不是反过来：

> “为了把 Grid 填满，所以把封面裁成这样。”

**G102，我倾向 D。**

<sub>原文台账 G102（消息 738）</sub>

#### G103 · Media Loading / Image Transition 应该怎么处理？

**D · Contextual Media Arrival**

> **Media Arrival 是 Content 从“不可用 / 不完整”进入“可识别状态”的过程，具体过渡取决于内容角色、加载状态与当前视觉环境。**

例如：

**普通 List Thumbnail**
→ 可以非常接近 Instant Reveal。

**大型 Album Artwork**
→ 可以有很轻的 Arrival，让视觉身份平稳进入。

**背景 / Environmental Artwork**
→ 更适合和 Environment Transition 一起完成，而不是单独弹出来。

**低带宽 / 高频列表加载**
→ 应优先稳定空间，避免大量 Item 同时播放 Arrival。

**重新加载相同内容**
→ 不应该每次重新播放一次“初次出现动画”。

而且：

> **Loading Placeholder 与最终 Media 应保持 Geometry Continuity。**

也就是说，资源没准备好时，空间已经预留好了：

**尺寸不跳**  
**Radius 不跳**  
**Layout 不重排**

真正变化的是：

> **内容完整度，而不是空间结构。**

这会和 G70–G72 的 Motion System 很自然地连接起来：

**Media 有 Arrival Capability**  
→ 但不代表每次都动。

**Motion 有 Temporal Role**  
→ Arrival 通常是 Responsive / Transformative 的轻量表达。

**Expression Budget**
→ 大量图片同时进入时必须受到限制。

核心原则：

> **Media should arrive, not perform.**

我倾向 **D**。

<sub>原文台账 G103（消息 741）</sub>

#### G104 · Media Failure 应该怎么办？

**D · Contextual Media Failure State**

> **Media Failure 不是把图片区域变成“错误页面”，而是让 Media Surface 在保持空间连续性的同时，表达“内容暂时不可用”以及必要的恢复路径。**

例如：

**小型 List Thumbnail**
→ 保留尺寸 / Radius / Alignment，只需要极轻的 Failure Mark。

**Album Artwork**
→ 可以提供安静的 Fallback Surface + Retry。

**关键身份媒体**
→ 如果没有 Artwork 会明显损害识别，应该提供更明确的替代表示。

**Background / Environment Artwork**
→ 不应该让整个 Environment 变成 Error UI；直接退回稳定 Environment State。

**临时网络问题**
→ 如果资源之后可能恢复，不应该永久把错误视觉写死在内容上。

并且继续遵守：

> **Failure 不应该破坏 Collection Geometry。**

不能因为一张图片失败：

**Card 高度变了**  
**Grid 跳了一下**  
**List Row 上下错位**  
**整个 Composition 重排**

同时它应该继承：

**Semantic Error Color**  
**Contextual Error Expression**  
**Semantic Notification System**

而不是重新设计一套“Media Error 红框”。

我尤其想保留一句：

> **When media fails, preserve the space first, then explain the failure.**

这和 G103 正好形成一组：

**Arrival** → 内容进入时保持空间连续  
**Failure** → 内容缺失时同样保持空间连续

这样 Media System 才真正稳定。

<sub>原文台账 G104（消息 744）</sub>


## Q · 分层 / 分隔 / 命中区

Divider、z-index、Hit Area 是三个最容易被随手写坏的系统件。

**Agent 硬约束**

- Divider 只在语义分组需要时出现，不用来画格子。
- Z-index 属于 Layer Governance，组件不得私自抬高。
- Hit Area 不得小于可用性下限；视觉尺寸可以小于命中区。

#### G105 · 全局的 “Divider / Separator” 到底应该是什么？

**D · Semantic Separation System**

> **Divider 是一种 Semantic Separation Channel，而不是一种默认视觉装饰。**

系统先判断：

**两个区域是否真的需要“线性边界”来表达它们的关系？**

如果不需要：

→ 用 **Spacing**

如果仍然不够：

→ 用 **Surface Difference**

如果仍然不够：

→ 用 **Edge / Alignment**

只有当用户确实需要快速识别：

> **“这里存在一个明确的结构分界。”**

才使用 Divider。

而且 Divider 本身也不是只有一种：

**Structural Divider**
→ 真正的区域分界。

**List Separator**
→ 帮助识别相邻集合成员。

**Form Separator**
→ 帮助区分不同 Setting Group。

**Temporal / Data Separator**
→ 比如日期分组、时间段分隔。

这些都共享 Global Edge Language，但不共享完全相同的视觉强度。

<sub>原文台账 G105（消息 747）</sub>

#### G106 · Z-index / Layering 应该怎么治理？

**D · Semantic Layer Governance**

> **Z-axis 不是组件自己的数字，而是 Nebula Spatial Layer 的一种受治理能力。**

首先由：

**Semantic Layer**

决定一个对象在哪个空间层：

```text id="z-axis"
World
  ↓
Base
  ↓
Elevated
  ↓
Floating
  ↓
Overlay
  ↓
Modal / Decision
```

然后系统内部才将这些 Semantic Layers 映射成实现所需的 z-index。

<sub>原文台账 G106（消息 750）</sub>

#### G107 · Hit Area 应该怎么治理？

**D · Semantic Interaction Envelope**

也把 Geometry 三层正式分开了：

> **Visual Geometry**：用户看到多大
> **Interaction Geometry**：用户有多容易操作
> **Semantic Geometry**：它为什么这样组织

这对 Nebula 尤其重要——我们可以继续保持很精致、很克制的视觉控件，同时不牺牲实际操作性。

<sub>原文台账 G107（消息 753）</sub>


## R · 手势 / 拖拽 / 撤销 / 展开

Pointer / Touch / Keyboard 共享一套交互语言，但各自有语义。

**Agent 硬约束**

- 手势一旦 commit，不能被别的系统半路抢走；系统级手势拥有更高 Authority。
- Drag 要有空间占位语言，Drop 要有明确确认；Undo 是能力，不是按钮。
- Disclosure 展开后要保住原位置记忆，不能把下面内容「跳」走。

#### G108 · Touch / Pointer / Keyboard 三种输入方式，应该共享一套 Interaction Language 吗？

**D · Semantic Input Modality System**

> **Nebula 统一的是 Interaction Semantics，而不是输入设备的具体手势或视觉反馈。**

也就是说：

```text
Semantic Intent
      ↓
Input Modality
├─ Pointer
├─ Touch
└─ Keyboard
      ↓
Modality-specific Interaction
      ↓
Shared State / Feedback Grammar
```

<sub>原文台账 G108（消息 756）</sub>

#### G109 · Gesture / Pointer Action 应该如何治理？

**D · Semantic Gesture Arbitration**

> **Gesture 不是组件天然拥有的能力，而是一种需要在当前空间中经过语义仲裁才能获得的 Interaction Capability。**

可以理解成：

```text
User Movement
      ↓
Gesture Candidate
      ↓
Context / Direction / Target
      ↓
Competing Owners
      ↓
Semantic Gesture Arbitration
      ↓
Gesture Ownership
      ↓
Interaction State
```

<sub>原文台账 G109（消息 759）</sub>

#### G110 · Gesture 一旦获得 Ownership，能不能被另一个系统“抢回去”？

**D · Semantic Gesture Commitment**

> **Gesture 在“Intent Recognition”阶段可以重新仲裁；一旦跨过明确的 Commitment Boundary，就获得稳定 Ownership。之后原则上不再被普通组件抢回。**

也就是：

```text id="gesture-commit"
User Movement
      ↓
Candidate
      ↓
Recognition Window
      ↓
Intent Confidence
      ↓
Commitment Boundary
      ↓
Gesture Owner
      ↓
Stable Ownership
```

例如：

**手指刚移动 2px**

→ 什么都还没决定。

继续移动：

**水平位移明显、速度和方向明确**

→ Swipe / Drag 的 Confidence 上升。

达到 Threshold：

> **Commit → Drag owns the gesture**

之后 Page Scroll 就不能突然把它抢回去。

---

但存在极少数更高层的例外：

**系统导航手势**  
**窗口级 Gesture**  
**Accessibility Gesture**

这些拥有更高的 Semantic Authority。

所以：

> **组件之间不能互相抢手势，但系统级语义可以拥有明确的接管权。**

这又与 G106 的 Layer Governance、G62 的 Capability Boundary 完全一致：

> **Authority 不仅决定谁能表达，也决定谁能接管交互。**

而且这里我很想加一个关键原则：

> **Once committed, a gesture should feel physically coherent.**

用户已经开始拖一个东西，就不应该在半路突然变成滚页面；那种“手势归属瞬移”会特别破坏操作的物理直觉。

<sub>原文台账 G110（消息 762）</sub>

#### G111 · Drag / Reorder 是否应该拥有统一的“空间占位”语言？

**D · Semantic Drag Field**

> **Drag 不是“把一个东西拽来拽去”，而是在 Collection / Layout 中临时改变空间所有权；因此核心反馈应该是“未来空间关系”。**

系统同时处理：

**Dragged Object**  
→ 保持身份可见，但降低非必要表达。

**Insertion / Drop Target**  
→ 明确告诉用户对象将在哪里落位。

**Affected Neighbours**  
→ 只在有助于理解时产生最小空间让位。

<sub>原文台账 G111（消息 765）</sub>

#### G112 · Drag 的“跟随对象”应该是什么表现？

**D · Contextual Drag Representation**

> **Dragged Object 的表现由“拖动语义 + 当前空间 + 对象重要性 + Input Modality”决定，而不是统一采用一种 Ghost / Lift。**

例如：

**普通 List Row**

→ 可以保持大部分原貌，只获得轻微 Lift。

**Artwork / Media Item**

→ 可以保留较强的视觉 Identity，但降低环境干扰。

**复杂 Data Object**

→ 可以使用更抽象的 Drag Proxy，避免整个复杂组件被拖起来。

**Touch Drag**

→ 可以让 Proxy 更清楚，因为手指本身会遮挡目标对象。

**Pointer Drag**

→ 可以更轻，因为光标不会遮挡主要内容。

同时有一个很关键的关系：

> **Dragged Representation ≠ Source Representation。**

拖动时不一定要把原组件整个复制一份跟着走。

可以是：

**完整对象**  
**简化 Proxy**  
**Identity Preview**

只要用户始终清楚：

> **“这是我正在移动的那个对象。”**

而原来的空间：

> 可以通过 G111 的 Drop / Insertion logic 告诉用户未来位置。

<sub>原文台账 G112（消息 768）</sub>

#### G113 · Drop / Commit 的确认应该怎么表达？

**D · Contextual Drop Commit**

> **Drop 的最终反馈应该由“空间变化是否需要被确认”决定。**

如果用户刚刚已经非常清楚地看到：

> Item → 新位置

那么：

**Drop 可以几乎无声地完成。**

如果空间关系比较复杂：

> 可以让对象进行非常轻的 Snap / Settle。

如果目标区域发生了比较大的结构变化：

> 可以保留极短的局部 Commit Evidence。

如果 Drop 失败：

> 直接进入 Contextual Error / Recovery，而不是播放一个“失败动画”。

尤其要避免：

**成功 → 大幅弹跳**  
**成功 → 发光庆祝**  
**成功 → 整个 Collection pulse**

因为用户自己已经完成了最重要的动作：

> **把东西放到那里。**

UI 的职责只是：

> **确认这个结果已经成为新的真实状态。**

<sub>原文台账 G113（消息 771）</sub>

#### G114 · Undo / Reversal 应该是什么身份？

**D · Semantic Reversal System**

> **Undo 不是一种固定 UI 组件，而是一种“可逆状态转换”的 Global Capability。**

系统首先判断：

**这个动作是否可逆？**  
**逆操作是什么？**  
**在什么时间窗口内可逆？**  
**逆操作是否会影响其他状态？**  
**用户当前是否需要显式恢复机会？**

然后决定 Undo 的表达方式。

例如：

**删除一首歌曲**
→ 可以提供短暂的可逆窗口。

**拖拽重排**
→ 通常整个 Reorder 本身就是一个可逆状态转换，可以进入 Undo History。

**修改一个设置**
→ 如果修改可以立即再次切换，就未必需要专门的 Undo UI。

**不可逆操作**
→ 就不应该伪造一个 Undo。

**多步骤编辑**
→ 可能需要真正的 Undo Stack，而不是连续弹 10 个 Toast。

<sub>原文台账 G114（消息 774）</sub>

#### G115 · Undo 的时间窗口应该是什么性质？

**D · Semantic Reversal Window**

> **Undo 的可用时间由“错误成本、状态稳定性、操作连续性和恢复复杂度”决定。**

例如：

**误删一个项目**
→ 可以给予短暂、明显的恢复机会。

**连续拖拽排序**
→ 可以把一整个连续操作视为一个 Reversal Unit，而不是每移动一次都生成一个 Undo。

**复杂编辑**
→ 可以进入更持久的 Undo History。

**高风险但仍可逆的操作**
→ 可以拥有更长的恢复窗口。

**状态已经被后续操作强烈依赖**
→ Undo 不应为了“有历史”而强行恢复，系统需要判断是否仍然语义可逆。

这里还要和 G110 的 **Commitment** 对上：

> **Gesture Commitment ≠ Undo Boundary。**

一个 Drag 可以在一次连续操作里完成：

`Grab → Move → Drop`

最终只形成**一个语义状态转换**。

所以：

> **Undo 应以语义操作为单位，而不是以底层事件为单位。**

<sub>原文台账 G115（消息 777）</sub>

#### G116 · Undo 的反馈应该有多强？

**D · Semantic Reversal Confirmation**

> **Undo 的反馈重点不是告诉用户“你点击了 Undo”，而是让用户确认“之前的状态已经回来”。**

所以如果最终状态本身非常明显：

**列表项重新出现**  
**Item 回到原位置**  
**Toggle 恢复**

那么可能根本不需要 Toast。

如果变化比较隐蔽：

> 可以增加非常轻的 Contextual Confirmation。

如果 Undo 影响范围比较大：

> 可以提供更明确的状态摘要或短暂通知。

例如：

**删除歌曲 → Undo**

理想情况可能是：

> 歌曲重新出现在原来的位置。

这本身已经是最好的反馈。

而不是：

> Toast：“撤销成功！”
> 然后 Toast 反而比恢复动作更醒目。

同时继续遵守 G27：

> **让完成可确认，而不是让完成变得更喧闹。**

以及 G114：

> **Undo 恢复的是语义状态，而不是视觉动画。**

所以核心原则：

> **The restored state should confirm the reversal whenever possible.**

这样 Undo 也完全融入我们已经建立的 Global Feedback Grammar。

**G116，我倾向 D。**

<sub>原文台账 G116（消息 780）</sub>

#### G117 · Disclosure / Accordion 应该是什么身份？

**D · Semantic Disclosure System**

> **Disclosure 是一种“信息可见性关系”的 Global Interaction Pattern，而 Accordion 只是多个 Disclosure 组合后的结构。**

也就是说，系统真正定义的是：

**Collapsed**  
→ 内容存在，但当前不占据主要视觉空间。

**Expanded**  
→ 内容进入当前 Spatial Composition。

**Trigger**  
→ 明确拥有展开 / 收起的 Interaction Ownership。

**Revealed Content**  
→ 仍然属于原来的 Semantic Group / Region。

<sub>原文台账 G117（消息 783）</sub>

#### G118 · Disclosure 展开后，原来的内容位置应该怎么保持？

**D · Semantic Spatial Expansion**

> **Disclosure Expansion 是局部 Spatial Recomposition；系统优先保持用户正在关注的内容与原空间关系，再让周围内容自然让位。**

也就是：

```text id="expand-flow"
Disclosure State Change
        ↓
Determine Focus / Visual Anchor
        ↓
Expand Local Region
        ↓
Reflow Affected Neighbours
        ↓
Preserve User Orientation
        ↓
Settle
```

例如用户点击 Section B：

**B 是当前 Focus Anchor**

→ B 可以向下 / 向外展开。

**C / D**

→ 为 B 让位。

如果展开后 B 的内容超出当前 Viewport：

> Scroll 可以根据语义需要轻微调整，让新增内容保持可见。

但不能发生：

> 用户点击一个小 Chevron，整个页面突然跳到另外一个地方。

而如果用户只是快速连续展开多个 Section：

> 系统应该直接追踪最终状态，而不是一个一个播放完整展开动画。

这继续继承：

**G70 Contextual Motion Capability**  
**G71 Semantic Temporal System**  
**G72 Contextual Motion Restraint**  
**G77 Semantic Focus Tracking**  
**G89 Semantic Collection Recomposition**

最终原则就是：

> **Expand the content, not the user's confusion.**

也就是说，空间可以明显变化，但**用户的认知锚点应该尽量稳定**。

**G118 我倾向 D。**

<sub>原文台账 G118（消息 786）</sub>


## S · 浮层生命周期与焦点恢复

所有浮层共享同一套进入 / 退出语言，关闭后必须回到用户来的地方。

**Agent 硬约束**

- Tooltip / Popover / Dropdown / Dialog / Sheet 的进出必须同源。
- 关闭不是「回到页面顶部」，而是回到触发对象。
- 多状态共存时按语义仲裁（G123/G124），不做「谁后出现谁赢」。

#### G119 · Tooltip / Popover / Dropdown / Dialog / Sheet 的“进入与退出”是否应该共享同一套生命周期语言？

**D · Semantic Overlay Lifecycle**

> **所有 Floating / Overlay Surface 共享同一套 Lifecycle Grammar，但具体 Motion 由 Semantic Role、Spatial Relationship 和 Interaction Authority 决定。

<sub>原文台账 G119（消息 789）</sub>

#### G120 · Overlay 的关闭之后，用户应该回到哪里？

**D · Semantic Context Restoration**

> **Overlay 关闭不是简单地消失，而是一次从临时空间向原有语义上下文的交还。**

具体来说：

- **Dropdown**：选择完成后，保留新的选择状态，并将交互控制权交还给 Trigger。
- **Popover**：提交或取消后，按照操作语义处理修改结果，并恢复合理的 Focus。
- **Dialog**：完成决策后，将 Focus 交还给调用它的上下文；如果原 Trigger 已不存在，则寻找合理的后继位置。
- **Sheet**：关闭后尽量保留原页面的 Scroll Position、Selection 和阅读位置。
- **Context Menu**：执行命令后，不应无故改变用户当前的导航位置。

这里要明确区分三个概念：

**State Restoration** — 恢复哪些状态。

**Focus Restoration** — 键盘与辅助技术的操作焦点回到哪里。

**Spatial Restoration** — 视口、滚动位置与阅读锚点如何延续。

三者相关，但不能混为一谈。

例如 Dialog 确认删除后，系统不能机械恢复一个已经被删除的按钮作为 Focus Target；它应该把焦点交给合理的后继对象，同时保留用户原本所在的空间上下文。

最终原则：

> **Close the overlay; preserve the user's place in the world.**

这与 G119 的生命周期正好闭环：

`Trigger → Arrival → Active Interaction → Dismissal → Context Restoration`

**G120，我倾向 D。**

<sub>原文台账 G120（消息 791）</sub>

#### G121 · Keyboard Focus 应该如何在 Nebula 中表达？

**D · Semantic Focus Expression**

> **Focus 是一种独立的交互状态，应该通过全局统一、但与组件语义相适应的视觉语言表达。**

具体来说：

**Keyboard Focus**
- 必须清晰可见。
- 不依赖颜色这一种信号。
- 不能被 Overflow、裁切或相邻 Surface 遮挡。
- 应与 Hover、Selected、Active 保持明确区别。

**Pointer Interaction**
- 不应仅仅因为鼠标点击就无条件出现强烈的键盘式 Focus Ring。
- 但不能因此破坏真实的 Focus 状态或辅助技术行为。

**Touch Interaction**
- 不需要模拟 Hover。
- 但在需要键盘导航或辅助技术操作时，仍然必须提供正确的 Focus 表达。

**Composite Controls**
- 对 List、Menu、Grid 等采用 roving focus 的组件，焦点应该跟随当前活动项。
- 不应让每个子元素都出现互相竞争的焦点环。

这里还有一条重要边界：

> **Focus indicates where interaction can proceed; Selection indicates what the user has chosen.**

例如在 Playlist 中：

- 键盘焦点位于歌曲 A，不代表歌曲 A 已经被选中。
- 歌曲 B 已被选中，也不代表键盘焦点必须停留在 B。

这两个状态必须能够独立存在。

最终原则：

> **Focus must remain unmistakable without becoming visually dominant.**

既不能为了美观而隐藏，也不需要让每一次 Focus 都像警报一样醒目。

**G121，我倾向 D。**

<sub>原文台账 G121（消息 793）</sub>

#### G122 · 当键盘焦点移动时，Nebula 应该如何处理视口？

**D · Semantic Focus Visibility**

**焦点移动应保证目标可见，同时尽可能保留用户原有的空间上下文。**

具体规则：

- 目标已经完整可见：不滚动。
- 目标部分可见：只滚动必要距离，并避开固定头部、底栏等遮挡区域。
- 目标完全不可见：采用最小必要滚动，让目标进入可操作区域。
- 在 List、Grid、Playlist 等复合控件中，遵循组件自身的导航方向与焦点模型。
- 在 Dialog、Sheet 等 Overlay 内，优先处理其内部滚动，不应无故带动背后的页面。
- 如果目标位于新的导航区域，允许进行更大范围的空间调整，但必须保持焦点与滚动结果一致。

同时，程序化焦点移动、用户主动导航和页面初始聚焦应区别处理，不能把所有焦点变化都当成同一种滚动命令。

核心原则：

> **Move the viewport only as much as needed to keep the next interaction visible.**

焦点负责告诉用户“下一步在哪里操作”，视口负责确保用户看得到；两者必须协同，但不能让视口抢走用户的空间控制权。

**G122，我倾向 D。**

<sub>原文台账 G122（消息 795）</sub>

#### G123 · 当 Focus、Hover、Selection 与 Playing 同时存在时，谁应该优先表达？

**D · Semantic State Arbitration**

**状态拥有不同的表达职责，系统应先判断每种状态需要传达什么，再协调它们的视觉表现。**

例如：

| 状态 | 核心职责 |
|---|---|
| Hover | 暗示指针当前指向的目标 |
| Focus | 明确下一步键盘操作的位置 |
| Selection | 表达用户已选中的对象 |
| Playing | 表达当前播放关系 |
| Dragging | 表达正在移动的对象及其空间归属 |

因此，不应该简单规定某个状态永远覆盖另一个状态。

- `Playing + Focus`：播放状态继续存在，焦点仍然清晰。
- `Playing + Selection`：当前播放与用户选择可以是不同歌曲。
- `Hover + Focus`：两者同时存在时，不能让 Hover 淹没键盘焦点。
- `Dragging + Selection`：拖动过程中保留必要的对象身份与选择语义。
- `Dragging + Hover`：目标区域的 Drop Feedback 应与被拖动对象的反馈区分开。

实现层面可以使用统一的状态仲裁机制，但不应该把所有组合都硬编码成独立的视觉样式。优先采用稳定的语义通道：例如边框表达 Focus、背景表达 Selection、播放标记表达 Playing，再根据具体组件调整。

核心原则：

> **States may coexist; their meanings must not compete.**

**G123，我倾向 D。**

<sub>原文台账 G123（消息 797）</sub>

#### G124 · 当状态发生冲突时，Nebula 应如何确定视觉表达？

**D · Semantic State Resolution**

**状态先声明表达意图，再由统一的解析规则决定最终视觉结果。**

这里要区分三个层次：

1. **Semantic State**：对象目前处于什么状态。
2. **Expression Intent**：该状态需要传达什么信息，以及哪些信息不可丢失。
3. **Resolved Appearance**：最终使用哪些视觉属性来表达这些信息。

例如，歌曲条目同时处于 `Playing + Selection + Focus` 时：

- Playing 的播放标记不能消失。
- Selection 仍然需要可辨识。
- Focus 仍然需要满足键盘可见性要求。
- 如果三者都争夺背景色，解析器不必让三种颜色叠加，而可以把其中一部分信息转移到图标、边框或其他稳定通道。

这不是给所有状态排一个全局名次，而是规定：

- 哪些语义必须保留。
- 哪些视觉属性可以共享或让步。
- 哪些表达必须满足无障碍约束。
- 当某种表达方式不可用时，如何寻找替代通道。

组件可以提供局部表达策略，但不应自行重新定义全局状态语义。

核心原则：

> **Resolve visual conflicts without erasing semantic meaning.**

这也意味着，CSS 只是最终表达的实现手段，不应成为语义决策的来源。

**G124，我倾向 D。**

<sub>原文台账 G124（消息 799）</sub>


## T · 动效治理与身份连续性

动效的收尾治理：降级、中断、并发、时间、缓动、方向、连续性、身份、发光。

**Agent 硬约束**

- 降级不等于消失：减动效后仍要保留语义线索。
- 中断后状态必须一致；多动画并发要协调，不能各跑各的。
- 空间连续性服务于意义（G131）；身份连续性优先于形状连续性（G132）。
- 发光是能力不是样式：权限 / 语义事件 / 预算，三问缺一即越权（G133）。

#### G125 · 当用户主动降低动态效果时，Nebula 应如何重新表达交互语义？

**D · Semantic Motion Reinterpretation**

**减少动态效果时，重新设计信息表达方式，而不是简单地按比例缩短或删除动画。**

例如：

- **Overlay**：减少位移，仍然明确其出现、存在与关闭关系。
- **Drag and Drop**：降低跟随动画，仍然清楚表达拖动对象和目标位置。
- **State Transition**：用清晰的最终状态或轻量过渡替代复杂的连续运动。
- **Focus Movement**：避免焦点移动触发大幅视口动画，同时保证目标可见。
- **Loading**：减少持续运动，但保留任务正在进行的状态信息。
- **Playing State**：避免必须依靠持续跳动、脉冲或波形动画才能识别播放状态。

这里需要区分三种能力：

1. **Motion**：用运动表达变化。
2. **Transition**：表达从一种状态到另一种状态的关系。
3. **Semantic Feedback**：告诉用户发生了什么，以及当前结果是什么。

Motion 可以减少，Transition 可以改写，但 Semantic Feedback 不能随之消失。

此外，系统级减少动态效果偏好与应用内设置应有明确的优先关系，不能因为某个组件单独实现了动画，就绕过用户的整体偏好。

核心原则：

> **Reduce motion, not meaning.**

**G125，我倾向 D。**

<sub>原文台账 G125（消息 801）</sub>

#### G126 · 当动态效果被中断时，Nebula 应如何保证状态一致性？

**D · Semantic Interruption Governance**

**动画可以被中断，但业务状态不能依赖动画是否顺利播放完毕。**

具体规则：

- **业务状态先提交**：动画不是事务提交条件，也不是业务状态的唯一来源。
- **新意图可以取代旧表现**：用户的新操作到来时，系统可以取消、衔接或重新计算动画。
- **取消后收敛到有效状态**：不能停留在半开、半关闭或语义不明的中间状态。
- **生命周期结束即失去修改权**：组件卸载或操作失效后，旧动画回调不能再修改当前状态。
- **Reduced Motion 同样适用**：即使动画被跳过，状态转换与必要的副作用仍必须完整执行。
- **交互操作需要明确提交边界**：例如拖放必须区分“正在拖动”“已提交放置”和“取消拖动”，不能用动画结束来推断提交结果。

这里有一个重要区分：

**Cancel Animation ≠ Cancel Operation。**

取消视觉动画不应自动撤销已经提交的业务操作；同样，取消尚未提交的操作，也不能只靠停止动画来完成。

核心原则：

> **Animation may be interrupted; semantic state must converge.**

**G126，我倾向 D。**

<sub>原文台账 G126（消息 803）</sub>

#### G127 · 当多个动画同时发生时，Nebula 应如何协调它们？

**D · Semantic Motion Coordination**

**动画不是一组独立效果，而是同一个交互过程中的协同表达。**

具体来说：

- **Causally Related Motion**：属于同一操作链的动画应协调表达，例如拖放、目标接收与最终状态确认。
- **Spatially Related Motion**：同一区域内的元素移动应共享一致的空间逻辑，避免各自朝不同方向运动。
- **Attention-sensitive Motion**：键盘焦点、关键状态变化与主要操作反馈不能被装饰性动画淹没。
- **Independent Ambient Motion**：背景动态、波形等持续效果应主动让出注意力，必要时暂停或降低强度。
- **Interrupted Motion**：某个动画被取消后，相关动画应重新评估，而不是继续播放一段已经失去因果意义的后续效果。

这里不是要建立一个全局动画队列，也不是让所有动画共享相同的持续时间。

而是要求系统先判断动画之间的**因果关系、空间关系和注意力关系**，再决定它们应该同步、衔接、并行还是让步。

例如，用户把歌曲拖到新的播放列表位置时，目标位置反馈、歌曲移动和最终顺序确认属于同一个过程；而背景封面缓慢缩放、音频波形持续跳动，则不应争夺这一刻的视觉注意力。

核心原则：

> **Coordinate motion by meaning, not merely by timing.**

**G127，我倾向 D。**

<sub>原文台账 G127（消息 805）</sub>

#### G128 · Nebula 应如何定义动画的时间与节奏？

**D · Semantic Temporal Grammar**

**时间、缓动与延迟应共同表达交互的语义，而不是仅仅套用一组时间常量。**

具体来说：

- **响应反馈**：用户操作后，应尽快获得明确反馈，不让动画阻塞操作。
- **空间建立**：需要解释位置、层级或容器变化时，允许适度的连续运动。
- **状态确认**：成功、选中、播放等状态应以清晰的最终状态为主，不依赖冗长动画。
- **连续操作**：重复导航、连续点击和快速切换应保持响应，不必每次都完整播放前一个动作。
- **环境动态**：背景动画应采用低干扰节奏，不与主要交互争夺注意力。
- **距离与复杂度**：移动距离可以影响时间，但不能单独决定时间。

时间 Token 仍然有价值，但它们是实现层的基础尺度，而不是设计决策本身。组件应先确定动作类型和响应要求，再选择合适的时间与曲线。

核心原则：

> **Timing should explain the interaction, never delay it.**

**G128，我倾向 D。**

<sub>原文台账 G128（消息 807）</sub>

#### G129 · Nebula 应如何统一定义动画的缓动曲线？

**D · Semantic Easing Grammar**

**缓动曲线应表达动作的性质，并与动作的时间、方向和结束状态共同设计。**

例如：

- **Enter**：元素进入当前空间，应自然建立存在感，而不是突然抢占注意力。
- **Exit**：元素离开当前空间，应及时释放位置，不拖延后续操作。
- **Spatial Reposition**：列表重排、布局变化等动作应保持空间连续性。
- **Direct Manipulation**：拖动中的对象应紧跟用户输入，不应因为缓动而产生明显滞后。
- **State Confirmation**：成功、选中、播放等状态不需要依赖夸张的回弹才能成立。
- **Ambient Motion**：背景动态可以平缓，但不能因此让主要操作显得迟钝。

全局 Easing Tokens 依然重要，但它们应该由这些语义类别归纳而来，而不是先有一组曲线，再强行把所有组件塞进去。

同样，弹簧模型只是可选的实现方式，不应被视为更高级或更真实的默认选择。对于需要即时响应、稳定布局或减少动态效果的场景，简单的插值和状态切换可能更合适。

核心原则：

> **Easing should express the nature of a change, not decorate it.**

**G129，我倾向 D。**

<sub>原文台账 G129（消息 809）</sub>

#### G130 · Nebula 应如何处理动画的空间方向？

**D · Semantic Spatial Direction**

**运动方向应由空间关系、交互意图与组件语义共同决定。**

具体规则：

- **Overlay**：方向应解释其与触发对象、所在容器及可用空间的关系。
- **Disclosure**：展开方向应对应内容实际占据的空间，而不是制造一个无关的位移效果。
- **Reordering**：元素应沿着布局真实变化的路径移动，不产生无意义的空间漂移。
- **Navigation**：前进、返回等方向性表达应保持一致，但不能仅凭动画方向判断导航语义。
- **Direct Manipulation**：对象运动应服从用户输入，不应被系统预设方向覆盖。
- **Constrained Space**：当空间不足时，可以重新选择运动方式，甚至不使用方向性运动，而不能为了维持形式强行溢出或遮挡。

这里的关键是：方向不是装饰性的统一规范，而是一种空间解释工具。相同组件在不同空间条件下可以使用不同方向，但变化必须有可理解的原因。

核心原则：

> **Motion should follow spatial meaning, not a fixed compass.**

**G130，我倾向 D。**

<sub>原文台账 G130（消息 813）</sub>

#### G131 · 当界面布局发生变化时，Nebula 应如何保持空间连续性？

**D · Semantic Spatial Continuity**

**只有当变化前后的空间关系具有语义价值时，才需要保留连续性；运动方式必须服从最终布局与用户意图。**

具体规则：

- **Repositioning**：同一对象只是改变位置时，可以保留空间连续性。
- **Resizing**：尺寸变化应解释布局适应，而不是无条件放大或缩小。
- **Reparenting**：对象更换容器时，应表达归属变化，而不只是让它飞向新位置。
- **Responsive Reflow**：布局从网格变为列表等结构变化时，优先保证新布局可理解，不强行维持旧几何关系。
- **Large-scale Updates**：大规模数据刷新或视图切换时，可以采用局部运动、轻量过渡或直接切换。
- **Reduced Motion**：空间连续性可以通过稳定锚点、明确的最终状态和其他非运动线索表达。

FLIP 等技术可以作为实现工具，但不能反过来决定设计：**技术能够插值，不代表每次变化都应该动画化。**

核心原则：

> **Preserve spatial continuity when it preserves meaning.**

**G131，我倾向 D。**

<sub>原文台账 G131（消息 816）</sub>

#### G132 · 当一个对象变成另一种界面形态时，Nebula 应如何保持身份连续性？

**D · Semantic Identity Continuity**

G131 解决了对象在空间中如何移动，但还有一个更微妙的问题：

**当对象不只是移动，而是从一种界面形态转变为另一种形态时，用户如何理解它们仍然是同一个对象？**

例如，在 Nebula 的音乐场景中：

- 用户点击一张专辑封面，它从媒体网格进入专辑详情。
- 一首歌曲从 Playlist 中的小型条目进入播放队列中的详细呈现。
- 一个紧凑播放控件展开为完整播放器。
- 一个列表项目被打开，成为具有更多信息和操作的详情视图。

这些变化可能涉及尺寸、排版、容器、内容密度和操作方式的全面改变。

如果简单地把新界面从原界面的位置动画移动过去，可能会让不同的对象看起来被错误地连接起来；反过来，如果完全直接替换，又可能丢失有价值的身份联系。

### A · Geometry-based Continuity

主要依据位置和尺寸相近程度建立连续性。

实现直观，但相邻对象容易被错误地关联；同一个对象发生大幅变形时，也可能失去连续感。

### B · Component-based Continuity

只有相同组件之间才保留连续性。

工程规则清晰，但会把视觉身份绑定到实现结构中，难以覆盖不同形态之间的转化。

### C · Shared-element Transitions

通过共享封面、标题或其他视觉元素连接变化前后的界面。

表现直接，但如果没有明确的身份映射，仍然可能让用户误以为不同对象之间存在联系。

### D · Semantic Identity Continuity

我倾向 D：**连续性首先取决于对象身份与语义关系，再决定哪些视觉元素值得延续。**

具体规则：

- **Stable Identity**：只有确认变化前后的对象具有真实身份关系时，才建立连续性。
- **Shared Representation**：封面、标题、缩略图等可以在不同界面形态之间延续，但必须对应同一个对象或明确的语义关系。
- **Structural Transformation**：对象可以从紧凑形态转化为完整形态，不要求所有几何属性都连续。
- **Identity Preservation**：即使不播放动画，用户也应能理解当前界面展示的是哪个对象。
- **Ambiguous Mapping**：多个对象同时变化、无法建立可靠对应关系时，宁可直接切换，也不制造错误的视觉联系。
- **Interaction Continuity**：形态改变后，用户对该对象的操作意图应尽可能得到延续；但原有操作不能在新界面中被不加判断地继承。

这里需要明确区分三个概念：

1. **Spatial Continuity**：对象在空间中如何变化。
2. **Identity Continuity**：变化前后是否仍然是同一个对象。
3. **Interaction Continuity**：用户对对象的操作意图能否延续。

三者可以同时成立，但不能互相替代。

例如，专辑封面展开为详情页时，封面可能保持身份连续性，布局同时发生空间重组；而原本位于封面上的点击操作，也不应该因此自动转化为详情页中的某个其他操作。

Shared-element transition 可以实现这种连续性，但不能成为身份判断的依据。

核心原则：

> **Preserve the identity of the object, not necessarily the shape of its interface.**

**G132，我倾向 D。**

<sub>原文台账 G132（消息 816）</sub>

#### G133 · 在 Nebula 里，谁有「发光」的权力？

**D · Semantic Emission Authority**

发光是一种受治理的能力（capability），不是样式属性。

- **Who**：只有被 Global 授予 Emission Capability 的语义角色可以发光；装饰性 Surface 默认 0 发光权。
- **When**：必须由语义事件触发（播放中 / 焦点证据 / 交互确认 / 环境影响 / 错误），禁止为好看而常驻发光。
- **How much**：强度 / 面积 / 持续时间受 G68 Expression Budget 约束并有硬上限；同屏 1 primary + 1 ambient。
- **Who owns the light field**：Environment 的 light field 只能由 G97 编排器合成；Player 冻结光效优先。

> 审查三问：这个对象有发光权吗？触发它的是语义事件吗？强度在预算内吗？三问缺一 → 越权。

<sub>原文台账 G133</sub>

---

## 3 · 规范层（D1 数值表 / D2 组件清单 / C1–C10 组件规格）· 🔒 FROZEN

> **2026-10-31 已签字冻结**（你确认「都按你的」）。以下数值与清单即执行标准；要改必须走「修改已冻结决策」流程。
> 组件级落地规格见 §3.3（C1–C10）。

### 3.1 D1 数值表（B1–B16 全量首版）

> 覆盖：几何 2 张（Radius / Spacing）、排版 1 张（Type）、色彩 3 张（Neutral / Semantic / Atmospheric）、光学 4 张（Shadow / Edge / Blur+Alpha / Easing）、运动 1 张（Duration）、层级 1 张（Z-index）、响应 1 张（Breakpoints）、控件 2 张（Control / Icon）、密度 1 张（Density）。


**Radius Family**（依据 G5/G6：离散家族 + ±1px 光学校正）

| Family | 取值 | 用在哪 | 仓库现状分布 |
|---|---|---|---|
| R0 · Micro | 4px | 仅 ≤18px 微元素：Checkbox / Tag / 小标记 | 新增（原表缺此档） |
| R1 · Control | 8px | Button / Input / Segmented / Chip 内层 | 8×18、10×14、9×11 |
| R2 · Row | 12px | List Row / Menu Item / 小卡 | 12×31、11×5、13×5 |
| R3 · Card | 18px | Card / 面板 / 内嵌容器 | 14×20、18×18、16×10 |
| R4 · Overlay | 24px | Dialog / Sheet（Menu / Popover 用 R3 18） | 无统一值，需新建 |
| R∞ · Pill | 999px | Tag / Badge / Avatar / 胶囊 | 999×105 |

> 任何数值必须归族；允许 ±1px 光学校正，不允许 13.7px 这种无法归族的取值。

**Spacing**（依据 G7/G8：语义关系优先）

| Token | 值 | 语义 |
|---|---|---|
| S-0 | 2px | 图标内部视觉修正 |
| S-1 | 4px | 图标↔文字、Badge↔文字 |
| S-2 | 8px | 控件内部 padding、紧邻元素 |
| S-3 | 12px | Row 之间、同组元素 |
| S-4 | 16px | 区块内边距、Card padding |
| S-5 | 24px | 区块之间 |
| S-6 | 32px | 页面级分区 |
| S-7 | 48px | 大留白 / 顶部呼吸 |

> 现状 1/2/3/5/6/7/10/14 全部收敛进 8 档（8×106、10×83、6×63 是最杂的一批）。Density 用整体乘数 0.85 / 1.0 / 1.2，不新增数值。

**Type Scale**（依据 G52/G53）

| Token | 字号 | 行高 | 用途 |
|---|---|---|---|
| T1 · Micro | 10px | 14px | Badge / 极小标注 |
| T2 · Caption | 11px | 15px | metadata / 时间 |
| T3 · Body-S | 12px | 17px | 列表副文本 / 控件文字 |
| T4 · Body | 13px | 19px | 正文默认 |
| T5 · Body-L | 15px | 22px | 表单主文案 |
| T6 · Title-S | 17px | 24px | 区块标题 |
| T7 · Title | 20px | 28px | 页面标题 |
| T8 · Display | 26px | 34px | 空状态 / 引导 |

> 现状 9/9.5/10.5/11.5/12.5 这类半档值并入最近档；Weight 只用 400 / 500 / 600。

**Duration**（依据 G71/G128）

| Token | 时长 | 用途 |
|---|---|---|
| D-1 · Instant | 120ms | 状态切换（hover / press） |
| D-2 · Quick | 160ms | 小元素进出 |
| D-3 · Standard | 200ms | 默认过渡 |
| D-4 · Emphasized | 280ms | 浮层 / 面板进出 |
| D-5 · Spatial | 400ms | 位移 / 尺寸变化 |
| D-6 · Expressive | 600ms | 路由级 / 大范围重排 |

> 现状 180/220/250/300/350/450/500/550 收敛进 6 档（200×44、180×30 为主力）。

**Easing**（依据 G129）

| Token | 曲线 | 用途 |
|---|---|---|
| E-Standard | `cubic-bezier(.2,0,0,1)` | 默认 |
| E-Enter | `cubic-bezier(0,0,.2,1)` | 出现 / 展开 |
| E-Exit | `cubic-bezier(.4,0,1,1)` | 消失 / 收起 |
| E-Spatial | `spring(260, 26)` | 位移 / 回位 |

**Blur / Alpha**（依据 G15/G16）

| 层 | Blur | 用途 |
|---|---|---|
| B1 | 8px | 轻磨砂（控件背后） |
| B2 | 16px | 卡片 / 面板 |
| B3 | 24px | 浮层 / Menu |
| B4 | 32px | Dialog / 全屏遮罩 |

| Alpha | 值 | 用途 |
|---|---|---|
| A1 | .04 | 最轻表面 |
| A2 | .08 | 次级表面 / hover 底 |
| A3 | .12 | 选中底 / 分隔 |
| A4 | .24 | Overlay veil |
| A5 | .48 | 禁用 / 非激活文字 |
| A6 | .72 | 次级文字 |

**Neutral Ramp**（依据 G11：稳定中性的温度；数值经对比度校验）

| Token | 值 | 用途 | 在 N1 上的对比度 |
|---|---|---|---|
| N0 | `#07080E` | 最深底 / 遮罩边缘 | — |
| N1 | `#0A0B15` | 应用底（现有值） | — |
| N2 | `#10121C` | 表面 / Card 底 | — |
| N3 | `#171A26` | 抬升面 / Popover 底 | — |
| N4 | `#1F2330` | 选中底 / 按下底 | — |
| N5 | `#2A2F3E` | 强分隔 / 描边底 | — |
| N6 | `#7C8499` | 弱文字（最小正文） | 5.24 : 1 |
| N7 | `#9AA4C8` | 次文字（现有值） | 7.95 : 1 |
| N8 | `#E6E9F2` | 主文字 | 16.15 : 1 |

> 文字下限：#7C8499 在 N1/N2/N3 上分别为 5.24 / 4.99 / 4.63，全部 ≥ 4.5。比它更暗的颜色只能用于分隔线或禁用态，不得承载正文。

**Semantic Color**（依据 G9/G10/G12；全部在深底上 ≥ 6:1）

| Token | 值 | 用途 | on N1 / on N3 |
|---|---|---|---|
| success | `#34D399` | 成功 / 已保存 | 10.19 / 9.01 |
| warn | `#FFD166` | 警告 / 需要注意 | 13.59 / 12.01 |
| danger | `#FF6B6B` | 错误 / 危险操作 | 7.06 / 6.24 |
| info | `#9DB8CF` | 提示 / 中性信息 | 9.51 / 8.41 |
| accent | `#FF8FA3` | 品牌强调 / 当前项（现有粉） | 9.06 / 8.01 |

> **语义色填充上的文字一律用 N1 深色字**（#0A0B15 on success = 10.19，white on success = 1.92 不合格）。语义色不得用于大面积背景。

**Atmospheric Color（封面取色）**（依据 G9/G96/G97）

| 规则 | 值 |
|---|---|
| 混入对象 | 只混入 N1 应用底，不混入表面 N2+ / 不动文字与语义色 |
| 混入上限 | ≤ 16% alpha |
| 饱和度上限 | ≤ 55%（超出先降饱和再混） |
| 可读性闸门 | 混合后 N8 文字 ≥ 12:1、N6 弱文字 ≥ 4.5:1，否则自动回退 |
| 写入方式 | 只能作为 Influence 交给 Environment 编排器（G97） |

**Shadow / Elevation**（依据 G14：Elevation ≠ Shadow 强度）

| Token | 值 | 用途 | 仓库现状 |
|---|---|---|---|
| S0 | none | Base Surface | none ×18 |
| S1 | `0 1px 2px rgba(0,0,0,.28)` | 轻微浮起（Card hover） | — |
| S2 | `0 4px 12px rgba(0,0,0,.32)` | Menu / Tooltip | 0 10px 30px .35 |
| S3 | `0 12px 32px rgba(0,0,0,.40)` | Popover / Sheet | 0 12px 30px .4 |
| S4 | `0 20px 50px rgba(0,0,0,.48)` | Dialog / Modal | 0 20px 50px .5 ×6 |
| Edge-Light | `inset 0 0 0 1px rgba(255,255,255,.08)` | 表面顶部高光（可选） | existing .18 |

**Edge / Border**（依据 G13；现状 8 种 alpha 全部收敛）

| Token | 值 | 用途 |
|---|---|---|
| E1 | 1px · rgba(255,255,255,.06) | 最轻分隔（同组内） |
| E2 | 1px · rgba(255,255,255,.10) | 标准描边（Card / Input） |
| E3 | 1px · rgba(255,255,255,.16) | 强调描边（浮层边缘 / 现有主力值） |
| E4 | 2px · accent | Focus ring（配合 2px offset，G74） |

**Z-index**（依据 G106：Layer Governance，组件不得私设层级）

| 层 | 值 | 内容 |
|---|---|---|
| Z0 | 0 | 文档流 |
| Z1 | 10 | 抬升元素（Sticky 行内元素） |
| Z2 | 100 | TopBar / 固定导航 |
| Z3 | 1000 | Dropdown / Menu / Popover |
| Z4 | 1100 | Overlay veil |
| Z5 | 1200 | Dialog / Modal |
| Z6 | 1300 | Sheet / Drawer |
| Z7 | 1400 | Toast |
| Z8 | 1500 | Tooltip |
| Z99 | 9999 | 仅调试用，禁止进生产 |

> 现状 1/2/3/5/10/50/60/80/120/400/10000 全部作废，只允许上表取值。

**Breakpoints**（依据 G91：按内容与结构，不按设备）

| Token | 区间 | 布局行为 |
|---|---|---|
| XS | < 700px | 单列；导航收纳为图标栏 |
| S | 700–900px | 单列 + 可选侧栏收起 |
| M | 900–1180px | 双栏；列表密度 standard |
| L | 1180–1440px | 双栏 + 详情面板 |
| XL | > 1440px | 三栏；容器最大宽度 1440（不无限拉伸） |

> 现有断点 1180 / 900 直接沿用，只补齐 700 与 1440。

**Control 尺寸**（依据 G33/G34：高度与宽度分开治理）

| Token | 高度 | 用途 | 最小 Hit Area |
|---|---|---|---|
| C1 | 24px | 紧凑图标按钮（列表行内） | 24×24（桌面可接受，触屏需扩） |
| C2 | 28px | 次级小按钮 / Chip | 32×32 |
| C3 | 32px | 默认控件高度 | 32×32 |
| C4 | 40px | 工具栏主按钮（现有主力） | 40×40 |
| C5 | 48px | 触屏 / 大号操作 | 44×44 起 |

**Icon 尺寸**（依据 G37/G38）

| Token | 尺寸 | stroke | 用途 |
|---|---|---|---|
| I1 | 12px | 1.5 | 内联标记 / Badge |
| I2 | 14px | 1.5 | 列表行内 |
| I3 | 16px | 1.5 | 默认图标（现有主力） |
| I4 | 20px | 1.75 | 工具栏 / 导航 |
| I5 | 24px | 2 | 大按钮 / 空状态 |

**Density**（依据 G8）

| 档位 | 乘数 | 影响范围 |
|---|---|---|
| compact | ×0.85 | Spacing 与 Control 高度 |
| standard | ×1.0 | 默认 |
| comfortable | ×1.15 | Spacing 与 Control 高度 |

> 密度不影响 Type Scale、Radius、Shadow —— 那三者由角色决定，不由密度决定。

### 3.2 D2 组件清单（Shared Component Inventory）

| 组件 | 依据 | 必须实现的状态 |
|---|---|---|
| Button（primary / secondary / ghost / icon） | G32–G34 | Rest / Hover / Press / Focus / Disabled / Loading |
| Input / TextField | G41 | Rest / Hover / Focus / Filled / Error / Disabled |
| Select / Dropdown | G31 | Rest / Open / Focus / Selected / Disabled |
| Toggle / Checkbox / Radio | G43 | Off / On / Mixed / Focus / Disabled |
| Segmented / Tabs | G42 | Rest / Selected / Hover / Focus |
| List Row | G45/G46 | Rest / Hover / Selected / Focus / Playing / Disabled |
| Card | G44 | Rest / Hover / Selected / Focus |
| Chip / Badge / Tag | G85 | Rest / Selected / Removable / Focus |
| Menu / Context Menu | G29/G30 | Rest / Hover / Selected / Focus / Disabled |
| Tooltip | G28 | Rest / Visible |
| Toast | G81 | Enter / Visible / Exit / Actionable |
| Dialog / Modal | G82 | Enter / Visible / Focus-trapped / Exit |
| Sheet / Drawer | G83 | Enter / Visible / Exit |
| Progress | G86 | Determinate / Indeterminate / Complete |
| Empty State | G84 | Empty / Error / Permission-denied |
| Collection / Grid | G87–G89 | Rest / Hover / Selected / Reordering |
| Divider | G105 | — |
| Disclosure / Accordion | G117/G118 | Collapsed / Expanded / Focus |
| Drag Handle | G111/G112 | Idle / Dragging / Drop-target / Committed |

> 清单外的组件不得进入主界面；确需新增走 G60（Taxonomy）/ G66（Promotion）登记后再实现。

### 3.3 C1–C10 组件规格

#### 通用 Token 速查

| 类别 | 可用值 |
|---|---|
| 高度 | C1 24 / C2 28 / **C3 32（默认）** / C4 40（表单/工具栏） / C5 48（触屏） |
| 圆角 | R0 4（仅 ≤18px 微元素）/ R1 8（控件）/ R2 12（行、tooltip）/ R3 18（card、popover、menu）/ R4 24（dialog、sheet）/ R∞ 999 |
| 间距 | S0 2 / S1 4 / S2 8 / S3 12 / S4 16 / S5 24 / S6 32 / S7 48 |
| 字号 | T1 10 / T2 11 / T3 12 / T4 13（正文）/ T5 15 / T6 17 / T7 20 / T8 26 |
| 中性 | N0 #07080E / N1 #0A0B15 / N2 #10121C / N3 #171A26 / N4 #1F2330 / N5 #2A2F3E / N6 #7C8499 / N7 #9AA4C8 / N8 #E6E9F2 |
| 语义 | success #34D399 / warn #FFD166 / danger #FF6B6B / info #9DB8CF / accent #FF8FA3 |
| 白层 | A1 .04 / A2 .08 / A3 .12 / A4 .24（veil）/ A5 .48（禁用）/ A6 .72（次级字） |
| 描边 | E1 .06 / E2 .10 / E3 .16 / E4 2px accent（focus ring，2px offset） |
| 阴影 | S0 none / S1 `0 1px 2px rgba(0,0,0,.28)` / S2 `0 4px 12px .32` / S3 `0 12px 32px .40` / S4 `0 20px 50px .48` |
| 时长 | D-1 120 / D-2 160 / D-3 200 / D-4 280 / D-5 400 / D-6 600 |

**三条全局禁令**（每个组件都适用）：Hover 不做 scale / 不做 glow / 不推动邻居；装饰性表面不发光（G133）；组件不得自设 z-index 或裸数值（G106 / G63）。

---

#### C1 · Button

依据：G32（Action Surface）/ G33–G34（Control Geometry）/ G21–G22（Hover·Press）/ G68（预算）/ G133（发光权）

| 变体 | 底 | 边 | 文字 | 用途 |
|---|---|---|---|---|
| primary | N4 | E3 | N8 · T4/500 | 一屏最多 1 个 |
| secondary | 透明 | E2 | N7 · T4/400 | 常规操作 |
| ghost | 无 | 无 | N7 · T4/400 | 工具条、行内 |
| danger | 透明 | E2 | danger · T4/400 | 破坏性操作 |
| icon | 透明 | 无 | — | 图标按钮，正方 C3 |

**尺寸**：高度 C3 32（默认）/ C4 40（表单主按钮、工具栏）/ C2 28（密集列表内）；横向 padding S3 12（primary/secondary）或 S4 16（大按钮）；图标↔文字 S1 4；圆角 R1 8。
**图标按钮**：正方 C3×C3，图标 I3 16 / stroke 1.5，圆角 R1 8；触屏场景升到 C5 48 + 图标 I5 24。

**状态**

| 状态 | 表现 | Token |
|---|---|---|
| Rest | 上表 | — |
| Hover | 底升 1 档（primary N4→N5，secondary/ghost 加 A2），文字转 N8；**无阴影、无 scale** | D-1 120 |
| Press | 底保持 N5 + `scale(.98)` + 边不变 | D-1 120 / E-Spatial |
| Focus | E4 环，2px 偏移 | — |
| Loading | 宽度锁定（禁止 layout shift），文字替换为 12px 环形；保留原宽高 | — |
| Disabled | 底 N2、边 E1、文字 N6；pointer-events: none | — |

**反例**：hover 加 glow / 加阴影飘起来 / 放大 1.05 / 点击时整块下沉 4px。

---

#### C2 · Input / TextField

依据：G41（Input Surface）/ G26（Error）/ G74（Focus）

- **几何**：高 C4 40；圆角 R1 8；横向 padding S3 12；文字 T4，占位 N6，输入 N8。
- **材质**：底 N2，静态边 E2；**没有内阴影、没有描边盒子套描边盒子**（G41：Input 是 Surface，不是边框）。
- **状态**：hover 边 E3；focus 底升到 N3 + E4 环（不是发光）；error 边 danger + 下方 T2 danger 说明（间距 S1 4）；disabled 底 N2@50%（A5 叠加）+ 文字 N6；filled 与 rest 同材质，只变文字色。
- **多行**：min-height C5 48，padding S3，行高 T4 的 19px。
- **反例**：focus 时放大、抖动、外发光；error 只用红色描边不给说明文字。

---

#### C3 · Select / Dropdown / Menu

依据：G29–G31（浮层与锚定）/ G106（层级）/ G119（生命周期）

- **触发器**：与 C2 同材质同高度（C4 40），右侧 chevron I2 14，间距 S1 4；打开时边转 E3、chevron 旋转 180°（D-1 120）。
- **浮层**：底 N3、圆角 R3 18、阴影 S3、padding S1 4；宽度 ≥ 触发器宽度，最大 320；z-index Z3 1000。
- **条目**：高 C3 32，横向 padding S3 12，圆角 R2 12（内缩 4px），文字 T4；hover A2；selected A3 + 左侧 2px accent；disabled 文字 N6。
- **分组**：组标题 T2 11 / N6，上间距 S2 8，不可点击；组间分隔用 E1（不用大留白）。
- **行为**：点击外部 / Esc 关闭；关闭后焦点回到触发器（G120）；菜单打开时**不做发光、不做缩放弹出**，只做 D-2 160 的透明度 + 2px 位移。
- **反例**：菜单带投影大光圈；条目 hover 时整行放大；关闭后焦点掉回 body。

---

#### C4 · Checkbox / Radio / Toggle / Segmented

依据：G43（Binary Control）/ G107（Hit Area）/ G35（Control Group）

| 控件 | 几何 | 材质与状态 |
|---|---|---|
| Checkbox | 18×18 · R0 4 · 边 E2 | 选中：accent 底 + N1 勾（I1 12）；hover 边 E3；focus E4 环；disabled A5 |
| Radio | 18×18 · 圆形 | 选中：accent 描边 2px + 中心 6px 点；其余同上 |
| Toggle | 40×22 · R∞ · 轨道 N5 | 开：轨道 accent、滑块 N8 18px、2px 内边距；关：轨道 N5、滑块 N6；切换 D-2 160 |
| Segmented | 容器 N2 + E2 + R1 8；段高 C2 28 | 选中段：N4 底 + N8 文字；未选 N6；切换 D-1 120 |

- 所有命中区不小于 32×32（触屏 44×44），视觉可小于命中区（G107）。
- 文字标签 T4，与控件间距 S2 8；成组时组内间距 S3 12，组间 S5 24。
- **反例**：勾选框 hover 发光；Toggle 用一个开关表达三态；Segmented 用滑动指示条抢注意力。

---

#### C5 · Tabs / Navigation

依据：G47–G49（导航）/ G48（Active Indicator 强度）/ G78（键盘顺序）

- **Tabs**：高 C3 32，文字 T4/500，间距 S4 16；active = N8 文字 + 2px accent 下划线（距文字 6px）；inactive N6；hover A2 底、圆角 R1 8。
- **侧边导航**：行高 C4 40，圆角 R2 12，左 padding S3 12，图标 I3 16 + 间距 S2 8；active = N4 底 + 左侧 2px accent + N8 文字；hover A2。
- **顶部导航**：高 C5 48，底 N2 + 下边 E1，z-index Z2 100。
- 键盘：Tab 进入、方向键组内移动、Home/End 到首尾（G78）。
- **反例**：active 用大面积 accent 填充；导航项 hover 时改变字号；用发光指示器。

---

#### C6 · Card / List Row / Collection Item

依据：G44–G46（内容容器）/ G87–G89（Collection）/ G133（Playing 的发光权）

| 组件 | 几何 | 材质 | hover | selected |
|---|---|---|---|---|
| Card | R3 18 · padding S4 16 | N2 + E2 | A2 底 + S1 阴影 | A3 底 + 1px accent 边 |
| List Row | 高 48 · 横向 padding S3 12 · R2 12 | 透明 | A1 底 | A3 底 + 左侧 2px accent |
| Collection Item | R3 18 · 封面 + 文字 | 透明 | 封面 `scale(1.02)` **仅限封面层** | A3 底 + 1px accent 边 |

- **Card 内容**：标题 T5 15/500、副文 T3 12/N6、间距 S2 8；卡内纵向间距 S3 12。
- **List Row**：主文字 T4、副文 T3/N6；右侧操作区不常驻，hover 才出现（D-1 120 淡入）。
- **Playing 状态**：行尾 12px 指示点/波形，accent + **允许发光**（G133 允许的语义事件：播放中）。这是全局唯一默认允许发光的 UI 状态。
- **反例**：Row 的 hover 只给文字变色导致命中感缺失；Card hover 整体位移 8px；封面 scale 带动整卡布局变化。

---

#### C7 · Dialog / Sheet / Popover / Tooltip

依据：G80–G83（浮层体系）/ G119–G120（生命周期与焦点）/ G106

| 层 | 尺寸 | 材质 | 进入 | 退出 |
|---|---|---|---|---|
| Dialog | 宽 min(560, 90vw) · padding S5 24 | N3 + R4 24 + S4；veil A4 | D-4 280 E-Enter（scale .98→1 + 透明度） | D-3 200 E-Exit |
| Sheet | 侧宽 360 / 底高 70vh | N3 + R4 24（贴边侧） | D-4 280 位移 24px | D-3 200 |
| Popover | 最大 320 | N3 + R3 18 + S3 | D-2 160 透明度 + 4px 位移 | D-2 160 |
| Tooltip | 自适应 · padding S1/S2 | N4 + R2 12 + S2 · T2 11 | 延迟 400ms · D-2 160 | D-2 160 |

- **焦点**：打开时焦点进入层内首个可交互元素；Tab 循环限制在层内；关闭后回到触发元素（G120）。veil 点击 = 关闭（Dialog 只在允许误触关闭时启用）。
- **层级**：veil Z4 1100、Dialog Z5 1200、Sheet Z6 1300、Tooltip Z8 1500。
- **反例**：Tooltip 承载可点击操作；Dialog 从屏幕中央放大弹出（用位移+透明度即可）；关闭后焦点回 body 顶部。

---

#### C8 · Toast / Empty State / Error

依据：G81（Toast）/ G84（Empty）/ G26（Error）

- **Toast**：位于 Bottom Player 之上（间距 S5 24），宽 ≤360，底 N3 + R2 12 + S3 阴影，padding S3 12，文字 T3 12；进入 D-4 280，停留 4s，退出 D-2 160；最多同时 3 条，向下堆叠 S2 8；z-index Z7 1400。**不得承载需要决策的内容**（那是 Dialog 的事）。
- **Empty State**：图标 I5 24 / N6 + 标题 T6 17 / N8 + 说明 T4 / N6（最大宽度 320）+ 最多一个 primary 按钮；整体垂直居中，间距 S3 12。
- **Inline Error**：行内 T3 12 danger，左侧 12px 图标 I2 14，间距 S1 4；不整页变红。
- **反例**：Toast 里放"确定/取消"；空状态只有一个"暂无数据"；错误用全屏红底。

---

#### C9 · Badge / Chip / Tag / Progress

依据：G85–G86（Tagging / Progress）/ G68（预算）

| 组件 | 几何 | 文字 | 材质 |
|---|---|---|---|
| Badge | 高 16 · R∞ · 横向 4 | T1 10 | accent 底 + N1 字（数字类）；或 E1 底 + N7 字 |
| Chip | 高 24 · R∞ · 横向 8 | T3 12 | N4 底 + E2 边；可带 12px 删除图标（hover 才显示） |
| Tag | 高 20 · R0 4 · 横向 6 | T2 11 | 透明 + E2；只读标记，不可点击 |
| Progress 线 | 高 4 · R∞ | — | 底 N5、进度 accent；不确定态用 12px 环形 |
| Progress 环 | 12 / 16 | — | stroke 2，底 N5、进度 accent |

- Badge 数字变化不做弹跳动画，只做 D-1 120 的透明度过渡。
- Progress 只表达"还要多久"（G86），不表达"我在忙"；后者用 Loading 态。
- **反例**：Chip 和 Tag 混用（一个可操作一个不可）；进度条加发光；Badge 用大字号。

---

#### C10 · Page Header / Typography 落地映射

依据：G50–G59（Typography）

| 角色 | Token | 字重 | 颜色 | 典型位置 |
|---|---|---|---|---|
| Display | T8 26 / 34 | 600 | N8 | 空状态、引导页 |
| Page Title | T7 20 / 28 | 600 | N8 | 页面顶部，间距下 S4 16 |
| Section Title | T6 17 / 24 | 500 | N8 | 区块之间，上间距 S5 24 |
| Body | T4 13 / 19 | 400 | N7 | 正文默认 |
| Body Strong | T4 13 / 19 | 500 | N8 | 列表主文字 |
| Caption | T3 12 / 17 | 400 | N6 | 副文本、说明 |
| Metadata | T2 11 / 15 | 400 | N6 | 时间、计数、来源 |
| Micro | T1 10 / 14 | 500 | N6 | Badge、极小标注 |

- 页面结构：Page Title（T7）→ 间距 S5 24 → 首个 Section Title（T6）→ 内容。
- **只允许三个字重**：400 / 500 / 600。字距默认 0，仅 T7 及以上允许 -0.01em 光学校正（G55）。
- **反例**：页面标题用 24px 又用 600 又加 letter-spacing；同一层级出现两种灰色；用字号而不是间距区分区块。

---

> 每簇的交付自查见本节末尾（状态齐全 / 无裸数值 / hover 无 scale·glow / 焦点可见 / 浮层焦点恢复 / PR 标 G 编号）。

---

## 4 · Agent 执行清单

### 4.1 必须做

- 新建任何视觉元素前，先定位它归属的领域与 G 编号，并写进 PR 描述。
- 尺寸只能取 D1 表的值；不在表里的值先问，再实现。
- 颜色只能来自语义色 / 氛围色两类，不允许新建一次性的颜色。
- 状态必须走 G67 优先级 + G68 表达预算。
- 浮层必须实现 G119 生命周期 + G120 焦点恢复。
- 动效必须声明 Duration / Easing token 与 Reduced Motion 降级。
- 可交互元素必须有 Focus 证据与不小于下限的 Hit Area（G74/G107）。

### 4.2 绝对不做

- 不得发明新的 radius / spacing / 字号 / 时长（G5–G8、G52、G71）。
- 不得让 hover 触发 scale、glow、邻居联动或 layout 变化（G21）。
- 不得给装饰性 Surface 加发光；发光必须过 G133 三问。
- 不得用硬边框把页面切格子（G4/G13）。
- 不得让组件直接写 Environment 的颜色 / 光场（G97）。
- 不得用 z-index 抢层级（G106）。
- 不得把 Player 母稿的视觉语言整段复制到普通页面（Specific beats General）。
- 不得为「更好看」改已冻结决策；要改走「修改已冻结决策」流程并留编号。

### 4.3 三个审查问句（Code Review）

```text
1. 它属于哪个 Surface / Radius Family / Type Role？（几何与材质是否有据）
2. 表达是否在 Expression Budget 内？发光是否有 Emission 权限？
3. 状态切换、浮层进出、形态变化时，意义是否仍然连续？（G131/G132）
```

三问有一问答不上来 → 打回，不进入 review。

---

## 5 · 附录

### 5.1 133 条索引

| 编号 | 领域 | 决策名 | 选项 |
|---|---|---|---|
| G1 | A | Global Foundation + Explicit Stage Ownership | D |
| G2 | A | Contextual Layered Material System | D |
| G3 | A | Contextual Surface Ground | D |
| G4 | A | Hierarchical Separation | D |
| G5 | B | Semantic Geometry System | D |
| G6 | B | Semantic Curvature Field | D |
| G7 | B | Semantic Spacing System | D |
| G8 | B | Semantic Density System | D |
| G9 | C | Stable Semantic Color System + Contextual Atmospheric Color | D |
| G10 | C | Controlled Chromatic Semantics | D |
| G11 | C | Stable Neutral Core + Optical Temperature | D |
| G12 | C | Stable Semantic Contrast + Contextual Optical Compensation | D |
| G13 | C | Contextual Edge System | D |
| G14 | C | Contextual Elevation System | D |
| G15 | C | Contextual Optical Blur | D |
| G16 | C | Contextual Optical Transparency | D |
| G17 | C | Layer + Semantic Role | D |
| G18 | C | Contextual Material Inheritance | D |
| G19 | C | Contextual Material Boundary | D |
| G20 | C | Contextual Overlay Veil | D |
| G21 | D | Contextual Hover Response + C-biased Micro Transformation | D |
| G22 | D | Contextual Press Response | D |
| G23 | D | Hierarchical Active State | D |
| G24 | D | Contextual Disabled State | D |
| G25 | D | Contextual Loading State | D |
| G26 | D | Contextual Error State | D |
| G27 | D | Contextual Success State | D |
| G28 | E | Contextual Informational Surface | D |
| G29 | E | Contextual Floating Surface System | D |
| G30 | E | Semantic Anchoring | D |
| G31 | E | Contextual Selection Surface | D |
| G32 | F | Contextual Action Surface | D |
| G33 | F | Semantic Control Geometry | D |
| G34 | F | Semantic Control Geometry — Independent Axes | D |
| G35 | F | Semantic Control Group | D |
| G36 | F | Semantic Iconography System | D |
| G37 | F | Semantic Icon Geometry | D |
| G38 | F | Semantic Optical Weight | D |
| G39 | F | Contextual Icon State Transformation | D |
| G40 | F | Contextual Icon Transition | D |
| G41 | F | Contextual Input Surface | D |
| G42 | F | Contextual Navigation State | D |
| G43 | F | Contextual Binary Control System | D |
| G44 | G | Contextual Content Surface | D |
| G45 | G | Semantic List Row System | D |
| G46 | G | Semantic Row Interaction | D |
| G47 | H | Semantic Navigation Field | D |
| G48 | H | Hierarchical Navigation Expression | D |
| G49 | H | Contextual Navigation Presence | D |
| G50 | I | Semantic Page Heading | D |
| G51 | I | Semantic Typography Personality | D |
| G52 | I | Hierarchical Type Scale | D |
| G53 | I | Semantic Weight Hierarchy | D |
| G54 | I | Semantic Reading Rhythm | D |
| G55 | I | Semantic Optical Tracking | D |
| G56 | I | Semantic Text Hierarchy | D |
| G57 | I | Semantic Typography Role System | D |
| G58 | I | Semantic Role + Controlled Variant Envelope | D |
| G59 | I | Semantic Role Federation | D |
| G60 | J | Semantic Component Taxonomy | D |
| G61 | J | Semantic Composition System | D |
| G62 | J | Semantic Capability Boundary | D |
| G63 | J | Semantic Token + Canonical Value + Allowed Range | D |
| G64 | J | Three-layer Semantic Token Architecture | D |
| G65 | J | Semantic Local Token Governance | D |
| G66 | J | Semantic Promotion Governance | D |
| G67 | J | Contextual State Composition | D |
| G68 | J | Contextual Expression Budget | D |
| G69 | J | Semantic State Capability | D |
| G70 | K | Contextual Motion Capability | D |
| G71 | K | Semantic Temporal System | D |
| G72 | K | Contextual Motion Restraint | D |
| G73 | K | Contextual Reduced Motion | D |
| G74 | L | Contextual Keyboard Focus | D |
| G75 | L | Semantic Focus Language | D |
| G76 | L | Contextual Focus Visibility | D |
| G77 | L | Semantic Focus Tracking | D |
| G78 | L | Semantic Navigation Order | D |
| G79 | L | Semantic Focus Boundary | D |
| G80 | M | Semantic Dismissal System | D |
| G81 | M | Semantic Notification System | D |
| G82 | M | Contextual Decision Surface | D |
| G83 | M | Contextual Secondary Space | D |
| G84 | M | Semantic Empty State System | D |
| G85 | M | Semantic Tagging System | D |
| G86 | M | Semantic Progress System | D |
| G87 | M | Semantic Collection Field | D |
| G88 | M | Semantic Collection Geometry | D |
| G89 | M | Semantic Collection Recomposition | D |
| G90 | N | Semantic Scroll System | D |
| G91 | N | Semantic Responsive Thresholds | D |
| G92 | N | Semantic Preservation Hierarchy | D |
| G93 | N | Progressive Recomposition | D |
| G94 | N | Semantic Elasticity Field | D |
| G95 | N | Semantic Spatial Region System | D |
| G96 | O | Living Environment System | D |
| G97 | O | Semantic Environment Orchestration | D |
| G98 | O | Semantic Influence Arbitration | D |
| G99 | O | Contextual Environmental Memory | D |
| G100 | O | Semantic Performance Governance | D |
| G101 | P | Semantic Media Surface System | D |
| G102 | P | Semantic Framing System | D |
| G103 | P | Contextual Media Arrival | D |
| G104 | P | Contextual Media Failure State | D |
| G105 | Q | Semantic Separation System | D |
| G106 | Q | Semantic Layer Governance | D |
| G107 | Q | Semantic Interaction Envelope | D |
| G108 | R | Semantic Input Modality System | D |
| G109 | R | Semantic Gesture Arbitration | D |
| G110 | R | Semantic Gesture Commitment | D |
| G111 | R | Semantic Drag Field | D |
| G112 | R | Contextual Drag Representation | D |
| G113 | R | Contextual Drop Commit | D |
| G114 | R | Semantic Reversal System | D |
| G115 | R | Semantic Reversal Window | D |
| G116 | R | Semantic Reversal Confirmation | D |
| G117 | R | Semantic Disclosure System | D |
| G118 | R | Semantic Spatial Expansion | D |
| G119 | S | Semantic Overlay Lifecycle | D |
| G120 | S | Semantic Context Restoration | D |
| G121 | S | Semantic Focus Expression | D |
| G122 | S | Semantic Focus Visibility | D |
| G123 | S | Semantic State Arbitration | D |
| G124 | S | Semantic State Resolution | D |
| G125 | T | Semantic Motion Reinterpretation | D |
| G126 | T | Semantic Interruption Governance | D |
| G127 | T | Semantic Motion Coordination | D |
| G128 | T | Semantic Temporal Grammar | D |
| G129 | T | Semantic Easing Grammar | D |
| G130 | T | Semantic Spatial Direction | D |
| G131 | T | Semantic Spatial Continuity | D |
| G132 | T | Semantic Identity Continuity | D |
| G133 | T | Semantic Emission Authority | D |

### 5.2 来源与完整性

- **G1–G131**：逐字摘自 ChatGPT 导出包（会话《分支 · 分支 · 暂停开发完善设计系统checkpoint》，818 节点 / 585 条有内容消息 / 约 48.3 万字，2026-10-22 导出）。131 条决策名已逐条字符串核验命中原文。
- **G132**：原对话已出题未答，2026-10-31 由你补答 D。
- **G133**：原对话未涉及，2026-10-31 由接续会话出题、你拍板 D。
- **Q1–Q151**：同会话探索素材，编号 1–152 连续无缺口，但格式不统一，不作为规范使用。
- 逐条原文与消息序号：`NEBULA_GLOBAL_UI_MASTER_G1-G131.md`；状态账本：`LEDGER_GlobalUI.md`。
