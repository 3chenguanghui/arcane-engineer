# 打击反馈与爽感 · 缺口拆解与补丁 v1

> 单写者纪律：本线**不修改主文件**，只出可粘贴补丁。全部段落以函数名/原文为锚点，逐段可独立回滚。
> 全局开关：`JUICE_V2_CONFIG.enabled`（**本补丁段 0 新增**）。地址栏 `?juice=off` 只在**补丁落地后**有效 —— 2026-11-09 核实：**主文件当前不存在 `?juice=off`**（`juice`/`JUICE` 全库 0 命中），主文件现有的开关是 `FEEL_CONFIG`、`?fx=low`、`?tier=off`、`?guard=off`、`?bg=off`、`?dev=1`、`?achnotice=off`、`?saveguard=off`。

## 落地顺序（2026-11-08 用户确认：A0 必须最先）

| 顺序 | 段 | 内容 | 前置/失败后果 |
|---|---|---|---|
| 1 | **A0** | `A11Y_PATCH_v1.md` 段 1：`flashScreen` 340ms 合并窗 | **已于 2026-11-09 落在主文件**（`flashScreen` 首行之后），复核数据见 9.2；若后续被回退 → **J3 禁止落地** |
| 2 | 段 0 | `JUICE_V2_CONFIG` 配置块（J1–J5 的依赖，不单独算落地单位） | 无 |
| 3 | J1 | 持续/延迟/反应伤害不冻结、不震屏 | — |
| 4 | J2 | 伤害数字堆叠 / 描边 / 暴击字号 | — |
| 5 | J3 | 闪白分级 + 同目标 0.34s 门限 | **依赖 A0** |
| 6 | J4 | 命中音去重 + 击杀尾音 | — |
| 7 | J5 | 普通击杀震屏 + 连杀节流 | — |

**为什么 A0 必须在前**：`flashScreen` 现在没有合并窗，S1 60ms / S2 110ms 各自 `setTimeout` 移除 class，重叠调用会互相截断 —— 实际闪白序列既可能被裁短、又可能超过 3 次/秒。**在"会被截断的闪白"之上做分级（J3），测出来的闪白时长与次数都不可信**。先让闪白变成"≤2.94 次/秒、且单次不会被下一次截断"，再谈分级。

A0 通过判据：`state.feel.flashCoalesced > 0`（确实发生过合流），且任意 1 秒窗口内 `is-on` 出现次数 ≤3。判据不成立时，J3 不贴。

## 0. 基线指纹

| 项 | 值 |
|---|---|
| 文件 | `index_arcane_v2.html` |
| 字节 | 2,868,713 |
| 行数 | 66,781 |
| MD5 | `FFD046B74C69C8603665FE872311919F` |

读取方式为单快照（一次性读入内存后同时取字节与哈希）。

**基线一天内变了五次**：11-08 记录 2,813,270 / 65,514 / `217969E2…`；11-09 上午 2,838,189 / 66,080 / `AB0C275D…`；11-09 下午 2,847,622 / 66,238 / `30B51FF7…`；11-09 傍晚 2,848,200 / 66,251 / `13D9C718…`；11-09 20:00 前后 2,868,713 / 66,781 / `FFD046B7…`（这一跳 +20,513 字节，其他线在大改）。本文档的 21 处锚点在 `13D9C718…` 与 `FFD046B7…` 两个版本上均逐条机器断言通过（命中数全部恰好相等，见 9.13.1），且 `FX_TIER_CONFIG` 的 45/90/60/130 未被改回 —— **但整合线每次落地前都必须重算 MD5**；与上表不一致说明又被改过，需重新核锚点。

---

## 1. 现状审计（逐项给数字，不给形容词）

### 1.1 命中停顿（hitstop）

| 参数 | 现值 | 位置 |
|---|---|---|
| S0 轻击 | 45ms | `FX_TIER_CONFIG.tiers.S0.hitStop` |
| S1 中档（重击/暴击/普通击杀） | 90ms | `.S1.hitStop` |
| S2 事件档 | 130ms | `.S2.hitStop` |
| 顿帧期世界时间流速 | 0.16 | `FEEL_CONFIG.hitStopScale` / `HITSTOP_CONFIG.scale` |
| 单次上限 | 220ms | `HITSTOP_CONFIG.maxSeconds` |
| 合并规则 | 取最大值，不累加 | `requestHitStop` |
| 生效时刻 | 命中帧**之后**一帧（≈16.7ms） | `pendingHitStop` 在帧末写入 |

净损失：一次 S0 冻结 45ms 中世界只前进 7.2ms，净失 37.8ms 游戏时间。

**已确认缺陷**：`fxTierRegisterHit` 不做来源过滤。`aoeZoneTick`（`field` 每 0.42s、`lavaBand`）、灼痕`dotBrand`的即时段、`elementReactDamage`（`reaction:true`）都会登记命中，于是**每次持续/延迟伤害也吃 45ms 顿帧 + 3px 震屏**。`CAST_FEEL_4SEG.md` §四 的第四行写明「DOT / 反应伤害 0ms（必须排除）」，但代码里这一条从未落地——前三档 45/90/130 落了，第四档漏了。

### 1.2 屏幕震动

| 档 | 幅度 / 时长 | 结构 |
|---|---|---|
| S0 | 3px / 0.10s | 四相位 1, −0.6, 0.3, −0.1 + `(1-u)²` 包络 |
| S1 | 6px / 0.18s | 同上，垂直分量 0.35 × 3 个来回 |
| S2 | 10px / 0.30s | 同上 |
| 视野上限 | 视野半径 × 1.6% | `FX_TIER_CONFIG.shakeMaxViewRatio` |

实际幅度（`zoom=0.85`，上限 = 0.008 × min(w,h)）：

- 1280×720 → 上限 6.78px，S2 由 10px 削到 6.78px（−32%）
- 1440×900 → 上限 8.47px（−15%）
- 1920×1080 → 上限 10.16px（不削）

另有独立震源：`killEnemy` 2.5px/0.12s；精英击杀 +4px/0.16s。

### 1.3 伤害数字

| 项 | 普通 | 重击(≥20) | 暴击 |
|---|---|---|---|
| 字号 | 12 | 16 | 16（旧值 19 被分级覆盖） |
| 颜色 | `#ffd9df` | `#ffe7a3` | `#ffcd4d` |
| 描边 | **0** | 3 | 3 |
| 生命 | 0.62s | 0.92s | 1.05s |
| 弹跳幅度 | 0.16 | 0.34 | 0.34 |

上浮 40px；弹出曲线为前 16% 生命做 `sin(π·p/0.16)` 放大；同目标位置固定（仅沿命中方向 +15px，垂直比例 0.45）。**无堆叠**：0.62s 内 3 连发的数字完全重合。

### 1.4 命中音效层数

- 逐事件层：`lightHit`(260→150Hz, 70ms) / `heavyHit`(95→42Hz, 180ms) / `critHit`(780→300Hz 方波, 110ms)，每条 = 1 振荡器 + 1 低通噪声（2 个音源）。
- 帧末层：无击杀时再播 `hit`(150→70Hz) 或 `heavy`，每种 1 振荡器 + 1 段 50ms 噪声 = 2 个音源。
- **同一次普通命中合计 4 个音源**；最长持续 240ms，无 200–500ms 尾音层。
- 限频 50ms（lightHit）、同屏 6 voice；同帧多杀音阶 1.00 → +0.12/只，封顶 1.60。

### 1.5 敌人受击位移与闪烁

| 项 | 轻 | 重 | 暴击 | Boss |
|---|---|---|---|---|
| 击退初速 | 150px/s | 232px/s | 315px/s | ×0.12 |
| 位移（衰减 9/s） | ≈16.7px | ≈25.8px | ≈35.0px | ≈2.0px |
| 闪白时长 | 32ms | 32ms | 32ms | 32ms |
| 挤压 | 峰值 (1.35, 0.70)，0.22s 恢复 | 同左 | 同左 | 同左 |

闪白实现：`enemy.flash = 0.16`，每帧 `-= dt*5` → 实际 32ms ≈ 2 帧。`dirAngle == null` 的命中（部分 AOE）无击退。

### 1.6 敌人死亡

- 实体**同帧 `splice` 移除**，无尸体、无倒地、无淡出。
- 替代演出：16 碎片 + 22 像素崩解块（重力 520，寿命 0.5s）+ 2 圈扩散环 + 「击杀 +1」+ 主题死亡形态 + 2.5px/0.12s 震屏；精英再 +4px/0.16s。
- 判定：属于「消失 + 解体」，崩解量足够（38 片），但重击击杀读不出「打飞」。

### 1.7 暴击与普通的区分度

| 项 | 普通 | 重击 | 暴击 |
|---|---|---|---|
| 档位 | S0（45ms / 3px / 无闪白） | S1（90ms / 6px / 60ms） | S1（同左） |
| 音色 | lightHit | heavyHit | critHit（方波 780→300Hz） |
| 数字 | 12px 粉 | 16px 暖黄 | 16px 金 + 前缀 |
| 击退 | ×1 | ×1.55 | ×2.1 |

暴击概率 12%、倍率 1.6。**重击与暴击同档同字号**，仅靠颜色/前缀/音色区分。

---

## 2. 同类量级对照（只做量级，不照抄）

| 参考 | 命中停顿 | 屏震 | 闪白 |
|---|---|---|---|
| 轻武器（匕首/爪） | 2–3 帧 @60fps = 33–50ms | 1–2px / 100ms | 2 帧 = 33ms |
| 中武器（剑/弓） | 4–6 帧 = 67–100ms | — | — |
| 重武器（锤/大剑） | 6–10 帧 = 100–167ms | 4–8px / 250ms | — |
| Hyper Light Drifter 冲刺接触 | ~4 帧 = 67ms | — | — |
| Dead Cells | 每击都有击退（匕首 60px/s、双手剑 380px/s） | 轻 | — |
| Nuclear Throne | — | 仅玩家死亡 8px | — |
| Hades | 只在部分武器、部分动作加顿帧 | 重击 ±2° 旋转微震 | — |
| 通用暴击配方 | 同档基础上加长 | — | 4 帧 = 67ms + 放大 1.1 |

来源：
- freegamesprites，《Game Feel in 2D Combat: 7 Juice Tricks That Make Hits Land》，2026-05-12（汇总 shipped 项目数值）
- Squirrel Eiserloh，《Juicing Your Cameras with Math》，GDC 2016（trauma² 曲线）
- GameRes，《游戏战斗设计分析：流畅、爽快、耐玩体验如何炼就?》（Hades 顿帧取舍）
- GDC Vault，《Juice It or Lose It》(Vlambeer, 2013)

结论：本作是高频魔法弹幕，落在「中武器区间下限」，推荐轻击 **33–50ms**；超过 55ms 在 6–8 次命中帧/秒时会让移动读成「黏」，低于 25ms（1.5 帧）只会读成掉帧。

**顿帧时间预算**（每次冻结净损失 = ms × 0.84）。45ms 是当前值、保持不变；35ms 列只作为「实测连发黏时」的降档参考：

| 命中帧/秒 | 45ms（当前，保持） | 35ms（降档参考） |
|---|---|---|
| 2 | 75.6ms/s | 58.8ms/s |
| 4 | 151.2ms/s | 117.6ms/s |
| 6 | 226.8ms/s | 176.4ms/s |
| 8 | 302.4ms/s | 235.2ms/s |

同帧多目标只算一次（已合并），所以上表按「有命中的帧」计，不按「命中次数」计。若 6 帧/秒以上实测仍读成「黏」，先按 45→40 调 5ms 再测，不要一步跳到 30ms 以下。

---

## 3. 参数表

| 编号 | 项 | 字段 | 从 → 到 | 理由 |
|---|---|---|---|---|
| A0 | 整屏闪白合流（前置） | `flashScreen` | 无门限 → **同一次 ≥340ms 间隔（2.94 次/秒）** | 原文收录在段 A0；J3 依赖它。340ms 折算 2.94Hz，给 0.06Hz 余量吸收计时抖动，硬线仍是 ≤3Hz |
| J0 | 轻击顿帧（不改值） | `FX_TIER_CONFIG.tiers.S0.hitStop` | **保持 45ms**（推荐区间 33–50ms，现值在区间上沿） | 上一轮已批准值，且删除 tick 冻结后冻结预算才真正落在「命中帧」上。若整合线实测连发黏，按 45→40→35 每档 5ms 下调并重跑命中帧统计；**不要加「每秒冻结预算」上限**，否则同样输入有时顿有时不顿，手感不可预期 |
| J1 | 持续/延迟/反应伤害不进顿帧与震屏 | `fxFrame.tickHits` + `fxTierFlush` | 每次 tick 45ms/3px → **0ms / 0px** | 0.42s 一拍持续冻结会把「有节奏的打击」变成「全程黏滞」；补上 `CAST_FEEL_4SEG.md` §四「DOT / 反应 0ms」这条从未落地的规则。飘字/闪白/逐事件音保留 |
| J2 | 同目标数字堆叠 + 描边 + 暴击字号 | `_floatStack` / `numberOpts` / `numberSize` | 堆叠 0px → **14px/层，≤3 层，0.45s 窗口**；描边 0 → **2px**；暴击 16 → **19px** | 0.62s 内 3 连发原本完全重合（14px ≈ 12px 字号 1.17 倍行高）；12px 粉字压在白色冲击环上对比不足；分级模式把旧值 19 吃掉了，暴击视觉反而变小 |
| J3 | 受击闪白分级 + 同目标 ≤3Hz 门限 | `enemy.flash` / `_flashAt` | 一律 32ms → **轻 32 / 重 48 / 暴击 64ms**，同目标间隔 ≥0.34s | 对齐「普通 2 帧、暴击 4 帧」；0.34s 门限 = 2.94Hz，**硬性 ≤3Hz**，不为了爽感破安全线 |
| J4 | 帧末重复命中音 | `fxTierFlush` 音效分支 | 每普通击中 4 音源 → **2 音源**；击杀尾音 50 → **260ms** | 去掉重复层是「更干净」；击杀补 200–500ms 尾音层，凑齐「预击/命中/尾音」三段 |
| J5 | 普通击杀震屏 + 连杀节流 | `killEnemy` | 2.5px/0.12s → **3.4px/0.16s**；并加 **250ms 内最多 1 次击杀震屏**（同屏击杀震屏源上限 N=1） | 每次击杀都有「句号」；3.4px 在 720p 上限 6.78px 内，不触上限。`triggerShake` 幅度取 max 不叠加、但**时长也取 max**：高频连杀每次把 `time` 续期到 0.16s，等于持续满幅晃动 → 必须限量 |

---

## 4. 补丁段（逐段粘贴，每段单独验证）

**粘贴顺序**：**A0 → 段 0 → J1 → J2 → J3 → J4 → J5**。
A0 必须先贴且先验；段 0 是 J1–J5 的共同依赖（不算独立落地单位）；J3 只有 A0 通过后才允许贴。其余各段之间无交叉依赖，任一段可单独回滚。

### 4.0 锚点索引（全部为字符串锚点，不用行号；行号会随其它线写入漂移）

| 段 | 锚点字符串（唯一匹配） | 回退方式 |
|---|---|---|
| A0 | `function flashScreen(color, msOverride) {` 的下一行（正文块首行是 `/* A11Y-P1：闪烁合流…`） | 删除该 6 行注释+判断 |
| 段 0 | `const TIER_FX_ENABLED = !/[?&]tier=off(?:&|=|$)/.test(location.search);` | 删除 `JUICE_V2_CONFIG` 整块 |
| J1(a) | `      suppressBurst: false` … `    };` | 删 `tickHits: 0` 并还原行尾逗号 |
| J1(b) | `  f.hits += 1;` 紧跟 `  if (o.crit) f.crits += 1;` | 删 `if (o.tick) …` 一行 |
| J1(c) | `    fxTierRegisterHit(enemy, { crit, heavy, lethal: enemy.hp <= 0, damage, dirAngle });` | 还原为单行对象 |
| J1(d) | `function aoeZoneTick(zone) {` 到 `function aoeZoneEnd(zone) {` 之间的 `zone.abilityId ? { abilityId: zone.abilityId } : undefined);`（**恰 2 处，`aoeZoneEnd` 里那处不动**） | 两处还原为 `zone.abilityId ? … : undefined` |
| J1(e) | `      damageEnemy(enemy, tickDamage, null, { abilityId: magic.id });` | 删 `, tick: true` |
| J1(f) | `  if (!f || f.flushed || (!f.hits && !f.eventTier)) return null;` | 整段还原为三行原文 |
| J1(g) | `  if (f.eventTier >= 2 || f.hits >= 5 \|\| f.kills >= 3 …` 与下一行 `else if` | 两处 `directHits` 换回 `f.hits` |
| J1(h) | `  if (f.hits > 0) {` 紧跟 `    const px = state.player ? state.player.x : bx;`；及 `4 + f.hits * 4` | 两处换回 `f.hits` |
| J1(i) | `  const summary = {` / `    hits: f.hits,` | 删 `hitStopReqs` 与 `tickHits` 两行 |
| J2(a) | `  const numberSize = numberTier` … `: (crit ? FEEL_CONFIG.critFloatSize : (heavy ? 16 : 12));` | 删 `numberSizeFinal`，`addFloat` 第 5 参换回 `numberSize` |
| J2(b) | `  let numberOpts;` 紧跟 `  if (numberTier && numberTier !== 'S0') {` | 删 S0 分支，恢复 `if` 首行 |
| J2(c) | `  addFloat(` … `    numberSize,\n    numberOpts\n  );`（伤害飘字那一处，**不是 `'击杀 +1'`**） | 删 stackDy 块，y 实参去掉 `- stackDy`，字号换回 `numberSize` |
| J3(a) | `  enemy.flash = FEEL_CONFIG.hitFlashTime;` | 去掉 `if (!JUICE_V2_CONFIG.enabled)` 前缀 |
| J3(b) | `  const offsetX = dirAngle == null ? 0 : Math.cos(dirAngle) * FEEL_CONFIG.floatForwardOffset;` | 删除其前插入的整块 |
| J4(a) | `    if (f.kills === 0) playSfx(tierNum >= 2 ? 'heavy' : 'hit', tier.volume, { force: tierNum >= 2 });` | 还原单行 |
| J4(b) | `    const frames = Math.max(64, Math.floor(ac.sampleRate * 0.05));` / `filter.frequency.value = 900 * pitch;` / `noise.stop(t0 + 0.05);` | 删 `tailSec` 行，三处还原常量 |
| J5 | `  triggerShake(2.5, 0.12);`（**仅 `killEnemy` 内这一处**；精英的 `triggerShake(4, 0.16)` 不动） | 整块还原为单行 |

以上 21 处已在 66,080 行版本上逐条机器断言过（每处命中次数必须等于预期，否则脚本中止），实测见 9.1。

### 段 A0：整屏闪白合并窗（前置，来自 `A11Y_PATCH_v1.md` 段 1）

**出处**：`A11Y_PATCH_v1.md` 段 1。**该段已于 2026-11-09 落在主文件**（复核数据见 9.2），本节保留原文只作回滚/核对用。原文档头的基线（`TARGET_MD5 = BA68478FE49A6DFA25C8B3F4CD368FAC` / 2,740,252 字节 / 63,930 行）与当前主文件（`AB0C275D…` / 2,838,189 字节 / 66,080 行）**不一致**，所以**不要用原文档的行号定位**，按下面锚点文本查找。

**锚点**：`function flashScreen(color, msOverride) {` 之后的第一条语句（`// U12 可访问性「关闭闪白」` 注释之前）

```js
  /* A11Y-P1：闪烁合流。WCAG 2.3.1 要求任意 1 秒内 ≤3 次，这里用 340ms 最小间隔封顶 2.94 次/秒。
     被合流的闪白只记账、不播放，不影响伤害判定与其它反馈。 */
  state.feel = state.feel || {};
  const __nowMs = performance.now();
  if (__nowMs - (state.feel.lastFlashAt || -1e9) < 340) {
    state.feel.flashCoalesced = (state.feel.flashCoalesced || 0) + 1;
    return;
  }
  state.feel.lastFlashAt = __nowMs;
```

**为什么它能同时解决"截断"和"超频"**：340ms 门限 > 单次最长闪白 110ms（S2），所以两次放行的闪白在时间上不可能重叠，`setTimeout` 不会互相 `remove('is-on')` 截短；同时 1/0.34 = 2.94Hz，硬线 ≤3Hz 不破。

**回滚**：删除这 6 行即可，`state.feel.flashCoalesced / lastFlashAt` 是纯记账字段，无副作用。

**A0 验收（先跑，通过才贴 J3）**：
1. 连续放 S1/S2 事件 10 次（或雷池 + 直接击杀密度场景 3 秒）：`state.feel.flashCoalesced > 0`。
2. 同一秒内对 `ui.flash` 采样 `classList.contains('is-on')`：任意 1 秒窗口内变为 `true` 的次数 ≤3。
3. 开关关闭时（`JUICE_V2_CONFIG.enabled === false`；落地后等价于 `?juice=off`）这条仍生效（A0 不属于 juice 开关范围，它只管安全线）。

### 段 0：配置块（J1–J5 的依赖，A0 通过后先贴）

锚点：`FX_TIER_CONFIG` 结束后（`const TIER_FX_ENABLED = ...` 之前）

```js
/* ============================================================================
   打击反馈与爽感补丁 v1（HIT_FEEL_PATCH_v1）
   单写者：只出补丁，不直接改主文件。全局开关 ?juice=off（随本块新增，主文件落地前无此参数）全部退回改动前。
   ========================================================================== */
const JUICE_V2_CONFIG = {
  enabled: !/[?&]juice=off(?:&|=|$)/.test(location.search),
  floatStackStep: 14,      // 同目标伤害数字纵向堆叠步长（px）
  flashCooldown: 0.34,     // 同一目标两次白闪最小间隔（≈2.94Hz，硬线 ≤3Hz）
  killShake: 3.4,          // 普通击杀震屏（原 2.5px）
  killShakeTime: 0.16,     // 原 0.12s
  killShakeGapMs: 250      // 击杀震屏节流：250ms 内最多 1 次（同屏击杀震屏源上限 N=1）
};
```

### 段 J1：持续伤害不冻结（必做，收益最大）

**(a)** `fxTierFrame` 的帧桶加字段：

```js
      suppressBurst: false,   // 第 6 轮：该帧跳过分档粒子（首领死亡已有专属大爆点）
      tickHits: 0             // 打击反馈线 J1：本帧"持续/延迟/反应"命中数
```

（原文该行结尾没有逗号，补上逗号再加新行。）

**(b)** `fxTierRegisterHit` 内，`f.hits += 1;` 之后插入：

```js
  if (o.tick) f.tickHits += 1;
```

**(c)** `damageEnemy` 的登记处（原文）：

```js
  if (FX_TIER_CONFIG.enabled) {
    fxTierRegisterHit(enemy, { crit, heavy, lethal: enemy.hp <= 0, damage, dirAngle });
  }
```

改为：

```js
  if (FX_TIER_CONFIG.enabled) {
    fxTierRegisterHit(enemy, {
      crit, heavy, lethal: enemy.hp <= 0, damage, dirAngle,
      /* J1：持续/延迟/反应伤害仍出飘字与闪白，但不申请顿帧/震屏 */
      tick: !!(opts && (opts.tick || opts.reaction))
    });
  }
```

**(d)** `aoeZoneTick` 两处调用各加 `tick: true`：

```js
      damageEnemy(enemy, zone.damage, Math.atan2(enemy.y - zone.y, enemy.x - zone.x),
        { abilityId: zone.abilityId, tick: true });
```
```js
      damageEnemy(enemy, zone.damage, Math.atan2(to.y - from.y, to.x - from.x),
        { abilityId: zone.abilityId, tick: true });
```
（原为 `zone.abilityId ? { abilityId: zone.abilityId } : undefined`，直接替换成上面的常量对象即可。）

**(e)** `dotBrand` 首拍：`damageEnemy(enemy, tickDamage, null, { abilityId: magic.id });` → 加 `tick: true`。

**(f)** `fxTierFlush` 开头（原文）：

```js
  const f = state && state.fxFrame;
  if (!f || f.flushed || (!f.hits && !f.eventTier)) return null;
  f.flushed = true;
```

改为：

```js
  const f = state && state.fxFrame;
  if (!f || f.flushed) return null;
  /* ?juice=off 必须完全退回旧行为（tick 照旧参与定档与冻结），所以扣减也受开关控制 */
  const directHits = JUICE_V2_CONFIG.enabled ? (f.hits - (f.tickHits || 0)) : f.hits;
  /* J1：整帧只有持续/延迟/反应命中（且无击杀）→ 不申请顿帧、不震屏、不出档位爆发。
     击杀仍放行：DoT 击杀也应有一次"句号"（杀帧会走下面的 S1）。 */
  if (JUICE_V2_CONFIG.enabled && f.hits > 0 && directHits === 0 && f.kills === 0 && !f.eventTier) {
    f.flushed = true;
    FX_TIER_STATS.tickOnlyFrames = (FX_TIER_STATS.tickOnlyFrames || 0) + 1;
    const tickSummary = {
      tier: 'TICK', hits: f.hits, kills: 0, crits: 0, eliteKill: 0,
      hitStopMs: 0, shake: 0, flashMs: 0, particles: 0, bursts: 0,
      merged: false, roomType: fxRoomTypeNow(), capped: false, reason: 'tickOnly',
      burstX: Math.round(f.x || 0), burstY: Math.round(f.y || 0), safePush: 0,
      tickOnly: true,
      /* J1 验收字段：本帧申请冻结的命中数 = 0（整帧只有 tick） */
      hitStopReqs: 0, tickHits: f.hits
    };
    state.lastFxTier = tickSummary;
    state.feel = state.feel || {};
    state.feel.fxFrame = tickSummary;
    return tickSummary;
  }
  if (!f.hits && !f.eventTier) return null;
  f.flushed = true;
```

**(g)** 定档两行把 `f.hits` 换成 `directHits`：

```js
  if (f.eventTier >= 2 || directHits >= 5 || f.kills >= 3 || f.eliteKill > 0) key = 'S2';
  else if (f.eventTier >= 1 || directHits >= 2 || f.kills > 0 || f.crits > 0) key = 'S1';
```

**(h)** 粒子上限（原文 `if (f.hits > 0) {` 与 `4 + f.hits * 4`）改为 `directHits`：

```js
  if (directHits > 0) {
    ...
    burstCount = Math.min(Math.round(tier.particles * (rp ? rp.particlesMul : 1)), 4 + directHits * 4);
```

**(i)** 帧摘要加两个验收字段（原文 `const summary = { tier: key, hits: f.hits, ... }`，在 `hits: f.hits,` 之后插入）：

```js
    hits: f.hits,
    /* J1 验收字段：本帧"真正申请冻结"的命中数（改前 = hits，改后 = directHits）。
       tick 击杀帧 directHits 为 0，但冻结由"击杀句号"申请 1 次 → 记 1，避免读数与实际冻结矛盾。 */
    hitStopReqs: directHits > 0 ? directHits : (f.kills > 0 ? 1 : 0),
    tickHits: f.tickHits || 0,
```

**J1 专项验收（"真的不冻了"）**

先说明机制事实：本作**没有"流血"这类可叠 3 层的 DoT**（`fireStacks / thunderStacks` 是遗物增伤层，不是持续伤害；`dotBrand` 灼痕是「1 即时 + 2 延迟」的一次性烙印，且延迟段走 `applyExplosion` 自带 40ms）。因此把"3 层流血"落到本作的等价物：**3 个持续源同帧结算**（雷池 `field` / 熔雷带 `lavaBand` / 燃云 `fireCloud`，前两者走 `aoeZoneTick`，燃云走 `elementReactDamage` → `reaction: true`）。

自然玩法里三源 tick 间隔不同（0.42s / `bandTick` / 0.5s），同帧对齐不稳定，所以**单帧口径用控制台同步注入**（主脚本是顶层作用域，`state / aoeZoneTick / damageEnemy / FX_TIER_STATS` 都可直接调用）：

```js
// ① 选一只血厚的活怪
const e = state.enemies.find(x => x && x.hp > 50);
// ② 造 3 个覆盖它的雷池，并同步各跑一拍（等价"3 层持续伤害"）
const mk = () => ({ type: 'field', x: e.x, y: e.y, radius: 120, life: 10, maxLife: 10,
  tick: 0, tickInterval: 0.42, damage: 1, color: '#9ad8ff', accent: '#9ad8ff', abilityId: 'arcanePool' });
state.aoeZones = state.aoeZones || [];
const zs = [mk(), mk(), mk()];
state.aoeZones.push(...zs);
zs.forEach(z => aoeZoneTick(z));
// ③ 同一帧内补一次"直接命中"
damageEnemy(e, 5, 0, { abilityId: 'arcanePool' });
// ④ 等一帧（setTimeout 30ms）后读
setTimeout(() => console.log(state.lastFxTier), 30);
```

| 口径 | 改前 | 改后 |
|---|---|---|
| 本帧命中登记数 | `hits = 4` | `hits = 4`（tick 3 + 直接 1） |
| **本帧冻结申请数** | **4**（4 次命中各自申请；合并后实得 S1 = 90ms 一次冻结） | **1**（`hitStopReqs = 1`、`tickHits = 3`；实得 S0 = 45ms） |
| 本帧震屏 | 6px / 0.18s（S1） | 3px / 0.10s（S0） |
| 击杀放行 | — | 若这 4 次里含击杀，仍走 S1（DoT 击杀保留"句号"） |

"冻结申请数"的口径统一为：**本帧内会各自申请冻结的命中条数**，不是 `requestHitStop` 的调用次数（后者本来就是每帧 1 次、取 max）。改前没有 `hitStopReqs` 字段，直接用 `hits` 读数即可。

自然玩法补充口径（防"只在注入场景成立"）：目标站在雷池 8 秒，`FX_TIER_STATS.tickOnlyFrames` 应持续递增，且这些帧的 `hitStopMs === 0`。

**边界说明（本段不覆盖，别误读为"所有 DoT 都不冻了"）**：灼痕 `dotBrand` 的 2 段延迟伤害走 `aoeZoneEnd → applyExplosion`，那里有独立的 `requestHitStop(0.04)` + `triggerShake(3)`；它和真实爆炸（火球 AOE 等）共用同一个出口，所以本段**不动**。它是一次性的 2 拍、不是 0.42s 周期，不属于"持续黏滞"的主因；若后续要连它一起去掉，需要给 `applyExplosion` 的 `blast` 加 `noFreeze` 字段，影响面大于本段，单列。

注：`fxTierNumberTier` 内还有一处 `if (f.hits >= 5) return 'aoe5';` 决定伤害数字档位，**本次不改**——它同时服务「同帧 5+ 直接命中」的既有大字设计，改动会与上一轮已批准的多目标大字冲突，只影响视觉字号、不影响顿帧。

### 段 J2：伤害数字（描边 + 堆叠 + 暴击字号）

**(a)** `const numberSize = ...;` 之后插入暴击字号兜底：

```js
  /* J2：分级模式下暴击字号被 S1 的字号压掉了旧值 19 → 取两者最大值 */
  const numberSizeFinal = (JUICE_V2_CONFIG.enabled && crit)
    ? Math.max(numberSize, FEEL_CONFIG.critFloatSize)
    : numberSize;
```

**(b)** `damageEnemy` 中 `let numberOpts;` 的首分支前插入描边：

```js
  let numberOpts;
  /* J2：轻击 12px 粉字原先无描边，压在白色冲击环上读不清 */
  if (JUICE_V2_CONFIG.enabled && numberTier === 'S0') {
    numberOpts = { outline: 2, outlineColor: 'rgba(40, 14, 6, 0.85)' };
  } else if (numberTier && numberTier !== 'S0') {
```

**(c)** `addFloat(...)` 调用前插入堆叠计算，y 实参减 `stackDy`、字号改用 `numberSizeFinal`：

```js
  /* J2：同目标 0.45s 内的连击数字纵向堆叠，避免完全重合 */
  let stackDy = 0;
  if (JUICE_V2_CONFIG.enabled) {
    state.feel = state.feel || {};
    const _nowFloat = Number.isFinite(state.realElapsed) ? state.realElapsed : (state.elapsed || 0);
    if (enemy._floatAt == null || _nowFloat - enemy._floatAt > 0.45) {
      enemy._floatAt = _nowFloat;
      enemy._floatStack = 0;
    }
    enemy._floatStack = Math.min(3, (enemy._floatStack || 0) + 1);
    stackDy = (enemy._floatStack - 1) * JUICE_V2_CONFIG.floatStackStep;
    if (stackDy > 0) state.feel.juiceStack = (state.feel.juiceStack || 0) + 1;
  }
  addFloat(
    (crit ? '暴击 -' : '-') + damage,
    enemy.x + offsetX,
    enemy.y - enemy.radius - 10 + offsetY - stackDy,
    numberColor,
    numberSizeFinal,
    numberOpts
  );
```

### 段 J3：闪白分级（含 3Hz 门限）

> **前置：A0 必须先落地并通过验收**。A0 之前的 `flashScreen` 每次各自 `setTimeout` 移除 class、重叠时会互相截断，分级测出来的时长不可信；A0 之后 340ms 门限 > 单次最长 110ms，分级才能被稳定观测。

**(a)** 先把原有的无条件赋值关掉（原文 `enemy.flash = FEEL_CONFIG.hitFlashTime;`，在 `heavy` 计算之前）：

```js
  if (!JUICE_V2_CONFIG.enabled) enemy.flash = FEEL_CONFIG.hitFlashTime;
```

（否则这一行每次命中都会把 32ms 闪白重新写上，后面的 3Hz 门限等于没做。）

**(b)** 在 `enemy` 的 `heavy` 与击退计算完成之后（`const offsetX = ...` 之前）插入分级与门限：

```js
  /* J3：闪白分级（轻 32 / 重 48 / 暴击 64ms），并按同一目标 ≤3Hz 门限。
     3Hz 是 A11Y_REVIEW 的硬安全线，不能为了爽感破。 */
  if (JUICE_V2_CONFIG.enabled) {
    state.feel = state.feel || {};
    const flashHold = crit ? 0.32 : (heavy ? 0.24 : 0.16);
    const nowFlash = Number.isFinite(state.realElapsed) ? state.realElapsed : (state.elapsed || 0);
    if (enemy._flashAt == null || nowFlash - enemy._flashAt >= JUICE_V2_CONFIG.flashCooldown) {
      enemy.flash = flashHold;
      enemy._flashAt = nowFlash;
    } else {
      state.feel.juiceFlashGated = (state.feel.juiceFlashGated || 0) + 1;
    }
  }
```

说明：`enemy.flash` 仍按 `dt*5` 衰减，故 0.32/0.24/0.16 分别对应 64/48/32ms。

### 段 J4：命中音去重 + 击杀尾音

**(a)** `fxTierFlush` 音效分支（原文）：

```js
    if (f.kills === 0) playSfx(tierNum >= 2 ? 'heavy' : 'hit', tier.volume, { force: tierNum >= 2 });
```

改为：

```js
    if (f.kills === 0 && (tierNum >= 2 || !JUICE_V2_CONFIG.enabled)) {
      playSfx(tierNum >= 2 ? 'heavy' : 'hit', tier.volume, { force: tierNum >= 2 });
    } else if (f.kills === 0) {
      FX_TIER_STATS.frameSfxSkipped = (FX_TIER_STATS.frameSfxSkipped || 0) + 1;
    }
```

**(b)** `buildSfx` 的 50ms 噪声层（原文 `const frames = Math.max(64, Math.floor(ac.sampleRate * 0.05));` 与 `noise.stop(t0 + 0.05);`）：

```js
    const tailSec = (name === 'kill' && JUICE_V2_CONFIG.enabled) ? 0.26 : 0.05;
    const frames = Math.max(64, Math.floor(ac.sampleRate * tailSec));
```
```js
    filter.frequency.value = (name === 'kill' && JUICE_V2_CONFIG.enabled ? 620 : 900) * pitch;
```
```js
    noise.stop(t0 + tailSec);
```


### 段 J5：普通击杀震屏 + 连杀节流

锚点：`killEnemy` 内 `triggerShake(2.5, 0.12);`

```js
  if (JUICE_V2_CONFIG.enabled) {
    /* J5：击杀震屏节流。triggerShake 的幅度取 max（不叠加），但时长也取 max：
       高密度连杀时每次击杀都把 time 续期回 0.16s，包络一直被重置在起手段，
       结果就是"持续满幅晃动"。这里限成 250ms 内最多 1 次（同屏击杀震屏源 N=1）。 */
    const __nowKill = performance.now();
    if (!state.feel) state.feel = {};
    if (state.feel.killShakeAt == null || __nowKill - state.feel.killShakeAt >= JUICE_V2_CONFIG.killShakeGapMs) {
      state.feel.killShakeAt = __nowKill;
      FX_TIER_STATS.killShakeFired = (FX_TIER_STATS.killShakeFired || 0) + 1;
      triggerShake(JUICE_V2_CONFIG.killShake, JUICE_V2_CONFIG.killShakeTime);
    } else {
      FX_TIER_STATS.killShakeGated = (FX_TIER_STATS.killShakeGated || 0) + 1;
    }
  } else {
    triggerShake(2.5, 0.12);
  }
```

**为什么是 250ms / N=1**：
- `killEnemy` 每次调用都会进 `triggerShake`，而 `triggerShake` 里 `state.shake.time = Math.max(cur, time)`、`power` 也取 max —— 幅度不会累加，**但时长会被无限续期**。
- 包络是 `u = 1 - time/dur`、`amp = power × shakeCurveAt(u)`，`u≈0` 是满幅起手。击杀间隔 < 0.16s 时 `time` 永远回不到 0，等于一直停在满幅 → 读成"持续晃动/晕"。
- 250ms 闸门 → 两次击杀震屏之间至少留 90ms 完全静止（250 − 160），单屏同时只有 1 个击杀震屏源，峰值恒为 3.4px（极致密度下也不会叠成 6px+）。
- 击杀震屏与档位震屏共用同一个 `state.shake` 通道（取 max、不求和），所以整个画面**最多 2 个震源**（击杀 1 个 + 档位 1 个），且幅度不会相加。

**J5 专项自检（"40 连杀不晕"）**

1. 进高密度房，用 AOE 连续清场，10 秒内累计 ≥40 杀。
2. 读数（控制台，跑完即关）：
   ```js
   let n = 0, zero = 0; const t0 = performance.now();
   (function tick() {
     if (performance.now() - t0 < 10000) {
       n += 1; if (state.shake.power === 0) zero += 1;
       requestAnimationFrame(tick);
     } else console.log('静止帧占比', (zero / n).toFixed(3), 'fired', FX_TIER_STATS.killShakeFired, 'gated', FX_TIER_STATS.killShakeGated);
   })();
   ```
3. 通过线：
   - `killShakeGated > 0`（说明节流真的生效过）；`killShakeFired` ≤ 40。
   - 10 秒窗口内 `state.shake.power === 0` 的帧占比 **≥ 25%**（40 杀/10s = 4/s，远低于闸门上限，正常应接近 60%；若 <25% 说明还有别的震源在持续续期，需回头查 S2 节流）。
   - `state.shake.power` 峰值 ≤ 6.0（击杀源 3.4；同时叠加档位 S1 时取 max 6）。
   - 关闭闸门（临时把 `killShakeGapMs` 设 0）复跑：静止帧占比应明显下降 —— 这一组是"证明闸门有用"的对照，不是验收线。

### 4.6 贴前检查清单（必须同一批完成，别靠记性）

| # | 动作 | 不做的后果 |
|---|---|---|
| 1 | `A0` **复验**（已落地）：`state.feel.flashCoalesced > 0` 且 1 秒内 `is-on` ≤3 | 不成立 → 说明 A0 被回退或改坏，**J3 一律不贴** |
| 2 | **同批改 `tools/arcane_fxtier.js` 期望值**：`S0 hitStopMs` **0 → 45**、`S1 hitStopMs` **55 → 90**、`flashMs` **40 → 60**（第 115–136 行附近） | 不改会把主文件现值误报成回归；注意是 45/90/60，**不是** 35/55/40。**已完成 2026-11-09**（S2 130/110、震屏 3/6/10、粒子 10/26/58、视野 1.6% 一并同步，13/13 通过，见 9.13.2） |
| 3 | 重算主文件指纹（字节 / 行数 / MD5）并回填第 0 节 | 锚点可能已漂移；`A11Y_PATCH_v1.md` 头部的 `BA68478F…` 已过期，别照抄 |
| 4 | **补丁落地后**用 `?juice=off` 跑一遍 A/B（落地前主文件没有这个参数，**不能**用它验收）：tick 照旧冻结、数字 12px 无描边、击杀震屏 2.5px/0.12s | 关不掉说明配置块里 `enabled` 的正则写错；落地前想自查只能运行时把 `JUICE_V2_CONFIG.enabled = false` |
| 5 | 贴完跑 `node tools/arcane_feel.js`（A0–A9）与 `node tools/arcane_fxtier.js` | 只跑 feel 会漏掉第 2 条的档位断言 |

---

## 零值陷阱（判空规则：时间戳 / 计数器一律 `== null`，不用 `!`）

> 2026-11-09 用户要求单独立节。这条不是三个小 bug，是同一个错误被写了三遍：
> **用"假值"表达"从没发生过"，而合法值里包含 `0`。**

### 病症

JS 里 `!x` 同时命中 `null`、`undefined`、`0`、`''`、`false`、`NaN`。时间戳和计数器的"未初始化"只有 `null` / `undefined` 两种，但它们的合法值会合法地取到 `0`：

- `state.elapsed` 从 0 开始（开局第一帧、非战斗态不推进）；
- `_floatAt` / `_flashAt` 第一次写入就可能等于 0（战斗刚开始 / `state.elapsed` 被重置）；
- 自增计数器 `_floatStack` 的初值语义是 0。

一旦 `!x` 把 `0` 当成"未初始化"，逻辑就朝两个方向坏掉：要么**每次都当成第一次**（窗口永不生效），要么**每次都当成过期**（状态永远重置）。

### 本次实测到的三处

| # | 原写法 | 位置 | 实测后果 | 修法 |
|---|---|---|---|---|
| 1 | `if (!enemy._floatAt \|\| _now - enemy._floatAt > 0.45)` | 段 J2(c) | `_floatAt === 0` 时 `!0 === true` → 每次都判定"窗口过期" → 堆叠永远只有 1 层。实测 y 偏移恒为 `0,0,0,0,0` | `enemy._floatAt == null` |
| 2 | `if (!enemy._flashAt \|\| …)` | 段 J3(b) | 同一族：第一次闪白的时间戳若为 0，之后每次都被当作"从没闪过"，0.34s 门限失效 | `enemy._flashAt == null` |
| 3 | `const nowFlash = Number.isFinite(state.realElapsed) ? state.realElapsed : 0;` | 段 J3(b) | 非战斗态 `state.elapsed` 不推进、`realElapsed` 不存在 → 回退到 `0`，而 `_flashAt` 也是 `0` → `0 - 0 < 0.34` 恒成立 → **门限永久锁死，一次都不放行** | 回退到另一个真实时钟：`: (state.elapsed \|\| 0)` |
| 4 | `if (!state.feel.killShakeAt \|\| …)` | 段 J5 | `performance.now()` 实际不会返回 0，属同类预防性统一；不修则将来换成相对时间基准必踩 | `state.feel.killShakeAt == null` |

第 1、2、3 条都是**跑测复现**的（不是看代码看出来的）：J2 首测 `0,0,0,0,0` / stack 恒 1；J3 首测门限锁死。第 4 条是同类预防。

### 判据（贴前检查按这个查）

1. **时间戳、计数器、"上次发生时刻"、"上次重置时刻"**：判空一律 `x == null`（或 `typeof x !== 'number'`），**禁止** `!x`。
2. **时间基准的回退值不能是 `0`**：`0` 表示"世界时间原点"，不是"未知"。回退必须落到另一个真实时钟（本线用 `state.elapsed`）。如果两个时钟都不可用，宁可不做时间判断，也不能用 `0` 当哨兵。
3. **只有"布尔语义"才可以用 `!x`**：`enabled`、`flushed`、`merged` 这类本来就是布尔量的，`!x` 正确；对象引用判空（`if (!enemy)`）也正确 — 但它们不参与"时间差"计算。
4. **自检方式**：把时间基准显式置 0（或让 `state.elapsed` 停在 0）再跑一次，行为必须与"正常时刻"一致。测不出差异才算这条规则过。
5. **代码检索式**：`!.*[_A-Za-z]At\b`（所有 `xxxAt` 字段的取反判断）在补丁里应为 0 命中；本次修完后 21 处锚点重跑全过。

### 为什么单独记一笔

J2/J3/J4 的实际改动量很小（堆叠 14px、描边 2、三档闪白、去一层音），真正会反复咬人的是这类**判空语义**。它们不会报错、不会崩，只会让"改了却像没改"，然后被误判成"参数没用"或"性能问题"。以后任何"时间戳 / 计数器"字段，先按本节过一遍。

---

## 5. 代价

| 段 | 每帧新增 | 绘制/粒子 | p95 |
|---|---|---|---|
| A0 | 1 次 `performance.now()` + 1 次比较（只在有闪白请求时执行，不是每帧） | 0（被合流的闪白直接 return，**减少**一次 class 写入） | 不可分辨 |
| J1 | 1 次整数减法、1 次比较 | **减少**：tick 帧不再出档位爆发/环 | 不可分辨（≤0，方向为降） |
| J2 | 4 次属性读写 + 最多 3 个额外文本 | 最多 +3 个 `fillText`（同屏 3 个目标各 1 层），约 0.01ms | 不可分辨 |
| J3 | 1 次时间比较 | 0（只改已有闪白时长） | 不可分辨 |
| J4 | 0 | 音源：普通命中帧 −1 次合成（−2 音源）；击杀 +1 个 260ms 噪声缓冲（约 0.02ms 音频线程） | 不可分辨 |
| J5 | 1 次 `performance.now()` + 1 次比较（仅击杀帧） | 0（节流后 `triggerShake` 与 `SHAKE_STATS.ring.push` **减少**） | 不可分辨 |

合计：无新增粒子、无新增 canvas 路径、无新增 drawcall、无新增整屏闪白。按 2.2ms 的测量分辨力，本线**不做毫秒增量声明**，一律判「不可分辨」。p95 只按配对口径测：同进程交替（运行时切 `JUICE_V2_CONFIG.enabled` ↔ 默认；**主文件没有 `?juice=off` 这个参数**，落地后才等价）≥3 轮，**只报两次的差值**，不报单轮绝对值；差值 <2.2ms 即判不可分辨。

---

## 6. 验收（整合线贴完后逐条跑）

**A0（前置，先跑）**
1. 10 次 S1/S2 事件后 `state.feel.flashCoalesced > 0`；任意 1 秒内 `ui.flash.is-on` 变 `true` 的次数 ≤3。不通过 → 停，J3 不贴。

**J1（唯一真正改手感的段，验收要能证明"真的不冻了"）**
2. 单帧口径（段 J1 的注入脚本）：改前 `hits = 4`（= 4 个冻结申请）、`hitStopMs = 90`；改后 `hitStopReqs = 1`、`tickHits = 3`、`hitStopMs = 45`。**核心判据：4 → 1。**
3. 自然口径：站进雷池 8 秒，`FX_TIER_STATS.tickOnlyFrames` 持续递增，且这些帧 `hitStopMs === 0`、`shake === 0`。
4. DoT 击杀仍放行：击杀帧 `tier === 'S1'`（tick 不吞掉死亡句号）。
5. `S0` 直接命中：`state.feel.lastHitStopMs === 45`（J0 不改值，确认没被误改）。
6. 开关关闭时（`JUICE_V2_CONFIG.enabled = false`，落地后等价于 `?juice=off`）：tick 照旧冻结、普通字号 12 无描边、无堆叠、击杀震屏 2.5px/0.12s —— A/B 基线。

**J2**
7. 同目标连续 5 次命中：数字 y 呈 `0 / −14 / −28 / −28 / −28`（`state.feel.juiceStack > 0`）。
8. 暴击：字号 `19`，描边存在。

**J3**
9. 同目标 1 秒内被命中 10 次：白闪实际次数 ≤3（`state.feel.juiceFlashGated > 0`）。

**J4**
10. 普通命中帧音源数 4 → 2（`FX_TIER_STATS.frameSfxSkipped` 递增）。
11. 击杀噪声层持续 260ms（`kill`）。

**J5**
12. 40 连杀自检：`killShakeGated > 0`、`killShakeFired ≤ 40`、10 秒内 `state.shake.power === 0` 的帧占比 ≥25%、峰值 ≤6.0px。
13. 击杀震屏 3.4px / 0.16s（`state.feel.lastShakeAmp` 或 `SHAKE_STATS.lastPeak`）。

**总回归**
14. 贴完跑 `node tools/arcane_feel.js`（A0–A9 全绿）与 `node tools/arcane_fxtier.js`（须已按 4.6 第 2 条改成 45/90/60）。

**性能口径**：p95 用配对法 —— 同进程交替（运行时切 `JUICE_V2_CONFIG.enabled`；**主文件当前没有 `?juice=off` 参数**，落地后才等价）≥3 轮，只报差值；差值 <2.2ms 判「不可分辨」，不写毫秒增量。

**已知测试口径不一致（非本补丁引入，但必须同批修）**：`tools/arcane_fxtier.js` 第 115–136 行仍按旧设计断言 `S0 hitStopMs === 0`、`S1 hitStopMs === 55 && flashMs === 40`，而当前主文件是 45/90/60。落地本补丁时**同一批**把期望值改为 **S0→45、S1→90、flash→60**，否则会把现值误判成回归。**2026-11-09 已完成并验证：13/13 通过，见 9.13.2。**

---

## 7. 明确不做（附理由）

| 不做 | 理由 |
|---|---|
| 提高 S2 震屏到 1280×720 也满 10px | 需把 `shakeMaxViewRatio` 从 1.6% 提到 2.4%，突破既有可读性锚点；且 ≥1080p 已是满值 |
| 任何新增整屏闪白 / 高频闪白 | 硬安全线 ≤3Hz；现状 S1 60ms、S2 110ms **无合并窗**（`flashScreen` 每次各自 `setTimeout` 移除 class，重叠调用还会互相截断），最密时可达 5–6 次/秒。**本线不新增**；合并窗已抽成前置段 A0（340ms），A0 不过 → J3 不贴 |
| 「每秒冻结预算」上限 | 同样输入有时顿有时不顿，比轻微黏更糟；J0 用「命中帧/秒 × ms」预算表替代，只在实测连发黏时按 5ms 档降值 |
| 尸体/倒地系统 | 新增实体与更新开销，与既有 22 块像素崩解重复；收益低于成本 |
| 修改 `hitstop` 的 1 帧结构性延迟 | 消除需重算 `worldDt`，改动面覆盖主循环；16.7ms 延迟在命中帧视觉上不可辨，收益不划算 |
| 新增粒子/新环 | 会抬高 draw 与 p95，且现有 S1/S2 环已够 |

---

## 8. 一句话结论

「不爽」的主因不是缺特效，而是**信号互相抵消**：持续伤害按 0.42s 一拍重复申请 45ms 冻结与 3px 震屏（黏滞感），普通命中 4 个音源互相盖住（听不出打击点），普通数字无描边且连击完全重合（读不出伤害），暴击在大字档里反而缩到 16px（记忆点被抹平）。本补丁 5 段全部是**去干扰 + 拉层级**，不靠加量。顿帧 45ms 不动：删掉 tick 冻结后，冻结预算才真正落在「命中帧」上。

落地顺序：**A0（闪白合并窗，前置且 A0 不过则 J3 不贴）→ J1 → J2 → J3 → J4 → J5**。合计代价低于 2.2ms 分辨力，判「不可分辨」；性能只报配对差值。

---

## 9. 实测报告（2026-11-09，副本跑测）

### 9.1 测法与约束

- 主文件**未写入**。把当前主文件原样复制成 `base.html`（改前），再用脚本逐条替换生成 `patched.html`（段 0 + J1–J5 全贴）。
- 脚本对每处锚点断言"全文恰好出现 N 次"，21 处全部命中（含 `aoeZoneTick` 区间内 2 处），**无一处靠行号**；任一断言失败会直接中止并打印上下文。
- 浏览器：无头 Edge（本机 Chrome 缺失，Puppeteer 自带 Chrome 的 `chrome.dll` 加载失败）。一次只开一个页面，跑完导航到 `about:blank` 并终止无头进程。
- 所有数值来自 `fxTierFlush()` 的返回摘要与 `FX_TIER_STATS` 记账字段，**不是估算**。

### 9.2 A0（闪白合并窗）：复核通过

主文件里 **A0 已经落地**（当前版本 `flashScreen` 开头即有 340ms 合并窗，锚点文本与 `A11Y_PATCH_v1.md` 段 1 完全一致），因此本轮只做复核，不重复贴。

实测：600ms 内调用 `flashScreen` 10 次 →

| 指标 | 实测 |
|---|---|
| 实际播放（`is-on` 上升沿） | **2 次**（70ms、429ms） |
| 被合流（`state.feel.flashCoalesced` 增量） | **8 次** |
| 任意 1 秒窗口内最多播放 | **2 次**（≤3，达标） |

结论：A0 判据成立 → **J3 允许落地**。

### 9.3 J1：同帧确定性场景（3 雷池各一拍 + 1 次直接命中）

把目标怪移到 (6000, 6000) 隔离（否则半径 120 的雷池会连带打到旁边叠在一起的怪，实测会变成 7 次命中），`hp` 临时置 99999，禁止暴击（`noCrit: true`，否则 12% 概率命中暴击会把档位抬到 S1，读数会抖）。

| 口径 | 改前（base） | 改后（patched） |
|---|---|---|
| 帧桶 `hits` | **4** | **4** |
| `tickHits` | 无此字段 | **3** |
| **冻结申请数** | **4**（= `hits`） | **1**（`hitStopReqs`） |
| 定档 | S1 | **S0** |
| 帧末冻结 | **90ms** | **45ms** |
| 帧末震屏 | **5.6px** | **3.0px** |

**核心判据 4 → 1，达成。**

**10 次重复的分布（同一版本副本，逐次重建帧桶）**：

| 版本 | 结果分布 |
|---|---|
| 改前 | `tier=S1 hits=4 ms=90 shake=5.6` × **10/10**（与是否暴击无关，因为 `hits>=2` 恒成立） |
| 改后 | `tier=S0 requests=1 tick=3 ms=45` × **6/10**<br>`tier=S1 requests=1 tick=3 crits=1 ms=90` × **4/10** |

那 4/10 的 S1 不是补丁失效：**雷池 tick 自己也会暴击**（`aoeZoneTick` 内部的 `damageEnemy` 没带 `noCrit`，12%/次 × 3 次 ≈ 32%），一旦 tick 暴击，帧档位按既有规则升到 S1。补丁保证的"冻结申请数"仍然是 **1**，只是这一次冻结值按 S1 取 90ms。口径写清：**4 → 1 是恒定的；45ms 占 6/10、90ms 占 4/10，改前恒为 90ms**。

补充两个单帧口径：

| 场景 | 结果 |
|---|---|
| 纯 tick 帧（3 雷池，无直接命中） | `tier = 'TICK'`、`hitStopMs = 0`、`shake = 0`、`hitStopReqs = 0`、`tickHits = 3`、`FX_TIER_STATS.tickOnlyFrames` +1 |
| tick 击杀帧（3 雷池把残血怪打死） | `tier = 'S1'`、`kills = 1`、`hitStopMs = 90`、`hitStopReqs = 1`（冻结由"击杀句号"申请，记 1） |

注：`hitStopReqs` 在 tick 击杀帧记 1 而不是 0 —— 否则会出现"读数为 0、实际冻了 90ms"的自相矛盾。这是本轮跑测后对补丁的一处修正，已同步进段 J1(i)。

### 9.4 J5：连杀震屏自检（清场后只保留击杀震源）

测法：清空 `state.enemies`，用同一个 `crawler` 克隆体反复 `killEnemy`，每帧采样 `state.shake.power`。玩家血量置 1e9，避免死亡中断。**注意：不清场时房间里的 Boss 会持续放 S2 震屏，峰值会被污染成 8px，测出来的不是击杀震屏。**

| 场景 | 杀数 | 静止帧占比 | 最长连续晃动 | 峰值 | fired | gated |
|---|---|---|---|---|---|---|
| 改前 4 杀/秒（2.5px/0.12s） | 38 | 0.512 | **646ms** | 8.0px* | — | — |
| 改前 20 杀/秒 | 20 | 0.339 | **2419ms** | 5.0px | — | — |
| 改后 4 杀/秒（3.4px/0.16s + 250ms 闸门） | 39 | **0.593** | **219ms** | **5.0px** | 23 | 16 |
| 改后 20 杀/秒，闸门关闭 | 49 | 0.176 | **2559ms** | 5.0px | 49 | 0 |
| 改后 20 杀/秒，闸门 250ms | 49 | 0.364 | **550ms** | 5.0px | 9 | 40 |

\* 改前 4/秒那组的 8.0px 峰值是清场前残留的 Boss S2 震屏，不是击杀震屏；同一时段改后组为 5.0px。

三条结论：

1. **"40 连杀不晕"成立**：自然密度（4 杀/秒）下 59.3% 的帧完全不晃，最长连续晃动 219ms（远低于 1 秒），对比改前 646ms。
2. **"持续晃动"风险是真实的**：20 杀/秒、**关闭闸门**时长连续晃动 2559ms —— 整个采样窗口都在晃，这正是用户担心的"震屏叠加变持续晃动"。`triggerShake` 幅度取 max 不叠加，问题确实来自时长被反复续期。
3. **闸门有效但非万能**：同样 20 杀/秒，开闸门后最长连续晃动从 2559ms 降到 550ms（`killShakeFired` 49 → 9，`killShakeGated` 0 → 40）。550ms 仍有残影，来源是帧末 S1 档震屏（6px / 0.18s）与击杀震屏在 250ms 闸门内的自然交叠，属预期；峰值始终 5.0px（<6px 上限）。

验收线（4 杀/秒）：静止帧占比 ≥25% → **实测 0.593 通过**；`killShakeGated > 0` → **16 通过**；`killShakeFired ≤ 40` → **23 通过**；峰值 ≤6.0px → **5.0 通过**。

### 9.7 J2 实测（伤害数字堆叠 / 描边 / 暴击字号）

测法：把 `addFloat` 换成记录器，只读它收到的 `(text, y, size, opts)`，不改变绘制；目标怪隔离到 (6000, 6000)，`hp` 置 99999，`noCrit`，同一时刻连打 5 次。基线 y 取 `enemy.y - enemy.radius - 10`。

| 口径 | 改前 | 改后 |
|---|---|---|
| 5 连击的 y 偏移（px） | `0, 0, 0, 0, 0` | **`0, −14, −28, −28, −28`** |
| 堆叠上限 | — | 3 层（第 4、5 次不再下移） |
| 字号（轻击） | 12 | 12 |
| 描边（S0） | 无（`outline: null`） | **`outline: 2`**（深棕 `rgba(40,14,6,0.85)`） |
| 暴击字号 | **16** | **19** |
| 暴击描边 | 3 | 3（不变） |
| `state.feel.juiceStack` | 无此字段 | **4**（5 次里 4 次产生堆叠） |
| 0.5s 后再打 | — | y 回到 `0`、stack 重置为 1（窗口生效） |

**跑测抓到一个真 bug（已修）**：原实现写的是 `if (!enemy._floatAt || …)`，而 `_floatAt` 初值 / 首次赋值可能是数字 `0`，`!0 === true` → **每一次都判定为"窗口过期"，堆叠永远只有 1 层**。第一次测出来是 `0,0,0,0,0`、`stack` 恒为 1。改成 `enemy._floatAt == null` 后才得到上表的 `0/−14/−28/−28/−28`。

### 9.8 J3 实测（分级闪白 32/48/64ms + 0.34s 门限）

测法：直接读命中后 `enemy.flash` 的写入值（渲染侧每帧 `flash -= dt * 5`，所以可见时长 = `flash / 5`，即 0.16→32ms、0.24→48ms、0.32→64ms），并通过推 `state.elapsed` 控制 0.34s 门限的两侧。`state.realElapsed` 只在 `state.mode === 'playing'` 时才存在，测试页处于非战斗态，所以走的是 `state.elapsed` 回退。

| 档 | 写入 `flash` | 可见时长 | 改前 |
|---|---|---|---|
| 轻击（非暴击、非重击） | **0.16** | **32ms** | 0.16 / 32ms |
| 重击（`damage ≥ hitStopHeavyDamage`，实测用 40） | **0.24** | **48ms** | 0.16 / 32ms |
| 暴击 | **0.32** | **64ms** | 0.16 / 32ms |

门限：同一时刻连打 10 次 → `state.feel.juiceFlashGated` **+9**，只有第 1 次写入 `flash`（写入值 0.16），其余 9 次只记账不闪。三段分级 + 门限均达到设计值。

**同一类 bug 也修了一处**：`if (!enemy._flashAt || …)` 在 `_flashAt === 0` 时会把门限误判为"从未闪过"，等于门限对第一次之后的 0 时刻失效；改为 `enemy._flashAt == null`。同时把 `nowFlash` 的回退从 `: 0` 改成 `: (state.elapsed || 0)`，否则非战斗态下门限会被永久锁死（`0 - 0 < 0.34` 恒成立）。J5 的 `killShakeAt` 同样从 `!x` 改成 `== null`（`performance.now()` 不会为 0，属预防性统一）。

### 9.9 J4 实测（命中音去重 + 击杀尾音 260ms）

测法：把 `playSfx` 包一层只记名字；`AudioBufferSourceNode.prototype.start/stop` 包一层记录调度时刻，用 `stop - start` 读尾音长度。

| 口径 | 改前 | 改后 |
|---|---|---|
| 单目标普通命中：`playSfx` 调用数 | **2**（`lightHit` + 帧末 `hit`） | **1**（只剩 `lightHit`） |
| 单目标普通命中：音源节点数 | **4**（2 层 × 2 节点） | **2** |
| 3 目标同帧命中：`playSfx` 调用数 | **4**（3×`lightHit` + 1×`hit`） | **3** |
| 3 目标同帧命中：音源节点数 | 8 | 6 |
| `FX_TIER_STATS.frameSfxSkipped` | 无此字段 | **+1 / 每次 S0 命中帧** |
| 击杀噪声尾音 `stop - start` | **0.050s** | **0.260s** |

说明：文档 1.4 节说的"同一次普通命中合计 4 个音源"是**节点数**（每层 1 振荡器 + 1 噪声），与上表"调用数 2"不矛盾；J4 去掉的是**帧末那一层**，所以单目标 4 节点 → 2 节点、3 目标 8 → 6。S1 及以上帧末那层本来就走 `heavy`（`force`），不受影响。

### 9.10 本轮（J2/J3/J4 补测）对补丁文本的改动

| 位置 | 原 | 改 |
|---|---|---|
| 段 J2(c) | `if (!enemy._floatAt \|\| …)` | `if (enemy._floatAt == null \|\| …)` |
| 段 J3(b) | `if (!enemy._flashAt \|\| …)`；`nowFlash = … : 0` | `== null`；`: (state.elapsed \|\| 0)` |
| 段 J5 | `if (!state.feel.killShakeAt \|\| …)` | `== null` |

这三处都是"数字 0 被当成未初始化"的同一类缺陷，不是风格问题 —— 前两处在跑测里**实测复现**（堆叠永远 1 层、门限永久锁死），第三处属于同类预防。改完后 21 处锚点重新断言通过，9.2/9.3/9.4 的 J1/J5 数据不受影响（J2/J3 时间基准表达式未变，只是判空与回退更稳）。

### 9.11 未测项（明确标"未测"）

| 项 | 状态 |
|---|---|
| `node tools/arcane_fxtier.js` | **已测**：期望值同步后 13/13 通过（见 9.13.2） |
| p95 配对差值 | **已测**：同会话开关配对 p95 中位 +0.20ms / 均值 +0.31ms（见 9.13.4） |
| 运行时 `JUICE_V2_CONFIG.enabled` 配对 A/B | **已测**：p95 中位 +0.20ms / 均值 +0.31ms（见 9.13.4）。**注意：主文件没有 `?juice=off` 这个参数**（`juice`/`JUICE` 0 命中），该 URL 参数只存在于补丁副本、随段 0 落地才出现；长期底座 A/B 因外部负载不采信（见 9.13.3） |
| J1 tickOnly 分支的帧预算 | **未测**：自动攻击与 tick 同帧，A/B 场景里造不出纯 tick 帧（该路径只"少做事"，方向不会更贵） |
| J5 击杀震屏的帧预算 | **未测**：A/B 把敌人设成不死，无击杀；行为已由 9.4 实测 |
| 真实手感（"爽/黏"） | **未测**（需真人上手） |

已间接覆盖的部分：`patched.html` 的游戏主循环在无头浏览器里连续跑了约 15 秒（含真实战斗），`evaluate` 返回的 console 输出为空，未见运行时报错。两页累计约 230 次 `killEnemy`（patched 176 次 + base 58 次，均用于 9.4 的震屏采样）。

### 9.12 本轮对补丁文本的改动汇总

1. `段 J1(i)`：`hitStopReqs` 由 `directHits` 改为 `directHits > 0 ? directHits : (f.kills > 0 ? 1 : 0)`，理由见 9.3（避免"读数说没冻、身体感觉到冻"）。
2. `段 J2(c)/J3(b)/J5`：`!x` → `x == null`，并把 J3 的 `nowFlash` 回退补成 `state.elapsed || 0`，理由见 9.10（0 被当成"未初始化"，实测复现两处）。

其余替换与本文件第 4 节正文一致。两轮改动后均重新跑过 21 处锚点断言（全部恰好命中），并重跑 J1/J5 数值确认未受影响。

---

### 9.13 门禁同步 + 运行时开关 A/B 与 p95 配对差值（2026-11-09）

> **口径更正（2026-11-09 核实）**：主文件里**不存在** `?juice=off` —— `juice` / `JUICE` 全库 **0 命中**；主文件现有的 URL 开关只有 `?fx=low`（50645 行读 `fx`）、`?tier=off`（39612）、`?guard=off`（5545）、`?bg=off`（56019）、`?dev=1`（7061）、`?achnotice=off`（18087）、`?saveguard=off`（67878），运行时配置是 `FEEL_CONFIG`（9583 起）。
> `?juice=off` 是**本补丁段 0 新增**的（第 236–237 行配置块），只存在于补丁副本/落地之后。
> 因此：9.13.4 的结论来自**运行时切 `JUICE_V2_CONFIG.enabled`**，与 URL 参数无关，数字不变；9.13.5 的"载入期校验"只在**补丁副本**上成立，不能算主文件能力。此前"`?juice=off` 可用"的表述**撤回**。

#### 9.13.1 主文件重取

| 项 | 值 |
|---|---|
| 字节 | 2,848,200 |
| 行数 | 66,251 |
| MD5 | `13D9C718FCC7FBC7B9EF5A23F329E0DF` |

21 处锚点在新版本上逐条断言"恰好命中 1 次"全部通过；`base.html` 与主文件字节完全一致，`patched.html` = 2,853,808 字节。

**A/B 跑完后主文件又跳了一次**：2,868,713 字节 / 66,781 行 / `FFD046B7…`（+20,513）。在该版本上重跑 21 处锚点断言 —— **仍全部恰好命中 1 次**（`patched` = 2,874,321 字节），且 `FX_TIER_CONFIG` 仍是 `0.045 / 0.090 / 0.130`、`flashMs 0/60/110`、`shakeMaxViewRatio 0.016`，所以 9.13.2 的期望值与 9.13.4 的性能结论都仍然成立。A/B 副本已单独留存为 `base_2848200.html` / `patched_2848200.html`，与本节报数一一对应。

主文件 `FX_TIER_CONFIG` 现值（**这些是主文件已有的，不是本补丁写的**）：S0 `45ms/3px/10/0`、S1 `90ms/6px/26/60ms`、S2 `130ms/10px/58/110ms`，`throttleWindow 1.0`、`shakeMaxViewRatio 0.016`、`safeRadius 90`。

#### 9.13.2 `tools/arcane_fxtier.js` 期望值同步（13/13 通过）

| 断言 | 旧期望 | 新期望（= 主文件现值） |
|---|---|---|
| 三档参数 S0 | `hitStop 0 / shake 0 / particles 8 / flash 0` | **45ms / 3px / 10 / 0** |
| 三档参数 S1 | `55ms / 3px / 20 / 40ms` | **90ms / 6px / 26 / 60ms** |
| 三档参数 S2 | `120ms / 7px / 60 / 90ms` | **130ms / 10px / 58 / 110ms** |
| 视野上限 | `shakeMaxViewRatio 0.012`（1.2%） | **0.016（1.6%）** |
| S0 帧摘要 | 不顿帧、不震屏、粒子 ≤8 | **45ms 顿帧、震幅 >0 且 ≤3、粒子 ≤10** |
| S1 帧摘要 | `55ms / 40ms 闪白 / 粒子 ≤20` | **90ms / 60ms 闪白 / 粒子 ≤26** |
| 多杀粒子上限 | ≤60 | **≤58** |

**口径写死**：是 **45/90/60**，**不是 35/55/40**。旧断言会把主文件现值误报成回归。

另修了两处**测试前提**（不是期望值，属于早就过期的场景假设）：

1. **S1 场景打不死**：`shooter` 在 1 层已扛得住 80 点伤害，实测该步返回 `tier:S0, hits:1, kills:0`。改为先 `terrain.weaken(id, 1)` 再打 80，保证测的是"击杀档位"。
2. **S2 节流窗口不推进**：原写法 `sleep(1150)` 依赖 `state.realElapsed` 按墙钟走，无头环境里不成立。改为用同一时钟把"上次 S2 时刻"回拨 1.15s，确定性地打中"窗口到期"分支。

修完 `node tools/arcane_fxtier.js` → **13/13 PASS**。

#### 9.13.3 方法：为什么最终不用"重载页面 × 长采样"

先按规定跑了"base / patched / patched?juice=off 各 12 秒 × 5 轮"（`?juice=off` 只在补丁副本上有意义，主文件无此参数）：5 轮里 4 轮出现三臂同步掉帧（最极端：`base n=139`、`avg 26.4ms`、`p95 127.6ms`，而同轮 `off` 也 10.97ms）。这只能说明采样窗口里有外部负载抢 CPU（本机有其他线在跑），不能算到补丁头上。剔除后只剩 1 轮有效，样本不足，**该数据不采信**。

改用**同会话开关配对**：

- 加载一次 `patched.html`，战斗场景不中断；
- 运行时切换 `JUICE_V2_CONFIG.enabled`，**3 秒一窗、ABBA 交替、8 个 cycle**；
- 窗内场景固定：第 3 层最大战斗房、6 只 1e9 血敌人（打不死）、玩家无敌、每 6 帧命中 1 次（≈10 次/秒）、每 60 帧一次暴击；
- 计时包住游戏 `loop()`，只计 `update + render` 净耗时；
- 同 cycle 内 on/off 两窗相邻，配对差值只反映补丁自身开销。

#### 9.13.4 结果（8 个 cycle 全部有效，n 277–362）

| 指标（on − off） | 值 |
|---|---|
| p95 均值 | **+0.31ms** |
| p95 中位 | **+0.20ms** |
| p95 范围 | −1.20 ~ +2.20ms |
| 平均帧 均值 | **+0.31ms** |
| 平均帧 中位 | **+0.13ms** |
| 平均帧 范围 | −0.18 ~ +1.16ms |

判据 2.2ms → **判"不可分辨"**（均值与中位都远低于门限；单 cycle 最大 +2.2ms 出现在 on 窗帧数最少的那个 cycle，不作判据）。

**分支真的被执行了的证据**（否则这个 A/B 只是在测两个空转）：on 窗每 3 秒 `juiceStack +41~+53`、`juiceFlashGated +39~+51`；off 窗两者恒为 0。

#### 9.13.5 补丁副本的 `?juice=off` 载入期校验（主文件无此参数）

> 前提：这一段跑在 `patched.html`（= 主文件 + 段 0 + J1–J5）上。**主文件单独加 `?juice=off` 不会有任何效果**，因为它没有 `JUICE_V2_CONFIG`。

```
before: { enabled: false, stack: 0, gated: 0 }
after 60 hits: { enabled: false, stack: 0, gated: 0 }, enemy.flash = 0.16
```

即：**补丁落地后**，URL 参数能在加载期把开关关掉；60 次连续命中后 J2 堆叠、J3 门限计数器都不增长，闪白退回旧的单一 `0.16`。

#### 9.13.6 覆盖边界（不冒充）

| 分支 | 本轮 A/B 是否执行 | 说明 |
|---|---|---|
| J2 堆叠 / 描边 | **是** | `juiceStack` 每窗 +41~+53 |
| J3 三档闪白 / 门限 | **是** | `juiceFlashGated` 每窗 +39~+51 |
| J4 帧末省音 | **否** | 本场景 `frameSfxSkipped` 增量 0（该分支条件未出现，未逐帧采证是哪一项）；行为已由 9.9 单测证明（+1） |
| J1 tickOnly | **否** | 自动攻击与 tick 同帧，造不出纯 tick 帧；该路径只"少做事" |
| J5 击杀震屏 | **否** | 敌人设为不死，无击杀；行为已由 9.4 实测 |

结论范围：**"每帧常规命中路径（J2/J3）加价 +0.3ms 量级、不可分辨"**；J1/J4/J5 是减少工作量的方向，不会把结论翻过来。

#### 9.13.7 结论

- 帧预算：on/off 差 p95 **+0.20ms（中位）/ +0.31ms（均值）**，平均帧 **+0.13 / +0.31ms**，均远低于 2.2ms → **判"不可分辨"，不写毫秒增量**。
- 门禁：`arcane_fxtier.js` 13/13 绿，期望值已是 45/90/60。
- 主文件仍由整合线独占；落地前**必须重取 MD5**（本文件第 0 节已记录今天的三次漂移）。
