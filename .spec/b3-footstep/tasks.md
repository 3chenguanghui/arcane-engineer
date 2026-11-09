# B3 重甲脚步 · tasks

- [x] T1 新增 `FOOTSTEP_CONFIG`（`index_arcane_v2.html` 顶部配置区，紧跟 `DEATH_FORM_CONFIG`）
- [x] T2 新增 `isHeavyEnemyType(typeId)` / `footstepPowerFor(dist)` / `updateHeavyFootstep(enemy, moved)`（放在 `updateEnemies` 之前）
- [x] T3 `updateEnemies` 分轴移动块内接入：实际位移 → `updateHeavyFootstep`
- [x] T4 调试口 `__roamDebug.footstep()`（配置 / 计数 / 最近一次 / 探针 / 重甲名单）
- [x] T5 新建 `tools/arcane_b3.js`（端口 9508，6 条断言 + 1 张截图）
- [x] T6 `node tools/arcane_syntax.js` 通过
- [x] T7 14 套回归串行（`regress_b3.log`）
- [x] T8 写 PROGRESS（含"下一步：M2 故事线"）

