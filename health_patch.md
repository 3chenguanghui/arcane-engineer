# 《烬》可粘贴补丁（B1 / B2 / B3 已按裁定出段；B4 / B5 只列不删）

**基线**：`index_arcane_v2.html` · MD5 `1A710C31F5D682C9787E0DCEA8DFF551` · 62,935 行 · 2026-11-08 17:21:26

> 审计期间主文件被改过 3 次，本补丁所有片段均已对上述基线做过「全文唯一命中」校验；
> 换基线后先重跑一遍唯一性检查，命中数不是 1 就不要粘。

**补丁规则**：锚点只用函数名 / 选择器 / 键名；每段独立可粘、独立可回滚；只删行，不加任何“已删除”墓碑。

## 两条不许动（先写在这里）

1. **调试 API 一个符号都不许动**：`__roamDebug` / `__talentDebug` 的键名、键数、返回结构保持原样。`tools/` 164 / 198 个脚本依赖它们（你给的 164 / 192 是旧数，脚本已增至 198，依赖数仍是 164）。
2. **`u11cLegacyEvents` 不许动**：事件房兜底，当前基线命中 3 次（定义 L51937 + 调用 L18192 / L51952；你给的 4 次是旧基线），删掉会让老存档进不了事件房。

## 粘贴顺序（8 行）

1. 备份主文件，确认 MD5 = `1A710C31…`、62,935 行。
2. 粘 **B1**（14 段，-180 行）→ 存盘 → `node tools/arcane_syntax.js`。
3. 粘 **B2-CSS**（20 段，-118 行）→ 存盘。
4. 粘 **B2-VAR**（19 行，-19 行）→ 存盘。
5. 粘 **B3**（26 段，-28 行）→ 存盘 → `node tools/arcane_syntax.js` + `node tools/arcane_verify.js`。
6. **B4 不粘**：融合提示链已证明恒空，但 3 个函数被 debug API 直接引用，见 §B4。
7. **B5 不粘**：武器区 1,082 行一行不删，只交分类清单，见 §B5。
8. 每批一个 commit；出红只回滚该批（各段互不重叠，按锚点反查即可）。

**净删合计：-345 行**（B1 180 + B2 118 + B2V 19 + B3 28）。
与报告数字的差值写在文末 §差值，先看再粘。

---

## 核验证据（删之前可以自己复核）

```powershell
# 函数：逐个整词搜，14 个全部只有 1 行（定义行本身）
Select-String -Path index_arcane_v2.html -Pattern 'function isRegionTransition'
# captureRunSnapshot 是 2 行 = 定义 1 + 文档注释自指 1，无调用点

# 死 class：在 class="..." 属性里命中 0（其余出现全在样式表选择器里）
Select-String -Path index_arcane_v2.html -Pattern 'class="[^"]*\b(title-duo|rules-grid|title-foot)\b'

# CSS 变量：var() 引用 0 次，只有 1 处定义
Select-String -Path index_arcane_v2.html -Pattern 'var\(--ink-600'

# 配置键：整词 1 次，即定义本身
Select-String -Path index_arcane_v2.html -Pattern '\bwallLen\b'
```

> 15 个死 class 的 `class="…"` 命中全部为 0；26 个键的整词命中全部为 1；19 个变量的 `var()` 命中全部为 0。

**整链试应用**：在副本上把 B1+B2+B2V+B3 全部粘一遍 → 62,935 → 62,590 行，`node tools/arcane_syntax.js` 通过，CSS 花括号平衡为 0，被删符号零残留，且没有产生新的孤儿函数。

---

## B1 · 14 个零引用函数（-180 行，含文档注释）

每段都是一个完整的「注释 + 函数」块，删掉即无残留。

### B1-1 · 锚点 `function isRegionTransition`（删 9 行）

```js
/**
 * 第 13 项：是否发生大区切换
 * @param {number} a 旧层
 * @param {number} b 新层
 * @returns {boolean}
 */
function isRegionTransition(a, b) {
  return regionIndexOf(a) !== regionIndexOf(b);
}
```

### B1-2 · 锚点 `function roomRouteScore`（删 14 行）

```js
/**
 * 房型路线评分：基础收益 + 词缀额外结晶，再乘 (1 − 代价)。
 * 只读 room.type 与当前词缀，不含随机 / 玩家状态 → 同种子同词缀必然同排序。
 * @param {Object} room 房间
 * @returns {number} 评分
 */
function roomRouteScore(room) {
  const base = FLOOR_ROUTE_BASE[room.type] || 0;
  const v = floorRouteValue(room.type);
  if (!v) return base;
  const bonus = (v.bonusCrystals || 0) * 12;
  const cost = (v.extraCount || 0) * 0.2 + (v.hpTax || 0);
  return Math.round((base + bonus) * (1 - cost));
}
```

### B1-3 · 锚点 `function floorModDistribution`（删 14 行）

```js
/**
 * 汇总每类词缀的条目数与权重占比（供帮助页与断言共用）
 * @returns {Object} {total, byKind:{good:{count,weight},...}}
 */
function floorModDistribution() {
  const byKind = { good: { count: 0, weight: 0 }, bad: { count: 0, weight: 0 },
    gamble: { count: 0, weight: 0 }, avoid: { count: 0, weight: 0 } };
  FLOOR_MOD_CONFIG.pool.forEach((mod) => {
    if (!byKind[mod.kind]) byKind[mod.kind] = { count: 0, weight: 0 };
    byKind[mod.kind].count += 1;
    byKind[mod.kind].weight = FLOOR_MOD_CONFIG.weights[mod.kind] || 0;
  });
  return { total: FLOOR_MOD_CONFIG.pool.length, byKind };
}
```

### B1-4 · 锚点 `function seedSignatureOfRun`（删 7 行）

```js
/**
 * 当前局指纹字符串（用于断言 / 导出比对）
 * @returns {string} JSON 字符串
 */
function seedSignatureOfRun() {
  return JSON.stringify(captureFloorSignature());
}
```

### B1-5 · 锚点 `function pickRandom`（删 8 行）

```js
/**
 * 从数组里随机取一个元素
 * @param {Array} list 候选数组
 * @returns {*} 随机元素
 */
function pickRandom(list) {
  return list[Math.floor(rng() * list.length)];
}
```

### B1-6 · 锚点 `function shuffleArray`（删 14 行）

```js
/**
 * 原地洗牌（Fisher-Yates），返回同一数组
 * @param {Array} list 待洗牌数组
 * @returns {Array} 洗好的数组
 */
function shuffleArray(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const temp = list[i];
    list[i] = list[j];
    list[j] = temp;
  }
  return list;
}
```

### B1-7 · 锚点 `function roomsConflict`（删 15 行）

```js
/**
 * 判断两个房间是否重叠或间距不足
 * @param {Object} a 房间 A
 * @param {Object} b 房间 B
 * @param {number} gap 需要的最小间隔
 * @returns {boolean} 是否冲突
 */
function roomsConflict(a, b, gap) {
  return !(
    a.x + a.w + gap < b.x
    || b.x + b.w + gap < a.x
    || a.y + a.h + gap < b.y
    || b.y + b.h + gap < a.y
  );
}
```

### B1-8 · 锚点 `function buildFallbackRooms`（删 18 行）

```js
/**
 * 兜底房间布局：当随机房间数量不足时使用，保证每层一定能玩
 * @returns {Array} 固定 4 个房间
 */
function buildFallbackRooms() {
  // M2 房间放大后同步放大的兜底坐标（3200×2300 世界，房间约 1.6 倍，彼此不重叠）
  const list = [
    { x: 200, y: 900, w: 600, h: 470, col: 0 },
    { x: 980, y: 440, w: 620, h: 480, col: 1 },
    { x: 1010, y: 1300, w: 620, h: 480, col: 1 },
    { x: 2300, y: 880, w: 640, h: 500, col: 3 }
  ];
  return list.map((room, index) => ({
    x: room.x, y: room.y, w: room.w, h: room.h,
    cx: room.x + room.w / 2, cy: room.y + room.h / 2,
    id: index, col: room.col, row: 0
  }));
}
```

### B1-9 · 锚点 `function randomPointInRoom`（删 12 行）

```js
/**
 * 找到房间里一个安全的随机点
 * @param {Object} room 房间
 * @param {number} margin 距离墙的留白
 * @returns {Object} 点坐标
 */
function randomPointInRoom(room, margin) {
  return {
    x: rand(room.x + margin, room.x + room.w - margin),
    y: rand(room.y + margin, room.y + room.h - margin)
  };
}
```

### B1-10 · 锚点 `function clearTransientEffects`（删 18 行）

```js
/**
 * 清理所有瞬时特效与顿帧（换层 / 重开时使用，避免上一层的爆点残留）
 */
function clearTransientEffects() {
  state.projectiles = [];
  state.mines = [];
  state.bullets = [];
  state.pickups = [];
  state.particles = [];
  state.rings = [];
  state.floats = [];
  state.beams = [];
  state.sparks = [];
  state.lastBurst = null;
  state.lastDirBurst = null;
  state.lastHit = null;
  state.hitStop = 0;
}
```

### B1-11 · 锚点 `function clearFloorEntities`（删 13 行）

```js
/**
 * 清理当前层的敌人与弹道（下楼时使用）
 */
function clearFloorEntities() {
  state.enemies = [];
  state.projectiles = [];
  state.mines = [];
  state.bullets = [];
  state.pickups = [];
  state.particles = [];
  state.rings = [];
  state.beams = [];
}
```

### B1-12 · 锚点 `function drawRuneCircle`（删 16 行）

```js
/**
 * 在效果图层里画一个圆圈（供技能与拾取反馈复用）
 * @param {number} x 圆心 x
 * @param {number} y 圆心 y
 * @param {number} radius 半径
 * @param {string} color 颜色
 */
function drawRuneCircle(x, y, radius, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 7]);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}
```

### B1-13 · 锚点 `function openRules`（删 7 行）

```js
/**
 * 打开帮助面板（同时暂停游戏）
 * @returns {boolean} 是否打开
 */
function openRules() {
  return openPanel('rules');
}
```

### B1-14 · 锚点 `function captureRunSnapshot`（删 15 行）

```js
/**
 * 抓取局内存档里的"开局随机化"白名单字段
 * ------------------------------------------------------------
 * 单独成一个入口，是为了让 captureRunSnapshot → applyRunSnapshot 的往返
 * 与快照校验断言（O10）有一段可读的真源，而不是散落在 restore 的拷贝循环里。
 * @returns {Object} 可 JSON 化的字段副本（未存在的字段不会出现）
 */
function captureRunSnapshot() {
  const snap = {};
  if (!state) return snap;
  RUN_SNAPSHOT_RANDOM_FIELDS.forEach((key) => {
    if (state[key] !== undefined) snap[key] = JSON.parse(JSON.stringify(state[key]));
  });
  return snap;
}
```

---

## B2 · 20 条死 CSS 规则（-118 行）

> 这 20 条选择器对应的 class 在 HTML 与 JS 字符串里命中 0；删的是整条规则（含它上方的说明注释）。

### B2-1 · 锚点 `.readout-floor > b`（删 6 行）

```css
  /* 楼层是主视觉：字号最大 + 青色发光 */
  .readout-floor > b {
    font-size: 30px;
    color: #d9fbff;
    text-shadow: var(--glow-tech);
  }
```

### B2-2 · 锚点 `.btn-magic`（删 5 行）

```css
  .btn-magic {
    border-color: rgba(176, 133, 255, 0.5);
    background: rgba(40, 24, 66, 0.72);
    color: #e6d6ff;
  }
```

### B2-3 · 锚点 `.rules-grid`（删 9 行）

```css
  .rules-grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    gap: 22px;
    align-items: stretch;
  }
```

### B2-4 · 锚点 `.rules-side`（删 13 行）

```css
  /* 右栏：天赋在上、音频设置在下，纵向堆叠后整体靠上对齐 */
  .rules-side {
    grid-column: 2;
    grid-row: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 18px;
    align-self: start;
    max-height: 100%;
    overflow-y: auto;
    padding-right: 2px;
  }
```

### B2-5 · 锚点 `.rule-block`（删 1 行）

```css
  .rule-block { margin-bottom: 18px; }
```

### B2-6 · 锚点 `.rule-block h3`（删 9 行）

```css
  .rule-block h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 7px;
    font-size: 13px;
    color: #cfe4ff;
    letter-spacing: 0.05em;
  }
```

### B2-7 · 锚点 `.rule-block h3 em`（删 9 行）

```css
  .rule-block h3 em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--tech);
    font-size: var(--fs-xs);
    border: 1px solid rgba(62, 230, 255, 0.3);
    border-radius: 3px;
    padding: 0 4px;
  }
```

### B2-8 · 锚点 `.rule-block p, .rule-block li`（删 1 行）

```css
  .rule-block p, .rule-block li { font-size: 12.5px; line-height: 1.7; color: #b8cce6; margin: 4px 0; }
```

### B2-9 · 锚点 `.rule-block ul`（删 1 行）

```css
  .rule-block ul { margin: 4px 0; padding-left: 18px; }
```

### B2-10 · 锚点 `.rule-block b`（删 1 行）

```css
  .rule-block b { color: #e6f4ff; }
```

### B2-11 · 锚点 `.rule-block kbd`（删 9 行）

```css
  .rule-block kbd {
    font-family: var(--mono);
    font-size: var(--fs-xs);
    border: 1px solid rgba(120, 170, 230, 0.35);
    border-radius: 3px;
    padding: 0 4px;
    color: var(--tech);
    background: rgba(6, 12, 22, 0.8);
  }
```

### B2-12 · 锚点 `.help-grid`（删 7 行）

```css
  /* 帮助面板：两列小卡（左操作 / 右楼层与难度），敌人表横跨底部 */
  .help-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px;
    align-content: start;
  }
```

### B2-13 · 锚点 `.title-duo`（删 11 行）

```css
  /* 标题页下半区：左「操作引导」/ 右「难度 + 永久天赋」双列
     ------------------------------------------------------------
     900px 高的窗口里，单列竖排会超过一屏，把"永久天赋"挤到滚动区外、看起来像空面板。
     双列后所有内容都在首屏，且左侧引导与右侧选择互不干扰；窄屏（<900px）自动叠成单列 */
  .title-duo {
    display: grid;
    grid-template-columns: minmax(0, 1.06fr) minmax(0, 0.94fr);
    gap: 18px;
    align-items: start;
    margin-top: 2px;
  }
```

### B2-14 · 锚点 `.title-duo-col`（删 1 行）

```css
  .title-duo-col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
```

### B2-15 · 锚点 `.title-scroll`（删 9 行）

```css
  /* 标题页可滚动内容区（滚动条只作用在这里，不影响底部按钮） */
  .title-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-right: 6px;
    scrollbar-width: thin;
    scrollbar-color: rgba(62, 230, 255, 0.34) transparent;
  }
```

### B2-16 · 锚点 `.title-scroll::-webkit-scrollbar`（删 1 行）

```css
  .title-scroll::-webkit-scrollbar { width: 8px; }
```

### B2-17 · 锚点 `.title-scroll::-webkit-scrollbar-thumb`（删 4 行）

```css
  .title-scroll::-webkit-scrollbar-thumb {
    border-radius: var(--r-pill);
    background: rgba(62, 230, 255, 0.3);
  }
```

### B2-18 · 锚点 `.title-actions`（删 13 行）

```css
  /* 开始按钮条：固定在卡片底部（外层不再滚动，不会被内容盖住）
     ------------------------------------------------------------
     标题页内容（主题预告 / 难度 / 永久天赋）在 900px 高的窗口里会超过一屏，
     上半段 .title-scroll 自己滚动；这一条永远可见，窗口再矮也能直接开打 */
  .title-actions {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    flex: none;
    z-index: 3;
    margin-top: 10px;
    padding: 16px 0 2px;
    border-top: 1px solid rgba(126, 164, 214, 0.18);
    background: linear-gradient(180deg, rgba(8, 13, 24, 0) 0, rgba(7, 11, 20, 0.9) 22px);
  }
```

### B2-19 · 锚点 `.title-foot`（删 7 行）

```css
  .title-foot {
    flex: 1;
    min-width: 220px;
    font-size: var(--fs-sm);
    color: var(--text-3);
    line-height: 1.7;
  }
```

### B2-20 · 锚点 `.title-foot b`（删 1 行）

```css
  .title-foot b { color: var(--text-2); }
```

---

## B2-VAR · 19 个死 CSS 变量（-19 行）

> 全部位于 `:root`，`var(--x)` 与 `var(--x, fallback)` 两种写法都查过，命中 0。每行单独删，互不影响。

| # | 锚点 | 要删的那一行 |
|---|---|---|
| 1 | `--panel-2` | `--panel-2: #16233a;` |
| 2 | `--panel-3` | `--panel-3: #1b2b46;` |
| 3 | `--warn` | `--warn: #ffb84d;` |
| 4 | `--fs-2xl` | `--fs-2xl: 26px;` |
| 5 | `--fs-3xl` | `--fs-3xl: 38px;` |
| 6 | `--glow-gold` | `--glow-gold: 0 0 20px rgba(255, 194, 71, 0.36);` |
| 7 | `--dur-slower` | `--dur-slower: 0.52s;` |
| 8 | `--sp-1` | `--sp-1: 4px;` |
| 9 | `--sp-6` | `--sp-6: 22px;` |
| 10 | `--ink-900` | `--ink-900: #070a12;` |
| 11 | `--ink-800` | `--ink-800: #0b1220;` |
| 12 | `--ink-700` | `--ink-700: #101a2c;` |
| 13 | `--ink-600` | `--ink-600: #16233a;` |
| 14 | `--ink-500` | `--ink-500: #1e2f4d;` |
| 15 | `--line-ink` | `--line-ink: #0a0d16;` |
| 16 | `--vignette` | `--vignette: 0.35;` |
| 17 | `--ease-in` | `--ease-in: cubic-bezier(0.4, 0, 1, 1);` |
| 18 | `--dur-pop` | `--dur-pop: 0.28s;` |
| 19 | `--modal-gap` | `--modal-gap: var(--sp-4);` |

```css
    --panel-2: #16233a;
    --panel-3: #1b2b46;
    --warn: #ffb84d;
    --fs-2xl: 26px;
    --fs-3xl: 38px;
    --glow-gold: 0 0 20px rgba(255, 194, 71, 0.36);
    --dur-slower: 0.52s;
    --sp-1: 4px;
    --sp-6: 22px;
    --ink-900: #070a12;
    --ink-800: #0b1220;
    --ink-700: #101a2c;
    --ink-600: #16233a;
    --ink-500: #1e2f4d;
    --line-ink: #0a0d16;
    --vignette: 0.35;
    --ease-in: cubic-bezier(0.4, 0, 1, 1);
    --dur-pop: 0.28s;
    --modal-gap: var(--sp-4);
```

---

## B3 · 26 个未接线配置键（-28 行）

> 键名整词命中都是 1（只有定义）。**注释跟着键一起走**：凡是解释“这个值可调”的行，全部随删，不留“这里可调”的尸检报告。
> 其中 2 个键是行内字段（`storageMoney` / `firstBattleAt`），只能改行、不能删行；8 个是对象末位属性，删行时必须把上一行末尾的逗号去掉。

### B3-1 · 锚点 `enemyBaseCount`（删 1 行）

```js
  enemyBaseCount: 3,           // 每层基础敌人数
```

### B3-2 · 锚点 `enemyPerFloor`（删 1 行）

```js
  enemyPerFloor: 1.5,          // 每层额外敌人数（3 + 层 × 1.5）
```

### B3-3 · 锚点 `talentMaxLevel`（删 1 行）

```js
  talentMaxLevel: 5,           // 每项永久天赋最高等级
```

### B3-4 · 锚点 `unlockClears`（删 1 行）

```js
  unlockClears: 1,            // 首次通关解锁挑战 1，之后每通关一次 +1（封顶 10）
```

### B3-5 · 锚点 `blockSize`（删 1 行）

```js
  blockSize: 6,
```

### B3-6 · 锚点 `maxSaturatedPerScreen`（改 3 行 → 1 行）

旧：

```js
  vignette: { alpha: 0.35, inner: 0.52, outer: 1.12 },
  /* 同屏高饱和上限（验收口径：玩家 / 精英描边 / 弹体 / 掉落） */
  maxSaturatedPerScreen: 4
```
新：

```js
  vignette: { alpha: 0.35, inner: 0.52, outer: 1.12 }
```

### B3-7 · 锚点 `squashAmount`（删 1 行）

```js
  squashAmount: 0.3,          // 受击挤压幅度（沿来向压扁）
```

### B3-8 · 锚点 `lethalSlowFrames`（删 1 行）

```js
  lethalSlowFrames: 0.13,     // 击杀时顿帧时长（与 hitStopLethal 同源，便于单独调）
```

### B3-9 · 锚点 `homingTurnRate`（改 3 行 → 1 行）

旧：

```js
  indicator: { enabled: true, radius: 13, width: 2, alpha: 0.6, spin: 0.6 },
  /* 与追踪融合技叠加时，投射物自身转向仍受 maxTurn（见 updateProjectiles）限制 */
  homingTurnRate: 6
```
新：

```js
  indicator: { enabled: true, radius: 13, width: 2, alpha: 0.6, spin: 0.6 }
```

### B3-10 · 锚点 `roomVariants`（删 2 行）

```js
  // 房间变体：同一层至少 3 种（按房间坐标 hash 分配，避免"走两间像复制"）
  roomVariants: ['装配间', '维修间', '管道枢纽'],
```

### B3-11 · 锚点 `hudWidth`（改 2 行 → 1 行）

旧：

```js
  shake: 6,            // 过载震屏强度
  hudWidth: 260        // HUD 细条宽度（CSS 读取）
```
新：

```js
  shake: 6            // 过载震屏强度
```

### B3-12 · 锚点 `maxAlpha`（改 2 行 → 1 行）

旧：

```js
  narrative: { mech: true, rune: true, void: true },   // 逐层开关，便于 A/B 单层对比
  maxAlpha: 0.3                                        // 细节透明度上限（超过就会抢敌人/子弹注意力）
```
新：

```js
  narrative: { mech: true, rune: true, void: true }   // 逐层开关，便于 A/B 单层对比
```

### B3-13 · 锚点 `lineDuration`（改 3 行 → 1 行）

旧：

```js
  camHold: 0.35,
  /** 演出时塔灵台词的显示时长（毫秒） */
  lineDuration: 5600
```
新：

```js
  camHold: 0.35
```

### B3-14 · 锚点 `storageMoney`（改 1 行 → 1 行）

旧：

```js
const TALENT_V2_CONFIG = { enabled: true, storageMoney: 'crystal' };
```
新：

```js
const TALENT_V2_CONFIG = { enabled: true };
```

### B3-15 · 锚点 `crystalsPerFloorMin`（删 1 行）

```js
  crystalsPerFloorMin: 6,           // 实测最低（只有清层 + 首领宝箱的层）
```

### B3-16 · 锚点 `crystalsPerFloorMax`（删 1 行）

```js
  crystalsPerFloorMax: 8,           // 实测最高（多一间宝箱 / 双价门 / 事件的层）
```

### B3-17 · 锚点 `exclusivePerFloor`（删 1 行）

```js
  exclusivePerFloor: 2,          // 每层至少几只独占（实际每区域给 3 只）
```

### B3-18 · 锚点 `hullText`（改 2 行 → 1 行）

旧：

```js
  readyText: '钥匙已齐 · 可下楼',
  hullText: '开放层 · 任意顺序探索'
```
新：

```js
  readyText: '钥匙已齐 · 可下楼'
```

### B3-19 · 锚点 `firstBattleAt`（改 1 行 → 1 行）

旧：

```js
const UNLOCK_STATS = { unlocks: 0, last: null, lastAt: 0, firstBattleAt: 0 };
```
新：

```js
const UNLOCK_STATS = { unlocks: 0, last: null, lastAt: 0 };
```

### B3-20 · 锚点 `deepBossEvery`（删 1 行）

```js
  deepBossEvery: 6,          // 深层每 6 层出现一次深层首领
```

### B3-21 · 锚点 `maxDisplay`（改 2 行 → 1 行）

旧：

```js
  aetherPerStep: 18,
  maxDisplay: 99
```
新：

```js
  aetherPerStep: 18
```

### B3-22 · 锚点 `contactLead`（删 1 行）

```js
  contactLead: ENEMY_WINDUP_CONFIG.time, // 近战接触前摇，复用旧配置，避免两套数字
```

### B3-23 · 锚点 `redundantMarks`（删 1 行）

```js
  redundantMarks: ['shrink', 'dash', 'ticks', 'arrow'], // 允许的冗余形状语言
```

### B3-24 · 锚点 `usedGray`（改 2 行 → 1 行）

旧：

```js
  purple: '#a855f7',
  usedGray: '#8c94a5'
```
新：

```js
  purple: '#a855f7'
```

### B3-25 · 锚点 `noContactDamage`（删 1 行）

```js
  noContactDamage: true,
```

### B3-26 · 锚点 `wallLen`（删 1 行）

```js
  wallLen: 72,           // 历史上限（实际用走廊宽度，见 findBreakableWall）
```

---

## B4 · 武器融合提示：链已证明恒空，但本轮不粘（单列）

### 证明：C1 之后没有任何可达入口

1. `WEAPON_CONFIG.enabled = false`（武器总闸门关闭）。
2. `weaponEnabledNow()` 第一行 `if (!WEAPON_CONFIG.enabled) return false;` → 恒 false。
3. `currentWeaponTag()` 第一行 `if (!WEAPON_TAG_CONFIG.enabled || !weaponEnabledNow()) return null;` → 恒 null。
4. `weaponFusionHintForOption()` 里 `const tag = currentWeaponTag(); if (!tag) return null;` → 恒 null。
5. `buildTreeWeaponBridgeHtml()` 有两道互不依赖的早退，任一都返回空串：
   - `if (!WEAPON_CONFIG.enabled || !weaponEnabledNow()) return '';`
   - `if (!FUSION_CONFIG.some((fusion) => fusion.weaponTag)) return '';`
6. 兜底证明：`weaponTag:` 作为**键名**的写法全文 **0 处**（只有 7 处读取 `fusion.weaponTag`）→ 就算前 5 步都不成立，配方过滤也永远查不到东西。
7. 两个消费点因此恒空：`wHint`（L45191，恒 null）、`bridgeHtml`（L47031，恒 ''）。

### 为什么不能按“证明得了就一起放进补丁”办

`weaponFusionHintForOption`、`buildTreeWeaponBridgeHtml`、`currentWeaponTag` 三个函数被调试 API 直接包了一层：
- `__roamDebug.fusion.currentTag()` → `currentWeaponTag()`
- `__roamDebug.fusion.hint(option)` → `weaponFusionHintForOption(option)`
- `__roamDebug.fusion.bridge()` → `buildTreeWeaponBridgeHtml()`
- `__roamDebug.fusion.recipes(id)` → 直接读 `fusion.weaponTag`
而 `tools/arcane_fusion.js`（L233 / 261 / 268）、`tools/arcane_verify.js`（L417 / 437）、`tools/arcane_weapons.js`（L115 / 128）**实际在调用**这些入口。
删函数 → 这几个验收脚本一跑就 `ReferenceError`。这与抬头的第 1 条（调试 API 一个符号都不许动）直接冲突，所以本段**不进粘贴顺序**。

### 若你决定删，需要一并改动的东西（4 个 debug 入口 + 2 个消费点）

```js
// 必须从调试 API 移除 / 改写：
currentTag() { return currentWeaponTag(); },        // L55050
hint(option) { return weaponFusionHintForOption(option || {}); },  // L55099
bridge() { return buildTreeWeaponBridgeHtml(); },  // L55106
// recipes() 里这一段的 weaponTag 过滤（L55059-55060）也应一并清掉
```

函数本体（3 段，供你批了之后直接粘）：

```js
/**
 * 取当前武器的元素标签（历史遗留：第三输入已随 C1 批移除）
 * 数据来源是武器定义上的 tagId，不是界面文案；没有武器时返回 null。
 * C1 批删掉 5 条武器标签配方后，本函数不再参与融合判定，
 * 只保留给武器侧的标签展示/调试使用。
 * @returns {Object|null} 标签对象 {id,name,glyph,color,weapon}
 */
function currentWeaponTag() {
  if (!WEAPON_TAG_CONFIG.enabled || !weaponEnabledNow()) return null;
  if (!state || !state.weapon) return null;
  const def = WEAPON_BY_ID[state.weapon.id];
  if (!def || !def.tagId) return null;
  return WEAPON_TAG_BY_ID[def.tagId] || null;
}
```

```js
/**
 * W 批 · 选卡时的「武器融合」提示
 * 只回答一件事：把这张卡拿到手，会不会和"当前武器标签"凑出一条新配方。
 * 返回的 text 固定 ≤12 个字（最长「与镜像双刃可融合」9 字），供卡面一句话提示。
 * @param {Object} option 奖励选项（需含 kind / id）
 * @returns {% raw %}{{fusion:Object, text:string}|null}{% endraw %}
 */
function weaponFusionHintForOption(option) {
  if (!WEAPON_TAG_CONFIG.enabled) return null;
  if (!option || option.kind !== 'magic' && option.kind !== 'tech') return null;
  const tag = currentWeaponTag();
  if (!tag) return null;
  const magicOk = (id) => state.ownedMagic.includes(id) || (option.kind === 'magic' && option.id === id);
  const techOk = (id) => state.ownedTech.includes(id) || (option.kind === 'tech' && option.id === id);
  const hit = FUSION_CONFIG.find((fusion) => (
    fusion.weaponTag === tag.id
      && state.fusions.indexOf(fusion.id) < 0
      && magicOk(fusion.magic)
      && techOk(fusion.tech)
      /* 这张卡本身必须是配方缺的那一半，否则提示会跑到别的卡上 */
      && ((option.kind === 'magic' && fusion.magic === option.id)
        || (option.kind === 'tech' && fusion.tech === option.id))
  ));
  if (!hit) return null;
  const def = WEAPON_BY_ID[tag.weapon];
  const shortName = (def && def.short) || '武器';
  return { fusion: hit, text: '与' + shortName + '可融合' };
}
```

```js
/**
 * W 批 · 「当前武器 → 可合成配方」说明条
 * ------------------------------------------------------------
 * 目的：让玩家只看面板就能推出「换武器会多出哪些配方」，不需要说明书。
 * 结构固定三行信息：
 *   ① 当前武器 + 其标签（第一输入是魔法、第二输入是科技、第三输入就是这里的标签）
 *   ② 五个标签各一行配方：已融合 / 可融合 / 缺 X（缺什么就写什么）
 *   ③ 一句换武器对比：换用 X 可多出 N 条配方
 * @returns {string} 说明条 HTML
 */
function buildTreeWeaponBridgeHtml() {
  /* X 批：武器系统默认关闭。面板不再出现"当前武器 → 配方"这块说明，
     避免玩家看到一把已经没有的武器；融合面板回到纯「魔法 + 科技」两输入。 */
  if (!WEAPON_CONFIG.enabled || !weaponEnabledNow()) return '';
  /* C1-5b：C1-1 删掉 5 条"武器标签融合"后，13 条配方全部只吃「魔法 + 科技」，
     不再有 fusion.weaponTag。这块"换武器会多/少哪些配方"的说明条因此失去了数据来源，
     继续渲染只会显示一行行空配方、让玩家误以为"换武器会让融合失效"。
     所以这里直接退场，并把结论写在代码里：换武器不再影响已获融合。 */
  if (!FUSION_CONFIG.some((fusion) => fusion.weaponTag)) return '';
  const tag = currentWeaponTag();
  const def = state.weapon ? WEAPON_BY_ID[state.weapon.id] : null;
  const tagName = tag ? tag.name : '无';
  const tagColor = tag ? tag.color : '#5b6c80';
  const head = '<span class="wb-head">当前武器 <b>' + (def ? def.name : '空手') + '</b>'
    + '<span class="wb-tag" style="color:' + tagColor + ';border-color:' + tagColor + '">'
    + (tag ? tag.glyph + ' ' + tagName : '无标签') + '</span>'
    + '<span class="wb-note">魔法 + 科技 + 武器标签 = 三条输入</span></span>';

  /* 每个标签一行：把「该标签专属配方」逐条标状态，缺什么直接写出来 */
  const rows = Object.keys(WEAPON_TAG_BY_ID).map((tid) => {
    const t = WEAPON_TAG_BY_ID[tid];
    const recipes = FUSION_CONFIG.filter((fusion) => fusion.weaponTag === tid);
    const isCurrent = !!tag && tag.id === tid;
    const cells = recipes.map((fusion) => {
      if (state.fusions.includes(fusion.id)) {
        return '<span class="wb-recipe is-owned">' + fusion.name + ' · 已融合</span>';
      }
      const st = fusionInputState(fusion);
      const miss = [];
      if (!st.magicOk) miss.push((MAGIC_BY_ID[fusion.magic] || {}).name || fusion.magic);
      if (!st.techOk) miss.push((TECH_BY_ID[fusion.tech] || {}).name || fusion.tech);
      if (!st.tagOk) miss.push('武器·' + t.name);
      if (miss.length === 0) {
        return '<span class="wb-recipe is-ready">' + fusion.name + ' · 可融合</span>';
      }
      return '<span class="wb-recipe is-missing">' + fusion.name + ' · 缺 ' + miss.join('/') + '</span>';
    }).join('');
    return '<div class="wb-row' + (isCurrent ? ' is-current' : '') + '">'
      + '<span class="wb-tag-name" style="color:' + t.color + '">' + t.glyph + ' ' + t.name + '</span>'
      + '<span class="wb-weapon">' + ((WEAPON_BY_ID[t.weapon] || {}).short || '') + '</span>'
      + cells + '</div>';
  }).join('');

  /* 对比句：挑「换过去能多出最多配方」的那把武器，数字是动态算的，不是写死的 */
  let best = null;
  WEAPON_CONFIG.weapons.forEach((w) => {
    if (!w.tagId || (tag && w.tagId === tag.id)) return;
    const count = FUSION_CONFIG.filter((fusion) => (
      fusion.weaponTag === w.tagId && !state.fusions.includes(fusion.id)
    )).length;
    if (count > 0 && (!best || count > best.count)) best = { weapon: w, count: count };
  });
  const swap = best
    ? '<span class="wb-swap">换用<b>' + best.weapon.name + '</b>可多出 <b>' + best.count + '</b> 条配方</span>'
    : '<span class="wb-swap">当前武器已覆盖全部标签配方</span>';

  return head + '<div class="wb-grid">' + rows + '</div>' + swap;
}
```

两个消费点（删掉后 `wHint` / `bridgeHtml` 从此不存在）：

```js
    /* W 批：武器标签融合提示。与上面的通用提示并列显示，互不覆盖：
       通用提示读的是「魔法↔科技」，这里读的是「当前武器标签」这第三输入。 */
    const wHint = (FUSION_HINT_CONFIG.enabled && (option.kind === 'magic' || option.kind === 'tech'))
      ? weaponFusionHintForOption(option) : null;
    const wHintHtml = wHint
      ? '<span class="r-fuse is-weapon" data-weapon-fuse="' + wHint.fusion.id + '">'
        + wHint.text + '</span>' : '';
```

```js
  /* W 批：三输入关系条（当前武器标签 → 可合成配方）
     X 批：武器关闭时内容为空，同时把容器本身隐藏（否则会留下一个空框） */
  if (ui.treeWeaponBridge) {
    const bridgeHtml = buildTreeWeaponBridgeHtml();
    ui.treeWeaponBridge.innerHTML = bridgeHtml;
    ui.treeWeaponBridge.style.display = bridgeHtml ? '' : 'none';
  }
```

另外 3 处小改：`wHintHtml` 的挂载点也要删。

```js
// L45196：把 (canFuse || wHint ? ' can-fuse' : '') 改回 (canFuse ? ' can-fuse' : '')
      + (wHint ? '<span class="r-fuse-badge is-weapon">可融合·武器</span>' : '')
      + wHintHtml
// 上面两行整行删除（is-weapon 徽章、wHintHtml 挂载点）
```

> 连带 CSS：`.wb-*`（L2288-2314，27 行）与 `.r-fuse.is-weapon` / `.r-fuse-badge.is-weapon`（L2976-2981，6 行）一起删。合计约 127 行。**默认不粘。**

---

## B5 · 武器区 1,082 行：一行不删，只分类

> 口径：名称含 `weapon` 的 29 个函数 + 4 个配置对象 + 标题页/HUD 的 6 行静态 DOM + 武器 CSS，按行并集去重 = **1,082 行**（报告写 1,067，差 15 行来自配置块边界取值）。

### B5-1 被 C1 之后彻底断链（恒空 / 恒 null）

| 项 | 位置 | 行数 | 判据 |
|---|---|---|---|
| `currentWeaponTag` | L17281-17287 | 7 | 恒 `null`（`weaponEnabledNow()` 恒 false） |
| `weaponFusionHintForOption` | L44944-44964 | 21 | 依赖 `currentWeaponTag`，恒 `null` |
| `buildTreeWeaponBridgeHtml` | L46939-46996 | 58 | 两道独立早退，恒 `''` |
| `wHint` 消费点 | L45188-45194 / 45196 / 45198 / 45207 | ≈9 | 恒 null，`is-weapon` 徽章与挂载点永不出现 |
| `bridge` 调用块 | L47028-47034 | 7 | 恒 `''`，容器永远 `display:none` |
| `.wb-*` CSS | L2288-2314 | 27 | 只服务上面的空串 |
| `.r-fuse.is-weapon` / `.r-fuse-badge.is-weapon` | L2976-2981 | 6 | 只服务 `wHint` |
| debug 入口 `currentTag/hint/bridge/recipes` | L55050 / 55099 / 55106 / 55057-55061 | 4 个符号 | tools 脚本在调，不能动 |
| **小计** | | **≈127** | 其中 4 个 debug 符号是硬阻塞 |

### B5-2 挂在活引用上（删就必须同时改调用点）

| 组 | 成员（行数） | 调用点 | 运行期实际行为 |
|---|---|---|---|
| 无条件执行 | `ensureWeaponState`(30) `renderWeaponModes`(26) `renderWeaponSettings`(12) `renderWeaponHud`(17) `setWeaponsEnabled`(14) `toggleWeaponDebug`(5) | L17127 / L49772；L50070；L53770；L23823；L53761；L53146 | **每局 / 每次渲染都在跑**：建 `state.weapon`、把标题武器行与 HUD 武器条隐藏 |
| 自守卫空转 | `tryWeaponAttack`(11) `updateWeapon`(28) `weaponSwingNow`(95) `drawWeaponHeld`(199) `drawWeaponFx`(61) `drawWeaponDebug`(51) | L53139/53141/53143；L54224；绘制管线 L25654-25658 | 输入 / 每帧 / 绘制都会进函数，第一行 `if (!weaponEnabledNow()) return`，**零开销空转** |
| 链内工具 | `weaponById`(3) `weaponStatsFor`(14) `weaponGeometry`(20) `weaponAngleDelta`(6) `weaponAssistAngle`(25) `weaponHitTargetsPure`(40) `weaponHitTargets`(5) `grantWeaponMods`(19) `applyWeaponTagRiders`(105) `setWeaponMeta`(15) | 只被上面两组调用 | 运行期不可达，但符号全部接线 |
| 配置 / 数据 | `WEAPON_TAG_CONFIG` / `WEAPON_CONFIG` / `WEAPON_BY_ID` / `WEAPON_TAG_BY_ID` | 活代码 + debug 共 35 / 5 / 14 / 4 处 | 被 `render*`、`ensureWeaponState`、debug 读 |
| 静态 DOM | `#weaponModeRow` `#weaponModes` `#weaponNote`（5 行）+ `#weaponChip`（1 行） | L5863-5867 / L5315 | 元素真实存在，被 `render*` 主动加 `.hidden` |
| 武器 HUD CSS | `.skill-chip.is-weapon` 2 行 | L1285-1286 | 活（HUD 条） |
| 仅 debug | `weaponDpsReport`(25) `weaponDpsLayout`(14) | L55275 / L55315 等 | 只有验收脚本调用 |
| **合计** | | **≈1,082** | 与 B5-1 相加有重叠（工具函数同时被两组调用），按并集去重 |

### 一句话结论

1,082 行里没有一段是“零引用可删”的独立死块：唯一恒空的那 127 行，恰好压在 debug API 上。
要动它，等于同时动 `tools/arcane_fusion.js`、`arcane_verify.js`、`arcane_weapons.js` 三个验收脚本——那是另一个决策，不是补丁。

---

## 差值说明（先看再粘）

- **B1：报告写 -193，实测 -180**。差 13 行：报告把函数之间的空行也算进跨度，补丁不动空行；函数本体 + 文档注释就是 180 行。
- **B2：报告写 -106（20 条），实测 -118**。多 12 行：报告只把单行注释算进去，这次把 `.title-duo`、`.title-actions` 等规则上方的整块注释（合计 12 行）也随规则删了。
- **B2-VAR：-19**，与报告的 19 行一致。
- **B3：报告写 -26，实测 -28**。多 2 行：`roomVariants` 的说明注释和 `lineDuration` 的 JSDoc 随键一起删；2 个行内键（`storageMoney` / `firstBattleAt`）只改行、不减行。
- **总计：报告 -193-125-26 = -344；本补丁 -345**。差 1 行来自 B1 的空行口径。

## 可选追加（未计入上面的数字，要不要由你）

审计里还有 4 个死 class 当时按“主选择器”归到了活规则，没进 20 条；它们同样零命中：
| 选择器 | 行数 | 说明 |
|---|---|---|
| `.readout > i.readout-enemy` | 10 | `class="readout-enemy"` 命中 0 |
| `.mini-card.r-common` | 1 | `r-common` 命中 0 |
| `.setting-row .setting-hint` | 1 | `setting-hint` 命中 0 |
| `.hud-icon svg` | 1 | 组内 token，删它要同时去掉上一行的逗号 |
另有 5 条 `@media` 覆写，服务的是已删的死容器：`.title-duo`（L3866 / L3908）、`.rules-grid`（L3882）、`.rules-side`（L3885）、`.title-actions`（L3913），共 5 行。
要的话说一声，我按同样格式补一段。

## 不粘但必须知道的三处

1. `.title-duo` 的派生规则（`.title-duo .title-difficulty` 等 6 行）仍然在样式表里。它们匹配不到任何 DOM，纯惰性残留；删不删都不影响画面。
2. `#treeWeaponBridge`（L5439）留着空容器，靠 `bridge` 调用块每帧 `display:none`；若走 B4 的备用段，记得把容器也删或加 CSS 隐藏。
3. `WEAPON_TAG_CONFIG.enabled = true` 与 `WEAPON_CONFIG.enabled = false` 的错位是本轮所有“恒空”的根因；将来要重新打开武器，先改 `WEAPON_CONFIG.enabled`，再回头看 B4。
