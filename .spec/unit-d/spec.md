# 单元 D · 场景 UI 装置感（spec）

## 目标（用户原话拆解）
1. HUD 不再是"贴在画布上的网页框"：面板带材质（内发光、扫描线、铆钉 / 符文边），边角与场景色调联动。
2. 数值变化有扫描 / 翻牌动效。
3. 楼层信息做成左侧竖排装置。
4. 卡牌区带材质与稀有度光。
5. 场景内可交互物（门 / 楼梯 / 裂隙 / 宝箱 / 秘藏裂纹）统一视觉语言：同一套边框光、高亮、交互提示字。
6. 小地图做成"终端屏幕"质感（网格、扫描线、边框），与主 HUD 同源。
7. 验收：同屏截图对比、层级检查（无遮挡 / 无越界）、11px 字号下限与对比度、fps ≥ 60。

## 约束（不变）
- 单文件 `index_arcane_v2.html`，零依赖、不下载图片、纯程序化绘制，`file://` 可玩。
- 不改既有玩法数值；HUD 只做视觉与排版。
- 保留 `--fs-xs: 11px` 字号下限；新增文本一律 ≥ 11px。
- BGM 默认关闭、6/6 卡池、三档稀有度、每层末 Boss 两阶段均不动。

## 方案（为什么这样做）
**不改 DOM 结构，只叠样式层。** 旧 HUD 的 DOM/A11y 与既有验收脚本全部依赖现有节点，
重建 DOM 风险高、回归面大。单元 D 的做法是：
- 在 CSS 里用多层 `background` 叠出「扫描线 + 四角铆钉 + 金属渐变 + 内发光」，
  统一挂在 `body.ui-v2` 下；同一份构建可 `setUiV2(false)` 回到旧观感做 A/B。
- 数值动效由 `setHudValue()` 选择 `is-scan`（新）/ `is-bump`（旧）。
- 楼层竖排：`.floor-panel` 左缘加导轨（`::after` 刻度线），`FLOOR` 标签改用 `writing-mode: vertical-rl`。
- 交互物统一语言：新增 `drawInteractFrame()`（四角支架 + 呼吸描边 + 扫描光带 + 提示牌），
  由楼梯 / 可通行门 / 虚空裂隙 / 秘藏暗纹共同调用。宝箱在本作是"清房即结算"，
  没有独立实体的宝箱立绘，因此只保留房间类型色与结算文案，不额外造一个假宝箱（见"判断不做"）。
- 小地图：在 `drawMinimap()` 最底层铺网格 + 扫描带 + 外框四角，玩法信息照旧画在上面。
- 小地图面板整体上移 44px（`@media (min-height: 820px)`），修掉与底部卡组的 34px 实际重叠。

## 验收口径
| 项 | 口径 |
|---|---|
| A/B 截图 | `unitd-before-*` 与 `unitd-after-*` 同机位 6 组 |
| 面板装置化 | `backgroundImage` 含 `repeating-linear-gradient` 与 `radial-gradient`；`boxShadow` 含 `inset` |
| 楼层装置 | `::after` 有刻度线；`writing-mode === 'vertical-rl'` |
| 数值动效 | `animationName === 'valueScan'` |
| 卡牌 | 卡面扫描线；稀有/史诗 `boxShadow` 含 `inset` 档位光 |
| 小地图 | 边框色 `rgba(62,230,255`、内发光 `inset`、网格抽样 14 行 ≥ 3 行偏青 |
| 交互物 | `INTERACT_UI_CONFIG` 存在、提示字号 ≥ 11px；离屏探针金色像素 ≥ 300 |
| 字号 | deckTitle / floorRow / floorLabel / minimapHead ≥ 11px |
| 版面 | 三块面板无重叠、全部在 1440×900 视口内 |
| 性能 | avg fps ≥ 60、平均帧 ≤ 16.7ms、errors 0 |

## 判断不做（附理由）
1. **不做 DOM 级"铆钉元素"**：每个铆钉一个 `<i>` 会让 HUD 节点数翻倍，且 11px 以下装饰不参与语义；用 `radial-gradient` 画铆钉，零节点、零布局风险。
2. **不做独立宝箱实体**：宝箱房的设计是"清房即结算"（`ROOM_TYPE_CONFIG.chestReward`），凭空加一个立绘会与结算时机冲突，需要改玩法；本单元只统一视觉，不改玩法。
3. **不换 HUD 字体**：现有 `--mono` 已在用 Cascadia/Consolas，换字体涉及离线可用性（不能下载字体），会破坏零依赖约束。
