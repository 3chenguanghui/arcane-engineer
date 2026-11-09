# 烬 · 成就面板 v1.1

面向《烬》38 条成就的独立 UI 面板。**不改主文件** `index_arcane_v2.html`，面板以 `ach-panel.js` + `ach-panel.css` 形式交付，可挂到任意容器；另附预览页用于三种状态验收。

## 交付物

| 文件 | 作用 |
| --- | --- |
| `ach-panel.js` | 单文件模块，内置 38 条成就数据、渲染、排序、筛选、详情、`?ach=off` |
| `ach-panel.css` | 面板全部样式，令牌前缀 `--ach-*`，不与主文件 class 冲突 |
| `ach-preview.html` | 预览页：一键切换「全部完成 / 全未完成 / 混合」，并显示实测读数 |
| `.screenshots/ach-panel/*.png` | 5 张实测截图（总览 / 详情 / 隐藏 / 完成态 / 关闭证明） |
| `ach-panel.md` | 本说明 |

数据来源：`achievements.json`，共 **38 条**（战斗 15 / 探索 9 / 构筑 10 / 隐藏 4；其中 22 条为已有成就，16 条为新增）。模块只读数据，不写回存档。

## 1. 面板结构

- **标题栏**：品牌眉标、`总数 38`、`已完成 N`、完成率环形进度（`conic-gradient`，100% 时金色外发光加强）。
- **分类页签**：全部 / 战斗 / 探索 / 构筑 / 隐藏，每个页签带数量角标（15 / 9 / 10 / 4）。
- **工具条**：排序（按分类 / 按完成度 / 按稀有度）+「只看未完成」开关。
- **卡片网格**：4 列自适应（`minmax(--ach-card-min, 1fr)`），窄屏自动降到 3 / 2 / 1 列；隐藏页签固定两列，并带一条 `HIDDEN · 04` 说明条。
- **卡片内容**：分类图标砖、名称、分类 / 稀有度小字、描述、人话条件（如「击杀构装 ≥ 100」）、奖励、进度条与 `128 / 1000` 计数。
- **详情弹层**：点卡片打开；条件全文、判定式、统计字段、当前进度、达成时间、奖励；`Esc` 或点遮罩关闭。

## 2. 视觉实现

令牌沿用 `ui-kit.md`：暗底冷色阶、文字 `#eaf5ff / #c3d7ef / #a8bfdc / #93a6c4`、金色 `#ffc247`、科技青 `#5ce6ff`、奥术紫 `#b085ff`；**史诗小字固定 `#c9a6ff`**，不直接用 `#b47cff`。

卡片不做扁平：
- 顶边 1px 稀有度色高光（`::before`），中间掺白，模拟左上单一光源打在卡片顶面；
- 顶部偏左的径向内发光（`::after`），让卡片中心亮、边缘暗；
- 三层阴影：`inset` 顶部白高光 + `inset` 底部 34px 暗压 + 外部 9px 投影；
- 完成态再叠一层金色径向光，顶边高光提到 95% 不透明度。

已完成 vs 未完成：
- **已完成**：金色金属奖牌 + 自绘勾选 SVG、标题提到 `#f7fcff`、进度条与数字转金、卡片底色更亮。
- **未完成**：卡片强调色统一降为灰蓝 `#8b9db6`、标题 `#9db2cc`、描述 `#8193ad`、图标砖去色、进度条灰蓝；稀有度色只在完成态恢复。
- **隐藏未达成**：名称显示 `???`（等宽 + 0.28em 宽字距），描述为「达成后揭晓名称与条件」，条件行给一条模糊线索（如「赌桌会记住连赢的手气」），进度显示 `???` 且条为 0；达成后才揭晓名称、描述与条件。

## 3. 数据与接口

`achievements.json` **没有当前值字段**，因此当前进度由外部传入：

```js
const panel = ACHPanel.mount(host, {
  // 主接口：成就 id → 当前统计值
  progress: { kills_100: 128, boss_kills_5: 5, first_kill: 1 },
  // 可选：统计口径 → 当前值；progress[id] 不存在时按 item.metric 回退
  metrics: { kills: 128, eliteKills: 37 },
  // 可选：成就 id → 达成时间（时间戳 / ISO / Date），用于详情「达成时间」
  completedAt: { first_kill: '2026-10-01T20:00:00' },
  // 可选：成就 id → true，强制标记完成（用于补录）
  done: { wager_3: true },
  // 可选：当前已到账奖励总额；按上限 26 / 1 结算，卡片只显示实际到手值
  rewards: { aether: 12, cards: 1 },
  tab: 'all', sort: 'category', onlyLocked: false
});
```

判定规则：`completedAt[id]` 存在、`done[id] === true`、或 `当前值 ≥ target`，三者任一即完成。`cur` 来自 `progress[item.id]`，缺省回退 `metrics[item.metric]`，再缺省为 0。

返回的控制器（`?ach=off` 或容器不存在时返回 `ok:false` 的空实现）：

| 方法 | 说明 |
| --- | --- |
| `setProgress(progress, completedAt?)` | 用成就 id 换一份进度，立即重算 |
| `setMetrics(metrics, completedAt?)` | 用统计口径换一份进度 |
| `setRewards({ aether, cards })` | 换当前已到账总额，按上限重算每条实得 |
| `setMode('progress'\|'mixed'\|'done'\|'none')` | 演示/测试态；`progress` 回到外部传入值 |
| `setTab(tab)` / `setSort(sort)` / `setOnlyLocked(bool)` | 页签 / 排序 / 筛选 |
| `open(id)` / `close()` | 打开 / 关闭详情 |
| `refresh()` / `destroy()` | 重渲染 / 销毁并移除 DOM |
| `getStats()` | `{ renderMs, cards, total }` 最近一次渲染耗时 |
| `getRows()` | 当前 38 行，含 `{ item, cur, done, ratio, rarity, completedAt, aetherGain, aetherProjected, cardGain, cardProjected }` |

关闭开关：地址栏加 `?ach=off`（或给 `<html>` 设 `data-ach="off"`）时，`mount()` 直接返回空控制器，不创建任何 DOM。

### 3.1 奖励核对与上限口径

**逐条实算（脚本对三份来源做 38/38 比对，不采信文档汇总）**：

- **带 aether：21 条，合计 26。**
- 只给起手卡：**1 条**（`first_win`，`cards: 1`）。
- 无奖励：其余 **16 条**。
- 可复核的算术：`aether: 2` 共 5 条（`combo_30` / `flawless_5` / `single_school` / `recipe_all` / `blueprint_all`）× 2 = **10**；`aether: 1` 共 16 条 = **16**；合计 **26**，条数 **21**。

**原值 → 修正值（差异共 1 处）**：

| 位置 | 原值 | 修正值 | 差异 |
| --- | --- | --- | --- |
| `achievements.json` `notes[4]` 汇总句 | 「现有 22 条的 reward.aether 合计为 23」 | 「21 条带 aether、合计 26；另 1 条 only cards」 | **1 处**（条数 22→21、合计 23→26） |
| 38 条逐条 `reward`（json ↔ 面板 ↔ 主文件） | — | 三份完全一致 | **0 处** |
| 面板奖励文案 | 名义值「奥能 +N」（旧上限下实得可能是 0） | 上限结算后的实得值；满额显示「奥能已满 · 实得 0」/「起手卡已满」 | 显示口径修正 |
| 上限常量 | 旧 12（从第 13 点起静默夹 0，提示仍报 +N） | **26**（`index_arcane_v2.html` 第 16016 行；起手卡 1） | 与主文件对齐 |

`ach-panel.js` 没有内嵌过期的汇总句；加载时按数据实算 `ACHPanel.totals = { aether: 26, aetherCount: 21, cards: 1, cardsCount: 1 }`，并导出 `maxAetherReward: 26` / `maxCardReward: 1`，避免面板再引用任何口头合计。

**实得结算规则（与主文件 `announceAchievement(item, aetherGained)` 同口径）**：

- 已完成：按 `completedAt` 升序重放，逐条 `min(名义, 上限 − 已用)`，得到当时真正到账的差额；被夹到 0 的条目显示「奥能已满 · 实得 0」，不再报名义 `+N`。
- 未完成：`min(名义, 上限 − 当前总额)`；不足名义时标「（上限内）」，例如只剩 1 点时 `aether: 2` 的条目显示「奥能 +1（上限内）」。
- 未传 `rewards`：按新档处理（预算 = 已完成名义合计），预览三态的文字与旧截图一致，不会凭空出现「已满」。
- 无 `completedAt` 时重放按数据顺序，差额总和仍严格等于外部传入的 `rewards.aether`。

实测（无头 Edge，`file://` 直开）：

| 场景 | 结果 |
| --- | --- |
| 新档 / 全未完成 | 22 条奖励文字，0 条「已满」 |
| `rewards: { aether: 26, cards: 1 }` + 全未完成 | 21 条「奥能已满 · 实得 0」、1 条「起手卡已满」、0 条 `+` |
| `rewards: { aether: 25 }` | 名义 1 →「奥能 +1」；名义 2 →「奥能 +1（上限内）」 |
| 旧档：15 条 aether 完成、总额仅 12 | 实得合计 **12**；尾部 5 条（`floor_3`…`void_rift_1`）显示已满实得 0 |
| `?ach=off` | `ok:false`、0 面板，`totals` 仍可读 |

### 3.2 接入硬约束（顺序不可颠倒）

**硬约束：`progress = metaMetricValue(a.metric)` 这条路径，必须等主文件 `metaMetricValue` 的 9 个新 case 落地之后才能接。** 不是建议：9 个 case 缺失时，新成就会一直返回 `undefined → 0`，面板看起来像「进度坏了」，且永远不会解锁。

必须存在的 9 个 case（与 9 条新成就一一对应）：

`dailyCleared`、`codexEnemies`、`codexRelics`、`codexCards`、`talentLevels`、`wagerWins`、`sacrifices`、`barrelKills`、`challenge10Clears`。

其中 `barrel_20` 还额外依赖写入侧三处齐全：`terrainBump(kind)` 的 barrel 分支调 `metaBumpStat('barrelKills', 1)`、`defaultMeta().stats` 有 `barrelKills: 0`、`normalizeMeta()` 兜底补 0；缺任何一处，进度恒为 0。

现状核对：主文件已在 `16550–16564` 行实现 9 个 case，barrel 写入在 `50172` 行附近、stats 兜底在 `16137` 行附近。**接入前仍须现场 grep 复核，不准只看本文档**：

```js
// 浏览器控制台：9 个口径都必须返回 number，任一 undefined 就说明还没落地
['dailyCleared','codexEnemies','codexRelics','codexCards','talentLevels',
 'wagerWins','sacrifices','barrelKills','challenge10Clears']
  .every(k => typeof metaMetricValue(k) === 'number');   // 期望 true
```

在 9 个 case 未落地前，面板只能用于 `mode: 'mixed' | 'done' | 'none'` 的纯视觉预览，不得挂到真实存档入口。

### 3.3 稀有度口径

稀有度为**展示口径**（数据里没有该字段）：隐藏 4 条 = 遗物；7 条 `targetRef` / `target ≥ 100` = 史诗；5 条 `target ≥ 20` = 稀有；其余 22 条 = 普通。排序时遗物 > 史诗 > 稀有 > 普通。条目上可直接加 `rarity` 覆盖。

## 4. 交互

- 页签切换保留排序 / 筛选状态；
- 排序：分类按 战斗→探索→构筑→隐藏；完成度按「已完成优先 + 比例降序」；稀有度按等级降序，同级已完成优先；
- 「只看未完成」为 `role="switch"` 的 40×22 开关；
- 卡片是 `<button>`，支持键盘聚焦与 Enter；详情打开后焦点落在弹层，`Esc` 关闭并尝试恢复原焦点；
- 隐藏页签说明条占满两列，解释 `???` 规则；
- 窄屏（1100 / 860 / 640）分别降列、缩环、隐藏副标题；`prefers-reduced-motion` 关闭位移动画。

## 5. 实测

环境：Windows / 本机 Edge（Chromium 131）无头，1440×1000，DPR 1，`file://` 直开。

| 指标 | 实测 |
| --- | --- |
| 38 条网格渲染（同页热渲染，多次中位数） | **3.9 ms**（常见 2.7–4.3 ms，机器高负载时 6.3 ms） |
| 整个面板挂载（标题栏 / 页签 / 网格 / 布局） | **4.5 ms**（常见 3.3–5.3 ms，高负载时 7.2 ms） |
| 同页切换 done / none / mixed 重渲染 | **3.7–5.4 ms** |
| 滚动采样（全列表上下往返 1.6s） | p95 帧间隔 **8.4–8.5 ms**，>20 ms 帧 **0**，无掉帧 |
| 外部请求 | **0**（`performance.getEntriesByType('resource')` 中 http(s) 条数为 0） |
| 页面 JS 错误 | **0** |
| 交互验收 | 页签 15/9/10/4、隐藏 4、只看未完成 20 条且 0 条已完成、稀有度排序首 4 条为遗物、点卡片开详情 / 关闭按钮 / `Esc` 均生效、`?ach=off` 0 个面板 0 张卡 |
| 外部进度接口 | `progress` 按 id 传入后 `kills_100` = 128 且完成；`boss_kills_5` = 0 未完成；`completedAt` 透传；`setMetrics` 切换口径生效 |
| 奖励结算验收 | `ACHPanel.totals` = 26 / 21 / 1 / 1；满额时 21 条 aether + 1 条 cards 全部显示已满、0 条 `+`；旧档 15 条完成 / 总额 12 时实得合计仍为 12、尾部 5 条为 0 |

预览页顶栏显示的是当次热开中位数（截图 01 为 **4.00 ms**）。首次冷启动还会包含预览页整页首次布局与字体初始化，数值波动大（约 30–60 ms，极端负载更高），游戏内 CSS 随主文件启动已解析，不应把这个冷启动数当作面板常态耗时。

性能做法：38 条全部真实渲染，**没有加虚拟滚动**——热渲染已 3–4 ms、滚动 p95 8.4 ms，再加虚拟列表反而增加复杂度。卡片用 `content-visibility:auto` + `contain-intrinsic-size` 让视口外跳过布局/绘制；`will-change:transform` 只在 `:hover` 时给，避免 38 张卡常驻合成层内存。滚动容器 `will-change:scroll-position`。

## 6. 接入示例（19 行）

```html
<!-- 1) ach-panel.css 粘到 </head> 前；ach-panel.js 在主脚本后引入 -->
<script>
  // 2) 硬前置：metaMetricValue 必须已含 9 个新 case（dailyCleared/codexEnemies/codexRelics/codexCards/
  //    talentLevels/wagerWins/sacrifices/barrelKills/challenge10Clears），否则新成就进度恒为 0
  // 3) 全屏宿主层：点击空白处关闭
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:90;display:grid;place-items:center;background:rgba(4,7,12,.55)';
  document.body.appendChild(host);
  // 4) progress 的 key 是成就 id；rewards 传当前已到账总额，按上限 26/1 结算实际到手
  const progress = {};
  ACHPanel.data.forEach(a => { progress[a.id] = metaMetricValue(a.metric); });
  const panel = ACHPanel.mount(host, {
    progress,
    completedAt: state.meta.achievements || {},  // 主文件存的是 id → 时间戳
    rewards: state.meta.rewards || { aether: 0, cards: 0 }
  });
  // 5) 关闭时销毁，避免遮住战斗输入
  host.addEventListener('click', e => { if (e.target === host) { panel.destroy(); host.remove(); } });
</script>
```

本地验证：双击 `ach-preview.html` 即可；`?ach=off` 验证关闭；`?state=done|none|mixed&tab=hidden&open=boss_kills_5` 可复现截图状态。

## 7. 截图

| 截图 | 内容 |
| --- | --- |
| `01-overview-mixed.png` | 混合态总览：18/38、47.4% 环、四列卡片、完成/未完成明暗差、条件与进度 |
| `02-detail.png` | 详情：条件全文、判定式、统计字段、5/5、2026-09-21 21:30、奖励、金色进度条 |
| `03-hidden.png` | 隐藏页签：`HIDDEN · 04` 说明条、4 张 `???`、四条模糊线索、两列布局 |
| `04-complete-all.png` | 全完成态：38/38、100% 环、全员金牌勾选、金色进度条 |
| `05-ach-off.png` | `?ach=off` 关闭证明：无面板、无卡片 |

## 8. 边界说明

- 未改动 `index_arcane_v2.html`；接入需要手动引入两个文件并加 19 行挂载代码（见上）。
- 未新增成就数据；`ach-panel.js` 内嵌的是 `achievements.json` 的只读快照，改数据需重新生成该数组。
- **汇总数字**：`achievements.json` 里「22 条 / 合计 23」仍是错的；重新生成数据快照时务必写成 **21 条 / 合计 26（另 1 条 only cards）**，否则错会再次流进面板。
- 已完成条目的「实得」按 `completedAt` 升序重放；无时间戳时按数据顺序。差额总和严格等于外部传入的 `rewards.aether`，但逐条归属在无时间戳时可能与真实发放顺序有出入。
- 旧上限 12 的历史夹零没有逐条存档记录，面板只能按当前总额反推；若外部不传 `rewards`，则按「新档满额可领」显示。
- 稀有度是面板展示规则，不是存档字段；若策划给出正式稀有度，条目加 `rarity` 即可覆盖。
- 隐藏线索为氛围文案，不参与条件判定；隐藏项达成后会正常展示名称 / 描述 / 条件。
- 「达成时间」只有外部传 `completedAt`（主文件 `state.meta.achievements`）时才准确；未传但 `progress` 已达标时会显示「未记录」。
