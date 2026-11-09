# 触屏文案补丁（键帽 + 首局教学）

> 目标：消除触屏上所有 F / K / Shift / WASD / 左键 / 空格 等键位字样。
> 纪律：不改主文件、不新增 DOM、不新增 `<style>` 节点、不用 UA 嗅探；
> 键鼠态 DOM 一个像素都不变；`?touch=off` 时两个补丁完全不生效。

## 1. 背景

31 条触屏断言已全过，但还剩两处"露馅"：

1. 主文件静态键帽与提示文案写着 F / K / Shift / WASD / 左键；
2. 首局教学（`ONBOARD_STEPS` 五层卡 + `#contextHint` 的 u9 三步）写着具体键位。

玩家在手机上看到 "F" / "Shift" 会立刻意识到这是桌面游戏被移植过来。

## 2. 交付文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `patch-touch-keycaps.js` | 可粘贴补丁 | 键帽与短提示改触屏说法（不新增 DOM） |
| `patch-touch-copy.js` | 可粘贴补丁 | 首局教学与情境提示改触屏说法（不新增 DOM） |
| `touch.js` | 既有文件修改 | 按钮副标题改中文短词；移除 u9 提示隐藏规则 |
| `tools/_touch_demo_build.js` | 构建脚本 | 依次内联 touch.js + 两个补丁 |
| `tools/arcane_touch_v3.js` | 验收脚本 | 31 → 40 条断言，新增 `touch-copy.png` |
| `touch.md` | 文档 | 补丁锚点 / 原文 / 回滚；iOS 安全区写"未验证项" |

主文件 `index_arcane_v2.html` **零修改**。

## 3. 触屏判定（两段判断，两个补丁各自独立实现）

```
第一段（能力）：navigator.maxTouchPoints > 0 或 matchMedia('(any-pointer: coarse)')
  · 为 false → 两个补丁完全不挂监听、不扫描 DOM、不改任何文本（桌面永不生效）
  · 为 true  → 允许挂监听，但文案仍保持键鼠版
第二段（事实）：真的收到过 touchstart 或 pointerdown(pointerType==='touch')
  · 收到之前：文案保持键鼠版
  · 收到之后：一次性切成触屏版，并开始监听后续动态 DOM
```

- `?touch=off` → 直接 return，连第二段监听都不注册。
- `?touch=on` **不跳过第二段**：仍以真实触摸事件为切换依据（验收脚本先派发一次无害触摸）。
- **完全不读 `navigator.userAgent` / `platform`**；iPad 报 Mac 也不会误判。
- 桌面鼠标键盘用户：全程静默，DOM 文本一个字符都不变。
- 暴露调试口：`window.__touchKeycaps` / `window.__touchCopy`，含 `capable / sawTouch / active / hits / apply`。

## 4. 补丁一：键帽与短提示（patch-touch-keycaps.js）

### 4.1 `<kbd>` 精确映射

只处理文本能整段命中的 `<kbd>`；替换后去掉药丸外观（内联样式：无边框/无底色/无内边距/继承字体），
避免中文词在窄键帽里溢出。**不新增节点**。

| 改前原文（`kbd.textContent.trim()`） | 触屏显示 |
|---|---|
| `WASD` | `摇杆` |
| `空格 / Shift` | `闪避` |
| `左键 / J` | `普攻` |
| `右键 / K` | `装置` |
| `Shift / 空格` | `闪避` |
| `1–6` / `1-6` | `卡组` |
| `鼠标` | `拖拽` |
| `J` | `普攻` |
| `K` | `装置` |
| `Q` | `武器` |
| `E` | `交互` |
| `F` | `融合` |
| `H` | `帮助` |
| `M` | `地图` |
| `T` | `技能树` |
| `G` | `图鉴` |
| `O` | `设置` |
| `N` | `静音` |
| `V` | `调试` |
| `Tab` | `换相` |
| `Enter` | `确认` |

### 4.2 元素级精确替换

| 选择器 | 改前原文 | 触屏文案 |
|---|---|---|
| `.deck-keys`（排除 `#padLegend`） | `左键 / <kbd>J</kbd> 主技能　右键 / <kbd>K</kbd> 装置　<kbd>Q</kbd> 近战　<kbd>E</kbd> 下楼　<kbd>F</kbd> 融合　<kbd>H</kbd> 暂停` | `摇杆移动　右下：普攻 / 装置 / 闪避 / 融合 / 交互` |
| `#fusionNote` | `集齐魔法与对应科技模块后按 <kbd>F</kbd> 融合` | `集齐魔法与对应科技模块后点融合键融合` |
| `#fusionBar` 第二格文本 | `集齐魔法 + 对应科技后按 F 融合` | `集齐魔法 + 对应科技后点融合键融合` |
| `.skill-chip > span` | `主技能 J` / `装置 K` / `武器 Q` | `主技能` / `装置` / `武器` |
| `.deck-title i` | `数字键 1–6 切换` | `点卡组切换` |
| `.deck-title i` | `点击选中装置 · K 触发` | `点击选中装置 · 点装置键触发` |
| `#introHintText` | `按 M 看全屏地图 · 按 T 看技能树` | `点地图键看全屏地图 · 点技能树键看天赋` |
| `#introHintSub` | `左下「地图」与右侧「技能树」按钮随时可点` | `右下「地图」与「图鉴」按钮随时可点` |
| `#magicRow .m-key` | 数字 1–6 角标 | 触屏隐藏（`display:none`，无数字键即无意义） |
| `#hudTop em` / `.dock-btn em`（单字母） | `M` `T` 等 | 触屏隐藏 |

### 4.3 动态 DOM

`MutationObserver`（`childList` + `characterData`，`requestAnimationFrame` 去抖）重新扫描；
跳过 `SCRIPT / STYLE / CODE / TEXTAREA / [contenteditable]`。
所有替换按"整段精确匹配"执行，天然幂等；本轮只改文本，不改结构。

## 5. 补丁二：首局教学（patch-touch-copy.js）

### 5.1 `ONBOARD_STEPS` 数据改写（锚点：`const ONBOARD_STEPS`）

主文件 `ONBOARD_CONFIG.hintMaxChars = 12`，每条 `Array.from(hint).length` 必须 ≤ 12：

| key | 改前 `hint` | 触屏 `hint` | 字数 |
|---|---|---|---|
| `moveAttack` | `WASD 移动，左键开火` | `摇杆移动，点攻击键` | 9 |
| `fusion` | `按 F 融合主技能` | `点融合键合成主技能` | 9 |
| `techDash` | `K 装置，Shift 跑` | `点装置键召唤，闪避键冲刺` | 12 |
| `route` | `选门：打怪或绕路` | 不变 | 8 |
| `meta` | `死亡后结晶升天赋` | 不变 | 8 |

改写方式：`ONBOARD_STEPS[i].hint = ...`（顶层 `const` 数组，元素可变；不替换数组本身）。

### 5.2 `updateContextHints` 包装（锚点：`function updateContextHints()`）

调用原函数后，对 `#contextHint > b` 与 `#contextHint > span` 做翻译（每帧幂等）：

| 改前原文 | 触屏文案 |
|---|---|
| `WASD 移动` | `摇杆移动` |
| `方向键同样可用；撞墙会贴着滑行。` | `摇杆推到底，撞墙会贴着滑行。` |
| `左键 施法` | `点攻击键施法` |
| `朝鼠标方向释放主技能，消耗奥能。` | `朝准星方向释放主技能，消耗奥能。` |
| `空格 影步` | `点闪避键冲刺` |

通用键位短语（正则，仅作用于 `#contextHint` 与静态文本节点）：

```
/按 E /g → 点交互键
/按 F /g → 点融合键
/按 M /g → 点地图键
/按 T /g → 点技能树键
/按 H /g → 点帮助键
/按 J /g → 点攻击键
/按 K /g → 点装置键
/按 Shift /g → 点闪避键
/左键 \/ J/g → 攻击键
/WASD/g → 摇杆
```

### 5.3 静态文案精确替换（文本节点，跳过 SCRIPT/STYLE/CODE）

| 改前原文 | 触屏文案 |
|---|---|
| `第 1 层：WASD 移动 · 左键 / J 施法 · 清场后按 E 下楼` | `第 1 层：摇杆移动 · 点攻击键施法 · 清场后点交互键下楼` |
| `集齐魔法 + 对应科技后按 F 融合` | `集齐魔法 + 对应科技后点融合键融合`（与补丁一互补，幂等） |
| `再按 F 过载` | `再点融合键过载` |
| `可按 F 融合` | `可点融合键合成` |
| `按 F 使用` | `点融合键使用` |
| `两个模块齐备，按 F 立即融合` | `两个模块齐备，点融合键立即合成` |
| `按 F 装配` | `点融合键装配` |
| `获得后按 F 融合激活` | `点融合键激活` |
| `按 J / 左键释放` | `点攻击键释放` |

其余同类文案由 5.2 的正则兜底。

## 6. 修改 `touch.js`（只动文案，不动尺寸 / 按键行为 / 已验收断言）

1. `injectStyles()` 中删除这一行（锚点：字符串 `body.tg-touch #contextHint[data-key^="u9-"]`）：
   `body.tg-touch #contextHint[data-key^="u9-"] { display: none !important; }`
   → u9 提示恢复显示，由补丁二改写为触屏说法，位置继续由 `layout()` 的 `--tg-lift` 上移。
   该行只影响触屏态可见性，不改变任何按钮尺寸、间距或手势逻辑。
2. `buildDom()` 的按钮副标题改中文（只影响触屏层，键鼠态不可见；`label`、`spec`、绑定方式均不变）：

| 按钮 | 改前 `hint` | 改后 |
|---|---|---|
| 地图 | `M` | `全屏` |
| 图鉴 | `G` | `查看` |
| 设置 | `O` | `调整` |
| 重开 | `长按` | `长按`（不变） |
| 装置 | `K` | `召唤` |
| 武器 | `Q` | `长按` |
| 闪避 | `Shift` | `冲刺` |
| 融合 | `F` | `合成` |
| 交互 | `E` | `拾取` |
| 普攻 | `J` | `按住连发` |

`makeButton` 的 `aria-label` 同步为 `label（短词）`，无拉丁字母。

## 7. 构建与验收

1. `node tools/_touch_demo_build.js`
   - 依次内联：`touch.js` → `patch-touch-keycaps.js` → `patch-touch-copy.js`；
   - 三个 `<script>` 的 id 分别为 `tg-touch-inline` / `tg-keycaps-inline` / `tg-copy-inline`。
2. `node tools/arcane_touch_v3.js`（Edge headless，端口 9531）
   - 进入 playing 后先派发一次无害触摸（左上角 5,5 的 touchStart/touchEnd），让两段判断进入第二段；
   - 原 31 条保持通过；
   - 新增 9 条，总计 **40 条**：
     - T7a 全页 `<kbd>` 无拉丁键名（允许中文集合外零命中）
     - T7b `.deck-keys` / `.skill-chip` 无 `J/F/K/Q/Shift/WASD`
     - T7c `.tg-btn > i` 全中文（含 `按住连发`、`冲刺`）
     - T7d `#introHintText` 无 `按 M` / `按 T`
     - T8a `ONBOARD_STEPS` 五条 `chars ≤ 12` 且无键位词
     - T8b `window.__touchCopy.translate('WASD 移动') === '摇杆移动'`、`translate('按 E 下楼') === '点交互键下楼'`
     - T8c 重置已读后 `onboardShowHint('moveAttack')`，`#onboardHint` 文本含 `摇杆` / `攻击键` 且无 `WASD`
     - T9a `?touch=off` 下 `.deck-keys` 仍含 `<kbd>J</kbd>` 等拉丁键帽
     - T9b `?touch=off` 下 `ONBOARD_STEPS[0].hint === 'WASD 移动，左键开火'`
   - 截图：`touch-portrait.png` / `touch-landscape.png` / `touch-pressed.png` / **`touch-copy.png`**
     - `touch-copy.png` 构图：390×844 竖屏、playing 态、首局教学卡（`#onboardHint`）处于显示状态、
       `#contextHint` 显示触屏文案、右下按钮副标题为中文短词。
   - T5 断言改为核对 4 张截图均 > 100KB。
3. 文档 `touch.md`：
   - 新增「补丁」章节：文件、锚点（函数名/标识符，不写行号）、改前原文、回滚一句话；
   - 更新断言数（40）与截图列表；
   - iOS Safari 安全区条目改写为 **未验证项**：写明"依赖真机 `env(safe-area-inset-*)`，本轮仅有桌面无头浏览器证据，未在 iPhone 实机验证"。

## 8. 回滚

- 单个补丁：删除对应 `<script src="patch-touch-*.js">` 行（或内联块）即可，主文件与 DOM 结构零残留。
- 全部关闭：URL 加 `?touch=off`（`touch.js` 与两个补丁都短路）。
- `touch.js` 自身回滚：恢复 10 个按钮 `hint` 原值 + 恢复 u9 隐藏 CSS 一行。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 文本替换误伤同名文案 | 只做整段精确匹配；正则只作用于 `#contextHint` 和明确的键位短语 |
| MutationObserver 自触发死循环 | 替换幂等 + rAF 去抖 + 跳过脚本样式节点 |
| 中文副标题偏长挤压按钮 | 全部 ≤ 4 字（`按住连发`），字号 9px；布局 `refresh` 后截图复核 |
| 混合设备误判 | 桌面永不激活；混合设备等真实触摸；`?touch=off` 兜底 |
| 教学文案超 `hintMaxChars` | 新文案 9 / 9 / 12 / 8 / 8，逐条断言 |
| iOS 安全区未真机验证 | 文档标为未验证项，不写"已适配" |

## 10. 待确认（默认值已选定）

- 按钮副标题：`召唤 / 长按 / 冲刺 / 合成 / 拾取 / 按住连发`（如需换词只改 `actDefs`）。
- `.m-key` 数字角标：触屏隐藏（无数字键，保留只会继续暴露桌面键位）。
