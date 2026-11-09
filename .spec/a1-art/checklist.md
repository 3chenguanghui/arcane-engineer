# A1 场景材质与光照 · 验收检查单（checklist）

> 逐条核对 `spec.md` 的可验收项；每条都必须用代码 / 截图 / 测试结果作为证据。

## 一、配置与结构

- [x] `SCENE_ART_CONFIG` 已插入 `THEME_CONFIG` 之后，含 `roomDensity / volumetricAlpha / vignette / lantern`，且不参与任何玩法计算
- [x] `bakeScene()` 房间循环按 spec §3.3 顺序调用（地面细节 → 主光 → 暗角 → 墙体 → 柱子 → 主题道具 → 房型装饰 → 机械层 → 壁灯/光柱 → 四角）
- [x] `state.sceneArt` 在烘焙末尾汇总 `totals`

## 二、三层材质（1x 可分辨）

- [x] 机械层：拉丝金属 / 焊缝铆钉 / 锈斑油污 / 熔橙壁灯 / 管道反光，`sig.metal+weld+rust > 0`
- [x] 符文层：石质错缝 / 风化苔痕 / 紫青蚀刻 / 冷青光柱 + 光尘，`sig.stone+runeEtch > 0`
- [x] 虚空层：低温靛青 / 霜痕 / 发光裂隙 / 焦痕 / 漂浮碎屑，`sig.cold+rift+frost > 0`
- [x] 地面砖缝、磨损、污渍、接缝高光在 1x 截图里可见（不是纯色块）

## 三、光照

- [x] 每房 `ringLum[0] - edgeLum ≥ 10`（中心明显亮于边缘）
- [x] 环带亮度由内向外单调不增（容差 2）
- [x] 壁灯（mech）/ 符文带（rune）/ 墙面裂隙（void）有局部光源，并推入 `sceneProps.lights`
- [x] 体积光柱存在且 `alpha ≤ volumetricAlpha`
- [x] 玩家提灯为双层 + 轻抖动，半径/透明度取 `SCENE_ART_CONFIG.lantern`

## 四、房型装饰密度

- [x] battle > elite > vault > chest > rest 的 `typeDecor` 排序成立（仅比较存在的房型）
- [x] `flags.battle / elite / boss / chest / vault` 与房型一致
- [x] chest 有箱台 + 金色光柱；boss 有巨构（齿轮弧 / 符文环 / 裂隙光环）
- [x] event 房 `typeDecor === 0`（留白，符合"待后续"）
- [x] 秘藏房金色裂纹可见（≤12 次描边，不改奖励 / 暗门判定）

## 五、性能

- [x] `avgFps ≥ 60`（实测记录 avg/min/avgFrameMs/maxFrameMs）
- [x] `scenePatch` 只贴镜头附近一块（宽高 < 视口 + 48）
- [x] 迷雾画布逻辑未改，`fog.seenRooms ≥ 1`
- [x] `errors()` 为空

## 六、截图

- [x] `before-f{1,2,3}-{battle,room}.png` 6 张均 > 10KB
- [x] `after-f{1,2,3}-{battle,room}.png` 6 张均 > 10KB
- [x] before/after 同机位、同缩放（1440×900 dsf 1，房间中心裁切 560×420）

## 七、回归

- [x] 核心回归 14 套全绿：verify / flow3 / p1a_ui / facing / fusion / m12 / m13 / m18 / m19 / m20 / m21 / m22 / m23 / m24
- [x] m25（Boss）全绿
- [x] 隐藏房暗门回归 bug 已修：`createHiddenRoom` 在 `state.doors` 之后调用，暗门不再压门洞（m21 连跑 3 次 40/40）

## 八、文档收口

- [x] `PROGRESS.md` 新增 A1 条目（改动点 / fps / 断言 / 回归 / 残留风险）
- [x] `奥术工程师_完整范围与验收清单.md` 勾选 A1
- [x] `.spec/a1-art/tasks.md` A1-0…A1-9 全部勾选
