# C7 · 任务清单

- [x] 定位奖励池 / 结算 / 受伤链路（`buildRewardOptions` / `applyReward` / `damagePlayer` / `state.mods`）
- [x] 写 spec（`spec.md`）
- [x] `REWARD_RARITY.pact = 'epic'` + `REWARD_TAGS.pact = '契约'`
- [x] `state.mods.pactTakenMul` + `state.pactBlessTaken / pactCurseTaken`
- [x] `buildRewardOptions('skill')` 追加两条契约（各一次守卫）
- [x] `applyReward` 新增 `pact` 分支（overclock / greed）
- [x] `damagePlayer` 乘 `pactTakenMul`
- [x] 调试口 `pacts()` + `pactOptionExists(kind)`（供测试稳定取卡）
- [x] `tools/arcane_c7.js`（端口 9506，C7-1..8）跑通（9/9 PASS）
- [x] 2 张截图（`c7-pact-cards.png` / `c7-pact-taken.png`）
- [x] 14 套回归串行复跑全绿（m13 断言同步 `pact:` 后 26/26；m14/m20 单跑复验通过）
- [x] PROGRESS 落盘 + 结尾"下一步"
