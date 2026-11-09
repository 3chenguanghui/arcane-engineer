# M1-2 任务清单（已全部完成并验证）

> 所有任务只改 `index_arcane_v2.html`（T7 除外）。
> 验收命令全部基于 `%TEMP%\arcane_*.js`，工作区根目录不新增脚本。

## T0 备份与基线（完成）
- [x] 生成 `index_arcane_v2.bak_20261103_m12.html`
- [x] 记录基线：`fusion 78/78`、`verify 34/34`、`flow3 38/38`、`p1a_ui 39/39`、`facing 23/23`、fps 120、`__errors` 空
- **产出**：备份文件名 + 基线数据

## T1 配置与状态（完成）
- [x] `MAGIC_CONFIG` 追加 `blade`、`mine`
- [x] `TECH_CONFIG` 追加 `magnet`、`amp`
- [x] 新增 `TACTIC_CONFIG`（blade / mine / magnet / amp / pickup）
- [x] `state` 增加 `mines: []`、`ampCharge: 1`
- [x] `generateFloor` / `clearTransientEffects` / `clearFloorEntities` 清空 mines 与倍率
- **验收**：页面无语法错误；`__roamDebug.getState().ownedMagic` 正常

## T2 回旋刃（完成）
- [x] 新增 `castBlade`（含 `outTime` 字段，修复过一次折返不触发）
- [x] `updateProjectiles` 支持 boomerang（折返 / 清 hitIds / 撞墙折返 / 回原点销毁）
- [x] `drawProjectiles` 画旋转三叶刃
- **验收**：单怪吃两次伤害，专项实测 103 → 67（2×18）PASS

## T3 符文雷（完成）
- [x] 新增 `castMine`（落点逐 20px 取最后可站立点）
- [x] 新增 `updateMines` + `detonateMine`，主循环接入
- [x] 新增 `drawMines`，世界层接入
- **验收**：触发爆 1 次、4s 超时自爆 1 次，两项 PASS

## T4 磁吸 / 增幅（完成）
- [x] `castDevice` 增加 magnet（220px 拉 42% + 减速 1.2s + 青色吸附线 + 飘字）
- [x] `castDevice` 增加 amp（`ampCharge = 2.2`）
- [x] `getMagicDamage` 叠加 amp 被动 +8% 与 ampCharge
- [x] `castPrimary` 分发后复位 `ampCharge`
- [x] `updatePickups` 吸附半径数据化（+90px）
- **验收**：实测 174→99px、slow 1.12；裸伤 24 / 被动 25.92 / 增幅 57.02 / 第三发回到 25.92，全部 PASS

## T5 HUD 6 列与快捷键（完成）
- [x] `renderDeck` 加 `is-dense`
- [x] CSS 新增 `.card-row.is-dense`（6 列紧凑、68px 不增高）
- [x] 760 窄屏规则同步
- [x] `keyToAction` + `handleKeyDown` 扩到 5 / 6
- [x] 文案 1–4 → 1–6
- **验收**：1280 / 1600 / 1920 × 100% / 125% 卡行同 top、无横向溢出、无裁字（12 条断言 PASS）

## T6 专项脚本与回归（完成）
- [x] 写 `%TEMP%\arcane_m12.js`（27 条断言，原计划 12 条，拆细后更多）
- [x] 跑 5 个既有回归脚本：verify 34/34、flow3 38/38、p1a_ui 39/39、facing 23/23、fusion 78/78
- [x] 三视口 × 两缩放 × 7 状态体检，截图 42 张落 `.screenshots\audit_m12\`，issues=0
- **验收**：27/27 × 4 连跑全绿 + 五项全绿 + issues=0 + fps 120 + `__errors` 空
- [x] 边界矩阵实测：无目标 / 落点在墙内 / 满栏 / 暂停开面板 / 切后台 / 1280×720 / 1920×1080 / 125%（结果见 spec.md §8）

## T7 清单收敛（完成）
- [x] `奥术工程师_完整范围与验收清单.md` L38「魔法 / 科技 4 → 6」→ `[x]`，附证据
- [x] 全文再无 `[~]`（自检通过）
- **验收**：清单状态与本轮实际一致

## 完成条件
1. T1–T7 全部勾选；
2. 12 条专项 + 5 项回归 + 体检全绿；
3. 用户收到一份单独体检结果；
4. 进入 M1-3（被动三选一 + 稀有度三档 + 5 层保底）。
