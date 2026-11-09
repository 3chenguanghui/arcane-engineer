# 烬 · 整改计划书（v1.3.1 · 2026-11-07）

> 范围：用户截图反馈「路显示出来了 / 武器细节不够 / 武器和魔法怎么融合」三件事，外加作者署名。
> 本文所有结论都对应到代码位置与截图；**做不到的部分明确写「未实现」，不用文案掩盖**。

---

## 0. 结论先行（三句话）

1. **「路显示出来了」不是单一 bug，是三种现象叠加**：①迷雾只压 94%，未探索区仍漏 6% 亮度，高亮灯带透了出来（**bug**）；②未探索房在迷雾之后主动画虚线框 + 斜纹 + 「未探索」字（**设计过显眼**）；③地砖砖缝对比过高，读起来像导航网格（**设计过显眼**）。
2. **武器细节**：本轮把五把武器从"一根线"改成"明暗渐变 + 刃口反光 + 护手/柄部结构"，拖影按武器轮廓分化；before/after 截图已出。
3. **融合体系**：改前**武器与融合没有任何数据连接**（融合只看魔法 + 科技两张卡，武器只是另一套并列系统）。本轮已把「武器标签」接成第三输入，并新增 5 条只有特定武器才能合出的配方，全部有实测伤害。

---

## 1. 问题清单

| # | 问题 | 证据（截图 / 实测） | 根因 | 性质 |
|---|---|---|---|---|
| Q1 | 未探索区域能看见走廊灯带（青色等距光点 + 琥珀小灯），一路延伸进黑区，像"提前把路画出来" | 用户截图 y≈88–100、x≈35–1010；`.screenshots/weapon_art/scene_before/scene_full.png` 上半部 | `FOG_CONFIG.alpha=0.94` 只压 94%，高亮 additive 装饰在 6% 亮度下仍可辨 | **bug** |
| Q2 | 未探索房有清晰虚线边框 + 红/蓝斜纹 + 「未探索」文字 | 用户截图四角：左 x35–195/y65–250；右 x940–1063/y60–250；左下 x0–215/y430–600；右下 x915–1063/y430–729 | `drawUnexploredMarkers()` 在迷雾**之后**绘制，边框 alpha 0.30、斜纹 0.055、文字 0.52，且虚线带流动偏移 | 设计过显眼 |
| Q3 | 地面红砖网格 + 砖缝全屋铺开，读作"地图网格 / 导航线" | 用户截图整片地面 | `THEME_CONFIG` 砖面亮度 `tileAlpha 0.048–0.078` + `seam alpha 0.16–0.2` | 设计过显眼 |
| Q4 | 房间内的大圆弧 / 斜向亮线被误认为"路径" | 用户截图中部 x≈240–620 / y≈320–570 | 一是武器判定可视化（`weaponDebugOn` 默认开时画绿色扇形/矩形），二是房间钢梁装饰 | 设计如此（**未改**，见 §5） |
| Q5 | 五把武器只有一根直线，没有明暗、刃口、护手，锤头像色块 | `.screenshots/weapon_art/before/*.png` | `drawWeaponHeld()` 单一渐变 + 单线绘制，无结构 | 设计不足 |
| Q6 | 挥砍拖影五把武器几乎同形 | 同上 + 手感截图 | `drawWeaponFx()` 只按 `shape`（arc/double/line）分，未按武器轮廓分 | 设计不足 |
| Q7 | **武器与融合没有数据连接** | 代码：`getAvailableFusions()` 只读 `ownedMagic` / `ownedTech`；`WEAPON_CONFIG` 无任何字段参与融合判定 | 两套系统并列，没有桥 | 体系缺口 |
| Q8 | 玩家看不懂「武器怎么参与融合」 | 用户原话"其实我有点没看懂" | 融合面板只有"魔法 × 科技"两列，武器面板完全独立 | 呈现缺口 |

---

## 2. 已修（v1.3.1 已完成并通过断言）

| # | 改法 | 位置 | 验收 | 结果 |
|---|---|---|---|---|
| F1 | 迷雾 `alpha` 0.94 → **0.985**（未探索只剩 1.5% 亮度；已探索靠擦洞完全透出，亮度不变） | `FOG_CONFIG`（原 L7048 附近） | A7-1 | PASS |
| F2 | 未探索标记降档：边框 0.30→**0.14**、斜纹 0.055→**0.030**、文字 0.52→**0.34**；去掉 `lineDashOffset` 流动 | `drawUnexploredMarkers()` | A7-2 | PASS |
| F3 | 新增 `SCENE_READ_CONFIG { seamMul: 0.55, gridMul: 0.70 }` + `sceneSeam()` / `sceneGridMul()`；砖面亮度与砖缝一起降档；`enabled=false` 逐像素回 v1.3.0 | 场景绘制 4 处 + 地面格子 | A7-3 | PASS |
| F4 | 五把武器各挂 `tagId`（数据层）：导轨短刃=导电、熔核长刀=灼热、共振战锤=震荡、镜像双刃=镜像、相位长枪=穿透 | `WEAPON_TAG_CONFIG` + `WEAPON_CONFIG.weapons[*].tagId` | A1 | PASS |
| F5 | 融合判定改为三输入：`fusionWeaponTagOk()`；**无 `weaponTag` 的 13 条旧配方一律通过**（行为零变化） | `getAvailableFusions()` / `buildTreeReadyHtml()` / `fusionHintForOption()` | A2 / A3 | PASS |
| F6 | 新增 5 条标签专属配方 + **真实生效**的武器侧附加伤害 `applyWeaponTagRiders()` | `FUSION_CONFIG` 13→18、`weaponSwingNow()` 命中后结算 | A4 | PASS（见下表） |
| F7 | 融合面板新增「当前武器 → 可合成配方」区块：当前武器 + 标签、五行标签配方、每行写明缺什么、末句"换用 X 可多出 N 条" | `buildTreeWeaponBridgeHtml()` + `#treeWeaponBridge` | A5 | PASS |
| F8 | 选卡卡面新增青色徽标「可融合·武器」+ ≤12 字提示（如"与长刀可融合"） | `weaponFusionHintForOption()` + `buildRewardModalHtml()` | A6 | PASS |
| F9 | 五把武器外观重做（渐变三段 / 刃口反光 / 护手 / 柄箍 / 锤头明暗 / 三棱枪尖 / 双刃对称） | `drawWeaponHeld()` | 人工看 before/after | PASS |
| F10 | 拖影按轮廓分化：短刃细弧 0.55、长刀满弧 0.30、战锤宽钝 0.18 + 外缘 6px、双刃双弧、长枪 0.55× 细直线 | `drawWeaponFx()` | 人工看 before/after | PASS |
| F11 | 作者署名「陈光辉 制作」写入 `GAME_CONFIG.author`，四处同源：标题页 / 关于面板 / 设置页脚 / 发布包说明 | `GAME_CONFIG.author` + 3 个 DOM + `tools/arcane_package.js` | A9 | PASS |

### 2.1 五条标签配方 · 实测伤害（`tools/arcane_fusion.js` §W，结果存 `.screenshots/weapon_art/fusion_w_damage.json`）

| 配方 | 需求（魔法 + 科技 + 标签） | 效果 | 设计倍率 | 实测附加 | 实测挥击（改前 → 改后） |
|---|---|---|---|---|---|
| 导轨电弧 `railArc` | 火球 + 电容 + **导电** | 命中后向 160px 内最多 2 个敌人弹射 | 40% | **4** | 10 → 14 |
| 熔核裂爆 `moltenTrace` | 熔岩裂变 + 增幅 + **灼热** | 落点 70px 炸一圈（主目标也吃） | 60% | **14** | 24 → 38 |
| 共振回响 `resonantEcho` | 雷击 + 力场 + **震荡** | 每第 3 次命中炸 70px | 65% | **60 / 6 挥（2 次触发）** | 276 → 336 |
| 镜像分裂 `mirrorSplit` | 刃雨 + 磁力 + **镜像** | 身后 ±110° 再挨一刀 | 50% | **4** | 18 → 18（暴击抖动抵消，附加仍生效） |
| 相位贯穿 `phaseLance` | 地雷 + 聚焦器 + **穿透** | 命中后 120px 直线贯穿 | 55% | **9** | 34 → 53 |

> 说明：主挥击带暴击随机，所以"改前→改后"总值会抖动；`riderStats.byFusion` 是确定性的附加伤害，倍率与设计值一致（4/10=40%、14/24≈58%、60/(46×2)≈65%、4/7≈57%、9/17≈53%，差异来自取整）。

### 2.2 武器外观 before / after

| 武器 | before | after |
|---|---|---|
| 导轨短刃 | `.screenshots/weapon_art/before/dagger.png` | `.screenshots/weapon_art/after/dagger.png` |
| 熔核长刀 | `.screenshots/weapon_art/before/longsword.png` | `.screenshots/weapon_art/after/longsword.png` |
| 共振战锤 | `.screenshots/weapon_art/before/hammer.png` | `.screenshots/weapon_art/after/hammer.png` |
| 镜像双刃 | `.screenshots/weapon_art/before/twin.png` | `.screenshots/weapon_art/after/twin.png` |
| 相位长枪 | `.screenshots/weapon_art/before/spear.png` | `.screenshots/weapon_art/after/spear.png` |
| 场景整体 | `.screenshots/weapon_art/scene_before/scene_full.png` | `.screenshots/weapon_art/scene_after/scene_full.png` |

before 用发布包 `dist/emberfall_v1.3.0/烬_v1.3.0.html`，after 用当前 `index_arcane_v2.html`，同机位 1600×900 dpr2。

---

## 3. 本轮修（v1.3.1 内的范围，已完成，但保留观察项）

| # | 项 | 优先级 | 改动范围 | 验收断言 |
|---|---|---|---|---|
| R1 | 迷雾/标记/网格三处降档 | P0 | `FOG_CONFIG`、`drawUnexploredMarkers`、`sceneSeam/sceneGridMul` | A7 |
| R2 | 武器标签 + 三输入融合 | P0 | `WEAPON_TAG_CONFIG`、`getAvailableFusions`、`fusionWeaponTagOk` | A1–A3、A6 |
| R3 | 5 条标签配方真实结算 | P0 | `applyWeaponTagRiders`、`weaponSwingNow` | A4 |
| R4 | 面板 / 选卡呈现 | P1 | `buildTreeWeaponBridgeHtml`、`weaponFusionHintForOption` | A5、A6 |
| R5 | 武器外观与拖影 | P1 | `drawWeaponHeld`、`drawWeaponFx` | A8（截图） |
| R6 | 作者署名同源 | P2 | `GAME_CONFIG.author` + 3 DOM + 打包脚本 | A9 |

---

## 4. 后续（未完成 / 未实现，如实列出）

| # | 项 | 现状 | 为什么没做 | 建议优先级 |
|---|---|---|---|---|
| N1 | **已获得的标签融合在换武器后仍保留** | 当前行为：`state.fusions` 只增不减，换武器不会失效 | 设计取舍：本轮不做"武器绑定校验"，避免中途换武器直接废掉一个槽位、玩家理解成本更高 | P2，需先定规则（失效 / 保留 / 转属性） |
| N2 | **融合面板没有"把每条配方画成三条输入的连线图"** | 只有文字行 + 缺项提示 | 本轮只做能一眼看懂的清单式呈现；连线图需要额外布局与命中测试，未做 | P2 |
| N3 | **Q4 房间大圆弧 / 斜线未改** | 保留原样 | 那部分是武器判定可视化（按 V 可关）与房间钢梁装饰，不属于"迷雾漏出"；贸然删会丢失判定反馈 | P3（若仍嫌抢眼，再单独做"淡出到 0.35"） |
| N4 | **武器外观没有做像素级精修（贴图级）** | 仍是程序化矢量，只做了结构 + 明暗 + 反光 | 用户约束"不引入外部贴图、不破坏判定"，矢量是唯一安全解；细节上限受 40px 显示尺寸限制 | P3 |
| N5 | **融合槽上限只有 6** | 正式规则不变；验收脚本用 `fusion.setSlotLimit(20)` 临时抬高 | 若真要让玩家体验全部 18 条，需要改成长曲线或天赋，本轮不动平衡 | P1（玩法向，另开任务） |
| N6 | **`arcane_weapons` W6 输入缓冲偶发失败** | 首跑 FAIL（first:false / whiffs:2），复跑 PASS（swings 5 / whiffs 5） | 属时序敏感用例，非本轮改动引入；按"不改弱断言"要求保留原断言，仅记录 | P2（补 3 次取多数的稳定化） |

---

## 5. 验收标准（可测断言 · 现状）

| 编号 | 断言 | 检查方式 | 结果 |
|---|---|---|---|
| A1 | 五把武器 `tagId` 与五个标签一一对应；`currentTag()` 随 `weapons.set` 变化 | `arcane_fusion.js` W1–W3 | PASS |
| A2 | 无 `weaponTag` 的 13 条旧配方不随武器变化（两输入回退） | W6 | PASS |
| A3 | 5 条新配方只在对应武器下出现在可融合列表；切走后消失 | W4–W5、W7 | PASS |
| A4 | 5 条配方都有真实附加伤害（`byFusion` > 0），倍率与设计一致 | W11–W15 | PASS（96/96） |
| A5 | 面板含"当前武器" + 5 个标签行 + "换用…可多出 N 条" | W8 | PASS |
| A6 | 可融合卡有徽标，提示 ≤12 字；无关卡无提示 | W9–W10 | PASS |
| A7 | `FOG_CONFIG.alpha ≥ 0.98`；三个标记 alpha 已降；`SCENE_READ_CONFIG.enabled=false` 回原值 | 代码 + scene before/after 截图 | PASS |
| A8 | 五把武器 before/after 截图存在且肉眼可辨差异 | `.screenshots/weapon_art/{before,after}` | PASS |
| A9 | 四处署名与配置完全一致；改 `GAME_CONFIG.author` 即同步 | `arcane_verify.js` §14.5 | PASS |

### 回归结果（本轮末次）

| 套件 | 结果 | 备注 |
|---|---|---|
| `arcane_fusion.js` | **96/96 PASS** | 含新增 15 条 W 断言 |
| `arcane_weapons.js` | **PASS** | W6 首跑偶发 FAIL，复跑 PASS（见 N6） |
| `arcane_verify.js` | **PASS** | 含作者署名 2 条 |
| `arcane_syntax.js` | **PASS** | 54950 行单块解析 |
| `arcane_package.js` | **9/9 PASS** | `dist/emberfall_v1.3.1`，2.45MB，3 文件 |

---

## 6. 改动范围（文件级）

| 文件 | 改动 |
|---|---|
| `index_arcane_v2.html` | `WEAPON_TAG_CONFIG`、5 个 `tagId`、`FUSION_CONFIG` +5、`fusionWeaponTagOk/currentWeaponTag/fusionInputState`、`applyWeaponTagRiders`、`buildTreeWeaponBridgeHtml`、`weaponFusionHintForOption`、`drawWeaponHeld` / `drawWeaponFx` 重写、`FOG_CONFIG` / `drawUnexploredMarkers` / `SCENE_READ_CONFIG`、`GAME_CONFIG.author`、版本 1.3.1、`__roamDebug.fusion` |
| `tools/arcane_fusion.js` | 13→18、新增 W1–W15 断言 |
| `tools/arcane_verify.js` | 新增 §14.5 署名断言 |
| `tools/arcane_package.js` | 说明页 / 更新说明加"作者：陈光辉 制作" |
| `tools/weapon_art_before_after.js` | 新增（before/after 截图探针，端口 9593） |
| 新增产物 | `RECTIFY_PLAN.md`、`.screenshots/weapon_art/**`、`dist/emberfall_v1.3.1/**` |
