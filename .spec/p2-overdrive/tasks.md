# P2 合体过载 · 任务拆解

- [x] T1 数据层：`OVERDRIVE_CONFIG` + `state.overdrive`
- [x] T2 逻辑层：`tryOverdrive()` 五条校验 + 结算 + 失败静默淡出
- [x] T3 收益层：`getMagicDamage` ×1.5、`castPrimary` 冷却 ×0.8、`tryFuse` 开窗口
- [x] T4 输入层：F 键窗口内路由到 `tryOverdrive`
- [x] T5 时间层：`update(dt)` 真实 dt 递减 window/buffTime
- [x] T6 表现层：反向符文环 + 白闪 + 顿帧 + 升调和弦 + HUD 细条
- [x] T7 调试口：`__roamDebug.overdrive { info, press, fuse, damage }` + `getState().overdrive`
- [x] T8 验收：`tools/arcane_overdrive.js` 6/6 + 语法检查
- [x] T9 落盘：`PROGRESS.md`（参考手法/我们的改动/数据/下一步 P3）
