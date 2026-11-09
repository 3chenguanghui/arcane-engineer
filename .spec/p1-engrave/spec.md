# P1 符文刻印台（Sigil Engraving）· 实现规格

> 依据：`REFERENCE_ORIGINALITY.md` §3 P1 + §6 施工清单 1a/1b。
> 本文档决策完整：照此即可直接编码，不再二次讨论。

## 1. 目标与非目标

### 目标
- 给玩家一个"付费、限额、可控"的构筑编辑入口：改一张已持有能力的**一个语义标签**。
- 改标签必须走既有唯一写入口 `applyTagPatch()`，从而自动刷新 HUD 标签条与合成融合标签。
- 全功能受 `ENGRAVE_CONFIG.enabled` 控制，可整体 A/B 关闭。
- 专项脚本 `tools/arcane_engrave.js` 覆盖 A1–A6，headless 可断言。

### 非目标
- 不做"新建能力 / 删除能力 / 改数值"。
- 不改 `ABILITY_TAGS` 原表（只写 `state.tagPatches`）。
- 不允许刻印融合卡本身：融合标签是"从基础卡现算"的并集，改基础卡即自动同步；直接改融合卡会造成双重来源。
- 不复制 Noita 法杖 UI / Hades 祝福卡框的视觉。

## 2. 原创边界（写入 PROGRESS 的原文）

- 参考手法：Noita「改法杖」的资源重配置思路；Hades「Keepsake 定向」把随机奖励变成可规划目标；本作 U11c 随机改标签事件的"唯一写入口"工程手法。
- 我们改成：把"重配置"落在**能力语义标签**（本作独有的乘算单位），且是**付费 + 每层 1 次 + 每卡 2 次**的规划行为；改完会同步改写融合标签并集，等于在改"融合的身份"。
- 明确没借：没有照搬任何法杖/卡框美术，没有复制外部代码，没有抄任何数值表（费用/限额为本作自定首版值，过专项后再调）。

## 3. 数据与配置

### 3.1 新增 `ENGRAVE_CONFIG`（插入到 `U11_CONFIG` 之后，约 L26530 前）

```js
const ENGRAVE_CONFIG = {
  enabled: true,          // 总开关（A/B）
  costEmbers: 3,          // 每次刻印花费余烬
  perFloor: 1,            // 每层最多刻印次数
  perAbility: 2,          // 同一能力本局最多被刻印次数
  minTags: 2,             // 改写后该能力至少保留的标签数
  spawn: { rest: 1, shopChance: 0.5 }, // 休整房固定 1 台；商店房 50% 追加 1 台
  interactRange: 64,      // E 交互半径
  radius: 18,             // 台座半径（绘制 + 落点判定）
  color: '#b98cff',       // 刻印紫（与 void 标签同色系，但仅表现用）
  sfxVolume: 0.7
};
```

### 3.2 `state` 新增（`createInitialState()` 内，紧跟 `tagPatchSeq` 之后 L6104）

```js
/* P1 刻印台：本层已用次数 / 每卡累计次数 / 本层台座 / 最近一次结果 / 面板选择态 */
engrave: { usedFloor: -1, count: {}, stations: [], local: 0, last: null, sel: null }
```
- `usedFloor`：记录上一次刻印发生在第几层（与 `state.floor` 比较判断本层是否还能用）。
- `count`：`abilityId → 次数`，跨楼层累计，重开清零。
- `stations`：`[{roomId,x,y,r}]`。
- `sel`：`{abilityId, fromTag, toTag}` 面板三列选择态。

## 4. 生成规则

`spawnEngraveStations(spawnRoom, stairRoom)`（新函数，放在 `spawnShopRoom` 之后）：
1. `state.engrave.stations = []`；`ENGRAVE_CONFIG.enabled === false` 直接返回。
2. 休整房：取 `type === 'rest'`、排除出生房/首领房的第一间；在房心偏移 `min(w,h) * 0.30`、角度 `hash01(room.x, room.y) * 2π` 处放 1 台；`isWalkableCircle(x,y,radius+6)` 与 `isNearAnyDoor(x,y,44)` 校验失败则沿 8 方向试 2 档半径；仍失败则本层无台座（宁缺毋滥）。
3. 商店房：若 `state.shop` 存在且 `hash01(room.x + floor, room.y - floor) < spawn.shopChance`，在商店房再放 1 台（同落点算法）。
4. 调用点：`generateFloor()` 中 `spawnShopRoom(...)` 之后（约 L8975），确保门洞已生成。

## 5. 交互与面板

### 5.1 E 键链路
`handleKeyDown` 的 descend 分支（L27966）改为：
```js
if (!tryVoidRiftInteract() && !trySurvivalInteract() && !tryEngraveInteract() && !tryShopInteract()) interactStairs();
```
`tryEngraveInteract()`：仅 `mode/status === 'playing'`、同房间、`dist <= interactRange` 时触发；本层已用则 `showToast('本层刻印台已用过')` 并返回 true（吃掉这次 E，避免顺手下楼）。

### 5.2 面板
- 新增 DOM：`<div id="engravePanel" class="rules-layer" aria-hidden="true">`，内部 `.rules-card.engrave-card`，三列：
  - 左：能力列表（`ownedMagic + ownedTech`，只列有 `ABILITY_TAGS` 的 id）
  - 中：当前标签按钮（点击选中 `fromTag`，标注"将被替换"）
  - 右：新标签按钮（`TAG_CONFIG` 9 个键，排除已在该能力上的标签与 `fromTag` 相同项）
  - 底部：费用/剩余次数/本层状态 + 「确认刻印」与「取消」按钮
- 注册到 `PANEL_CONFIG.engrave = { build: () => buildEngravePanel(), focus: () => ui.engraveClose }`；`panelEl('engrave')` 返回 `ui.engravePanel`。
- `openEngravePanel()` 直接调 `openPanel('engrave')`：自动暂停、互斥、Esc 可关。
- 键盘：Esc 关闭（现有 `closeActivePanel()` 已覆盖）；面板内其余键不响应（现有面板分支）。
- 鼠标：三列按钮点击 → 更新 `state.engrave.sel` → 重绘面板；确认按钮走 `engraveConfirm()`。

### 5.3 结算 `engraveConfirm()` → `applyEngrave(abilityId, nextTags)`

`applyEngrave` 是唯一结算入口（UI 与调试口共用），按顺序校验：
1. `enabled === false` → `{ok:false, reason:'off'}`
2. 能力不在 `ownedMagic/ownedTech` → `'notOwned'`
3. `nextTags.length < minTags` → `'minTags'`（A4）
4. `nextTags` 有重复 → `'duplicate'`
5. `count[id] >= perAbility` → `'limitAbility'`（A3）
6. `usedFloor === state.floor` → `'limitFloor'`
7. `embers < costEmbers` → `'embers'`（A1）
8. 通过：`applyTagPatch(id, nextTags)`（内部 `tagPatchSeq++` + 清 `TAG_FUSION_CACHE`）→ 扣余烬 → `count[id]++` → `usedFloor = floor` → `state.engrave.last = {...}` → `renderTagBar()` 立即重绘 → 音效/粒子/浮字 → `updateHUD()` → `{ok:true,...}`

表现：`playSfx('ui', 0.7)`（不新增音频资源）；台座处 `addRing` 紫色 + `addBurst` + `addFloat('刻印 · 弹体→雷')`；受改能力卡面由既有 `tagPatchSeq` 机制刷新标签条。

## 6. 挂载点清单（精确）

| 位置 | 现状行号 | 改动 |
| --- | --- | --- |
| `U11_CONFIG` 之后 | ~L26530 | 新增 `ENGRAVE_CONFIG` |
| `createInitialState()` | L6104 后 | 新增 `state.engrave` |
| `generateFloor()` | L8975 后 | 调 `spawnEngraveStations(spawnRoom, stairRoom)` |
| `handleKeyDown` descend 分支 | L27966 | 插入 `tryEngraveInteract()` |
| `PANEL_CONFIG` | L24790 | 新增 `engrave` 条目 |
| `panelEl()` | L24810 | 新增 engrave 分支 |
| `ui` 注册处 | ~L10208 | 注册 `engravePanel/engraveClose/engraveBody` |
| 世界层绘制 | `drawShopPedestals()` 调用旁 | 调 `drawEngraveStations()` |
| `getState()` | ~L30068 | 暴露 `engrave` 摘要 |
| `__roamDebug` | ~L30200 | 新增 `engrave` API |
| `<style>` 末尾 | 文件内 | 新增 `.engrave-*` 样式（沿用 surface/line/radius token） |

## 7. 调试口 API（供专项脚本）

```js
window.__roamDebug.engrave = {
  info(),                                  // {enabled,embers,floor,usedFloor,count,stations,last}
  stations(),                              // 台座数组
  open(),                                  // 强制打开面板（测试用，跳过距离判定）
  options(id),                             // {ok,currentTags,choices}
  apply(id, fromTag, toTag),               // 替换式刻印（正常玩法路径）
  applyTags(id, nextTags),                 // 原生标签表（用于 A4 minTags 校验）
  last()
};
```

## 8. 验收断言（`tools/arcane_engrave.js`，端口 9512）

- **A1** 余烬 0：`apply('fireball','projectile','thunder')` → `ok:false, reason:'embers'`；`tagPatches` 仍为 `{}`；余烬仍 0。
- **A2** 余烬 3、`relics={ember:1}`：刻印后 `getAbilityTags('fireball') === ['fire','thunder']`；补 `conductor:1` 后 `tagDamageMul('fireball')` 从 1.2 → 1.44（±0.02）；余烬 0；`tagPatchSeq` +1。
- **A3** 同卡第 3 次：`ok:false, reason:'limitAbility'`，`count.fireball === 2`，不再扣费。
- **A4** `applyTags('fireball', ['fire'])` → `ok:false, reason:'minTags'`，`tagPatches` 不变。
- **A5** 下层（`descendFloor` 或直接 `state.floor++` + `spawnEngraveStations`）后 `tagPatches` 仍生效；`renderTagBar()` 后 `#hudTags` 文本含「雷」。
- **A6** 连续 3 次刻印 + 600 帧 `update(1/60)`：`window.__errors.length === 0`；面板可正常开关；截图 `p1-engrave.png`。

## 9. 风险与降级

- 玩家把所有卡改成同一标签 → 乘算爆炸：`perAbility:2` + `minTags:2` + 每层 1 次三重限制。
- 若专项 A2 的乘算增幅超预期：只允许改科技卡（降级开关 `ENGRAVE_CONFIG.techOnly`，首版不启用）。
- 面板 DOM 与 HUD 三角冲突：面板为全屏层，`z-index` 沿用 `.rules-layer`，不改 HUD 定位。

## 10. 完成定义（DoD）

- `node tools/arcane_syntax.js` 通过。
- `tools/arcane_engrave.js` A1–A6 全绿。
- 核心回归串行：`arcane_verify`、`arcane_u1`、`arcane_fusion`、`arcane_c7`、`arcane_m23` 全绿（其余 14 套按轮次抽跑）。
- `window.__errors` 为空。
- `PROGRESS.md` 记录：参考手法 / 我们改成了什么 / 关键数据 / 下一步 P2。
