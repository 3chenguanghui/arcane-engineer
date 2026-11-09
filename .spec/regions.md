# 第 13 项规格 v2 · 三大区 18–20 层 + 深度模式

> 状态：待批准（Spec Mode，第 2 版）
> 目标文件：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`（单文件零依赖）
> 量尺工具：`tools\arcane_ladder.js`（F1–F20）
> 新增验收：`tools\arcane_regions.js`
> 归属：PLAN.md 第 13 项；前置第 15 项（已完成）

---

## 0. v2 相对 v1 的三个改点（针对驳回）

1. **不再牺牲后期难度**：v1 以 F1=151 为锚，会把 F18 从 2876 砍到约 870（−70%），等同于全面削弱。
   v2 改为**后端锚定**：F18 维持在旧曲线 95–105%，通过抬升教学层单只血量来满足 8–12% 的斜率；F1 仍是 2 只、弱伤害、弱速度的弱怪。
2. **首领不抽空**：v1 把 F6 之外的首领房全删，破坏"每层清房→下楼"的既有节奏，还会打断既有首领测试。
   v2 保留每层首领房：普通层是本区**守卫首领**，F6/F12/F18 才是**区域首领**（专属标题、+15% 血量）；深层每 6 层为深层首领。
3. **平衡判据可执行**：v2 直接给出 F1–F18 的目标总血表与容差，调参按表标定；不再把"难度下降"推给第 14 项。

---

## 1. 目标

1. 大区成块：
   - 机械熔炉 F1–F6（区域首领 F6）
   - 符文回廊 F7–F12（区域首领 F12）
   - 虚空深渊 F13–F18（区域首领 F18）
   - 深层回廊 F19+（不封顶，档位递增、满档转横向机制）
2. 三个大区拥有**独立敌池、主题色、房间素材、家具语言、环境色调、专属首领**；深层使用第四套主题与混合敌池。
3. 总血曲线：同区相邻层 8–12%（±3 抖动 → 判定 5–15%）、跨区 ≤15%（判定 1.00–1.15）、无倒退；第 2/3 区整体 1.4–1.6x。
4. 教学段：F1 保持 2 只弱怪；F1→F2 ≤30%；F3→F4 的大台阶拆到 F3/F4 两级（各 ≤12%）。
5. 深度模式 F19+：每 5 层一档、+10% 总血；6 档封顶（F49）后不再加血，改加横向机制。
6. 切区演出：区域名 + 主题色过渡 + 音乐层切换；可点击/ESC 跳过，可在设置整体关闭。
7. 存档记录 `regionId / regionIndex / depthTier`；旧档无字段时按层数推导，不崩。
8. 三档难度在所有大区与深度都可用。

---

## 2. 需求歧义的自裁决（写入 PROGRESS）

| 歧义 | 裁决 | 理由 |
|---|---|---|
| "整体 1.4–1.6x/F1–F18" | 解释为**第 2/3 区各 6 层整体 1.4–1.6x**；第 1 区因 F1→F2 教学例外为 1.8x，单列说明；F1→F18 总量约 5.6x | 17 层按 8–12% 连乘不可能只到 1.6x；教学例外必然抬高第 1 区 |
| 绝对血量基准 | **后端锚定**：F18 = 旧曲线 95–105%（≈2730–3020）；F1 单只抬到约 250，仍为 2 只弱怪 | 满足斜率的同时不削弱后期；若以 F1=151 为锚，F18 只能到约 870，等于砍掉 70% 难度 |
| 首领出现频率 | 每层保留首领房；F6/F12/F18 为**区域首领**（`isRegionBoss=true`、+15% 血量、专属标题），其余层为本区**守卫首领**；深层每 6 层为深层首领 | 不破坏"清房→下楼"节奏与既有首领测试，同时落实区末区域首领 |
| 主题轮换 | 主题按大区锁定；`state.themeCycle` 保留为开局随机记录，但不再驱动 `getTheme` | 切区演出必须与区域主题一致 |
| 8–12% 的口径 | 用第 15 项量尺的**战斗房总血均值**；计数跳变层允许单只血量回落（会在表里标注） | 判据沿用既有量尺口径，不重新定义指标 |
| 挑战等级 | 只保证三档难度全层可用；第 14 项的 1–10 挑战等级不越界实现 | 不伪造下一项入口 |

---

## 3. 数据模型

### 3.1 `REGION_CONFIG`（插在 `THEME_CONFIG` 之后）

```js
const REGION_CONFIG = {
  enabled: true,
  blockSize: 6,
  deepStart: 19,
  themeLocked: true,
  regions: [
    { id:'foundry', name:'机械熔炉', en:'MECHANICAL FOUNDRY', from:1,  to:6,
      theme:'mech', pool:1, boss:'mech', endFloor:6,
      accent:'62, 230, 255',
      intro:'进入机械熔炉：冲撞与蒸汽扇形压制近身。',
      twist:'近战压迫 + 过热蒸汽' },
    { id:'gallery', name:'符文回廊', en:'RUNE GALLERY', from:7,  to:12,
      theme:'rune', pool:2, boss:'rune', endFloor:12,
      accent:'190, 130, 255',
      intro:'进入符文回廊：延迟符阵开始逼迫走位。',
      twist:'延迟符阵 + 走位惩罚' },
    { id:'abyss', name:'虚空深渊', en:'VOID ABYSS', from:13, to:18,
      theme:'void', pool:3, boss:'void', endFloor:18,
      accent:'255, 92, 170',
      intro:'进入虚空深渊：远程压制与吸能，站桩会被抽干。',
      twist:'远程压制 + 吸能' },
    { id:'deep', name:'深层回廊', en:'DEEP CORRIDOR', from:19, to:Infinity,
      theme:'deep', pool:4, boss:'deep', endFloor:null,
      accent:'120, 170, 255',
      intro:'进入深层：层数不封顶，满档后只加机制、不加血。',
      twist:'混合敌池 + 横向机制' }
  ],
  deep: { tierEvery:5, maxTier:6, hpPerTier:0.10, bossEvery:6,
          eliteBonusStep:0.05, affix2Step:0.08, hazardStep:0.12,
          eliteBonusCap:0.35, affix2Cap:0.55, hazardCap:1.6 },
  transition: { enabled:true, skippable:true, autoMs:1400, fadeMs:420 }
};
```

### 3.2 主题新增（`THEME_CONFIG`）

- `THEME_CONFIG.themes.deep`：近黑蓝底 `#070b15`、冷白墙线、蓝紫光、`prop:'deep'`、冷白尘埃。
- `getTheme(f)`：`themeLocked` 时返回 `regionThemeOf(f)`；`REGION_CONFIG.enabled === false` 时回退旧 `themeCycle`。

### 3.3 房间素材与家具语言

- `ROOM_TEMPLATE_CONFIG.templates.deep`：`spiral`（八边形+对角线）、`fracture`（L 形+堆叠），形状不重复 mech/rune/void。
- `bakeScene` 家具分支新增 `theme.prop === 'deep'`：断裂立柱 + 电缆 + 悬浮碎块。
- 主题色走既有 `accent/floorWash`，作用于墙、光、尘埃、地面。

### 3.4 音乐

- `BGM_CONFIG.themes.deep`：低频 46/69/92Hz，ping 146.8/174.6/220/261.6，lowpass 230，lfo 0.035。
- `playRegionTransition` 调 `crossfadeBgm(floor)`；关闭演出时仍切音乐层。

---

## 4. 结构与函数改造

### 4.1 区域助手（新增，放在 `isOpenFloor` 附近）

```js
regionIndexOf(f)      // 1..4
regionOf(f)           // region 对象
regionKeyOf(f)        // 1..4
regionThemeOf(f)      // 'mech'|'rune'|'void'|'deep'
isRegionEndFloor(f)   // 6/12/18；深层为 19+ 每 6 层
isRegionBossFloor(f)  // 6/12/18
isBossFloor(f)        // 每层都是 boss（保留既有节奏）
isRegionTransition(a,b)
deepTierOf(f)         // 0（<19）；1..6 封顶
deepHorizontalOf(f)   // 封顶后每 5 层的横向档
deepHpMulOf(f)        // 1 + tier*0.10，封顶后恒 1.60
```

### 4.2 替换所有 3 层轮换点

改用 `regionKeyOf(f)`：
`regionPoolForFloor`、`formationsForFloor`、`enemyRosterForFloor`、`spawnCorridorPatrols.key`、`getTheme`、`bossKindForFloor`、`tools\arcane_ladder.js` 的 `regionOf`。

### 4.3 敌池

- `REGION_ENEMY_POOLS[4] = 'deep'`：虚空远程 + 符文延迟 + 机械冲撞的代表怪混合。
- 三个大区池子互不相同；`EXCLUSIVE_ENEMY_CONFIG.byRegion[4]` 增加深层专属替换（复用既有专属怪，不新增精灵）。

### 4.4 首领

- `bossKindForFloor(f)`：按大区返回；深层按 `deepTierOf` 轮换三系首领。
- `generateFloor`：`stairRoom.type` 保持 `'boss'`；新增 `room.isRegionBoss = isRegionBossFloor(f)`。
- `spawnBoss`：区域首领血量乘 `BOSS_CONFIG.regionBossHpMul`（默认 1.15）；标题"区域首领 · 大区名"；守卫首领标题"守卫 · 大区名"。
- 深层每 6 层 `isDeepBoss=true`，标题"深层首领 · 第 N 档"。

---

## 5. 平衡：目标曲线与标定

### 5.1 应用点

把 `rampByFloor` 从"F6+ 预算房"扩展为**全层战斗/精英房**：

```js
const budgetHpScale = (hpRoom && (hpRoom.type==='battle' || hpRoom.type==='elite'))
  ? rampHpScale(floorNumber) : 1;
```

- 计数预算 `enemyBudgetApplies` 不变（仍只管 F6+），教学层数量不被改写。
- F1 的 `hpScale` 与 `weakFloor1` 共同作用，保留"2 只弱怪"（弱伤害/弱速度不变）。
- 深层在 `spawnEnemy` 再乘 `deepHpMulOf(f)`。

### 5.2 目标总血表（战斗房总血均值，单位：HP）

以 F18 锚定旧曲线（2876）；区内步长 9.5%，跨区 12%，F1→F2 25%。

| 层 | 目标 | 相对旧曲线 | 层 | 目标 | 相对旧曲线 |
|---|---|---|---|---|---|
| F1 | 515 | 3.41x（教学抬升） | F10 | 1361 | 0.90x |
| F2 | 644 | 1.28x | F11 | 1490 | 0.85x |
| F3 | 705 | 1.24x | F12 | 1631 | 0.88x |
| F4 | 772 | 0.88x | F13 | 1827 | 1.04x |
| F5 | 846 | 0.87x | F14 | 2001 | 0.92x |
| F6 | 926 | 0.73x | F15 | 2191 | 0.94x |
| F7 | 1037 | 0.93x | F16 | 2399 | 1.11x |
| F8 | 1135 | 0.85x | F17 | 2627 | 1.00x |
| F9 | 1243 | 0.75x | F18 | 2876 | 1.00x |

- 第 2 区 F7→F12：1.57x；第 3 区 F13→F18：1.57x（均落在 1.4–1.6）。
- 第 1 区 F1→F6：1.80x（教学例外，单列）。
- F1→F18：5.58x。
- 计数跳变层（F5→F6、F9→F10 等）单只血量会回落；以总血为准，表内注明。

### 5.3 标定算法（不照抄第 15 项建议值）

1. F1–F20 的 `hpScale` 暂设 1，`LADDER_DRY=1` 跑 1 轮 × 60 次 → 基准 `B_f`。
2. `hpScale_f = T_f / B_f`，钳制 0.40–2.50。
3. 再跑 1 轮 DRY，按 `hpScale_f *= T_f / 实测_f` 修正一次。
4. 正式 8 轮 × 60 次，写入历史。
5. PROGRESS 记录：字段 `rampByFloor[f].hpScale`、依据（DRY 基准/修正）、预期区间（`T_f ±5%`）。

> 不改 `floorScale`、`DIFFICULTY_CONFIG`、玩家伤害与掉落。

---

## 6. 深度模式

- 档位：`tier = clamp(ceil((f-18)/5), 1, 6)`；`hpMul = 1 + tier*0.10`，F19–23=1.10 … F49+=1.60。
- 封顶后横向档 `h = floor((f-19)/5) - 6`：
  - 精英比例 `+min(0.35, 0.05*h)`
  - 第二词缀概率 `+min(0.55, 0.08*h)`（复用 `affix2`）
  - 危险地形密度 `+min(1.6, 0.12*h)`（复用既有 hazard）
  - `h ≥ 4` 时深层首领房多 1 只普通怪
- 断言：F19–F48 阶梯单调；F49–F80 总血平台（max/min ≤1.02）；精英比例与第二词缀概率随 `h` 上升。

---

## 7. 切区演出

- DOM：`#floorWipe .wipe-text` 增加 `#wipeKicker`、`#wipeRegionText`；CSS `.floor-wipe.region` + `--wipe-accent`。
- `playRegionTransition(region, floor)`：区域名/EN/`第 N 层`/`区 1-3`；`accent` 驱动 420ms 过渡；`crossfadeBgm`；`autoMs` 自动结束；点击或 ESC 立即结束；关闭时只 toast。
- 设置面板新增 `#regionFxToggle`（`meta.regionFx`），复用 `motionTrail` 样式与持久化。
- `descendFloor` 比较前后区域触发一次；同层重开不重复。

---

## 8. 存档与迁移

- `generateFloor` 写 `state.regionId / regionIndex / depthTier`。
- `applyRunSnapshot` 后调用 `ensureRegionState()`：缺失或与 `floor` 不一致时按 `regionOf(floor)` 重算。
- `META_SCHEMA_VERSION` 7 → 8；旧档按"无字段 → 推导"迁移。
- 断言：删除三字段后读回，`regionId === regionOf(floor).id`、`depthTier === deepTierOf(floor)`。

---

## 9. 难度与可用性

- `difficultyCfg()`/`difficultyPressure()` 不按层/区门控；F1–F5 的教学固定普通保留。
- 断言：F1–F60 每层三档均返回对象，`hpMul` 与选择一致。
- 第 14 项不实现，仅保留 `regionId` 接口。

---

## 10. 验收

1. `node tools\arcane_syntax.js` PASS。
2. `node tools\arcane_regions.js` PASS（R1–R10）。
3. `node tools\arcane_ladder.js` 正式 8 轮：
   - 同区 1.05–1.15、跨区 1.00–1.15、无倒退、无 >15% 断崖
   - 第 2/3 区 1.40–1.60；第 1 区 1.70–1.90（教学例外）
   - F1→F2 ≤1.30
   - 保留旧 L1–L4（F6–F10 数量、8–12%、F5→F10 ≥1.35）
   - 深层 F19–F80 阶梯单调 + 封顶平台
   - 实测与目标表偏差 ≤5%
4. 回归：`arcane_openrandom`（O6/O9 改分区语义，覆盖 18 层）、`arcane_render_probe`、`arcane_ab_perf`、`arcane_talents`、`arcane_bossbp` 全 PASS。
5. 截图 ≤4：机械/符文/虚空/深层各 1 张。
6. PROGRESS 记录调参字段、依据、预期区间、实测表。

---

## 11. 分两次交付

- **第一次**：结构 + 机械熔炉完整 + F1–F6 量尺；报结构与一个完整大区。
- **第二次**：符文/虚空/深层 + F1–F20 与深层全量验收；报三大区完成与量尺结果。

---

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| F1 单只血量从约 75 抬到约 250 | 数量仍 2、伤害/速度仍弱；教学时长目标 ≤10s；`arcane_onboard` 复测 |
| 总血 8–12% 导致计数跳变层单只血量回落 | 以总血为准并在 PROGRESS 标注；不反向改弱旧断言 |
| 主题锁定与 item 12 的 themeCycle 断言冲突 | O6/O9 改为分区语义且覆盖 9→18 层，强度不降 |
| 敌池成块后方差变大 | 每层 60 次 × 8 轮；DRY 两轮标定再正式跑 |
| 深层横向机制影响帧预算 | 复用既有词缀/危险地形；不新增每帧 DOM；`arcane_ab_perf` 复测 |
