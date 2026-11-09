# 《烬》图鉴文案与术语表

来源：`index_arcane_v2.html`（只读核对，未改动主文件）
统计口径：卡牌 12 + 科技 8 = 20 条；元素反应 3 条；首领 3 条。
文风约定：冷峻、克制、不吹牛；每条卡牌描述 20–40 字，术语解释不超过 60 字。

---

## 一、卡牌与魔法（20 条）

### 魔法卡

| id | 名称 | 描述 |
| --- | --- | --- |
| `fireball` | 火球 | 最便宜的一发。它不负责解决问题，只负责让问题开始移动。 |
| `frost` | 冰环 | 把靠近的东西慢下来。慢下来之后，它们仍然会靠近。 |
| `bolt` | 雷击 | 先选一个目标，再让电流替你选剩下的。跳跃不问你同不同意。 |
| `heal` | 治疗符 | 把伤口缝回去，但线是临时的。下一次会从同一处裂开。 |
| `blade` | 回旋刃 | 去的时候是一把刀，回来的时候是一笔账。两段都要算。 |
| `mine` | 符文雷 | 提前把答案放在地上。敌人负责走过来，你负责别忘记位置。 |
| `lavaFissure` | 熔岩地裂 | 沿着瞄准线撕开地面。裂缝比它看起来更长，也更记仇。 |
| `arcanePool` | 奥术雷池 | 一块会反复收费的地砖。站上去的人，按秒结算。 |
| `runeOrbit` | 符文轨道 | 环带向外扩，像一次缓慢的宣判。越早站在里面，越早收到。 |
| `collapseHole` | 坍缩黑洞 | 先把周围拉近，再一起结算。它不区分敌我，只区分距离。 |
| `flameCone` | 喷火锥 | 越近越烫。这是一个把距离翻译成伤害的句式。 |
| `frostRing` | 冰霜环 | 以自己为圆心降温。适合被围住的时候，也适合围住别人。 |

### 科技卡

| id | 名称 | 描述 |
| --- | --- | --- |
| `concentrator` | 聚能模块 | 把奥能的回流调匀。没有爆发，只有不再卡壳的一口气。 |
| `field` | 力场发生器 | 一层薄薄的拒绝。它挡不住所有东西，但能挡住这一次。 |
| `capacitor` | 电容 | 把上限抬高，把充能压紧。大的一发，总要有地方先存着。 |
| `nanite` | 纳米机器人 | 看不见的修补，按秒计费。它们不问你为什么又受伤。 |
| `magnet` | 磁吸 | 把散落的东西拉过来，也把不该靠近的东西拉过来。 |
| `amp` | 增幅 | 下一次会更大。代价是你必须记得下一次是什么时候。 |
| `phase` | 相位甲 | 每层替你死一次。只有一次，而且不会提前通知是哪一次。 |
| `rewind` | 时序器 | 偶尔把冷却抹掉，让你误以为节奏站在你这边。 |

---

## 二、元素反应（3 条，每条不超过 60 字）

| id | 术语 | 解释 |
| --- | --- | --- |
| `frostBurst` | 霜爆 | 火打中带冰目标即炸：半径 92 内最多 3 人吃 55% 伤害，本体挂 2 秒湿身。 |
| `conduct` | 传导 | 雷打中湿身目标时，向半径 150 内最多 3 个目标跳 45% 伤害；湿身可由霜爆留下。 |
| `fireCloud` | 燃云 | 火打中淬毒目标时留下燃云：半径 100，3 秒内每 0.5 秒结算 25% 伤害，最多 4 层。 |

---

## 三、首领（3 条，每条不超过 60 字）

| id | 名称 | 解释 |
| --- | --- | --- |
| `mech` | 机械暴君 | 机械层首领。重招「过载震波」以自身为圆心扩散；二阶段提速，核心暴露时承伤更高。 |
| `rune` | 符文织者 | 符文层首领。重招「三环刻印」沿射线依次引爆；二阶段刻印反向，预警窗不变。 |
| `void` | 虚空噬主 | 虚空层首领。重招「湮灭奇点」先把人拽向中心再结算；二阶段双井叠加，拉力更强。 |

---

## 四、接入示例（13 行，可直接贴进主文件）

```js
// 把 achievements.json 的 achievements 数组内联为常量（保持单文件、零网络请求）
const ACH_DATA = { achievements: [/* 粘贴 achievements.json 的数组 */] };
// 注册：按 id 去重，只并入主文件已有口径的条目，避免存档校验把新 id 丢掉
const achIds = new Set(META_PROGRESS_CONFIG.achievements.map((a) => a.id));
ACH_DATA.achievements.forEach((a) => {
  if (achIds.has(a.id) || a.counterStatus !== '已有') return;
  const item = { id: a.id, name: a.name, desc: a.desc, metric: a.metric, target: a.target, reward: a.reward };
  META_PROGRESS_CONFIG.achievements.push(item);
  META_PROGRESS_CONFIG.byId[item.id] = item;   // normalizeMeta 靠 byId 过滤存档脏数据
});
// 查询：按 id 取成就描述，找不到返回空串（设置页 / 提示条共用）
function achDescOf(id) {
  const item = META_PROGRESS_CONFIG.byId[id];
  return item ? item.desc : '';
}
```

---

## 五、接入前需要补的口径（不改玩法数值）

新增 16 条里，7 条可直接注册；其余 9 条字段已存在但 `metaMetricValue()` 还没有读取分支，补齐位置如下：

- `dailyCleared`：读 `meta.seedRuns`，任一记录 `daily && cleared` 即为 1。
- `codexEnemies` / `codexRelics` / `codexCards`：分别读 `meta.codex.enemies / relics / cards` 的 length。
- `talentLevels`：对 `meta.talents` 的所有等级求和。
- `wagerWins` / `sacrifices`：读 `meta.eventStats.wagerWins / sacrifice`。
- `challenge10Clears`：读 `meta.challengeCleared['10']`。
- `barrelKills`：唯一需要新写盘的计数器。在 `terrainBump(kind)` 的 `kind === 'barrel'` 分支调用 `metaBumpStat('barrelKills', 1)`；同时在 `defaultMeta().stats` 与 `normalizeMeta()` 的 stats 兜底里补 `barrelKills: 0`。

奖励说明：现有 22 条 `reward` 的 `aether` 合计 23，已超过 `META_PROGRESS_CONFIG.maxAetherReward = 12`，所以新条目统一留空；若要给奖励，先扩展 `announceAchievement()` 的无奖励分支，或重新标定上限。
