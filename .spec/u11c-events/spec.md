# U11c · 变量事件（改标签 / 改能力）规格

> 出处：`.spec/round4-5-merge.md` 条目 **C11「事件房加 2–3 条打乱构筑的变量事件」**（R5 §6 杠杆 C），单元表 **U11**（验收："至少 1 个新房间类型可进入并结算"——U11a 商店 / U11b 生存房已完成，本条补齐"变量"）。
> 依赖 U1 标签乘算（`ABILITY_TAGS` / `getAbilityTags` / `tagLevels` / `tagDamageMul`）。本轮**不加新系统**，只给事件房加"改写标签"的能力。

---

## 1. 根因

1. **事件房只有 3 条纯数值**：`eventTable` 现在是「奥能 +60 / 生命 +34 / 生命 -14 奥能 +100」。结算完玩家的**构筑完全不变**——事件房叫"事件"，实际只是"换个方式发资源"。
2. **U1 的标签是只读的**：`ABILITY_TAGS` 是一张出生即定死的常量表，`getAbilityTags()` 只有"查表 / 查融合对象"两个分支。整条乘算链（遗物层数 → `collectMods` → 统治演出 → HUD 标签条）都建立在"标签永不改变"这个前提上，于是"标签"是静态属性，不是可以被搅动的构筑轴。
3. **事件房是唯一合适的落点**：它已经是无怪、进房即结算、有 toast/飘字反馈的房型；在这里改标签不需要新房型、不需要新交互键、不碰战斗流程，风险最低。

## 2. 目标（可一句话验收）

**事件房在 U1 标签系统开启时，有约一半概率抽到"改标签"事件（符文改调 / 标签植入 / 元素易位）；抽到的瞬间该能力的标签真的变了，HUD 标签条层数与 `tagDamageMul()` 同步变化；关掉 A/B 开关则回到原来的 3 条纯数值事件。**

## 3. 数据层

`createInitialState()` 新增（重开自动归零）：

| 字段 | 初始值 | 用途 |
|---|---|---|
| `state.u11cV1` | `true` | 变量事件总开关（false = 事件池只剩旧的 3 条数值事件） |
| `state.tagPatches` | `{}` | `abilityId → tags[]` 的改写板；只在本局有效，跨楼层保留 |
| `state.tagPatchSeq` | `0` | 改写版本号（HUD 标签条的廉价签名必须读它，否则改完不重绘） |
| `state.u11cLast` | `null` | 最近一次变量事件结果（`{ kind, text, ability, from, to, tag, changed, at }`，验收断言用） |

`U11C_CONFIG`（新增，放在 U11c 代码段开头）：

```js
const U11C_CONFIG = {
  cycle: ['fire', 'thunder', 'ice'],   // 元素三循环：火 → 雷 → 冰 → 火
  maxTags: 4,                           // 和 U1 的上限一致（>4 会挤爆标签条）
  events: [ ...3 条，见第 4 节 ]
};
```

## 4. 三条事件（全部"改标签"，不改任何数值）

| id | 名称 | 效果 | 目标选择（确定性） | 断言点 |
|---|---|---|---|---|
| `retune` | 符文改调 | 把一张基础卡的首个元素标签按 火→雷→冰→火 换一位 | 第一张"带元素标签、且换过去不重复"的基础卡（火球必有火 → 一般就是火球） | 火球 `['fire','projectile']` → `['thunder','projectile']`；`tagMul('fireball')` 在 ember 1 层时 `1.2 → 1` |
| `graft` | 标签植入 | 给一张基础卡**追加**一个它没有的元素标签（选全局层数最低的元素，同层数按 cycle 顺序） | 第一张 `tags.length < 4` 的基础卡 | 火球变 `['fire','thunder','projectile']`；`tagLevels().thunder +1`；有 ember+conductor+resonance 时 `tagMul` 从 `1.2` 变 `2.016`（1.2×1.2×1.4） |
| `swap` | 元素易位 | **全卡**「火」↔「雷」互换（其余标签不动） | 全部基础卡（魔法 + 科技） | 火球 `fire→thunder`；同时带火雷的卡两标签顺序互换；`tagLevels()` 的 fire/thunder 层数互换 |

- 三条事件写进 `ROOM_TYPE_CONFIG.eventTable`，统一带 `effect` 字段；`u11cEventPool()` 按开关过滤：
  - `state.u11cV1 === false` 或 `state.tagsV1 === false` → 只返回**没有 `effect`** 的旧 3 条；
  - 都开启 → 旧 3 条 + 新 3 条 = **6 条**（所以"抽到变量事件"的概率是 3/6）。
- 文字在**结算时**拼（`{name}` / `{from}` / `{to}` 是运行时才知道的），模板存在事件条目里只做占位说明。
- 三条事件都不发任何生命 / 奥能 / 余烬 / 结晶 —— 改的只有"这张卡以后吃哪条遗物乘算"。

## 5. 改写板如何接进 U1（精确改动点）

1. **唯一读标签入口** `getAbilityTags(abilityId)`：最前面加
   ```js
   const patch = state.tagPatches && state.tagPatches[abilityId];
   if (state.tagsV1 !== false && Array.isArray(patch)) return patch;
   ```
   这样 `tagLevels()` / `tagDamageMul()` / `tagDamageMul` 的合成融合 / HUD 标签条**全部自动跟着变**，不需要在 6 个施法函数里各改一处。
2. **合成融合缓存**：`buildTagFusion()` 的标签是从两张基础卡现算并写进 `TAG_FUSION_CACHE`；改写后必须 `delete` 掉整张缓存表，否则 `tag:fireball:xxx` 会一直返回旧标签。
3. **HUD 签名** `tagSourceSignature()` 末尾追加 `'/' + Number(state.tagPatchSeq || 0)`；`renderTagBar` / `syncTagSynergy` 都靠这个签名决定"要不要重算"，不加就会"标签变了但标签条不动"。
4. **不要动** `ABILITY_TAGS` 常量本身（U1 的 `tags()` 验收读它做覆盖率断言；运行时改写只写 `state.tagPatches`）。

## 6. 结算路径

`applyRoomReward()` 的 `room.type === 'event'` 分支改为：

1. `const ev = u11cPickEvent();`（`u11cEventPool()` 里随机取一条）；
2. 若 `ev.effect` 存在 → `u11cResolveEvent(ev.effect)`：
   - 成功：`addFloat(text)` + `showToast(text, 'success')` + `playSfx('reward')`，并把结果写进 `state.u11cLast`；
   - 失败（`noAbility`，理论上不会：火球自带火标签）→ 退回旧的数值事件分支；
3. 若 `ev` 没有 `effect` → 走原来的数值逻辑（`heal` / `aether`），代码原样保留。

`room.rewarded = true` 仍在函数最前面，不会重复触发。

## 7. A/B 与调试口

- `__roamDebug.setU11c(value)`：总开关。
- `__roamDebug.u11cPool()`：当前事件池的 id 列表（断言"3 条 / 6 条"）。
- `__roamDebug.u11cApply(kind, abilityId?)`：走真实结算函数，返回结果（不经过随机）。
- `__roamDebug.tagsOf(id)`：某能力**当前生效**的标签（含改写）。
- `__roamDebug.tagLevelsNow()`：当前标签层数。
- `__roamDebug.u11cLast()`：最近一次变量事件。
- 已有 `setTagsV1 / tagMul / tags` 保持不动，可直接用于前后对比。

## 8. 验收断言表（`tools/arcane_u11c.js`，端口 9503）

| # | 断言 | 通过条件 |
|---|---|---|
| 1 | 事件池（全开） | `u11cPool().length === 6`，含 `retune/graft/swap` |
| 2 | 事件池（U11c 关） | `setU11c(false)` → 3 条且不含新 id |
| 3 | 事件池（标签系统关） | `setTagsV1(false)` → 3 条（U11c 即使开着也不出变量事件） |
| 4 | 符文改调 | 火球 `['fire','projectile']` → `['thunder','projectile']` |
| 5 | 改调影响乘算 | ember 1 层时 `tagMul('fireball')` 由 `1.2` 降到 `1` |
| 6 | 标签植入 | 火球变 3 标签且含 `thunder`；`tagLevels().thunder` +1 |
| 7 | 植入影响乘算 | ember/conductor/resonance 各 1 层 → `tagMul` = `2.016` |
| 8 | 元素易位 | 火球 `fire→thunder`；所有基础卡火雷层数互换 |
| 9 | HUD 同步 | `#hudTags .tag-pip` 的文本/数量随改写变化，且不报错 |
| 10 | 事件房真实结算 | 传送到事件房 → `rewarded === true`，`u11cLast` 有记录，toast 文本含"事件" |
| 11 | 重开归零 | `restartRun()` 后 `tagPatches` 为空、`tagPatchSeq` 为 0 |
| 12 | 帧率/异常 | `avgFps ≥ 60`、`errors === 0` |

另需 3 张截图：`u11c-before.png`（默认标签条）、`u11c-retune.png`（改调后 + 飘字）、`u11c-swap.png`（易位后标签条变化）。

## 9. 风险

1. **`getAbilityTags` 是所有乘算的唯一入口**，改它等于改全局伤害。缓解：只在 `state.tagsV1 !== false` 且确实有 patch 时才返回改写值；无 patch 时**完全走原路径**，14 套回归的既有口径不变。
2. **合成融合缓存**：忘记清 `TAG_FUSION_CACHE` 就会出现"卡改了、融合没改"的错位，已在第 5 节列为必改点。
3. **统治演出可能被事件触发**：改调/植入可能让某标签当场跨过 3 层 → 播"短暂统治"。这是设计内效果，但断言脚本要允许 `dominance.count` 变化，不能写死 0。
4. **改调可能让玩家变弱**（火→雷后 ember 遗物失效）：这是"变量"事件的本意，文本会明确写"火 → 雷"，不做数值补偿（本单元不引入新数值）。
5. **不加任何绘制**：本轮不新增房内道具/光效，全部反馈走既有 `addFloat / showToast / HUD 标签条`，把渲染回归风险压到 0。
