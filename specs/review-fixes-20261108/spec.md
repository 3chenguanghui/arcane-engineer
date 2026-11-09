# 审查整改 · 教学事件化 + 死亡归因去假分类（v2 补丁）

> 本规格只处理审查提出的 6 条。交付物仍是「可粘贴补丁 + 主文件副本自检」，**不改主文件**。
> 主文件：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`（约 62,936 行，行号会漂移，全部按函数名/唯一代码片段定位）。

## 0 · 结论先行

| # | 审查意见 | 规格决定 |
|---|---|---|
| ① | `ground` 类恒为 0 | **删除 `ground`**；`hazard` 归回 `env`；同时删除同样无生产者的 `collapse` 分支。不保留任何恒 0 分类。 |
| ② | 老玩家判定读 live `bestFloor` | 在 `onboardBeginRun` 里取**开局快照** `state.onboardBaseline = {runs, bestFloor}`，`onboardReturningPlayer()` / `onboardSkipAll()` 只读快照。 |
| ③ | `showFloor()` 先抬 `bestFloor` 再 `onboardBeginRun()` | `showFloor()` 先取数值 `bestBefore`，再生成楼层；`onboardBeginRun({ bestFloor: bestBefore })` 显式传入基线。 |
| ④ | 首领含贴身，必须拆子计数 | 新增 `bossContactDmg/Hits`；标签 `被首领（含贴身）`；判决句追加「其中贴身接触 X 点（Y%）」。Y 口径 = 占总承伤。 |
| ⑤ | 4 个旧断言脚本要改，单独提交 | 只改依赖「五层动画」的断言；改前/改后/理由逐条写进报告；不混进补丁。 |
| ⑥ | `step.floor` 别名不是可选 | 直接删 `floor`，以 `n` 为唯一序号；同步改 3 个主文件读者（帮助速查 / 设置回顾 / 调试 info）与全部脚本。 |

## 1 · 六分类真实来源审计（先审计，后改码）

审计对象：`p1CategoryOf` 的每一个返回值。证据来自主文件 `damagePlayer(...)` 全部 10 处真实调用。

| 分类 | 真实产生者（函数） | 现场 kind | 是否可达 | 结论 |
|---|---|---|---|---|
| `boss` | `resolveBossTelegraph`（落锤/奇点/引力井，约 22499）<br>`updateBossEnemy` 贴身（约 22738）<br>`updateBossHazards` 残留危险区（约 22866） | `hazard` / `contact` | 可达 | 保留；`bossKind` 恒非空，第一条判定正确 |
| `melee` | `updateEnemies` 接触（约 42445）<br>`resolveEnemyAction` 冲锋（约 41690）<br>`resolveEnemyAction` 濒死自爆（约 41605） | `contact` / `charge` / `selfdestruct` | 可达 | 保留 |
| `ranged` | `updateBullets`（约 42837，`srcKind` 全文只有 `'bullet'`）<br>`resolveEnemyAction` 蓄力爆发（约 41557） | `bullet` / `burst` | 可达 | 保留 |
| `env` | `updateSigils` 符阵爆炸（约 42158） | `sigil` | 可达 | 保留；`hazard` 仅在带 `bossKind` 时出现，会被 `boss` 先截走，故 `hazard→env` 是**防御性映射**，不是可测路径 |
| `self` | `explodeBarrel` 伤己（约 50574） | `barrel` | 可达 | 保留 |
| `other` | 调试口 `damagePlayer`（约 57187 / 60122）与未标 kind 的兜底 | 任意 | 仅调试 | 保留为兜底，不参与死因断言 |

**无生产者、必须删掉的分支**：
- `ground`（v1 补丁新增）——全文无任何非首领 `hazard`，删。
- `collapse`（主文件原有）——`collapse` 只是**玩家技能区**类型 `zone.type`，从不进 `damagePlayer`，删。

> 明确回答审查的问题：**主文件里不存在「落地伤害」这一真实来源**。首领落锤/引力井是首领技能，已经归 `boss`；普通墙体坍塌伤害不存在。因此不接、不造、不保留。

## 2 · 逐块改动（按函数定位）

### 2.1 教学补丁（`ONBOARD_PATCH.md` v2）

| 块 | 位置 | 改什么 | 回退方式 |
|---|---|---|---|
| 0 | `<style>` 内 `.onboard-hint` | `top:64px; right:18px`；新增 `.ob-modal-line` | 删这两条规则 |
| 1 | `ONBOARD_CONFIG` | 加 `hintLifeSec:3.0`、`skipKeys:['Escape','Space',' ']`、`seedOnRuns:2`；`maxFloors` 仅用于难度，不再用于提示 | 删 3 个键 |
| 2 | `ONBOARD_STEPS` | 换成 5 个事件：`firstRoom/firstChoice/firstElite/lowHp/firstCrystal`，字段 `{key,n,hint,delay}`，**删 `floor`** | 整表还原 |
| 3 | `onboardState` | 加 `ev/evOrder/queue/pending/gap/modalHint` | 删字段 |
| 4 | 新增 `onboardSeedSeen` / `onboardReturningPlayer` | 老玩家判定**只读** `state.onboardBaseline`；无基线返回 true（拒绝弹） | 删两函数 |
| 5 | `onboardShowHint` + 新增 `onboardRenderHint` | 真正渲染才写 seen；弹窗内走 `modalHint`；占屏则入队 | 还原 `onboardShowHint` |
| 6 | `onboardHideHint` | 收起后 `st.gap = 0.5` | 删一行 |
| 7 | `onboardMark` | 去掉 `onboardActiveFloor` 楼层门槛 | 还原一行 |
| 8 | `onboardTick` | 删「按楼层弹提示」第 5 段；加 3 秒计时/队列/pending/gap | 整段还原 |
| 9 | 新增 `onboardEvent(key, forceModal)` | 唯一入口；非 playing/reward 不弹；非首局直接 false；`delay>0` 走 pending | 删函数 |
| 10 | `onboardOnRoomEnter` | 发 `firstRoom`（出生房→非 start 房）/ `firstElite`（`room.type==='elite'` 或 `enemy.elite`） | 还原函数 |
| 11 | `onboardBeginRun(opts)` | 重置事件状态；**写基线快照** `{runs: meta.runs, bestFloor: 显式参数 ?? meta.bestFloor}`；`onboardSkipAll` 用基线；老玩家播种 5 键 | 还原函数 |
| 12 | `openReward` | `stage==='skill'` 时 `onboardEvent('firstChoice', true)` | 删一行 |
| 13 | `grantRunCrystals` | `if (!base) return 0;` 后 `onboardEvent('firstCrystal')` | 删一行 |
| 14 | `damagePlayer` | `state.fx.lowHpFired = true;` 后 `onboardEvent('lowHp')` | 删一行 |
| 15 | `buildRewardModalHtml` | 在 `const kicker = isPassive` 前生成 `obLine`，返回串追加 | 删 `obLine` 与拼接 |
| 16 | `handleKeyDown` | `if (!state) return;` 后按 `skipKeys` 跳过当前提示 | 删该段 |
| 17 | `__roamDebug.onboard` | 加 `event(key, forceModal)` / `modalLine()`；`info()` 加 ev/evOrder/queue/modalHint/hintT/baseline/returning | 删新增字段与方法 |
| 18 | 帮助速查 24506、设置回顾 `renderOnboardReview` 46326、调试 info 57975 | `data-quickref-floor` → `data-quickref-step`；`第 N 层` → `事件 N`；`step.floor` → `step.n` | 逐处还原 |
| 19 | `__roamDebug.floor.showFloor` | **顺序修复**：先 `bestBefore = meta.bestFloor`，置基线，`generateFloor`，`onboardBeginRun({bestFloor: bestBefore})` | 还原函数 |

**语义约束**：提示文案 ≤12 字；3 秒淡出；不暂停；Esc/空格跳过；第一局每事件恰一次；第二局 0 次。

### 2.2 死亡归因补丁（`DEATH_REVIEW_PATCH.md` v2）

| 块 | 位置 | 改什么 | 回退方式 |
|---|---|---|---|
| 0 | CSS | `.p1-summary / .p1-spike / .p1-boss-contact` | 删规则 |
| 1 | `P1_CATEGORY_META` / `P1_VERDICT_LABEL` | **删 `ground`**；`melee→近战`、`env→环境/陷阱`、`boss→被首领（含贴身）`；新增 `P1_SPIKE_RULE` | 还原表 |
| 2 | `p1LedgerReset` | 新增 `maxHit/sourceByCat/floors/bossContactDmg/bossContactHits`；`zero` 只含 5 类 + other | 还原 |
| 3 | `p1CategoryOf` | **`hazard→env`**；删 `collapse`；注释写清「hazard 无 bossKind 时只可能是未来新增来源」 | 还原 |
| 4 | `p1NoteIncoming` | 写 `maxHit`、`sourceByCat`、`floors[state.floor]`；`cat==='boss' && cause.kind==='contact'` 时累加 `bossContactDmg/Hits` | 还原 |
| 5 | `p1IncomingList` | 返回 `maxHit/topName/topDmg/deathFloorDmg/deathFloorPct`；boss 项附 `contact:{dmg,hits,pct}` | 还原 |
| 6 | 新增 `p1SpikeFor` | 死亡层占比 ≥ 全局 ×2 且 ≥25%，层伤害 ≥12 | 删函数 |
| 7 | `p1DeathVerdict` | **删 `ground >= 0.45` 分支**；boss 分支 rule 追加贴身子句；标签同步 | 还原函数 |
| 8 | `buildShareBarHtml` | `in` 图例追加「最大 X 点 · 主凶 名字」；boss 追加「贴身 X 点（Y%）」 | 还原函数 |
| 9 | 新增 `p1SummaryText` + 重写 `buildReviewHtml` | 结论前插 `.p1-summary`；承伤图例后插 `.p1-spike`；不改三层结构 | 删函数 + 还原 |
| 10 | `__roamDebug.p1` | 加 `summary()/detail()/spike()/categories()` | 删新增方法 |

**口径**：分类百分比合计恒 100（最大余数法）；「贴身 Y%」分母是**总承伤**；总结句必须含「第 N 层」与「其中一次 X 点」。

## 3 · 验证（只在主文件副本上算数）

1. 复制主文件 → `D:\其他\TRAE宝\奥术工程师\.reviewfix\index_patched.html`（不触碰主文件）。
2. 用脚本把 `ONBOARD_PATCH.md` + `DEATH_REVIEW_PATCH.md` 的最终块**逐块替换**进副本；每块失败即中止并报错（保证补丁可机械复现）。
3. `node tools\arcane_syntax.js .reviewfix\index_patched.html` 通过。
4. 教学自检（真实主文件副本，非预览页）：
   - 新号（bestFloor=0，runs 快照=1）依次触发 5 事件，断言顺序、各 1 次、文案 ≤12 字；
   - 第二局（runs=2）5 事件全 false；
   - `showFloor(5)` 在新号上仍 `skipAll=false` 且能触发 `firstCrystal`（验证 ③）；
   - 提示 3 秒后 `hintVisible=false`；Esc 立即收起（验证 16）。
5. 归因自检（真实 `damagePlayer` 路径，不手造 ground）：
   - `p1CategoryOf({kind:'hazard'})==='env'`，`P1_CATEGORY_META` 无 `ground`；
   - 近战死：多只 `contact` → 近战占比、最大单次、主凶名正确，合计 100；
   - 环境死：`sigil` → 环境占比正确；
   - 首领死：真实首领贴身 + `hazard`（带 bossKind）→ 全部计入 boss，判决句出现「其中贴身接触 X 点（Y%）」，标签为「被首领（含贴身）」；
   - 死亡层骤升：`p1SpikeFor` 返回预期；
   - 结算 HTML 含 `data-p1-summary` / `data-p1-max` / `data-p1-spike`。

## 4 · 旧脚本整改（单独提交，不混补丁）

| 脚本 | 改前断言 | 改后断言 | 理由 |
|---|---|---|---|
| `tools/arcane_onboard.js` | 5 个楼层键 `moveAttack/fusion/techDash/route/meta`；`showFloor(f)` 必弹提示 | 5 个事件键 `firstRoom/firstChoice/firstElite/lowHp/firstCrystal`；`event(key)` 触发、`evOrder` 恰 5 条 | 语义升级：触发点跟玩家遭遇走，不再跟楼层走 |
| 同上 | `info.steps[i].floor` | `info.steps[i].n` | 删 `floor` 后唯一序号是 `n`（⑥） |
| `tools/arcane_playthrough.js` | 循环 F1–F5 断言每层提示 | 一次性触发 5 事件并断言各 1 次 | 同上 |
| `tools/arcane_help.js` | `[data-quickref-floor]` 取 5 行 | `[data-quickref-step]` 取 5 行，文案「事件 N」 | ⑥ 的 DOM 语义修正 |
| `_ac_new_arcane_help.js` | 审查提到的文件 | **项目内不存在**（只有 `_ac_new_help2.log` 等旧日志） | 如实登记，不虚构改动 |

**不改的旧断言**：`第 1 层敌人数锁 2 只` 与当前主文件 `floor1CountCap:3` 冲突，属**改动前就存在的漂移**，不借整改顺手改数字；在报告里单列「既存红」证据。

## 5 · 交付物

- `ONBOARD_PATCH.md`（v2，19 块，每块带「回退」）
- `DEATH_REVIEW_PATCH.md`（v2，11 块，每块带「回退」）
- `REVIEW_FIX_REPORT.md`：逐条位置 + 改前/改后 + 自检数字 + 审计表 + 既存红
- `.reviewfix/index_patched.html`（仅自检副本，不发布）
- `tools/arcane_onboard_event.js`、`tools/arcane_death_review.js`（指向主文件副本）
- 旧脚本改动清单（单独说明，不混补丁）

## 6 · 非目标

- 不抬 `z-index`；不改 `bossKind` 判定；不新增 DoT 类型；不改结算页三层结构；不动难度/敌人数曲线。
