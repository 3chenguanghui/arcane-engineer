# C · 玩法多样（内容批）

## C1 挑战房（本批先做）
- `CHALLENGE_ROOM_CONFIG { enabled, perFloor=1, timeLimit=60, bonusCrystals=2,
  bonusCharges=1, bonusAether=40, kinds, kindOrder, rewardText, failText, footerText }`
- `CHALLENGE_STATS { floors, setups, started, cleared, success, failed, declined, lastKind, lastRoomId }`
- `state.challenge = { roomId, kind, started, done, success, startedAt, fusionUsed, slotUsed, timeoutNotified }`

规则：
1. 每层挑 1 间普通战斗房挂 `room.challenge = { kind }`；排除出生房 / 首领房 / 钥匙房 / 代价房。
2. 条件按层轮换：第 1 层限时、第 2 层禁融合、第 3 层只准主槽，之后循环。
3. 门板写清：`挑战 · 条件 · 达成奖励` + `不想挑战可以不进门`；**不进门 = 拒绝**，零成本。
4. 进房即开始：`startChallengeIfNeeded` 记录 `startedAt`，屏幕顶部挑战条显示条件/剩余时间。
5. 违规计数：`tryFuse()` 成功 → `fusionUsed+1`；`castSlot(slot>0)` 成功 → `slotUsed+1`。
6. 清房结算 `resolveChallenge`：达成 → 结晶 +2、奖励等级 +1、奥能 +40；
   未达成 → 只给基础奖励，不扣血、不惩罚。
7. 限时房在超时瞬间提示一次，仍可清完但只给基础。
8. 调试口 `__roamDebug.challenge { info(), setEnabled(), setFloor(), setKind(), enter(),
   violate(), clearNow() }`；`getState().challenge` 暴露同一份统计。

## 专项断言（tools/arcane_challenge.js，端口 9523）
A0 配置默认值；A1 每层 1 间且房型有怪、排除 boss/出生/钥匙/代价房；
A2 条件按层轮换；A3 门板条件与奖励文案；A4 不进门不开始、进门才开始；
A5 限时达成 → 结晶 +2 / 等级 +1；A6 超时未达成 → 不给额外；
A7 禁用融合成功/违规两条路径；A8 只准主槽成功/违规两条路径；
A9 enabled=false 不生成；A10 截图 / fps / 零报错。

## 降级
`CHALLENGE_ROOM_CONFIG.enabled=false` 即完全退回旧规则；找不到普通战斗房时不生成挑战房（不强塞）。

---

## C2 双选祭坛（第二项）
- `DUAL_ALTAR_CONFIG { enabled, perFloor, roomTypes=['event','chest'], altarRadius=22,
  interactRange=64, gapRatio, altars:[{ id, name, glyph, desc, color }], pickedText, brokenText, footerText }`
- `DUAL_ALTAR_STATS { floors, setups, picks, powerPicks, supplyPicks, lastAltar, lastRoomId }`
- `state.dualAltar = { roomId, altars:[{id,x,y,r}], picked:null, shattered:false }`

规则：
1. 每层最多 1 间房放双祭坛：优先事件房，其次宝箱房；不占战斗房、不占首领/出生/代价/钥匙房。
2. 两座祭坛左右并排（以房心为轴），都要求可走、不被立柱挡、离门 ≥44；一侧放不下就整组放弃（不强塞）。
3. 靠近任一祭坛按 E 选择：选中的生效，另一座**立刻碎裂**（`shattered=true`），不可再选、不可逆。
4. 力量祭坛：本局技能伤害 ×1.15（写 `state.mods.damageMul`，立即 `addFloat` 说明）。
   丰饶祭坛：结晶 +2、余烬 +15、奥能 +50（`saveMeta()` 落盘）。
5. 门板第二行提示 `双选祭坛 · 两选一 · 选完另一座碎裂`，让玩家在门口就想清楚。
6. 选择瞬间：选中祭坛亮一圈 + toast 结果，未选祭坛画裂纹（不需要新美术资源）。
7. 调试口 `__roamDebug.dualAltar { info(), setEnabled(), setFloor(n), enter(), pick(id), reset() }`；
   `getState().dualAltar` 暴露同一份状态与统计。

## C2 专项断言（tools/arcane_dualaltar.js，端口 9524）
A0 配置默认值；A1 每层 ≤1 组且房型为事件/宝箱、两座祭坛均可达；
A2 门板文案含"两选一/碎裂"；A3 未选择时两座都可用、状态 picked=null；
A4 选力量 → damageMul ×1.15 且只有一次；A5 选丰饶 → 结晶/余烬/奥能到位；
A6 选完另一座不可再选（shattered=true、第二次 pick 返回 false、数值不再变化）；
A7 不可逆：离开再回来/重新进入仍保持 picked；A8 enabled=false 不生成；
A9 截图 / fps / 零报错。

## C2 降级
`DUAL_ALTAR_CONFIG.enabled=false` 整层不生成；找不到事件/宝箱房时跳过，不影响主流程。

---

## C3 全探索奖励（第三项，待做）
- `FULL_CLEAR_BONUS_CONFIG { enabled, reward: 三选一, text }`：本层所有房间都探索过 →
  楼梯旁多给一次三选一，每层只给一次。

