# 第 12 项 · 开局随机化（open-random）

> 交付清单第 12 项：起始卡 / 起始遗物 / 大区顺序 / 精英词缀 / 事件与宝箱分布 / 掉落倾向，全部走同一可控随机源。
> 纪律：单文件零依赖、函数级注释、总开关关闭后与当前行为完全一致、不改弱已 PASS 断言。

## 1. 一句话目标

**每一局的开局骨架不同，但同一局可以被同一颗种子完整复现。**

## 2. 总开关与子开关

```js
const OPEN_RANDOM_CONFIG = {
  enabled: true,            // 总开关：false → 以下全部不生效，行为与 v1.0.3 完全一致
  salt: 'open-run',         // 随机源命名空间
  sub: {
    startCard: true,        // 起始卡
    startRelic: true,       // 起始遗物
    zoneOrder: true,        // 大区（楼层主题）顺序
    eliteAffix: true,       // 精英词缀偏好
    roomBias: true,         // 事件 / 宝箱 / 精英分布偏好
    dropBias: true          // 奖励掉落倾向
  },
  startRelicPool: ['firstStrike', 'lastStand', 'overflow', 'momentum', 'bloodthirst', 'thorns', 'roomCharge'],
  bias: { min: 0.20, max: 0.55 },   // 偏好倍率的取值区间（×1+[min,max]）
  dropKinds: ['magic', 'tech', 'relic', 'fusion'],
  roomKinds: ['event', 'chest', 'elite']
};
```

**为什么 startRelicPool 只放这 7 件**：它们的效果全部在运行时读 `state.relics`（`damageEnemy` / `damagePlayer` / `killEnemy` / `onRoomCleared`），
`apply()` 为空，所以在 `createInitialState()` 里直接写 `fresh.relics[id] = 1` 是安全的；
带 `apply()` 的 5 件（hp / regen / power / haste / swift）必须在全局 `state` 就位后再 apply，否则会改到上一局的状态，禁止放进池里。

## 3. 同一可控随机源（唯一入口）

```js
/** 本局随机源种子：种子局用 state.seedInfo.value；普通局用开局时生成并记录下来的 32 位种子 */
function openRunSeed(stateLike)

/** 从同一个种子派生命名流；每个 stream 是独立游标，按调用顺序推进 */
function openRandomState()   // { seed, streams: { startCard, startRelic, zoneOrder, eliteAffix, roomBias, dropBias } }

/** 唯一的取数入口：openRand('startCard') */
function openRand(streamName)
```

- 实现基于既有 `makeSeedRng(seed, salt)`，**不新增第二套随机算法**。
- 种子来源优先级：`state.seedInfo.value`（每日挑战 / 自定义种子）→ `state.openRandom.seed`（普通局首次生成，`Math.random()` 取 32 位）→ `Math.floor(Math.random()*2**32)`。
- **禁止**在这 6 个系统里直接用 `Math.random()`；关闭总开关时恢复旧路径（旧路径本来就不是同一个源，这是"关闭=零差异"的必要条件）。

## 4. 六项随机化的落点

| 子项 | 落点 | 做法 |
|---|---|---|
| 起始卡 | `createInitialState()` 里 `startCardNow` 的计算 | 从 `startCardPool()` 抽 1 张（`pool[floor(openRand('startCard')*pool.length)]`）；天赋 `startPool` 扩充池 → 选项更多；`startGame()` 用 toast 报"本局起始卡：xxx" |
| 起始遗物 | `createInitialState()` 里 `talentEff('startRelic') > 0` 分支 | 从 `startRelicPool` 抽 1 件写进 `fresh.relics`；不再固定 `firstStrike` |
| 大区顺序 | `state.themeCycle` + `getTheme(floor)` | 用 Fisher–Yates 洗 `THEME_CONFIG.cycle`，得到本局顺序；`getTheme` 优先读 `state.themeCycle`（关闭时读配置默认 `cycle`） |
| 精英词缀 | `pickEliteAffix()` / `pickEliteAffixForKey()` | 抽 1 个偏好词缀 `state.openBias.affix`，该词缀权重 ×(1+bias)；抽取走 `openRand('eliteAffix')` 以保同种子可复现 |
| 事件 / 宝箱分布 | `assignRoomTypes()` 的 `weights` | 从 `roomKinds` 抽 1 个偏好房型，权重 ×(1+bias)；只改权重、不动 `ROOM_TYPE_CONFIG` 本体 |
| 掉落倾向 | `buildRewardOptions()` → `pickWeightedOptions()` | 从 `dropKinds` 抽 1 个偏好类型，该 kind 的候选权重 ×(1+bias) |

## 5. 存档衔接

- `state.openRandom`（种子 + 各流的抽取结果）与 `state.themeCycle` 必须写进局内存档白名单（`captureRunSnapshot` / `applyRunSnapshot`），
  否则读档后楼层主题和偏好会变——这是"存档可恢复"的硬要求。
- 不写 `meta`：这是"本局"属性，跨局不继承。

## 6. 调试口

`window.__roamDebug.openRandom = { config(), info(), setSeed(n), reroll() }`
- `info()` 返回 `{ seed, card, relic, themeCycle, affix, roomPref, dropPref }`
- `setSeed(n)` 只对下一次开局生效（用于断言复现）

## 7. 断言（`tools/arcane_openrandom.js`，O1–O10）

1. **O1** 配置结构：6 个子项 + 池/偏好表齐全，总开关默认开
2. **O2** 同种子可复现：同一 seed 连续两次 `createInitialState()`，起始卡 / 起始遗物 / 主题顺序 / 三类偏好完全一致
3. **O3** 不同种子有差异：20 个不同 seed 至少出现 2 种起始卡、2 种主题顺序
4. **O4** 起始卡一定在池内，且池大小随 `startPool` / `thirdWeapon` 天赋变化
5. **O5** 起始遗物只在天赋解锁后发放；id 必须 ∈ `startRelicPool`，且该遗物 `apply()` 为空（动态读）
6. **O6** `themeCycle` 是 `THEME_CONFIG.cycle` 的排列；`getTheme(n)` 与 `themeCycle[(n-1)%3]` 一致
7. **O7** 房型偏好生效：同一批楼层，开偏好后偏好房型的出现次数 > 关闭时（统计 30 层）
8. **O8** 掉落偏好生效：同一奖励池重复抽取，偏好 kind 的占比高于无偏好
9. **O9** 总开关关闭零差异：起始卡=`fireball`、`relics` 不含起始遗物、`themeCycle` 为默认顺序、`getTheme` 与旧实现逐层相等
10. **O10** 局内存档往返：`captureRunSnapshot` → `applyRunSnapshot` 后 `openRandom.seed` 与 `themeCycle` 逐字段一致；页面 0 异常

## 8. 收尾

- 同步 `spec.md` / `tasks.md`，勾选交付清单第 12 项，单独报一次。
- 回归：syntax + openrandom + title 17 / render 21 / opening 11 / transition 13 / p2 + p1
