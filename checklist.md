# B · 手感重置 + A 段收尾 验收清单（v1.5.0）

> 逐条按证据核对；证据文件在 `.screenshots/balance/ladder_last.log`、`.screenshots/feel/feel_probe.json`、`.screenshots/reg/*.log`、`dist/emberfall_v1.5.0/`。

## 一、数量与血量（B-A）
- [x] 普通战斗房敌数在 F1 ≥4、F6 ≥7、F10 ≥8（`ENEMY_BUDGET_CONFIG.rampByFloor`）
  - 证据：ladder 各层"敌数均值" 4 / 7 / 8
- [x] 单怪血量落在 116–340（F1 117、F10 ≈150、F20 ≈321）
  - 证据：feel 探针 `hpAvg` F1=117、F10=141；ladder 总血/敌数换算
- [x] `minFloor` 已降为 1，F1–F5 战斗/精英房不再走兜底表
- [x] 同房血量归一（`uniformHp=true`）只作用于普通战斗房，精英房不归一
- [x] 20 层总血曲线单调不倒退（N1 PASS，无任何一层低于前一层）
- [x] 相邻层增幅 ≤15%（N2 PASS，实测最大 13.5%）
- [x] 同区相邻层 1.05–1.15（N7 PASS）
- [x] F5→F6 增幅 ≤10% 且不倒挂（L1 PASS，+8.7%）
- [x] F6→F10 每层 8%–12%（L2 PASS：+11.7 / +9.4 / +9.8 / +10.1）
- [x] F5→F10 整体 ≥1.35x（L4 PASS，1.60x）
- [x] F1→F6 1.70–1.90x（N9a PASS，1.78x）；F7→F12 / F13→F18 区段倍率 PASS
- [x] 多轮稳定性（F6–F10、F11–F20 各 8 轮，L5/N5 PASS）
- [x] `arcane_ladder` 全绿：36/36 PASS

## 二、手感数字（B-D）
- [x] 真实房清房 ≤8s：F1 4.23s / F6 3.97s / F10 4.73s（B-1、B-1b PASS）
- [x] 每只 2–3 下（46 伤害范围技）：F1 2.54 / F6 2.15 / F10 3.07（B-3 PASS）
- [ ] 单次技能 ≥3 杀占比 ≥60%：**未达成**（F1 33%、F6 44%，B-2 FAIL，已登记不删弱）
  - 已达成部分：单帧最多杀 3（F1/F6 均为 3）；"一发带走 2–3 只"的用户口径成立
- [x] 单怪血量下降幅度（F1 ≥50%、F10 ≥25%）（B-4 PASS：259→117、245→141）
- [x] 怪数上升（F1 ≥1.5x、深层 ≥1.3x）（B-4b PASS：2→4、6→8）
- [x] 最长空档 ≤3.0s（B-6 PASS：1.85 / 2.03 / 1.1）
- [x] 同帧只爆一次（B-7 PASS）
- [x] 改前/改后同场景对照表已产出（before 运行时还原旧表）

## 三、真实债 `dirAngle`（B-B）
- [x] 5 处全向演出 burst 均带 `skipTrack=true`（连杀阈值环 / 终结脉冲 / 处决 / 感电 / 首领破甲）
- [x] `arcane_verify` 锥角断言转绿（50/50 PASS）
- [x] 未修改粒子飞散逻辑、未改弱断言

## 四、A 段剩余减法（B-C）
- [x] `POSTFX_CONFIG` 四值降档已生效（.22 / 1.2+.30 / .03 / .22）
- [x] `PARALLAX_CONFIG` 三层与 apron 降档（.26/.26/.24、.26）
- [x] `SCENE_READ_CONFIG` 砖缝 .35 / 网格 .45
- [x] `drawComboEdge()` 连杀 <2 直接 return
- [x] 未探索文字默认关（`UNEXPLORED_HINT_CONFIG.enabled=false`）

## 五、回归与发布（B-E）
- [x] `arcane_syntax` PASS
- [x] `arcane_verify` 50/50 PASS
- [x] `arcane_fusion` 96/96 PASS
- [x] `arcane_weapons` 20/20 PASS（含修复后的 X-B1 隐藏行断言）
- [x] `arcane_package` 9/9 PASS
- [x] `GAME_CONFIG.version` = 1.5.0，`#aboutVersion` = 1.5.0
- [x] 署名「陈光辉 制作」保留
- [x] `dist/emberfall_v1.5.0/` 3 个文件、2.47MB，更新说明已含本版手感改动
- [x] C 阶段（砍层数 / 砍卡 / 砍天赋）未执行
