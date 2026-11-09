# 引信接入方案 v1（给整合线，不落主文件）

> 目标：把原型 03 的「68%~86% 完美 / >86% 过载 / <68% 刮痧」接进 `index_arcane_v2.html` 现有技能链。
> 原则：**默认关闭、单点开关、可整段回滚**；关闭时必须与当前版本逐帧等价。
> 行号基于当前主文件（2.92MB）；整合后可能漂移，请按代码原文搜索锚点。

---

## 0. 一句话结论

引信不是新增一种伤害，而是把现有主槽技能的「按下即出伤」拆成**按下先付费、松手才结算**两段：

```
按下 → 扣奥能 + 进冷却 + 开始蓄力（不可撤销的承诺）
松手 → 按蓄力比例定档：刮痧 / 完美 / 过载
```

这样「等时机」才有成本：犹豫 = 提前亏钱，贪蓄 = 自爆。

---

## 1. 机制定义（参数与原型 03 对齐）

| 参数 | 值 | 说明 |
|---|---|---|
| `windTime` | 1.25s | 满蓄时长，`ratio = t / windTime` |
| 完美窗口 | `0.68 ≤ ratio ≤ 0.86` | 伤害 ×1.45，返还 30% 奥能，冷却 ×0.85 |
| 刮痧 | `ratio < 0.68` | 伤害 ×0.35，费用/冷却不退 |
| 过载 | `ratio > 0.86` | 伤害 ×0.50，自损当前生命 18%（最低 12），眩晕 0.65s |
| 自动引爆 | `ratio ≥ 1.40` | 一直按住也逃不掉：强制按过载结算 |
| 取消窗口 | 按下后 `0.12s` 内松手 | 全额退奥能、清冷却、不计入统计 |

关键取舍：

- **费用在按下时扣**，不是松手时扣。否则「贪蓄失败」只是没打出去，没有痛感。
- **完美必定暴击**（确定性），弱/过载必定不暴击。避免「蓄得完美还得看脸」，也让飘字能直接读出档位。
- 引信只结算**首跳**。熔岩裂缝、奥能池这类延迟伤害在施法时已把倍率烘进 `damage`，后续 tick 不重复乘。

---

## 2. 锚点块（函数 / 前 3 行 / 后 3 行 / 命中次数）

> 「命中次数」= 全文件 grep `函数名(` 的命中数（含定义）。

### 锚点 A｜`castSlot(slot, loud)` — 付费与冷却的唯一入口
- 定义：[index_arcane_v2.html](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L42070)（第 42070 行）
- 命中次数：6（定义 1 + 调用 3：42049 / 42056 / 42057，其余为文档引用）
- 插入位置：扣费之后、取 `fusion` 之前（第 42110 行）

前 3 行：
```js
    return false;
  }

  state.player.aether -= cost;
```
后 3 行：
```js
  // 焚稿回响：只在真正扣费成功后消耗一次半价次数（失败分支不会走在这里）
  if (ashEchoMul < 1 && Number(state.ashEchoCasts) > 0) state.ashEchoCasts -= 1;
  // 先取融合，再写冷却：超频期（P2）冷却 ×0.8 要作用在同一条融合上
```

### 锚点 B｜`castSlot` 末尾 — 把「分发」抽成 `dispatchMagic`
- 位置：第 42135–42158 行（`if (magic.id === 'fireball') castFireball(...)` 到 `if (d) { d.castingSlot = 0; ... }`）
- 命中次数：该分发链 1 处（12 个 `else if` + 收尾）
- 做法：整段搬到新函数 `dispatchMagic(magic, fusion, slot)`，`castSlot` 末尾只留一行调用。**不改任何 cast 函数内部。**

前 3 行：
```js
  if (state) state.fxTierNow = magic.rarity === 'common' ? 'T0' : 'T1';
  if (magic.id === 'fireball') castFireball(magic, fusion);
  else if (magic.id === 'frost') castFrost(magic, fusion);
```
后 3 行：
```js
  if (d) {
    d.castingSlot = 0;
    if (d.stats) d.stats.casts[slot] += 1;
  }
```

### 锚点 C｜`getMagicDamage(magic, fusion)` — 伤害总闸
- 定义：[index_arcane_v2.html](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L42012)（第 42012 行）
- 命中次数：19（定义 1 + 调用 18，覆盖 12 个 cast 函数与复合计算）
- 插入位置：`return damage;` 之前（第 42037 行）

前 3 行：
```js
  damage *= openingGiftDamageMul(magic.id);
  // 焚稿 P0：灰烬层数 → 法术增伤（每层 +6%，上限 4 层；总开关关闭时恒 1）
  damage *= ashDamageMul();
```
后 3 行：
```js
  return damage;
}

/**
```

### 锚点 D｜`damageEnemy(enemy, amount, dirAngle, opts)` — 暴击判定
- 定义：[index_arcane_v2.html](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L46635)（第 46635 行）
- 命中次数：48（定义 1 + 调用 47）
- 插入位置：暴击判定三行（第 46683–46684 行）前

前 3 行：
```js
    else if (enemy.mechP1 === 'armorCycle') sigMul = mechCfg.phase1.armorMul;
  }

  // ---------- 三档分级第一层：暴击判定 ----------
```
后 3 行：
```js
  const critChanceNow = clamp(FEEL_CONFIG.critChance + talentEff('crit'), 0, 0.9);
  const crit = (opts && opts.noCrit) ? false : (rng() < critChanceNow);

  // ---------- D2 遗物「先手」：每间房的前 3 次命中 ×1.5 ----------
```

### 锚点 E｜键盘入口 `handleKeyDown` / `handleKeyUp`
- 定义：`handleKeyDown` 第 57372 行、`handleKeyUp` 第 57534 行
- 命中次数：`handleKeyDown` 3（定义 + 2 处绑定/转发）、`handleKeyUp` 2
- `primary` 分支在第 57492 行

前 3 行：
```js
  if (state.mode !== 'playing') return;

  if (action === 'primary') castPrimary();
```
后 3 行：
```js
  /* 第 25 项：Q 近战挥击（总开关关闭时 tryWeaponAttack 内部第一行就返回） */
  else if (action === 'weapon') {
    /* 第 29 项：按下即记录"按住"，冷却结束后由 updateWeapon 自动连发 */
    weaponHoldFire = true;
```

### 锚点 F｜鼠标 / 触屏入口
- `handleCanvasMouseDown`：[index_arcane_v2.html](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L57575)（第 57575 行），绑定 1 处（57983）
- `handleTouchStart`：[index_arcane_v2.html](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L57769)（第 57769 行），右半屏分支 57792–57804
- `touchCast`：[index_arcane_v2.html](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L57735)（第 57735 行），命中 4
- `handleTouchEnd`：[index_arcane_v2.html](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L57867)（第 57867 行），瞄准指针清理 57878–57883

鼠标前 3 行：
```js
  if (!state || state.mode !== 'playing' || state.status !== 'playing') return;
  updateMouseWorld(event);

  if (event.button === 0) {
```
鼠标后 3 行：
```js
    castPrimary();
  } else if (event.button === 2) {
    event.preventDefault();
    castDevice();
```

触屏右半屏前 3 行：
```js
  if (state.touch.aimStartY === point.y && state.touch.aimStartX === point.x) return;
```
（实际插入点为 57792 的 `if (state.touch.aimId !== null) return;` 之前）

---

## 3. 冲突表（和谁冲突 / 为什么 / 怎么让路）

| # | 冲突对象 | 现有行为（行号） | 为什么冲突 | 怎么让路 |
|---|---|---|---|---|
| 1 | **暴击** | `FEEL_CONFIG.critChance = 0.12`、`critMul = 1.6`（9570–9571）；判定在 `damageEnemy` 46683–46684 | 完美 ×1.45 若再乘随机暴击 = 2.32~3.7 倍，方差爆炸；且飘字读不出档位 | 引信路径**接管暴击判定**：`perfect` 恒 `crit=true`，`weak/over` 恒 `false`，不消耗 `rng()`。非引信路径一行不改。 |
| 2 | **`?juice=` 打击反馈** | **主文件不存在该参数**（全项目 HTML grep `juice` 0 命中）。真实开关是 `FEEL_CONFIG`（9567）、`?fx=low`（50338）、`?tier=off`（39305） | 方案若监听不存在的参数，会做出一个永远不生效的开关 | 不新增任何 URL 参数。引信只复用现有 `addFloat / addRing / playSfx`；档位差异靠 `state.fuse.tier` 选飘字颜色与音高。 |
| 3 | **冷却** | 写冷却在 42119–42124；倒计时在 `tickCooldowns`（58612） | 冷却若在松手时才写，蓄力 1.25s 等于白嫖冷却 | **按下即写冷却**（保持原位置）。松手不再检查冷却，直接分发。完美：`cooldowns[id] *= 0.85`；取消：回滚到按下前快照。 |
| 4 | **奥能消耗** | 扣费 42110；焚稿半价次数 42112；`baseAether 100 / regen 16 / kill 6`（7142–7147） | 松手才扣费 = 失败无代价 | **按下即扣费**。快照 `{cost, ashEchoUsed}` 存进 `state.fuse`；取消全额返还并恢复半价次数；完美返还 `round(cost*0.30)`。 |
| 5 | **双回路副槽** | `castPrimary` 先主槽再副槽（42056–42057），副槽 ×0.8 伤害 / ×1.45 冷却 | 主槽在蓄力、副槽已瞬发 → 两槽不同拍，玩家读不出因果 | 引信开启时，`castPrimary` 的副槽调用**推迟到主槽释放那一帧**（`dispatchMagic` 后再 `castSlot(1,false)`）；副槽不单独蓄力。 |
| 6 | **触屏按住连发** | `touchCast` 0.10s 节流（57738）；`update()` 每帧调 `touchCast`（58629） | 与「按住蓄力」直接互斥：每 0.1s 会重开引信 | 引信开启时该分支加条件 `&& !fuseCharging()`；`handleTouchStart` 右半屏改为 `fuseBegin()`；`handleTouchEnd` 调 `fuseRelease()`。摇杆/左半屏完全不动。 |
| 7 | **键鼠长按 Q** | `weaponHoldFire = true`（57496），`updateWeapon` 冷却好就自动连发（7922） | 同是「按住」语义，容易误绑 | 引信**只绑 `primary`（J / 鼠标左键）**，绝不绑 Q、不绑空格（影步）、不绑 F（融合）。 |
| 8 | **面板 / 暂停 / 转场** | `B` 打开焚稿面板（57415）；`state.mode` 非 playing 时 `update` 不推进 | 蓄力中开面板 → `update` 冻结、松手事件丢失，永久卡在 charging | 所有提前 return 分支前调 `fuseAbort('mode')`：面板/暂停 = **取消并全额退款**；转场/死亡 = 取消不退款。`fuseAbort` 幂等。 |
| 9 | **DPS 三口径** | `?` 三口径 8271–8294 不计引信 | 开引信后旧基线失真 | 引信默认 `enabled=false`；开启需显式 `?fuse=on` 或整合线置位，基线脚本不读该开关。 |
| 10 | **手柄** | `pollGamepad` 把按钮转成 `handleKeyDown` 的边沿动作 | 边沿触发没有「松开」事件，无法表达蓄力 | 一期：手柄在引信开启时走「点按=满蓄 0.72」，不做真蓄力；二期再接按键 down/up 状态。 |

---

## 4. 增量补丁骨架（4 个落点 + 1 个新模块）

> 全部按「插入」实现，不重写现有函数体。整合线可直接搬运。

### 4.1 新模块（建议插在 `castSlot` 之前）

```js
/* ============================================================
   引信 · FUSE_GATE
   把主槽技能的「按下即出伤」拆成「按下付费 + 松手结算」。
   enabled=false 时所有函数立即返回，与原版逐帧等价。
   ============================================================ */
const FUSE_GATE = {
  enabled: false,        // 总开关（整合线决定是否默认开）
  windTime: 1.25,        // 满蓄时长（秒）
  perfectMin: 0.68,      // 完美下界
  perfectMax: 0.86,      // 完美上界（超过即过载）
  autoBoomAt: 1.40,      // 按住到该比例仍未松手 → 强制过载
  cancelWindow: 0.12,    // 按下后该时长内松手 = 取消并退款
  weakMul: 0.35,         // 刮痧伤害倍率
  perfectMul: 1.45,      // 完美伤害倍率
  overMul: 0.50,         // 过载伤害倍率
  perfectRefund: 0.30,   // 完美返还奥能比例
  overSelfPct: 0.18,     // 过载自损：当前生命比例（最低 12 点）
  overStun: 0.65,        // 过载眩晕时长（秒）
  whitelist: null        // null = 全部主槽技能；或 ['fireball','bolt']
};

/**
 * 引信是否接管本次施法（只接管主槽、只接管白名单）
 * @param {number} slot 0=主槽 / 1=副槽
 * @param {Object} magic 魔法配置
 * @returns {boolean} true = 本次改为蓄力
 */
function fuseShouldGate(slot, magic) {
  if (!FUSE_GATE.enabled || slot !== 0) return false;
  if (state.mode !== 'playing' || state.status !== 'playing') return false;
  if (FUSE_GATE.whitelist && FUSE_GATE.whitelist.indexOf(magic.id) < 0) return false;
  return true;
}

/**
 * 开始蓄力：费用与冷却此时已经扣过，这里只记录快照
 * @param {number} slot 槽位
 * @param {Object} magic 魔法配置
 * @param {Object|null} fusion 融合
 * @param {number} cost 实际扣掉的奥能
 * @param {number} ashEchoUsed 本次是否消耗了焚稿半价次数
 * @returns {void}
 */
function fuseBegin(slot, magic, fusion, cost, ashEchoUsed) {
  state.fuse = {
    active: true, slot: slot, magicId: magic.id, fusion: fusion,
    t: 0, cost: cost, ashEchoUsed: ashEchoUsed,
    cdBefore: 0, tier: null, released: false
  };
  FUSE_STATS.casts += 1;
}

/**
 * 每帧推进蓄力（放在 update 最前，和 touch 连发同层）
 * @param {number} dt 时间步长（秒）
 * @returns {void}
 */
function fuseUpdate(dt) {
  const f = state.fuse;
  if (!f || !f.active) return;
  f.t += dt;
  if (f.t >= FUSE_GATE.windTime * FUSE_GATE.autoBoomAt) fuseRelease(true); // 按太久，强制引爆
}

/**
 * 松手结算：定档 → 分发 → 清理
 * @param {boolean} forced true = 自动引爆（按住超时）
 * @returns {void}
 */
function fuseRelease(forced) {
  const f = state.fuse;
  if (!f || !f.active) return;
  const ratio = f.t / FUSE_GATE.windTime;
  f.active = false;

  // 取消窗口：短按 = 撤销整次承诺
  if (!forced && ratio < FUSE_GATE.cancelWindow) { fuseCancel(); return; }

  const magic = MAGIC_BY_ID[f.magicId];
  if (ratio > FUSE_GATE.perfectMax) f.tier = 'over';
  else if (ratio >= FUSE_GATE.perfectMin) f.tier = 'perfect';
  else f.tier = 'weak';

  if (f.tier === 'perfect') {
    FUSE_STATS.perfect += 1;
    // 完美返还三成奥能 + 冷却打折
    state.player.aether = Math.min(state.player.maxAether,
      state.player.aether + Math.round(f.cost * FUSE_GATE.perfectRefund));
    state.cooldowns[f.magicId] = Math.max(0, (state.cooldowns[f.magicId] || 0) * 0.85);
  } else if (f.tier === 'over') {
    FUSE_STATS.over += 1;
    const self = Math.max(12, Math.round(state.player.hp * FUSE_GATE.overSelfPct));
    state.player.hp = Math.max(1, state.player.hp - self);
    state.player.stun = Math.max(state.player.stun || 0, FUSE_GATE.overStun);
    if (state.player.hp <= 1) FUSE_STATS.overDeaths += 1; // 计数：过载致死
  } else {
    FUSE_STATS.weak += 1;
  }

  // 用 tier 覆盖一发伤害：getMagicDamage / damageEnemy 读同一个字段
  dispatchMagic(magic, f.fusion, f.slot);
  state.fuse = null;
}

/**
 * 取消：全额退款 + 清冷却（只允许在 0.12s 取消窗或面板中断时调用）
 * @returns {void}
 */
function fuseCancel() {
  const f = state.fuse;
  if (!f) return;
  state.player.aether = Math.min(state.player.maxAether, state.player.aether + f.cost);
  state.cooldowns[f.magicId] = 0;
  if (f.ashEchoUsed) state.ashEchoCasts = (state.ashEchoCasts || 0) + 1;
  FUSE_STATS.cancels += 1;
  state.fuse = null;
}

/**
 * 当前蓄力档位对应的伤害倍率（getMagicDamage 调用）
 * @returns {number} 倍率
 */
function fuseDamageMul() {
  const f = state && state.fuse;
  if (!f || !f.tier) return 1;
  if (f.tier === 'perfect') return FUSE_GATE.perfectMul;
  if (f.tier === 'over') return FUSE_GATE.overMul;
  return FUSE_GATE.weakMul;
}

/**
 * 引信统计（验收与 HUD 共用）
 * @returns {{perfectRatio:number, overchargeDeathRate:number, casts:number, weak:number, perfect:number, over:number}}
 */
function fuseStatsReport() {
  const casts = Math.max(1, FUSE_STATS.casts);
  return {
    casts: FUSE_STATS.casts,
    weak: FUSE_STATS.weak,
    perfect: FUSE_STATS.perfect,
    over: FUSE_STATS.over,
    perfectRatio: FUSE_STATS.perfect / casts,
    overchargeDeathRate: FUSE_STATS.overDeaths / casts
  };
}

const FUSE_STATS = { casts: 0, weak: 0, perfect: 0, over: 0, overDeaths: 0, cancels: 0 };
window.__fuseStats = fuseStatsReport;   // 验收脚本读取点
```

### 4.2 锚点 A/B：`castSlot` 里加闸门 + 抽出分发

```js
  // 锚点 A：扣费之后、取 fusion 之前
  const ashEchoUsed = (ashEchoMul < 1 && Number(state.ashEchoCasts) > 0) ? 1 : 0;

  // ……原 42112 行扣减照旧……

  // 锚点 B 前置：冷却照旧写入（42119–42124）
  // 然后在原分发链的位置改为：
  if (fuseShouldGate(slot, magic)) {
    fuseBegin(slot, magic, getFusionForMagic(magic.id), cost, ashEchoUsed);
    if (d) d.castingSlot = 0;
    return true;                       // 已付费、已进冷却，伤害等松手
  }
  dispatchMagic(magic, getFusionForMagic(magic.id), slot);
```

`dispatchMagic` 内部就是原 42135–42158 的 `if/else if` 分发链 + `spawnBlueprintEffect` + `playSfx`，原样搬入，**一行不改**。

### 4.3 锚点 C：伤害总闸

```js
  damage *= ashDamageMul();
  damage *= fuseDamageMul();   // ← 新增这一行（引信档位）
  return damage;
```

### 4.4 锚点 D：暴击接管

```js
  // ---------- 三档分级第一层：暴击判定 ----------
  const critChanceNow = clamp(FEEL_CONFIG.critChance + talentEff('crit'), 0, 0.9);
  const fuseTier = state.fuse && state.fuse.tier;
  // 引信路径不吃随机：完美必暴、弱/过载必不暴，保证档位可读
  const crit = fuseTier
    ? fuseTier === 'perfect'
    : ((opts && opts.noCrit) ? false : (rng() < critChanceNow));
```

> 注意：`fuseRelease()` 是同步执行，`state.fuse.tier` 在整个 cast 期间有效，分发结束即置空，不会污染敌人子弹 / 反应伤害。

### 4.5 输入（两套都要能玩）

**键鼠**
```js
// handleKeyDown 的 primary 分支
if (action === 'primary') {
  if (FUSE_GATE.enabled) fuseBeginFromInput(0); else castPrimary();
}

// handleKeyUp 新增
if (action === 'primary' && FUSE_GATE.enabled) fuseRelease(false);

// handleCanvasMouseDown：左键
if (event.button === 0) {
  if (FUSE_GATE.enabled) fuseBeginFromInput(0); else castPrimary();
}
// 新增 window 'mouseup'（button === 0）→ fuseRelease(false)
```

`fuseBeginFromInput` 只做「走完 castSlot 的校验/扣费/冷却，然后进入蓄力」，实现方式：置一个 `FUSE_INPUT.charging = true`，再调 `castSlot`，由 4.2 的闸门接管。这样**所有前置校验（未解锁/冷却/奥能不足/无目标）都自动复用**，不用重写。

**触屏**
```js
// handleTouchStart 右半屏（原 57803 touchCast()）
if (FUSE_GATE.enabled) fuseBeginFromInput(0); else touchCast();

// handleTouchEnd：aimId 释放时
if (FUSE_GATE.enabled) fuseRelease(false);

// update() 的连发分支（58629）加保护
if (touchEnabled() && state && state.mode === 'playing' && state.touch
    && state.touch.aimId !== null && !(FUSE_GATE.enabled && state.fuse && state.fuse.active)) {
  touchCast();
}
```

**蓄力可视化**：右半屏拇指处画一圈进度环，`0.68–0.86` 段染金色；超过 `0.86` 变红并加抖动。键鼠则在准星外画同一圈。两者复用同一段绘制函数，读 `state.fuse.t / windTime`。

---

## 5. 判据：证明「玩家真的在等时机」

### 5.1 两个必须存在的计数器

```js
perfectRatio        = 完美次数 / 蓄力总次数
overchargeDeathRate = 过载致死次数 / 蓄力总次数
```

它们不是给玩家看的，是给验收看的：如果玩家根本不等，`perfectRatio` 会贴近 0；如果玩家无脑贪，`overchargeDeathRate` 会飙高。

### 5.2 100 次自动回合的分布要求

在 `?fuse=test` 下跑 100 个自动回合（策略混合：20% 抢蓄、50% 读招、30% 随机），把每次结算的 `ratio` 落进 5 档：

| 档位 | 区间 | 通过要求 |
|---|---|---|
| 取消 | `< 0.12` | 5%–25% |
| 刮痧 | `0.12–0.68` | 10%–45% |
| 完美 | `0.68–0.86` | **25%–55%** |
| 过载 | `0.86–1.40` | **5%–25%** |
| 强制引爆 | `≥1.40` | 0%–8% |

硬性判据（任一不满足即接入失败）：

1. `0.25 ≤ perfectRatio ≤ 0.55` —— 说明存在可被稳定命中的时机窗口；
2. `0.02 ≤ overchargeDeathRate ≤ 0.15` —— 自爆真实存在，但不是必死；
3. **最大单档占比 < 70%** —— 不能全挤在一档（这条直接排除「机器人只会按住不放」或「只会点按」的假通过）；
4. 100 局中过载致死局数 ∈ [3, 20]。

### 5.3 探针脚本（给整合线的 tools/ 用）

```js
/**
 * 引信 100 局探针：驱动合成输入，读 window.__fuseStats
 * 运行前提：FUSE_GATE.enabled = true，且 ?fuse=test 已放开自动回合
 */
async function fuseProbe100(page) {
  const out = { casts: 0, weak: 0, perfect: 0, over: 0, overDeaths: 0, ratios: [0, 0, 0, 0, 0] };
  for (let i = 0; i < 100; i += 1) {
    await page.evaluate(() => window.__fuseTestBegin && window.__fuseTestBegin());
    await page.evaluate(() => window.__fuseTestAutoTurn && window.__fuseTestAutoTurn(i));
    const row = await page.evaluate(() => window.__fuseTestLast || null);
    if (!row) continue;
    out.casts += 1;
    out[row.tier] += 1;
    out.ratios[row.bucket] += 1;
  }
  return out;
}
```

> 这段依赖 `?fuse=test` 下的 `window.__fuseTestBegin / __fuseTestAutoTurn / __fuseTestLast` 三个钩子；钩子由接入方补，逻辑就是「模拟一次按住-松手，返回 tier 与 bucket」。**探针不进正式包**。

---

## 6. 回滚与验收

- 单一开关：`FUSE_GATE.enabled = false` 时，`fuseShouldGate` 永远 false，所有引信代码走不到，行为与原版等价。
- 建议同时保留 `?fuse=off` 强制关闭（优先级高于全局开关），便于线上排查。
- 接入后必须重跑现有三口径 DPS，数字应与接入前一致（因为默认关闭）。
- 视觉验收：金色窗口段、过载红环、自爆震屏三处必须能被肉眼区分；否则「等时机」没有反馈支撑。

---

## 7. 明确不做

- 不加新卡、不改 `MAGIC_CONFIG` 数值、不动敌人 AI。
- 不把引信绑到 Q / 空格 / F。
- 不做「蓄力中可移动惩罚」——原型 03 里移动会中断蓄力，但主文件移动是高频操作，一期先只做「蓄力中可移动、但移动不加速蓄力」，避免手感断裂。
- 不改 `?juice=`（该参数不存在），不发明新的全局特效开关。
