# U7 · 任务拆解

| # | 任务 | 产出 | 状态 |
|---|---|---|---|
| U7-0 | 写 spec（根因 / 模板表 / 三层几何模型 / 断言 / 取舍） | `.spec/u7-rooms/spec.md` | ✅ |
| U7-1 | 新增 `ROOM_TEMPLATE_CONFIG` + `state.roomShapeV1 / walkBlockers / walkCircles` | `index_arcane_v2.html` | ✅ |
| U7-2 | `assignRoomTemplates()`：主题×模板分配（出生/休整=rect，首领=circle） | 同上 | ✅ |
| U7-3 | `addRoomWalkArea()` + `isWalkBlocked()`；`isWalkableCircle()` 接入并集/减法 | 同上 | ✅ |
| U7-4 | `nudgeOutOfBlockers()`：刷怪 / 出生点避开立柱与缺口 | 同上 | ✅ |
| U7-5 | `paintRoomShapeMask()`：切角 / 缺口 / 圆外压暗 + 边界描边 | 同上 | ✅ |
| U7-6 | `drawRoomPillars()`：运行时柱身（`drawScene()` 之后） | 同上 | ✅ |
| U7-7 | `state.decor` 按形状过滤（跳过画在缺口里的符文圈/角节点） | 同上 | ✅ |
| U7-8 | `__roamDebug`：`setRoomTemplates / roomShapeAudit / walkProbe / pillarProbe` | 同上 | ✅ |
| U7-9 | 新建 `tools/arcane_u7.js`（端口 9495，13 项断言 + 4 张截图） | `tools/arcane_u7.js` | ✅ |
| U7-10 | 语法检查 + 验收 13/13 + 14 套回归 + `PROGRESS.md` 落盘 | `PROGRESS.md` | ✅ |
