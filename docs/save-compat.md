# 《烬》v1.6.1 · 老存档兼容审计

| 项目 | 值 |
|---|---|
| 审计对象 | `D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html` |
| 起点校验 | 2,711,040 B / `23194ECC5F7733054C4E511476B885C7`（与任务给定值一致） |
| **结束校验（异常）** | **2,711,566 B / `12E7D7C03232EC484AB0196DE064DB67`** |
| 版本 | GAME_CONFIG.version = 1.6.1，META_SCHEMA_VERSION = 9 |
| 方法 | 只读静态分析 + 从主文件抽取真实函数在 node 里跑纯函数场景；未开浏览器、未跑无头 |
| 对主文件的操作 | 无（全程只读；文件在审计期间被**另一会话**改动，见下） |

> **MD5 漂移说明（必须读）**：审计开始时文件与任务给定指纹完全一致；审计结束复读时变成 2,711,566 B / `12E7D7…`（+526 B，mtime 21:13:05）。
> 存档子系统的 5 个锚点行号全程未变（`defaultMeta` 16154 / `normalizeMeta` 16249 / `migrateMeta` 16488 / `loadMeta` 16759 / `saveMeta` 16791），且 `loadMeta` / `saveMeta` 函数体逐行复核一致；
> 新增的 526 B 落在 `54,098～63,391` 之间（启动写档由 63385 移到 63391），**不涉及存档读写代码**。
> 因此本文结论对两个快照都成立；但补丁落盘前应以当时主文件的函数名为锚点重新定位，不要用本文行号直接贴。

---

## 0. 结论摘要（五个风险项）

| # | 风险 | 严重度 | 性质 |
|---|---|---|---|
| R1 | 存档 JSON 损坏/顶层类型非法时，启动同帧用默认档覆盖原存档，永久天赋/结晶/成就全部不可恢复，且不留原始文本备份 | **高** | 已存在 |
| R2 | 多标签页/多窗口无 `storage` 监听，整对象写盘，后行动者覆盖先行动者的永久进度 | **高** | 已存在 |
| R3 | `motionTrail` / `regionFx` 两个玩家设置不在存档白名单，每次刷新被静默重置 | 中 | 已存在 |
| R4 | 局内存档单槽上限 4,000,000 字符 × 3 槽 > 常见 5MB 配额；配额满时 `saveMeta` 静默失败，刚买的永久天赋不落盘 | 中 | 已存在（容量触发为理论） |
| R5 | `saveMeta(meta)` 传参无效，写入的是 `state.meta`；当前因后续调用补写而未造成丢失 | 低 | 已存在（无实际后果） |

另外三个"看着像风险、实测不成立"的点放在 §5，避免按错误结论改代码。

---

## 1. 存档结构

### 1.1 键与版本

| localStorage 键 | 内容 | 版本字段 | 读坏时的行为 |
|---|---|---|---|
| `arcane_rogue_meta` | 永久档案（结晶、天赋、成就、图鉴、种子成绩…） | `version: 9` | catch → 返回默认档（见 R1） |
| `arcane_run_slots_v1` | 局内存档 3 槽，含 checksum | `version: 2` | 解析失败/版本不符 → 当空库（3 槽一起丢） |
| `arcane.crash.v1` | 崩溃标记（楼层 + 槽位 + 摘要） | `version: 1` | catch → null |
| `arcane_rogue_audio` | 音频设置 | 无 | 解析失败 → 默认值 |
| `arcane.titleMotion` | 标题背景动效 | 无 | 非 `'0'` 一律按"开" |
| `arcane_intro_hint_v1` / `arcane_onboard_v1` | 新手提示已读 | 无 | 静默降级 |

主键定义在 [GAME_CONFIG.metaKey](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L6066)，槽位定义在 [SAVE_SLOTS_CONFIG](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L7690-L7697)。

### 1.2 读 / 写链路

```
启动 createInitialState()                      L16803
  └─ loadMeta()                                L16759
       ├─ localStorage.getItem(metaKey)
       ├─ JSON.parse  ← try/catch
       ├─ normalizeMeta(parsed)                L16249
       │    ├─ base = defaultMeta()            L16154（白名单，44 字段）
       │    ├─ migrateMeta(raw, version)       L16488（v0→v9 逐级）
       │    └─ 逐字段取值 + 夹紧 + 非法值回默认
       └─ catch → defaultMeta() + metaLoadNotice
state.meta = 结果
saveMeta()                                     L63385（启动时无条件写一次）
```

写档只有一个出口：[saveMeta()](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L16791-L16797)，`setItem(metaKey, JSON.stringify(state.meta))`，异常静默吞掉。

### 1.3 meta v9 的 44 个字段（defaultMeta 全集）

`runs, bestFloor, crystals, talents, talentsMigrated, talentsMigration, talentsRespecLog, startCard, aimMode, difficulty, storySeen, hintsSeen, postFx, postfx, alwaysAim, reduceShake, reduceFlash, colorblind, infoMode, unlocks, milestones, bossBlueprints, version, performance, comboFx, stats, eventStats, bestCombo, bestRunRecipes, clears, achievements, achievementsAether, recipes, rewards, seedRuns, ascensionUnlocked, ascension, challengeCleared, codex, weaponId, weaponsEnabled, gameTitle, gameSlug, legacyTitle`

`normalizeMeta` 是**白名单重建**：先 `defaultMeta()`，再从 raw 逐字段赋值。因此 raw 里任何不在上面的键都不会进入结果，也就不会被 `saveMeta` 原样写回。

局内存档另存一份 `state` 快照（[snapshotRunState](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L50043-L50056)），剔除 `meta / playRng / particles / rings / floats / beams / decor / atmosphere / parallax / sceneProps`，其余（rooms、enemies、projectiles、bullets、pickups、fog…）全部写入。

---

## 2. 字段演进（三个可取证的历史阶段）

| 阶段 | 取证方式 | 版本 | defaultMeta 字段数 |
|---|---|---|---|
| A：无版本号早期档 | `migrateMeta` 的 `fromVersion < 1..9` 分支注释 | 0 | 无 `version` 字段 |
| B：真实快照 `index_arcane_v2.bak_pre8_title.html`（2026-11-06） | 直接读备份文件 | **4** | **26** |
| C：当前主文件 | 直接读主文件 | **9** | **44** |

v4（26 字段）→ v9（44 字段）：**新增 18 个，删除 0 个**。

新增：`talentsMigrated, talentsMigration, talentsRespecLog, startCard, colorblind, infoMode, eventStats, achievementsAether, seedRuns, ascensionUnlocked, ascension, challengeCleared, codex, weaponId, weaponsEnabled, gameTitle, gameSlug, legacyTitle`。
迁移节点：v5 加 `eventStats`、v6 加 `seedRuns/ascension/codex`、v7 加天赋 v2 容器、v9 加 `challengeCleared`（`migrateMeta` L16488-16543）。

### 2.1 新增字段：老档缺字段会不会出问题

逐个核对 `normalizeMeta` 的取值方式，18 个新增字段**全部有默认值兜底**，没有"读出 undefined 直接进渲染"的字段：

| 字段 | 兜底 | 证据 |
|---|---|---|
| `talentsMigrated` / `talentsMigration` | `=== true` / 非对象置 null | L16268-L16270 |
| `talentsRespecLog` | 非数组→`[]`，条目逐字段校验，只留 20 条 | L16294-L16305 |
| `startCard` | 不在当前卡池 → `fireball` | L16307-L16309 |
| `colorblind` / `infoMode` | `=== true` / 非法档位 → `standard` | L16328-L16329 |
| `eventStats` | 非对象→全 0 | L16378-L16385 |
| `achievementsAether` | 非对象→`{}`，值夹 0..26 | L16399-L16407 |
| `seedRuns` | 非对象→`{}`，逐条校验 + 上限 60 条 | L16419-L16441 |
| `ascension*` | 夹 0..maxLevel，且 `ascension ≤ unlocked` | L16443-L16446 |
| `challengeCleared` | 非对象→`{}`，键 0..10、值 0..999 | L16448-L16456 |
| `codex` | 非对象→`null` 信号 → 用 `recipes`/`bossBlueprints` 回填 | L16459-L16470 |
| `weaponId` / `weaponsEnabled` | 非法 id → 首把武器；`!== false` | L16472-L16474 |
| `gameTitle` / `gameSlug` / `legacyTitle` | `loadMeta` 单独处理旧名标记 | L16765-L16775 |

实测（node，抽取主文件真实函数）：极端满配 meta（60 条种子成绩 + 47 条成就 + 60 条配方 + 6 类图鉴各 200 条）= **20,287 B / 19.8 KB**；简单档（少量成就 + 200 条敌人图鉴）= **2,899 B**。可见字段新增本身不会把存档撑爆。

### 2.2 删除字段：会不会越滚越大

**不会。** 白名单重建把历史多余字段在**读档时**丢掉（node T5c 已验证：`someRemovedField` 读档后不存在）。所以"存档随版本越滚越大"这条不成立。

### 2.3 改类型字段

- **`talents`：旧三键 `vitality / aether / fusionMastery` → 新 30 项 id**（L16271-L16292）。
  - 换算：`vitality→hp`、`aether→aether`、`fusionMastery→fusion`，取 `max(新档现值, 映射值)`；
  - 超出新上限的部分按 `GAME_CONFIG.talentCost`（1 结晶/级）返还一次，写 `talentsMigrated=true` 防重复。
  - node 实测 T3：`{vitality:4, aether:6, fusionMastery:4}` → `hp=2, aether=2, fusion=2, crystals=+8`；二次读档结晶仍为 8（不重复返还）。
- **`unlocks`**：v2 起是 4 键布尔容器；缺字段时按 `bestFloor>=3` 重推 `overdrive/parallel`（L16331-L16337）。老档 `fusion/device` 不会因此丢失（node T4b/T4d）。
- **`postFx`（布尔）与 `postfx`（四分项对象）并存**，两条都读、互不覆盖（L16314-L16322）。改类型没有引发类型判断缺失。

结论：老档的**永久天赋**在"字段缺失/删字段/改类型/version 过旧"这四种情况下都能保住；唯一保不住的是 §3 R1 的解析级损坏。

---

## 3. 风险表

| 场景 | 触发条件 | 后果 | 严重度 | 修法 |
|---|---|---|---|---|
| R1 坏档覆盖 | `arcane_rogue_meta` 不是合法 JSON，或顶层是数组/字符串/数字/`null` | `loadMeta` 回默认档；启动流程紧接着 `saveMeta()` 把默认档写回，**原文本无备份** → 永久天赋、结晶、成就、图鉴全部归零且不可恢复。之后才弹"存档已损坏"提示 | **高** | ① catch 里先把原始文本备份到 `arcane_rogue_meta.broken.<时间戳>`；② 设 `metaFallbackClean=true`，启动那次 `saveMeta()` 跳过；③ 设置页加"导出损坏原文" |
| R1b 天赋字段类型损坏 | 存档是合法 JSON，但 `talents` 是字符串/数组 | 天赋全 0，且因为 `talentsMigrated=true` 不会重新换算返还 | 中 | 与 R1 同一处理：坏字段时先备份原档再降级 |
| R2 多标签页覆盖 | 同一浏览器开两个标签页/窗口，各自玩一段 | 每次 `saveMeta` 都是整对象覆盖，**后写者赢**：A 买的永久天赋被 B 的旧快照抹掉；两页都"继续"同一个槽时会覆盖局内进度 | **高** | 加 `storage` 监听 + 冲突后停止写档（片段见 §4.2） |
| R3 设置不落盘 | 玩家在设置页开关"冲刺残影"/"大区切换演出"，刷新页面 | 两项不在 defaultMeta，白名单重建时被丢，刷新即恢复默认（残影关、演出开） | 中 | `defaultMeta` 补 2 字段 + `normalizeMeta` 补 2 行（§4.3） |
| R4 配额满时元进度不落盘 | 3 槽局内存档把配额吃满（单槽上限 4,000,000 字符） | `saveMeta` 静默失败；刚花结晶买的天赋、刚解锁的成就在关闭页面后回滚（不是崩溃） | 中（触发条件理论） | `saveMeta` 捕获 quota → 删最旧槽 → 重试一次；同时把单槽上限降到 1.5 MB（§4.4） |
| R5 `saveMeta(meta)` 传参无效 | 解锁首领蓝图 | 该行实际写的是 `state.meta` 而非参数；因为紧接着 `codexMarkSeen` 又写一次，**当前无实际丢失** | 低 | 改为 `saveMeta()` 或给 `saveMeta(meta)` 加可选参数 |
| R6 `eventStats` 迁移重置 | 存档 `version < 5` **但**里面已有 `eventStats` | 五个统计被整体置 0 | 中（理论，见 §5） | 改成合并：`Object.assign(默认零值, 原值)`（§4.6） |
| R7 槽位版本不符清空 | 以后把 `SAVE_SLOTS_CONFIG.version` 从 2 改大 | 3 个局内存档槽**一起静默丢弃**（无迁移、无备份） | 低（理论，见 §5） | 版本不符时先把原 store 备份到 `arcane_run_slots_v1.bak` |
| R8 局内存档恢复注入未知键 | 同版本但快照里有未知字段 | `restoreRunFromSlot` 把 `data` 的每个键直接赋给新 state | 低 | 不需要改：store 版本门禁已挡住跨版本；同版本内字段集合固定 |

---

## 4. 关键证据与补丁片段

### 4.1 R1：坏档 → 默认档 → 启动即覆盖（已存在）

读档兜底（[L16781-16786](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L16781-L16786)）：

```js
  } catch (error) {
    // D4：坏 JSON 不崩，降级到默认存档并留一条提示
    metaLoadNotice = '存档已损坏，已按默认存档继续';
    return defaultMeta();
  }
```

启动流程（[L63364](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L63364) 与 [L63391](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L63391)，按当前 2,711,566 B 快照行号）：

```js
  state = createInitialState();   // 内部 loadMeta()，坏档时拿到 defaultMeta()
  ...
  saveMeta();                     // 此处无条件写回 → 原存档字符串被覆盖
```

"损坏"提示在 `startGame()` 里才弹（[L53245-L53248](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L53245-L53248)），此时磁盘上已经是新档。

node 实测（从主文件抽真实函数 + 假 localStorage，复刻"load → 启动 save"）：

| 输入 | 原档 | 启动后磁盘 |
|---|---|---|
| 截断 JSON（原档 `crystals=120`、天赋合计 9 级） | 120 / 9 | **0 / 0**，成就清空 |
| `[1,2,3]` / `"hello"` / `42` / `null` | — | 一律变成默认档 |

补丁（锚点 = 函数名，主文件冻结期可用）：

```js
/* 补丁 1：loadMeta 增加"原始文本备份"，并标记本次是从坏档降级的 */
let metaFallbackClean = false;

function loadMeta() {
  try {
    const raw = window.localStorage.getItem(GAME_CONFIG.metaKey);
    if (!raw) return defaultMeta();
    const parsed = JSON.parse(raw);
    const fixed = normalizeMeta(parsed);
    /* ……原逻辑不变…… */
    return fixed;
  } catch (error) {
    /* 先把原始文本另存一份，避免后续 saveMeta 把唯一副本覆盖掉 */
    try {
      const rawNow = window.localStorage.getItem(GAME_CONFIG.metaKey);
      if (rawNow) window.localStorage.setItem('arcane_rogue_meta.broken.' + Date.now(), rawNow);
    } catch (e) { /* 配额满/隐私模式：备份失败也不能再挡住降级 */ }
    metaFallbackClean = true;
    metaLoadNotice = '存档已损坏，已按默认存档继续（原档已备份）';
    return defaultMeta();
  }
}

/* 补丁 2：启动那次写档跳过，保证"至少本次会话不会覆盖原存档" */
// L63391（旧快照 L63385）改为：
if (!metaFallbackClean) saveMeta();
```

补充说明：`metaFallbackClean` 只挡启动那一次；玩家后续在设置页改任何选项仍会写档。如果要求"坏档时整局都不写"，把 `saveMeta()` 第一行加 `if (metaFallbackClean) return;`，并在设置页提供"接受新档/导出原档"两个按钮。

### 4.2 R2：多标签页覆盖（已存在）

- 全文件检索 `addEventListener('storage')` / `onstorage` / `BroadcastChannel` / `SharedWorker`：**0 处**。
- 写档是整对象（[L16793](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L16793)）：
  ```js
  window.localStorage.setItem(GAME_CONFIG.metaKey, JSON.stringify(state.meta));
  ```
- 另一条隐性写盘：`pagehide` / `visibilitychange` 自动存局内槽（[L54097-L54104](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L54097-L54104)），两页都"继续"槽 1 时各自往槽 1 写。

后果：A 页买到 4 级天赋 → B 页（内存里还是启动时的旧 meta）任意一次写档 → A 的结晶扣减与天赋等级一起被回滚。

补丁：

```js
/* 补丁 3：检测另一个标签页写档；检测到后本页停止写 meta，避免覆盖对方 */
let metaExternalChanged = false;

window.addEventListener('storage', (event) => {
  if (event.key !== GAME_CONFIG.metaKey || !event.newValue) return;
  if (metaExternalChanged) return;
  metaExternalChanged = true;
  showToast('检测到另一标签页更新了存档：本页已停止写入，请刷新后继续', 'warn');
});

function saveMeta() {
  if (metaExternalChanged) return;   // ← 新增这一行
  try {
    window.localStorage.setItem(GAME_CONFIG.metaKey, JSON.stringify(state.meta));
  } catch (error) { /* 原样 */ }
}
```

注意：这是"止损"不是"合并"。要真正合并需要给 meta 加单调修订号（`meta.metaRev`）并改 schema 版本，属于结构性改动，不建议发版前做。

### 4.3 R3：两个设置不在白名单（已存在）

写入（[L38425](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L38425)、[L38438](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L38438)）：

```js
  state.meta.motionTrail = !!on;
  ...
  state.meta.regionFx = !!on;
```

而 `defaultMeta()`（[L16154-L16241](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L16154-L16241)）里没有这两个键，`normalizeMeta` 也没有复制它们 → 读档时被白名单丢掉。读取侧默认值：残影 `=== true` 才开（[L47330](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L47330)），演出 `!== false` 才开（[L47334](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L47334)）。

node 实测 T5：写入这两个字段后读档，两键均不存在。

补丁：

```js
/* 补丁 4a：defaultMeta 增加两键（放在 postfx 附近） */
    motionTrail: false,      // 冲刺残影：默认关
    regionFx: true,          // 大区切换演出：默认开

/* 补丁 4b：normalizeMeta 增加两行（放在 base.comboFx 附近） */
    base.motionTrail = raw.motionTrail === true;
    base.regionFx = raw.regionFx !== false;
```

这是纯补字段，不改 `META_SCHEMA_VERSION`（与 L16234 的既有口径一致：可选补字段不升版本）。

### 4.4 R4：容量与静默写失败（已存在，触发条件部分理论）

- 单槽上限 4,000,000 字符（[L7695](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L7695)），3 槽上限合计 **12,000,000 字符**；主流浏览器 origin 配额约 **5MB**。
- 槽位写入有配额降级（[L50094-L50100](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L50094-L50100)）：只保留最新一槽。
- 但 `saveMeta` 没有降级、没有提示（[L16794-L16796](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L16794-L16796) 只有空 catch）。配额被槽位吃掉后，元进度落盘会**静默失败**。

补丁：

```js
/* 补丁 5：saveMeta 配额失败时，先丢最旧局内槽再重试一次，仍失败则明确告知 */
function saveMeta() {
  if (metaExternalChanged) return;
  const write = () => window.localStorage.setItem(GAME_CONFIG.metaKey, JSON.stringify(state.meta));
  try {
    write();
  } catch (error) {
    try {
      const store = readRunSlotStore();
      const keys = Object.keys(store.slots);
      if (keys.length) {
        keys.sort((a, b) => (store.slots[a].savedAt || 0) - (store.slots[b].savedAt || 0));
        delete store.slots[keys[0]];
        writeRunSlotStore(store);
        write();
        showToast('存储空间不足：已清理最旧的局内存档以保住永久进度', 'warn');
        return;
      }
    } catch (e) { /* 二次失败走下面 */ }
    showToast('存储空间不足：本次永久进度未能保存', 'warn');
  }
}
```

容量结论：

- **meta 不会随局数线性增长**：`seedRuns` 上限 60 条（[L16438-L16441](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L16438-L16441)）、洗点记录 20 条（L16297）、图鉴每类 200 条（L16464）、`storySeen` 40 条（L16313）、成就为有限集合。实测极端值 20.4 KB。
- **局内存档不增长**：固定 3 槽，覆盖写，不追加。
- **实际槽体积未验证**：不允许开浏览器，无法读取真实快照的字节数；按快照字段（rooms/enemies/projectiles/bullets/pickups/fog）判断大概率在百 KB 级，远低于 4 MB，但这句是推断，不是实测。

### 4.5 R5：`saveMeta(meta)` 传参无效（已存在，无实际后果）

[L23196](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L23196) `saveMeta(meta)`，但 `saveMeta` 声明无参、固定写 `state.meta`。好在紧接 [L23202](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L23202) 的 `codexMarkSeen('blueprints', …)` 会再调用一次 `saveMeta()`（L49860），此时 `state.meta.bossBlueprints` 已更新，蓝图实际会落盘。所以本项只记为代码口径隐患，建议改成 `saveMeta()`。

### 4.6 R6：`version<5` 时 `eventStats` 被整体重置（理论）

[L16510-L16515](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L16510-L16515)：

```js
  if (fromVersion < 5) {
    out.eventStats = { sacrifice: 0, wagerWins: 0, wagerLosses: 0, curses: 0, curseTicks: 0 };
    out.version = 5;
  }
```

这是**无条件覆盖**，与其余步骤的"只补不删"不同。node T4 实测：`version=4` + `eventStats{7 胜 9 献祭}` → 读回全 0。

为什么判"理论"：`eventStats` 是 v5 引入的，真实的 v4 档里根本不会存在该字段（v4 快照的 26 字段里没有它）。只有版本号被手工改小、或拿 v5+ 存档喂给 v4 旧构建后又被 v9 读，才会命中。

补丁：

```js
/* 补丁 6：保留已有统计，只补缺失键 */
  if (fromVersion < 5) {
    out.eventStats = Object.assign(
      { sacrifice: 0, wagerWins: 0, wagerLosses: 0, curses: 0, curseTicks: 0 },
      (out.eventStats && typeof out.eventStats === 'object') ? out.eventStats : {});
    out.version = 5;
  }
```

### 4.7 R7：槽位版本不符 → 3 槽一起清空（理论）

[L49969-L49971](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L49969-L49971)：

```js
    if (parsed.version !== SAVE_SLOTS_CONFIG.version) {
      return { version: SAVE_SLOTS_CONFIG.version, slots: {} };
    }
```

取证：当前主文件与三份可用历史快照（`bak_20261108_1735.html`、`bak_20261108_v160_C762F594.html`、`index_arcane_v2.bak_c1fix.html`）的 `SAVE_SLOTS_CONFIG.version` 都是 2；更早的 `_backup` 目录里没有该键。**未发现在野的 version 1 槽位**，所以判理论。但下次任何升版都会静默清槽，建议升版前加备份。

---

## 5. 已排查、判定"不是风险"的项

| 项 | 结论 | 依据 |
|---|---|---|
| 新增字段读成 `undefined` 导致 NaN / 渲染崩 / 天赋归零 | **不会**：44 字段全部在 `normalizeMeta` 里重建，数值统一 `Number(x) || 0` + `Math.max` + `clamp` | L16254-L16475；node T2/T3/T7 |
| 删除字段被原样写回、越滚越大 | **不会**：白名单重建，读档时丢弃 | node T5c |
| `null` / `NaN` / 空字符串 | **不会崩**：`version:''`→0 走全量迁移；`talents:null`→0 级；`codex:null`→从 recipes/blueprints 回填；`seedRuns:null`→`{}`；`unlocks:null`→按 bestFloor 重推 | L16253、L16331、L16419、L16459 |
| JSON 解析失败导致白屏 | **不会白屏**：有 catch，游戏照常进标题页 | L16781 |
| `unlocks` 在旧档缺失时被清空 | **不会**：缺失才补空对象，已有对象原样保留（node T4d 更正了假设） | L16497、L16331 |
| 旧名 `奥术工程师` 存档读不了 | **不会**：不校验名字，只记 `legacyTitle` | L16765-L16775 |
| 崩溃标记坏 JSON | **不会崩**：try/catch + 类型判断 | L7280-L7287 |
| 新手指引键损坏 | **不会崩**：静默降级为"每局都提示" | L46109-L46127 |

---

## 6. 容量实测

| 对象 | 实测 / 推断 | 数值 |
|---|---|---|
| meta 简单档（少量成就 + 200 条敌人图鉴） | node 实测 | 2,899 B ≈ 2.8 KB |
| meta 极端满配（60 种子 + 47 成就 + 60 配方 + 6×200 图鉴） | node 实测 | **20,287 B ≈ 19.8 KB** |
| meta 增长趋势 | 代码上限约束 | 不随局数线性增长 |
| 单槽上限 | 配置值 | 4,000,000 字符 |
| 3 槽合计理论上限 | 计算 | 12,000,000 字符（> 常见 5 MB） |
| 单槽实际体积 | **未验证**（未开浏览器） | 推断百 KB 级 |
| localStorage 上限 | 浏览器约定 | 约 5 MB / origin |

---

## 7. 最小验证清单（只能测 3 个场景时）

1. **坏档恢复（优先级最高，直接对应 R1）**
   - 打开游戏 → 在控制台把 `localStorage.getItem('arcane_rogue_meta')` 存到文本，手工截断后写回 → 刷新。
   - 通过标准：加补丁前应看到"天赋归零 + 磁盘被覆盖"；加补丁后必须能在 `localStorage` 里找到 `arcane_rogue_meta.broken.*` 原始文本，且首次 `saveMeta` 不覆盖。
2. **真实 v4 老档升级（对应 §2）**
   - 用 `bak_pre8_title.html`（schema 4）在浏览器里生成一份 v4 存档（或按 26 字段构造），换到 v1.6.1 打开。
   - 通过标准：`version` 变 9，`talents/结晶/bestFloor/成就/蓝图/配方/storySeen` 全部保留，`eventStats` 全 0（本该如此），不弹红字错误。
3. **双标签页覆盖（对应 R2）**
   - 标签 A 买 1 级天赋（花掉结晶）→ 标签 B 保持打开并做一次会写档的操作（如改设置）→ 关闭 B → 刷新查看 A 的购买是否还在。
   - 通过标准：加补丁前大概率回滚；加补丁后 B 应弹"检测到另一标签页更新了存档"并停止写档。

---

## 8. 明确"未验证"的部分

- 玩家机器上真实的老存档文件：无法获得，以上结论基于代码与本地历史快照。
- 局内存档的真实字节数：需要浏览器运行期读取，本次约束禁止，**未测**。
- 不同浏览器（Safari / Firefox）的实际配额与 UTF-16 计费差异：未测，本文按 5 MB 量级估算。
- `version` 8 是否真实发布过：历史快照里只有 4 和 9，无法确认 8 是否是中间态；迁移分支 `fromVersion < 9` 同时覆盖 8，功能上无差异。
