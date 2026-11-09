# 《烬》主文件代码健康审计报告

- 审计对象：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`
- 快照 MD5：`7F90FB2DF2C7F31D29A10286CC4E680A`（修改时间 2026-11-08 16:51:34）
- 规模：**62,776 行 / 2,676,227 字节**；其中 HTML+CSS 5,892 行，脚本 5,893–62,772 行（56,880 行）
- 注释行 12,085 行（19.3%），空行 3,160 行
- 本报告**未修改主文件**，所有结论均来自静态分析 + 全文词频复核

> 说明：下文行号均以该 MD5 快照为准。若文件随后被其他任务改动，请以表格中的“名字”重新 grep 后再删。
> 校验方式：acorn 解析脚本 AST（引用计数）+ 全文整词计数；**命中 1 = 除定义处外零引用**。
> 复现命令（二选一）：
> - ripgrep：`rg -c "\bopenRules\b" index_arcane_v2.html`
> - PowerShell：`(Select-String -LiteralPath .\index_arcane_v2.html -Pattern '\bopenRules\b' -AllMatches | %{$_.Matches.Count} | Measure-Object -Sum).Sum`

---

## 0. 结论摘要

| 类别 | 可处理量 | 风险 |
|---|---|---|
| 可立即删除（有 grep 证据 + 回归可验证） | **约 345 行** | 低 |
| 功能已关闭、删前需产品决策/断言 | **约 1,190 行** | 中–高 |
| 重复逻辑抽公共函数（重构，不删玩法） | **可减 150–260 行** | 中 |
| 调试 API 巨型函数（不是死代码，占 8,060 行） | 0 删除，仅建议拆分/延迟安装 | 高（164 个测试脚本依赖） |
| 图片资源 | **无未使用图片**（0 处 base64，12 个 SVG symbol 全部被动态引用） | — |

**总可删行数估算：345 行（立即）～1,535 行（含关闭功能）～1,800 行（含重构压缩）**，约占全文 2.5%–2.9%。
真正的大头不是死代码，而是 **`installDebugApi` 一个函数占 8,060 行（全文 12.8%）**：它不能删，但应当拆。

---

## 1. 死代码

### 1.1 零引用函数（14 个，含注释共 193 行）

| 函数 | 函数体 | 含前置注释 | 可删行 | 全文命中 | 动作 |
|---|---|---|---|---|---|
| `isRegionTransition` | L10895–10897 | L10888–10897 | 10 | 1 | 整块删除 |
| `roomRouteScore` | L14234–14241 | L14228–14241 | 14 | 1 | 整块删除 |
| `floorModDistribution` | L14260–14269 | L14255–14269 | 15 | 1 | 整块删除 |
| `seedSignatureOfRun` | L15759–15761 | L15754–15761 | 8 | 1 | 整块删除 |
| `pickRandom` | L15831–15833 | L15825–15833 | 9 | 1 | 整块删除 |
| `shuffleArray` | L15840–15848 | L15834–15848 | 15 | 1 | 整块删除 |
| `roomsConflict` | L18733–18740 | L18725–18740 | 16 | 1 | 整块删除 |
| `buildFallbackRooms` | L18876–18889 | L18871–18889 | 19 | 1 | 整块删除 |
| `randomPointInRoom` | L23147–23152 | L23140–23152 | 13 | 1 | 整块删除 |
| `clearTransientEffects` | L23185–23199 | L23181–23199 | 19 | 1 | 整块删除 |
| `clearFloorEntities` | L23204–23213 | L23200–23213 | 14 | 1 | 整块删除 |
| `drawRuneCircle` | L35931–35939 | L35923–35939 | 17 | 1 | 整块删除 |
| `openRules` | L46444–46446 | L46439–46446 | 8 | 1 | 整块删除（旧规则弹窗入口） |
| `captureRunSnapshot` | L49438–49445 | L49430–49445 | 16 | 2（1 处是注释） | 整块删除 |

**证据**：`rg -c "\b(isRegionTransition|roomRouteScore|...|captureRunSnapshot)\b"` 逐项 = 1（`captureRunSnapshot` = 2，其中 1 处为注释）。
AST 引用计数同样为 0，且不在 HTML 内联事件中。

### 1.2 零引用变量（1 行）

| 名字 | 位置 | 命中 | 动作 |
|---|---|---|---|
| `toastCooldownUntil` | L15423 | 1 | 删除声明 |

### 1.3 死 CSS（20 条规则，共 106 行）

判定方式：class token 在 `<style>` 之外的 HTML/JS 中出现次数 = 0，且**不属于任何动态拼接族**。

| CSS 规则 | 行范围 | 行数 |
|---|---|---|
| `.readout-floor > b` | L264–268 | 5 |
| `.btn-magic` | L593–597 | 5 |
| `.rules-grid` | L1648–1656 | 9 |
| `.rules-side` | L1697–1708 | 12 |
| `.rule-block` 系列（6 条） | L1709–1739 | 22 |
| `.help-grid` | L1973–1978 | 6 |
| `.title-duo` | L2567–2573 | 7 |
| `.title-duo-col` | L2576 | 1 |
| `.title-scroll` + 2 条滚动条伪元素 | L3499–3511 | 13 |
| `.title-actions` | L3633–3641 | 9 |
| `.title-foot` / `.title-foot b` | L3717–3724 | 8 |

缺失但有类名残留（规则与活类共享选择器，需人工确认后再删）：`.r-common`、`.setting-hint`、`.hud-icon`（约 5 行潜在收益）。
死类名清单（15 个）：`rule-block / title-duo / title-duo-col / title-scroll / title-actions / title-foot / readout-floor / readout-enemy / rules-grid / rules-side / help-grid / btn-magic / r-common / setting-hint / hud-icon`。

### 1.4 零 `var()` 引用的 CSS 变量（19 个）

`--panel-2`(L24)、`--panel-3`(L25)、`--warn`(L42)、`--fs-2xl`(L50)、`--fs-3xl`(L51)、`--glow-gold`(L62)、`--dur-slower`(L75)、`--sp-1`(L78)、`--sp-6`(L83)、`--ink-900`…`--ink-500`(L108–112)、`--line-ink`(L113)、`--vignette`(L114，定义 2 次)、`--ease-in`(L118)、`--dur-pop`(L119)、`--modal-gap`(L134)。

**证据**：全文整词命中数 = 1 或 2（只等于定义次数）。注：`--tag / --acc / --fc / --fv` 被 `var(--x, 回退值)` 使用，**不是死变量**（初筛误报，已排除）。

### 1.5 定义了但从未读取的配置键（26 个）

| 配置键 | 位置 | 备注 |
|---|---|---|
| `GAME_CONFIG.enemyBaseCount` / `enemyPerFloor` / `talentMaxLevel` | L5974 / 5975 / 5978 | 旧刷怪公式，已被敌人数预算系统取代 |
| `ASCENSION_CONFIG.unlockClears` | L7539 | 解锁逻辑在别处按通关数计算 |
| `REGION_CONFIG.blockSize` | L7914 | 未参与分区计算 |
| `ART_DIRECTION_CONFIG.maxSaturatedPerScreen` | L8090 | 美术限色开关未接线 |
| `FEEL_CONFIG.squashAmount` / `lethalSlowFrames` | L8324 / 8328 | 注释说控制受击挤压/击杀顿帧，实际未读 |
| `AIM_CONFIG.homingTurnRate` | L8410 | 追踪转向未走该键 |
| `MECH_SCENE_CONFIG.roomVariants` | L8780 | 房名表未使用 |
| `OVERDRIVE_CONFIG.hudWidth` | L8879 | HUD 宽度未读 |
| `TOWER_SHELL_CONFIG.maxAlpha` | L8936 | — |
| `MILESTONE_CONFIG.lineDuration` | L9511 | — |
| `TALENT_V2_CONFIG.storageMoney` | L10417 | — |
| `TALENT_PACE_CONFIG.crystalsPerFloorMin/Max` | L10477 / 10478 | 节奏改用别的口径 |
| `ENEMY_BUDGET_CONFIG.exclusivePerFloor` | L10788 | — |
| `OPEN_FLOOR_CONFIG.hullText` | L11676 | — |
| `UNLOCK_STATS.firstBattleAt` | L13235 | — |
| `BOSS_CONFIG.deepBossEvery` | L13841 | — |
| `COMBO_CONFIG.maxDisplay` | L14409 | HUD 未读 |
| `ENEMY_WARNING_CONFIG.contactLead` / `redundantMarks` | L14622 / 14628 | 注释称“复用旧配置”，实际未读 |
| `VOID_RIFT_CONFIG.usedGray` | L15004 | — |
| `CORRIDOR_PATROL_CONFIG.noContactDamage` | L15024 | **无效开关**（见 4.4） |
| `U10_CONFIG.wallLen` | L49976 | 注释自称“历史上限” |

**证据**：每个键名全文整词命中 = 1（仅定义处）。`rg -c "\benemyBaseCount\b"` 等逐项复核。
**排除的误报**：`FURNITURE_KINDS.crate/drawer/stool` 通过 `Object.keys` 动态使用；`REWARD_ICON_MAP` 的 `'magic:fireball'` 等字符串键通过 `kind + ':' + id` 动态查表——都**不是死代码**。

### 1.6 无引用 DOM id（6 个，仅删 id 属性，不删元素）

`aimNote`(L5499)、`infoLayerLabel`(L5611)、`archiveNote`(L5641)、`helpSection`(L5661)、`saveSlotSection`(L5676)、`aboutSection`(L5700)。
命中均为 1；`ui-patch.js` 中也无引用。收益低（0 行），仅作为第 4 档清理项。

### 1.7 图片资源

- `data:image` 内联位图：**0 处**。
- `<symbol>` 图标：12 个（L5070–5114），全部通过 `rewardIconId()` 返回 `'i-xxx'` 再拼成 `href="#i-xxx"` 动态引用（L44953–45016、L45030），**无死图标**。

---

## 2. 重复逻辑

| 重复簇 | 位置 | 相似度/规模 | 重复内容 | 建议与收益 |
|---|---|---|---|---|
| 6 个 AOE 施法函数 | `castLavaFissure` L40118–40170、`castArcanePool` L40177–40205、`castRuneOrbit` L40212–40247、`castCollapseHole` L40255–40304、`castFlameCone` L40311–40355、`castFrostRing` L40363–40409 | 0.62–0.80，约 290 行 | `cfg → 伤害 → 开关回退 → castAnim/角度 → vfx 取色 → aoeRecord → 遍历敌人 → 命中环/火花 → 多目标飘字` 每次都重写 | 抽 `beginAoeCast()` + `forEachEnemyInRange()` + `aoeHitFeedback()`，**可减 80–110 行** |
| 元素反应触发 | `triggerFrostBurst` L42849–42874 × `triggerConduct` L42882–42910 | 0.75 | 伤害计算、邻近目标、双环/火花、飘字、命中结算 5 段一致 | 抽 `reactionPrelude()`，**可减 10–15 行** |
| 隐藏房进出 | `enterHiddenRoom` L19917–19938 × `exitHiddenRoom` L19944–19958 | 0.67 | 取坐标、清速度、冷却、镜头快照、飘字、音效一致 | 抽 `teleportHidden()`，**可减 8–12 行** |
| 胜负结算 | `loseGame` L47620–47652 × `winGame` L48740–48779 | 0.67 | 写状态、清槽、存档、按键清空、演出、弹窗一致 | 抽 `settleRun(outcome)`，**可减 10–15 行** |
| 种子成绩记录 | `seedTouchRun` L49034–49049 × `seedRecordRun` L49056–49083 | 0.71 | 取槽、写纪录、更新 meta | **可减 8–12 行** |
| 屏幕边缘效果 | `drawLowHpVignette` L31157–31188 × `drawComboEdge` L31483–31526 | 0.69 | 渐变创建、alpha 曲线、边界裁剪一致 | 抽 `drawEdgeGlow()`，**可减 8–12 行** |
| 敌人分型绘制 | `drawExclusiveEnemy` 383 / `drawMechEnemy` 298 / `drawVoidEnemy` 277 / `drawRuneEnemy` 233 行 | 共享骨架 | 底盘、血条、受击闪白、异常层、朝向、死亡淡出 | 抽公共骨架可减 **150–250 行**，但视觉回归风险高，建议最后做 |
| 小地图两套 | `drawMinimap` L24733–25098 × `drawFullMap` L46215–46436 | 共享投影/缩放/迷雾 | 房间矩形投影、相机框、未探索处理 | 抽投影函数，**可减 30–50 行** |

高频惯用法（不建议全部抽象，只建议统一“数值格式化”）：
`Math.round` 568 次、`.toFixed` 340 次、`hexToRgba` 331 次（已有 helper）、`clamp` 213 次（已有 helper）、`addRing` 157 次、`ctx.save/restore` 127/128 对、`const player = state.player` 51 次、敌人遍历 56 处、`damageEnemy` 41 处调用。
→ 建议只新增 `fmtInt()` / `fmtPct()` 两个函数替换 HUD 内的重复格式化，预计减少 30–60 行并降低每帧字符串分配。

---

## 3. 超长函数（≥200 行，共 27 个）

| 行数 | 函数 | 位置 | 风险说明 |
|---|---|---|---|
| 8060 | `installDebugApi` | L54643–62702 | 巨型 `window.__roamDebug` 字面量；占全文 12.8%，必须拆分而非删除 |
| 574 | `bindEvents` | L53370–53943 | 键鼠/触屏/手柄耦合，拆分需输入回归 |
| 461 | `createInitialState` | L16567–17027 | 建议默认值表驱动 |
| 457 | `drawPlayer` | L35233–35689 | 更新+绘制混写，改动易破坏手感 |
| 416 | `paintMechRoomLayer` | L29577–29992 | 主题绘制分支，视觉回归成本高 |
| 383 | `drawExclusiveEnemy` | L32189–32571 | 与其余分型绘制重复，见第 2 节 |
| 366 | `drawMinimap` | L24733–25098 | 与小地图全图重复 |
| 353 | `drawEnemies` | L33581–33933 | 状态机 + 渲染 |
| 353 | `damageEnemy` | L43487–43839 | 与 `killEnemy`(233 行) 死亡结算重叠 |
| 298 | `drawMechEnemy` | L32578–32875 | 同上 |
| 294 | `generateFloor` | L20830–21123 | 生成逻辑多分支 |
| 277 | `drawVoidEnemy` | L33121–33397 | 同上 |
| 275 | `updateEnemies` | L41995–42269 | AI 全类型混写 |
| 265 | `paintThemeProps` | L27975–28239 | 主题道具分支 |
| 259 | `paintRoomTypeDecor` | L29140–29398 | 房型装饰分支 |
| 241 | `cacheUi` | L23224–23464 | 静态 DOM 缓存，可改脏标记 |
| 233 | `drawRuneEnemy` | L32882–33114 | 同上 |
| 233 | `killEnemy` | L43988–44220 | 掉落/成就/演出混写 |
| 224 | `damagePlayer` | L44249–44472 | 受击/护盾/死亡混写 |
| 222 | `drawFullMap` | L46215–46436 | 见第 2 节 |
| 219 | `paintThemeFloorDetail` | L28351–28569 | 视觉 |
| 218 | `normalizeMeta` | L16072–16289 | 存档兼容，表驱动可减 40+ 行 |
| 215 | `drawBossBody` | L34171–34385 | 视觉 |
| 215 | `enemySignatureStep` | L41707–41921 | AI |
| 211 | `spawnEnemiesForFloor` | L21232–21442 | 生成 |
| 210 | `updateBossEnemy` | L22331–22540 | AI |
| 209 | `paintRoomFloor` | L27400–27608 | 视觉 |

**只标风险，不建议本轮拆分**：这些函数都处在“改一行就影响手感/视觉”的路径上，收益是维护性，代价是回归成本。

---

## 4. 可疑配置

| # | 位置 | 现象 | 判断 |
|---|---|---|---|
| 4.1 | `WEAPON_CONFIG.enabled=false` L6020；`WEAPON_TAG_CONFIG.enabled=true` L6007；`currentWeaponTag()` L17141 | 武器总闸关死 → `weaponEnabledNow()` 恒 false → `currentWeaponTag()` 恒 null；但标签配置仍为 true | 自相矛盾的开关；标签系统在运行时永远不生效 |
| 4.2 | `FUSION_HINT_CONFIG.enabled=true` L44740；`weaponFusionHintForOption` L44804–44824；调用 L45050–45058 | C1 批已删掉 5 条武器标签配方（代码注释 L17137、L17152 自证），该函数只筛 `fusion.weaponTag`，结果恒 null | **恒空 UI 链路**：函数 21 行 + 调用/徽章/`is-weapon` CSS 约 33 行 |
| 4.3 | `UNEXPLORED_HINT_CONFIG.enabled=false` L7768；使用 L26172 | L26172 直接 `return`，其后 L26201/L26214/L26221 三档绘制永远不执行 | 关闭功能的分支，约 54 行运行时死代码 |
| 4.4 | `CORRIDOR_PATROL_CONFIG.noContactDamage=true` L15024 | `spawnCorridorPatrols` L21488–21524 只读 `enabled/minFloor/maxPerFloor/chance/types/range/speedMul/sizeMul`，**从不读 `noContactDamage`** | **无效开关**：配置写着“巡逻怪不造成接触伤害”，代码未接线（需确认巡逻怪是否另有免伤逻辑） |
| 4.5 | `FEEL_CONFIG.squashAmount` L8324 / `lethalSlowFrames` L8328 | 注释描述“受击挤压幅度 / 击杀顿帧”，全文零读取 | 注释与代码不符，调参无效 |
| 4.6 | `GAME_CONFIG.enemyBaseCount/enemyPerFloor` L5974–5975 | 注释 `3 + 层 × 1.5` 仍描述旧公式 | 旧公式残留，新刷怪走预算系统 |
| 4.7 | `ENEMY_WARNING_CONFIG.contactLead` L14622 | 注释“复用 ENEMY_WINDUP_CONFIG.time，避免两套数字”，实际未读 | 注释误导 |
| 4.8 | `GAME_CONFIG.worldWidth` 等 9 项 L5902–5987 | L8252 顶层立即调用 `applyRoomScaleConfig()`，按 `ROOM_SCALE_BASE × 1.25` 覆盖 | 声明值不是运行值；读者容易按错误数字调参（**不要删**，被 BASE 快照引用） |
| 4.9 | `U10_CONFIG.wallLen=72` L49976 | 注释自称“历史上限（实际用走廊宽度）” | 死配置 |
| 4.10 | `TALENT_PACE_CONFIG.crystalsPerFloorMin/Max` L10477–10478 | 零读取，节奏由别处计算 | 注释与实现脱节 |
| 4.11 | `HUD_MODE_CONFIG` L54652 + `applyHudMode()` L54658 | 生产 HUD 的 compact/minimal 配置**定义在 `installDebugApi` 内部**，且开机即执行 | 位置错误；也是“调试 API 无法直接延迟安装”的根因 |
| 4.12 | `metrics.*` L57261–57274（9 个字段） | 主文件内部零读取 | 可能是给 164 个测试脚本的**外部契约**，删前必须全库 grep |
| 4.13 | `fresh.runId / fresh.lastTime / fresh.talentRerolls` L16597/L16945/L16834 | 只写不读（存档字段） | 删除会改变存档布局，需兼容断言 |

> 全文无 `if(false)` / `if(true)` 字面量分支（扫描结果 0），可疑点主要是“配置键未接线”，而不是硬编码死分支。

---

## 5. 风险排序（删了会坏吗 × 收益）

### A 档 · 可立即删（有断言可验证）

| 项 | 位置 | 减少行数 | 验证方式 |
|---|---|---|---|
| 14 个零引用函数 | 见 1.1 | **193** | `rg` 命中保持 1→删后 0；`tools/arcane_syntax.js` + `tools/arcane_verify.js` |
| 20 条死 CSS 规则 | 见 1.3 | **106** | 截图对比（标题/设置/小地图三张） |
| 19 个死 CSS 变量 | 见 1.4 | **19** | 同上 |
| 26 个死配置键 | 见 1.5 | **26** | 语法 + 一局完整跑通（配置只影响调参，不影响逻辑） |
| `toastCooldownUntil` | L15423 | **1** | 语法 |
| 6 个死 id 属性 | 见 1.6 | 0 | 仅降低 DOM 噪音 |
| **合计** | | **≈345 行** | |

执行建议：分 5 个小批次，每批一次 `node tools/arcane_syntax.js`，每批后跑 `arcane_verify.js`（避免一次大面积 diff 无法定位）。

### B 档 · 需先加断言/产品决策再删

| 项 | 位置 | 可减行数 | 前置条件 |
|---|---|---|---|
| 武器子系统（配置块 + 函数 + 标题/HUD 入口） | L5998–6104、L6115–7130、L5820–5843、L5272 等 | **≈1,067 行**（实测唯一行） | `WEAPON_CONFIG.enabled` 是有意关闭；删除会破坏 `tools/arcane_weapons.js`、`arcane_fusion.js`，需产品确认“永久不做” |
| 武器标签/三输入融合残留 | L6006–6015、L17141–17147、L44804–44824、L45048–45058、L2961–2980、L1285–1286 | **≈54 行** | C1 已删配方；先确认调试口 `__roamDebug.fusion.tags()` 是否还要保留 |
| 未探索提示渲染 | L26172–26225 | **≈54 行** | 确认不再 A/B 开启 |
| `activeFusionList()` 直通包装 | L17156–17158 | **3 行** | 3 处调用点同步内联 |
| 只写不读的 state 字段 | 见 4.13 | **≈15 行** | 存档兼容断言 + 外部脚本确认 |
| AOE 施法骨架抽取 | L40118–40409 | **80–110 行** | 6 个技能的伤害/命中数断言（`arcane_p0aoe.js`、`arcane_duoaltar.js`） |
| 元素反应/胜负/隐藏房去重 | 第 2 节 | **≈45 行** | 专项断言 + 一局通关回归 |
| `installDebugApi` 延迟安装 | L54643 调用点 L62759 | 0（结构优化） | **164/192 个 tools 脚本依赖**，必须保留 `window.__roamDebug`；建议 `?debug=1` 时安装，并让脚本统一加参 |
| **合计** | | **≈1,190 行 + 150 行重构** | |

### C 档 · 别动

1. **`installDebugApi` / `window.__roamDebug` / `window.__talentDebug`**：164 个测试脚本依赖，删了整条验收链断掉。
2. **事件房“旧路径”**：`u11cLegacyEvents`（命中 4）、`u11cPickEvent`（2）、`applyRoomReward` 的 `room.type==='event'` 分支仍会在 `setupEventRoom` 找不到落点时兜底——**不是死代码**。
3. **长函数**（第 3 节）：手感/视觉路径，收益低、回归高。
4. **`FURNITURE_KINDS` 键、`REWARD_ICON_MAP` 字符串键、12 个 SVG symbol**：动态使用，已确认非死。
5. **`rarity- / reward- / is- / mod- / tal-` 前缀 CSS 族**：由 `'rarity-' + rarity.id`、`'reward-' + option.kind`、`'is-' + st` 动态拼接（L45055、L24611），**不是死 CSS**。
6. **`HUD_MODE_CONFIG`**：在移出调试函数前不要动，否则 `hud-compact` 失效。
7. **`GAME_CONFIG` 被覆盖的 9 个尺寸默认值**：被 `ROOM_SCALE_BASE` 读取，删了会少一层基准。

---

## 6. 额外优化清单（项目收尾用，20 条）

> 前 5 条是本次审计直接产出的清理项，其余为结构性优化建议；均不改变玩法。

| # | 建议 | 收益 | 风险 |
|---|---|---|---|
| 1 | 删 14 个零引用函数（1.1） | -193 行 | 低 |
| 2 | 删 20 条死 CSS（1.3） | -106 行 | 低 |
| 3 | 删 19 个死 CSS 变量（1.4） | -19 行 | 低 |
| 4 | 删 26 个未接线配置键（1.5），同步修注释 | -26 行，消除误导 | 低 |
| 5 | 删 `toastCooldownUntil`、6 个死 id | -1 行 | 低 |
| 6 | 把 `installDebugApi` 按域拆成 8 个子对象（weapons/fusion/feel/audio/branding/regions/crash/map） | 可读性，便于按需维护 | 中（测试脚本路径不变） |
| 7 | 调试 API 改为 `?debug=1` 延迟安装，`HUD_MODE_CONFIG` 上移到生产配置区 | 首帧启动更干净 | 中（164 脚本需统一加参） |
| 8 | `bindEvents`（574 行）按“键鼠 / 触屏 / 手柄 / 窗口”拆分 | 可维护性 | 中 |
| 9 | `createInitialState`（461 行）默认值改表驱动 | -100 行潜力 | 中 |
| 10 | `damageEnemy`（353）+ `killEnemy`（233）抽“死亡结算”公共段 | -80 行潜力 | 中高 |
| 11 | 4 个分型敌人绘制共用底盘/血条/受击闪白骨架 | -150~250 行 | 高（视觉回归） |
| 12 | `drawMinimap` / `drawFullMap` 共用投影与迷雾处理 | -30~50 行 | 中 |
| 13 | 6 个 AOE 技能统一施法骨架 | -80~110 行 | 中（命中数断言可保） |
| 14 | 新增 `fmtInt/fmtPct`，替换 HUD 内 340 处 `toFixed` 中的重复格式 | -30~60 行，减少每帧分配 | 低 |
| 15 | `cacheUi`（241 行）改为脏标记刷新，避免每帧重建字符串 | 性能 | 中 |
| 16 | 清理 C1 后的武器融合提示链路（函数+调用+CSS） | -54 行 | 中（需产品确认） |
| 17 | `activeFusionList()` 直通函数内联 | -3 行 + 少一层间接 | 低 |
| 18 | 校验并修复 `noContactDamage` 无效开关（或接线、或删键） | 消除玩法误解 | 低（需确认设计意图） |
| 19 | 统一 media query 断点（标题/设置/HUD 存在多份重复块） | 减少 CSS 分叉 | 低 |
| 20 | 把 C1/X/W/U9 等“批次标记注释”归档到 CHANGELOG，代码只留结论 | 12,085 行注释可压缩 20–30% | 低 |
| 21 | 6 个无引用配置键（`enemyBaseCount` 等）与 FEEL 两键补注释“已废弃” | 防止后人误调 | 低 |
| 22 | 武器子系统若要长期保留，加一条“开关为 false 时工具链跳过”的断言，避免测试脚本误报 | 测试稳定性 | 低 |

---

## 7. 建议执行顺序（每步可回滚）

1. **批次 1（零风险）**：1.1 的 14 个函数 → 语法 + verify。
2. **批次 2（零风险）**：1.3 + 1.4 的 CSS（死类 + 死变量）→ 三张截图对比。
3. **批次 3（零风险）**：1.5 的 26 个配置键 + 1.2 的变量 + 1.6 的 id → 语法 + 一局通关。
4. **批次 4（需确认）**：C1 武器融合残留（4.2）→ 保留 `__roamDebug.fusion.tags()` 作为只读接口。
5. **批次 5（需决策）**：武器子系统整体（B 档）——只有确认“永久不做武器”才执行，并同步删除/跳过 `arcane_weapons.js`、`arcane_fusion.js`。
6. **批次 6（结构）**：拆分 `installDebugApi`、上移 `HUD_MODE_CONFIG`、延迟安装；每拆一个命名空间跑一次全量脚本抽查。

---

## 8. 风险与保留意见

- **行号漂移**：主文件正被其他任务（ui-patch / touch 适配）改动，删除前请以本报告 MD5 校验；不一致时按“名字”重新 grep。
- **工具链强依赖**：`tools/` 下 192 个脚本中 **164 个**引用 `__roamDebug/__talentDebug`，任何“删调试 API”的方案都会直接破坏验收体系，因此本报告只建议拆分/延迟安装，不建议删除。
- **关闭≠死代码**：武器系统、未探索提示、武器融合提示是“功能开关关闭”，删除属于产品决策，不属于纯清理；本报告将其单列为 B 档。
- **误判已排除**：动态 CSS 前缀族、`Object.keys` 配置表、SVG symbol 动态 `href`、`var(--x, fallback)` 变量均已人工复核，未计入死代码，避免“删了会坏”。
