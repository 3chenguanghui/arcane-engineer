# U8 · 任务拆解

| # | 任务 | 产出 | 状态 |
|---|---|---|---|
| U8-1 | 写 spec（根因 / 改法 / 断言 / 取舍） | `.spec/u8-juice/spec.md` | ✅ |
| U8-2 | HTML 增加 `#bossTitle` 三层结构 | `index_arcane_v2.html` | ✅ |
| U8-3 | CSS `.boss-title` + 四段关键帧（2.3s 收起） | 同上 | ✅ |
| U8-4 | `ui.bossTitle*` 绑定 + `showBossTitle()` | 同上 | ✅ |
| U8-5 | `startBossIntro()` 调用大字 | 同上 | ✅ |
| U8-6 | `nextSfxVariation()` + `playSfx()` 接入 | 同上 | ✅ |
| U8-7 | `__roamDebug.setU8 / sfxJitter / previewBossTitle` | 同上 | ✅ |
| U8-8 | 语法检查 | `node tools/arcane_syntax.js` → PASS | ✅ |
| U8-9 | 新建 `tools/arcane_u8.js`（端口 9492，12 项断言 + before/after 截图） | `tools/arcane_u8.js` | ⏳ |
| U8-10 | 跑验收 + 14 套回归 + PROGRESS 落盘 | `.screenshots/art/u8-*.png`、`PROGRESS.md` | ⏳ |
