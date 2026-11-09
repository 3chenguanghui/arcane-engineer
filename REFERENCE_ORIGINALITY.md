# 参考拆解 + 原创改造 · 施工设计书

> 项目：奥术工程师（单文件 HTML + Canvas 2D，俯视实时战斗 roguelike，魔法 × 科技）
> 目标代码：`index_arcane_v2.html`（**本文件只做设计，不修改任何游戏代码**）
> 版本：v1.0 · 2026-11-04
> 硬约束：单文件 / 零外部依赖 / 无外部美术与音频 / 中文界面 / 数据驱动 / 可调参数集中在 CONFIG / 小批量交付（每轮一个可验证单元）

## 阅读顺序

1. 只想看做什么 → §0
2. 准备开工 → §3（五个提案）+ §6（施工清单）
3. 要审"有没有抄" → §5
4. 要查来源 → 每节末尾 + §7

---

## 0. 结论（先看这一页）

### 0.1 五个提案与推荐实施顺序

| 顺位 | 提案 | 一句话钩子 | 主要解决 | 成本 | 为什么先做它 |
| --- | --- | --- | --- | --- | --- |
| 1 | **符文刻印台**（Sigil Engraving） | 花钱把一张卡的标签改一位，让"火"变成"雷" | 标签只能靠运气收集，构筑不可编辑 | S（1.5–2 人日） | 直接复用 `applyTagPatch`，改动最小、决策最深；商店终于有"策略消费" |
| 2 | **合体过载**（Rite Overdrive） | 融合演出中再按一次 F，赌一次更亮的合体 | 融合是一次性演出，玩家没有参与感 | S（1–1.5 人日） | 复用现有 0.78s 演出，把每局 3–10 次的高潮变成"可操作瞬间" |
| 3 | **并联回路**（Dual-Cast） | 主/副两条魔法回路同时咏唱，共享奥能 | 同时只有一张魔法在打，6 张卡大半是仓库 | M（2.5–3.5 人日） | 从"选一张最强的"变成"主副配比 + 资源分配"，构筑决策质变 |
| 4 | **残响回路**（Fusion Echo） | 融合放完后在落点留下一个会复读的残响 | 区域融合放完就结束，站位不产生后续价值 | M（2–3 人日） | 复用融合施法与对象池；把"站哪"变成输出，最像"魔法装置" |
| 5 | **Boss 蓝图装配**（Blueprint Salvage） | 拆掉 Boss 或把它的一招装进自己的融合 | 打赢 Boss 只有数值奖励，没有记忆点 | L（4–6 人日） | 长线目标 + 强记忆点；放最后因为与 Boss 预警几何耦合最高 |

> 成本口径：S ≤ 2 人日；M = 2–4 人日；L = 4–6 人日。按单人开发、含自测与回归估算，不含美术重绘。

### 0.2 为什么是这五个

- **都长在"魔法 × 科技"上**：刻印=改写符文语义；过载=仪式超频；并联=双回路供电；残响=信号残留；蓝图=把敌方构装逆向装配。换成任何其他题材都不成立，因此不是通用 roguelike 补丁。
- **都挂在已有系统上**：标签补丁 `state.tagPatches`、融合演出 `playFusionCinematic`、主技能 `state.activeMagicId`、融合施法 `castPrimary`、Boss 配置 `BOSS_CONFIG`。没有一条要求新引擎、新资源格式。
- **补的是本作当前缺的三块**（见 §1.11）：组合不可编辑、高潮不可操作、站位不可兑现。

### 0.3 明确不做的三件事

1. **不做 10 元素反应表**。元素反应是"照搬机制"的高危区，且本作 9 标签的乘算已经够深；再加一层只会让 HUD 与数值同时失控。
2. **不把 6 张魔法全塞进常驻 HUD**。Vampire Survivors 的 6 武器同屏是另一个游戏的信息密度；本作已有底栏卡组 + 标签条 + 三选一，继续加会挤掉战场。
3. **不做无保底纯随机**。`REWARD_CONFIG.fusionPityLimit = 5` 是现有资产，任何新奖励规则都必须给它让路。

---

## 1. 参考拆解：它们"为什么好玩"

### 1.1 速查总表

| 参考 | 为什么好玩（一句） | 借机制层 | 借表现层 | 本作变形 | 不能照搬 |
| --- | --- | --- | --- | --- | --- |
| Hades | 每次选择都是给已有招式加一条规则，双神祝福是两条线的合流 | 三选一、稀有度、双神前置图、神池限制、可对比锁定 | 神祇专属色、选择即演出 | 融合配方前置预览；不做 4 神池 | 卡框、神祇图标、语音、UI 构图 |
| Vampire Survivors | 6+6 槽位 + 进化，把"养一条生产线"做成滚雪球 | 槽位上限、满栏后只升级、进化消耗基底武器 | 全宽经验条、HUD 推边、数量爆炸 | 满栏后提高融合/遗物权重 | 武器表、进化表、像素素材 |
| Enter the Gungeon | 枪是动词，协同是藏在图鉴里的彩蛋 | 手工房间模板 + 程序化排列、必含房型、显式协同图鉴 | 每把枪不同的后坐力/弹壳/换弹 | 分支图必含房型；图鉴化融合 | 300 把枪的数值/名字/美术 |
| Dead Cells | 移动即表达，三色属性逼你早承诺 | 三色卷轴、武器只吃一色、路线分支 | 翻滚无敌帧、命中顿帧、速度感 | 用现有 9 标签做"专精"，不另起三色 | 三色数值、关卡美术 |
| Noita | 法杖是容器，法术是内容，玩家在"编程" | 施法顺序/延迟/充能/法力/散布；牌库-手牌-弃牌 | 像素物理、元素蔓延、连锁爆炸 | 魔法=弹体、科技=修饰符、融合=触发器 | 法术表、像素模拟（性能不允许） |
| Brotato | 20–90 秒一波，逛店即构筑，输得快也开得快 | 波次时长阶梯、刷新价格随波上升、稀有度按波解锁 | 材料吸附、暴击飘字 | 商店每层 1 次刷新，价格按层重算 | 价格表、物品表、角色 |
| Risk of Rain 2 | 无限叠加 + proc 链，滚出"我破坏了系统"的爽感 | 道具分族叠加（线性/双曲/倒数）、proc 链 | 满屏数字、连锁闪电层层叠加 | 遗物叠加分族；只做 3 类，不做无限 | 道具名/图标/公式表 |
| Soulstone Survivors | 技能类型 + buff 叠加 + 符文，菜单里也能 theory-craft | 8 符文（3 技能 + 5 属性）、类型连锁（电→火） | 高频飘字与特效（吵但可读） | 只做 3 条"类型连锁"，不做 350 技能 | 技能树、符文表 |
| Magic Survival | 单摇杆 + 自动施法，复杂度全放在构筑 | 升级三选一、自动索敌、局外永久升级 | 极简 HUD、黑底高对比 | 只借升级节奏与 HUD 极简，不改主动施法 | 法术合成表 |

### 1.2 Hades

- **好玩点**：Boon 不是"加 12% 伤害"，而是"给你的攻击加一条新规则"；Duo Boon 需要两张指定前置，形成"我在凑一个组合"的长期计划；叙事状态机让失败也有新内容。
- **机制层可迁移**：
  - 三选一 + 稀有度权重（已有 `pickWeightedOptions`）。
  - 双神前置图：Duo 位于 Tier 3，必须先持有两位神各自的指定前置之一；这比"任意两张卡合成"更有计划性。
  - 神池限制（一局最多 4 位神）+ Keepsake 定向：用"减少随机"作为玩家的主动权。
  - Boon 信息页支持 **pin 对比**（官方补丁明确提到）。
- **表现层可迁移**：每位神一套专属色/边框/音色；选择瞬间有短演出，但不超过 1 秒。
- **本作变形**：
  - 已有 `buildCardFusionLines`（`index_arcane_v2.html:10403`）在卡面显示融合线索，把它升级成"配方前置图"：卡面直接标"再拿 X 即可融合"。
  - 不做 4 神池；用"每层 1 次刻印/1 次商店刷新"承担"减少随机"的功能。
- **不能照搬**：Laurel 卡框、神祇头像/图标、语音、Hades 特有的紫金构图与字体；这些是强识别资产。
- 来源：[Boon System: God Gifts, Rarity & Duo Boons](https://teemo.dev/game-design/hades/systems/boon-system-god-gifts/)、[UX, UI & Accessibility](https://teemo.dev/game-design/hades/systems/ux-ui-and-accessibility/)、[官方补丁：Boon 可 pin 对比](https://www.supergiantgames.com/blog/hades-long-winter-update-patch-notes/)、[God Pool 与 build planning](https://hadesguides.com/hades/guides/boon-build-planning)

### 1.3 Vampire Survivors

- **好玩点**：6 武器 + 6 被动的槽位上限，让"拿什么"本身是取舍；进化把满级武器 + 指定被动变成一件新武器，形成"我在养一条生产线"的滚雪球。
- **机制层可迁移**：
  - 升级三选一（幸运时四选一），池子按稀有度权重；两栏满后不再出新，只出升级。
  - 四种转化：进化（消耗基底武器，保留被动）、联合（多把满级武器合成）、天赋（白送不占槽）、形态（角色专属）。
  - 每把武器的伤害/冷却/范围按攻击形态单独调，不套统一模板。
- **表现层可迁移**：全宽经验条、HUD 只保留 5 个元素并推到屏幕边缘、数量爆炸的粒子与飘字。
- **本作变形**：
  - 本作已有 6 魔法 / 6 科技 / 10 融合，天然对应"基底 + 催化剂 → 进化"；把"满栏后只出升级/融合"写进 `buildRewardOptions` 的池规则即可。
  - 不复制 6 武器同屏 HUD；本作用"主/副回路"（提案 P3）解决多技能的表达。
- **不能照搬**：武器/进化配方表、像素素材、字体、UI 布局。
- 来源：[Core Mechanics & Systems Architecture](https://teemo.dev/game-design/vampire-survivors/systems/core-mechanics-and-systems-architecture/)、[Weapons and Evolutions Reference](https://teemo.dev/game-design/vampire-survivors/systems/weapons-and-evolutions-reference/)、[UI / UX Design](https://teemo.dev/game-design/vampire-survivors/systems/ui-ux-design/)、[Balancing Levers](https://teemo.dev/game-design/vampire-survivors/systems/balancing-levers-and-tuning-matrix/)

### 1.4 Enter the Gungeon

- **好玩点**：每把枪都是一个动词（后坐力、弹道、换弹节奏完全不同），协同是"藏在图鉴里的彩蛋"；房间不是纯随机，而是"手工房间的程序化排列"。
- **机制层可迁移**：
  - 房间模板池 + 必含房型（商店、Boss、宝箱），保证每层结构可预期。
  - 协同在图鉴里显式记录，玩家可以"照着凑"。
  - Boss 房在楼层尽头，Boss 死前楼梯不可用（本作已实现）。
- **表现层可迁移**：不同枪械的后坐力、弹壳、换弹动画差异，让"换枪"立刻可感。
- **本作变形**：
  - 分支图已是 Delaunay + MST（`state.floorGraph`），可再加"每层必含 1 商店 + 1 精英岔路"的硬约束。
  - 协同图鉴：把 `buildCardFusionLines` 扩展成"融合图鉴/配方树"，不需要新美术。
- **不能照搬**：300 把枪的数值、名字、像素美术、Ammonomicon 的具体文案与排版。
- 来源：[Enter the Gungeon（玩法与协同）](https://www.owiki.org/wiki/Enter_the_Gungeon)、[SIFTD 评测：程序化排列而非纯生成](https://siftd.net/content/21270/enter-the-gungeon-review)、[Roguelite Design Analysis（显式协同）](https://a327ex.com/notes/roguelite-design-analysis)

### 1.5 Dead Cells

- **好玩点**：移动与战斗是同一个动词（跑、滚、跳、砍无缝衔接）；三色属性逼你"早承诺"，分散投资会得到一个又宽又弱的角色；无检查点让每次路线选择有重量。
- **机制层可迁移**：
  - 三色卷轴 + 武器只吃一色：构筑不是"拿越多越好"，而是"先把一条线拉满"。
  - 路线分支 + 符文解锁：地图选择即难度/收益选择。
- **表现层可迁移**：翻滚无敌帧、命中顿帧、轻微屏震、镜头跟随的速度感。
- **本作变形**：
  - 不另起三色（会与 9 标签打架）；用 `DOMINANCE_CONFIG` 的"同标签 3 层触发短暂统治"承担"专精奖励"。
  - 精英岔路（`ELITE_ROUTE_CONFIG`）已有"高风险高回报"，继续强化"路线即构筑"。
- **不能照搬**：三色数值、卷轴表、关卡美术、UI。
- 来源：[Dead Cells: The Roguevania Blueprint](https://asidehouse.com/respawn/dead-cells-the-roguevania-blueprint/)、[Dead Cells 评测：移动与战斗手感](https://fantasland.com/action/dead-cells)

### 1.6 Noita

- **好玩点**：法杖是容器、法术是内容；玩家在"编程"，一次失败会变成一段故事。深度来自"顺序 + 延迟 + 法力 + 散射"的组合，而不是数值。
- **机制层可迁移**：
  - 法杖属性：乱序/施法数/施法延迟/充能/法力上限/回蓝/容量/散射。
  - 牌库-手牌-弃牌三堆，触发"回绕"（wrap）会强制换弹。
  - 修饰符与触发器：让一个弹体变成"到点再施法"的容器。
- **表现层可迁移**：像素物理、元素蔓延、爆炸连锁；但这些依赖模拟，本作不做。
- **本作变形**：
  - 不做自由编程（上手成本高、性能风险大）；只借"容器 + 内容"的表达：**魔法 = 弹体，科技 = 修饰符，融合 = 触发器**。
  - 卡面用"线路图"展示施法顺序（弹体 → 修饰 → 触发），比纯文字 `desc` 更像"工程图纸"。
- **不能照搬**：法术表、法杖数值表、像素模拟引擎、素材。
- 来源：[Why Noita Bet on a Custom Falling Everything Engine](https://dev.to/wlz/why-noita-bet-on-a-custom-falling-everything-engine-the-pixel-simulation-tech-behind-roguelike-1n22)、[Advanced Wand Mechanics](https://blueprintedgaming.com/docs/noita/advanced-wand-mechanics)、[Noita: Crafting Chaos Through Wand Building](https://games.gg/noita/)

### 1.7 Brotato

- **好玩点**：20–90 秒一波的短循环，每波后必逛商店；属性、武器、经济三条线互相挤占，失败很快能再来一局。
- **机制层可迁移**：
  - 波次时长阶梯（越后期越长），波内目标只有"高效击杀"。
  - 商店刷新价格随波次上升（公式含基础价 + 每波增量），稀有度按波次逐步解锁。
  - 危险等级是整档倍率，不是逐级微调。
- **表现层可迁移**：材料吸附、暴击飘字、升级瞬间的短促反馈。
- **本作变形**：
  - 已有商店（余烬）与生存房（`U11b`）；借"刷新价格随层上升"和"稀有度按层解锁"，但**数值必须按本作 TTK 重算**，不得抄表。
  - 每层商店给 1 次刷新，作为余烬的第二个出口。
- **不能照搬**：价格公式的具体系数、物品表、角色设计。
- 来源：[Teardown: 微循环与硬上限](https://teemo.dev/game-design/brotato/systems/teardown/)、[Shop, Economy & Run Structure](https://teemo.dev/game-design/brotato/systems/shop-economy-and-run-structure-reference/)、[Macro Loop & Scaling](https://teemo.dev/game-design/brotato/systems/overview-v/)

### 1.8 Risk of Rain 2

- **好玩点**：道具无限叠加 + proc 链，单人也能滚出"我破坏了系统"的爽感；时间压力让"多拿一个箱子"变成风险决策。
- **机制层可迁移**：
  - 叠加公式分族：线性、双曲、倒数（不同道具用不同曲线，避免全部线性爆炸）。
  - proc coefficient：一个道具触发另一个道具，形成链式反应。
  - 部分道具**只加目标数/范围，不加伤害**（如 Ukulele 每层 +2 目标，伤害与概率固定），让"叠"不等于"无脑强"。
- **表现层可迁移**：满屏数字、连锁闪电、音效层层叠加。
- **本作变形**：
  - 已有 `RELIC_CONFIG.maxStacks`（2–4 层）与标签乘算；借"分族叠加"，只做 3 类：加法（生命/奥能）、乘法（伤害）、边际递减（冷却）。
  - 不做无限叠加；`maxStacks` 保留。
- **不能照搬**：道具名、图标、公式表、角色。
- 来源：[Items and stacking](https://teemo.dev/game-design/risk-of-rain-2/systems/items-and-stacking/)、[Ukulele 叠加规则](https://rogueranker.com/risk-of-rain-2-ukulele/)、[Death Mark 四种不同 debuff](https://2upskill.com/risk-of-rain-2-best-item-synergies-2026-build-guide/)

### 1.9 Soulstone Survivors

- **好玩点**：技能类型 + buff 叠加 + 符文，菜单里也能 theory-craft；"发现一个破局组合"的密度很高。
- **机制层可迁移**：
  - 8 符文 = 3 个改技能 + 5 个改属性，限制数量而不是无限堆。
  - 技能类型连锁：例如施放电系技能时有概率再施放火系，制造"类型 × 类型"的乘法。
- **表现层可迁移**：高频飘字与特效；虽然吵，但伤害来源始终可读。
- **本作变形**：
  - 本作 22 个能力已接近"少而深"；只借"类型连锁"，做 3 条（火→雷、雷→冰、冰→火），且必须用本作标签表实现，不新增技能。
- **不能照搬**：350+ 技能、技能树、符文表。
- 来源：[Soulstone Survivors 评测（符文与武器锻造）](https://bullethaven.com/review/soulstone-survivors)、[Xbox Wire：技能类型与连锁](https://news.xbox.com/en-us/2025/04/23/soulstone-survivors-demo-xbox/)、[Buff 协同](https://www.hawkdive.com/master-barbarian-builds-and-more-in-soulstone-survivors/)

### 1.10 Magic Survival

- **好玩点**：单摇杆移动 + 自动施法，把操作复杂度压到最低，把复杂度全放到"每级三选一"的构筑上。
- **机制层可迁移**：
  - 升级三选一、自动索敌、局外永久升级（三类货币）。
  - 法术合成：低阶法术两两合成高阶，形成"收集 → 合成"的短目标。
- **表现层可迁移**：极简 HUD、黑底高对比、法术自动开火的节奏感。
- **本作变形**：
  - 本作是"主动瞄准 + 主动施法"，不能改成全自动，否则会丢掉准心系统（`AIM_CONFIG`）。
  - 只借"升级节奏"与"极简 HUD"：HUD 常驻元素不超过 6 个。
- **不能照搬**：法术合成表、数值、美术。
- 来源：[Magic Survival 玩法概述](https://oyunclubnet.com/magic-survival/)、[MiniReview 对比描述](https://minireview.io/arcade/brotato-premium/games-like)

### 1.11 方法论：设计文章里的可迁移结论

- **a327ex 的 roguelite 维度表**：把作品拆成"升级深度 / 交互方式 / 协同类型"。关键结论是"协同 + 乘法"比"线性升级"更能产生记忆点；但无限叠加需要上限。→ 本作用的标签乘算属于"乘法协同"，需要"每张卡最多 2 个标签"的上限（已有约束）。
- **三支柱**：核心动词、协同、元进度。先保证核心动词（瞄准 + 施法 + 冲刺）好玩，再加协同；不要用元进度补偿核心动词的无聊。→ 本作提案全部不改核心动词，只改"选择与兑现"。
- **Game feel 原子**：屏震、顿帧、挤压拉伸、粒子、音高抖动是"廉价高收益"的五件套；关键是**分级**：轻击 1–2 帧顿帧 + 1–2px 震，重击 6–10 帧 + 4–8px 震。→ 本作已有 `FEEL_CONFIG` / `PIXEL_FX_CONFIG`，新提案只复用，不新造反馈体系。
- **Juice it or lose it**：同一个游戏，加粒子、音效、缓动、挤压后，玩家对"同一件事"的评价会显著提高。→ 刻印/过载/残响都必须先做"反馈"，再做"数值"。
- **"为什么好玩"的 7 条共性**（从上面 9 款提炼）：
  1. 动词优先：先有一个爽的动词，再叠规则。
  2. 选择必须有代价：槽位、神池、三色、经济，四选一。
  3. 组合要可见：图鉴、前置图、叠加说明，让玩家能计划。
  4. 保底防挫败：进化、稀有度解锁、融合保底。
  5. 短循环 + 快重开：20–90 秒到 20 分钟，失败成本低。
  6. 反馈分层：轻/中/重的顿帧与屏震不同。
  7. 失败也有收获：叙事、解锁、结算。
- **本作已命中的 4 条**：核心动词（瞄准/施法/冲刺）、短循环（5 层）、保底（融合 pity）、失败收获（U5 死因台词/结算）。
- **本作缺的 3 条**（也就是五个提案的由来）：
  - 缺"组合可编辑"：标签只能靠奖励拿，不能主动改写 → P1 刻印台。
  - 缺"高潮可操作"：融合是一次性演出，玩家只能看 → P2 合体过载。
  - 缺"站位可兑现"：区域融合放完就结束 → P4 残响回路。
  - （P3 并联回路补"选择有代价"；P5 蓝图补"长线记忆点"。）
- 来源：[Roguelite Design Analysis](https://a327ex.com/notes/roguelite-design-analysis)、[How to Make a Roguelike: 3 Pillars](https://game-designers.net/how-to-make-a-roguelike)、[Game Feel in 2D Combat](https://freegamesprites.com/en/news/game-feel-2d-combat-juice-tricks)、[GDC: Juice It or Lose It](https://www.gdcvault.com/play/1016487/juice-it-or-lose)、[Vlambeer: The Art of Screenshake](https://verbotengames.wordpress.com/2014/06/21/the-psychology-of-screen-shake/)

---

## 2. 本作现状盘点（施工坐标）

| 系统 | 现状 | 关键符号 / 位置 | 可挂什么 |
| --- | --- | --- | --- |
| 魔法 6 张 | 同时只有 1 张"主技能"，数字键 1–6 切换 | `MAGIC_CONFIG` L4294；`state.ownedMagic`；`state.activeMagicId`；`selectMagic()` L22488 | P3 双槽、P1 改标签 |
| 科技 6 张 | 被动 + 可触发装置 | `TECH_CONFIG` L4341；`state.ownedTech`；`castDevice()` L22336 | P1 改标签、P2 过载消耗 |
| 融合 10 条 | 魔法 + 科技 → 升级主技能；按 F 融合 | `FUSION_CONFIG` L4388；`tryFuse()` L22446；`getAvailableFusions()` | P2 过载、P5 蓝图变体 |
| 融合演出 | 0.78s 双环 + 符文汇入 + 慢动作 + 名字横幅 | `FUSION_CAST_CONFIG` L4450；`playFusionCinematic()` | P2 过载窗口 |
| 标签乘算 | 9 标签；每能力 2–4 标签；遗物按标签乘算 | `TAG_CONFIG` L4696；`ABILITY_TAGS` L4712；`collectMods()` L21475；`tagDamageMul()` L21505 | P1 刻印台 |
| 标签改写 | U11c 事件已能改写标签（随机事件） | `state.tagPatches` L6102；`applyTagPatch()` L27260；`tagPatchSeq` | P1 直接复用 |
| 标签统治 | 同标签 3 层触发 0.1s 慢动作 + 边缘染，每局 2 次 | `DOMINANCE_CONFIG` L4762 | P1 刻印后可主动触发 |
| 遗物 | 5 条基础 + 3 条标签遗物，maxStacks 2–4 | `RELIC_CONFIG` L4508；`TAG_RELICS` L4741 | P3/P4 的数值出口 |
| 三选一奖励 | 权重抽取 + 融合保底 5 层 + 池不足补补给 | `buildRewardOptions()` L24268；`REWARD_CONFIG` L4791 | P1/P5 的奖励接入 |
| 契约 | 2 条一次性：祝福·锋刃协议 / 诅咒·贪婪回路 | `buildRewardOptions` L24364–24373；`state.pactBlessTaken` / `pactCurseTaken` L6056；`pactTakenMul` L6052 | 可作为 P2 的代价来源 |
| 房型 | 战斗/精英/宝箱/事件/休整/商店/生存/秘藏/首领 | `ROOM_TYPE_CONFIG` L4982 | P1 刻印台（休整/商店） |
| 商店 | 展台 + E 交互 + 余烬交易 | `state.shop`；U11 | P1 刻印台、P3 刷新 |
| 生存房 | E 启动后落闸刷波 | `state.survival`；U11b | P2 过载的高压场景 |
| 隐藏房 | 撞墙潜入 | `HIDDEN_ROOM_CONFIG` L7865 | P5 蓝图可选奖励 |
| 精英岔路 | 风险路线 + 奖励权重提升 | `ELITE_ROUTE_CONFIG` L5552 | P5 蓝图掉落 |
| 虚空裂隙 | 传送 + 代价 | `VOID_RIFT_CONFIG` L5582 | P4 残响的落点玩法 |
| Boss | 每层最远房；mech/rune/void 三套 | `BOSS_CONFIG` L5124；`BOSS_SIG_CONFIG` L5176 | P5 蓝图 |
| 调试 API | 验收脚本读状态 | `window.__roamDebug.getState()` L28765；`tools/arcane_*.js` | 所有验收断言 |
| 错误收集 | 全局错误列表 | `window.__errors` L28448 | 所有验收断言 |

---

## 3. 五个原创玩法提案（施工级）

> 统一约定：每个提案都新增一个 `XXX_CONFIG` 参数块；所有数值先给"首版建议值"，必须过专项测试后再调。所有提案默认 `enabled: true/false` 可 A/B。

### P1 符文刻印台（Sigil Engraving）

**钩子**：在休整房/商店房出现一台"刻印台"，花余烬把一张已持有能力的一个标签改写成另一个标签。玩家第一次可以"主动编辑自己的乘算"。

**规则（首版）**
- 出现位置：每层休整房固定 1 台；商店房有 50% 概率多 1 台（可配置）。
- 费用：3 余烬/次；每层最多 1 次；每张能力一生最多 2 次刻印。
- 操作：靠近按 E → 选能力 → 选"被替换的标签" → 选"新标签"（9 选 1）→ 确认。
- 约束：改完后该能力仍须 ≥ 2 个标签，且不能出现重复标签；融合/合成融合的标签同步刷新（因为都走 `getAbilityTags`）。
- 与随机事件的关系：U11c 的随机改标签保留；刻印台是"付费可控版"，两者共用 `applyTagPatch`，不新增第二套状态。

**为什么是原创（最接近的做法 + 三点差异）**
- 最接近：Noita 的"改法杖"、Hades 的 Keepsake 定向、U11c 自己的随机标签事件。
- 差异 1：改的不是法术/装备，而是**能力的语义标签**——这是本作独有的乘算单位。
- 差异 2：它是"付费 + 限额"的**规划行为**，不是随机事件，也不是无代价重铸。
- 差异 3：改标签会同时改变融合的标签并集（`buildTagFusion` 取并集），所以它在改"融合的身份"，不只是改一张卡。

**挂载点**
- `state.tagPatches`（L6102）、`applyTagPatch()`（L27260）、`getAbilityTags()`（L21469）、`tagDamageMul()`（L21505）。
- 商店展台/交互：复用 `state.shop` 的 pedestal 结构与 E 交互；休整房新增一个固定坐标的交互物。
- HUD 标签条：`renderTagBar()` + `tagPatchSeq++` 强制重绘（已有签名机制）。

**实现步骤**
1. 新增 `ENGRAVE_CONFIG`：`costEmbers: 3`、`perFloor: 1`、`perAbility: 2`、`minTags: 2`、`spawn: { rest: 1, shopChance: 0.5 }`。
2. 新增 `state.engrave = { usedFloor: -1, count: {}, station: null }`；`createInitialState` 初始化。
3. 生成刻印台：休整房固定放 1 个；商店房按概率追加；`getState()` 暴露 `engrave` 摘要。
4. 交互 UI：复用现有弹窗样式，三列（能力列表 / 当前标签 / 新标签），键盘可操作；只列 `ownedMagic + ownedTech + fusions`。
5. 确认时校验费用/次数/最少标签 → 调 `applyTagPatch(id, newTags)` → 扣余烬 → `flashScreen` + 音效。
6. 结算/读档：`tagPatches` 本来就在 `state` 内，随本局；`count` 随本局重置。

**表现层**
- 刻刀音：WebAudio 短噪声 burst（30ms）+ 1 声高频 ping；标签条以 0.22s 溶解再重写（用现有粒子）。
- 卡面：被改的标签短暂闪一次新颜色，并在卡角留一个"刻痕"（2px 斜线），提示"这张卡被改过"。
- 不做：不要复刻 Hades 的祝福卡框或 Noita 的法杖 UI。

**验收断言（可直接写成 `tools/arcane_engrave.js`）**
- A1 初始 0 余烬按 E：返回 `{ok:false, reason:'embers'}`，`state.tagPatches` 不变，余烬不变。
- A2 付 3 余烬把 `fireball` 的 `projectile` 改为 `thunder`：`getAbilityTags('fireball')` 返回 `['fire','thunder']`；在 `relics.ember=1, conductor=1` 时 `tagDamageMul('fireball')` 从 `1.2` 变为 `1.44`（±0.02）。
- A3 同一能力第 3 次刻印：被拒绝，`count[id] === 2`，不再扣费。
- A4 只给 1 个标签的输入：被拒绝，提示"至少保留 2 个标签"。
- A5 下层后 `tagPatches` 仍生效；`tagPatchSeq` 增加；HUD 标签条重绘一次。
- A6 60 秒战斗 + 3 次刻印：`window.__errors` 为空，平均帧耗不超过基线 +1ms。

**工作量**：1.5–2 人日，约 200–260 行。
**风险 / 降级**：玩家把所有卡都改成同一标签会导致乘算爆炸 → 用 `perAbility:2` + `minTags:2` + 每层 1 次限制；若仍爆炸，降级为"只能改科技卡标签"。

---

### P2 合体过载（Rite Overdrive）

**钩子**：融合演出开始后的 0.45 秒内再按一次 F，等于"给仪式再加一档电压"。成功则演出升级、融合后的技能获得 8 秒过载；失败则什么都不发生。

**规则（首版）**
- 触发窗口：`tryFuse()` 成功后 0.45s（真实时间，不受慢动作影响）。
- 输入：再次按 F（或手柄确认键）；窗口内 HUD 出现一个收束环 + 提示"再按 F 过载"。
- 成功代价：扣除最大奥能的 35%（不足则不可触发，按钮灰显）；本局过载次数 +1，最多 3 次。
- 成功收益：融合后的技能 8 秒内伤害 ×1.5、冷却 ×0.8；演出追加"第二层反向环 + 专属色爆闪 + 0.06s 顿帧 + 音高 +2 半音"。
- 失败：窗口结束自动消失，无消耗、无惩罚。

**为什么是原创**
- 最接近：动作游戏里的"完美换弹/完美闪避"（如 Gears 的 active reload），以及各种"二次确认"。
- 差异 1：确认的对象不是攻击，而是**融合仪式本身**，且发生在 0.78s 的慢动作演出里。
- 差异 2：收益是"技能进入过载态 8 秒"，不是一次性伤害；它改变接下来 8 秒的节奏。
- 差异 3：代价用**奥能上限比例**而不是冷却，保证"穷的时候不能赌"。

**挂载点**
- `tryFuse()`（L22446）、`playFusionCinematic()`、`FUSION_CAST_CONFIG`（L4450）、`state.player.aetherMax`、`getMagicDamage` 结算（L21637 附近）。
- `state.overdrive = { window: 0, buffTime: 0, used: 0 }`。

**实现步骤**
1. 新增 `OVERDRIVE_CONFIG = { window: 0.45, costRatio: 0.35, maxPerRun: 3, buffDuration: 8, damageMul: 1.5, cooldownMul: 0.8, hitStop: 0.06, pitch: 2 }`。
2. `tryFuse()` 成功后设置 `state.overdrive.window`；`update()` 里按真实 `dt` 递减。
3. 输入处理：F 键在 `window > 0` 时走 `tryOverdrive()`；校验 `aether >= aetherMax * 0.35` 与 `used < max`。
4. 成功：扣奥能、`used++`、`buffTime = 8`、播放加强版演出（复用现有环，改方向/颜色/音高）。
5. 伤害与冷却：在 `getMagicDamage` 与冷却计算处乘 `overdriveMul`；`buffTime` 归零自动复位。
6. HUD：融合技能卡上加一条"过载 8s"倒计时细条；`getState()` 暴露 `overdrive`。

**表现层**
- 窗口内：屏幕中心一个收束环从 120px 缩到 40px（0.45s），配一声上扬的合成音。
- 成功：第二层环反向旋转 + 专属色爆闪 + 0.06s 顿帧 + 音高 +2 半音 + 名字横幅加"· 过载"。
- 失败：环淡出，不播错误音（避免惩罚感）。

**验收断言（`tools/arcane_overdrive.js`）**
- A1 融合后 0.45s 内按 F 且奥能充足：`state.overdrive.used === 1`，`buffTime` 在 7.9–8.0，奥能减少约 35% 最大值的 ±2%。
- A2 0.45s 后按 F：`used` 不变、奥能不变、`buffTime === 0`。
- A3 奥能不足 35%：返回失败，`used` 不变，提示"奥能不足"。
- A4 第 4 次过载：被拒绝，`used === 3`。
- A5 过载后对同一敌人的伤害 ≈ 非过载的 1.5 倍（±5%），冷却 ≈ 0.8 倍（±3%）。
- A6 演出总时长增加 ≤0.25s，且输入不被慢动作阻塞；`window.__errors` 为空。

**工作量**：1–1.5 人日，约 100–160 行。
**风险 / 降级**：与 F 键原功能冲突 → 只在 `window > 0` 时接管；若手柄/移动端没有第二按键，则改为"融合演出中点击屏幕中央的收束环"。

---

### P3 并联回路（Dual-Cast）

**钩子**：两张魔法同时挂在"主回路 / 副回路"上，共享一条奥能池。主回路满功率，副回路降频降伤；按 Tab 切换主导权，切换有 0.35s 的"换相"硬直。

**规则（首版）**
- 槽位：`state.dual.slots = [magicIdA, magicIdB]`，初始为 `[activeMagicId, null]`；第二槽在第一次获得第二张魔法时自动填入。
- 主/副：`focus` 指向其中一槽。主槽伤害 ×1.0、冷却 ×1.0；副槽伤害 ×0.8、冷却 ×1.45、奥能消耗 ×0.9。
- 共享奥能：两条回路都从同一个 `player.aether` 扣；奥能不足时**只有主槽能施法**，副槽自动停摆（避免"两张卡一起卡死"）。
- 切换：Tab 切换 `focus`，0.35s 内两槽都不施法（换相硬直），HUD 显示换相进度。
- 融合：融合只作用于它所属槽位的那张魔法；`state.fusions` 仍按 magic id 记录。
- 与现有 `selectMagic` 的关系：数字键 1–6 改为"把该魔法装进当前 focused 槽"；点击卡面同理。

**为什么是原创**
- 最接近：VS 的多武器同时开火、Noita 的多法术杖。
- 差异 1：本作不是"越多越好"，而是**两个槽 + 一个 focus**，副槽永远降频降伤，逼玩家做"主副配比"。
- 差异 2：共享奥能让"两张高消耗卡"不能无脑并列，必须配一张低消耗卡；这是资源决策，不是槽位收集。
- 差异 3：融合绑定槽位，玩家要决定"把融合放在主回路还是副回路"。

**挂载点**
- `state.activeMagicId`、`selectMagic()`（L22488）、`castPrimary()`（L21713）、各 `castFireball/castFrost/...`（L21864–22336）、`getMagicDamage` 结算（L21637）、奥能扣除处。
- `renderDeck()` / `updateHUD()` / `state.mods.cooldownMul`。

**实现步骤**
1. 新增 `DUAL_CONFIG = { secondaryDamage: 0.8, secondaryCooldown: 1.45, secondaryCost: 0.9, switchTime: 0.35, autoFill: true }`。
2. `createInitialState` 增加 `state.dual = { slots: ['fireball', null], focus: 0, switchCd: 0 }`。
3. `selectMagic(id)` 改为写入 `slots[focus]`；若该 id 已在另一槽，则交换两槽（避免重复）。
4. 新增 `castDual()`：主槽调原 `castPrimary` 逻辑；副槽用同一施法函数但传 `{damageMul, cooldownMul, costMul}`；两槽独立冷却记录（`state.dual.cd[0/1]`）。
5. 奥能扣除：主槽全价、副槽 0.9；不足时跳过副槽并给一次轻提示（不刷屏）。
6. 输入：Tab 切 focus；`switchCd` 期间禁止施法；HUD 两个槽显示独立冷却环与 focus 高亮。
7. 卡组 UI：6 张卡上打"主/副"角标；未装备的卡显示为"待接入"。

**表现层**
- 主/副槽各一条冷却环；focus 槽有 1px 呼吸描边（只改 `box-shadow`，不做全属性过渡）。
- 换相：0.35s 内画面轻微去色 + 一声"继电器闭合"的咔哒；换相结束两槽各闪一次。
- 双施法时两条弹道用同一色系的不同明度，避免玩家分不清哪发是谁的。

**验收断言（`tools/arcane_dualcast.js`）**
- A1 装备 `fireball` + `frost`，3 秒内 `state.projectiles` 同时出现两种弹体（火球与冰环各 ≥1 次）。
- A2 主槽伤害 / 副槽伤害 ≈ 1.0 / 0.8（±5%）；副槽实际施法间隔 ≈ 主槽 ×1.45（±5%）。
- A3 奥能降到只够一发时：只有主槽施法，副槽 `cd` 不推进，且不出现负奥能。
- A4 按 Tab 后 `focus` 翻转；0.35s 内 `castPrimary` 返回 false；0.35s 后恢复。
- A5 对槽 A 的魔法融合后，槽 B 的行为不变；`state.fusions` 只增加 1 条。
- A6 60 敌人场景：平均帧耗 ≤ 基线 +2ms，`window.__errors` 为空。

**工作量**：2.5–3.5 人日，约 300–450 行。
**风险 / 降级**：HUD 拥挤 → 卡面只显示"主/副"角标，不新增常驻面板；若双施法性能不达标，降级为"副槽每 2 次主施法才触发 1 次"。

---

### P4 残响回路（Fusion Echo）

**钩子**：融合技能释放后，在落点留下一个"残响节点"，6 秒内每 1.5 秒复读一次该融合的 30% 效果。最多同时 2 个；敌人踩到可以踩碎它。

**规则（首版）**
- 触发：每次成功释放"已融合"的技能时，在**施法点**（不是命中点）生成 1 个残响。
- 行为：每 1.5s 对半径 70px 内敌人造成该融合基础伤害的 30%；不触发过载、不触发二次残响、不复制控制效果（只复制伤害，控制减半时长）。
- 上限：同时 2 个；超出时最早的一个立即碎裂（给一次小爆）。
- 生命：6s；敌人接触 1 次即碎（碎裂造成 1 次 50% 伤害）。
- 视觉：一个地面符文环 + 一条上下浮动的"信号线"；颜色取 `fusion.color`。

**为什么是原创**
- 最接近：各类"回响/回声"技能、PoE 的触发宝石、Noita 的延迟施法。
- 差异 1：残响不是"再放一次技能"，而是**留在空间里的低功率信号源**，玩家要决定"在哪放"。
- 差异 2：它可被敌人踩碎，所以是"可失去的资产"，不是纯增益。
- 差异 3：它只复制伤害、不复制控制，避免"冰环残响无限控"。

**挂载点**
- `castPrimary()`（L21713）与各 `castXxx` 函数；`state.fusions`；`state.fx`/对象池；融合 `color`。
- 新增 `state.echoes = []`，`getState()` 暴露数量与剩余时间。

**实现步骤**
1. 新增 `ECHO_CONFIG = { life: 6, interval: 1.5, radius: 70, damageRatio: 0.3, maxCount: 2, breakDamageRatio: 0.5, controlRatio: 0.5 }`。
2. 在"融合技能成功释放"的分支处（`castPrimary` 内判断 `state.fusions.includes(...)`）调用 `spawnEcho(x, y, fusionId)`。
3. `spawnEcho` 用对象池创建节点（不要每帧 new）；超过上限时先碎最早的。
4. `updateEchoes(dt)`：计时、脉冲、索敌（复用现有网格/距离查询）、伤害调用 `damageEnemy`。
5. 敌人接触检测复用现有碰撞；碎裂时 `addSparks` + 一次 0.5 伤害。
6. HUD：不新增常驻条；只在节点上画一个 6s 环形倒计时。

**表现层**
- 生成：地面一圈符文环（0.3s 扩散）+ 一声"信号锁定"的双音。
- 脉冲：环收缩 + 3 颗粒子；不震屏（避免高频震屏）。
- 碎裂：小范围专属色碎片 + 一声短促的"断线"噪声。

**验收断言（`tools/arcane_echo.js`）**
- A1 释放融合技能后，`state.echoes.length === 1`，坐标与施法点误差 ≤8px，`life` 在 5.9–6.0。
- A2 6 秒内脉冲次数 ≥3；单次对同一敌人伤害 ≈ 融合基础伤害 ×0.3（±5%）。
- A3 同时生成第 3 个：`length === 2`，最早的一个被移除并触发碎裂伤害。
- A4 敌人接触：节点立即消失，接触敌人受到 0.5 倍伤害。
- A5 残响不触发过载：`state.overdrive.used` 不变；不生成新残响。
- A6 20 个残响压力测试（临时把上限调 20）：帧耗 ≤ 基线 +1.5ms，`window.__errors` 为空。

**工作量**：2–3 人日，约 250–350 行。
**风险 / 降级**：区域融合（引力井/冰环）残响可能过强 → 首版只允许"投射/连锁"类融合生成残响；区域类降级为"只造成 15%"。

---

### P5 Boss 蓝图装配（Blueprint Salvage）

**钩子**：Boss 死后掉落"蓝图核心"，玩家二选一：拆解换资源，或把 Boss 的一招装进自己的融合。装配后下一层开始，你的融合会多出一个"敌方构装"的形态。

**规则（首版）**
- 掉落：每层 Boss 必掉 1 个蓝图核心（本局最多 5 个）。
- 二选一：
  - **拆解**：+3 奥术结晶 + 8 余烬（数值按层缩放，见配置）。
  - **装配**：把该 Boss 的一个标志招式变成玩家融合变体，占用 1 个融合位（不覆盖已有融合），下一层生效，持续到本局结束。
- 三个 Boss 各一个变体：
  - 机械 Boss → `bp:mech`「扇形齐射」：融合技能释放时额外向前方 60° 扇形发射 5 发 40% 伤害弹。
  - 符文 Boss → `bp:rune`「刻印地雷」：融合命中处留下 1 个 2s 后引爆的符文雷（80% 伤害，半径 64）。
  - 虚空 Boss → `bp:void`「引力回拉」：融合命中后把 120px 内敌人向命中点拉 25%，并减速 0.6s。
- 只能装 1 个蓝图变体；再装会替换（旧的不返还资源）。
- 与现有融合的关系：`getFusionById` 增加 `bp:` 前缀解析；`state.fusions` 仍只存 id，伤害与触发在 `castPrimary` 的融合分支里追加。

**为什么是原创**
- 最接近：Mega Man 的 Boss 武器、Hades 的 Boss 奖励、Gungeon 的 Boss 掉落。
- 差异 1：不是"获得一把 Boss 武器"，而是**把 Boss 的预警几何逆向装进已有融合**——题材上是"拆解构装、重接线路"。
- 差异 2：二选一发生在"资源 vs 身份"之间，不是"两件装备选一件"。
- 差异 3：变体是"融合的附加层"，不新增技能栏，HUD 不膨胀。

**挂载点**
- `BOSS_CONFIG`（L5124）、`BOSS_SIG_CONFIG`（L5176）、`getFusionById()`（L21523）、`castPrimary()`（L21713）、`state.fusions`、`state.crystals`、`state.embers`。
- `buildRewardOptions`（L24268）可复用"三选一"弹窗，但这里是"二选一"，建议新开一个轻量弹窗。

**实现步骤**
1. 新增 `BLUEPRINT_CONFIG`：每个 Boss 的 `variantId / name / desc / params`；拆解奖励按层 `{crystal: 3, embers: 8}`。
2. Boss 死亡结算处弹"二选一"（复用现有弹窗容器），选择后写入 `state.blueprint = { id, floor }`。
3. `getFusionById` 增加 `bp:` 解析，返回一个"变体描述对象"（不修改 `FUSION_CONFIG` 原表）。
4. `castPrimary` 的融合分支末尾调用 `applyBlueprintEffect(fusionId, x, y, dir)`；三个变体各自独立函数，参数全在配置里。
5. 下一层开始时把 `state.blueprint` 标记为 `active`；结算面板显示"本局装配：扇形齐射"。
6. 验收用 `getState()` 暴露 `blueprint`。

**表现层**
- 装配：一段 1.2s 的"拆解—重焊"演出（复用融合演出的环与火花，改为冷色），名字横幅"装配：扇形齐射"。
- 触发：变体效果用自己的副色（不与主融合撞色），只加一层薄冲击线，不抢主融合的视觉。
- 拆解：结晶/余烬飞向 HUD 的对应图标（复用现有拾取动画）。

**验收断言（`tools/arcane_blueprint.js`）**
- A1 Boss 死亡后必出二选一；选"拆解"：结晶 +3、余烬 +8，`state.blueprint === null`。
- A2 选"装配"：`state.blueprint.id === 'bp:mech'`，下一层 `castPrimary` 释放融合时额外生成 5 发弹（角度覆盖 60°±5°）。
- A3 装配后只占 1 个变体位；再装 `bp:void` 时旧变体被替换，不叠加。
- A4 `bp:rune` 在命中点生成地雷，2s 后爆炸，伤害 ≈ 融合基础 ×0.8（±5%）。
- A5 `bp:void` 把 120px 内敌人向命中点移动约 25%（±5%），减速 0.6s。
- A6 全流程 1–5 层：每层 Boss 都有掉落，`window.__errors` 为空，帧耗 ≤ 基线 +2ms。

**工作量**：4–6 人日，约 500–700 行。
**风险 / 降级**：与 Boss 预警几何耦合高 → 首版只做"简化版"三招（扇形弹、地雷、拉拽），不复用 Boss AI；若仍超期，降级为"只做拆解 + 1 个变体（机械）"。

---

## 4. UI / 网页设计参考

### 4.1 六个可借的范式

| 范式 | 参考 | 可以借的结构 | 本作怎么落地 | 必须自己重画 |
| --- | --- | --- | --- | --- |
| 奖励三选一 | Hades Boon 选择 | 三张并列、稀有度色、可 pin 对比、选择即演出 | 现有 `buildRewardOptions` 弹窗加"pin 对比"与"与当前标签的匹配度"两行 | 卡框、神祇图标、 laurel 纹样、字体 |
| 卡面可读性 | Slay the Spire 卡牌 | 文本 ≤15 词、关键词高亮、悬停 tooltip、意图图标分级 | 卡面只留 1 行效果 + 1 行标签；长解释进 tooltip | 卡牌边框、能量球、意图图标画风 |
| 战斗 HUD | Vampire Survivors | 常驻元素 ≤5–6 个、推到屏幕边缘、经验条全宽 | 顶部层数/计时、左下 HP/奥能、底部卡组、右侧标签条 | 像素字体、经验条造型、图标 |
| 商店经济 | Brotato 商店 | 刷新价格随层上升、稀有度按层解锁、每波必逛 | 商店加 1 次刷新；价格 = 基础 + 层数 × 系数（自己重算） | 价格表、物品图标、角色 |
| UI 参考库 | Game UI Database | 按"屏幕类型/年代/平台"检索同类截图，只看布局与层级 | 每个新面板先找 3 张参考，再画 3 张自己的草图 | 任何截图都不能直接描摹 |
| Web 交互 | NN/g + MDN | 渐进披露、focus-visible、prefers-reduced-motion | tooltip 只显示 2 行；键盘焦点 2px 环；震屏可关 | 不复制任何站点视觉 |

- 来源：[Game UI Database](https://www.gameuidatabase.com/)、[HUD 设计最佳实践（Rocketbrush）](https://rocketbrush.com/blog/designing-practical-and-pretty-hud-in-video-games)、[Game HUD Design（Argentics）](https://www.argentics.io/game-hud-design)、[Game UI/UX Principles（StraySpark）](https://www.strayspark.studio/blog/game-ui-ux-design-principles)、[Slay the Spire 视觉语言](https://teemo.dev/game-design/slay-the-spire/systems/art-direction-and-visual-language/)、[Slay the Spire 卡面可读性](https://shrunkenshrine.com/tag/slay-the-spire/)、[Progressive Disclosure（NN/g）](https://www.nngroup.com/articles/progressive-disclosure/)、[prefers-reduced-motion（MDN）](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)

### 4.2 本作 HUD 信息层级（建议固定为 4 层）

| 层级 | 内容 | 出现时机 | 视觉权重 | 交互 |
| --- | --- | --- | --- | --- |
| L0 世界 | 敌人、弹幕、地面警示、残响节点 | 常驻 | 最高（对比度最高） | 无 |
| L1 生命线 | HP、奥能、护盾、冲刺冷却 | 常驻，屏幕左下 | 高（大字号 + 条形） | 无 |
| L2 构筑线 | 主/副魔法槽、科技被动、标签条、融合点 | 常驻，底部 + 右侧 | 中（小字号 + 图标） | 点击/数字键 |
| L3 元信息 | 层数、计时、结晶、余烬、最佳楼层 | 常驻，顶部边缘 | 低（小字号、低饱和） | 悬停查看 |

规则：
- 常驻元素总数 ≤ 6 组；新提案（P1/P3/P5）只允许增加"角标/细条"，不新增面板。
- 任何"只在特定时机会用到"的信息（如刻印费用、蓝图候选）不得常驻，必须在交互时出现。
- 危险状态（HP < 25%）才允许提高视觉权重；平时不要呼吸灯。

### 4.3 动效节奏表（统一 token，避免每个面板各写一套）

| 场景 | 时长 | 缓动 | 说明 |
| --- | --- | --- | --- |
| 悬停 / focus | 90–120ms | ease-out | 只改 `border-color / box-shadow / translate` |
| 卡面入场 | 180–220ms，间隔 40ms | cubic-bezier(0.16, 1, 0.3, 1) | 三张卡依次落位，不逐帧重绘 |
| 选择确认 | 300ms + 1 帧闪白 | ease-out | 先闪白再飞入卡组 |
| 弹窗关闭 | 140–160ms | ease-in | 不拖沓，快速回到战斗 |
| 融合演出 | 780ms（现有） | 自定义 | 慢动作只作用世界时间，不阻塞输入 |
| 刻印重写 | 220ms | ease-in-out | 标签条溶解 → 重写 |
| 过载收束环 | 450ms | linear | 与输入窗口严格同长 |
| 残响脉冲 | 300ms | ease-out | 不震屏，避免高频疲劳 |

无障碍：
- 尊重 `prefers-reduced-motion`：关闭屏震/镜头 kick，保留顿帧与颜色反馈。
- 所有可点击卡面必须有 `:focus-visible` 2px 环，键盘可完成三选一/刻印/蓝图。
- 颜色不是唯一信息载体：稀有度同时用"边框粗细 + 罗马数字"（已有 `RARITY_MARK`）。

### 4.4 必须自己重画的部分（黑名单）

- 不描摹 Hades 的 Boon 卡框、神祇头像、Laurel 纹样、紫金配色。
- 不描摹 Slay the Spire 的卡框、能量球、意图图标、字体。
- 不描摹 Vampire Survivors 的像素字体、经验条、图标。
- 不描摹 Brotato 的物品图标、商店货架布局。
- 不使用任何游戏截图作为 UI 背景或纹理。
- 本作 UI 语言应为"电路板 + 符文"：细线走线、焊点圆点、刻痕斜线、发光只在高能时刻。颜色从现有 `--rar-*` 与主题色取，不引入新色板。

---

## 5. 原创边界规则（一页判定）

### 5.1 合法 vs 抄袭

| 行为 | 判定 | 说明 |
| --- | --- | --- |
| 学"三选一/保底/权重"的结构 | 合法 | 这是通用设计语法，且本作已用自己的数值与 UI 实现 |
| 学"轻/重击的顿帧分级" | 合法 | 参数区间是公共经验；必须自己调 |
| 学"房间模板 + 程序化排列" | 合法 | 本作已有 Delaunay + MST 自研实现 |
| 参考公开文章的观点并注明来源 | 合法 | 在 `REFERENCE.md` / 本文记录链接 |
| 使用 MIT/Apache 代码片段 | 有条件合法 | 必须保留版权头 + 在 `NOTICE.md` 汇总；能自写就自写 |
| 复制 GPL/AGPL 代码 | 抄袭 | 只可读思路，不可复制 |
| 复制美术/精灵/音频/字体 | 抄袭 | 一律禁止，本作零外部素材 |
| 整表复制数值/配方（即使改名） | 抄袭 | 数值必须按本作 TTK 重新推导 |
| 复制独特 UI 构图/图标体系/配色身份 | 抄袭 | "看起来就是那个游戏"即越界 |
| 使用商标名/角色名/文案 | 抄袭 | 名称与文案必须原创 |
| 逐帧复刻动画曲线/镜头运动 | 抄袭 | 可以学"节奏感"，不能复刻具体曲线 |
| 反编译提取资源 | 抄袭 | 明确禁止 |

### 5.2 三问测试（每个提案评审时逐条回答）

1. **能否用本作术语一句话说清？** 例如"刻印台改的是能力标签，不是法术"。说不清 → 说明还在抄皮。
2. **数值是否由本作 TTK/经济推导？** 例如过载 1.5 倍是否会让 Boss 少打一轮？必须给出推导，不能写"参考原作"。
3. **玩家会不会说"这就是 X 的 Y"？** 会 → 必须改表现层 + 改规则变形；不会 → 通过。

补充规则：
- **参考配额**：每个里程碑对单一参考最多借 2 个结构点；写进 `REFERENCE.md` 的表格。
- **证据链**：每个提案记录"来源链接 / 借了什么 / 改了什么 / 明确没借什么"四行。
- **不复制原则**：能自写就自写；算法优先用教科书公共知识（Delaunay、Kruskal、trauma²、对象池）。

### 5.3 许可证矩阵

| 来源类型 | 可用方式 | 额外要求 |
| --- | --- | --- |
| MIT / Apache-2.0 | 可参考实现，必要时可移植片段 | 保留版权头 + `NOTICE.md` |
| GPL / AGPL | 只读思路 | 不复制任何代码 |
| 未标注 / 无许可证 | 只读结论 | 视为"不可复制" |
| 商业游戏素材 | 不使用 | 无例外 |
| 商业游戏代码 | 不反编译、不复制 | 无例外 |
| 公开设计文章/演讲 | 可引用观点 | 注明作者与链接 |

### 5.4 提案记录模板（复制到每个提案开头）

```
来源：<链接 1> / <链接 2>
借了什么结构：<最多 2 条>
本作改了什么：<规则变形 + 题材绑定>
明确没借什么：<美术 / 数值表 / 代码 / UI 构图>
三问测试：1) 能一句话说清 [是/否] 2) 数值有推导 [是/否] 3) 玩家会说像 X [是/否]
```

---

## 6. 施工清单（可直接当 backlog）

> 节奏：按项目既有规则，**每轮只做一个可验证小单元**，跑专项 + 核心回归（`tools/arcane_verify.js`、`tools/arcane_u1.js`、`tools/arcane_fusion.js`、`tools/arcane_c7.js`）后再进下一个。本文档不授权修改 `index_arcane_v2.html`。

| # | 任务 | 依赖 | 专项验收 | 预估 |
| --- | --- | --- | --- | --- |
| 0 | 新增 5 个 `*_CONFIG` 空壳 + `getState()` 调试字段 | 无 | `arcane_verify.js` 全绿 | 0.5 人日 |
| 1a | P1 刻印台：数据 + 生成 + 交互 UI | 0 | `arcane_engrave.js` A1/A3/A4 | 1 人日 |
| 1b | P1 刻印台：`applyTagPatch` 接线 + 乘算验证 | 1a | A2/A5 | 0.5–1 人日 |
| 2 | P2 合体过载：窗口 + 输入 + 演出加强 | 0 | `arcane_overdrive.js` A1–A4 | 1 人日 |
| 2b | P2：过载 buff 的伤害/冷却 + HUD 细条 | 2 | A5/A6 | 0.5 人日 |
| 3a | P3 并联回路：状态 + 选卡 + 输入 | 0 | `arcane_dualcast.js` A1/A4 | 1.5 人日 |
| 3b | P3：双施法 + 奥能/冷却 + 融合归属 | 3a | A2/A3/A5 | 1.5–2 人日 |
| 4a | P4 残响：生成 + 生命周期 + 索敌 | 0 | `arcane_echo.js` A1/A3 | 1.5 人日 |
| 4b | P4：伤害/碎裂 + 上限 + 性能 | 4a | A2/A4/A5/A6 | 1–1.5 人日 |
| 5a | P5 蓝图：Boss 掉落 + 二选一 + 拆解 | 0 | `arcane_blueprint.js` A1 | 1.5 人日 |
| 5b | P5：三个变体 + `bp:` 解析 + 下一层生效 | 5a | A2–A5 | 2.5–4 人日 |
| 6 | UI 统一：三选一 pin 对比、HUD 层级、动效 token | 1–5 | 截图对比 + 帧耗 | 2 人日 |

合计约 **14–18 人日**（不含回归与调参）。建议顺序：1 → 2 → 3 → 4 → 5 → 6；每个提案内部再拆 2 个单元。

### 6.1 每个单元的完成定义（DoD）

- 专项脚本全绿 + 指定核心回归全绿 + `window.__errors` 为空 + 帧耗不超基线阈值。
- 所有新数值进 `*_CONFIG`；`PROGRESS.md` 记录"时间/单元/关键数据/文件/残留风险/下一步"。
- 需用户决策的写入 `QUESTIONS.md`，给 2 个选项 + 推荐方案，不阻塞开发。
- 备份快照放 `_backup/`，失败可回滚。

---

## 7. 来源总表

### 作品与设计分析

- Hades：[Boon System](https://teemo.dev/game-design/hades/systems/boon-system-god-gifts/)、[UX/UI](https://teemo.dev/game-design/hades/systems/ux-ui-and-accessibility/)、[God Pool 与 planning](https://hadesguides.com/hades/guides/boon-build-planning)、[官方补丁（pin 对比）](https://www.supergiantgames.com/blog/hades-long-winter-update-patch-notes/)、[Holism: Why Hades Mattered](https://sourcegaming.info/2025/11/05/holism-why-hades-mattered/)
- Vampire Survivors：[Core Mechanics](https://teemo.dev/game-design/vampire-survivors/systems/core-mechanics-and-systems-architecture/)、[Weapons & Evolutions](https://teemo.dev/game-design/vampire-survivors/systems/weapons-and-evolutions-reference/)、[UI/UX](https://teemo.dev/game-design/vampire-survivors/systems/ui-ux-design/)、[Balancing](https://teemo.dev/game-design/vampire-survivors/systems/balancing-levers-and-tuning-matrix/)
- Enter the Gungeon：[玩法与协同](https://www.owiki.org/wiki/Enter_the_Gungeon)、[程序化排列评测](https://siftd.net/content/21270/enter-the-gungeon-review)
- Dead Cells：[Roguevania Blueprint](https://asidehouse.com/respawn/dead-cells-the-roguevania-blueprint/)、[移动/战斗手感](https://fantasland.com/action/dead-cells)
- Noita：[Wand 系统与引擎成本](https://dev.to/wlz/why-noita-bet-on-a-custom-falling-everything-engine-the-pixel-simulation-tech-behind-roguelike-1n22)、[Advanced Wand Mechanics](https://blueprintedgaming.com/docs/noita/advanced-wand-mechanics)、[Wand Building](https://games.gg/noita/)
- Brotato：[Teardown](https://teemo.dev/game-design/brotato/systems/teardown/)、[Shop & Economy](https://teemo.dev/game-design/brotato/systems/shop-economy-and-run-structure-reference/)、[Scaling](https://teemo.dev/game-design/brotato/systems/overview-v/)
- Risk of Rain 2：[Items & Stacking](https://teemo.dev/game-design/risk-of-rain-2/systems/items-and-stacking/)、[Ukulele 叠加](https://rogueranker.com/risk-of-rain-2-ukulele/)、[Death Mark 协同](https://2upskill.com/risk-of-rain-2-best-item-synergies-2026-build-guide/)
- Soulstone Survivors：[评测](https://bullethaven.com/review/soulstone-survivors)、[技能类型连锁](https://news.xbox.com/en-us/2025/04/23/soulstone-survivors-demo-xbox/)、[Buff 协同](https://www.hawkdive.com/master-barbarian-builds-and-more-in-soulstone-survivors/)
- Magic Survival：[玩法概述](https://oyunclubnet.com/magic-survival/)、[同类对比](https://minireview.io/arcade/brotato-premium/games-like)

### 方法论 / Game Feel

- [Roguelite Design Analysis（a327ex）](https://a327ex.com/notes/roguelite-design-analysis)
- [How to Make a Roguelike: 3 Pillars](https://game-designers.net/how-to-make-a-roguelike)
- [Game Feel in 2D Combat: 7 Juice Tricks](https://freegamesprites.com/en/news/game-feel-2d-combat-juice-tricks)
- [GDC Vault: Juice It or Lose It](https://www.gdcvault.com/play/1016487/juice-it-or-lose)
- [Vlambeer: The Art of Screenshake（转载分析）](https://verbotengames.wordpress.com/2014/06/21/the-psychology-of-screen-shake/)
- [Video Game Design: further reading（Nuclear Throne 反馈）](https://datafield.dev/video-game-design/part-02/chapter-08/further-reading.html)

### UI / 网页交互

- [Game UI Database](https://www.gameuidatabase.com/)
- [HUD 设计最佳实践](https://rocketbrush.com/blog/designing-practical-and-pretty-hud-in-video-games)
- [Game HUD Design](https://www.argentics.io/game-hud-design)
- [Game UI/UX Principles](https://www.strayspark.studio/blog/game-ui-ux-design-principles)
- [Slay the Spire 视觉语言](https://teemo.dev/game-design/slay-the-spire/systems/art-direction-and-visual-language/)
- [Slay the Spire 卡面可读性](https://shrunkenshrine.com/tag/slay-the-spire/)
- [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)

---

## 附：一句话总结

学结构、学节奏、学信息层级；不学美术、不抄数值、不复制代码。五个提案都从"魔法 × 科技"长出来，并且都能挂在现有系统上——先做刻印台和合体过载，用最小成本把"构筑可编辑"和"高潮可操作"补上，再考虑并联、残响与 Boss 蓝图。
