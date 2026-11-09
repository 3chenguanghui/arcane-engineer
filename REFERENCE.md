# 参考与拆解（REFERENCE）

> 目的：为「打击感 / 美术质感」找可移植的手法。**只读思路，不引入任何第三方文件、库、图片、音频**（单文件零依赖硬约束不变）。
> 许可证策略：
> - **MIT / Apache-2.0**：允许参考实现手法；若移植代码片段，必须在片段上方注释 `来源: <repo URL> · <许可证>`，并在 `NOTICE.md` 汇总。
> - **GPL / AGPL**：**只取思路，绝不复制代码**。
> - **无明确许可证**：按「只读、不可复制」处理，仅记录结构性结论。
> - 外部素材（贴图 / 音频 / 精灵）一律不引入，纹理与音效继续程序化生成。

---

## 方向 1：俯视角 / 自动射击 roguelike 的结构

### 1-A [SurvivorsStarterKit](https://github.com/DarkRewar/SurvivorsStarterKit) · MIT · Godot 4
- **可取之处**：把「刷怪」拆成三层——`spawn budget`（每秒可刷怪预算，随分钟增长）、`wave curve`（精英/群组的配比曲线）、`boss cadence`（Boss 间隔）。升级池用权重表 + 保底（连续几次没出稀有就强制提权）。
- **明显不适用**：GDScript 与场景树架构、`.tscn` 资源；跨引擎无移植价值。
- **我们改成什么**：只借鉴「预算 / 曲线 / 保底」三段式，落在现有 `spawn` 逻辑的权重表上；不引入任何代码。

### 1-B [pokesurvivor](https://github.com/JPTER78/pokesurvivor) · 许可证未标注 → **仅读思路**
- **可取之处**：纯 HTML/CSS/JS + Canvas 2D、零引擎；420 敌人/帧约 3ms。关键手法是「实体池 + 空间分桶（网格）索敌/碰撞 + 每帧只遍历镜头邻域」。
- **明显不适用**：精灵来自 PMD SpriteCollab（非商用），绝不可取素材；项目体积大、结构耦合。
- **我们改成什么**：`arcade` 已在用「镜头裁剪 + 视口内实体」，本轮只补「索敌分桶」的桶大小与遍历顺序，确保同屏 60 敌人时索敌 O(n·k) 而不是 O(n²)。

### 1-C [Survivor.io 多人 Demo](https://godotengine.org/asset-library/asset/3131) · MIT
- **可取之处**：服务端权威 + 波次状态机（`idle → spawn → fight → clear`），清房演出与刷怪严格串行。
- **明显不适用**：多人同步、WebSocket、服务器成本；我们是单机。
- **我们改成什么**：借用「清房演出必须先于下一波」的串行约束，作为 FEEL_TARGETS 的「清房时长」断言依据。

---

## 方向 2：game feel / juice

### 2-A [Juicee](https://github.com/Kelpekk/Juicee) · MIT · Godot 4
- **可取之处**：把反馈拆成可组合原子：shake / hit-stop / squash / flash / shader。**hit-stop 用时间缩放 0 的短窗口**，shake 用 `trauma²` 衰减（比线性更"高级"）。
- **明显不适用**：Godot 节点与可视化图编辑器。
- **我们改成什么**：现有 `FEEL_CONFIG` 对齐为「原子反馈表 + 统一 play() 入口」；顿帧用 `timeScale=0` 的短窗口（已有实现，只需校参数）。

### 2-B [Sparkle Lite](https://godotengine.org/asset-library/asset/5066) · MIT
- **可取之处**：`FeedbackPlayer` 一次 `play()` 触发整套反馈，默认参数可参考（shake ≈ 0.25s、幅度个位数像素、flash 1–2 帧）。
- **明显不适用**：编辑器内可视化编排。
- **我们改成什么**：`playHitFeel(kind)` 一个入口按 kind 触发顿帧+屏震+闪白+粒子+音阶，参数集中在 `FEEL_CONFIG`。

### 2-C [Trauma](https://godotengine.org/asset-library/asset/4933) · MIT
- **可取之处**：trauma 累积、按 `trauma²` 衰减、上限 1.0；不同事件只加 trauma 不加"直接位移"。
- **明显不适用**：Camera2D 插件形态。
- **我们改成什么**：屏震改成 trauma 池（同一帧多事件叠加），幅度 = `maxAmp × trauma²`。

### 2-D 「Juice it or lose it」（GDC 演讲，理念引用，无代码）
- **可取之处**：tween 的缓动、挤压拉伸、音高抖动、粒子爆发是"廉价高收益"的四件套。
- **我们改成什么**：把这四件套写进 FEEL_TARGETS 的验收项（缓动曲线、缩放 punch、音阶、粒子数）。

---

## 方向 3：2D 后处理（低成本）

### 3-A [pixi-filters](https://github.com/pixijs/filters) · MIT
- **可取之处**：`AdvancedBloom`（阈值 → 多级降采样模糊 → 加法合成）、`Glitch`（RGB 通道横向撕裂 + 扫描线）、`ChromaticAberration`（径向色差）、`CRT`。
- **明显不适用**：依赖 WebGL 滤镜管线；我们是 Canvas 2D，不能上 shader。
- **我们改成什么**：Canvas 2D 等价实现——亮度阈值用 `globalCompositeOperation='lighter'` + 低分辨率离屏 + `ctx.filter='blur(Npx)'`；色差只在受击/暴击瞬间用三通道偏移贴图（低成本、短时）。

### 3-B [Bloom（Canvas 2D 配方）](https://cdn.jsdelivr.net/npm/baes-game-maker@4.0.0/knowledge/recipes/shader-effects.md)
- **可取之处**：提取亮部 → **两次 box blur（水平+垂直）** → 加法合成；不需要高斯，成本可控。
- **我们改成什么**：`FEEL_CONFIG.bloom` 用 1/4 分辨率离屏 + 2 次 box blur，只在"高能时刻"（暴击/清房/Boss 阶段）开启，常态关闭。

### 3-C [lite-fireworks](https://www.npmjs.com/package/@zakkster/lite-fireworks) · 许可证未标注 → 仅读思路
- **可取之处**：拖尾用「整屏半透明填充 + `lighter` 叠加粒子」，衰减残影几乎零成本。
- **我们改成什么**：爆炸残影统一走 `lighter`，不再逐粒子画渐变。

---

## 方向 4：UI 与卡牌表现

### 4-A [card-foil](https://www.npmjs.com/package/card-foil) · MIT
- **可取之处**：全息箔用**单层超大渐变 + 位移**，绝不每帧重绘渐变；稀有度越高，箔层越亮。
- **我们改成什么**：史诗/遗物卡加一层 `--mat-sheen` 的位移高光（CSS `background-position` 过渡），只在 hover 时动，避免持续重绘。

### 4-B [crd-ui](https://github.com/JuandaGarcia/crd-ui) · MIT
- **可取之处**：零依赖 vanilla 卡牌组件；四态（normal/hover/selected/disabled）+ `focus-visible` ring 的组合写法。
- **我们改成什么**：A3 已落地的四态令牌化，可直接对照其 `transition: border-color, box-shadow, translate` 的过渡属性白名单（避免全属性过渡导致掉帧）。

### 4-C [sukuna-ui 卡牌文档](https://raw.githubusercontent.com/arielplas/sukuna-ui/HEAD/docs/llms/card.md) · MIT
- **可取之处**：`tone`（语义色）与 `elevation`（阴影层级）正交拆分；交互态只改 `border-color / box-shadow / translate`。
- **我们改成什么**：把这套正交关系固定为 `--surface-1/2/3`（elevation）× `--rar-*`（tone），已在 A3 实现。

---

## 许可证风险汇总

| 仓库 | 许可证 | 风险 | 用法 |
| --- | --- | --- | --- |
| SurvivorsStarterKit | MIT | 低 | 只借鉴结构，未复制代码 |
| pokesurvivor | 未标注 | **高** | 只读结论，不复制代码/素材 |
| Survivor.io Demo | MIT | 低 | 只借鉴串行约束 |
| Juicee / Sparkle Lite / Trauma | MIT | 低 | 参数与算法思路 |
| pixi-filters / card-foil / crd-ui / sukuna-ui | MIT | 低 | 思路与参数 |
| baes-game-maker 配方 | 未标注（npm 包内文档） | 中 | 只采用通用 bloom 配方（阈值+box blur+加法，属公有做法） |
| lite-fireworks | 未标注 | 中 | 只采用"整屏淡出 + lighter"通用做法 |

**结论**：本轮**不复制任何第三方代码**，只把通用算法（阈值 bloom、trauma² 震屏、时间缩放顿帧、加权刷怪）以自写实现落地，因此无需新增 NOTICE 条目；若后续要移植 MIT 片段，再按策略补注释与 NOTICE。
