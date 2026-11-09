# U11a · 商店房 任务清单（每步完成即写 PROGRESS）

> 规格：`.spec/u11-rooms/spec.md`。原则：每步都能独立回滚；`state.u11V1` 关闭即回到 U10 状态。

## U11-1 规格落盘
- [x] `.spec/u11-rooms/spec.md` + `tasks.md`
- 验收：文件存在、断言表 ≥ 12 项、改动点带行号

## U11-2 数据层：余烬 + 状态容器
- [x] 在 `createInitialState()` 加 `embers: 0` / `u11V1: true`
- [x] 新增 `state.shop = null`（`generateFloor()` 与 `spawnShopRoom()` 开头各清一次）
- [x] 新增 `U11_CONFIG`（商品表 / 价格 / 展台半径 / 交互半径 60 / 落点约束）
- 验收：`node tools/arcane_syntax.js` OK；`__roamDebug.embers()` 返回 0

## U11-3 房型接入
- [x] `ROOM_TYPE_CONFIG.types.shop` + `ROOM_LIGHT_MOODS.shop`
- [x] `assignRoomTypes()` 末尾「保底四」（第 2 层起、`others ≥ 3`、事件→宝箱→休整→第 2 战斗→第 2 精英）
- [x] `designEliteRoute()` 剔除支线里的 shop（独一间时用相邻房顶上）
- [x] `applyRoomReward()` 加 `shop` 分支（只提示、不发奖）
- 验收：2–12 层抽样 9 层命中；`shop` 房 `enemies 0 / locked false`

## U11-4 展台生成
- [x] `spawnShopRoom()`：8 方向 × 2 档半径，四检；不足 3 座降级为 `rest`；排在 `spawnFloorProps()` 之后
- 验收：`shopAudit()` 三座 `walkable:true / blocked:false / doorGap 123.5 / 间距 ≥52`

## U11-5 购买逻辑
- [x] `buyShopItem(index)`：`index / noRoom / sold / poor` 四种失败 + 三种商品效果
- [x] `buyAtShop` 调试口
- 验收：电池 40→32（`aetherMax +12` 回满）、符文 32→23（`hpMax +10`）、棱镜 23→11（`damageMul ×1.05`）；二次购买 `sold`

## U11-6 交互与 HUD
- [x] `tryShopInteract()` 插在 `tryVoidRiftInteract()` 与 `interactStairs()` 之间
- [x] HUD 战绩行加「余烬」（复用 `setHudValue`，不加 DOM）
- [x] `#contextHint` 三种文案（可买 / 不足 / 已售）
- 验收：`pressE()` 楼层不变；HUD 出现「余烬 32」

## U11-7 渲染
- [x] `drawShopPedestals()` 在 `drawFloorProps()` 之后调用
- [x] 三件商品图标 + 深色圆角价格牌 + 售罄灰化 / 打勾 / 辉光熄灭
- 验收：`u11-shop.png` 三座展台可辨；`u11-buy.png` 商品名 + 扣钱飘字

## U11-8 专项验收脚本
- [x] `tools/arcane_u11.js`（端口 9501，复用 U10 的 Edge + CDP 骨架）
- [x] 20 项断言 + 3 张截图 + `.screenshots/art/u11-result.json`
- 验收：20/20 PASS，`avgFps 119`、`errors 0`

## U11-9 回归 + 收口
- [x] 14 套回归全绿：m12 27/27 · m13 26/26 · m14 12/12 · m18 23/23 · m19 23/23 · m20 45/45 · m21 40/40 · m22 49/49 · m23 38/38 · m24 30/30 · m25 58/58 · verify 34/34 · fusion 78/78 · facing 23/23
- [x] PROGRESS.md 顶部写 U11a 条目（根因 / 改法 / 数据 / 缺陷 / 回归 / 风险 / 文件 / 下一项）

---

## 后续（本单元收口后另写规格）

- **U11b 生存房**：进房落闸、限时 22s 持续刷怪、活到计时结束即结算（奖励 = 结晶 + 余烬），中途死亡按正常死亡流程。
- **U11c 变量事件**：`eventTable` 追加 2–3 条"改能力 / 换标签"的事件（如"献祭一张卡换 2 层火标签"），走 U1 的标签系统，不改数值。
