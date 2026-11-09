# E1 落地报告：保底精英核查 · F1 空卡率 · 种子/每日挑战 · 可粘贴补丁

> **状态：补丁就绪，但本轮不落（红线未通过）。**
> 主文件正在做 v1.6.0 发布验收（冻结中）；更关键的是**新红线也不允许落**：
> **10 层通关 42.2% [A] / 42.3% [A′] > 40% 即停；F20 到达 36.7% / 36.7% > 36% 即停** —— 两个都超。
> 按裁决回到「F2 首领找回当难度点」。旧红线「5 层 >52%」已废止（设在了非难度关卡上），废止记录留在验收清单 §八。
> **落地排序**：`mech2 → E1 → W12(F2)`，三个分开落、每落一个各跑一次通关率，**不许合并**。
>
> 口径：`tools/sim_panel` 离散事件模拟器，普通档，固定种子 20261108，10000 局。
> 主文件核查：无头 Edge + Puppeteer 打开 `index_arcane_v2.html`，直接调用 `generateFloor`（未改文件）。
> **`index_arcane_v2.html` 本轮零改动**，补丁只在本文件里给文本，没有落盘。

---

## 0. 三句话结论

1. **保底精英房 56% 可绕、44% 必经。** 两条路线永远存在（`attachLoopRoutes` 的兜底边），精英房落在两线交集时才是绕不开的。
   → A（按权重 37% 精英出现率）合法，但比"必经下限"还低，略乐观；B（100%）是 2.3 倍高估。**主口径改为 A′（只算必经精英）：46.0%。**
2. **F1 额外三选一的"三张全废"率 = 0.4%**（远低于你定的 5% 红线）。但"随机点一张正好是空卡"= 25.1%，
   因为 F1 结束时技能槽**已经满**（火球+冰霜 52%），这与全程 12.8% 的差异要说清楚（见 §3）。
3. **种子一致性成立，而且理由比预期更硬**：楼层布局/出怪用 `seed + floor` 独立派生的随机流；
   **奖励卡面用的是 `Math.random`，根本不消耗种子流**。浏览器实测：插入 1000 次随机调用后，F2–F20 布局逐字节一致。

---

## 1. 事实核查：保底精英房能不能绕

### 怎么测的

在真实的主文件里循环生成楼层（`state.seedInfo` 关掉，让布局每次随机），每次记录：

- `findSimpleRoutes(spawn, stair, 8, edges, rooms)` 的全部路线；
- `state.rooms` 里的精英房 id；
- **判据：如果每一条通往楼梯的路线都包含至少 1 间精英房 → 该层精英"必经"；否则"可绕"。**

样本：**F2–F20 共 570 层**（30 轮 × 19 层）；F2–F5 另外补到 **每层 100 样本**（400 层）。
同时验证结构：每层固定 **5 间房**（`minRooms = maxRooms = 5`），**永远有 2 条路线**（`attachLoopRoutes` 保证），
`state.eliteRoute`（精英支线）**100% 生成**。

### 结果

| 楼层 | 必经（绕不开） | 可绕 |
|---|---|---|
| F2 | 44% | 56% |
| F3 | 10% | 90% |
| F4 | 52% | 48% |
| F5 | 47% | 53% |
| F6–F20 | 46.5% | 53.5% |
| **整体** | **44.2%** | **55.8%** |

为什么会有零有整：`assignRoomTypes` 的保底是把"最后一间非出生/非楼梯房"直接改成精英
（锚点：`assignRoomTypes`，`if (floor >= 2 && !state.rooms.some(r => r.type === 'elite'))`）。
这间房在不在两条路线的交集，取决于当层 5 间房的布图。`designEliteRoute` 再把"绕远支线"的专属房间改成精英，
所以**两条路线各有一间精英**的楼层就变成"怎么走都要打"。

### 对口径的决定

- **B（每层 100% 精英）不成立**：把"存在精英"错当成"必经精英"，精英死亡被高估 2.3 倍（3303 vs 真实量级）。
- **A（37% 出现率）也不是完全对**：它比实测必经率 44% 还低 7pp，相当于假设玩家连"绕不开的精英"也会少打。
- **A′（真实保底口径）= 只打必经精英、不主动进精英支线**：这才是玩家行为的**下界**，也是本轮起的主口径。

| 口径 | 含义 | 5 层通关 | 平均层 | F20 到达 | 精英总死亡 |
|---|---|---|---|---|---|
| **A′ 真实保底（新主口径）** | 只打绕不开的精英 | **46.0%** | 8.78 | 32.1% | 1319 |
| A 按权重（旧口径） | 贪心模型，37% 出现率 | 44.9% | 8.65 | 31.7% | 1712 |
| B 保底全打（最坏） | 每层都进精英 | 38.5% | 7.95 | 29.1% | 3303 |

**位移很小（A → A′ 只有 +1.1pp）**，因为精英房只比战斗房难约 1.3 倍，且必经楼层并没有想象中多。
对外报数仍然必须写 **[A′]** 或 **[B]**，不许只写一个数；A 作为历史对照保留。

---

## 2. E1 在 A′ 口径下的收益

| 指标 | A′ 基线 | A′ + E1 | Δ |
|---|---|---|---|
| 5 层通关率 | 46.0% | **53.4%** | **+7.4pp** |
| 平均层数 | 8.78 | 9.87 | +1.09 |
| F15 到达 | 34.6% | 39.8% | +5.2pp |
| F18 到达 | 32.8% | 37.6% | +4.8pp |
| F20 到达 | 32.1% | 36.7% | +4.6pp |
| F2 死亡 | 1751 | 1376 | −375 |
| F3 死亡 | 1652 | 1387 | −265 |

A 口径下：44.9% → 52.4%（+7.5pp）。**两个口径都 +7pp 以上，E1 的结论不受口径选择影响。**

> 修正一处引用：上一轮报的 **51.8%** 是把 E1 建模成"开局就发卡"；本轮改成**真实触发点（F1 清层后）**，
> 所以准确值是 **52.4%（A）/ 53.4%（A′）**。差的 0.6pp 来自"这张卡不参与 F1 本身"。

### 2.1 红线判定：两条线在两个口径下都超

| 指标 | A 基线 | A′ 基线 | A + E1 | A′ + E1 | 红线 |
|---|---|---|---|---|---|
| 5 层通关（**参考，不判**） | 44.9% | 46.0% | 52.4% | 53.4% | — |
| **10 层通关** | 35.9% | 36.4% | **42.2%** | **42.3%** | **>40% 即停** |
| **F20 到达** | 31.7% | 32.1% | **36.7%** | **36.7%** | **>36% 即停** |

- **两条红线都超** → 按裁决：**E1 暂不落，回到「F2 首领找回当难度点」**。
- 5 层 +7.5pp 是**预期收益**（E1 的目标就是捞 F2/F3 手牌不够的人），不作为判定项。
- 但 10 层 +6.3pp、F20 +5.0pp 说明它**不只在开局起作用，而是把中段和深层一起推高** → 整条难度曲线被压平，这才是红线要拦的东西。

---

## 3. F1 这次额外三选一：空卡率单独量

抽样 9999 次 F1 发卡（`probe_e1_f1.js`）：

| 指标 | 数值 | 说明 |
|---|---|---|
| **三张全是空卡**（你担心的"点三下都是废牌"） | **0.4%**（36/9999） | 远低于 5% 红线 |
| 3 张里有效张数分布 | 3 张：72.2% / 2 张：23.4% / 1 张：4.1% / 0 张：0.4% | 99.6% 至少有一张能用 |
| 随机点一张正好是空卡 | **25.1%** | 这是模拟器的"随机选牌机器人"，不是人 |
| 魔法卡真的换了槽 | 31.3% | 其余魔法卡是"数值不如现有主/副" |
| 卡类型 | 魔法 56.3% / 遗物 27.3% / 科技 15.6% / 融合 0.8% | |
| 发卡时等级 | Lv.3：82% / Lv.4：18% | 即 F1 已拿过 1–2 张卡 |
| 发卡时技能槽 | 火球+冰霜 **52.1%**，其余为火球+某张已换的卡 | **槽是满的，不是空的** |

**判断（要直说）：**

- 你定的红线是"三张全是废牌"，实际 **0.4%**，比不给卡的风险小得多 —— **可以落地。**
- 但 **25.1% 的"随机选就是空卡"** 比全程 12.8% 高，原因是 F1 结束时槽已经满（52% 是火球+冰霜），
  魔法卡占 56%，其中约一半换不动槽。真实玩家看到三张会挑，不会像机器人乱点；**但"空卡"在 F1 确实比中后期更常见。**
- 结论：这不是"第三张更贵的卡"，而是"**三张里必有一张能用，但另外两张经常是陪跑**"。
  体验上更像"一次有明确最优解的补强"，不是"三选一抽奖"。这比"全废"好，但也没有全局 12.8% 那么漂亮。

> **对外/对内都并列写这两个数，不许只写好看的 0.4%**：
> - **三张全废 = 0.4%** → 它回答的是"会不会点三下都没用"；
> - **随机点一张正好空卡 = 25.1%** → 它回答的是"挑错了会不会浪费一次机会"。
>
> 只写 0.4% 会让人以为"三选一几乎总能选到有用的"；实际是"**几乎总有一张有用的，但你挑错就浪费**"。
> 这两个数说的是两件事，缺一个就会误导。

---

## 4. 种子一致性 与 每日挑战

### 4.1 种子一致性：成立，且不依赖"少调一次随机"

主文件的随机流结构（读代码确认）：

| 内容 | 随机源 | 是否受"多一次选卡"影响 |
|---|---|---|
| 楼层布局（房间位置/连线/词缀） | `withSeedRng(seed, 'floor:' + N)` | **不受**：每层重新派生 |
| 敌人种类/数量 | `withSeedRng(seed, 'spawn:' + N)` | **不受**：每次生成重新派生 |
| 奖励卡面（技能/遗物/科技） | `pickWeightedOptions` 里的 **`Math.random()`** | 本来就不在种子承诺内 |

也就是说：**E1 多出来的那次三选一，连一次种子随机都不会消耗**（它走 `Math.random`）。
不需要为 E1 额外做"分叉随机流"，这也是它比 W1/W2 更适合先上的原因之一。

**浏览器实测**：`seed = 'demo-seed-42'`，生成 F2–F20 记录指纹（房间 id/类型、边、出生/楼梯、精英支线）；
中间插入 **1000 次 `rng()` + `Math.random()` 调用**，再生成一次：

```
same: true, diffAt: -1     // 19 层逐字节一致
```

→ **同种子 + 同操作，加 E1 后楼层布局、敌人种类、结晶掉落额度不变；只有多出一张卡。**
P2-1 种子局的承诺不破。

### 4.2 每日挑战

- 每日挑战 = `startSeedRun(dailySeedValue(), { daily: true })`，本质是"锁定种子的普通局"。
- 如果每日挑战也吃 E1，**同一个种子的难度会变**，而历史成绩是按旧规则打的 → 榜单不可比。
- **建议：每日挑战默认不启用 E1**（补丁里 `E1_CONFIG.dailyOff = true`）。
  这样不需要写"某日之后换规则"，历史榜单永远同规则可比。
- 如果你更希望每日挑战也有 E1：把 `dailyOff` 改成 `false`，并在公告里写
  "**2026-11-XX 起每日挑战启用 E1**"，同时接受该日之前/之后的成绩分段解释。

**每日挑战四锁（2026-11-08 裁决，与种子局那条线同步）**：榜要可比，以下四项必须同时锁死——

| # | 锁 | 值 |
|---|---|---|
| 1 | 锁种子 | `startSeedRun(dailySeedValue(), { daily: true })` |
| 2 | 挑战等级 | `state.ascension = 0` |
| 3 | 难度 | 固定**普通档**（不受 `meta.difficulty` 影响） |
| 4 | 解锁池 | **满解锁**（否则不同玩家卡池不同，同一张卡面都不成立） |

**四项缺一，榜就不可比。** E1 另由 `dailyOff` 单独关闭（不在这四锁之内），等于每日局完全不启 E1。

---

## 5. 可粘贴补丁（锚点：函数/常量名，无行号）· 就绪，未落盘

> 状态：**文本就绪，本轮不落**——v1.6.0 发布验收结束 + 红线未过（10 层 42.2/42.3 > 40；F20 36.7 > 36）。

设计：**1 个常量 + 2 个新函数 + 4 处小改**。全部可单独回滚；`?e1=off` 可运行时关掉。

### H1 · 常量（锚点：`const REWARD_CHOICES_CONFIG` 下方）

```js
/* E1：第一层清空后额外一次三选一（2026-11-08 定案）
 * 依据 tools/sim_panel/probe_e1_f1.js：A′ 46.0% → 53.4%（+7.4pp），A 44.9% → 52.4%
 * 总闸：URL 加 ?e1=off 关闭；每日挑战默认不启用（保证历史榜单同规则可比） */
const E1_CONFIG = {
  enabled: true,
  floor: 1,
  choices: 3,
  dailyOff: true
};
/* 运行时总闸：?e1=off / ?e1=0 / ?e1=false 都算关闭 */
(function initE1MasterSwitch() {
  try {
    const q = new URLSearchParams(location.search).get('e1');
    if (q && /^(off|0|false)$/i.test(q)) E1_CONFIG.enabled = false;
  } catch (e) { /* 非浏览器环境：保持默认开启 */ }
})();
```

### H2 · 选项数（锚点：`function rewardChoiceCountForStage`）

```js
function rewardChoiceCountForStage(stage) {
  const s = stage || state.rewardStage || 'skill';
  // E1：第一层额外奖励固定三选一，不受"四选一"开关影响
  if (state.e1RewardActive && s !== 'passive') return Math.max(1, Math.round(E1_CONFIG.choices));
  if (s === 'passive' && state.rewardSource === 'levelup' && XP_CONFIG && XP_CONFIG.enabled) {
    return Math.max(1, Math.round(XP_CONFIG.passiveCount));
  }
  return rewardChoiceCount();
}
```

### H3 · 触发（锚点：`function checkFloorClear` 的 XP 分支）

在 `showToast('本层清空 · 掉落奥能球 ×' + XP_CONFIG.clearOrbs + '（升级时才选卡）', 'success');` 之后、
`return;` 之前插入：

```js
    // E1：第一层清空后额外一次三选一（排队，避免和升级弹窗抢同一个 modal）
    queueE1FloorBonus();
```

### H4 · 两个新函数（锚点：`function openReward` 结束后、`function stampCardFloor` 之前）

```js
/**
 * E1 是否应该在当前这一层生效。
 * 条件：总闸开 + XP 流程（清层本身不弹卡）+ 非每日挑战 + 正好第 1 层。
 * @returns {boolean} 是否生效
 */
function e1BonusActive() {
  if (!E1_CONFIG.enabled) return false;
  if (!XP_CONFIG.enabled) return false;
  if (E1_CONFIG.dailyOff && state.seedInfo && state.seedInfo.daily) return false;
  return state.floor === E1_CONFIG.floor;
}

/**
 * 把一次"额外三选一"挂进队列；若此刻不在弹窗里，立刻打开。
 * 为什么排队：清层那一帧可能正好在处理升级选卡，直接开会被旧弹窗状态覆盖。
 * @returns {boolean} 是否已打开
 */
function queueE1FloorBonus() {
  if (!e1BonusActive()) return false;
  state.e1PendingChoices = Math.max(0, state.e1PendingChoices || 0) + 1;
  return openE1RewardIfIdle();
}

/**
 * 有排队的 E1 奖励、且当前已回到 playing，就打开它。
 * @returns {boolean} 是否打开
 */
function openE1RewardIfIdle() {
  if (!(state.e1PendingChoices > 0)) return false;
  if (state.mode !== 'playing') return false;
  if (state.floor !== E1_CONFIG.floor) {   // 已经下楼：作废，不补发
    state.e1PendingChoices = 0;
    return false;
  }
  state.e1PendingChoices -= 1;
  state.e1RewardActive = true;
  state.rewardSource = 'floor';
  showToast('第一层清空 · 额外三选一', 'success');
  openReward('floor', 'skill');
  return true;
}
```

### H5 · 选完立刻收尾（锚点：`function chooseReward`）

在 `if (state.rewardStage !== 'passive') {` 之前插入：

```js
  // E1：额外奖励只有技能一段，选完直接回战斗，不接被动段
  if (state.e1RewardActive) return closeRewardFlow(false);
```

### H6 · 收尾接力（锚点：`function closeRewardFlow`）

(a) 在 `state.eliteRewardBoost = 0;` 这一行后加：

```js
  state.e1RewardActive = false;   // E1 标记只活一次奖励流程
```

(b) 在函数末尾 `return true;` 之前（`if (state.bossExtraRewards > 0) { ... }` 之后）插入：

```js
  // E1：若额外三选一被升级/首领赏赐流程挡住，这里接上（同样等 playing 后再开新弹窗）
  if (state.e1PendingChoices > 0 && !state.xpChoosing) {
    state.e1PendingChoices -= 1;
    state.e1RewardActive = true;
    state.rewardSource = 'floor';
    showToast('第一层清空 · 额外三选一', 'success');
    showRewardStage('skill');
    return true;
  }
```

### H7 · 文案（锚点：`function buildRewardModalHtml` 的 kicker / title / sub）

kicker：

```js
  const kicker = isPassive
    ? 'FLOOR ' + state.floor + ' · PASSIVE'
    : (state.e1RewardActive
      ? 'FLOOR 1 · BONUS'
      : (state.rewardSource === 'levelup' ? 'LEVEL UP · Lv.' + state.xpLevel : 'FLOOR ' + state.floor + ' CLEARED'));
```

title：

```js
  const title = isPassive ? '楼层被动 · ' + choiceWord
    : (state.e1RewardActive ? '第一层奖励 · 技能' + choiceWord
      : (state.rewardSource === 'levelup' ? '升级强化 · 技能' + choiceWord : '楼层清空 · 技能' + choiceWord));
```

sub（把原来的三目再包一层）：

```js
  const sub = isPassive
    ? '技能奖励已生效。<b>再选一项被动</b>强化本局；顶部列出你已持有的被动，卡面第三行直接给出与本局的联动或冲突。'
    : (state.e1RewardActive
      ? '第一层清空的<b>额外奖励</b>：多拿一张卡再下楼。'
      : '本层敌人已全部清除。<b>先选一项技能</b>，随后还有一次独立被动选择。');
```

### 回滚

- **轻量回滚**：URL 加 `?e1=off`，或把 `E1_CONFIG.enabled` 改成 `false`。
- **彻底回滚**：删掉 H1、H4；还原 H2、H3、H5、H6、H7 五处。没有存档/状态迁移，旧存档不受影响
  （`state.e1PendingChoices` / `state.e1RewardActive` 缺省 undefined，读作 0/false）。

---

## 6. 必须同步改的一条：W1/W2 的作用层段

你说的没错：保底精英既然在 F2–F5 就已经有 10%–52% 的楼层绕不开，`fromFloor: 13` 就划错了。

**A′ 口径下的精英死亡分布（10000 局）**：

| 方案 | 5 层通关 | 平均层 | F2–5 精英死 | F6–12 | F13–20 | 合计 |
|---|---|---|---|---|---|---|
| A′ 基线 | 46.0% | 8.78 | **984** | 283 | 52 | 1319 |
| A′ + W12 F13 起 | 46.0% | 8.78 | 984 | 283 | 28 | 1295 |
| A′ + W12 F6 起 | 46.0% | 8.82 | 984 | 220 | 26 | 1230 |
| A′ + W12 **F2 起** | **49.8%** | 9.21 | **613** | 284 | 27 | **924** |

A 口径：基线 44.9%（F2–5 精英死 1432）；W12 从 F2 起 → **49.5%（+4.6pp）**，精英死 1712 → 1177。

**结论：W1/W2 的 `fromFloor` 应该是 2，不是 13。** 现在的精英压力 **75% 集中在 F2–F5**，
F13–F20 只占 3%–4%。从 F13 起等于给晚期做抛光，救不了通关率。

顺带一个必须先知道的叠加值（**不是这一轮要上的，只是让你有数**）：
**E1 + W12(F2) = 56.5%（A）/ 56.9%（A′）**，平均层 10.2–10.3。
比"E1 单独 52.4%"再高 4pp。按你"一次只动一个杠杆"的规矩，W1/W2 要等 E1 实测曲线出来再决定。

---

## 7. 复现

```powershell
# E1 前置：F1 空卡率 + A/A′/B 收益对照（4 组 × 10000 局）
node tools/sim_panel/probe_e1_f1.js --runs 10000

# W1/W2 层段（A/A′ × F13/F6/F2 + 叠加 E1）
node tools/sim_panel/probe_w_scope.js --runs 10000
```

产物：`probe_e1_f1.json`、`probe_w_scope.json`。

保底精英核查是一次性浏览器实验（无头 Edge + Puppeteer 调 `generateFloor`），
复现步骤写在 §1，未落成脚本以免把浏览器依赖塞进模拟器目录。

---

## 8. 本轮动过 / 没动

**动过（只在 `tools/sim_panel/`）**

- `sim.js`：
  - `levelUp(p, rng, rec)` 增加探针回调；新增 `optionEffective()`（判定"空卡"）；
  - `generateRooms` 新增 `eliteMandatory`（口径 A′，按实测必经率注入）；
  - `runOne` 新增 `e1rng` 独立流、`e1CardAtFloor`（F1 清层发卡探针）、`compositionTrace`（组成指纹）。
- 新增 `probe_e1_f1.js`、`probe_w_scope.js`。

**没动**

- `index_arcane_v2.html`：零改动（补丁只在 §5 文本里）。
- `MERGE-QUEUE.md`：未触碰。
- 方案 C：本轮不上。
