# 第 18 项规格 · 崩溃兜底与自动保存

> 目标（PLAN 原文判定标准）：全局异常捕获、白屏兜底、出错前最后一次可恢复。
> 约束：单文件零依赖、函数级注释、中文；不改弱任何已 PASS 断言；任何时候留一个可运行主文件。

---

## 一、恢复检查结论（2026-11-06）

| 检查 | 结果 |
|---|---|
| `node tools\arcane_syntax.js` | `chunk 0 OK (52536 lines)` · `RESULT: PASS` |
| PLAN.md 第 17 项 | 已完成（虚拟手柄 14/14） |
| PLAN.md 第 23 项 | 已完成（A5/A5b 转绿，A4/A7 固定为量尺证据） |
| PLAN.md 第 18 项 | **待做**（本规格对象） |
| PROGRESS.md 详细记录 | 第 16/23/17 项均已写；顶部清单 17/23 仍为 `[ ]`（需补勾） |
| 主文件状态 | **可运行**；第 18 项仅插入了配置与函数，尚未接线 |

### 已存在的代码（无需重写）

- `index_arcane_v2.html` L6024–L6038：`CRASH_CONFIG`、`crashState`
- L6044–L6233：`writeCrashFlag / readCrashFlag / clearCrashFlag / showCrashOverlay / hideCrashOverlay / triggerCrash / noteLoopError / crashRestore / crashRestart / checkCrashFlagOnBoot / bindCrashOverlay`
- 依赖已存在：`firstEmptyRunSlot()` L45250、`saveRunSlot()`、`restoreRunFromSlot()`、`restartRun()` L44564、`recordError()` L49778、`showToast()`

### 缺口（本项要补的 6 处接线）

1. DOM：`#crashOverlay / #crashMsg / #crashMeta / #crashRestoreBtn / #crashRestartBtn / #crashCopyBtn` 全部不存在
2. `loop()` L49790：仍是 `try { update; render } catch { recordError }`，未接 `testThrow / halted / consecutive`
3. 全局监听 L57785–L57786：只 `recordError`，未 `triggerCrash`
4. `init()` L57775：未调用 `bindCrashOverlay(); checkCrashFlagOnBoot();`
5. `startGame()` L48332：未清理崩溃标记 / 收起面板 / 复位 `halted`
6. `window.__roamDebug` L50381：无 `crash` 调试口（gamepad 块止于 L50679）

---

## 二、实现方案（decision-complete）

### 2.1 DOM（`.stage` 内，`#settingsPanel` 之后）
新增 `<div id="crashOverlay" class="rules-layer crash-layer" hidden>`：
- kicker：`RECOVERY · CRASH`
- 标题：`游戏遇到异常`
- `#crashMsg`：固定安全提示文案
- `#crashMeta`：`中断于第 N 层 · 最近存档：槽 N · 错误摘要`
- 按钮行：`#crashRestoreBtn`（主按钮）/ `#crashRestartBtn` / `#crashCopyBtn`
- `role="alertdialog"`、`aria-modal="true"`，面板不覆盖失败帧的视觉信息（保留轻背景）

### 2.2 CSS（紧邻 `.rules-layer` 规则之后）
- `.crash-layer`：`z-index: 80`、背景 `rgba(2,5,10,.86)`、`backdrop-filter: blur(6px)`
- `.crash-layer .rules-card`：`width: min(560px, 92vw)`、`border-color` 用告警色变量
- 按钮行 `.crash-actions`：flex 换行，主按钮在左且唯一高亮；移动端 100% 宽
- `hidden` 属性优先（`[hidden]{display:none}` 已有则复用）

### 2.3 `loop()`（L49790）
```js
try {
  if (crashState.testThrow > 0) { crashState.testThrow -= 1; throw new Error('simulated crash (debug)'); }
  if (!crashState.halted) { update(dt); render(); }
  crashState.consecutive = 0;   // 只要这一帧没抛异常就归零
} catch (error) {
  recordError(error);
  noteLoopError(error);         // 连续 2 帧 → triggerCrash
}
```
`requestAnimationFrame(loop)` 保持不变：崩溃后循环继续空转，面板按钮仍可响应。

### 2.4 全局监听（L57785）
```js
window.addEventListener('error', (event) => {
  const err = event.error || event.message;
  recordError(err);
  if (state && state.mode !== 'title') triggerCrash(err);
});
window.addEventListener('unhandledrejection', (event) => {
  recordError(event.reason);
  if (state && state.mode !== 'title') triggerCrash(event.reason);
});
```

### 2.5 `init()`（`installDebugApi();` 之后、`requestAnimationFrame(loop);` 之前）
```js
bindCrashOverlay();
checkCrashFlagOnBoot();
```

### 2.6 `startGame()`（`state.mode = 'playing';` 之后立刻）
```js
clearCrashFlag();
hideCrashOverlay();
crashState.halted = false;
crashState.consecutive = 0;
crashState.shown = false;
```

### 2.7 `__roamDebug.crash`（gamepad 块之后）
`config() / state() / simulate(n) / trigger(msg) / restore() / restart() / clearFlag()`
- `simulate(n)`：设 `crashState.testThrow = n`，供测试注入；返回设定值
- `state()`：`{config enabled, halted, shown, consecutive, total, flag, overlayHidden}`

---

## 三、验收（新建 `tools/arcane_crash.js` · 端口 9542）

| # | 断言 | 判定 |
|---|---|---|
| C1 | 页面启动 0 错误、`__errors` 为空 | `length === 0` |
| C2 | 单帧瞬时异常不弹面板 | `simulate(1)` 后 500ms：`shown=false`、`halted=false`、`consecutive=0` |
| C3 | 连续 2 帧 → 停机 + 弹面板 | `simulate(2)` 后：`halted=true`、`shown=true`、`#crashOverlay` 可见 |
| C4 | 崩溃前自动存档 | 崩溃后 `p2.slotInfo()` 对应槽 `savedAt` 更新且 `reason='crash'` |
| C5 | 非白屏 | 截 `crash-overlay.png`，中心区域非纯白（≥3 种采样色） |
| C6 | 一键恢复 | 点 `#crashRestoreBtn` → `halted=false`、面板收起、`state.floor` 与崩溃前一致 |
| C7 | 刷新后仍可恢复 | 重载（不清 localStorage）→ 面板自动出现；点恢复后回到原层 |
| C8 | 放弃重开 | 点 `#crashRestartBtn` → 回到第 1 层、`flag` 清空 |
| C9 | 总开关 | `CRASH_CONFIG.enabled=false` 时不弹面板（行为不变） |

回归（串行，必跑）：`arcane_syntax` → `arcane_crash` → `arcane_p2` → `arcane_enemies` → `arcane_title_assert` → `arcane_render_probe`。

## 四、落盘

- 完成即写 PROGRESS（字段 / 依据 / 实测数字 / 下一步第 19 项）
- PLAN.md 第 18 行改「已完成（12/12 或实际断言数）」
- 顺手补勾 PROGRESS 顶部清单第 17、23 项

## 五、风险

1. `state.status` 字段名若与 `triggerCrash` 里的判断不一致，自动存档会跳过 → 实现时先核对再接线（失败时仍弹面板，只是槽位回退到 `state.runSlot`）。
2. 崩溃后 `loop` 空转仍占 rAF，属预期（保证面板可交互）；`enabled=false` 时保持原空转。
3. 截图验收需在恢复面板出现时完成，截图脚本必须串行，端口 9542 不得与 9540/9541 冲突。
