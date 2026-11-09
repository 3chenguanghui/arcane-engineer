# U1 · 标签乘算（tasks）

- [x] U1-0 基准：`state.tagsV1` 开关落地，before 截图 = 关掉标签层
- [x] U1-1 `ABILITY_TAGS`：22 个能力（6 魔法 / 6 科技 / 10 融合）挂 2–4 标签（覆盖 22/22）
- [x] U1-2 `TAG_RELICS`：余烬（火）/ 导体（雷）/ 共鸣（火+雷 ×1.4），push 进 `RELIC_CONFIG`
- [x] U1-3 `collectMods(tags, st)` + `tagDamageMul(id)`：`getMagicDamage` 与两处融合直伤各接一次
- [x] U1-4 保底融合：`tryFuse` 无配方时 `buildTagFusion()`，`getFusionById()` 支持 `tag:` id
- [x] U1-5 HUD 标签条 `#hudTags` + `#dominanceFx` + `syncTagSynergy()`（0.1s 慢动作 / 边缘染 / 音效 / ≤2 次）
- [x] U1-6 `tools/arcane_u1.js`（9488）：before/after 截图 + 覆盖/乘算/共鸣/开关/HUD/dominance/fps 断言（19/19）
- [x] U1-7 14 套回归 + PROGRESS 落盘
