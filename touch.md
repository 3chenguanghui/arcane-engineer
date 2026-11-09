# 《烬》触屏 / 移动端适配说明

主文件 `index_arcane_v2.html` 未做任何修改。触屏能力由独立一层 `touch.js` 在运行时挂载；键帽与教学文案由两个独立补丁 `patch-touch-keycaps.js` / `patch-touch-copy.js` 只改文本（不新增 DOM）。三块脚本都可单独移除，或访问 `?touch=off` 全部关闭。

## 1. 交付物

| 文件 | 作用 |
| --- | --- |
| `touch.js` | 触屏适配层（单文件、零依赖、零外部请求） |
| `patch-touch-keycaps.js` | 键帽与短提示补丁：触屏态把 F/K/Shift/WASD 换成中文动作词（不新增 DOM） |
| `patch-touch-copy.js` | 首局教学与情境提示补丁：把键位句换成人话（不新增 DOM） |
| `touch-demo.html` | 主文件 + 内联三段脚本的演示副本 |
| `tools/_touch_demo_build.js` | 生成演示副本（只读主文件，按固定顺序内联三段脚本） |
| `tools/arcane_touch_v3.js` | 无头 Edge + CDP 触摸验收脚本（40 条） |
| `.screenshots/touch/touch-portrait.png` | 竖屏 390x844 |
| `.screenshots/touch/touch-landscape.png` | 横屏 844x390 |
| `.screenshots/touch/touch-pressed.png` | 摇杆推动 + 普攻/武器同时按下 |
| `.screenshots/touch/touch-copy.png` | 竖屏触屏文案：中文按钮副标题 + 首局教学卡 + 情境提示 |
| `.screenshots/touch/touch-result.json` | 40 条断言结果与实测数据 |

重新生成演示页并验收：

```powershell
node tools/_touch_demo_build.js
node tools/arcane_touch_v3.js
```

## 2. 现状审计：触屏上会坏的交互

审计范围是主文件里的键盘、鼠标、pointer、右键与 `:hover` 用法。结论如下：

| 交互 | 主文件位置 | 触屏上的后果 | 本层替代方案 |
| --- | --- | --- | --- |
| `keydown` 的 J/K/Q/Shift/E/F/Tab/M/T/O/G/R | `handleKeyDown` 约 53006 行 | 没有物理键盘，技能全部不可用 | 屏幕按钮合成 `KeyboardEvent`，复用主文件真实入口（含按住连发、按下/抬起成对） |
| 左键 `castPrimary` / 右键 `castDevice` | `handleCanvasMouseDown` 53278–53288 | 没有右键，也没有跟随光标的世界坐标 | 普攻键合成 J；装置键合成 K；瞄准沿用主文件内置的右半屏点按/拖动逻辑 |
| `mousemove` 更新瞄准与准星 | 53263 附近 | 手指抬起后没有“光标位置”，施法方向会停在旧点 | 主文件已有 `pointerType=touch` 分支（右半屏点按/拖动），本层不重复接管 |
| `contextmenu` 被 `preventDefault` | 53598 | 触屏长按会尝试弹系统菜单/选择文本 | `touch-action:none`、`-webkit-touch-callout:none`、`user-select:none` |
| `.tal-card:hover .tal-tip`（天赋词条） | 4850 附近 | 触屏没有 hover，词条永远看不到；点一下又会误买/误选 | 长按 380ms 显示说明，并吞掉长按后补发的 `click`；点空白立即收起 |
| `#hudFusion i[title]`（融合词条） | 顶部 HUD | 原生 `title` 在触屏上不显示（长按菜单又被禁用） | 长按后由本层绘制浮层，读取 `title` 文本 |
| 地图 `wheel` 缩放 | 53778 | 没有滚轮，地图无法缩放 | 双指捏合翻译成主文件 `WheelEvent`（每格 12%，节流 90ms） |
| `.mini-card:hover`、`.reward-card:hover`、`.btn:hover` | 878 / 2737 / 575 等 | 悬停高亮不会出现 | 只影响视觉、不影响信息；统一用 `:active` 与本层 `.is-pressed` 按下态 |
| 主文件内置左半屏摇杆 / 右半屏施法 | 53290 起 | 与鼠标逻辑并存，但摇杆区没有视觉 | 复用内置 `state.touch.axisX/axisY`，用合成 `PointerEvent` 驱动，保留原死区与曲线 |
| 390px 竖屏顶部 HUD | `.hud-top` | 帮助/技能树按钮右缘超出屏幕，点不到 | 层内压缩 HUD：隐藏副标题、战绩、按钮文字，仅留图标（实测右缘 313/347/381px ≤ 390） |
| 首局键鼠提示（WASD/左键/空格） | `#contextHint[data-key^="u9-"]` | 文案误导，且盖住操作区 | 不再隐藏：由 `patch-touch-copy.js` 改写为「摇杆移动 / 点攻击键施法 / 点闪避键冲刺」，位置继续由 `--tg-lift` 上移 |
| 五层目标卡 | `#onboardHint` | 默认贴在右侧中部，压住技能键 | 窄屏移到左上角，竖屏 `top:168px`、横屏 `top:62px` |
| 地图小地图与码头按钮 | `.minimap-panel`、`#btnMapDock`、`#btnSkillDock` | 窄屏挤占操作区、与虚拟键重叠 | 窄屏隐藏小地图与重复码头按钮，由系统键提供入口 |

## 3. 虚拟摇杆与技能键

### 3.1 布局

- 左下：移动摇杆，底盘吸收指针，旋钮跟手。
- 右下：3 列 2 行动作键。上排 装置/武器/闪避，下排 融合/交互/普攻（主键最大）。
- 动作区上方：系统键 地图/图鉴/设置/重开。
- 所有位置读取底部卡组 `.hud-deck` 的真实矩形，自动避让；横屏 390px 高时把卡组视觉缩到 62%，给操作区让出空间。

### 3.2 实测尺寸（无头 Edge，DPR 1）

| 项目 | 竖屏 390x844 | 横屏 844x390 |
| --- | --- | --- |
| 摇杆底盘 / 旋钮 | 126px / 48px | 132px / 50px |
| 动作键 | 64x64 | 60x60 |
| 主键（普攻） | 88x64 | 84x60 |
| 键间距 | 8px | 8px |
| 系统键 | 42x36 | 44x34 |
| 距屏幕右边 | 12px | 12px |
| 摇杆距左 / 距底 | 14px / 卡组上沿 +8px | 14px / 卡组上沿 +8px |
| 卡组处理 | 原尺寸 | 视觉 `scale(0.62)`，底部对齐 |

实测按钮矩形（竖屏）：地图 192,497；图鉴 240,497；设置 288,497；重开 336,497；装置 146,541；武器 218,541；闪避 290,541（88 宽）；融合 146,613；交互 218,613；普攻 290,613（88 宽）。

建议值：高频动作键不小于 60x60、主键 84 以上、间距 8–12px、距屏幕边缘至少 12px；系统键属于低频操作，可接受 42x36。若后续要做真机手势热区统计，优先加大“闪避”和“普攻”，其余保持不变。

### 3.3 死区与加速曲线

直接沿用主文件手感，避免“双重加速”：

- 死区 `deadZone = 0.08`（有效半径的比例）。
- 满推 `fullPush = 0.86`。
- 曲线 `moveCurve = 1.15`。
- 反解公式：`push = fullPush * strength^(1 / moveCurve)`，即强度 0.558 时回推原始推程 0.558，主文件再正向计算一次，实测 `axisX = 0.558`，误差小于 0.03。
- 死区内强度为 0；满推时强度恰好 1。
- 摇杆热区向底盘外扩 12px（透明），按偏 10px 仍能抓住，实测通过。

## 4. 悬停改点按

| 目标 | 触发 | 行为 |
| --- | --- | --- |
| 天赋卡 `.tal-card` | 按住 380ms | 加 `.tg-tip-on` 显示 `.tal-tip`；期间移动超过 14px 取消 |
| 融合词条 `#hudFusion i[title]` | 按住 380ms | 读取 `title`，在手指上方绘制浮层，自动避开屏幕边缘 |
| 收起 | 点空白 / 1.6s 无操作 / 切换面板 | 立即移除 `.tg-tip-on` 与浮层 |
| 防误选 | 长按成功后 | 捕获阶段吞掉这一次 `click`（`clickSwallowed` 计数），避免“看说明”变成“买卡” |

实测：长按 520ms 显示“奥能上限提升，长战斗更从容。”，`clickSwallowed=1`，天赋页没有被误关；点坐标 `(6,195)` 的空白后说明立即收起。

重开按钮另做防误触：短按不发 R（`restartSkipped`），按住 0.8 秒才真正派发（`restartFired`）。

## 5. 多指、安全与性能

- 多指互不干扰：摇杆只认第一个落下的 `pointerId`；每个按钮独立 `pointerId` 并 `setPointerCapture`，同指不会串键。实测双指（摇杆 + 普攻）：摇杆强度 0.912，J 持续补发，奥能 100 → 97.4；三指（摇杆 + 普攻 + 武器）同时按下，两个按钮都在 `.is-pressed`，摇杆仍为 0.491。
- 全部抬手后摇杆归零、按钮无残留按下态，并补发所有 `keyup`，不会卡键。
- 隐藏操作层（打开面板/切后台/窗口失焦）时调用 `resetInputs`：停掉连发定时器与长按计时，防止后台继续施法。
- 手势：`touch-action:none`（层与 canvas）、`overscroll-behavior:none`、`-webkit-touch-callout:none`、`user-select:none`；输入框除外。
- viewport 由脚本注入（主文件没有 viewport meta 时创建，有时改写）：`width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`。安全区用 `env(safe-area-inset-*)` 兜底；**iOS 真机未验证**（见第 9 节）。
- 性能：摇杆几何在按下时缓存，`pointermove` 不再读 DOM；120 次移动平均 0.036ms。连发 110ms，双指捏合 90ms 节流。所有监听 `passive` 或 `capture`，不阻塞主线程。

## 6. 实测结果

40/40 通过（`pass: 40, total: 40`），全程无 JS 报错，四张截图已落盘。

| 分组 | 断言 | 关键实测 |
| --- | --- | --- |
| T0 | 启动、竖屏尺寸、触摸目标、顶部 HUD、情境提示 | 摇杆 126px；10 个按钮最小边 36px；顶部按钮右缘 313/347/381 ≤ 390；提示底边同时避开操作区与系统键行 |
| T1 | 摇杆按下/死区/半推/满推/真实位移/热区/性能 | 2px 推程不移动；强度 0.558 → axisX 0.558；600ms 位移 379.6px；底盘外 10px 可抓；0.036ms/次 |
| T2 | 双指、三指、普攻入口、抬手、闪避 | 强度 0.912 时 J 仍补发；`castPrimary` 触发 10 次、奥能 100 → 84.5；闪避 `dashCd 0 → 1.80` |
| T3 | 横屏尺寸、系统键避让、卡组避让、旋转重排、长按、吞点击、点空白 | 横屏摇杆 132px、按钮 84x60；操作区底 241 / 卡组顶 249；长按 520ms 出说明 |
| T4 | 手势安全、地图捏合、重开短按/长按 | `touch-action:none`；`pinch=1`；短按 0 次 R，长按 0.95s 触发 1 次 |
| T5 | 全程无报错 + 截图 | 4 张 PNG |
| T6 | `?touch=off` | 整层不启动，无 DOM、无样式、body 不变 |
| T7 | 键帽 / 卡组 / 按钮副标题 / 顶部提示 | 可见 `kbd` 拉丁残留 0；卡组与技能条无键位字母；10 个按钮副标题全中文（含「按住连发」「冲刺」） |
| T8 | 首局教学数据 / 翻译函数 / 教学卡 DOM | 五条 `hint` 字数 9/9/12/8/8 且无键位词；`translate('WASD 移动')='摇杆移动'`；教学卡显示「摇杆移动，点攻击键」 |
| T9 | 键鼠态原文保持 | `?touch=off` 下卡组仍是 J/K/Q/E/F/H 键帽，`ONBOARD_STEPS[0].hint` 仍是「WASD 移动，左键开火」 |

截图：

![竖屏 390x844](./.screenshots/touch/touch-portrait.png)

![横屏 844x390](./.screenshots/touch/touch-landscape.png)

![按下态：摇杆推动 + 普攻/武器同时按下](./.screenshots/touch/touch-pressed.png)

![触屏文案：中文按钮副标题 + 首局教学卡](./.screenshots/touch/touch-copy.png)

### 6.1 触屏文案补丁（两个可单独回退的块）

**判定（两段，全程不读 UA）**

- 第一段·能力：`navigator.maxTouchPoints > 0` 或 `matchMedia('(any-pointer: coarse)')`。不成立 → 两个补丁直接 return，连监听都不挂，桌面鼠标键盘的文本一个字符都不变。
- 第二段·事实：真实 `touchstart` 或 `pointerdown(pointerType === 'touch')` 之后才切换文案。只有能力、没有真实触摸（例如触屏笔记本只用鼠标）时仍是键鼠文案。
- `?touch=off` → 直接 return；`?touch=on` 也不跳过第二段（验收脚本先派发一次无害触摸）。

**补丁一 `patch-touch-keycaps.js`（不新增 DOM，只改文本 + 隐藏装饰键帽）**

| 锚点（标识符 / 选择器） | 改前原文（精确匹配） | 触屏结果 |
| --- | --- | --- |
| `querySelectorAll('kbd')` | `WASD` / `空格 / Shift` / `左键 / J` / `J` / `K` / `Q` / `E` / `F` / `Esc` / `R` … | `摇杆` / `闪避` / `普攻` / `普攻` / `装置` / `武器` / `交互` / `融合` / `关闭` / `重开`（按钮内的装饰键帽直接 `display:none`） |
| `.deck-keys:not(#padLegend)` | `左键 / J 主技能　右键 / K 装置　Q 近战　E 下楼　F 融合　H 暂停` | `摇杆移动　右下：普攻 / 装置 / 闪避 / 融合 / 交互` |
| `#fusionNote` | `集齐魔法与对应科技模块后按 F 融合` | `集齐魔法与对应科技模块后点融合键融合` |
| `#fusionBar span:not(.fb-label)` | `集齐魔法 + 对应科技后按 F 融合` | `集齐魔法 + 对应科技后点融合键融合` |
| `.skill-chip > span` | `主技能 J` / `装置 K` / `武器 Q` | `主技能` / `装置` / `武器` |
| `.deck-title i` | `数字键 1–6 切换` / `点击选中装置 · K 触发` | `点卡组切换` / `点击选中装置 · 点装置键触发` |
| `#introHintText` | `按 M 看全屏地图 · 按 T 看技能树` | `点地图键看全屏地图 · 点技能树键看天赋` |
| `#introHintSub` | `左下「地图」与右侧「技能树」按钮随时可点` | `右下「地图」与「图鉴」按钮随时可点` |
| `.m-key` / `.hud-actions em` | 数字角标 / 单字母角标 | 触屏隐藏（无数字键、字母键后它们只暴露桌面键位） |

回滚：整文件删 `<script src="./patch-touch-keycaps.js"></script>` 一行即可，DOM 里只留下 `data-tg-kbd` 标记属性，无结构残留。块级回退：删 `KB3` 里某一条映射 → 该键帽回到原文；删 `KB4–KB10` 中某个 `applyX()` 及 `applyAll()` 里对应那一行 → 该类元素回到原文，其余不受影响。

**补丁二 `patch-touch-copy.js`（不新增 DOM，只改数据字符串与文本节点）**

| 锚点（标识符 / 选择器） | 改前原文（精确匹配） | 触屏结果 |
| --- | --- | --- |
| `const ONBOARD_STEPS` → `moveAttack.hint` | `WASD 移动，左键开火` | `摇杆移动，点攻击键`（9 字，≤ `hintMaxChars=12`） |
| `ONBOARD_STEPS` → `fusion.hint` | `按 F 融合主技能` | `点融合键合成主技能`（9 字） |
| `ONBOARD_STEPS` → `techDash.hint` | `K 装置，Shift 跑` | `点装置键召唤，闪避键冲刺`（12 字） |
| `function updateContextHints()` | 原函数不动，包装后翻译 `#contextHint` 的 `b` / `span` | `WASD 移动`→`摇杆移动`、`左键 施法`→`点攻击键施法`、`空格 影步`→`点闪避键冲刺` |
| `.help-note` / `.map-tip` / `.result-hint` | 被 `<kbd>` 拆散的说明句 | 整块换成口语（如「双指缩放 · 拖拽平移 · 点地图键关闭」） |
| 全文文本节点 | `按 E ` / `按 F ` / `按 R `… | `点交互键` / `点融合键` / `点重开键`…（跳过 `SCRIPT/STYLE/CODE/TEXTAREA/KBD` 与键帽补丁负责的区域） |

回滚：删除 `<script src="./patch-touch-copy.js"></script>` 一行。补丁内部按 `CP1–CP8` 分块，每块只负责一类文案，删块即局部回退。

两个补丁都只依赖主文件已存在的标识符（`ONBOARD_STEPS`、`updateContextHints`）与精确原文；不写行号。动态 DOM 由 `MutationObserver` + 帧/120ms 去抖兜底，替换幂等。

## 7. 接入示例

```html
<!-- 在 index_arcane_v2.html 的 </body> 之前加这三行；主文件其它代码不用改 -->
<script src="./touch.js"></script>
<script src="./patch-touch-keycaps.js"></script>
<script src="./patch-touch-copy.js"></script>

<script>
  /* 可选：确认触屏层是否生效；访问 ?touch=off 时 enabled 为 false */
  console.log('touch layer:', window.__touchLayer.info());
  console.log('keycaps:', window.__touchKeycaps.active, 'copy:', window.__touchCopy.active);
  /* 可选：部分浏览器旋屏事件早于布局，补一次重排 */
  window.addEventListener('orientationchange', function () {
    setTimeout(function () { window.__touchLayer.refresh(); }, 120);
  });
</script>
```

顺序固定：`touch.js` 先挂触屏层，两个补丁随后只改文本。三行可任意单独删——删键帽补丁只是键帽回退成 F/K/Shift，删文案补丁只是教学卡回退成键鼠原句，都不影响 `touch.js` 的摇杆与按钮。

位置要求在**主文件那个大 `script` 之后**（否则读不到 `kbd`、`ONBOARD_STEPS`、`updateContextHints`）；与 `touch.js` 的先后不影响结果，演示副本固定按上面顺序内联。两个补丁用同一套能力判定自行生效，不依赖 `body.tg-touch`。

如果想保持单文件分发，用 `node tools/_touch_demo_build.js` 生成内联版 `touch-demo.html`，原理是读主文件、在最后一个 `</body>` 前按固定顺序内联三段脚本，再写副本。

## 8. 在手机上打开本地文件

推荐本地 HTTP 服务（最稳，避免 `file://` 限制）：

```powershell
# 在项目目录执行
python -m http.server 8080
# 或：npx serve -l 8080
```

手机与电脑连同一 Wi-Fi，浏览器访问 `http://电脑局域网IP:8080/touch-demo.html`。用 `ipconfig` 查 IPv4 地址；Windows 防火墙需允许该端口。

备选：文件管理器打开。把 `touch-demo.html` 传到手机（数据线、微信文件传输均可），在文件管理器中点开并选择浏览器；iOS 可在“文件”里分享到 Safari。若浏览器只下载不渲染，说明它限制了本地 HTML，请改用上面的 HTTP 服务。

## 9. 已知限制

- **未验证项（不属于“已适配”）**：iOS Safari 的安全区（`safe-area-inset-*`）、`100vh` 与 `zoom` 表现。本层只用 `env()` 与 `viewport-fit=cover` 做了兜底，验收环境是桌面 Edge 的设备仿真 + 合成触摸事件，**没有 iOS 真机数据**。真机复验前不要对外写“已适配”。
- 390px 高的横屏会把底部卡组视觉缩到 62%，卡面文字相应变小；这是为操作区让位的取舍。
- 触屏层复用了主文件内置的右半屏施法，二者不是互斥实现；如果以后主文件重写输入系统，需要同步检查 `sendCanvasPointer` 的坐标与目标元素。
- 两个文案补丁的映射表是按当前主文件文案逐条审计的；主文件若新增键位提示，需要补一条映射（未匹配到原文时会保持原样，不会乱改）。
- 补丁只在“触屏能力 + 真实 touch 事件”之后生效；触屏笔记本若全程只用鼠标，会一直是键鼠文案（这是刻意行为，避免误伤）。
