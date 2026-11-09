# U1 · 标签乘算（spec · 决策完成版）

> 来源：`.spec/round4-5-merge.md` C2（第五轮 L3「构筑是查表不是乘算」+ 第四轮 §3.4「保底融合」合并）。
> 一句话根因：**22 个能力之间没有任何东西互相放大，玩家拿到即懂、没有第二次发现。**

## 目标（已定稿，不再需要讨论）
1. 22 个能力（6 魔法 + 6 科技 + 10 融合）各挂 2–4 个标签（火/雷/冰/弹体/区域/连锁/控制/持续/治疗）。
2. 新增"标签乘算层"：`collectMods(tags, st)` 读取遗物层数，按标签累乘 `dmgMul`。
3. 新增 3 件标签遗物（余烬 / 导体 / 共鸣），追加进现有 `RELIC_CONFIG`，不新增系统。
4. HUD 左侧楼层面板新增"标签条"；某标签叠到 3 层时一次"短暂统治"演出（0.1s 慢动作 + 元素色边缘染 + 专属音效），每局最多 2 次。
5. 保底融合：`tryFuse()` 在没有可用的专属配方时，用"标签数值熔合"出一个临时融合，不再是白合。

## 决策（含默认取舍，避免返工）
| # | 问题 | 决策 |
|---|---|---|
| D1 | 天赋要不要也进 `collectMods` | **不进**。`fusionMastery` 已在 `getFusionDamageBonus()` 里生效，进 `collectMods` 会双重计算。代码注释写明。 |
| D2 | "3 层"怎么定义 | 层数 = 已拥有能力里带该标签的数量 + 火/雷遗物层数。达到 3 触发。 |
| D3 | dominance 慢动作怎么实现 | 复用现有 `state.fusionSlow`（世界时间 0.2 倍），设为 0.1s；不新增时间系统。 |
| D4 | 保底融合是否进 FUSION_CONFIG | **不进**。生成 `id = 'tag:<magic>:<tech>'` 的运行时对象，`FUSION_CONFIG` 仍 10 条，`fusion 78/78` 不受影响。 |
| D5 | 火球双标签怎么凑"火+雷" | 符文雷 `mine` 挂 `['fire','thunder','area','control']`，是共鸣的落点能力；测试直接调 `tagMul('mine')`。 |
| D6 | 旧观感怎么保留 | 新增 `state.tagsV1`（默认 true）；false 时标签乘算全部为 1，HUD 标签条不渲染 → before 截图口径。 |

## 改动落点（精确到函数）
| 文件 | 位置 | 改动 |
|---|---|---|
| `index_arcane_v2.html` | `RELIC_CONFIG` 之后（约 L4036） | 新增 `TAG_CONFIG` / `ABILITY_TAGS` / `TAG_RELICS`，并 `RELIC_CONFIG.push(...TAG_RELICS)`（`RELIC_BY_ID` 在 L4215 之后构建，自动包含） |
| 同上 | `AUDIO_CONFIG.tones`（L3714） | 新增 `dominance` 音色 |
| 同上 | `getMagicDamage()` 前（约 L18512） | 新增 `getAbilityTags(id)` / `getFusionById(id)` / `collectMods(tags,st)` / `tagDamageMul(id)` / `tagLevels()` / `syncTagSynergy()` / `renderTagBar()` |
| 同上 | `getMagicDamage()` | 末尾 `damage *= tagDamageMul(fusion ? fusion.id : magic.id)` |
| 同上 | L17076 / L19117（融合直伤） | 乘 `tagDamageMul(fusion.id)` |
| 同上 | `getFusionForMagic()` | 改用 `getFusionById()`，支持 `tag:` 合成融合 |
| 同上 | `tryFuse()` | `available` 为空 → `buildTagFusion()` 兜底 |
| 同上 | `updateHUD()` | 调 `renderTagBar()` + `syncTagSynergy()` |
| 同上 | `.floor-panel` DOM + CSS | 新增 `#hudTags` 标签条与 `.tag-pips` 样式；新增 `#dominanceFx` 边缘染层 |
| 同上 | `__roamDebug`（L23168 后） | 新增 `tags()` / `tagMul(id)` / `setTagsV1(on)` |
| 新增 | `tools/arcane_u1.js` | 端口 9488；before/after 截图 + 5 组断言 |

## 验收（可验证）
| 项 | 口径 | 断言 |
|---|---|---|
| 标签覆盖 | 22 个能力全有 tags，每个 2–4 个 | `__roamDebug.tags().coverage === '22/22'` |
| 单标签乘算 | 同一能力：无遗物 vs `ember×1` | `tagMul('fireball') ≥ 1.2` |
| 双标签共鸣 | `ember×1 + conductor×1 + resonance×1` 对 `mine` | `= 1.2 × 1.2 × 1.4 = 2.016` |
| 旧开关 | `setTagsV1(false)` | `tagMul('fireball') === 1` |
| HUD | 出现标签条且 ≥1 个 chip | `#hudTags .tag-pip` 数量 ≥ 1 |
| dominance | 标签到 3 层 | `dominance.count` +1，`fusionSlow > 0`，`≤2 次/局` |
| 回归 | 14 套全绿，`fusion 78/78` 不降 | 见 `tools/` 结果 |
| fps | ≥ 60 | 工具采样中位数 |

## 约束（不变）
- 不改 6/6 卡池、不改三档稀有度、不改 `FUSION_CONFIG` 10 条。
- 单文件零依赖；不下载图片/字体；`file://` 可玩。
- 伤害结算只加"读标签"钩子，不复制结算逻辑。
