# P1 符文刻印台 · 任务拆解

- [x] T1 数据层：`ENGRAVE_CONFIG` + `state.engrave` 初始化 + `getState()` 暴露
- [x] T2 生成层：`spawnEngraveStations()`（休整房固定 / 商店 50%），挂到 `generateFloor()`
- [x] T3 结算层：`applyEngrave()` 八条校验 + 调 `applyTagPatch()` + 扣费 + `renderTagBar()`
- [x] T4 交互层：`tryEngraveInteract()` + E 键链路插入（刻印优先于商店）
- [x] T5 面板层：`#engravePanel` DOM + CSS + `PANEL_CONFIG.engrave` + 三列渲染 + 确认/取消
- [x] T6 表现层：台座绘制 `drawEngraveStations()` + 世界层调用 + 刻印粒子/浮字
- [x] T7 调试口：`__roamDebug.engrave` 六个方法
- [x] T8 验收：`tools/arcane_engrave.js` 7/7 + 语法检查通过（核心回归串行在 P1 收尾轮执行）
- [ ] T9 落盘：`PROGRESS.md`（已完成）+ 验收清单勾选（待办）
