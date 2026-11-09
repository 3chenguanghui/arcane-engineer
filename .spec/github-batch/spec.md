# G 批次规格：楼层生成加固 / 顿帧只缩模拟时间 / 屏震四相位阻尼

> 来源：`GITHUB_REFERENCE.md`。三项独立改动，互不共用函数；每项都有 `*_CONFIG.enabled` 可 A/B、
> 专项断言与 PROGRESS 记录。改动面大的项（AI 状态机、声明式弹幕、卡牌数据化）不在本批。

## G1 楼层生成加固（`generateFloor`）

### 规则
1. 布局尝试最多 `FLOOR_GEN_CONFIG.maxAttempts = 8` 次；每次都是新的随机布局（等价换种子）。
2. 每次尝试后校验：房间数 4–7、所有边端点合法、从出生房 BFS 可达全部房间、楼梯房是**可达的最远房**。
3. 全部失败 → 5 房线性兜底（列号 0,1,1,2,3，显式树边 + 一条回环边，不依赖 Delaunay）。
4. 房内种子 `room.seed = floorSeed ^ (roomId * 2654435761)`；房型 / 机械变体用 `roomHash01(room, salt)`，
   同一层重复生成内容不变（不闪变）。

### 数据契约
- `FLOOR_GEN_CONFIG`：`enabled / maxAttempts / minRooms / maxRooms / validate / seedMix`
- `FLOOR_GEN_STATS`：`runs / attempts / fallback / failures / rooms / valid / lastMs`
- `state.floorGen = { attempts, fallback, rooms, valid }`
- `__roamDebug.floorGen.info() / simulate(count)`（只跑布局+建图+校验，不烘焙不刷怪）

### 断言（`tools/arcane_floor.js`，9518）
- A0 配置默认值；A1 连续 50 层 `bad=0`、房间 4–7；
- A2 当前层楼梯坐标落在最远房内、与出生房不同；
- A3 同层重复生成 seed 一致；
- A4 `maxAttempts=0` 强制兜底仍合法；
- A5 真实 `generateFloor(3)` 落地且 `valid=true`、无新增错误；
- A6 截图 >10KB / fps≥60 / errors=0。

## G2 顿帧只缩模拟时间（主循环 + `requestHitStop`）

### 规则
1. 主循环：`worldDt = state.hitStop > 0 && HITSTOP_CONFIG.enabled ? dt * 0.16 : dt`；
   输入、HUD、音频、帧率采样继续用真实 `dt`。
2. 所有顿帧请求走 `requestHitStop(seconds)`：`Math.max` 合并（绝不累加），单次上限 0.22s。
3. 统计 `HITSTOP_STATS`：`requests / merged / skipped / lastRequest / lastMax / active / ring`。

### 断言（`tools/arcane_feel.js` A5–A7）
- 顿帧时 `simDt/realDt ≈ 0.16`、关闭开关后 `= 1`；
- `0.06 + 0.13 → 0.13` 且 `merged ≥ 1`；
- 顿帧期间按键仍产生非零位移。

## G3 屏震四相位阻尼（`triggerShake` + 渲染）

### 规则
1. 曲线 `shakeCurveAt(u)`：相位 `[1, -0.6, 0.3, -0.1]`，段内余弦平滑，包络 `(1-u)^2`。
2. 渲染：主方向冲击 + 垂直方向次级高频振荡；`triggerShake(power, time, cap, dirAngle)` 可带方向。
3. 保留 `reduceShake`（0.35）与 8px 普通事件上限；`SHAKE_CONFIG.enabled=false` 退回旧随机偏移。

### 断言（A0–A4、A8）
- 曲线采样 `1 / -0.3375 / 0.075 / -0.00625`（形状断言，不只是峰值）；
- `4/7/5 → 7`（取最大）；上限 8；`reduceShake` 8→2.8；连续 10 次后归零。

## 风险与降级
- G1：`enabled=false` 退回单次生成；布局异常永远有线性兜底，不会出现"没有楼梯"的死局。
- G2：`enabled=false` 时顿帧不再缩放模拟时间（A/B 对照）。
- G3：`enabled=false` 时完全走旧随机偏移，观感可对照。
