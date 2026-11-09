# A 批次任务清单

## A1 门口信息板（已完成）
- [x] T1 `DOOR_INFO_CONFIG` + `DOOR_INFO_STATS` + `doorInfoFor()`（`ROOM_TYPE_CONFIG` 之后）。
- [x] T2 `drawDoors()` 标签段替换为"距离判定 + 两行信息板 + 统计"。
- [x] T3 `__roamDebug.doorInfo { info, doors, tipFor, reveal }`。
- [x] T4 `tools/arcane_doorinfo.js`（端口 9517）A0–A6。
- [x] T5 语法检查 + 专项全绿（7/7）。
- [x] T6 串行 18 套回归（红灯先单跑）。
- [x] T7 PROGRESS + 清单勾选。

## A2 双价门（已完成）
- [x] T11 `PRICED_DOOR_CONFIG` + 每层挑选分叉点（排除当前房 / 首领房）。
- [x] T12 三种代价结算 + 付不起禁用 + 信息板第三行。
- [x] T13 `tools/arcane_priceddoor.js`（12/12）+ 回归 + PROGRESS（待本轮回归）。

## A3 回溯已清房间（已完成）
- [x] T21 `BACKTRACK_CONFIG` + 回访守卫 + 信息板第三行。
- [x] T22 `tools/arcane_backtrack.js`（9/9）+ 回归 + PROGRESS。
