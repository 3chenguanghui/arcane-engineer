# MERGE-QUEUE · 《烬》合并审查线

## 判据分层（2026-11-08 用户裁定 · 先于一切验收判定）

**20 层全跑 = 冒烟判据，不判时长、不判通关率。**
- 只判四件事：能否从标题页跑通 F1→F20 / 有无 console error / 每层是否清层（可下楼）/ 有无崩溃或中止。
- 跑 3 次，3 次都要过冒烟；任一次红，按同口径复跑，不许用另一次的结果覆盖。
- 时长与通关率 = **统计判据**，只在 `tools/sim_panel`（10000 局）里判分布，**不进全跑门禁**。

**理由（用户原话留档）**：**同层两次差 15–20s 的量，用它判 75 秒门槛，等于用噪声判阈值。**
反证：RUN1 负载更高（CPU 73–84 / Edge avg 48）却 8/8 全绿；RUN2 负载更低（CPU 57–73）却 5/8 三红。
同一份代码（MD5 恒 `C762F5944F5D3A46C3A69CBD6E971E48`）、同一环境，结论只能是**单样本高方差**，不是代码不稳定。

| 判据 | 载体 | 判什么 | 频次 |
| --- | --- | --- | --- |
| 冒烟 | `_cut_run.js` 20 层全跑 | 跑通 / 无 console error / 清层 / 无崩溃 | 3 次，3 次全过 |
| 统计 | `tools/sim_panel` 10000 局 | 时长分位（P50/P95/max）、超 75s/90s 占比、通关率 | 每次调数值后 1 次 |

**E1 作废**：E1 两条新红线都越了（10 层 42.2% / 通关 36.7%），本轮**不落**。因此**没有「等 E1 之后重测」这个出口**；F18/F19 的时长问题必须现在独立解决。

### 写盘后第一件事：最小加载自检（2026-11-08 铁律）

任何写入主文件的操作之后，**先跑 `node tools/_load_check.js`**：
`readyState=complete` / 标题可见 / `init()` 与 `__roamDebug` 存在 / 画布存在 / **console error = 0**。
加载 PASS 才做功能验证；加载 FAIL 立刻回滚，不许继续验证。
教训：剑境一个多余的右括号让整份 3.8MB 文件跑不起来，而写它的人自报"功能 8/8 验证通过"。

### 指纹口径（2026-11-08 补）

- **MD5 用于发布比对；SHA256 只作旁证**，两者不可混用。
- 今晚两次"哈希对不上"均为**算法混用**：旧文件 MD5 `C762F594…` / SHA256 `92B649BC…`；
  P1 落盘后 MD5 `62C63B77…` / SHA256 `3929CB87…`。
- 报哈希必须写清算法，禁止只给 8 位前缀（8 位前缀无法区分 MD5 与 SHA256）。

### 首领战时长归因（模拟器 bot · 10000 局 · seed 20261108）

| 层 | P50 | P95 | max | >75s | >90s | 判定 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| F10 | 71.8 | 85.9 | 93.8 | 37.0% | 1.3%（45/3515） | 模拟器正常，全跑 91s 是尾部样本 → **改判据，不改血量** |
| F18 | 95.5 | 120.5 | 128.0 | 93.9% | 63.9% | 模拟器也超 → **数值问题**，须独立修 |
| F19 | 92.2 | 115.8 | 125.3 | 91.2% | 55.5% | 模拟器也超 → **数值问题**，须独立修 |

根因：`cap(f) = hpCap × (1 + 0.04 × (f−1))` 在 F18/F19 = 5,376 / 5,504；F20 有 `hpCapF20Scale = 0.55` → 3,098。
即 **75 秒闸门只对 F20 生效，F18/F19 从未过闸**；F12 起 `>90s` 已达 33.4%，同一漏层问题从 F12 就开始。
调参方向只在模拟器里算，补丁只做「就绪」，不粘主文件。

## 实时状态（每次更新覆盖）
- **主文件基线（本线复核，21:53:28）**：**64,235 行 / 2,754,346 B / MD5 `4A5B39DCA063F01BFC1BC4725F00F771`**。较 21:43:30 的 `BA68478FE49A6DFA25C8B3F4CD368FAC`（63,929 行 / 2,740,252 B）**+306 行 / +14,094 B**，写入来自写权线；本线全程只读。
- **#12 路虚影：定性 + 补丁 + A/B 实测已完成**（§13）。根因=「地面延伸带」被 `ring()` 铺进房间（走廊腿从房心连到房心 + `drawVoidApron()` 在雾之后）；四嫌疑 ①命中、②③④ 均有结构性反证。房间地面覆盖 **17.8% → 0.0%**（>32/255 档）。补丁 **+13 行 / +823 B / 帧内 0**，`clipToFloors` 单开关。
- **v1.7.0 收尾（2026-11-08 · 只产补丁与文档，主文件零改动）**：主文件仍为 v1.6.1 出包态 2,711,040 B / MD5 `23194ECC5F7733054C4E511476B885C7`。
  - 队列统计：F10/F11 倒挂=已量化不改（`F10_F11_INVERSION_REPORT.md`）｜F20 设计欠账=已登记不改（`F20_ENDPOINT_REPORT.md`）｜E1=不落（解封线 10 层 <32.0%）｜主文件补丁=**1 处注释级**（`V170_PATCH.md` P1，就绪不落）。
  - 倒挂实测（A · 10,000 局 bot）：整层 P50 F10 121.62 / F11 126.11 / F12 111.36 → F11→F12 **−14.8s**、F11→F13 **−21.1s**；首领战 −17.4s / −23.3s，2×SE≈2.4s → 全部可分辨。归因：v1.6.1 压血把 F12 整层 P50 从 140.63 压到 111.36（改前无倒挂）。
  - 全曲线凹点（A 现行 5 处）：F1→F2 −3.6 / F2→F3 −3.1 / F6→F7 −4.9 / **F11→F12 −14.8（闸门新增）** / F12→F13 −6.4；改前 5 处含 **F19→F20 −30.1**。即闸门把终局断崖换成深层入口台阶，凹点总数不变。
  - 最近验证（已跑完）：F12–F19 P95 60.35–71.66s、>90s 0% → PASS；10 层 35.1%、通关 32.0% → PASS；正控 `--floor all` FAIL（F5–F11）→ 判据有效。
  - 卡住：无。等「收尾合并与发布」线决定是否合入注释级 P1。
- **主文件当前状态（v1.6.1 已出包，2026-11-08 夜）**：2,711,040 B / MD5 `23194ECC5F7733054C4E511476B885C7`。已含 P1（F2 ×0.85 / F3 ×0.88）+ 教学 26 处 + 归因 14 处 + v1.6.1 深层压血（F12–F17 ×0.65、F18 ×0.60、F19 ×0.62）。
- **出包产物**：`dist/emberfall_v1.6.1/`（`烬_v1.6.1.html` 2,711,040 B，MD5 与主文件一致）+ `dist/manifest_v1.6.1.json`；打包验 9/9 PASS（重建前后主文件 MD5 未变）；dist 75 文件 = 18 个历史包 + 1 个新包。
- **v1.6.1 判据（10,000 局 bot）**：F12–F19 P95 60.35–71.66s、>90s 0%；10 层 35.1%（≤40）、通关 32.0%（≤36）。正控 `--floor all` 基线 FAIL（F5–F19 全红，F18 120.46s / >90 63.9%）→ 判据有效。
- **v1.6.1 明确不做**：F18 伤害 ×1.15（首领死 70→106、P95 71.66→72.59 没缩短、普通/精英段 2017→2019 / 110→110）；F20 闸门 0.55 不动（抬 0.7 只把 55.1→69.9s、首领死 1→1）；E1 不落，**解封条件=10 层通关率跌到 32% 以下**。
- **已知问题**：F7 bot 侧卡死 1/6（52.2s / 兜底 197 / 承伤 0），复跑 3/3 未复现、v1.6.0 包 3/3 未复现 → **判 bot 问题，不判产品问题**（判据：复跑不复现 + 承伤 0）。
- **冻结起点（历史，留档）**：2,693,678 B / MD5 `C762F5944F5D3A46C3A69CBD6E971E48`（18:05:23），与 `bak_20261108_v160_C762F594.html` 逐字节相同。
- 队列：可粘 7 项（新增 #12 路虚影）| 待审 5 项（新增 #13 出入口）| 占位 3 项
- 降负载纪律：模拟器默认线程 16 → 4（`sim_panel/run.js`、`_tri_factor.js`、`_sim_cap_eval.js`）；`_balance_check.js` / `_ach_persist.js` 已补 `finally` 关 Edge；20 层回归拆 4 批、批次间落盘并停 10 秒。
- **负载归因（18:35 实测）**：CPU 75%，但**本项目探针进程 0**；`msedge` 32 个全是用户自己的浏览器（带调试端口 0 个）、`node` 10 个全是 WorkDaddy / 剑境等别的项目。**热点不在本审查线**。降负载规则仍然生效——本线历史上确实是峰值之一，规则防的是复发，不是这次。
- 单线：**#12 路虚影（补丁已交，等写权线粘）** → **#13 出入口（定性+实测+补丁已成，待预算实测与复核）**；#7 无障碍 P0 顺延；#10 / #11 已审、等对方改；其余按「执行顺序」排队
- 最近一次验证：`door_readability_probe.js`（F3 / elite 618×624 / 4 门）→ 门心 15.4–19.5 vs 地面 58.5（门比地面暗 39–43 阶），门闪+光带注入后峰值差 **61.5 → 140.1**，25% 缩图由「看不出」变「一眼可辨」；`apron_ghost_probe.js` 同帧 A/B（F3 / 5 房 / 11 走廊）→ 房间地面 >32 档 **17.8% → 0.0%**；`apron_patch_budget.js` 两锚点各命中 1、`+13 行 / +823 B`（内存实测，主文件未被本线写入）；`arcane_onboard_event.js` / `arcane_death_review.js` 均 PASS（preview）；`a11y_compare.js` 19/19；`fake_knob_audit.js` A 3/3、B 确定 2
- 卡住：#10 老玩家判定读 live `bestFloor`（新玩家进第 5 层会被静默）；#11 `ground` 类不可达、首领含贴身未拆

## 互斥与顺序（改动前先对一遍）
| # | 必须在前 | 必须在后 | 反了会怎样 |
| --- | --- | --- | --- |
| 1 | §1.2 的 9 条 `case` | 成就面板 | 面板 `progress` 永远走 `default: 0`，像面板坏了 |
| 2 | §1.4 D-2 `achRewardText` | 面板 `rewardText` | 主文件与面板各拼一套文案，「已记入档案」再次分叉 |
| 3 | `__roamDebug.p2` 四方法预检 | save-ui 可写模式 | 只判 `if (p2)` 会把没写成功的槽显示成已保存 |
| 4 | 成就面板 | 无障碍 P0 → 代码审计 | 审计删配置键时最容易撞成就奖励表与 a11y 色令牌 |
| 5 | 无障碍内部：假旋钮去留 → 对比度 → 字号 → 色盲 → 动效三档 | 同左 | 动效三档要新增 `state.meta.motionLevel`，晚加才能一次改完存档白名单 |

> **纪律 0（最高优先级）· 降负载 —— 先于一切测量纪律**
> 1. 同一时刻**最多 1 个无头浏览器**（绝对上限 2）；批量任务（截图 / 回归 / 基准）**一律串行**，禁止 `Promise.all` 开多页。
> 2. 脚本启动前先 `(Get-Process msedge).Count` 粗查；**真正要清的是命令行带 `--headless` 的实例**——不带 headless 的是用户自己的浏览器，不许杀。
> 3. 每个脚本必须在 `finally` 里关浏览器（成功 / 抛错 / 超时三路都走），不许指望「进程会自己退」。
> 4. 两个重活之间留 **3–5 秒**空隙。
> 5. **原因**：CPU 85% 时所有 p95 都是垃圾；复核别人的数字，先要保证自己的测量环境干净。
> 6. **别矫枉过正**：串行只针对重活；读代码 / grep / 写文档 / 改补丁这些轻活照常并行。
>
> 主线只需做三步：**粘补丁 → 跑命令 → 勾选**。
> **复核纪律**：每次复核先报主文件「行数 / 字节 / MD5」，与上一基线对比后再谈其它。
> 本文件不修改 `index_arcane_v2.html`；所有补丁均以**函数名 / 配置段名**为锚点（不写行号，行号会漂）。
> 每个补丁都有独立总开关，任何一项粘错都能单点回退。
> 每轮必跑 `node tools/merge_audit/fake_knob_audit.js`：配置 / UI / 存档三方对不上就报（§9）。
> **新增两条顺序约束（不占表行）**：#10 教学**不能单独粘**，必须与 4 个旧脚本（`arcane_onboard.js` / `arcane_playthrough.js` / `arcane_help.js` / `_ac_new_arcane_help.js` 副本）的断言改写同一个提交；#11 死亡归因与 #10 无互斥，但改 `P1_CATEGORY_META` 后要重跑 `arcane_p1.js`（当前 A3–A6 兼容，见 §11.3）。

## 执行顺序（同一时刻只推一条线）

> 规则：**一条线做完、验收、落盘，才开下一条。** 被对方卡住的线不占执行位，跳过继续下一条，交付后插回队首。轻活不排队。

1. **#12 路虚影（补丁已交，等写权线粘）** —— §13；两处锚点 + `clipToFloors` 总开关；验收 `node tools/merge_audit/apron_ghost_probe.js` 改后 `before.a32 = 0.0`。
2. **#13 出入口不可见（本线正在做，唯一在推）** —— 先定性门层/色值/描边/光 + 实测对比度，再四件套（地面光带 / 门口呼吸环 / 清场全房提示 / 门框描边）；判据：房间截图缩到 25% 仍能一眼看出门。
3. **#7 无障碍 P0** —— §6.0 摘字 → 4 行对比度 → 闪白滚动/序号令牌 → 动效三档；验收 `a11y_compare` 19/19，`fake_knob` 只剩 2 条死配置。
4. **#1 D-2 收尾** —— 「已记入档案」统一；`verify_itemD` 6/6。它是 #6 的前置，必须先做。
5. **#2 UI 差集** —— 13 行；`arcane_tokens` + `arcane_audit` 全 PASS。
6. **#6 成就面板** —— 前置 #1 的 9 条 case 已在位；面板打开滚动 p95 8.4–8.5ms。
7. **#9 save-ui** —— 前置 `__roamDebug.p2` 四方法预检；`save_ui_probe` 53 项。
8. **#10 首局教学** —— 等对方按 §10.1 改完；补丁 + 4 脚本同一提交，`arcane_onboard_event` 改为主文件可跑。
9. **#11 死亡归因** —— 等对方按 §11.1 / §11.2 改完；`arcane_p1` A3–A6 + 新增两条断言。
10. **#3 sim_panel** —— 离线工具，不入包。
11. **#8 代码审计** —— 最后做，删配置键不与前十条抢。
12. #4 音效 / #5 触屏 —— 占位，未交付不进序。

**验收冻结 → 落地顺序（用户 2026-11-08 拍板）**

0. **本轮验收只认已落盘的 1.6.0 口径**：`boss-mech-v2` / E1 / W1+W2 三条难度补丁**一个都不落**。理由不是"一次只动一个杠杆"，是 **E1 单独 +6.9pp 会完全盖掉 B1 的贡献 → 验完说不清 44.9% 是谁的功劳，等于失去归因能力**。冻结窗口只给验收，不给改难度。
1. **验收绿后 ① `boss-mech-v2`（四机制）单独落**：−0.35pp 落在噪声内，落完重测应仍 ≈44.9%；若跳变，即补丁有副作用。它解决的是"5 场全是同一只首领"的**内容问题，不是数值问题**。
2. **② E1（F1 清层 +1 三选一）单独落、单独验**：44.9% → 51.8%，是目前最大的单一杠杆。落完跑一次 5 层通关率；**>52% 即停**，回到「把 F2 首领找回来当难度点」讨论。肉鸽新手 50% 偏慷慨。
3. **③ W1+W2（精英墙）最后**：只影响 F13+，离新玩家最远；且与 E1 叠加会把 F20 到达率从两个方向同时推高，必须分开验才知道各自多少。
4. **mech2 的已知风险（用户点明，必须留档）**：−0.35pp 只是模拟器的"数值承伤上限"，模拟器**没有走位、没有预警、没有冲刺**。真人第一次遇液压合拢会站着不动被夹，实际难度一定高于 −0.35pp。落地后必须**真人**真机上手 F1–F5 各一遍（**AI 不代玩**），判「看懂就能躲、看不懂就死」：死的都是没看懂的 → 预警/前摇不足，改预警；看懂也躲不掉 → 才是难度问题。

**并行禁令**：以上任意一步的截图 / 回归 / 基准跑完之前，不得启动下一步的任何浏览器实例。`#10` 与 `#11` 虽无逻辑互斥，也**不许同时跑两套回归**。

基线（本审查线开单时实测）：**62,776 行 / 2,676,227 字节**；版本 `GAME_CONFIG.version = '1.5.6'`。
17:21 外部合并后：**62,936 行 / 2,688,093 字节**（含第 1 项 A/B/C 已粘入及其它改动）。
17:48:49 再次外部写入：**62,993 行 / 2,691,500 字节 / MD5 1107F15F**；复核期间文件仍在被主线改动，但 §6 的 19 项锚点断言全部仍 PASS（`a11y.contrast`、`minGap`、5 条 CSS 选择器、存档白名单均未漂）。
17:55:51 又一次写入：**63,001 行 / 2,692,209 字节 / MD5 EA4CB089**；§10/§11 审计另核了 10 个锚点，全部在位：`ONBOARD_CONFIG` / `onboardTick` / `onboardBeginRun` / `grantRunCrystals` / `openReward` / `buildRewardModalHtml` / `handleKeyDown` / `P1_CATEGORY_META` / `p1LedgerReset` / `p1DeathVerdict` / `buildShareBarHtml`。
- 主循环 [loop()](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L54176-L54210)：`update(dt)` → `render()`，异常兜底已在

---

## 队列总览

| # | 模块 | 准入判定 | 预计行数 | 预计字节 | 帧内 p95 | 状态 |
| --- | --- | --- | ---: | ---: | --- | --- |
| 1 | 成就 38 条 + 文案 | **可直接合**（4 处补丁 + 2 处口径修正） | +42 | +4,194 | 无变化 | ☐ |
| 2 | UI kit v1.5.6 / ui-patch | **只合差集**（21 项中 18 项已落地） | +13 | +~450 | 无变化 | ☐ |
| 3 | tools/sim_panel | **可直接合**（离线工具，不入包） | 0 | 0 | 无变化 | ☐ |
| 4 | 音效配乐 | 占位待交付 | — | — | — | ☐ |
| 5 | 触屏适配 | 占位待交付 | — | — | — | ☐ |
| 6 | 成就面板 `ach-panel.js/.css` | **已在手，可按序合**（前置：先合 #1 的补丁 B / D-2） | +2,463 | +84,657 | 面板打开时滚动 p95 8.4–8.5ms | ☐ |
| 7 | 无障碍 P0 补丁 | **可粘 P0 核心**（假旋钮摘字 + 4 行对比度 + 闪白上限 + 动效三档）；字号 / 色盲两个 P1 子项**待审** | 约 +110（待实测） | 约 +4,000（待实测） | 无变化（计数判断 O(≤3)） | ☐ |
| 8 | 代码健康审计补丁 | **占位待交付**（裁决已定，见 §7） | 负增长，待实测 | 负增长，待实测 | 无变化 | ☐ |
| 9 | 三槽存档界面 `save-ui.js/.css` | **已在手，两条硬性准入须先落实**（见 §8.0 / §8.1） | +3,152 | +121,478 | 无变化（浮层不挂每帧） | ☐ |
| 10 | 首局教学 19 块 | **已核销，交写权线**（4 条硬伤 + 自检同源，见 §10.5） | 副本实测 | 副本实测 | 每帧 O(1) | ☐ |
| 11 | 死亡归因 11 块 | **已核销，交写权线**（`ground`/`collapse` 已删 + 首领含贴身，见 §11.6） | 副本实测 | 副本实测 | 死亡时一次 | ☐ |
| 12 | 路虚影（地面延伸带抠除） | **可粘**（两处锚点、单开关），见 §13 | +13 | +823 | **帧内 0**（烘焙期 17 次 `clearRect`） | ☐ |
| 13 | 出入口不可见（门可读性四件套） | **待审，不可粘**（定性+实测已完成，预算未实测），见 §14 | ≈+45 | ≈+1.6 KB | 每帧每门 1 渐变+1 填充 | ☐ |

**本轮重排编号**：#6 = 原 #10 成就面板，#7 = 新增无障碍 P0，#8 = 原 #11 代码审计，#9 = 原 #12 存档界面；节号 **§5 / §6 / §7 / §8** 与之一一对应，旧引用以节标题为准。**#10 / #11 为本轮新收，接在 #9 之后，节号 §10 / §11。** 第 1 项已用**临时副本** `.merge_audit/index_item1.html` 实测并静态验收全绿；本审查线未改动主文件（17:21 / 17:48 / 17:55 三次改动均来自主线）。

---

## 1. 成就 38 条 + 卡片文案

**准入：可直接合。** `achievements.json` 的 22 条「已有」与主文件逐字段一致，16 条新增全部指向真实字段；仅 `barrelKills` 需要新写盘，其余 9 条只补读取分支。

**当前状态（17:21 复核）**：主线已把 **A / B / C** 粘入（16 条成就、9 条 case、`barrelKills` 三处均在位），**D 的文案口径未对齐**：现为「初始奥能已满 / 无奖励」，用户要求夹成 0 与无奖励统一显示 **「已记入档案」**。不改这两处，§5.1 的面板奖励口径无法复用。

**主文件基线（本审查线复核）**
- 行数 **62,936**
- 字节 **2,688,093**
- MD5 **1A710C31F5D682C9787E0DCEA8DFF551**
- 与开单基线（62,776 / 2,676,227）差：**+160 行 / +11,866 字节**
- 外部改动记录：`maxAetherReward` 已由 **12 改为 26**（与 21 条 aether 合计 26 一致，当前不会出现夹 0）；面板常量同为 26。D 段函数按传入 `cap` 工作，若上限回落 12 即刻生效。

### 1.1 注册位置（补丁 A）

锚点：`META_PROGRESS_CONFIG.achievements` 数组最后一条 `deaths_5` 之后、数组闭合 `]` 之前。

```js
    { id: 'deaths_5', name: '屡败屡战', desc: '累计死亡 5 次', metric: 'deaths', target: 5, reward: { aether: 1 } },
    /* ---- v1.5.6 合并审查线 · 扩展 16 条（来源 achievements.json，reward 统一留空） ---- */
    { id: 'kills_1000', name: '千机散架', desc: '累计击杀 1000 只构装', metric: 'kills', target: 1000, reward: {} },
    { id: 'elite_200', name: '精英坟场', desc: '累计击杀 200 只精英', metric: 'eliteKills', target: 200, reward: {} },
    { id: 'boss_20', name: '首领名录', desc: '累计击败 20 名首领', metric: 'bossKills', target: 20, reward: {} },
    { id: 'combo_50', name: '连锁成瘾', desc: '单次连击峰值达到 50', metric: 'comboPeak', target: 50, reward: {} },
    { id: 'floor_12', name: '塔心回响', desc: '最高到达第 12 层', metric: 'bestFloor', target: 12, reward: {} },
    { id: 'floor_20', name: '深井尽头', desc: '最高到达第 20 层', metric: 'bestFloor', target: 20, reward: {} },
    { id: 'daily_clear', name: '今日签收', desc: '通关任意一次每日挑战', metric: 'dailyCleared', target: 1, reward: {} },
    { id: 'codex_enemies_all', name: '名录补全', desc: '图鉴敌人条目全部解锁', metric: 'codexEnemies', target: 33, reward: {} },
    { id: 'relics_10', name: '拾荒成性', desc: '图鉴遗物解锁 10 件', metric: 'codexRelics', target: 10, reward: {} },
    { id: 'cards_all', name: '卡池见底', desc: '图鉴卡牌条目全部解锁', metric: 'codexCards', target: 20, reward: {} },
    { id: 'talents_30', name: '天赋满墙', desc: '累计投入 30 级天赋', metric: 'talentLevels', target: 30, reward: {} },
    { id: 'single_school_3', name: '一路到底', desc: '同一流派通关 3 次', metric: 'singleSchoolClears', target: 3, reward: {} },
    { id: 'wager_3', name: '三押三中', desc: '赌注房累计获胜 3 次', metric: 'wagerWins', target: 3, reward: {} },
    { id: 'sacrifice_5', name: '血本无归', desc: '献祭房累计献祭 5 次', metric: 'sacrifices', target: 5, reward: {} },
    { id: 'barrel_20', name: '桶边常客', desc: '累计用爆桶击杀 20 只敌人', metric: 'barrelKills', target: 20, reward: {} },
    { id: 'challenge_10', name: '无阶可退', desc: '以挑战等级 10 通关一次', metric: 'challenge10Clears', target: 1, reward: {} }
```

**byId 双写**：不需要另写一份映射。紧跟在数组后面的既有 `forEach` 会自动把 38 条全部写进 `META_PROGRESS_CONFIG.byId`，`normalizeMeta()` 就是靠它过滤存档脏数据。若把补丁 A 贴到别处（不走数组末尾），则必须同步补一行 `META_PROGRESS_CONFIG.byId[item.id] = item;`。

### 1.2 补 9 条读取口径（补丁 B）

锚点：`metaMetricValue()` 的 `case 'runRecipes'` 之后、`default:` 之前。

```js
    case 'runRecipes': return Math.max(0, Math.floor(Number(m.bestRunRecipes) || 0));
    /* v1.5.6 合并审查线 · 扩展 9 条口径：字段都已存在，这里只补读取分支 */
    case 'dailyCleared': {
      const runs = m.seedRuns && typeof m.seedRuns === 'object' ? m.seedRuns : {};
      return Object.keys(runs).some((k) => runs[k] && runs[k].daily === true && runs[k].cleared === true) ? 1 : 0;
    }
    case 'codexEnemies': return m.codex && Array.isArray(m.codex.enemies) ? m.codex.enemies.length : 0;
    case 'codexRelics': return m.codex && Array.isArray(m.codex.relics) ? m.codex.relics.length : 0;
    case 'codexCards': return m.codex && Array.isArray(m.codex.cards) ? m.codex.cards.length : 0;
    case 'talentLevels': {
      const talents = m.talents && typeof m.talents === 'object' ? m.talents : {};
      return Object.keys(talents).reduce((sum, k) => sum + Math.max(0, Math.floor(Number(talents[k]) || 0)), 0);
    }
    case 'wagerWins': return Math.max(0, Math.floor(Number(m.eventStats && m.eventStats.wagerWins) || 0));
    case 'sacrifices': return Math.max(0, Math.floor(Number(m.eventStats && m.eventStats.sacrifice) || 0));
    case 'barrelKills': return Math.max(0, Math.floor(Number(m.stats && m.stats.barrelKills) || 0));
    case 'challenge10Clears': return Math.max(0, Math.floor(Number(m.challengeCleared && m.challengeCleared['10']) || 0));
    default: return 0;
```

### 1.3 唯一新增计数器 `barrelKills`（补丁 C，3 处）

1）`terrainBump(kind)` 末尾：

```js
  state.terrainKills[kind] = (state.terrainKills[kind] || 0) + 1;
  // 成就口径：爆桶击杀单独计数（metaBumpStat 内部已做存档/开关保护）
  if (kind === 'barrel') metaBumpStat('barrelKills', 1);
```

2）`defaultMeta()` 的 `stats` 块：

```js
      hiddenRooms: 0, voidRifts: 0, singleSchoolClears: 0,
      barrelKills: 0
```

3）`normalizeMeta()` 的 `base.stats` 块：

```js
    singleSchoolClears: Math.max(0, Math.floor(Number(rawStats.singleSchoolClears) || 0)),
    barrelKills: Math.max(0, Math.floor(Number(rawStats.barrelKills) || 0))
```

### 1.4 奖励口径修正与共享函数（补丁 D）

**事实校正**：`achievements.json` 注写「22 条 aether 合计 23」，逐条相加为 **26**；`maxAetherReward` 已被外部改为 **26**，所以当前恰好不夹 0。函数按传入 `cap` 工作，若上限回落 12 仍会正确显示「已记入档案」。

先粘 **D-1** 可立刻收口文案；**D-2** 是同口径重构，粘了 D-2 就不需要 D-1。

#### D-1 纯文案替换（零逻辑）

锚点：`announceAchievement()` 内 `reward.aether` 的 else 分支与末尾 else 分支。

```js
    rewardText = aetherGained > 0 ? ('初始奥能 +' + aetherGained) : '已记入档案';
  } else {
    rewardText = '已记入档案';
  }
```

原字面量 `'初始奥能已满'`、`'无奖励'` 改为 `'已记入档案'`。判断顺序、传参、toast 结构均不变，属纯文案。

#### D-2 抽共享函数 `achRewardText(id, granted, cap)`

1）插到 `announceAchievement` 的 JSDoc 之前（顶层函数声明，不依赖闭包）：

```js
/**
 * 成就奖励文案（主文件与面板共用，纯函数，不读取任何闭包状态）
 * @param {string} id 成就 id
 * @param {number} granted 本次实际到账的奥能；未达成或未结算传 null
 * @param {number} [cap] 奥能叠加上限；缺省读 META_PROGRESS_CONFIG.maxAetherReward
 * @returns {string} 有卡给卡，有实得给数字，其余统一「已记入档案」
 */
function achRewardText(id, granted, cap) {
  const item = META_PROGRESS_CONFIG.byId[id];
  const reward = (item && item.reward) || {};
  if (reward.cards) return '开局多一张卡';
  if (!reward.aether) return '已记入档案';
  const limit = Number.isFinite(cap) ? cap : META_PROGRESS_CONFIG.maxAetherReward;
  const actual = Math.max(0, Math.min(Math.floor(Number(granted) || 0), limit));
  return actual > 0 ? '初始奥能 +' + actual : '已记入档案';
}
window.achRewardText = achRewardText;   // 面板是独立 IIFE，必须挂 window 才能单独调用
```

2）`announceAchievement()` 的整段 `rewardText` 分支替换为一行调用：

```js
  /* 与面板同一口径：实得 > 0 报数字，夹成 0 或无奖励统一「已记入档案」 */
  const rewardText = achRewardText(item.id, aetherGained, META_PROGRESS_CONFIG.maxAetherReward);
```

**为什么能独立调用**：函数只读全局 `META_PROGRESS_CONFIG.byId` 与三个入参，不碰 `state`、`meta`、`saveMeta`。面板 IIFE 通过 `window.achRewardText` 调用即可；实际到手值由面板自己的 `settleRewards()` 按完成时间重放得出（见 §5.1），**不需要新增存档字段**。唯一限制：面板必须与主文件同页内联；独立预览页没有主文件时走 §5.1 的同规则兜底。

**D-2 临时副本实测**：**+8 行 / +626 字节**；主文件语法、面板语法、旧文案清除、两边同函数调用共 6 项静态检查全 PASS（`tools/merge_audit/apply_itemD.js` + `verify_itemD.js`）。

### 1.5 总开关

沿用既有配置布尔，不新增：

```js
META_PROGRESS_CONFIG.enabled = false;   // 关闭全部成就检查与发奖（含新增 16 条）
```

### 1.6 预算（临时副本实测，非估算）

| 指标 | 合并前 | 合并后 | 变化 |
| --- | ---: | ---: | ---: |
| 行数 | 62,776 | 62,818 | **+42** |
| 字节 | 2,676,227 | 2,680,421 | **+4,194** |
| 帧内 p95 | — | — | **无变化**：新增逻辑只在 `checkMetaAchievements`（事件驱动）与爆桶击杀时执行，不在 `update`/`render` 每帧路径 |

### 1.7 粘完跑什么

```powershell
node tools/arcane_ach.js      # A0–A7：面板行数=配置数、进度条、存档一致、零报错
node tools/arcane_audit.js    # U1–U8：面板不出视口、零运行时报错
```

通过标准：两条命令全 PASS，且设置页档案标题显示「成就 N / 38」。
（临时副本的静态验收已跑过：语法 1 段 PASS、条目 38 PASS、9 条口径 PASS、计数器 3 处 PASS、报数口径 PASS。）

---

## 2. UI kit v1.5.6 / ui-patch 差集

**准入：只合差集，禁止整段粘贴 `ui-patch.css`。** 主文件在 `C1-10 · UI kit 接入` 段已落地绝大部分；整段粘贴会用 `--jj-*` 覆盖既有实现，且 760 结算宽会撞既有回归断言。

### 2.1 21 项逐项比对

| # | 项 | 补丁值 | 主文件当前值 | 判定 |
| --- | --- | ---: | --- | --- |
| 01 | 卡条宽 | 960 | 960（`--modal-w`） | 已落地，剔除 |
| 01 | 卡高 | 176 | 176 | 已落地，剔除 |
| 01 | 卡圆角 | 12 | 12（`--ui-card-r`） | 已落地，剔除 |
| 01 | 稀有度条 | 4 | 4 | 已落地，剔除 |
| 01 | 图标砖 | 44 | 44（SVG 24） | 已落地，剔除 |
| 02 | 顶栏高 | 64 | 64 | 已落地，剔除 |
| 02 | 血条高 | 10 | 10 | 已落地，剔除 |
| 02 | 状态胶囊 | 26 | 26 | 已落地，剔除 |
| 02 | 卡格高 | 68 | 68 | 已落地，剔除 |
| 02 | 卡组列数 | 6 | 6 | 已落地，剔除 |
| 03 | 结算面板宽 | **760** | **960**（`var(--modal-w)`） | **冲突：取 960** |
| 03 | 死因条高 | **38** | 自适应（多行叙事） | **差集：要补** |
| 03 | 楼层主数值 | **38** | 主文件无此节点（`.result-summary` 不存在） | **死选择器，剔除** |
| 03 | 数据格列数 | 3 | 3 | 已落地，剔除 |
| 03 | 重开按钮高 | **44** | ≈40（padding 撑高） | **差集：要补高度** |
| 04 | 设置网格 | 2 | 2 | 已落地，剔除 |
| 04 | 行高 | 40 | 40 | 已落地，剔除 |
| 04 | 开关宽 | 40 | 40 | 已落地，剔除 |
| 04 | 开关高 | 22 | 22 | 已落地，剔除 |
| 04 | 滑钮直径 | **14** | **16** | **冲突：取 14** |
| 04 | 轨道高 | 4 | 主文件无独立轨道规则 | 无效项，剔除 |

「仅补丁有」的 5 项复核结果：

| 补丁独有项 | 复核 |
| --- | --- |
| 13 个内联 SVG 图标 | **已有**：主文件已有 12 个 `<symbol id="i-*">` + `REWARD_ICON_MAP`，其中 `i-cursor` 就是准心；无新增 |
| `JJUI.icon(name, size)` | **不需要**：主文件统一 `<use href="#i-*">`，再引入一套 API 只会出现双图标源 |
| 结算宽 760 | **拒绝**：`arcane_tokens.js` 断言「五类弹窗宽度均取 `var(--modal-w)`」，改成 760 必挂 |
| 死因条 38 | **采纳**：真差集，但代价是隐藏 `.tower-quote` / `.tower-context` |
| 重开 sticky | **已有**：主文件早已 `position: sticky`，补丁重复 |
| 设置 2×2 / 40×22 | **已有** |
| `revert()` | **不需要**：不引入 `JJUI.apply()` 就没有要摘的 class |

### 2.2 冲突项裁决

| 冲突 | 取哪个 | 为什么 |
| --- | --- | --- |
| 结算宽 760 vs 960 | **960** | 既有回归断言要求五类弹窗同宽；760 会让 `arcane_tokens.js` 直接 FAIL |
| 滑钮 14 vs 16 | **14** | `ui-kit.md` 的验收目标是 14；14px 在 22px 高开关里上下各留 4px，比 16px（上 2 下 4）更居中 |

### 2.3 差集补丁（只含新增内容，约 11 行 CSS）

锚点：主文件 `</style>` 之前（`C1-10 · UI kit 接入` 段之后）。

```css
  /* ============================================================
     合并审查线 · ui-patch 差集（只补 v1.5.6 未覆盖的 3 项）
     作用域 body.jj-ui；去掉 body 上的 jj-ui 即整体回退
     ============================================================ */
  body.jj-ui .tower-voice {
    height: 38px; min-height: 38px; box-sizing: border-box;
    padding: 0 12px; align-items: center; overflow: hidden;
  }
  body.jj-ui .tower-voice .tower-orb { display: none; }
  body.jj-ui .tower-voice .tower-body { display: flex; align-items: center; gap: 8px; min-width: 0; }
  body.jj-ui .tower-voice .tower-quote,
  body.jj-ui .tower-voice .tower-context { display: none; }
  body.jj-ui .result-modal > .btn[data-action="restart"] { height: 44px; box-sizing: border-box; }
  body.jj-ui .switch::after { top: 4px; left: 4px; width: 14px; height: 14px; }
  body.jj-ui .switch[aria-checked="true"]::after { transform: translateX(18px); }
```

挂开关（锚点：`</body>` 之前、主脚本之后）：

```html
<script>
  /* ?uidiff=off 关闭差集；默认开启。只加一个 body class，不改任何 DOM/逻辑 */
  if ((new URLSearchParams(location.search).get('uidiff') || '') !== 'off') {
    document.body.classList.add('jj-ui');
  }
</script>
```

**总开关**：`?uidiff=off`（等价于手动删掉 `body.jj-ui`）。

### 2.4 预算

| 指标 | 变化 |
| --- | --- |
| 行数 | **+13**（11 行 CSS + 2 行脚本） |
| 字节 | **≈ +450** |
| 帧内 p95 | **无变化**（纯 CSS，且隐藏两个文本节点反而少合成两个 layer） |

### 2.5 粘完跑什么

```powershell
node tools/arcane_tokens.js   # 五类弹窗必须仍取 var(--modal-w)（760 冲突的守门断言）
node tools/arcane_audit.js    # U8 死亡结算不出视口、sticky 重开可点
```

**提醒主线**：不要整段粘 `ui-patch.css`；它会把 760 宽、16px 滑钮、预览页专用 `.result-summary` 规则一起带进来，其中前两项会直接破坏 v1.5.6 与既有断言。

---

## 3. tools/sim_panel

**准入：可直接合**（离线目录，不进发布包）。

### 3.1 与主文件同步状态（抽样核对）

| 参数 | sim `config.js` | 主文件 | 结论 |
| --- | --- | --- | --- |
| baseHp / baseAether | 100 / 100 | 100 / 100 | 同步 |
| baseRegen / killAether | 16 / 6 | 16 / 6 | 同步 |
| contactDamage / contactInterval / contactLock | 7 / 0.85 / 0.32 | 7 / 0.85 / 0.32 | 同步 |
| floorScale / speedScaleCap | 1.07 / 1.8 | 1.07 / 1.8 | 同步 |
| enemyHpMul / globalHpMul | 0.9 | 0.9 | 同步 |
| 难度三档 hpMul | 2.05 / 2.60 / 2.70 | 2.05 / 2.6 / 2.70 | 同步 |
| 首领 hpBase / hpFloorMul / hpCap | 1250 / 1.30 / 3200 | 1250 / 1.30 / 3200 | 同步 |
| 首领 damageScale / aetherRegenMul | 0.9 / 2.0 | 0.9 / 2.0 | 同步 |
| 火球 cost/cd/dmg | 15 / 0.55 / 24 | 15 / 0.55 / 24 | 同步 |

**唯一问题**：`config.js` 顶部注释里的行号已漂（`GAME_CONFIG L5677` 实际 5902、`DIFFICULTY L7171` 实际 7396、`ENEMY L9911` 实际 10142、`BOSS L13592` 实际 13835、`MAGIC L8726` 实际 8960）。符号名都在，建议删掉行号只留符号名——这是**注释修正**，不影响任何数值。

### 3.2 调参落地位置

主文件（改这里才是真改游戏）：
- `GAME_CONFIG`（全局战斗/经济）
- `DIFFICULTY_CONFIG`（三档）
- `ENEMY_CONFIG` + `ENEMY_BUDGET_CONFIG`（血量/数量）
- `MAGIC_CONFIG` / `TECH_CONFIG` / `RELIC_CONFIG` / `FUSION_CONFIG`
- `BOSS_CONFIG` / `REGION_CONFIG.deep`

离线模拟（追随上述改动）：
- `tools/sim_panel/config.js`（镜像）
- 跑 `node tools/sim_panel/run.js` → 重写 `results.json` 与 `烬_数据面板.html`

**总开关**：不需要（不参与运行时）。

**预算**：0 行 / 0 字节 / p95 0。

**粘完跑什么**：

```powershell
node tools/sim_panel/run.js
```

---

## 4. 后续交付（预留槽位）

每个模块交付时必须带齐这 6 项，否则不排队：

1. **准入判定**：能直接合 / 需要改什么
2. **可粘贴补丁**：锚点写函数名或配置段名
3. **一个总开关**：`?xxx=off` 或配置布尔
4. **预算**：行数 / 字节 / 帧内 p95
5. **验证命令**：粘完要跑的那一条
6. **回退方式**：删哪一段 / 关哪个开关

| 模块 | 需要重点核对的既有接入点 |
| --- | --- |
| 音效配乐 | 程序化合成约束（禁外部音频）、`playSfx` 调用点、`?audio=off` |
| 触屏适配 | `keydown/mousedown` 绑定、`state.uiV2`、`touch-action`、`?touch=off` |
| 无障碍 P0（§6） | `READABILITY_CONFIG.a11y`、`PIXEL_FX_CONFIG.tier.minGap`、30+ 个 `flashScreen` 直调点、`POSTFX_CONFIG` |
| 代码健康审计 | `window.__*` 调试口、`recordError`、`loop()` 兜底 |
| 成就面板 | 必须读 `META_PROGRESS_CONFIG.achievements.length`，不能写死 8 |
| 存档界面 | `normalizeMeta()` 白名单 + `META_SCHEMA_VERSION = 9`，新增字段必须夹紧 |

---

## 5. 成就面板 `ach-panel.js` + `ach-panel.css`（队列 #6）

**准入：已在手，可按序合。** 交付件为 [ach-panel.js](file:///D:/其他/TRAE宝/奥术工程师/ach-panel.js)（1,502 行 / 54,373 B，17:30 外部更新版）、[ach-panel.css](file:///D:/其他/TRAE宝/奥术工程师/ach-panel.css)（961 行 / 30,284 B）、[ach-panel.md](file:///D:/其他/TRAE宝/奥术工程师/ach-panel.md)、`ach-preview.html`。令牌前缀 `--ach-*`，不与主文件 class 冲突。

### 5.0 准入前提（硬性，单独成节，不许并进代码注释）

> **顺序不可颠倒：必须先把 §1.2「补丁 B」的 9 条 `case` 粘进 `metaMetricValue()`，再接面板。**
>
> 面板的 `progress` 走 `metaMetricValue(a.metric)`。若先接面板、后补 case，`dailyCleared / codexEnemies / codexRelics / codexCards / talentLevels / wagerWins / sacrifices / barrelKills / challenge10Clears` 这 9 条会一直返回 `default: 0`，界面上永远显示 0 进度，且看起来像面板 bug。
>
> 验收时先确认 `metaMetricValue('barrelKills')` 能拿到非 0（用爆桶杀一只小怪），再开面板。

### 5.1 奖励数字必须与主文件同一口径（第二个硬性前提）

- 面板显示**实际到手值**，不显示名义值；夹成 0 显示「已记入档案」，**不能出现「+0」「奥能已满 · 实得 0」**。
- 统一入口是 §1.4 的 `achRewardText(id, granted, cap)`；`announceAchievement()` 与面板都调它，面板**不要**自己拼文案。
- 好消息：面板 17:27 版已有 `settleRewards()`，会按达成时间重放、逐条扣减上限，算出每行 `aetherGain / aetherProjected`。所以「实际到手」不需要新增存档字段，直接把 `gain` 传给共享函数即可。

面板侧补丁，锚点 `ach-panel.js` 的 `function rewardText(item, row)`（整函数替换）：

```js
  function rewardText(item, row) {
    var gain = null;
    if (item.reward && item.reward.aether) {
      gain = row ? (row.done ? row.aetherGain : row.aetherProjected) : null;
    }
    /* 游戏内必须走主文件共享函数；预览页没有主文件时才走下面的同规则兜底 */
    if (typeof window.achRewardText === 'function') {
      return window.achRewardText(item.id, gain, MAX_AETHER_REWARD);
    }
    if (item.reward && item.reward.cards) return '开局多一张卡';
    if (item.reward && item.reward.aether) {
      return gain > 0 ? ('初始奥能 +' + gain) : '已记入档案';
    }
    return '已记入档案';
  }
```

原实现里的 `'奥能已满 · 实得 0'`、`'起手卡已满'` 随替换消失。`rewardText(item, row)` 两个调用点（卡片与详情）已传 `row`，无需改签名。

### 5.2 已实测性能（交付方数据，1440×1000 / DPR 1 / Edge 131 无头 / `file://`）

| 指标 | 实测 | 与项目预算 |
| --- | --- | --- |
| 38 条网格热渲染（中位） | **3.9 ms** | 满足 |
| 整个面板挂载 | **4.5 ms** | 满足 |
| 打开面板时滚动 p95 帧间隔 | **8.4–8.5 ms** | ≤ 9.5 ms，满足 |
| >20 ms 帧 | **0** | 满足 |
| `performance.getEntriesByType('resource')` 中 http(s) | **0** | 满足零外部请求 |
| 页面 JS 错误 | **0** | 满足 |

**虚拟滚动结论保留：38 条全真实渲染，不加虚拟列表。** 热渲染 3–4 ms、滚动 p95 8.4 ms，加虚拟滚动只会增加复杂度与状态同步风险。后续任何人提「更工程化」都不改这条。

### 5.3 接入补丁

1）`ach-panel.css` 全部内容粘到 **`</style>` 之前**（与 §2 差集同一锚点；先粘 §2 再粘面板，避免两段覆盖 `body.jj-ui` 的层叠顺序）。

2）`ach-panel.js` 全部内容粘到 **`</body>` 之前、主脚本 `loop()` 之后**（内联，不新增外部 `<script src>`，保持双击即开零请求）。

3）18 行挂载代码，锚点：设置页档案入口 `renderArchivePanel()` 的调用处。

```js
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:90;display:grid;place-items:center;background:rgba(4,7,12,.55);display:none';
  document.body.appendChild(host);

  // progress 的 key 是成就 id，value 必须来自主文件 metaMetricValue（9 条 case 已先粘）
  const progress = {};
  ACHPanel.data.forEach(a => { progress[a.id] = metaMetricValue(a.metric); });
  const panel = ACHPanel.mount(host, { progress, completedAt: state.meta.achDates || {} });

  // 打开：显示宿主；关闭：销毁 + 移除，避免遮住战斗输入
  window.openAchPanel = () => { host.style.display = 'grid'; panel.refresh(); };
  host.addEventListener('click', e => {
    if (e.target === host) { panel.destroy(); host.remove(); window.openAchPanel = () => {}; }
  });
```

### 5.4 总开关

`?ach=off`（或 `<html data-ach="off">`）：`mount()` 直接返回 `ok:false` 空实现，**不创建任何 DOM**。关闭证明已实测：`?ach=off` 下 0 个面板、0 张卡。

### 5.5 预算

| 指标 | 变化 |
| --- | --- |
| 行数 | **+2,463**（JS 1,502 + CSS 961） |
| 字节 | **+84,657**（54,373 + 30,284） |
| 帧内 p95 | 常驻 **无变化**（面板不挂进 `update`/`render`）；打开时滚动 p95 8.4–8.5 ms |

这是队列里单笔最大的合并（约 +3.1% 包体）。若后续要压，优先压 `ach-panel.js` 内嵌的 38 条快照（改成运行时从主文件 `META_PROGRESS_CONFIG.achievements` 读取），**不要**先压样式。

### 5.6 粘完跑什么

```powershell
node tools/arcane_ach.js      # 成就数据/存档口径仍全 PASS
node tools/arcane_audit.js    # 零运行时报错
```

外加面板自带验收：双击 `ach-preview.html`，切换「全部完成 / 全未完成 / 混合」；再开 `?ach=off` 确认 0 DOM。游戏内验收：爆桶杀一只小怪后开面板，`barrel_20` 进度必须不是 0。

---

## 6. 无障碍 P0 补丁（队列 #7）

**准入：P0 核心可粘；字号 / 色盲配色两个 P1 子项待审。** 数据直接采用 [a11y.md](file:///D:/其他/TRAE宝/奥术工程师/a11y.md) 的实测（1,370 个取样节点 / 152 失败），但**逐条复核了能不能粘**，其中审计报告有一处锚点写错、一处调色方向必须先判、一处已落地。

**内部顺序写死，不许颠倒**：假旋钮去留 → 对比度 → 字号 → 色盲 → 动效三档。

---

### 6.0 第一顺位：`a11y.contrast` 是假旋钮（结论：摘字，不实装）

| 检查 | 结果 |
| --- | --- |
| 字段定义 | `READABILITY_CONFIG.a11y = { colorblind: false, contrast: 'normal' }` |
| 行为读取 | **0 处**（`a11y.contrast` 点访问 0 次，字面量仅定义处 1 次） |
| 存档落盘 | **没有**：`defaultMeta()` 只有 `colorblind`，`normalizeMeta()` 没有 `contrast` 分支 → 改了也存不下来 |
| 设置页 | 标签写「色盲 / 高对比」，但 `setColorblind()` 只写 `a11y.colorblind`；没有任何写 `contrast` 的入口 |
| 结论 | 「高对比」只存在于**标签和注释**里，实际零行为 |

**为什么不实装**：真正的高对比要改 40 多个 Canvas 取色点（元素徽记、房间名、血条、伤害数字），只加一个 CSS class 做不到；做一个「只改 CSS」的高对比，等于把假旋钮升级成假旋钮 Pro。**本轮摘字，保留能工作的 `colorblind`**；以后要真做，单开一项，范围必须包含 Canvas 调色板。

补丁（4 处 UI 文案 + 1 行配置，不改存档字段名）：

```js
// 1) READABILITY_CONFIG：删掉零引用字段
  a11y: { colorblind: false },
```

```html
<!-- 2) 设置页：标签与状态文字不再承诺"高对比" -->
<label id="cbModeLabel">色盲辅助</label>
<span class="setting-state" id="cbModeStateText">默认关 · 形状 / 纹理</span>
```

```js
// 3) setColorblind 的 toast（两处）与 JSDoc 改名
  showToast(on ? '色盲辅助：已开启（形状 + 纹理）' : '色盲辅助：已关闭（恢复纯色）', ...);
```

```html
<!-- 4) 设置页说明：同上 -->
开「色盲辅助」后血条 / 附着 / 处决 / 事件门徽改用形状与纹理区分，不依赖颜色；
```

代码注释里另有 13 处「色盲 / 高对比」（均在描述形状 / 纹理冗余），建议顺手改成「色盲辅助」，不阻塞合并。

**验收**：`grep "a11y.contrast"` → 0 命中；设置页与 toast 搜「高对比」→ 0 命中。
**预算**：净 **-1 行 / ≈ -40 B**。

---

### 6.1 对比度：报告给了 5 行，实际只需粘 4 行

| 位置 | 实测 | 目标色 | 现在 | 判定 |
| --- | ---: | --- | --- | --- |
| 锁定卡名 `.mini-card.is-locked .m-name` | 3.44 | `rgba(150,180,214,.75)` | `rgba(150,180,214,.55)` | **待粘** |
| 铭文 `.spirit-line .spirit-tag` | 4.04 | `rgba(143,228,255,.55)` | `rgba(143,228,255,.5)` | **待粘** |
| 楼层竖排 `body.ui-v2 .floor-head span` | 4.37 | `rgba(150,222,255,.72)` | `rgba(150,222,255,.66)` | **待粘** |
| 稀有文字（新增 `--rar-rare-text`） | 4.37 | `#58b0ff` | 取 `--rar-rare` | **待粘** |
| 史诗文字 `--rar-epic-text` | 3.81 | `#c9a6ff` 已生效 | 已生效 | **已落地，剔除** |

> 复核说明：报告引用的行号（L999 / L1387 / L3967 / L95）已漂，但**选择器全部命中**；史诗那条在 v1.5.6 奖励卡段已用 `var(--rar-epic-text)`，再粘一次是重复。

**补丁（锚点：`</style>` 之前，v1.5.6 奖励卡段之后）**：

```css
  /* ============================================================
     无障碍 P0 · 对比度（作用域 body.a11y-p0；摘掉 class 即整体回退）
     ============================================================ */
  body.a11y-p0 { --rar-rare-text: #58b0ff; }
  body.a11y-p0 .mini-card.is-locked .m-name { color: rgba(150, 180, 214, .75); }
  body.a11y-p0 .spirit-line .spirit-tag { color: rgba(143, 228, 255, .55); }
  body.a11y-p0.ui-v2 .floor-head span { color: rgba(150, 222, 255, .72); }
  body.a11y-p0 .reward-card.rarity-rare .r-rarity { color: var(--rar-rare-text); }
```

**为什么加 `body.a11y-p0`**：既提供总开关，也顺手压过 `.reward-card .r-rarity { color: var(--rc); }`（3 类）与史诗规则（3 类）的同特异度竞争，不依赖插入顺序。

挂开关（锚点：`</body>` 之前、主脚本之后）：

```html
<script>
  /* ?a11ycss=off 关闭对比度补丁；默认开启 */
  if ((new URLSearchParams(location.search).get('a11ycss') || '') !== 'off') {
    document.body.classList.add('a11y-p0');
  }
</script>
```

**验收**：按 a11y.md §8.1 同一流程（隐藏文字截纯背景 + 矩形中位色）复测 7 屏，目标正文 0 个 < 4.5:1；再在 2560×1440 / DPR2 复跑一次。
**预算**：**+11 行 / ≈ +330 B**（8 行 CSS + 3 行脚本）。

---

### 6.2 字号：本轮**不粘**（P1 待审）

实测：58 处 CSS + 16 处 Canvas < 11px，最小 **6px = 4.5pt**（小地图事件副标签）；1080p 下 9.5px 及以下不可读。

**裁决：不批量替换，只立规则。** 理由：字号一动就改布局（HUD 顶栏、卡组 6 列、设置行高 40 都是按当前字号算的），批量 `font-size` 替换必须逐屏截图目测，属于独立一轮。本轮只写死两条规则供后续执行：

- 正文（卡名 / 稀有度 / 奖励说明）≥ **11px**，奖励说明 ≥ 12px；
- Canvas 中「需要读」的文本 ≥ **12px**，纯图标角标 ≥ 10px；6px 那处先改图标 + 全屏地图文字。
- **不许为了达标把 HUD 挤变形**：字号提不上去就缩文案 / 换行，不许动布局尺寸。达不到的屏单独列出来，不改全局。

**不新增 `--fs-min` 令牌**——目前没有消费点，加了就是第二个假旋钮。

---

### 6.3 色盲配色：不动色相，先做文字双编码（P1 待审）

实测：冰 `#7fd8ff` / 雷 `#8fe4ff` 正常视觉 ΔE **7.7**（已接近同色）；稀有 / 史诗在 deutan 下 ΔE **2.4**。

**裁决：本轮不改雷的主色。** `#8fe4ff` 同时用在元素徽记、灵光球、弹道与粒子，直接换成 `#ffe08a` 会改变元素身份，且需要重新校验所有带雷的画面。先做零色相风险的一步：**所有元素标签前加单字（火 / 冰 / 雷 / 毒 / 湿），伤害数字加元素后缀**；颜色的四视觉 ΔE ≥10 复算放到下一轮。现有 `colorblind` 开关已提供形状 / 纹理兜底（徽记 5 种外框 + 字形），不是零冗余。

---

### 6.4 动效三档（P0 核心）

#### 6.4.1 `minGap 0.25 → 0.34` 对照：结论**不改**

**先纠正锚点**：`minGap` 不在 `FX_TIER_CONFIG`，而在 **`PIXEL_FX_CONFIG.tier`**（`tier: { maxLayers: 1, minGap: 0.25 }`），唯一读取点是 `requestScreenFx()` 的 `if (prev && prev.t < cfg.tier.minGap) return false;`。报告写成 `FX_TIER_CONFIG.minGap` 是**错的**，按那个名字去找会改错配置。

**对 S0/S1/S2 的影响：零。** 命中分级的闪白在 `fxTierFlush()` 里直接调 `flashScreen()`，不经过 `requestScreenFx()`；改 `minGap` 碰不到分级合并、S2 节流或打击感。

**对整屏演出链的影响：真实存在。** 离线复刻同一段判定（`tools/merge_audit/a11y_compare.js`）对照结果：

| 链路（前一段开始后 0.30s 请求后一段） | minGap 0.25 | minGap 0.34 |
| --- | --- | --- |
| 清房 → 下楼 | 放行 | **拦截** |
| 清房 → 首领阶段 | 放行 | **拦截** |
| 里程碑 → 下楼 | 放行 | **拦截** |
| 清房 → 里程碑（同档） | 放行 | **拦截** |

0.26s / 0.30s / 0.33s 三档里，三条跨档链全部是 ●/○：0.34 把「低档 → 高档」的盲窗从 250ms 拉到 340ms（+90ms），而且 `requestScreenFx` 返回 `false` 时**调用点不重试**（清房、下楼、Boss 阶段三处都直接忽略返回值）——不是延后 90ms，是**这次演出直接没了**。只有「清房 → 里程碑」这条同档链在 0.26s 被 `dur*0.65` 规则先拦下，与 `minGap` 无关。

**更关键的是它治不了目标问题**：审计测到的 4 次/秒来自 **30 多个 `flashScreen()` 直调点**（受伤、融合、拾取、下楼、Boss、元素；全文 33 处命中含 1 处定义），根本不经过 `requestScreenFx`，`minGap` 一个都挡不住。

**裁决**：`minGap` 保持 **0.25**；频率上限只在 `flashScreen()` 里做。

#### 6.4.2 闪白硬上限：滚动 1 秒 ≤3 次（与同帧合并不打架）

- **层级不同，不抵消**：`fxTierFlush()` 在上游把同帧多段合成 1 次闪白；秒级上限在下游 `flashScreen()` 按时间窗计数。脚本已断言 `fxTierFlush` 定义在 `flashScreen` 之前，两者串联而非互相覆盖。
- **必须用滚动窗口，不能用固定秒桶**：同一组时间戳，滚动窗口把 4 连压到 3；固定秒桶在跨秒边界会漏出 **50ms 内 4 次**（实测 `990/1000/1010/1020/1030/1040` → 滚动 3 / 桶 4）。
- **必须顺手修一个老 bug**：现在 `flashScreen` 的收尾 `setTimeout` 没有序号令牌。实测最小间隔 **103.7ms**，而闪白时长有 110ms / 140ms——前一次的定时器会把新闪**提前摘掉**，看起来就是更碎的爆闪。这就是「4 次/秒」读数的一部分来源。加 `flashSeq`，只让最新一次收尾。
- **上限只数「已放行」**：被丢的写进 `state.feel.flashCapped`，验收才能量到丢弃次数（`flashSuppressed` 仍归 `reduceFlash` 专用）。
- **S2 有优先级**：`fxTierFlush` 的 S2 闪白不能被前面的拾取闪白挤掉，`flashScreen(color, ms, priority=1)` 的调用不参与丢弃，但仍计入窗口。

顺带可见：Boss 阶段与下楼本来就是**同帧两连闪**（`flashScreen` 直调 + `requestScreenFx` 内部再闪一次）。上限会把这层冗余自然收掉，属于预期收益。

#### 6.4.3 三档参数写进 `POSTFX_CONFIG`（不另起配置）

锚点：`POSTFX_CONFIG` 的 `vignette` 行之后、闭合 `};` 之前。**只有倍率 / 闸门，基准值仍留在 `FX_TIER_CONFIG` / `HITSTOP_CONFIG`，不复制数字。**

```js
  /* ---- 无障碍 P0 · 动效三档（唯一真值源；只存倍率与闸门，不复制基准值） ---- */
  motion: {
    level: 2,                       // 0 关 / 1 低 / 2 标准（持久化到 state.meta.motionLevel）
    tiers: {
      0: { shakeScale: 0, shakeMaxPx: 0, flash: false, hitStopScale: 0, lowHpBpm: 0 },
      1: { shakeScale: 0.25, shakeMaxPx: 2, flashAlphaMax: 0.10, flashMsMax: 60,
           flashPerSec: 0.5, hitStopScale: 0.7, hitStopMaxMs: 40, lowHpBpm: 60 },
      2: { shakeScale: 1, shakeMaxPx: 8, flashAlphaMax: 0.32, flashMsMax: 90,
           flashPerSec: 3, hitStopScale: 1, hitStopMaxMs: 120, lowHpBpm: 96 }
    }
  }
```

读档（锚点：`flashScreen` 定义之前加一个顶层函数）：

```js
/**
 * 读取当前动效档位参数（0 关 / 1 低 / 2 标准）
 * 旧存档没有 motionLevel 时按 2 标准，行为与改造前一致
 * @returns {{level:number, cfg:Object}} 档位与对应参数
 */
function motionTier() {
  const lv = state && state.meta && Number.isFinite(state.meta.motionLevel)
    ? state.meta.motionLevel : POSTFX_CONFIG.motion.level;
  const level = [0, 1, 2].indexOf(lv) >= 0 ? lv : 2;
  return { level: level, cfg: POSTFX_CONFIG.motion.tiers[level] };
}
```

**TDZ 说明（已断言）**：`POSTFX_CONFIG` 定义在 47,135 行附近，`flashScreen` 定义在 37,574 行附近——函数定义在前、**执行在后**，主循环 54,369 行才启动，所以运行时读取安全。前提是**不要在脚本解析阶段调用** `flashScreen` / `triggerShake`（当前没有这种调用）。

#### 6.4.4 三个消费点（改判定，不改基准值）

1）`triggerShake()`：把 37709–37710 两行换成下面四行（**2 档必须与现在逐字节一致**）：

```js
  const mt = motionTier();
  const reduce = (state && state.meta && state.meta.reduceShake) ? 0.35 : 1;
  const accessScale = Math.min(reduce, mt.cfg.shakeScale);
  const capPx = (mt.level === 2)
    ? (cap ? Math.min(power, FEEL_CONFIG.shakeMaxAmp) : power)
    : Math.min(power, mt.cfg.shakeMaxPx);
  const amp = capPx * accessScale;
```

> 2 档：`Math.min(1, 1) = 1`，与现在逐字节一致；开着「减少屏震」时 `Math.min(0.35, 1) = 0.35`。0 档即使「减少屏震」开着也是 0（取更严者，两个开关不会互相抵消）。Boss / 大招 `cap=false` 在 2 档仍可突破普通上限；0 档 `amp=0` 走既有的 `shakeMinAmp` 丢弃分支，`droppedShake` 照常 +1，`a11yShakeScale` 验收锚点不破。

2）`requestHitStop()`：把 37683 那一行换成三行（乘档位倍率 + 夹上限，0 档直接 skipped）：

```js
  const mt = motionTier();
  const capped = Math.min(sec, HITSTOP_CONFIG.maxSeconds, (mt.cfg.hitStopMaxMs || 0) / 1000)
    * mt.cfg.hitStopScale;
  if (capped <= 0) { HITSTOP_STATS.skipped += 1; return state && state.hitStop ? state.hitStop : 0; }
```

3）`flashScreen(color, msOverride, priority)`：加时间窗 + 序号令牌 + α 上限（新增小工具 `clampFlashAlpha`）：

```js
/**
 * 把 rgba 颜色的 alpha 夹到上限（1 档 α≤0.10 / 2 档 ≤0.32）
 * @param {string} color 原色
 * @param {number} max 上限
 * @returns {string} 夹后的颜色
 */
function clampFlashAlpha(color, max) {
  const m = /rgba?\(([^)]+)\)/.exec(color || '');
  if (!m) return color;
  const p = m[1].split(',').map((s) => parseFloat(s));
  if (p.length < 4) return color;
  p[3] = Math.min(p[3], max);
  return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + p[3] + ')';
}
```

```js
function flashScreen(color, msOverride, priority) {
  const mt = motionTier();
  // 既有「关闭闪白」开关优先，行为不变
  if (state && state.meta && state.meta.reduceFlash) {
    state.feel = state.feel || {};
    state.feel.lastFlashMs = 0;
    state.feel.flashSuppressed = (state.feel.flashSuppressed || 0) + 1;
    return;
  }
  // 0 档：等同「关闭闪白」
  if (!mt.cfg.flash) {
    state.feel = state.feel || {};
    state.feel.lastFlashMs = 0;
    state.feel.flashCapped = (state.feel.flashCapped || 0) + 1;
    return;
  }
  if (!ui.flash) return;
  // 滚动 1 秒窗口（只数已放行；priority=1 不参与丢弃）
  const now = Math.round((Number(state.elapsed) || 0) * 1000);
  const rec = (state.feel.flashTimes = state.feel.flashTimes || []);
  while (rec.length && now - rec[0] >= 1000) rec.shift();
  if (!priority && rec.length >= mt.cfg.flashPerSec) {
    state.feel.flashCapped = (state.feel.flashCapped || 0) + 1;
    return;
  }
  rec.push(now);
  const ms = Math.min(Number(msOverride) || FEEL_CONFIG.flashMs, mt.cfg.flashMsMax);
  const seq = (state.feel.flashSeq = (state.feel.flashSeq || 0) + 1);
  state.feel.lastFlashMs = ms;
  ui.flash.style.background = clampFlashAlpha(color || 'rgba(255, 107, 127, 0.3)', mt.cfg.flashAlphaMax);
  ui.flash.classList.add('is-on');
  setTimeout(() => {
    if (state.feel.flashSeq !== seq) return;   // 旧闪的定时器不许摘新闪
    ui.flash.classList.remove('is-on');
  }, ms);
}
```

并在 `fxTierFlush` 的 S2 闪白行加优先级：`flashScreen(color, tier.flashMs, tierNum >= 2 ? 1 : 0);`

#### 6.4.5 设置入口（必须是能改状态的按钮，不再造假旋钮）

HTML 锚点：设置页 A11Y 段 `infoLayerModes` 那个 `setting-row` 之后。

```html
          <div class="setting-row">
            <label id="motionLevelLabel">动效强度</label>
            <div class="aim-modes" role="group" aria-label="动效强度档位" id="motionLevelModes">
              <button type="button" class="aim-mode" data-motion-level="0">关</button>
              <button type="button" class="aim-mode" data-motion-level="1">低</button>
              <button type="button" class="aim-mode is-active" data-motion-level="2">标准</button>
            </div>
            <span class="setting-state" id="motionLevelStateText">标准</span>
          </div>
```

绑定锚点：`document.querySelectorAll('[data-info-mode]').forEach(...)` 之后。

```js
  document.querySelectorAll('[data-motion-level]').forEach((btn) => {
    btn.addEventListener('click', () => setMotionLevel(btn.getAttribute('data-motion-level')));
  });
```

setter（锚点：`setColorblind()` 之后）：

```js
/**
 * 设置「动效强度」三档并写入永久存档
 * 0 关 / 1 低 / 2 标准；只改表现层，不动玩法数值
 * @param {number|string} level 档位
 */
function setMotionLevel(level) {
  const lv = [0, 1, 2].indexOf(Number(level)) >= 0 ? Number(level) : 2;
  state.meta.motionLevel = lv;
  saveMeta();
  syncA11yToggles();
  showToast('动效强度：' + ['关', '低', '标准'][lv], 'success');
}
```

存档三处（`motionLevel` 必须进白名单，否则改了也存不下）：
- `defaultMeta()`：`colorblind: false,` 后加 `motionLevel: 2,`
- `normalizeMeta()`：`base.colorblind = ...` 后加 `base.motionLevel = [0,1,2].indexOf(raw.motionLevel) >= 0 ? raw.motionLevel : 2;`
- `syncA11yToggles()`：按 `data-motion-level` 刷 `is-active` / `aria-pressed`，并写 `motionLevelStateText`

设置页说明块（`setting-note` 末尾）补一句，避免玩家以为新开关和老开关打架：

```html
            「动效强度」0 关 / 1 低 / 2 标准；与「减少屏震」「关闭闪白」取更严者，
            0 档等于同时关掉屏震 / 闪白 / 顿帧。
```

#### 6.4.6 总开关、预算、验收

- **总开关**：`state.meta.motionLevel = 2` 即回到当前行为；另可 `?motion=off` 强制 2 档（一行判断，便于 A/B）。
- **预算**：约 **+110 行 / +4,000 B**（估算；粘到临时副本后覆盖实测值）。帧内 p95 无变化：`flashScreen` 每帧最多一次 `while` 清窗口（数组 ≤3），`triggerShake` / `requestHitStop` 各多一次对象读取。
- **验收**：
  ```powershell
  node tools/merge_audit/a11y_compare.js   # 19 项锚点/对照断言
  node tools/arcane_assert.js              # 主回归
  node tools/arcane_audit.js               # 零运行时报错
  ```
  实机：压力战 60s 采样闪白时间戳，断言任意 1s ≤3；0 档全程 `shake=0 / flash=0 / hitStop=0`；屏震开关仍能显示 35%。

**修完必须重测，并把读数拆成两列**：真实闪白次数（以 `state.feel.flashTimes` 里的时间戳为准）与测量噪声（被旧 `setTimeout` 提前摘掉的截断次数）。原始 37 次/20s 里混着截断假象，下降不许全部记在“上限”头上。

---

## 7. 代码健康审计补丁（队列 #8，占位待交付）

**准入：占位。补丁到货后由本审查线先验，再进主线。**

### 7.1 已下裁决（交付方按此出补丁）

| 类别 | 裁决 |
| --- | --- |
| 14 个零引用函数 | 做成删除补丁，**但必须逐条 grep 复核**（见 §7.2） |
| 20 条死 CSS + 19 个死变量 | 做成删除补丁，按「选择器 / 变量名」逐条列清单 |
| 26 个未接线配置键 | 做成删除补丁，逐键标注「无读取点」证据 |
| 新增死配置（本轮实测） | `REGION_CONFIG.transition.skippable`、`CORRIDOR_PATROL_CONFIG.noContactDamage`：零引用且无 UI，随 26 键清单一并删；`a11y.contrast` 不归审计，由 §6.0 当场摘 |
| 武器融合提示 54 行 | **先 grep 证明调用链恒为空，才准删**；拿不出证据就不删 |
| 武器相关 1,067 行 | **本轮一行不删，只交清单**（供下轮单独评审） |
| 调试 API、`u11cLegacyEvents` | **禁区，禁止触碰**；补丁抬头必须写明这两个禁区 |

补丁抬头模板（缺这段直接打回）：

```text
【禁区】本补丁不删除、不改写任何调试 API（window.__*）与 u11cLegacyEvents。
【证据】每条删除均附 grep 命令与命中结果（0 命中才算零引用）。
【回退】每条删除独立成段，可单条还原，不打包成一次性大删。
```

### 7.2 我要做的复核（不信「零引用」三个字）

对 14 个函数逐个跑三类检索，任一有活引用即打回：

1. 定义点：`function NAME` / `const NAME =`
2. 静态引用：`NAME(`、`NAME,`、`'NAME'`、`"NAME"`（含字符串注册表、事件表、定时器表）
3. 动态引用：`window['NAME']`、`obj[NAME]`、`eval`/`Function` 拼接、`data-*` 映射表

重点怀疑对象：被 `setTimeout` / 事件监听 / 存档迁移表以**字符串**引用的函数；这类函数在纯文本 grep 里看似零引用，删了会在特定存档或特定房型下报错。

### 7.3 总开关与回退

无运行时开关——**不贴补丁即关闭**。每条删除独立成段，出问题按段还原，不做整包回滚。

### 7.4 预算

负增长，具体行数/字节等补丁到货后实测填入；帧内 p95 预期无变化（删的都是非每帧路径）。到货后我会在临时副本上先跑一遍实测，再填这一行。

### 7.5 粘完跑什么

```powershell
node tools/arcane_assert.js   # 主回归
node tools/arcane_audit.js    # 零运行时报错
node tools/arcane_ach.js      # 成就/存档不受删减影响
```

外加逐段 grep 复核记录（14 函数 / 54 行 / 禁区三项），附在补丁 PR 说明里。

---

## 8. 三槽存档界面 `save-ui.js` + `save-ui.css`（队列 #9）

**准入：文件已在手，但两条硬性条件必须先进代码，否则只能降级只读。**

交付件：[save-ui.js](file:///D:/其他/TRAE宝/奥术工程师/save-ui.js)（2,071 行 / 86,945 B）、[save-ui.css](file:///D:/其他/TRAE宝/奥术工程师/save-ui.css)（1,081 行 / 34,533 B）、[save-ui.md](file:///D:/其他/TRAE宝/奥术工程师/save-ui.md)、`save-ui-preview.html`、`tools/save_ui_probe.js`。

> **别混线**：这套是《烬》的三槽局内存档；已排队的 `save.js` 是剑境世界存档，两者不是一回事。

### 8.0 准入条件一：`__roamDebug.p2` 可写性检查（必须是运行前检查，不是文档一句话）

**本次核查结果**：主文件 `__roamDebug.p2` 的四个方法当前都在位 —— `snapshot()`、`rawStore()`、`writeRawStore(text)`、`loadSlot(slot)`。

**但现状有隐患**：`save-ui.js` 的 `detectAdapter()` 只判断 `if (p2)`，不看方法齐不齐。一旦外部改动删掉任一方法，仍会进入 game 模式，玩家点「覆盖」会以为存上了、其实没写。

补丁（锚点：`detectAdapter()` 内 `var p2 = global.__roamDebug && global.__roamDebug.p2;`）：

```js
    var p2 = global.__roamDebug && global.__roamDebug.p2;
    /* 运行前检查：四个方法全部可用才算“可写”；缺一个就降级只读，
       避免玩家点「覆盖」以为存上了、其实没写 */
    var P2_METHODS = ['snapshot', 'rawStore', 'writeRawStore', 'loadSlot'];
    var p2Missing = P2_METHODS.filter(function (k) { return !p2 || typeof p2[k] !== 'function'; });
    global.JJSAVE_PROBE = { p2: !!p2, missing: p2Missing, ok: p2Missing.length === 0 };
    if (p2Missing.length === 0) {
      // ……原 game 分支整段原样保留……
```

`standalone` 分支的返回对象补两个字段：

```js
    return {
      mode: 'standalone',
      readonly: true,
      missing: p2Missing,
```

只读时必须让玩家看得见，锚点 `renderAlerts()` 内 `preview` 分支之后：

```js
    if (runtime.adapter && runtime.adapter.mode === 'standalone') {
      out += '<div class="jjsv-alertbar is-warn">'
        + '<span class="jjsv-alertbar__text"><b>只读模式：</b>未连接到主文件调试口，'
        + '「覆盖 / 立即存档 / 新局」不会写入。可用：查看 / 导出 / 导入 / 清槽。</span>'
        + '</div>';
    }
```

同时把卡片上的「覆盖」「新局」按现有 `saveDisabled` 口径加 `disabled` 与 `title`，不能只靠提示条。

验收口：`window.JJSAVE_PROBE` 必须能读出 `{p2, missing, ok}`，供 `tools/save_ui_probe.js` 断言。

### 8.1 准入条件二：导出只搬单槽（UI 文案，不靠玩家读文档）

导出抽屉里必须直说「只搬这一局」。锚点 `renderExportDrawer()` 内 `<h3 id="jjsvExportTitle">` 的说明行之后：

```js
      + '<p>两条路：复制到剪贴板 / 下载文件。file:// 下若下载被拦截，用复制即可。</p>'
      + '<p class="jjsv-check__hint">只搬这一局的存档：不含结晶 / 天赋 / 图鉴等全局进度；'
      + '换设备后从这一局继续，全局进度不会跟过去。</p>'
```

复用既有 `.jjsv-check__hint`，不新增 CSS。导入抽屉沿用同一句，避免「导入即整号迁移」的误解。

### 8.2 接入补丁

1）`save-ui.css` 全部粘到 `</style>` 之前。
2）`save-ui.js` 全部粘到 `</body>` 之前、主脚本 `loop()` 之后（内联，不新增 `<script src>`）。
3）开局入口，锚点：标题页/开局前的按钮绑定处。

```js
  window.JJSAVE_CONFIG = { hotkey: 'F8', launcher: true, storageKey: 'arcane_run_slots_v1' };
  window.JJSAVE.open();   // 标题页打开三槽；玩家点「继续」由模块调 p2.loadSlot
```

### 8.3 总开关

`?saveui=off`（`?saveui=0` 同效）：不注入浮层，只在页脚留一行说明，主文件存档逻辑照旧。

### 8.4 预算

| 指标 | 变化 |
| --- | --- |
| 行数 | **+3,152**（JS 2,071 + CSS 1,081） |
| 字节 | **+121,478**（86,945 + 34,533，约 **+4.5%** 包体） |
| 帧内 p95 | **无变化**（浮层不挂 `update`/`render`）；打开时帧耗时交付方未给数，接入后补测 |

### 8.5 粘完跑什么

```powershell
node tools/save_ui_probe.js   # 53 项验收（含 9 层刷新继续、396B 导出/导入、改字符报错）
node tools/arcane_assert.js   # 主回归，确认存档模块未污染主文件
node tools/arcane_audit.js    # 零运行时报错
```

外加手验两条：`save-ui-preview.html?saveui=off` 不出现浮层；只读模式下「覆盖」按钮必须禁用且 `JJSAVE_PROBE.ok === false`。

### 8.6 状态

- 主文件未改动；本审查线复核基线：**62,993 行 / 2,691,500 字节 / MD5 1107F15F**（17:48:49 外部写入，比 17:21 那次多 57 行 / 3,407 字节；本项全部锚点复跑仍 PASS）。
- 53 项验收全过、零外部请求、零异常、危险色对比度 7.16:1 与 11.99:1，均已由交付方实测。

---

## 9. 常驻检查：假旋钮三方对账（每轮必跑）

**规矩（已定）**：凡是「配置里有、UI 上有、存档里没有」的开关，都是假旋钮；**假旋钮一律摘掉，不许降级成「半可用」**。宁可少一个开关，不要多一个骗人的。

**命令**：`node tools/merge_audit/fake_knob_audit.js`（只读主文件、不写盘；有确定项时退出码 1）

**三方**：

| 方 | 数据来源 | 对不上意味着 |
| --- | --- | --- |
| 配置 | `const X_CONFIG = { ... }` 里的开关类字段（`enabled / mode / level / contrast / reduce* / ...`） | 零按名访问 = 空壳 |
| UI | `syncA11yToggles()` / `motionTier()` 实际读的 `state.meta.X` | 有开关 |
| 存档 | `defaultMeta()` 键 + `normalizeMeta()` 的 `base.X` | 缺了 = 改了存不下来 |

**两类判定**：
- **A（必报）**：UI 读的 meta 键不在存档白名单 → 半可用，按规矩摘掉或补齐白名单。
- **B（确定 / 疑似）**：开关类配置字段零引用 → 空壳。嵌套字段已排除「`const conf = X.y; conf.enabled`」这种别名读法，数据表（`TAG_CONFIG.fire.*`）不参与，避免把 `id / name / color` 当开关。

**当前基线（62,993 行 / 2,691,500 B）**：

| 判定 | 结果 |
| --- | --- |
| A | **3/3 PASS**：`reduceShake` / `reduceFlash` / `colorblind` 都在白名单 |
| B 确定 | **2 项**：`READABILITY_CONFIG.a11y.contrast`（§6.0 的假旋钮，待摘）、`REGION_CONFIG.transition.skippable`（死配置，无 UI，交 #8） |
| B 疑似 | **1 项**：`CORRIDOR_PATROL_CONFIG.noContactDamage`（无 UI 死配置候选，交 #8） |

合完 §6.0 后重跑应只剩 2 条死配置；#8 清掉后应到 **0，退出码 0**。`a11y.contrast` 不归代码审计——先由 §6.0 摘掉，再进这个检查才算闭环。

**新增开关的硬要求（三处缺一不可）**：`defaultMeta()` 加默认值 + `normalizeMeta()` 加 `base.X = ...` 类型收敛 + `syncA11yToggles()` 刷 UI 状态。只做前两步 = 能存但不显示；只做 UI = 能点但存不下来。

---

## 10. 首局教学 19 块（已粘 v1.6.0，2026-11-08；机械版 O 系列 26 处替换）

**准入：四条硬伤中的两条教学项 + 自检同源已核销（2026-11-08，见 §10.5）；本块已于当晚先于归因块写入主文件，落盘后 20 层全跑冒烟 PASS，随 v1.6.0 出包。**

原准入理由（自检跑 `onboard-event-preview.html` 分叉、块 18 缺调试方法）已作废：v2 自检改为在 `reviewfix_apply.js` 生成的**主文件补丁副本**上跑，调用 `__roamDebug.onboard` / `onboardOnRoomEnter` / `grantRunCrystals` / `openReward` 等生产函数。结果：`arcane_onboard.js` **31/31 PASS**（已知红 0 条）、`reviewfix_onboard_test.js` **24 条 PASS**（含 4 条新增）。

### 10.1 硬伤（不改不进队列）

1. **老玩家判定读 live `bestFloor` → 新玩家爬到第 5 层会被静默。**
   块 11 的 `onboardReturningPlayer()` 每次调用都读当前 `state.meta.bestFloor`；而 `bestFloor` 在进层时就 `Math.max` 更新（`descend` / 清房路径多处）。`skipBestFloor = 5`，所以首局玩家一进第 5 层，之后所有 `onboardEvent`（`firstCrystal` / `lowHp` / 精英）都被 `returning` 拦掉。**只有新玩家会碰到，老玩家永远复现不了。**
   修法：判定必须在本局开始**快照**，和 `onboardSkipAll` 同一时机：
```js
// onboardBeginRun() 内
state.onboardReturning = onboardReturningPlayer();
```
```js
// onboardEvent() 内，改读快照
if (state.onboardReturning) return false;
```

2. **`showFloor()` 先抬 `bestFloor` 再调 `onboardBeginRun()`。**
   顺序是 `generateFloor(target)` → `onboardBeginRun()`，所以 `showFloor(5)` 一进来就是 returning=true → 播种 5 条 → 之后 `event()` 恒 false。旧脚本全靠 `showFloor`，等于**补丁自带一个把测试全掐死的入口**。
   修法：`showFloor` 在 `generateFloor` **之前**快照 returning，与 `skipBefore` 一起恢复；或给 `onboardBeginRun(forceNew)` 参数。

3. **`runs >= 2` 这条是对的（已替你验）。**
   两个真实入口都是先 `+1` 再调：`restartRun`（`state.meta.runs += 1` → `onboardBeginRun()`）、`startGame` 同序；`defaultMeta()` 是 `runs: 0`，`normalizeMeta` 不动它。首局 1、第二局 2，`>= 2` 正确。写成 `>= 1` 会把新玩家首局播种掉——这个错存在，但当前补丁没犯。
   **缺口**：调试入口 `reset(true)` 不动 `runs`，跑过一局后 runs≥2，主文件里再也模拟不出新玩家。块 17 必须补 `resetRun({ clearSeen, runs, bestFloor })`。

4. **`step.floor` 同名不同义，块 18 不是可选。**
   三个读者全在主文件：帮助页速查（`data-quickref-floor`，输出「第 N 层 · 动词」）、设置页回顾行、调试 `info().steps[].floor`。不粘块 18，低血会显示成「第 4 层 · 低血」——低血可在任意层触发，**这是语义错误，不是文案瑕疵**。块 18 必须与块 2 同粘。
   同时块 8 删掉了 `onboardStepForFloor()` 的唯一调用点，该函数随即变零引用——**必须同块删除**，否则 #8 审计会把它记成新的死函数。

### 10.2 中等问题（随块改）

- `onboardTick()` 的出队渲染不检查 `ONBOARD_CONFIG.enabled`：调试 `set({enabled:false})` 时，队列里的提示还会弹。开头补 `if (!ONBOARD_CONFIG.enabled) return;`。
- `lowHp` 插点：`state.fx.lowHpFired = true;` 在 `spiritSay('lowHp')` 之前，建议插到 `spiritSay` **之后**，避免教学条先抢旁白。
- 低血阈值只有一处：`damagePlayer` 的 `state.fx` 分支判 `< lowHpTrigger`，复位在 40%，没有第二套阈值——你担心的重复判断不存在。
- CSS 从「右缘垂直居中」改「右上 64px」：`.onboard-hint` 只有 `right/top`、没有 `left`，替换成立；但 64px 可能压楼层条/首领条，**必须逐屏截图目测**，不进自动断言。

### 10.3 会被改到的旧测试（单列，不许混在补丁里）

| 脚本 | 依赖旧行为 | 补丁后 |
| --- | --- | --- |
| `tools/arcane_onboard.js` | 18 处：`info().steps` 五个旧 key、`showFloor(1..5)` 出提示、`trigger()`、`progress/active/pendingToast` | **全红**，需按事件断言重写 |
| `tools/arcane_playthrough.js` | 4 处：`showFloor` 每层出提示、按 `step.floor` 过滤 | 第 5 层必红，其余拿不到提示 |
| `tools/arcane_help.js` | `[data-quickref-floor]` 取 5 行 | 块 18 后取到 0 行，断言空转 |
| `tools/_ac_new_arcane_help.js` | 同上（副本） | 同上 |
| `tools/arcane_room.js` | 只用 `onboard.set({enabled})` | 不受影响 |

结论：**教学改造 = 补丁 + 4 个脚本（含 1 个副本）同步改，独立一个提交。**

### 10.4 预算

19 块 + 3 处修法，估 **+150 行 / +5,500 B（待临时副本实测）**。帧内：`onboardTick` 每帧最多 5 次比较，可忽略。

### 10.5 核销记录（2026-11-08）

> 验证方式：`node tools/reviewfix_apply.js` 生成 `.reviewfix/index_patched.html`（主文件补丁副本）→ `node tools/arcane_syntax.js "<副本>"` PASS → 两份自检跑在副本上 → 跑完删除副本。**主文件本轮未由本次核销写入**；但 19:27 检测到外部写入方改动（2,694,263 B / SHA256 `3929CB87…`，原为 2,693,678 B / `92B649BC…`），本次副本与自检均基于改动后的主文件。

| # | 原问题 | 现状 | 是否改动 | 证明方式（断言名 + 结果） |
| --- | --- | --- | --- | --- |
| 1 | 老玩家判定读 live `bestFloor` | 只读开局快照 `state.onboardBaseline = {runs, bestFloor}`，`onboardReturningPlayer()` 不再读 live 值 | **已改**（块 4 + 块 10） | 副本 46134–46140 只有 `return state.onboardBaseline...`；断言 `PASS 第二局 returning → true`、`PASS showFloor 基线=0 → {"runs":1,"bestFloor":0}`、`PASS showFloor 不判老档 → false`、`PASS showFloor 未播种 → {}`、`PASS showFloor 后仍能触发`；全量 `PASS 老档 bestFloor ≥5 整轮跳过：skipAll=true、不弹提示、event 恒 false` |
| 2 | `showFloor()` 先抬 `bestFloor` 再调 `onboardBeginRun()` | 先取 `bestBefore` → `generateFloor` → `onboardBeginRun({ bestFloor: bestBefore })` | **已改**（块 19） | 副本 58404–58414；断言 `PASS showFloor 基线=0`（副本上 `bestFloor` 已变 5 而快照仍 0）、`PASS showFloor 不判老档`、`PASS showFloor 未播种`、`PASS showFloor 后仍能触发` |
| 3 | `runs >= 2` | 两个真实入口先 `+1` 再判定，保持 `>= 2`；补 `resetRun({clearSeen,runs,bestFloor})` 供人工/自检重建新号 | **判定未改 + 补调试口**（块 18） | 断言 `PASS 第二局 returning → true`、`PASS 第二局全拒绝 → [false×5]`、`PASS resetRun 可重建新号 → {"runs":1,"bestFloor":0}` |
| 4 | `step.floor` 同名不同义 | `step.n` + `data-quickref-step`，`onboardStepForFloor()` 同块删除 | **已改**（块 2 定义 + 块 16/17/18 三个读者） | 断言 `PASS 序号 n=1..5 → [1,2,3,4,5]`；`arcane_help.js` 16/16 PASS（速查取到 5 行、文案「第 n 步 · 动词」） |
| — | 自检不同源（preview 分叉 + `__previewDebug`） | 自检跑补丁副本、调用生产函数 | **已改** | `reviewfix_onboard_test.js` 的 PAGE 默认 `.reviewfix/index_patched.html`；调用 `__roamDebug.onboard` / `onboardOnRoomEnter` / `grantRunCrystals` / `openReward` / `__roamDebug.p1.damagePlayer`（后者内部执行真实 `damagePlayer`，主文件 57187–57196），全文无 `__previewDebug`；块 18 已补 `resetRun / event / modalLine / info()` 扩展 |

**§10.2 中等问题状态**：`onboardTick()` 的总开关门禁**已补**（`if (!ONBOARD_CONFIG.enabled) return;`，块 8），新增断言 `PASS 关闭后不出队`、`PASS 队列仍挂起 → [{"key":"firstChoice"}]`、`PASS 重开后队列继续`。`lowHp` 与 `spiritSay` 的顺序属观感项，**未改**；CSS 右上 64px 需人工逐屏目测，**不进自动断言**（原条目已注明）。两项均不影响本次可粘判定。

---

## 11. 死亡归因 11 块（已粘 v1.6.0，2026-11-08；机械版 D 系列 14 处替换）

**准入：四条硬伤中的两条归因项 + 自检同源已核销（2026-11-08，见 §11.6）；本块在教学块之后写入主文件，落盘后再跑一次 20 层全跑冒烟 PASS，随 v1.6.0 出包。**

### 11.1 硬伤 1：`ground` 类不可达

补丁把 `hazard → ground`（「地面持续」）。但全文 `kind:'hazard'` 只有两处，都在首领危险区路径上，且两处都带 `bossKind: state.boss ? state.boss.kind : null`；`p1CategoryOf()` 第一条判断就是 `if (cause.bossKind) return 'boss'`。结果：

- 真实游戏里 `ground` **恒为 0**；
- 新加的 `if (share('ground') >= 0.45)` **永远走不到**；
- 预览自检的「环境」场景用手工注入**不带 `bossKind` 的 hazard**，测的是现实里不存在的数据（连「近战」场景都凭空出现 `ground 7%`）。

这和 §9 的假旋钮同型：**UI 上有、实际到不了**。二选一：
- **(a) 删掉 `ground`，hazard 留在 `env`**（1 行回退，推荐）；
- **(b)** 真要「地面持续」，先让 hazard 有独立的持续伤害标记、并与首领危险区分开，再拆类——当前没有这种伤害，别先造标签。

### 11.2 硬伤 2：首领含贴身，标签会失真（你点的那条，确认会）

首领贴身走 `kind:'contact'` + `bossKind`，被并进 `boss`。基础数值（`BOSS_CONFIG.<kind>`）：

| 来源 | 单次 | 频率 | 可持续输出 |
| --- | --- | --- | --- |
| 贴身接触 | 13–15 | 冷却 0.9s | **≈14–17 / 秒**（站着不动也吃） |
| 远程弹 | 11–12 | 每轮齐射 | 间歇 |
| 重击 | 24–30 | 长冷却 | 点状 |

贴脸 2 次 ≈ 1 次重击；被逼到角上贴身 5 秒 ≈ 5 次 ≈ 65–75 点。所以「50% 死于首领」里混着大量「贴脸蹭死」，**结论会失真**。补丁写了「已知限制」，但按你的规矩不能留含糊。推荐**标签 + 子计数**（不新开大类，改动最小）：

```js
// p1NoteIncoming() 的 bossKind 分支内追加
if (cause && cause.bossKind && cause.kind === 'contact') {
  L.incoming.bossContactDmg = (L.incoming.bossContactDmg || 0) + v;
  L.incoming.bossContactHits = (L.incoming.bossContactHits || 0) + 1;
}
```
```js
// P1_VERDICT_LABEL.boss
boss: '被首领（含贴身）',
```
```js
// p1DeathVerdict() 的 boss 句尾追加
+ (contactShare > 0
  ? '，其中贴身接触 ' + Math.round(contactDmg) + ' 点（' + Math.round(contactShare * 100) + '%）'
  : '')
```

若对方坚持拆成两类，要同时改 `P1_CATEGORY_META`、`p1IncomingList`、`data-p1-share` 配色三处，成本高且会和 `arcane_p1.js` A3 的标签计数打架。

### 11.3 与既有测试的兼容（A3–A6 不用改）

- A3 正则要求 `data-p1-share → pct → value` 顺序：补丁把 `max/top` 追加在 `value` 之后，**顺序未变**，PASS。
- A4 构造 `byCat` 只有 6 键、不含 `ground`；`p1IncomingList` 过滤零值，**不炸**。
- A5/A6 只判阈值与标签属性；`近身 → 近战` 不在断言里（属无谓 diff，建议保留「近身」）。
- 新增断言只需两条：`ground` 不再出现；`boss` 判决句含「其中贴身接触」且子计数与 `cause.kind === 'contact'` 对得上。

### 11.4 次要点

- `p1SpikeFor()` 的 `deathFloorPct` 分母是**死亡层总承伤**，`pct` 分母是**全局总承伤**，基数不同。一层只吃 20 点也能算出 100% → 骤升误报。建议加「本层总承伤 ≥30」门槛，或把规则句写成「本层内占比」。
- `p1SummaryText()` 用 `state.floor` / `death.name`：普通怪给怪名、首领给首领名，成立；`death` 为 null 有兜底。
- 自检不同源：脚本依赖 `__previewDebug.p1.scenario/html`，补丁只给 `__roamDebug.p1.summary/detail/spike`。要主文件可验，块 10 需补 `scenario()` 注入器与 `html()` 取面板，否则只能算规格。

### 11.5 预算

11 块 + 子计数，估 **+90 行 / +3,300 B（待实测）**。帧内：只在受伤/死亡时累计，无每帧开销。

### 11.6 核销记录（2026-11-08）

> 验证方式同上：副本 `.reviewfix/index_patched.html` + `reviewfix_death_test.js`（跑在副本上，调用生产函数），跑完删除副本；主文件本轮未由本次核销写入（19:27 的改动来自外部写入方，非本操作）。

| # | 原问题 | 现状 | 是否改动 | 证明方式（断言名 + 结果） |
| --- | --- | --- | --- | --- |
| 1 | `ground` 类不可达、`collapse` 无生产者 | 两个分类**已删**；`hazard` 归 `env`；`P1_CATEGORY_META` 只剩 6 类 | **已改**（块 1 / 块 7） | 副本 48670–48677 六类无 `ground`；`p1CategoryOf()`（48736–48747）无 `ground` / `collapse` 分支；断言 `PASS 无 ground → ["boss","melee","ranged","env","self","other"]`、`PASS hazard→env → "env"`、`PASS collapse 无分支`；`PASS 合计 100` |
| 2 | 首领贴身被并进 `boss`，标签失真 | 标签改「被首领（含贴身）」；`bossContactDmg/Hits` 子计数；判决句追加「其中贴身接触 X 点（占总承伤 Y%，N 次）」；**不新开大类** | **已改**（块 2 / 块 4 / 块 7） | 断言 `PASS 标签含（含贴身） → "被首领（含贴身）"`、`PASS 判决 tag=boss`、`PASS 贴身子句 40 点`、`PASS 贴身子句 67%`、`PASS 贴身计数 2 次 → {"dmg":40,"hits":2,"pct":67}`、`PASS 贴身不计入新分类 → ["boss"]`、`PASS bossKind 优先` |
| — | 自检不同源（`__previewDebug.p1.scenario/html`） | 自检跑补丁副本 | **已改** | `reviewfix_death_test.js` 的 PAGE 默认 `.reviewfix/index_patched.html`；直接调用生产函数 `p1CategoryOf()` / `buildReviewHtml()`，伤害经 `__roamDebug.p1.damagePlayer()` 注入（其内部调真实 `damagePlayer`），全文无 `__previewDebug`；输出 INFO 中 `categories` 即生产常量 |

**与难度无关的旁证**：同一补丁副本上 `death_parity.js` 750 局/页逐局比对——总死亡 108 vs 108、逐局一致 **750/750**、逐格差异 0（结论已够用，本轮不再重跑）。

**11.4 遗留状态**：`p1SpikeFor()` 的 `deathFloorPct` 分母口径维持原样（本层占比），判决句已写明「本层内」；属表述项，不构成硬伤。

---

## 13. 路虚影（队列 #12，2026-11-08 实测 · 本线只读 + 出补丁）

**TARGET_MD5：`96C942621E7FBC3ADC9D8FA102BFB7EF`**（64,261 行 / 2,755,687 B / mtime 21:54:20）。
**套用后（内存实测，非估算）：64,274 行 / 2,756,510 B / MD5 `A778F3D757DA643165939E3C10F649B4`** → **+13 行 / +823 B / 帧内 0**。
> 写权线仍在写这个文件（21:43:30 `BA68478F` → 21:53:28 `4A5B39DC` → 21:54:20 `96C94262`），**MD5 每几分钟就变一次**；本补丁两处锚点已用 `apron_patch_budget.js` 在最新基线上断言「各命中 1 次」，不依赖行号，所以基线漂移不影响可粘性。

> **探针出处（不许含糊）**：A/B 实测时刻 21:50:14，当时基线 `BA68478FE49A6DFA25C8B3F4CD368FAC`（2,740,252 B）。21:53:28 写权线又写入一版（`4A5B39DC…`），**apron 段逐字未变**——`apron: { width: 120, alpha: 0.26, scale: 0.5 }`、`ring(rect, alpha * 0.75, …)`、`sceneSeam` 那条 1px 描边全部仍在原位，且本补丁两个锚点在**当前基线各命中 1 次**（`apron_patch_budget.js` 已断言，命中数 ≠1 直接抛错）。所以实测数对两版都成立。复核命令见 13.5。

### 13.1 定性（一句话）

**不是路的残影，是「地面延伸带」画进了房间。** 走廊腿从「房间中心」连到「房间中心」，`ring()` 又给每条腿的左右各铺 120px 渐变带 → 带子必然压进两端房间；延伸带在 `drawFog()` **之后**才贴上去，而已探索房间的雾是透明的 → 带子原样留在房间地面上。

### 13.2 证据链（五条，全部可 grep，不写行号）

| # | 环节 | 事实（绘制调用的实际参数） | 产生的现象 |
| --- | --- | --- | --- |
| 1 | `PARALLAX_CONFIG.apron` | `{ width: 120, alpha: 0.26, scale: 0.5 }` → 房间带 **66/255**，走廊腿 `alpha*0.75 = 0.195` → **50/255** | 「半透明」——但 26% 的**实色地板色**足够压过地面明暗 |
| 2 | `connectRoomsWithCorridor()` | 横腿 `x` 从 `roomA.cx` 到 `roomB.cx`（`Math.abs(bx-ax)+36`）；竖腿同理由 `roomB.cx` 起算 | 腿矩形与两端房间**各重叠半个房宽**，所以带子不是"路的两侧"，是"路上 + 房内" |
| 3 | `ring()` 左右两支 | `g.fillRect(rect.x - width, rect.y - 18, width, rect.h + 36)`（`width = 120`） | 竖腿的 `rect.h` ≈ 房高 → 竖带 **贯穿整房高**；`GAME_CONFIG.corridorWidth = 96` + 两侧 120 = 336px 一条带，房内可见 120px |
| 4 | 主渲染顺序 | `drawFog()` → `drawVoidDepth()` → `drawVoidApron()` → `if (FOG_CONFIG.secondPass) drawFog()` | 二次雾只压**未探索**区；已探索房间透明 → 带子留下。源码注释自己写的也是"会在地板/走廊上重新描出'路的虚影'" |
| 5 | `ring()` 末尾 | `g.strokeStyle = sceneSeam(theme); g.lineWidth = 1; g.strokeRect(…)` | 截图里那条**右缘更亮的竖线**（1px 接缝高光，世界坐标 → 屏上 ≈2px） |

补充（为什么"不跟着地砖透视"）：延伸带在 `apronCanvas` 里是**世界坐标的矩形 + 线性渐变**，没有走 `paintCorridor()` 的地砖纹理管线；它压在走廊地砖之上、雾之下，所以看到的是"一块平的玻璃板"，不是斜向地砖。

### 13.3 四嫌疑逐个裁决

1. **「路的地面延伸带」= 就是它。** 13.2 五条闭环；补丁命中的唯一一处就是 `paintVoidApron()` 的 `ring()` 输出。
2. **半透明障碍物深度排序 = 不是它。** 带子的 alpha 在 `apronCtx` 里**恒定 66/255（房间）/ 50/255（走廊腿）**；深度排序错只改"谁盖谁"，不会改自身 alpha，也不会给出「矩形 + 120px 线性渐变」的边缘。探针在**同一帧只读 `apronCtx`** 就能复现，完全不经过实体绘制。
3. **双次渲染残留 = 不是它。** `sceneCanvas` 每层只烘焙一次，主循环每帧只 `drawImage` 一次；若是叠两遍，alpha 应为 `1-(1-0.195)² ≈ 0.352`（90/255），实测恒为 50/255。
4. **`motionTrail` 残影 = 不是它。** 采样条件是 `DASH_CONFIG.trailEnabled === true && state.meta.motionTrail === true`；`DASH_CONFIG.trailEnabled` 为 `false` → 前半恒 false，残影采样**根本不执行**。且带子不随冲刺出现/消失，是静态烘焙层。（另：`defaultMeta.motionTrail: true` 与 UI「默认关 · 0.18s 短衰减」不一致，是**另一条假旋钮**，已在 §9 清单，与本条无关。）

### 13.4 补丁（两处，函数级锚点）

**① 配置段 `PARALLAX_CONFIG.apron`** —— 把原来那一行替换为：

```js
  apron: { width: 120, alpha: 0.26, scale: 0.5, clipToFloors: true },
```

**② 函数 `paintVoidApron(theme)`** —— 在三个 `ring(...)` 循环（`state.rooms` / `state.corridorRects` / `state.hiddenRoom`）之后、`state.parallax.apron = { ... }` 之前插入：

```js
  // 修复「路的虚影」：延伸带只允许存在于任何地面矩形之外（总开关 cfg.apron.clipToFloors）。
  // 走廊腿的左右 120px 渐变条必然整段压进它两端连接的房间；延伸带在 fog 之后
  // 以地板色叠上去，而探索过的房间雾是透明的 → 房间上留下半透明竖带 + 接缝高光。
  // 烘焙期抠一次，运行时零成本；开关置 false 即回到旧行为，供 A/B 复查。
  if (cfg.apron.clipToFloors !== false) {
    const punchFloor = (rect) => {
      if (!rect || !rect.w || !rect.h) return;
      g.clearRect(rect.x + 1, rect.y + 1, Math.max(0, rect.w - 2), Math.max(0, rect.h - 2));
    };
    state.rooms.forEach(punchFloor);
    (state.corridorRects || []).forEach(punchFloor);
    punchFloor(state.hiddenRoom);
  }
```

**为什么内缩 1px**：`ring()` 的接缝高光画在 `rect.x + 0.5` 上，内缩 1px 刚好保住"房间边界 → 延伸带"的过渡线，不会把房间外框也一起抠掉（否则房间看起来像浮在黑里）。
**总开关**：`clipToFloors`。置 `false` = 逐像素回到改前行为，可随时复跑 A/B；不需要新增设置页 UII（不要把它做成玩家可见旋钮）。

### 13.5 实测（同房间、同机位、同一帧）

- 环境：楼层 3 / 房间 5 / 走廊 11 / 秘藏房 1；`roomAlpha8 = 66`、`corridorAlpha8 = 50`。
- 采样：所有房间地面内缩 2px、2px 网格，共 **498,092** 点，读 `apronCtx` 的 alpha。
- 裁切：`shot()` 用 **玩家坐标** 作原点（不是 `state.cam`），所以 camA `{x:56,y:1103}` → camB `{x:44,y:1096}` 那 7px 缓动**不进对比**；两张图除延伸带一层外逐像素相同（怪已清空）。

| 阈值（alpha，满值 255） | 改前 | 改后 |
| --- | ---: | ---: |
| **> 32（明显亮带，肉眼一眼）** | **17.8%** | **0.0%** |
| > 16（可见） | 29.2% | 0.0% |
| > 3（任意非零） | 43.9% | 0.0% |

对比图（440×620，同一机位）：
- [ghost_before.png](file:///D:/其他/TRAE宝/奥术工程师/MERGE-QUEUE.assets/ghost_before.png)（391,788 B）
- [ghost_after.png](file:///D:/其他/TRAE宝/奥术工程师/MERGE-QUEUE.assets/ghost_after.png)（387,687 B）

复跑命令（一次无头、跑完自关）：

```powershell
node tools/merge_audit/apron_ghost_probe.js
```

**验收判据**：补丁粘入后跑同一脚本，`before.a32` 必须为 **0.0**（烘焙期已抠除，运行时再抠不该有变化）；`after` 三档同为 0。若 `before.a32` 仍非 0，说明抠除没跑在烘焙路径上（先查 `paintVoidApron` 是否在 `generateFloor` 之后仍被调用）。

### 13.6 预算与回退

| 项 | 值 |
| --- | --- |
| 行数 | +13 |
| 字节 | +823（含中文注释） |
| 运行时 | **0**（烘焙期一次，F3 = 17 次 `clearRect`） |
| 回退 | `clipToFloors: false`，两处都可不删 |

---

## 14. 出入口不可见（队列 #13，2026-11-08 · 定性 + 实测 + 补丁待审）

**TARGET_MD5：`96C942621E7FBC3ADC9D8FA102BFB7EF`**（§13 同一基线；本线只读）。
**结论一句话**：门**有**提示（H1 呼吸光 / 门槛箭头 / 门牌 / 小地图闪烁都已存在），但**门洞本身是一个没有填充的黑缺口**（门心亮度 15.4–19.5 vs 地面 58.5），整套提示只占 46×10 世界像素、且呼吸光只覆盖离玩家 340px 以内的门——缩到 25% 后全部塌成 1–2px 的噪点，所以"找不到入口"。

### 14.1 门是怎么画的（层 / 色值 / 描边 / 光，全部是现值）

| 项 | 现值 | 备注 |
| --- | --- | --- |
| 图层顺序 | `drawDoors()` 在 `render()` 里排在实体之前（`drawPlayer()` 之前） | 门在地板层，被角色与特效覆盖 |
| 门洞填充 | **无**。只是房间边缘的一个缺口，露出下面黑底 | 实测门心 26px 方块 mean **15.4–19.5**，同房间地面 **58.5** |
| 门框线 | `arcColor`：目标房已清 = `rgba(120,140,165,0.5)`；未清 = 房型色（battle `#3ee6ff` / elite `#ff6b7f` / boss `#ff3d6e`） | `lineWidth 2`，`alpha 0.5 + (未清 ? 0.2 : 0)` |
| 门框尺寸 | 两根 10px 短柱，间距 `ROOM_FLOW_CONFIG.doorBarWidth = 46` | 总占位 ≈ 46×10 世界像素 |
| 呼吸光（已有） | 26px 厚线性渐变，`base`：可通行 0.34 / 锁定 0.46 / 已探索 0.16；`pulseSpeed 2.4 rad/s` → 周期 **2.62s** | 只在 `dPlayer ≤ glowRange(340)` 时画 |
| 门槛箭头（已有） | 3 个 V 形，`lineWidth 2.2`，`alpha 0.72`，间距 13px，流速 34px/s | 从门心朝房心，最多到房间短边 45% |
| 门牌（已有） | 11px bold，盒高 18，底 `rgba(8,14,24,0.55)`，边 `alpha 0.42` | 未探索只写「? 未知」 |
| 贴近提示（已有） | 「按 E 进入」，≤90px 才出现 | 本机位 `hints = 0`（玩家在房心，离门 ~300px） |
| 落闸（已有） | 橙红能量幕 8px，渐变 `0.15→0.60`，7px 扫描线，`sin(t*6)` 呼吸 | 清场后 `anim=0`，不画 |

### 14.2 实测对比度（同房间同机位，像素实测，非估算）

机位：F3 / elite 房 618×624 / 玩家站房心偏下 30px / `zoom 0.85` / `dpr 1` / 画布 1250×765。采样：门心 26px 半径方块 vs 房心地面同尺寸方块。

| 度量 | 改前 | 改后（注入同款补丁） |
| --- | --- | --- |
| 环境（房心地面）mean | **58.5** | 58.9 |
| 门区域 mean（4 扇） | **15.4 / 15.6 / 19.1 / 19.5** | 53.9 / 35.6 / 52.2 / 55.5 |
| 门区域最亮像素 | 66 / 64 / 61 / **120** | **196 / 183 / 199 / 196** |
| **门区域与环境的最大亮度差（峰值）** | **61.5**（改前那 120 是门牌字，不是门洞） | **140.1** |
| 均值差（门 − 环境） | **−43.1 … −39.0**（门比地面暗） | −23.3 … −3.4 |

**"看不见"的数学原因**：均值差 43 阶本身够（≥20），但**面积只有 46×10 世界像素 ≈ 屏上 39×8.5px**；缩到 25% 后剩 10×2px，且两根门框线从 2px 掉到 0.5px（被抗锯齿抹平）。所以不是对比度不够，是**可辨面积不够**。

对比图：
- [door_before.png](file:///D:/其他/TRAE宝/奥术工程师/MERGE-QUEUE.assets/door_before.png)（100%）
- [door_before_25.png](file:///D:/其他/TRAE宝/奥术工程师/MERGE-QUEUE.assets/door_before_25.png)（25%）
- [door_after.png](file:///D:/其他/TRAE宝/奥术工程师/MERGE-QUEUE.assets/door_after.png)（100%，注入同款补丁）
- [door_after_25.png](file:///D:/其他/TRAE宝/奥术工程师/MERGE-QUEUE.assets/door_after_25.png)（25%）

**25% 判据（我自己看图判定）**：改前 25% 图里门只剩底部两三处模糊小点，**看不出是门**；改后 4 条青色光带指向 4 个门，**一眼可辨**。→ 改后 PASS，改前 FAIL。

> 顺带：`door_before.png` 中间那道从上到下的浅色竖带就是 §13 的路虚影（同一张图里两者都可见），可作为虚影的目视证据。

### 14.3 有没有非视觉提示

- **音效：没有门专用提示**。清场走 `requestScreenFx('clear')` + `triggerShake`，但**不发声**；`playSfx('clearAll')` 是"连杀阈值"音（`playComboThreshold`），不是清场音。
- **小地图：有**。`DOOR_VIS_STATS.minimapBlink = 5`（本帧 5 个可通行门对应房间在闪）。
- **粒子/箭头：有**（门槛 3 箭头，见 14.1）。
- 结论：**只有小地图闪烁**，屏幕上没有"门开了"的听觉提示。

### 14.4 清场瞬间 → 玩家走到门，平均要多久

**没有埋点，给不出这个数**。`state` 里没有任何"清场时刻 / 进门时刻"的成对时间戳（`room.cleared` 只有布尔）；`arcane_playthrough` 也只记层完成时间。要测这个数需要新增两个字段（`room.clearedAt` / `door.enteredAt`），属于统计线的工作，**不在本条补丁里**。

### 14.5 四件套：现状与新做

| 件 | 现状 | 最小改法 |
| --- | --- | --- |
| ① 地面光带（房心 → 门） | **没有** | 新增 `drawDoorGroundBeam()`，在 `drawDoors()` 的 H1 分支里画一道 `'lighter'` 渐变楔形光 |
| ② 门口呼吸光环 | 有，周期 2.62s、峰值约 +45 阶 | **只改一个参数**：`glowRange 340 → 620`（本房心到门 300–470px，340 时 4 扇门只有 1 扇发光） |
| ③ 清场瞬间全房门闪 + 音效 | **没有** | `onRoomCleared()` 里给本房门打 `flashAt`，`drawDoors()` 按 0.9s 衰减画一圈亮框；新增 `doorOpen` 短音（2 行配置） |
| ④ 门框描边 | 有，2px / alpha 0.5–0.7 | `lineWidth 2 → 3`、`alpha → 0.85`（两行常量） |

### 14.6 补丁（四处，函数级锚点；待实测后转可粘）

**① `DOOR_VIS_CONFIG`** —— 改一个值、加五个键：

```js
const DOOR_VIS_CONFIG = {
  enabled: true,          // 总开关（A/B：false 时只保留原有门框与 A1 信息板）
  groundBeam: true,       // ① 地面光带总开关（false = 退回只有门框 / 箭头 / 门牌）
  beamLength: 0.5,        // 光带长度 = min(房宽, 房高) × 该值
  beamAlpha: 0.38,        // 光带最亮处 alpha（'lighter' 混合；实测峰值 +140 阶）
  beamPulse: 2.3,         // 呼吸角速度 rad/s（周期 2.73s，落在 2.5–3.5s）
  flashDur: 0.9,          // ③ 清场门闪时长（秒）
  ...
  glowRange: 620,         // ② 原 340 → 620：玩家站在房心时四扇门都能发光
```

**② 新函数（放在 `drawDoorGlow()` 之后）**：

```js
/**
 * ① 地面光带：从门心朝房心的一道渐变楔形光，让玩家用余光就能看出"路在哪"
 * 用 'lighter' 混合叠在地板上，不遮挡角色与地面细节（总开关 DOOR_VIS_CONFIG.groundBeam）
 * @param {Object} door 门对象
 * @param {Object} vis doorVisFor 的状态结果
 * @param {Object} room 门所在房间
 * @param {number} t 全局时间（秒）
 * @returns {void}
 */
function drawDoorGroundBeam(door, vis, room, t) {
  if (!room) return;
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  let ux = door.x - cx;
  let uy = door.y - cy;
  const len = Math.hypot(ux, uy) || 1;
  ux /= len; uy /= len;
  const L = Math.min(room.w, room.h) * DOOR_VIS_CONFIG.beamLength;
  const halfStart = ROOM_FLOW_CONFIG.doorBarWidth * 0.5;
  const halfEnd = 10;
  const pulse = 0.78 + 0.22 * Math.sin(t * DOOR_VIS_CONFIG.beamPulse + door.x * 0.02);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(door.x, door.y, door.x - ux * L, door.y - uy * L);
  g.addColorStop(0, hexToRgba(vis.color, DOOR_VIS_CONFIG.beamAlpha * pulse));
  g.addColorStop(0.4, hexToRgba(vis.color, DOOR_VIS_CONFIG.beamAlpha * 0.52 * pulse));
  g.addColorStop(1, hexToRgba(vis.color, 0));
  ctx.fillStyle = g;
  const px = -uy; const py = ux;                       // 门向的垂直单位向量
  const ex = door.x - ux * L; const ey = door.y - uy * L;
  ctx.beginPath();
  ctx.moveTo(door.x + px * halfStart, door.y + py * halfStart);
  ctx.lineTo(ex + px * halfEnd, ey + py * halfEnd);
  ctx.lineTo(ex - px * halfEnd, ey - py * halfEnd);
  ctx.lineTo(door.x - px * halfStart, door.y - py * halfStart);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  DOOR_VIS_STATS.beams = (DOOR_VIS_STATS.beams || 0) + 1;
}
```

**③ 在 `drawDoors()` 的 H1 分支里挂两处**（`if (vis) { ... }` 内，`drawDoorGlow` 之后）：

```js
        // ① 地面光带（总开关 groundBeam）
        if (DOOR_VIS_CONFIG.groundBeam) drawDoorGroundBeam(door, vis, room, t);
```

以及 `drawDoorPlate(door, vis);` 之前，画 ③ 的清场闪框：

```js
        // ③ 清场瞬间：本房所有门同步闪一下（按 flashAt 衰减，不新增每帧状态机）
        if (door.flashAt != null && DOOR_VIS_CONFIG.flashDur > 0) {
          const k = 1 - (t - door.flashAt) / DOOR_VIS_CONFIG.flashDur;
          if (k > 0) {
            ctx.save();
            ctx.strokeStyle = hexToRgba(vis.color, 0.9 * k);
            ctx.lineWidth = 3 + 7 * k;
            ctx.strokeRect(door.x - 34, door.y - 34, 68, 68);
            ctx.restore();
            DOOR_VIS_STATS.flash = (DOOR_VIS_STATS.flash || 0) + 1;
          }
        }
```

**④ 门框描边加粗**（`drawDoors()` 门框段，两根柱子的那段）：

```js
    ctx.strokeStyle = hexToRgba(arcColor, target && target.cleared ? 0.7 : 0.85);
    ctx.lineWidth = 3;
```

**⑤ 清场钩子**（`onRoomCleared()` 里 `setRoomDoors(room, false);` 之后）：

```js
  // ③ 清场瞬间：本房所有门打上时间戳（画面上闪一下）+ 一声很短的"门开了"
  state.doors.forEach((d) => { if (d.roomId === room.id) d.flashAt = state.elapsed; });
  playSfx('doorOpen', 0.7, { priority: true });
```

**⑥ 音色（2 行）** —— `AUDIO_CONFIG.tones` 里加一条、`rateLimit` 里加一条：

```js
    doorOpen:   { freq: 300, to: 640, dur: 0.22, gain: 0.6, type: 'triangle' },
    // rateLimit 内：doorOpen: 0.5,
```

**总开关**：`DOOR_VIS_CONFIG.groundBeam`（①）、`DOOR_VIS_CONFIG.flashDur = 0`（③）、`DOOR_VIS_CONFIG.glowRange`（②）、门框两行常量（④）。任一项可单独回退。

### 14.7 预算（待实测）

约 **+45 行 / +1.6 KB**（1 个新函数 + 4 处调用/配置 + 1 个音色）；帧内成本：每帧每扇本房可通行门 1 次 `createLinearGradient` + 1 次 `fill`（F3 实测同房 4 扇门 → 4 次），清场时一次 13 门循环。**粘前先用内存预算脚本实测，未测前不得标"可粘"。**

### 14.8 粘完跑什么

```powershell
node tools/merge_audit/door_readability_probe.js
```

判据：`afterMaxDelta` 的**峰值差** ≥ 120（改前 61.5）；`after*_25.png` 缩小后能一眼看出 4 个门；`DOOR_VIS_STATS.beams ≥ 3`、`flash` 在清场帧 > 0。

---

## 勾选区

- [ ] #1 补丁 A 成就数组（16 条）已粘
- [ ] #1 补丁 B `metaMetricValue` 9 条口径已粘
- [ ] #1 补丁 C `barrelKills` 三处已粘
- [ ] #1 补丁 D 奖励报数口径已粘（D-1 或 D-2）
- [ ] #1 `achRewardText(id, granted, cap)` 已抽并挂 `window`
- [ ] #1 `node tools/arcane_ach.js` 全 PASS
- [ ] #1 `node tools/arcane_audit.js` 全 PASS
- [ ] #2 差集 CSS 11 行已粘
- [ ] #2 `?uidiff=off` 开关脚本已粘
- [ ] #2 `node tools/arcane_tokens.js` 全 PASS
- [ ] #2 `node tools/arcane_audit.js` 全 PASS
- [ ] #3 `node tools/sim_panel/run.js` 重生成面板
- [ ] 发布包用 `tools/package.mjs` 重新生成
- [ ] #6 前置：`metaMetricValue` 9 条 case 已先于面板合入
- [ ] #6 `ach-panel.css` / `ach-panel.js` 已内联（`</style>` 前 / `</body>` 前）
- [ ] #6 18 行挂载已接 `renderArchivePanel()` 入口
- [ ] #6 `?ach=off` 下 0 DOM；爆桶击杀后 `barrel_20` 进度非 0
- [ ] #6 奖励文案与 `announceAchievement` 同函数、无「+0」
- [ ] #6 面板 `rewardText` 已改为调用 `window.achRewardText`
- [ ] #7 `a11y.contrast` 已删，设置页 / toast 无「高对比」字样
- [ ] #7 对比度 4 行 CSS 已粘，`?a11ycss=off` 可整体回退
- [ ] #7 `minGap` 保持 0.25（**未**改成 0.34）
- [ ] #7 闪白滚动 1 秒 ≤3 + `flashSeq` 序号令牌已接
- [ ] #7 `POSTFX_CONFIG.motion` 三档 + `state.meta.motionLevel` 白名单已接
- [ ] #7 `node tools/merge_audit/a11y_compare.js` 19 项全 PASS
- [ ] 常驻：`node tools/merge_audit/fake_knob_audit.js` 退出码 0（A 全 PASS、B 确定 0）
- [ ] 常驻：每个新增开关三处齐全（`defaultMeta` / `normalizeMeta` / `syncA11yToggles`）
- [ ] 常驻：`a11y.contrast` 已摘（先摘旋钮，再谈审计）
- [ ] #8 补丁到货：14 函数逐个 grep 复核通过
- [ ] #8 补丁到货：54 行删除附「调用链恒为空」证据
- [ ] #8 补丁到货：调试 API 与 `u11cLegacyEvents` 未被触碰
- [ ] #8 补丁到货：武器 1,067 行零删除，只交清单
- [ ] #9 运行前检查已加：`JJSAVE_PROBE` 四方法预检、缺一即 `readonly`
- [ ] #9 只读横幅与「覆盖 / 新局」禁用已接
- [ ] #9 导出抽屉已写明「只搬这一局，不含全局进度」
- [ ] #9 `node tools/save_ui_probe.js` 53 项全 PASS
- [ ] #9 `?saveui=off` 不注入浮层
- [x] #10 待审转正：`onboardReturning` 改为开局快照（不读 live `bestFloor`）
- [x] #10 待审转正：`showFloor` / `reset` 能强制新玩家，块 18 补 `resetRun / modalLine / info()`（`hintVisible/hint/queue/seen`）
- [x] #10 待审转正：块 18 与块 2 同粘，`onboardStepForFloor()` 同块删除
- [ ] #10 4 个旧脚本（含 1 副本）单独提交改事件断言——`tools/` 三个脚本已就地改写，`_ac_new_arcane_help.js` 副本待写权线合并时统一
- [x] #11 待审转正：删 `ground`（hazard 回 `env`）或给出可达证据
- [x] #11 待审转正：`P1_VERDICT_LABEL.boss = '被首领（含贴身）'` + 贴身子计数
- [ ] #11 待审转正：`p1SpikeFor` 加本层承伤门槛——未加；判决句已写明「本层内」，归表述项
- [x] #11 待审转正：块 10 补 `scenario()/html()` 或声明自检仅作规格——v2 改为自检直接跑补丁副本并调生产函数
- [ ] #12 路虚影：`PARALLAX_CONFIG.apron` 已加 `clipToFloors: true`
- [ ] #12 路虚影：`paintVoidApron()` 三循环后已按房间/走廊/秘藏房抠除（内缩 1px）
- [ ] #12 `node tools/merge_audit/apron_ghost_probe.js` 改后 `before.a32 = 0.0`、`after` 三档 0
- [ ] #12 `clipToFloors: false` 能逐像素回到改前（A/B 可复查）
- [ ] #13 出入口：`DOOR_VIS_CONFIG` 加 `groundBeam/beamLength/beamAlpha/beamPulse/flashDur`，`glowRange 340 → 620`
- [ ] #13 出入口：新函数 `drawDoorGroundBeam()` 已加、在 `drawDoors()` H1 分支调用
- [ ] #13 出入口：门框 `lineWidth 2 → 3`、`alpha → 0.85`（门闪按 `flashAt` 衰减）
- [ ] #13 出入口：`onRoomCleared()` 已给本房门打 `flashAt` + `playSfx('doorOpen')`，音色 2 行已加
- [ ] #13 出入口：**预算实测前不得标可粘**；粘后跑 `door_readability_probe.js`，峰值差 ≥ 120、25% 缩图一眼可辨

---

## 12. 交写权线（#10 / #11，2026-11-08 收尾）

**TARGET_MD5（落盘起点，历史留档）：`62C63B773A093C5F334C8D0563051BBB`**（2,694,263 B / mtime 2026-11-08 19:27:21 / SHA256 `3929CB87…`）。
**落盘后 + 出包指纹：MD5 `F852832AC553E0E5ECB3F2ABC423A6D9`**（2,710,524 B，与 `dist/emberfall_v1.6.0/烬_v1.6.0.html` 一致）。
**落盘前先算 `Get-FileHash index_arcane_v2.html -Algorithm MD5`，不符拒收**——两份补丁的自检全部基于起点那份。

落盘顺序（每步之间不得并行开浏览器实例）：

1. 基线：`node tools/page_boot_check.js index_arcane_v2.html` → `BOOT: PASS`。这是「当前文件是好的」的基线，失败就别往下走。
2. **#10 教学**：`ONBOARD_PATCH.md` 块 0–19（机械版 `reviewfix_apply.js` 的 O 系列）→
   `node tools/page_boot_check.js index_arcane_v2.html` → `node tools/arcane_syntax.js` →
   全量：`arcane_onboard.js` / `arcane_playthrough.js` / `arcane_help.js` / `reviewfix_onboard_test.js` → 全绿。
3. **#11 归因**：`DEATH_REVIEW_PATCH.md` 块 0–10（D 系列）→
   `node tools/page_boot_check.js index_arcane_v2.html` → `node tools/arcane_syntax.js` →
   `arcane_p1.js` + `reviewfix_death_test.js` + `death_parity.js`（逐局差异必须 0）→ 全绿。
4. 任何一步 `page_boot_check` 返回 `BOOT: FAIL`：**停在这一步，回滚该步，不跑功能断言**。
   理由：语法/结构坏了的时候，功能脚本可能连页面都起不来，报错会误导成功能失败。

禁止：不要把 `.reviewfix/index_patched.html` 当落盘对象；不要跳过 boot check；本审查线不再写主文件。
