# A3 UI 整体重做 · 规格（spec）

## Why

现有 UI 已做过一轮打磨，但 **设计令牌没有收口**：同一个"面板底色 / 卡片渐变 / 稀有度颜色"在 CSS 与 JS 里各写了一遍（`#101b2c`、`rgba(159,182,208,.34)`、`RARITY_CONFIG.color`），改一处观感要翻十几个位置；卡片也缺"选中"这一态（只有常态 / 悬浮 / 锁定 / 冷却）。A3 把这些收敛成**一套令牌 + 一套材质 + 四态**，为 A4 动效与 A5 可访问性打底。

## What Changes

- **新增设计令牌**（ART_PLAN §2 全量）：`--surface-1/2/3`、`--surface-line`、`--mat-sheen`、`--mat-inner`、`--rar-common/rare/epic/relic`、`--ease-out`、`--ease-in`、`--dur-pop`，全部只写一次。
- **材质统一**：标题页、战斗 HUD 面板、奖励弹窗、结算页、规则/设置面板、技能树面板、卡牌统一使用 `surface-* + mat-sheen + mat-inner`，**不改尺寸、位置、字号**。
- **稀有度单一来源**：`RARITY_CONFIG.color` 改为引用 `var(--rar-*)`（仅用于 DOM 内联样式，不进 Canvas）；CSS 里的稀有度描边改用令牌派生的半透明色。
- **卡片四态**：常态 / 悬浮（`:hover`）/ 选中（`.is-selected`）/ 禁用（`[disabled]`、`.is-locked`）。选中态只加视觉，不参与任何玩法判定；奖励卡与卡组卡（`.mini-card`）都支持。
- **HUD 不遮挡战斗区**：HUD 面板矩形与"中央安全区"（视口中央 55%×55%）交集为 0；HUD 总面积占视口 < 30%。
- **不新增玩法逻辑、不改数值/判定/房间生成/奖励概率**。

## Impact

- Affected specs：A1（场景材质）、A2（远景）不受影响；A4（动效）将复用 `--ease-* / --dur-pop`；A5（可访问性）复用字号令牌与对比度。
- Affected code：`index_arcane_v2.html` 的 `<style>` 段（`:root`、HUD、`.mini-card`、`.modal/.reward-card/.result-*`、`.rules-*`、`.title-*`）、`RARITY_CONFIG`；新增 `tools\arcane_a3.js`。

## ADDED Requirements

### Requirement: 设计令牌收口
系统 SHALL 在 `:root` 中提供 `--surface-1/2/3`、`--surface-line`、`--mat-sheen`、`--mat-inner`、`--rar-common/rare/epic/relic`、`--ease-out`、`--ease-in`、`--dur-pop`，且 UI 主面板/卡片的底色、材质、稀有度描边 MUST 引用这些令牌。

#### Scenario: 令牌可解析
- **WHEN** 读取 `getComputedStyle(document.documentElement)` 的上述 13 个变量
- **THEN** 全部非空且可被 `color / background / box-shadow / transition` 正常解析

#### Scenario: 材质一致
- **WHEN** 对比 `.modal`、`.reward-card`、`.mini-card`、`.rules-card`、`.title-card` 的计算样式
- **THEN** 它们都含 `mat-sheen` 或 `mat-inner` 之一，且底色来自 `surface-*`

### Requirement: 卡片四态
系统 SHALL 为 `.reward-card` 与 `.mini-card` 提供常态 / 悬浮 / 选中 / 禁用四态，视觉差异可被计算样式区分。

#### Scenario: 选中态
- **WHEN** 元素被加上 `.is-selected`
- **THEN** `border-color`、`box-shadow`、`transform` 至少两项与常态不同，且不改变布局尺寸（`width/height` 不变）

#### Scenario: 禁用态
- **WHEN** 元素带 `disabled` 或 `.is-locked`
- **THEN** `cursor: not-allowed`、`opacity < 0.8`、且无上浮变换

### Requirement: 稀有度单一来源
系统 SHALL 让稀有度颜色只来自 `--rar-*`；`RARITY_CONFIG.color` MUST 引用令牌而不是字面量。

#### Scenario: 三档可区分
- **WHEN** 渲染 `.rarity-common / .rarity-rare / .rarity-epic` 三张奖励卡
- **THEN** 三种 `border-color` 互不相同，且分别等于 `--rar-common / --rar-rare / --rar-epic` 的派生值

### Requirement: HUD 不遮挡战斗区
系统 SHALL 保证 HUD 面板不覆盖视口中央 55%×55% 的安全区，HUD 面积占视口 < 30%。

#### Scenario: 交叠为零
- **WHEN** 取 `.hud-top`、`.floor-panel`、`.hud-deck`、`.hud-record` 的包围盒，与中央安全区求交
- **THEN** 交集面积为 0（容差 1px）

### Requirement: 性能与回归不退化
系统 SHALL 保持 `avgFps ≥ 60`、`errors` 为空、`scenePatch` 仍为视口 + 48 margin、`fogSeen ≥ 1`，核心 15 套回归全绿。

## MODIFIED Requirements

### Requirement: 稀有度颜色（原 RARITY_CONFIG 字面量）
`RARITY_CONFIG` 的 `color` 字段改为 `var(--rar-common) / var(--rar-rare) / var(--rar-epic)`；`relic` 档新增 `var(--rar-relic)` 供后续使用。展示文案（普通/稀有/史诗）与权重不变。

## REMOVED Requirements

无。
