# U11b · 生存房（限时 22 秒波次挑战）规格

> 出处：`.spec/round4-5-merge.md` U11「商店房 / 生存房 / 变量事件」的第二项。
> 前置：U11a 已收口（`shop` 房型、`state.embers`、`drawShopPedestals`、`assignRoomTypes` 保底四）。

---

## 1. 根因

现有"有怪房"是**静态清怪**：进房落闸 → 杀光 → 开闸。玩家的压力只来自"这一波有多少怪"，没有**时间压力**，也就没有"我先打哪个 / 我要不要开技能顶一下 / 我能不能撑到计时结束"的临场决策。生存房把"清空"换成"撑住"，同一套房间流程就能产出完全不同的节奏。

## 2. 目标（一句话验收）

**第 4 层起可能出现「生存房」：房中央有一座祭坛，靠近按 E 开始挑战 → 门落闸、22 秒内持续刷怪 → 计时结束自动结算（开门 + 结晶/余烬/奥能/回血），同一层不重复出现第二座。**

## 3. 与现有约束的关系（为什么不做成"进房即锁"）

- **不做自动触发**：生存房 `count = [0,0]`，进房走的是"无怪房奖励"分支。若进房即锁，玩家在不知情的情况下被关 22 秒；更要命的是它会改变所有"进房就会清房"的既有语义，14 套回归里凡是遍历房间清怪/开门的用例都会踩到。
- **改成主动开启**：祭坛（E）才落闸。回归用例不会去按 E，生存房对它们等价于一间普通安全房 → 既有语义零变化。
- **仍然保留"进房锁门"的规则**：一旦按下 E，立刻 `room.locked = true` + `setRoomDoors(room, true)`，与战斗房完全同一套闸门。

## 4. 数据与配置

```js
const U11B_CONFIG = {
  duration: 22,            // 挑战时长（秒）
  waveEvery: 2.2,          // 波次间隔
  waveMax: 2,              // 每波最多 2 只
  spawnMinDist: 56,        // 刷怪离玩家的最小距离（不许贴脸）
  altarRadius: 24,
  startRange: 72,          // 祭坛交互半径
  reward: { crystals: 4, embers: 10, aether: 45, hp: 20 }
};
```

- `state.u11bV1`（默认 `true`）。
- `state.survival`：`{ roomId, altar:{x,y,r}, active, remain, waveTimer, waves, cleared }`，`generateFloor()` 里置 `null`。
- 房型：`survival: { name:'生存', en:'SURVIVE', risk:3, color:'#ff6b6b', count:[0,0] }`。
- 光照：`survival: { color:[255,107,107], coreAlpha:0.32, radiusMul:0.96, accent:'255,107,107', vignette:1.35, tint:0.10 }`。

## 5. 生成（不破坏保底）

- `assignRoomTypes()` 末尾、**保底四（商店）之后**追加「保底五」：
  - 条件：`state.u11bV1 !== false && state.floor >= 4 && others.length >= 3`；
  - 让位顺序（从"最不影响保底"到"影响最大"）：**第 2 间战斗房 → 多余宝箱（≥2）→ 多余事件（≥2）→ 第 2 间精英房**；
  - 铁律：让位后仍剩 ≥1 间战斗/精英（保底一/二）、≥1 间宝箱或事件（保底三）；出生房 / 首领房 / `shop` 房永不被选中。
  - 实测（3 轮 × 4–14 层 = 33 次生成）命中 12 次（36%），每层最多 1 间。
- `designEliteRoute()` 的"不参战"过滤扩展为 `shop / survival`（否则生存房会被改成精英房，祭坛消失）。
- `spawnSurvivalRoom()`（排在 `spawnShopRoom()` 之后）：
  - 祭坛落点从房心开始，按 8 方向 × 半径 `min(w,h)×0.22` 找第一个 `isWalkableCircle(x,y,28) && !isWalkBlocked(x,y,28) && 离门 ≥40` 的点；房心合法就用房心；
  - 一个都找不到 → 该房降级回 `battle`（宁可不给祭坛，也不要出现"没有祭坛的生存房"）。

## 6. 流程

1. `applyRoomReward()` 加 `survival` 分支：只 `showToast('生存祭坛 · 按 E 开始挑战（22 秒）')`，不发奖。
2. `startSurvival(room)`：
   - `active=true`、`remain=22`、`waveTimer=0.6`、`waves=0`、`room.locked=true`、`setRoomDoors(room,true)`；
   - 立刻刷第 1 波；`showToast('生存挑战开始 · 撑过 22 秒')`、`playSfx('ui')`、`triggerShake(3,0.16)`、`drawMinimap()`。
3. `updateSurvival(dt)`（在 `updateRoomLogic` 之前调用）：
   - 非 active 直接返回；
   - `remain -= dt`；`waveTimer -= dt`；到点刷波（`waves += 1`，每波 `1 + (waves % 2)` 只，最多 2）；
   - 怪型：前 2 波 `wanderer`（游荡体），第 3 波起 35% 概率 `shooter`（射手傀儡）；
   - 刷点：房内随机 12 次尝试，要求 `isWalkableCircle(x,y,16)`、`!isWalkBlocked`、离玩家 ≥56；
   - `remain <= 0` → `finishSurvival(room)`。
4. `finishSurvival(room)`：
   - `active=false`、`cleared=true`、`rewarded=true`、`room.locked=false`、`setRoomDoors(room,false)`；
   - 奖励：`crystalsEarned += 4`、`embers += 10`、`aether = clamp(+45)`、`hp = clamp(+20)`；
   - `showToast('生存挑战完成 · 奖励已结算')`、`playSfx('reward')`、`addRing` 金色冲击波、`triggerShake(2,0.12)`、`updateHUD()`、`drawMinimap()`；
   - **不清场里的怪**：留下的怪照样能杀（继续给余烬），但门已经开了。
5. 玩家中途死亡：走既有死亡流程；`state.survival.active` 留在状态里也不影响，因为重开走 `createInitialState()` 归零。

## 7. 交互 / 渲染 / 提示

- E 链路（第 25414 行）最终形态：
  `if (!tryVoidRiftInteract() && !trySurvivalInteract() && !tryShopInteract()) interactStairs();`
  `trySurvivalInteract()`：仅在生存房内、玩家距祭坛 ≤72、`mode/status === 'playing'` 且 `!active` 时启动并 `return true`（吞掉这次 E）。
- `drawSurvivalAltar()` 在 `drawShopPedestals()` 之后：
  - 未开始：深色台面 + 亮红双环 + 缓慢旋转的符文刻度 + 中心菱形 +「生存 · E」深色药丸标签，色 `#ff6b6b`；
  - 进行中：祭坛上方 46px 的环形进度（从 12 点起顺时针收）+ 深色药丸里的剩余秒数（`#ffd166`）+ 外圈红色呼吸光；
  - 已完成：整体转灰绿 + 台面中心打勾；
  - 三种状态都叠一道向上收窄的红/绿光柱，防止玩家站在祭坛正上方时把整块台面挡死。
- `#contextHint` 三种文案：未开始「按 E 开始生存挑战 · 22 秒」/ 进行中「生存中 · 剩余 X 秒」/ 已完成「挑战已完成 · 奖励已结算」。
- 小地图：`ROOM_TYPE_CONFIG.types.survival.color` 自动生效，无需额外改动。

## 8. 调试口

- `setU11b(on)`、`survivalRoomId()`、`survivalAudit()`（`roomId / active / remain / waves / altar / walkable / doorGap / enemies / cleared / roomLocked / doorsClosed`）、
- `survivalStart()`（等价按 E：必须在祭坛旁）、`survivalTick(seconds)`（按 1 秒步长推进 `advanceSurvival()`，用于快速结算）。

## 9. 断言表（`tools/arcane_u11b.js`，端口 9502，≥14 项）

| # | 断言 | 判据 |
|---|---|---|
| 1 | 进入游戏 | `#titleLayer` 隐藏 |
| 2 | 第 4 层起出现生存房 | `setFloor(4..12)` 抽样 ≥2 层命中，每层 ≤1 间 |
| 3 | 祭坛落点合法 | `walkable:true`、`blocked:false`、`doorGap ≥ 40` |
| 4 | 未开始时是安全房 | `enemies 0`、`roomLocked false`、`doorsClosed false`、`active false` |
| 5 | 按 E 开始 | `active true`、`remain ≈22`、`roomLocked true`、门全关 |
| 6 | 第一波立刻到位 | 开始后 `enemies ≥ 1` |
| 7 | 波次持续推进 | `survivalTick(6)` 后 `waves ≥ 2`、`enemies ≥ 3` 累计出现过 |
| 8 | 刷怪不贴脸 | 每个怪与玩家距离 ≥ 56 |
| 9 | 计时结束自动结算 | `survivalTick(20)` 后 `active false`、`cleared true`、`roomLocked false`、门开 |
| 10 | 奖励到账 | `crystalsEarned +4`、`embers +10`、`aether` 增、`hp` 增（不超上限） |
| 11 | 不可重复开始 | 结算后 `survivalStart()` 返回 `{ ok:false, reason:'done' }` |
| 12 | 提示文案 | 三阶段 `#contextHint` 分别含「按 E 开始」「生存中」「已完成」 |
| 13 | A/B 关闭 | `setU11b(false)` → 新层 `survivalRoomId === -1`；重开恢复 |
| 14 | 换层清理 | 换层后旧祭坛不可用（`roomId` 变 / `active false`） |
| 15 | 性能与报错 | `avgFps ≥ 60`、`errors 0` |
| 截图 | before / run / after | `u11b-altar.png` / `u11b-run.png` / `u11b-done.png` |

## 10. 回归与风险

- 14 套全绿（重点：m20 的落闸用例、m22 的 `beforeTypes`、m23/m24/m25 的多层遍历）。
- 风险 1：生存房改成 `battle` 会让"该层 battle 数 −1"，若测试断言 battle 计数会抖动；本仓库现有断言按"有怪房"取房，不数 battle，预计安全，实跑验证。
- 风险 2：`setRoomDoors(room, true)` 只关目标房的门；生存房只与相邻房相连，玩家确实无法溜走（闸门碰撞与战斗房同一套）。
- 风险 3：结算不清怪，玩家可能在开门后被残怪追出房 —— 这是有意的（走廊不追人规则仍在，怪出房会脱战）。
- 风险 4：`updateSurvival` 必须排在 `updateRoomLogic` 之前，否则"计时归零那一帧"会先被 `isInsideRoom` 判定成普通无怪房重复发提示。

## 11. 明确不做

- 不做排行榜 / 连击倍率 / 波次预览条；
- 不做"提前结束换更高奖励"；
- 不在本单元做 U11c 变量事件。
