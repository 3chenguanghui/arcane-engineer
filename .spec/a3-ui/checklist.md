# A3 UI 整体重做 · 验收检查单（checklist）

> 逐条核对 `spec.md`；每条都要有代码 / 计算样式 / 截图 / 测试结果作为证据。

## 一、令牌

- [x] `:root` 含 `--surface-1/2/3`、`--surface-line`、`--mat-sheen`、`--mat-inner`、`--rar-common/rare/epic/relic`、`--ease-out`、`--ease-in`、`--dur-pop`，共 13 项
- [x] 13 个变量 `getComputedStyle` 全部非空、可解析
- [x] 令牌只定义一次，UI 代码引用而非重复字面量

## 二、材质统一

- [x] `.modal`、`.reward-card`、`.mini-card`、`.rules-card`、`.title-card` 计算样式包含 `mat-sheen` 或 `mat-inner`
- [x] 上述面板底色来自 `surface-*`（不再出现 `#101b2c / #0a1220` 这类旧字面量）
- [x] 统一后尺寸 / 位置 / 字号完全不变（`p1a_ui` 39/39 兜底）

## 三、稀有度

- [x] `RARITY_CONFIG.color` 引用 `var(--rar-*)`，无十六进制字面量
- [x] `.rarity-common / .rarity-rare / .rarity-epic` 三档 `border-color` 互不相同
- [x] 卡面仍显示文字档位（普通 / 稀有 / 史诗），不只靠颜色

## 四、卡片四态

- [x] 常态：有描边 + 材质
- [x] 悬浮：`:hover` 有位移或描边变化
- [x] 选中：`.is-selected` 至少两项样式变化（border / shadow / transform），尺寸不变
- [x] 禁用：`[disabled]` 与 `.is-locked` 均 `cursor: not-allowed`、`opacity < 0.8`、无上浮

## 五、HUD 不遮挡

- [x] HUD 面板与中央 50%×40% 安全区交集面积为 0（容差 1px）
- [x] HUD 总面积 0.283 < 视口 30%
- [x] 战斗区内玩家 / 敌人 / 门 / 楼梯均可完整看到（截图）

## 六、性能

- [x] `avgFps ≥ 60`（实测 120 / 8.33ms）
- [x] `scenePatch` 仍为视口 + 48 margin（1488×948 量级）
- [x] `fogSeen ≥ 1`，`errors()` 为空

## 七、截图

- [x] `a3-before-{title,hud,reward,result,rules,settings}.png` 6 张 > 10KB
- [x] `a3-after-{title,hud,reward,result,rules,settings}.png` 6 张 > 10KB
- [x] before/after 同机位、同缩放（1440×900 dsf 1）

## 八、回归与文档

- [x] 核心回归 15 套全绿：verify / flow3 / p1a_ui / facing / fusion / m12 / m13 / m18 / m19 / m20 / m21 / m22 / m23 / m24 / m25
- [x] `p1a_ui` 39/39（标题天赋 3 行、帮助 3 块、设置四组、奖励入口、结算天赋）
- [x] `PROGRESS.md` 新增 A3 条目（改动点 / fps / 断言 / 回归 / 残留风险）
- [x] `奥术工程师_完整范围与验收清单.md` 勾选 A3；本文件全勾
