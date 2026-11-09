# 任务清单 · 审查整改（specs/review-fixes-20261108）

> 顺序：先改补丁文档 → 再拿主文件副本验证 → 最后改旧脚本（单独提交）。
> 每项完成必须给出「文件 + 函数 + 实测数字」，不接受"应该可以"。

## T1 归因补丁 v2（去假分类）
- [x] T1-1 `P1_CATEGORY_META` 删 `ground`；`melee→近战`、`env→环境/陷阱`
- [x] T1-2 `p1CategoryOf` 改 `hazard→env`，删 `collapse` 分支，注释写清防御性映射
- [x] T1-3 `p1LedgerReset` 增 `maxHit/maxByCat/sourceByCat/floors/bossContactDmg/bossContactHits`
- [x] T1-4 `p1NoteIncoming` 写上述字段；`boss+contact` 走子计数
- [x] T1-5 `p1IncomingList` 返回 maxHit/topName/层占比；boss 项附 contact
- [x] T1-6 `p1DeathVerdict` 删 ground 分支；boss rule 追加「其中贴身接触 X 点（Y%）」
- [x] T1-7 `buildShareBarHtml` 图例补「最大 X 点 · 主凶 名字」与贴身子句
- [x] T1-8 `p1SummaryText` + `buildReviewHtml` 插入 summary/spike
- [x] T1-9 `__roamDebug.p1` 补 `summary/detail/spike/categories`

## T2 教学补丁 v2（基线快照 + showFloor 顺序）
- [x] T2-1 `ONBOARD_STEPS` 改事件表，删 `floor`，加 `n`
- [x] T2-2 `onboardBeginRun(opts)` 写 `state.onboardBaseline`
- [x] T2-3 `onboardReturningPlayer()` 只读 baseline（无基线=拒绝）
- [x] T2-4 `onboardSkipAll()` 优先读 baseline
- [x] T2-5 `showFloor()` 先取 `bestBefore`、置基线、再 `generateFloor`、再 `onboardBeginRun({bestFloor})`
- [x] T2-6 三个显示读者（帮助速查 / 回顾 / 调试 info）改 `step.n` + `data-quickref-step`
- [x] T2-7 `onboardEvent` 入口、弹窗内提示、3 秒/跳过/队列
- [x] T2-8 `ONBOARD_PATCH.md` 更新为 20 块（0–19），块 19 为 showFloor 顺序

## T3 主文件副本自检
- [x] T3-1 复制主文件到 `.reviewfix/index_patched.html`，逐块应用两份补丁
- [x] T3-2 `arcane_syntax` 通过
- [x] T3-3 教学：5 事件顺序/各一次/≤12 字/3 秒淡出/Esc 跳过；第二局 0 次
- [x] T3-4 教学：新号 `showFloor(5)` 不播种（③ 回归）
- [x] T3-5 归因：无 `ground` 键；`hazard→env`；近战/环境/首领三场景占比 100
- [x] T3-6 归因：首领贴身子计数与「含贴身」标签正确；骤升标记命中
- [x] T3-7 实测数字写入 `REVIEW_FIX_REPORT.md`

## T4 旧脚本整改（单独提交）
- [x] T4-1 `arcane_onboard.js` 五层→五事件；`step.floor→step.n`
- [x] T4-2 `arcane_playthrough.js` P4/P4b 改事件断言
- [x] T4-3 `arcane_help.js` `quickref-floor→quickref-step`（并支持 argv[2] 指向副本）
- [x] T4-4 登记 `_ac_new_arcane_help.js` 不存在；登记 `floor1CountCap` 既存红
- [x] T4-5 逐处「改前/改后/理由」表写入报告

## T5 交付
- [x] T5-1 `REVIEW_FIX_REPORT.md`：6 条整改 + 位置 + 实测 + 未解风险
- [x] T5-2 回报：补丁块号、可回退说明、复跑命令
- [x] T5-3 删除时间戳副本 `.reviewfix/index_patched.html`

## T6 已知红门禁（三条纪律）
- [x] T6-1 新建 `tools/known_red.json`（schema/baseline/approved/entries，初始为空）
- [x] T6-2 `test_known_red.js` 四要素校验：缺一即 FAIL，孤儿条目同按 FAIL
- [x] T6-3 未批准新增：打印 `KNOWN-RED ADDED: <名>` + 退出码 2；`--allow-known-red-add` 才写 approved
- [x] T6-4 固定打印「已知红 N 条（上轮 M 条）」；N>M 打 ▲ 新增；门禁拦下不回写 baseline
- [x] T6-5 `arcane_onboard.js` / `arcane_playthrough.js` / `arcane_help.js` 收尾统一用 `s.exitCode`
- [x] T6-6 自检证据（临时脚本已删）：exitCode 2 / 缺字段 FAIL / 批准后 approved+baseline 落盘

## T7 death_parity 扩样本
- [x] T7-1 每格 50 局、5 层 × 3 组成 = 750 局/页
- [x] T7-2 场景表在 Node 生成（HP 20–239、敌人 2–4 只、站位逐局变化），两页注入同一张表
- [x] T7-3 固定种子接管 `Math.random`，消除两页房间几何差异
- [x] T7-4 逐局比对死亡/死因；750/750 一致、差异 0；任何 1 例差异即 FAIL

## 验收口径
- 主文件未被修改（大小 / mtime / SHA256 三证）。
- 自检只在 `.reviewfix/index_patched.html` 上跑；预览页结果不作为证据。
- 任何一条断言失败：如实登记，不调低阈值。
