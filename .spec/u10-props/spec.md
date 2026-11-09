# U10 · 爆炸桶 + 可破坏墙（环境参与战斗）

> 出处：`.spec/round4-5-merge.md` **A8**（可互动道具：爆炸桶 / 可破坏墙，P2）、单元表 **U10**（依赖 U7）。
> 验收目标：**打爆桶能伤敌；打穿墙能进捷径。**

---

## 1. 根因

1. **环境是背景板**：U7 之后柱子终于能挡弹幕，但房间里的所有东西仍然"不可回应" —— 玩家没有任何一个"用房间本身打怪"的选择。
2. **弹幕没有落点价值**：敌人弹幕打到墙只是消失，墙既不裂也不塌，"掩体"只对玩家单向有效。
3. **房间缺少可选路线**：走廊只有一条官方通路，房间与走廊之间的隔墙是纯装饰，探索没有"我自己开一条路"的收益。

## 2. 改法

### A. 数据与生成
- 新增 `U10_CONFIG`：`barrelHp 24`、`barrelRadius 13`、`blastRadius 92`、`blastDamage 26`、`fuse 0.18`（引信延迟，给敌人一次逃开机会）、`wallHp 60`、`wallThickness 18`、`wallLen 72`、`chainLimit 2`。
- 新增本层状态 `state.props = { barrels: [], breakables: [] }`，在 `generateFloor()` 开头清空（不跨层）。
- 新增 `spawnFloorProps()`，插在 `createVoidRift()` 之后、`buildAtmosphere()` 之前（此时 `walkBlockers` 已建好、隐藏暗门已选墙，不会冲突）：
  - **桶**：战斗 / 精英房每间 1–2 个（`(room.id + floor) % 2` 决定数量，确定性）；落点=以房心为中心 45–`min(w,h)*0.32` 的环上取 4 个候选，过 `isWalkableCircle(r=15)` 与 `isWalkBlocked` 双检，再排除房心符文圈（≥42px）与门洞（离 `state.doors` 对应点 ≥46px）。
  - **墙**：每层 1 段，只在"房间边与走廊矩形相邻"的墙段上取；取该边中点向两侧各 `wallLen/2`，注册为 `{kind:'rect', x, y, w, h, uid, wall:true}` 进 `state.walkBlockers`。
- 两者都带 `uid`（`'b' + 序号` / `'w' + 序号`），便于破坏时精确移除 blocker。

### B. 命中与爆炸
- 统一入口 `hitProp(prop, amount, dirAngle)`：桶 / 墙都走这里，扣 `hp` → 归零触发 `explodeBarrel()` / `breakWall()`。
- `explodeBarrel(barrel)`：
  1. 画一圈冲击环 + 12 片火星 + 震屏 0.28s + `flashScreen`；
  2. 半径内敌人 `damageEnemy(e, blastDamage × 距离衰减)`，并给 0.25s 击退；
  3. 半径内玩家 `damagePlayer(blastDamage × 0.8 × 衰减, barrel.x, barrel.y, {kind:'barrel', name:'爆炸桶'})` —— 走 U5 死因链；
  4. 链式引爆：半径内的其他桶进入 `fuse` 倒计时，`chainLimit` 限制本帧最多连锁 2 个，避免整层瞬爆。
- 弹体命中道具：`updateBullets()` 里在"撞墙/出界"判定前，先查 `props` 圆形/矩形相交 → `hitProp` 并消耗弹体（`aoe` 类弹体震波同样生效）。

### C. 破坏墙
- `breakWall(wall)`：从 `state.walkBlockers` 移除对应 uid、从 `state.props.breakables` 移除、补 18 片碎石 + 一次"墙体崩塌"抖动；不重新 `rebuildRoomWalkGeometry()`（避免把 U7 的整层几何重算一次）。
- 视觉：未破坏时按 `hp/maxHp` 画 2–4 条裂纹（画在世界层，随进度加深）；破坏后只留地面缺口（地板烘焙本身不动，所以缺口用一层"碎砖堆"提示曾经有墙）。

### D. 渲染与 A/B
- `drawFloorProps()` 在 `drawScene()` 之后、实体之前画：桶 = 圆柱 + 顶盖六边星 + 警示带（hp 越低红环越急）；墙 = 砖块 + 裂纹。
- `state.u10V1`：`false` 时不生成任何桶 / 墙、不注册额外 blocker（回到 U7 的纯立柱环境），用于对照与回归。
- `__roamDebug` 新增 `setU10 / u10Audit / hitBarrel / breakWallTest / propsCount`。

## 3. 保留约束

1. 不改移动 / 碰撞主循环：墙只借用 `walkBlockers` 的既有减法，桶**不进** `walkBlockers`（可穿过，避免把通道挤死）。
2. 不改 U7 形状 / 立柱规则、不改清房与锁门流程（m20 / m25 依赖）。
3. 桶与墙都是纯 Canvas 绘制，零图片资源。
4. 爆炸伤害必须走既有 `damageEnemy` / `damagePlayer`，不另开伤害通道（否则暴击 / 裂印 / U5 死因全部失效）。
5. U5 死因表需新增 `barrel`（爆炸桶）与 `collapse`（墙体崩塌）两条，否则会落到 `unknown`。

## 4. 验收断言（`tools/arcane_u10.js`，端口 9498）

| # | 断言 | 口径 |
|---|---|---|
| 1 | 每层有桶且落点合法 | 桶数 ≥1；每个桶 `isWalkableCircle(15)` 为真、离房心 ≥42px、不在障碍内 |
| 2 | 桶可被打掉血 | `hitBarrel(id, 10)` 后 `hp` 减少且未爆 |
| 3 | 打爆伤敌 | 桶旁放一只怪，打爆后该怪 `hp` 下降（≥ blastDamage × 0.5） |
| 4 | 打爆伤己 | 玩家站在桶旁打爆 → 扣血且 `state.lastHit.kind === 'barrel'` |
| 5 | 链式有上限 | 三个桶排一米字，打爆一个 → 本帧连锁 ≤2 个 |
| 6 | 墙初始不可走 | `isWalkBlocked(墙心, 12)` 为真，且 `walkBlockers` 里有 `wall:true` 项 |
| 7 | 打穿后可走 | `breakWallTest()` 后同一坐标为假，`walkBlockers` 数量 −1 |
| 8 | 真的开出捷径 | 破坏后从墙内侧点到走廊点的直线中点全部 `isWalkableCircle` |
| 9 | 换层清零 | `setFloor(f+1)` 后旧桶 uid 全部消失，新层桶数重新 ≥1 |
| 10 | A/B 关闭 | `setU10(false)` → 桶 0、`wall:true` blocker 0；重开恢复 |
| 11 | 性能 + 错误 | avgFps ≥ 60、errors 0 |
| 12 | 截图 | 桶特写 / 打爆后 / 破墙通路，3 张 > 10KB |

## 5. 取舍

- **桶不做实体碰撞**：桶要是挡路，在窄房间里会直接把通路堵死（U7 的 L 形房尤其危险）；"能穿过去"比"能挡住"更安全。
- **墙只移除 blocker、不重建整层几何**：`rebuildRoomWalkGeometry()` 会把 U7 的模板形状整层重算，一处失败就是"整层空气墙"，风险远大于收益。
- **链式引爆设上限**：不限的话，桶挨得近会一次性炸掉整层怪，等于给玩家一发清场；上限 2 保持"可预期的小连锁"。
- **每层只 1 段墙**：多段墙会让"官方通路"失去意义，也让 m20 迷雾足迹断言变脆。
