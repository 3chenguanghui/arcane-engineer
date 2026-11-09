# M1-3 规格：被动三选一 + 稀有度三档 + 5 层融合保底

> 状态：已自查并直接执行（用户 2026-11-03 授权“不再等确认，按标准自审后实施”）
> 目标文件：`index_arcane_v2.html`（单文件 / 零依赖 / 素材内联）
> 备份：改动前生成 `index_arcane_v2.bak_20261103_m13.html`

## 1. 目标（每条都可被脚本断言）

1. **过滤已持有**：技能奖励池永远不出现玩家已持有的魔法 / 科技，也不出现已激活的融合；池不足 3 个时用「应急补给」补满，保证永远有 3 张可点。
2. **每层两段奖励**：清层后先弹「技能奖励三选一」（魔法 / 科技 / 融合），选完立刻弹「被动奖励三选一」（遗物池），两段是两个独立弹窗阶段，被动段不混入技能卡。
3. **稀有度三档**：每张奖励带 `common / rare / epic` 标记，抽取按权重（普通 55 / 稀有 35 / 史诗 10）；卡面有对应颜色的边框、稀有度角标与类型标签。
4. **5 层融合保底**：`state.fusionPity` 记录连续未获得融合的层数；达到 4（即第 5 层）时，技能奖励池**强制**出现一条当前可立即凑出 / 或只差一张就能凑出的融合件。
5. **不回归**：已持有的 12 张卡、10 条融合、A 符文合体演出、面板互斥与暂停、HUD 6 列、五项回归全部保持通过。

## 2. 非目标（明确不做）

- 不做遗物 5 → 12（清单已明确并入 M2）。
- 不做事件房选择 / 商店（M2）。
- 不改融合配方、不改融合演出、不改技能数值。

## 3. 数据与状态

| 名称 | 内容 |
|---|---|
| `RARITY_CONFIG` | `common{普通,权重55,#9fb6d0}` / `rare{稀有,35,#3ee6ff}` / `epic{史诗,10,#ffc247}` |
| `REWARD_RARITY` | 类型 → 稀有度：magic/tech=rare，fusion=epic，relic/supply=common |
| `REWARD_CONFIG` | `fusionPityLimit: 5`（连续 5 层必有融合件） |
| `state.rewardStage` | `null` / `'skill'` / `'passive'` |
| `state.fusionPity` | 连续未获得融合的层数（新局归零） |
| `state.floorGotFusion` | 本层奖励是否已拿到融合（用于结算 pity） |

## 4. 行为要求（含边界）

### 4.1 技能段
- 池：未持有魔法 + 未持有科技 + 当前可融合且未激活的融合。
- 权重抽取 3 张，三张 key 不重复。
- **无目标**（池空，例如满栏 + 无融合）：用 3 张「应急补给」，不出现空弹窗。
- **满栏**（12 张全持有）：不出现重复卡；只有可融合配方 / 补给出场。
- 保底：`fusionPity >= 4` 时，若抽出的 3 张里没有融合，则把最后一张替换为强制融合；若一条可融合配方都没有，则替换为“只差 1 张即可凑出融合”的魔法 / 科技；两者都没有才允许保留补给。

### 4.2 被动段
- 技能段选完立即切到 `rewardStage='passive'`，标题改为「楼层被动 · 三选一」。
- 池：`RELIC_CONFIG` 中仍可堆叠的遗物；全部满级时用补给补满 3 张。
- 被动段只影响 `state.mods` / `state.relics`，不碰技能栏。
- 选完回 `playing`；若本层最终没拿到融合，`fusionPity += 1`，否则归零。

### 4.3 暂停与面板互斥
- 两段都在 `state.mode='reward'`，世界 `elapsed` 冻结。
- 奖励里打开技能树（T）→ 关闭后回到**同一阶段**同一组选项，不重新抽卡。
- 奖励中打开 H / O 与奖励互斥，关闭后仍回到奖励。

### 4.4 视口
- 1280×720 / 1920×1080 × 缩放 100% / 125%：两段弹窗三张卡同 top、无横向溢出、无裁字、按钮可点。

## 5. 精确改动清单

1. CSS：`.reward-card` 的三种稀有度边框 + `.r-rarity` 角标（约 L1964 之后）。
2. 配置区：`RELIC_CONFIG` 之后新增 `RARITY_CONFIG` / `REWARD_RARITY` / `REWARD_CONFIG`。
3. `createInitialState`：新增 `rewardStage: null`、`fusionPity: 0`、`floorGotFusion: false`。
4. `buildRewardOptions(stage)` 重写：按阶段建池、按权重抽 3、保底替换、稀有度字段。
5. `buildRewardModalHtml()`：按阶段换 kicker / 标题 / 副标题 / 角标 / 稀有度徽标 / 底部说明。
6. `openReward(reason, stage='skill')`：写 `state.rewardStage`；新增 `openPassiveReward()`。
7. `chooseReward(key)`：技能段选完 → 应用 → 生成被动段并保留弹窗；被动段选完 → 应用 → 关闭 → `playing` + pity 结算。
8. `applyReward`：融合分支置 `state.floorGotFusion = true`。
9. `getState()`：新增 `rewardStage` / `fusionPity` / `rarities`。
10. `__roamDebug`：新增 `openPassiveReward()`、`setFusionPity(n)`、`rarityConfig()`。
11. 文案：奖励弹窗说明改为两段式；HUD/攻略页不改。

## 6. 验证计划（全部走 `window.__roamDebug`）

| # | 断言 | 判定 |
|---|---|---|
| 1 | 稀有度三档配置 | 权重 55/35/10，三档名称与颜色存在 |
| 2 | 技能段不出现遗物 | 连续 30 次 `openReward`，`kinds` 无 `relic` |
| 3 | 技能段过滤已持有 | 全持有 12 张后开 20 次，无 `magic`/`tech` 重复 key |
| 4 | 稀有度覆盖 | 200 次抽样中 common / rare / epic 均出现 |
| 5 | 融合保底 | `setFusionPity(4)` + 持有火球/聚能 → 选项含 `fusion:homingFireball` |
| 6 | 保底补模块 | 只持有火球、pity=4 → 选项含 `tech:concentrator`（可凑出） |
| 7 | 两段式流程 | 技能段选完后 `rewardStage='passive'`、mode 仍 `reward` |
| 8 | 被动段只有遗物 | 被动段 kinds 全部是 `relic` 或 `supply` |
| 9 | 被动段生效 | 选 `relic:power` 后 `damageMul` 从 1 变 1.12，回 `playing` |
| 10 | 满栏兜底 | 全持有 + 全融合后开奖励，仍有 3 张可点且无重复 |
| 11 | 暂停冻结 | 两段中 `state.elapsed` 连采两次差 < 0.02 |
| 12 | 技能树往返 | 奖励中开 T 再关，阶段与 3 张 key 不变 |
| 13 | 三视口布局 | 1280/1920 × 100%/125% 三卡同 top、overflow=0、clipped=0 |
| 14 | 性能/报错 | fps ≥ 60、`__errors` 空 |

**回归**：verify 34/34、flow3 38/38、p1a_ui 39/39、facing 23/23、fusion 78/78、m12 27/27。
**体检**：6 视口 × 7 状态 issues=0，截图 `.screenshots\audit_m13\`。

## 7. 风险与回滚

| 风险 | 处理 |
|---|---|
| 两段式让旧脚本“选一次就 playing”失效 | 同步更新 verify / flow3 / p1a / m12 的收奖励步骤（选到 passive -> 再选一次） |
| 保底强制融合造成固定套路 | 只在第 5 层触发；抽到即重置，不长期锁定 |
| 满栏/无融合时卡池空 | 「应急补给」兜底 + 专项 10 |
| 权重导致史诗泛滥 | 权重固定 10%，专项 4 抽样覆盖 + 卡面角标 |
