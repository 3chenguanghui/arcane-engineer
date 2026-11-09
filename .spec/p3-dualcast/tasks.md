# P3 并联回路 · 任务拆解

- [x] T1 数据层：`DUAL_CONFIG` + `state.dual`
- [x] T2 施法层：`castPrimary()` 拆为 `castSlot(0/1)`，副槽 0.8 伤 / 1.45 冷 / 0.9 耗
- [x] T3 资源层：共享奥能、只够一发时副槽停摆、绝不负数
- [x] T4 输入层：Tab → `switchFocus()` + 0.35s 换相硬直
- [x] T5 槽位层：`selectMagic` 写入 focus 槽并交换；第二张卡自动填入
- [x] T6 表现层：卡面主/副角标 + focus 呼吸描边 + 换相细条
- [x] T7 调试口：`__roamDebug.dual { info, equip, focus, cast, damage }` + `getState().dual`
- [x] T8 验收：`tools/arcane_dualcast.js` 7/7 + 语法检查
- [x] T9 落盘：`PROGRESS.md`（参考手法/我们的改动/数据/下一步 P4/P5 评估）
- [x] T10 回归收口：18 套串行 + 5 条抖动复验 + m12 真回归修复（槽 0 与 activeMagicId 同步）
