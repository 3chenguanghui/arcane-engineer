# 里程碑 3 · 永久天赋的第一次呈现（分层解锁补丁）

> 基线：`index_arcane_v2.html` · 2,711,040 B · MD5 `23194ECC5F7733054C4E511476B885C7`
> **只产出补丁，不改主文件。** 应用前现场重读 MD5，流程同 [FIRST_DEATH_PATCH.md](file:///D:/其他/TRAE宝/奥术工程师/FIRST_DEATH_PATCH.md)。

## 1. 现状（是不是“一次性砸给玩家”）

| 入口 | 现在看到什么 | 问题 |
|---|---|---|
| 标题页 / 结算页天赋块 | `buildTalentRowsHtml` 自动挑 **3 条可买项** | 数量对，但挑的是“配置顺序前 3 条”（首局=体魄/奥脉/坚壁），其中“奥脉”不对应屏幕上任何可见数字 |
| 「打开天赋页」 | 四列 **30 张卡同时铺开**，T1/T2/T3 混排 | 首局 0 结晶、30 个禁用按钮，认知过载 |
| 第 5 层死亡预览 | 只有到第 5 层才出现 | 第 1–4 层死的新手看不到“结晶能换什么” |
| 解锁机制 | 只有 `TALENT_TIER_CONFIG` 的**购买前置** | 是“买不买得起”，不是“看不看得懂” |

**结论**：数量上不是一次砸 30 个（标题只有 3 行），但**天赋页是**；且首局三项没有和 HUD 上的可见数字对齐。

## 2. 首局三项为什么是这三个（有依据）

| 天赋 | 对应屏幕上的可见证据 | 为什么新手能懂 |
|---|---|---|
| `hp` 体魄 | 左上红色生命条会变长 | “血更多”无需术语 |
| `steady` 稳击 | 打怪时跳出的伤害数字变大 | “打得更疼”可直接验证 |
| `greed` 结晶 | 结算页 `本局结晶 +N` 变大 | “下一局钱更多”闭环最短 |

被替换的 `aether`（奥能上限）与 `armor`（减伤）不是弱，而是**首局没有可见对照物**：奥能条变化需要长战斗才感知，减伤没有数字反馈。它们在第 2 层随 T1 一起开放。

## 3. 分层阶梯（用 `bestFloor`，不新增存档字段）

| 阶段 | 触发条件（历史最高层） | 可见项 | 可见数量 | 文案（≤18 字） |
|---|---|---|---|---|
| 0 | 首局 / 最高 1 层 | 仅 `hp` `steady` `greed` | **3** | `首局只开放 3 项 · 第 2 层再开放` |
| 1 | 最高 2 层 | + 全部 T1 | **11** | `已开放 11 项 · 第 3 层再开放` |
| 2 | 最高 3 层 | + 全部 T2 | **21** | `已开放 21 项 · 第 4 层全部开放` |
| 3 | 最高 ≥4 层 | 全部 T3 | **30** | `已开放全部 30 项` |

规则：
- **本局内不改阶梯**：用开局快照 `state.onboardBaseline.bestFloor`，避免第 1 层打到第 2 层时天赋页突然多出 8 张卡。
- **已买过的永不隐藏**：老存档里 T2/T3 有点数的一律显示，只隐藏“没买过且未到层”的项。
- 关闭开关 `TALENT_UNLOCK_CONFIG.enabled = false` 时立即回到旧版 30 项全展示（可回滚）。

## 4. 补丁（函数级锚点）

### 块 0 · 头信息
```
TARGET_MD5 = 23194ECC5F7733054C4E511476B885C7
应用顺序：块1 → 块2 → 块3 → 块4 → 块5；每块后做一次语法检查。
```

### 块 1 · 新增配置与判定函数
**锚点**（`buildTalentRowsHtml` 函数声明前插入，唯一）：
```
function buildTalentRowsHtml() {
```
在其上方插入：
```
/**
 * 里程碑3：天赋分层解锁
 * starterIds 只放“屏幕上能看到对应数字”的三项；其余按 tier 随最高层开放。
 * enabled=false 时完全回到旧版（30 项全展示），用于回滚。
 */
const TALENT_UNLOCK_CONFIG = {
  enabled: true,
  starterIds: ['hp', 'steady', 'greed'],
  /* 阶段 → 最低历史层；index 即 stage */
  stages: [
    { minFloor: 1, maxTier: 0, count: 3 },
    { minFloor: 2, maxTier: 1, count: 11 },
    { minFloor: 3, maxTier: 2, count: 21 },
    { minFloor: 4, maxTier: 3, count: 30 }
  ]
};

/**
 * 取“用于解锁判定的历史最高层”
 * 本局/结算页用开局快照，标题页用存档值，保证本局内阶梯不跳动。
 * @returns {number} ≥1 的整数
 */
function talentUnlockFloor() {
  const metaFloor = (state && state.meta && Number(state.meta.bestFloor)) || 1;
  if (!state || state.mode === 'title') return Math.max(1, metaFloor);
  const snap = state.onboardBaseline && Number(state.onboardBaseline.bestFloor);
  return Math.max(1, snap || metaFloor);
}

/**
 * 当前解锁阶段
 * @returns {{stage:number, floor:number, maxTier:number, nextFloor:number|null, text:string}}
 */
function talentStageInfo() {
  if (!TALENT_UNLOCK_CONFIG.enabled) {
    return { stage: 3, floor: 99, maxTier: 3, nextFloor: null, text: '已开放全部 30 项' };
  }
  const floor = talentUnlockFloor();
  const stages = TALENT_UNLOCK_CONFIG.stages;
  let stage = 0;
  for (let i = 0; i < stages.length; i += 1) {
    if (floor >= stages[i].minFloor) stage = i;
  }
  const next = stages[stage + 1] ? stages[stage + 1].minFloor : null;
  const count = stages[stage].count;
  const text = next
    ? ('已开放 ' + count + ' 项 · 第 ' + next + ' 层再开放')
    : '已开放全部 30 项';
  return { stage: stage, floor: floor, maxTier: stages[stage].maxTier, nextFloor: next, text: text };
}

/**
 * 某一天赋是否对当前玩家可见
 * 已买过（Lv>0）永不隐藏，避免老存档“花钱买的东西消失”。
 * @param {Object} talent TALENT_CONFIG 条目
 * @returns {boolean}
 */
function talentVisible(talent) {
  if (!TALENT_UNLOCK_CONFIG.enabled || !talent) return true;
  if (talentLevelOf(talent.id) > 0) return true;
  if (TALENT_UNLOCK_CONFIG.starterIds.indexOf(talent.id) >= 0) return true;
  return talent.tier <= talentStageInfo().maxTier;
}

/**
 * 当前可见天赋数量（断言与标题页计数用）
 * @returns {number}
 */
function talentVisibleCount() {
  return TALENT_CONFIG.filter(talentVisible).length;
}

/**
 * 分类内“未开放”占位卡（不渲染购买按钮，避免误点）
 * @param {number} hidden 隐藏数量
 * @param {number|null} nextFloor 下一阶段楼层
 * @returns {string} HTML
 */
function talentLockedHtml(hidden, nextFloor) {
  if (!hidden) return '';
  return '<div class="tal-locked" data-talent-locked="1" data-locked-count="' + hidden + '">'
    + hidden + ' 项未开放'
    + (nextFloor ? ' · 第 ' + nextFloor + ' 层开放' : '')
    + '</div>';
}
```

### 块 2 · 标题/结算天赋块：只挑可见项 + 阶梯说明
**锚点**（整个 `buildTalentRowsHtml` 函数，按当前文本替换）：
```
function buildTalentRowsHtml() {
  if (!TALENT_V2_CONFIG.enabled) {
    return '<div class="talent-note">天赋系统已关闭（TALENT_V2_CONFIG.enabled = false）。</div>';
  }
  const picked = TALENT_CONFIG.filter((talent) =>
    talentLevelOf(talent.id) < talent.maxLevel &&
    !talentExclusiveConflict(talent.id) &&
    talentStateOf(talent.id) !== 'capped' &&
    talentPrereqMet(talent)
  ).slice(0, 3);

  const rows = picked.map((talent) => {
    const level = talentLevelOf(talent.id);
    const cost = talentCostOf(talent);
    const cat = TALENT_CATEGORY_CONFIG[talent.cat];
    const affordable = state.meta.crystals >= cost;
    return '<div class="talent-row">'
      + '<canvas class="t-glyph t-ico" width="24" height="24" data-icon="' + talent.icon
      + '" data-accent="' + cat.accent + '"></canvas>'
      + '<div class="t-info"><b>' + talent.name + ' <i class="t-cat">' + cat.short + '</i></b>'
      + '<span>' + talent.detail + '</span></div>'
      + '<span class="t-level">Lv ' + level + '/' + talent.maxLevel + ' · ' + cost + ' 结晶</span>'
      + '<button type="button" class="t-buy" data-talent-id="' + talent.id + '"'
      + (affordable ? '' : ' disabled') + '>' + (level > 0 ? '升级' : '解锁') + '</button>'
      + '</div>';
  }).join('');

  const total = totalCostOfTalents();
  const spent = talentTotalSpent(null);
  return rows
    + '<button type="button" class="talent-open-btn" data-talent-open="1">'
    + '打开天赋页 · ' + TALENT_CONFIG.length + ' 项'
    + ' · 已投入 ' + spent + '/' + total + ' 结晶</button>';
}
```
替换为：
```
function buildTalentRowsHtml() {
  if (!TALENT_V2_CONFIG.enabled) {
    return '<div class="talent-note">天赋系统已关闭（TALENT_V2_CONFIG.enabled = false）。</div>';
  }
  /* 里程碑3：先过滤“当前可见”，再挑 3 条可买项 */
  const stage = talentStageInfo();
  const visible = TALENT_CONFIG.filter(talentVisible);
  const picked = visible.filter((talent) =>
    talentLevelOf(talent.id) < talent.maxLevel &&
    !talentExclusiveConflict(talent.id) &&
    talentStateOf(talent.id) !== 'capped' &&
    talentPrereqMet(talent)
  ).slice(0, 3);

  const rows = picked.map((talent) => {
    const level = talentLevelOf(talent.id);
    const cost = talentCostOf(talent);
    const cat = TALENT_CATEGORY_CONFIG[talent.cat];
    const affordable = state.meta.crystals >= cost;
    return '<div class="talent-row">'
      + '<canvas class="t-glyph t-ico" width="24" height="24" data-icon="' + talent.icon
      + '" data-accent="' + cat.accent + '"></canvas>'
      + '<div class="t-info"><b>' + talent.name + ' <i class="t-cat">' + cat.short + '</i></b>'
      + '<span>' + talent.detail + '</span></div>'
      + '<span class="t-level">Lv ' + level + '/' + talent.maxLevel + ' · ' + cost + ' 结晶</span>'
      + '<button type="button" class="t-buy" data-talent-id="' + talent.id + '"'
      + (affordable ? '' : ' disabled') + '>' + (level > 0 ? '升级' : '解锁') + '</button>'
      + '</div>';
  }).join('');

  const total = totalCostOfTalents();
  const spent = talentTotalSpent(null);
  return rows
    + '<div class="talent-note" data-talent-stage="' + stage.stage + '"'
    + ' data-talent-visible="' + visible.length + '">' + stage.text + '</div>'
    + '<button type="button" class="talent-open-btn" data-talent-open="1">'
    + '打开天赋页 · 已开放 ' + visible.length + '/' + TALENT_CONFIG.length + ' 项'
    + ' · 已投入 ' + spent + '/' + total + ' 结晶</button>';
}
```

### 块 3 · 天赋页：隐藏未开放卡，保留“N 项未开放”占位
**锚点**（`buildTalentsPage` 内四列生成，唯一）：
```
    const owned = list.filter((t) => talentLevelOf(t.id) > 0).length;
    return '<section class="tal-col" data-talent-col="' + catId + '" style="--cat-accent:' + cat.accent + '">'
      + '<header class="tal-col-head"><b>' + cat.name + '</b>'
      + '<span>' + owned + ' / ' + list.length + '</span></header>'
      + '<div class="tal-col-body">' + list.map(talentCardHtml).join('') + '</div>'
      + '</section>';
```
替换为：
```
    const shown = list.filter(talentVisible);
    const hidden = list.length - shown.length;
    const owned = shown.filter((t) => talentLevelOf(t.id) > 0).length;
    return '<section class="tal-col" data-talent-col="' + catId + '" style="--cat-accent:' + cat.accent + '">'
      + '<header class="tal-col-head"><b>' + cat.name + '</b>'
      + '<span>' + owned + ' / ' + shown.length + '</span></header>'
      + '<div class="tal-col-body">' + shown.map(talentCardHtml).join('')
      + talentLockedHtml(hidden, talentStageInfo().nextFloor) + '</div>'
      + '</section>';
```

### 块 4 · 样式
**锚点**（唯一注释）：
```
  /* ---------- 辅助瞄准三档：分段按钮（复用设计令牌，不引入新配色） ---------- */
```
在其上方插入：
```
  /* 里程碑3：未开放天赋占位 —— 虚线 + 低对比，不参与点击 */
  .tal-locked {
    margin: 6px 0 2px;
    padding: 10px 8px;
    border: 1px dashed rgba(126, 164, 214, 0.26);
    border-radius: 6px;
    color: rgba(255, 231, 184, 0.50);
    font-size: 11.5px;
    line-height: 1.5;
    text-align: center;
    pointer-events: none;
  }
```

### 块 5 · 第 5 层预览文案（去掉“完整 30 项”暗示）
**锚点**（`buildOnboardTalentPreviewHtml` 内，唯一）：
```
    + '<div class="talent-note">点一次升级，下一局开局立刻生效；完整 30 项在标题页「天赋」里。</div>'
```
替换为：
```
    + '<div class="talent-note">点一次升级，下一局开局立刻生效；其余天赋随层数开放。</div>'
```

### 块 6 · 自检口
建议在 `talentVisibleCount` 后追加：
```
/* 验收：控制台读 __talStage() */
window.__talStage = function () {
  const s = talentStageInfo();
  return { stage: s.stage, floor: s.floor, visible: talentVisibleCount(), text: s.text };
};
```

## 5. 验收

| 断言 | 方法 | 通过条件 |
|---|---|---|
| 首局只 3 项 | 清档 / `bestFloor=1`，开标题页与天赋页 | 天赋块 3 行；天赋页共 3 张卡 + 4 个占位（各分类 hidden 数 4/3/4/2） |
| 第 2 层开放 11 项 | `meta.bestFloor=2` 后重开 | `data-talent-visible=11`；天赋页 11 张卡 |
| 第 3 层 21 / 第 4 层 30 | 同上 | 21 / 30 |
| 本局不跳阶 | 首局从第 1 层走到第 2 层，中途打开天赋页 | 仍是 3 项（读开局快照） |
| 老存档不丢 | 手工给 `tier=3` 项升级 | 该项仍显示，不因阶段被隐藏 |
| 回滚 | `TALENT_UNLOCK_CONFIG.enabled=false` | 立即恢复 30 项，UI 无报错 |
| 不遮挡 | 720p / 1080p 截图 | 占位不超出列宽，无横向滚动 |

## 6. 风险与取舍

- **测试脚本可能断言 30 张卡**：改为断言 `data-talent-visible` 与占位数量；这是预期变更，不是回归。
- **首局 0 结晶**：三项按钮全是 disabled，玩家只能看不能买。这是正确的“预告”，但文案必须写“下一局生效”，已保留。
- **不在本局中途弹解锁提示**：避免打断战斗；解锁信息只在标题/结算/天赋页出现。
