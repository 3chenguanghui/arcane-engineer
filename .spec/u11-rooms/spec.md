# U11a · 商店房（新房型 + 局内货币「余烬」）规格

> 出处：`.spec/round4-5-merge.md` 条目 **A11 商店房 / C5 局内商店**，单元表 **U11**（验收："至少 1 个新房间类型可进入并结算"），依赖 U1（标签乘算）/ U2（五层一局）。
> 本轮只做 U11a「商店房」；U11b 生存房、U11c 变量事件在本单元收口后按同一模板续写（见 tasks.md 末节）。

---

## 1. 根因

1. **房间只有"打"和"捡"两种**：战斗 / 精英 / 首领 / 宝箱 / 事件 / 休整 / 秘藏，全部是"进房 → 自动结算"。玩家没有任何**主动消费**的动作，一局的资源曲线只能靠随机掉落。
2. **局内没有货币**：`state.crystalsEarned` 与 `meta.crystals` 是局外永久货币（关掉游戏也在），`state.shards` 只是一个从未被读取的遗留计数器。想在局内交易，必须先有一份"只在本局有效"的钱。
3. **标签乘算（U1）已经能放大单卡，但没有"买什么"的选择**：有了商店，玩家才能在"补生存 / 补输出 / 补容量"之间做取舍，构筑从"抽到什么"变成"抽到什么 + 换到什么"。

## 2. 目标（可一句话验收）

**第 2 层起，房间数 ≥6 的层保底 1 间「商店房」（抽样里 ≥2 层命中）；走进去靠近展台按 E 可以花「余烬」买下 3 件商品中的 1 件；买完钱减少、属性立即变化、该商品在本层永久售罄。**

## 3. 经济定义（新，但只在本局内）

- 货币名：**余烬 EMBER**，字段 `state.embers`（整数）。
- 来源：击杀即得，不新增掉落实体——
  - 普通敌人 `+1`；分裂子体 `+1`（同普通）；
  - 精英 `+3`（与原「精英结晶 +1」并列，不替换）；
  - 首领 `+6`。
- 销毁：`createInitialState()` 里初始化为 `0`，所以 `restartRun()` / 新一局自动归零；`generateFloor()` **不清**（跨楼层累积，这是本局内的储蓄）。
- 展示：顶部 HUD 战绩行改为
  `最佳 {bestFloor} · 余烬 {embers} · 结晶 {crystals} · 击杀 {kills}`（用现有 `setHudValue`，不新增 DOM）。
- 不写入 `saveMeta()`、不进标题页统计、不影响结算奖励计算（`crystalsEarned` 语义保持不变）。

## 4. 商品表（3 件，价格 8 / 9 / 12）

| id | 名称 | 效果（立即生效） | 价格 | 断言点 |
|---|---|---|---|---|
| `cell` | 奥能电池 | `aetherMax +12` 且 `aether` 回满 | 8 | `aetherMax` 变大、`aether === aetherMax` |
| `rune` | 护心符文 | `hpMax +10`，`hp +10`（不超上限） | 9 | `hpMax +10`、`hp` 增加 |
| `prism` | 棱镜透镜 | `state.mods.damageMul ×= 1.05`（本局永久） | 12 | `damageMul` 变大 5% |

- 实现入口 `buyShopItem(index)`：校验 `type === 'shop'`、未售罄、`embers >= price`；成功则扣钱、应用效果、`item.sold = true`、飘字 + `playSfx('reward')` + 震屏 2/0.1；失败返回 `{ ok:false, reason }`（`noRoom` / `sold` / `poor` / `index`）。
- 售罄不刷新、不补货；A/B 关闭时整间房不存在。

## 5. 房型接入（精确改动点）

1. **类型表** `ROOM_TYPE_CONFIG.types`（第 4656 行起）新增：
   `shop: { name: '商店', en: 'SHOP', risk: 0, color: '#5ee1b4', count: [0, 0] }`
2. **权重不动**（`weights` / `eliteWeightFloor2` 保持原值，避免 m20/m21 的房型组合断言抖动），改为**保底四**：在 `assignRoomTypes()`（第 6139 行）末尾追加——
   - 条件：`state.u11V1 !== false && state.floor >= 2 && others.length >= 3`；
   - 让位顺序（从最不影响保底到影响最大）：**多余事件房 → 多余宝箱房 → 休整房 → 第 2 间战斗房 → 第 2 间精英房**；
   - 铁律：让位后仍要剩 ≥1 间宝箱/事件（保底三）、≥1 间有怪房（保底一/二）；没有可让位房就跳过；
   - 出生房 / 首领房永不改成 shop。
   - （实测修正）只有"出生房 + 楼梯房 + 2 间"的 4 间房层没有可让位房，所以**不是每层都有商店**；6 间房及以上的层按上述规则必有 1 间（2–12 层抽样 11 层里 9 层命中）。
3. **精英路线保护**：`designEliteRoute()`（第 7340 行附近）在选定支线独有房时剔除 `shop`；如果支线只有这一间商店，就沿该路线取相邻房顶上（至少保留 1 间精英房），避免商店被改成 `elite` 后整层没有商店。
4. **光照情绪** `ROOM_LIGHT_MOODS`（第 4733 行）新增
   `shop: { color: [94, 225, 180], coreAlpha: 0.30, radiusMul: 0.98, accent: '94, 225, 180', vignette: 1.00, tint: 0.08 }`（青绿 = "安全但要用钱"）。
5. **奖励分支** `applyRoomReward()`（第 6253 行）新增 `else if (room.type === 'shop')`：只 `showToast('商店 · 靠近展台按 E 购买', 'success')`，不改任何数值，`room.rewarded` 照旧置 true（防止每帧重复弹提示）。
6. **清房 / 锁门** 不改：`count [0,0]` 天然不会锁门、不会走 `onRoomCleared`。

## 6. 展台与交互

- 数据：`state.shop = { roomId, pedestals: [{ x, y, r: 20, itemIndex }] }`，在 `generateFloor()` 的 `state.shop = null`（与 `state.props` 一起清空）后由新函数 `spawnShopRoom()` 生成；调用点紧跟 `spawnFloorProps()` 之后（第 8445 行后）。
- 落点：以商店房中心为圆心，8 方向 × 半径 `min(w,h) × 0.30` 取点；要求 `isWalkableCircle(x,y,24)`、`!isWalkBlocked(x,y,24)`、离任一门 ≥40、展台两两 ≥52；不足 3 个就退到 `min(w,h) × 0.20` 再试一轮；仍不足则该房降级为 `rest`（保证不会出现"商店却没有货架"）。
- 交互：`keyAction('descend')` 分支（第 25414 行）改为
  `else if (action === 'descend') { if (!tryVoidRiftInteract() && !tryShopInteract()) interactStairs(); }`
  `tryShopInteract()`：仅当 `state.currentRoomId === state.shop.roomId`、玩家距某展台 ≤60、且 `state.mode/status === playing` 时，调用 `buyShopItem(itemIndex)` 并 `return true`（无论买成没买成，都吞掉这次 E，避免"买不起又顺手下了楼"）。不在商店房返回 `false`。
- 渲染：新增 `drawShopPedestals()`，在 `drawFloorProps()` 之后调用（第 10879 行后）。每座展台 = 地面椭圆阴影 + 六边底座 + 顶部浮起的商品图标（电池 / 心形 / 棱镜三种纯 Canvas 图形）+ 价格牌 `8/9/12`；已售罄画成灰化底座 + 打勾。颜色统一走 `#5ee1b4` 主色 + `#ffd166` 价格色（复用 U9 六边母题）。
- 提示：展台 60px 内且未售罄时，用 U9 的 `#contextHint` 写「按 E 购买 · 余烬 8」，买不起写「余烬不足 · 需要 8」。

## 7. A/B 与调试口

- `state.u11V1`（默认 `true`）。关闭 → 不生成商店房（`assignRoomTypes` 的保底四跳过）、`state.shop = null`、`tryShopInteract()` 直接 `false`、不绘展台。
- `__roamDebug` 新增：
  - `setU11(on)` → 返回当前值；
  - `embers()` / `addEmbers(n)`（测试用，直接加钱）；
  - `shopAudit()` → `{ enabled, roomId, roomType, pedestals:[{x,y,r,item,price,sold,gapToDoor,walkable}], counts }`；
  - `shopRoomId()` → 本层商店房 id（无则 `-1`）；
  - `buyAtShop(index)` → 透传 `buyShopItem` 返回值 + 购买后 `{embers, aetherMax, hpMax, damageMul, sold}`。

## 8. 断言表（`tools/arcane_u11.js`，端口 9501，≥12 项）

| # | 断言 | 判据 |
|---|---|---|
| 1 | 进入游戏 | `#titleLayer` 隐藏 |
| 2 | 第 2 层起有商店房 | `setFloor(2..12)` 抽样 ≥2 层 `shopRoomId >= 0`；每层 ≤1 间；房间数 ≥6 的层必有 |
| 3 | 商店房不刷怪 | 该房 `enemies` 计数 0、未 `locked` |
| 4 | 展台 3 个且落点合法 | 每个 `walkable:true` / `gapToDoor ≥ 40` / 彼此 `≥ 52` |
| 5 | 余烬来源 | 在空地 `spawnEnemyAt('chaser', …, {roomId:-1})` × 3 → `hitNearest(999)` × 3，`embers` 增量 = 击杀数 × 1 |
| 6 | 买不起时不扣钱 | `setEmbers(0)` → `buyAtShop(0)` 返回 `{ok:false, reason:'poor'}`，`embers` 仍 0 |
| 7 | 买电池 | `embers 8→0`、`aetherMax +12`、`aether === aetherMax` |
| 8 | 买符文 | `ember` 扣 9、`hpMax +10`、`hp` 增加 |
| 9 | 买棱镜 | `damageMul` ×1.05（浮点误差 1e-6） |
| 10 | 售罄不可重复 | 同一 index 二次购买返回 `reason:'sold'`，钱不变 |
| 11 | E 交互吞掉 | 在展台旁 `keyAction('descend')` 后 `floor` 不变（不会误下楼） |
| 12 | A/B 关闭 | `setU11(false)` → 新层 `shopRoomId === -1`、展台 0；重开 `true` 恢复 |
| 13 | 换层清理 | `setFloor(n+1)` 后 `state.shop` 指向新层（或 null），旧展台不再可买 |
| 14 | 性能与报错 | `avgFps ≥ 60`、`errors === 0` |
| 截图 | before / after | `u11-before.png`（`setU11(false)` 的房型图例）/ `u11-shop.png`（展台全景）/ `u11-buy.png`（买完飘字） |

## 9. 回归与风险

- 必须跑 14 套全绿：`m12 m13 m14 m18 m19 m20 m21 m22 m23 m24 m25 verify fusion facing`。
- 风险 1（已排除）：`assignRoomTypes` 的保底四会改变房型分布、`designEliteRoute` 的支线取房也动了 → m22 的 `beforeTypes` 逐间一致、m20 路线差异、m21 隐藏房宿主全部实跑通过（49/49、45/45、40/40）。**保底四必须留在 `designEliteRoute()` 之前**：挪到之后会让 m22 看到"快照后改房型"。
- 风险 2：`state.embers` 只在 `createInitialState()` 初始化，若未来加"读档继续一局"需要补序列化（当前无此功能）。
- 风险 3：商店房使用 `ROOM_TEMPLATE_CONFIG.safeShapes` 未登记 → 可能是八边 / L 形房，展台落点必须靠 `isWalkableCircle` 校验，不能写死坐标。
- 风险 4：`damageMul` 是 `state.mods` 的乘算字段，U1 的标签乘算也在同一处结算；棱镜透镜只乘 1.05，且必须走 `state.mods` 而不是直接改伤害函数，避免 m12「增幅被动超标」断言误判。

## 10. 明确不做（本单元）

- 不做刷新 / 涨价 / 讨价还价 / 商店专属 NPC；
- 不做局外结晶消费（`meta.crystals` 只读展示）；
- 不做"商店房可被锁门"（无怪房永不上闸）；
- 不在本单元做生存房与变量事件（U11b / U11c 另写规格）。
