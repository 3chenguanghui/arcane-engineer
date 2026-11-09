# A 批 · 范围技能扩容 / 科技补 2 / 融合补 3 / 奖励四选一 · 规格

> 状态：**已由用户 2026-11-05 明确拍板，直接实现，不再等待确认**。
> 唯一主文件：`index_arcane_v2.html`（单文件、零外部依赖、双击即开）。
> 本轮起规格自审后直接进入实现；仅遇到需求自相矛盾 / 破坏单文件零依赖 / 两个已确认系统互斥时才回问用户。

## 0. 数字裁定（写进 PROGRESS「自行判定」）
| 争议 | 裁定 | 依据 |
|---|---|---|
| 卡池 30 张 | **作废 30**，以明细为准 = 魔法 12 + 科技 8 + 融合 13 = **33** | 用户真实诉求是「选择更多」，精确数字不是需求；33 > 30 |
| 6 条 AOE 归属 | 全部进魔法主动池，魔法 6 → 12 | 用户选择方案 A |
| 融合条数 | 10 + 3 = 13（"12"视为笔误） | 用户指定 3 条新融合且全部保留 |
| 奖励张数 | `REWARD_CHOICES_CONFIG.count` 默认 4，可 A/B 回 3 | 用户拍板 |

## 1. 数据层改动
### 1.1 `MAGIC_CONFIG`（L5015 起，追加 6 条，追加后魔法 = 12）
| id | 名称 | 形状 | cost | cd | damage | 说明 |
|---|---|---|---|---|---|---|
| `lavaFissure` | 熔岩地裂 | 线 | 24 | 2.4 | 46 | 沿瞄准方向撕开 260×44 的裂缝，线段内敌人全中 |
| `arcanePool` | 奥术雷池 | 域 | 30 | 3.0 | 22/跳 | 在瞄准点生成半径 110 的雷池，持续 2.6s，每 0.42s 结算一次 |
| `runeOrbit` | 符文轨道 | 环带 | 26 | 2.8 | 34 | 40→200 的环带外扩，带内（宽 34）敌人只命中一次 |
| `collapseHole` | 坍缩黑洞 | 聚拢 | 32 | 3.2 | 52 | 在瞄准点半径 170 内把敌人拉向中心，1.2s 后统一结算 |
| `flameCone` | 喷火锥 | 扇 | 22 | 2.2 | 30 | 朝瞄准方向 72° 扇形、射程 190，距离衰减 |
| `frostRing` | 冰霜环 | 自环 | 25 | 2.6 | 28 | 以自身为中心半径 140 的冰环，命中减速 1.6s |

每条带 `vfx`（core/glow/accent）与 `desc`，标签写入 `AOE_SKILL_CONFIG[id].shape`。

### 1.2 `AOE_SKILL_CONFIG`（新增，紧随 `MAGIC_CONFIG` 后）
```
enabled: true,
lavaFissure: { shape:'line', length:260, width:44, damageMul:1, tick:0 },
arcanePool:  { shape:'field', radius:110, duration:2.6, tickInterval:0.42, damageMul:0.62 },
runeOrbit:   { shape:'ringband', startR:40, endR:200, band:34, expand:0.45, damageMul:1 },
collapseHole:{ shape:'pull', radius:170, pullRatio:0.55, delay:1.2, damageMul:1 },
flameCone:   { shape:'cone', range:190, angleDeg:72, splash:0.62, damageMul:1 },
frostRing:   { shape:'selfring', radius:140, slow:1.6, damageMul:1 }
```
开关 `AOE_SKILL_CONFIG.enabled=false` 时：6 条技能仍可释放，但退化为「以自身为中心的简单爆炸」（复用 `applyExplosion`），用于 A/B 与旧行为对照。

### 1.3 `TECH_CONFIG`（追加 2 条，科技 = 8）
| id | 名称 | 独占机制 | 装置 |
|---|---|---|---|
| `phase` | 相位甲 | **每层 1 次致死免伤**：致死伤害改为保留 1 血 + 1.2s 无敌 | `相位跃迁`：沿瞄准方向瞬移 110px + 0.6s 无敌，cd 13 |
| `rewind` | 时序器 | **击杀重置冷却**：每次击杀 12% 概率重置全部魔法冷却 | `时序归零`：立刻重置全部魔法冷却并 +6 奥能，cd 15 |

实现钩子：`damagePlayer`（相位甲致死拦截）、`killEnemy`（时序器概率重置）、`castDevice`（两个新装置分支）。两者均不是纯数值放大。

### 1.4 `FUSION_CONFIG`（追加 3 条，融合 = 13）
| id | 名称 | magic + tech | 独占形态 |
|---|---|---|---|
| `lavaBand` | 熔雷带 | `lavaFissure` + `capacitor` | 地裂结束后沿裂缝留下 3s 熔带，每 0.5s 灼烧带内敌人（`damageMul 0.35`） |
| `drainRing` | 吸噬环 | `collapseHole` + `magnet` | 坍缩结算时每命中 1 只回复 3 生命，并把敌人再拉近一次 |
| `frostFlame` | 霜焰爆发 | `frostRing` + `amp` | 冰环命中后 0.55s 在同点炸出火焰环（0.7× 伤害，半径 +30） |

颜色/音阶沿用现有 `color` + `rate` 字段，保证 13 条融合一眼可区分。

## 2. 释放与绘制
### 2.1 施法分发
`castSlot` L26589 分支追加：
```
else if (magic.id === 'lavaFissure') castLavaFissure(magic, fusion);
else if (magic.id === 'arcanePool') castArcanePool(magic, fusion);
else if (magic.id === 'runeOrbit') castRuneOrbit(magic, fusion);
else if (magic.id === 'collapseHole') castCollapseHole(magic, fusion);
else if (magic.id === 'flameCone') castFlameCone(magic, fusion);
else if (magic.id === 'frostRing') castFrostRing(magic, fusion);
```
每个 cast 函数职责：施法演出 → 形状判定 → 逐敌结算 → 写 `state.aoeCasts` 记录。

### 2.2 持续区域系统（域 / 熔带 / 霜焰延迟）
新增 `state.aoeZones = []`，结构 `{ type, x, y, radius, life, tick, tickInterval, damage, color, accent, hits, payload }`。
- 更新：`updateAoeZones(dt)` 在 `updateProjectiles` 同一帧循环里调用；
- 绘制：`drawAoeZones(ctx)` 在绘制投射物之前（地面层）调用；
- 生命周期结束自动移除，不产生 GC 压力（数组原地 splice）。

### 2.3 形状判定（脚本可区分）
每条释放把记录写入 `state.aoeCasts`（最多保留 30 条）：
```
{ id, shape, at, hits, hitIds, params:{...}, from:{x,y}, to:{x,y} }
```
- `line`：点到线段距离 ≤ width/2 + enemy.radius
- `field`：圆内且每 tick 单独累计 `hits`
- `ringband`：`|dist - currentR| <= band/2 + enemy.radius`，每敌只记一次
- `pull`：先位移再统一结算，记录 `pulled` 位移总量
- `cone`：夹角 ≤ angle/2 且距离 ≤ range
- `selfring`：以玩家为圆心的圆

## 3. 奖励四选一
- 新增 `REWARD_CHOICES_CONFIG = { enabled:true, count:4 }`（放在 `REWARD_CONFIG` 附近）。
- `buildRewardOptions`：
  - `choiceCount = enabled ? clamp(count, 1, 6) : 3`；
  - `pickWeightedOptions(pool, choiceCount, ...)`；
  - 融合保底改为替换第 `choiceCount-1` 张；
  - 补位 `while (options.length < choiceCount)`；
  - 同次抽取池内 `key` 唯一 → 同 id 不重复（融合与魔法/科技可并存）。
- `buildRewardModalHtml`：标题/副标题/快捷键文案按 `choiceCount` 动态生成（四选一显示 `1 / 2 / 3 / 4`）。
- `handleKeyDown` reward 分支补 `magic4 → chooseRewardByIndex(3)`。
- A/B：`REWARD_CHOICES_CONFIG.count = 3` 或 `enabled = false` 立即回到三选一。

## 4. UI 同步
- 底部卡组 `renderDeck` 数据驱动，自动出现 12 魔法 / 8 科技；`is-dense` 6 列自动换行第二行。
- 技能树 `buildTreeNodeHtml` 数据驱动，融合节点自动 10 → 13；三态 `owned / ready / locked` 全部复用。
- P4 推荐 `fusionHintForOption` 数据驱动，新卡自动获得 `can / missing / none` 文案。
- 奖励弹窗卡片数据驱动，新卡自动进入卡池。

## 5. 验收（`tools/arcane_abatch.js`，端口 9543）
1. 配置断言：`MAGIC_CONFIG.length === 12`、`TECH_CONFIG.length === 8`、`FUSION_CONFIG.length === 13`；
   6 条 AOE 的 `shape` 分别为 line/field/ringband/pull/cone/selfring 且互不相同。
2. 形状断言：每条技能在脚本布置的 6 只聚团敌人下释放，`hits ≥ 4`，且 `shape` 与记录一致；
   线/扇/环带/自环/域/聚拢各自校验专属参数（如线宽、扇形角度、环带宽度、聚拢位移）。
3. 开关断言：`AOE_SKILL_CONFIG.enabled=false` 时仍可释放、记录 `shape:'fallback'`、命中 ≥ 4。
4. 融合断言：3 条新融合可获取、`fusionHintForOption` 三态文案存在、技能树三态可读。
5. 四选一：默认 `count=4` 且返回 4 张、`key` 无重复；`count=3` 返回 3 张。
6. fps ≥ 60；无运行时报错。
7. 截图：`.screenshots/abatch/before.png` + 6 张 after（每条技能 1 张）。

## 6. 落地顺序
1. 数据 + 配置（MAGIC 6 / AOE 配置 / TECH 2 / FUSION 3）
2. 释放函数 + 区域系统 + 绘制（逐条 6 个）
3. 科技钩子（相位甲 / 时序器）+ 装置
4. 奖励四选一 + 文案 + 快捷键
5. `tools/arcane_abatch.js` 断言 → 截图
6. PROGRESS（含自行判定）→ 全量 9 脚本串行回归 → `tools/arcane_cleanup.js --apply` → 报 C 盘
