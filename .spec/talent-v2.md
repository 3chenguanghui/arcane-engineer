# 永久天赋 v2 规格（交付清单第 11 项）

> 目标：把现有 3 项线性天赋（活力 / 奥能 / 融合精通，每级 1 结晶、封顶 5 级）重做成
> **四类 30 项、7 排互斥、3 层成本递增、三类数值封顶、洗点 75%、进阶对冲** 的永久成长系统。
> 纪律：单文件零依赖、函数级注释、不改弱任何已 PASS 断言、每个新系统有总开关。
> 本文档是自决规格（用户已授权"不提问、自己裁决写 PROGRESS"）。

---

## 0. 现状锚点（已读代码，实施时按函数名定位）

| 位置 | 现状 |
| --- | --- |
| `TALENT_CONFIG`（约 L7442） | 仅 3 项：`vitality` / `aether` / `fusionMastery` |
| `TALENT_BY_ID`（约 L10978） | 由 `TALENT_CONFIG` 生成 |
| `defaultMeta()`（约 L11367） | `talents:{vitality:0,aether:0,fusionMastery:0}` |
| `normalizeMeta()`（约 L11449） | 按 `TALENT_CONFIG` 夹到 `GAME_CONFIG.talentMaxLevel` |
| `applyMetaStats()`（约 L12207） | `hpMax = baseHp + vitality*20 + mods.hpBonus`；`aetherMax = baseAether + aether*10 + …` |
| `getFusionDamageBonus()`（约 L12292） | `1 + fusionMastery*0.15` |
| `buildTalentRowsHtml()`（约 L18622） | 旧三行 HTML，标题页 / 结算页共用 |
| `renderTalents()`（约 L18645） | 写 `[data-talent-body]` 与 `[data-talent-crystals]` |
| `buyTalent()`（约 L39760） | 固定 `GAME_CONFIG.talentCost = 1`，无前置 / 无互斥 / 无封顶 |
| `damagePlayer()`（约 L37162） | 受伤入口（力场 -15%、护盾 -50%、相位甲免死） |
| `startDash()`（约 L31728） | `player.dashCd = DASH_CONFIG.cooldown` |
| `damageEnemy()`（约 L36480 起） | 暴击 `rng() < FEEL_CONFIG.critChance`，最终 `damage` 约 L36531 |
| `dealReactionDamage()`（约 L35819 / L35937） | 元素反应统一出口 |
| `EXECUTION_CONFIG`（约 L6333） | `normalThreshold .15 / eliteThreshold .20 / bossBreakDuration 5.0` |
| `eventSacrificeCost()` / `acceptEventObject()`（约 L9330） | 献祭代价；赌注 `stake` 扣结晶约 L9362–9376 |
| `EVENT_CONFIG.wager.chance` / `EVENT_CONFIG.chance`（约 L8921） | 赌桌胜率 / 每层事件房概率 |
| `buyShopItem()`（约 L42784） | 商店价格 `item.price`（余烬） |
| `buildRewardModalHtml()` / `showRewardStage()`（约 L37638 / L37696） | 奖励弹窗，可挂"重掷"按钮 |
| `RARITY_CONFIG`（约 L7036） | 稀有度权重 55 / 35 / 10 |
| 结晶发放点 | 约 L8605、8783、9375、10223、12892、12928、12999、17023、17158、37039、37358、37795 |
| `META_SCHEMA_VERSION` | 当前 6，本次升到 7 |
| 存档 / 种子 / 进阶 / 图鉴 | 已 PASS，不改语义；天赋写入 `meta`，不进局内快照 |

---

## 1. 配置与数据结构（新增，放在 `TALENT_CONFIG` 原位置整体替换）

```js
/* 总开关：false 时所有天赋数值归零、UI 显示"天赋系统已关闭"，其余系统零影响 */
const TALENT_V2_CONFIG = { enabled: true, storageMoney: 'crystal' };

const TALENT_CATEGORY_CONFIG = {
  survival: { id:'survival', name:'生存', short:'生', accent:'#47e8a7', cap:null },
  output:   { id:'output',   name:'输出', short:'输', accent:'#ff8f6b', cap:'damage' },
  economy:  { id:'economy',  name:'经济', short:'经', accent:'#ffd166', cap:'economy' },
  unlock:   { id:'unlock',   name:'解锁', short:'解', accent:'#c9a6ff', cap:null }
};

/* 3 层：越深越贵；前置由 talentPrereq() 统一判定 */
const TALENT_TIER_CONFIG = {
  1: { cost: 3, name: '第 1 层 · 基础', prereq: null },
  2: { cost: 5, name: '第 2 层 · 进阶', prereq: { sameCategoryTier: 1, level: 1 } },
  3: { cost: 8, name: '第 3 层 · 深层', prereq: { sameCategoryTier: 2, level: 1 } }
};

/* 纯加成封顶（解锁类不受限）；数值先合计、再封顶、最后乘进阶对冲 */
const TALENT_CAP_CONFIG = {
  damage: 0.35,          // 伤害类合计 ≤ +35%
  mitigation: 0.30,      // 减伤类合计 ≤ −30%
  economy: 0.60,         // 经济类合计 ≤ +60%
  critExpectedWeight: 0.6 // 暴击率按 60% 折算进伤害封顶（暴击期望）
};

const TALENT_ASCENSION_CONFIG = { stepPerLevel: 0.08, minMul: 0.68, unlockExempt: true };
const TALENT_RESPEC_CONFIG = { refund: 0.75, feeAll: 2, feeCategory: 1 };
```

### 1.1 30 项总表（最终值）

字段：`id / 名称 / 类 / 层 / 满级 / 每级价 / 合计 / 效果键（每级）/ 互斥组 / 图标 id`

| # | id | 名称 | 类 | 层 | 满级 | 价/级 | 合计 | 效果（每级） | 互斥组 | 图标 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `hp` | 体魄 | 生存 | 1 | 2 | 3 | 6 | `hpMaxPct +5%` | - | heart |
| 2 | `aether` | 奥脉 | 生存 | 1 | 2 | 3 | 6 | `aetherMax +15` | - | orb |
| 3 | `armor` | 坚壁 | 生存 | 1 | 2 | 3 | 6 | `mitigation +8%` | G1 | shield |
| 4 | `swift` | 疾影 | 生存 | 1 | 2 | 3 | 6 | `dashCdPct -10%` | G1 | wing |
| 5 | `regen` | 回盾 | 生存 | 2 | 2 | 5 | 10 | `shieldRegen -1.5s`（未受伤触发间隔） | G2 | bubble |
| 6 | `leech` | 噬血 | 生存 | 2 | 2 | 5 | 10 | `healPct +15%` | G2 | drop |
| 7 | `lastStand` | 濒死免疫 | 生存 | 3 | 1 | 8 | 8 | `lastStand` 每局一次免死 | - | phoenix |
| 8 | `iron` | 铁壁 | 生存 | 3 | 2 | 8 | 16 | `mitigation +10%` | - | fortress |
| 9 | `steady` | 稳击 | 输出 | 1 | 2 | 3 | 6 | `damage +6%` | G3 | sword |
| 10 | `crit` | 暴击 | 输出 | 1 | 2 | 3 | 6 | `crit +6%` | G3 | spark |
| 11 | `reaction` | 共鸣 | 输出 | 2 | 2 | 5 | 10 | `reaction +15%` | G4 | ripple |
| 12 | `execute` | 处决 | 输出 | 2 | 2 | 5 | 10 | `execute +4%`（阈值放宽） | G4 | skull |
| 13 | `break` | 破防 | 输出 | 3 | 1 | 8 | 8 | `breakBonus +1.5s` | - | crack |
| 14 | `fusion` | 融合精通 | 输出 | 2 | 2 | 5 | 10 | `fusion +10%` | - | prism |
| 15 | `cdr` | 冷却 | 输出 | 1 | 2 | 3 | 6 | `cdr +5%` | - | clock |
| 16 | `thrift` | 节能 | 输出 | 3 | 1 | 8 | 8 | `aetherCostPct -10%` | - | leaf |
| 17 | `greed` | 结晶 | 经济 | 1 | 3 | 3 | 9 | `crystal +10%` | G5 | coin |
| 18 | `chest` | 寻宝 | 经济 | 2 | 2 | 5 | 10 | `chestRarity +10%` | G5 | chest |
| 19 | `wager` | 赌徒 | 经济 | 2 | 2 | 5 | 10 | `wagerDiscount -15%` | G6 | dice |
| 20 | `altar` | 祭品 | 经济 | 2 | 2 | 5 | 10 | `altarDiscount -15%` | G6 | altar |
| 21 | `reroll` | 重掷 | 经济 | 3 | 1 | 8 | 8 | `reroll +1`（奖励弹窗） | - | refresh |
| 22 | `event` | 奇遇 | 经济 | 2 | 2 | 5 | 10 | `eventChance +5%` | - | compass |
| 23 | `shop` | 商谈 | 经济 | 1 | 2 | 3 | 6 | `shopDiscount -10%` | - | tag |
| 24 | `floorBonus` | 厚利 | 经济 | 3 | 1 | 8 | 8 | `floorBonus +1`（每清层额外结晶） | - | stack |
| 25 | `startPool` | 卡池 | 解锁 | 2 | 2 | 5 | 10 | `startPool +2`（起始卡可选数） | - | cards |
| 26 | `startRelic` | 遗物 | 解锁 | 3 | 1 | 8 | 8 | `startRelic` 开局自带 1 件遗物 | G7 | relic |
| 27 | `thirdWeapon` | 第三武器 | 解锁 | 3 | 1 | 8 | 8 | `thirdWeapon` 起始池追加第 3 把武器 | G7 | wand |
| 28 | `fusionSlot` | 融合槽 | 解锁 | 3 | 1 | 8 | 8 | `fusionSlot +1` | - | slot |
| 29 | `startAether` | 启灵 | 解锁 | 1 | 2 | 3 | 6 | `startAether +20`（开局奥能） | - | star |
| 30 | `startEmber` | 启烬 | 解锁 | 1 | 2 | 3 | 6 | `startEmber +6`（开局余烬） | - | ember |

**逐项合计 249 结晶**（6×6 + 10×9 + 16 + 8×7 + 9 + … 见断言脚本自动求和，规格不重复手算）。

互斥组 7 排（`group` 字段两两互斥，选中一个即锁另一个；洗点后可重选）：
G1 坚壁 ↔ 疾影（减伤 vs 机动）
G2 回盾 ↔ 噬血（被动护盾 vs 治疗增效）
G3 稳击 ↔ 暴击（稳定期望 vs 高方差爆发）
G4 共鸣 ↔ 处决（反应流 vs 收割流）
G5 结晶 ↔ 寻宝（直接收益 vs 稀有度）
G6 赌徒 ↔ 祭品（赌注折扣 vs 献祭折扣）
G7 遗物 ↔ 第三武器（开局遗物 vs 起手武器）

### 1.2 加成聚合 API（所有数值出口只走这里，禁止各处手写）

```js
/** 某效果键的原始合计（未封顶、未对冲；解锁类也走这里） */
function talentRaw(stat) {}
/** 按类别封顶后的合计（damage / mitigation / economy；其它键原样） */
function talentCapped(stat) {}
/** 进阶对冲后的最终生效值：锁定类不受影响 */
function talentEff(stat) {}
/** 三类合计快照：{raw, capped, cap, mul}，供 UI 进度条与断言共用 */
function talentCategoryTotals() {}
/** 单次购买价（按层） */
function talentCostOf(talent) {}
/** 前置是否满足：tier2 需同类 tier1 至少 1 级；tier3 需同类 tier2 至少 1 级 */
function talentPrereqMet(talent) {}
/** 互斥冲突返回对方 id（无冲突返回 null） */
function talentExclusiveConflict(talentId) {}
/** 悬停文案：从配置反解"选了它就锁了谁"（禁止手写第二份文案） */
function talentExclusiveText(talentId) {}
/** 洗点：mode='all' | categoryId；返回 {ok, refund, fee, before} */
function respecTalents(mode) {}
```

`TALENT_V2_CONFIG.enabled === false` 时：`talentRaw` 恒 0、`talentEff` 恒 0、UI 顶部显示"天赋系统已关闭"。

---

## 2. 效果落地（精确到函数 / 行为）

| 效果键 | 落点 | 改法 |
| --- | --- | --- |
| `hpMaxPct` | `applyMetaStats()` | `hpMax = baseHp * (1 + eff('hpMaxPct')) + mods.hpBonus`（旧 `vitality*20` 删除） |
| `aetherMax` | `applyMetaStats()` | `aetherMax = baseAether + eff('aetherMax') + 科技 + 成就奖励` |
| `mitigation` | `damagePlayer()` | 在契约倍率之后：`damage *= Math.max(0.05, 1 - eff('mitigation'))` |
| `dashCdPct` | `startDash()` | `player.dashCd = DASH_CONFIG.cooldown * (1 - eff('dashCdPct'))` |
| `shieldRegen` | 玩家更新循环（`player.shield` 递减处，约 L31883） | 新增 `player.noHitTimer`；未受伤累计 ≥ `max(4, 12 - eff('shieldRegen'))` 且 `shield<=0` → `shield=2`，计时归零；受伤时归零 |
| `healPct` | 新增 `applyHeal(amount)`，替换 3 处 `hp = clamp(hp + heal…)` | `amount * (1 + eff('healPct'))` |
| `lastStand` | `damagePlayer()`（相位甲之后、扣血之前） | 致死且 `talentEff('lastStand')>0` 且 `!state.talentLastStandUsed` → `hp=1, invuln=1.4, used=true`，飘字"濒死免疫" |
| `damage` | `damageEnemy()` 暴击判定前 | `amount *= 1 + eff('damage')` |
| `crit` | `damageEnemy()` | `rng() < FEEL_CONFIG.critChance + talentEff('crit')`（封顶折算见 `TALENT_CAP_CONFIG.critExpectedWeight`） |
| `reaction` | `dealReactionDamage()` | `sourceDamage *= 1 + eff('reaction')` |
| `execute` | 处决阈值判定处（`EXECUTION_CONFIG.normalThreshold / eliteThreshold`） | 阈值 `+ eff('execute')`，夹到 `[0.05, 0.6]` |
| `breakBonus` | 首领破防触发处（约 L36323） | `enemy.breakWindow = EXECUTION_CONFIG.bossBreakDuration + eff('breakBonus')` |
| `fusion` | `getFusionDamageBonus()` | `1 + eff('fusion')`（旧 `fusionMastery*0.15` 删除） |
| `cdr` | 所有技能冷却写入处（找到 `state.cooldowns[...] = X` 后统一乘 `1-eff('cdr')`） | 只在"开始冷却"时缩短，不改逐帧递减 |
| `aetherCostPct` | 约 L32314 / L34113 `player.aether -= cost` | `cost *= 1 - eff('aetherCostPct')`，最低 1 |
| `crystal` | 新增 `grantRunCrystals(n, reason)` | `meta.crystals += Math.round(n * (1 + eff('crystal'))`）；替换所有**局内获得**结晶点（不含赌桌下注扣除） |
| `chestRarity` | 稀有度权重抽取函数 | 宝箱/秘藏来源时：`epic += 10%*lv`，`common -= 同量`，夹到 ≥5 |
| `wagerDiscount` | `acceptEventObject()` 赌注分支 | 实扣 `stake*(1-eff)`，中奖仍按 `stake*2` 发放 |
| `altarDiscount` | `eventSacrificeCost()` | 返回值 `* (1 - eff('altarDiscount'))`，最低 1 |
| `reroll` | `buildRewardModalHtml()` + 奖励点击处理 | 技能段显示"重掷 · 剩 N"；`state.talentRerolls` 在开局 = `talentEff('reroll')`；点击重抽本段选项并 −1 |
| `eventChance` | 事件房生成判定（`EVENT_CONFIG.chance` 使用处） | `chance + eff('eventChance')`，夹到 ≤0.95 |
| `shopDiscount` | `buyShopItem()` + 商店提示价 | `price = max(1, round(item.price*(1-eff)))`，展示与结算同一函数 `shopPriceOf(item)` |
| `floorBonus` | 清层发结晶处（约 L37358） | 额外 `grantRunCrystals(eff('floorBonus'))` |
| `startPool` | 新增 `startCardPool()` + `createInitialState()` | 池 = 基础 3 张（火球 / 冰锥 / 电弧）+ `2*lv`；`meta.startCard` 记录玩家选择，非法则回火球 |
| `startRelic` | `createInitialState()` | `state.relics['<首件遗物 id>']=1`（从 `RELIC_CONFIG` 取第一件普通遗物） |
| `thirdWeapon` | `startCardPool()` | 池内追加第 3 把武器（`MAGIC_CONFIG` 中第三张攻击卡），保证不买时只有 2 张起手池 |
| `fusionSlot` | 新增 `fusionSlotLimit()` | `6 + eff('fusionSlot')`；技能树 / 奖励发放用它判定上限，默认 6 不影响现有关卡 |
| `startAether` | `createInitialState()` | 开局 `player.aether += eff('startAether')`（填满后仍可溢出? 否，夹到 max） |
| `startEmber` | `createInitialState()` | 开局 `state.embers = eff('startEmber')` |

**局内重置**：`talentLastStandUsed`、`talentRerolls` 在 `createInitialState()` 写入；读档快照自动包含（state 字段）。

---

## 3. 元存档迁移（v6 → v7）

- `META_SCHEMA_VERSION` 6 → 7。
- `defaultMeta().talents` 改为全 0 的 30 键对象 + `talentsMigrated:false`、`talentsRespecLog:[]`、`startCard:'fireball'`。
- `migrateMeta()` / `normalizeMeta()`：
  1. 若 `talentsMigrated !== true` 且存在旧键 `vitality/aether/fusionMastery`：分别映射到 `hp/aether/fusion`，等级取 `min(2, old)`；超出部分按旧价 1 结晶/级返还（记入 `migrationRefund`）。
  2. 打标 `talentsMigrated = true`；再次 normalize 不得重复换算 / 重复返还。
  3. 未知键丢弃，等级夹到 `[0, maxLevel]`。
  4. 迁移过程写入 `meta.talentsMigration = {at, from:{...}, to:{...}, refund}`，PROGRESS 与断言读取。
- 旧档（v5 / v6 局内存档）打开标题页不报错；局内存档不被天赋迁移改写（meta 不进快照）。

---

## 4. 天赋页 UI（可读性硬要求）

**入口**：标题页 `.title-talents` 内新增 `#btnOpenTalents`（"打开天赋页"）；
结算页 `#resultTalentBox` 内同按钮；保留原 `data-talent-body` 但只渲染 3 行摘要（"生存 x/8 · 输出 x/8 · 经济 x/8 · 解锁 x/6"），完整页在独立浮层。

**浮层结构**（新增 `#talentLayer`，`hidden` 默认；不参与世界渲染，打开时暂停输入）：

```
#talentLayer
 ├─ .tp-head：标题 / 结晶余额 / 关闭钮
 ├─ .tp-bars（三类封顶进度条）
 │   伤害类 +XX% / 上限 +35%   [=====     ]  (已达上限时显式"▲ 已达上限，超出不生效")
 │   减伤类 -XX% / 上限 -30%
 │   经济类 +XX% / 上限 +60%
 ├─ .tp-cols（4 列：生存 / 输出 / 经济 / 解锁）
 │   └─ 每项 .t-card 带 data-talent-id / data-state / data-exclusive-text
 └─ .tp-foot：全部洗点（费 2，返 75%）+ 每列"洗此列"（费 1，返 75%）+ 说明
```

**五种状态（形状 + 文字 + 颜色三重编码，沿用已有色盲冗余口径）**：
| 状态 | 文字前缀 | 形状标记 | 类名 |
| --- | --- | --- | --- |
| 已选 | `✓ 已选` | 实心方框 + 右上角勾 | `.is-owned` |
| 可买 | `＋ 可买` | 虚线圆环 | `.is-buyable` |
| 互斥被锁 | `⊘ 互斥锁` | 斜杠圆 + 锁形角标 | `.is-exclusive-locked` |
| 已达上限 | `▲ 已达上限` | 三角角标（页面顶栏同步） | `.is-capped` |
| 前置不足 | `↓ 前置不足` | 向下箭头 + 前置文案（"需 生 tier1 ≥1"） | `.is-prereq` |

- 颜色只是第四重；`state.meta.colorblind === true` 时再叠纹理（点阵 / 斜线），与既有 `colorblind` 同一开关。
- **专属图标**：每项一个 `data-icon`，用纯 CSS（`::before` 几何 + `::after` 描边）绘制 30 种可区分的简笔图标；零外部图片、零 Canvas 依赖（Canvas 图标与断言截图更易受 DPR 影响，故选择 CSS）。
- **互斥视觉**：同组卡片共享 `.t-group-band` 同底色块 + 组号 `G1…G7` 印章；悬停显示 `talentExclusiveText(id)`（由配置反解，如"选了它就锁了：疾影（G1）"）；同时写入 `title` 与 `data-exclusive-text` 两个属性，断言直接比对配置。
- **悬停说明一致**：`talentExclusiveText` 只读 `TALENT_CONFIG.filter(group)`，UI 不得另写文案。

**购买 / 洗点交互**：
- 卡片点击 → `buyTalent(id)`；失败按 `reason` 给 toast（`poor / maxed / exclusive / prereq / disabled`）。
- 洗点：`respecTalents('all')` / `respecTalents(category)`；返还 `floor(已投入 * 0.75)`，先扣手续费（不足则拒绝），写入 `meta.talentsRespecLog.push({at,mode,before,refund,fee})`；提供"查看上次洗点记录"与"复原"（从 log 的 `before` 回填等级，费用不返还，记 `restored`）。

---

## 5. 节奏数值（8–14 / 局，20–25 局买满）

1. 静态总额：30 项合计 **249** 结晶（脚本 `totalCostOfTalents()` 求和，断言值必须与配置一致）。
2. 实测：`tools/arcane_talents.js` 用现有 bot 流程跑 5 局（普通难度、不打无尽），读 `state.crystalsEarned` 与 `meta.crystals` 增量，取中位数 `avg`。
3. 判定：`8 ≤ avg ≤ 14`；`projectedRuns = ceil(249 / avg)`，要求 `20 ≤ projectedRuns ≤ 25`。
4. 若不达标：按 `scale = avg*22.5/249` 等比调整 `TALENT_TIER_CONFIG` 的三档价格（保持 3 < 5 < 8 的比例与整数），**不修改水晶产出源**，并在 PROGRESS 写实测表（逐项价格 + 总额 + 每局均值 + 推算局数）。

预期（按保守 11/局）：`249 / 11 ≈ 22.6 局`，落在区间内。

---

## 6. 断言清单（`tools/arcane_talents.js`，复用 `arcane_profile.prepareProfile()`）

| # | 断言 | 做法 |
| --- | --- | --- |
| A1 | 互斥不能同时生效 | 每组买左项 → 买右项返回 `reason:'exclusive'`；两等级不同时 >0 |
| A2 | 封顶生效 + UI 标示 | 灌满三类 → `talentCapped` 等于上限；DOM 三类进度条出现"已达上限"文字 + `.is-capped` |
| A3 | 满级实测伤害在封顶内 | 钉死 `critChance=0`，同一敌人同一发：无天赋伤害 `d0`，满伤害天赋 `d1`，`d1/d0 ≤ 1.35 + 0.01` |
| A4 | 满级实测减伤在封顶内 | `damagePlayer(100)`：无天赋 `a0`，满减伤 `a1`，`a1 ≤ 70`（即 ≥30% 减伤）且不减到 0 |
| A5 | 满级实测经济在封顶内 | `grantRunCrystals(100)`：无天赋 `100`，满经济 `≤160` 且 `>100` |
| A6 | 洗点返还正确 + 记录可复原 | 买若干 → `spent`；`respecTalents('all')` → 返还 `floor(spent*0.75)`、扣 `feeAll`；log.before 与购买前等级一致；`restore` 后等级复原 |
| A7 | 洗点非零成本 | 结晶 = 0 时洗点被拒；有结晶时手续费确实扣除；连续两次洗点第二次无投入可返 |
| A8 | 前置不足不可买 | tier2 未买同类 tier1 → `reason:'prereq'`；买 tier1 后可买 |
| A9 | 进阶对冲生效 | 同等级天赋在 `ascension=0` 与 `4` 下的 `talentEff('damage')` 比值 = `1-0.08*4`；`startPool` 等解锁类不变 |
| A10 | 旧档迁移不丢失不重复 | 写入旧 meta（v6，`vitality:5,aether:3,fusionMastery:4`）→ 重载 → `hp=2,aether=2,fusion=2`，`migrationRefund` 记录；再次 normalize 数值不变、不再返还 |
| A11 | 五态 UI 不只靠颜色 | 构造五种状态，检查每张卡 `data-state` 对应的文字标记存在（✓/＋/⊘/▲/↓） |
| A12 | 悬停说明与配置一致 | 遍历 7 组：`card.dataset.exclusiveText` 与 `talentExclusiveText(id)` 完全相等，且文案里出现对方名字 |
| A13 | 总开关 | `TALENT_V2_CONFIG.enabled=false` → 所有 `talentEff` 为 0，买/洗点返回 `disabled`，其余系统行为不变 |
| A14 | 节奏 | 静态总额 249；5 局实测 `avg∈[8,14]`；`projectedRuns∈[20,25]` |
| A15 | 天赋页不破坏既有入口 | 标题页按钮可开、ESC/关闭可关，关闭后 `state.mode==='title'`，elapsed 不推进 |

**回归（必须全 PASS，不许改弱）**：
`arcane_syntax.js`、`arcane_title_assert.js 17/17`、`arcane_render_assert.js 21/21`、
`arcane_transition_assert.js 13/13`、`arcane_opening_assert.js 11/11`、`arcane_p2.js 47/47`。

---

## 7. 交付步骤（按序）

1. PROGRESS.md 顶部写入用户"交付清单"24 项勾选框（第 1–10 已勾，第 11 起待勾）。
2. 替换 `TALENT_CONFIG` 为 30 项 + 四组配置；新增聚合 / 前置 / 互斥 / 洗点 API。
3. `defaultMeta` / `normalizeMeta` / `migrateMeta` 升 v7 + 迁移。
4. 接入 28 个效果落点（第 2 节表格），新增 `grantRunCrystals` / `applyHeal` / `shopPriceOf` / `startCardPool`。
5. 重写 `buyTalent` + 新增 `respecTalents`；保留 `renderTalents()` 作为摘要渲染。
6. 新建 `#talentLayer` 天赋页 + CSS（四列、图标、互斥带、五态、三进度条、洗点）。
7. 标题页 / 结算页加入口按钮；选难度页与天赋页写明进阶对冲。
8. 新建 `tools/arcane_talents.js` 跑 A1–A15；跑全部回归。
9. 版本 1.0.4；PROGRESS 记录逐项价格表 / 买满总额 / 实测每局均值 / 推算局数 / 7 组互斥表 / 迁移说明。
10. 单独汇报（玩家视角）。
