# U13 · 三主题死亡形态细分（机械炸零件 / 符文溃散 / 虚空坍缩）

出处：`.spec/round4-5-merge.md` B4 残项（R4 §2.2「敌人死亡差异化」）。
现状：单元 C 已接"死亡态 + 碎片后处理"，但三种主题用的是同一套爆点 + 像素崩解，
换层后击杀表现完全一样，主题只体现在敌人配色上。

## 一、目标

同一只怪被击杀时，三种主题给三种可辨认的"尸体处理"演出，**只改表现层**：
不改死亡逻辑、不改掉落、不改清房判定、不改碰撞。

| 主题 | 形态 | 视觉关键词 |
| --- | --- | --- |
| `mech` 机械 | 零件炸散 | 橙金色硬边冲击波 ×2 + 向下坠落的火花碎片 |
| `rune` 符文 | 符文溃散 | 青色旋转法阵环（`rune`）+ 六边符文环（`hex`）+ 向上飘散的笔画粒子 |
| `void` 虚空 | 虚空坍缩 | 由外向内收缩的紫环 ×2（`grow` 为负）+ 被吸向中心点的暗粒 |

## 二、改动

1. `DEATH_FORM_CONFIG`：总开关 `enabled` + `strength`（只放大环半径与粒子数）+ 三主题各自的
   `label / shards / ringGrow / ringShape / ringColor`。
2. `spawnThemeDeathForm(enemy)`：按 `state.themeId` 分发，复用既有 `addRing` / `addBurst` /
   粒子对象池（`acquireParticle`），不新开 RAF、不建离屏画布。
3. `killEnemy()` 在既有爆点之后调用（`PIXEL_FX_CONFIG.enabled` 守卫内、`spawnThemeDeathForm` 自带开关）。
4. 验收记账：`state.feel.lastDeathForm = { theme, label, rings, particles }`；
   调试口 `__roamDebug.deathForm()` 返回该记账 + 配置快照。

## 三、断言（`tools/arcane_u13.js`，端口 9507）

- U13-1 三层各杀一只怪：`lastDeathForm.theme` 分别为 `mech / rune / void`，`label` 与配置一致。
- U13-2 机械：`state.rings` 里新增 ≥2 个 `shockwave` 环，颜色为橙金；粒子数 ≥ 配置 `shards`。
- U13-3 符文：新增 `rune` 与 `hex` 两种形状的环各 ≥1；上升粒子（`vy` 为负方向）≥ `shards`。
- U13-4 虚空：新增 ≥2 个 `grow < 0` 的环（半径随时间收缩）；内向粒子（速度指向圆心）≥ `shards`。
- U13-5 不改玩法：击杀后 `kills` 恰好 +1、`enemies.length` 减少 1、掉落照发（`embers` ≥ 0）。
- U13-6 帧率 ≥90、无脚本错误、3 张截图 >10KB（`u13-mech.png / u13-rune.png / u13-void.png`），截图时 `mode==='playing'`。

## 四、风险

1. 环与粒子都在既有预算内（环 < 20、粒子 300 上限），主题演出最多再加 3 环 12 粒，不掉帧。
2. 主题取自 `state.themeId`（`bakeScene` 写入），换层即变；若将来做"主题混层"，需要改成读 `enemy.theme`。
3. 关掉 `DEATH_FORM_CONFIG.enabled` 时完全回到改动前表现，便于 A/B 与回退。
