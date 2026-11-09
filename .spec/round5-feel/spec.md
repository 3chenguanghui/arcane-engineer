# 第 5 轮规格 · 爽感 / 美术 / 元进度 / 技术债

> 交付物：`index_arcane_v2.html`（单文件，全内联，零外链）。
> 用户已授权无人值守执行（不提问、不等确认，选择写入 PROGRESS 的「自行判定」）。
> 本规格即执行契约：下列锚点、改动、验收均可直接施工。

## 硬约束（五组共用）

1. `FX_TIER_CONFIG` 三条不可破：1 秒窗口内 S2 ≤ 1 次；同帧事件合并为一次；可读性保护（震幅 ≤ 视野 1.2%、玩家 90px 内不铺遮挡粒子）。
2. 所有演出走现有帧桶 `fxTierFrame / fxTierRegisterHit / fxTierEvent / fxTierFlush`，不新增第二条并行整屏管线。
3. 所有新增功能必须有存档开关或配置 A/B，关闭后行为回到改造前。
4. 已 PASS 的断言一条不许删 / 不许改弱；新增断言只增不减。

---

## 第 1 组 · 连击与爽感系统

### 新增配置 `COMBO_FX_CONFIG`（放在 `COMBO_CONFIG` 之后，约 L8265）

```js
const COMBO_FX_CONFIG = {
  enabled: true,            // 存档总开关 meta.comboFx
  edge:   { enabled: true, width: 26, alpha: 0.24, pulseHz: 2.6, decay: 2.2 },
  pitch:  { enabled: true, step: 0.045, max: 1.75 },
  thresholds: [8, 16, 30],
  threshold: { rings: 3, dur: 0.62, flashMs: 80, slowMo: 0.1, color: '#9ff3ff' },
  groupBlast: { enabled: true, minKills: 4, rings: 3, particles: 90, shake: 7, color: '#ffd07a', dur: 0.6 }
};
const COMBO_FX_STATS = { edgePeaks:0, thresholds:0, mergedThresholds:0, groupBlasts:0,
  lastThreshold:0, lastGroupKills:0, pitchPeak:1, breaks:0, lastPitch:1 };
```

### 运行时状态

- `state.comboFx = { edge: 0, pitch: 1, thresholdsHit: [], lastThresholdAt: -999, groupBlastAt: -999 }`
  由 `ensureComboFxState()` 懒初始化；`createInitialState()` 与 `restartRun()` 里重置。
- 中断（`state.combo.timer` 归零，L38257 区块）时：`pitch` 回 1、`edge` 衰减到 0、`thresholdsHit` 清空、`COMBO_FX_STATS.breaks += 1`。

### 触发点

1. **击杀累加**：`killEnemy()` 在 `state.combo.count += 1` 之后调用 `comboFxOnKill(enemy)`：
   - `pitch = 1 + min(max-1, (count-1)*step)`，写 `COMBO_FX_STATS.lastPitch / pitchPeak`；
   - `edge = 1`，`COMBO_FX_STATS.edgePeaks += 1`；
   - 阈值命中（`thresholds` 内且未记录过）→ `fxTierEvent('comboThreshold', {x,y})`，
     同帧合并 / S2 节流由 `fxTierFlush` 统一裁决；被合并时 `mergedThresholds += 1`，不补放。
2. **击杀音高递增**：`damageEnemy()` 致命分支（L31341）把 `killPitch` 改为
   `1 + min(killPitchMax, frameKills阶梯 + combo阶梯)`；保留 `state.killPitchLog` 现有格式（旧断言可继续读）。
3. **集体爆裂**：`fxTierFlush()` 中 `f.kills >= groupBlast.minKills` 且当前档位仍为 S2（未被节流降级）时，
   调 `playGroupBlast(f)`：3 圈同心环 + 90 粒子 + 短慢动作 + `playSfx('clear')` + 浮字 `清场 ×N`。
4. **阈值冲击环**：`playComboThresholdRing(f)`：`requestScreenFx('comboThreshold', …)`（tier 1，低于 milestone）
   + 玩家脚下 3 圈世界环 + 音效；`COMBO_FX_STATS.thresholds += 1`。

### 屏幕边缘脉冲

`drawComboEdge()`：四边线性渐变条（复用 `drawLowHpVignette` 的实现方式），
alpha = `edge * cfg.alpha * (0.55 + 0.45*sin(t*pulseHz*2π))`，宽度 `cfg.width`；
挂在 `render()` 的 `drawPixelFxScreen()` 之前（HUD 之下，不会挡字）。关闭开关后直接 return。

### 存档与 UI

- `defaultMeta()` 增 `comboFx: true`；`normalizeMeta()` 增 `base.comboFx = raw.comboFx !== false`（**不升版本号**，纯兼容字段）。
- 设置面板「可访问性」区新增一行：`comboFxToggle` + `comboFxStateText`（开=连击演出开 / 关=仅计数）。
- `setComboFx(on)`：写 `state.meta.comboFx` → `saveMeta()` → `applyComboFxSettings()` → toast。
- `__roamDebug.comboFx = { info(), setEnabled(), reset(), threshold(n) }`。

### 验收（新建 `tools/arcane_combo_fx.js`）

A1 默认开 + 存档往返；A2 连杀累加 / 超时中断后 pitch 回 1、边脉冲归零；A3 阈值只触发一次（8→9→8 往返不重发）；
A4 S2 频次：1 秒内连打 20 次 → `FX_TIER_STATS.s2` ≤ 1；A5 同帧 ≥4 杀只触发 1 次 groupBlast；
A6 关闭开关后 edge/threshold/groupBlast 全 0 但 combo 仍累加；A7 长连杀 120 帧平均帧时 < 16.6ms（PERF 类记录 + 预算断言）；
A8 截图 before（关）/ after（开）各 1 张。

---

## 第 2 组 · 程序化音频补强

### 新增六层音色（全部 WebAudio 合成，零文件）

`AUDIO_CONFIG.tones` 增 6 项，`buildSfx` 增对应分支（多振荡器 + 噪声比例不同）：

| 键 | 用途 | 音色设计 |
|---|---|---|
| `lightHit` | 轻击 | 260→150Hz 三角，60ms，噪声 0.2 |
| `heavyHit` | 重击 | 90→40Hz 正弦 + 低频噪声，180ms |
| `cast` | 技能释放 | 420→880Hz 正弦上扬，160ms |
| `fusionCast` | 融合技能 | 三音和弦（复用 `AUDIO_M3_CONFIG.chords`），520ms |
| `critHit` | 暴击 | 780→320Hz 方波短促 + 高频噪声，110ms |
| `clearAll` | 清场 | 160→60Hz 下滑 + 双层噪声，420ms |

触发映射：`damageEnemy` 的轻/重/暴击分支改播新键；技能施放（`castMagic`）播 `cast`；融合播 `fusionCast`；
`killEnemy` 的 ≥4 同帧杀走 `clearAll`；原键保留供旧调用点，不做删除。

### 连击音高 / Boss 阶段

- 连击音高沿用第 1 组 pitch（限幅 1.75）。
- `playBossIntroSting` 增加阶段参数：phase 2 用降三度、phase 3 用减五度，形成"段落音"；`bossPhase` 事件处传入。

### 氛围层

- `BGM_CONFIG` 增 `floorTint`：按 `floor % 3` 在 `themes.mech/rune/void` 之间轮换音色（不换音量）；
- `lowpass` 从 320 降到 300（去刺耳），`padGain` 0.5→0.42，`lfoDepth` 0.2→0.16；
- BGM 默认仍关闭（`bgmDefaultOn: false` 不动）。

### 验收（新建 `tools/arcane_audio_layers.js`）

B1 六个新键都在 `tones` 且离线渲染 RMS > 0.001；B2 六个音色过零率/主频可分（成对差异 ≥ 阈值）；
B3 触发点：轻击/重击/暴击/技能/融合/清场各 +1；B4 静音总开关与 BGM 开关互不影响（独立）；
B5 音量滑杆写 localStorage 并在刷新后保持；B6 页面内 `performance.getEntriesByType('resource')` 音频条目 = 0；
B7 楼层 1/2/3 的 BGM 主题不同。

---

## 第 3 组 · 场景与角色美术二次提升

### 场景

- `THEME_CONFIG` 增 `floorTop / floorBottom / wallSkirt / lightDir`：三种主题（机械熔橙 / 符文紫青 / 虚空靛青）
  的地面主色、墙脚接触阴影色与统一光照方向（左上 → 右下）。
- 场景烘焙 `bakeScene`（现有函数）里：
  1) 地面加一层同方向明暗渐变（`createLinearGradient`，从 `lightDir` 起亮到对角暗）；
  2) 墙脚画 6–10px 接触阴影（贴墙一侧更暗），让贴墙物件有"落地感"；
  3) 地板纹理按 `themeId` 走不同 patch 图案（机械=方格铆钉 / 符文=六边刻纹 / 虚空=星点裂纹）。
- 全部烘焙期完成，运行时零新增开销。

### 角色剪影

- 复用现有 `CHARACTER_ART_CONFIG` 与 `unitSilhouette(key, 60)` / `unitIdentityColor(key, 60)`；
- 提升玩家与主力敌人的轮廓差：玩家加披风外扩、械群加方肩、符文加尖冠、虚空加触须（只改烘焙路径）；
- 断言以 60px 采样：主色 RGB 距离、宽高比、填充率、边缘复杂度四项。

### 验收（新建 `tools/arcane_scene_art2.js`）

C1 三主题地面主色像素采样差异（RGB 距离 ≥ 28）；C2 墙脚 8px 带亮度低于同房中心 ≥ 12%；
C3 贴墙物体下方有暗带（接触阴影存在）；C4 剪影四项指标达阈值（玩家↔三敌、三敌互比）；
C5 before/after 截图各 1 张（同专项 ≤4）。

---

## 第 4 组 · 元进度 / 档案面板

### 数据

`meta.stats = { kills, deaths, clears, bestFloor, blueprints, recipes, deathsSinceWin }`（只增不减，除清档）；
`meta.achievements = { [id]: { at, granted } }`。

### 成就（4 条起）

| id | 条件 | 奖励 |
|---|---|---|
| `kill100` | 累计击杀 ≥ 100 | 初始奥能上限 +5 |
| `floor5` | 最高层 ≥ 5 | 起始多 1 张科技卡 |
| `clear1` | 通关 ≥ 1 次 | 初始奥能上限 +5 |
| `death3` | 死亡 ≥ 3 次 | 起始多 1 瓶治疗 |

- `checkAchievements()` 在换层 / 结算 / 死亡时调用；已发过的不再发（幂等）。
- `applyMetaBonuses()` 在 `startGame` 里真实生效（`aetherMax` / 起始卡 / 起始治疗），并写进存档。
- 面板：设置面板顶部新增「档案」区块（入口在现有设置里，不新增常驻 UI），列出 6 项统计 + 4 条成就状态 + 清档按钮。
- `__roamDebug.meta = { stats(), grant(id), reset() }`。

### 验收（新建 `tools/arcane_meta.js`）

D1 跨局累积正确（模拟 3 局：击杀/死亡/最高层）；D2 成就只发一次（重复触发 granted 数不变）；
D3 奖励在新开局真实生效（aetherMax、起始卡、起始治疗）；D4 清档重置统计与成就；D5 面板条目数与配置一致。

---

## 第 5 组 · 技术债收口

1. 说明页「每层 4–7 房 / 战斗房 3–6 只」改为从 `GAME_CONFIG` / `ENEMY_BUDGET_CONFIG` 读取生成
   （新增 `helpFloorCountText()`，`buildRulesContent()` 调用）。
2. 隐藏房 `bottom` 朝向补断言：`arcane_playthrough.js` 用固定种子或 `__roamDebug.hidden.pick('bottom')`
   强制一次，验证 `side==='bottom' → keys.down`。

---

## 收尾

- 每组结束即写 `PROGRESS.md`（做了什么 / 怎么验 / 遗留风险 / 自行判定）。
- 每组 `node tools/arcane_syntax.js` + 新断言全绿；不动已 PASS 断言。
- 最终全量回归：`ladder / enemies / bossbp / combo / playthrough / perf / help / tactic`。
- `node tools/arcane_cleanup.js --apply`、`.testprofile` 归零、`.bak_*.html ≤ 2`、报告 C 盘可用空间。
