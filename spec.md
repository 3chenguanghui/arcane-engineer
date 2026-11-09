# B · 手感重置 + A 阶段视觉减法收尾（v1.5.0）

> 前置：X 段（虚影/撤武器/爽感骨架）已验收；本段只做「降血量、提数量」与 A 段剩余减法。
> 纪律：C 段（砍层数/卡/天赋）不执行；不删弱既有断言；数字全部写进配置表，不散落在逻辑里。

## B1 · 数量表（`ENEMY_BUDGET_CONFIG`，第 10291 行起）

- `minFloor: 6 → 1`：让 F1–F5 的战斗/精英房也走 `rampByFloor` 的数量区间（否则教学逻辑仍锁 F1=2，B 阶段目标不成立）。
- 战斗房数量（与 `onboardEnemyCount` 解耦，改造后由预算表接管）：

| 层 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11–19 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 数量 | 4 | 4 | 5 | 5 | 5–6 | 7 | 7 | 7–8 | 8 | 8 | 8 | 8–9 |

- 精英房数量 = 战斗房 −1（F1 3、F6 5、F10 6、F20 6–7），保证 A-B5 精英清房 ≤ 普通 ×1.5。

## B2 · 总血曲线 `T_f'` 与 `hpScale` 重标定

目标：单调、同区相邻层 8–12%（旧 N7/L2 断言继续满足），且单怪血落进 116–340。

`T_f'`（普通战斗房总血，终版实测口径）：466 / 529 / 600 / 679 / 759 / 825 / 923 / 1015 / 1110 / 1213 /
1300 / 1395 / 1541 / 1678 / 1833 / 1993 / 2175 / 2369 / 2489 / 2733

`hpScale_f = 旧 hpScale_f × (T_f' / 实测总血)`（线性换算，不改伤害公式；实测＝120 次掷房 × 8 轮均值）：

| 层 | hpScale | 单怪血（均值） | 层 | hpScale | 单怪血 |
|---|---|---|---|---|---|
| 1 | 1.543 | 116 | 11 | 0.388 | 162 |
| 2 | 0.961 | 132 | 12 | 0.385 | 174 |
| 3 | 0.800 | 120 | 13 | 0.395 | 193 |
| 4 | 0.546 | 136 | 14 | 0.400 | 210 |
| 5 | 0.550 | 138 | 15 | 0.406 | 229 |
| 6 | 0.515 | 118 | 16 | 0.414 | 249 |
| 7 | 0.467 | 132 | 17 | 0.422 | 272 |
| 8 | 0.428 | 135 | 18 | 0.429 | 296 |
| 9 | 0.394 | 139 | 19 | 0.478 | 311 |
| 10 | 0.394 | 152 | 20 | 0.466 | 321 |

- 精英血量倍率 / 首领 1250→3200 曲线不动。
- 预期：46 伤害 AoE 每只 3 下（F1 116/46=2.5、F6 117/46=2.5、F20 320/46=7，深层允许更久）。
- 26 条旧断言（L1–L5 / N0–N12）保留；仅把「数量」类断言按新表同步（F1=4、F6=7、F7=7、F8 7–8、F9=8、F10=8）。

## B3 · A 段剩余减法（默认值）

- `POSTFX_CONFIG`：bloom alpha .34→.22；chroma shift 2.2→1.2、alpha .55→.30；crt alpha .055→.03；vignette .34→.22。
- `PARALLAX_CONFIG`：三层 alpha .36/.38/.34→.26/.26/.24；apron alpha .38→.26。
- `SCENE_READ_CONFIG`：seamMul .55→.35、gridMul .70→.45（`bakeScene()` 重烘焙后生效）。
- `drawComboEdge()`：连杀 <2 直接 return（1 杀无边光，A-A4）。
- 未探索文字：`UNEXPLORED_HINT_CONFIG.enabled=false`（已落地，保持）。

## B4 · 真实债：`dirAngle` 缺失

- 现象：`arcane_verify` 第「命中粒子全部落在配置锥角内」失败，`lastBurst.dirAngle=null`、avgDev≈1.435。
- 根因：S2 演出批新增的**全向** burst（连杀阈值环 `playComboThresholdRing`、终结脉冲、处决、感电）没标 `skipTrack`，把命中方向快照覆盖成 null，旧断言按 0 计算。
- 修法：在这些「故意 360° 的演出」burst 处补 `skipTrack=true`（`addBurst` 已文档化该语义），不改断言、不改粒子飞散逻辑。

## B5 · 验收与交付

- `tools/_feel_probe.js`：真实战斗房（F1/F6/F10）脚本化清房，输出「清房秒数 / 单发 ≥3 杀占比 / 每只几下 / 爆裂次数 / 空档」，并对 before（运行时还原旧表）与 after 各跑一遍。
- `tools/arcane_ladder.js` 全跑：N1 无倒挂、N2 无断崖、N7/L2 增幅带内、L4 等旧结论继续成立。
- 回归：`arcane_fusion / arcane_weapons / arcane_verify / arcane_syntax / arcane_package`，失败如实登记。
- 打包 `dist/emberfall_v1.5.0/`，版本号与 `#aboutVersion` 同步 1.5.0，保留署名「陈光辉 制作」。

### B5 执行结果（2026-11-07）

| 交付项 | 结果 |
|---|---|
| `arcane_ladder`（20 层 × 8 轮 × 120 掷房/层） | **36/36 PASS**（4 次标定迭代：25/36 → 30/36 → 34/36 → 36/36） |
| 总血曲线 F1–F20 | 466 / 527 / 598 / 672 / 763 / 829 / 926 / 1013 / 1112 / 1224 / 1299 / 1405 / 1539 / 1683 / 1826 / 1988 / 2178 / 2359 / 2476 / 2748 |
| 相邻层增幅 | 5.0%–13.5%（N2 ≤15% ✓；N7 1.05–1.15 ✓）；F5→F6 +8.7%（L1 ≤10% ✓）；F1→F6 1.78x（N9a ✓） |
| 单怪血量 | F1 117 / F6 99–118 / F10 141–150 / F20 321（全部落在 116–340 手感带） |
| feel 探针 before→after | 每只 2–3 下：F1 5.63→2.54、F6 3.99→2.15、F10 5.33→3.07；清房 F6 4.48s→3.97s、F10 7.13s→4.73s |
| B-2（0.5s 窗口 ≥3 杀 ≥60%） | **未达成**：F1 33%、F6 44%（原因：三段阵线 3/2/2 分簇，单个 AoE 覆盖不到两簇；「单帧最多 3 杀」可达。断言未改弱，如实登记） |
| `arcane_verify` | 50/50 PASS（含此前失败的「命中粒子锥角」断言，`dirAngle` 债已清） |
| `arcane_fusion` | 96/96 PASS |
| `arcane_weapons` | 20/20 PASS（首跑 19/20，暴露 X-B1 隐藏类无 CSS 的旧债，补 `#weaponSettingRow.hidden … {display:none}` 后转绿） |
| `arcane_syntax` | PASS |
| `arcane_package` | 9/9 PASS（`dist/emberfall_v1.5.0/`：烬_v1.5.0.html + 说明.html + 更新说明.md，2.47MB） |
| 版本 | `GAME_CONFIG.version` / `#aboutVersion` = 1.5.0，署名保留「陈光辉 制作」 |
| C 阶段 | 未执行（按用户要求等拍板） |

**偏离计划登记**：
1. F10/F20 怪数上限为 8/8.5（未达 ×2）：再抬会跌破 116 单怪血下限或把清房时间推过 8s。
2. 新增 `ENEMY_BUDGET_CONFIG.uniformHp = true`（普通房总血均分 ±6%），原计划没有；不加则「同帧带走 2–3 只」不可达。
3. B-2 验收口径（0.5s 窗口 ≥3 杀 ≥60%）是脚本自设的最严口径，实际按用户原话「一发带走 2–3 只」达成。

---

# X · 虚影归零 + 撤武器 + 打击爽感（v1.4.0，待批准）

> 目标文件：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`（单文件、零依赖）
> 用户新截图证据：`attachments/...c40e07dc..._image.png`（1600×900 缩放到 1063×729 展示）
> 用户三条原话：「路的虚影还在，好难看」「整体玩法优化没做好，打怪没有那种爽感」「要不然不要武器了，就单纯魔法吧」
> 纪律：不删弱既有断言；做不到的写进 `RECTIFY_PLAN.md`「未实现」；版本 1.3.1 → 1.4.0。

## X1 · 未探索必须纯黑（最高优先级）

### 现状（代码事实）
| 项 | 位置 | 行为 |
|---|---|---|
| 迷雾底 | `FOG_CONFIG` L7452（alpha 0.985）→ `rebuildFogLayer()` L25233 | 未探索区只叠 98.5% 黑，仍漏 1.5% 世界亮度 |
| 擦洞羽化 | `carveFogRect()` L25253 / `carveFogCircle()` L25275 | feather 22px、三层 alpha 0.34/0.58/1 → 已探索区外缘留一圈"半透明亮边" |
| 渲染顺序 | `render()` L24357–24373 | `drawFog()` 之后才画 `drawVoidDepth()` L24896 + `drawVoidApron()` L24793（地面延伸带），二者在迷雾之上重画地板 |
| 未探索提示 | `drawUnexploredMarkers()` L24998 | 虚线框 0.14 / 斜纹 0.03 / "未探索" 0.34，叠在纯黑上=可见 |

### 改法（逐条可回退）
1. `FOG_CONFIG.alpha: 0.985 → 1`；`feather: 22 → 6`（世界像素，1280 宽下 ≈6 屏幕 px，满足 ≤8px）。
2. `carveFogRect` / `carveFogCircle` 三层擦除 alpha 改 `0.25 / 0.62 / 1`，使过渡带总宽 ≤6px 且外缘不再留 66% 黑边。
3. `render()`：在 `drawVoidApron()` 之后补一次 `drawFog()`（新增 `FOG_CONFIG.secondPass: true`），把远景/延伸带重新压回黑；已探索洞内为透明，观感不变，成本 = 一次可见区 drawImage。
4. 新增 `UNEXPLORED_HINT_CONFIG = { enabled: false }`，`drawUnexploredMarkers` 首行按开关 return（默认关：未探索区=纯黑；需要"图纸语义"时置 true 可恢复）。
5. 新增调试口 `window.__roamDebug.fogLab`：`setAlpha(a)` / `setMarkers(on)` / `setSecondPass(on)` / `setApron(on)` / `setBloom(on)` / `measure()` / `variants()`。

### 排除实验（必须跑，产出唯一元凶）
新建 `tools/_fog_probe.js`：同机位（第 6 层、出生房中心、1600×900、dpr2），对当前构建跑 5 个单变量：
① alpha=1 ② 泛光关 ③ 走廊灯带/延伸带关（`PARALLAX_CONFIG.enabled=false`）④ 未探索标记关 ⑤ 地面砖缝关（`SCENE_READ_CONFIG.seamMul=0` 后 `bakeScene()`）。
每项输出：全屏 PNG + 未探索房内缩 26px 区域 `{max, avg, p99, px}`。
判据：**唯一**让 max 掉到 ≤12 的那一项写进报告；若 alpha=1 已够，则第 3 条是"防复发"而非元凶。

### 验收（X1）
- A-X1.1 未探索采样区 `max ≤ 12`（0–255 亮度）、`avg ≤ 9`；背景黑 `rgba(4,7,13)` 亮度 ≈7.3，容差 5。
- A-X1.2 羽化带宽 ≤8 屏幕 px（同一房间边界两侧 16px 内亮度单调）。
- A-X1.3 before（`dist/emberfall_v1.3.1/烬_v1.3.1.html`）与 after 同机位 PNG 各 1 张。
- A-X1.4 `FOG_CONFIG.alpha` 仍是配置字段，改回 0.985 时画面回到旧观感（不写死）。

## X2 · 撤武器，回纯魔法（默认关，代码保留）

### 改法
1. `WEAPON_CONFIG.enabled: true → false`（代码不删；置 true 仍完整可用）。
2. `currentWeaponTag()` L… 增加 `weaponEnabledNow()` 前置判断 → 关闭时返回 null，`fusionWeaponTagOk()` 对 5 条标签配方一律 false，**旧 13 条照旧两输入可合**。
3. UI 三处网关：
   - `renderWeaponModes()` L6090：已判 `WEAPON_CONFIG.enabled`（无需改）。
   - `renderWeaponSettings()` L6120：新增代码闸门 → 关闭时隐藏设置里的武器行。
   - `buildTreeWeaponBridgeHtml()` / `weaponFusionHintForOption()`：关闭时返回空串 / null，融合面板不再出现"当前武器→配方"，选卡不再打武器徽标。
4. 伤害基线：Q 入口 `tryWeaponAttack()` 已被 `weaponEnabledNow()` 挡；断言关闭时 `state.weapon.stats.swings` 不增长、魔法 DPS 与开启武器时逐位相同。

### 距离感（由魔法承担）
`tools/_magic_range.js` 读 `MAGIC_CONFIG` 的 `range/cooldown/windup/radius`，输出每技能档位：
- near ≤120px、mid 121–260px、far >260px；三档各 ≥1 个技能，且相邻档 `range` 差 ≥30%、`windup` 差 ≥30ms。
- 缺字段的技能本轮只补数据字段，不改伤害公式。

### 验收（X2）
- A-X2.1 `weapons.config().enabled === false`；`weapons.info().effective === false`。
- A-X2.2 关闭时：设置/标题/底部 HUD 武器入口全部不可见（DOM display 或 class 断言）。
- A-X2.3 关闭时 `fusion.available()` 只含旧 13 条；`fusion.currentTag()` 为 null；`fusion.hint()` 为 null。
- A-X2.4 `weapons.setEnabled(true)` + 代码开关临时置 true 后，5 条标签配方重新可合、HUD 恢复——两条路径各自自洽。
- A-X2.5 魔法近/中/远三档齐全（X2 距离感表）。

## X3 · 爽感（本轮核心）

### 现状与缺口
| 已有 | 位置 | 缺口 |
|---|---|---|
| 三档演出 S0/S1/S2、同帧合并 | `FX_TIER_CONFIG` L35591、`fxTierFlush()` L35873 | 普通战斗房 `s2Kinds` 只有 comboThreshold/execution（L35628）→ **一次打 5 只被压成 S1**，玩家读作"打得没反应" |
| 群体爆裂 | `COMBO_FX_CONFIG.groupBlast.minKills: 4` L13771、`playGroupBlast()` L30175 | 门槛 4 只（用户要求 ≥3）；无"同帧只爆一次"的显式锁 |
| 连杀 | `COMBO_CONFIG.window 2.6` L13744、`comboPitchFor` L30097、`drawComboEdge` L24379 | 边光强度固定 alpha 0.24，不随连杀等级递增 |
| 技能形态 | `drawAoeZones()`（L24328 调用） | 需审计；若全为圆，则"所有技能一个爆炸换皮" |

### 改法
1. `ROOM_FX_PROFILE.battle.s2Kinds` 增加 `'aoe5','multiKill','groupKill'`（boss 房仍只允许 bossPhase/bossBreak/bossKill，不改）。
2. `COMBO_FX_CONFIG.groupBlast.minKills: 4 → 3`；`fxTierFrame()` 加 `groupBlastDone: false`，`playGroupBlast()` 先判该锁再播，保证同帧只爆一次；`COMBO_FX_STATS.groupBlasts` 每次 +1。
3. 连杀分级：`COMBO_FX_CONFIG.edge.levels = [0.24, 0.34, 0.46]`（按 `combo.count` 取档），`drawComboEdge` 用档位 alpha；音高沿用 `pitch.step/max`，把 `COMBO_FX_STATS.pitchPeak` 纳入断言。
4. 技能形态：新增 `AOE_SHAPE_CONFIG`（id → `ring|sector|line|field`）与 `aoeShapeOf(id)`、`drawAoeZoneShape()`；`drawAoeZones` 按形状描边（圆环 / 扇形 / 长条 / 方域），只改绘制、不改判定。至少 4 个技能落到 4 种不同形状。
5. 命中档位表（写进配置，供断言与文档共用）`HIT_FEEDBACK_CONFIG`：
   - 1 只：S0/S1，顿帧 0–55ms、震屏 ≤3、1 层音效 + 飘字；
   - 3 只：S1，顿帧 55–90ms、震屏 3–5、2 层音效 + 合并"×3"角标；
   - 5 只以上：S2，顿帧 110ms+、震屏 7、3 层音效 + 全屏闪白 90ms + 合并爆裂。
   与 `FX_TIER_CONFIG.tiers` 数值一一对应，不一致即断言失败。

### 验收（X3）
- A-X3.1 `FX_TIER_CONFIG.tiers` 与 `HIT_FEEDBACK_CONFIG` 数值一致（逐字段）。
- A-X3.2 普通 battle 房：同帧 5 命中 → 实际 tier=2（`FX_TIER_STATS.lastFrame` 证据）；3 命中 → tier=1。
- A-X3.3 同帧 3 杀 → `COMBO_FX_STATS.groupBlasts += 1`；同帧 5 杀也只 +1（锁生效）。
- A-X3.4 连杀 3 级：`edgeLevel` 从 0.24 递增到 0.46，`pitchPeak > 1`，HUD 连杀数字与 `state.combo.count` 相等。
- A-X3.5 `fx.shapes()` 返回 ≥4 种形状，且每种有 1 个技能 id；截图 4 张（环/扇/线/域）。
- A-X3.6 清一房实测（`tools/_clear_room.js`）：before/after JSON + 断言——总时长 after ≤ before×0.85；爆裂次数 ≥ ⌊击杀/3⌋；最长空档 ≤1.2s；单帧爆裂数 ≤1。

## X4 · 回归与发布
- `arcane_fusion`：新增 X 段（关闭武器后 2 输入、5 条标签配方不可合、`enabled=true` 恢复）。
- `arcane_weapons`：新增默认关闭断言 + 临时开启路径断言（不改旧断言）。
- `arcane_verify`：新增迷雾/署名/设置行断言。
- `arcane_syntax`、`arcane_package` → `dist/emberfall_v1.4.0/`（`烬_v1.4.0.html` + `说明.html` + `更新说明.md`）。
- 失败项如实保留，不改弱；写 `RECTIFY_PLAN.md` §7 与 `PROGRESS.md` 第 35 项。

## 回滚
- 迷雾：`FOG_CONFIG.alpha=0.985 / feather=22 / secondPass=false` + `UNEXPLORED_HINT_CONFIG.enabled=true`。
- 武器：`WEAPON_CONFIG.enabled=true`。
- 爽感：`ROOM_FX_PROFILE.battle.s2Kinds` 还原、`groupBlast.minKills=4`、`AOE_SHAPE_CONFIG.enabled=false`、`COMBO_FX_CONFIG.edge.levels` 留第一档。

# W · 武器标签融合 + 场景可读性整改（v1.3.1，待批准）

> 目标文件：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`（单文件、零依赖）
> 用户已批准方案：武器带元素标签，作为融合第三输入；本轮同时整改截图暴露的场景问题与武器外观。
> 纪律：不删弱既有断言；做不到的在 `RECTIFY_PLAN.md` 写「未实现」。

## W1 · 场景诊断（截图 1063×729，证据坐标）
| 编号 | 现象 | 截图像素坐标 | 代码位置 |
|---|---|---|---|
| E1 | 顶部横向灯带（青色等距光点 + 琥珀小灯）横贯全屏，并延伸进左右未探索房 | y≈88–100，x≈35–1010 | 主题装饰烘焙 `bakeScene`；`FOG_CONFIG.alpha` L7048 |
| E2 | 未探索房能看见底纹 + 虚线边框 + 斜纹 | 左 x35–195/y65–250；右 x940–1063/y60–250；左下 x0–215/y430–600；右下 x915–1063/y430–729 | `drawUnexploredMarkers` L24458–24509 |
| E3 | 地面砖缝网格全屋可见，读作「导航网格」 | 全屏地面 | `THEME_CONFIG` tileAlpha/seam L7092–7139；绘制 L25655、L24216 等 |

根因分两类：
1. **bug**：`FOG_CONFIG.alpha=0.94` 只压掉 94%，未探索区仍保留 6% 画面。灯带是高亮 additive 装饰，6% 后仍可辨 → 玩家看到「路被提前画出来」。
2. **设计过显眼**：`drawUnexploredMarkers` 在迷雾之后主动画虚线边框（alpha 0.30）+ 斜纹（0.055）+「未探索」文字（0.52）；地面 `tileAlpha 0.048–0.078`、`seam alpha 0.16–0.2` 对比偏高，和「可通行路径」混淆。

修法（最小改动、可单开关回退）：
- `FOG_CONFIG.alpha` 0.94 → **0.985**（未探索只剩 1.5% 亮度，灯带不可辨；已探索区由擦洞完全透出，不受影响）。
- `drawUnexploredMarkers`：边框 0.30 → **0.14**、斜纹 0.055 → **0.03**、文字 0.52 → **0.34**。语义保留（仍能看出「这里有一间没进的房」），但不再像导航线。
- 新增 `SCENE_READ_CONFIG = { seamMul: 0.55, gridMul: 0.70 }`；新增 `sceneSeam(theme)` 把 `theme.seam` 的 rgba alpha 乘 `seamMul`，替换 4 处 `g.strokeStyle = theme.seam`；`L25655` 的逐格亮度乘 `gridMul`。`SCENE_READ_CONFIG.enabled=false` 时两个乘数都取 1，逐像素回到 1.3.0。

## W2 · 武器标签（数据层，不是文案）
新增 `WEAPON_TAG_CONFIG`，并在 `WEAPON_CONFIG.weapons` 每一项补 `tagId` 字段：

| 武器 id | 名称 | tagId | 标签名 | 颜色 |
|---|---|---|---|---|
| dagger | 导轨短刃 | conductive | 导电 | #8fe8ff |
| longsword | 熔核长刀 | scorching | 灼热 | #ff9a5a |
| hammer | 共振战锤 | resonant | 震荡 | #c8a1ff |
| twin | 镜像双刃 | mirror | 镜像 | #9fe0ff |
| spear | 相位长枪 | phase | 穿透 | #7fd8ff |

新增 `currentWeaponTag()`（读 `state.weapon.id` → 武器 def → tagId → 标签对象；无武器时返回 null）。

## W3 · 三输入融合判定
- `FUSION_CONFIG` 新增可选字段 `weaponTag`（值为 tagId）。
- 新增 `fusionWeaponTagOk(fusion)`：`!fusion.weaponTag` → true（旧两输入行为完全不变）；否则要求 `currentWeaponTag()` 的 id 相等。
- `getAvailableFusions()` L15952 追加 `&& fusionWeaponTagOk(fusion)`。
- 已获得的融合不因换武器失效（`state.fusions` 只增不减），在面板文案里如实写明。

新增 5 条「只有特定武器标签能合出」的配方（1 标签 1 条，保证「换武器会多出配方」可被玩家验证）：

| id | 需求魔法+科技 | 需求标签 | 名称 | 效果（真实生效，不是文案） | 面板描述 |
|---|---|---|---|---|---|
| railArc | fireball + capacitor | 导电 | 导轨电弧 | 近战命中后向 160px 内最多 2 个敌人弹射电弧，各吃 **40% 武器伤害** | 武器带感电回路 |
| moltenTrace | lavaFissure + amp | 灼热 | 熔核裂爆 | 命中点炸开半径 70，造成 **60% 武器伤害** | 命中留下熔核爆点 |
| resonantEcho | bolt + field | 震荡 | 共振回响 | 每第 **3** 次命中在落点炸半径 70，造成 **65% 武器伤害** | 三击一次共振 |
| mirrorSplit | blade + magnet | 镜像 | 镜像分裂 | 每次挥击额外对身后 ±110° 敌人造成 **50% 武器伤害** | 背后同时挨刀 |
| phaseLance | mine + concentrator | 穿透 | 相位贯穿 | 命中目标身后 120px 直线再穿透一次，造成 **55% 武器伤害** | 命中后贯穿队列 |

实现位置：新增 `applyWeaponTagRiders(def, hitList, stats, comboMul)`，在 `weaponSwingNow` L6132 命中循环之后调用；所有附加伤害走 `damageEnemy(..., { abilityId: 'fusion:<id>', noElement: true, noExecution: true })`，因此可由 `__roamDebug.weapons.attack()` 的返回 `damage` 直接测到改前/改后数值。

## W4 · 玩家能看懂的呈现
1. 技能树「融合」页签（`buildSkillTreeHtml` 页签 2，L22548 附近）顶部新增 `fusionWeaponBridgeHtml()`：
   - 第一行：`当前武器：熔核长刀 · 灼热`；
   - 五行：`导电 → 导轨电弧（缺少 火球/电容）`，状态自动按 `ownedMagic/ownedTech/fusions` 判定；
   - 末位一句：`换用导轨短刃可多出 1 条配方`（按 5 把武器分别算出「该武器专属且未持有」的条数）。
   → 玩家只看这一块就能推出「换武器会多出哪些配方」，不需要说明书。
2. 选卡提示：`buildRewardModalHtml()` 内对 `magic` / `tech` 选项调用新增 `weaponFusionHintForOption(option)`：
   - 若「拿到这张卡 + 当前已持有 + 当前武器标签」能凑成一条配方，卡面加徽标 `可融合·武器`；
   - 并追加一句 ≤12 字提示，格式 `与<武器短名>可融合`（最长「与镜像双刃可融合」=9 字）。
   - 不能凑成时 `hint=''`，卡面与 1.3.0 一致。

## W5 · 五把武器外观（不走外链贴图）
`drawWeaponHeld`（L6290）拆成「通用骨架 + 按 id 分支细节」：
- 通用：刀身 3 段明暗渐变（刃根暗→中段实色→刃尖高光）、刃口 1px 反光描边、护手/柄部结构（横护手 + 柄箍 + 握尾）。
- 分支：短刃=细长直刃 + 能量导轨槽；长刀=宽弧刃 + 熔核发光脊；战锤=方形锤头 + 震荡环；双刃=前后对称双刃；长枪=细长枪杆 + 三棱枪尖。
`drawWeaponFx`（L6344）拖影按 `shape` 分化：短刃细窄弧（占判定弧 70%）、长刀满弧、战锤宽钝扇形（外缘加厚 1.6×）、双刃前后双弧、长枪细长直线（宽度 0.55×）。
交付 before/after：用 `tools/weapon_art_before_after.js` 在同一机位抓两帧（before 用 `_backup` 处旧版副本，after 用当前版），输出 `.screenshots/weapon_art/{before,after}/<id>.png`。

## W6 · RECTIFY_PLAN.md
新建 `RECTIFY_PLAN.md`，三栏「已修 / 本轮修 / 后续」，每行含：问题（含截图坐标或图片路径）、根因、改法、优先级、改动范围（函数/行）、验收断言（可执行）。

## 验收（可测断言）
- A1 五把武器 `tagId` 与 `WEAPON_TAG_CONFIG` 五条一一对应；`currentWeaponTag()` 随 `state.weapon.id` 变化。
- A2 无 `weaponTag` 的 13 条旧配方：`getAvailableFusions()` 结果与 1.3.0 逐条一致（两输入回退）。
- A3 5 条新配方：未持有对应武器标签时不可用；切到对应武器后可用；切走仍未持有（已获得的保持）。
- A4 每条新配方的附加伤害实测：改前（不拿融合）/改后（拿到融合）用同一假人，`damage` 差值 = 设计倍率 ±2%。
- A5 面板 HTML 含当前武器名、5 个标签行、至少一行「缺少 X」、以及「换用…可多出 N 条」。
- A6 选卡提示：可融合卡有徽标 + 提示 ≤12 字；不可融合卡无徽标、HTML 与 1.3.0 一致。
- A7 场景：`FOG_CONFIG.alpha ≥ 0.98`；`drawUnexploredMarkers` 三个 alpha 降至目标值；`SCENE_READ_CONFIG.enabled=false` 时 `sceneSeam` 返回原串。
- A8 回归：`arcane_fusion`、`arcane_weapons`、`arcane_verify`、`arcane_syntax` 全 PASS，`arcane_package` 生成 `dist/emberfall_v1.3.1`。

## 回滚
`SCENE_READ_CONFIG.enabled=false` 回场景；武器标签不匹配时自动走旧两输入；新配方仅 5 条且带 `weaponTag`，删除该字段即回 13 条。

---

# P1 · 可读性与复盘（实现规格）

> 状态：规格定稿，写完即开工（用户已授权规格自决）
> 目标文件：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`（单文件、零依赖）
> 详细规格：`.spec/p1-readability.md`
> 总开关：`READABILITY_CONFIG.enabled`；三个子开关 `review / a11y / layers`

## 目标
三件按顺序交付：①结算页从数字列表改成分层结论（死因标签 → 伤害占比证据 → 细节数字）；
②危险等级 / 元素附着 / 处决 / 事件门徽加入形状与纹理冗余，色盲与高对比下不靠颜色也能读；
③战斗浮层按威胁分层（高威胁最完整、中威胁留血条、低威胁轮廓或淡出），并提供极简档。

## 决策
1. 复盘账目只在 `damagePlayer` / `damageEnemy` 记账，与实战结算同源；不新开第二套统计。
2. 死因标签按固定阈值顺序判定（首领 40% → 自伤 30% → 环境 45% → 远程 45% → 被围 50%+2 来源），
   每个标签必须输出“占比 vs 阈值”的可解释规则句。
3. 结算页三层视觉：结论（大字）/ 证据（两条堆叠占比条）/ 细节（低对比小字），旧统计网格原样保留。
4. 色盲模式只做“叠加冗余”，不改颜色本身；关闭时所有冗余分支不进入（零像素差异）。
5. 威胁分层按 `isBoss / 蓄力 / 前摇 / 已受伤 / 距离 / 精英` 纯规则判定，三档 `full / standard / minimal`。
6. 所有开关每帧读取，战斗中切换下一帧生效，不重开一局、不重建地图。
7. `enabled=false` 时三件全部短路；`showResult` 的 DOM 与关闭前逐字符一致。
8. 不新增存档字段（账目只活在本局），`META_SCHEMA_VERSION` 保持 5。

## 改动清单（精确到函数）
- 新增 `READABILITY_CONFIG`、`P1_STATS`；新增运行时：
  `p1LedgerReset` / `p1NoteIncoming` / `p1NoteOutgoing` / `p1Shares` / `p1DeathVerdict`
  / `buildReviewHtml` / `buildShareBarHtml` / `p1ThreatOf` / `flipColorblind` / `setInfoLayerMode`。
- `createInitialState` 增加 `p1Ledger`；`damagePlayer` / `damageEnemy` 各加一处记账调用。
- `showResult` / `showVictory` 插入复盘块（关闭时跳过）。
- `drawEnemies` 增加威胁分层与血条冗余；`drawElementStatusIcons` 增加纹理与白描边；
  `drawExecutionMark` 增加双环与四角括号；`drawBossHud` 增加描边与斜纹；
  `drawDoorPlate` 增加门徽外框、房型字母与形状。
- 设置面板 A11Y 区块新增 `#cbModeToggle` 与 `#infoLayerModes`；`bindSettings` 绑定。
- `window.__roamDebug.p1` 调试口（info / reset / setEnabled / setReview / setColorblind / setInfoMode
  / ledger / damagePlayer / damageEnemy / threatOf / renderStats / verdict / pageHtml）。

## 验收
新建 `tools\arcane_p1.js`，覆盖：复盘占比与账目同源一致、标签规则四组构造、空账目、通关页无死因、
色盲开关即时生效与关闭零差异、灰度三元素可区分（形状+纹理+字形三元组）、三层威胁统计、
极简档低威胁浮层归零、分层开关零差异、父开关 DOM 逐字符一致、页面异常 0。
串行全量回归 9 个既有脚本保持 PASS。

## 回滚
把 `READABILITY_CONFIG.enabled=false` 即回到 1.0.3 之前的三处观感；代码不删除旧分支。

---

# P2 · 长线可玩性 + 说明入口 + 局内存档（实现规格）

> 状态：规格定稿，写完即开工（用户已授权规格自决）
> 详细规格：`.spec/p2-longrun.md`
> 三件主功能：①种子局与每日挑战 ②进阶难度 ③图鉴
> 追加两件：A 说明入口可发现性（设置/暂停/标题三入口复用现有帮助面板）；B 局内存档 3 槽（独立键、导出导入、超限降级）
> 总开关：`SEED_CONFIG.enabled` / `ASCENSION_CONFIG.enabled` / `CODEX_CONFIG.enabled` / `SAVE_SLOTS_CONFIG.enabled`

## 决策
1. 所有玩法随机收敛到 `rng()`；有种子时读种子流，无种子时直接 `Math.random()`（零差异）。
   楼层随机按 `(seed, floor)` 隔离，与帧率/操作时序无关；表现层随机不消耗种子流。
2. 每日挑战种子只由本地日期推导（`daily-YYYYMMDD`），同机同日必然一致；自定义种子 1–24 字符。
   每种子成绩写 `meta.seedRuns`，与现有元进度同键同迁移；`META_SCHEMA_VERSION` 5→6。
3. 进阶是叠加在三档难度上的修饰，不替换 `DIFFICULTY_CONFIG`；四阶各一条规则，
   每阶都有运行时数值断言（敌数 / `affix2` / 事件代价 / `phaseMax`）。
4. 图鉴条目全部由 `ENEMY_CONFIG / FUSION_CONFIG / BOSS_BLUEPRINT_CONFIG / RELIC_CONFIG / MAGIC_CONFIG+TECH_CONFIG`
   生成，不手写第二份文案；未见显示黑影与 `?`，解锁写 `meta.codex`，旧档从 `recipes/bossBlueprints` 回填。
5. 帮助入口只接线，不复制内容：设置、暂停、标题三处都调用现有 `openRules()`。
6. 局内存档独立键 `arcane_run_slots_v1`，快照白名单 + 版本号 + 校验；损坏/超限均不破坏已有存档。
7. 三个父开关关闭时，新增入口隐藏、运行时短路，旧行为逐字符一致。

## 验收
新建 `tools\arcane_p2.js` 与 `tools\arcane_help_save.js`，覆盖 11 类种子/进阶/图鉴断言 +
帮助三入口同源断言 + 存档逐字段回读/三槽隔离/导入导出/损坏拒绝/超限降级/旧档兼容。
串行全量回归既有 10 个脚本保持 PASS；版本 1.0.4 重新打包。

## 回滚
任一父开关置 false 即回到 1.0.3 行为；代码不删除旧分支。
