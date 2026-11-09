# 死亡归因补丁 · v2（删假分类 + 首领含贴身 + 一句话总结）

> **状态：已核销，交写权线，第 2 份落盘。主文件冻结中；本文件不含对主文件的直接改动。**
> **TARGET_MD5: `62C63B773A093C5F334C8D0563051BBB`**（2,694,263 B / mtime 2026-11-08 19:27:21 / SHA256 `3929CB87…`）。**落盘前比对，不符拒收**。
> 机械版：`tools/reviewfix_apply.js`（`D0`–`D10`）。
> 基准：主文件 62,936 行版本；按「唯一锚点」定位，不按行号。
> **粘贴顺序：本文件第 2 份**。必须等 `ONBOARD_PATCH.md` 粘完且全量自检全绿后再粘；粘完块 0–10 重新跑全量（含 `death_parity` 差异必须为 0）。

## 块索引（11 块，0–10）

| 块 | 位置 | 一句话 | 回退 |
|---|---|---|---|
| 0 | CSS `.p1-legend-item i` 之后 | 新增 `.p1-summary` / `.p1-spike` | 删两条规则 |
| 1 | `P1_CATEGORY_META` / `P1_VERDICT_LABEL` | **删 `ground`**；`近身→近战`、`环境→环境/陷阱`、`被首领→被首领（含贴身）`；新增 `P1_SPIKE_RULE` | 还原表 |
| 2 | `p1LedgerReset` | 新增 `maxHit/maxByCat/sourceByCat/floors/bossContactDmg/bossContactHits` | 还原 |
| 3 | `p1CategoryOf` | **`hazard→env`**；删 `collapse` | 还原 |
| 4 | `p1NoteIncoming` | 写最大单次 / 来源累计 / 按层 / 贴身子计数 | 还原 |
| 5 | `p1IncomingList` | 返回 `maxHit/topName/deathFloorPct/contact` | 还原 |
| 6 | `p1Shares` 之前 | 新增 `p1TopSource` / `p1BossContact` / `p1SpikeFor` / `p1SummaryText` | 删四函数 |
| 7 | `p1DeathVerdict` | 删 `ground` 分支；boss 追加贴身子句；env 文案去掉「塌墙」 | 还原 |
| 8 | `buildShareBarHtml` | 图例追加「最大 X 点 · 主凶 名字」与贴身子句 | 还原 |
| 9 | `buildReviewHtml` | 插 `.p1-summary` 与 `.p1-spike`（不动三层结构） | 还原 |
| 10 | `__roamDebug.p1` | 加 `summary/detail/spike/categories` | 删方法 |

---

## 块 0 · 样式

**锚点**
```css
  .p1-legend-item i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
```
在它之后插入：
```css
  .p1-summary {
    margin: 10px 0 6px;
    padding: 8px 10px;
    border-left: 3px solid #ff9a5a;
    border-radius: 6px;
    background: rgba(255, 154, 90, 0.10);
    color: #ffe7b8;
    font-size: 13.5px;
    line-height: 1.65;
    text-align: left;
  }
  .p1-spike {
    margin-top: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    background: rgba(255, 92, 122, 0.12);
    color: #ffb7c4;
    font-size: 12px;
    line-height: 1.6;
    text-align: left;
  }
```
**回退**：删两条规则。

---

## 块 1 · 分类表（核心整改 ①）

**锚点**：`P1_CATEGORY_META` 与 `P1_VERDICT_LABEL` 两张表。替换为：
```js
/** 承伤分类 → 显示名 / 色块（顺序即兜底时的优先顺序）
    只保留真实可达的 5 类 + 兜底：ground 无生产者（全文 hazard 都带 bossKind），已删除；
    collapse 只是玩家技能区类型，从不进 damagePlayer，也删除。 */
const P1_CATEGORY_META = {
  boss: { name: '首领', color: '#ff5c7a' },
  melee: { name: '近战', color: '#ff9a5a' },
  ranged: { name: '远程', color: '#ffd166' },
  env: { name: '环境/陷阱', color: '#a8e6ff' },
  self: { name: '自伤', color: '#b6ff6b' },
  other: { name: '其它', color: '#9fb3c8' }
};
/** 分类 → 死因标签（被围 / 被远程 / …） */
const P1_VERDICT_LABEL = {
  boss: '被首领（含贴身）', melee: '被围', ranged: '被远程',
  env: '被环境', self: '自伤类', other: '未知', unknown: '未知'
};
/**
 * 死亡层骤升规则：该层占比 ≥ 全局 × mul，且该层占比 ≥ minFloorPct、该层伤害 ≥ minFloorDmg
 * 例：全局 50% → 死亡层 ≥100% 才算"突然飙升"；全局 20% → 死亡层 ≥40%。
 */
const P1_SPIKE_RULE = { mul: 2.0, minFloorPct: 25, minFloorDmg: 12 };
```
**为什么删 `ground`**：主文件全文 `kind:'hazard'` 只有两处，都在首领危险区且都带 `bossKind`；`p1CategoryOf` 第一条就 `if (cause.bossKind) return 'boss'`，所以 `ground` 分支**恒 0**。主文件不存在独立「落地伤害」来源（落锤 / 引力井都是首领技能，已归 `boss`）。
**为什么删 `collapse`**：`collapse` 只是玩家技能区的 `zone.type`，从不进 `damagePlayer`，同样无生产者。
**回退**：还原两张表，删 `P1_SPIKE_RULE`。

---

## 块 2 · 账目字段

**锚点**
```js
  const zero = { boss: 0, melee: 0, ranged: 0, env: 0, self: 0, other: 0 };
  state.p1Ledger = {
    incoming: {
      total: 0, hits: 0,
      byCat: Object.assign({}, zero),
      hitsByCat: Object.assign({}, zero),
```
改成：
```js
  const zero = { boss: 0, melee: 0, ranged: 0, env: 0, self: 0, other: 0 };
  state.p1Ledger = {
    incoming: {
      total: 0, hits: 0,
      maxHit: 0,
      byCat: Object.assign({}, zero),
      hitsByCat: Object.assign({}, zero),
      maxByCat: Object.assign({}, zero),
      /* 分类 → 来源名 → 累计伤害：回答"哪只怪打得最多" */
      sourceByCat: {},
      /* 楼层 → { total, byCat }：判断死亡层某类占比是否突然飙升 */
      floors: {},
      /* 首领贴身子计数：boss 伤害里混着大量被蹭死的，必须和技能分开 */
      bossContactDmg: 0,
      bossContactHits: 0,
```
**回退**：删 6 个新字段。

---

## 块 3 · 来源映射

**锚点**：整个 `p1CategoryOf(cause)`。替换为：
```js
/**
 * 把伤害来源（cause）映射成复盘分类
 * 规则：带 bossKind 恒为首领；爆炸桶算自伤；符阵算环境；弹幕/爆发算远程；贴身/冲锋/自爆算近战。
 * @param {Object} cause damagePlayer 的 cause 参数
 * @returns {string} boss / melee / ranged / env / self / other
 */
function p1CategoryOf(cause) {
  const kind = (cause && cause.kind) || 'unknown';
  if (cause && cause.bossKind) return 'boss';
  if (kind === 'barrel') return 'self';
  /* hazard 在真实游戏里只出现在首领危险区（必带 bossKind，已被上面截走）。
     这一条是防御性映射：真有不带 bossKind 的 hazard 时算环境，但不是可测路径。
     collapse 没有生产者（只是玩家技能 zone.type），已删除。 */
  if (kind === 'hazard' || kind === 'sigil') return 'env';
  if (kind === 'bullet' || kind === 'burst') return 'ranged';
  if (kind === 'contact' || kind === 'charge' || kind === 'selfdestruct') return 'melee';
  return 'other';
}
```
**六分类真实生产者审计**（报告同表）：

| 分类 | 真实函数（主文件） | kind |
|---|---|---|
| `boss` | `resolveBossTelegraph`、`updateBossEnemy` 贴身、`updateBossHazards` | `hazard` / `contact`（均带 `bossKind`） |
| `melee` | `updateEnemies` 接触、`resolveEnemyAction` 冲锋、`resolveEnemyAction` 濒死自爆 | `contact` / `charge` / `selfdestruct` |
| `ranged` | `updateBullets`（`srcKind` 全文只有 `'bullet'`）、`resolveEnemyAction` 蓄力爆发 | `bullet` / `burst` |
| `env` | `updateSigils` | `sigil` |
| `self` | `explodeBarrel` | `barrel` |
| `other` | 调试口 `damagePlayer` 与未标 kind 的兜底 | 任意 |

**回退**：还原函数。

---

## 块 4 · 记账写入

**锚点**
```js
  const cat = p1CategoryOf(cause);
  L.incoming.total += v;
  L.incoming.hits += 1;
  L.incoming.byCat[cat] = (L.incoming.byCat[cat] || 0) + v;
  L.incoming.hitsByCat[cat] = (L.incoming.hitsByCat[cat] || 0) + 1;
  if (cat === 'melee' && cause && cause.name) {
```
改成：
```js
  const cat = p1CategoryOf(cause);
  L.incoming.total += v;
  L.incoming.hits += 1;
  L.incoming.byCat[cat] = (L.incoming.byCat[cat] || 0) + v;
  L.incoming.hitsByCat[cat] = (L.incoming.hitsByCat[cat] || 0) + 1;
  if (v > (L.incoming.maxHit || 0)) L.incoming.maxHit = v;
  if (v > (L.incoming.maxByCat[cat] || 0)) L.incoming.maxByCat[cat] = v;

  // 分类 → 来源名累计伤害：用来回答"哪只怪打得最多"
  const srcName = (cause && cause.name) ? String(cause.name) : '未知来源';
  if (!L.incoming.sourceByCat[cat]) L.incoming.sourceByCat[cat] = {};
  L.incoming.sourceByCat[cat][srcName] = (L.incoming.sourceByCat[cat][srcName] || 0) + v;

  // 按层记账：死亡层某类占比突然飙升要单独标出
  const fk = String(state.floor);
  if (!L.incoming.floors[fk]) L.incoming.floors[fk] = { total: 0, byCat: {} };
  L.incoming.floors[fk].total += v;
  L.incoming.floors[fk].byCat[cat] = (L.incoming.floors[fk].byCat[cat] || 0) + v;

  // 首领"贴身"子计数：玩家要知道自己是"没躲开大招"还是"站错位置被蹭死"
  if (cat === 'boss' && cause && cause.kind === 'contact') {
    L.incoming.bossContactDmg = (L.incoming.bossContactDmg || 0) + v;
    L.incoming.bossContactHits = (L.incoming.bossContactHits || 0) + 1;
  }
  if (cat === 'melee' && cause && cause.name) {
```
**回退**：删新增段。

---

## 块 5 · 承伤列表

**锚点**：`p1IncomingList(ledger)` 的 `return raw.map(...)`。替换为：
```js
  const deathFloor = L.incoming.floors[String(state.floor)] || null;
  const contact = p1BossContact(L);
  return raw.map((item) => {
    const top = p1TopSource(L, item.key);
    const floorDmg = deathFloor ? (deathFloor.byCat[item.key] || 0) : 0;
    const floorPct = (deathFloor && deathFloor.total > 0)
      ? Math.round(floorDmg / deathFloor.total * 100)
      : 0;
    return {
      key: item.key,
      name: P1_CATEGORY_META[item.key].name,
      color: P1_CATEGORY_META[item.key].color,
      value: item.value,
      pct: pctMap[item.key],
      hits: L.incoming.hitsByCat[item.key] || 0,
      maxHit: L.incoming.maxByCat[item.key] || 0,
      topName: top.name,
      topDmg: top.dmg,
      deathFloorDmg: floorDmg,
      deathFloorPct: floorPct,
      contact: item.key === 'boss' ? contact : null
    };
  }).sort((a, b) => b.value - a.value);
```
**回退**：还原原 `return raw.map(...)`。

---

## 块 6 · 四个新纯函数

**锚点**
```js
/**
 * 汇总账目（结算页与调试口共用）
```
在它前面插入：
```js
/**
 * 某分类里累计伤害最高的来源名（"哪只怪打得最多"）
 * @param {Object} ledger 账目
 * @param {string} cat 分类键
 * @returns {{name:string, dmg:number}}
 */
function p1TopSource(ledger, cat) {
  const L = ledger || (state && state.p1Ledger);
  const map = (L && L.incoming && L.incoming.sourceByCat && L.incoming.sourceByCat[cat]) || {};
  let name = '';
  let dmg = 0;
  Object.keys(map).forEach((key) => {
    if (map[key] > dmg) { dmg = map[key]; name = key; }
  });
  return { name: name, dmg: dmg };
}

/**
 * 首领"贴身接触"子计数（占总数比例，分母恒为总承伤）
 * @param {Object} ledger 账目
 * @returns {{dmg:number, hits:number, pct:number}}
 */
function p1BossContact(ledger) {
  const L = ledger || (state && state.p1Ledger);
  const total = L ? (L.incoming.total || 0) : 0;
  const dmg = L ? (L.incoming.bossContactDmg || 0) : 0;
  return {
    dmg: dmg,
    hits: L ? (L.incoming.bossContactHits || 0) : 0,
    pct: total > 0 ? Math.round(dmg / total * 100) : 0
  };
}

/**
 * 死亡层骤升：某类在本层占比 ≥ 全局 ×2，且本层占比 ≥25%、本层伤害 ≥12
 * @param {Object} item p1IncomingList 条目
 * @param {Object} ledger 账目
 * @returns {Object|null} 命中项 { key, name, runPct, floorPct, floorDmg }
 */
function p1SpikeFor(item, ledger) {
  const L = ledger || (state && state.p1Ledger);
  if (!item || !L || !L.incoming.total) return null;
  const rule = P1_SPIKE_RULE;
  const floorPct = item.deathFloorPct || 0;
  const floorDmg = item.deathFloorDmg || 0;
  if (floorDmg < rule.minFloorDmg) return null;
  if (floorPct < rule.minFloorPct) return null;
  if (floorPct < (item.pct || 0) * rule.mul) return null;
  return { key: item.key, name: item.name, runPct: item.pct, floorPct: floorPct, floorDmg: floorDmg };
}

/**
 * 一句话总结（结算页与自检共用同一份文字）
 * 玩家记得住"第 12 层"，记不住"71%" —— 所以楼层必须出现。
 * @param {Object|null} death resolveDeathCause() 返回值
 * @param {Array<Object>} list p1IncomingList 结果
 * @returns {string}
 */
function p1SummaryText(death, list) {
  const top = (list && list.length) ? list[0] : null;
  const killer = (top && top.topName) ? top.topName
    : ((death && death.name) ? death.name
      : ((state.lastHit && state.lastHit.name) || '不明伤害'));
  if (!top) return '你在第 ' + state.floor + ' 层倒下，本局没有记录到承伤。';
  return '你在第 ' + state.floor + ' 层被' + killer + '打死，' + top.name
    + '占 ' + top.pct + '%，其中一次 ' + (top.maxHit || 0) + ' 点。';
}

```
**为什么 killer 取 `top.topName`**：验收句是「被裁决者打死」，而 `death.name` / `lastHit` 常常是最后补刀的小怪（弓手）。改后取「造成最多伤害的来源」，与「近战占 71%」口径一致。
**回退**：删四函数。

---

## 块 7 · 判决

**锚点**
```js
  if (share('boss') >= 0.40) {
    return {
      tag: 'boss', label: P1_VERDICT_LABEL.boss,
      rule: '首领伤害占 ' + pctText('boss') + '%（阈值 ≥40%）',
      quote: null
    };
  }
```
改成：
```js
  if (share('boss') >= 0.40) {
    const contact = p1BossContact(L);
    const extra = contact.dmg > 0
      ? '；其中贴身接触 ' + contact.dmg + ' 点（占总承伤 ' + contact.pct + '%，' + contact.hits + ' 次）'
      : '';
    return {
      tag: 'boss', label: P1_VERDICT_LABEL.boss,
      rule: '首领伤害占 ' + pctText('boss') + '%（阈值 ≥40%）' + extra,
      quote: null
    };
  }
```
**块 7b**（环境文案）：
```js
      rule: '环境伤害占 ' + pctText('env') + '%（阈值 ≥45%，地面危险区 / 符阵 / 塌墙）',
```
改成：
```js
      rule: '环境伤害占 ' + pctText('env') + '%（阈值 ≥45%，符阵 / 陷阱）',
```
**为什么**：环境只剩 `sigil`（符阵）；「地面危险区 / 塌墙」无来源，写出来又是假承诺。
**如果存在 `ground >= 0.45` 分支**：整段删除（分类已不存在，`share('ground')` 恒 0）。
**回退**：还原。

---

## 块 8 · 图例

**锚点**：`buildShareBarHtml` 里的 `const legend = list.map((item) => '<span class="p1-legend-item"' …`。替换为：
```js
  const legend = list.map((item) => {
    const safeTop = String(item.topName || '').replace(/"/g, '&quot;');
    const extra = kind === 'in'
      ? ' · 最大 ' + (item.maxHit || 0) + ' 点'
        + (item.topName ? ' · 主凶 ' + item.topName : '')
        + (item.contact && item.contact.dmg > 0
          ? ' · 贴身 ' + item.contact.dmg + ' 点（' + item.contact.pct + '%）' : '')
      : '';
    return '<span class="p1-legend-item"'
      + ' data-p1-share="' + kind + ':' + item.key + '"'
      + ' data-p1-pct="' + item.pct + '"'
      + ' data-p1-max="' + (item.maxHit || 0) + '"'
      + ' data-p1-top="' + safeTop + '"'
      + ' data-p1-value="' + item.value + '">'
      + '<i style="background:' + item.color + '"></i>'
      + item.name + (item.fusion ? '（融合）' : '') + ' ' + item.pct + '% · ' + item.value + ' 点'
      + extra
      + '</span>';
  }).join('');
```
**暴露给自检的 DOM 契约**：`data-p1-max`、`data-p1-top`。输出侧（`kind !== 'in'`）不加这些，避免"你的输出"里出现"主凶"。
**回退**：还原原 `legend`。

---

## 块 9 · 结算页插入总结与骤升

**(a)** 在 `buildReviewHtml` 里，锚点：
```js
  const shares = p1Shares(L);
  const verdict = won ? null : p1DeathVerdict(L);
  const inTotal = shares.incoming.total;
```
改成：
```js
  const shares = p1Shares(L);
  const verdict = won ? null : p1DeathVerdict(L);
  const summary = won ? '' : p1SummaryText(death, shares.incoming.list);
  const spike = won ? null
    : (shares.incoming.list || []).map((item) => p1SpikeFor(item, L)).filter(Boolean)[0] || null;
  const inTotal = shares.incoming.total;
```
**(b)** 结论层之后，锚点（`if (verdict) { … }` 那个块的收尾 `}`）追加：
```js
  // 1.5) 一句话总结：先让玩家记住"第几层 / 被谁 / 怎么死的"
  if (summary) {
    html += '<div class="p1-summary" data-p1-summary="1">' + summary + '</div>';
  }
```
**(c)** 承伤图例之后，锚点：
```js
    + buildShareBarHtml(shares.incoming.list, 'in', '本局没有记录到承伤')
    + '<div class="p1-evidence-head">复盘 · 你的输出构成（按卡与融合）</div>'
```
改成：
```js
    + buildShareBarHtml(shares.incoming.list, 'in', '本局没有记录到承伤')
    + (spike ? '<div class="p1-spike" data-p1-spike="1">死亡层突然飙升 · '
        + spike.name + ' 本层占 ' + spike.floorPct + '%（全局 ' + spike.runPct + '%），'
        + '本层共吃 ' + spike.floorDmg + ' 点</div>' : '')
    + '<div class="p1-evidence-head">复盘 · 你的输出构成（按卡与融合）</div>'
```
**不动**：三层结构（结论 / 证据 / 细节）原样，只在结论层和证据层各加一条。
**回退**：删三处新增。

---

## 块 10 · 调试口

在 `__roamDebug.p1` 的 `/** 清空本局账目 + 绘制计数（每个场景开始前调用） */` 之前插入：
```js
      /** 一句话总结（与结算页调用同一函数） */
      summary() {
        const L = state.p1Ledger;
        return p1SummaryText(state.lastHit, L ? p1IncomingList(L) : []);
      },
      /** 承伤明细（含最大单次 / 主凶 / 死亡层占比） */
      detail() {
        const L = state.p1Ledger;
        return L ? JSON.parse(JSON.stringify(p1IncomingList(L))) : [];
      },
      /** 死亡层骤升项（没有则 null） */
      spike() {
        const L = state.p1Ledger;
        if (!L) return null;
        const hit = p1IncomingList(L).map((item) => p1SpikeFor(item, L)).filter(Boolean);
        return hit.length ? JSON.parse(JSON.stringify(hit[0])) : null;
      },
      /** 分类表（断言 ground 已删除） */
      categories() {
        return Object.keys(P1_CATEGORY_META);
      },
```
**回退**：删四个方法。

---

## 口径（复审时逐条对）

1. 分类百分比合计恒 100（最大余数法 `p1PercentMap`）。
2. 「贴身 Y%」分母是**总承伤**，不是 boss 伤害；与「首领占 X%」并列可加。
3. 一句话总结必须含「第 N 层」与「其中一次 X 点」。
4. `P1_CATEGORY_META` 键集 = `{boss, melee, ranged, env, self, other}`，**没有 ground / collapse**。
5. 首领判决仍只有一条 `boss` 分类，不拆「技能 / 贴身」两个 tag。

## 复跑命令（冻结期在副本上）

```bat
node tools\reviewfix_apply.js .reviewfix\index_patched.html
node tools\arcane_syntax.js .reviewfix\index_patched.html
node tools\reviewfix_death_test.js
```
