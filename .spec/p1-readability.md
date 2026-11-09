# P1 · 可读性与复盘（规格）

> 纪律：不提问、自行裁决并写 PROGRESS；不改弱已 PASS 断言；单文件零依赖、函数级注释。
> 本文写完即开工，不发审阅请求。

## 0. 非目标

- 不改任何战斗数值、掉落、楼层生成、元进度货币。
- 不新增外部资源（字体 / 图片 / 第三方库）；全部 Canvas 与内联 DOM。
- 不重写结算页结构：只在「结论 → 证据 → 细节」之间插入新层级，旧字段全部保留。

## 1. 总开关与配置（三件独立）

```js
const READABILITY_CONFIG = {
  enabled: true,                 // 父开关：false 时三件全部短路，回到 1.0.3 之前的观感
  review:  { enabled: true },    // 第一件：死因复盘（同时控制账目记录，关 = 零状态写入）
  a11y:    { colorblind: false, contrast: 'normal' },  // 第二件：色盲 / 高对比
  layers:  { enabled: true, mode: 'standard' }         // 第三件：战斗信息分层（off 由 enabled=false 表达）
};
```

- `enabled=false` 时：三件的绘制 / 记录 / 结算插入全部跳过，`showResult()` 的 DOM 与现状逐字符一致。
- 每个子开关都能单独关：`review.enabled=false` 时账目对象不分配、不写 `state`；
  `a11y.colorblind=false` 时所有冗余编码分支不进入；`layers.enabled=false` 时 `drawEnemies` 走原路径。
- 所有开关都是「每帧读取」的全局配置，改完下一帧立即生效，**不重开一局、不重建地图**。

### 设置面板（A11Y 区块新增两行）

- `#cbModeToggle`：色盲 / 高对比（switch，默认关，写入永久设置）。
- `#infoLayerModes`：三档按钮 `完整 / 标准 / 极简`（`data-info-mode`，标准为默认）。
- 绑定函数 `flipColorblind()` / `setInfoLayerMode(mode)`，只改配置 + 刷新 `aria-checked`，
  不触碰 `state` 的玩法字段，因此战斗中切换即时生效。

## 2. 第一件：死因复盘（分层结论）

### 2.1 同源账目（唯一数据源）

记录点只有两处，和实战结算共用一个函数体：

| 入口 | 记录内容 | 位置 |
|---|---|---|
| `damagePlayer()` 实际扣血之后 | 承伤：分类、数值、受击次数、来源名 | 扣血与 `lastHit` 同一段 |
| `damageEnemy()` 最终伤害算完之后 | 输出：`abilityId`（卡 / 融合）归类的有效伤害 | 扣血与飘字之间 |

- 承伤 = `damage`（已过减伤 / 契约倍率，和真正扣掉的血同值）。
- 输出 = `护盾吸收 + min(实际扣血, 扣血前 hp)`，避免溢出伤害虚增占比。
- 账目对象 `state.p1Ledger`，`createInitialState` 初始化为空；
  `resetStats` 只清本局，不写存档（结算页只读本局）。
- 没有 `opts.abilityId` 的伤害归入 `system` 桶（反伤 / 地形 / 连锁 / 蓝图），
  有 id 的用 `abilityDisplayName(id)` 取名，`getFusionById(id)` 命中则标记 `fusion:true`。

### 2.2 死因标签判定规则（顺序判定，先命中先得）

分类（承伤 `cause.kind` 映射）：

| 分类 | 包含 kind | 说明 |
|---|---|---|
| 首领 | 任意带 `bossKind` 的伤害 | 首领身份优先于伤害类型 |
| 近身 | `contact`（非首领）、`charge` | 被贴身 / 冲锋撞到 |
| 远程 | `bullet`、`burst` | 弹幕、蓄力爆发 |
| 环境 | `hazard`、`sigil`、`collapse` | 地面危险区 / 符阵 / 塌墙 |
| 自伤 | `barrel` | 玩家自己打爆的桶 |
| 其它 | 未知 kind | 兜底 |

判定（`share = 该分类承伤 / 总承伤`）：

1. `bossShare ≥ 0.40` → **被首领**
2. `selfShare ≥ 0.30` → **自伤类**
3. `envShare ≥ 0.45` → **被环境**
4. `rangedShare ≥ 0.45` → **被远程**
5. `meleeShare ≥ 0.50` 且（近身来源名 ≥ 2 种 或 近身受击 ≥ 5 次）→ **被围**
6. 兜底：占比最大的分类按上表映射；总承伤为 0 → **未知**

每条标签必须带一句可解释的 `rule` 文本，例如：
`「被围」· 近身伤害占 62%（阈值 50%），来源 3 种构装（阈值 2 种）`。
标签不依赖随机、不读 `lastHit` 以外的“感觉”，同一份账目永远得到同一标签。

### 2.3 页面层级（三层，视觉必须可区分）

插入位置：`showResult()` 中 `result-summary` 之后、`buildTowerVoiceHtml` 之前。

1. **结论层** `.p1-verdict`：大号标签 + 一句规则说明 + 一句塔灵口吻的短句（复用 `resolveDeathCause` 的 quote，不新增文案表）。
2. **证据层** `.p1-evidence`：两条 100% 堆叠条
   - 承伤来源（按 2.2 分类，支撑上面的标签）
   - 输出构成（按卡与融合归类，回答“这局你的构筑实际在干什么”）
   每段都带色块 + 名称 + 百分比 + 数值（`x 点 / 100%`），图上与账目同源：百分比由账目现算，不另存一份。
3. **细节层** `.p1-detail`：小字、低对比 —— 总承伤、受击次数、致命一击、输出总量、伤害最高的 3 张卡。

通关页（`showVictory`）只插「输出构成 + 细节」，不插死因标签（没有死因）。

### 2.4 空账目与旧档

- 本局账目为空（例如被脚本直接 `loseGame`）时，标签给「未知」，证据条显示“本局没有记录到伤害”，
  不抛异常、不出现 `NaN%`。
- 账目不写存档，`META_SCHEMA_VERSION` 不变。

## 3. 第二件：色盲 / 高对比（形状 / 纹理 / 边框冗余）

`A11Y_CONFIG.colorblind=true` 时启用，关闭时所有函数走原分支（零像素差异）。

| 对象 | 现有编码 | 新增冗余（仅色盲模式） |
|---|---|---|
| 普通怪血条 | 红色填充 | 实心填充 + 2px 深色外框 + 左端 3px 竖标（`▏`） |
| 精英怪血条 | 同普通 | 5px 高 + 双线外框 + 右端菱形刻度 + 头顶 `◆` 前缀（词缀文字前） |
| 首领血条（HUD） | 红/主题色填充 + 25% 刻度 | 2px 白描边 + 45° 斜纹填充 + 左端 `BOSS` 文字标 + 50% 加粗（已有） |
| 三种元素附着 | 颜色 + 字形 + 外框形状 + 读秒 | 徽记内加纹理（灼烧斜线 / 冰冻点阵 / 感电十字），外框统一加 2px 白描边；字形保留 |
| 处决 / 破防 | 红/金虚线环 + 四箭头 + 文字 | 环改**双线**（实线内环 + 虚线外环）+ 四角方括号 + 文字加白描边 |
| 事件房门徽 | 门牌颜色 + 图标 + 短文本 | 门牌加 2px 高对比外框 + 左上角房型字母（`祭 / 赌 / 诅`）+ 外框形状按房型（圆 / 方 / 菱形） |

- 三种元素（火 / 冰 / 雷）在灰度下必须仍可区分：形状（圆 / 六角 / 三角）已不同，
  色盲模式再叠纹理与白描边，保证“只看亮度”也能读。
- 事件房门徽覆盖 `sacrifice / wager / curse`（无事件房时分支不进入）。
- 所有冗余绘制都在 `if (A11Y_CONFIG.colorblind)` 内，关掉立即回原样。

## 4. 第三件：战斗信息分层

### 4.1 威胁判定（`p1ThreatOf(enemy)`，纯函数、可断言）

| 档 | 条件（或关系） |
|---|---|
| 高 | `isBoss`、`windup>0`、`ai.state==='windup'`、`ai.state==='action'`、`telegraph.t>0`、精英且已受伤 |
| 中 | 非高，且（已受伤 `hp<hpMax`、或距玩家 ≤ 260、或 `elite`） |
| 低 | 其余（满血、未交战、远离） |

### 4.2 档位 → 显示内容

| 信息 | 高 | 中 | 低（standard） | 低（minimal） |
|---|---|---|---|---|
| 敌人本体 | 画 | 画 | 画（轮廓，透明度 0.55） | 画（轮廓，透明度 0.35） |
| 血条 | 完整 + 数值 | 完整 | 淡出（alpha 0.35） | 不画 |
| 附着徽记 | 画 | 画 | 不画 | 不画 |
| 处决 / 破防环 | 画 | 画 | 不画 | 不画 |
| 词缀 / 名字文字 | 画 | 不画 | 不画 | 不画 |
| 连击边缘脉冲 | 画 | 画 | 画 | 不画 |

- `full` 档 = 全部按现状（高/中/低都完整），作为对照。
- `standard` 为默认档：低威胁只淡出血条（题面“只留轮廓或淡出血条”）。
- `minimal` = 极简：低威胁不画任何浮层、连击脉冲关闭；高威胁仍保留全部信息（不牺牲可玩性）。
- `layers.enabled=false` = 现状（低威胁也画血条/徽记/处决/文字，与改前逐帧一致）。

## 5. 断言清单（`tools\arcane_p1.js`）

A. 复盘
1. 账目写入与真实扣血一致：`ledger.incoming.total` == 连续 `damagePlayer` 的 applied 之和。
2. 输出账目与真实伤害一致：`ledger.outgoing.total` == 同一批 `damageEnemy` 的有效伤害之和。
3. 页面占比与账目一致：DOM 里每段百分比 = 账目现算百分比（±1 舍入），且各段和为 100%。
4. 标签规则可解释：构造 4 组账目（首领 60% / 近身 70%+3 名称 / 远程 80% / 自伤 50%）→ 标签分别为
   被首领 / 被围 / 被远程 / 自伤类，且 `rule` 文本含对应百分比与阈值。
5. 空账目：标签「未知」，页面无 `NaN`，不抛异常。
6. 通关页有输出构成、无死因标签。

B. 色盲
7. `setColorblind(true)` 后同一帧：普通/精英/首领血条、元素徽记、处决环、事件门牌的冗余绘制计数各 +1 以上
   （由 `P1_STATS` 计数器提供），且下一帧仍生效（无需重开）。
8. `setColorblind(false)` 后计数器归零，画面绘制路径与原分支一致（回归 render 断言仍 PASS）。
9. 灰度可区分：三种元素徽记的“形状 id + 纹理 id + 字形”三元组两两不同（数据结构断言，不依赖截图肉眼）。

C. 分层
10. 构造 高 / 中 / 低 三种敌人：`p1ThreatOf` 返回值分别正确；绘制统计 `hpBars / badges / execMarks / affixTexts` 数量符合 4.2 表。
11. `mode='minimal'`：低威胁浮层全为 0，高威胁仍 >0；`mode='full'`：三层都完整。
12. `layers.enabled=false`：同一场景的统计与基线（关闭态）逐项相等（零差异）。
13. 开关即时生效：同一局内先 standard 后 minimal，下一帧统计立刻变化，`state.floor` 不变。

D. 通用
14. `READABILITY_CONFIG.enabled=false`：`showResult` 的 `innerHTML` 与关闭前快照逐字符相同；`state.p1Ledger` 不存在或为空。
15. 页面异常 0、语法 PASS、既有 182 条回归全 PASS。

## 6. 关键改动点（精确到函数）

- 文件：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`（单文件）。
- 新增配置：`READABILITY_CONFIG`、`P1_STATS`；新增运行时：
  `p1LedgerReset` / `p1NoteIncoming` / `p1NoteOutgoing` / `p1Shares` / `p1DeathVerdict`
  / `buildReviewHtml` / `buildShareBarHtml` / `p1ThreatOf` / `p1HpBarStyle` / `p1BadgeTexture`
  / `flipColorblind` / `setInfoLayerMode`。
- 改动：`createInitialState`（账目字段）、`damagePlayer` / `damageEnemy`（两行记账）、
  `showResult` / `showVictory`（插块）、`drawEnemies`（威胁分层 + 血条冗余 + 词缀门控）、
  `drawElementStatusIcons`（纹理/白描边）、`drawExecutionMark`（双环 + 括号）、
  `drawBossHud`（描边 + 斜纹）、`drawDoorPlate`（门徽外框 + 字母）、`render` 不变。
- 设置：`bindSettings` 增加两处绑定；`ui` 引用 + 默认值写入永久设置（复用现有设置读写函数）。
- 调试口 `window.__roamDebug.p1`：
  `info` / `reset` / `setEnabled` / `setReview` / `setColorblind` / `setInfoMode`
  / `ledger` / `damagePlayer` / `damageEnemy` / `threatOf` / `renderStats` / `verdict` / `pageHtml`。

## 7. 回归与打包

- 串行跑 `arcane_syntax / render / title / opening / tokens / transition / element / execute / events / p1`。
- 版本 `GAME_CONFIG.version` 按现有规则递增（1.0.2 → 1.0.3），更新说明按本版内容重写。
- `node tools\arcane_package.js` 重新打包；`node tools\arcane_cleanup.js --apply` 清理。
- 每件完成单独汇报；三件全部完成后再打包一次。
