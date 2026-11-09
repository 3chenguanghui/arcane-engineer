# A1 场景材质与光照 · 任务清单（tasks）

> 依据 `spec.md`。按顺序执行，每个任务完成即更新状态；A1-0 必须先于任何代码改动。

| # | 任务 | 具体改动 | 验收 |
| --- | --- | --- | --- |
| [x] A1-0 | **before 截图** | 新建 `tools/arcane_a1.js`（端口 9480）；`setFloor(1/2/3)` → 战斗房中心 → 全屏 + 560×420 特写 → `.screenshots/art/before-f{1,2,3}-{battle,room}.png` | 6 张 > 10KB；同机位同缩放 |
| [x] A1-1 | 配置 | `THEME_CONFIG`（L3234）之后插入 `SCENE_ART_CONFIG`（roomDensity / volumetricAlpha / vignette / lantern） | `arcane_syntax` 通过 |
| [x] A1-2 | 三层地面材质 | `paintThemeFloorDetail` + `drawEtchGlyph` + `strokePolyline`，插在 `paintThemeProps` 结束处（约 L10714）之前 | 三层 `sig` 各自 > 0；1x 截图可见砖缝/磨损/污渍/高光 |
| [x] A1-3 | 光照 | `paintRoomVignette`、`paintRoomLightProps`（壁灯/符文带/裂隙 + 体积光柱）；`bakeScene` 调用顺序更新；`drawAtmosphere` 扩展 lamp/rift 光晕 + 提灯抖动 | 每房 `centerLum - edgeLum ≥ 10`；环带递减 |
| [x] A1-4 | 房型装饰 | `paintRoomTypeDecor`：battle 碎石/刹车痕、elite 猩红警戒纹、boss 巨构、chest 箱台+光柱、vault 金裂、rest/start 极简、event 留白 | `typeDecor` 排序 battle≥elite≥vault≥chest≥rest；`flags` 对应为真 |
| [x] A1-5 | 秘藏金裂 | `drawHiddenRoom()`（L6518）进入分支追加金色裂纹 + 金晕（≤12 次描边，无每帧数组） | 进房后可见；不改暗门/奖励判定 |
| [x] A1-6 | 验收接口 | `sceneAuditSnapshot()` + `__roamDebug.sceneAudit()`：读 `sceneArt` + `sceneCanvas` 像素抽样（中心/边缘/环带/暖紫青占比） | 返回结构符合 spec §3.6 |
| [x] A1-7 | after 截图 + 专项 | `node tools/arcane_a1.js after`：6 张 after + 断言 + fps/帧耗时 | 专项断言全 PASS；avgFps ≥ 60；scenePatch 裁剪生效；errors 0 |
| [x] A1-8 | 核心回归 | 14 套 + m25，每套前 `taskkill /F /IM msedge.exe /T` | 全部 PASS、errors 0（m21 连跑 3 次 40/40） |
| [x] A1-9 | 文档收口 | `PROGRESS.md` 新增 A1 条目；验收清单勾选 A1 | 条目含 fps / 断言 / 回归 / 风险 |
| [x] A1-10 | 进入 A2 | 远景与纵深（视差 3 层 / 地面延伸 / 景深） | 不等待，继续 |

## 回退点

- 改动前备份：`index_arcane_v2.bak_20261103_m15.html`（同目录）。
- 若 fps < 60：先降 `roomDensity` ×0.6 → 再降 `volumetricAlpha` 0.04 → 最后关光柱；禁止降 `sceneScale`。
