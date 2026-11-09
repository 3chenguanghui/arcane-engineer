# M1-4 任务清单：技能卡面 UI

> 每项都可独立验证；完成即打勾。

- [x] T0 备份 + 基线回归（5 项 + m12/m13）
- [x] T1 数据：`state.cardFloor` + `stampCardFloor()` 接入奖励与调试发放
- [x] T2 CSS：稀有度三档边框 + `.m-meta` 角标 + `.is-partner` 高亮 + 6 列紧凑内边距
- [x] T3 CSS/DOM：`#cardTip` 浮层 + `#fusionBar` 融合条（含空态）
- [x] T4 JS：`renderDeck()` 写入稀有度类与元信息；`renderFusionBar()` 脏检查渲染并接进 `updateHUD`
- [x] T5 JS：`describeCard()` + `showCardTip/hideCardTip` + `highlightPartners/clearPartnerHighlight` + 事件绑定（悬停 / 触摸长按）
- [x] T6 JS：`closeRewardFlow()` 抽取 + `skipPassiveStage()` + 按钮 + 事件委托 + 调试接口
- [x] T7 专项 `%TEMP%\arcane_m14.js` 12 条断言 + 截图（卡面三档 / 浮层 / 融合条 / 被动跳过）
- [x] T8 回归 34/38/39/23/78/27/26 + 视口体检 6 组 × 8 状态 issues=0
- [x] T9 更新 108 清单 L45 与里程碑边界

> 备注：facing 回归在 M1-4 备份文件上同样出现 14/23（开火 / 静止保持类断言），已确认与本次改动无关，属于无头键盘注入的既有抖动，列入"随 M1 收口复跑观察"。
