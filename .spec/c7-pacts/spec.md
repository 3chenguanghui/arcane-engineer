# C7 · 祝福 / 诅咒契约（奖励池风险方差源）

出处：`round4-5-merge.md` C7��R4 §3.4）——「祝福 / 诅咒三选一（高风险高回报）」。
结论：C7 不单独做一套系统，只作为奖励池的「方差来源」加 2 条契约卡，与 C2 标签乘算同源；本阶段先落 2 条可开关的独立契约。

## 一、根因

现在的三选一全是"纯增益"：伤害 +、生命 +、回复 +，玩家永远只会挑数值最大的那张，
5 层一局的构筑曲线是单调上升的，没有"要不要赌一把"的决策点。
R4 §3.4 要的正是这个决策点：**用一条明确的代价，换一条明显超额的收益**。

## 二、设计（严格 2 条，每局各一次）

| id | 名称 | 类别 | 收益 | 代价 |
| --- | --- | --- | --- | --- |
| `overclock` | 祝福 · 锋刃协议 | `pact` / epic | `state.mods.damageMul ×1.12`（对敌伤害 +12%） | `state.mods.pactTakenMul ×1.10`（受到伤害 +10%） |
| `greed` | 诅咒 · 贪婪回路 | `pact` / epic | 永久结晶 +2（`state.meta.crystals`，立即 `saveMeta()`） | 本局最大生命 −8（`state.mods.hpBonus −= 8`，`applyMetaStats` 重算） |

设计约束：
- **每局各一次**：取过即 `state.pactBlessTaken / state.pactCurseTaken = true`，之后不再进池（同一次奖励里也不会重复）。
- **只走三选一 UI**：不新增按键、不新增面板、不弹出二次确认；与现有 `chooseReward` 流程完全一致（技能段选完照常接被动段）。
- **不进保底**：融合保底 / 补给兜底不会把契约挤掉或被契约挤掉——契约只在池里，由 `pickWeightedOptions` 正常抽。
- **不碰魔法/科技/融合/遗物**：卡池数量不变（6 魔法 / 4 科技 / 10 融合 / 遗物），只多 2 条 `kind: 'pact'`。
- **存档安全**：`pactTakenMul` 只在 `state.mods` 里（本局内），不写 `meta`；唯一写盘的是 `greed` 的结晶 +2（走既有 `saveMeta()`）。

## 三、改动清单

1. `state.mods` 增 `pactTakenMul: 1`；`state` 顶层增 `pactBlessTaken: false`、`pactCurseTaken: false`（`createInitialState()` 每次重开自动复位）。
2. `REWARD_RARITY.pact = 'epic'`；`REWARD_TAGS.pact = '契约'`。
3. `buildRewardOptions('skill')`：在科技段之后、融合段之前追加两条 `pushOption('pact', ...)`，用 `!state.pactBlessTaken` / `!state.pactCurseTaken` 守卫。
4. `applyReward(option)`：新增 `kind === 'pact'` 分支，按 `option.id` 分发两条契约的收益 / 代价。
5. `damagePlayer(amount, ...)`：`let damage = amount;` 之后先乘 `state.mods.pactTakenMul`，再走既有 `field` 减伤与护盾减伤（顺序不影响乘算结果，先乘契约让浮字与死因记录的数值是"契约后"的真实值）。
6. 调试口 `__roamDebug.pacts()`：返回 `{ blessTaken, curseTaken, damageMul, pactTakenMul, hpBonus }` 供断言。

## 四、验收断言（`tools/arcane_c7.js`，端口 9506）

- C7-1 契约卡进池：连续 `openReward('skill')` 最多 60 次，能看到 `pact:overclock` 与 `pact:greed`；卡面 `tag` 文案为「契约」。
- C7-2 祝福收益：记录 `damageMul` → 选 `overclock` → `damageMul ×1.12`（容差 1e-6）、`pactBlessTaken === true`。
- C7-3 祝福代价：`pactTakenMul === 1.10`；同一数值的伤害事件，`damagePlayer` 返回的 `applied` 与基线相比 ≥ +8%（±1 取整容差）。
- C7-4 诅咒收益：`meta.crystals` +2 且 `localStorage` 已落盘（重读 meta 一致）。
- C7-5 诅咒代价：`player.hpMax` −8；当前 hp 被 clamp 到新上限内且 ≥1。
- C7-6 一局一次：取过后再连续生成 60 次奖励，不再出现对应 `pact:*`。
- C7-7 重开复位：`restart()` 后 `pactTakenMul === 1`、两个标记 false、`damageMul === 1`。
- C7-8 帧率 ≥90、无脚本错误、2 张截图 >10KB（`c7-pact-cards.png` / `c7-pact-taken.png`）且截图时 `mode === 'reward'`（卡面证据）或 `playing`（应用后 HUD 证据）。

## 五、风险

1. `pactTakenMul` 是乘算且可叠加一次，配合已有 `field` 0.85 与护盾 0.5，最坏 1.10 × 0.85 × 0.5 → 仍低于原值，不会出现"越叠越脆到秒杀"；但若后续要加更多诅咒，需要改成加算或设上限。
2. `greed` 改 `hpBonus` 会影响 `applyMetaStats` 的派生上限；若玩家已把 hpBonus 堆到负值，极端情况下 hpMax 可能过低 → 分支内保证 `hpMax ≥ 40`（不足则跳过扣减并提示）。
3. 契约是 epic 权重，早期楼层不一定出现；这是刻意的（不是保底），断言用"最多 60 次生成内出现过"而不是"每次必出"。
4. 契约卡与 `vaultRewardBoost` 稀有度提升叠加时仍是 epic，不会变成不存在的档位。
