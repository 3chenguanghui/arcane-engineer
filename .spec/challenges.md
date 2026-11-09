# 挑战等级 1–10（第 14 项 · 实现规格）

> 状态：规格定稿，写完即开工（用户已授权自决，不再请求批准）
> 目标文件：`index_arcane_v2.html`（单文件、零依赖）
> 前置：第 11 项天赋 v2（进阶 −8%/级 对冲）、第 13 项三大区 + 深度模式

## 一句话

把原来 0–4 的“进阶难度”升级为 **0–10 的挑战等级**，与三档难度（简单 / 普通 / 困难）并存：
三档难度负责“整体基线”，挑战等级负责“逐条叠加规则”。每一级只有一条可读规则，
可随时回退到 0，结算页与档案都会记录本局挑战等级与通关次数。

## 十级规则（单一配置 `ASCENSION_CONFIG`，UI 文案由配置生成）

| 级 | 名称 | 规则（玩家可读） | 运行时落点 |
|---|---|---|---|
| 1 | 敌潮 | 每间战斗 / 精英房额外 +1 名敌人 | `generateFloor` 刷怪数量 |
| 2 | 精英强化 | 精英额外携带 1 条不重复词缀 | `spawnEnemy` affix2 |
| 3 | 代价加重 | 取舍房代价 ×1.5（献祭 / 赌注 −8% / 诅咒更痛） | `ascensionCostMul` 等 |
| 4 | 首领三阶段 | 首领 30% 血进入第三阶段（更快更重） | `enterBossPhase3` |
| 5 | 疾行 | 敌人移动速度 +10% | `spawnEnemy` speed |
| 6 | 硬化 | 敌人受到的伤害 −12% | `damageEnemy` 最终伤害 |
| 7 | 壁垒 | 精英自带 15% 最大生命的护盾 | `spawnEnemy` shieldHp |
| 8 | 高压 | 敌人接触伤害 +12% | `spawnEnemy` damage |
| 9 | 围猎 | 精英房间额外 +1 名敌人（与敌潮叠加） | `generateFloor` 刷怪数量 |
| 10 | 终局 | 首领最大生命 +25% | `spawnBoss` hpMax |

## 关键决策（自裁决）

1. **不新建第二套系统**：沿用 `ASCENSION_CONFIG` / `meta.ascension` / `meta.ascensionUnlocked`
   三处真源，只把 `maxLevel` 4→10 并补 6 条规则。这样旧存档、旧断言（`arcane_p2` 1–4 级）、
   天赋对冲文案全部无需迁移；另一条路“新建 CHALLENGE_CONFIG 再同步两份状态”会产生双真源，
   一旦读写顺序错位就会出现“界面显示 7、实际生效 3”，因此不选。
2. **解锁曲线**：沿用“首次通关解锁 1，之后每通关一次 +1，封顶 10”；
   等级只能选 ≤ 已解锁值，未解锁时点击被夹回 0（与旧行为一致）。
3. **效果全部运行时读**：`challengeLevel()` 每次现算，不把倍率写死进敌人；
   回退到 0 后，新生成的层立即恢复原值（已在场敌人不回改，避免半血实体属性跳变）。
4. **关闭开关**：`ASCENSION_CONFIG.enabled=false` → `ascensionLevel()` 恒 0，
   十级效果全部短路，标题行隐藏（与第 2 项 P2 的开关口径一致）。
5. **档案留档**：`META_SCHEMA_VERSION` 8→9，新增 `meta.challengeCleared`
   （键 = 等级，值 = 该等级通关次数）。只增不减，规范化时夹紧到 0–10 与上限 999。
6. **结算页**：沿用 `buildLongrunResultStatsHtml()`，把标签从“进阶”改为“挑战等级”，
   内容为 `N 级 · 规则短句`，0 级时不显示（与旧行为视觉一致）。
7. **全区域可用**：挑战等级与三档难度都只依赖 `state`，不读大区；
   断言在 F1 / F8 / F15 / F20 / F25 各取一次，证明同一条规则在机械 / 符文 / 虚空 / 深度都生效。

## 改动清单（精确到函数）

- `ASCENSION_CONFIG`：`maxLevel: 10` + 6 条新规则 + `displayName: '挑战等级'`。
- 新增：`challengeLevel()`（= `ascensionLevel()`）、`challengeSpeedMul()`、`challengeTakenMul()`、
  `challengeEliteShieldRatio()`、`challengeDamageMul()`、`challengeEliteExtraCount()`、
  `challengeBossHpMul()`、`challengeRecordClear(level)`。
- `spawnEnemy`：speed / damage / shieldHp 三处乘挑战倍率；
- `spawnBoss`：hp / hpMax 乘 `challengeBossHpMul()`；
- `damageEnemy`：最终伤害乘 `challengeTakenMul()`；
- `generateFloor`：敌潮之后追加“围猎”对精英房 +1；
- `winGame`：调用 `challengeRecordClear()` 写档案；
- `defaultMeta / normalizeMeta / migrateMeta`：`challengeCleared` 容器与 v8→v9 迁移；
- `renderAscensionModes()`：标题按钮 `关 / 挑战 1…10` + 自动换行；
- `buildLongrunResultStatsHtml()`：标签与文案；
- `window.__roamDebug.challengeLv`：info / set / unlock / metrics / damageProbe / recordClear /
  resultHtml / setEnabled（断言脚本只读真源，不复制逻辑）。

## 验收（新建 `tools/arcane_challengelevels.js`，串行运行）

1. 配置：10 级、每级 rule/short 非空、1–4 级 id 与旧进阶一致、maxLevel=10。
2. 未解锁夹紧 / 解锁到 10 / 回退 0 且持久化、rule 清空。
3. 1–4 级旧规则不回归（敌数 +1 / 精英双词缀 / 代价 ×1.5 / 首领三阶段）。
4. 5–10 级逐级生效：速度 ×1.10、承伤 ×0.88、精英盾 +15%、接触伤害 ×1.12、
   精英房 +1 只、首领血 ×1.25（同一 seed、同一层，只改等级，比值落在容差内）。
5. 全区域可用：F1/F8/F15/F20/F25 上普通 vs 困难总血比 > 1.1，且挑战 10 与挑战 0
   在以上每层都产生差异（不出现“某大区没有难度”）。
6. 存档：局内快照含挑战等级 7，读回 `ascension=7`；meta 写回一致。
7. 结算：`resultHtml()` 含“挑战等级 / 7 级”；`challengeCleared['7']` 通关后 +1 并持久化。
8. 开关：`ASCENSION_CONFIG.enabled=false` 时等级恒 0、指标等于基线、标题行隐藏。
9. 帧率 ≥60、脚本错误 0、截图 `challengelevels.png` > 10KB。

回归：`arcane_syntax / arcane_p2 / arcane_ladder / arcane_regions / arcane_challenge`
（全部串行，避免共享 `.testprofile` 被并发清空）。

## 回滚

`ASCENSION_CONFIG.enabled=false` 或把 `maxLevel` 改回 4、levels 截断到前 4 条，
即回到 v1.0.3 的进阶行为；代码分支不删除，旧存档字段不变。
