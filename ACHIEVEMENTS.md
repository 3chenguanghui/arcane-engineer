# 烬 · 成就系统设计（v1.9 新线）

> 阶段：只读设计。未打开浏览器、未改动 `index_arcane_v2.html`。
> 设计基线（单快照读取，`.optim/snapshot_C.html` 已复核）：字节 **2,833,891** / 字符 **2,369,375** / 行 **65,981** / MD5 `CA61D8A90DD6784AA63CB8F0F71B40A1`。
> **写入台账**：设计期间主文件被第三方线写入两次，我全程未写主文件。
> · 第一次 2026-11-08 23:03:48：净 +1 行 / +72 字节（`setWeaponsEnabled` 上方注释）。
> · 第二次（本次）净 +11,412 字节，改动位于 `announceAchievement` 与 `ui.toast` 之间的 UI 模块区。
> · 当前主文件：字节 **2,845,375** / 字符 **2,378,390** / 行 **66,226** / MD5 `3B376F821D70EE1617A6C5A41C88508C`。
> · P5 六个字符串锚点已在当前版本逐一复核唯一命中：`.toast.is-error`(1380)、`<div id="toast" …>`(6254)、`function announceAchievement`(17850)、`ui.toast = …`(25084)、`metaBumpStat('deaths', 1);`(49985)、通关结算注释(51359)。
> 配套落地文档：[ACHIEVEMENTS_PATCH.md](./ACHIEVEMENTS_PATCH.md)。

---

## 0. 结论摘要

1. 主文件**已经有一版成就**（`META_PROGRESS_CONFIG.achievements`，共 **38 条**），存档、发奖、面板、调试模拟链路齐全。本条线不是从零造，而是**审计 + 收敛 + 补容错 + 补表现层**。
2. 现状有 4 个真问题：① 38 条无分类、无隐藏、无筛选；② 同帧解锁多条时 toast 互相覆盖，玩家只看得到最后一条；③ 存在“刷量型/奖励失败型”条目；④ 老档读到未知 id 会被 `normalizeMeta` 直接过滤，**退休条目会静默丢失记录**。
3. 收敛为 **35 条**，按需求四类：进度 10 / 技巧 8 / 探索 8 / 长期 9；隐藏 4 条。
4. 数据侧只需新增 **7 个容器字段**，全部走“缺失即默认、脏值即归零”的容错；老档不会崩、不会丢进度。
5. 实测代价：新增字段序列化 **净减 84 字节**；35 条全表扫描一次 **0.024 ms**；检查只在 11 类语义事件触发，**不是每帧**。

---

## 1. 现状审计（已有 38 条）

### 1.1 已有链路

| 环节 | 位置（函数名锚点） | 现状 |
|---|---|---|
| 配置表 | `META_PROGRESS_CONFIG.achievements` | 38 条，纯数据；`metric + target` 判定 |
| 存档结构 | `defaultMeta()` 的 `achievements` / `achievementsAether` / `rewards` | `achievements[id] = 解锁时间戳`，只发一次 |
| 读档容错 | `normalizeMeta()` | 补齐 stats、过滤非法 id、夹紧奖励上限 |
| 判定 | `metaMetricValue(metric, meta)` | 16 个 case，缺省返回 0 |
| 结算 | `checkMetaAchievements(silent)` | 达成即写档、发奖、`saveMeta()` |
| 提示 | `announceAchievement(item)` | `showToast` + 脚下金环 + 浮字 |
| 面板 | `renderArchivePanel()` | 设置页「档案 · ARCHIVE」内 6 格统计 + 全部条目平铺 |
| 调试 | `__roamDebug.p2.simulate(id)` | 按 metric 把统计推到 target，再走真实结算 |

### 1.2 已有 38 条的真实分布

- 击杀/首领：`first_kill`、`kills_100`、`kills_1000`、`elite_50`、`elite_200`、`boss_kills_1`、`boss_kills_5`、`boss_20`
- 楼层/通关：`floor_3`、`floor_5`、`floor_8`、`floor_12`、`floor_20`、`first_win`、`single_school_3`
- 技巧：`combo_16`、`combo_30`、`combo_50`、`flawless_1`、`flawless_5`、`single_school`、`run_recipes_5`、`barrel_20`
- 收集：`recipe_3`、`recipe_all`、`blueprint_1`、`blueprint_all`、`relics_10`、`cards_all`、`codex_enemies_all`
- 探索/其他：`hidden_room_1`、`void_rift_1`、`daily_clear`、`wager_3`、`sacrifice_5`、`deaths_5`、`talents_30`、`challenge_10`

### 1.3 必须修的问题

| 编号 | 问题 | 证据 | 影响 |
|---|---|---|---|
| A1 | 同帧多解锁时 toast 覆盖 | `checkMetaAchievements` 循环内逐条 `announceAchievement`，每次 `toastNow` 会 `clearTimeout` 并覆盖文本 | 玩家只看到最后一条，成就反馈失效 |
| A2 | 无分类/无隐藏/无筛选 | 面板 `list.map(...)` 平铺 38 行 | 成就墙不可读，隐藏成就无法成立 |
| A3 | 退休 id 会丢记录 | `normalizeMeta` 只保留 `META_PROGRESS_CONFIG.byId[id]` | 收敛到 35 条时，旧档已解锁的 14 条被静默删除 |
| A4 | 奖励池已饱和 | 22 条带奖励合计奥能 26 = `maxAetherReward: 26` | 再加奖励必显示「初始奥能 +0」 |
| A5 | 打工型条目 | `elite_200`、`boss_20`、`wager_3`、`sacrifice_5`、`deaths_5`、`single_school_3` | 机械重复或奖励失败，违背“成就不该是打工” |

---

## 2. 数据盘点

### 2.1 老档已有、够用的字段（26 条成就直接可用）

| 字段 | 类型/默认 | 写入点 | 对应成就 |
|---|---|---|---|
| `bestFloor` | number / 1 | 换层、死亡、通关、里程碑 | `floor_3/5/8/12/20` |
| `clears` | number / 0 | `winGame()` | `first_win`、`clears_5` |
| `runs` | number / 0 | `startGame()` / `restartRun()` 各 +1 | `runs_20`（需补读取 case） |
| `stats.kills` | number / 0 | `metaBumpStat('kills',1)` 每次击杀 | `kills_100`、`kills_1000` |
| `stats.eliteKills` | number / 0 | 精英死亡分支 | `elite_50` |
| `stats.bossKills` | number / 0 | 首领结算 | `boss_kills_5` |
| `stats.flawlessFloors` | number / 0 | 换层 `floorNoHit`、通关末层 | `flawless_1/5` |
| `stats.hiddenRooms` | number / 0 | `enterHiddenRoom()` | `hidden_room_1` |
| `stats.voidRifts` | number / 0 | 虚空裂隙使用 | `void_rift_1` |
| `stats.singleSchoolClears` | number / 0 | `winGame()` 的 `runSingleSchool()` | `single_school` |
| `bestCombo` | number / 0 | `metaRecordPeak('bestCombo', …)` | `combo_30/50` |
| `recipes[]` | string[] / [] | `noteMetaRecipe()` | `recipe_all` |
| `bossBlueprints[]` | string[] / [] | 蓝图解锁 | `blueprint_all` |
| `codex.cards[]` | string[] / [] | 图鉴标记 | `cards_all`（26 张） |
| `codex.enemies[]` | string[] / [] | 图鉴标记 | `codex_enemies_all`（33 种） |
| `codex.relics[]` | string[] / [] | 图鉴标记 | `relics_10`（共 15 件） |
| `talents{}` | 30 项 / 0 | 天赋升级 | `talents_30` |
| `challengeCleared{}` | 键 0–10 / 0 | `challengeRecordClear()` | `challenge_10` |
| `achievements{}` | id→时间戳 / {} | `checkMetaAchievements` | 全部“只发一次” |
| `achievementsAether{}` | id→实得奥能 / {} | `checkMetaAchievements` | 面板/提示同口径 |

### 2.2 运行期已有、可直接取用的状态

| 字段 | 说明 | 用途 |
|---|---|---|
| `state.runNoHit` | 本局是否从未掉血；`createInitialState` 置 true，三处真实扣血分支置 false | 整局无伤（无需新写逻辑，只需在通关时落盘） |
| `state.elapsed` | 本局秒数 | 限时通关、累计时长 |
| `state.characterId` | 本局角色（`warden / ember / gazer / none`） | 角色专属通关 |
| `state.player.hp / hpMax` | 通关瞬间血量 | 残血翻盘 |
| `state.rooms[].type` | 13 种房型键 | 全房型 |
| `localDateKey()` | 本地时区 `YYYYMMDD` | 连续挑战日期 |

### 2.3 需要新增的 7 个字段

| 字段 | 类型 / 默认 | 写入时机 | 最大增量 |
|---|---|---|---|
| `stats.perfectRuns` | number / 0 | `winGame()` 且 `state.runNoHit !== false` | 每次通关 +1 |
| `stats.lowHpClears` | number / 0 | `winGame()` 且 `hp/hpMax ≤ 0.15` | 每次通关 +1 |
| `charClears` | `{warden:0, ember:0, gazer:0}` | `winGame()` 且 `state.characterId` 是三名角色之一 | 每次通关一处 +1 |
| `bestClearTime` | number / 0（0 = 无记录） | `winGame()` 取 `min(旧值, elapsed)` | 每次通关最多一次 |
| `playSeconds` | number / 0 | 通关或死亡时 `+= elapsed` | 每局一次 |
| `roomTypesSeen` | string[] / [] | `trackBacktrack()` 进房变化、`enterHiddenRoom()` 记 `vault` | 最多 12 个键 |
| `dailyStreak` | `{lastDate:'', current:0, best:0}` | `startDailyRun()` 成功开局后 | 每自然日最多一次 |

> `runs` 字段已存在，只是 `metaMetricValue` 没有读取分支，属于“补 case”，不是新增存储。

### 2.4 老存档容错（硬要求）

1. 所有新字段在 `normalizeMeta` 里**先取默认、再逐项校验**：非负整数、数组去重、`dailyStreak` 只接受合法日期串。
2. `achievements` / `achievementsAether` 允许保留 **退休 id**（`META_PROGRESS_CONFIG.legacyIds`），仅不展示、不参与计数；绝不能因为条目被裁掉就删掉玩家历史。
3. `raw.roomTypesSeen` 不是数组、`raw.charClears` 是字符串、`dailyStreak` 是 `null` 等脏输入，一律回默认值，不抛异常。
4. 读档过程**零写入**：只补内存字段，不修改 `runs / bestFloor / talents / crystals`。

---

## 3. 成就清单（35 条）

### 3.1 进度类 · PROGRESS（10 条）

| # | id | 名称 | 判定条件 | metric / target | 难度 | 隐藏 | 自然/挑战 |
|---|---|---|---|---|---|---|---|
| 1 | `floor_3` | 下潜三层 | 最高到达第 3 层 | `bestFloor` / 3 | ★☆☆ | 否 | 自然 |
| 2 | `floor_5` | 抵达终章 | 最高到达第 5 层 | `bestFloor` / 5 | ★☆☆ | 否 | 自然 |
| 3 | `floor_8` | 深井常客 | 最高到达第 8 层 | `bestFloor` / 8 | ★★☆ | 否 | 自然 |
| 4 | `floor_12` | 塔心回响 | 最高到达第 12 层 | `bestFloor` / 12 | ★★★ | 否 | 自然（长尾） |
| 5 | `floor_20` | 深井尽头 | 最高到达第 20 层 | `bestFloor` / 20 | ★★★★ | 否 | 挑战 |
| 6 | `first_win` | 首次通关 | 完成一局 | `clears` / 1 | ★★☆ | 否 | 自然 |
| 7 | `clears_5` | 五次收束 | 累计通关 5 次 | `clears` / 5 | ★★★ | 否 | 自然（长尾） |
| 8 | `role_warden` | 守拙之证 | 以守拙通关 1 次 | `charClearWarden` / 1 | ★★★ | 否 | 挑战 |
| 9 | `role_ember` | 疾火之证 | 以疾火通关 1 次 | `charClearEmber` / 1 | ★★★ | 否 | 挑战 |
| 10 | `role_gazer` | 观星之证 | 以观星通关 1 次 | `charClearGazer` / 1 | ★★★ | 否 | 挑战 |

### 3.2 技巧类 · SKILL（8 条）

| # | id | 名称 | 判定条件 | metric / target | 难度 | 隐藏 | 自然/挑战 |
|---|---|---|---|---|---|---|---|
| 11 | `flawless_1` | 滴水不漏 | 无伤清空 1 层 | `flawlessFloors` / 1 | ★☆☆ | 否 | 自然 |
| 12 | `flawless_5` | 毫发无伤 | 无伤清空 5 层 | `flawlessFloors` / 5 | ★★★ | 否 | 挑战 |
| 13 | `perfect_run` | 一尘不染 | 整局未掉血通关 | `perfectRuns` / 1 | ★★★★ | 是 | 挑战 |
| 14 | `single_school` | 专精一路 | 只用同一流派（≥2 张不同魔法）通关 | `singleSchoolClears` / 1 | ★★★ | 否 | 挑战 |
| 15 | `lowhp_win` | 残血翻盘 | 通关瞬间生命 ≤ 15% | `lowHpClears` / 1 | ★★★★ | 是 | 挑战 |
| 16 | `fast_clear` | 十二分钟 | 普通难度通关用时 ≤ 720 秒 | `fastestClear` / 720 | ★★★★ | 是 | 挑战 |
| 17 | `combo_30` | 连锁大师 | 单次连击峰值 30 | `comboPeak` / 30 | ★★☆ | 否 | 自然 |
| 18 | `combo_50` | 连锁成瘾 | 单次连击峰值 50 | `comboPeak` / 50 | ★★★★ | 否 | 挑战 |

> `fastestClear` 的读取口径：`bestClearTime > 0 ? bestClearTime : 999999`，否则“0 秒”会误判达成。限时只在**普通难度、非种子/每日局**记录（避免种子局与每日局口径不可比）。

### 3.3 探索类 · EXPLORE（8 条）

| # | id | 名称 | 判定条件 | metric / target | 难度 | 隐藏 | 自然/挑战 |
|---|---|---|---|---|---|---|---|
| 19 | `hidden_room_1` | 墙后有人 | 首次进入秘藏房 | `hiddenRooms` / 1 | ★★☆ | 否 | 自然 |
| 20 | `void_rift_1` | 裂隙旅人 | 首次使用虚空裂隙 | `voidRifts` / 1 | ★★☆ | 否 | 自然 |
| 21 | `rooms_all` | 十二面 | 除起始房外 12 种房型各进入一次 | `roomTypesSeen` / 12 | ★★★★ | 是 | 挑战 |
| 22 | `cards_all` | 卡池见底 | 图鉴卡牌 26 张（18 魔法 + 8 科技） | `codexCards` / 26 | ★★★★ | 否 | 自然（长尾） |
| 23 | `codex_enemies_all` | 名录补全 | 图鉴敌人 33 种 | `codexEnemies` / 33 | ★★★★ | 否 | 自然（长尾） |
| 24 | `recipe_all` | 配方全图鉴 | 全部 13 条融合配方 | `recipes` / 13 | ★★★ | 否 | 自然（长尾） |
| 25 | `blueprint_all` | 蓝图集齐 | 全部 15 张首领蓝图 | `blueprints` / 15 | ★★★ | 否 | 自然（长尾） |
| 26 | `relics_10` | 拾荒成性 | 图鉴遗物 10 件（共 15） | `codexRelics` / 10 | ★★☆ | 否 | 自然（长尾） |

> 12 种房型 = `battle / elite / chest / event / sacrifice / wager / curse / rest / shop / survival / vault / boss`（不含 `start`）。`vault` 只能由暗门潜入，单独在 `enterHiddenRoom()` 记一次。

### 3.4 长期类 · LONG（9 条）

| # | id | 名称 | 判定条件 | metric / target | 难度 | 隐藏 | 自然/挑战 |
|---|---|---|---|---|---|---|---|
| 27 | `kills_100` | 拆解专家 | 累计击杀 100 | `kills` / 100 | ★☆☆ | 否 | 自然 |
| 28 | `kills_1000` | 千机散架 | 累计击杀 1000 | `kills` / 1000 | ★★★ | 否 | 自然 |
| 29 | `elite_50` | 精英猎手 | 累计击杀精英 50 | `eliteKills` / 50 | ★★★ | 否 | 自然 |
| 30 | `boss_kills_5` | 首领终结者 | 累计击败首领 5 | `bossKills` / 5 | ★★☆ | 否 | 自然 |
| 31 | `runs_20` | 二十次下潜 | 累计开局 20 局 | `runs` / 20 | ★★☆ | 否 | 自然 |
| 32 | `daily_streak_7` | 七日不辍 | 连续 7 个本地日期进入今日挑战 | `dailyStreakBest` / 7 | ★★★ | 否 | 挑战（习惯） |
| 33 | `talents_30` | 天赋满墙 | 天赋总等级 30 | `talentLevels` / 30 | ★★★ | 否 | 自然 |
| 34 | `play_5h` | 五小时灯火 | 累计游玩 18000 秒 | `playSeconds` / 18000 | ★★☆ | 否 | 自然 |
| 35 | `challenge_10` | 无阶可退 | 以挑战等级 10 通关 | `challenge10Clears` / 1 | ★★★★ | 否 | 挑战 |

### 3.5 自然获得 vs 专门挑战

- **自然获得（22 条）**：#1–4、#6、#7、#11、#17、#19、#20、#22–31、#33、#34。正常推进就会拿到，不需要刻意做。
- **专门挑战（13 条）**：#5、#8–10、#12–16、#18、#21、#32、#35。需要换角色、压血、限时、限制构筑、绕房型或连续登录。
- **七日不辍**属于“习惯型”，不要求每天通关，只要打开今日挑战；它不会被“某天漏了就清零”惩罚，`best` 只增不减。

### 3.6 删除的打工型条目（14 条）

| id | 删除理由 |
|---|---|
| `wager_3` | 依赖随机胜率，最坏情况是反复下注，机械重复 |
| `sacrifice_5` | 纯次数累加，没有构筑或叙事收益 |
| `deaths_5` | 奖励失败，负体验 |
| `elite_200` / `boss_20` | 纯线性刷量，已被 1000 击杀 / 50 精英覆盖 |
| `single_school_3` | 与 `single_school` 重复，只是 ×3 |
| `barrel_20` | 依赖房间是否刷桶，可遇不可求，容易变成运气挂机 |
| `daily_clear` | 单日通关价值低，被“七日不辍”覆盖 |
| `first_kill` / `combo_16` / `boss_kills_1` / `recipe_3` / `blueprint_1` / `run_recipes_5` | 低档重复，弹窗噪音；对应高阶条目保留 |

> 这些 id 进入 `legacyIds`：老档的解锁时间戳继续保存，面板不显示、计数不计入，但**绝不删除**。

### 3.7 奖励策略

- 现有 22 条带奖励合计奥能 **26**，正好等于 `maxAetherReward: 26`；新条目一律 `reward: {}`。
- 删掉 7 条带奖励条目（`first_kill`、`boss_kills_1`、`combo_16`、`run_recipes_5`、`recipe_3`、`blueprint_1`、`deaths_5` 共 7 点，其中 `first_win` 发卡不占奥能），总奥能降到 19，cap 仍保留 26：
  - 若下调 cap，老档 `rewards.aether` 会被夹小，玩家永久变弱 → **cap 不允许下调**。
  - 余量 7 点留给后续里程碑，不再新增到饱和。
- 面板与 toast 继续使用 `achRewardText()` 的“实际到账”口径，禁止显示名义值。

---

## 4. 表现层

### 4.1 解锁提示

| 项 | 设计 |
|---|---|
| 位置 | 独立元素 `#achvToast`，顶部居中距顶 **150px**（系统 toast 在 104px，二者上下分开、互不覆盖） |
| 时长 | 每条 **1800 ms**，条间空档 **220 ms**；隐藏成就 **2400 ms** |
| 同帧多条 | 同屏只允许 **1 条**，逐条播放；队列上限 **6 条**，超出合并为「成就解锁 ×N」 |
| 同批顺序 | 进度 → 技巧 → 探索 → 长期，同类按配置表顺序（可复现） |
| 结算打断 | 正在播的不掐断；剩余转结算模式，最多详播 2 条（隐藏优先），其余汇总；`z-index: 66` 盖在结算面板之上 |
| 是否打断战斗 | 不暂停、不抢焦点、不锁输入、不进弹窗层 |
| 附加反馈 | `playSfx('reward', 0.6)`；玩家脚下金环 + 浮字（仅同批首条播环） |
| 隐藏成就 | 未解锁显示 `???`；解锁瞬间「揭晓」：紫框 + `✧` + 达成条件行 + 轻抖 |
| 回退开关 | `?achnotice=off` 关闭全部成就提示，结算与写档照常 |

### 4.2 成就墙

| 项 | 设计 |
|---|---|
| 位置 | **设置页现有「档案 · ARCHIVE」区块**，不另开独立页（打开即暂停，零新增导航成本） |
| 分类 | 分段筛选：全部 / 进度 / 技巧 / 探索 / 长期；默认“全部” |
| 行结构 | 名称 + 条件 + 进度条 + 进度数字 + 奖励 + 状态（✓ 日期 / 锁定） |
| 未解锁（普通） | 整行 45% 透明度、灰色描边，条件与进度可见（给目标感） |
| 未解锁（隐藏） | 名称显示「???」、条件显示「隐藏成就 · 达成后揭示」、进度条隐藏 |
| 已解锁 | 金色左边条 + 达成日期；不只靠颜色，必须有 ✓ 与日期文本 |
| 顶部计数 | 「成就 12 / 35 · 进度 3/10 · 技巧 2/8」 |

### 4.3 视觉令牌（沿用现有青金紫）

| 用途 | 令牌 | 值 |
|---|---|---|
| 科技青（锁定条 / 进度底） | `--tech` | `#3ee6ff` |
| 魔法紫（分类标题 / 进度渐变尾） | `--magic` | `#b085ff` |
| 强调金（已解锁条 / 日期） | `--gold` | `#ffc247` |
| 成功绿（可选 ✓） | `--good` | `#47e8a7` |

- 进度条渐变 `linear-gradient(90deg, var(--tech), var(--magic))`；已解锁行底色 `rgba(255,194,71,0.08)`。
- 圆角沿用现有 4px / 6px；不新增字体、不新增图片。
- 无障碍：锁定/解锁同时用文字和图标区分，不把颜色作为唯一信号；进度条保留 `role="progressbar"` 与 `aria-valuenow`。

---

## 5. 代价

### 5.1 检查频率（不每帧）

只在 **11 类语义事件**触发：

1. 击杀敌人（现有调用点，事件驱动）
2. 清空一层 / 换层
3. 进入新房间（只在该房间首次进入时）
4. 通关
5. 死亡
6. 发现融合配方
7. 使用虚空裂隙
8. 进入秘藏房
9. 开始今日挑战
10. 天赋升级
11. 图鉴解锁

明确禁止：`update()` 主循环每帧调用、绘制函数内调用。

### 5.2 实测开销

| 指标 | 实测值 | 口径 |
|---|---|---|
| 35 条全表扫描 1 次 | **0.024 ms** | Node 24.19.0，35 项 × 10000 次 = 8.465 ms |
| 单局估算（约 200 次合并扫描） | **≈ 4.8 ms** | 20 分钟局，占比 < 0.001% |
| 写盘 | 仅解锁瞬间一次 `saveMeta()` | 全局最多 35 次，不在击杀时写 |
| 内存 | 常量级，35 个小对象 | 与当前 38 条持平 |

### 5.3 存储增量

按“35 条全解锁 + 12 种房型全见 + 三名角色各 1 次通关”的最坏样本序列化：

| 项 | 字节（UTF-8） |
|---|---|
| 旧 38 条 + 无新字段 | 1,323 |
| 新 35 条 + 7 个新字段 | 1,239 |
| **净增量** | **−84 字节** |

即存储不升反降。`achievements` 字典本身从 1,024 字节降到 940 字节；新增容器合计约 299 字节。

### 5.4 老档风险

| 风险 | 处理 |
|---|---|
| 字段缺失 | `normalizeMeta` 默认值补齐，成就按“未解锁”处理 |
| 字段类型错误 | `typeof` / `Array.isArray` 校验，非法归默认 |
| 退休 id | 保留在 `legacyIds`，只隐藏不删除 |
| 奖励超上限 | 继续 `clamp` 到 `maxAetherReward`，提示显示实际到账 |
| 坏档 | 沿用现有坏档备份 + 只读保护，成就模块不新增写盘路径 |

---

## 6. 验收清单

1. 老档（手动删掉全部新字段）启动无报错，成就墙显示 0/35。
2. `achievements` 被改成字符串/数字/null，仍能启动，不崩。
3. 旧档已解锁的 14 条退休成就，记录仍在 `meta.achievements`，只是不展示。
4. 35 条全部能通过 `__roamDebug.p2.simulate(id)` 走完“统计→达标→发奖”。
5. 同帧解锁 3 条时，3 条提示依次播放，无覆盖、无丢失。
6. 隐藏成就在未解锁时不显示名称与条件。
7. 全文件搜索 `checkMetaAchievements`，确认没有任何调用位于每帧 `update` 路径。
8. 存档导出对比：新增字段序列化增量 ≤ +300 字节；全解锁状态净增量 ≤ 0。
9. `META_PROGRESS_CONFIG.enabled = false` 时成就墙显示“已关闭”，不误触发。
10. 老档 `runs / bestFloor / talents / crystals` 读档前后逐字节一致。
