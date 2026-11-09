# 第 13 项任务分解 v2 · 三大区 + 深度模式

> 规格：`.spec\regions.md`（v2）
> 纪律：每完成一小步 → `node tools\arcane_syntax.js` + 受影响断言 → 立刻写 PROGRESS。
> 分两次汇报：Phase A（结构 + 机械熔炉）/ Phase B（三区 + 深层 + 量尺）。

---

## Phase A · 结构与第一区

### T13.1 配置落盘
- [ ] `REGION_CONFIG`（4 区、deep 档位、transition）。
- [ ] `THEME_CONFIG.themes.deep` 第四套主题。
- [ ] `REGION_ENEMY_POOLS[4]='deep'`。
- [ ] `ROOM_TEMPLATE_CONFIG.templates.deep` 2 套房型。
- [ ] `BGM_CONFIG.themes.deep` 音乐层。
- [ ] `BOSS_CONFIG.regionBossHpMul=1.15`、`deepBossEvery=6`。
- 验证：语法 PASS；`REGION_CONFIG.regions.length === 4`。

### T13.2 区域助手 + 轮换点替换
- [ ] `regionIndexOf/regionOf/regionKeyOf/regionThemeOf/isRegionEndFloor/isRegionBossFloor/isRegionTransition`。
- [ ] 深层 `deepTierOf/deepHorizontalOf/deepHpMulOf`。
- [ ] 替换 6 处 `((f-1)%3)+1`。
- [ ] `getTheme` 按大区；关闭总开关回退旧轮换。
- 验证：F1–F18 主题 = mech×6, rune×6, void×6；F19+ deep。

### T13.3 首领结构
- [ ] 每层保留 boss 房；`room.isRegionBoss = isRegionBossFloor(f)`。
- [ ] 区域首领血量 ×1.15、标题"区域首领 · 大区名"；普通层"守卫 · 大区名"。
- [ ] 深层每 6 层 `isDeepBoss`。
- 验证：F6/F12/F18 `isRegionBoss=true`；F3/F10 false；三区 boss kind 不同。

### T13.4 切区演出 + 开关
- [ ] `#wipeKicker`、`#wipeRegionText`；`.floor-wipe.region` + `--wipe-accent`。
- [ ] `playRegionTransition`：点击/ESC 跳过、autoMs、关闭只 toast。
- [ ] `descendFloor` 跨区触发；`crossfadeBgm` 切音乐。
- [ ] `#regionFxToggle` + `meta.regionFx`。
- 验证：R5 跳过 < autoMs；关闭后无全屏 wipe。

### T13.5 存档与迁移
- [ ] `state.regionId/regionIndex/depthTier`。
- [ ] `ensureRegionState()` + `applyRunSnapshot` 调用。
- [ ] `META_SCHEMA_VERSION` 7→8。
- 验证：R7 旧档读回字段由 floor 推导一致。

### T13.6 机械熔炉落地（F1–F6）
- [ ] 敌池/主题/房型/家具/首领指向 `foundry`。
- [ ] `rampByFloor` 扩展 F1–F20；全层 battle/elite 应用 hpScale（F1 由 weakFloor1 控制）。
- [ ] DRY 标定：目标 515/644/705/772/846/926（±5%）。
- 验证：DRY 1 轮 F1–F6 达标；截图 1 张机械熔炉。
- **第一次汇报点**。

---

## Phase B · 三区 + 深层 + 验收

### T13.7 符文回廊（F7–F12）
- [ ] 切 `gallery`；标定 1037/1135/1243/1361/1490/1631。
- 验证：F6→F7 1.10–1.15；F7–F12 各 5–15%；区段 1.40–1.60。

### T13.8 虚空深渊（F13–F18）
- [ ] 切 `abyss`；标定 1827/2001/2191/2399/2627/2876。
- [ ] 远程压制由敌池表达，不新增 AI。
- 验证：F12→F13 1.10–1.15；F13–F18 各 5–15%；区段 1.40–1.60；三区首领不同。

### T13.9 深层回廊（F19+）
- [ ] 第四主题 + 混合池 + 每 6 层首领。
- [ ] `deepHpMulOf` 接入 `spawnEnemy`；封顶后横向机制。
- [ ] 量尺扩到 F19/F20。
- 验证：R5 阶梯单调、F49+ 平台 ≤1.02、横向档递增。

### T13.10 量尺与调参
- [ ] `arcane_ladder.js` 判据：同区 1.05–1.15、跨区 1.00–1.15、第 1 区 1.70–1.90、第 2/3 区 1.40–1.60、F1→F2 ≤1.30、保留旧 L1–L4、深层阶梯。
- [ ] DRY 两轮 → 正式 8 轮 × 60。
- [ ] PROGRESS 写字段/依据/区间/实测表。
- 验证：`node tools\arcane_ladder.js` 全 PASS。

### T13.11 新验收 `arcane_regions.js`
- [ ] R1 大区分配；R2 三区敌池/首领不同；R3 主题/房型/家具/音乐不同；R4 区末首领标记；R5 深层单调+封顶+横向；R6 演出可跳过/可关闭；R7 存档字段与迁移；R8 三档难度 F1–F60；R9 音乐层一致；R10 单文件零依赖。
- 验证：`node tools\arcane_regions.js` PASS。

### T13.12 回归与收尾
- [ ] `arcane_openrandom` O6/O9 分区语义（覆盖 18 层）。
- [ ] `arcane_balance` 首领层确认 6/12 仍有效（守卫首领保留，无需改）。
- [ ] 跑 `arcane_render_probe`、`arcane_ab_perf`、`arcane_talents`、`arcane_bossbp`。
- [ ] 截图 ≤4；PROGRESS 勾选；PLAN 更新；清理临时探针；报 C 盘可用。
- **第二次汇报点**。
