# GitHub 开源项目专查

> 项目：奥术工程师（单文件 HTML + Canvas 2D，俯视实时战斗 roguelike，魔法 × 科技）
> 目的：上一份 `REFERENCE_ORIGINALITY.md` 偏作品与设计文章，本文件补"代码级实现"的参考。
> 核实时间：2026-11-04（星数、许可证、活跃度均为当日 GitHub REST API 快照）
> 硬约束：**单文件、零依赖、零外部资源**。因此即使许可证允许，也不直接引入任何仓库代码；全部结论落到"我们自己怎么写"。
> 本文件只做调研与设计，**不修改任何游戏代码**。

---

## 0. 结论：最值得"抄思路"的 5 个仓库

| 排名 | 仓库 | 语言 / 星数 | 许可证 | 为什么值得看 | 对应本作系统 |
| --- | --- | --- | --- | --- | --- |
| 1 | [liyupi/binding-of-isaac-webgame](https://github.com/liyupi/binding-of-isaac-webgame) | JS / 约 77 | MIT | **约束最接近**：零依赖、零构建、Canvas 2D、俯视动作 roguelike；有独立的 `dungeon.js / entities.js / items.js` 和 `test/bot.js` 无头测试 | AI、房间、道具、测试钩子 |
| 2 | [majidmanzarpour/threejs-procedural-dungeon](https://github.com/majidmanzarpour/threejs-procedural-dungeon) | JS / 约 515 | MIT | 完整走通 **散点 → 分离 → Delaunay → MST → 回环边 → 房间语义**，且有确定性种子与重试；正好对应本作分支图升级 | 程序化房间图 |
| 3 | [matthiasbroske/VampireSurvivorsClone](https://github.com/matthiasbroske/VampireSurvivorsClone) | C# / 约 283 | MIT | 幸存者类的"压力曲线 + 分类型对象池 + 数据资产"三件套做得干净；README 明确列出对象池与 spawn keyframe 系统 | 刷怪节奏、对象池、性能 |
| 4 | [DesirePathGames/Slay-The-Robot](https://github.com/DesirePathGames/Slay-The-Robot) | GDScript / 约 292 | MIT | 卡牌/遗物/协同的**动作拦截器 + 校验器 + 内容包**架构；最适合学"遗物如何改动作而不散落各处" | 卡池、遗物、协同 |
| 5 | [felixmariotto/three-screenshake](https://github.com/felixmariotto/three-screenshake) | JS / 约 19 | MIT | 只有 2.4KB，四相位阻尼振荡（1, -0.6, 0.3, -0.1）+ 二次包络；比"随机偏移"高级，又小到能完全读懂 | 屏震、镜头反馈 |

**为什么不是另外几个**：`delaunator` 和 `rot.js` 很好，但前者是为上千点优化的 sweep-hull + 类型化数组，本作每层只有 4–7 间房，抄进来是负收益；后者是完整工具箱（RNG/地图/FOV/A*/调度器），BSD 许可但整包引入会破坏零依赖。它们的价值在"知道算法边界"，不在"搬代码"。`SpaceHuggers` 是 GPL 且 13KB 高度压缩，只适合看"极简结构"，不能碰代码。

---

## 1. 检索与核实方法

- 检索方式：GitHub REST Search API（`/search/repositories`），按分类关键词 + `sort=stars`；再对重点仓库用 `/repos/{owner}/{repo}` 与 `/contents/{path}` 核实许可证、语言、体积、目录结构。
- 只读分析：对 5 个核心仓库下载了源码到临时目录，用文本检索确认关键函数/字段（不复制、不引入）。
- 星数为快照，会变化；许可证以 API 返回的 `license.spdx_id` 为准。
- `NOASSERTION` 表示"仓库有许可证文件但 GitHub 无法识别"，**按无授权处理**：只看思路。
- 检索式（可复现）：

```
roguelike game language:JavaScript stars:>50
survivors game language:JavaScript stars:>50
bullet heaven stars:>30
dungeon generator language:JavaScript stars:>200
delaunay triangulation language:JavaScript stars:>200
screenshake stars:>10
game feel stars:>10
behavior tree javascript game stars:>50
deckbuilder roguelike language:TypeScript stars:>30
card game engine javascript stars:>100
object pool javascript stars:>30
quadtree javascript stars:>50
```

---

## 2. 分类清单（逐个仓库）

### 2.1 俯视实时战斗 / 动作 roguelike

| 仓库 | 用途 | 星数 | 许可证 | 只学思路？ | 可借鉴的具体点 | 不可借鉴 |
| --- | --- | --- | --- | --- | --- | --- |
| [liyupi/binding-of-isaac-webgame](https://github.com/liyupi/binding-of-isaac-webgame) | 零依赖 Canvas 2D 以撒类：12 层 / 13 Boss / 55 道具，含 `js/dungeon.js`、`entities.js`、`items.js`、`test/bot.js` | 约 77 | MIT | 可以（本项目仍选择只学） | 房间种子、生成重试与兜底、敌人 `state/st/phase/pattern`、`hitStop` 取最大值、`Shake.add`、无头 bot 测试 | 其美术、Boss 名称/弹型、道具数值、12 层内容表；代码本身也不建议整段搬 |
| [KilledByAPixel/SpaceHuggers](https://github.com/KilledByAPixel/SpaceHuggers) | 13KB 的俯视太空射击，纯 Canvas + WebAudio | 约 288 | GPL-3.0 | **只能看思路，禁止复制** | 极简数据驱动、窗口裁剪、按帧计时的特效、音频合成 | 任何代码/文本/资源；GPL 会传染 |
| [Larkenx/Rotten-Soup](https://github.com/Larkenx/Rotten-Soup) | 浏览器 roguelike（Vue + Pixi + rot.js） | 约 408 | GPL-3.0 | 只能看思路 | 房间/实体分层、存档点设计、UI 与逻辑分离 | 代码、美术、关卡数据 |
| [stefanweck/dungeongeneration](https://github.com/stefanweck/dungeongeneration) | JS 地牢生成演示（含可视化） | 约 201 | MIT | 可以 | BSP/随机房间的对比、可视化调试、参数面板 | 其具体房间尺寸与美术 |
| [ondras/rot.js](https://github.com/ondras/rot.js) | roguelike 工具箱：RNG、地图生成、FOV、A*、调度器 | 约 2726 | BSD-3-Clause | 可以（不要整包引入） | `RNG`/`Alea`/`xorshift` 的种子流、递归阴影 FOV、A*、按速度调度 | 整包体积与 API 设计；本项目自写简化版 |
| [PubDeer/astro-loop](https://github.com/PubDeer/astro-loop) | Android 俯视 roguelike 射击 | 约 151 | GPL-3.0 | 只能看思路 | 移动端输入、弹幕密度、波次结构 | 代码与资源 |
| [Bozar/GodotRoguelikeTutorial](https://github.com/Bozar/GodotRoguelikeTutorial) | Godot 极简 roguelike 教程 | 约 278 | MIT | 可以 | 回合/实时切换的边界、网格与实体组织 | Godot 节点/场景结构不能直接映射到单文件 |

**重点说明（isaac-webgame）**
- 它的价值是"同约束"：没有引擎、没有资源包，全部 Canvas 绘制；目录按 `dungeon / entities / items / game / util` 分层，正好对应本作的 `generateFloor / updateEnemies / buildRewardOptions`。
- 代码级可学：
  - `dungeon.js` 里每间房用全局种子派生房内种子（`room.seed = rng.int ^ (id * 2654435761)`），保证"同一层同房间内容稳定"。
  - 生成不是一次成功：失败会换种子重试，最后有线性兜底方案，避免死循环。
  - `entities.js` 的敌人是 `state + st(状态计时) + phase(血量阶段) + pattern` 的轻量状态机，不是为每种敌人写一个类。
  - `game.js` 的顿帧用 `Math.max` 叠加，且把 `dt` 缩到 6%，而不是暂停整个循环。
  - `test/bot.js` 通过 `window.__game` 的 `press/release/move` 驱动无头 bot，证明"这局可通关"；这比截图测试更可靠。
- 不可学：Boss 名称、弹型角度表、55 个道具的数值、美术风格；以及 MIT 代码也不直接搬（零依赖 + 可维护性）。

### 2.2 幸存者类（bullet-heaven / horde survival）

| 仓库 | 用途 | 星数 | 许可证 | 只学思路？ | 可借鉴的具体点 | 不可借鉴 |
| --- | --- | --- | --- | --- | --- | --- |
| [matthiasbroske/VampireSurvivorsClone](https://github.com/matthiasbroske/VampireSurvivorsClone) | Unity 幸存者类完整实现：20+ 武器、4 敌人、2 Boss、升级、对象池 | 约 283 | MIT | 可以 | **分类型对象池**（怪物/弹体/掉落/宝箱/伤害数字）、**spawn 概率/速率 keyframe 曲线**、ScriptableObject 式数据配置、无限背景 | Unity 组件/Prefab/Shader、Kenney 美术、具体数值曲线 |
| [JPTER78/pokesurvivor](https://github.com/JPTER78/pokesurvivor) | 浏览器幸存者类（Phaser） | 约 507 | NOASSERTION | **只能看思路** | 升级三选一节奏、武器进化表结构、刷怪环 | 代码、宝可梦 IP 名称/形象/素材（高风险） |
| [stationch/battle-of-heroes](https://github.com/stationch/battle-of-heroes) | 极小 JS 割草 roguelite | 约 2 | MIT | 可以 | 单文件结构、波次循环、最小 UI | 体量太小，只适合看骨架 |

**重点说明（VampireSurvivorsClone）**
- 它的核心不是"武器多"，而是三件事：
  1. **压力曲线是数据**：敌人出现概率与速率用 keyframe 配置，随时间/波次变化，不写死在 `if (time > 60)`。
  2. **对象池按类型分开**：怪物、弹体、掉落、宝箱、伤害数字各自一个池；伤害数字单独池化是很多人漏掉的性能点。
  3. **数据与表现分离**：角色/关卡/武器用 ScriptableObject（等于本作的 `CONFIG` 对象），调参不改逻辑。
- 不能学：Unity 的组件生命周期、Prefab、Shader；也不能抄它的曲线数值（本作 TTK 不同）。

### 2.3 程序化关卡生成（房间图 / Delaunay + MST / 地牢算法）

| 仓库 | 用途 | 星数 | 许可证 | 只学思路？ | 可借鉴的具体点 | 不可借鉴 |
| --- | --- | --- | --- | --- | --- | --- |
| [majidmanzarpour/threejs-procedural-dungeon](https://github.com/majidmanzarpour/threejs-procedural-dungeon) | 程序化 3D 地牢：散点→分离→Delaunay→MST→回环→房间语义 | 约 515 | MIT | 可以 | **流程图完整**、确定性种子、回环边条件、走廊栅格、重试 | Three.js 渲染、几何体、房间尺寸与美术 |
| [mapbox/delaunator](https://github.com/mapbox/delaunator) | 极快 Delaunay 三角剖分 | 约 2638 | ISC | 可以（不要引入） | sweep-hull 的 O(n log n) 思路、类型化数组、热循环零分配 | 为大规模点集优化的复杂度；本作 N≤7，用 Bowyer-Watson 更简单 |
| [mikolalysenko/cdt2d](https://github.com/mikolalysenko/cdt2d) | 约束 Delaunay（带边界） | 约 266 | MIT | 可以 | 约束边/洞的处理思路 | 依赖较多、体量大 |
| [AsPJT/DungeonTemplateLibrary](https://github.com/AsPJT/DungeonTemplateLibrary) | C++ 地牢生成模板库（20+ 算法） | 约 1466 | BSL-1.0 | 可以 | 生成器分类学：随机房间、BSP、cellular、迷宫、图连通 | C++ 模板/结构不能搬；具体参数不能抄 |
| [stefanweck/dungeongeneration](https://github.com/stefanweck/dungeongeneration) | JS 地牢生成演示 | 约 201 | MIT | 可以 | 参数面板 + 可视化对比；BSP 与随机房间的差异 | 具体尺寸/密度 |
| [ondras/rot.js](https://github.com/ondras/rot.js) | 地图生成器合集 | 约 2726 | BSD-3-Clause | 可以 | Uniform / Digger / Cellular / DividedMaze / Eller / Icey 的适用场景 | 整包代码 |

**重点说明（threejs-procedural-dungeon）**
- 算法链：随机散点 → 分离（避免重叠）→ Delaunay 三角化 → 最小生成树保连通 → 按条件加回环边（形成多条路线）→ 走廊/门 → 房间语义（起点、Boss、商店、宝箱）。
- 回环条件值得学：不是"随便加边"，而是"边长小于 MST 平均边长的某个倍数 + 概率"才加，既保证有环路，又不产生过长走廊。
- 确定性：同一 seed 必得同一图；失败会换种子重试。对本作的验收脚本非常关键。
- 走廊用 `Uint8Array` 栅格标记，绘制与碰撞共用一份数据；比对象数组省内存、缓存友好。
- 不能学：Three.js 的网格/材质、房间装饰、具体倍率（2.2 等）要按本作房间尺寸重算。

### 2.4 Game feel / juice 库

| 仓库 | 用途 | 星数 | 许可证 | 只学思路？ | 可借鉴的具体点 | 不可借鉴 |
| --- | --- | --- | --- | --- | --- | --- |
| [felixmariotto/three-screenshake](https://github.com/felixmariotto/three-screenshake) | 2.4KB 屏震 | 约 19 | MIT | 可以 | **四相位阻尼**（1, -0.6, 0.3, -0.1）+ 二次包络；方向/旋转抖动 | Three.js 时钟/相机 API；代码不搬 |
| [mixandjam/Balatro-Feel](https://github.com/mixandjam/Balatro-Feel) | 复刻 Balatro 的"手感"（C#） | 约 741 | MIT | 可以 | **可中断的动效序列**：缩放冲击→旋转→粒子→数字弹出→落位；同一张卡多个反馈叠加的时序 | Unity 协程/Tween、Balatro 美术/音效/具体曲线 |
| [jotson/ridiculous_coding](https://github.com/jotson/ridiculous_coding) | Godot 屏震插件 | 约 1142 | MIT | 可以 | 参数化 trauma、衰减曲线、最大偏移钳制 | Godot 节点 |
| [kaplayjs/kaplay](https://github.com/kaplayjs/kaplay) | JS 游戏库（含相机/粒子/tween） | 约 1823 | MIT | 可以（不要引入） | 相机 shake 的 API 设计、粒子池、tween 生命周期 | 整包引擎；会破坏零依赖 |
| [flashhawk/spp.js](https://github.com/flashhawk/spp.js) | 轻量粒子系统 | 约 155 | MIT | 可以 | 粒子池 + 发射器参数化（速率/寿命/初速/角度） | 代码不搬；本作已有粒子池 |
| [getify/deePool](https://github.com/getify/deePool) | 高性能对象池 | 约 126 | MIT | 可以 | 空闲链表 O(1) 分配/回收、按类型分池、池上限 | 代码不搬；本作已有对象池，可对照检查 |
| [timohausmann/quadtree-js](https://github.com/timohausmann/quadtree-js) | 四叉树 | 约 639 | MIT | 可以 | 插入/查询的边界处理、批量重建 vs 增量更新 | 本作实体量不大，网格哈希更简单 |

**重点说明（ScreenShake）**
- 它不是"随机偏移"，而是四段阻尼振荡：位移序列约 `1, -0.6, 0.3, -0.1`，再乘二次衰减包络；视觉上是"快速来回几下然后停"，比纯随机更像物理冲击。
- 可加方向性：沿受击方向偏移，横向抖动小于纵向，避免准心被晃飞（本作有瞄准系统，必须克制）。
- 本作现有 `triggerShake` 已经用 `Math.max` + `trauma²`，方向是"一次事件只记峰值"；可以补的是**方向 + 振荡相位 + 每轴频率**，不是推翻重写。

### 2.5 卡牌构筑 roguelike（构筑 / 遗物 / 协同）

| 仓库 | 用途 | 星数 | 许可证 | 只学思路？ | 可借鉴的具体点 | 不可借鉴 |
| --- | --- | --- | --- | --- | --- | --- |
| [oskarrough/slaytheweb](https://github.com/oskarrough/slaytheweb) | 浏览器版 Slay the Spire | 约 319 | **AGPL-3.0** | **只能看思路，禁止复制** | 卡牌是数据对象、动作是 `{type, parameter, conditions}` 数组、条件函数独立、UI 与逻辑同管线 | 任何代码/卡牌文案/数值/美术；AGPL 传染 |
| [DesirePathGames/Slay-The-Robot](https://github.com/DesirePathGames/Slay-The-Robot) | Godot 卡牌 roguelike 框架 | 约 292 | MIT | 可以 | **动作拦截器（遗物改动作）**、**校验器（UI 与逻辑共用）**、内容包、嵌套动作 | Godot 资源/场景；具体卡牌数据 |
| [guladam/deck_builder_tutorial](https://github.com/guladam/deck_builder_tutorial) | Godot 卡牌构筑教程 | 约 455 | MIT | 可以 | 每张卡 = 数据 + 效果资源；效果拆成独立 `.gd`；状态机驱动回合 | Godot 节点结构 |
| [chun92/card-framework](https://github.com/chun92/card-framework) | 通用卡牌 UI/交互框架 | 约 380 | MIT | 可以 | 手牌布局、拖拽/点击、卡面信息层级 | UI 美术与具体布局 |

**重点说明（Slay-The-Robot / slaytheweb）**
- 卡牌不是"一个类一个 `if`"，而是"数据 + 动作数组"：`{type: 'damage', parameter: {...}, conditions: [...]}`。加一张新卡 = 加一条数据，不改执行器。
- **拦截器**：遗物/状态在动作执行前修改动作（加伤害、加目标、改消耗），而不是在伤害函数里写十几个 `if (hasRelic('x'))`。这是本作标签乘算/遗物系统最值得学的地方。
- **校验器**：同一套 `canPlay(card, state)` 同时给 UI 灰显和逻辑拒绝用，避免"按钮能点但打不出"。
- 不能学：AGPL 的 slaytheweb 代码；两边的卡牌表、稀有度、遗物名称；Godot 的资源加载方式。

### 2.6 弹幕编排（补充参考）

| 仓库 | 用途 | 星数 | 许可证 | 只学思路？ | 可借鉴的具体点 | 不可借鉴 |
| --- | --- | --- | --- | --- | --- | --- |
| [daishihmr/bulletml.js](https://github.com/daishihmr/bulletml.js) | BulletML 的 JS 运行时 | 约 102 | 无许可证 | **只能看思路** | 用声明式 DSL 描述 `aim / fan / sequence / repeat / delay` | 代码、XML 解析器、示例弹幕 |
| [emillon/bulletml](https://github.com/emillon/bulletml) | BulletML 参考实现 | 约 99 | BSD-2-Clause | 可以 | 弹幕语法的层级结构（action/sequence/repeat） | OCaml 代码与解析器 |
| [eatfrog/bulletmllib4unity](https://github.com/eatfrog/bulletmllib4unity) | Unity 弹幕库 | 约 40 | MIT | 可以 | 发射器状态、方向/速度曲线、延迟队列 | Unity 组件与具体弹型 |

**结论**：不要引入 BulletML 解析器（XML + 运行时太重，且本作弹幕量级不需要）。只学"**弹幕 = 发射器数据 + 延迟队列 + 序列**"，用本作 `BOSS_SIG_CONFIG` 的声明式结构扩展即可。

---

## 3. 红线：许可证与"零依赖"处理

| 许可证类型 | 可以做什么 | 不可以做什么 | 本项目执行方式 |
| --- | --- | --- | --- |
| MIT / ISC / BSD / BSL-1.0 | 读代码、学算法；必要时可复制小片段（需保留版权头） | 不能把整库拖进来；不能去掉版权声明 | **一律不引入**；只在自己的架构里重写；如参考了具体函数，在文档记录来源 |
| GPL-2.0 / GPL-3.0 | 读思路、读算法、读数据结构 | 不能复制任何代码/文本/资源；复制会导致整个单文件被 GPL 传染 | 只看，不复制；实现必须"独立重写 + 结构不同" |
| AGPL-3.0 | 同上，且网络分发也触发 | 不能复制；不能照搬 UI/数据 | 只看思路；不接触其代码 |
| 无许可证 / NOASSERTION | 视为"保留所有权利" | 不能复制任何代码/资源 | 只看高层思路；不下载代码片段入库 |
| 商业游戏素材/代码 | 不使用 | 反编译、提取、复制都禁止 | 无例外 |

### 3.1 零依赖的执行细则

1. 不引入 npm 包、外部 JS 文件、CDN 脚本、WebFont、图片、音频。
2. 不复制算法源码；只写"适合本作规模"的简化版（例如 N≤7 用 Bowyer-Watson，不用 sweep-hull）。
3. 不复制数据表：房间模板、Boss 弹型角度、卡池权重、道具数值全部按本作 TTK 重算。
4. 不复制命名与文案：Boss 名、卡名、遗物名、UI 文案必须原创。
5. 结构差异要有记录：同一问题采用不同数据结构/参数化方式，写进 `REFERENCE_ORIGINALITY.md` 的"参考记录模板"。
6. 许可证合规：即使未来复制了 MIT 片段，也要在文件头保留版权声明并在 `NOTICE.md` 汇总；本项目当前策略是"零复制"。

### 3.2 "只学思路"的判定

- 能用自己的话讲清算法步骤、复杂度、边界条件 → 算学会。
- 能写出与参考不同的数据结构/命名/参数 → 算独立实现。
- 代码里出现参考项目的函数名、变量名、注释、常量组合 → 越界。
- 玩家一眼说"这不就是 X" → 表现层越界，必须改。

---

## 4. 针对本作六大系统的改造建议

> 所有建议都以"现有函数"为挂载点，不新增引擎。行号对应 `index_arcane_v2.html` 当前版本。

### 4.1 敌人 AI 状态机

**现状**：`updateEnemyThreatV2(enemy, dt, ctx)`（L23755）、`updateEnemies(dt)`（L23990）、`updateBossEnemy`（L9915）、`updateBossSignature`（L10102）。敌人行为分散在多个条件分支里，缺少统一的"预警 → 出手 → 收招"节拍。

**参考**：isaac-webgame 的 `entities.js` 用 `e.state / e.st / e.phase / e.pattern`，核心是：
- `setState(name, duration)` 只做两件事：写状态名、写剩余时间；
- 每帧先减 `st`，`st > 0` 时只跑该状态逻辑，不接收新决策；
- `phase` 由血量比例推进（例如 66% / 33%），推进时只触发一次；
- `pattern` 是一个数组索引，按顺序循环，不随机乱打。

**改造方案**
1. 新增 `AI_PROFILE` 数据表（按敌人类型，不按实例）：
   ```
   {
     idle:      { dur: 0.6 },
     telegraph: { dur: 0.4, tell: 'ring' },
     attack:    { dur: 0.25, damage: 8, pattern: 'fan3' },
     recover:   { dur: 0.35 }
   }
   ```
2. 每个敌人增加 `e.ai = { state:'idle', st:0, phase:0, pattern:0, fired:false }`。
3. 新增 `setEnemyState(e, name)`：写 `state/st/fired=false`；进入 `attack` 时只标记，不立刻结算伤害。
4. 在 `updateEnemyThreatV2` 开头插入 `advanceEnemyAI(e, dt)`，其返回 `true` 时跳过旧逻辑（避免双重决策）。
5. Boss 在 `updateBossEnemy` 里复用同一状态机，但 `phases` 表多两档；`updateBossSignature` 只负责"按 pattern 发射"。
6. 预警必须可见：`telegraph` 状态画地面圈/线段，时长 ≥0.35s；没有预警的伤害一律不允许。

**验收断言**
- A1 连续采样 60 秒：任何造成伤害的动作，之前都存在 ≥0.35s 的 `telegraph` 状态，违规 0 次。
- A2 `e.ai.state` 只能经 `setEnemyState` 改变；静态扫描无直接赋值。
- A3 血量跨过 66% / 33% 时，`phase` 恰好 +1，且只触发一次。
- A4 同屏 60 敌人：平均帧耗 ≤ 基线 +1.5ms，`window.__errors` 为空。
- A5 Boss 连续 10 次攻击中，同一 `pattern` 不超过 2 次。

**不要学**：以撒的敌人名称、攻击形状、血量/伤害数值。

---

### 4.2 弹幕编排

**现状**：`fireEnemyBullet`（L23260）、`updateBossSignature`（L10102）、`BOSS_SIG_CONFIG`（L5176）、`updateBossHazards`（L10178）。弹幕多为即时 `for` 循环发射，缺少"延迟序列 / 旋转 / 多段"。

**参考**：BulletML 的声明式语法（`aim / fan / sequence / repeat / delay`）与 isaac 的 `reps/burst` 数组；只学结构，不引入解析器。

**改造方案**
1. 新增 `BULLET_PATTERN_CONFIG`：
   ```
   fan3:   { shape:'fan', count:3, spreadDeg:40, speed:120, delay:0,   rotatePerShot:0,   aim:'player' }
   spiral: { shape:'ring', count:8, spreadDeg:360, speed:90, delay:120, rotatePerShot:15, aim:'fixed' }
   burst:  { shape:'burst', steps:[{count:5,delay:0},{count:5,delay:180},{count:5,delay:360}] }
   ```
2. 新增 `queueBulletPattern(id, x, y, overrides)`：把步骤压入 `state.pendingShots`（`{t, patternId, origin, step}`），不立刻发射。
3. 新增 `updatePendingShots(dt)`：按真实时间递减 `t`；到点调用 `fireEnemyBullet`；支持 `rotatePerShot` 累加角度。
4. 弹体共用现有对象池；全局上限 300，满了回收最旧的普通弹（Boss 预警弹不回收）。
5. 房间切换/死亡时清空 `pendingShots`，避免"隔房延迟弹"。
6. 瞄准模式只保留 `player / fixed / lastDir` 三种，别做脚本语言。

**验收断言**
- A1 `fan3` 一次恰好 3 发，角度跨度 = 40° ±1°，关于瞄准方向对称。
- A2 `burst` 三段分别在 0/180/360ms 触发，误差 ≤16ms。
- A3 `spiral` 每发旋转 +15°，第 8 发角度 = 起始 +105° ±1°。
- A4 场上弹体达到 300 后不再新增普通弹，且无报错；Boss 预警弹仍可发射。
- A5 房间切换后 `state.pendingShots.length === 0`，旧弹幕不跨房。
- A6 10 组弹幕并发 20 秒：帧耗 ≤ 基线 +1ms。

**不要学**：XML 解析器、BulletML 运行时、现成弹幕表/弹型图。

---

### 4.3 程序化房间图

**现状**：`buildBranchingRooms(count)`（L7543）、`buildFloorGraph(rooms, cols)`（L7876）、`generateFloor(floorNumber)`（L9096）。已有 Delaunay + MST 保连通 + 跨列回环，4–7 房、出生房最左、楼梯房最远。

**参考**：threejs-procedural-dungeon 的完整链路与"回环条件"；isaac 的"失败重试 + 兜底"；delaunator 的"确定性 + 类型化数组"思路。

**改造方案**
1. 新增 `FLOOR_GEN_CONFIG = { maxAttempts:8, minRooms:4, maxRooms:7, loopFactor:2.2, loopChance:0.35 }`。
2. `generateFloor` 改为"尝试 → 校验 → 失败换种子"循环；超过 `maxAttempts` 用 `buildFallbackChain()`（线性 5 房，仍保证起点/楼梯/商店）。
3. 种子派生：`floorSeed = hash(runSeed, floorNumber)`，同 seed + 同层必得同图；房内内容再用 `roomSeed = floorSeed ^ (roomId * 2654435761)`。
4. 回环边条件：`edgeLength < mstMean * loopFactor && rng() < loopChance`；不要无条件加边。
5. 语义分配放在图之后：起点 = 最左；楼梯 = 距起点最远；商店/精英/隐藏按列区间分配，冲突时按优先级重排。
6. 走廊/门用一份栅格数据同时供绘制与碰撞，避免两套坐标。

**验收断言**
- A1 跑 100 个种子：房间数 4–7、图连通、起点最左、楼梯最远，全部通过。
- A2 ≥80% 的楼层存在 2 条边不相交路线；0 个不可达房间。
- A3 同 seed + 同层生成两次，图哈希完全一致。
- A4 单层生成耗时 <8ms；`maxAttempts` 内成功；兜底触发率 ≤1/100。
- A5 所有走廊端点都能落到房间门，无悬空边。

**不要学**：Three.js 几何/材质、房间装饰、具体倍率与尺寸；本作已有自己的房间模板，不要替换。

---

### 4.4 屏震与顿帧叠加

**现状**：`triggerShake(power, time, cap)`（L21000）已用 `Math.max` 记峰值 + `trauma²` 衰减（L11707–11710）；`state.hitStop` 用 `Math.max` 叠加（L22646–22647、L24718），`FEEL_CONFIG`（L3955）定义 60/90/130ms 与 0.16 时间缩放。

**参考**：ScreenShake 的四相位阻尼 + 二次包络；isaac 的 `hitStop = Math.max(...)` 与 `dt *= 0.06`；VSClone 的"伤害数字独立池"。

**改造方案**
1. 保留"峰值叠加"，不改成累加；新增 `shake.dir`（受击方向单位向量）与 `shake.freq`（每轴频率），位移 = 振幅 × 方向 × 振荡相位。
2. 振荡相位用四段序列近似 `1, -0.6, 0.3, -0.1`，包络用 `ratio²`；总时长不变。
3. 分离 `realDt` 与 `simDt`：顿帧只缩 `simDt`（0.16），`realDt` 继续驱动输入、UI、音频与渲染；不要在 `requestAnimationFrame` 里 `sleep`。
4. 上限：`shakeMaxAmp`（建议 8px）与 `hitStopMax`（建议 0.13s）；连续命中只取最大，不叠加时长。
5. 新增 `state.feel.ring`（最近 20 条事件：类型/峰值/时长），供验收与调试面板读取。
6. 伤害数字对象池：击杀/暴击的数字从池里取，1.2s 后回收，避免 GC 峰值。

**验收断言**
- A1 100ms 内 3 次命中：`state.shake.power` 等于三者最大值，不是求和；最终偏移 ≤8px。
- A2 轻/重/击杀顿帧分别 60/90/130ms（±1 帧）；`simDt/realDt === 0.16`（±0.01）。
- A3 顿帧期间输入事件仍被处理（记录按键回调次数 ≥1）。
- A4 连续 10 次震屏后，`cameraOffset` 回到 (0,0)，无漂移。
- A5 开启"减少动态"后：屏震幅度 0，顿帧保留，颜色/数字反馈保留。
- A6 200 次命中压力：帧耗 ≤ 基线 +1ms。

**不要学**：ScreenShake 的 Three.js 时钟/相机代码；Balatro 的具体曲线与美术。

---

### 4.5 卡池权重与保底

**现状**：`pickWeightedOptions(pool, count, weightMul)`（L25263）、`buildRewardOptions(stage)`（L25309）、`REWARD_CONFIG.fusionPityLimit`（L5043）、`state.fusionPity`（L6384、L25364）、重置（L25558）。

**参考**：slaytheweb 的"动作 + 条件"数据管线；Slay-The-Robot 的"拦截器 + 校验器"；VS 的三选一与稀有度权重；RoR2 的分族叠加（仅思路）。

**改造方案**
1. 新增 `PITY_CONFIG = { fusion:5, tagRelic:4, pact:6, ramp:1.15 }`；每类一个独立计数，不要共用一个 `fusionPity`。
2. `buildRewardOptions` 先算"类别层"再算"具体卡"：同一组三选一不允许 3 张同类别；最多 2 张同类别。
3. 软保底：未出目标类别时，该类别权重每层 ×`ramp`，达到阈值直接锁定；锁定优先"未拥有"。
4. `previewOffer(cardId)` 与 `applyReward` 共用同一个 `computeRewardEffect`，保证卡面数字 = 实际结算。
5. 池子不足 3 张时补"余烬/结晶"兜底项，不能死循环。
6. UI 显示保底进度（已有 L25468 的文案，扩展到每类）。

**验收断言**
- A1 模拟 1000 次三选一：融合类在第 5 次前必出（池非空时 100%）。
- A2 3 张同类别出现率 <5%。
- A3 实际类别分布与配置权重偏差 ≤3%。
- A4 获得后只重置该类别计数，其他类别保留。
- A5 池空时不进入无限循环，返回兜底项。
- A6 卡面预览数值与实际结算一致（逐项比对，误差 0）。

**不要学**：StS 的卡牌表/稀有度、VS/Brotato 的具体权重与价格。

---

### 4.6 存档结构

**现状**：`GAME_CONFIG.metaKey`（L3736）、`loadMeta`（L6155）、`saveMeta`（L6168）；音频另有 `AUDIO_SETTINGS_KEY`（L20316）。当前是直接 `JSON.stringify(state.meta)`，缺少版本、校验与迁移。

**参考**：isaac-webgame 没有永久存档（只有单局）——这是反面教材：一旦要加永久进度，必须提前做 schema；VSClone 用 ScriptableObject 存"静态数据"而非存档，说明静态配置与运行状态要分开。

**改造方案**
1. 存档信封：`{ v:2, savedAt, checksum, meta }`；`checksum` 用轻量 FNV-1a（字符串），损坏时回退。
2. 白名单字段：只存 `crystals / bestFloor / talents / difficulty / audio / unlocks`；不存派生值、不存运行中实体。
3. `migrateMeta(v1)`：补默认值、重命名字段、丢弃未知字段；迁移失败回退默认。
4. `saveMeta` 去抖 500ms；页面隐藏/结算时强制落盘；`localStorage` 禁用时用内存副本。
5. 数组长度上限（如 `unlocks ≤ 200`），防止异常数据撑爆。
6. 导出/导入：Base64(JSON)，导入前走同一套校验与迁移。

**验收断言**
- A1 写入损坏 JSON / 错误类型：`loadMeta` 返回默认值，不抛异常，只 1 条警告。
- A2 缺字段：仅该字段取默认，其他字段保留。
- A3 v1 → v2 迁移后 `crystals/bestFloor/talents` 数值不变。
- A4 100 次 save/load：深比较完全一致，存档 <20KB。
- A5 `localStorage` 抛异常（隐私模式）：游戏可玩，使用内存存档。
- A6 导入非法 Base64：拒绝并提示，不覆盖现有存档。

**不要学**：把整个 `state` 直接序列化；把静态配置写进存档；无版本号。

---

## 5. 三个"只有开源代码里才看得到"的技巧

### 技巧 1：生成失败要"换种子重试 + 兜底"，而不是相信一次成功

- 来源：isaac-webgame 的 `dungeon.js`（重试若干次后走线性兜底）、threejs-procedural-dungeon 的 `tryGenerate`（失败后 `seed = imul(seed, 9301) + 49297` 再试）。
- 设计文章通常只讲"用 Delaunay + MST"，不会讲**失败处理**；代码里才看得到：随机生成一定会遇到退化情况（点共线、房间重叠、图不连通），必须有限次重试 + 兜底，否则玩家会遇到"这层没楼梯"。
- 本作落点：`generateFloor`（L9096）加 `maxAttempts` 与 `buildFallbackChain()`；验收用 100 个种子跑连通性。
- 附带技巧：`roomSeed = floorSeed ^ (roomId * 2654435761)`，让房内内容也确定，而不是每次重开都变。

### 技巧 2：顿帧用"取最大值 + 缩模拟时间"，不是暂停循环

- 来源：isaac-webgame 的 `hitStop = Math.max(hitStop, newStop)`，随后 `dt *= 0.06`；本作已有 `state.hitStop = Math.max(...)`（L22647）与 `hitStopScale = 0.16`（L3963）。
- 设计文章说"加 60ms 顿帧"，但不会说：
  - 多次命中要取最大值，否则连击会把游戏冻住；
  - 只缩"模拟时间"，输入/渲染/音频继续跑，否则玩家会觉得输入丢失；
  - 顿帧期间不要 `while` 等待，必须每帧递减。
- 本作落点：分离 `realDt/simDt`，保留 `Math.max`；验收断言 `simDt/realDt = 0.16` 且输入仍响应。

### 技巧 3：卡牌/遗物效果用"数据 + 拦截器 + 共用校验"，避免 UI 与逻辑两套实现

- 来源：slaytheweb 的 `CardAction { type, parameter, conditions }` 与独立 `conditions.js`；Slay-The-Robot 的 action interceptors（遗物在动作执行前改参数）与 validators（UI 灰显与逻辑拒绝共用）。
- 设计文章只讲"要有协同"，代码里才看得到实现边界：
  - 新卡 = 新数据，不改执行器；
  - 遗物不散落在伤害函数里，而是在管线里拦截；
  - 卡面预览与实际结算走同一函数，杜绝"写着 5 实际 7"。
- 本作落点：`buildRewardOptions`（L25309）与卡面/融合提示共用 `computeRewardEffect`；遗物/标签乘算继续走 `collectMods`（L21475），但把"修改动作"的钩子集中到一处，不要在 `damageEnemy` 里堆 `if`。

---

## 6. 建议施工顺序（小批量，每轮一个可验证单元）

| 顺序 | 单元 | 参考 | 挂载点 | 验收脚本 | 预估 |
| --- | --- | --- | --- | --- | --- |
| 1 | 存档 schema v2 + 迁移 | isaac（反面）、VSClone（静态/运行分离） | `loadMeta` / `saveMeta` | `arcane_save.js` | 0.5–1 人日 |
| 2 | 屏震方向化 + realDt/simDt 分离 | ScreenShake、isaac | `triggerShake` / 主循环 | `arcane_feel.js` | 0.5 人日 |
| 3 | 分类保底 + 预览同源 | slaytheweb、Slay-The-Robot | `buildRewardOptions` / `pickWeightedOptions` | `arcane_reward.js` | 0.5–1 人日 |
| 4 | 敌人 AI 状态机（先普通敌人，后 Boss） | isaac `entities.js` | `updateEnemyThreatV2` / `updateBossEnemy` | `arcane_ai.js` | 1.5–2 人日 |
| 5 | 声明式弹幕（先 3 个 pattern） | BulletML（只学结构） | `fireEnemyBullet` / `updateBossSignature` | `arcane_bullets.js` | 1–1.5 人日 |
| 6 | 楼层图重试/兜底/回环条件 | threejs dungeon、isaac | `generateFloor` / `buildFloorGraph` | `arcane_floor.js` | 1 人日 |

合计约 **5–7 人日**。每轮必须跑专项 + 核心回归（`arcane_verify.js`、`arcane_u1.js`、`arcane_fusion.js`、`arcane_c7.js`），全绿才进下一轮。

---

## 7. 仓库来源总表

| 仓库 | 分类 | 星数（约） | 许可证 | 结论 |
| --- | --- | --- | --- | --- |
| [liyupi/binding-of-isaac-webgame](https://github.com/liyupi/binding-of-isaac-webgame) | 动作 roguelike | 77 | MIT | 只学架构与测试法 |
| [KilledByAPixel/SpaceHuggers](https://github.com/KilledByAPixel/SpaceHuggers) | 动作射击 | 288 | GPL-3.0 | 只看思路，禁止复制 |
| [Larkenx/Rotten-Soup](https://github.com/Larkenx/Rotten-Soup) | 浏览器 roguelike | 408 | GPL-3.0 | 只看思路，禁止复制 |
| [stefanweck/dungeongeneration](https://github.com/stefanweck/dungeongeneration) | 地牢生成 | 201 | MIT | 只学生成器对比 |
| [ondras/rot.js](https://github.com/ondras/rot.js) | roguelike 工具箱 | 2726 | BSD-3-Clause | 只学 RNG/FOV/A* |
| [PubDeer/astro-loop](https://github.com/PubDeer/astro-loop) | 动作 roguelike | 151 | GPL-3.0 | 只看思路 |
| [Bozar/GodotRoguelikeTutorial](https://github.com/Bozar/GodotRoguelikeTutorial) | 极简 roguelike | 278 | MIT | 只学结构 |
| [matthiasbroske/VampireSurvivorsClone](https://github.com/matthiasbroske/VampireSurvivorsClone) | 幸存者类 | 283 | MIT | 只学对象池与压力曲线 |
| [JPTER78/pokesurvivor](https://github.com/JPTER78/pokesurvivor) | 幸存者类 | 507 | NOASSERTION | 只看思路，禁止素材 |
| [stationch/battle-of-heroes](https://github.com/stationch/battle-of-heroes) | 幸存者类（极小） | 2 | MIT | 只看骨架 |
| [majidmanzarpour/threejs-procedural-dungeon](https://github.com/majidmanzarpour/threejs-procedural-dungeon) | 关卡生成 | 515 | MIT | 只学算法链 |
| [mapbox/delaunator](https://github.com/mapbox/delaunator) | Delaunay | 2638 | ISC | 只学复杂度与数据布局 |
| [mikolalysenko/cdt2d](https://github.com/mikolalysenko/cdt2d) | 约束 Delaunay | 266 | MIT | 只学约束边 |
| [AsPJT/DungeonTemplateLibrary](https://github.com/AsPJT/DungeonTemplateLibrary) | 地牢算法合集 | 1466 | BSL-1.0 | 只学分类学 |
| [felixmariotto/three-screenshake](https://github.com/felixmariotto/three-screenshake) | 屏震 | 19 | MIT | 只学阻尼公式 |
| [mixandjam/Balatro-Feel](https://github.com/mixandjam/Balatro-Feel) | 手感复刻 | 741 | MIT | 只学动效序列 |
| [jotson/ridiculous_coding](https://github.com/jotson/ridiculous_coding) | 屏震插件 | 1142 | MIT | 只学参数化 |
| [kaplayjs/kaplay](https://github.com/kaplayjs/kaplay) | JS 游戏库 | 1823 | MIT | 只学 API 设计 |
| [flashhawk/spp.js](https://github.com/flashhawk/spp.js) | 粒子 | 155 | MIT | 只学发射器参数 |
| [getify/deePool](https://github.com/getify/deePool) | 对象池 | 126 | MIT | 只学空闲链表 |
| [timohausmann/quadtree-js](https://github.com/timohausmann/quadtree-js) | 四叉树 | 639 | MIT | 只学查询边界 |
| [oskarrough/slaytheweb](https://github.com/oskarrough/slaytheweb) | 卡牌 roguelike | 319 | AGPL-3.0 | 只看思路，禁止复制 |
| [DesirePathGames/Slay-The-Robot](https://github.com/DesirePathGames/Slay-The-Robot) | 卡牌框架 | 292 | MIT | 只学拦截器/校验器 |
| [guladam/deck_builder_tutorial](https://github.com/guladam/deck_builder_tutorial) | 卡牌教程 | 455 | MIT | 只学效果资源拆分 |
| [chun92/card-framework](https://github.com/chun92/card-framework) | 卡牌 UI 框架 | 380 | MIT | 只学布局与交互 |
| [daishihmr/bulletml.js](https://github.com/daishihmr/bulletml.js) | 弹幕 | 102 | 无许可证 | 只看思路，禁止复制 |
| [emillon/bulletml](https://github.com/emillon/bulletml) | 弹幕语法 | 99 | BSD-2-Clause | 只学层级结构 |
| [eatfrog/bulletmllib4unity](https://github.com/eatfrog/bulletmllib4unity) | 弹幕 | 40 | MIT | 只学发射器状态 |

---

## 附：一句话总结

同约束下最值得看的是 `binding-of-isaac-webgame`（架构 + 测试），算法最值得看的是 `threejs-procedural-dungeon`（Delaunay→MST→回环→语义），工程化最值得看的是 `VampireSurvivorsClone`（压力曲线 + 分池），系统设计最值得看的是 `Slay-The-Robot`（拦截器 + 校验器），手感最值得看的是 `ScreenShake`（2.4KB 的阻尼公式）。所有仓库都只学思路：GPL/AGPL/无许可证一律不碰代码，MIT 也不引入，全部重写成适合"单文件零依赖 + 4–7 间房 + Canvas 2D"的简化实现。
