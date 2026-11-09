# U11c · 变量事件 任务清单（每步完成即写 PROGRESS）

## U11c-1 规格
- [x] `spec.md` + `tasks.md`

## U11c-2 数据层
- [x] `state.u11cV1 / tagPatches / tagPatchSeq / u11cLast`
- [x] `U11C_CONFIG`（cycle / maxTags / 3 条 events）
- [x] `ROOM_TYPE_CONFIG.eventTable` 追加 3 条带 `effect` 的条目
- 验收：语法检查 OK

## U11c-3 接进 U1
- [x] `getAbilityTags()` 最前面读 `state.tagPatches`（`tagsV1===false` 时忽略）
- [x] `applyTagPatch()` 改写后清空 `TAG_FUSION_CACHE`
- [x] `tagSourceSignature()` 追加 `tagPatchSeq`
- 验收：不改 `ABILITY_TAGS` 常量；无 patch 时行为与旧版完全一致

## U11c-4 结算
- [x] `u11cEventPool / u11cPickEvent / u11cResolveEvent`（retune / graft / swap）
- [x] `applyRoomReward()` 的 event 分支接入（失败回退旧数值事件）
- 验收：三条事件都能改到标签；`u11cLast` 有记录

## U11c-5 调试口
- [x] `setU11c / u11cPool / u11cApply / tagsOf / tagLevelsNow / u11cLast`

## U11c-6 专项脚本
- [x] `tools/arcane_u11c.js`（端口 9503）12 项断言 + 3 张截图 + `u11c-result.json`
- 验收：12/12 PASS、avgFps ≥60、errors 0

## U11c-7 回归 + 收口
- [x] 14 套回归**串行**全绿（失败先单跑复验）
- [x] PROGRESS 顶部写 U11c 条目
