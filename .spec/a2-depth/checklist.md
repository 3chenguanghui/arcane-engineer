# A2 远景与纵深 · 验收检查单（checklist）

> 逐条核对 `spec.md` 的可验收项；每条都必须用代码 / 截图 / 测试结果作为证据。

## 一、配置与结构

- [x] `PARALLAX_CONFIG` 已插入 `SCENE_ART_CONFIG` 之后，含 `layers(3) / holePad / corridorPad / apron / depth`，且不参与任何玩法计算
- [x] `state.parallax` 在 `bakeScene()` 初始化、运行时逐帧更新（layers / holes / apron / depth / drawMs）
- [x] `render()` 在 `drawFog()` 之后调用 `drawVoidDepth()` 与 `drawVoidApron()`，迷雾与 HUD 顺序不变

## 二、视差三层

- [x] 三层贴片各自程序化烘焙、可无缝平铺（无明显接缝）
- [x] `factor = 0.16 / 0.38 / 0.66`，相机移动 220px 后三层 `offsetX` 差值严格递增且相邻差 ≥ 30px
- [x] 远近亮度梯度：`far < mid < near`（far 与 near 差 ≥ 4）
- [x] 三层配色与主题一致（mech 蓝 / rune 紫 / void 青）
- [x] 视差只出现在房间与走廊之外的远景带（挖洞），房间内像素不变

## 三、地面延伸

- [x] 每个房间 / 走廊都有延伸带（`apron.rooms === rooms.length`）
- [x] 宽度 120px、四边渐变 + 角补无硬边，1x 下能看到碎石/断管/霜痕层次
- [x] 不透明度向外单调衰减：`apronAlphaSample(16) - apronAlphaSample(108) ≥ 25`
- [x] 延伸带压在视差层之上、房间内容之下无覆盖（只画在房间外）

## 四、景深

- [x] 尘埃 3 档（尺寸 / 透明度差异可见），档位由生成时写入
- [x] 悬浮碎片 3 档（只改尺寸与描边 alpha）
- [x] 掉落物按屏幕纵向 3 档，尺寸/透明度变化 ≤ ±6%，拾取半径与判定期完全不变

## 五、不遮挡

- [x] `coverage` 中 rooms / corridors / hiddenRoom / player / pickups / stairs / doors / rift 全为 `true`
- [x] 秘藏房暗门裂纹区域在洞内（暗门提示不被远景盖住）
- [x] 战斗房 ：敌人、弹幕、门、预警圈均不被远景覆盖（截图 + holes 断言）

## 六、性能

- [x] `avgFps ≥ 60`（记录 avg/min/avgFrameMs/maxFrameMs）
- [x] 视差每帧成本 `drawMsAvg ≤ 3.5ms`
- [x] `scenePatch` 只贴镜头附近一块（宽高 < 视口 + 48）
- [x] 迷雾画布逻辑未改，`fog.seenRooms ≥ 1`
- [x] `errors()` 为空

## 七、截图

- [x] `a2-before-f{1,2,3}-{battle,edge}.png` 6 张均 > 10KB
- [x] `a2-after-f{1,2,3}-{battle,edge}.png` 6 张均 > 10KB
- [x] before/after 同机位、同缩放（1440×900 dsf 1；battle = 房心，edge = 左墙内侧 70px）

## 八、回归与文档

- [x] 核心回归 15 套全绿：verify / flow3 / p1a_ui / facing / fusion / m12 / m13 / m18 / m19 / m20 / m21 / m22 / m23 / m24 / m25
- [x] `PROGRESS.md` 新增 A2 条目（改动点 / fps / 断言 / 回归 / 残留风险）
- [x] `奥术工程师_完整范围与验收清单.md` 勾选 A2
- [x] `.spec/a1-art/tasks.md` 勾选 A1-10；`.spec/a2-depth/tasks.md` 全部勾选
