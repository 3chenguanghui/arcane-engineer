# 像素特效复核 + 补强 任务清单（每步完成即写 PROGRESS）

## 批次 1 · 验活
- [x] `tools/arcane_fxaudit.js` 骨架（端口 9504，CDP 复制 u11c）
- [x] dissolve / glitch / scanline / impact / shatter 五项断言 + 5 张截图
- [x] 失效项修复（如有）

## 批次 2 · 震撼补强（配置 + 实现）
- [x] `PIXEL_FX_CONFIG.burst / lowHp / magnet / milestone / bossPhase / tier`
- [x] `state.fx.bursts / magnet / screen / screenLog / lastBurst`
- [x] `spawnBurst()` + `drawBurstRings()`（世界层，多环 + 白芯 + 色温偏移）
- [x] `drawLowHpVignette()`（屏幕层，心跳脉冲）
- [x] `spawnMagnetStreams()` + `drawMagnetStreams()`
- [x] `requestScreenFx() / drawScreenFx()`（径向光柱 + 闪白 + 边框脉冲 + 层互斥）
- [x] 接线：AOE / 暴击 / 击杀 / 10 连 / Boss 转换 / 拾取
- [x] 清房过场 `clear`（档位 2）+ 下楼过场 `descend`（档位 3，叠在 dissolve 上）
- [x] `drawScreenFx` 档位 ≥2 追加中心爆闪 + 扩散环

## 批次 3 · 量化 + 验收
- [x] `FEEL_TARGETS.md` 追加 FX1–FX8（含实测值）
- [x] `tools/arcane_fxaudit.js` A1–A16 全跑（16/16 PASS）
- [x] 截图复核（before/after）
- [x] 14 套回归串行（m21 29/40、m24 29/30 首轮失败 → 单跑复验 40/40、30/30，判定抖动非回归）
- [x] PROGRESS 收口 + 下一步一句话
