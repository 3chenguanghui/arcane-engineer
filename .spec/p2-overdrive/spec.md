# P2 合体过载（Fusion Overdrive）· 实现规格

> 依据：`REFERENCE_ORIGINALITY.md` §4 P2。决策完整，照此直接编码。

## 1. 目标

- 融合成功后开一个 **0.45s 真实时间窗口**，再按 F 可"赌"一档更强的过载。
- 代价是**按比例烧掉奥能**（最大奥能的 35%），换取对该融合 8 秒：伤害 ×1.5 / 冷却 ×0.8。
- 每局最多 3 次；失败（奥能不足 / 次数用尽）→ 窗口立即淡出 + 提示，不哭不叫（无错误音）。
- 总开关 `OVERDRIVE_CONFIG.enabled`；调试口可完整 A/B。

## 2. 原创边界（写入 PROGRESS 的原文）

- 参考手法：Gears of War「Active Reload」把"一次确认"变成"二次确认 + 时机窗口"的节奏感。
- 我们改成：确认对象是**融合仪式**（本作独有系统），代价是**奥能比例**（不是子弹/换弹），收益是**同一融合的短时超频**，
  并且与 P1 的标签乘算、U11 遗物乘算相乘叠加 → 形成"先改标签再赌过载"的构筑链。
- 明确没借：没有照搬换弹条美术/音效/时长数值表；窗口 0.45s 与 8s 为本作自定首版值。

## 3. 配置与状态

```js
const OVERDRIVE_CONFIG = {
  enabled: true,
  window: 0.45,       // 融合后可再按 F 的窗口（真实时间）
  costRatio: 0.35,    // 扣除最大奥能比例
  maxPerRun: 3,
  buffDuration: 8,
  damageMul: 1.5,
  cooldownMul: 0.8,
  hitStop: 0.06,
  pitchMul: 1.5,      // 过载和弦升调
  shake: 6,
  hudWidth: 260
};
```

`state.overdrive = { window: 0, fusionId: null, buffTime: 0, used: 0, last: null }`。

## 4. 逻辑

| 函数 | 行为 |
| --- | --- |
| `tryFuse()` 成功尾部 | `window = OVERDRIVE_CONFIG.window`；`fusionId = fusion.id` |
| `tryOverdrive()` | 校验 enabled → mode → window>0 → `used<3` → `aether>=round(max*.35)`；通过才结算 |
| 结算 | 扣奥能、`used++`、`buffTime=8`、`window=0`、演出（反向符文环 + 白闪 + 顿帧 + 升调和弦） |
| 失败 | `window=0` + `showToast(原因)`；不扣任何资源 |
| `update(dt)` | 用**真实 dt** 递减 window / buffTime（不受融合慢动作影响），并刷新 HUD 细条 |
| `getMagicDamage(magic, fusion)` | 若 `buffTime>0 && fusion.id === fusionId` → ×1.5 |
| `castPrimary()` | 同一条件 → 冷却再 ×0.8（先取 `fusion`，再写 `state.cooldowns[magic.id]`） |
| F 键 | `window>0 ? tryOverdrive() : tryFuse()` |

HUD：底部细条 `#overdriveBar`，窗口期显示"再按 F 过载 · 剩余秒"，增益期显示"过载 ×1.5 · 剩余秒"，进度用 `scaleX`。

## 5. 验收（`tools/arcane_overdrive.js`，端口 9513）

- **A1** 融合成功 → `window > 0`、`fusionId` 非空。
- **A2** 奥能 0 时按 F → `reason:'aether'`、`window` 归零、`buffTime` 仍 0、奥能不被扣成负数。
- **A3** 奥能满时按 F → `ok`，奥能减少 `round(aetherMax*0.35)`，`used=1`、`buffTime≈8`、`window=0`；同一融合 `getMagicDamage` 提升 ≈1.5×。
- **A4** 冷却 ×0.8：清冷却后 `castPrimary()`，`cooldowns.fireball ≈ fireball.cooldown * mods.cooldownMul * 0.8`。
- **A5** 真实时间递减：`window=0.2` 跑 `update(0.25)` → 0；`buffTime=0.3` 跑 `update(0.4)` → 0 且伤害回到基准。
- **A6** 第 4 次拒绝（`reason:'usedUp'`）+ HUD 细条可见性 + 无脚本错误 + fps ≥ 60 + 截图 `p2-overdrive.png`。

## 6. 挂载点

| 位置 | 行号（当前） | 改动 |
| --- | --- | --- |
| `AUDIO_M3_CONFIG` 附近 | ~L20050 | 新增 `OVERDRIVE_CONFIG` |
| `createInitialState()` | L6194 之后 | `state.overdrive` |
| `getMagicDamage()` | L21761 | 末尾加过载倍率 |
| `castPrimary()` | L21804-21810 | 先取 fusion，再写冷却（含 0.8） |
| `tryFuse()` | L22511 | 成功尾部开窗口 |
| `update(dt)` | L28887 前 | 真实 dt 递减 + `updateOverdriveHud()` |
| `handleKeyDown` fuse 分支 | L28480 | 窗口内改走 `tryOverdrive()` |
| `playFusionChord` / `fusionChordFreqs` | L20050-20100 | 可选 `pitchMul` |
| HUD DOM/CSS | body + style 末尾 | `#overdriveBar` |
| `getState()` / `__roamDebug` | L29535 / L28768 | 暴露 `overdrive` |

## 7. 风险与降级

- 过载 + 标签乘算 + 遗物乘算可能叠到 2~3 倍：用 3 次/局 + 35% 最大奥能（一次几乎半管）双重闸。
- 若仍过强：只调 `damageMul` / `buffDuration`，不动结构。
- 与 P1 面板冲突：F 在面板模式下不响应（现有 mode 检查已覆盖）。
