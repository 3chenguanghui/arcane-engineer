# U6 · 房型光照情绪分级

> 出处：`.spec/round4-5-merge.md` 条目 **A3**（R4 §1.3，唯一出处）。
> 现状：`paintRoomLight()` 只读 `theme.light` + `index % 3` 的轻微差异，**同一层里战斗房 / 精英房 / 宝箱房 / 休整房的光是一模一样的**。
> 判定：部分成立（氛围可感知，但不是玩法根因）；接入点明确、成本低，因此先做。

---

## 1. 根因（一句话）

**光照只表达"这一层是机械/符文/虚空"，没有表达"这一间是危险房还是安全房"**：
玩家隔着两间房看不出"再往前是精英房"，只能靠小地图图标读信息，场景本身不参与叙事。

## 2. 改法

1. 新增 `ROOM_LIGHT_MOODS`（数据表，8 种房型各一条）：
   | 房型 | 主光色 | coreAlpha | radiusMul | 整间薄染 tint | 暗角倍数 |
   |---|---|---|---|---|---|
   | start | 薄荷绿 | 0.29 | 1.04 | 0.06 | 0.90 |
   | battle | **沿用楼层主题** | 0.24 | 1.00 | 0 | 1.00 |
   | elite | 猩红 | 0.34 | 0.92 | 0.10 | 1.35 |
   | boss | 深红 | 0.38 | 0.86 | 0.12 | 1.50 |
   | chest | 金 | 0.36 | 0.90 | 0.10 | 1.05 |
   | vault | 淡金 | 0.38 | 0.88 | 0.10 | 1.10 |
   | rest | 暖橙 | 0.30 | 1.06 | 0.09 | 0.85 |
   | event | 紫 | 0.30 | 0.98 | 0.08 | 1.25 |
2. `roomLightMood(room, theme)`：把"房型 → 情绪"收成一次查询；`battle` 的 `color/accent` 为 `null` 表示沿用主题，**保住 A1 的三层色温区分**。
3. `paintRoomLight()` 改为读 mood：整间薄染（`tint`）+ 主光色 / 核心强度 / 半径系数 / 壁灯色（mood 房型壁灯 0.30 vs 主题 0.17）。
4. `paintRoomVignette()` 用 mood 的**倍数**缩放整条暗角曲线（1.0 = 原值，封顶 0.55）→ 高危房更压抑、休整房更平。用倍数而不是加法：加法会顶到上限后失去区分。
5. `state.roomMoodV1` A/B 开关 + `__roamDebug.setRoomMood()`（关闭后重新烘焙即为 before 口径）。
6. `__roamDebug.setRoomMood / roomLightAudit` 两个验收入口；截图沿用 A1 的"同机位裁剪"口径（`Page.captureScreenshot` + clip），A/B 两张相机位置完全一致。

## 3. 保留约束

- 不改 `theme.light` / `theme.accent` 的取值；`battle` 完全继承主题（A1 的三层色温断言不受影响）。
- 不改房间生成、房型权重、清房/落闸逻辑；纯烘焙期（`bakeScene()`）表现变化，**运行时零额外开销**。
- 不改 `SCENE_ART_CONFIG.vignette` 原值，只在叠加时相加并封顶。
- 不改小地图图标颜色（房型色仍在 `ROOM_TYPE_CONFIG.types[x].color`）。
- 单文件零依赖、无图片。

## 4. 验收断言（`tools/arcane_u6.js`，端口 9493）

| # | 断言 | 口径 |
|---|---|---|
| 1 | 配置覆盖 | `ROOM_TYPE_CONFIG.types` 的 8 种房型在 `ROOM_LIGHT_MOODS` 里都有条目 |
| 2 | 主光色互异 | 有主光色的 7 种情绪两两 RGB 欧氏距离 ≥ 18 |
| 3 | 分级方向 | elite/boss 的 `coreAlpha > battle` 且 `radiusMul < battle` 且 `vignette > battle` |
| 4 | 色彩方向 | rest/chest/vault 的 `R > B`（暖）；battle 继承主题 → `B ≥ R`（冷） |
| 5 | 同层可辨（阈值） | 同一层内 elite 房与 battle 房的 `R/B` 比差值 ≥ 0.10 |
| 6 | 暖色占比 | 同一层内 rest（或 chest）房 `warmRatio` > battle 房 `warmRatio` |
| 7 | 暗角倍数 | 数值级：elite/boss 的暗角倍数 > battle(=1.0)，rest(=0.85) 最平；不做像素级（主光色本身会提亮边缘，跨房型不可比） |
| 8 | A/B 关闭 | `setRoomMood(false)` 重新烘焙后，elite 与 battle 的 `R/B` 差 **< 0.10**（分级消失） |
| 9 | 截图 | 至少 3 种房型的底图导出 PNG 均 >10KB；A/B 两张同机位可对比 |
| 10 | 性能 | avg fps ≥ 60、运行时 errors 0 |
| 11 | 回归 | 14 套全绿 |

## 5. 设计取舍

- **D1 battle 继承主题**：如果给战斗房也固定一个颜色，A1 的三层色温（暖 / 紫 / 青）会被压平成一套蓝，等于用"房型分级"换掉"楼层分级"，不划算。
- **D2 用"颜色 + 半径 + 压暗"三个维度分级**：只改颜色容易在小尺寸缩放下糊在一起；半径与对比度是"退后一步也能看出"的维度。
- **D3 只在烘焙期生效**：`bakeScene()` 每层只跑一次，运行时没有逐帧成本，fps 不受影响。
- **D4 vault 用淡金而不是纯金**：秘藏房是"藏起来的金色"，需要和宝箱房（亮金、明示奖励）区分开，避免两种房型读成同一个。
