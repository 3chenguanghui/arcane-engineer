# 里程碑 2 · 第一次死亡的设计 + 死亡归因补丁

> 基线：`index_arcane_v2.html` · 2,711,040 B · MD5 `23194ECC5F7733054C4E511476B885C7`
> **只产出补丁，不改主文件。** 应用前必须现场重读 MD5：
> `$f="D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html"; $b=[IO.File]::ReadAllBytes($f); [BitConverter]::ToString([Security.Cryptography.MD5]::Create().ComputeHash($b)).Replace('-','')`
> 锚点一律用函数名/唯一代码行，不用行号。每段可单独回滚。

## 1. 现在死完到底给了什么（代码事实）

| 顺序 | 内容 | 字号/位置 | 回答的问题 |
|---|---|---|---|
| 1 | `机体失效` + 楼层 + 结晶保留 | h2 | 我死了？ |
| 2 | 到达楼层 / 击杀 / 核心组合 | 三格 | 这局打到哪 |
| 3 | 死亡归因：标签（被围/被远程/…）+ 判定规则 | 大字 + 12.5px | 哪类伤害 |
| 4 | 一句话：`你在第 X 层被<怪>打死，<类别>占 Y%` | 13px | 谁杀的我 |
| 5 | 承伤占比条 + 图例（含主凶、最大单次、贴身点） | 条 + 11px | 伤害从哪来 |
| 6 | 死亡层骤升（仅命中阈值才出） | 12px | 是不是这一层突然变难 |
| 7 | 输出构成 + 总承伤/受击/致命一击 | 10.5px | 我打得够不够 |
| 8 | 塔灵台词、自传、统计网格 | 10.5–13px | 氛围与记录 |
| 9 | 第 5 层才有的 3 张天赋预览 + 天赋升级框 | 卡片 | 结晶能干嘛 |

**缺口（正是用户要求的三点）**
1. **没有“什么时候开始掉血”**：账本只有累计与按层，没有首次/末次受击时间。
2. **没有“有没有躲的可能”**：只有分类名，没有可执行的躲避结论。
3. **第一次死亡没有“只教一件事”的收口**：新手要自己从 9 个块里找重点；第 1–4 层死还看不到结晶用途。

## 2. 第一次死亡应该教会他的三件事（按优先级）

| 优先级 | 教什么 | 为什么是它 | 证据/约束 |
|---|---|---|---|
| P0 | **我死于哪一类、能不能躲** | 直接决定下一局是否改变行为 | 现有分类已稳定（6 类），只差一句动作 |
| P1 | **一个可执行动作**（不是“提高意识”） | 新手只会执行具体动作 | 每条 ≤18 字，符合既有提示字数约束 |
| P2 | **结晶 → 天赋 → 下一局** | 肉鸽的“永久成长”闭环，首局必须看见 | 第 5 层才预览，第 1–4 层死会断链 |

不教：构筑术语、融合公式、词缀、挑战等级。死亡页已有 9 块，新增只允许 **1 张卡 + 2 行**，避免把复盘变成第二篇论文。

## 3. 补丁（函数级锚点）

### 块 0 · 头信息（写入补丁文档前现场核对）
```
TARGET_MD5 = 23194ECC5F7733054C4E511476B885C7   // 2026-11-08 19:56 读取
要求：MD5 不一致时停止应用；三块全部应用后再复读一次。
```

### 块 1 · 账本新增时间线与最近受击
**锚点**（`p1LedgerReset` 内，唯一）：
```
      maxByCat: Object.assign({}, zero),
```
替换为：
```
      maxByCat: Object.assign({}, zero),
      /* 里程碑2：第一次/最后一次掉血的时刻，回答"什么时候开始掉血" */
      firstAt: null, firstFloor: 0, lastAt: null,
      /* 最近 12 次受击，用于"最后 10 秒挨了几下"；环形截断，避免长局内存增长 */
      recent: [],
```

### 块 2 · 记账时写入时间线
**锚点**（`p1NoteIncoming` 内，唯一）：
```
  L.incoming.total += v;
  L.incoming.hits += 1;
```
替换为：
```
  L.incoming.total += v;
  L.incoming.hits += 1;
  /* 里程碑2：首末受击时刻（旧存档账本无这些字段时按 null 兜底） */
  if (L.incoming.firstAt == null) {
    L.incoming.firstAt = Number(state.elapsed) || 0;
    L.incoming.firstFloor = state.floor;
  }
  L.incoming.lastAt = Number(state.elapsed) || 0;
  if (!Array.isArray(L.incoming.recent)) L.incoming.recent = [];
  L.incoming.recent.push({ at: L.incoming.lastAt, amount: v, cat: cat });
  if (L.incoming.recent.length > 12) L.incoming.recent.shift();
```

### 块 3 · 新增“生存时间线 / 可躲性 / 首死卡”
**锚点**（`buildReviewHtml` 函数声明前插入，唯一）：
```
function buildReviewHtml(death, won) {
```
在其上方插入：
```
/**
 * 秒数 → mm:ss（死亡页时间线专用，不依赖 formatTime 的样式）
 * @param {number} sec 秒
 * @returns {string} 例如 02:14
 */
function p1Clock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/**
 * 致命伤害种类的躲避建议：标签只用于区分，文案必须是可执行动作
 * 映射依据：contact/charge 在 damagePlayer 中有前摇；sigil/hazard 是延迟区；
 * barrel 由玩家引爆；bullet/burst 是可见弹道/蓄力。
 * @param {Object|null} death resolveDeathCause() 返回值
 * @returns {{tag:string, text:string}} 可躲性标签 + ≤18 字动作
 */
function p1DodgeAdvice(death) {
  const kind = (death && death.kind) || (state.lastHit && state.lastHit.kind) || 'unknown';
  const map = {
    bullet:      { tag: '可躲', text: '弹道可见，侧移别后退' },
    burst:       { tag: '可躲', text: '蓄力有红光，先绕开' },
    charge:      { tag: '可躲', text: '冲锋有预警，横向闪' },
    sigil:       { tag: '可躲', text: '脚下符阵，出圈再打' },
    hazard:      { tag: '可躲', text: '危险区会亮，别站里面' },
    contact:     { tag: '难躲', text: '贴脸就掉血，留一个身位' },
    selfdestruct:{ tag: '难躲', text: '红圈亮起，立刻拉开' },
    barrel:      { tag: '自伤', text: '别站桶边，先点爆' },
    unknown:     { tag: '未知', text: '保持移动，别站桩' }
  };
  if (death && death.bossKind) {
    if (kind === 'contact') return { tag: '难躲', text: '被蹭死：贴身也要退' };
    return { tag: '可躲', text: '先看预警圈，再还手' };
  }
  return map[kind] || map.unknown;
}

/**
 * 第一次死亡专用卡：时间线 + 可躲性 + 结晶去向
 * 只在“人生第一次死亡”出现（deaths === 1），且只在失败结算页调用。
 * @param {Object|null} death resolveDeathCause() 返回值
 * @returns {string} HTML；非首死返回空串
 */
function buildFirstDeathLessonHtml(death) {
  if (!p1ReviewReady() || !state || !state.meta) return '';
  const stats = state.meta.stats || {};
  if (Number(stats.deaths || 0) !== 1) return '';   // 结算前已 +1，所以首死恰好为 1
  const L = state.p1Ledger;
  if (!L || !L.incoming || !(L.incoming.total > 0)) return '';
  const advice = p1DodgeAdvice(death);
  const firstAt = L.incoming.firstAt;
  const lastAt = L.incoming.lastAt != null ? L.incoming.lastAt : state.elapsed;
  const span = (firstAt != null) ? Math.max(0, Math.round(lastAt - firstAt)) : null;
  const recent = (L.incoming.recent || []).filter((h) => h.at >= lastAt - 10);
  const recentHits = recent.length;
  const recentDmg = recent.reduce((sum, h) => sum + (h.amount || 0), 0);
  const line1 = (firstAt != null)
    ? ('时间线：' + p1Clock(firstAt) + ' 开始掉血 → ' + p1Clock(lastAt) + ' 倒下'
      + (span != null ? ' · ' + span + ' 秒' : ''))
    : '时间线：本局受击时刻未记录';
  const line2 = recentHits > 0
    ? ('最后 10 秒：挨 ' + recentHits + ' 下 / ' + recentDmg + ' 点')
    : '最后 10 秒：没有再挨打';
  return '<div class="p1-firstdeath" data-p1-firstdeath="1">'
    + '<div class="p1-fd-head">第一次死亡 · 只说明这一次</div>'
    + '<div class="p1-fd-line">' + line1 + '</div>'
    + '<div class="p1-fd-line">' + line2 + '</div>'
    + '<div class="p1-fd-advice"><span class="p1-fd-tag">' + advice.tag + '</span>'
    + advice.text + '</div>'
    + '<div class="p1-fd-line p1-fd-gold">结晶 +' + (state.crystalsEarned || 0)
    + '：点下方任意天赋，下一局生效</div>'
    + '</div>';
}
```

### 块 4 · 结算页插入首死卡（紧跟在复盘之后）
**锚点**（`showResult` 内，唯一）：
```
    + buildReviewHtml(death, false)
```
替换为：
```
    + buildReviewHtml(death, false)
    + buildFirstDeathLessonHtml(death)
```

### 块 5 · 样式（放在现有设置页教学样式之后）
**锚点**（唯一注释）：
```
  /* ---------- 辅助瞄准三档：分段按钮（复用设计令牌，不引入新配色） ---------- */
```
在其上方插入：
```
  /* 里程碑2：第一次死亡卡 —— 与 p1 复盘同色系，但不抢结论 */
  .p1-firstdeath {
    margin: 10px 0 4px;
    padding: 10px 12px;
    border: 1px solid rgba(255, 210, 120, 0.30);
    border-radius: 6px;
    background: linear-gradient(180deg, rgba(40, 28, 10, 0.72), rgba(20, 16, 12, 0.72));
    text-align: left;
  }
  .p1-fd-head {
    font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.12em;
    color: #ffc247; margin-bottom: 5px;
  }
  .p1-fd-line { font-size: 12.5px; line-height: 1.55; color: #ffe7b8; }
  .p1-fd-advice {
    margin: 4px 0; font-size: 13px; line-height: 1.5; color: #fff4d6;
  }
  .p1-fd-tag {
    display: inline-block; margin-right: 6px; padding: 1px 6px;
    border: 1px solid rgba(255, 210, 120, 0.45); border-radius: 4px;
    font-family: var(--mono); font-size: 10.5px; color: #ffd166;
  }
  .p1-fd-gold { color: #ffd166; }
```

### 块 6 · 自检口（方便验收，不影响玩家）
**锚点**（`buildFirstDeathLessonHtml` 之后无依赖；放在同一函数后）：
```
  state.__p1FirstDeath = { advice: advice.tag + ' · ' + advice.text, firstAt: firstAt, lastAt: lastAt };
```
建议加在 `buildFirstDeathLessonHtml` 的 `return` 之前，便于控制台断言。

## 4. 验收（不靠感觉）

| 断言 | 方法 | 通过条件 |
|---|---|---|
| 首死才出现 | 跑一局故意死，控制台 `document.querySelectorAll('[data-p1-firstdeath]').length` | 首次 = 1；第二局死 = 0 |
| 时间线真实 | 对照 `state.elapsed` 与账本 `firstAt/lastAt` | 差值 = 实际存活时间 ±1s |
| 可躲性有依据 | 用 `?p1=off` 对照旧版 | 旧版无此卡、无报错 |
| 不遮挡/不超高 | 结算页 720p 截图 | 卡片位于复盘之后，首屏仍能看到结论；新增高度 ≤ 120px |
| 字数 | 逐条数 | 动作文案 ≤18 字（当前最长 11 字） |
| 旧存档兼容 | 读入旧账本 | `firstAt == null` 时显示“未记录”，不报错 |

## 5. 应用顺序与回滚

1. 块 1 → 块 2 → 块 3 → 块 4 → 块 5 → 块 6。
2. 每块应用后只做语法检查 + 打开结算页（可用 `__roamDebug.forceDeath()` 若存在）的自检。
3. 任一块失败：仅回滚该块，不整体回滚。
4. 三块落地后复读 MD5 并写入 `DEATH_REVIEW_PATCH.md` 的“已合并”状态。
