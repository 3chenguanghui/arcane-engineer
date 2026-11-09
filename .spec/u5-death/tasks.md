# U5 · 任务拆解（死因台词 + 结算自传）

| 编号 | 任务 | 完成判定 |
|---|---|---|
| U5-0 | 盘点现状：`damagePlayer` 无来源身份、`showResult` 只有数字 | 写进 spec 根因 |
| U5-1 | 新增 `U5_CONFIG`（7 类台词 ×2 + 3 条首领台词 + 自传模板开关） | `u5Audit()` 可读出 |
| U5-2 | `damagePlayer(amount, sx, sy, cause)` 记录 `state.lastHit`（真实扣血才记） | 无敌帧挡掉不写 |
| U5-3 | 全量调用点补 `cause`：接触 / 冲锋 / 爆发 / 自爆 / 弹幕 / 危险区 / 首领 | `grep damagePlayer(` 每处都有第 4 参 |
| U5-4 | `resolveDeathCause()`：首领优先 + 按 `(floor+kills)%2` 选句 | 返回 `{kind,label,quote,extra}` |
| U5-5 | `damageEnemy()` 记录 `state.runBest`（最锋利一击） | 大伤害覆盖旧值 |
| U5-6 | `buildRunAutobiography()`：路线 / 战力 / 构筑三句 + 缺失标签 | 文本三要素齐全 |
| U5-7 | `showResult()` 插入塔灵台词块 + 自传 + `data-death-cause` | 死亡面板可读 |
| U5-8 | `showVictory()` 插入同一段自传 | 通关面板可读 |
| U5-9 | CSS：`.tower-voice` / `.run-autobiography` / 六边星头像（纯 CSS） | 11px 字号下限、不挤压统计 |
| U5-10 | `state.u5V1` A/B 开关 + `__roamDebug`：`u5Audit / setU5 / killBy / resultText / autobiography` | 脚本可确定性驱动 |
| U5-11 | `tools/arcane_u5.js`（9496）14 项断言 + before/after 截图 | 全部 PASS |
| U5-12 | 14 套回归 + PROGRESS 落盘 | 全绿，写入数据与风险 |

## 状态：全部完成（2026-11-04）

- U5-0 ~ U5-12 全部落地；`tools/arcane_u5.js` **19/19 PASS**（avgFps 120、errors 0、3 张截图）。
- 14 套回归全绿；m20 另修 3 处采样问题（`state.uiV2` 网格线 / 已探索走廊重叠 / 走廊末端顶墙），连跑 4 次 45/45。
- 落盘：PROGRESS 顶部 U5 条目（含风险 4 条、下一项 U9 标题屏减法）。


```powershell
node tools/arcane_syntax.js
node tools/arcane_u5.js
node tools/arcane_m12.js ; node tools/arcane_m13.js ; node tools/arcane_m14.js
node tools/arcane_m18.js ; node tools/arcane_m19.js ; node tools/arcane_m20.js
node tools/arcane_m21.js ; node tools/arcane_m22.js ; node tools/arcane_m23.js
node tools/arcane_m24.js ; node tools/arcane_m25.js ; node tools/arcane_verify.js
node tools/arcane_fusion.js ; node tools/arcane_facing.js
```
