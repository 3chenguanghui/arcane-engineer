# 像素特效（pixelfx 移植）现状复核 + 补强规格

> 来源：`D:\其他\腾讯自动化办公AI\歌曲MV\pixelfx`（MIT）。已移植 5 项：pixel-dissolve / glitch-wipe / crt-off(scanline) / hit-flash(impact) / shatter-death。
> 用户要求：① 逐个验活（触发条件 → 画面证据）；② 剩余模块逐个判"能适配 / 不适配"；③ **取向改为"震撼优先"**：默认能适配就做，只有硬伤才跳过；④ 量化（FEEL_TARGETS 口径）+ 分档防晕；⑤ 每批截图 + PROGRESS。

---

## 1. 现状复核（5 项验活）

| 效果 | 触发点（代码位置） | 验活方式 | 已知风险 |
|---|---|---|---|
| dissolve | `descendFloor()` 换层前、`restartRun()` 重开前 | `state.fx.dissolve.active` + 块数/duration + 截图中景 | 启动时抓帧必须在换层**之前**，否则抓到的是新场景 |
| glitch | 死亡 `loseGame()` 强度 1、`hurtLevel≥2` 强度 0.45 | `state.fx.glitch.dur/bands` + 截图 | `captureFxFrame` 每帧重抓，暂停时不刷新（画面静止可接受） |
| scanline | `startGame()` 开局、换层、低血 | `state.fx.scanline.dur` + 截图 | 透明度 0.05 刻意极淡，单帧截图对比度低 → 用亮带位置断言 |
| impact | `damageEnemy()` 带方向命中（`dirAngle != null`） | `fx.impacts.length` + 命中点截图 | 环境伤害不画（无来源会满屏乱线，属设计） |
| shatter | `killEnemy()` 击杀 | `fx.shards.length`（22/杀）+ 截图 | 上限 180 块，连杀会淘汰旧块 |

> M1-5e 准星 / 落点圈**已经实现**（`drawCrosshair()` + `drawAimIndicator()`，四状态 + 拖尾 + 地面圈），不需要和 impact 合并改造。

## 2. 补强清单（震撼优先）

### 2.1 采纳（本批实现）

| # | 效果 | 来源/思路 | 触发 | 量化目标 |
|---|---|---|---|---|
| X1 | 径向爆闪 + 冲击波环叠加 | hit-flash / impact-frame 的"白芯 + 多环" | 暴击 / 击杀 / AOE | AOE 环数 **3**、核心白闪 0.16s；击杀环 2；暴击环 2 |
| X2 | AOE 色温偏移 | 参考 palette shift：外环从元素色过渡到冷白 | `applyExplosion` | 色温偏移强度 0.55，外环 RGB 明显偏冷 |
| X3 | 低血心跳色边 | vignette 类模块 | `hp ≤ 30%` 常驻，`>40%` 解除 | 边缘 22px、alpha 峰值 0.22、96bpm 脉冲 |
| X4 | 拾取磁吸汇聚 | collect-burst / coin-spin 的"向心汇聚" | 拾取结算 | 每次 5 条流、0.28s、26px 起半径 |
| X5 | 连杀 10 里程碑整屏演出 | firework/star-iris 的径向光柱 | `combo.count === 10` | 闪白 110ms、光柱 18 条、慢动作 0.18s、屏震 8 |
| X6 | Boss 阶段转换整屏演出 | boss 转换加强 | `enterBossPhase2()` | 3 环（最大 460px）、闪白 140ms、慢动作 0.34s、边框脉冲 |
| X7 | 分档防晕（整屏层互斥） | 硬性约束 | 所有整屏演出 | 同一时刻整屏层 **≤1**，同档最小间隔 0.25s |
| X8 | 清房过场整屏演出 | 用户点名"清房/下楼过场" | `onRoomCleared()` | 14 光柱 / 60ms 闪白 / 0.1s 慢动作；档位 2 |
| X9 | 下楼过场叠加演出 | 用户点名"清房/下楼过场" | `descendFloor()` | 16 光柱 / 70ms 闪白 / 0.16s 慢动作；档位 3；与像素溶解同帧 |

### 2.2 判定为"暂不适配"（写明硬伤）

| 模块 | 硬伤 |
|---|---|
| 色差（chromatic aberration 常驻） | 常驻全屏滤镜会糊子弹边缘与像素轮廓，违反"事件触发"约束；仅在 glitch 里做 2px 分离边已够 |
| 拖影（motion trail 常驻） | 需要每帧保存历史帧并半透明叠加，静止房间也会持续重绘整屏（fps 成本 ×2+），且会让"敌人残影"与实体混淆 |
| palette swap（整屏调色） | 与"主题层配色 + 可读性对比度"冲突，且同一时刻只能有一个全局滤镜，收益低于 X1/X5 |
| 其余 transitions（iris / blinds / diamond / slash） | 与现有 floorWipe（光环收缩）+ dissolve 语义重复，再多一种转场只会让节奏更碎 |
| 其余 impacts（ground-slam / parry / ricochet） | 本项目无格挡 / 弹反 / 落地重击玩法，触发条件不存在 |
| critters / weather / water / fire 循环类 | 需要持续粒子系统与每帧更新，属于"场景装饰层"（A1/A2 已覆盖），不塞进战斗后处理 |

## 3. 数据层

`PIXEL_FX_CONFIG` 追加 8 组（全部 `enabled + strength`）：

```js
burst:    { enabled, strength, maxBursts, critRings, killRings, aoeRings, ringLife, ringWidth, coreFlash, colorShift }
lowHp:    { enabled, strength, threshold, release, edge, alpha, bpm }
magnet:   { enabled, strength, streams, life, spawnRadius }
milestone:{ enabled, strength, at: [10], flashMs, slowMo, slowScale, rays, raysLength }
bossPhase:{ enabled, strength, flashMs, slowMo, ringCount, ringMax, borderPulse }
clear:    { enabled, strength, dur: 0.8, rays: 14, flashMs: 60,  slowMo: 0.1  }
descend:  { enabled, strength, dur: 0.95, rays: 16, flashMs: 70, slowMo: 0.16 }
tier:     { maxLayers: 1, minGap: 0.25 }
```

`state.fx` 追加：`bursts: []`（世界层爆环）、`magnet: []`（汇聚流）、`screen: null`（整屏层）、`screenLog: []`（演出记录，断言用）、`lastBurst: null`。

## 4. 断言表（`tools/arcane_fxaudit.js`，端口 9504）

| # | 断言 | 条件 |
|---|---|---|
| A1 | dissolve 活 | 换层后 `dissolve.active` 真、块数 ≥600、duration ≈0.99s |
| A2 | glitch 活 | 死亡触发 `glitch.dur ≥0.4`、`bands ≥6`，截图非空 |
| A3 | scanline 活 | 开局 `scanline.dur 0.62`；换层再次启动 |
| A4 | impact 活 | 带方向命中 → `impacts` 新增 1 组；`lines ≥7` |
| A5 | shatter 活 | 击杀 → `shards +22`（允许 ±4） |
| A6 | AOE 环数 | `lastBurst.kind='aoe'`、`rings=3`、`particles ≥ 40` |
| A7 | 色温偏移 | 外环颜色 B 通道 > R 通道（冷白方向） |
| A8 | 暴击/击杀环 | 暴击 `rings=2`；击杀 `rings=2` |
| A9 | 低血色边 | hp 20% → `lowHpLevel > 0`；hp 80% → 0；阈值 0.3 / 解除 0.4 |
| A10 | 磁吸汇聚 | 拾取后 `magnet` 新增 ≥5 条，0.28s 内消失 |
| A11 | 10 连里程碑 | `combo=10` → `screenLog` 新增 milestone、闪白 ≥100ms、慢动作 ≥0.18s |
| A12 | Boss 转换 | `screenLog` 新增 bossPhase、环数 3、慢动作 ≥0.3s |
| A13 | 分档互斥 | 注入 milestone+bossPhase 同时 → `screenLayers ≤1` |
| A15 | 清房过场（真实链路） | 重开后传送到一间战斗房 → 真实 `damageEnemy→killEnemy` 打空 → `screen.kind='clear'`、14 光柱、60ms 闪白 |
| A16 | 下楼过场（真实链路） | `descend()` → 楼层 +1、`screen.kind='descend'`、16 光柱、70ms 闪白、`dissolve.blocks >0` |
| A14 | 帧率 / 异常 | 峰值 fps ≥ 90（目标 100+）、errors 0、截图 10 张 |

## 5. 风险

1. 新增绘制全部在现有 `drawPixelFxWorld/Screen` 内，不新开 RAF 循环、不建离屏画布，避免 fps 回落。
2. 整屏旋转光柱用"一次 path 描边 + 每帧只改角度"实现，不用 18 条独立渐变（渐变对象每帧创建是主要 GC 来源）。
3. 低血色边必须画在 HUD 之下的画布层，且只在 `hp/max ≤ threshold` 时画，避免常驻成本。
4. 磁吸流只在拾取瞬间生成，数量 ≤8，寿命 0.28s，不会堆粒子。
5. 分档互斥用单一 `state.fx.screen` 槽位，天然保证"同时最多一层"。
