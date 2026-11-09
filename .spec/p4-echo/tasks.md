# P4 残响回路 · 任务清单

- [ ] T1 新增 `ECHO_CONFIG`（`DUAL_CONFIG` 之后，约 L4486），含 12 个字段与默认值。
- [ ] T2 `createInitialState()` 增加 `state.echoes = []`（`dual` 之后，约 L6238）。
- [ ] T3 新增 P4 函数块（`dualStateSummary()` 之后，约 L22044+）：
      `isAreaEchoFusion` / `spawnEcho` / `pulseEcho` / `breakEcho` / `updateEchoes` / `echoStateSummary`。
- [ ] T4 `castSlot()` 尾部（`state.ampCharge = 1;` 之后，约 L21977）挂接 `spawnEcho`。
- [ ] T5 `update(dt)` 的 `updateDualHud();` 之后（约 L29287）挂接 `updateEchoes(dt)`。
- [ ] T6 `generateFloor()` 的 `state.mines = []` 后（约 L8975）清空 `state.echoes`。
- [ ] T7 新增 `drawEchoes()`（`drawEngraveStations` 附近实现），并在世界层 `drawMines();` 之后（约 L11604）调用。
- [ ] T8 `getState()` 增加 `echoes: echoStateSummary()`（`dual:` 之后 L29705）。
- [ ] T9 `__roamDebug.echo { info, spawn, clear }`（P3 调试块之后 L31028 后）。
- [ ] T10 新建 `tools/arcane_echo.js`（端口 9515），实现 A0–A7。
- [ ] T11 语法检查 `node tools/arcane_syntax.js`。
- [ ] T12 专项跑 `node tools/arcane_echo.js`，7/7 以上。
- [ ] T13 回归串行（同时只跑一个 Edge，间隔 2s）：verify / u1 / u11c / u11 / c7 / fusion / facing / m12 / m13 / m18–m25 / m14；红灯先单跑复验。
- [ ] T14 `PROGRESS.md` 顶部写入 P4 记录（参考手法 / 我们的改动 / 没借什么 / 数据 / 回归 / 下一步）。
- [ ] T15 `奥术工程师_完整范围与验收清单.md` 附录 D 勾选 P4。
