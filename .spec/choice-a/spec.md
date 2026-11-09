# A 批次「选择要有信息」· 规格

> 用户新要求：玩法要多样、要融入"选择"（例如房间选择），也可做自由地图探索。按 A → B → C 顺序落地。
> 目标文件：`index_arcane_v2.html`（单文件、零依赖、`file://` 双击即开）。已有锚点：
> `state.doors`（`{ roomId, side, x, y, closed, anim, targetRoomId, eliteRoute }`）、
> `drawDoors()`（L7193）、`ROOM_TYPE_CONFIG`（L5234，含 `types[type].risk/color/name`）、
> `state.currentRoomId`、`drawMinimap()`（L11076）、`ROOM_FLOW_CONFIG.lockDoors`（L7083）、
> `applyRoomReward()`（L6930）、`onRoomCleared()`（L6990 附近）。

---

## A1 · 门口信息板（`DOOR_INFO_CONFIG`）

**目标**：玩家站在门口就能看懂"进去会怎样"，而不是靠背数值表。

**规则**
1. 每扇门（`targetRoomId >= 0`）在玩家距门 ≤ `showRange`（132px）时显示一块信息板，离远不画（避免整图文字堆）。
2. 信息板两行：
   - 第一行：`房型名 · 风险档`（安全 / 常规 / 危险）；
   - 第二行：一句收益提示（如"宝箱 · 无战斗"、"精英 · 必掉稀有"）。
3. 风险档映射由 `riskLabels` 表决定（risk 0=安全、1/2=常规、3=危险），**文案与颜色都来自 `ROOM_TYPE_CONFIG`**，不新造第二套配色。
4. 已清房：仍显示信息，但用灰色（沿用 `drawDoors` 现有的 cleared 灰化），让"回头路"可读。
5. 未探测（可选开关 `fog`）：
   - `fog=true` 且目标房 `!visited && !cleared && !state.revealUnlocked` → 只显示 `unknownText`（"未探测 · 随机"）；
   - `__roamDebug.doorInfo.reveal(true)` 后恢复具体信息（模拟"探测道具/升级"）；
   - `fog` 默认 **false**，不改变现有观感，可 A/B。
6. 每帧统计（只给验收读）：`{ labels, unknown, nearDoors }`，`drawDoors()` 开头清零。

**数据契约**
```js
const DOOR_INFO_CONFIG = {
  enabled: true,
  showRange: 132,
  fog: false,
  unknownText: '未探测 · 随机',
  riskLabels: { 0: '安全', 1: '常规', 2: '常规', 3: '危险' },
  tipByType: { start: '休整 · 无战斗', battle: '清场 · 结晶与余烬', elite: '精英 · 必掉稀有',
    chest: '宝箱 · 无战斗', event: '事件 · 随机抉择', rest: '恢复 · 生命与奥能',
    shop: '交易 · 用余烬买牌', survival: '生存 · 持续刷波', vault: '秘藏 · 撞墙潜入',
    boss: '首领 · 通往楼梯' }
};
const DOOR_INFO_STATS = { labels: 0, unknown: 0, nearDoors: 0 };
function doorInfoFor(door) -> { known, unknown, typeId, typeName, risk, riskLabel, tip, cleared } | null
```

**挂载点**
| 位置 | 改动 |
|---|---|
| `ROOM_TYPE_CONFIG` 之后（L5266 后） | 新增 `DOOR_INFO_CONFIG` / `DOOR_INFO_STATS` / `doorInfoFor()` |
| `drawDoors()` 标签段（L7273–7286） | 替换为带距离判定的两行信息板 + 统计 |
| `__roamDebug`（towerShell 之后） | `doorInfo: { info, doors, tipFor, reveal }` |

**验收（`tools/arcane_doorinfo.js`，端口 9517）**
- A0 开关开 / `showRange` / `fog=false` / `tipByType` 覆盖 `ROOM_TYPE_CONFIG.types` 的**所有**类型键。
- A1 对当前楼层每个有 target 的门：`doorInfoFor` 返回非 null，`riskLabel ∈ {安全,常规,危险}`，`tip` 非空。
- A2 穷举 `ROOM_TYPE_CONFIG.types`：chest→风险"安全"且提示含"无战斗"；elite→"危险"；boss→"危险"；rest→"安全"。
- A3 `fog=true` 且目标未访问 → `unknown=true`；`reveal(true)` 后 `unknown=false`（关 fog 复原）。
- A4 近距离渲染：把玩家传送到某门 40px 内，等 2 帧 → `DOOR_INFO_STATS.labels ≥ 1`；传回房间中心（> showRange）→ `labels === 0`。
- A5 `enabled=false` → `labels === 0`，恢复 `true` 后 > 0。
- A6 截图 `choice-doorinfo.png` >10KB / fps ≥ 60 / `window.__errors` 为空。

**非目标**：不改门闸/锁门/房间切换逻辑；不改 `state.doors` 结构；不做探测道具实体（只留 `revealUnlocked` 开关）。

---

## A2 · 双价门（`PRICED_DOOR_CONFIG`，A1 收口后做）

**目标**：同一分叉点给出一对**信息对称**的门——一扇"高收益但要付代价"，一扇"安全但只给普通奖励"，让玩家自己权衡。

**规则（首版）**
1. 每层最多 1 次：在"有 ≥2 个未访问门口"的房间（优先出生房之后的第一个分叉房）挑一对门，标记：
   - 门 A：`door.offer = { kind: 'cost', title: '代价门', cost: 'HP-15%' | '余烬-3' | '本层 +1 波', gain: '必掉稀有 / 双倍结晶' }`；
   - 门 B：`door.offer = { kind: 'safe', title: '安全门', gain: '普通奖励' }`。
2. 进门时结算：代价门先扣代价（`player.hpMax` 降 15% 且 hp 同步、或 `state.embers -= 3`、或本层追加一波敌人），再给增益；安全门只走普通奖励。
3. 两扇门上方都写清代价与收益（复用 A1 信息板的两行结构 + 第三行代价/收益）。
4. 下限保护：hpMax 不低于 40%、余烬不足时显示"余额不足"并禁用该代价门（改为安全门文案），**不出现"付不起还被扣"**。
5. 开关 `PRICED_DOOR_CONFIG.enabled`，每层生成次数 `perFloor: 1`。

**验收**：代价三种各一条断言、付不起时禁用、两门信息完整、A/B 关闭后不出现 `offer`。

---

## A3 · 回溯已清房间（`BACKTRACK_CONFIG`，A2 收口后做）

**目标**：已清房间可以走回去，回头不刷怪、不掉落，只作为探索路径。

**规则**
1. 现状核对：`setRoomDoors` 只按 `room.locked` 控制；清房后 `onRoomCleared` 会把门打开。若已可通行 → 本项只需补"回访不重新落闸/不重新发奖励"的守卫 + 明确文案。
2. 回访守卫：`room.cleared === true` 时不再 `lockDoors`、不再 `applyRoomReward`（`rewarded` 已存在，双保险）。
3. 门信息板对已清房显示"已清 · 无战斗"（灰色）。
4. 开关 `BACKTRACK_CONFIG.enabled`；关闭时行为回到"只在清房后自然开门"（现状）。

**验收**：清房后走进走出 3 次，`room.locked` 保持 false、`rewarded` 保持 true、敌人数不增加、掉落不增加；A/B 关闭后不改变现状。

---

## DoD

每条（A1/A2/A3）：语法检查通过 → 专项脚本全绿 → 串行 18 套回归（红灯单跑复验）→ `PROGRESS.md` 落盘（含"玩家能看懂为什么选"的信息层说明与数据）→ 清单勾选。
