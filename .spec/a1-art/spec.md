# A1 场景材质与光照 · 规格说明（spec）

> 所属：美术质感专项（ART_PLAN.md 第 A1 单元）
> 目标文件：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`（单文件，零依赖）
> 约束：全部纹理程序化；不得下载图片；**不改玩法数值、碰撞判定、生成参数、Boss 数值、奖励概率**。

## 1. 目标（可验收）

1. 三层材质在 1x 缩放下可区分，且地面能看出砖缝 / 磨损 / 污渍 / 接缝高光的层次（不是色块）。
   - 机械：拉丝金属 + 焊缝铆钉 + 锈斑油污 + 熔橙壁灯 + 管道反光。
   - 符文：石块错缝 + 风化苔痕 + 紫青符文蚀刻 + 冷青顶光 + 光尘。
   - 虚空：低温靛青洗色 + 霜痕 + 发光裂隙 + 焦痕 + 漂浮碎屑。
2. 光照层次：房间主光（已有）+ 边缘暗角（新）+ 壁灯/符文/裂隙局部光源（新）+ 轻量体积光柱（新）+ 玩家提灯式环境光（增强）。
3. 房型装饰密度差异化：战斗（管道/碎石）> 精英（猩红警戒纹）> 秘藏（金色裂纹）> 宝箱（箱台/光柱）> 休整（极简）；首领房（巨型机械 / 符文环）；事件房留白待后续。
4. 性能：贴图裁剪（`drawScene` 的 `scenePatch`）与迷雾（`fogCanvas`）不受影响；给出 avg/min fps 与每帧耗时；低于 60fps 时优先降装饰密度，不降清晰度。
5. 交付 before/after 同机位同缩放截图；专项断言 + 核心回归 14 套 + m25 Boss 全绿；写 PROGRESS 与验收清单。

## 2. 现状（已确认）

- 静态烘焙入口：`bakeScene()`（L9618）；房间循环 L9651–9662，顺序为
  `paintRoomFloor → paintRoomLight → paintWallStructure → paintPillars → paintThemeProps → paintMechRoomLayer(仅mech) → paintRoomCorners`。
- `paintRoomFloor`（L10122）已含 64px 地砖、砖缝、接缝高光、划痕、裂缝、噪点、污渍、四边内缩暗边、斜向反光带。
- `paintRoomLight`（L10302）已有房间主光 + 一处壁灯余光；`paintWallStructure` L10342；`paintPillars` L10434；`paintRoomCorners` L10472。
- `paintThemeProps`（L10503–10713）三层装饰，已向 `state.sceneProps.lights` 推 `pipe/rune/shard`。
- 动态层：`drawAtmosphere()`（L11572）已有悬浮雾团、玩家提灯光晕（L11614–11623，半径 128 / alpha 0.13）、能量管线、装饰灯（`glowR/glowA` 表 L11644–11645）、漂浮碎片、尘埃；机械层另有 `drawMechProps`。
- `drawScene()`（L9308）只贴镜头附近一块并写 `state.scenePatch`；迷雾为世界空间累积擦洞，二者不得改动逻辑。
- 房型键：`start / battle / elite / chest / event / rest / vault / boss`（`ROOM_TYPE_CONFIG.types`，L4012）。**宝箱房间 type 是 `chest`（不是 treasure）**。
- 秘藏房是 `state.hiddenRoom`（id 900），不在 `state.rooms` 内，本体由 `drawHiddenRoom()`（L6518）运行时绘制，烘焙管线覆盖不到。
- 调试接口：`installDebugApi()`（L20148）；已有 `getState()` / `setFloor()` / `setPlayerPos()` / `snapCamera()`（`setPlayerPos` 内部已 snap）。
- `rand()` 是 `Math.random()`（非种子）；新增装饰一律用 `hash01()` 保证同房间每次烘焙一致，避免闪变。

## 3. 设计决定

### 3.1 新配置 `SCENE_ART_CONFIG`（插在 `THEME_CONFIG` 之后，L3234 之后）

字段：

```js
{
  enabled: true,
  roomDensity: { battle:1.0, elite:0.9, boss:1.0, vault:0.62, chest:0.55, event:0.38, rest:0.3, start:0.26 },
  volumetricAlpha: 0.085,   // 体积光柱最大不透明度（"轻量"）
  vignette: 0.42,           // 边缘暗角强度
  lantern: { radius: 168, core: 0.17, flicker: 0.03 }
}
```

只影响观感，不参与任何玩法计算。

### 3.2 新增烘焙函数（插在 `paintThemeProps` 结束、`机械层专属场景` 注释之前，约 L10714）

全部只写 `sceneCanvas` 与 `state.sceneProps / state.sceneArt`，不碰实体数组。

| 函数 | 作用 |
| --- | --- |
| `getSceneArtRoom(room)` | 创建/取回房间美术签名（`sig / typeDecor / flags / lights`），供验收读取 |
| `paintThemeFloorDetail(g, room, theme)` | 三层地面材质细节（机械拉丝/焊缝/铆钉/锈斑/油污；符文字石缝/风化/苔痕/蚀刻；虚空冷洗/霜痕/裂隙/焦痕） |
| `drawEtchGlyph(g,x,y,size,color,alpha,seed)` | 小符文刻痕（三笔几何 + 细环），符文层复用 |
| `strokePolyline(g, pts, color, width)` | 折线描边小工具（裂隙/焊缝共用） |
| `paintRoomVignette(g, room)` | 房间边缘暗角（中心透明 → 边缘压暗 + 四角额外压暗） |
| `paintRoomLightProps(g, room, theme, index)` | 壁灯（mech 熔橙）/ 符文带 + 冷青顶光（rune）/ 墙面裂隙漏光（void）+ 体积光柱；推 `lamp/rune/rift` 光源到 `sceneProps.lights` |
| `paintRoomTypeDecor(g, room, theme, index)` | 按房型装饰：battle 碎石/管道 + 刹车痕；elite 猩红警戒纹带 + 警示三角；boss 巨型齿轮/符文环/裂隙光环；chest 箱台 + 金色光柱；vault 金色裂纹；rest/start 极简；event 留白 |

### 3.3 `bakeScene()` 改动（L9618）

- `state.sceneProps` 初始化后新增 `state.sceneArt = { themeId, floor, rooms: {}, totals }`。
- 房间循环顺序改为：

```js
paintRoomFloor
paintThemeFloorDetail       // 新
paintRoomLight
paintRoomVignette           // 新
paintWallStructure
paintPillars
paintThemeProps
paintRoomTypeDecor          // 新
paintMechRoomLayer (仅 mech)
paintRoomLightProps         // 新（壁灯/光柱压在装饰之上，但不挡角色）
paintRoomCorners
```

- `bakeScene()` 末尾汇总 `sceneArt.totals = { lights: sceneProps.lights.length, debris: ..., decor: ... }`。

### 3.4 运行时改动（`drawAtmosphere`，L11572）

1. 装饰灯表扩展：`glowR` 增 `lamp: 64 / rift: 52`，`glowA` 增 `lamp: 0.32 / rift: 0.26`；`makeGlow` 按 kind 选色（`lamp` 固定暖橙 `255,138,61`，`rift` 青 `120,240,214`，其余主题 accent）。
2. 玩家提灯增强：半径取 `SCENE_ART_CONFIG.lantern.radius`，叠加 `sin(t*7.3)` + `sin(t*13.1)` 轻抖动，主光晕 + 26px 灯芯两层；每帧仅 2 个渐变（不新增数组）。
3. 其余动态元素保持不变；机械层 `drawMechProps` 不动。

### 3.5 秘藏房（隐藏房）金色裂纹

`drawHiddenRoom()`（L6518）在进入后（`h.revealed && 玩家在房内` 分支）追加金色裂纹与金色地面光晕（静态参数用 `hash01(seed)`，不新增每帧数组；不超过 ~12 次描边）。
只加视觉，不改 `rewarded / 暗门判定`。

### 3.6 验收接口（`installDebugApi`，L20148）

新增 `sceneAudit()`：

- 读取 `state.sceneArt`（每房 `type / typeDecor / lights / sig / flags`）。
- 用 `sceneCanvas.getContext('2d').getImageData` 抽样（坐标乘 `sceneScale`）：
  - 每房 `centerLum`（房间中心 64×64）、`edgeLum`（四角 24×24 均值）、`delta = center - edge`；
  - 环带亮度（0.3 / 0.6 / 0.9 半径）用于"由中心向外递减"；
  - 暖/紫/青像素占比（`r>b+10`、`b>g+10&&r>g+4`、`g>r+12&&b>r+12`），用于"三层可区分"。
- 返回 `{ theme, floor, sceneScale, rooms:[...], totals:{...} }`。
- 只读，不改状态。

## 4. 截图与验收

### 4.1 新工具 `tools/arcane_a1.js`（端口 9480）

复用 m25 的 Edge headless + CDP + WebSocket 骨架；`Emulation.setDeviceMetricsOverride({1440×900, dsf:1})`（1x 清晰度验收）。

模式：

- `node tools/arcane_a1.js before`：仅截图（不改代码前运行）
- `node tools/arcane_a1.js after`：截图 + 专项断言 + fps

同机位规则：`setFloor(f)` → 取该层 `type==='battle'`（无则 `elite`，再退 `rooms[0]`）→ `setPlayerPos(room.cx, room.cy)`（内部 snap）→ 等 600ms → 截全屏 + 以房间中心为原点裁 560×420 特写（坐标 = 世界坐标 − `cam`）。

产物：`.screenshots/art/{before|after}-f{1,2,3}-battle.png` 与 `-room.png`。

### 4.2 fps / 每帧耗时

在 `after` 模式：按住 `d` 移动 3s，同时用 `requestAnimationFrame` 采样 ≥120 帧，输出 `avgFps / minFps / avgFrameMs / maxFrameMs`，并同时读 `getState().drawStats`、`scenePatch`（证明裁剪仍生效、迷雾未改）。

### 4.3 专项断言（全部需 PASS）

1. 三层可区分：`floor 1/2/3` 的 `theme` 分别为 `mech/rune/void`；每层战斗房 `sig` 对应键 > 0（mech：`metal+weld+rust`；rune：`stone+runeEtch`；void：`cold+rift+frost`）；且该层主导色占比 > 另两层（warm / violet / cyan）。
2. 亮度层次：每房 `centerLum - edgeLum ≥ 10`；环带亮度自中心向外单调不增（允许 2 的噪声容差）。
3. 装饰密度差异：同层房间 `typeDecor` 满足 battle ≥ elite ≥ vault ≥ chest ≥ rest（实际同层不一定齐全，按存在项比较）；且 `battle` 房 `flags.battle=true`、`elite` 房 `flags.elite=true`、`boss` 房 `flags.boss=true`、`chest` 房 `flags.chest=true`。
4. 房型专属：boss 房 `typeDecor > 0`；chest 房有 `flags.chest`；elite 房有 `flags.elite`；vault（若生成）有金色裂纹标记；event 房 `typeDecor === 0`（留白，符合"待后续"）。
5. 性能：`avgFps ≥ 60`；`state.scenePatch.w/h` 均 < 视口 + 48（证明只贴一块）；`fog.seenRooms` 正常；`errors()` 为空。
6. 截图存在：`before/after` 各 6 张文件均 > 10KB。

### 4.4 核心回归（14 套 + m25）

`arcane_verify / arcane_flow3 / arcane_p1a_ui / arcane_facing / arcane_fusion / arcane_m12 / arcane_m13 / arcane_m18 / arcane_m19 / arcane_m20 / arcane_m21 / arcane_m22 / arcane_m23 / arcane_m24 / arcane_m25`

每套运行前 `taskkill /F /IM msedge.exe /T`，按各自端口启动；要求全部 PASS 且 `errors` 为 0。

## 5. 性能红线与回退

1. 任何改动后 `avgFps < 60`：先降 `SCENE_ART_CONFIG.roomDensity`（整体 ×0.6），再降 `volumetricAlpha` 到 0.04，最后关 `paintRoomLightProps` 的光柱；
2. 不允许降 `sceneScale`、不允许减少地砖/砖缝细节（清晰度红线）；
3. 若专项断言失败且无法在 1 轮内修复，回退到本轮开始前备份 `index_arcane_v2.bak_20261103_m15.html`（同目录）并记录。

## 6. 交付物清单

- `index_arcane_v2.html`：上述所有改动。
- `tools/arcane_a1.js`：截图（before/after）+ 专项断言 + fps。
- `.screenshots/art/`：12 张截图。
- `PROGRESS.md`：新增 A1 条目（改动点 / fps / 断言结果 / 回归结果 / 残留风险）。
- `奥术工程师_完整范围与验收清单.md`：勾选 A1 条目。
- 完成后进入 A2（远景与纵深 / 视差层），不等待。

## 7. 风险

- `bakeScene` 增补绘制会增加换层烘焙时间（一次性，目标 < 120ms 增量）；已通过"全部静态、无每帧新数组"控制运行时成本。
- 新增 `sceneProps.lights` 数量变多：`drawAtmosphere` 已有视野裁剪与渐变缓存，预计每帧多 ≤ 6 个光晕绘制。
- 隐藏房金色裂纹在运行时绘制，需限制描边次数（≤ 12）并只在该房已进入时执行。
