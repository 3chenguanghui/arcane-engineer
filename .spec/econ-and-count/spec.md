# 奥能经济 + F5→F6 数量台阶 · 施工规格

> 状态：施工中（用户已预授权自主裁决，不等待确认）。
> 红线：保持 `index_arcane_v2.html` 单文件零依赖；不改已有 13 条融合配方；不把已 PASS 的断言改弱。

## 0. 诊断结论（已核对源码）

| 指标 | 现值 | 来源 |
|---|---|---|
| 奥能自然回复 | `GAME_CONFIG.baseRegen = 8 /s` | 主文件 L4126 |
| 奥能上限 | `baseAether = 100` | L4125 |
| 火球 | cost 15 / cd 0.55 / damage 24 | L5077 |
| 喷火锥 | cost 22 / cd 2.2 / damage 30 | L5148 |
| 击杀回能 | 仅"每 5 连 +18"（`COMBO_CONFIG`），无单杀回能 | L31105 |
| 首领战回能 | 与普通房相同（无加成） | L26902 |
| 首领血量 | F6 起触顶 `hpCap 3200` | L12928 |

**三因子拆解（有限奥能实测 DPS≈15）**

1. 供给：8/s ÷ 双技能满转需求 37.3/s = **21% 施法占用率**（瓶颈）；
2. 效率：每点奥能伤害 1.36–1.60（火球 1.60 / 喷火锥 1.36），属正常区间，不是瓶颈；
3. 命中：bot 提前量 0.4s、AoE 可多目标，实测 ≈0.85–0.95，不是主瓶颈。

→ **结论：瓶颈在"回能供给"，不在单发价格，也不在命中率。**
→ 因此方案 A（供给侧）优先；方案 B（降耗+砍首领血）作为备选，不落地（会同时动"伤害预算"与"血量预算"，无法归因）。

## 1. 第 1 组：奥能经济（方案 A 落地）

### 1.1 改动（全部为配置/单点逻辑，可整体回滚）

| 文件 | 锚点 | 改动 |
|---|---|---|
| `index_arcane_v2.html` | `GAME_CONFIG` L4126 | `baseRegen: 8 → 16` |
| 同上 | `GAME_CONFIG` L4129 附近 | 新增 `killAether: 6`（每击杀回 6 奥能，clamp 到上限） |
| 同上 | `killEnemy()` L31068 | 非首领击杀 +`GAME_CONFIG.killAether`，飘字 `击杀回能 +6` |
| 同上 | `BOSS_CONFIG` L8038 附近 | 新增 `aetherRegenMul: 2.0`（首领登场期间自然回能 ×2） |
| 同上 | `update()` L26902 回能行 | `player.regen * dt * bossRegenMul()`，`bossRegenMul()` 在首领战开启时返回 `BOSS_CONFIG.aetherRegenMul` |
| 同上 | `skillCasting` 若干 | 不动（避免影响 DPS 口径） |

**为什么是 2.0（首领战）**：有限奥能实测 15 DPS @8/s → 线性外推 16/s ≈ 30 DPS；首领战 ×2 ≈ 60 DPS，3200/60 ≈ 53s，落在 45–60s 目标带。

### 1.2 备选方案（记录，不落地）

- **B1 降耗**：collapseHole 32→28、arcanePool 30→26、bolt 30→27、runeOrbit 26→23，DPS 只提升约 12%，仍需再砍首领血，改动面大、收益小。
- **B2 砍首领血**：`hpCap 3200→1800`，会让 F6 首领失去"厚"的手感，且与"不要靠砍血量"的指令冲突。

### 1.3 验证

1. `node tools/arcane_syntax.js` → PASS。
2. `CTRL_ONLY=1 node tools/arcane_balance.js`（有限奥能 + 无敌）→ F5–F10 各 8 次、Boss F6/F10 各 3 次；
   中位清场时间写入 `BALANCE_REPORT.md` §13；Boss 必须脱离"90s 全超时"。
3. 采样脚本内新增经济指标（见 §3），把 `DPS = 回能速率 × 每点奥能伤害 × 命中率` 三项落成数字。

## 2. 第 2 组：F5→F6 数量台阶

### 2.1 现状

- F1–F5 走 `onboardEnemyCount()`：`round(3–4 × pressure(1.32) × 0.8)` → 3–4 只。
- F6 起 `ENEMY_BUDGET_CONFIG.battle=[5,6]` → 直接 5–6 只（×1.57）。
- 每只血量增速：`floorScale(1.10) × pressure.hpStep(0.04)` ≈ ×1.144/层。

### 2.2 改动

| 文件 | 锚点 | 改动 |
|---|---|---|
| `index_arcane_v2.html` | `ENEMY_BUDGET_CONFIG` L6254 | 新增 `rampByFloor`（逐层数量区间 + `hpScale`） |
| 同上 | `enemyBudgetRange()` L6332 | 先查 `rampByFloor[floor]`，命中则用该层区间；未命中回落 `battle/elite` |
| 同上 | `spawnEnemies` L12605 | 预算房 `count` 用 `enemyBudgetRange(room.type, floorNumber)` |
| 同上 | `spawnEnemy()` L12829 | `hpMul` 末尾追加 `× rampHpScale(floor)` |
| 同上 | `GAME_CONFIG.floorScale` L4131 | `1.10 → 1.07` |
| 同上 | `DIFFICULTY_CONFIG.pressure` L4159 | `hpStep 0.04 → 0.02`，`maxMul 1.35 → 1.25` |

**初始 `rampByFloor`（随后按实测校准，允许 ±1 次迭代）**

```js
rampByFloor: {
  6: { battle: [4, 4], elite: [3, 4], hpScale: 0.95 },
  7: { battle: [4, 5], elite: [4, 4], hpScale: 0.87 },
  8: { battle: [5, 5], elite: [4, 5], hpScale: 0.78 },
  9: { battle: [5, 6], elite: [4, 5], hpScale: 0.72 },
  10:{ battle: [5, 6], elite: [4, 5], hpScale: 0.72 }
}
```

**校准规则（用采样证明，不凭感觉）**：以 `balance-control.json` 的 `hpSum` 中位为口径，
相邻层总血量比目标 `1.10 ± 0.02`；超差则只调该层 `hpScale`（乘 `目标比/实测比`），数量区间不动。
清场时长验收：F5→F6 ≤ +10%，F6→F10 每层 +8%～+12%（±2% 容差，样本中位）。

### 2.3 验证

1. 采样脚本新增 `ladder` 断言块（读 `balance-control.json`，逐层比对）。
2. 保留原"第 5–10 层各 ≥8 样本""清场全部完成"等既有断言，不改弱。
3. 截图：F5 / F6 各 1 张（before 用旧值存档图，after 用新值）。

## 3. 采样脚本改动（`tools/arcane_balance.js`）

- `__bal` 新增统计字段：`manaSpent`、`casts`、`castsBlocked`、`damageDone`、`regenAccrued`；
  在 `tick()` 内包裹两次 `castSlot` 调用（记录前后 aether 差、成功/失败），`damageDone` 用 `hpSum` 差值累加。
- `CTRL_ONLY` 输出追加：`回能占用率 = manaSpent/elapsed ÷ 理论满转需求`、`每点奥能伤害 = damageDone/manaSpent`、
  `命中率 = damageDone ÷ (casts × 名义单发伤害 × dmgMul)`。
- 新增 `ladder` 断言（§2.3），失败退出码 1。
- 不让 `SKIP_PREDICT` / `PILOT` 旧分支行为变化。

## 4. 第 3 组：Boss 蓝图装配

按既有 `.spec/boss-assembly/spec.md` 的 B0–B8 施工，新增 `tools/arcane_bossbp.js`（端口 9566）。
与 13 条基础配方零冲突：蓝图配方走独立 `BOSS_FUSION_CONFIG`，`FUSION_CONFIG` 行数必须仍为 13。

## 5. 回滚

- 第 1 组：`baseRegen` 回 8、`killAether` 设 0、`aetherRegenMul` 设 1。
- 第 2 组：`ENEMY_BUDGET_CONFIG.enabled=false`（回到旧数量路径）；或删 `rampByFloor` 并恢复 `floorScale 1.10 / hpStep 0.04 / maxMul 1.35`。
- 第 3 组：`BOSS_BLUEPRINT_CONFIG.enabled=false`。

## 6. 验证清单（三组统一）

- `node tools/arcane_syntax.js`
- 全量回归：verify / m12 / fusion / p1a_ui / facing / enemies / flow3 / feel / abatch / balance / xp / bossbp
- 每组截图 before/after 各 1，同专项 ≤4 张
- 收尾：`node tools/arcane_cleanup.js --apply`（连跑两次归零）、`.testprofile` 归零、`.bak_*.html ≤2`、C 盘可用空间汇报
