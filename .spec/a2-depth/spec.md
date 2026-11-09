# A2 远景与纵深 · 规格说明（spec）

> 所属：美术质感专项（ART_PLAN.md 第 A2 单元）
> 目标文件：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`（单文件，零依赖）
> 约束：全部纹理程序化、不得下载图片；**不改玩法数值、碰撞判定、生成参数、Boss 数值、奖励概率、迷雾逻辑**。

## 1. 目标（可验收）

1. **视差 3 层**：远塔剪影 / 桁架 / 雾中平台，随相机位移产生 ≥ 3 档位移差（`factor 0.16 / 0.38 / 0.66`）。
2. **地面延伸衰减**：房间地面向墙外延伸约 120px 并由实到虚淡出（不是"地板一刀切"）。
3. **景深**：尘埃 / 悬浮碎片 / 掉落物按 3 档（尺寸 + 透明度 + 光晕软化）区分远近，不改变任何判定。
4. **不遮挡**：视差只出现在房间与走廊之外的"远景带"，房间内全部内容（角色 / 敌人 / 掉落物 / 楼梯 / 暗门 / 裂隙）零遮挡。
5. **性能**：迷雾画布与贴图裁剪不受影响；给出 avg/min fps 与每帧耗时；掉帧优先降视差/装饰强度，不降清晰度。
6. 交付 before/after 同机位同缩放截图；专项断言 + 15 套回归全绿；写 PROGRESS 与验收清单。

## 2. 现状（已确认）

- `render()`（L9276）：屏幕底色 `#050910` → `ctx.translate(-cam + shake)` → `drawScene()` 贴烘焙底图（只贴镜头附近一块，写 `state.scenePatch`）→ 世界层各绘制 → restore → `drawFog()` → `drawBossHud()` → `drawPixelFxScreen()` → `drawCrosshair()`。
- `sceneCanvas` 世界尺寸 3200×2300（`GAME_CONFIG.worldWidth/Height`），`sceneScale = clamp(dpr,1,1.5)`；`bakeScene()`（L9687）顺序为
  `paintWorldBase → (mech) paintMechSkyline → 房间外环 → 走廊 → 每房 10 步 → 地面裂纹 → totals → paintMapBorder`。
- `paintWorldBase` 把整张世界铺满（含房间之间的"空洞区"是工程网格），所以**世界贴图不透明**；任何画在世界贴图之下的东西都看不见。
- 迷雾（L9418 起）：世界尺寸离屏画布，未探索区域 `rgba(4,7,13,0.94)`，只在房间（`carveFogRect`，羽化 22）与走过的走廊（`carveFogCircle`）上擦洞；**房间之间的空洞区永远是 94% 黑**。
- 结论：远景必须在 `drawFog()` **之后** 绘制（否则被 94% 黑吃掉），并且必须把"房间 / 走廊 / 秘藏房"从视差层里挖掉，才谈得上"不遮挡"。
- `state.rooms[i]` 有 `x/y/w/h/cx/cy`；`state.corridorRects`、`state.walkRects`（含房间矩形与走廊矩形）；秘藏房 `state.hiddenRoom` 有 `x/y/w/h/gap/wall`。
- 房型键 `start / battle / elite / chest / event / rest / vault / boss`；三层主题 `mech / rune / void`（`THEME_CONFIG`，含 `light / accent / dust / floorBase / floorAlt`）。
- `buildAtmosphere()`（L12424）生成 `dust`（每房 14 颗：`x/y/r/phase/speed`）与 `haze`；`drawAtmosphere()`（L12479）逐帧绘制尘埃 / 碎片 / 灯。
- 调试接口：`installDebugApi()`（L21187）；已有 `setFloor / setPlayerPos / getState / sceneAudit`。
- `rand() = Math.random()`；新增静态纹样一律用 `hash01()` 保证同层稳定。视差贴片按主题**只烘焙一次**，换层才重建。

## 3. 设计决定

### 3.1 新配置 `PARALLAX_CONFIG`（插在 `SCENE_ART_CONFIG` 之后，L3263 之后）

```js
const PARALLAX_CONFIG = {
  enabled: true,
  tileSize: 512,                 // 视差贴片边长（可平铺）
  layers: [
    { id: 'far',  factor: 0.16, alpha: 0.30, kind: 'towers'  },
    { id: 'mid',  factor: 0.38, alpha: 0.32, kind: 'truss'   },
    { id: 'near', factor: 0.66, alpha: 0.30, kind: 'platform' }
  ],
  holePad: 12,                   // 房间挖洞外扩（吸收墙体光晕/门框）
  corridorPad: 8,
  apron: { width: 120, alpha: 0.32, scale: 0.5 },   // 地面延伸带宽 / 起始不透明度 / 烘焙倍率
  depth: {
    dust:    [{ scale: 0.70, alpha: 0.55 }, { scale: 1.00, alpha: 0.80 }, { scale: 1.35, alpha: 1.00 }],
    debris:  [{ scale: 0.82, alpha: 0.55 }, { scale: 1.00, alpha: 0.80 }, { scale: 1.18, alpha: 1.00 }],
    pickup:  [{ scale: 0.94, alpha: 0.86 }, { scale: 1.00, alpha: 0.95 }, { scale: 1.04, alpha: 1.00 }]
  }
};
```

只影响观感，不参与任何玩法计算。`alpha` 为整层最大不透明度（三层叠加后远景带仍保持暗部可读）。

### 3.2 视差贴片烘焙 `ensureParallaxTiles(themeId)`

- 缓存 `parallaxCache = { themeId, tiles: [Canvas,Canvas,Canvas], sig: [{lum,rgb},…] }`；`themeId` 不变不重建（换层才重建，一次约 1–3ms）。
- 每层一张 `tileSize×tileSize` 的可平铺贴片（`parallaxCache.tiles[i]`），由 `paintParallaxTile(g, theme, layer)` 程序化绘制：
  - `far / towers`：剪影塔柱 / 烟囱 / 巨构轮廓（mech = 塔架与烟囱；rune = 悬浮符文尖塔；void = 虚空立柱），底部更暗、顶部有 `theme.accent` 微光；`alpha ≈ 0.5 × layer.alpha`，整体亮度最低。
  - `mid / truss`：桁架 / 拱肋 / 管道横梁（周期 128px 的斜撑 + 横梁），轮廓更高对比，`alpha ≈ 0.7 × layer.alpha`。
  - `near / platform`：雾中平台边缘 / 栏杆 / 踏板的近景剪影，底部 40% 变暗并带 `theme.dust` 雾化渐变，`alpha = layer.alpha`。
  - 所有随机量走 `hash01(layerIndex, i)`；贴片左右/上下各补画一次（±tileSize 偏移）保证接缝不可见。
  - 记录 `sig`：每层贴片的平均亮度与均色（供"三层可区分 / 远近亮度梯度"断言）。

### 3.3 地面延伸衰减 `paintVoidApron()` / `drawVoidApron()`

- 新增 `apronCanvas`（世界尺寸 × `apron.scale`，透明底；烘焙一次，约 1600×1150）。
- `paintVoidApron()` 在 `bakeScene()` 末尾（`paintMapBorder` 之前）调用：对每个房间 / 走廊 / 秘藏房，沿四条外边画"由实到虚"的延伸带：
  - 每条边一条 `width=120px` 的线性渐变带：`0 → apron.alpha`、`0.35 → α×0.42`、`1 → 0`；
  - 四个外角补径向渐变（`α×0.5 → 0`），避免直角拼接出现硬边；
  - 带内撒 3–5 个碎石 / 断管 / 霜痕小剪影（`hash01(room.id,i)`，alpha 0.10–0.18），保证 1x 下"延伸带也有层次"；
  - 带外沿描 1px 接缝高光（`theme.seam`，alpha 0.35）。
  - 统计写 `state.parallax.apron = { rooms, corridors, width, scale, bands }`。
- `drawVoidApron()` 每帧按相机裁剪贴一块（同 `drawScene` 的 `margin 24` 逻辑），写 `state.parallax.apronPatch = {w,h}`。
- 绘制位置：`drawFog()` 之后、世界坐标 translate 内（`ctx.translate(-cam.x+shakeX, -cam.y+shakeY)`），**在视差层之上** → "近处地面压住远处景物"，形成真实纵深。

### 3.4 每帧视差合成 `drawVoidDepth()`

- 计算"挖洞"矩形（屏幕空间，含 `shakeX/shakeY`）：
  - 每个房间 `x-cam.x+shakeX` 外扩 `holePad`；
  - 每条走廊外扩 `corridorPad`；
  - 秘藏房本体 + `gap` + `wall` 外扩 `holePad`（保护暗门裂纹提示）。
- 用**反向绕行**来挖洞：外层 `rect(-40,-40,viewW+80,viewH+80)` 顺时针，房间/走廊子路径逆时针（`moveTo → lineTo` 手动描反向）→ `ctx.clip()`（nonzero 规则下相消成洞）。若浏览器行为异常，回退方案见 §5。
- 三层绘制：`ctx.createPattern(tile,'repeat')` + `pattern.setTransform(DOMMatrix().translate(offsetX, offsetY))`，`offsetX = -(cam.x * factor) % tileSize`，`offsetY = -(cam.y * factor * 0.6) % tileSize`（纵向视差更弱，避免"背景在飘"），`globalAlpha = layer.alpha`，每层一次 `fillRect(视口)`。
- 统计：`state.parallax = { enabled, theme, layers:[{id,factor,alpha,offsetX,offsetY}], holes:{rooms,corridors,hidden,total}, clipMs, drawMs, drawMsAvg, apronPatch, apron, depth }`；`drawMs` 用 `performance.now()` 差，`drawMsAvg` 为 20 帧 EMA。
- 早退：`!enabled || !state.rooms.length || !parallaxCache.tiles.length` 直接返回。

### 3.5 `render()` 接线

```js
ctx.restore();

drawFog();                 // 迷雾（逻辑不变）

drawVoidDepth();           // A2：远景 3 层（屏幕空间，挖掉房间/走廊/秘藏房）
ctx.save();
ctx.translate(-state.cam.x + shakeX, -state.cam.y + shakeY);
drawVoidApron();           // A2：地面延伸带（世界空间，压在远景之上）
ctx.restore();

drawBossHud();
...
```

### 3.6 景深分档（只改观感）

- 尘埃（`buildAtmosphere` 生成时加 `tier: randInt(0,2)`，`drawAtmosphere` 绘制时按 `PARALLAX_CONFIG.depth.dust[tier]` 乘 `p.r` / `alpha`）。
- 悬浮碎片（`state.sceneProps.debris`）：按 `hash01(shard.x, shard.y)` 分 3 档，`size` 与描边 alpha 按 `depth.debris` 缩放。
- 掉落物（`drawPickups`）：按"屏幕纵向位置"分档（画面中线上方 = 远，下方 = 近）：`tier = dy < -0.25 ? 0 : dy > 0.25 ? 2 : 1`；只缩放宽高与 `globalAlpha`（`depth.pickup`），**不改拾取半径、不改 `life`、不改绘制顺序**。
- 统计写 `state.parallax.depth = { dustTiers:[a,b,c], pickupScale:[…], debrisScale:[…] }`（每帧刷新，供断言）。

### 3.7 验收接口（`installDebugApi`，L21187）

新增：

- `parallaxAudit()`：只读快照
  ```js
  {
    enabled, theme,
    layers: [{ id, factor, alpha, offsetX, offsetY, meanLum, meanRgb }],
    holes: { rooms, corridors, hidden, total, rects: [ {kind,x,y,w,h} ] },
    apron: { rooms, corridors, width, scale, bands, alphaNear, alphaFar },
    depth: { dustTiers, pickup, debris },
    cam, view, drawMs, drawMsAvg, clipMs,
    coverage: { rooms, corridors, hiddenRoom, player, pickups, stairs, doors, rift }  // 每项 true/false：是否被洞覆盖
  }
  ```
- `setParallaxEnabled(flag)`：仅用于 A/B 像素对照与性能排查，默认 `true`，**不写存档**。
- `apronAlphaSample(roomId, dist)`：从 `apronCanvas` 取"房间左边缘外 `dist` px"处的 alpha（0–255），供"衰减"断言。

### 3.8 状态字段

`freshState()` 增加 `parallax: null`；`bakeScene()` 开头初始化为
`{ enabled: PARALLAX_CONFIG.enabled, theme, layers: [], holes: {...}, apron: null, depth: null, drawMs: 0, drawMsAvg: 0 }`，烘焙末尾写 `apron`。

## 4. 截图与验收

### 4.1 新工具 `tools/arcane_a2.js`（端口 9481）

复用 `tools/arcane_a1.js` 的 Edge headless + CDP + WebSocket 骨架（同 1440×900、`deviceScaleFactor 1`）。

- `node tools/arcane_a2.js before`：仅截图（**A2 代码改动前先跑**）。
- `node tools/arcane_a2.js after`：截图 + 专项断言 + fps。

每层两个机位（`setFloor(f)` → 选战斗房：优先 `x >= 260 && x + w <= worldW - 260`，否则任意 battle/elite/首间）：

1. `battle`：`setPlayerPos(room.cx, room.cy)`，等 650ms，全屏截图。
2. `edge`：`setPlayerPos(room.x + 70, room.cy)`（相机随角色贴左墙），等 650ms，全屏截图 → 画面左侧露出远景带。

产物：`.screenshots/art/a2-{before|after}-f{1,2,3}-{battle,edge}.png`（共 12 张）。

### 4.2 fps / 每帧耗时

同 A1：按住 `d` 采样 150 帧，输出 `avgFps / minFps / avgFrameMs / maxFrameMs`，并读 `scenePatch`、`fog.seenRooms`、`parallax.drawMsAvg`、`errors()`。

### 4.3 专项断言（全部需 PASS）

1. **视差 3 层**：`layers.length === 3`；`factor` 与配置一致（±0.02）。
2. **≥3 档位移差**：玩家从房心沿 x 移动 220px，前后两次 `parallaxAudit()` 的 `offsetX` 差值绝对值按 `factor` 从小到大严格递增，且相邻两档差值 ≥ 30px（期望 ≈ 35 / 84 / 145 → 相邻差 49 / 61）。
3. **远近亮度梯度**：同主题三层的 `meanLum` 满足 `far < mid < near`（far 与 near 差 ≥ 4），证明"远层低对比"。
4. **三层可区分**：`theme` = `mech/rune/void` 与楼层对应；远层均色 R/G/B 与同层主题配色一致（`rune` 紫占优、`void` 青占优、`mech` 蓝占优，按 `meanRgb` 断言一层即可）。
5. **不遮挡可交互物**：`coverage.rooms / corridors / hiddenRoom / player / pickups / stairs / doors / rift` 全部为 `true`；`holes.total >= rooms + corridors + (hiddenRoom?1:0)`。
6. **地面延伸**：`apron.rooms === state.rooms.length`；`apron.width === 120`；对至少 5 间房，`apronAlphaSample(id, 16) - apronAlphaSample(id, 108) ≥ 25`（0–255）。
7. **景深**：`depth.dustTiers` 非零档位数量 = 3；`depth.pickup` 与 `depth.debris` 各 3 档。
8. **性能**：`avgFps ≥ 60`；`avgFrameMs ≤ 16.7`；`drawMsAvg ≤ 3.5`；`scenePatch.w/h ≤ 视口 + 48`；`fog.seenRooms ≥ 1`；`errors` 为空。
9. **截图**：12 张 before/after 均 > 10KB。

### 4.4 核心回归（15 套）

`arcane_verify / arcane_flow3 / arcane_p1a_ui / arcane_facing / arcane_fusion / arcane_m12 / arcane_m13 / arcane_m18 / arcane_m19 / arcane_m20 / arcane_m21 / arcane_m22 / arcane_m23 / arcane_m24 / arcane_m25`

每套前 `taskkill /F /IM msedge.exe /T`，按各自端口启动；要求全部 PASS、`errors` 为 0。

## 5. 性能红线与回退

1. 掉帧（`avgFps < 60`）：先降 `PARALLAX_CONFIG.layers[].alpha` ×0.75 → 再关 `near` 层 → 再降 `apron.alpha` / 宽度到 80 → 最后 `enabled=false`（视差整体关闭）。**禁止降 `sceneScale`、禁止减地砖细节**。
2. `drawMsAvg > 3.5`：先降 `tileSize` 到 384，再把 `haze` 之外的三层改成"每层一块整屏 fillRect"（当前已是），最后关 `near` 层。
3. 反向绕行挖洞若在 Edge 上失效（出现画面全黑/未挖洞）：改用离屏 `maskCanvas`（透明底 → 画白洞 → `destination-out` 房间矩形 → `drawVoidDepth` 以 `globalCompositeOperation='destination-in'` 应用），逻辑等价、成本 +1 次整屏合成，需重新测 fps。
4. 若专项断言 1 轮内无法修复：回退本轮备份文件并记录（备份在改动前创建 `index_arcane_v2.bak_20261103_a2.html`）。

## 6. 交付物清单

- `index_arcane_v2.html`：`PARALLAX_CONFIG`、`ensureParallaxTiles / paintParallaxTile / paintVoidApron / drawVoidApron / drawVoidDepth / depth 分档`、`render` 接线、`parallaxAudit / setParallaxEnabled / apronAlphaSample`。
- `tools/arcane_a2.js`：before/after 截图 + 专项断言 + fps。
- `.screenshots/art/`：12 张 A2 截图。
- `PROGRESS.md`：新增 A2 条目（改动点 / fps / 断言 / 回归 / 残留风险）。
- `奥术工程师_完整范围与验收清单.md`：勾选 A2。
- `.spec/a1-art/tasks.md`：勾选 A1-10（已进入 A2）。

## 7. 风险

- 视差画在迷雾之上：房间之间"远景带"不再是被 94% 黑覆盖的死黑，观感变化较大；但只出现在房间/走廊之外，且挖洞保证不遮挡玩法内容。迷雾画布与擦洞逻辑**一行不改**。
- `createPattern` + `DOMMatrix` 在 Edge 旧版本可能不可用 → 已备"逐块 drawImage 平铺"的等价实现（`workspaceDraw` 分支）。
- 机械层原有烘焙远景（`paintMechSkyline`）会被新视差层覆盖；保留代码不动（不删既有功能），只在其上叠加 A2 远景。
- 地面延伸带在迷雾之上，可能让"未探索房间"的轮廓提前露出一点地面光晕（只泄露"有地面"，不泄露房间类型/连接）。通过 `apron.alpha ≤ 0.32` 与 120px 宽度控制。
