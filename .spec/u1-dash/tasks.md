# L1 · 冲刺穿身挂「裂印」（tasks）

- [x] L1-0 `DASH_MARK_CONFIG` + `state.dashMarkV1` 开关
- [x] L1-1 穿身检测 `applyDashMarks()`：dash 期间距离 < 半径和 + 6 → 挂印（每敌一次）
- [x] L1-2 `tickDashMarks(dt)`：3s 倒计时
- [x] L1-3 `damageEnemy()` 读印：×1.4 + 命中即消耗
- [x] L1-4 `detonateDashMark()`：70px / 18 伤害（首领 50%）+ `state.detonating` 防递归
- [x] L1-5 `drawDashMark()`：紫色双环 + 剩余时间刻度
- [x] L1-6 `tools/arcane_l1.js`（端口 9489）：before/after 截图 + 14 组断言（fps 跳过首帧）
- [x] L1-7 14 套回归 + PROGRESS
