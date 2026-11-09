# M3 音频批（融合三音和弦 / 首领登场音 / 楼层 BGM 变体）spec

> 来源：主清单「十一、音频」三条未完成项：
> - 融合专属音阶（每条融合一个三音和弦）
> - Boss 登场音
> - 楼层主题 BGM 变体（机械 / 符文 / 虚空，仍默认关）

## 1. 现状
- 融合音已有 `playSfx('fuse', {rate})`（单音按 `fusion.rate` 变调）——只区分音高，不区分"和弦身份"。
- Boss 登场沿用 `playSfx('reward')`——听感偏"奖励"，不够重。
- BGM 只有一套 A 调低频 pad，换层仅微升音高，三层配色差异在听觉上体现不出来。

## 2. 方案（零外部文件，全部 WebAudio 程序化合成）
### 2.1 `AUDIO_M3_CONFIG`
- `chordBase: 392`（G4）× `fusion.rate` → 每条融合一个基准音；`chords` 把 10 条融合映射到三音音程：
  `homingFireball [0,4,7] / frostField [0,3,7] / chainBolt [0,5,9] / regenField [0,5,7] / novaBurst [0,2,7] /
   chainSpread [0,5,11] / piercingBeam [0,4,9] / droneSwarm [0,3,10] / gravityWell [0,2,5] / shieldNova [0,4,11]`。
- 三音逐一错开 35ms 拨响（像"和弦被拨开"，而不是一坨同时响），单音 0.52s、增益 0.16。
- `playFusionChord(fusion)`：接在原有 `playSfx('fuse')` 之后叠加，基础音 + 和弦一起响。
- `playBossIntroSting(themeId)`：锯齿 74→132Hz 上滑 0.9s + 低通噪声抬升 0.5s，替换 `playSfx('reward')`。

### 2.2 BGM 变体 `BGM_CONFIG.themes`
| 主题 | padFreqs | pingNotes | lowpass | lfoRate | 听感 |
| --- | --- | --- | --- | --- | --- |
| mech | 55 / 82.5 / 110 (A) | 220–392 | 320 | 0.07 | 工业低鸣 |
| rune | 65.4 / 98 / 130.8 (C) | 261–523 | 380 | 0.10 | 空灵、起伏更勤 |
| void | 49 / 73.5 / 98 (G) | 164–294 | 260 | 0.045 | 更低、更慢、更闷 |

- `bgmThemeFor(themeId)` 纯函数返回合并后的参数；`startBgm` 读它，`bgmState.theme / pingNotes` 记当前值；
- `playSoftPing` 改用 `bgmState.pingNotes`，保证点缀音也随主题变化；
- 换层已走 `crossfadeBgm(floor)` → 自动换主题，无需新挂点。

### 2.3 约束
- BGM 仍**默认关闭**（既有用户偏好），只在设置里手动开；音量 / 滑杆 / 静音逻辑一行不改。
- 统计计数 `audioM3Stats` 在"有无 AudioContext"之前记账 → headless 验收也能断言调用链。
- `AUDIO_M3_CONFIG.enabled=false` → 和弦与首领音完全不发声（BGM 变体仍生效，因为它是 BGM 开关下的子行为）。

## 3. 验收（`tools/arcane_m3audio.js`，端口 9510）
| 编号 | 断言 |
| --- | --- |
| M3A-1 | 10 条融合和弦配置齐全（`missingChords = []`），每条 3 个音且频率递增 |
| M3A-2 | 10 组和弦频率互不相同（同基准音下音程不同 → 至少 9 组唯一） |
| M3A-3 | 真实 `tryFuse()` 后 `audioM3Stats.fusionChords ≥ 1`，`lastChord.id` 等于本次融合 |
| M3A-4 | 真实 `startBossIntro()` 后 `bossStings ≥ 1` 且 `lastSting = 当前主题` |
| M3A-5 | 三主题 BGM 参数互不相同（padFreqs / pingNotes / lowpass / lfoRate 四项均不同） |
| M3A-6 | 真实 `descendFloor()` 到第 2 层（rune）后 `bgmState.theme = rune` 且 `pingNotes` 切到 C 组（BGM 开启时） |
| M3A-7 | `AUDIO_M3_CONFIG.enabled=false` → `playFusionChord` 返回 false、计数不变 |
| M3A-8 | 帧率 ≥ 90 / 无脚本错误 / 仍在游戏中 / 截图 |
