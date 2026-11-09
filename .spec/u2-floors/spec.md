# U2 · 五层一局（`finalFloor` 3 → 5）

> 出处：`.spec/round4-5-merge.md` **C4 / U2**（P0）；A9 的取舍里也写明"改为 5 层 + 每层 5–7 间"。
> 前情：L4 先做"终点/通关"时用 `finalFloor = 3`（三主题各一层）验证链路，属于临时值。

## 一、根因

- `.spec/round4-5-merge.md` 的设计是 **5 层一季**，但当前 `GAME_CONFIG.finalFloor = 3`，一局只有 3 层，节奏偏短（PROGRESS L4 条目风险①已记录）。
- 主题与首领本来就是按层轮转（`getTheme()` 3 主题循环、`bossKindForFloor()` 3 首领循环），所以把层数改成 5 **不需要新美术、新首领、新地图逻辑**，只是把"一季的长度"接回设计值。

## 二、改动

| 编号 | 改动 | 位置 | 说明 |
|---|---|---|---|
| A | `finalFloor: 3 → 5` | `GAME_CONFIG` | 第 5 层击败首领后进入通关结算；第 1/3/5 层首领分别为机械/虚空/机械（按 3 首领轮转） |
| B | 通关面板 kicker 自动变成 `RUN COMPLETE · 5 FLOORS` | `showVictory()` | 该文案读 `GAME_CONFIG.finalFloor`，无需改代码 |
| C | `tools/arcane_l4.js` 断言改 5 层 | 测试 | `finalFloor=5`、末层 `setFloor(5)`、`bestFloor ≥5`、"第 5 层通关" |

## 三、断言（`tools/arcane_l4.js` + 14 套回归）

| 编号 | 断言 | 目标 |
|---|---|---|
| L4-1 | 终点配置 | `finalFloor === 5`，初始未通关 |
| L4-2 | 非末层不触发 | 第 1 层首领倒下 3s 后仍无通关面板 |
| L4-3 | 末层触发通关 | 第 5 层首领倒下 → `victoryTimer 2.4s` → `status=won` + 金色通关面板 |
| L4-4 | 战绩 | `clears +1`、`bestFloor ≥ 5` |
| L4-5 | 无尽 | 继续下潜后第 6 层再击败首领不再弹通关 |
| L4-6 | 帧率 / 截图 | fps ≥90、errors 0、通关面板截图非空 |

## 四、风险

1. 一局从 3 层变 5 层，单局时长约 +60%；每层房间数维持 5–7（A9 的取舍），不额外加密度；
2. `meta.bestFloor` 旧存档值（≤3）保持兼容，只增不减；
3. 第 4/5 层会重复使用机械/符文/虚空主题与首领（轮转），强度靠楼层缩放 `hpFloorMul` 继续抬，暂不新增第 4 个首领；
4. 任何写死 `floor === 3` 的测试都要同步（目前只有 `arcane_l4.js`）。
