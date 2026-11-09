# A3 UI 整体重做 · 任务清单（tasks）

> 依据 `spec.md`。A3-0（before 截图）必须先于任何 HTML 改动。

| # | 任务 | 具体改动 | 验收 |
| --- | --- | --- | --- |
| [x] A3-0 | **before 截图** | 新建 `tools/arcane_a3.js`（端口 9483，复用 `arcane_a1/a2` 骨架）；在 HTML 未改动时 `node tools/arcane_a3.js before` → `.screenshots/art/a3-before-{title,hud,reward,result,rules,settings}.png` | 6 张 > 10KB；1440×900 dsf 1 |
| [x] A3-1 | 令牌收口 | `:root` 新增 13 个令牌（`surface-1/2/3`、`surface-line`、`mat-sheen`、`mat-inner`、`rar-common/rare/epic/relic`、`ease-out/ease-in`、`dur-pop`） | 13 个变量 `getComputedStyle` 非空 |
| [x] A3-2 | 材质统一 | `.modal / .reward-card / .mini-card / .rules-card / .title-card / .result-modal / .hud-top / .floor-panel / .hud-deck` 底色与阴影改走 `surface-* + mat-sheen + mat-inner`；**不改尺寸/位置/字号** | 5 个主面板计算样式含 mat 令牌；`p1a_ui` 仍 39/39 |
| [x] A3-3 | 稀有度单一来源 | `RARITY_CONFIG.color` → `var(--rar-*)`；`.reward-card.rarity-*` / `.mini-card.r-*` 描边改令牌派生 | 三档 border-color 互异且与令牌一致；卡面文字仍显示"普通/稀有/史诗" |
| [x] A3-4 | 卡片四态 | `.reward-card` / `.mini-card` 补 `.is-selected`；`[disabled]` / `.is-locked` 统一 `cursor/opacity/transform` | 选中态 ≥2 项计算样式变化且尺寸不变；禁用态 `cursor not-allowed`、`opacity<0.8` |
| [x] A3-5 | HUD 遮挡 | HUD 面板底色/内阴影统一；不改布局 | 与中央 50%×40% 安全区交集 0；HUD 面积 0.283 < 30% 视口 |
| [x] A3-6 | after 截图 + 专项 | `node tools/arcane_a3.js after`：6 张 after + 断言（令牌/材质/稀有度/四态/遮挡/字号/fps） | 专项 **18/18 PASS**；`avgFps 120`；errors 0 |
| [x] A3-7 | 核心回归 | 15 套，每套前 `taskkill /F /IM msedge.exe /T` | 全部 PASS、errors 0 |
| [x] A3-8 | 文档收口 | `PROGRESS.md` 新增 A3 条目；验收清单勾 A3；`.spec/a2-depth/tasks.md` 已全勾；本文件全勾 | 条目含 fps / 断言 / 回归 / 风险 |

## 回退点

- 改动前备份：`index_arcane_v2.bak_20261103_a3.html`（同目录）。
- 回归失败优先回退**单个选择器**，不要整体回滚。
- 若 fps < 60：先去掉 `backdrop-filter`，再降 `--mat-*` 透明度；禁止改尺寸/字号。

## 依赖

- A3-1 → A3-2 → A3-3 → A3-4 → A3-5 串行（同一 `<style>` 段）。
- A3-0 必须在 A3-1 之前；A3-6 依赖 A3-1…A3-5。
