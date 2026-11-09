# 《烬》无障碍补丁 v1（锚点式，逐段可回滚）

```
TARGET_MD5 = BA68478FE49A6DFA25C8B3F4CD368FAC
TARGET_BYTES = 2,740,252 / 字符 2,290,127 / 行 63,930
被测：D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html
```

**落盘纪律**：主文件当前被外部进程写过一次（21:43:30）。粘贴前先复算 MD5；不等于 `BA68478F…` 就停下，不要套用本补丁的行号。

每一段独立：语法检查 → 页面加载自检 → 记录 MD5。任一段失败只回滚该段。

---

## 段 1｜光敏感：闪烁合流（P0）

**锚点**：`function flashScreen(color, msOverride) {`
**插入位置**：函数第一行（`if (state && state.meta ...reduceFlash)` 之前）

```js
  /* A11Y-P1：闪烁合流。WCAG 2.3.1 要求任意 1 秒内 ≤3 次，这里用 340ms 最小间隔封顶 2.94 次/秒。
     被合流的闪白只记账、不播放，不影响伤害判定与其它反馈。 */
  state.feel = state.feel || {};
  const __nowMs = performance.now();
  if (__nowMs - (state.feel.lastFlashAt || -1e9) < 340) {
    state.feel.flashCoalesced = (state.feel.flashCoalesced || 0) + 1;
    return;
  }
  state.feel.lastFlashAt = __nowMs;
```

**验收**：连续受击 20 秒，读 `state.feel.lastFlashMs` 序列，任意 1 秒窗口内 `is-on` 次数 ≤3；`flashCoalesced` 有值即证明生效（不能是 0，否则说明没合流过任何一次）。
**回滚**：删掉这段即可，无副作用。

---

## 段 2｜光敏感：自爆环降频（P0）

**锚点**：`if (ai.action === 'selfdestruct') {`
**改前**：`const blink = 0.5 + 0.5 * Math.sin(t * 26);`
**改后**：

```js
      const blink = 0.5 + 0.5 * Math.sin(t * 12);   // A11Y-P1：4.14Hz → 1.91Hz（≤3 次/秒）
```

**验收**：自爆怪在场时取样 5 秒，`blink` 完整周期数 ≈ 9.5（改前 ≈20.7），即 `sin(t*12)` 的周期 0.524s、`sin(t*26)` 的周期 0.242s。
**回滚**：把 `12` 改回 `26`。

---

## 段 3｜光敏感：濒死抖动降频（P0）

**锚点**：`dx += Math.sin(t * 19) * amp;`
**改前**：

```js
    dx += Math.sin(t * 19) * amp;
    dy += Math.cos(t * 23) * amp * 0.7;
```

**改后**：

```js
    dx += Math.sin(t * 9) * amp;    // A11Y-P1：3.02Hz → 1.43Hz
    dy += Math.cos(t * 11) * amp * 0.7;   // A11Y-P1：3.66Hz → 1.75Hz
```

**验收**：血量 <30% 时，装置位移峰峰值不变（≤1.8px），但过零频率降到一半以下。
**回滚**：改回 `19 / 23`。

---

## 段 4｜对比度：14 条 CSS（P1，只动色层，不动字号）

**插入位置**：`</body>` 之前，作为最后一个样式表（同选择器后写者胜）。

```html
<!-- A11Y-P1：对比度补丁。仅改字色/不透明度/底色，不改任何 font-size -->
<style id="a11y-contrast-patch">
  /* 1) 版本角标 2.15 → 6.55 */
  #titleLayer .title-corner { color: #9db0c4; opacity: 1; }

  /* 2) 锁定卡的卡名 3.10 → 5.43 */
  .mini-card.is-locked .m-name { color: rgba(150, 180, 214, 0.86); }

  /* 3) 迷你卡楼层行 3.40 → 5.71 */
  .mini-card .m-floor { color: rgba(168, 191, 220, 0.82); }

  /* 4) 标题页工具按钮（未按下）3.47 → 6.20 */
  #titleLayer .title-tool[aria-pressed="false"] { color: #9aabbe; }

  /* 5) 精灵提示条 3.70 → 7.36 */
  .spirit-line .spirit-tag { color: rgba(143, 228, 255, 0.82); }

  /* 6) 卡牌提示脚注 3.92 → 5.91 */
  .card-tip .ct-foot { color: rgba(168, 191, 220, 0.84); }

  /* 7) 融合条空槽 3.92 → 5.91 */
  .fusion-bar.is-empty { color: rgba(168, 191, 220, 0.84); }

  /* 8) 铭刻空位 3.98 → 5.70 */
  .engrave-empty { color: #97a3b5; }

  /* 9) 未解锁天赋 4.13 → 7.41 */
  .tal-locked { color: rgba(255, 231, 184, 0.75); }

  /* 10) 楼层词缀"规避"红 4.26 → 5.87 */
  .floor-mod-row b.mod-avoid { color: #ff7a95; }
  .map-bar .map-mod.mod-avoid { color: #ff7a95; }

  /* 12–14) 标题页三个同色小标题 4.48 → 6.20 */
  #titleLayer .title-stat span,
  #titleLayer .title-difficulty-head,
  #titleLayer .title-talents .talent-head h3 { color: #9aabbe; }
</style>
```

**验收**：重跑 `tools/a11y_measure.mjs`，A 表应为 0 条 CSS 不达标；再人工看标题页/卡牌弹窗/天赋页，确认没有"发白刺眼"。
**回滚**：删除整个 `<style id="a11y-contrast-patch">` 块。

---

## 段 5｜对比度：小地图未探索房名（P1，Canvas）

**锚点**：`ctx.fillStyle = \`rgba(150, 176, 214, ${UNEXPLORED_HINT_CONFIG.textAlpha})\`;`
**改法（二选一，推荐 A）**

A. 只改配置值（最小改动，改后 ≈4.6:1）：

```js
// UNEXPLORED_HINT_CONFIG 里
textAlpha: 0.80,   // A11Y-P1：0.34 → 0.80（2.02:1 → ≈4.6:1）
```

B. 若不想让未探索房名太抢眼，保留 0.34 但给文字加 1px 深色描边（仍算图形层）：

```js
      ctx.strokeStyle = 'rgba(6, 12, 22, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.strokeText(/* 同 fillText 的文本与坐标 */);
```

**验收**：小地图截图取样，未探索房名与底色的对比 ≥4.5:1。
**回滚**：`textAlpha` 改回 `0.34`。

---

## 段 6｜字号：设计令牌（P2，需版面回归后再落）

**改前**：`--fs-xs: 11px;`
**改后**：

```css
    --fs-xs: 12px;   /* A11Y-P2：中文正文线 12px；影响 88 条声明 */
```

> 这一步会让 HUD/卡牌/提示条整体变宽约 9%，**必须先做三处版面回归**：①战斗 HUD 四角；②卡牌三选一；③天赋页与熔铸表。若溢出，改用段 7 的逐条替换，不动令牌。

---

## 段 7｜字号：硬编码 8.5–11.5px（P2，可选逐条）

```html
<style id="a11y-font-patch">
  /* 8.5px 字面：升到数字线 11px（含紧凑 HUD 的高特异性变体） */
  .card-row.is-dense .m-key,
  body.hud-compact .card-row.is-dense .m-key { font-size: 11px; }
  .mini-card .m-meta { font-size: 11px; }
  /* 9px → 中文 12 / 英文 11 */
  .mini-card .m-fuse-badge { font-size: 11px; }
  #titleLayer .title-kicker { font-size: 11px; }      /* BOSS ENCOUNTER：英文 */
  #titleLayer .title-corner { font-size: 11px; }
  #titleLayer .title-stat span,
  #titleLayer .difficulty-mode span,
  #titleLayer .title-talents .t-info span,
  .talent-page-head h2 em,
  .tal-cat, .tal-state, .tal-group-tag, .t-cat { font-size: 12px; }
  /* 9.5px */
  body.hud-compact .card-row.is-dense .m-name { font-size: 12px; }
  .dock-btn em,
  body.hud-compact .dock-btn em { font-size: 12px; }
</style>
```

> 剩下 10/10.5/11/11.5px 共 172 条，多数由 `--fs-xs` 覆盖；不随令牌改的硬编码逐条清单见 `tools/a11y_tables.md` §B，按同格式追加即可。

---

## 段 8｜字号：Canvas 最小字号（P2）

**锚点 1**：`minimapCtx.font = 'bold 8px "Microsoft YaHei UI", sans-serif';` → 改 `bold 12px`
**锚点 2**：`minimapCtx.font = '6px "Microsoft YaHei UI", sans-serif';` → 改 `11px`，并把下一行 `cy + 8` 改为 `cy + 10`（避免与图标重叠）

```js
  minimapCtx.font = 'bold 12px "Microsoft YaHei UI", sans-serif';  // A11Y-P2：8 → 12
  ...
  minimapCtx.font = '11px "Microsoft YaHei UI", sans-serif';        // A11Y-P2：6 → 11
  minimapCtx.fillStyle = hexToRgba(type.color, 0.9);
  minimapCtx.fillText(sub, cx, cy + 10);
```

**验收**：小地图事件房图标与 `−X/层` 不再重叠、可读。
**回滚**：改回 8px / 6px / `cy + 8`。

---

## 段 9｜色盲：仅一处建议（P3，可不落）

稀有蓝 vs 史诗紫在绿色盲下 ΔE00 = **0.1**（完全同色）。当前靠 `.r-rarity` 文字（"稀有/史诗"）与迷你卡 `Ⅱ/Ⅲ` 序号兜住，**三个问题仍答得出**，因此不列为必改。

若要再加一层形状冗余（不是颜色）：

```css
  .reward-card.rarity-rare { border-style: solid; }
  .reward-card.rarity-epic { border-style: double; border-width: 3px; }
```

---

## 落地顺序

1. 段 1 → 2 → 3（P0，3 处，逐段落盘并跑加载自检）
2. 段 4 → 5（P1，纯色层，零布局风险）
3. 段 6 或 7 → 8（P2，先令牌后硬编码，必须做版面回归）
4. 段 9 可选
