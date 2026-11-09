# M1-2 规格：魔法 / 科技 6 / 6

> 状态：已完成（2026-11-03；用户已授权按自审标准直接实施）
> 目标文件：`index_arcane_v2.html`（单文件、零依赖）
> 备份：改动前生成 `index_arcane_v2.bak_20261103_m12.html`

## 1. 目标

把魔法卡从 4 张扩到 6 张、科技卡从 4 张扩到 6 张，并保证：

1. 新卡能从层奖励池正常出现、能被 `grantMagic / grantTech` 直接授予；
2. 6 张卡在底部 HUD 单行排布、不换行、不裁字、不越界；
3. 新技能有完整玩法与视觉反馈，不做“只加一个数字”的空壳卡；
4. 原有 4 魔法 + 4 科技的释放路径、10 条融合、A 符文合体演出全部不回归；
5. 帧率 ≥ 60fps，`window.__errors` 为空。

## 2. 非目标（明确不做）

- **新 4 张卡不加入 `FUSION_CONFIG`**。融合已 10 条达标，避免 M1 膨胀；技能树里这 4 张卡的“可融合”文案会显示“这一项暂时没有融合配方”，属预期。
- 不改动已有 10 条融合的配方、数值、演出。
- 不做卡牌美术重绘（M1-4 统一处理卡面 UI）。

## 3. 四张新卡的设计（已拍板，不再讨论）

### 3.1 魔法：`blade`「回旋刃」glyph `⟲`

| 项 | 值 |
|---|---|
| 消耗 / 冷却 / 伤害 | 20 奥能 / 1.4s / 18 |
| 行为 | 向瞄准方向掷出，飞行 0.5s 后自动折返玩家，**去程与回程各命中同一敌人一次** |
| 形态 | 紫色旋转三叶刃，回程时亮度提升 |
| 配置 | `TACTIC_CONFIG.blade = { speed: 460, returnSpeed: 520, outTime: 0.5, life: 1.6, radius: 9 }` |

实现要点：
- 投射物新增字段 `boomerang: true / originX / originY / outElapsed / returning / hitIds`；
- `updateProjectiles` 中：`outElapsed >= outTime` → `returning = true`、`hitIds = []`、把 `originX/Y` 改为**当前玩家位置**（回程追着玩家走，手感更好）；
- 撞墙时若仍在去程 → 直接转入回程（不消失）；回程再撞墙才消失；
- 命中处理：boomerang 不 splice，改为 `hitIds.push(enemy.id)` 后继续飞；回程清空 `hitIds` 实现同敌二连击；
- 回到玩家 16px 内 → 消失并补一圈小特效。

### 3.2 魔法：`mine`「符文雷」glyph `✳`

| 项 | 值 |
|---|---|
| 消耗 / 冷却 / 伤害 | 22 奥能 / 2.6s / 40 |
| 行为 | 在瞄准点布雷：0.5s 布防；布防后敌人进入 60px 立即引爆；4s 未触发自动引爆 |
| 爆炸 | 复用 `applyExplosion`，半径 84、边缘 60% 伤害、顿帧 0.035、震屏 2.4 |
| 配置 | `TACTIC_CONFIG.mine = { armTime: 0.5, triggerRadius: 60, autoTime: 4, blast: {...}, color: '#a06bff' }` |

实现要点：
- 落点从玩家向瞄准方向逐 20px 步进，取**最后一个可站立点**（防止把雷埋进墙里）；
- `state.mines` 新增数组；`generateFloor / clearTransientEffects / clearFloorEntities` 三处清空；
- 新增 `updateMines(dt)`：布防倒计时 → 检测敌人 → `detonateMine` → 自动引爆兜底；
- 新增 `drawMines()`：布防期为虚线圆，布防后为旋转符文 + 脉冲圈 + 剩余时间弧。

### 3.3 科技：`magnet`「磁吸」glyph `⊙`

| 项 | 值 |
|---|---|
| 被动 | 掉落物吸附半径 **+90px**（`updatePickups` 的 112 → 202，仅对已持有磁吸生效） |
| 装置 | 「磁吸脉冲」cd 10s：把 220px 内敌人拉向玩家 42%，并减速 1.2s |
| 配置 | `TACTIC_CONFIG.magnet = { radius: 220, pullRatio: 0.42, slow: 1.2 }` |

实现要点：复制「引力井」的拉拽 + 吸附线逻辑，中心改为玩家；每只被拉敌人画一条青色吸附线；飘字显示拉到的数量。

### 3.4 科技：`amp`「增幅」glyph `⤴`

| 项 | 值 |
|---|---|
| 被动 | 技能伤害 **+8%**（在 `getMagicDamage` 内叠加） |
| 装置 | 「超频增幅」cd 12s：下一发魔法伤害 **×2.2** |
| 配置 | `TACTIC_CONFIG.amp = { boost: 2.2, passiveMul: 1.08 }` |

实现要点：
- `state.ampCharge`（默认 1）记录待消费倍率；
- `castPrimary` 分发技能后立即把 `ampCharge` 复位为 1，**保证只作用于下一发**，不会污染后续；
- `getMagicDamage` 返回 `damage * (ampCharge > 1 ? ampCharge : 1)`；
- 装置触发时金色飘字「超频增幅 ×2.2」+ 金色法阵。

## 4. 精确改动清单（按文件顺序）

### 4.1 配置区

1. `MAGIC_CONFIG`（当前 L3308–3337）末尾追加 `blade`、`mine` 两条。
2. `TECH_CONFIG`（当前 L3340–3365）末尾追加 `magnet`、`amp` 两条（卡名压到 2 字，适配 6 列窄卡）。
3. `FUSION_CAST_CONFIG` 之后新增 `TACTIC_CONFIG`，集中存放四张卡的所有数值（函数级注释说明“改玩法只改这里”）。

### 4.2 运行时状态

4. `state`（L4020 起）：新增 `mines: []`、`ampCharge: 1`。
5. `generateFloor`（L4748，重置块 L4758–4768）：新增 `state.mines = []`、`state.ampCharge = 1`。
6. `clearTransientEffects`（L5086）与 `clearFloorEntities`（L5103）：新增 `state.mines = []`。

### 4.3 施法分发

7. `castPrimary`（L11947）：在 `if/else if` 链（L11981–11984）前加入 `blade`、`mine` 分支；分发结束后 `state.ampCharge = 1`。
8. `getMagicDamage`（L11937）：叠加 `amp` 被动倍率与 `ampCharge` 倍率。
9. 新增 `castBlade(magic, fusion)`：放在 `castFireball` 之前（注释：去程/回程各一次命中）。
10. 新增 `castMine(magic, fusion)`：放在 `castFrost` 之前。
11. `castDevice`（L12431，分支 L12450–12476）：新增 `magnet`、`amp` 两个 `else if`。
12. `tryFuse` 不动。

### 4.4 投射物与地雷更新 / 绘制

13. `updateProjectiles`（L12826）：
    - 循环开头加入 boomerang 计时 / 折返 / 原点更新；
    - 撞墙分支（L12873）加入 boomerang 折返判断；
    - 命中分支（L12914）加入 boomerang `hitIds` 处理；
    - 循环末尾加入“回到玩家 16px 内移除”。
14. 新增 `updateMines(dt)`，放在 `updateProjectiles` 之后；主循环 L14932 后插入 `updateMines(worldDt)`。
15. `drawProjectiles`（L9788）开头加入 `fxType === 'blade'` 的旋转三叶刃绘制。
16. 新增 `drawMines()`；世界绘制顺序 L5857 `drawPickups()` 之后调用（地雷在地面、敌人之下）。
17. `updatePickups`（L12956）：把硬编码 112 改为 `TACTIC_CONFIG.pickup.baseRadius + 磁吸加成`。

### 4.5 HUD 与输入

18. `renderDeck`（L5356）：
    - 根据 `length > 4` 给 `ui.magicRow / ui.techRow` 加 `is-dense` 类；
    - 魔法卡键位序号 1–6（数据驱动，无需硬编码）。
19. CSS `.card-row`（L526）后新增 `.card-row.is-dense` 规则：`repeat(6, minmax(0,1fr))`、卡内竖排、glyph 居中 20px、名称 10.5px 单行、隐藏 `.m-sub`、卡高仍 68px。
20. `@media (max-width: 760px)` 的 `.card-row`（L2401）补 `.is-dense` 同样 6 列，避免窄屏回落成 4 列换行。
21. `keyToAction`（L14529）：新增 `'5': 'magic5', '6': 'magic6'`。
22. `handleKeyDown`（L14613–14616）：新增 `magic5 → MAGIC_CONFIG[4]`、`magic6 → MAGIC_CONFIG[5]`；奖励弹窗仍只用 1/2/3 选奖励，5/6 不参与。
23. 静态文案：L2538 改为「数字键 1–6 切换」；L2759 改为「1–6」并补列新卡名；L12523 注释同步。

### 4.6 验收与文档

24. 回归脚本复用 `%TEMP%\arcane_*.js` 现有测试入口（`window.__roamDebug`）。
25. 新增 `%TEMP%\arcane_m12.js` 专项脚本（不放进工作区根目录）。
26. 更新清单 `奥术工程师_完整范围与验收清单.md`：L42「魔法/科技 6/6」改 `[x]` 并附证据。

## 5. 验证计划

### 5.1 新增专项 `arcane_m12.js`（全部走 `window.__roamDebug`）

| # | 断言 | 通过标准 |
|---|---|---|
| 1 | 卡表数量 | `MAGIC_BY_ID` 6 个、`TECH_BY_ID` 6 个，id 与名称一致 |
| 2 | 奖励池 | 连续 `openReward()` 20 次，`blade/mine/magnet/amp` 至少各出现 1 次 |
| 3 | 新卡可释放 | `grantMagic` 后 `cast()` 返回 true，冷却与奥能正常扣除 |
| 4 | 回旋刃二连击 | 正前方放 1 只高血量怪，`cast()` 后等 1.5s，该怪 `hp` 减少量 ≈ 2×单发伤害（允许 ±15% 衰减误差） |
| 5 | 地雷触发 | `grantMagic('mine')` + `cast()`，等 0.6s 布防后把怪 teleport 到雷上，0.5s 内 `explosionStats.count` +1 |
| 6 | 地雷超时 | 无怪时等 4.6s，`mines` 归零且 `lastExplosion` 存在 |
| 7 | 磁吸拉怪 | 220px 内放怪，记录距离 → `castDevice()` → 距离缩短 ≥ 30% 且 `slow > 0` |
| 8 | 磁吸被动 | 掉落物在 190px 内、无磁吸时不吸；`grantTech('magnet')` 后同距离会被吸走 |
| 9 | 增幅倍率 | 同一只怪、关冷却，普通伤害 D；`grantTech('amp')` 后被动 1.08D；装置后再打一发 ≈ 1.08×2.2D；**第三发回到 1.08D**（证明只吃一发） |
| 10 | HUD 6 列 | 1280 宽下 `magicRow` 6 张卡同一 top、无换行、`scrollWidth <= clientWidth + 1`、文字不裁切 |
| 11 | 键盘 5/6 | 派发 keydown `5`/`6` 后 `activeMagicId` 分别为 `blade`/`mine` |
| 12 | 性能 / 报错 | 战斗中 10s `fps >= 60`，`__errors.length === 0` |

### 5.2 回归（必须全绿）

- `%TEMP%\arcane_fusion.js`（78 项，含 10 条融合与 A 演出）
- `%TEMP%\arcane_verify.js`（34 项）
- `%TEMP%\arcane_flow3.js`（38 项）
- `%TEMP%\arcane_p1a_ui.js`（39 项）
- `%TEMP%\arcane_facing.js`（23 项）

### 5.3 可见且可点体检复跑（P0 标准不回退）

- 视口 1280×720 / 1600×900 / 1920×1080 × 缩放 100% / 125%；
- 每视口 7 个状态（标题 / 战斗 / 奖励 / 技能树 / 规则 / 设置 / 结算）；
- 输出 `issues = 0`（越界或遮挡为 0），技能树允许“需滚动”但必须可滚到；
- 截图落 `.screenshots\audit_m12\`，结果单独回报一次。

## 6. 风险与回滚

| 风险 | 处理 |
|---|---|
| 6 列卡片在 1280 宽下挤 | `is-dense` 隐藏副标题、名称单行、glyph 居中；专项断言 10 兜底 |
| 回旋刃撞墙来回抖动 | 回程再撞墙直接消失；`life` 1.6s 强制回收 |
| 地雷埋在墙里 | 落点步进取最后可站立点 |
| 增幅倍率泄漏到下一发 | `castPrimary` 分发后强制复位 1，专项断言 9 兜底 |
| 技能树 6+6 节点排版溢出 | 体检第 2 项覆盖；若溢出则调树网格列数（不改玩法） |
| 改坏原路径 | 改动前时间戳备份；五项回归全绿才算完成 |

## 7. 已执行的决策（按自审标准补录，欢迎后续复盘中再改）

1. 四张新卡**不进融合配方**（保持 10 条融合）。
2. 魔法/科技快捷键扩到 **1–6**；奖励弹窗仍只用 1/2/3。
3. 6 张卡改为**单行 6 列紧凑卡**（隐藏副标题，卡高不变 68px）。
4. 地雷自动引爆时间 **4s**、布防 **0.5s**；增幅只作用于**下一发**魔法。

## 8. 边界情况（自审补录，全部已实测）

| 边界 | 行为 | 证据 |
|---|---|---|
| 无目标（房间无怪） | 回旋刃照常掷出并回程；符文雷照常布防；磁吸 0 敌人只放空特效进冷却；增幅照常上弹 | m12 专项 4/5/7/9 阶段均在清场状态下通过 |
| 瞄准点全在墙内 | 符文雷落点逐 20px 回退，最终停在玩家前方最后一个可站立点 | `castMine` 落点搜索 + m12 截图 `02_mine_armed` |
| 满技能栏（6/6 + 6/6） | HUD 仍 6 列不换行；奖励池交给 M1-3 过滤 + 补给兜底 | m12 三视口断言 + M1-3 满栏断言 |
| 暂停中开面板（H/T/O/奖励） | 世界冻结，快捷键 1–6 只切换不施法；关闭后回到原模式 | p1a 39/39（含 H 面板冻结与技能树往返） |
| 切后台再回前台 | `visibilitychange` 暂停累计，回前台 `dt` 钳制，不瞬移 | 既有主循环钳制；回归全程无瞬移报错 |
| 1280×720 / 1920×1080 / 125% | 6 列同 top、无横向溢出、无遮挡 | m12 断言 10/11 + 体检 6 组视口 issues=0 |
