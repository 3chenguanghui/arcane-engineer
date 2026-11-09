# A 批 · 任务清单（自审后直接执行）

> 用户已拍板，不再等待确认。每项完成后立即落盘并更新 PROGRESS。

## T1 数据层
- [ ] T1.1 `MAGIC_CONFIG` 追加 6 条 AOE（id/name/glyph/tag/rarity/cost/cooldown/damage/vfx/desc）
- [ ] T1.2 新增 `AOE_SKILL_CONFIG`（enabled + 6 条 shape 参数）
- [ ] T1.3 `TECH_CONFIG` 追加 `phase` / `rewind`（含 device 配置）
- [ ] T1.4 `FUSION_CONFIG` 追加 `lavaBand` / `drainRing` / `frostFlame`（10 → 13）
- [ ] T1.5 `REWARD_CHOICES_CONFIG = { enabled:true, count:4 }`

## T2 释放与绘制
- [ ] T2.1 `castSlot` 追加 6 条分发
- [ ] T2.2 `castLavaFissure`（线） + 熔雷带残留
- [ ] T2.3 `castArcanePool`（域） + `updateAoeZones` / `drawAoeZones`
- [ ] T2.4 `castRuneOrbit`（环带）
- [ ] T2.5 `castCollapseHole`（聚拢） + 吸噬环回血
- [ ] T2.6 `castFlameCone`（扇）
- [ ] T2.7 `castFrostRing`（自环） + 霜焰延迟爆
- [ ] T2.8 `state.aoeCasts` 记录（最多 30 条，含 shape/hits/hitIds/params）

## T3 科技钩子
- [ ] T3.1 相位甲：`damagePlayer` 致死拦截（每层 1 次，1 血 + 1.2s 无敌）
- [ ] T3.2 时序器：`killEnemy` 12% 重置全部魔法冷却
- [ ] T3.3 `castDevice` 两个新装置（相位跃迁 / 时序归零）

## T4 奖励四选一
- [ ] T4.1 `buildRewardOptions` 改为 `choiceCount`（默认 4，可回 3）
- [ ] T4.2 保底 / 补位 / 去重逻辑适配 `choiceCount`
- [ ] T4.3 弹窗文案与快捷键 `1–4` 动态化
- [ ] T4.4 `handleKeyDown` reward 分支补第 4 张

## T5 验收脚本
- [ ] T5.1 新建 `tools/arcane_abatch.js`（端口 9543）
- [ ] T5.2 配置断言（12 / 8 / 13 / 6 形状互异）
- [ ] T5.3 6 条形状断言（每条命中 ≥4）
- [ ] T5.4 开关 A/B 断言
- [ ] T5.5 融合三态 + P4 文案断言
- [ ] T5.6 四选一 + 去重断言
- [ ] T5.7 fps ≥60 + 无报错
- [ ] T5.8 截图 before + 6 张 after

## T6 收尾
- [ ] T6.1 PROGRESS 条目（含「自行判定」数字裁定）
- [ ] T6.2 全量 9 脚本串行回归
- [ ] T6.3 `tools/arcane_cleanup.js --apply`
- [ ] T6.4 报 C 盘可用空间
