# 音频与氛围打磨 · 补丁包（AUDIO AMBIENCE PATCH）

> 本文件只产出**补丁与参数表**，不包含对主文件的任何直接修改。
> 主文件 `index_arcane_v2.html` 在本轮全程只读；所有验证都在 `.audit_tmp/` 临时副本上完成，验证后已删除（`Test-Path .audit_tmp` = `False`）。

---

## 0. 现场指纹（TARGET_MD5 必须现场读取）

安装前请先读一次，不要抄本文档里的数字：

```powershell
Get-FileHash "D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html" -Algorithm MD5
```

本轮实测期间，主文件被**第三方（非本任务）**改写了三次，指纹变化如下：

| 时间点 | MD5 | 大小 | 行数 | 说明 |
|---|---|---|---|---|
| 开轮现场 | `23194ECC5F7733054C4E511476B885C7` | 2711040 | 63404 | 只读基线 |
| 第一轮实测 | `12E7D7C03232EC484AB0196DE064DB67` | 2711566 | 63410 | 本轮实测数据来源 |
| 中途复查 | `7458D064476EEDF131FB47D013DF58FA` | 2712622 | — | 又被改写（+56 字节） |
| 最近一次复查 | `9C6DB008C77A47FCA5984E10A4FAC460` | 2713467 | 63431 | 锚点静态校验通过 |

结论：**不写死 TARGET_MD5**。补丁采用函数级锚点（不含行号），在上表四个版本上全部命中且唯一；交付给「烬 · 收尾合并与发布」线时，请以现场 `Get-FileHash` 结果作为 TARGET_MD5 记录进发布日志。

静态校验（不开浏览器，随时可跑）：

```powershell
node tools/arcane_audio_audit.js --check-anchors
# 输出示例：主文件 MD5（现场读取）= 9C6DB0...  锚点校验：全部命中且唯一 ✓  净增字节= 16034
```

---

## 1. 事实核对：主文件里没有雨声/风层

任务前提写的是“`soundscape` 那条线做过雨声、风层、静谧化”。对当前主文件做全文检索后确认：

- 没有 `ambient` / `soundscape` / `rain` / `wind` 相关实现；
- 音频层只有三样东西：`buildSfx/playSfx` 程序化打击音、`startBgm` 主题低频 pad + 稀疏 ping、`playFusionChord` / `playBossIntroSting` 等事件音；
- `sfx.md` 记录的自检项 B0–B9 也全部是打击音，没有环境层。

所以本轮**不新增环境层**（也符合“不加新系统”的约束），只补三个缺口：强度映射、首领辨识度、生命周期回收。

---

## 2. 里程碑一：战斗强度 → 音频密度（呼吸感）

### 2.1 强度分数公式（只读运行时状态，不改玩法、不碰随机源）

```
score = enemyScore(当前房间活敌数，不含首领)
      + hpScore(玩家血量比)
      + bossScore(首领是否已登场 / 是否二阶段)
```

阈值表：

| 项 | 判据 | 权重（score） |
|---|---|---|
| 活敌 0 | `roomAliveEnemyCount() === 0` | 0 |
| 活敌 1–2 | `<= 2` | 1 |
| 活敌 3–4 | `<= 4` | 2 |
| 活敌 ≥5 | `> 4` | 3 |
| 血量 < 50% | `hp/hpMax < 0.50` | +1 |
| 血量 < 25% | `hp/hpMax < 0.25` | +2（覆盖上一档，不叠加） |
| 首领 P1 已登场 | `state.boss.started && !defeated` | +3.0 |
| 首领 P2 | `phase >= 2 \|\| phase2` | +4.0（覆盖 P1） |

活敌只统计 `e.roomId === state.currentRoomId` 且 `hp > 0` 且 `!e.isBoss` —— 首领单独计权，否则“首领房只有 1 个目标”会被误判成 L1，登场反而不够重。

### 2.2 档位参数表（真正影响手感的就是这四列）

| 档 | score 上限 | 语义 | `voiceLimit` 同时发声上限 | `rateScale` 同名冷却倍率 | `pingMul` 点缀间隔倍率 | `bgmGainMul` BGM 总线 |
|---|---|---|---|---|---|---|
| **L0** | ≤ 0.9 | 探索 / 空房 | 4 | 1.35（更稀疏） | 1.80（5–11s → 9–19.8s） | 1.00 |
| **L1** | ≤ 2.4 | 常规交火 | 6（= 现值） | 1.00（基准） | 1.00 | 1.00 |
| **L2** | ≤ 3.9 | 怪多 / 首领 P1 | 8 | 0.85（更密） | 0.80（4–8.8s） | 1.05 |
| **L3** | > 3.9 | 围攻 / 低血 / 首领 P2 | 10 | 0.70（最密） | 0.65（3.25–7.15s） | 1.10 |

- `voiceLimit` 上限受 `AUDIO_CONFIG.voiceLimit + 4 = 10` 夹紧，不会突破现有总闸。
- `rateScale` 直接乘在 `AUDIO_CONFIG.rateLimit[name]` 上，L3 时 `hit 0.055s → 0.0385s`，L0 时 `→ 0.074s`。**不新增音源，只改节流**。
- 档位切换有 `dwell = 0.45s` 防抖：敌人数在 4↔5 之间抖动时不会“音量抽气”。BGM 总线用 `setTargetAtTime(..., 0.5)` 平滑过渡。

### 2.3 低血心跳（复用现有 `heavy` 音，不新增音源）

| 血量 | 间隔 | 音量 | 音高倍率 |
|---|---|---|---|
| < 25% | 2.0s | 0.13 | 0.60（低频心跳感） |
| 25%–50% | 3.2s | 0.11 | 0.62 |

`playSfx('heavy', vol, { rate, force: true })` —— `force` 绕过限频，但仍受 `voiceLimit` 约束；`state.mode !== 'playing'` 或 `status !== 'playing'` 时心跳计时清零。

### 2.4 实测矩阵（补丁副本，`__roamDebug.audioLayers.intensity()` 直读）

| 用例 | score | 档 | 应用档 | 活敌 | 血量比 | 首领 | voiceLimit | rateScale | pingMul | 心跳 |
|---|---|---|---|---|---|---|---|---|---|---|
| 探索·0敌·满血 | 0 | L0 | L0 | 0 | 1.0 | 否 | 4 | 1.35 | 1.80 | 否 |
| 探索·0敌·20%血 | 2 | L1 | L1 | 0 | 0.2 | 否 | 6 | 1.00 | 1.00 | **是** |
| 2敌·满血 | 1 | L1 | L1 | 2 | 1.0 | 否 | 6 | 1.00 | 1.00 | 否 |
| 5敌·满血 | 3 | L2 | L2 | 5 | 1.0 | 否 | 8 | 0.85 | 0.80 | 否 |
| 5敌·20%血 | 5 | L3 | L3 | 5 | 0.2 | 否 | 10 | 0.70 | 0.65 | **是** |
| 首领P1·满血 | 3 | L2 | L2 | 0 | 1.0 | 是 | 8 | 0.85 | 0.80 | 否 |
| 首领P2·满血 | 4 | L3 | L3 | 0 | 1.0 | 是 | 10 | 0.70 | 0.65 | 否 |

7/7 与设计一致，无 `NaN`、无 Runtime 异常（`runtimeErrors = 0`）。

### 2.5 调参指引

- 嫌战斗不够“炸”：把 L3 的 `voiceLimit` 提到 10 已是上限，改 `rateScale` 到 0.6。
- 嫌探索太吵：L0 `pingMul` 提到 2.2、`voiceLimit` 降到 3。
- 彻底关掉：`AUDIO_INTENSITY_CONFIG.enabled = false`，所有函数立刻退化为补丁前行为（`audioIntensityRateScale()` 返回 1、`audioIntensityVoiceLimit()` 返回原 `AUDIO_CONFIG.voiceLimit`）。

---

## 3. 里程碑二：首领登场的听觉记忆点（三档，零新增音频文件）

### 3.1 现状问题

原 `playBossIntroSting(themeId, phase)` 只接收主题 id，三档首领（`mech` / `rune` / `void`）实际渲染**完全相同的音色**；deep 层轮换首领时也听不出区别。本轮改为按 `state.boss.kind` 分档。

### 3.2 三档设计（闭眼可分的三条物理线索）

| 档 | 语义 | 频谱重心 | 节奏形态 | 合成手段 |
|---|---|---|---|---|
| **mech** 铸造 | 金属闸门 + 撞击 | **高**（1320Hz 金属余响，噪声 lowpass 1800） | **点状四连击** 0.10/0.16/0.22/0.28s | 锯齿 68→118Hz 0.8s + 4 个平方/sine 短击 + 噪声 |
| **rune** 刻印 | 空灵三音上行 | **最高**（196/293.66/392 + 1046.5 泛音） | **连奏琶音** 每 0.09s 一个 | 全部 sine，无噪声；三音各 0.55s 长余韵 |
| **void** 湮灭 | 下沉低频 | **最低**（62→34Hz + 31Hz sub + 7 cents 失谐） | **单次长滑** 1.2s | 锯齿下滑 + 失谐副音 + sine sub + 300Hz 暗噪声 |

共享结构：`semis = phase>=3 ? -5 : (phase===2 ? -3 : 0)`，P2 整段降三度、P3 降减五度，时长 ×0.7 —— 同一档首领在二阶段“变得更紧更沉”，玩家不需要新的学习成本。

### 3.3 配置（`AUDIO_M3_CONFIG.bossTimbres`，完整块）

```js
  bossTimbres: {
    mech: {
      osc: { type: 'sawtooth', from: 68, to: 118, dur: 0.80, gain: 0.20 },
      clicks: [ { at: 0.10, freq: 220, dur: 0.06, gain: 0.20, type: 'square' },
                { at: 0.16, freq: 330, dur: 0.05, gain: 0.16, type: 'square' },
                { at: 0.22, freq: 440, dur: 0.05, gain: 0.10, type: 'square' },
                { at: 0.28, freq: 1320, dur: 0.18, gain: 0.07, type: 'sine' } ],
      noise: { gain: 0.12, cutoff: 1800, dur: 0.50 }
    },
    rune: {
      arp: [ { at: 0.00, freq: 196.00, dur: 0.55, gain: 0.10 },
             { at: 0.09, freq: 293.66, dur: 0.55, gain: 0.10 },
             { at: 0.18, freq: 392.00, dur: 0.55, gain: 0.10 } ],
      shimmer: { freq: 1046.5, dur: 0.65, gain: 0.05 },
      noise: null
    },
    void: {
      osc: { type: 'sawtooth', from: 62, to: 34, dur: 1.20, gain: 0.20 },
      detune: { freq: 63.5, gain: 0.06 },
      sub: { freq: 31, dur: 1.20, gain: 0.10 },
      noise: { gain: 0.12, cutoff: 300, dur: 0.80 }
    }
  }
```

### 3.4 离线客观指标（`OfflineAudioContext` 1.8s 渲染，44100Hz）

| 档 | peak | rms | **zcr（过零率）** | lowRms(120Hz 低通) | highRms(1500Hz 高通补) |
|---|---|---|---|---|---|
| mech | 0.2261 | 0.0203 | **272.2** | 0.0129 | **0.0052** |
| rune | 0.1312 | 0.0192 | **635.6** | 0.0075 | 0.0045 |
| void | 0.2506 | 0.0256 | **112.2** | **0.0218** | 0.0036 |

判据（`renderBossStingSelfTest().ok`）：

```
rune.zcr > 1.8 × max(mech.zcr, void.zcr)   → 635.6 > 489.9 ✓
void.lowRms > mech.lowRms                  → 0.0218 > 0.0129 ✓
mech.highRms > void.highRms                → 0.0052 > 0.0036 ✓
```

实测 `ok: true`，`zcrSpread = 523.4`。全部音量 ≤ 0.26，不会盖过打击音，也不会触发削波。

---

## 4. 里程碑三：“关掉也不亏”实测

### 4.1 三项必报（本项目历史坑位）

| 指标 | 基线（无补丁） | 补丁副本 | 判定 |
|---|---|---|---|
| **常驻节点数**（BGM 开、静置） | `bgmState.nodes.length = 10`，但仪器实测 **+14 仍连接**（真实 12 个 BGM 节点 + 2 个泄漏的 ui 节点） | `nodes.length = 12`，实测 **+12**，与登记数一致 | 登记表终于等于真实节点，无幽灵节点 |
| **每次触发新增节点**（ui / lightHit / heavyHit） | ui 2（gain1+osc1，open **2**）；lightHit 5（open **5**）；heavyHit 5（open **5**） | ui 2（open **0**）；lightHit 5（open **0**）；heavyHit 5（open **0**） | 触发量不变，回收率 100% |
| **反复开关 5 次是否累积**（BGM） | residual **+36**：gain +18、osc +12、convolver **+6**；并保留 impulse buffer **+1.10MB** | residual **0**（所有类型 0）；buffer 仍每次创建 1.10MB 但**不保留** | 累积问题根除 |

首领登场单次节点（补丁副本，关 BGM / 满血 / 清场后测）：

| 档 | 新增节点合计 | 明细 | 清理后 open |
|---|---|---|---|
| mech | **13** | gain 6 / osc 5 / biquad 1 / bufferSource 1 | 0 |
| rune | **8** | gain 4 / osc 4 | 0 |
| void | **9** | gain 4 / osc 3 / biquad 1 / bufferSource 1 | 0 |

### 4.2 静音 / 切标签页 / 低电量

| 场景 | 基线 | 补丁副本 |
|---|---|---|
| **静音 5 次开关** | `AudioContext` 始终 `running`；`liveDelta +10`；`ctxCreatedDelta 0` | 静音后 `suspend()`，5 次采样 4 次 `suspended`（另 1 次为切回瞬间的 resume/suspend 竞态采样）；`liveDelta 0`；`ctxCreatedDelta 0` |
| **切标签页**（`visibilitychange` + `document.hidden`） | `running → running → running`（音频线程空转，rAF 已停但音频没停） | `running → suspended → running`（回来恢复；若此时已静音则保持挂起） |
| **低电量**（伪 Battery：20% 且未充电） | 无任何策略，BGM 与点缀照跑 | `lowPower true`、`bgmOn false`、`bgmNodesLen 0`、`voiceLimit 4`、`pingMul 99`（点缀完全停） |
| **电量恢复**（充到 90%） | — | `lowPower false`，**不自动重开 BGM**（避免电量抖动导致 BGM 反复开关，玩家手动再开） |

### 4.3 AudioContext 创建次数

基线 1 次、补丁 1 次，全部场景（含 5 次 BGM 开关、5 次静音开关、低电量切换）`ctxCreatedDelta` 恒为 **0**。不存在“反复创建 AudioContext”的隐患。

### 4.4 根因（三条，全部是节点生命周期问题，不是性能玄学）

1. `buildSfx` 只 `osc.stop()/noise.stop()`，**从不 `disconnect()`** → gain/filter 永久挂在总线上。
2. `startBgm` 的 `nodes = [padGain, lowpass]` 在混响分支**之前**声明，`reverb`/`wet` 没进登记表 → `stopBgm` 停不掉 convolver，每次开关留一份 + 1.10MB impulse。
3. `playSoftPing` 只断开 `gain`，`osc`/`filter` 留着；且静音/隐藏时没有任何 `suspend` 路径。

---

## 5. 补丁正文（函数级锚点，不写行号）

安装方式：`tools/arcane_audio_audit.js` 的 `applyAudioPatch(src)` 就是本节的逐条实现，锚点缺失/不唯一会直接抛错（不会产出半成品）。手工合并时按下列锚点逐条替换，**要求锚点在文件中恰好出现一次**。

### A 段：战斗强度 → 音频密度

**A-1 插入配置块** — 锚点 `/**\n * 机械层专属场景配置`（插在其前）

```js
/* ============================================================
   战斗强度 → 音频密度（AUDIO DENSITY PATCH）
   ------------------------------------------------------------
   只读运行时状态，只改音频层参数；不碰玩法、不碰随机源、不加新音源。
   所有阈值/倍率集中在这张表，调参只改这里。
   ============================================================ */
const AUDIO_INTENSITY_CONFIG = {
  enabled: true,                     // 总开关：false = 完全回到补丁前行为
  dwell: 0.45,                       // 档位稳定时间（秒）：防止敌人数 4↔5 抖动导致音量抽气
  enemyScore: [0, 1, 2, 3],          // 房间活敌数 0 / 1–2 / 3–4 / ≥5 的权重
  hpBands: [                         // 血量比从高到低匹配（第一条满足的生效）
    { below: 0.25, score: 2, hb: { interval: 2.0, volume: 0.13, rate: 0.60 } },
    { below: 0.50, score: 1, hb: { interval: 3.2, volume: 0.11, rate: 0.62 } }
  ],
  bossScore: { phase1: 3.0, phase2: 4.0 },   // 首领已登场 / 二阶段
  bands: [                           // score 从低到高匹配（第一条 score <= max 的生效）
    { id: 'L0', max: 0.9, voiceLimit: 4, rateScale: 1.35, pingMul: 1.80, bgmGainMul: 1.00 },
    { id: 'L1', max: 2.4, voiceLimit: 6, rateScale: 1.00, pingMul: 1.00, bgmGainMul: 1.00 },
    { id: 'L2', max: 3.9, voiceLimit: 8, rateScale: 0.85, pingMul: 0.80, bgmGainMul: 1.05 },
    { id: 'L3', max: Infinity, voiceLimit: 10, rateScale: 0.70, pingMul: 0.65, bgmGainMul: 1.10 }
  ],
  lowPower: { threshold: 0.25, restore: 0.35, voiceLimit: 4, disableBgm: true, disablePing: true }
};

/** 运行态：当前已应用档位 / 目标档位 / 稳定计时 / 心跳计时 / 低电量标记 */
const audioIntensityState = {
  level: 1, target: 1, dwell: 0, score: 0,
  hpLow: false, heartbeatTimer: 0,
  lowPower: false, battery: null
};

/**
 * 当前房间活敌数（不含首领；首领单独计权，避免"首领房只有 1 个目标"被当成 L1）
 * @returns {number} 活敌数量
 */
function roomAliveEnemyCount() {
  if (!state || !Array.isArray(state.enemies)) return 0;
  const rid = state.currentRoomId;
  let n = 0;
  for (let i = 0; i < state.enemies.length; i += 1) {
    const e = state.enemies[i];
    if (!e || e.isBoss) continue;
    if (rid != null && e.roomId != null && e.roomId !== rid) continue;
    if (e.hp != null && e.hp <= 0) continue;
    n += 1;
  }
  return n;
}

/**
 * 只读计算当前强度分数（纯函数，验收可直接断言）
 * @returns {number} 0 ~ 6 的分数
 */
function audioIntensityScore() {
  const cfg = AUDIO_INTENSITY_CONFIG;
  if (!cfg.enabled || !state) return 0;
  const count = roomAliveEnemyCount();
  const enemyScore = count === 0 ? cfg.enemyScore[0]
    : (count <= 2 ? cfg.enemyScore[1] : (count <= 4 ? cfg.enemyScore[2] : cfg.enemyScore[3]));
  const hpMax = Number(state.player && state.player.hpMax) || 0;
  const hpRatio = hpMax > 0 ? clamp(state.player.hp / hpMax, 0, 1) : 1;
  let hpScore = 0;
  for (let i = 0; i < cfg.hpBands.length; i += 1) {
    if (hpRatio < cfg.hpBands[i].below) { hpScore = cfg.hpBands[i].score; break; }
  }
  let bossScore = 0;
  const b = state.boss;
  if (b && b.started && !b.defeated) {
    bossScore = (b.phase >= 2 || b.phase2) ? cfg.bossScore.phase2 : cfg.bossScore.phase1;
  }
  return enemyScore + hpScore + bossScore;
}

/**
 * 分数 → 档位参数
 * @param {number} score 强度分数
 * @returns {Object} 档位配置
 */
function audioIntensityBand(score) {
  const bands = AUDIO_INTENSITY_CONFIG.bands;
  for (let i = 0; i < bands.length; i += 1) if (score <= bands[i].max) return bands[i];
  return bands[bands.length - 1];
}

/**
 * 当前允许的同类音效并发上限
 * @returns {number} 2 ~ AUDIO_CONFIG.voiceLimit + 4
 */
function audioIntensityVoiceLimit() {
  if (!AUDIO_INTENSITY_CONFIG.enabled) return AUDIO_CONFIG.voiceLimit;
  const band = AUDIO_INTENSITY_CONFIG.bands[audioIntensityState.level] || AUDIO_INTENSITY_CONFIG.bands[1];
  const cap = audioIntensityState.lowPower
    ? AUDIO_INTENSITY_CONFIG.lowPower.voiceLimit : band.voiceLimit;
  return Math.max(2, Math.min(cap, AUDIO_CONFIG.voiceLimit + 4));
}

/**
 * 当前同名声效冷却倍率（越小越密）
 * @returns {number} 0.70 ~ 1.35
 */
function audioIntensityRateScale() {
  if (!AUDIO_INTENSITY_CONFIG.enabled) return 1;
  const band = AUDIO_INTENSITY_CONFIG.bands[audioIntensityState.level] || AUDIO_INTENSITY_CONFIG.bands[1];
  return band.rateScale;
}

/**
 * 当前 BGM 点缀间隔倍率（越大越稀疏）
 * @returns {number} 0.65 ~ 1.80
 */
function audioIntensityPingMul() {
  if (!AUDIO_INTENSITY_CONFIG.enabled) return 1;
  if (audioIntensityState.lowPower && AUDIO_INTENSITY_CONFIG.lowPower.disablePing) return 99;
  const band = AUDIO_INTENSITY_CONFIG.bands[audioIntensityState.level] || AUDIO_INTENSITY_CONFIG.bands[1];
  return band.pingMul;
}

/**
 * 每帧推进：档位防抖 + BGM 总线呼吸 + 低血心跳（心跳复用现有 heavy 低频音，不新增音源）
 * @param {number} dt 帧间隔（秒）
 * @returns {void}
 */
function updateAudioIntensity(dt) {
  const cfg = AUDIO_INTENSITY_CONFIG;
  if (!cfg.enabled) return;
  const playing = state && state.mode === 'playing' && state.status === 'playing';
  if (!playing) { audioIntensityState.heartbeatTimer = 0; return; }
  const score = audioIntensityScore();
  audioIntensityState.score = score;
  const target = audioIntensityBand(score);
  const targetId = cfg.bands.indexOf(target);
  if (targetId !== audioIntensityState.target) {
    audioIntensityState.target = targetId;
    audioIntensityState.dwell = 0;
  }
  audioIntensityState.dwell += dt;
  if (audioIntensityState.dwell >= cfg.dwell && audioIntensityState.level !== targetId) {
    audioIntensityState.level = targetId;
    if (audioState.bgmBus && audioSettings.bgmOn && !audioSettings.muted) {
      audioState.bgmBus.gain.setTargetAtTime(
        audioSettings.bgm * target.bgmGainMul, audioState.ctx.currentTime, 0.5);
    }
  }
  const hpMax = Number(state.player && state.player.hpMax) || 0;
  const hpRatio = hpMax > 0 ? state.player.hp / hpMax : 1;
  let hb = null;
  for (let i = 0; i < cfg.hpBands.length; i += 1) {
    if (hpRatio < cfg.hpBands[i].below) { hb = cfg.hpBands[i].hb; break; }
  }
  audioIntensityState.hpLow = !!hb;
  if (hb) {
    audioIntensityState.heartbeatTimer -= dt;
    if (audioIntensityState.heartbeatTimer <= 0) {
      playSfx('heavy', hb.volume, { rate: hb.rate, force: true });
      audioIntensityState.heartbeatTimer = hb.interval;
    }
  } else {
    audioIntensityState.heartbeatTimer = 0;
  }
}

/**
 * 低电量模式：Battery API 可用时监听电量；低于 25% 且未充电 → 关 BGM、禁点缀、压并发
 * （无 Battery API 的浏览器静默跳过，不影响正常玩法）
 * @returns {void}
 */
function initLowPowerAudio() {
  const cfg = AUDIO_INTENSITY_CONFIG.lowPower;
  if (!navigator.getBattery) return;
  navigator.getBattery().then((battery) => {
    audioIntensityState.battery = battery;
    const sync = () => {
      const low = !battery.charging && battery.level < cfg.threshold;
      audioIntensityState.lowPower = low;
      if (low && cfg.disableBgm && audioSettings.bgmOn) setBgmEnabled(false);
    };
    battery.addEventListener('levelchange', sync);
    battery.addEventListener('chargingchange', sync);
    sync();
  }).catch(() => { /* 权限/环境不支持时忽略 */ });
}

/**
 * 页面不可见或静音时挂起 AudioContext，避免音频线程空转
 * @param {string} [reason] 挂起原因（hidden / muted）
 * @returns {boolean} 是否执行了挂起
 */
function suspendAudioForIdle(reason) {
  const ac = audioState.ctx;
  if (!ac || typeof ac.suspend !== 'function') return false;
  audioState.idleReason = reason || 'hidden';
  ac.suspend().catch(() => {});
  return true;
}

/**
 * 页面恢复可见且未静音时恢复 AudioContext
 * @returns {boolean} 是否执行了恢复
 */
function resumeAudioFromIdle() {
  const ac = audioState.ctx;
  audioState.idleReason = null;
  if (!ac || audioSettings.muted) return false;
  if (ac.state === 'suspended' && typeof ac.resume === 'function') ac.resume().catch(() => {});
  return true;
}
```

**A-2 并发闸接强度** — 锚点：`const limit = AUDIO_CONFIG.rateLimit[name] || AUDIO_CONFIG.rateLimit.default;`

```js
  const limit = (AUDIO_CONFIG.rateLimit[name] || AUDIO_CONFIG.rateLimit.default) * audioIntensityRateScale();
```

**A-3 并发上限接强度** — 锚点：`if (!o.priority && audioState.voices >= AUDIO_CONFIG.voiceLimit) return false;`

```js
  if (!o.priority && audioState.voices >= audioIntensityVoiceLimit()) return false;
```

**A-4 点缀间隔（初始化）** — 锚点：`bgmState.nextPing = BGM_CONFIG.pingInterval[0] + Math.random() * 3;`

```js
  bgmState.nextPing = (BGM_CONFIG.pingInterval[0] + Math.random() * 3) * audioIntensityPingMul();
```

**A-5 点缀间隔（循环）** — 锚点两行 `bgmState.nextPing = BGM_CONFIG.pingInterval[0]` + `+ Math.random() * (BGM_CONFIG.pingInterval[1] - BGM_CONFIG.pingInterval[0]);`

```js
    bgmState.nextPing = (BGM_CONFIG.pingInterval[0]
      + Math.random() * (BGM_CONFIG.pingInterval[1] - BGM_CONFIG.pingInterval[0])) * audioIntensityPingMul();
```

**A-6 低电量禁点缀** — 锚点：`if (!audioSettings.bgmOn || audioSettings.muted) return;`（在 `updateBgm` 内）

```js
  if (!audioSettings.bgmOn || audioSettings.muted) return;
  if (audioIntensityState.lowPower && AUDIO_INTENSITY_CONFIG.lowPower.disablePing) return;
```

**A-7 每帧推进** — 锚点：`// BGM 的稀疏点缀调度（真实时间；BGM 关闭时函数内部直接返回）\n  updateBgm(dt);`

```js
  // 战斗强度 → 音频密度（只改音频层参数，不碰玩法与随机源）
  updateAudioIntensity(dt);

  // BGM 的稀疏点缀调度（真实时间；BGM 关闭时函数内部直接返回）
  updateBgm(dt);
```

**A-8 静音开关** — 锚点段：`applyAudioSettings();\n  saveAudioSettings();\n  renderAudioSettings();\n  playSfx('ui');\n  return audioSettings.muted;`（`toggleMute` 尾部）

```js
  applyAudioSettings();
  saveAudioSettings();
  renderAudioSettings();
  if (audioSettings.muted) suspendAudioForIdle('muted');
  else resumeAudioFromIdle();
  playSfx('ui');
  return audioSettings.muted;
```

**A-9 切标签页** — 锚点：`if (document.hidden) weaponHoldFire = false;\n  });`

```js
    if (document.hidden) weaponHoldFire = false;
    /* 音频空转修补：页面不可见时挂起 AudioContext，回来再恢复（静音时保持挂起） */
    if (document.hidden) suspendAudioForIdle('hidden');
    else if (!audioSettings.muted) resumeAudioFromIdle();
  });
```

**A-10 低电量初始化** — 锚点：`if (ui.btnReturnTitle) ui.btnReturnTitle.addEventListener('click', returnToTitleFromRun);`

```js
  if (ui.btnReturnTitle) ui.btnReturnTitle.addEventListener('click', returnToTitleFromRun);
  // 低电量模式：首次绑定时读取电池状态（无 Battery API 时静默跳过）
  initLowPowerAudio();
```

### B 段：首领三档音色

**B-1 三档配置** — 锚点：`boss: { gain: 0.22, dur: 0.9, lowFreq: 74, highFreq: 132, noiseGain: 0.09 }`（在 `AUDIO_M3_CONFIG` 内，其后补逗号再接 `bossTimbres`，完整块见 §3.3）

**B-2 整函数重写** — 起止锚点：`function playBossIntroSting(themeId, phase) {` … `\n\n/**\n * 启动氛围 BGM`

```js
function playBossIntroSting(kindOrTheme, phase, acIn) {
  const cfg = AUDIO_M3_CONFIG;
  if (!cfg.enabled) return false;
  const p = Math.max(1, Number(phase) || 1);
  let kind = kindOrTheme;
  if (!(cfg.bossTimbres && cfg.bossTimbres[kind])) {
    kind = (state && state.boss && cfg.bossTimbres && cfg.bossTimbres[state.boss.kind])
      ? state.boss.kind : 'mech';
  }
  audioM3Stats.bossStings += 1;
  audioM3Stats.lastSting = kind + ':p' + p;
  const ac = acIn || ensureAudio();
  if (!ac) return false;
  const dest = acIn ? ac.destination : audioState.sfxBus;
  if (!dest) return false;
  const t0 = ac.currentTime + 0.05;
  const timbre = cfg.bossTimbres[kind] || cfg.bossTimbres.mech;
  const semis = p >= 3 ? -5 : (p === 2 ? -3 : 0);
  const shift = Math.pow(2, semis / 12);
  const durScale = p > 1 ? 0.7 : 1;
  const cleanup = [];
  const push = (node) => { if (node) cleanup.push(node); };
  const addOsc = (type, from, to, at, dur, gainValue, detuneCents) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const attack = Math.min(0.08, dur * 0.45);
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from * shift), t0 + at);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to * shift), t0 + at + dur);
    if (detuneCents) osc.detune.value = detuneCents;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(gainValue, t0 + at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    osc.connect(gain); gain.connect(dest);
    osc.start(t0 + at); osc.stop(t0 + at + dur + 0.04);
    push(osc); push(gain);
  };
  const addNoise = (gainValue, cutoff, dur, at, attack) => {
    try {
      const frames = Math.floor(ac.sampleRate * Math.min(0.7, dur));
      const buf = ac.createBuffer(1, frames, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * 0.6;
      const noise = ac.createBufferSource();
      noise.buffer = buf;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const ng = ac.createGain();
      ng.gain.setValueAtTime(0.0001, t0 + at);
      ng.gain.exponentialRampToValueAtTime(gainValue, t0 + at + (attack || 0.16));
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      noise.connect(filter); filter.connect(ng); ng.connect(dest);
      noise.start(t0 + at); noise.stop(t0 + at + dur + 0.03);
      push(noise); push(filter); push(ng);
    } catch (error) { /* 不支持 buffer 时静默跳过噪声层 */ }
  };

  if (kind === 'rune') {
    (timbre.arp || []).forEach((n) => {
      addOsc('sine', n.freq, 0, n.at * durScale, n.dur * durScale, n.gain * (p > 1 ? 0.9 : 1), 0);
    });
    if (timbre.shimmer) addOsc('sine', timbre.shimmer.freq, 0, 0.16 * durScale, timbre.shimmer.dur * durScale, timbre.shimmer.gain, 0);
  } else if (kind === 'void') {
    addOsc('sawtooth', timbre.osc.from, timbre.osc.to, 0, timbre.osc.dur * durScale, timbre.osc.gain, 0);
    if (timbre.detune) addOsc('sawtooth', timbre.detune.freq, timbre.detune.freq - 28, 0, timbre.osc.dur * durScale, timbre.detune.gain, 7);
    if (timbre.sub) addOsc('sine', timbre.sub.freq, 0, 0, timbre.sub.dur * durScale, timbre.sub.gain, 0);
    if (timbre.noise) addNoise(timbre.noise.gain, timbre.noise.cutoff, timbre.noise.dur * durScale, 0, 0.35);
  } else {
    addOsc('sawtooth', timbre.osc.from, timbre.osc.to, 0, timbre.osc.dur * durScale, timbre.osc.gain, 0);
    (timbre.clicks || []).forEach((c) => {
      addOsc(c.type || 'square', c.freq, 0, c.at * durScale, c.dur * durScale, c.gain, 0);
    });
    if (timbre.noise) addNoise(timbre.noise.gain, timbre.noise.cutoff, timbre.noise.dur * durScale, 0.02, 0.18);
  }

  window.setTimeout(() => {
    cleanup.forEach((n) => { try { n.disconnect(); } catch (error) { /* 已断开 */ } });
  }, 1800);
  return true;
}
```

**B-3 调用点改成真实 `boss.kind`** — 两处锚点：

- `playBossIntroSting(state.themeId);` → `playBossIntroSting((state.boss && state.boss.kind) || state.themeId);`
- `playBossIntroSting(state.themeId, 2);` → `playBossIntroSting((state.boss && state.boss.kind) || state.themeId, 2);`

**B-4 离线自检** — 锚点：`/* ============================================================\n   六、战斗与交互区`（插在其前）
函数 `renderBossStingSelfTest()` 用 `OfflineAudioContext` 分别渲染三档并算 `peak/rms/zcr/lowRms/highRms`，`ok` 判据见 §3.4；完整实现见 `tools/arcane_audio_audit.js` 常量 `BOSS_SELFTEST`。

**B-5 验收调试口** — 锚点：`setBgmOn(on) { setBgmEnabled(!!on); return audioSettings.bgmOn; }\n    },`

在 `setBgmOn` 后追加 `bossSelfTest()`（返回 `renderBossStingSelfTest()`）与 `intensity()`（返回 §2.4 矩阵所需 13 个字段）。完整代码见 `tools/arcane_audio_audit.js` 的 `B-debug` 替换段。

### C 段：节点生命周期（静音/切页/低电量之外的部分）

**C-1 `buildSfx` 全节点回收** — 5 个锚点，插入内容：

| 锚点 | 追加 |
|---|---|
| `const vol = Math.max(0.0001, (tone.gain \|\| 0.8) * (volume == null ? 1 : volume));` | `const cleanupNodes = [];` |
| `osc.stop(t0 + dur + 0.01);` | `cleanupNodes.push(osc, gain);` |
| `noise.stop(t0 + 0.05);` | `cleanupNodes.push(noise, filter, noiseGain);` |
| `noise.stop(t0 + Math.min(0.12, dur * 0.6));` | `cleanupNodes.push(noise, filter, noiseGain);` |
| `noise.start(t0);\n  }` | `cleanupNodes.push(noise, filter, noiseGain);` |

函数返回前（锚点 `}\n\n  return true;\n}\n\n/**\n * U8：本次音效的随机微抖参数`）：

```js
  }

  // 节点回收：音效播完后显式断开，避免增益节点常驻挂在总线上
  window.setTimeout(() => {
    cleanupNodes.forEach((n) => { try { n.disconnect(); } catch (error) { /* 已断开 */ } });
  }, (dur + 0.3) * 1000);

  return true;
}
```

**C-2 `startBgm` 混响节点登记** — 锚点：`lowpass.Q.value = 0.6;` 到 `const nodes = [padGain, lowpass];` 这一整段

```js
  lowpass.Q.value = 0.6;
  /* 先把本轨所有节点登记进 nodes，混响分支的 convolver / wet 也必须进来，
     否则 stopBgm 只停振荡器，混响节点会每次开关累积一份。 */
  const nodes = [padGain, lowpass];

  if (BGM_CONFIG.reverb) {
    const reverb = ac.createConvolver();
    reverb.buffer = buildImpulse(ac);
    lowpass.connect(reverb);
    const wet = ac.createGain();
    wet.gain.value = 0.55;           // 混响占比：有空间感但不糊
    reverb.connect(wet);
    wet.connect(audioState.bgmBus);
    nodes.push(reverb, wet);
  }
  lowpass.connect(audioState.bgmBus);
  padGain.connect(lowpass);
```

**C-3 `playSoftPing` 全节点回收** — 锚点：`osc.start(t0);\n  osc.stop(t0 + dur + 0.05);\n  window.setTimeout(() => { try { gain.disconnect(); } catch (error) { /* 忽略 */ } }, (dur + 0.3) * 1000);`

```js
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
  window.setTimeout(() => {
    [osc, filter, gain].forEach((n) => { try { n.disconnect(); } catch (error) { /* 忽略 */ } });
  }, (dur + 0.3) * 1000);
```

---

## 6. 安装顺序 / 回滚 / 开关

1. 现场读 `TARGET_MD5`（§0），记入发布日志。
2. `node tools/arcane_audio_audit.js --check-anchors` —— 必须输出「全部命中且唯一 ✓」；失败就不要动手。
3. 按 A-1 → A-10、B-1 → B-5、C-1 → C-3 顺序合并（顺序无关，但 A-1 的配置块要在 `playSfx` 编译前存在，否则 `audioIntensityRateScale` 未定义）。
4. 合并后自检：`node tools/arcane_audio_audit.js`（**需开浏览器，见 §7 等时段**）。
5. 回滚：本补丁全部是新增函数与局部替换，`git checkout -- index_arcane_v2.html` 即可；补丁后净增约 16034 字节（0.59%），无外部文件、无 CDN、包体不涨外部依赖。

运行时开关（全部在 `AUDIO_INTENSITY_CONFIG` 内）：

| 开关 | 作用 |
|---|---|
| `enabled: false` | 强度映射整体失效，回到补丁前音量密度 |
| `lowPower.disableBgm: false` | 低电量不自动关 BGM |
| `lowPower.disablePing: false` | 低电量保留点缀 |
| `AUDIO_M3_CONFIG.enabled: false` | 首领登场音整体静音（原有开关） |

---

## 7. 验收与等时段

- 静态（秒级，不开浏览器）：`node tools/arcane_audio_audit.js --check-anchors`
- 动态（**需独占浏览器，约 6–8 分钟**，单实例串行，跑完自动杀进程并删临时副本）：

```powershell
node tools/arcane_audio_audit.js
```

输出 `.screenshots/audio_nodes/audio-node-audit.json`，对照 §4 的表逐项核对。**开测前请让出机器**，不要与其他浏览器自动化并发（会抢音频设备导致 Sink 初始化抖动、数字失真）。

---

## 8. 未做与风险

- **未新增环境层**：任务前提里的雨声/风层在当前主文件不存在，本轮按“不加新系统”不补；若要补，属于新系统，需另立一轮。
- **低电量策略依赖 Battery API**：Firefox/Chromium 可用，Safari 无该 API 时静默跳过（行为等同补丁前，不会报错）。
- **静音期间的一次采样为 `running`**：`AudioContext.suspend()` 是异步的，250ms 采样点可能撞上切换竞态；节点计数与 Context 创建次数均为 0 增长，不影响结论。若要求“静音后 100% 立刻 suspended”，可把 `toggleMute` 里的 `suspendAudioForIdle` 改为 `await`（会改动 `toggleMute` 返回时序，本轮未做）。
- **电量回升不自动重开 BGM**：刻意设计，避免 BGM 反复开关；玩家手动开启即可。
- **主文件被第三方持续改写**：本轮 4 次指纹中锚点全命中，但正式合并前仍必须重跑 `--check-anchors`。
