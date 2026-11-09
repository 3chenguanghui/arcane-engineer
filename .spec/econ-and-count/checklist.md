# 验收清单（econ-and-count + boss-assembly）

## 第 1 组 · 奥能经济
- [x] `GAME_CONFIG.baseRegen = 16`、`killAether = 6`、`BOSS_CONFIG.aetherRegenMul = 2.0` 已落地
- [x] `update()` 回能真实乘上首领战倍率（`bossAetherRegenMul()`），非首领击杀回能 + 飘字
- [x] `CTRL_ONLY=1` 采样输出三因子（回能速率 / 每次施法伤害 / 空放率）+ F3–F10 + Boss
- [x] `BALANCE_REPORT.md` §13 数据表已回填，且 F1–F5 爽感未被削弱（清场时长未变差）
- [x] 关闭无限奥能对照组仍在报告里，数值可复现

## 第 2 组 · 数量台阶
- [x] `rampByFloor` 数量档位 5→5→5–6→6→6，`minFloor` 未改
- [x] `tools/arcane_ladder.js` 14/14 PASS（含 F5→F6 ≤10%、F6→F10 8–12%）
- [x] 阶梯断言使用多轮均值，且旧断言没有被放宽
- [x] `BALANCE_REPORT.md` §14 曲线表已写入
- [x] before/after 截图 ≤4 张

## 第 3 组 · Boss 蓝图
- [x] 击败 Boss 掉落蓝图（`oncePerKindPerRun`，重复击败不重复发）
- [x] 蓝图可参与融合（第 14 条路径，13 条老配方不变）
- [x] 融合后技能实战生效（伤害/半径/预警可观测）
- [x] 帮助页签 + 宝箱奖励界面有发现性与用法说明
- [x] `tools/arcane_bossbp.js` 43/43 PASS

## 收尾
- [x] `.testprofile` 计数归零、`.bak_*.html ≤2`
- [x] C 盘可用空间已核实并解释波动
