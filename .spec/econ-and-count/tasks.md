# 任务清单（econ-and-count + boss-assembly）

## 第 1 组 · 奥能经济
- [x] T1.1 `GAME_CONFIG.baseRegen 8 → 16`；新增 `killAether: 6`
- [x] T1.2 `BOSS_CONFIG.aetherRegenMul: 2.0`
- [x] T1.3 `update()` 回能行乘首领战倍率（新函数 `bossAetherRegenMul()`）
- [x] T1.4 `killEnemy()` 非首领击杀回能 + 飘字
- [x] T1.5 `arcane_balance.js` `__bal` 经济指标（manaSpent/casts/castsBlocked/damageDone）
- [x] T1.6 `CTRL_ONLY=1` 采样 + 输出三因子指标
- [x] T1.7 `BALANCE_REPORT.md` §13 数据表（F3–F10 + Boss）
- [x] T1.8 `arcane_syntax.js` + 回归不红

## 第 2 组 · 数量台阶
- [x] T2.1 `ENEMY_BUDGET_CONFIG.rampByFloor` 初始值
- [x] T2.2 `enemyBudgetRange(type, floor)` 支持逐层区间
- [x] T2.3 `spawnEnemies` 消费逐层区间；`spawnEnemy` 应用 `hpScale`
- [x] T2.4 `floorScale 1.07`、`pressure.hpStep 0.02`、`maxMul 1.25`
- [x] T2.5 采样 + 校准 `hpScale`（相邻层总血 1.08–1.12）
- [x] T2.6 `ladder` 断言：F5→F6 ≤10%、F6→F10 8–12%（`tools/arcane_ladder.js` 14/14）
- [x] T2.7 `BALANCE_REPORT.md` §14 曲线表

## 第 3 组 · Boss 蓝图
- [x] T3.1 `BOSS_BLUEPRINT_CONFIG` + state/meta 字段
- [x] T3.2 宝箱掉落 + 去重
- [x] T3.3 `tryFuse` 第二段蓝图判定 + 材料消耗
- [x] T3.4 帮助页签蓝图表 + 宝箱提示文案
- [x] T3.5 `drawBlueprintTelegraph` 复用首领几何
- [x] T3.6 `tools/arcane_bossbp.js` B0–B8 全绿（43/43）
- [x] T3.7 截图 before/after

## 收尾
- [x] C1 清理脚本 ×2 归零
- [x] C2 `.bak_*.html ≤2`
- [x] C3 C 盘空间汇报
- [x] C4 PROGRESS 顶部逐组条目 + 末尾"下一步"
