# U11b · 生存房 任务清单（每步完成即写 PROGRESS）

## U11b-1 规格
- [x] `spec.md` + `tasks.md`

## U11b-2 数据层
- [x] `state.u11bV1 = true`、`state.survival = null`
- [x] `U11B_CONFIG`
- 验收：语法检查 OK

## U11b-3 房型 + 生成
- [x] `ROOM_TYPE_CONFIG.types.survival`、`ROOM_LIGHT_MOODS.survival`
- [x] `assignRoomTypes()` 保底五（第 4 层起、`others ≥ 3`；让位顺序：第 2 战斗 → 多余宝箱 → 多余事件 → 第 2 精英）
- [x] `designEliteRoute()` 的"不参战"过滤加 `survival`
- [x] `spawnSurvivalRoom()` 祭坛落点（房心 → 8 方向 × 0.22，四检；失败降级 battle）
- [x] `applyRoomReward()` 加 `survival` 分支（只提示）
- 验收：33 次抽样命中 12 次（36%）；未开始时无怪不锁门

## U11b-4 流程
- [x] `startSurvival(room)`：落闸 + 首波 + 提示 + 震屏
- [x] `updateSurvival(dt)`：计时 / 波次 / 刷点三检 / 结束判定；插在 `updateRoomLogic` 之前（用真实 dt）
- [x] `finishSurvival(room)`：开门 + 奖励 + 冲击波；不清怪
- 验收：E 开始 → `active`、门全关、首波到位；`survivalTick(22)` 后结算

## U11b-5 交互 / 渲染 / 提示
- [x] `trySurvivalInteract()` 插在裂隙与商店之间
- [x] `drawSurvivalAltar()`（未开始 / 进行中环形进度 + 秒数 / 已完成打勾；三态都带光柱）
- [x] `#contextHint` 三阶段文案
- 验收：三阶段提示文案正确；三张截图可辨

## U11b-6 调试口
- [x] `setU11b / survivalRoomId / survivalAudit / survivalStart / survivalTick`

## U11b-7 专项脚本
- [x] `tools/arcane_u11b.js`（端口 9502）18 项断言 + 3 张截图 + `u11b-result.json`
- 验收：18/18 PASS、avgFps ≥60、errors 0

## U11b-8 回归 + 收口
- [x] 14 套回归全绿（首轮 4 套因并发 Edge 争用抖动，单独重跑全绿）
- [x] PROGRESS 顶部写 U11b 条目
