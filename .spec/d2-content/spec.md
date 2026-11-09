# D2 · 内容扩容（深度）

目标：把"重复刷同一套内容"改成"每局能看到新组合"。三块都必须数据驱动、可单独 A/B。

总开关：`D2_CONFIG = { enabled, relics, events, floorEnemies, exclusiveChance: 0.45, exclusiveIds: [...] }`
调试口：`window.__roamDebug.d2 = { info, setEnabled, setFeature, grantRelic, clearRelics, runEvent, spawn }`

---

## 1. 遗物 5 → 12（每件独立机制，禁止纯数值 +）

原有 5 件（hp / regen / power / haste / swift）+ 标签遗物 3 件（ember / conductor / resonance，不计入这次 12 件基础池）。

新增 7 件，全部是"条件 / 触发 / 反制"，都不是面板数值：

| id | 名称 | 机制 | 挂载点 |
|---|---|---|---|
| lastStand | 背水 | 生命 ≤ 40% 时技能伤害 ×1.3 | `newRelicDamageMul()` |
| overflow | 溢流 | 奥能 ≥ 75% 时技能伤害 ×1.22 | `newRelicDamageMul()` |
| firstStrike | 先手 | 每间房第一击 ×1.8，同房只一次 | `damageEnemy()`（按 `state.currentRoomId` 去重） |
| momentum | 惯性 | 玩家速度 ≥ 60 时 ×1.18，站定无加成 | `newRelicDamageMul()` |
| bloodthirst | 嗜血 | 击杀回复 3 生命 / 层（最多 2 层） | `killEnemy()` |
| thorns | 荆棘 | 受伤时对最近敌人反弹 40% 伤害 | `damagePlayer()`（`state.relicThornsBusy` 防递归） |
| roomCharge | 层压 | 每清一间房本局伤害 ×1.03，最多 5 层 | `onRoomCleared()`（`state.relicRoomCharge`） |

规则：
1. 条件倍率统一在伤害出口 `getMagicDamage()` 乘一次，**不在 apply() 里累乘**，避免读档重复叠。
2. 全部行为受 `D2_CONFIG.relics === false` 关闭；关闭后原有 5 件与 3 件标签遗物完全不变。
3. 标签遗物（ember/conductor/resonance）不受 D2 开关影响，仍由 `tagDamageMul` 管。
4. 三选一奖池自动包含新遗物（走原 `RELIC_CONFIG` 构建的 `RELIC_BY_ID`）。

断言（A0–A8）：基础遗物计数 12、7 个 id 齐全且描述含条件词、背水 1.3/满血 1.0、溢流 1.22、惯性 1.18、先手 done 状态机、嗜血 +3、荆棘反弹 4/10、层压 7 次只叠 5 层（1.03^5）。

---

## 2. 事件房选项翻倍（≥ 4 条改"能力 / 标签 / 代价"）

`ROOM_TYPE_CONFIG.eventTable` 从 6 条扩到 12 条（事件池 6 → 12；标签事件从 3 → 6）。

新增 6 条：

| id | 类型 | 效果 |
|---|---|---|
| purge | 能力/标签 | 剥离一张卡的一个非元素标签（area/projectile/chain/control/sustain/heal），附赠 1 结晶 |
| graft2 | 标签 | 补一个缺失的元素标签（复用 graft 解析器） |
| retune2 | 标签 | 元素标签倒退一位（复用 retune 解析器） |
| bloodpact | 代价 | 生命 -22 → 结晶 +2 |
| embertax | 代价 | 生命 -10 → 余烬 +20 |
| aetherforge | 代价 | 奥能 -45 → 生命 +45 |

规则：
1. `u11cEventPool()` 在 `D2_CONFIG.events === false` 时过滤掉这 6 个 id，退回旧池（6 条）。
2. `u11cResolveEvent` 新增 `purge` 分支；`u11cPurge(ids)` 只删第一个命中的非元素标签，保证结果可预测。
3. 代价事件的生命/奥能走 clamp：生命不低于 1，结晶/余烬不低于 0。
4. 事件文案必须写清"失去什么 / 得到什么"，不做盲盒。
5. `rewardCrystals` 写在事件条目上，由事件房结算统一入账（`saveMeta` + `crystalsEarned`）。

断言（A9）：表 ≥ 12 条、effect 事件 ≥ 5、`purge` 能剥离 1 个标签（before 比 after 多 1）、关 D2 后池大小变小。

---

## 3. 楼层专属敌人（独立外形 + 行为差异）

`ENEMY_CONFIG` 新增 2 种，带 `floorOnly`：

| id | 名称 | 楼层 | 外形（新 body） | 行为（AI v2 role / blocks） |
|---|---|---|---|---|
| forgepriest | 炉心祭司 | [4] | `mech` / `forge`：八边炉壳 + 呼吸炉心 + 两侧排渣口 | `burst`：kite + burst（中距离蓄力爆发） |
| voidbishop | 虚空主教 | [5] | `void` / `bishop`：六边冠 + 三只竖眼 + 反向裂环 | `rush`：chase + burst + selfdestruct（贴身 + 濒死自爆） |

规则：
1. `floorExclusivePick(floorNumber, room, i)` 只在 `floorOnly` 命中时参与；用 `(room.x, room.y, i, floor)` 稳定哈希，同层重开不闪烁。
2. `exclusiveChance = 0.45`，关 `D2_CONFIG.floorEnemies` 后恒返回 null，刷怪退回原区域池。
3. 替换发生在 `spawnEnemiesForFloor` 选完池内怪之后，精英房也遵守（只换类型，不换房型奖励）。
4. 外形必须走独立 body 分支（`drawMechEnemy` 的 `forge` / `drawVoidEnemy` 的 `bishop`），不能复用旧 body 换色。

断言（A10）：两种怪 floorOnly 分别为 [4]/[5]、非指定楼层不替换、第 4 层可命中、`body` 为 forge/bishop 且 `spawnEnemy` 能生成。

---

## 降级与 A/B

- 总开关 `D2_CONFIG.enabled=false`：三块一起退回旧内容，游戏仍可正常开局/清房/结算。
- 子开关：`relics / events / floorEnemies` 可分别关闭。
- 新遗物只读 `state.relics`，缺字段按 0 处理；旧存档不会崩。
- `state.relicFirst` / `state.relicRoomCharge` 缺失时按默认值补（无需迁移）。
