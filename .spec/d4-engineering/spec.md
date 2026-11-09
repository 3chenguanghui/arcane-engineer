# D4 · 工程隐患（存档迁移 + 性能模式）

两块互不影响，各自有开关 / 断言，不改变正常画质与正常存档结构。

---

## 1. 存档版本号 + 迁移函数

现状：`loadMeta()` 直接 `JSON.parse` → `normalizeMeta()`；缺版本号，schema 变了只能靠"字段缺省"猜。

数据契约：
```
META_SCHEMA_VERSION = 4
meta.version = 4
meta.milestones = { highestFloor, titles: [] }   // D3 追加
```
`normalizeMeta(raw)` 流程：
1. `raw` 不是对象 → `defaultMeta()`（坏存档不崩）。
2. `version <= 0`（旧档没有版本号）→ 视为 v0，进入 `migrateMeta(raw, 0)`。
3. 迁移逐级：v0→v4 每一步只补字段 / 转换类型，**不丢已有数据**。
4. 输出前统一 clamp（楼层 / 结晶 / 天赋等级 / 数组长度）。
5. 迁移后若 `meta.version` 仍不是当前版本 → 强制写当前版本号并 `saveMeta()`（下次读取不再迁移）。

规则：
- 字段缺失有默认值（`milestones`、`unlocks`、`talents`、`performance` 等）。
- 类型错误按默认值降级（`titles` 不是数组 → `[]`；`highestFloor` 非数 → 由 `bestFloor` 推导）。
- `localStorage` 里是坏 JSON → 捕获 → `defaultMeta()` + 一次性提示（`state.saveNotice`，HUD toast）。
- 迁移函数必须纯净（`migrateMeta(raw, fromVersion)` 返回新对象），可被测试直接调用。

断言（A0–A6）：版本号落盘；v0 旧档 `bestFloor=7` 迁移后 `milestones.highestFloor=5`、原有天赋/结晶不丢；
坏 JSON 降级不崩且有提示；`titles` 类型错误降级；重复迁移幂等；`saveMeta` 写入后 `version` 正确。

---

## 2. 性能模式（低端机预算）

`PERF_CONFIG = { enabled: true, mode: false, particleScale: 0.45, fogScale: 0.5, disablePostFx: true, minFps: 50 }`
存档：`meta.performance = { mode: false }`，设置页可切换；`state.performanceMode` 由 meta 同步。

规则：
1. 打开性能模式后：
   - `meta.postFx = false`（关闭后处理；设置页的 postFx 开关保持可单独控制，性能模式只强制本局生效）；
   - 粒子 / 碎片数量乘 `particleScale`（`addBurst` / 像素溶解采样处统一读 `perfParticleScale()`）；
   - 迷雾/阴影离屏分辨率乘 `fogScale`（重新创建离屏 canvas 时按缩放建）。
2. 关闭后完全恢复原参数，不需要重开页面。
3. 设置页增加「性能模式」开关（`data-action="perf"`），切换即写入 `meta.performance.mode` 并 `saveMeta()`。
4. 不在战斗逻辑里做 fps 自适应（避免"越卡越降"震荡）；只提供手动开关。

验收：
- `dpr=2` + Edge 关闭硬件加速 + 1440×900，性能模式开启后平均 fps ≥ 50（与关闭对比记录）。
- A/B 断言：`__roamDebug.perf.setMode(true/false)` 后 `state.performanceMode` / `meta.postFx` / 粒子倍率 / 迷雾倍率同步变化。
- 截图对比：模式切换后画面仍可辨识（非黑屏），无报错。

断言（A7–A12）：默认关闭；开启后三个参数生效；关闭后恢复；设置页开关存在且可点击；坏字段降级；截图/fps。
