# U4 · 任务拆解（终点 / 通关）

| 编号 | 任务 | 完成判定 |
|---|---|---|
| U4-0 | 盘点现状：确认唯一收束路径是 `loseGame()`，楼梯无上限 | 写进 spec 根因 |
| U4-1 | `GAME_CONFIG` 增加 `finalFloor=3`、`victoryDelay=2.4` | 配置可读 |
| U4-2 | `state` 增加 `endless / runCompleted / victoryTimer` | 重开后自动归零 |
| U4-3 | `isFinalFloorRun()` + `onBossDefeated` 末层分支（跳过额外三选一、起计时） | 第 3 层首领倒下 → 计时启动 |
| U4-4 | `winGame()`：状态 won、写档、金色演出 | `meta.clears +1` |
| U4-5 | `showVictory()` 面板（9 项统计 + 永久天赋区 + 双按钮） | 截图可见 |
| U4-6 | `continueEndless()` + 弹窗事件委托 | 返回 playing，不再弹 |
| U4-7 | `__roamDebug.runInfo / continueEndless / setEndless` | 自动化可断言 |
| U4-8 | `tools/arcane_l4.js`（9491）断言的 1–10 项 + 截图 | 全部 PASS |
| U4-9 | 14 套回归 + PROGRESS 落盘 | 全绿 |

## 验证命令

```powershell
node tools/arcane_syntax.js
node tools/arcane_l4.js
node tools/arcane_m12.js ; node tools/arcane_m13.js ; node tools/arcane_m14.js
node tools/arcane_m18.js ; node tools/arcane_m19.js ; node tools/arcane_m20.js
node tools/arcane_m21.js ; node tools/arcane_m22.js ; node tools/arcane_m23.js
node tools/arcane_m24.js ; node tools/arcane_m25.js ; node tools/arcane_verify.js
node tools/arcane_fusion.js ; node tools/arcane_facing.js
```
