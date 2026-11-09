# P4 残响回路（Fusion Echo）· 规格

> 出处：`REFERENCE_ORIGINALITY.md` §P4（第 382–425 行）。原创提案第 4 条。
> 目标文件：`index_arcane_v2.html`（单文件、零外部依赖、`file://` 双击即开）。
> 专项脚本：`tools/arcane_echo.js`（新建，端口 9515）。

## 1. 一句话目标

融合技能释放后，在**施法点**留下一个会按固定节拍复读伤害的低功率"残响节点"：
把"站在哪放技能"变成可兑现的空间资产，同时它是**可被敌人踩碎**的消耗品，不是纯增益。

## 2. 玩法规则（首版）

| 项 | 值 | 说明 |
|---|---|---|
| 触发 | 每次成功释放**已融合**的魔法 | 只在 `castSlot()` 成功分支；普通卡不生成 |
| 生成点 | 施法点 = `state.player.x/y` | 规格要求"施法点不是命中点" |
| 生命 | 6s（真实时间） | 与慢动作解耦，6s 后自然消失（不爆） |
| 脉冲间隔 | 1.5s | 首次脉冲在生成后 1.5s（给玩家 1.5s 读环） |
| 脉冲半径 | 70px | 对范围内**所有**敌人结算 |
| 伤害 | 融合基础伤害 × 0.3 | 区域类融合降级为 0.15 |
| 区域类名单 | `frostField / gravityWell / shieldNova / regenField` | 防止"冰环残响无限控 + 高频 AOE" |
| 上限 | 同时 2 个 | 第 3 个生成时最早的一个立即碎裂 |
| 踩碎 | 敌人圆心进入 `半径×0.5 + 敌人半径` 即碎 | 碎裂对范围内敌人造成 0.5 倍基础伤害 |
| 不复制 | 控制效果 / 过载 / 二次残响 | 只复制伤害；脉冲不调用 `castSlot` |

数值全部进 `ECHO_CONFIG`，首版值见下：

```js
const ECHO_CONFIG = {
  enabled: true,
  life: 6,
  interval: 1.5,
  radius: 70,
  damageRatio: 0.3,
  areaRatio: 0.15,
  areaFusions: ['frostField', 'gravityWell', 'shieldNova', 'regenField'],
  maxCount: 2,
  touchRatio: 0.5,
  breakRadius: 56,
  breakDamageRatio: 0.5
};
```

## 3. 数据契约

```js
// createInitialState() 内
state.echoes = [];   // 元素见下

// 每个残响
{
  x, y,                // 施法点（生成时确定）
  fusionId, magicId,   // 只做调试/渲染，不参与结算
  color,               // fusion.color
  life, maxLife,       // 剩余/总生命
  pulseAcc,            // 距下一次脉冲的累计（真实秒）
  pulseDamage,         // 生成时缓存：base × ratio
  breakDamage,         // 生成时缓存：base × 0.5
  pulses               // 已脉冲次数（断言 A2 用）
}
// base = getMagicDamage(MAGIC_BY_ID[magicId], fusion)，在 ampCharge 复位后取值
```

`getState()` 增加：

```js
echoes: echoStateSummary()   // { enabled, count, max, list:[{x,y,life,remaining,pulses,color,fusionId}] }
```

## 4. 挂载点（精确位置，改前以实际行号复核）

| 位置 | 改动 |
|---|---|
| `DUAL_CONFIG` 之后（约 L4486） | 新增 `ECHO_CONFIG` |
| `createInitialState()` 的 `dual` 之后（约 L6238） | `state.echoes = []` |
| `dualStateSummary()` 之后（约 L22044+） | 新增 P4 函数块 |
| `castSlot()` 尾部 `state.ampCharge = 1;` 之后（约 L21977） | `if (ECHO_CONFIG.enabled !== false && fusion && state.echoes) spawnEcho(...)` |
| `update(dt)` 的 `updateDualHud();` 之后（约 L29287） | `updateEchoes(dt)` |
| `generateFloor()` 的 `state.mines = []` 后（约 L8975） | `state.echoes = []`（不跨层） |
| 世界层渲染 `drawMines();` 之后（约 L11604） | `drawEchoes();` |
| `getState()` 的 `dual:` 之后（L29705） | `echoes: echoStateSummary()` |
| `__roamDebug` 的 P3 块之后（L31028 后） | `echo: { info, spawn, clear }` |

## 5. 实现步骤（函数级）

1. **`spawnEcho(magic, fusion, x, y)`**
   - 关闭时直接 return；`state.echoes` 兜底初始化。
   - 超出 `maxCount`：对最早的调用 `breakEcho(echo, 'evict')`（有爆裂伤害）。
   - 计算 `base = getMagicDamage(magic, fusion)`（调用点已复位 `ampCharge` 与 `castingSlot`，等于"融合基础伤害"）。
   - `ratio = areaFusions.includes(fusion.id) ? areaRatio : damageRatio`。
   - push 一个节点，`life=maxLife=ECHO_CONFIG.life`，`pulseAcc=0`，`pulses=0`。
   - 表现：`addRing(x,y,18,color,46,0.32,'shockwave')` + `addBurst(...,6)` + `playSfx('ui',0.5)` + 小飘字"残响"。
2. **`pulseEcho(echo)`**
   - 对 `state.enemies` 拷贝遍历：`dist < radius + enemy.radius` 且 `hp>0` → `damageEnemy(enemy, echo.pulseDamage, null)`。
   - `addRing(收缩环)`，`echo.pulses += 1`。
   - **不**调用 `tryOverdrive` / `spawnEcho` / 任何 cast。
3. **`breakEcho(echo, cause)`**
   - 移除节点；`addBurst` + 短音；范围内敌人吃 `breakDamage`（`damageEnemy(..., null)`）。
   - `state.echoes.last = { cause, x, y, at }`（调试）。
4. **`updateEchoes(dt)`**（真实 dt）
   - `life -= dt`；到 0 → splice（不爆）。
   - `pulseAcc += dt`；`>= interval` → 减 interval 后 `pulseEcho`。
   - 敌人接触：遍历敌人，命中即 `breakEcho(echo,'touch')` 并 break。
   - 全程倒序遍历 splice，避免越界。
5. **`echoStateSummary()`** 返回第 3 节摘要。
6. **`drawEchoes()`**
   - 地面符文环（`fusion` 色，呼吸）、上下浮动信号线、6s 环形倒计时弧。
   - 画在敌人之前（`drawMines()` 之后）。
7. **调试口 `__roamDebug.echo`**
   - `info()`、`spawn(magicId, fusionId, x, y)`（强制生成，测试用）、`clear()`。

## 6. 验收断言（`tools/arcane_echo.js`，A1–A6）

- **A0** 页面可加载、`ECHO_CONFIG.enabled` 为 true、`state.echoes` 存在且为空。
- **A1** 释放一次融合技能后：`echoes.length === 1`；`|echo.x - player.x| ≤ 8`、`|echo.y - player.y| ≤ 8`；`life ∈ [5.85, 6.0]`。
- **A2** 用一个固定 hp 的假敌放在半径内，等待 3.2s：`pulses ≥ 2`；单次实际扣血 ≈ `getMagicDamage*ratio`（容差 ±10%，暴击用 `state.feel.lastCrit` 排除或取多次中位）。
- **A3** 连续生成第 3 个：`length === 2`；最早的被移除；`state.echoes.last.cause === 'evict'`；碎裂对范围内敌人造成 `base×0.5`（容差 ±10%）。
- **A4** 敌人站到节点上（下一帧被检测）：`length` 减少 1，`last.cause==='touch'`，该敌人掉血 ≈ `base×0.5`。
- **A5** 残响期间：`state.overdrive.used` 不变；`echoes` 数量不因脉冲增加；`state.dual.stats.casts` 不变。
- **A6** 压力：临时 `ECHO_CONFIG.maxCount=20` 生成 20 个，跑 2s，`window.__errors` 为空、帧率 ≥ 50；恢复 `maxCount=2`。
- **A7（A/B）** `ECHO_CONFIG.enabled=false` 时释放融合不生成残响；开回来生成 1 个。

## 7. 风险与降级

- 引力井/冰环类残响高频 AOE → 已用 `areaRatio=0.15` 降级；若专项显示过强，改 `0.10`。
- 脉冲走 `damageEnemy` 会带飘字/粒子 → 每 1.5s × 最多 2 节点，频率低于现有无人机（0.55s），可接受；若体感吵，后续给 `damageEnemy` 加"轻量伤害"可选参数，但**本轮不做**。
- 对象池：首版用数组 splice（同时最多 2 个，20 个压力测试也在 50 帧以上），不做池化，避免过度设计。

## 8. 非目标（本轮明确不做）

- 不复制控制效果、不做"残响链"、不做残响等级/词缀。
- 不改 `damageEnemy` 公共签名。
- 不做 HUD 常驻条；只在节点上画倒计时。

## 9. 完成定义（DoD）

1. `node tools/arcane_syntax.js` 通过。
2. `tools/arcane_echo.js` ≥ 7/7 PASS，`window.__errors` 为空。
3. 回归串行：verify / u1 / u11c / u11 / c7 / fusion / facing / m12 / m13 / m18–m25 / m14 全绿（抖动项单跑复验）。
4. `PROGRESS.md` 写入"参考了谁的手法 / 我们改成了什么 / 没借什么 + 断言数据 + 回归结论"。
5. `奥术工程师_完整范围与验收清单.md` 附录 D 勾选 P4。
