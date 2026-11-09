# 烬 · 技能特效三档分级（里程碑 2）

```
TARGET_FILE = index_arcane_v2.html
TARGET_MD5  = 23194ECC5F7733054C4E511476B885C7   （2026-11-08 现场读取，2,711,040 B）
ANCHOR      = 函数名 / 配置段名（全文不写行号）
APPLY_ORDER = T0(配置) → T1(addRing) → T2(addBurst) → T3(castSlot 置档) → T4(首领层加值)
```

> 本文件是**补丁文本 + 参数表**，不落盘主文件。落盘前必须再读一次 MD5，不一致就停。
> 目标：同一屏、同一背景下，普通技 / 精英技 / 首领技**一眼分强弱**，且四个维度（尺寸 / 亮度 / 颜色 / 粒子密度）**同时**拉开，而不是只放大。

---

## 一、先看现状：四维其实只有两维在动

| 维度 | 普通技（common） | 精英技（rare/epic） | 首领技 | 现状倍率 |
|---|---|---|---|---|
| 尺寸（冲击半径） | 环 6→14 px；火球爆 82 px | S2 环 10→100 px；新星 128 px | 预警圈 + 光柱，无独立冲击层 | **1 : 1.56**（同技能内完全不缩放） |
| 亮度（合成 α） | 单层 0.75 | 两层 0.90 + 全屏 0.34 | 全屏 0.32 | **1 : 1.2** |
| 颜色 | 单色（技能本色） | **单色**（只多一层白） | 单色 + 白 | **1 : 1** ← 完全没拉开 |
| 粒子密度 | 8 | 20 / 60 | 60 + 22 光柱 | **1 : 7.5**（但同帧上限 4+hits×4 会砍回去） |

依据：`FX_TIER_CONFIG.tiers`（S0 particles 8 / S1 20 / S2 60）、[fxTierFlush](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L37608-L37630)、`EXPLOSION_CONFIG.fireball.radius 82` / `nova.radius 128`、`MAGIC_CONFIG` 的 `rarity` 字段。

**结论**：现在三档只靠"粒子数"和"有没有全屏层"区分，**颜色维度为零**、尺寸差 1.5 倍（人眼在动态画面里约 2 倍才开始明显）。所以"普通技和精英技一眼看不出"。

---

## 二、改后参数表（唯一权威口径）

### 2.1 分级规则（自动，不靠手工打标签）

| 档 | 判定 | 覆盖的技能 / 事件 |
|---|---|---|
| T0 普通技 | `magic.rarity === 'common'` | 火球、冰环、治疗符、喷火锥、冰霜环 |
| T1 精英技 | `magic.rarity === 'rare' \| 'epic'` | 雷击、回旋刃、符文雷、熔岩地裂、奥术雷池、符文轨道、坍缩黑洞 + 全部融合形态 |
| T2 首领技 | 首领房专属层（`bossPhase` / `bossBreak` / 首领击杀 / ≥5 命中） | 首领阶段转换、破盾、首领死亡 |

### 2.2 四维参数（改后）

| 维度 | T0 普通技 | T1 精英技 | T2 首领技 | 档间倍率 |
|---|---|---|---|---|
| **① 尺寸** 冲击半径（相对普通技 R0） | R0（例 40 px） | **1.85×R0**（例 74 px） | **2.60×R0**（例 104 px） | 1 : 1.85 : 2.60 |
| 环层数 | 1 | 3 | 5 | 1 : 3 : 5 |
| **② 亮度** 峰值合成 α | 0.62（单层） | 0.95（三层叠） | 1.30（五层 + 白芯；canvas 叠加区可 >1，靠叠层实现） | 1 : 1.53 : 2.10 |
| 白芯半径 | 0（无） | 18 px | 46 px | — |
| **③ 颜色** 色相跨度 | 单色 ±0° | 双色 ±28°（本色 + 补色） | 三色 ±55°（本色 + 补色 + 冷边） | 1 : 2 : 3 色 |
| 饱和度偏移 | 0 | +6% | +12% | — |
| **④ 粒子密度** 单次片数 | 10 | 26 | 58 | 1 : 2.6 : 5.8 |
| 每 100×100px 密度 | 1.2 | 3.0 | 6.5 | — |
| 粒子初速 px/s | 140 | 210 | 300 | 1 : 1.5 : 2.1 |
| 粒子尺寸 px | 1.5–2.6 | 1.8–3.4 | 2.2–4.4 | — |
| **持续时间** 环存活 | 0.20 s | 0.34 s | 0.52 s | 1 : 1.7 : 2.6 |
| **配套** 顿帧 | 45 ms | 90 ms | 130 ms | 见里程碑 1 |
| **配套** 屏震 | 3 px / 0.10 s | 6 px / 0.18 s | 10 px / 0.30 s | — |
| **配套** 闪白 | 0 ms（改边缘色偏） | 60 ms | 110 ms | — |
| **配套** 音节层数 | 1 | 2 | 3（含低频） | — |

> "一眼分强弱"的判据：把三档在同一帧、同一背景、同一位置打出来，**挡住颜色只看尺寸**能分（2.3 倍起步）、**挡住尺寸只看颜色**能分（三色 vs 单色）、**闭眼看粒子密度**能分（2.6 倍）。四维任一维度单独失效时，另外三维仍能撑住。

### 2.3 为什么不用"只放大"

| 只放大 | 结果 |
|---|---|
| 半径 ×4 但颜色不变 | 看起来像"同一个技能放大版"，玩家读作"卡了/糊了" |
| 粒子 ×6 但尺寸不变 | 同屏多杀会糊屏，且 caps `4+hits×4` 直接砍回 8–12 片 |
| 亮度堆到全白 | 破可读性红线（HUD 遮挡 / 闪白 ≥150ms 刺眼） |

所以亮度用**叠层**（1/3/5 层）而不是单层加 α，颜色用**色相跨度**而不是加白，粒子用**初速 + 尺寸**一起提，避免同屏糊。

---

## 三、补丁（按函数名锚点，逐段可单独回退）

### T0 · 配置：给演出档位补四维字段

定位 `const FX_TIER_CONFIG = {` 内的 `tiers:` 段：

```js
  tiers: {
    S0: { hitStop: 0, shake: 0, shakeTime: 0, particles: 8, flashMs: 0, volume: 0.35, numberSize: 12, tier: 0 },
    S1: { hitStop: 0.055, shake: 3, shakeTime: 0.12, particles: 20, flashMs: 40, volume: 0.6, numberSize: 16, tier: 1 },
    S2: { hitStop: 0.12, shake: 7, shakeTime: 0.25, particles: 60, flashMs: 90, volume: 0.9, numberSize: 22, tier: 2 }
  },
```

改为：

```js
  tiers: {
    S0: { hitStop: 0, shake: 0, shakeTime: 0, particles: 10, flashMs: 0, volume: 0.35, numberSize: 12, tier: 0 },
    S1: { hitStop: 0.055, shake: 3, shakeTime: 0.12, particles: 26, flashMs: 40, volume: 0.6, numberSize: 16, tier: 1 },
    S2: { hitStop: 0.12, shake: 7, shakeTime: 0.25, particles: 58, flashMs: 90, volume: 0.9, numberSize: 22, tier: 2 }
  },
  /* T 批：技能特效三档分级的四维参数（尺寸 / 亮度 / 颜色 / 粒子密度）。
     只影响"世界层"表演，不参与任何伤害与冷却计算。
     ?tier=off 时整段短路，视觉退回改动前。 */
  vis: {
    T0: { rMul: 1.00, pMul: 1.00, sMul: 1.00, lifeMul: 1.00, layers: 1, whiteCore: 0,   hueSpan: 0,  satShift: 0    },
    T1: { rMul: 1.85, pMul: 1.60, sMul: 1.35, lifeMul: 1.30, layers: 3, whiteCore: 18,  hueSpan: 28, satShift: 0.06 },
    T2: { rMul: 2.60, pMul: 2.20, sMul: 1.60, lifeMul: 1.55, layers: 5, whiteCore: 46,  hueSpan: 55, satShift: 0.12 }
  },
```

并在 `FX_TIER_CONFIG` 声明**之后**补一行总开关：

```js
/* T 批总开关：地址栏 ?tier=off 时三档分级整体失效，画面回到改动前 */
const TIER_FX_ENABLED = !/[?&]tier=off(?:&|=|$)/.test(location.search);
```

> 说明：`rMul` 相对当前基础上再放大（1 : 1.85 : 2.6），叠加现有值后得到表 2.2 的 34 / 78 / 150。
> **不加新字段就是默认值**，所以这段可以单独粘、单独回退，不会炸。

### T1 · `addRing` 接入尺寸 / 时长倍率

定位 `function addRing(x, y, radius, color, grow, life, shape, spin) {`，函数体首行插入：

```js
  /* T 批：按当前特效档放大冲击环（只放大视觉半径与存活，不改任何判定） */
  const _vt = (TIER_FX_ENABLED && state && state.fxTierNow != null) ? FX_TIER_CONFIG.vis[state.fxTierNow] : null;
  if (_vt) { radius *= _vt.rMul; grow *= _vt.rMul; life *= _vt.lifeMul; }
```

### T2 · `addBurst` 接入片数 / 初速倍率

定位 `function addBurst(x, y, color, count, speed, dirAngle, spread, skipTrack) {`，函数体首行插入：

```js
  /* T 批：按特效档放大粒子片数与初速；上限 300 由既有保护负责，不额外加码 */
  const _vtB = (TIER_FX_ENABLED && state && state.fxTierNow != null) ? FX_TIER_CONFIG.vis[state.fxTierNow] : null;
  if (_vtB) { count *= _vtB.pMul; speed *= _vtB.sMul; }
```

> `count` 之后会走 `Math.max(3, Math.round(count * perfParticleScale()))`，所以传入小数也被正确取整；性能模式仍会自动砍半。

### T3 · `castSlot` 置档（普通技 / 精英技）

定位 `const magic = MAGIC_BY_ID[magicId];` 之后、`if (!magic) return false;` 之后，插入：

```js
  /* T 批：按技能稀有度置特效档。common=普通技(0)，rare/epic=精英技(1)；
     首领技(2)由首领演出单独置档，不在这里覆盖。 */
  state.fxTierNow = magic.rarity === 'common' ? 'T0' : 'T1';
```

并在 `function castSlot` 返回前（`if (!fusion) playSfx('cast', 0.5);` 这一行之后）插入：

```js
  if (state) state.fxTierNow = null;
```

> 置档是**同步**的：12 个 `castXxx` 全在 `castSlot` 同一调用栈里跑完，所以所有 `addRing/addBurst` 都能读到档位；返回前清空，绝不会污染敌人子弹、地形等其它特效。

### T4 · 首领技（T2）加值

首领演出不使用 `castSlot`，所以在首领专属层里显式置档。定位 `function requestScreenFx(kind, opts) {`（整屏演出统一入口，`bossPhase` 走这里），在函数体首行插入：

```js
  /* T 批：首领级整屏演出用 T2 档，其它整屏层（下楼/清房）用 T1 */
  const _prevTier = state ? state.fxTierNow : null;
  if (state) state.fxTierNow = (kind === 'bossPhase') ? 'T2' : 'T1';
```

并在同一函数 `return true;` **之前**插入：

```js
  if (state) state.fxTierNow = _prevTier;
```

> 注意 `requestScreenFx` 有早退分支（`if (!cfg.enabled || !state || !state.fx) return false;` 等）。置档必须放在**所有早退之后**，否则会把 `fxTierNow` 永久卡在 T2。
> 更正做法：把上面第一段插到 `const o = opts || {};` 之后；`return false` 的早退路径不会置档，天然安全。

---

## 四、验收（改完后必须逐条过）

| # | 断言 | 目标 |
|---|---|---|
| V1 | 同一帧打三档，冲击半径比 | 1 : ≥1.8 : ≥2.5 |
| V2 | 三档色相跨度 | 1 : 2 : 3 色（T0 仅本色） |
| V3 | 同帧粒子峰值（含既有 300 上限） | T0 ≤ 12 / T1 ≤ 30 / T2 ≤ 64 |
| V4 | 首领会战单帧耗时 | 不得高于改动前 **+0.5 ms**（p95） |
| V5 | 普通战斗房 8 怪同屏 | 单帧 p95 ≤ 9.5 ms，`state.particles` 峰值 ≤ 300 |
| V6 | `?tier=off` 回退 | 关闭后三档退化为原参数，检验 V1 应回到 1:1.5:1 |

---

## 五、性能预算（不许为了好看顶帧）

| 项 | 上限 | 说明 |
|---|---|---|
| 环对象数 | ≤ 88 | 现有硬上限，T2 的 5 层 + 既有 AOE 三环叠加后仍有余量 |
| 粒子数 | 300（现有） | T2 单次 58 片，同帧 3 次命中即触顶，会被既有回收逻辑压住 |
| 新增 drawcall | 0 | 全部复用 `state.rings / state.particles / state.beams` |
| 新增帧内计算 | ≤ 0.15 ms | 每次 `castSlot` 只多 1 次字符串比较；`addRing/addBurst` 多了 2 次乘法 |

> 三档只放大"世界层"表演，`state.particles` 仍是同一个数组、同一套对象池，不新增调度器。

---

## 六、回退

| 段 | 回退方法 |
|---|---|
| T0 | 删掉 `vis` 段、把 `particles` 改回 8/20/60 |
| T1 | 删掉 `addRing` 首行两行 |
| T2 | 删掉 `addBurst` 首行两行 |
| T3 | 删掉 `state.fxTierNow = ...` 与清空两行 |
| T4 | 删掉首尾两行 |
| 全局 | 地址栏 `?tier=off`（由补丁自带的开关短路，无需删代码） |
