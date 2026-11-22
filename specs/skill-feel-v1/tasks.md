# skill-feel-v1 任务分解

> 每个任务独立可验证；S1/S2 依赖同一处 `drawRingShape` 扩展，先做 S1 再做 S2。

## S0 前置

- [x] S0-1 复核主文件 2,947,258 B / `ADE53A18E96D758E531B5C53BB8FB13E`（已核）
- [x] S0-2 备份 `backup/index-pre-skillfeel.html`，记录字节数 + MD5
- [x] S0-3 记录 `tools/sim_panel/sim.js` / `config.js` 的 MD5 作为不变基线

## S1 技能手感与表现（第 1 次上报）

- [x] S1-1 新增 `SKILL_SIG`（20 条：shape/color/size/dir/sfxRate/sfxVol），位置在 `SKILL_POOL_CONFIG` 之后
- [x] S1-2 新增 `SIG_SHAPES` 归一化路径表 + `drawSigShape()`（20 形状，双遍描边：暗底 + 主色）
- [x] S1-3 `drawRingShape` 顶部接入 `SIG_SHAPES` 分支；`dir` 形状旋转到 `ring.dir`
- [x] S1-4 `addRing` 增加 `dir: 0`、`casing: state.fxTierNow != null` 两个字段；`drawRingShape` 按 `casing` 画暗底
- [x] S1-5 新增 `spawnCastSignet(magic, fusion)`（直接 push 两枚环，绕开 tier 放大，零 rand）
- [x] S1-6 `castSlot` 在 `fxTierNow` 置档后调用 `spawnCastSignet`，并把 `playSfx('cast', 0.5)` 改为带 `sfxRate/sfxVol`
- [x] S1-7 `castBlade` 施法音 `ui` → `bolt`；`castMine` 施法音 `frost` → `fuse`
- [x] S1-8 语法检查 `node tools/arcane_syntax.js` + 页面 boot error 0
- [x] S1-9 探针：20 技能逐条强制释放，断言签名环存在 / life ≤ 0.45 / casing 存在（9/9 PASS）
- [x] S1-10 随机数审计：新增代码 `rand(` 计数 = 0
- [x] S1-11 上报：字节数 / MD5 / 双击路径 / 同屏截图

## S2 技能可读性（第 2 次上报）

- [x] S2-1 `.mini-card.magic::before` 左缘色条 CSS
- [x] S2-2 `renderDeck` 合并写入 `--mc`（保留 `--fv`）
- [x] S2-3 20 行可读性表（技能 → 主色 → 形状 → 元素 → 施法音高 → 能否一眼认出）
- [x] S2-4 验收：左缘色 RGB 去重 = 20；同屏三技能截图可辨；error 0
- [x] S2-5 上报（含字节数 / MD5）

## S3 体检表 + 前 2 项（第 3 次上报）

- [x] S3-1 输出六维体检表（UI / 动画 / 手感 / 性能 / 无障碍 / 文案），标注已做/未做/收益/成本
- [x] S3-2 落地①：`updateEffects` 增加 `RING_SOFT_CAP = 120` 软上限（删最老）
- [x] S3-3 落地②：`spawnCastSignet` 尊重 `prefers-reduced-motion`（静态环，无动画）
- [x] S3-3b 追加：reduced-motion 同时取消屏幕震动平移（零随机数影响）
- [x] S3-3c 追加：命中飘字按 `opts.abilityId` 取技能主色（暴击/重击/回程优先级不变）
- [x] S3-4 验收：连发压力下 `rings.length ≤ 120`；reduced-motion 下签名环 grow = 0（16/16 PASS）
- [x] S3-5 终验：语法 PASS、页面 error 0、sim 文件 MD5 未变、新增代码随机数 0
- [x] S3-6 上报（含字节数 / MD5 / 最终结论）

## 回滚点

- 任一任务失败或越红线：`Copy-Item backup\index-pre-skillfeel.html index_arcane_v2.html -Force`
