# B · 自由探索层（Open Floor）规格

## 目标
每 3 层（3/6/9…）生成"开放层"：地图更大、任意顺序绕行、楼梯被钥匙锁住，
把"清完再下"与"够钥匙就走"变成玩家自己的决策。

## 数据契约
- `OPEN_FLOOR_CONFIG { enabled, every=3, minRooms=7, maxRooms=9, keysMin=1, keysMax=2,
  keyTypes=['chest','event','elite'], keyText, lockText, readyText }`
- `OPEN_FLOOR_STATS { floors, active, keysNeeded, keysFound, keyRoomIds, unlocks }`
- `state.openFloor = { active, stairsLocked, keysNeeded, keysFound, keyRoomIds }`
- 房间对象新增：`room.hasKey`、`room.keyTaken`（仅开放层钥匙房使用）

## 规则
1. 判定：`isOpenFloor(n) = n % every === 0`，`enabled=false` 时全层按旧规则。
2. 布局：开放层 `targetRooms ∈ [7,9]`，G1 校验上限改为 `OPEN_FLOOR_CONFIG.maxRooms`；
   仍保留换种子重试 + 线性兜底。
3. 楼梯房：开放层不再设为 `boss`，改为 `rest`；`state.boss=null`。
4. 钥匙：在 `chest / event / elite` 里按 `roomHash01(room, 31)` 排序取 1–2 间，标记 `hasKey=true`；
   候选不足时兜底任意非出生/楼梯房，保证楼梯不会永久锁死。
5. 收钥匙：`grantOpenFloorKey(room)`
   - 无怪房（宝箱/事件）在 `applyRoomReward` 里结算；
   - 有怪房（精英）在 `onRoomCleared` 里结算；
   - 每间房只发一次，`keyTaken` 守卫；收齐后 `stairsLocked=false`、`OPEN_FLOOR_STATS.unlocks+1`。
6. 下楼：`interactStairs()` 在开放层只检查 `stairsLocked`，不要求 `floorCleared` / 首领。
7. 不锁门：`updateRoomLogic` 的落闸分支在开放层直接跳过，允许打一半去别处绕行。
8. 信息层：
   - 开局 toast："开放层 · 不锁门，任意顺序探索；楼梯要 N 把钥匙"；
   - 楼梯提示牌：锁定红色 `楼梯被锁 · 需要钥匙 x/y`，解锁金色 `钥匙已齐 · 按 E 下楼`；
   - 门板：已探测的钥匙房第二行显示 `钥匙 · 必得一把`（未探测仍为未知，鼓励探索）；
   - 小地图：沿用迷雾，未探索房间不画（留黑），只显示已走过的区域。
9. 调试口：`__roamDebug.openFloor { info(), setEnabled(), setFloor(n), collectAll() }`；
   `getState().openFloor` 暴露同一份统计。

## 专项断言（tools/arcane_openfloor.js，端口 9522）
- A0 配置默认值。
- A1 第 3/6 层开放、第 1/2/4/5 层不开放。
- A2 开放层房间数 7–9。
- A3 楼梯房非 boss；钥匙房 1–2 间且房型 ∈ keyTypes。
- A4 初始 `stairsLocked=true`；在楼梯旁按 E 被拒且楼层不变。
- A5 `collectAll()` 后钥匙齐、楼梯解锁、`unlocks+1`。
- A6 解锁后按 E 成功下楼（floor+1），新层非开放时恢复 boss 楼梯。
- A7 开放层进入战斗房中心不落闸。
- A8 小地图迷雾：新层至少 1 间房未探索（未画）。
- A9 A/B：`enabled=false` 时第 3 层不开放。
- A10 截图 >10KB / fps≥60 / 无脚本错误。

## 降级
任一校验失败：`OPEN_FLOOR_CONFIG.enabled=false` 即退回旧楼层规则；
钥匙找不到候选时兜底普通房；房间数不足走 G1 线性兜底（此时 A2 会失败，需看 `state.floorGen.fallback`）。
