# P0-3 · 房间事件与取舍房（献祭祭坛 / 赌注房 / 诅咒房）

> 状态：规格定稿，待实现
> 目标文件：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`（单文件、零外部依赖）
> 断言脚本：`D:\其他\TRAE宝\奥术工程师\tools\arcane_events.js`
> 总开关：`EVENT_CONFIG.enabled`
> 存档：`META_SCHEMA_VERSION` 4 → **5**

## 1. 目标与边界
本轮把"事件房"从"进门自动发一次奖励"升级成**可拒绝、代价前置、结算一次**的三类取舍房：

| 房型 id | 玩家叫法 | 门徽 | 主色 | 室内主体物 | 核心取舍 |
|---|---|---|---|---|---|
| `sacrifice` | 献祭祭坛 | `☩` | `#ff9a5e` | 八角石坛 + 向天火柱 | 永久最大气血 → 2 张史诗卡 |
| `wager` | 赌注房 | `⚄` | `#f2c14e` | 圆赌桌 + 半注/全押两枚筹码 | 结晶按明示胜率翻倍或清空 |
| `curse` | 诅咒房 | `☠` | `#a34bd6` | 黑紫方尖碑 + 锁链环 | 立刻拿遗物，换每层最大气血下降 |

非目标：
- 不改战斗房、精英房、首领房的数值与视觉；
- 不新增货币，结晶（`state.meta.crystals`）与最大气血（`state.mods.hpBonus` → `applyMetaStats`）复用既有接口；
- 不改已有事件池与 `U11c` 变量事件；
- 不触碰已 PASS 的断言（element / execute / render / title / opening / tokens / transition）。

## 2. 现状事实（实现前定位，行号为改动前）
- 房型表：`ROOM_TYPE_CONFIG` @ 7515，`weights` @ 7533；新类型**不加入 weights**，只能由事件房装配函数显式指定。
- 门信息板：`DOOR_INFO_CONFIG` @ 7571（`tipByType` @ 7577）、`doorInfoFor` @ 7685；门徽：`DOOR_VIS_CONFIG.icons/labels` @ 7621 / 7626。
- 房间类型分配：`assignRoomTypes` @ 11190；事件房自动奖励：`applyRoomReward` @ 11343（新类型不进入该分支）。
- 楼层生成：`generateFloor` @ 13971；生成顺序：`assignRoomTypes`（14075）→ `designEliteRoute` → `setupOpenFloor` → `assignRoomTemplates` → 门（14119）→ `createHiddenRoom`（14137）→ `createVoidRift`（14139）→ `spawnFloorProps`（14143）→ `spawnShopRoom`（14145）→ `spawnSurvivalRoom`（14147）→ `spawnEngraveStations`（14149）→ `spawnDualAltarRoom`（14151）。
- 隐藏房宿主：`createHiddenRoom` @ 13013，只挑 `type.count[1] > 0` 的有怪房（事件房 count 为 0，天然不冲突）。
- 虚空裂隙：`createVoidRift` @ 13364，兜底轮可把任意房当起点/终点（事件房装配时必须避开）。
- 存档：`META_SCHEMA_VERSION` @ 6182；`defaultMeta` @ 9948；`normalizeMeta` @ 10008；`migrateMeta` @ 10120；`loadMeta` @ 10311。
- 交互：`updateContextHints` @ 41127；E 键链 @ 41465；提示块 4/5/6 分别为商店 / 生存 / 双祭坛。
- 绘制：`render` @ 17483，`drawDualAltar` @ 8385，`drawShopPedestals` @ 39900，`drawSurvivalAltar` @ 40250；小地图房间着色 @ 16940。
- 调试口：`window.__roamDebug` @ 42876，`element` @ 43761，`execute` @ 43909。
- 单局状态：`createInitialState` @ 10344（`mods` @ 10563，`relics` @ 10571）。

## 3. 配置（唯一真源）
```js
const EVENT_CONFIG = {
  enabled: true,              // 总开关：false 时楼层生成与现版本完全一致
  minFloor: 2,                // 第 1 层不出现取舍房（先教会玩家基础循环）
  chance: 0.45,               // 每层最多掷一次；未命中 = 本层无事件房
  maxPerFloor: 1,             // 硬上限：每层最多 1 间事件房
  hpFloor: 30,                // 最大气血绝对下限（任何代价都不能击穿）
  interactRange: 66,          // E 交互半径
  kinds: ['sacrifice', 'wager', 'curse'],
  sacrifice: { hpCost: 15, cards: 2 },      // 永久最大气血 -15，换 2 张史诗卡
  wager: {
    chance: 0.55,             // 明示胜率 55%；绝不暗箱
    label: '胜率 55%',
    stakes: [
      { id: 'half', name: '半注', ratio: 0.5 },
      { id: 'all',  name: '全押', ratio: 1 }
    ]
  },
  curse: { hpPerFloor: 6 },   // 每层开始 -6 最大气血；可累计，下限 30
  settleLock: 1.2             // 下注后落闸展示结果，1.2 秒后自动开门（不再可退）
};
```

## 4. 三种房的状态机

### 4.1 通用状态机（每间房独立）
```
setup（生成楼层）
  → idle（可自由进出；未落闸；门板 & 小地图已写代价/收益）
    ├─ 玩家离开房间 = 拒绝：不打任何标记、不扣任何数值、门永远不锁
    ├─ E 交互
    │    → resolving（结算一次；used=true；写入 EVENT_STATS）
    │       ├─ sacrifice：立即扣最大气血 + 立即发卡，房间恢复 idle（可离开）
    │       ├─ wager：立即扣注 + 立即掷骰展示结果；落闸 settleLock 秒 → 开门 → done
    │       └─ curse：立即发遗物 + 立即可见的负数上限；记录每层 tick → 房间恢复 idle
    └─ done / used：再次 E 只显示"已结束"，不重复结算
```

### 4.2 献祭祭坛 `sacrifice`
- 进房前：门板 + 小地图写 `最大气血 −N → 史诗卡《A》《B》`；`N = min(15, hpMax - 30)`，避免文本与实际扣减不一致。
- 接受（E）：`applyMaxHpDelta(-N)` → `grantEventCards(2)`；只结算一次。
- 拒绝：直接走出房间；不扣血、不发卡、不落闸。
- 下限保护：`hpMax` 永不 < 30；若 `hpMax <= 30`，门板写"守卫下限 · 祭坛沉睡"，E 只提示不可用。

### 4.3 赌注房 `wager`
- 房内两枚筹码：**半注**（押 `max(1, floor(crystals/2))`）与**全押**（押全部）。站在哪枚旁按 E 就押哪枚；押完另一枚立刻灰化（只许下注一次）。
- 胜率固定 55%，门板、筹码上方、提示条三处都显示 `胜率 55%`；结果在按下 E 的同一帧掷出，不存在"看起来赢了却扣钱"。
- 赢：结晶 `+stake`（本金保留，等于"押注部分翻倍"）；输：结晶 `-stake`（全押即清空）。
- 下注后 `room.locked = true` + `setRoomDoors(room, true)`，1.2 秒后自动 `false`；`used=true` 后不可再次下注、不可退款。
- 结晶为 0 时：门板写"无结晶可押"，E 只提示，不落闸、不软锁。

### 4.4 诅咒房 `curse`
- 进房前：门板写 `每层 −6 上限（≥30）→ 遗物《X》`；小地图画 `☠` + `−6/层` 文本；已有诅咒时显示累计值。
- 接受（E）：立即 `grantEventRelic()`；`state.eventCurse.stacks += 1`、`perFloor += 6`，并立刻结算本层这一跳（让玩家马上看到代价）。
- 每层开始：`generateFloor` 调 `applyEventCurseTick(floorNumber)`，每层只结算一次（`lastTickFloor` 去重）。
- 下限保护：每跳都走 `applyMaxHpDelta`，最多扣到 30；`currentHp` 同步夹到新上限，不会"上限 30、当前 45"。
- 可累计：连续多间诅咒房叠加 `perFloor`；层数写入 `meta.eventStats.curses`。
- 拒绝：直接离开；不加诅咒、不发遗物。

## 5. 房间生成与互斥
### 5.1 出现概率与硬上限
- 仅 `EVENT_CONFIG.enabled && floor >= minFloor` 才掷骰。
- 每层用稳定种子 `roomHash01`（层号/房间）判定，**每层最多一次**，`state.eventRoom` 至多一个。
- `maxPerFloor=1` 由 `setupEventRoom` 的"只改一间房"实现；验收统计 `floorsWithRoom / maxRoomsInFloor`。

### 5.2 候选房优先级（从"最不影响既有保底"到最大）
1. 已有 `event` 房（把自动事件升级成取舍事件，不减少战斗房）；
2. `chest` 房；
3. `rest` 房；
4. `battle` 房（仅当层内还有 ≥1 间其它 battle/elite，避免整层无怪）。
排除：出生房、首领/楼梯房、`shop`、`survival`、双价门房（`pricedTag`）、挑战房、双祭坛房、隐藏房宿主、虚空裂隙起点/终点、开放层钥匙房（`hasKey && !keyTaken`）。
- 若候选为空 / 主物体放不下：`setupEventRoom` 返回 `null`，房间类型原样回退，**不强制生成**。
- 装配顺序：`spawnDualAltarRoom()` 之后、`resetFullClearState()` 之前；此时隐藏房/裂隙/门/道具均已定稿，可直接排除。
- 与隐藏房：隐藏房只挑 `count[1] > 0` 的房，事件房 `count=[0,0]`，不会互斥；验收要求"有事件房的层仍能生成隐藏房"。
- 与虚空裂隙：装配时排除 `state.voidRift.sourceId/targetId`，避免同一间房叠两个交互物。

### 5.3 关闭开关后的零差异
`EVENT_CONFIG.enabled === false` 时：
- `setupEventRoom` 第一行 return `null`（不改任何 `room.type`）；
- `applyEventCurseTick` 返回 0；
- `drawEventRoom` / 小地图标记 / 提示条 / E 交互全部短路；
- `state.eventRoom` 保持 `null`，`EVENT_STATS` 不增长。
验收：关闭后连续生成 20 层，`state.rooms` 不含 `sacrifice/wager/curse`，`eventRoom===null`，事件统计全 0，且页面异常 0。

## 6. 结算与数值接口
- 最大气血：只改 `state.mods.hpBonus`，再 `applyMetaStats(state, false)`；这样更衣室/天赋/遗物的既有加成全部保留，读档也不会重复累乘。
- `applyMaxHpDelta(delta)`：先算 `after = max(hpFloor, hpMax + delta)`，只把差值写入 `hpBonus`，同步 `hp = min(hp, hpMax)`；返回实际扣减量（可能是 0，表示触发下限）。
- 结晶：只改 `state.meta.crystals` 并 `saveMeta()`；同时写 `state.crystalsEarned`（本局统计口径）。
- 卡：`grantEventCards(n)` 只从 `MAGIC_CONFIG/TECH_CONFIG` 的 `rarity === 'epic'` 且未拥有的卡里取；写入 `ownedMagic/ownedTech`、`activeMagicId/activeTechId`、`stampCardFloor`。
- 遗物：`grantEventRelic()` 从 `RELIC_CONFIG` 里挑第一件未满层的强力遗物；写 `state.relics[id]++` 并调用 `relic.apply()`。
- 所有奖励在 `EVENT_CONFIG.enabled === false` 时不发放。

## 7. 存档迁移（schema 4 → 5）
`defaultMeta()` 新增：
```js
eventStats: { sacrifice: 0, wagerWins: 0, wagerLosses: 0, curses: 0, curseTicks: 0 }
```
- `normalizeMeta`：缺字段补 0；只接受非负整数；脏数据不崩。
- `migrateMeta`：`fromVersion < 5` 时补 `out.eventStats = {}`，`out.version = 5`；已有 `crystals / talents / stats` 原样保留。
- 本局诅咒只作用于本局（`state.eventCurse` 在 `createInitialState` 归零），跨局只累计统计，不把玩家永久扣死。
- 验收：v0/v3/v4 旧档读入不崩、`version===5`、`eventStats` 存在、原有结晶数与最佳楼层不变。

## 8. 视觉与交互（不复用战斗房）
- **门徽**：`DOOR_VIS_CONFIG.icons = { sacrifice:'☩', wager:'⚄', curse:'☠' }`，`labels` 分别"献祭/赌注/诅咒"；房型主色进 `ROOM_TYPE_CONFIG`。
- **门板**：`doorInfoFor` 对三类型返回动态 `roomEvent` 文本（代价/收益/胜率/累计诅咒），未探测时仍遵守 `fogUnvisited`。
- **室内主体物**：
  - 献祭：八角石坛（8 边深红石台）+ 垂直火柱 + 悬浮 `−N` 符文；
  - 赌注：圆形赌桌 + 两枚筹码（半注/全押）+ 中央骰子；
  - 诅咒：黑紫方尖碑 + 锁链环 + 滴落粒子。
  全部用 canvas 基础图元，与战斗房/宝箱/商店/双祭坛视觉不同。
- **交互提示**：站到主体物 `66px` 内显示 `按 E …`，副文本必写"拒绝 = 直接离开，不扣任何东西"。
- **小地图**：房型主色 + 专属符号；诅咒额外画 `−6/层`，赌注画 `55%`；统计 `EVENT_STATS.minimapMarks`。
- **结算反馈**：`addFloat` + `addRing` + `showToast` + `playSfx`；献祭/诅咒走 `warn`，赌注赢 `success`、输 `warn`。

## 9. 调试口 `__roamDebug.event`
```
info()                 // enabled / config / stats / room / curse / 本层房型
setEnabled(v)          // 总开关
setChance(n)           // 测试用出现概率（0/1）
resetStats()           // 清统计
setup(kind)            // 强制在当前层装配指定房型（绕过掷骰，测试用）
accept(stakeId?)       // 直接走真实接受路径（sacrifice/curse 可省略 stakeId）
reject()               // 拒绝：标记 declined，保持门开
tickFloor(n)           // 手动触发诅咒每层结算（验证去重与下限）
forceWager(result)     // 'win' / 'lose'，仅影响下一次赌注结果
migrate(raw, from)     // 直接调 migrateMeta
normalize(raw)         // 直接调 normalizeMeta
```

## 10. 验收断言（`tools\arcane_events.js`，全部走真实函数）
1. 默认开关开启；三种房配置存在，且 `weights` 未混入新类型。
2. 强制装配三种房：房型 id / 门徽 / 主色 / 主物体坐标存在，`drawEventRoom` 本帧绘制数 > 0。
3. **结算一次**：献祭连续 `accept()` 两次，第二次 `reason==='used'`，最大气血只扣一次、卡只发一次。
4. **拒绝可离开**：`reject()` 后 `room.locked===false`、所有门 `closed===false`，玩家可走出房间（`currentRoomId` 可变为相邻房）。
5. **连续触发不叠爆**：两间诅咒房各接受一次后 `perFloor===12`，连续 `tickFloor` 5 次只按新层各扣一次；`hpMax` 不低于 30。
6. **下限保护**：把 `hpMax` 压到 33 再献祭，实际只扣 3 → 30；再接受诅咒扣 0，`hpMax===30`。
7. **关闭开关零差异**：连续生成 20 层，无新类型房、`eventRoom===null`、统计全 0、页面异常 0。
8. **旧档迁移不崩**：`migrate({version:0,crystals:7,bestFloor:4},0)` 与 `normalize` 均不抛异常，`version===5`，`crystals===7`，`eventStats` 齐全。
9. **与隐藏房/裂隙不冲突**：有事件房的层仍满足隐藏房宿主存在（或有怪房存在）；`voidRift` 的 source/target 不等于事件房 id。
10. **每层最多一间**：20 层统计 `maxRoomsInFloor===1`；无候选层的 `setupEventRoom` 返回 null 且房型回退。
11. 赌注：显示胜率 55%；`forceWager('win')` 赢后结晶 `+stake`；`forceWager('lose')` 输后 `-stake`；下注瞬间 `locked===true`，1.2 秒后 `false`；第二次下注被拒。
12. 截图：三种房各 1 张 + 关闭开关 1 张；页面异常数组长度 0。

通过标准：全部 PASS，页面异常 0，语法校验 PASS，既有 143 条回归不回退。

## 11. 风险与回滚
- 事件房抢走 `chest/event` 房可能影响开放层钥匙：候选排除 `hasKey` 房，且保底至少 1 间非事件房。
- 双祭坛原本偏好 `event/chest/rest`：装配时排除 `state.dualAltar.roomId`，避免同房两个主体物。
- 诅咒 `hpBonus` 走负数可能影响契约/遗物：只在 `mods.hpBonus` 上叠加，所有来源共用同一字段，不会重复累乘。
- 若生成阶段候选为空：直接回退，不记录 `eventRoom`，楼层与关闭开关时一致。
- 回滚：`index_arcane_v2.bak_*.html` 保留 1 份；移除 `setupEventRoom()` 调用即可完全停用（再加上总开关）。
