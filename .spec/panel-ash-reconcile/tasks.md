# 面板对账（剩余 4 条）+ 尺子核验 · 任务清单

> 规则：每批做完立刻汇报，不攒着。
> 主文件冻结指纹：2,976,311 B / MD5 `22CA9F5B47113204147A04A319CC25E4` / 69,168 行（按 `\n` 计）。
> 动主文件前必核；不一致 → 停止上报。

## 准备

- [ ] T0 复核主文件字节 / MD5 / 行数（必须完全一致）
- [ ] T1 备份主文件 → `backup/index-pre-panel4.html`，记录备份字节 / MD5
- [ ] T2 定位 #5 在上一轮对账清单里的原描述；找不到则按 spec §1#5 的「非伤害卡口径」执行并在汇报中标注

## 批次一（做完立即汇报）

- [ ] T3 #1 新增 `ashCardDamageNow()` + `ashFormatDamage()`（函数级注释）
- [ ] T4 #1 `ashRenderList()` 的 `伤害` 改为现算（L42907）
- [ ] T5 #3 `房间类型与经济循环.md` L14 改为「约 2.84 MiB + 每版 MD5」
- [ ] T6 #4 `index_arcane_v2.html` L6803 静态文案改为 `成就 — / —`
- [ ] T7 #5 `codexSourceEntries('cards')` 抽 `codexCardDamageText()`；非伤害卡整段不显示（按用户裁定）
- [ ] T8 语法检查（抽 `<script>` 解析，0 error）
- [ ] T9 运行验证：#1 2 层 = 26.9；#4 首帧 = `成就 — / —`、打开后 = `成就 N / 38`；#5 治疗符不出现 `伤害 0`
- [ ] T10 记录并汇报：新字节 / 新 MD5 / 新行数 / 改动行号

## 批次二（先交影响表，再做核验）

- [ ] T11 核验 `tools/sim_panel/sim.js` 无 `value: 0.10`（现状已确认：`damageCardValue` 在 L1115）
- [ ] T12 核验 `_sim_aligned.js:668` 与 `s_visibility.js:235` 不属于现行跑分口径
- [ ] T13 落影响表到具体文件 / 行号（QUESTIONS、BALANCE_REPORT、patches/杠杆表、批次叠加矩阵、七天分配单、CONTENT_AUDIT）
- [ ] T14 受影响表格加「坏秤时代，不可比」标注（只加标注，不改历史数字）
- [ ] T15 写清新口径与新基线（36.0/29.3；保守 36.3/29.2；焚稿后 36.4/27.7）
- [ ] T16 跑 `node tools/_ash_drift_check.js`（11 字段一致）
- [ ] T17 跑 `node tools/s_visibility.js` 与基线对比
- [ ] T18 跑 `node tools/stack_matrix.js` 与基线对比
- [ ] T19 汇报影响表 + 新口径 + 新基线 + 三份检查结果

## 交付口径（每条都要带）

- n / 难度档 / 档案 / 种子 / 层数 / 统计窗口
- 文件字节 / MD5 / 行数
- 改前 → 改后的具体读数
