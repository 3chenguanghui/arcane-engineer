# D3 · 阶段感 / 里程碑

不做 Boss，做"锚点"：第 5 / 10 / 15 层各一次专属演出，让玩家记住"我走到过哪里"。

总开关：`MILESTONE_CONFIG.enabled`（默认 true，可 A/B）
调试口：`window.__roamDebug.milestone = { info, setEnabled, setFloor, trigger }`

---

## 数据契约

```
MILESTONE_CONFIG = {
  enabled: true,
  floors: [
    { floor: 5,  title: '塔心初响', line: '…', camPeak: 66, duration: 1.8 },
    { floor: 10, title: '深塔行者', line: '…', camPeak: 78, duration: 2.0 },
    { floor: 15, title: '无图纸者', line: '…', camPeak: 92, duration: 2.2 }
  ],
  resultLabel: '最高里程碑',
  emptyLabel: '尚未抵达',
  toastPrefix: '里程碑 · '
}
MILESTONE_STATS = { triggered, lastFloor, highest, duplicates }
```

存档：`meta.milestones = { highestFloor: 0, titles: [] }`
- `defaultMeta()` 补默认值；`normalizeMeta()` 对旧存档按 `bestFloor` 推导 `highestFloor`，`titles` 去重。
- 只增不减：重复触发同一层不会重复记录称号。

## 规则

1. 触发点：`generateFloor(n)` 末尾调用 `triggerMilestone(n)`；只有 `n` 命中 `floors` 列表才演出。
2. **同一层同一局只触发一次**：`state.milestoneTriggers[floor]` 去重；重开新局由 `createInitialState()` 重建 state，自然清零。
3. 演出四件套（同时发生，全部可被关闭）：
   - 镜头：`state.milestoneCam = { t, dur, peak }`，`getCameraTarget()` 在演出期间把 `targetY` 上推 `peak × sin(π·progress)`，`updateCamera(dt)` 递减 `t`；
   - 台词：`spiritSay(line, 5200)`（塔灵专属句，一局一次）；
   - 称号：写入 `meta.milestones.titles`（去重）+ `saveMeta()`；
   - 反馈：`showToast(prefix + title, 'success')` + `playSfx('reward')` + `addRing` + 轻震屏。
4. 结算页（死亡 / 通关）新增一项：`最高里程碑`，值为 `meta.milestones.highestFloor` 对应的称号；没到过 5 层显示 `尚未抵达`。
5. 关掉 `MILESTONE_CONFIG.enabled` 后：不演出、不写称号、不推镜头，结算页仍显示旧存档里的最高里程碑（读取不写）。
6. 老存档/坏字段：`meta.milestones` 缺失时按 `bestFloor` 推导，`titles` 非数组时置空，不崩。

## 断言（A0–A8）

- A0 配置：3 个锚点 5/10/15，顺序升序，`enabled=true`。
- A1 第 4 层不触发；第 5 层触发一次：`stats.triggered +1`、称号入档、`meta.milestones.highestFloor=5`。
- A2 第 5 层重复 `setFloor(5)` 不再触发（`duplicates` 计数 +1，`triggered` 不变）。
- A3 第 10 层 / 第 15 层各触发一次，`highestFloor` 递增，称号不重复。
- A4 镜头：触发后 `state.milestoneCam.t > 0`，`getCameraTarget(false).y` 比无演出时更小（镜头上推）。
- A5 结算页 HTML 含「最高里程碑」与当前称号文本（死亡 / 通关两条路径共用取值函数）。
- A6 `setEnabled(false)`：强制 `triggerMilestone(5)` 不产生演出/称号；恢复 true 后正常。
- A7 旧存档：`meta.milestones` 缺失 + `bestFloor=7` → `normalizeMeta` 推导 `highestFloor=5`，不崩。
- A8 截图 / 无报错 / fps ≥ 50。
