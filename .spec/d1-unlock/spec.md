# D1 · 渐进解锁 + 首层强引导（规范）

> 目标：新人第一局不再"一开局就被 8 个系统糊脸"。第 1 层只给移动 + 主攻击，系统按玩家自己达成的条件逐个出现；
> 未解锁的 UI **不显示**（不是灰掉），解锁瞬间给一次专属演出 + 一句话说明。老存档/重开按已达成条件补齐，不倒退。

## 数据契约

```js
const UNLOCK_CONFIG = {
  enabled: true,                 // A/B 开关：false = 全系统默认解锁（旧行为）
  order: ['fusion', 'device', 'overdrive', 'parallel'],
  labels: { fusion: '融合', device: '装置 K', overdrive: '合体过载', parallel: '并联回路' },
  stageFloor: 3,                 // 首次到达该层 → 解锁过载/并联
  uiHiddenClass: 'is-unlock-hidden'
};
const UNLOCK_STATS = { unlocks: 0, last: null, lastAt: 0, firstBattleAt: 0 };
```

存档（meta 级、永久、单调）：
```js
state.meta.unlocks = { fusion: true, device: true, overdrive: true, parallel: true }  // 只增不减
```

## 解锁条件

| id | 触发点 | 条件 |
| --- | --- | --- |
| `fusion` | `onRoomCleared()` | 清掉本局第一间 `battle`/`elite` 房 |
| `device` | 科技模块入卡组 | 第一次拿到任意科技卡（`cards.tech` 从 0 → >0） |
| `overdrive` | `generateFloor()` | 第一次到达第 3 层 |
| `parallel` | `generateFloor()` | 第一次到达第 3 层 |

老存档补齐：只要 `meta.bestFloor >= 3` 即解锁过载/并联；已有 `unlocks` 字段只做并集，不回退。
坏存档：字段缺失按"未解锁"处理，不抛错。

## 规则

1. `isUnlocked(id)`：`enabled=false` 时恒 true；读取 `state.meta.unlocks[id]`。
2. `unlock(id, reason)`：已解锁则静默返回 false；首次解锁 → 写 meta、`saveMeta()`、`applyUnlockUI()`、
   toast `解锁 · <label>（<reason>）`、`playSfx('reward')`、玩家脚下扩散光环；`UNLOCK_STATS.unlocks+1`。
3. `applyUnlockUI()`：未解锁的 UI 元素加 `is-unlock-hidden`（CSS `display:none !important`）：
   - fusion：`#fusionHint` `#fusionBar` `#fusionCast`
   - device：科技技能条 `#secondarySkill` 的父节点 `.skill-chip.is-tech`
   - overdrive：`#overdriveBar`
   - parallel：`#dualBar`
4. 输入门禁：
   - `action==='fuse'` → 融合未解锁时直接 return（不弹 toast，避免提示不存在的东西）
   - `action==='device'` → 未解锁 return
   - `action==='swap'`（Tab 换相）→ 未解锁 return
   - `tryFuse()` 内部再加一层 guard（防调试口/脚本绕过）
5. 第 1 层引导：出生房已有"清完这间房解锁融合"的提示（复用 toast / spiritLine），
   仅当 `!isUnlocked('fusion')` 时显示一次。
6. `generateFloor()` 末尾：`applyUnlockUI()`；达到 `stageFloor` 时依次 `unlock('overdrive')` `unlock('parallel')`。

## 专项断言（tools/arcane_unlock.js，端口 9526）

- A0 配置默认值：`enabled=true`、`stageFloor=3`、四道 gate 顺序正确。
- A1 新档第 1 层：仅 `fusion/device/overdrive/parallel` 全未解锁；`#fusionBar/#overdriveBar/#dualBar` 都带 `is-unlock-hidden`。
- A2 清第一间战斗房 → `fusion` 解锁且只解锁一次（`UNLOCK_STATS.unlocks` 从 0 → 1），UI 立即显示。
- A3 拿到第一张科技卡 → `device` 解锁；重复拿第二张不重复计数。
- A4 第 3 层前过载/并联仍锁；到达第 3 层 → 两者解锁，且第 4 层仍保持。
- A5 解锁后 `meta.unlocks` 落盘（重新 `loadMeta()` 仍为 true），模拟"老存档补齐"。
- A6 `enabled=false`：全部门禁放行、UI 不隐藏、`isUnlocked` 恒 true。
- A7 输入门禁：未解锁时 `tryFuse()` 返回 false；解锁后正常。
- A8 截图 / fps ≥45 / 零报错。

## 降级

`UNLOCK_CONFIG.enabled=false` 即完全回到"全系统默认开放"，不影响 C/B/A 批次。
