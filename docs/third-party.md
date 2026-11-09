# 第三方来源登记

> 硬线：仅接受 **MIT / Apache-2.0 / BSD-2 / BSD-3 / CC0**；字体可接受 **SIL OFL 1.1** 并注明出处。
> 排除 NC、ND、无许可证仓库。本项目只取“分区结构与信息顺序”，不复制任何源代码、贴图或字体文件；
> 颜色、圆角、字体、间距一律改用《烬》主文件 `:root` 里已有的令牌。

---

## 技能卡（ui-lab/技能卡.html）

### 1. DesirePathGames / Slay-The-Robot

- 地址：https://github.com/DesirePathGames/Slay-The-Robot
- 许可证：**MIT**（GitHub `license.spdx_id = mit`，约 293★，Godot 4 Roguelike 卡牌框架）
- 引用文件：`scenes/ui/card/Card.tscn`（只读节点树）
- 取用部分：卡面**分区顺序**
  - 费用是独立节点（`EnergySprite` + `EnergyCost`），不写进描述
  - 名称与类型分行（`CardName` / `CardType`）
  - 底部修饰容器（`CardDecoratorContainer`，VBox），用来堆叠融合/关键词提示
- 改动：没有复制任何 GDScript、场景或美术资源。仅把上述顺序翻成 CSS：耗蓝独立成格、类型独立成 tag、融合提示独立成一行；
  颜色改用 `--tech #3EE6FF` / `--rar-*` / `--gold #FFC247`，圆角 12px，文案全部中文。

### 2. guladam / deck_builder_tutorial

- 地址：https://github.com/guladam/deck_builder_tutorial
- 许可证：**MIT**（GitHub `license.spdx_id = mit`，约 455★，Godot 4 卡牌教程工程）
- 引用文件：`scenes/ui/card_visuals.tscn`、`scenes/ui/battle_over_panel.tscn`
- 取用部分：
  - 卡面四槽位 `Panel / Cost / Icon / Rarity` —— 稀有度必须**单独占槽**，不能塞进标题
  - 结算面板的 `VBoxContainer` 顺序：`Label`（结论）→ `ContinueButton`（主）→ `MainMenuButton`（次）
- 改动：同上，只借结构。稀有度改为“菱形刻度 + 描边粗细 + 文字”三路编码；
  结算页改为“结论 → 大数 → 明细 → 主按钮 → 次按钮”，并按《烬》现有按钮样式重画。

### 3. 检查后排除

- **oskarrough / slaytheweb**（https://github.com/oskarrough/slaytheweb）：GitHub `license.spdx_id = agpl-3.0`。
  视觉最接近，但 AGPL 不符合本项目许可证硬线，**只做对照，不取用任何内容**。
- Godot 引擎资产（`.tscn` / `.tres`）未复制进交付物；本交付为单文件 HTML/CSS，双击即可打开。

---

## 字体

- **Cascadia Mono**（Cascadia Code 家族，Microsoft）：**SIL OFL 1.1**。
  主文件已把它写在 `--mono` 回退栈里，属于系统字体调用，不随包分发字体文件；本原型沿用同一栈。

---

## 结算面板（ui-lab/结算.html）

结算页**没有新增仓库**，只落地了上面已登记的两条来源中的结构约定，外加一处"对照但排除"。

### 1. 已取用：guladam / deck_builder_tutorial

- 引用文件：`scenes/ui/battle_over_panel.tscn`
- 许可证：**MIT**（与上文同一条登记）
- 取用部分：结算面板的容器顺序 **`Label`（结论）→ `ContinueButton`（主操作）→ `MainMenuButton`（次操作）**
- 落到方案 A「结论条」：
  - 结论在最上、按钮在最下，中间才是数字与明细；
  - 主按钮 46px 填色、次按钮 38px 描边，差值靠**高度 + 填充**而不是颜色；
  - 三个大数的位置顺序改为《烬》已有的字段：楼层 → 用时 → 击杀。
- 改动：没有复制任何 `.tscn` / GDScript / 美术资源；颜色全部换成主文件令牌
  （`--tech` / `--text-3` / `--good` / `--r-sm`），文案为中文，差值可视化是本次新写的
  （箭头 `▲` + 正负号 + 颜色，解决色盲只靠颜色读不出方向的问题）。

### 2. 已取用（原则级）：DesirePathGames / Slay-The-Robot

- 引用文件：`scenes/ui/card/Card.tscn`
- 取用部分：**"数值不写进描述"的分区原则**（费用是独立节点，不混在 `CardDesc` 里）。
- 落到结算页：把"楼层 / 用时 / 击杀"从长句叙述里抽出来，单独成三格。
- 改动：只迁移原则，没有复制节点树或代码。

### 3. 对照后排除：oskarrough / slaytheweb

- 许可证：**AGPL-3.0**，不符合本项目许可证硬线。
- 处理：仅作为"卡牌 / 结算视觉"的对照参考，**不取用任何代码、样式、贴图或文案**。

### 4. 本轮未新增任何第三方资源

结算页的颜色、圆角、字号、间距全部来自主文件 `:root`；没有引入新字体、新图标库或新图片。
`ui-lab/结算.html` 是单文件 HTML/CSS，双击即可打开。

