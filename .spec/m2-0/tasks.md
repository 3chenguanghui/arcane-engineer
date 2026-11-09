# M2-0 任务拆解

- [x] T0 快照 + 规格落盘
- [x] T1 配置：`worldWidth/Height = 2600/1900`、`roomColumns = 3`、`FOG_CONFIG`
- [x] T2 布局：`buildBranchingRooms` + `connectBranchingRooms` + `state.floorGraph`
- [x] T3 兜底房与出生/楼梯：新世界坐标、`getSpawnRoom` 兼容、`state.spawnRoomId`
- [x] T4 迷雾状态：`state.fog`、`revealRoom`、换层重置
- [x] T5 迷雾渲染：`fogCanvas` + `drawFog` + render 顺序
- [x] T6 小地图迷雾门控
- [x] T7 `drawScene` 源矩形裁剪
- [x] T8 粒子对象池 + 绘制裁剪 + `drawStats`
- [x] T9 调试接口：`world / layout / fog / drawStats / particlePool`
- [x] T10 `tools/arcane_m18.js` 专项（23 条断言，全绿）
- [x] T11 全套回归 + 视口体检（verify/flow3/p1a_ui/facing/fusion/m12/m13 全绿；m14–m17 与 audit 已在 M2-0a 轮跑过 issues=0）
- [x] T12 更新清单与 PROGRESS

## M2-0b 分支图升级（补充）

- [x] T13 Delaunay（暴力空圆检验）+ Kruskal MST + 退化兜底 `connectBranchingRooms`
- [x] T14 `attachLoopRoutes` 跨列优先加回环边 + `findSimpleRoutes` DFS 枚举
- [x] T15 `ensureRouteVariety` 保证两条路线风险/收益不同；`getState().layout` 暴露 `treeEdges/loopEdges/routes/routeVariety`
- [x] T16 `tools/arcane_m19.js` 专项（23 条断言，全绿）、核心回归 7 套全绿、PROGRESS 留痕

## M2-0c 迷雾复测与完善（补充）

- [x] T17 迷雾改世界空间累积擦洞（2600×1900 离屏层，每帧只贴可见块）
- [x] T18 走廊按路径揭示（`corridorIndexAt/revealCorridor/updateFogTrail`，26px 足迹、半径 58）
- [x] T19 小地图：`isStairsSeen()` 门控、玩家箭头改用 `facingAngle`、新增 `minimapStats`
- [x] T20 `tools/arcane_m20.js` 专项（45/45）、m18/m19 回归、核心 7 套全绿、PROGRESS 留痕

