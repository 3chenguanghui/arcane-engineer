# 第 18 项 · 可执行任务清单（tx）

> 每完成一格立刻落盘：改代码 → 跑对应验证 → 勾选本文件 → 写 PROGRESS。
> 主文件任何时刻都必须能通过 `node tools\arcane_syntax.js`。

- [x] **T1 规格批准**：`.spec/crash.md` 已提交，等待用户确认后执行（系统 Spec 门）。
- [x] **T2 DOM**：在 `.stage` 内、`#settingsPanel` 之后插入 `#crashOverlay` 恢复面板（6 个 id，`role=alertdialog`，默认 `hidden`）。
- [x] **T3 CSS**：新增 `.crash-layer / .crash-actions` 规则（z-index 80、深色、非白屏、移动端按钮满宽）。
- [x] **T4 语法**：`node tools\arcane_syntax.js` → PASS。
- [x] **T5 loop 接线**：`testThrow` 注入、`halted` 跳过 update/render、成功帧 `consecutive=0`、catch 走 `noteLoopError`。
- [x] **T6 全局监听**：`error / unhandledrejection` 在非标题态 `triggerCrash`。
- [x] **T7 boot/开局**：`init()` 里 `bindCrashOverlay(); checkCrashFlagOnBoot();`；`startGame()` 清标记/收面板/复位 halted。
- [x] **T8 调试口**：`__roamDebug.crash`（config/state/simulate/trigger/restore/restart/clearFlag）。
- [x] **T9 语法复跑**：`node tools\arcane_syntax.js` → PASS（52598 行）。
- [x] **T10 验收脚本**：新建 `tools/arcane_crash.js`（端口 9542），C1–C9 全绿（9/9）。
- [x] **T11 截图**：`crash-overlay.png` 非白屏证据（518623B，25 采样 24 色、纯白 0）。
- [x] **T12 回归（串行）**：`arcane_p2` 47/47、`arcane_enemies` 33/33、`arcane_title_assert` 17/17、`arcane_render_probe` 7/7（首次启动竞态，单跑通过）。
- [x] **T13 落盘**：PROGRESS 已写第 18 项记录；PLAN 已勾第 18；PROGRESS 顶部已补勾 17/23。
- [x] **T14 进下一项**：交接完成，下一步第 19 项（形象辨识度重绘），已写入 PROGRESS 下一步。

## 断点规则
若中途撞步数上限：先跑 `arcane_syntax`；不可运行则用 `.bak` / 最小回退；可运行则按本清单未勾格继续。
