# 单元 D · 场景 UI 装置感（tasks）

- [x] D-0 before 基准：`node tools/arcane_unitd.js before`（6 张同机位截图）
- [x] D-1 HUD 装置材质：`.hud-deck / .floor-panel / .minimap-panel / .hud-record` 扫描线 + 铆钉 + 内发光 + 符文边角（`body.ui-v2` 作用域）
- [x] D-2 数值扫描翻牌：`setHudValue()` 新态用 `is-scan` + `@keyframes valueScan`（旧态保留 `is-bump`）
- [x] D-3 左侧竖排楼层装置：`padding-left` + `::after` 导轨刻度 + `floor-head span` 竖排（11px）
- [x] D-4 卡牌材质与稀有度光：卡面扫描线 + 两枚角铆钉；稀有/史诗改内发光档位光
- [x] D-5 交互物统一语言：`INTERACT_UI_CONFIG` + `drawInteractFrame()`；接入楼梯 / 可通行门 / 虚空裂隙 / 秘藏暗纹
- [x] D-6 小地图终端：canvas 内网格 + 扫描带 + 外框四角；CSS 边框 + 内发光；面板上移 44px 修重叠
- [x] D-7 专项验收：`node tools/arcane_unitd.js after` → **21/21 PASS**
- [x] D-8 回归 14 套 + PROGRESS 落盘
