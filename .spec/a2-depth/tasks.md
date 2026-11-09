# A2 远景与纵深 · 任务清单（tasks）

> 依据 `spec.md`。按顺序执行，A2-0 必须先于任何 HTML 改动（before 截图要用原始版本）。

| # | 任务 | 具体改动 | 验收 |
| --- | --- | --- | --- |
| [x] A2-0 | **before 截图** | 新建 `tools/arcane_a2.js`（端口 9481，复用 `arcane_a1.js` 骨架）；在 HTML 未改动时运行 `node tools/arcane_a2.js before` → `.screenshots/art/a2-before-f{1,2,3}-{battle,edge}.png` | 6 张 > 10KB；1440×900 dsf 1 |
| [x] A2-1 | 配置与状态 | `PARALLAX_CONFIG`（插在 `SCENE_ART_CONFIG` 之后，L3263 后）；`freshState()` 增 `parallax: null`；`bakeScene()` 开头初始化 `state.parallax` | `tools/arcane_syntax.js` 通过；`getState()` 不报错 |
| [x] A2-2 | 视差贴片 + 每帧合成 | `ensureParallaxTiles / paintParallaxTile / drawVoidDepth`（含反向绕行挖洞、pattern 平铺、`state.parallax` 统计）；`render()` 在 `drawFog()` 之后调用 `drawVoidDepth()` | `layers.length===3`；房间/走廊/秘藏房 `coverage=true`；远景带可见 |
| [x] A2-3 | 地面延伸 | `paintVoidApron()`（`apronCanvas` 0.5 倍烘焙，四条边渐变 + 角补 + 碎石剪影 + 接缝高光）；`drawVoidApron()`（世界坐标裁剪贴图）；`bakeScene()` 末尾调用 | `apron.rooms === rooms.length`；`apronAlphaSample(16) - apronAlphaSample(108) ≥ 25` |
| [x] A2-4 | 景深分档 | 尘埃加 `tier` 并在 `drawAtmosphere` 按 `depth.dust` 缩放；`debris` 按 hash 分档；`drawPickups` 按屏幕纵向分 3 档（只改尺寸/alpha） | `depth.dustTiers` 三档非零；拾取物可读、拾取半径不变 |
| [x] A2-5 | 验收接口 | `parallaxAudit()`（layers / holes / apron / depth / coverage / drawMs）+ `setParallaxEnabled()` + `apronAlphaSample()`；`getState()` 增 `parallax` 摘要 | `tools/arcane_a2.js after` 断言全 PASS |
| [x] A2-6 | after 截图 + 专项 | `node tools/arcane_a2.js after` → 6 张 after + 断言（§4.3）+ fps / 每帧耗时 | 专项全 PASS；`avgFps ≥ 60`；`drawMsAvg ≤ 3.5`；errors 0 |
| [x] A2-7 | 核心回归 | 15 套，每套前 `taskkill /F /IM msedge.exe /T` | 全部 PASS、errors 0（m21 连跑 3 次 40/40） |
| [x] A2-8 | 文档收口 | `PROGRESS.md` 新增 A2 条目；验收清单勾选 A2；`.spec/a1-art/tasks.md` 勾 A1-10；本文件全勾 | 条目含 fps / 断言 / 回归 / 风险 |

## 回退点

- 改动前备份：`index_arcane_v2.bak_20261103_a2.html`（同目录）。
- 掉帧顺序：`layers[].alpha ×0.75` → 关 `near` 层 → `apron.alpha` / 宽度 80 → `enabled=false`；禁止降 `sceneScale`。
- 挖洞失效：改用离屏 mask + `destination-in`（spec §5.3）。

## 依赖

- A2-1 → A2-2 → A2-3 → A2-4 → A2-5 串行（同一区域同一文件）。
- A2-0 必须在 A2-1 之前；A2-6 依赖 A2-1…A2-5。
