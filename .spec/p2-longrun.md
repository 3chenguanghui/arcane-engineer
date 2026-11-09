# P2 · 长线可玩性（实现规格）

> 状态：规格定稿，写完即开工（用户已授权规格自决）
> 目标文件：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`（单文件、零依赖）
> 顺序：① 种子局 → ② 进阶难度 → ③ 图鉴；每件完成单独汇报“玩家视角怎么用”
> 纪律：不改弱已 PASS 断言；函数级注释；总开关可回滚；旧存档迁移不崩

## 0. 总设计

| 子功能 | 父开关 | 持久字段 | 运行时 |
|---|---|---|---|
| 种子局 | `SEED_CONFIG.enabled` | `meta.seedRuns`（map，限 60 条） | `state.seedInfo` |
| 进阶 | `ASCENSION_CONFIG.enabled` | `meta.ascensionUnlocked / ascension` | `state.ascension` |
| 图鉴 | `CODEX_CONFIG.enabled` | `meta.codex`（5 个已见 id 数组） | `state.codexPage`（纯 UI） |

`META_SCHEMA_VERSION` 5 → 6，`migrateMeta` 增加 v5→v6：
补 `seedRuns:{}`、`ascensionUnlocked:0`、`ascension:0`、`codex:{enemies:[],recipes:[],blueprints:[],relics:[],cards:[]}`。
`normalizeMeta` 逐项过滤非法 id / 夹紧数值；旧档缺 `codex` 时用 `meta.recipes`、`meta.bossBlueprints` 回填，绝不重置已有解锁。

## 1. 种子局（每日挑战 + 自定义种子 + 成绩）

### 1.1 配置（放在 `DIFFICULTY_CONFIG` 之后）
```js
const SEED_CONFIG = {
  enabled: true,                 // 总开关：false → 所有 seed 分支短路，随机行为与 1.0.3 完全一致
  dailyPrefix: 'daily-',         // 今日挑战种子格式 daily-YYYYMMDD
  minLen: 1, maxLen: 24,         // 自定义种子合法长度
  maxRecords: 60,                // meta.seedRuns 条数上限（按 lastAt 淘汰最旧）
  panelLimit: 8                  // 标题页成绩列表最多显示 8 条
};
const SEED_STATS = { floors:0, seededFloors:0, lastSeed:null, lastFingerprint:null };
```

### 1.2 随机源（单一入口）
新增：
- `hashSeedString(str)` → 32 位整数（FNV-1a）。
- `mulberry32(a)` → 返回 `() => [0,1)`。
- `makeSeedRng(seed, salt)` → `mulberry32(hashSeedString(String(seed)+'|'+salt))`。
- `rng()` → `__rngOverride ? __rngOverride() : Math.random()`。
- `seedActive()` → `SEED_CONFIG.enabled && state && state.seedInfo && state.seedInfo.active && state.seedInfo.value`。
- `withSeedRng(seed, salt, fn)` → 设置/恢复 `__rngOverride`。

改造这些**玩法随机**入口改用 `rng()`：
`rand` / `randInt` / `pickRandom` / `shuffleArray` / `pickEliteAffix` / `grantBossBlueprint` 掉率 / `spawnLoot` 掉落 roll / `wager` 胜负 roll / `pickWeightedOptions` / `dropXp` 结算 / `crit` / 时序器重置。
粒子、震屏、音频噪声等**纯表现**保持 `Math.random()`，不消耗种子流。

楼层隔离：`generateFloor(n)` 开头
`const __seedPrev = __rngOverride; if (seedActive()) __rngOverride = makeSeedRng(state.seedInfo.value, 'floor:'+n);`
结尾恢复 `__rngOverride = __seedPrev` 并写入 `state.floorSignature`。
因此楼层布局/编队/掉落只由“种子+层号”决定，与帧率、操作时序无关。
玩法期（战斗掉落等）用 `state.playRng`：开局 `state.playRng = seedActive() ? makeSeedRng(seed,'play') : null`，`rng()` 在玩法期读它。

### 1.3 指纹（断言唯一真源）
`state.floorSignature = { floor, seed, rooms:[{id,type,x,y,w,h}], enemies:[{type,roomId,x,y,elite,affix,hpMax}], doors, spawnRoomId, stairId }`。
`seedSignatureOfRun()` 返回 JSON 字符串；`seedCompare(a,b)` 返回首个差异路径。
`__roamDebug.seed.probe(seed, floors)`：设置种子→重启→逐层 `descend`→返回每层 signature 与掉落 roll 序列。

### 1.4 每日挑战
- `localDateKey()` → 本地时区 `YYYYMMDD`。
- `dailySeed()` → `'daily-' + localDateKey()`。
- 同一台机器同一天：种子只由日期推导，重开/刷新完全一致。
- 标题页入口 `#btnDaily`：按钮文案「今日挑战 · 2026-11-06 · daily-20261106」，点击 = 用今日种子开局。
- 自定义：`#seedCustomInput` + `#btnSeedStart`；输入去掉首尾空格，长度 1–24，空输入视为无种子。
- 种子展示：`#seedBadge` 常驻标题页与 HUD 小字（本局种子），并提供复制按钮（`navigator.clipboard` 失败时降级 `select()`）。

### 1.5 成绩记录
`meta.seedRuns[seed] = { seed, daily, date, bestFloor, bestTime, deathCause, cleared, attempts, lastAt }`。
- `seedRecordRun(result)`：死亡/通关/重开时调用；只保留更优（更高层数；同层比更短用时；通关优先）。
- 记录展示：标题页 `#seedRecords` 列表（日期、种子、最高层、用时、死因/通关）。
- `SEED_CONFIG.enabled=false`：按钮/输入框隐藏，`seedActive()` 恒 false，玩法随机回 `Math.random()`。

## 2. 进阶难度

### 2.1 配置
```js
const ASCENSION_CONFIG = {
  enabled: true,
  maxLevel: 4,
  unlockClears: 1,
  levels: [
    { level:1, id:'swarm', name:'敌潮', rule:'每间战斗 / 精英房额外 +1 名敌人', short:'敌潮 · 敌人 +1' },
    { level:2, id:'affix', name:'精英强化', rule:'精英敌人额外携带 1 条词缀（护盾 / 迅捷 / 吸血）', short:'精英词缀 +1' },
    { level:3, id:'toll', name:'代价加重', rule:'取舍房代价 ×1.5：献祭更多气血、赌注胜率 -8%、诅咒每层更痛', short:'事件代价 ×1.5' },
    { level:4, id:'third', name:'首领三阶段', rule:'首领在 30% 血量进入第三阶段：更快、更重', short:'首领 +1 阶段' }
  ]
};
```
`meta.ascensionUnlocked`：首次通关后 ≥1；以进阶 N（N≥1）通关后解锁 N+1（上限 4）。
`meta.ascension`：标题页选择的当前阶（0=关闭），必须 ≤ unlocked；normalize 夹紧。
`state.ascension`：本局阶数，进入游戏时从 meta 读取；`ascensionLevel()` 返回安全值。

### 2.2 每级规则落地（必须实战可验证）
- L1：`spawnEnemiesForFloor` 里，`room.type` 为 battle/elite 且 `ascensionLevel()>=1` → `count += 1`（上限 9）；记录 `room.ascensionExtra=1`。
- L2：`spawnEnemy` 里 `elite && ascension>=2` → 从 `['shield','swift','vampiric']` 用房间稳定哈希取第二条词缀，写入 `enemy.affix2`，并按既有字段生效（shield→shieldHp、swift→speed、vampiric→healRatio）。
- L3：新增 `ascensionCostMul() = ascension>=3 ? 1.5 : 1`；
  `eventSacrificeCost()` 用 `Math.round(hpCost*mul)` 且仍受 `EVENT_CONFIG.hpFloor` 下限保护；
  `eventWagerChance()` 返回 `chance - (ascension>=3 ? 0.08 : 0)`，门牌/赌桌文案实时显示；
  `eventCursePerFloor()` 返回 `Math.max(1, Math.round(hpPerFloor*mul))`，换层扣血仍走 30 下限。
- L4：`spawnBoss` 设 `boss.phaseMax = ascension>=4 ? 3 : 2`，并 `boss.phase3=false`；
  新增 `enterBossPhase3(boss)`（30% 阈值触发：速度 ×1.12、攻击间隔 ×0.82、接触/子弹伤害 ×1.15、换色 + 演出 + toast）；
  伤害结算后与二阶段同一处判断；`drawBossHud` 阶段刻度与文字显示 `阶段 x/3`。

### 2.3 UI
- 标题页：`#ascensionRow`（0–4 五个按钮，未解锁禁用并写“通关后解锁”），下方 `#ascensionNote` 实时显示所选阶的规则（来自配置，不手写第二份）。
- 结算页（死亡/通关）：新增一行「难度 <b>普通</b> · 进阶 <b>3</b> · 代价加重」。
- 开关关闭：`ASCENSION_CONFIG.enabled=false` → 标题页隐藏、`ascensionLevel()` 恒 0、结算页无进阶行（与旧版逐字符一致）。

## 3. 图鉴

### 3.1 配置与数据源（唯一真源）
```js
const CODEX_CONFIG = {
  enabled: true,
  pageSize: 8,
  tabs: [
    { id:'enemies',    label:'敌人',   source:'ENEMY_CONFIG' },
    { id:'recipes',    label:'配方',   source:'FUSION_CONFIG' },
    { id:'blueprints', label:'蓝图',   source:'BOSS_BLUEPRINT_CONFIG' },
    { id:'relics',     label:'遗物',   source:'RELIC_CONFIG' },
    { id:'cards',      label:'卡牌',   source:'MAGIC_CONFIG + TECH_CONFIG' }
  ]
};
```
`codexEntries(tab)` 运行时从配置生成：`{ id, name, glyph, color, desc, meta }`；
- 敌人：`name/glyph=shape/desc/基础属性 hp·speed·damage`（`ENEMY_CONFIG` 每条）。
- 配方：`FUSION_CONFIG` 的 `name/glyph/desc/magic+tech`。
- 蓝图：`BOSS_BLUEPRINT_CONFIG.blueprints` 的 `moveName/glyph/hint/result.desc`。
- 遗物：`RELIC_CONFIG` 的 `name/glyph/desc/maxStacks`。
- 卡牌：`MAGIC_CONFIG + TECH_CONFIG` 的 `name/glyph/tag/rarity/desc`。
**禁止**另写文案表；名称/说明全部读配置。

### 3.2 解锁记录
`meta.codex[tab] = [id...]`。`codexUnlock(tab, id)`：
- 只认配置里的合法 id；已存在直接返回；写入后 `saveMeta()`（首次解锁才 IO，频率极低）。
钩子：
- 敌人：`spawnEnemy` 成功创建后。
- 配方：`recordRecipeDiscovery`（现 `meta.recipes` 写入点）。
- 蓝图：`grantBossBlueprint`。
- 遗物：获得遗物入口（`relics[id]` 写入处）。
- 卡牌：`ownedMagic` / `ownedTech` 写入处（初始卡也在 `createInitialState` 后补录）。
旧档：`normalizeMeta` 若 `raw.codex` 缺失 → 用 `raw.recipes`/`raw.bossBlueprints` 回填配方与蓝图；已存在则原样保留。

### 3.3 UI
- 标题页按钮 `#btnCodex`「图鉴」；设置面板档案区块也加一个入口 `#btnCodexFromArchive`。
- 面板 `#codexPanel`（`rules-layer`）：页签、搜索框 `#codexSearch`、网格 `#codexGrid`、翻页 `#codexPrev/#codexNext`、计数 `#codexCount`。
- 未遇见：黑影卡片（暗底 + 斜纹 + 大「?」），名称 `???`，说明「尚未遇见」；
  已遇见：配置色描边 + glyph + 名称 + 基础属性 + 一句话说明。
- 搜索：匹配 name/desc/id，大小写不敏感；搜索时重置到第 1 页。
- 面板打开不推进游戏时间（复用暂停面板机制），关闭后状态不变。
- 计数显示「已见 8 / 33」等，分母来自配置长度。

## 4. 断言（新建 `tools\arcane_p2.js`）
1. `SEED_CONFIG.enabled=true`，同种子两次 `seed.probe` 的 rooms/enemies/doors 逐字段一致。
2. 不同种子 → 布局指纹不同（至少 1 处差异）。
3. `SEED_CONFIG.enabled=false` → `rng()` 走 `Math.random`、无种子字段写入、楼层生成与旧逻辑同路径（对比 `floorSignature` 均为空）。
4. 今日挑战：同一天两次 `dailySeed()` 相同，格式 `daily-YYYYMMDD`，重开 signature 一致。
5. 成绩：死亡/通关写入 `meta.seedRuns`，最高层与用时取最优，`saveMeta` 后可读回。
6. 进阶 L1：同层同房 baseline `enemyCount` vs L1 多 1；L2 精英 `affix2` 非空且效果字段生效；L3 献祭代价 ×1.5 且不低于 30 下限、赌率 -8%、诅咒扣血 ×1.5；L4 首领 `phaseMax=3` 且 30% 触发 `phase3`。
7. 进阶回退：`ascension.set(0)` 后所有数值回到 baseline；父开关 false 时标题/结算无进阶文本。
8. 图鉴条目数 = 配置真值：敌人 `ENEMY_CONFIG.length`、配方 `FUSION_CONFIG.length`、蓝图 `BOSS_BLUEPRINT_CONFIG.blueprints.length`、遗物 `RELIC_CONFIG.length`、卡牌 `MAGIC_CONFIG.length+TECH_CONFIG.length`。
9. 图鉴解锁持久化：解锁→`saveMeta`→重新 `loadMeta` 仍存在；旧档（无 `codex`）读入不重置已有 `recipes/bossBlueprints`。
10. 图鉴 UI：搜索、翻页、未遇见黑影与 `?`；已见显示配置名与说明；打开/关闭不改 `state.elapsed/floor`。
11. `SEED_CONFIG/ASCENSION_CONFIG/CODEX_CONFIG.enabled=false` 时，标题页对应入口隐藏，无新增 DOM 文本；旧断言全量回归 PASS。

## 5. 回滚
三个父开关任意一个置 false 即回到 1.0.3 行为；代码保留旧分支，不删除既有逻辑。

## 6. 追加需求（P2 之后、P3 之前）

### A. 说明入口可发现性
- 设置面板新增「说明 / 帮助」按钮 `#btnHelpFromSettings`；标题页新增 `#btnHelpTitle`；暂停层（若有独立暂停面板）同样加按钮。
  三个入口统一调用现有 `openRules()` / `togglePanel('rules')`，**不复制内容**。
- 自查帮助页手写数字：`grep` 帮助面板 HTML 与 `refreshConfigTexts`，能由 `GAME_CONFIG/ROOM_TYPE_CONFIG/DIFFICULTY_CONFIG` 生成的改成生成；
  不能生成的（剧情/固定文案）在 `PROGRESS.md` 列明原因。
- 断言：三入口打开同一 `#rulesPanel`（同一 DOM 节点、同样三页签）；关闭后 `state.elapsed/floor/mode` 不变。

### B. 局内存档（3 槽）
- 独立键 `arcane_run_slots_v1`，**不写 meta**、不与 `arcane_rogue_meta` 混用。
- `SAVE_SLOTS_CONFIG = { enabled:true, key:'arcane_run_slots_v1', slots:3, autosave:true, maxBytes: 5_000_000 }`。
- 快照白名单（`runSnapshotFields()`）：floor/difficulty/ascension/seedInfo/runSeed/floorSignature/
  player/rooms/walkRects/walkCircles/walkBlockers/corridorRects/doors/floorGraph/spawnRoomId/currentRoomId/fog/
  enemies/bullets/pickups/boss/bossChest/bossBlueprints/bossFusions/stairs/keys/openFloor/shop/survival/hiddenRoom/voidRift/eliteRoute/eventRoom/eventCurse/props/
  ownedMagic/ownedTech/fusions/relics/cardFloor/tagPatches/tagPatchSeq/cooldowns/mods/embers/crystalsEarned/kills/floorsCleared/elapsed/xp/xpLevel/xpNeed/xpTotal/
  runNoHit/floorNoHit/runRecipes/runSchools/p1Ledger/lastHit/endless/runCompleted/phaseSaveFloor/u11cLast/telemetry 计数。
- `captureRunSnapshot()`：返回 `{ v:2, savedAt, slot, metaVersion, payload, checksum }`；
  `checksum = fnv1a(JSON.stringify(payload))`。
- `saveRunSlot(slot, reason, silent)`：`localStorage.setItem` 失败 → catch → 提示「本次未能保存」；
  `QuotaExceededError` → 删除最旧的非当前槽后重试一次，仍失败保留最近一个槽。
- 触发：`generateFloor()` 末尾（每层进入）、`beforeunload`/`pagehide`、`winGame`/`loseGame`、开宝箱、事件结算、升层。
- 标题页 `#btnSaveSlots`「继续 / 存档槽」→ `#saveSlotsPanel`：三槽摘要（层数/难度/进阶/种子/时间），
  每槽「继续 / 复制 / 删除 / 导出 / 导入」。
- 游戏内 settings 面板新增存档区块（切换槽、存到槽、复制、删除、导出、导入）。
- 导出文本：`{ v:2, checksum, payload }` 的 JSON 字符串；导入校验版本、checksum、payload 必填字段，
  失败明确提示（版本不符 / 校验失败 / 数据不完整），不覆盖原槽。
- 继续：`applyRunSnapshot(snap)` → `createInitialState` 后 `Object.assign` 白名单 → 重建几何/烘焙/HUD/小地图 →
  `mode='playing'`，不调用 `generateFloor`（保留原布局与敌人）。
- 旧档无局内存档：标题页正常显示，`btnContinue` 走旧逻辑；不报错。

## 7. 版本与打包
- `GAME_CONFIG.version` 1.0.3 → 1.0.4。
- `buildChangelog` 按本轮三件 + A/B 重写。
- 全量回归 10 脚本 + `arcane_p2.js`、`arcane_help_save.js` 全 PASS。
- `node tools\arcane_package.js` → `dist\arcane_engineer_v1.0.4\`，发布包验收 8/8；清理。
