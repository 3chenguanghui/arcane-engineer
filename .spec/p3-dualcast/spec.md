# P3 并联回路（Dual-Cast）· 实现规格

> 依据：`REFERENCE_ORIGINALITY.md` §P3。以下为落地版决策（在文档基础上做减法，保证可做、可测、可 A/B）。

## 1. 目标

- 两张魔法挂在"主回路 / 副回路"两个槽上，**共享同一管奥能**。
- 主槽满功率；副槽伤害 ×0.8、冷却 ×1.45、消耗 ×0.9。
- Tab 切换主导权，**0.35s 换相硬直**（两槽都不施法），HUD 有换相进度。
- 奥能只够一发时**只有主槽施法**，副槽自动停摆，且绝不会出现负奥能。
- 融合仍只作用于"它所属槽位的那张卡"（`state.fusions` 按 magic id 记录）。
- 总开关 `DUAL_CONFIG.enabled`：false 时退回单卡施法（旧行为 100% 不变）。

## 2. 原创边界（写入 PROGRESS）

- 参考手法：Vampire Survivors 的"多武器同时开火"节奏、Noita 的"多法术槽"信息结构。
- 我们改成：**只有两个槽 + 一个 focus**，副槽永远降频降伤；共享奥能让"两张高消耗卡"无法无脑并列（必须配一张低消耗卡），
  融合绑定槽位让玩家要决定"融合放主回路还是副回路"。
- 明确没借：没有复制其武器/法杖美术与数值表；0.8 / 1.45 / 0.9 / 0.35 为本作自定首版值。

## 3. 配置与状态

```js
const DUAL_CONFIG = {
  enabled: true,
  secondaryDamage: 0.8,
  secondaryCooldown: 1.45,
  secondaryCost: 0.9,
  switchTime: 0.35,
  autoFill: true
};
```

```js
state.dual = { slots: ['fireball', null], focus: 0, switchCd: 0, castingSlot: 0, stats: { casts: [0, 0], skips: 0 }, notice: false };
```
- `slots`：两槽魔法 id；`focus` 0/1；`switchCd` 换相剩余；`castingSlot` 供 `getMagicDamage` 读"本次是副槽"。

## 4. 逻辑改造

| 位置 | 改动 |
| --- | --- |
| `getMagicDamage()` | 末尾：`castingSlot === 1` 时 ×0.8（仅 DUAL 开启） |
| `castPrimary()` | 变为双槽入口：先 `castSlot(0)`，再 `castSlot(1)`；任一成功返回 true |
| `castSlot(i)` | 从旧 `castPrimary` 抽出：归属/换相硬直/冷却/雷击目标/奥能检查 → 扣费 → 冷却（副槽 ×1.45）→ 分发 |
| 失败提示 | 主槽沿用原 toast；副槽**静默**（只计入 `stats.skips`，避免刷屏） |
| `selectMagic(id)` | 写入 `slots[focus]`；若 id 已在另一槽则两槽交换 |
| `switchFocus()` | Tab：槽 1 为空时先自动填入；`focus` 翻转 + `switchCd=0.35` + 继电器音 + 浮字 |
| `update(dt)` | 真实 dt 递减 `switchCd`，刷新换相细条 |
| `renderDeck()` | 卡面加"主/副"角标；focus 槽加呼吸描边（CSS class，不新增常驻面板） |
| `tryFuse()` | 不变：读 `state.activeMagicId`（= focused 槽的卡），所以融合只落在该槽 |

## 5. 验收（`tools/arcane_dualcast.js`，端口 9514）

- **A1** 装备 fireball(主) + frost(副)，3 秒内 `stats.casts` 两槽都 ≥1。
- **A2** 同卡伤害槽0 : 槽1 = 1 : 0.8（±2%）；`cooldowns.frost / (frost.cooldown*mods.cooldownMul)` ≈ 1.45。
- **A3** 奥能只够一发：只有主槽施法，副槽计数不变，`aether >= 0`。
- **A4** `switchFocus()` 翻转 focus；`switchCd` 内 `castPrimary()` 返回 false；等待 0.4s 后恢复。
- **A5** 在槽 A 融合后 `state.fusions` 只 +1，槽 B 的伤害不变。
- **A6** `DUAL_CONFIG.enabled=false` 时副槽不再施法（A/B 证据）；`window.__errors` 为空；fps ≥ 60；截图 `p3-dualcast.png`。

## 6. 挂载点

| 位置 | 行号（当前） | 改动 |
| --- | --- | --- |
| `OVERDRIVE_CONFIG` 之后 | L4432 | 新增 `DUAL_CONFIG` |
| `createInitialState()` | L6182 后 | `state.dual` |
| `getMagicDamage()` | L21835 | 副槽倍率 |
| `castPrimary()` | L21842-21900 | 拆成 `castSlot(0/1)` |
| `selectMagic()` | L22724 | 槽位写入 + 交换 |
| `renderDeck()` | L10664 | 主/副角标 |
| `keyToAction()` | L28605 | `tab: 'swap'` |
| `handleKeyDown` | L28648 后 | `swap → switchFocus()` |
| `update(dt)` | L29058 前 | `switchCd` 递减 + `updateDualHud()` |
| HUD DOM/CSS | body + style | `#dualBar` |
| `getState()` / `__roamDebug` | L29519 / L30820 | `dual` 摘要 + API |

## 7. 风险与降级

- HUD 拥挤 → 只在卡面加角标 + 换相时短暂细条，不新增常驻面板。
- 双施法性能 → 每帧只多一次"取卡 + 判冷却"，无新对象；若掉帧，降级为"副槽每 2 次主施法触发 1 次"（配置位预留）。
- 与 P2 叠加：副槽同样吃超频（若其融合被过载），倍率为 0.8 × 1.5，符合"同一融合超频"语义。
