# 打击感目标值（FEEL_TARGETS）

> 作用：把「打击感 / 爽感」这种主观描述拆成**可测量数字**，每项都配一条自动断言。
> 验收脚本：`node tools/arcane_feel.js after`（端口 9485，Edge headless）。
> 调参入口：全部集中在 `FEEL_CONFIG` / `EXPLOSION_CONFIG` / `ROOM_FLOW_CONFIG` / `COMBO_CONFIG`，不改逻辑函数。
> 原则：**先对齐数字，再谈感觉**；任何一项不达标就改配置，而不是改散落在各处的魔法数。

---

## 一、顿帧（hit-stop）

| # | 指标 | 目标值 | 当前取值 | 自动断言 |
|---|------|--------|----------|----------|
| F1 | 轻击顿帧 | 55–75ms（标称 60） | `hitStopLight = 0.06` | `feelAudit().hitStop.lightMs` 落在区间 |
| F2 | 重击顿帧 | 85–100ms（标称 90） | `hitStopHeavy = 0.09` | `hitStop.heavyMs` 落在区间 |
| F3 | 暴击顿帧 | 100–120ms（标称 110） | `hitStopCrit = 0.11` | `hitStop.critMs` 落在区间 |
| F4 | 击杀顿帧 | 120–140ms（标称 130） | `hitStopLethal = 0.13` | `hitStop.lethalMs` 落在区间 |
| F5 | 顿帧时间缩放 | 0.12–0.20（标称 0.16） | `hitStopScale = 0.16` | `hitStop.scale` 落在区间；且 < 0.5（必须真的"停"） |

**实测方式**：`spawnEnemy` 生成一只高血量敌人 → `hitNearest(6)` → 读 `state.feel.lastHitStopMs`；
暴击档用 `hitNearest` 连打直到 `state.feel.lastCrit === true`（或直接读配置）。
**为什么这些数字**：<50ms 玩家感知不到"停"；>150ms 会让连招卡顿。60/90/110/130 是递增阶梯，保证"越重的一下停得越久"。

---

## 二、屏震（camera shake）

| # | 指标 | 目标值 | 当前取值 | 自动断言 |
|---|------|--------|----------|----------|
| F6 | 普通事件峰值上限 | ≤ 8px（1x 分辨率） | `shakeMaxAmp = 8` | 连续 40 次普通 `triggerShake` 后 `lastShakePeak ≤ 8` |
| F7 | 屏震下限 | ≥ 2px 才震 | `shakeMinAmp = 2.5` | 配置值在 2–3；且普通击杀 `triggerShake(2.5)` 生效 |
| F8 | 衰减曲线 | 二次（trauma²） | 渲染层 `amp = power * ratio²` | 注入 `shake.power=8,dur=0.3`，t=0.15 时峰值应 ≈ 2px（8×0.25=2，允许 ±0.6） |
| F9 | 大招豁免 | Boss 击杀可达 16px | `triggerShake(16, 0.6, false)` | 代码中 `cap=false` 调用 ≥3 处（静态计数） |

**为什么**：线性衰减收尾"拖泥带水"，二次曲线前半段猛、后半段迅速归零，更符合"一次冲击"的体感。
普通战斗 8px 上限保证玩家不丢准心；Boss 级演出必须突破上限才有"级别感"。

---

## 三、粒子与碎裂

| # | 指标 | 目标值 | 当前取值 | 自动断言 |
|---|------|--------|----------|----------|
| F10 | 暴击粒子总量 | 12–20 片 | `hitSparksCrit 6 + hitBurstCrit 14 = 20` | 触发暴击后 `state.feel.lastParticles ∈ [12,20]` |
| F11 | 轻击粒子总量 | 2–6 片 | `hitSparksLight = 3` | `lastParticles ∈ [2,6]`（轻击不喷碎片） |
| F12 | 击杀碎裂总量 | ≥ 20 块 | `killBurst 16 + killShatterBlocks 22 = 38` | 击杀后 `state.feel.lastKillFragments ≥ 20` |

**为什么**：12 片以下"看不出爆发"，30 片以上同屏多杀会糊屏；击杀用"碎片 + 像素崩解"两种材质叠出"被打散"的层次。

---

## 四、节奏与音阶

| # | 指标 | 目标值 | 当前取值 | 自动断言 |
|---|------|--------|----------|----------|
| F13 | 同帧多杀音阶步长 | 0.10–0.15 | `killPitchStep = 0.12` | 一次 `killAllEnemies` 后 `killPitchLog` 呈 1.00 → 1.12 → 1.24… |
| F14 | 音阶上限 | 0.4–0.7（标称 0.6） | `killPitchMax = 0.6` | 连杀 6 只时末值 ≤ 1.6 |
| F15 | 连杀窗口 | 2.0–3.0s（标称 2.6） | `COMBO_CONFIG.window = 2.6` | 配置值在区间；窗口内击杀累计、窗口外清零 |

**为什么**：同帧多杀如果音高不变，玩家只会听到"一声糊响"；12% 步进能听出"三连升调"，又不至于变尖啸。

---

## 五、AOE 与清房演出

| # | 指标 | 目标值 | 当前取值 | 自动断言 |
|---|------|--------|----------|----------|
| F16 | 单次 AOE 期望命中 | ≥ 2 只（标准火球） | `fireball.radius 82` / `maxTargets 14` | 3 只敌人在半径内一次爆炸，`lastExplosion.hits ≥ 2` |
| F17 | AOE 伤害衰减 | 边缘保留 50–75% | `fireball.splash 0.55` / `nova 0.72` | 配置值在区间；边缘目标伤害 ≥ 圆心 50% |
| F18 | 清房演出时长 | 0.5–1.0s | `slowMo 0.32 + ringLife 0.62` | 配置值和落在区间；演出期间 `state.slowMo > 0` |

**为什么**：清房是"每 20–40 秒一次的高频奖励节点"，演出过长会拖节奏，过短则没有"打完收工"的仪式感。

---

## 六、飘字与闪白

| # | 指标 | 目标值 | 当前取值 | 自动断言 |
|---|------|--------|----------|----------|
| F19 | 轻击飘字时长 | 0.52–0.70s | `floatLifeLight = 0.62` | 命中后 `state.floats` 末项 `maxLife` 落在区间 |
| F20 | 飘字上浮距离 | 34–46px | `floatRise = 40` | 命中后等 0.3s，位移 ≈ 40×(0.3/0.62) ≈ 19px（误差 ±4） |
| F21 | 闪白峰值时长 | 60–120ms（≈1–2 帧 @60Hz 峰值） | `flashMs = 90` | `state.feel.lastFlashMs ∈ [60,120]`，且 DOM 会自己移除 `is-on` |

**为什么**：飘字太小/太快看不清数字，太大/太久会遮挡敌人；闪白超过 120ms 会变成"白屏"，低于 60ms 大多数人看不到。

---

## 七、暴击与低血

| # | 指标 | 目标值 | 当前取值 | 自动断言 |
|---|------|--------|----------|----------|
| F22 | 暴击率 | 10–15% | `critChance = 0.12` | 配置值在区间 |
| F23 | 暴击倍率 | 1.5–1.8 | `critMul = 1.6` | 配置值在区间 |
| F24 | 低血阈值 | 25–35% 血量 | `hpRatio ≤ 0.3` | 静态：`lowHpFired` 触发条件在区间 |
| F25 | 低血解锁回差 | ≥ 8 个百分点 | `0.4`（30% 触发 / 40% 解锁） | 静态：解锁阈值 − 触发阈值 ≥ 0.08 |

**为什么**：暴击是"意外之喜"，高于 20% 就变成常态、失去惊喜；低血回差过小会在阈值附近反复闪。

---

## 八、美术质感手法（从 REFERENCE 落地到 A1/A2/A3）

| # | 手法 | 来源结论 | 落地位置 | 验收 |
|---|------|----------|----------|------|
| V1 | 光照层次（主光 + 暗角 + 局部光源 + 体积光） | Juicee / Sparkle 的"多层叠加" | A1 场景烘焙：房间主光 + 边缘暗角 + 壁灯/符文/裂隙光源 + 雾锥 | A1 专项断言（明度层次 / 局部亮点） |
| V2 | 边缘光（rim light） | 2D 像素游戏通用的"轮廓提亮" | A1 敌人/道具轮廓 + A2 远景层边缘 | A1 断言签名 |
| V3 | 材质细节密度（砖缝 / 磨损 / 污渍 / 接缝高光） | Vlambeer「Juice it or lose it」 | A1 地面三层材质 | A1 断言（1x 下可辨层次） |
| V4 | 稀有度发光 | card-foil | A3 `.reward-card.rarity-*` 的 `--rar-*-glow` | A3 18/18 已通过 |
| V5 | 卡面材质（sheen + inner shadow） | crd-ui 四态 | A3 `--mat-sheen` / `--mat-inner` | A3 断言（5 主面板材质） |

---

## 九、验收流程

```powershell
# 1) 打击感专项（配置区间 + 运行时实测 + fps）
node tools/arcane_feel.js after

# 2) 核心 14 套回归
node tools/arcane_audit.js ; node tools/arcane_flow3.js ; node tools/arcane_facing.js
node tools/arcane_m12.js ; node tools/arcane_m13.js ; node tools/arcane_m14.js
node tools/arcane_m18.js ; node tools/arcane_m19.js ; node tools/arcane_m20.js
node tools/arcane_m21.js ; node tools/arcane_m22.js ; node tools/arcane_m23.js
node tools/arcane_m24.js ; node tools/arcane_m25.js
```

判定标准：**全部 PASS**，且 `avg fps ≥ 60`；掉帧时**先降装饰密度**（`ROOM_FLOW_CONFIG.clearBurst.particles`、`EXPLOSION_CONFIG.vfx.particles`），不降分辨率/不砍贴图清晰度。

---

## 十、当前达标记录

| 日期 | 项 | 结果 |
|------|----|------|
| 2026-11-03 | F1–F25 配置区间 | ✅ 全部落区间 |
| 2026-11-03 | `arcane_feel.js` 全量 | ✅ **40/40 PASS**，avg 120fps / 8.33ms |
| 2026-11-03 | 实测顿帧 | 轻击 60 / 重击 90 / 暴击 110 / 击杀 130 ms |
| 2026-11-03 | 实测粒子 | 轻击 3 片 / 暴击 20 片 / 击杀碎裂 38 块 |
| 2026-11-03 | 实测音阶 | `[1.00, 1.12, 1.24, 1.36]`（4 连杀，避开启终结脉冲） |
| 2026-11-03 | 实测 AOE / 屏震 | 火球命中 14 只 / 峰值 7px（≤8 上限） |
| 2026-11-03 | 回归 | verify 34/34、fusion 78/78、14 套全绿 |
| 2026-11-04 | F26–F40 像素特效 | ✅ `arcane_fxaudit.js` **16/16 PASS**，avg 120.1–120.2fps / errors 0 |
| 2026-11-04 | F41–F45 装置回应 + 可访问性 | ✅ `arcane_u12.js` **11/11 PASS**，avg 120.3fps / errors 0 |
| 2026-11-04 | 实测 AOE 爆环 | 环数 3 / 粒子 70 / 半径 148px / 外环偏冷（B 168 > 内环 61） |
| 2026-11-04 | 实测里程碑 | 光柱 18 / 闪白 110ms / 慢动作 0.18s / 屏震 8px |
| 2026-11-04 | 实测低血色边 | hp15% → level 0.741（峰值 alpha 0.22）/ hp85% → 0 |
| 2026-11-04 | 实测清房过场 | 真实打空一间战斗房 → `screen.kind clear` / 14 光柱 / 60ms 闪白 / 慢动作 0.1s |
| 2026-11-04 | 实测下楼过场 | 真实 `descend()` → `screen.kind descend` / 16 光柱 / 70ms 闪白 / 溶解 1048 块同帧 |

---

## 十一、像素特效 / 震撼演出（U-fx）

> 验收脚本：`node tools/arcane_fxaudit.js`（端口 9504）。
> 调参入口：`PIXEL_FX_CONFIG`（沿用 pixelfx 的 enabled + strength 约定）。
> 原则：**震撼优先**，但同一时刻整屏层 ≤ 1 层（防眩晕 / 癫痫风险）。

### 11.1 五项移植效果（验活）

| # | 指标 | 目标值 | 当前取值 | 自动断言 |
|---|------|--------|----------|----------|
| F26 | 像素溶解 | 块数 ≥600、时长 ≥0.5s | `cell 46 / maxBlocks 760 / intro+hold+outro = 0.93s`，实测 1048 块 | `state.fx.dissolve.blocks ≥600 && duration >0.5` |
| F27 | 故障撕裂 | 撕裂带 ≥6、时长 ≥0.3s | `bands 12 / maxShift 34px / duration 0.42` | `state.fx.glitch.bands ≥6 && dur ≥0.3` |
| F28 | CRT 扫描 | 时长 ≥0.3s、有亮带 | `duration 0.62 / bandAlpha 0.16 / lineAlpha 0.05` | `state.fx.scanline.dur >0.3`（截图用 0.5 档） |
| F29 | 命中冲击线 | ≥1 组、7 条线 | `impact.lines 7 / life 0.2 / length 16px` | 真实 `hitNearest` 后 `impacts ≥1` |
| F30 | 击杀崩解 | 方块 = 22（±4） | `shatter.count 22 / gravity 520 / life 0.5` | 击杀后 `shards` 新增 ≈22 |

### 11.2 新增震撼演出

| # | 指标 | 目标值 | 当前取值 | 自动断言 |
|---|------|--------|----------|----------|
| F31 | AOE 爆环 | 环数 **3**、粒子 ≥40、外环更冷 | `burst.aoeRings 3 / ringLife 0.42 / coreFlash 0.16 / colorShift 0.55`；实测 3 环 / 70 粒子 / 半径 148px | `aoe burst.rings === 3 && particles ≥40`；外环 B↑ R↓ |
| F32 | 暴击 / 击杀环 | 各 2 环 | `critRings 2 / killRings 2`；暴击粒子 20 片、屏震 6px | `lastBurst.kind === crit/kill && rings === 2` |
| F33 | 低血心跳色边 | hp≤30% 出现、>40% 解除、峰值 alpha ≥0.15 | `threshold 0.3 / release 0.4 / edge 22px / alpha 0.22 / bpm 96`；hp15% 实测 level 0.741 | `lowHpLevel >0.1`（15%）且 `<0.03`（85%） |
| F34 | 拾取磁吸汇聚 | ≥5 条、0.28s 内清空 | `magnet.streams 5 / life 0.28 / spawnRadius 26` | 触发后 `magnet ≥5`，0.36s 后归零 |
| F35 | 10 连里程碑 | 光柱 18 / 闪白 110ms / 慢动作 0.18s / 屏震 8px | `milestone.at [10] / flashMs 110 / slowMo 0.18 / rays 18` | `screen.kind = milestone` 且四项全部命中 |
| F36 | Boss 阶段转换 | 3 环 / 光柱 22 / 闪白 140ms / 慢动作 0.34s / 边框脉冲 | `bossPhase.ringCount 3 / flashMs 140 / slowMo 0.34 / borderPulse 0.5` | `screen.kind = bossPhase` 且四项命中 |
| F37 | 分档防晕 | 同一时刻整屏层 ≤1、同档最小间隔 0.25s | `tier.maxLayers 1 / minGap 0.25` | milestone 占用时 bossPhase / 再次 milestone 均被拒，`screenLayers === 1` |
| F38 | 特效帧率 | ≥90（目标 100+） | headless 与**真机窗口**均实测 avg **120.1–120.2fps**（120Hz 上限）、`__errors` 0 | 2.5s 采样 fps ≥90 且 errors 0（`FX_HEADED=1` 复测同样 16/16） |
| F39 | 清房过场 | 真实清空战斗房 → 整屏层 `clear`：14 光柱 / 60ms 闪白 / 慢动作 0.1s | `clear.dur 0.8 / rays 14 / flashMs 60 / slowMo 0.1`；档位 2（不抢 Boss） | A15：真实 `damageEnemy → killEnemy → onRoomCleared` 链路看 `screen.kind` |
| F40 | 下楼过场 | 真实下楼 → 整屏层 `descend`：16 光柱 / 70ms 闪白 + 溶解同帧 | `descend.dur 0.95 / rays 16 / flashMs 70 / slowMo 0.16`；档位 3 | A16：`descend()` 后 `screen.kind = descend` 且 `dissolve.blocks >0` |
| F41 | 装置·施法回应 | 前移 4–5px、辉光 1.0 | `hoverDeviceOffset`：`castAnim>0 → +4.5px` | `castAnim=1.2` 时 `devicePose().x ∈ [4,5]` |
| F42 | 装置·冲刺回应 | 拖后 4–5px | `dashTime>0 → −5px` | `dashTime=0.25` 时 `x ∈ [−5,−4]` |
| F43 | 装置·濒死回应 | 抖动 ≤1.8px、变红、辉光 0.45 | `hp<30% → sin(t*19)` | `alert=true`、`|x|≤1.8`、`glow≤0.46` |
| F44 | 减少屏震 | 幅度 ×0.35 | `meta.reduceShake` | 固定 20 → 实测 7（`scale=0.35`） |
| F45 | 关闭闪白 | 实际播出 0ms | `meta.reduceFlash` | 100ms → 0ms 且 `flashSuppressed ≥1` |

**为什么这些数字**：
- AOE 少于 3 环只像"一圈波纹"，3 环错峰才有"炸开"的体积；粒子 <40 时小屏（1280）看不清。
- 里程碑闪白 <100ms 会被当成掉帧，>150ms 开始刺眼；110ms ≈ 2 帧，正好"一下白"。
- 整屏层互斥是防晕硬约束：一次战斗里 Boss 转换、10 连、死亡可能同帧发生，必须只播一层。

