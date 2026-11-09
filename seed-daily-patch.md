# 《烬》种子与每日挑战 · 补差补丁

> **唯一基线（以主文件为准）**：字节 2,693,678 / 字符 2,251,734 / 行 63,022
> · MD5 `C762F5944F5D3A46C3A69CBD6E971E48` · SHA256 `92B649BC…E7477E6`
> 旧快照 `.seedwork/snapshot.html`（字节 2,691,500 / 字符 2,250,174 / 行 62,992）是
> 18:05:23 写入**之前**的状态，只作 diff 参照，不再作为基线。
> 验证副本（用当前主文件重建）：字节 2,730,754 / 字符 2,282,639 / 行 63,940
> · MD5 `DCE73AE1…` · SHA256 `27271A1D…AE816A`，26 项补丁全部命中。
> 主文件未改动（v1.6.0 发布验收冻结中，本补丁停在“补丁就绪”状态）。以下所有锚点均为**内容锚点**（不依赖行号，主线合并时按片段搜索即可）。
> 已有种子实现（每层独立流 `(seed,'floor:N')`、存档 `playRngState` 接回游标）保持原样，本补丁只补差。

---

## 0. 交付物

| 文件 | 用途 |
|---|---|
| `seed-daily.js` | 粘贴模块（8 位种子 / 每日首次锁定 / 选择流 / 生存房小流 / UI / 调试接口） |
| `seed-daily-patch.md` | 本文件：4 组内联改动清单 |
| `seed-daily-preview.html` | 独立预览（8 位校验、每日锁定、同种子对比、污染开关） |
| `tools/seed_repro_assert.js` | 可复现断言（headless Edge；默认 60 条，`--e1` 64 条） |
| `.seedwork/audit_indirect.js` | 表现层间接随机门禁（可重复执行，退出码即结论） |
| `.seedwork/verify_baseline.js` | 基线漂移核对（反向还原 + 锚点计数 + 函数交集） |
| `.seedwork/index_seed_patched.html` | 已应用补丁的验证副本（可直接跑断言） |
| `.seedwork/shots/*.png` | 结算页 / 标题页 / 预览页实测截图 |

---

## 0.5 基线核对：旧快照 → 当前主文件的 30 行差异

旧快照比当前主文件少 30 行（35 增 / 5 删，8 个差异块）。逐块如下：

| # | 快照行 | 位置 | 改什么 | 涉及 26 项锚点？ |
|---|---|---|---|---|
| 1 | 5746 | 关于面板 HTML | 版本号 `v1.5.9` → `v1.6.0` | 否 |
| 2 | 5965 | `GAME_CONFIG` | `version: '1.5.9'` → `'1.6.0'` | 否 |
| 3 | 13927 | `BOSS_CONFIG` | 新增 `hpCapF20Scale: 0.55`（C1-15 75 秒硬闸门） | 否 |
| 4 | 16157 | `defaultMeta()` | 新增 `achievementsAether: {}` | 否 |
| 5 | 16337 | `normalizeMeta()` | 归一化 `achievementsAether`（夹 0..上限） | 否 |
| 6 | 16606 | `checkMetaAchievements()` | 落盘“实际到账”奥能 | 否 |
| 7 | 21980 | `bossHpCapForFloor()` | `floorNumber >= 20` 时乘 `0.55` | 否 |
| 8 | 47553 | `renderArchivePanel()` | 读 `achievementsAether`（旧档回退重放）+ `window.achRewardText` 兜底 | 否 |

### 0.5.1 语义等价怎么证的（不是“形式命中”）

1. **反向还原**：把当前主文件按这 8 个 hunk 反向应用，
   结果与旧快照**逐字节相同**（脚本 `.seedwork/verify_baseline.js` 输出
   `原始字节完全相同 : true`）。→ 差异区域之外的每一行都字面相等，
   26 项锚点及其上下文不可能被“顺手改义”。
   可重复命令：

```powershell
git diff --no-index --unified=0 --output=.seedwork\main_vs_snapshot.diff .seedwork/snapshot.html index_arcane_v2.html
node .seedwork\verify_baseline.js
# 期望：原始字节完全相同 : true / anchor mismatches = 0 / 两者交集 : 空（无重叠）
```
2. **函数级交集**：被 diff 改动的函数 =
   `defaultMeta / normalizeMeta / checkMetaAchievements / bossHpCapForFloor / renderArchivePanel`；
   锚点所在函数 =
   `resolveChallenge / triggerMilestone / onboardSkipAll / onboardBeginRun / buildAtmosphere / snapshotRunState / restoreRunFromSlot`。
   两者**交集为空**。
3. **锚点计数**：26 项补丁 + 1 个模块插入点（`\ninit();`）共 27 项，
   在快照与主文件中的出现次数逐项一致（11 + 1 + 1 + 1 + 1 + 1 + 1 + 19）。

> **结论：26 项语义等价已逐项核对。**
> 唯一需要留意的是第 7 块：它把 `floorNumber >= 20` 的首领血量压到 0.55 倍
> （代码注释写明 F20 有效约 3407，低于 F1 的 3520，F18 区末 6182 成为最硬一战）。
> 本补丁的断言只覆盖 F1–F5，指纹不受影响；若以后把断言扩到 F20，
> 同种子仍然是确定性的，只是数值基于新基线而非旧快照。

---

## 1. 应用顺序（3 分钟）

1. 把 `seed-daily.js` 全文插入主文件 **`init();` 调用之前**（注意：必须在 `init()` 之前，
   因为 `init()` → `generateFloor()` → `buildAtmosphere()` 会调用 `fxRange`）。
2. 按第 3 节把 **12 处** `bestFloor` 写入替换成 `noteBestFloor(...)`。
3. 按第 4 节把 **2 处** 难度参照改成 `onboardProgressFloor()`，并修 **1 处**
   `buildAtmosphere` 里的 `randInt(0,2)`（它绕过遮蔽）。
4. 按第 5 节在 **19 个纯表现函数**开头插入一行 `const rand = fxRange;`。
5. 按第 6 节改 **2 处**快照 / 读档代码。
6. 跑 `node tools/seed_repro_assert.js <主文件>`，期望 `60/60 PASS`；
   再跑 `node tools/seed_repro_assert.js <主文件> .seedwork/shots --e1`，期望 `64/64 PASS`。
   **参数与路径坑（已修但必须知道）**：
   - 第一个参数是**被测文件**，第二个才是**输出目录**；把目录放到第一位会报
     `调试端口未就绪`（脚本把目录当文件，页面打不开）。
   - `--user-data-dir` **必须是绝对路径**，Edge 会拒绝相对路径且不报错。
     脚本内部已把 `FILE` / `OUT` 统一转成绝对路径（`path.resolve`），
     但在别的机器上复用时，如果你自己写裸命令拉起 headless Edge，务必传绝对路径。
7. 跑 `node .seedwork/audit_indirect.js <主文件>`，期望 `PASS` 且退出码 `0`
   （遮蔽函数 = 19、裸间接入口 = 0）。这条是**每次新增表现函数后必跑**的门禁，见 6.3。

回滚：删掉模块、把 `noteBestFloor(x)` 换回原写法、删掉 19 行遮蔽、删掉 2 处快照改动即可。
运行时快速关闭：把 `seed-daily.js` 里 `SEED8_CONFIG.enabled` 改成 `false`（回到旧自由文本种子与 Math.random）。

---

## 2. 模块插入点

```js
// ……主文件末尾原代码……
init();          ← 把 seed-daily.js 插在这一行之前
```

模块内部做了这些“函数级补差”（不改函数体以外的调用方）：

| 被覆盖函数 | 补什么 |
|---|---|
| `applySeedToState` | 额外建 `state.choiceRng = makeSeedRng(seed,'choice')`，每日局记 `dailyDateKey`，并写入沙盒难度（见 3.6） |
| `isUnlocked` / `unlock` / `refreshUnlocks` | 每日局读恒为“已解锁”、写一律短路（试玩不落盘，见 3.6） |
| `dailySeedValue` | `daily-YYYYMMDD` → `YYMMDD + 2 位校验`（8 位） |
| `normalizeSeedInput` | 只接受合法 8 位；`startCustomSeedRun` 校验失败时按 `format` / `checksum` 分别提示 |
| `seedTouchRun` / `seedRecordRun` | 同步累计每日尝试次数 / 写首次与最佳 |
| `pickWeightedOptions` | `Math.random()` → `choiceRandom()`（三选一 + 宝箱房奖励） |
| `spawnSurvivalWave` | `Math.random()` → `(seed, floor, wave)` 独立小流 |
| `renderLongrunTitle` | 今日挑战按钮追加「· 已完成」，记录区追加一行今日成绩，旧格式记录补「旧格式」角标 |
| `showResult` / `showVictory` | 结算页底部只追加一行「今日挑战」，不新建面板 |
| `init` | `init()` 之后注入「随机 8 位 / 复制本局种子」两个按钮（不改 HTML） |
| `onboardProgressFloor`（新增） | 每日局返回日期基准楼层，普通局返回 `meta.bestFloor`（供两处内联改动调用） |
| `e1ExtraChoice`（新增） | E1 预埋：额外一次选卡走 `(seed,'choice:e1:floor:N')` 独立流 |

---

## 3. 内联改动 A：12 处最佳楼层写入 → `noteBestFloor`

原代码（11 处完全相同）：

```js
state.meta.bestFloor = Math.max(state.meta.bestFloor, state.floor);
```

替换为：

```js
noteBestFloor(state.floor); // 每日局自动跳过，成绩隔离
```

出现位置（快照行号 / 所属函数）：

| 行 | 函数 |
|---|---|
| 12036 | `resolveChallenge` |
| 12211 | `grantDualAltarEffect` |
| 13702 | `grantPricedBonus` |
| 18168 / 18206 | `applyRoomReward`（两处） |
| 18300 | `onRoomCleared` |
| 20133 | `grantHiddenReward` |
| 44687 | `checkFloorClear` |
| 45588 | `descendFloor` |
| 47824 | `loseGame` |
| 48945 | `winGame` |

另有 1 处变体（13512，`triggerMilestone`）：

```js
state.meta.bestFloor = Math.max(Number(state.meta.bestFloor) || 0, floorNumber);
```
→
```js
noteBestFloor(floorNumber);
```

> `noteBestFloor` 只在 `state.seedInfo.daily === true` 时跳过；普通局行为不变。
> 每日局的死亡数、成就进度、结晶仍照常累计（只隔离层数/用时/击杀成绩）。

---

## 3.5 内联改动 A2：每日难度基准（2 处）

**问题**：主文件的「老档跳过教学难度」判断读的是玩家自己的 `meta.bestFloor`
（`>= 5` 视为老玩家）。这会让高手和新人同一天、同一个种子打到两个难度，
每日排行榜在数学上不成立。

**方案**：不临时改写 `meta.bestFloor`，也不落盘任何基准值；只把**两处读取点**
换成 `onboardProgressFloor()`：每日局返回按日期派生的固定基准，普通局返回原值。
这样「中途退出 / 崩溃 / 读档」都不需要“还原”，因为从来没改过账号数据。

### 3.5.1 懒快照（`onboardSkipAll()` 内）

```js
// 原
state.onboardSkipAll = Number(state.meta && state.meta.bestFloor) >= ONBOARD_CONFIG.skipBestFloor;
// 改
state.onboardSkipAll = Number(onboardProgressFloor()) >= ONBOARD_CONFIG.skipBestFloor;
```

### 3.5.2 开局快照（`resetOnboardState()` 内）

```js
// 原
state.onboardSkipAll = !!(state.meta && Number(state.meta.bestFloor) >= ONBOARD_CONFIG.skipBestFloor);
// 改
state.onboardSkipAll = !!(Number(onboardProgressFloor()) >= ONBOARD_CONFIG.skipBestFloor);
```

`onboardProgressFloor()`（模块内）：

```js
function onboardProgressFloor() {
  if (!state) return 1;
  if (DAILY_DIFF_CONFIG.enabled && state.seedInfo && state.seedInfo.daily) {
    return dailyBaselineFloor(state.seedInfo.dailyDateKey); // 按日期派生，同一天全服一致
  }
  return Math.max(1, Number(state.meta && state.meta.bestFloor) || 1);       // 普通局保持成长
}
```

基准派生规则：`1 + (YYYYMMDD 数字 % 4)` → 1–4，恒低于 `skipBestFloor`（5），
即所有玩家每日局统一走同一条难度曲线。想固定成某个值，把
`DAILY_DIFF_CONFIG.baselineFloor` 写成数字即可（`null` = 按日期派生）。

> **不再需要“退出时还原”**：`meta.bestFloor` 全程没有被写入，
> 断言用「中途退出 / 整页刷新（模拟崩溃）/ 读档」三种路径验证过（见第 8 节）。

---

## 3.6 每日局封存：`ascension` / 难度档 / 解锁池

**裁决口径**：每日局 = 固定普通档 + `ascension = 0` + **满解锁池** + 日期派生基准楼层。
四项全锁死，排行榜才成立。

**为什么是“给满”而不是“清零”**：清零会让新玩家只能玩最基础的两张卡，
而排行榜不该靠“你账号里有什么”分高下；给满之后所有人卡池一致，只看操作。
额外收益是新玩家能在每日里试玩未解锁的卡 —— 但**试玩解锁不能永久落盘**，
否则等于送解锁，所以写入侧也必须封。

全部只改**本局 `state`**，不碰账号 `meta`：

```js
const DAILY_SANDBOX_CONFIG = { enabled: true, ascension: 0, difficulty: 'normal', fullUnlocks: true };

// 开局：只写 state
if (opts && opts.daily && DAILY_SANDBOX_CONFIG.enabled) {
  state.ascension = DAILY_SANDBOX_CONFIG.ascension;      // 0
  state.difficulty = DAILY_SANDBOX_CONFIG.difficulty;    // 'normal'
}

// 读取侧：每日局恒为已解锁
isUnlocked = function (id) {
  if (dailySandboxActive() && DAILY_SANDBOX_CONFIG.fullUnlocks) return true;
  ...
};

// 写入侧：每日局一律短路（含 refreshUnlocks(true) 这条绕过 unlock() 的路径）
unlock = function (id, reason) { if (dailySandboxActive()) return false; ... };
refreshUnlocks = function (silent) { if (dailySandboxActive()) return 0; ... };
```

> 关键点：`refreshUnlocks(true)` 会**绕过 `unlock()` 直接写 `meta.unlocks`**，
> 只包 `unlock` 是不够的 —— 这是本轮自查发现的第二处绕道，已一并封住。

因为账号数据全程没被写，**“中途退出 / 崩溃 / 读档”不需要任何还原逻辑**：
需要清理的问题变成了不存在的问题。断言用 POOR（`ascension=5 / nightmare / 全锁`）
与 RICH（`ascension=0 / easy / 全开`）两个账号跑同一天，逐项比对第 1 层指纹与三选一。

---

## 4. 内联改动 B：19 个纯表现函数开头插入遮蔽

在每个函数的 `{` 后插入同一行：

```js
  const rand = fxRange; // 表现层：遮蔽全局 rand，禁止推进玩法流
```

> 原理：`rand()` 是全局函数，函数内 `const rand` 会遮蔽它；函数体里原有的
> 130 处 `rand(...)` 一行不改就自动走 `Math.random`。另外 1 处 `randInt` 绕过了
> 遮蔽，已单独改写（见 4.1）。19 行遮蔽 + 1 行改写，共 131 个调用点。

| # | 函数 | rand 调用 | 表现内容 | 是否有 rand 结果流入玩法 |
|---|---|---|---|---|
| 1 | `paintWorldBase` | 6 | 世界底色纹理 / 星点半径 | 无 |
| 2 | `paintCorridor` | 4 | 走廊裂纹碎线 | 无 |
| 3 | `paintRoomFloor` | 17 | 地面噪声 / 裂纹 / 苔痕 | 无 |
| 4 | `paintThemeProps` | 23 | 管道 / 符文 / 晶簇的坐标与相位 | 无 |
| 5 | `paintMechRoomLayer` | 7 | 机械灯 / 蒸汽相位 | 无（`mechVariant/mechSeed` 走 `hash01(room)`，不是 rand） |
| 6 | `buildAtmosphere` | 17（16 rand + 1 改写自 randInt） | 浮尘 / 雾 / 蒸汽 | 无（`randInt` 曾绕过遮蔽，已修，见 4.1） |
| 7 | `startGlitchBurst` | 3 | 故障横带位置与相位 | 无 |
| 8 | `spawnImpactLines` | 1 | 冲击线角度抖动 | 无 |
| 9 | `spawnPixelShatter` | 6 | 碎块速度 / 角度 / 寿命 | 无 |
| 10 | `spawnMagnetFx` | 2 | 磁吸粒子半径 / 缩放 | 无 |
| 11 | `drawProjectiles` | 2 | 电弧绘制分支 | 无（只读 projectile 字段画图） |
| 12 | `nextSfxVariation` | 2 | 音高 / 节奏抖动 | 无（只被 `playSfx` 消费） |
| 13 | `addBurst` | 5 | 爆发粒子方向 / 速度 / 寿命 | 无（`state.lastBurst` 仅验收遥测） |
| 14 | `addSparks` | 4 | 火花方向 / 速度 / 寿命 | 无 |
| 15 | `castBolt` | 4 | 闪电折线抖动 / 分支端点 | 无（伤害走 `getMagicDamage`，落地伤害/范围无随机） |
| 16 | `castHeal` | 6 | 治疗粒子 | 无（回复量 / 护盾读配置常量） |
| 17 | `updateProjectiles` | 4 | 弹道拖尾粒子 | 无（伤害 / 穿透读 projectile 字段） |
| 18 | `updateElementClouds` | 2 | 元素云火花 | 无（区域伤害用 `cloud.damage`） |
| 19 | `spawnThemeDeathForm` | 16 | 敌人死亡形态粒子 | 无（返回值只写 `state.feel` 遥测） |

合计 **131 个随机调用点**（130 处 `rand` + 1 处 `randInt` 改写，此前文档写的 123 是漏数）。
逐函数审计方法与结果：
`.seedwork/audit_rand.js`（列出每处源码行）、`.seedwork/audit_state.js`
（扫描函数体内是否调用 `damageEnemy/spawnEnemy/generateFloor/pickWeightedOptions`
等玩法函数或写入 `state.* / room.* / enemy.*`）。结论：19 个函数内**没有一处**
`rand()` 结果进入房间生成、掉落判定、敌人属性、三选一或存档。

### 4.1 审计发现的 1 处绕过（已修）

`buildAtmosphere` 里有一行 `tier: randInt(0, 2)`。`randInt` 内部调用的是**全局**
`rand`（→ `rng()`），不会被 `const rand = fxRange` 遮蔽，因此仍会推进玩法流。
已改为：

```js
tier: Math.floor(rand(0, 3)) // 遮蔽后的 rand = Math.random，不推进玩法流
```

同一审计还确认：这些函数内部调用的 `addRing / addBeam / addFloat / flashScreen /
acquireParticle` 均不含随机入口；`playSfx` 只通过 `nextSfxVariation` 取随机，
而它已被遮蔽。`paintMechRoomLayer` 内嵌套的 `cabinet/fanUnit/steamVent`
共享外层闭包，自动继承遮蔽，无需单独处理。

> 备注：**130 → “全部表现层”** 这个结论只对上述 19 个函数成立。文件里其他
> 调用 `rng()` 的函数是玩法侧（`generateFloor` / `spawnEnemy` / 敌人 AI / 弹道角度 /
> `rollLoot` / 暴击），保持走种子流。

实测证明：连续调用 `addBurst` / `spawnPixelShatter` / `spawnMagnetFx` 后，
`state.playRng.state` 前后完全相等（522350623 → 522350623）。

---

## 5. 内联改动 C：快照 / 读档接回选择流

### 5.1 保存（`snapshotRunState` 内，紧跟 `copy.playRngState` 之后）

```js
  copy.playRngState = rngState;
  copy.choiceRngState = state.choiceRng ? state.choiceRng.state : null; // 新增
```

### 5.2 读取（`restoreRunFromSlot` 内，`playRng` 的 if/else 之后）

```js
    } else {
      fresh.playRng = null;
    }
    /* P2-3：选择流（三选一 / 宝箱奖励）按原种子接回，续局后选项仍然一致 */
    if (fresh.seedInfo && fresh.seedInfo.active && fresh.seedInfo.value) {
      fresh.choiceRng = makeSeedRng(fresh.seedInfo.value, 'choice');
      fresh.choiceRng.state = Number(data.choiceRngState) || 0;
    } else {
      fresh.choiceRng = null;
    }
```

---

## 6. 随机源边界（最终口径）

### 6.1 必须走种子流（玩法）

| 类别 | 入口 |
|---|---|
| 楼层布局 / 房型 / 敌人生成 | `generateFloor` 的 `__rngOverride` → `(seed,'floor:N')` |
| 精英词缀 | `pickEliteAffixForKey` → `(seed,'elite-affix|…')` |
| 开局六项 | `openRandomRolls` 六条命名流 |
| 三选一 / 宝箱房奖励 | `pickWeightedOptions` → `choiceRandom()` → `(seed,'choice')` |
| E1 额外选卡（预埋） | `(seed,'choice:e1:floor:N')` 独立流，不动共享游标 |
| 每日难度参照 | `onboardProgressFloor()`（每日=日期基准，普通=`meta.bestFloor`） |
| 生存房刷怪 | `spawnSurvivalWave` → `(seed,'survival:floor:wave')` |
| 暴击 / 掉落 / 事件判定 | `rng()`（本局 `playRng`） |

### 6.2 允许 `Math.random`（纯表现层）

粒子方向、屏震幅度、待机呼吸、音频噪声、背景横带相位、拾取物散落、`runId` 标识、
以及注入层 4 处兜底（无种子 / 关闭开关时）。

### 6.3 检查命令（验收门禁，每次都要重跑）

```powershell
# 门禁 1：间接随机入口（遮蔽管不到 randInt / pickRandom / shuffleArray / rng）
node ".seedwork\audit_indirect.js" ".seedwork\index_seed_patched.html"
# 期望：PASS 且退出码 0
#   [表现层随机体检] 目标=index_seed_patched.html
#   遮蔽函数=19 个（基线 19） | 遮蔽函数内裸间接入口=0 处 | 调用路径命中=4 条
#   EXITCODE=0

# 门禁 2：真实调用（排除注释）
Select-String -Path "D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html" -Pattern "Math\.random" |
  Where-Object { $_.Line -notmatch '^\s*(//|\*|/\*)' } |
  Select-Object LineNumber, Line | Format-Table -AutoSize
```

`audit_indirect.js` 每次运行做四件事（不写死 19）：

1. 自动发现“带 `const rand = fxRange`”的函数；
2. 扫这些函数体内的裸间接入口 —— **有就 FAIL（退出码 1）**；
3. 按调用路径追溯“遮蔽函数 → … → 间接入口”，打印出来供人工判定
   （战斗类如 `castBolt → damageEnemy` 属预期，不参与硬失败）；
4. **基线漂移**：遮蔽函数名单必须等于脚本里的 19 个基线。
   少一条（遮蔽行被删）或多一个（新增表现函数未复核）都会 FAIL ——
   这正是“第 20 个函数带进一个 `randInt`”的入口。

> **为什么必须写成命令而不是结论**：遮蔽是“每加一个新函数就可能破一次”的东西。
> 今天 19 个函数干净，明天第 20 个就可能带进一个 `randInt`（`buildAtmosphere`
> 那行就是活例）。所以新增/修改任何表现函数后**都要重跑门禁 1**；
> 若因“新增了一个合法表现函数”而 FAIL，先人工复核它体内无裸入口，
> 再把它加进脚本 `BASELINE` 名单 —— 这一步就是复核留下的痕迹。

**反向验证（证明门禁不是橡皮章）**：往副本里注入三种坏改动，三种都应 FAIL、退出码 1：

| 注入 | 期望输出 |
|---|---|
| 在遮蔽函数体内加 `randInt(0, 2)` | `paintWorldBase@L… → randInt(...)` |
| 删掉一条 `const rand = fxRange;` | `少了（遮蔽行可能被删）: paintWorldBase` |
| 新增一个带遮蔽的 `extraFx()` | `多了（新增表现函数未经复核）: extraFx` |

> 脚本路径约定：本仓库所有 headless Edge 脚本都要求 `--user-data-dir` 为**绝对路径**
> （Edge 对相对路径静默失败，表现成 `调试端口未就绪`）。
> `seed_repro_assert.js` 已在脚本内用 `path.resolve` 兜住 `FILE/OUT`；
> 你新写脚本时也要自己兜，别在文档里留裸相对路径。

---

## 7. 验证结果（实测数字）

```powershell
node tools/seed_repro_assert.js   # 60/60 PASS，VERDICT: PASS
node tools/seed_repro_assert.js .seedwork/index_seed_patched.html .seedwork/shots --e1   # 64/64 PASS，VERDICT: PASS
node .seedwork/audit_indirect.js .seedwork/index_seed_patched.html   # PASS，退出码 0
```

> 以上三行均已在**当前主文件**（字节 2,693,678 / 字符 2,251,734 / 行 63,022）
> 重建的副本上重跑通过；
> 重建命令：`node .seedwork/apply.js index_arcane_v2.html`（26 项补丁全部 `OK`）。

| 断言组 | 结果 |
|---|---|
| 8 位格式 / 校验位错误拒绝 / 位数错误拒绝 | 4/4 |
| 同种子 1–5 层房型序列逐项一致 | 5/5 |
| 同种子 1–5 层敌人数量+种类+词缀逐项一致 | 5/5（11 / 13 / 12 / 16 / 18 只） |
| 同种子 1–5 层每层 3 次三选一逐项一致 | 5/5 |
| 同种子 1–5 层被动/宝箱奖励一致 | 5/5 |
| 同种子 1–5 层完整指纹一致 | 5/5 |
| 存档续局：种子不变 / 选择游标接回 / 第 4–5 层一致 | 4/4 |
| 表现层随机不推进 playRng | 1/1 |
| 每日首次锁定（首次 3 层不被 5 层覆盖） | 1/1 |
| 每日局不写 `meta.bestFloor` | 1/1 |
| 结算页仅一行「今日挑战」 | 1/1 |
| **每日难度与账号进度无关**（bestFloor 1 vs 20 第 1 层敌人属性一致） | 1/1 |
| **每日难度参照 = 日期基准**（不是玩家 bestFloor） | 1/1 |
| **普通局保留进度成长**（bestFloor 1 vs 20 敌人属性不同） | 1/1 |
| **每日封存：`ascension` 强制 0（账号 5 → 局内 0，meta 仍 5）** | 1/1 |
| **每日封存：难度档固定 `normal`（账号 nightmare/easy 均无效）** | 1/1 |
| **每日封存：四系统全开（融合/装置/过载/并行）** | 1/1 |
| **每日封存：`meta.unlocks` 未被写回（试玩不落盘）** | 1/1 |
| **每日封存：普通局仍继承账号解锁** | 1/1 |
| **每日封存：两个极端账号（POOR vs RICH）第 1 层指纹 + 三选一逐项一致** | 1/1 |
| **中途退出不污染 `meta.bestFloor`** | 1/1 |
| 主菜单 8 位种子 + 输入框 8 位 + 两个按钮 | 3/3 |
| **旧格式记录角标**（日期种子 + 文本种子各 1 条） | 1/1 |
| **8 位新记录不带角标** | 1/1 |
| **模拟崩溃：整页刷新后就绪 + meta 未被污染 + 读档保留种子/每日标记/基准难度** | 4/4 |
| `--e1`：每层多一次三选一（≥3 个不重复选项） | 1/1 |
| `--e1`：额外选卡不改变 1–5 层内容与正常三选一 | 1/1 |
| `--e1`：与“不启用 E1 但手动跳过该次选卡”逐项一致 | 1/1 |
| `--e1`：额外选卡同种子两次逐项一致 | 1/1 |

实测关键值：

- 每日局 `bestFloor=1` 与 `bestFloor=20` 的第 1 层敌人属性完全相同
  （`assembler:248,boss_mech:3200,crawler:116,patrol:116,riveter:111…`），
  `progressFloor=1 / baseline=1`，账号 bestFloor 仍显示 20。
- 普通局同一对比则明显不同（`crawler:116` vs `crawler:192`），说明进度成长没有被误伤。
- 崩溃测试：`bestFloor` 9 → 整页刷新后仍为 9；读档后种子 `26110893`、`daily=true`、
  第 1 层敌人属性与刷新前完全一致。
- 旧格式角标：注入 `daily-20260101` 与 `legacyTextSeed` 后角标数 = 2，
  8 位记录 0 个角标。
- 每日封存：POOR 账号 `{ascension:5, difficulty:'nightmare', unlocks 全 false}` 与
  RICH 账号 `{ascension:0, difficulty:'easy', unlocks 全 true}`，同一天进每日局后
  两边 `ascension=0`、`difficulty='normal'`、融合/装置/过载/并行四项全 `true`，
  第 1 层敌人指纹与三选一选项**逐项字符串一致**；`meta.unlocks` 保持原样未被写回；
  同一账号的普通种子局仍按自己的解锁列表走（未被沙盒污染）。
- 表现层门禁：`audit_indirect.js` → 19 个遮蔽函数 / 0 处裸入口 / 退出码 0；
  注入 `randInt`、删遮蔽行、新增第 20 个函数三种坏改动，均 FAIL 且退出码 1。

预览页实测：

| 操作 | 结果 |
|---|---|
| 首次通关 4 层 / 5:21 / 17 杀 | 首次锁定 4 层 |
| 重玩 6 层 / 6:10 / 30 杀 | 首次仍 4 层，最佳 6 层 |
| 同种子跑两次（关闭污染） | 5/5 层一致 · PASS |
| 开启“表现层污染”开关 | 5/5 层掉落漂移 · FAIL |

截图：`.seedwork/shots/08_daily_result.png`、`09_title_seed_ui.png`、
`14_title_legacy_badge.png`（旧格式角标）、`10_preview_boot.png`、`11_preview_daily_locked.png`、
`12_preview_repro_clean.png`、`13_preview_repro_polluted.png`。

---

## 8. 已知限制（合并前请知悉）

1. **每日局难度已与账号进度解耦；普通局保留成长**。
   每日局的两处难度参照已改走 `onboardProgressFloor()`（日期基准 1–4），
   断言证明 `bestFloor=1` 与 `=20` 的第 1 层敌人属性完全一致。
   普通种子局仍然读 `meta.bestFloor`，这是设计意图（“难度随进度成长”）。
   > 顺带说明：此前文档把这条写成“遗留限制”，结论是错的——每日局必须消除，
   > 本次已按“只改读取点、不改账号数据”的方案落地，因此不需要退出还原，
   > 崩溃/读档也不存在“基准值残留”的风险。
2. **每日局的账号差异三源已按裁决封存**（见 3.6）：
   - `state.difficulty` → 固定 `normal`；
   - `meta.ascension` → 局内置 0；
   - 已解锁武器/技能 → 读取恒为 true（**给满，不是清零**），写入短路（试玩不落盘）。
   保留的“照常累计”只有死亡数、成就进度、结晶 —— 这是裁决明确要求的，
   它们不进排行榜的层数/用时/击杀三项。
   沙盒全部只写本局 `state`，因此退出/崩溃/读档**不需要还原逻辑**。
3. **每日种子换了格式**：今天起每日种子从 `daily-YYYYMMDD` 变为 `YYMMDD+校验`（8 位）。
   历史 `meta.seedRuns` 记录按“只读保留”处理，列表里加「旧格式」角标；
   新开局只发 8 位。
4. **`seedRuns` 仍写每日种子**：只为让既有成就 `dailyCleared` 继续生效；
   成绩隔离靠 `noteBestFloor` + `meta.dailyRuns`，不会混算普通最佳层。
5. **E1 停在“就绪待落”，本轮不落主文件**：主文件冻结中（v1.6.0 发布验收，
   一个字节都不许改）；落盘顺序固定 **`mech2 → E1 → W12(F2)`，一项一验**。
   红线不变：**10 层 > 40% 即停、F20 到达 > 36% 即停**；
   上一轮实测 42.2% / 36.7% 两个口径都越线，所以它现在是“就绪待落”，
   不是“待验证”——放进去会同时作废 44.9% 的验收基线与这两条红线判定。
   代码侧只留预埋：主线还没有 `E1_CONFIG` 时，`--e1` 用
   `(seed,'choice:e1:floor:N')` 独立流模拟“清层额外一次选卡”，
   断言只验证不变量（存在 / 不影响其它内容 / 两次一致）。
   E1 落地后只要 `window.E1_CONFIG.enabled = true`，断言自动切到真实模式；
   若真实 E1 复用共享 `choiceRng`，第 2 条断言（后续内容一致）会立刻变红——
   这正是它该抓的问题。
6. **调试接口 `window.__seedDebug`** 仅断言脚本使用，不接入任何按钮；不需要可整段删除。
