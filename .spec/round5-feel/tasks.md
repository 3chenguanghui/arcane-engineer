# 第 5 轮任务清单

> 顺序执行；每组结束写 PROGRESS 并跑语法校验。用户已预授权无人值守。

## G1 连击与爽感
- [x] T1.1 加 `COMBO_FX_CONFIG` / `COMBO_FX_STATS`（COMBO_CONFIG 之后）
- [x] T1.2 `ensureComboFxState()` + `state.comboFx` 重置与 combo 中断清理
- [x] T1.3 `comboFxOnKill()` + `comboFxPitch` 接入 `killEnemy` / `damageEnemy`
- [x] T1.4 `fxTierFrame` / `fxTierEvent` 支持 `comboThreshold`；`fxTierFlush` 接 `playGroupBlast` / `playComboThresholdRing`
- [x] T1.5 `drawComboEdge()` 挂进 `render()`
- [x] T1.6 存档 `meta.comboFx` + 设置页开关 + `setComboFx()` + 调试口
- [x] T1.7 新建 `tools/arcane_combo_fx.js`（A1–A8）+ 截图 2 张

## G2 音频补强
- [x] T2.1 六层音色进 `tones` 与 `buildSfx`
- [x] T2.2 触发点替换（轻/重/暴击/技能/融合/清场）
- [x] T2.3 连击音高 + Boss 阶段段落音
- [x] T2.4 氛围层 `floorTint` + 低通/增益微调
- [x] T2.5 新建 `tools/arcane_audio_layers.js`（B1–B7）

## G3 场景与角色美术
- [x] T3.1 `THEME_CONFIG` 增光照/墙脚/地面主色
- [x] T3.2 烘焙层：方向明暗 + 墙脚接触阴影 + 主题地板纹理
- [x] T3.3 角色剪影轮廓强化（玩家/三族）
- [x] T3.4 新建 `tools/arcane_scene_art2.js`（C1–C5）+ 截图 2 张

## G4 元进度 / 档案
- [x] T4.1 `meta.stats` / `meta.achievements` 默认值与规范化
- [x] T4.2 `checkAchievements()` + `applyMetaBonuses()` + 结算/换层/死亡挂钩
- [x] T4.3 设置页「档案」区块 + 清档
- [x] T4.4 新建 `tools/arcane_meta.js`（D1–D5）

## G5 技术债
- [x] T5.1 说明页房数/敌数由配置生成
- [x] T5.2 隐藏房 `bottom` 朝向断言

## 收尾
- [x] 全量回归 8 套
- [x] PROGRESS 收尾段 + 清理 + 磁盘

