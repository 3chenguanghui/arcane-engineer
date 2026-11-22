# S1 锚点块 · S 批 minFloor → 3 + 折跃步 minFloor → 3

> 给整合线直接贴的改动清单。**本文不写主文件**，只给锚点、命中数与回滚方式。
> 采纳判据：S 批可见性（零 S 54.2%）+ 六张 S 从 6.4–13.1 收敛到 ~15%。
> 方向是**往安全方向压**，不是透支红线（最差口径余量 2.6pp / 4.1pp）。
> ⚠️ **坏秤时代，不可比（2026-11-09 更正）**：本文的最差口径 **35.9 / 30.9** 是方案 A 之前的旧秤值。
> 方案 A 之后基线为 **36.0 / 29.3**，余量 **2.5 / 5.7pp**；**跨分界线不许相减**，旧数只作历史参考。

## 0. 口径头

```
【口径头】sim.js MD5 3051C033CB3C00AA86718E491740CA50 | config.js MD5 6CA6E486DB5AA35FA20CD4A54ADD3052
【口径头】基线含熔炉房 ON（G1）｜真·全关 = G0
【口径头】卡池 20 张（基础6 + A6 + S6 + P0 2）｜minFloor 由脚本覆盖，config.js 文件未改
【口径头】样本 2000 局/口径 × 4 口径 = 8000 局/变体｜档案 bot / 普通
【口径头】红线 10 层 ≤38.5% 且 F20 ≤35%（取最差口径）；±0.1pp 抖动豁免
```

复现：`node tools/s_visibility.js --runs 2000`，变体 `S1+折跃步→3（采纳）`
存档：`.seedwork\s_visibility_2000.json`

## 1. 改哪几处（14 处，全部命中 1 次）

功能闸门只有一处读取 `minFloor`：`MAGIC_CONFIG.forEach` 里的
`if (magic.minFloor && Number(state.floor || 1) < magic.minFloor) return;`（L48105），
它读的是 **`MAGIC_CONFIG`**（卡表，L10318–L10370）；`SKILL_POOL_CONFIG`（L10392–L10402）
里的同名字段是结算台账，不参与抽牌，但**必须同步**，否则以后审计对不上。

### 1.1 功能处（MAGIC_CONFIG，7 行）

| 卡 | id | 行号 | 原 | 新 |
|---|---|---|---|---|
| 斥力脉冲 | pulseShock | L10320 | `minFloor: 4` | `minFloor: 3` |
| 贯流长枪 | pierceLance | L10326 | `minFloor: 5` | `minFloor: 3` |
| 天陨 | skyfall | L10332 | `minFloor: 6` | `minFloor: 3` |
| 符文重锤 | hammer | L10338 | `minFloor: 4` | `minFloor: 3` |
| 灼痕烙印 | brand | L10344 | `minFloor: 4` | `minFloor: 3` |
| 护身符阵 | ward | L10350 | `minFloor: 4` | `minFloor: 3` |
| 折跃步 | riftStep | L10361 | `minFloor: 5` | `minFloor: 3` |

**不动**：霜封印 `frostSeal`（L10367，保持 `minFloor: 5`）、基础 6 张与 A 批 6 张（无该字段）。

锚点用整行替换，每行在原文件中唯一（已核验 7/7 各命中 1 次）：

```
    cost: 30, cooldown: 3.4, damage: 26, minFloor: 4,     →  minFloor: 3   (pulseShock)
    cost: 30, cooldown: 3.6, damage: 38, minFloor: 5,     →  minFloor: 3   (pierceLance)
    cost: 50, cooldown: 6.0, damage: 78, minFloor: 6,     →  minFloor: 3   (skyfall)
    cost: 34, cooldown: 3.0, damage: 52, minFloor: 4,     →  minFloor: 3   (hammer)
    cost: 23, cooldown: 1.4, damage: 36, minFloor: 4,     →  minFloor: 3   (brand)
    cost: 24, cooldown: 5.0, damage: 0, minFloor: 4,      →  minFloor: 3   (ward)
    cost: 18, cooldown: 5.0, damage: 12, minFloor: 5,     →  minFloor: 3   (riftStep)
```

### 1.2 台账处（SKILL_POOL_CONFIG，7 行，同步）

| 行号 | 锚点（唯一） |
|---|---|
| L10393 | `pulseShock:  { kind: 'selfringPush', ... minFloor: 4 }` → `3` |
| L10394 | `pierceLance: { kind: 'pierceLine',  ... minFloor: 5 }` → `3` |
| L10395 | `skyfall:     { kind: 'delayedBomb', ... minFloor: 6 }` → `3` |
| L10396 | `hammer:      { kind: 'heavySingle', ... minFloor: 4 }` → `3` |
| L10397 | `brand:       { kind: 'dotBrand',    ... minFloor: 4 }` → `3` |
| L10398 | `ward:        { kind: 'wardSelf',    ... minFloor: 4 }` → `3` |
| L10400 | `riftStep:    { kind: 'blinkStep',   ... minFloor: 5 }` → `3` |

`frostSeal`（L10401）保持 `minFloor: 5`。

### 1.3 注释同步（2 处，不改会变成假注释）

1. L10316 `· minFloor 分期解锁：保证 F1–F3 的奖励池与扩容前完全一致`
   → `· minFloor 分期解锁：F1–F2 的奖励池与扩容前完全一致，F3 起 S 批进入池子（2026-11-09 由 4/5/6 下调到 3）`
2. L10355 `· 全部 minFloor: 5：F1–F4 奖励池零改动，把风险关在 5 层以后`
   → `· minFloor：折跃步 3（2026-11-09 由 5 下调）/ 霜封印 5`

## 2. 实测（采纳版 vs 修后基线，8000 局/列）

| 指标 | 修后A（现行） | S1+折跃步→3 | Δ |
|---|---|---|---|
| 整局零 S（获得） | 65.5% | **54.2%** | −11.3pp |
| 整局零 S（出现） | 57.4% | **44.1%** | −13.3pp |
| S 批获得率 | 34.4% | **45.8%** | +11.4pp |
| 前 3 层不同牌 | 1.98 | 2.10 | +0.12 |
| 护身符阵 | 6.4% | 7.9% | +1.5pp（贴红线 7.88） |
| 折跃步 | 5.1% | **8.7%** | +3.6pp（过红线） |
| 最差 10 层 / F20 | 37.3 / 33.3 | **35.9 / 30.9** | −1.4 / −2.4 |

四口径（10 层 / F20，%）：中性 33.5/29.0、守拙 35.9/30.9、疾火 35.3/30.4、观星 35.6/30.6
→ 最差 **35.9 / 30.9**，距红线余量 **2.6pp / 4.1pp**，**PASS**。

六张 S 收敛：斥力脉冲 15.2、贯流长枪 13.9、天陨 15.8、符文重锤 15.1、灼痕烙印 13.7、护身符阵 7.9
（池均值 19.71%，红线 40% = 7.88%）。

## 3. 验收断言（贴完逐条查）

1. **F1–F2 奖励池不变**：这两层 `MAGIC_CONFIG` 可出卡集合与改动前逐项相同（S 批全部 ≥3）。
2. **F3 起可出 S**：F3 的三选一里能出现 S 批；护身符阵/斥力脉冲/符文重锤/灼痕烙印最先出现。
3. **双 MD5 不变**：`sim.js 3051…CA50` / `config.js 6CA6…3052`（本次只动主文件，模拟器零改动）。
4. **红线**：贴完后线上四口径最差 10 层 ≤38.5%、F20 ≤35%。
5. **命中数**：14 处替换各命中 1 次；任一处 ≠1 立即停手，不要"猜着贴"。

## 4. 回滚（一条命令级）

把上表 7 处 `minFloor: 3` 改回原值 **4 / 5 / 6 / 4 / 4 / 4 / 5**（顺序同上表），
同步 `SKILL_POOL_CONFIG` 7 处，并把 §1.3 两条注释改回。
回滚后抽牌分布应回到 `修后A` 列（零 S 65.5%、最差 37.3/33.3）——恢复不掉就是漏改了一处。

> 注意：`config.js` 仍是旧 minFloor（4/5/6）。以后再跑 `tools/s_visibility.js`，
> 只有 `s1r` 变体（脚本内覆盖）代表线上新值；直接用 `after` 变体跑出来的是旧口径。
