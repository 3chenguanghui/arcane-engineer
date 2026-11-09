# 审查整改回报 · v2 补丁（教学事件化 + 死亡归因去假分类）

> 主文件冻结期作业。**`index_arcane_v2.html` 零改动**：大小 2,693,678 字节 / 最后修改 2026-11-08 18:05:23 / SHA256 `92B649BC…477E6`（副本生成时间 18:25，之后主文件 mtime 未变）。
> 所有自检在副本 `.reviewfix/index_patched.html` 上跑；预览页结果不作证据。

## 一、6 条逐条

### ① `ground` 类恒 0 —— 已删，并回答「没有落地伤害来源」

**位置**：`P1_CATEGORY_META` / `p1CategoryOf` / `p1DeathVerdict`（补丁块 D1、D3、D7）

- 改前 `p1CategoryOf`：`hazard / sigil / collapse → env`；`ground` 单独一类；`p1DeathVerdict` 有 `share('ground') >= 0.45` 分支。
- 改后：`P1_CATEGORY_META` 只剩 `boss / melee / ranged / env / self / other`；`if (kind === 'hazard' || kind === 'sigil') return 'env';`；`collapse` 分支删除；`ground` 判决分支删除。
- **明确结论**：主文件不存在独立「落地伤害」来源。全文 `kind:'hazard'` 只有两处（`updateBossHazards` 与 `resolveBossTelegraph`），都带 `bossKind`，第一条 `if (cause.bossKind) return 'boss'` 必先截走。落锤 / 引力井属首领技能，已归 `boss`。**不新增来源、不保留恒 0 分类。**
- 顺带自查：`collapse` 也无生产者——它只是玩家技能区的 `zone.type`，从不进 `damagePlayer`。一并删除，未留注释性的空分支。

**六分类真实生产者审计**（复审可直接对表）：

| 分类 | 真实游戏里谁产生这个 cause（函数名） | kind | 可达性 |
|---|---|---|---|
| `boss` | `resolveBossTelegraph`（落锤/奇点/引力井）、`updateBossEnemy`（贴身）、`updateBossHazards`（残留危险区） | `hazard` / `contact`，均带 `bossKind` | 可达 |
| `melee` | `updateEnemies`（接触）、`resolveEnemyAction`（冲锋）、`resolveEnemyAction`（濒死自爆） | `contact` / `charge` / `selfdestruct` | 可达 |
| `ranged` | `updateBullets`（`srcKind` 全文只有 `'bullet'`）、`resolveEnemyAction`（蓄力爆发） | `bullet` / `burst` | 可达 |
| `env` | `updateSigils`（符阵爆炸） | `sigil` | 可达；`hazard→env` 仅**防御性映射**，不是可测路径（已在代码注释写明） |
| `self` | `explodeBarrel`（爆炸桶伤己） | `barrel` | 可达 |
| `other` | 调试口 `damagePlayer`、未标 kind 的兜底 | 任意 | 仅调试，不参与死因断言 |

**实测**（`reviewfix_death_test.js`）：
```
categories = ["boss","melee","ranged","env","self","other"]
p1CategoryOf({kind:'hazard'}) = env
p1CategoryOf({kind:'hazard',bossKind:'rune'}) = boss
p1CategoryOf({kind:'collapse'}) = other
```

### ② 老玩家判定读 live `bestFloor` —— 改开局快照

**位置**：`onboardBeginRun`（O10）、`onboardReturningPlayer` / `onboardSkipAll`（O4）

- 改前：`onboardReturningPlayer()` 每次调用现读 `state.meta.bestFloor`（进层即刷新）；`onboardSkipAll()` 也现读。
- 改后：`onboardBeginRun` 写 `state.onboardBaseline = { runs, bestFloor }`（`bestFloor` 支持 `opts.bestFloor` 显式传入）；`onboardReturningPlayer` 只读基线，无基线返回 true；`onboardSkipAll` 优先读基线。
- **实测**：新号 `runs=1 / bestFloor=0` → `returning=false`；`runs=2` → `returning=true` 且 5 事件全 false。`showFloor(5)` 后基线仍是 `bestFloor=0`（未被 live 值污染）。

### ③ `showFloor` 先抬 `bestFloor` 再 `onboardBeginRun` —— 已修顺序

**位置**：`__roamDebug.floor.showFloor`（O22）

- 改前：`generateFloor(target)` → `bestFloor` 抬到 target → `onboardBeginRun()` 读 live 值 → 老档 → `onboardSeedSeen()` 播种 → 之后 `event()` 恒 false。
- 改后：先 `const bestBefore = Number(state.meta.bestFloor)||0`，置基线，再 `generateFloor`，再 `onboardBeginRun({ bestFloor: bestBefore })`。
- **实测**：新号 `showFloor(5)` 后 `baseline.bestFloor=0`、`seen` 未被播种、`onboardEvent('firstCrystal')` 仍返回 true（随后现场验证）。

### ④ 首领含贴身 —— 按审查方案，不拆类

**位置**：`P1_VERDICT_LABEL.boss`、`p1NoteIncoming`、`p1BossContact`、`p1DeathVerdict`

- 标签：`被首领` → `被首领（含贴身）`。
- 账目新增 `bossContactDmg / bossContactHits`，**只在 `cat==='boss' && cause.kind==='contact'` 累加**。
- 判决句追加：`；其中贴身接触 X 点（占总承伤 Y%，N 次）`；Y 的分母是**总承伤**，与「首领占 Z%」并列可加。
- 不新增分类、不改 `bossKind` 判定、不拆 tag。
- **实测**：首领场景 boss 100%，贴身子句「贴身接触 40 点（占总承伤 67%，2 次）」；图例同时出现 `data-p1-max="40"`、`data-p1-top="裁决者"`。

### ⑤ 旧断言脚本 4 个 —— 已改，逐处如下

> 这一组**不混进补丁**，见本节末尾「提交边界」。

| 脚本 | 位置 | 改前断言 | 改后断言 | 为什么是语义升级 |
|---|---|---|---|---|
| `tools/arcane_onboard.js` | 头部 + 配置检查 | 5 个楼层键 `moveAttack/fusion/techDash/route/meta`，每项带 `floor` | 5 个事件键 `firstRoom/firstChoice/firstElite/lowHp/firstCrystal`，每项带 `n`、无 `floor` | 触发点从「第几层」变成「第一次遇到」，`floor` 不再是数据模型的一部分 |
| 同上 | 第 3 节 | `showFloor(1)` 必弹「移动与开火」 | 真实 `onboardOnRoomEnter(非 start 房)` 触发 `firstRoom`；带 1.2s 延迟，先 pending 后上屏 | 断言走**真实进房回调**，不再依赖调试入口弹提示 |
| 同上 | 第 4 节 | `showFloor(2)` 必弹「融合」 | `openReward('floor','skill')` 后 `modalLine()` 含「选牌优先凑融合」 | 三选一提示渲染进弹窗（z-index 60 盖住 41），断言改为读弹窗内 DOM |
| 同上 | 第 5 节 | `showFloor(3)` 必弹「装置与冲刺」 | 精英房回调触发 `firstElite` | 事件由房间类型产生，不由楼层产生 |
| 同上 | 第 6 节 | 手工造低血 | 走真实 `__roamDebug.p1.damagePlayer` 打到 29% | 复用真实伤害路径与 `lowHpFired` 每局一次语义 |
| 同上 | 第 7 节 | `showFloor(5)` 必弹「元进度」 | 真实 `grantRunCrystals` 触发 `firstCrystal` | 结晶提示由「真正入账」产生 |
| 同上 | 第 9/10 节 | 老档用 `bestFloor≥5` | 老档 `event` 恒 false；A/B 走 `event('firstRoom')` | 与 ②③ 的新口径对齐，不读 live 值 |
| `tools/arcane_playthrough.js` | 第 4 节 P4 | 循环 F1–F5，每层断言弹提示 | 一次性触发 5 事件，断言 `evOrder` 恰 5 条、各 1 次、文案 ≤12 字 | 同上；另加 P4c：`runs=2` 后 5 事件全 false |
| `tools/arcane_help.js` | `quick` 选择器 | `[data-quickref-floor]` 取 5 行 | `[data-quickref-step]` 取 5 行，序号 `1..5`，文案「事件 N」 | ⑥ 的 DOM 语义修正：低血可在任意层触发，不能再写「第 4 层」 |
| `tools/arcane_help.js` | 第 14 行 | 写死主文件路径 | 支持 `process.argv[2]` 指定被测文件 | 冻结期必须能指向副本验证；**不改断言口径** |
| `_ac_new_arcane_help.js` | — | 审查提到的文件 | **项目内不存在**（只有 `_ac_new_help2.log` 等旧日志） | 如实登记，不虚构改动 |

**另外两处测试脚本的稳健性修正（非语义）**，一并写明：

| 脚本 | 改动 | 原因 | 是否放宽阈值 |
|---|---|---|---|
| `arcane_playthrough.js` P4 | 触发后若为 pending，等 1.4s 再读 `hintVisible` | `firstRoom` 本身有 1.2s 延迟；原来立刻读会读到「已接受但未上屏」 | 否。`evOk` 仍要求 true，且必须最终上屏 |
| `arcane_playthrough.js` P5 | 固定 `sleep(500)` → 轮询最多 3s 直到 `mode==='reward' && options==4` | 升级弹窗先走慢动作 + `levelDelay`，低帧率下 500ms 会读到中间态（同一次补丁代码曾 PASS，也 FAIL 过） | 否。弱化的是等待方式，不是断言条件 |

**既存红处理（已转绿，未混进补丁线）**：

`arcane_onboard.js` 原来断言「第 1 层固定 2 只」，副本返回 3。查 `ONBOARD_CONFIG.floor1CountCap = 3`（注释写明「原 2 只」，因为同帧三杀要求一房至少 3 只）——**设计值就是 3，2 是旧版残留**。处理：
- 断言期望值改为 3，注释写明「设计值 3；改前写 2 是旧版残留，长期红着等于这条测试不存在」；
- 不再把它当「允许红」挂着。从这条起，该测试恢复报警能力。

**已知红门禁**（`tools/test_known_red.js` + `tools/known_red.json`）：清单本身也有门禁，防止「任何真回归登记成已知红就能继续 PASS」。三条纪律写在代码里：

1. **四要素齐全才算已知红**：`name / reason / date / reviewCondition`。缺任何一项 → 该条按 **FAIL** 处理并打印缺失字段；清单条目指向不存在的断言（孤儿）同样按 FAIL 处理。不允许用四要素不全的条目不劳而获。
2. **新增必须显式批准**：文件里出现 `approved` 之外的有效条目 → 打印 `KNOWN-RED ADDED: <名>` 并退出码 **2**；只有带 `--allow-known-red-add` 才把名字写入 `approved`、落盘并打印 `KNOWN-RED APPROVED`。
3. **数量只能减不能增**：固定打印「已知红 N 条（上轮 M 条）」；N > M 时打印 `▲ 新增 X 条：…（必须说明新增理由）`。被门禁拦下（退出码 2）时**不回写 baseline**，逼下一次重新面对新增。

实测（临时自检脚本，已删除）：
```
已知红 1 条（上轮 0 条）
▲ 新增 1 条：A（必须说明新增理由）
  · A — 原因（登记 2026-11-08；复核：主文件修好后删除）
  ✗ B — 四要素缺失（reviewCondition），按 FAIL 处理
KNOWN-RED ADDED: A
新增已知红未批准：带 --allow-known-red-add 重新运行才会通过（退出码 2）
RESULT: BLOCKED(新增已知红未批准)  1/2（已知红 1 条不计入）
```
带 `--allow-known-red-add` 后：`exitCode=1`、`approved=["A"]`、`baseline=1`——新增被看见、被批准、被记账。

当前实际清单为空，教学脚本输出「已知红 0 条（上轮 0 条）」「31/31 PASS」。

### ⑥ 块 18（`step.floor` 别名）—— 非可选，已改三个读者

| 读者 | 位置 | 改前显示 | 改后显示 |
|---|---|---|---|
| 帮助速查 | `buildHelpHtml` quickref | `<li data-quickref-floor="N"><b>第 N 层</b>` | `<li data-quickref-step="N"><b>事件 N</b>` |
| 设置页回顾 | `renderOnboardReview` | `第 N 层 · verb` | `事件 N · verb` |
| 调试 info | `__roamDebug.onboard.info().steps` | `step.floor` | `step.n` |

**为什么不是兼容问题**：`lowHp` 可以在任意层触发，写成「第 4 层 · 低血」会让玩家以为只有第 4 层才会低血——这是明确的语义错误。

## 二、自检结果（全部在副本上）

副本命名：`.reviewfix/index_patched.html`（主文件复制 + 40 块机械替换，每块必须唯一命中）。

| 脚本 | 结果 | 关键数字 |
|---|---|---|
| `arcane_syntax.js` | PASS | 副本语法通过 |
| `reviewfix_onboard_test.js` | PASS（24 条） | 顺序 `firstRoom→firstChoice→firstElite→lowHp→firstCrystal`；各 1 次；第二局全 false；`showFloor(5)` 基线 `bestFloor=0`、未播种；1.2s 前不上屏 / 2.9s 在屏 / 3.2s 收起；Esc 收起；弹窗行含「选牌优先凑融合」；**关闭总开关后队列不出队 / 队列仍挂起 / 重开后继续 / resetRun 可重建新号** |
| `reviewfix_death_test.js` | PASS | 近战：裁决者 71%、最大单次 38、合计 100、总结含「第 12 层」；环境 83%；首领 100% + 「贴身接触 40 点（67%）」；骤升 melee 本层 100% vs 全局 33%；HTML 含 `data-p1-summary` / `data-p1-max` / `data-p1-spike` |
| `arcane_onboard.js` | 31/31 PASS（已知红 0） | 断言已改为设计值 3；功能项 31/31，PERF 2 条仍作为负载敏感项只记录 |
| `arcane_playthrough.js` | 23/23 PASS | P4 五事件全 `evOk=true` 且上屏；P4c 第二局 0 次；P5 四选一；P17 无运行时错误 |
| `arcane_help.js` | 16/16 PASS | H4 `rows:[1,2,3,4,5]`、`cfg` 五事件文案一致；H10/H11 自包含 2.58MB |
| `death_parity.js` | PASS（750/750 逐局一致） | 每页 750 个**互不相同的场景**（5 层 × 近战/远程/空场 × 50 局）；粘前/粘后总死亡 108 vs 108；逐格差异 0、逐局差异 0 |
| 已知红门禁（`test_known_red.js`） | PASS（自检脚本已删） | 未批准新增 → `exitCode=2` + `KNOWN-RED ADDED: A`；缺 `reviewCondition` → 按 FAIL；带 `--allow-known-red-add` → `approved=["A"]`、`baseline=1`、`exitCode=1` |

**「不影响难度」的实测证据**（`tools/death_parity.js`，已按新要求抬到每格 50 局）：

- **每页 750 个场景，不是同一场景跑 50 次。** HP 按局在 20–239 之间变化、敌人数量 2–4 只、站位逐局错开；两页注入**同一张场景表**，所以同一下标就是同一局。
- **两页在生成楼层前统一用固定种子接管 `Math.random`**，保证房间几何一致；否则两页各自 `generateFloor`，墙体差异会伪装成回归。
- **逐局比对（死亡 / 存活 + 死因），不是只比汇总数。**

| 楼层 | 近战（死亡/50） | 远程（死亡/50） | 空场（死亡/50） | 逐局差异 |
|---|---|---|---|---|
| F1 | 6 vs 6 | 9 vs 9 | 0 vs 0 | 0 |
| F2 | 11 vs 11 | 26 vs 26 | 0 vs 0 | 0 |
| F3 | 9 vs 9 | 10 vs 10 | 0 vs 0 | 0 |
| F4 | 9 vs 9 | 9 vs 9 | 0 vs 0 | 0 |
| F5 | 9 vs 9 | 10 vs 10 | 0 vs 0 | 0 |

死因分布同样逐格一致（近战全部 `contact:游荡体`，远程全部 `bullet:射手傀儡`，空场无死亡——后者是对照组，证明「没有敌人就没有额外死亡来源」）。**750/750 逐局一致，没有任何一例差异。**

> 过程中发现并修掉一个脚手架问题：初版在 `showFloor` 后 `await 80ms`，让出主线程时两页的 RAF 循环各自消费了不同次数的随机数，F3–F5 长出不同房间，制造了 10 例假差异。去掉 `await`（整批在同一个 JS 任务里同步跑完）后差异归零。**这是测试脚手架的问题，不是补丁的问题**，但值得写下来：以后改这个脚本不要再在种子窗口里加 `await`。
> 帧数仍不作判据（现在是精确同步，但帧数对结论没有信息量）。

## 三、回答「会不会影响 F1–F5 难度或内容」

**都不会，两件都可以排在验收之后粘。** 上一节已有实测：每页 750 个不同场景，死亡 108 vs 108、逐局差异 0。

- **教学条**：绝对定位浮层，`.onboard-hint` 已有 `pointer-events: none`，不接收点击；z-index 41 低于弹窗 60，不抢焦点；不暂停、不改 `state.mode`；位置在右上角 `top:64px`，小地图在右下（`right:18px / bottom:208px`），不重叠。写入的持久化只有独立键 `arcane_onboard_v1`。
- **F1–F5 的难度内容**：**不在本补丁里**。首层 3 只封顶（`floor1CountCap:3`）与 `enemyCountMul: 0.8` 是主文件既有的 G 批行为，冻结版本里已经在跑；本补丁只删掉「按楼层弹提示」那段 tick，不动敌人数、不动血量、不动掉落。
- **死亡归因**：记账发生在 `damagePlayer` 已有的 `p1NoteIncoming` 单一路径里，O(1) 累加几个数字；展示全在结算页 HTML。战斗数值、命中判定、冷却全部未改。
- 唯一能感知的副作用：提示条出现时会收起诉灵那一句（`ui.spiritLine`），这是既有教学行为，不是新增。

## 四、未解风险 / 需要复审确认的点

1. `arcane_help.js` 现在支持 `argv[2]`。这是**工具链改动**，不是断言改动；复审时请确认可接受（否则冻结期无法指向副本）。
2. `firstRoom` 的 1.2s 延迟是产品决定（出生房刚进画面就给提示会跟入场动画打架）。若复审认为应改成 0，只改 `ONBOARD_STEPS` 的 `delay`，测试脚本的等待可以保留。
3. 首领贴身的 `Y%` 分母选了「总承伤」。若复审要改成「首领伤害占比」，只改 `p1BossContact` 一行。
4. 旧脚本 `arcane_onboard.js` 的「2 只」断言已按设计值改为 3（`floor1CountCap:3` 的注释写明「原 2 只」）；若产品决定回到 2 只，那是主文件问题，需单独登记，不在本补丁线内改。

## 五、交付物与提交边界

| 文件 | 性质 | 说明 |
|---|---|---|
| `ONBOARD_PATCH.md` | 补丁文档 v2（20 块，0–19） | 每块带唯一锚点 + 回退动作 |
| `DEATH_REVIEW_PATCH.md` | 补丁文档 v2（11 块，0–10） | 同上 |
| `tools/reviewfix_apply.js` | 补丁机械版 | 40 个替换，任一不唯一即中止 |
| `tools/reviewfix_onboard_test.js` / `reviewfix_death_test.js` | 新增自检 | 指向副本，不指向预览页 |
| `tools/arcane_onboard.js` / `arcane_playthrough.js` / `arcane_help.js` | **旧脚本整改，单独提交** | 逐处对照见 ⑤ |
| `tools/test_known_red.js` + `tools/known_red.json` | 已知红清单门禁 | 四要素校验、新增退出码 2、数量只能减不能增；清单为空 |
| `tools/death_parity.js` | 难度奇偶性验证 | 每页 750 个不同场景，逐局对比粘前/粘后 |
| `.reviewfix/index_patched.html` | 临时副本 | 自检后删除，不发布 |

## 六、粘贴顺序（冻结期结束后执行）

**第 1 步：教学条**（失败面最小：`pointer-events:none` 浮层、不暂停、不改 `mode`）
1. 粘 `ONBOARD_PATCH.md` 块 0 → 19，按顺序，每块锚点必须唯一命中；
2. 跑 `node tools\arcane_syntax.js`；
3. 跑全量：`arcane_onboard`、`arcane_playthrough`、`arcane_help`、`reviewfix_onboard_test`、`death_parity`；
4. 全绿后再进第 2 步。**不要连着粘两份。**

**第 2 步：死亡归因**（碰 `damagePlayer` 记账路径，离战斗数值更近）
5. 粘 `DEATH_REVIEW_PATCH.md` 块 0 → 10；
6. 再跑一次全量（同上 5 个脚本 + `reviewfix_death_test`）；
7. 记录：已知红 N 条（上轮 M 条）、有效通过率、`death_parity` 逐局差异是否为 0（750 局/页，任何 1 例差异都算 FAIL）。

任一块锚点找不到：停下回报，**不要改锚点强行粘**。
