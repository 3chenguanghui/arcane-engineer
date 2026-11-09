# Boss 蓝图装配 · 规格（G 项，本轮仅规格，未实现）

> 状态：**未实现**（本轮时间预算优先给了 A–F 的落地与验收）。本文件是下一轮的施工图。
> 原则：不改"单文件零依赖"；不改已有的 13 条基础融合契约（H3 页签二固定 13 条）。

## 1. 目标

拆掉首领后，玩家能拿到该首领的**一招**（蓝图），并把它当成融合素材，拼出一条**只在本次运行有效**的新技能。
解决两个体验问题：

1. 首领战结束后除了宝箱没有"战利品记忆点"；
2. 玩家学到的东西与首领的招式无关，缺少"我打败了它，所以我会了它"的因果感。

## 2. 数据模型（新增，不改 FUSION_CONFIG）

```js
const BOSS_BLUEPRINT_CONFIG = {
  enabled: true,                     // 总开关（关掉即完全回到现状，可回滚）
  dropChance: 1,                     // 首领宝箱必掉；后期可按难度档下调
  oncePerKindPerRun: true,           // 同一种首领一局只给一次
  blueprints: [
    {
      id: 'bp_overload',             // 唯一 id
      boss: 'mech',                  // 对应 BOSS_CONFIG.kinds.id
      moveName: '过载震波',           // 与 heavyName / 招牌机制一致
      glyph: '⌁',
      hint: '以自身为圆心的一次过载震波，命中后短暂削甲',
      fuseWith: { magic: 'nova', tech: 'phaseArmor' },   // 与基础融合相同的材料语义
      result: {
        id: 'bpOverloadNova',
        name: '过载新星',
        desc: '以自身为圆心扩散的震波环，对护甲单位额外 +25% 伤害',
        damage: 46, radius: 150, cd: 6.5
      }
    },
    // bp_runechain → rune：三环刻印 → 与 runeBolt / timerCore 组合
    // bp_singularity → void：湮灭奇点 → 与 voidLance / phaseArmor 组合
  ]
};
```

掉落与持有：

- 首领击败 → 宝箱开启时（现有 `BOSS_CONFIG.dropCrystals` 同一条流程）追加 `state.bossBlueprints.push(bp.id)`。
- 存档字段：`meta.bossBlueprints`（跨局永久图鉴，用于说明页显示"已解锁"），
  局内字段：`state.bossBlueprints`（本局可用，结算清空）。
- 蓝图不占技能槽：它只在按 `F` 融合时作为**可选材料**出现（材料判定优先级：魔法+科技 > 蓝图+魔法/科技）。

## 3. 融合入口（尽量少动现有系统）

- `FUSION_CONFIG` 保持 13 条不动，蓝图融合放在独立数组 `BOSS_FUSION_CONFIG`（由 `BOSS_BLUEPRINT_CONFIG.blueprints` 派生）。
- `tryFuse()` 增加第二段判定：先跑原来的 13 条，未命中再跑蓝图配方。
- 说明页页签二的标题改为「融合配方 · 13 基础 + 3 首领蓝图」，基础表仍严格 13 行（H3 断言不变），
  蓝图表单独 `<table data-boss-fusion>`，未解锁显示"击败 XX 解锁"，已解锁显示产物与材料。

## 4. 与 Boss 预警几何的耦合（风险最高处）

蓝图的"过载震波 / 三环刻印 / 湮灭奇点"直接复用了首领战的预警几何：

- `drawHeavyTelegraph()`（震波圆环 / 三环刻印 / 奇点吸力圈）
- 预警时长必须沿用 `BOSS_CONFIG.heavyTelegraphMin/Max`（0.75–1.0s），**不许**因为玩家施法而缩短。

因此实现时必须：

1. 把预警绘制抽成 `drawBlueprintTelegraph(spec, t)`，**复用**首领战同一套几何参数（heavyRadius / step / gap），
   而不是新写一套，避免"玩家看到的预警和首领战时不一样"。
2. 玩家版伤害上限沿用 `BOSS_CONFIG.damageCap = 46`，避免蓝图技能秒杀。
3. 玩家版冷却 ≥ 6.0s（`result.cd`），且同一时间只允许存在 1 个蓝图预警；再次按下时排队而非叠加。

## 5. 验收（必须自己写断言，新增脚本 `tools/arcane_bossbp.js`，端口 9566）

- B0 配置默认值：enabled=true、3 条蓝图、每条的 boss 都能在 `BOSS_CONFIG.kinds` 找到。
- B1 击败对应首领 + 开宝箱 → `state.bossBlueprints` 含该 bp；重复击败同种 → 仍只有 1 条。
- B2 蓝图融合：持有 bp + 对应 magic/tech，按 F → `state.fusions` 增加蓝图产物、材料被消耗。
- B3 材料不足时按 F 不生效，且不误吃基础融合材料。
- B4 说明页：基础表仍 13 行；蓝图表 3 行；未解锁文案正确；解锁后高亮。
- B5 预警几何一致：玩家版预警半径/前摇与首领战同源（对比 `BOSS_CONFIG` 数值）。
- B6 伤害上限：蓝图命中 ≤ `BOSS_CONFIG.damageCap`。
- B7 A/B：`BOSS_BLUEPRINT_CONFIG.enabled=false` → 宝箱不产蓝图、F 键回旧行为、无报错。
- B8 截图 before/after 各 1 张（首领宝箱未解锁 / 已解锁 + 蓝图表）。

## 6. 回滚

- 只关 `BOSS_BLUEPRINT_CONFIG.enabled` 即回到现状；存档多出的 `meta.bossBlueprints` 不影响旧逻辑
  （`normalizeMeta` 已对未知字段做默认补齐）。
- 若预警几何无法复用，则降级为"蓝图只给被动强化（+伤害/减冷却）"，不做玩家版预警，
  以免出现两套互不一致的预警。

## 7. 下一轮施工顺序

1. 数据层：`BOSS_BLUEPRINT_CONFIG`、state/meta 字段、`normalizeMeta` 补默认值。
2. 掉落：宝箱流程追加 `state.bossBlueprints.push`。
3. 融合：`tryFuse` 第二段判定 + 材料消耗 + 产物写入 `state.fusions`。
4. 说明页：蓝图表 + 文案（保持基础 13 行）。
5. 预警：`drawBlueprintTelegraph` 复用首领几何。
6. 断言脚本 + 截图 + PROGRESS。
