# Spec · 首屏 A + B 落地（v1.7.1 第一批）

## 1. 目标与范围
把已拍板的两个改动落进补丁文档，并在**副本**上验证；主文件 `index_arcane_v2.html` 只读不写（并行会话仍在写入）。

- **A**：把 `buildAtmosphere()` + `bakeScene()` 从启动期 `generateFloor(1)` 移到"开始探索"之后，用既有 `#sceneFade` 场景遮罩盖住这段同步开销（玩家感受到"过渡"，不是"卡住"）。
- **B**：`updateHUD()` 增加可选 `animate` 参数，启动期调用传 `false`，跳过 `void element.offsetWidth` 强制重排；游戏内调用不传参，动画照旧。

不做：C（已实测证伪）、C′（无实测，只留"待验证"，不写收益）。

## 2. 硬约束
1. 延后不能变成"卡一下"：`startGame()` 中在黑场最高点执行烘焙，且交付要报两个数（双击→标题、点开始→能走）。
2. 默认值补齐：`state.parallax / sceneArt / sceneProps / atmosphere / sceneBakePending` 在烘焙前被读到的路径都要有可用默认值。
3. 签名口径：`captureFloorSignature()` **保留原位**（它只读 rooms/enemies/doors，不依赖 bakeScene 的任何产物；延后反而会与 `maybeAutosaveRun` 抢顺序）。这满足"不许签名按空值算"。
4. 落地前跑 `.optim/final_check.mjs` 53 条锚点，任何一条命中≠1 立即停止。
5. 改动只写进补丁文档；主文件不动。

## 3. 精确改动（锚点必须唯一命中）
文件：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`（快照 `.optim/snapshot_C.html`）

### A-1 `generateFloor` 延后（约 22689–22692 行）
```js
/* v1.7.1-A：首屏延后烘焙。
   标题页阶段，"氛围数据 + 离屏烘焙"在屏幕上完全不可见，却占 init 里 generateFloor 的绝大部分。
   这里先记一个待办，等玩家点"开始探索"时在黑场最高点补做（flushPendingSceneBake）。
   换层 / 重开路径 state.mode 不是 'title'，仍走原来的立即烘焙，行为不变。 */
if (state.mode === 'title') {
  state.sceneBakePending = true;
} else {
  state.atmosphere = buildAtmosphere();
  bakeScene();
}
```

### A-2 新增 `flushPendingSceneBake()`（插在 `function startGame()` 之前）
```js
/**
 * v1.7.1-A：补做被延后的"氛围 + 场景烘焙"
 * ------------------------------------------------------------
 * 必须在离开标题页之后调用：用既有场景遮罩（#sceneFade）盖住这段同步开销，
 * 玩家看到的是"一次过渡"，而不是"点完没反应"。
 * @param {number} [duration] 遮罩单程时长（秒），默认 0.30（总时长 ≈ 0.31s）
 * @returns {boolean} 本次是否真的执行了烘焙（无待办时返回 false）
 */
function flushPendingSceneBake(duration) {
  if (!state || !state.sceneBakePending) return false;
  state.sceneBakePending = false;
  const d = clamp(Number(duration) || 0.30, 0.10, 1.4);
  playSceneFade(d, 'boot-bake', () => {
    /* 黑场最高点：此时玩家什么也看不到，同步烘焙被完全遮住 */
    setTitleVisible(false);
    state.atmosphere = buildAtmosphere();
    bakeScene();
  });
  return true;
}
```

### A-3 `startGame()` 调用（原 `setTitleVisible(false);` 处）
```js
/* v1.7.1-A：标题阶段跳过的烘焙在这里补做；有遮罩时标题也到黑场再收起 */
if (!flushPendingSceneBake(0.30)) setTitleVisible(false);
updateTitleStats();
```

### A-4 `createInitialState()` 默认值
- `parallax: null` → 与 `bakeScene` 同形的空对象（`enabled:false / theme:'' / layers:[] / holes:{rooms:0,corridors:0,hidden:0,total:0,rects:[]} / apron:null / apronPatch:null / depth:null / drawMs:0 / drawMsAvg:0 / clipMs:0`）；
- `sceneProps: { lights: [], debris: [] }` → 补齐 `fans/steam/belts/drips/warm` 七个数组；
- 新增 `sceneArt: { themeId: 'mech', floor: 0, rooms: {}, totals: { lights: 0, debris: 0, decor: 0 } }`；
- 新增 `sceneBakePending: false`。

### B-1 `setHudValue(element, text, animate)`
`animate === false` 时只写文本 + 清动画类，**不执行** `void element.offsetWidth`、不加重播类。

### B-2 `updateHUD(animate)`
内部 4 处 `setHudValue(...)` 全部把 `animate` 透传（hudFloor / hudEnemy / hudRecordText / minimapFloor）。

### B-3 启动期调用
`syncDifficultyButtons(); renderDeck(); updateHUD();` → `updateHUD(false);`（仅启动这一处）。

## 4. 验证口径
- 环境：Edge `headless=new`、每次全新 profile、CDP 直连、串行（无头并发上限 1）。
- 轮次：N ≥ 7，串行、同机、无并行会话，**取最小值**；每轮记录当时 msedge 进程数与 CPU。
- A 判据：init 内 `buildAtmosphere+bakeScene` 段 **≤5 ms**（目标值；烘焙已移出 init）。
- B 判据：init 内 `updateHUD` 段 **≤5 ms**（原 59.8 ms）。
- 另报两个体验数：① 导航开始 → 标题可见；② 点"开始探索" → 可走（`transitionLock` 释放 + 已烘焙 + 至少一帧已画）。
- 测不到写"未测"，不写"不可分辨"。

## 5. 验收表
| 项 | 判据 | 不通过时 |
|---|---|---|
| A init 段 | ≤5 ms（7 轮最小值） | 回退 A，只留 B |
| A 体验 | 标题提前出现；点开始 ≤ 过渡总时长（≈310 ms） | 加大 duration 或回退 |
| B updateHUD | ≤5 ms（7 轮最小值） | 回退 B |
| 锚点 | 53/53 命中 = 1 | 停止落地 |
| 功能 | 双击→标题可用；点开始→能走、地板可见、无报错 | 停止落地 |
