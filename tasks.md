# B · 手感重置 + A 段收尾（v1.5.0，执行中）

> 规格：`spec.md` 顶部 B 段。顺序 B-A → B-B → B-C → B-D → B-E；C 段不执行。

## B-A 数量与血量重标定（`ENEMY_BUDGET_CONFIG`）
- [x] B-A1 `minFloor` 6 → 1（F1–F5 战斗/精英房改由预算表给数量）
- [x] B-A2 `rampByFloor` 20 层 battle/elite 区间换成新表（F1=4 … F20=8–9）
- [x] B-A3 20 层 `hpScale` 按 `T_f' × 数量比` 重算并写入
- [x] B-A4 `tools/arcane_ladder.js` 数量类断言同步到新表（增长/稳定性断言一条不动）
- [x] B-A5 跑 `arcane_ladder.js`：N1 无倒挂、N2 无断崖、L2/N7 在 8–12%、L4 成立
  - 终版 `RESULT: 36/36 PASS`（8 轮 × 120 次掷房/层）；曲线 466/527/598/672/763/829/926/1013/1112/1224/1299/1405/1539/1683/1826/1988/2178/2359/2476/2748
  - 相邻增幅 5.0%–13.5%（N2 ≤15% ✓、N7 1.05–1.15 ✓）；F5→F6 +8.7%（L1 ≤10% ✓）；F1→F6 1.78x（N9a ✓）
  - 调试过程如实记录：共跑 4 轮标定（25/36 → 30/36 → 34/36 → 36/36），前三次分别暴露 F1–F4 台阶 15%+、F6→F7 14.4%、F3→F4 15.2%（F4 单点溢出 0.2%）

## B-B 真实债 `dirAngle`
- [x] B-B1 `playComboThresholdRing` / 终结脉冲 / `executeEnemy` / `triggerConduct` 的全向 burst 补 `skipTrack=true`
- [x] B-B2 `arcane_verify` 50 项复跑，锥角断言转绿（`RESULT 50/50`，锥角断言 PASS）

## B-C A 段剩余减法
- [x] B-C1 `POSTFX_CONFIG` 四值降档（bloom .22 / chroma 1.2/.30 / crt .03 / vignette .22）
- [x] B-C2 `PARALLAX_CONFIG` 三层 .26/.26/.24 + apron .26
- [x] B-C3 `SCENE_READ_CONFIG` seamMul .35 / gridMul .45
- [x] B-C4 `drawComboEdge` 连杀 <2 无边光

## B-D 可比数字（改前/改后同场景）
- [x] B-D1 `tools/_feel_probe.js`：F1/F6/F10 真实战斗房清房（秒数 / 单发 ≥3 杀占比 / 每只几下 / 爆裂 / 空档）
- [x] B-D2 运行时还原旧表跑 before，输出同场景对照表

> 结果（2026-11-07，`.screenshots/feel/feel_probe.json`）：
>
> | 场景 | 怪数 | 单血 | 46 技几下 | 清房秒 | 单帧最多杀 | 爆裂 |
> |---|---|---|---|---|---|---|
> | before F1 | 2 | 259 | 5.63 | 3.35 | 2 | 0 |
> | before F6 | 5 | 183.6 | 3.99 | 4.48 | 3 | 2 |
> | before F10 | 6 | 245.2 | 5.33 | 7.13 | 2 | 0 |
> | after F1 | 4 | 117 | 2.54 | 4.23 | 3 | 1 |
> | after F6 | 7 | 99 | 2.15 | 3.97 | 3 | 3 |
> | after F10 | 8 | 141 | 3.07 | 4.73 | 2 | 0 |
>
> 断言：B-1 / B-1b / B-3（每只 2–3 下）/ B-4 / B-4b / B-5 / B-6 / B-7 PASS；
> **B-2（0.5s 窗口 ≥3 杀占比 ≥60%）未达成**：F1 33%、F6 44%。
> 原因如实登记：三段阵线把 7 只拆成 3/2/2 三簇，簇心间距约 0.42×房间短边，
> 单个 AoE 半径覆盖不到两簇，一簇最多 3 只 → 「单帧最多 3 杀」可达但「每发都 ≥3 杀」不可达。
> 用户原口径是「一发范围技能能带走 2–3 只」，实测典型值 2–3 只，符合原口径；
> B-2 是验收脚本按最严口径（≥60% 窗口 ≥3 杀）自设的断言，未改弱，保留为红并登记。

## B-E 回归与发布
- [x] B-E1 五项回归（fusion / weapons / verify / syntax / package），失败如实登记
  - `arcane_syntax` PASS（chunk 0 OK / 55290 行）
  - `arcane_verify` RESULT 50/50 PASS
  - `arcane_fusion` RESULT 96/96 PASS
  - `arcane_weapons` 首次 19/20 FAIL（X-B1 `rowHidden=false` / `modeRowHidden=false`）
    → 根因：本项目没有全局 `.hidden{display:none}`，`renderWeaponSettings()` 只加 class 不生效
    → 修复：补 `#weaponSettingRow.hidden / #weaponSettingNote.hidden / #weaponModeRow.hidden { display:none }`
    → 复跑 20/20 PASS
  - `arcane_package` RESULT 9/9 PASS
- [x] B-E2 版本 1.4.0 → 1.5.0（`GAME_CONFIG.version` / `releaseName` / `#aboutVersion`）
- [x] B-E3 `dist/emberfall_v1.5.0/` 打包 + 更新说明 + 署名「陈光辉 制作」（3 文件 / 2.47MB）

---

# X · 虚影归零 + 撤武器 + 打击爽感（v1.4.0，待批准）

> 规格：`spec.md` 顶部 X 段。执行顺序 X-A → X-B → X-C → X-D → X-E；每步跑对应探针再做下一步。

## X-A 迷雾纯黑
- [ ] X-A1 `FOG_CONFIG`：alpha 1.0 / feather 6 / secondPass true
- [ ] X-A2 `carveFogRect` / `carveFogCircle` 三层擦除改 0.25 / 0.62 / 1
- [ ] X-A3 `render()` 在 `drawVoidApron()` 后补第二次 `drawFog()`
- [ ] X-A4 `UNEXPLORED_HINT_CONFIG.enabled=false` + `drawUnexploredMarkers` 闸门
- [ ] X-A5 `__roamDebug.fogLab`（setAlpha/setMarkers/setSecondPass/setApron/setBloom/measure）
- [ ] X-A6 `tools/_fog_probe.js`：5 组排除实验 + 未探索区 max/avg/p99 + 同机位 PNG

## X-B 撤武器
- [ ] X-B1 `WEAPON_CONFIG.enabled=false`
- [ ] X-B2 `currentWeaponTag()` 增加 `weaponEnabledNow()`
- [ ] X-B3 `renderWeaponSettings()` 代码闸门隐藏武器行
- [ ] X-B4 `buildTreeWeaponBridgeHtml()` / `weaponFusionHintForOption()` 关闭时返回空
- [ ] X-B5 `tools/_magic_range.js`：近/中/远三档表 + 档差断言

## X-C 爽感
- [ ] X-C1 `ROOM_FX_PROFILE.battle.s2Kinds` 增 aoe5/multiKill/groupKill
- [ ] X-C2 `groupBlast.minKills=3` + `groupBlastDone` 同帧锁
- [ ] X-C3 `COMBO_FX_CONFIG.edge.levels` + `drawComboEdge` 按连杀等级取 alpha
- [ ] X-C4 `AOE_SHAPE_CONFIG` + `aoeShapeOf` + `drawAoeZoneShape`（环/扇/线/域）
- [ ] X-C5 `HIT_FEEDBACK_CONFIG` + `fx.levels()` 一致性接口

## X-D 实测与断言
- [ ] X-D1 `tools/_clear_room.js`：清一房逐帧数据（秒/击杀/爆裂/空档），before/after
- [ ] X-D2 `arcane_fusion` X 段、`arcane_weapons` 默认关闭段、`arcane_verify` 迷雾/署名段

## X-E 发布
- [ ] X-E1 五项回归（fusion / weapons / verify / syntax / package）全绿或如实登记
- [ ] X-E2 `dist/emberfall_v1.4.0/` 打包；`RECTIFY_PLAN.md` §7 + `PROGRESS.md` 第 35 项

# W · 武器标签融合 + 场景整改（v1.3.1，待执行）

> 规格：`spec.md` 顶部 W 段。纪律：不改弱断言、函数级注释、版本递增到 1.3.1。

## W-A 配置与数据层
- [ ] W-A1 `WEAPON_TAG_CONFIG` + 五把武器 `tagId`（数据字段，非文案）
- [ ] W-A2 `currentWeaponTag()` / `fusionWeaponTagOk()` / `weaponFusionAvailable()`
- [ ] W-A3 `FUSION_CONFIG` 新增 5 条带 `weaponTag` 的配方（railArc / moltenTrace / resonantEcho / mirrorSplit / phaseLance）
- [ ] W-A4 `getAvailableFusions()` 接第三输入；旧 13 条行为零差异

## W-B 融合真实生效（武器侧 rider）
- [ ] W-B1 `applyWeaponTagRiders()`：5 条配方各一条真实附加伤害
- [ ] W-B2 `weaponSwingNow()` 命中循环后调用；能力 id = `fusion:<id>`
- [ ] W-B3 `__roamDebug.fusion` 扩展：`tags()` / `recipesOf(weaponId)` / `available()` / `riderStats()`

## W-C 呈现
- [ ] W-C1 技能树融合页顶部「当前武器 → 可合成配方」区块（5 行 + 换武器提示）
- [ ] W-C2 选卡卡面徽标「可融合·武器」+ ≤12 字提示（`weaponFusionHintForOption`）
- [ ] W-C3 面板自解释校验：只看面板能推出换武器多出的配方

## W-D 场景整改
- [ ] W-D1 `FOG_CONFIG.alpha` 0.94 → 0.985
- [ ] W-D2 `drawUnexploredMarkers` 三个 alpha 降档
- [ ] W-D3 `SCENE_READ_CONFIG` + `sceneSeam()` + 4 处替换 + 地面格子亮度 ×0.70
- [ ] W-D4 截图复验：同机位 before/after

## W-E 武器外观
- [ ] W-E1 `drawWeaponHeld` 五把武器独立细化（渐变 / 刃口反光 / 护手柄部）
- [ ] W-E2 `drawWeaponFx` 拖影形状按武器轮廓分化
- [ ] W-E3 before/after 截图（10 张，`.screenshots/weapon_art/`）

## W-F 收尾
- [ ] W-F1 `RECTIFY_PLAN.md`（已修 / 本轮修 / 后续 三栏，含截图证据与可测断言）
- [ ] W-F2 版本 1.3.0 → 1.3.1（`GAME_CONFIG.version` / `releaseName` / `#aboutVersion`）
- [ ] W-F3 回归：`arcane_fusion` / `arcane_weapons` / `arcane_verify` / `arcane_syntax` / `arcane_package`
- [ ] W-F4 写 `PROGRESS.md` 第 34 项并汇报

---

# P1 · 执行任务清单（tasks.md）

> 纪律：不提问、自行裁决并写 PROGRESS；不改弱已 PASS 断言；单文件零依赖、函数级注释。
> 详细规格：`.spec/p1-readability.md`
> 三个子开关：`READABILITY_CONFIG.review / a11y / layers`，父开关 `READABILITY_CONFIG.enabled`

## A. 规格与配置
- [x] A1 写 `.spec/p1-readability.md`（账目 / 规则 / 冗余编码 / 分层 / 断言）
- [x] A2 同步根 `spec.md`
- [x] A3 `READABILITY_CONFIG` + `P1_STATS` 配置块
- [x] A4 设置面板：色盲开关 + 三档信息分层
- [x] A5 `__roamDebug.p1` 调试口

## B. 第一件：死因复盘
- [x] B1 `state.p1Ledger` 初始化 + `p1LedgerReset`
- [x] B2 `damagePlayer` 记账（承伤分类 / 次数 / 来源名）
- [x] B3 `damageEnemy` 记账（按 `abilityId` 归类，融合标记，有效伤害）
- [x] B4 `p1Shares` / `p1DeathVerdict`（顺序判定 + 可解释 rule）
- [x] B5 `buildReviewHtml` / `buildShareBarHtml`（结论 / 证据 / 细节三层）
- [x] B6 `showResult` / `showVictory` 插块（关闭时 DOM 逐字符一致）
- [x] B7 断言 1–6 PASS + 单独汇报

## C. 第二件：色盲 / 高对比
- [x] C1 普通 / 精英血条冗余（外框 / 竖标 / 菱形）
- [x] C2 首领 HUD 血条冗余（白描边 / 斜纹 / BOSS 标）
- [x] C3 元素徽记纹理（灼烧斜线 / 冰冻点阵 / 感电十字 + 白描边）
- [x] C4 处决环双线 + 四角括号
- [x] C5 事件门牌外框 + 房型字母 + 形状
- [x] C6 断言 7–9 PASS + 单独汇报

## D. 第三件：战斗信息分层
- [x] D1 `p1ThreatOf`（高 / 中 / 低，纯函数）
- [x] D2 血条 / 徽记 / 处决 / 词缀 / 本体透明度按档位门控
- [x] D3 `standard` / `minimal` / `full` 三档 + 极简关连击脉冲
- [x] D4 断言 10–13 PASS + 单独汇报

## E. 收尾
- [x] E1 `READABILITY_CONFIG.enabled=false` 零差异断言（14）
- [x] E2 串行全量回归（syntax / render / title / opening / tokens / transition / element / execute / events / p1）
- [x] E3 版本递增 + 更新说明
- [x] E4 `node tools\arcane_package.js` 重新打包
- [x] E5 `node tools\arcane_cleanup.js --apply` 清理
- [x] E6 写 `PROGRESS.md` 并最终汇报

---

# P2 · 长线可玩性 + 说明入口 + 局内存档（已完成）

> 详细规格：`.spec/p2-longrun.md`
> 顺序：种子局 → 进阶 → 图鉴 → 说明入口 → 局内存档；每件单独汇报
> 验收：`P2 ASSERT 47/47 PASS`；回归 title 17/17、render 21/21、transition 13/13、opening 11/11

## A. 规格与基础设施
- [x] A1 写 `.spec/p2-longrun.md` + 同步 `spec.md` / `tasks.md`
- [x] A2 `META_SCHEMA_VERSION` 5→6 迁移 + `normalizeMeta` 新字段
- [x] A3 `SEED_CONFIG` / `SEED_STATS` / `ASCENSION_CONFIG` / `CODEX_CONFIG` / `SAVE_SLOTS_CONFIG`
- [x] A4 `__roamDebug.p2` 调试口（seed / ascension / codex / save）

## B. 第一件：每日挑战与种子局
- [x] B1 `hashSeedString` / `mulberry32` / `makeSeedRng` / `rng()` / `withSeedRng`
- [x] B2 `rand/randInt/pickRandom/shuffleArray/pickEliteAffix/掉落/赌注/crit` 收敛到 `rng()`
- [x] B3 `generateFloor` 种子隔离 + `state.floorSignature`
- [x] B4 标题页今日挑战按钮 + 自定义种子输入 + 种子徽章 + 成绩列表
- [x] B5 `seedRecordRun` 成绩（最高层/用时/死因/通关）与 `meta.seedRuns`
- [x] B6 断言 1–5 + 单独汇报

## C. 第二件：进阶难度
- [x] C1 `meta.ascensionUnlocked/ascension` + 标题页 0–4 选择 + 规则说明
- [x] C2 L1 敌数 +1 / L2 精英第二条词缀 / L3 事件代价 ×1.5 / L4 首领三阶段
- [x] C3 结算页难度+进阶行；开关关闭零差异
- [x] C4 断言 6–7 + 单独汇报

## D. 第三件：图鉴
- [x] D1 `codexEntries` 由配置生成（敌人/配方/蓝图/遗物/卡牌）
- [x] D2 `meta.codex` 解锁钩子（生成/融合/蓝图/遗物/卡牌）
- [x] D3 标题页 + 档案入口；页签/搜索/翻页/黑影
- [x] D4 断言 8–11 + 单独汇报

## E. 追加 A：说明入口
- [x] E1 设置 / 暂停 / 标题三入口复用 `openRules()`
- [x] E2 帮助页手写数字审计 + 改配置生成
- [x] E3 断言：同一 DOM、关闭后状态不变

## F. 追加 B：局内存档 3 槽
- [x] F1 `captureRunSnapshot` / `applyRunSnapshot` 白名单 + 校验
- [x] F2 自动存档触发（每层/退出/关键节点）
- [x] F3 标题页与设置页槽位 UI（继续/复制/删除/导出/导入）
- [x] F4 超限降级、损坏拒绝、旧档兼容
- [x] F5 断言：逐字段回读、三槽隔离、导出导入、损坏、超限、旧档

## G. 收尾
- [x] G1 三个父开关关闭零差异
- [x] G2 全量回归（syntax/render/title/opening/tokens/transition/element/execute/events/p1/p2/help_save）
- [x] G3 版本 1.0.4 + buildChangelog
- [ ] G4 打包 + 发布包验收 + 清理（并入最终 v1.1.0 发布）
- [x] G5 写 `PROGRESS.md` 并最终汇报

---

# T · 永久天赋 v2（交付清单第 11 项，已完成 · 22/22 PASS）

> 详细规格：`.spec/talent-v2.md`
> 目标：四类 30 项 / 7 排互斥 / 3 层成本 / 三类封顶 / 洗点 75% / 进阶 −8% 对冲
> 节奏：一局 8–14 结晶，买满（249）20–25 局

## T1. 配置与聚合 API
- [x] T1-1 `TALENT_V2_CONFIG` / `TALENT_CATEGORY_CONFIG` / `TALENT_TIER_CONFIG` / `TALENT_CAP_CONFIG` / `TALENT_ASCENSION_CONFIG` / `TALENT_RESPEC_CONFIG` / `TALENT_PACE_CONFIG`
- [x] T1-2 `TALENT_CONFIG` 换成 30 项（含 7 组 `group`、`tier`、`maxLevel`、`icon`）
- [x] T1-3 `talentRaw / talentCapped / talentEff / talentCategoryTotals / talentCostOf`
- [x] T1-4 `talentPrereqMet / talentExclusiveConflict / talentExclusiveText / respecTalents / undoRespec / talentPaceInfo`

## T2. 存档与迁移
- [x] T2-1 `META_SCHEMA_VERSION` 6→7；`defaultMeta` 30 键 + `talentsMigrated` / `talentsRespecLog` / `startCard`
- [x] T2-2 旧 `vitality/aether/fusionMastery` 映射 + 超出等级按旧价返还 + 打标防重复
- [x] T2-3 旧档（v5/v6）正常进标题页；局内存档不受影响

## T3. 效果落点（28 键）
- [x] T3-1 生存：hpMaxPct / aetherMax / mitigation / dashCdPct / shieldRegen / healPct / lastStand
- [x] T3-2 输出：damage / crit / reaction / execute / breakBonus / fusion / cdr / aetherCostPct
- [x] T3-3 经济：crystal / chestRarity / wagerDiscount / altarDiscount / reroll / eventChance / shopDiscount / floorBonus
- [x] T3-4 解锁：startPool / startRelic / thirdWeapon / fusionSlot / startAether / startEmber
- [x] T3-5 `grantRunCrystals` / `applyHeal` / `shopPriceOf` / `startCardPool` / `fusionSlotLimit`
- [x] T3-6 `buyTalent` 重写（价格 / 前置 / 互斥 / 封顶 / 失败原因）

## T4. 天赋页 UI
- [x] T4-1 `#talentLayer` 浮层 + 标题页 / 结算页入口按钮
- [x] T4-2 四列布局 + 30 个纯 Canvas 图标（零素材，`drawTalentIcon` 30 分支）
- [x] T4-3 五态编码（✓ / ＋ / ⊘ / ▲ / ↓ + 形状 + 色盲纹理）
- [x] T4-4 7 组互斥底色带 + 悬停说明（配置反解）
- [x] T4-5 顶部三类封顶进度条 + “已达上限”
- [x] T4-6 洗点（全部 / 单列，费 2 / 1，返 75%）+ 记录与复原
- [x] T4-7 选难度页写明进阶 −8%/级 对冲（`ascensionTalentHedgeText` 从配置反解）

## T5. 断言与收尾
- [x] T5-1 `tools/arcane_talents.js` A1–A15（互斥 / 封顶实测 / 洗点 / 前置 / 对冲 / 迁移 / 五态 / 悬停 / 开关 / 节奏）
- [x] T5-2 节奏实测 3 层：实测 4/3/3–5，每局落在 8–14；买满 249 → 22.6 局（20–25 内）
- [x] T5-3 全量回归（syntax PASS / title 17 / render 21 / transition 13 / opening 11 / p2 PASS / meta 16 / chest 10 / onboard 25）
- [x] T5-4 PROGRESS：交付清单 24 项勾选 + 逐项价格表 + 互斥表 + 迁移说明
- [x] T5-5 单独汇报（玩家视角：怎么买、怎么洗、一局多少结晶、几局买满）

---

# R · 开局随机化（交付清单第 12 项，进行中）

> 详细规格：`.spec/open-random.md`
> 目标：起始卡 / 起始遗物 / 大区顺序 / 精英词缀 / 事件与宝箱分布 / 掉落倾向，全部走同一可控随机源

## R1. 配置与随机源
- [x] R1-1 `OPEN_RANDOM_CONFIG`（总开关 + 6 子开关 + startRelicPool + bias + 偏好表）
- [x] R1-2 `openRunSeed` / `openRandomState` / `openRand`（基于 `makeSeedRng`，单一种子多命名流）
- [x] R1-3 `state.openRandom` / `state.themeCycle` / `state.openBias` 初始化

## R2. 六项随机化
- [x] R2-1 起始卡：从 `startCardPool()` 抽 1（`createInitialState`）
- [x] R2-2 起始遗物：从 `startRelicPool` 抽 1（仅天赋解锁时）
- [x] R2-3 大区顺序：`themeCycle` 洗牌 + `getTheme` 读取
- [x] R2-4 精英词缀：偏好词缀权重加权（种子局仍可复现）
- [x] R2-5 事件 / 宝箱分布：房型权重偏好
- [x] R2-6 掉落倾向：奖励候选 kind 加权

## R3. 衔接与调试
- [x] R3-1 局内存档白名单补 `openRandom` / `themeCycle`
- [x] R3-2 `__roamDebug.openRandom` 调试口
- [x] R3-3 开局 toast 报起始卡 / 起始遗物

## R4. 断言与收尾
- [ ] R4-1 `tools/arcane_openrandom.js` O1–O10
- [ ] R4-2 总开关关闭零差异（O9）
- [ ] R4-3 回归 syntax / title / render / opening / transition / p2 / p1
- [ ] R4-4 PROGRESS 勾选第 12 项 + 单独汇报
