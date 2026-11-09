# U2 · 任务拆解（敌人威胁语法）

| 编号 | 任务 | 完成判定 |
|---|---|---|
| U2-0 | 现状盘点：列出 18 只怪的 `ai` 字段与所在池 | 3 套模板 / 3 池各 5 只，写进 spec 表 |
| U2-1 | 新增 `ENEMY_AI_V2_CONFIG`（10 块参数）+ `ENEMY_AI_V2_ROLES`（每只 2–3 块） | 覆盖 3 池 15 只 + 旧 3 只 |
| U2-2 | `spawnEnemy` 增加 `aiV2` 运行时（状态机字段、召唤计数、后撤冷却、未受伤计时） | 新怪出生即带 `aiV2` |
| U2-3 | `updateEnemies` 接入 `updateEnemyThreatV2()`，`state.aiV2=false` 时走旧分支 | 旧 3 套行为可 A/B 复现 |
| U2-4 | 实现块：`chase / kite / orbit`（移动） | 距离/角度采样符合配置 |
| U2-5 | 实现块：`suppress / charge / burst`（攻击 + 前摇 + 结算） | 前摇可读、可打断、结算有伤害 |
| U2-6 | 实现块：`summon / selfdestruct / dodge / shieldRegen` | 召唤上限 2、濒死自爆、后撤、回盾 |
| U2-7 | `damageEnemy` 接入打断判定（≥8 伤害取消前摇）+ 受伤重置回盾计时 | 前摇中被打 → recover |
| U2-8 | 可视化 `drawAiV2Telegraph()`：冲锋锁定线、爆发范围圈、召唤环、压制瞄准线、自爆闪烁 | 同屏能读出 ≥3 种节奏 |
| U2-9 | `__roamDebug` 验收接口：`setAiV2 / aiV2 / aiAudit / threatSnapshot / spawnThreat / forceBlock` | 脚本可确定性驱动每个块 |
| U2-10 | `tools/arcane_l2.js`（端口 9490）before/after 截图 + 13 类断言 + fps | 全部 PASS（after） |
| U2-11 | 14 套回归 + PROGRESS 落盘 | 全绿，写入数据与风险 |

## 验证命令

```powershell
node tools/arcane_syntax.js
node tools/arcane_l2.js before
node tools/arcane_l2.js after
node tools/arcane_m12.js ; node tools/arcane_m13.js ; node tools/arcane_m14.js
node tools/arcane_m18.js ; node tools/arcane_m19.js ; node tools/arcane_m20.js
node tools/arcane_m21.js ; node tools/arcane_m22.js ; node tools/arcane_m23.js
node tools/arcane_m24.js ; node tools/arcane_m25.js ; node tools/arcane_verify.js
node tools/arcane_fusion.js ; node tools/arcane_facing.js
```
