# M1-4 规格：技能卡面 UI（含跳过被动）

> 状态：进行中（2026-11-03）
> 目标文件：`index_arcane_v2.html`（单文件、零依赖）
> 备份：`index_arcane_v2.bak_20261103_m14.html`（618,498 字节）

## 1. 目标

把底部技能卡从"能点的方块"升级成"信息完整的卡面"，并补一个缓解节奏的入口：

1. **图标**：沿用现有几何 glyph（不换美术，M3 再统一素材化）。
2. **稀有度边框（三档可辨）**：普通冷灰 / 稀有科技青 / 史诗强调金，卡面左上角补 Ⅰ/Ⅱ/Ⅲ 角标。
3. **冷却环**：沿用现有 conic-gradient 环，只保证 6 列紧凑卡下仍可见、不压住名称。
4. **层数角标**：显示该卡在本局**获得的楼层**（`F3`），本层刚获得的标金色。
5. **悬停 / 长按详情**：卡上方浮层显示名称、稀有度、消耗 / 冷却 / 伤害 / 被动、获得楼层、以及它与哪些科技/魔法能凑成融合、当前状态（已激活 / 可融合 / 还缺谁）。
   **可融合对象高亮**：悬停某张卡时，把配方里的另一半卡点亮（金色呼吸边）。
6. **底部「已激活融合」条**：HUD 底部整行列出本局已激活的融合（专属色点 + 名称），空态给一句提示。
7. **跳过被动**：被动段弹窗新增次级按钮，跳过后照常结算 `fusionPity`（与选完等价）。

## 2. 非目标（明确不做）

- 不重画卡牌美术、不改 glyph 字形（M3 素材化统一做）。
- 不做卡牌拖拽排序、不做自定义快捷键。
- 不改奖励池 / 稀有度权重 / 保底逻辑（M1-3 已定）。
- 不做"奖励卡前后数值对比"（M3 的事项，见 108 清单 L104）。

## 3. 精确改动清单

### 3.1 CSS（样式区）

1. `.mini-card` 之后、`.mini-card.is-active` **之前**插入稀有度边框三档（保证选中态仍然覆盖稀有度色）：
   - `.r-common` 冷灰；`.r-rare` 科技青 + 内描边；`.r-epic` 强调金 + 内辉光。
2. `.m-meta`（左上角元信息行，绝对定位）、`.m-rarity`（Ⅰ/Ⅱ/Ⅲ，颜色由 `--rc` 注入）、`.m-floor`（`F3`，本层新得 `is-new` 金色）。
3. `.is-partner`（可融合对象高亮，金色呼吸动画 `partnerPulse`）。
4. `#cardTip`（卡面浮层，`position:absolute; bottom:calc(100% + 8px)`，宽 252px，`pointer-events:none`，默认 `opacity:0/visibility:hidden`，`.is-on` 显示）。
5. `.fusion-bar`（横跨 HUD 卡组整行，`grid-column: 1 / -1`，顶部细分割线）+ `.fb-chip`（专属色点 + 名称）。
6. `.card-row.is-dense .mini-card` 顶部内边距加到 13px，给 `.m-meta` 让位；glyph 保持居中。

### 3.2 HTML

7. `footer.hud-deck` 内新增：
   - `<div id="fusionBar" class="fusion-bar">…</div>`（整行）
   - `<div id="cardTip" class="card-tip" role="tooltip" aria-hidden="true"></div>`（浮层，不参与布局）

### 3.3 JS：数据

8. `createInitialState()` 新增 `cardFloor: { 'magic:fireball': 1 }`（记录获得楼层）。
9. 新增 `stampCardFloor(kind, id)`：首次获得时写入 `state.floor`，已有则不动。
10. 调用点：`applyReward` 的 magic / tech 分支、`__roamDebug.grantMagic / grantTech`。

### 3.4 JS：卡面渲染

11. `renderDeck()`：
    - 每张卡追加 `r-<rarity>` 类（魔法用 `magic.rarity`，科技用 `tech.rarity`，缺省 common）；
    - 新增 `.m-meta`（稀有度罗马数字 + `F{获得楼层}`，本层新得加 `is-new`）；
    - 渲染前先 `hideCardTip()`，避免重建 DOM 后浮层残留。
12. 新增 `renderFusionBar()`：
    - `sig = state.fusions.join(',')` 做脏检查；
    - 空态："尚无融合 · 集齐魔法 + 对应科技后按 F"；
    - 有融合：`已激活 N / 10` + 每条一个 `.fb-chip`（`--fc` 注入专属色）；
    - 在 `updateHUD()` 里 `renderFusionPips()` 之后调用。
13. 新增 `describeCard(kind, id)`：返回浮层 HTML（名称 / 稀有度 / 类型 / 消耗 / 冷却 / 伤害或被动 / 获得楼层 / 相关融合列表及状态）。

### 3.5 JS：浮层与高亮

14. 新增 `showCardTip(kind, id, anchor)` / `hideCardTip()`：
    - 以 `#cardTip.offsetParent`（`.hud-deck`）为参照计算 `left`，钳制在 8px 边距内；
    - 同时调用 `highlightPartners(kind, id)`。
15. 新增 `highlightPartners(kind, id)` / `clearPartnerHighlight()`：
    - 从 `FUSION_CONFIG` 找该卡的配方，把**未激活**配方的另一半卡加 `.is-partner`；
    - 已激活的融合不再高亮（已经生效，提示无意义）。
16. 事件（`bindUIEvents()` 内）：
    - `mouseover` 行委托 → 显示浮层；
    - `mouseout`（离开行）→ 隐藏；
    - `pointerdown` 且 `pointerType === 'touch'` → 420ms 长按显示；`pointerup/pointercancel/pointerleave` 清除；
    - 点击卡片（选中技能）→ 隐藏浮层。

### 3.6 JS：跳过被动

17. 抽出 `closeRewardFlow()`（原 `chooseReward` 尾段）：清空选项、关闭弹窗、结算 `fusionPity`、回到 playing、刷新 HUD / 卡组 / 融合条 / 小地图。
18. 新增 `skipPassiveStage()`：仅在 `mode === 'reward' && rewardStage === 'passive'` 时生效，调用 `closeRewardFlow()`，提示"已跳过被动"。
19. `buildRewardModalHtml()` 被动段在 `.modal-secondary` 增加：
    `<button type="button" class="btn btn-skip" data-action="skipPassive">跳过被动，直接继续</button>`
    并在 `modal-note` 补一句"跳过不会丢失保底进度"。
20. 弹窗事件委托新增 `data-action="skipPassive"` 分支。

### 3.7 JS：调试接口

21. `window.__roamDebug` 新增：
    - `cardFloors()` → `{magic:{id:floor}, tech:{...}}`；
    - `hoverCard(kind, id)` → `{ tipOn, tipText, partners }`（内部调用 showCardTip，供无头浏览器断言）；
    - `fusionBar()` → `{ text, chips }`；
    - `skipPassive()` → 布尔。

## 4. 验证计划（`%TEMP%\arcane_m14.js`）

| # | 断言 | 通过标准 |
|---|---|---|
| 1 | 稀有度类 | 12 张卡 DOM 上的 `r-<rarity>` 与配置一致；三档各至少 1 张 |
| 2 | 三档边框可辨 | 读取三档卡的 `borderTopColor` + `boxShadow`，三者互不相同 |
| 3 | 层数角标 | 初始火球显示 `F1`；`grantMagic('blade')` 后该卡显示当前楼层，且 `cardFloors()` 有记录 |
| 4 | 悬停详情 | `hoverCard('magic','fireball')` → `tipOn=true`，文本含名称 / 稀有度 / 消耗 / 冷却 / 相关融合名 |
| 5 | 可融合对象高亮 | 悬停 `fireball` 时 `concentrator` 卡带 `is-partner`；`grantFusion('homingFireball')` 后不再高亮 |
| 6 | 长按详情（触摸） | 派发 `pointerdown`(pointerType=touch) 等 480ms → `tipOn=true`；`pointerup` 后隐藏 |
| 7 | 已激活融合条 | 空态文案正确；`grantFusion` 两条后 chips = 2 且颜色取自 `FUSION_CONFIG.color` |
| 8 | 跳过被动 | 技能段选完进被动段 → `skipPassive()` 关闭弹窗、`mode=playing`、`fusionPity` 按规则 +1 |
| 9 | 跳过不丢保底 | 本层拿过融合再跳过 → `fusionPity` 归零 |
| 10 | HUD 布局 | 1280×720 / 1600×900 / 1920×1080 × 100%/125%：卡 6 列同 top、无横向溢出、融合条在视口内、浮层未越界 |
| 11 | 帧率 / 报错 | 战斗中 10s `fps >= 60`，`__errors` 为空 |

## 5. 回归（每项完成即跑）

`arcane_verify` 34 / `arcane_flow3` 38 / `arcane_p1a_ui` 39 / `arcane_facing` 23 / `arcane_fusion` 78 / `arcane_m12` 27 / `arcane_m13` 26。

## 6. 边界情况

| 边界 | 行为 |
|---|---|
| 未解锁卡 | 不显示稀有度/楼层角标，悬停显示"未解锁 · 通关奖励可获得" |
| 满栏 6/6 | 卡面仍 6 列，浮层不被裁切 |
| 浮层靠近左右边缘 | `left` 钳制在 8px 内，不出 HUD 容器 |
| 暂停 / 奖励弹窗中 | 浮层随卡组隐藏（`renderDeck` 前先 `hideCardTip`），不叠在弹窗上 |
| 触摸长按 | 420ms 触发；滑动或抬起即取消 |
| 切后台 / 缩放 | 浮层定位用 `offsetParent` 实时 rect，缩放后重新悬停即正确 |

## 7. 风险与回滚

| 风险 | 处理 |
|---|---|
| 6 列卡加角标后挤压名称 | dense 顶部内边距 13px + 名称单行省略；断言 10 覆盖 |
| 浮层遮挡 HUD | 浮层向上弹（`bottom:100%`），`pointer-events:none` |
| 鼠标移入卡片触发 renderDeck 重建导致浮层闪烁 | 只在选中技能时重建；悬停不重建 |
| 跳过被动破坏融合保底 | 复用 `closeRewardFlow()` 同一结算路径，断言 8/9 覆盖 |
