# U9 · 任务拆解

| 编号 | 任务 | 完成判定 |
|---|---|---|
| U9-0 | 截 before：旧标题屏（7 条引导）整屏 | `u9-title-before.png` > 10KB |
| U9-1 | 标题 HTML 减法：移除 `title-themes` + `title-guide`，保留核心 | 引导 0 条 |
| U9-2 | 新增 `#titleBg` canvas + `.title-bg` 样式（卡片之下） | 尺寸 > 0 |
| U9-3 | `drawTitleBackground(t)`：底 / 双六边环 + 电路节点 / 48 微粒 / 主角剪影 | `titleBgStats()` 可读 |
| U9-4 | 标题可见时 rAF、进入游戏即停 | 停绘后两帧哈希相同 |
| U9-5 | `.title-sigil` 六边星 + 电路节点（纯 CSS `clip-path`） | `clip-path` 含 polygon |
| U9-6 | `.context-hint` HUD 结构与样式（11px 下限、不挡玩法） | 可见 / 可读 |
| U9-7 | 首局三步提示（移动 / 施法 / 影步），结束写 `meta.hintsSeen` | 文本按时推进、一次性 |
| U9-8 | 靠近楼梯 / 宝箱提示 | 文本含 E |
| U9-9 | `state.u9V1` A/B：关闭恢复旧 DOM + 停背景 | 旧 7 条恢复 |
| U9-10 | `__roamDebug`：`setU9 / u9Audit / titleBgStats / setHintsSeen / clearHints` | 脚本可驱动 |
| U9-11 | `tools/arcane_u9.js`（9497）13 项断言 + 3 张截图 | 全 PASS |
| U9-12 | 14 套回归 + PROGRESS 落盘 | 全绿 |

## 状态
全部完成（2026-11-04）。专项 19/19 PASS，14 套回归全绿。

## 收口时追加的两条（原计划外）
| 编号 | 任务 | 完成判定 |
|---|---|---|
| U9-13 | 提示条贴卡组栏上沿（`syncContextHintOffset` + `ResizeObserver`） | 提示条不压技能卡 |
| U9-14 | 修标题层 HTML 闭合（`title-duo` 左列 + `titleLayer`），把 `#modalLayer/#floorWipe/#bossTitle` 移出标题层 | 奖励卡 `pointer-events:auto`、m13/m14 恢复 |

