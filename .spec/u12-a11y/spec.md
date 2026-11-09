# U12 · 浮游装置回应 + 可访问性开关

> 来源：`.spec/round4-5-merge.md` B9 / D9；依赖：无。目标：装置"活着"，设置能照顾光敏感 / 易晕玩家。

## 一、根因

1. **装置是死的**：单元 C 的背部悬浮装置只有"自转刻点"，施法、冲刺、濒死三种状态对它没有任何影响——玩家身体在做动作，装置像贴纸。
2. **可访问性缺失**：屏震与整屏闪白是全局硬编码，设置页只有后处理开关；对光敏感 / 易晕玩家没有退路。

## 二、改动（全部只影响表现层，不改玩法数值）

| 编号 | 改动 | 位置 | 说明 |
|---|---|---|---|
| A | `hoverDeviceOffset(player, t)` | `drawPlayer` 之前 | 纯函数返回 `{x,y,glow,alert}`：施法 +4.5px 前移并拉满辉光；冲刺 −5px 拖后；HP<30% 抖动 ≤1.8px 且辉光 0.45、描边转红 |
| B | 装置绘制接入偏移 | `drawPlayer` 装置段 | 环与 4 个刻点整体平移；濒死时描边/刻点变红 |
| C | `meta.reduceShake` / `meta.reduceFlash` | `defaultMeta` + `normalizeMeta` | 默认 `false`，旧存档缺字段回退 `false` |
| D | `triggerShake` 缩放 | 现有函数 | `reduceShake` 时幅度 ×0.35，记账 `state.feel.a11yShakeScale` |
| E | `flashScreen` 抑制 | 现有函数 | `reduceFlash` 时完全不播，`lastFlashMs=0` 并累计 `flashSuppressed` |
| F | 设置页「可访问性 · A11Y」 | `#settingsPanel` | 两个 switch + 状态文案 + 说明；`syncA11yToggles` / `renderSettingsPanel` |
| G | 设置面板可滚动 | `.settings-panel` | 第 5 块内容超出卡片高度，面板自身滚动（卡片头固定） |
| H | 调试口 | `__roamDebug` | `a11y()` / `setA11y()` / `devicePose()` / `shakeTest()` / `flashTest()` |

## 三、断言（`tools/arcane_u12.js`，端口 9505）

| 编号 | 断言 | 目标 |
|---|---|---|
| U12-1 | 两个开关存在且默认关 | `aria-checked=false`、总状态「全效果开」 |
| U12-2 | 面板可滚动、A11Y 区块完整可见 | 滚动后两个开关落在视口内 |
| U12-3 | 开启写入 meta + UI 同步 | 两 aria true、总状态「已开启」 |
| U12-4 | 减少屏震 | 固定 20 → 7（35%），`scale=0.35` |
| U12-5 | 关闭闪白 | 100ms → 0ms，`suppressed ≥1` |
| U12-6 | 存档持久化 | localStorage 两字段 true，`restart()` 后仍 true |
| U12-7 | 施法前移 | `x ∈ [4,5]`、`glow=1` |
| U12-8 | 冲刺拖后 | `x ∈ [−5,−4]` |
| U12-9 | 濒死抖动 | `alert=true`、抖动 ≤1.8px、`glow≤0.46` |
| U12-10 | 关闭后恢复 | 震屏 20 / 闪白 100ms / 总状态复位 |
| U12-11 | 帧率 / 异常 / 截图 | fps ≥90、errors 0、4 张截图 >10KB、`mode=playing` |

## 四、风险

1. `triggerShake` 的峰值是 `max()` 累积，单独验证某一次事件前必须清 `state.shake`（测试口已做）；
2. 可访问性只管"闪白 / 屏震"，不关径向光柱与冲击环——这是刻意保留的可读性；
3. 设置面板新增第 5 块后，矮窗口（≤820px）走两列网格，高窗口走单列滚动，两种都要能滚到最后一块。
