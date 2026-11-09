# B3 残项 · 重甲脚步（spec）

> 出处：`round4-5-merge.md` B3「移动节奏人格化」唯一可选残项。
> 目标：让"慢速重型怪"走路时有物理重量感——靠近时地面轻微震一下 + 低频闷响，远处完全无感。

## 1. 问题
- 单元 C 已按类型区分动作节奏（爬行抖 / 顿挫 / 正弦），但**声音与屏震层面**重甲和碎片怪一样：都是"贴上来才被撞一下"。
- 玩家无法通过"脚步"提前判断"有个大家伙在逼近"，重甲的压迫感只存在于碰撞伤害数字里。

## 2. 方案（只做表现，不动 AI / 伤害 / 碰撞）
1. 新增 `FOOTSTEP_CONFIG`（总开关 + 全部数值集中，便于 A/B 与一键关闭）：
   - `minRadius: 18` + `maxSpeed: 70`：半径够大 **且** 速度够慢才算"重甲"（当前命中：巡检机 18/56、碑卫 19/44、吞噬者 22/54、戍卫碑像 21/48；相位兽 19/95 被速度条件排除）。
   - `stride: 34`：累计移动 34px 算"一步"，按 `radius/18` 缩放（体型越大步幅越长、步频越低）。
   - `nearRange: 360`：只有玩家距离 ≤ 360px 才触发。
   - `shake: 4.2` / `shakeTime: 0.08`：近距离震幅 4.2px（在 `FEEL_CONFIG.shakeMaxAmp=8` 之内，属普通事件）。
2. 距离衰减：`power = shake * (1 - 0.55 * dist/nearRange)`
   - dist=0 → 4.2；dist=180 → 3.2；dist=360 → 1.9（低于 `shakeMinAmp=2.5` 被 `triggerShake` 丢弃）。
   - 结果：**有效"有感"半径约 265px**，360px 附近自然静音，无需额外 if。
3. 触发链：`updateHeavyFootstep(enemy, movedDist)` →
   - 累计 `enemy.stepDist`，跨过步幅就归零；
   - `triggerShake(power, 0.08)`（走现有 `triggerShake`，自动吃 `reduceShake` 的 0.35 缩放与下限丢弃）；
   - `playSfx('heavy', 音量按距离 0.18–0.34)`（复用现有低频闷响音，不新增音效条目）；
   - 地面小尘环 `addRing(..., radius+6, 低透明度, 18, 0.26)`；
   - 记账 `state.feel.lastFootstep = { typeId, dist, power, at }` + `state.feel.footsteps++`。
4. 纯函数 `footstepPowerFor(dist)` 单列，便于验收与后续调参；调试口 `__roamDebug.footstep()` 暴露配置 / 计数 / 最近一次 / 探针 / 重甲名单。
5. 兼容性：
   - `FOOTSTEP_CONFIG.enabled = false` → 完全不调用（零开销、零表现差异）；
   - 可访问性「减少屏震」开着时，4.2 × 0.35 = 1.47 < 2.5 → 全部被丢弃，只保留音效与尘环（符合"减少屏震"的语义）。

## 3. 验收（`tools/arcane_b3.js`，端口 9508）
| 编号 | 断言 |
| --- | --- |
| B3-1 | 近距（≤ 250px）重甲走 ≥1.2s → `footsteps ≥ 1`、`lastFootstep.dist ≤ 360`、`state.shake` 真的被推起（peak > 0） |
| B3-2 | 探针衰减：`probe(60) > 3.6`、`probe(360) < 2.5`（远处必被下限丢弃），且中间单调递减 |
| B3-3 | 非重甲（crawler 13/122）同距离同时间 → `footsteps` 不增（只有重甲才有脚步） |
| B3-4 | 减震开 → 单次脚步 `triggerShake` 峰值 ≤ 0.35× 基准，或被丢弃（`droppedShake` 增加） |
| B3-5 | 玩法不变：敌人数量 / 玩家血量 / 帧率 ≥ 90 / 无脚本错误 |
| B3-6 | 1 张截图（近距重甲 + 尘环可辨） |

## 4. 风险
- 多只重甲同屏会导致震屏叠加 → `triggerShake` 取 `max` 不累加，且步幅按体型放大，最坏约 0.7s 一次/只。
- 若听感偏吵：把 `FOOTSTEP_CONFIG.sfxVolume` 降到 0.15 或 `sfx: ''` 即可，不必改代码逻辑。
