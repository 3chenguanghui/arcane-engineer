# 补丁 v1.7.1 · 首屏与内存优化（只交补丁文档，不改主文件）

> 落地对象：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`
> 本文所有锚点均为**文本锚点**（不含行号），每条锚点的命中次数已在交付前于现场文件逐条复核 = **1**（共 53 条，明细见 §7）。

---

## 0. 指纹冲突（必须先看）

| 时刻 | 字节 | MD5 |
|---|---|---|
| 任务书给定 | 2,716,347 | `539781FE7CA8A9BE4278C61F96D4E8A7` |
| 本次开工首次读数 | 2,730,626 | `718881AFD8C42C8FA2BEB10918BCB8DC` |
| 分析用只读快照（**本文基准版本**） | 2,740,252 | `97D32203DFA64A669A96DC0509EA300E` |
| 锚点核对时的现场读数 | 2,760,702 | 53/53 命中 = 1 |
| 交付前最后一次读数 | 2,773,330 | `E38D347F99722C283223A2AEB4E74A01`（52/53 命中 = 1） |

任务书给的 MD5 在本机**已不存在**：主文件正在被其它并行会话持续写入（5 次读数累计 +56,983 B）。本补丁不写主文件，仅以文本锚点交付；全部锚点已在 2,760,702 B 版本逐条复核 = **1**（§7）。

**本次交付期间已出现一次锚点失效**：在 2,773,330 B 版本里，附录 A 的 `.readout-floor > b { font-size: var(--fs-xl); … }` 已被另一会话删除（该规则在基准快照 97D32203 里存在）→ 说明并行的 UI 会话正在改这套标题样式。落地前请先跑一次 `.optim/final_check.mjs`：

- **命中 = 1** → 直接落；
- **命中 = 0** → 说明该项已被他人处理，跳过该条即可（不要报错停下）；
- **命中 > 1** → 停手，说明该段被复制过，需人工确认后再落。

---

## 1. 结论摘要（先给判据）

| # | 项 | 机制 | 实测收益 | 判定 |
|---|---|---|---|---|
| 1 | `titleBg` 释放 | 进游戏后把 1570×805 画布后备区归零，回标题页重建 | 画布合计 **13.20 MB → 8.37 MB（−4.83 MB）** | ✅ 达标，唯一 MB 级收益 |
| 2 | `installDebugApi` 按需安装 | 355,546 B 源码移出 `<script>`，改为惰性源 + eval 装载 | 预解析 **−0.5 ms**（低于 2.2 ms 分辨力） | ⚠️ **收益 ≈ 0（−0.5 ms，低于 2.2 ms 分辨力）**；**这项不产生可测收益，落地理由是代码卫生**（见 §3） |
| 3 | 死代码清理 | **12 个**零引用 JS 项（另有 4 项按决定保留）+ 15 个无引用 CSS 类 | 文件 **−7,889 B（0.29%）**；7 个 CSS 类不可删（见 §4） | ✅ 达标，收益微小 |

**首屏判据（改前 / 改后各 9 轮，交错 A/B，每轮全新 Edge 进程）**

| 指标（`performance.now()`，页内自测） | 改前 9 轮中位 | 改后 9 轮中位 | Δ |
|---|---|---|---|
| 标题背景首帧完成（本文主口径） | **1,449.0 ms** | **1,627.1 ms** | +178.1 ms |
| 脚本总时长 `m2-m0`（含 init 执行） | 552.0 ms | 534.8 ms | −17.2 ms |
| DOMContentLoaded | 741.8 ms | 727.5 ms | −14.3 ms |
| 纯解析执行 `m1-m0`（整个 2.06 MB 脚本） | 3.5 ms | 3.4 ms | −0.1 ms |

改前逐轮 firstFrame：1555 / 1894 / 1382 / 1449 / 1679 / 1808 / 939 / 1328 / 1309
改后逐轮 firstFrame：1594 / 792 / 1489 / 1351 / 1965 / 1756 / 1754 / 1714 / 1627

> **判据结论：首屏中位没有下降，差值不可分辨。** 改前跨度 955 ms、改后跨度 1,173 ms，跨度是差值的 5～6 倍，任何单向结论都只能用噪声解释。按既定口径（差值需大于 2.2 ms 且轮间极差小于差值）判为**未测出可分辨收益**。
>
> 若一定要一个"降了多少"的数字：**0 ms（不可分辨）**。真正拿到的是内存 −4.83 MB 与体积 −7,889 B（12 项死代码口径）。

---

## 2. 补丁 A：`titleBg` 离场释放 / 回场重建（MB 级收益）

### A1 新增两个函数（锚点：`stopTitleBackground` 函数体，命中 = 1）

把下面整段原文：

```js
function stopTitleBackground() {
  titleBgRuntime.running = false;
  if (titleBgRuntime.raf) cancelAnimationFrame(titleBgRuntime.raf);
  titleBgRuntime.raf = 0;
}
```

替换为「原文 + 新增两个函数」：

```js
function stopTitleBackground() {
  titleBgRuntime.running = false;
  if (titleBgRuntime.raf) cancelAnimationFrame(titleBgRuntime.raf);
  titleBgRuntime.raf = 0;
}

/**
 * 离场释放 #titleBg 全屏画布的像素后备区
 * ------------------------------------------------------------
 * 只把 width/height 归零：浏览器随即回收像素缓冲（实测 1570×805×4 = 4.83 MB）。
 * 星点与微粒坐标数组（约 2 KB）保留，回场无需重建布局，画面与离场前一致。
 * @returns {void}
 */
function releaseTitleBackground() {
  stopTitleBackground();
  const canvas = document.getElementById('titleBg');
  if (!canvas) return;
  if (!canvas.width && !canvas.height) return;
  canvas.width = 0;
  canvas.height = 0;
  titleBgRuntime.released = true;
}

/**
 * 回场重建 #titleBg：动效开则重启 rAF，动效关则补一张静帧（与 applyTitleChrome 同口径）
 * @returns {void}
 */
function restoreTitleBackground() {
  const canvas = document.getElementById('titleBg');
  if (!canvas || canvas.width > 0) return;
  if (titleMotionEnabled()) startTitleBackground();
  else { resizeTitleBg(); drawTitleBackground(0); drawTitleEmblem(0); }
  titleBgRuntime.released = false;
}
```

### A2 挂钩进出场（锚点：`setTitleVisible` 函数体，命中 = 1）

原文：

```js
function setTitleVisible(visible) {
  if (!ui.titleLayer) return;
  ui.titleLayer.classList.toggle('hidden', !visible);
  ui.titleLayer.setAttribute('aria-hidden', visible ? 'false' : 'true');
}
```

替换为：

```js
function setTitleVisible(visible) {
  if (!ui.titleLayer) return;
  ui.titleLayer.classList.toggle('hidden', !visible);
  ui.titleLayer.setAttribute('aria-hidden', visible ? 'false' : 'true');
  // v1.7.1 首屏内存：离场释放全屏背景画布，回场重建（两处都幂等）
  if (visible) restoreTitleBackground();
  else releaseTitleBackground();
}
```

> 为什么挂在 `setTitleVisible`：它是标题层显示/隐藏的唯一收口，三条进游戏路径（点开始、重开、读档）全部经过它，只改一处即可全覆盖；且它不会在标题页停留期间被调用，不会误释放。

### A3 实测（3 轮全新进程，dpr1，1600×900）

| | 进游戏后画布合计 | `#titleBg` 尺寸 | 返回标题页 |
|---|---|---|---|
| 改前 | 13.20 MB（= 原样常驻） | 1570×805（4.83 MB） | 1570×805 |
| 改后 | **8.37 MB** | **0×0** | **恢复 1570×805** |

- 差值 = 13.20 − 8.37 = **4.83 MB**，与 1570×805×4 = 4.82 MB 完全对上，没有多余开销。
- 返回标题页 3/3 轮：`mode=title`、`titleHidden=false`、`frames` 递增（27 / 54 / 23）、`__errors` 为空 → **不崩、动画照常**。
- dpr2：本机 `--force-device-scale-factor=2` 未能生效（canvas 仍是 1570×805），实测差值与 dpr1 相同；健康报告的 19.28 MB 只能按 2× 面积换算，**本轮未实测复现，标注"未测"**。

---

## 3. 补丁 B：`installDebugApi` 按需安装

> **⚠️ 留档规则（必须随补丁一起留档）**
>
> **本项不产生可测收益，落地理由是代码卫生。**
>
> - 隔离 A/B 7 轮：脚本解析执行 **3.5 → 3.0 ms**，Δ **−0.5 ms**，低于本机 2.2 ms 分辨力；
> - 整页首屏轮间跨度 955–1,173 ms，更不可能验证 0.5 ms 级差异；
> - **不许把它写成"优化"或计入任何性能收益表。** 它买到的是：普通玩家默认不安装 355,546 B / 8,111 行调试接口（攻击面与常驻源码小降），以及 `?debug=0/1` 的显式开关。

### B1 调用方审计结论（动手前先 grep `tools/`，已完成）

| 项 | 数字 |
|---|---|
| 引用 `__roamDebug` 的脚本 | **175 个** |
| 直接引用 `installDebugApi` 的脚本 | 0 个 |
| 自己拼 URL 打开主文件（A 类） | **174 个** |
| 只做页面内注入（B 类） | 0 个（注入库 `arcane_botnav.js` 计为库） |
| 存在覆盖全部脚本的公共 URL helper | **不存在**（`arcane_profile.js` 只管 profile，覆盖 166 个；`preview_cdp.js:openPreview` 只覆盖 5 个） |
| 等待接口的写法 | **0 处 `waitForFunction`**；164 个是"导航后固定 `sleep(1200–3200)` 再 eval" |
| 缺接口时的表现 | 秒级 `TypeError`（不是超时） |

→ 若用严格 `?debug=1` 门控，需改 **170 个文件**。因此本补丁改为三级门控：`?debug=0` 强制关 > `?debug=1` 强制开 > **无头 UA 兜底开**（实测 Edge `--headless=new` 的 UA 含 `HeadlessChrome`）。**tools/ 零改动**，普通玩家默认不装。

### B2 步骤 1：整段外置（锚点：`function installDebugApi() {`，命中 = 1）

1. 找到 `function installDebugApi() {`，从该行行首起，到其配对的 `}`（其后紧接 `/** 启动入口… */` → `function init()`）为止，**整段 8,111 行 / 355,546 B 剪切出去**。
2. 在该函数原来所在位置，粘贴 §3.3 的装载器代码。
3. 把剪切出来的那 8,111 行原样放进新增的惰性源块（见 B3），放在**唯一 `<script>` 开标签之前**（锚点：`<script>`，命中 = 1）。注意：该源码内不得含 `</script`（已验证 0 处），否则需转义。

### B3 步骤 2：新增惰性源块（插在 `<script>` 开标签之前）

```html
<script type="text/plain" id="arcDebugSource">
（此行为被剪切的 8,111 行 installDebugApi 原文）
</script>
```

### B4 步骤 3：换掉 init 内的调用（锚点：`installDebugApi();` 全文命中 = 1）

```js
  installDebugApi();
```

替换为：

```js
  installDebugApiIfNeeded();
```

### B5 装载器代码（粘贴在原函数位置）

```js
/**
 * 调试接口装载开关（按需安装）
 * ------------------------------------------------------------
 * 首屏不解析 355 KB 的调试块：源码改存进 <script type="text/plain" id="arcDebugSource">，
 * 只有本开关为 true 时才 eval 进作用域。优先级：?debug=0 强制关 > ?debug=1 强制开 >
 * 无头浏览器 UA 兜底开（tools/ 下 175 个自动化脚本因此零改动）> 其余关闭。
 * @returns {boolean} 本次是否允许装载
 */
function debugApiGateOn() {
  try {
    const q = String(location.search || '');
    if (/[?&]debug=0(&|$)/.test(q)) return false;
    if (/[?&]debug=1(&|$)/.test(q)) return true;
    return /HeadlessChrome|Headless/i.test(navigator.userAgent || '');
  } catch (e) { return false; }
}

/**
 * 按需装载调试接口（幂等；未开启开关时完全不解析调试源码）
 * @returns {boolean} 是否已装载
 */
function installDebugApiIfNeeded() {
  if (typeof window.__roamDebug === 'object' && window.__roamDebug) return true;
  if (!debugApiGateOn()) return false;
  const node = document.getElementById('arcDebugSource');
  if (!node) return false;
  try {
    // 直接 eval：声明落在 init 的词法作用域内，闭包才能读到 state / clamp 等模块级变量
    eval(String(node.textContent || '') + '\n;installDebugApi();');
    return typeof window.__roamDebug === 'object' && !!window.__roamDebug;
  } catch (e) {
    if (typeof recordError === 'function') recordError(e);
    return false;
  }
}
```

### B6 实测与验证

| 场景 | 结果 |
|---|---|
| `?debug=0` | `typeof __roamDebug === 'undefined'` → 全程未解析调试块 ✅ |
| 无参数 + 无头 UA | `__roamDebug` 为完整对象（`audio()` 等全部存在）✅ |
| 完整回归（无头 UA，走装载路径） | **52/52 PASS**（含 `__roamDebug.audio()` / `xp.setEnabled()` 等 30+ 处调用）✅ |
| 隔离 A/B（仅此项，7 轮交错） | 解析执行 3.5 → 3.0 ms（**−0.5 ms**）；脚本总时长 534.4 → 468.4（−66 ms，属噪声）；DCL +10.6、首帧 +131.6（噪声） |

### B7 为什么"省下的解析时间"接近 0（修正健康报告口径）

健康报告写"内联 JS 解析加执行 967 ms（55.6%）"。本轮页内直接测量（`m0` 在 `<script>` 首行、`m1` 在 `init();` 前）：

- 整个 **2.06 MB** 脚本的解析 + 顶层执行 = **3.5 ms**（改前）/ 3.4 ms（改后）;
- `init()` 执行 = **≈535–550 ms**（这才是首屏大头）；
- 到标题首帧还有约 **0.6–0.9 s** 的绘制/合成时间。

原因：V8 对函数体是**懒编译**，355 KB 的 `installDebugApi` 在启动时只走预解析（tokenize + 跳过函数体），真正的编译发生在调用时。因此把这段搬到惰性源块，只能省掉那一小段预解析（实测 −0.5 ms），**不可能省出几百毫秒**。

---

## 4. 补丁 C：清死代码

### C1 删除 12 个零引用 JS 项 + 保留 4 项（按决定）

**删除 12 项**（全部整段删除，含上方专属 docblock）。每条锚点 = `function <名字>(`（`toastCooldownUntil` 为 `let toastCooldownUntil`），命中均 = 1。

| 名字 | 类型 | 函数体 B(+NL) | 上方专属 docblock B(+NL) |
|---|---|---|---|
| `isRegionTransition` | function | 86 | 127 |
| `toastCooldownUntil` | `let` 变量 | 28 | 92（单行注释） |
| `seedSignatureOfRun` | function | 84 | 105 |
| `pickRandom` | function | 78 | 110 |
| `shuffleArray` | function | 212 | 138 |
| `roomsConflict` | function | 168 | 197 |
| `buildFallbackRooms` | function | 546 | 135 |
| `randomPointInRoom` | function | 172 | 158 |
| `clearTransientEffects` | function | 333 | 108 |
| `clearFloorEntities` | function | 210 | 66 |
| `drawRuneCircle` | function | 225 | 206 |
| `openRules` | function | 54 | 89 |
| **合计** | | **2,196** | **1,531** |

→ 12 项合计 **3,727 B**（2,196 + 1,531），= 16 项实测 5,755 B − 保留 4 项 2,028 B。

**保留 4 项（不删，理由：审计脚本把它们当全局函数调用，删了破坏"可复跑"）**

| 保留项 | 函数体 B(+NL) | docblock B(+NL) | 调用它的脚本 |
|---|---|---|---|
| `roomRouteScore` | 300 | 259 | `tools/arcane_routemods.js:126` |
| `floorModDistribution` | 469 | 153 | `tools/arcane_floormods.js:110` |
| `onboardStepForFloor` | 95 | 100 | `tools/reviewfix_apply.js:350` |
| `captureRunSnapshot` | 235 | 416 | `tools/arcane_openrandom.js:404` |
| **合计** | **1,099** | **928** | **2,027 B（约 2,028 B，含行尾差 1 B）** |

> 取舍依据：这 4 项只占 5,755 B 里的 2,028 B（35%），但它们承载"审计脚本可复跑"这一整套工作的地基。**不值得用可复跑性换 2 KB。**
>
> `openRules` 可删：`tools/arcane_rules_probe.js:35` 调用的是 `window.__roamDebug.openRules()`（调试接口方法），**不依赖这个全局函数**，删了不影响脚本。
>
> `captureRunSnapshot` 全文整词命中 2 处：一处是定义，另一处就在它自己的 docblock 正文里。既然保留，**不要动它上方注释**。

### C2 CSS：15 个类可删，7 个必须保留（任务书"22 类"有误）

**必须保留（7 个）**——它们由运行时字符串拼接产生，删了卡面会掉色：

| 类 | 证据 |
|---|---|
| `reward-magic` / `reward-tech` / `reward-fusion` / `reward-pact` | `'reward-' + option.kind` |
| `rarity-common` / `rarity-rare` / `rarity-epic` | `' rarity-' + rarity.id` |

`rarity-relic` 可删：拼接只可能产出 common/rare/epic，`relic` 在 `REWARD_RARITY` 里回落 common。

**可删的 15 个类**：`readout-floor`、`readout-enemy`、`btn-magic`、`rules-grid`、`rules-side`、`rule-block`、`help-grid`、`setting-hint`、`title-duo`、`title-duo-col`、`title-scroll`、`title-actions`、`title-foot`、`hud-icon`、`rarity-relic`
→ 共 **29 条整条规则 + 3 处选择器片段**，实际删除 **4,162 B**（原文清单见附录 A）。

**3 处只能摘片段（不能整条删，否则共用样式丢失）**，每处锚点命中 = 1：

| 摘除（原文） | 同条规则中必须保留 |
|---|---|
| `,\n  .readout > i.readout-enemy` | `.readout > b em` |
| `, .setting-row .setting-hint` | `.setting-state, .setting-note` |
| `,\n  .hud-icon svg` | `.btn > svg, .btn-mute svg, .icon svg` |

### C3 实测

- JS **12 项 −3,727 B**（16 项实测 5,755 B − 保留 4 项 2,028 B）；CSS 15 类 **−4,162 B**（实际字节差）；
- 死代码合计 **−7,889 B（0.29%）**；
- 按前版"三补丁合计 −7,194 B"加回保留的 2,028 B 推算，整份文件净减约 **−5,166 B（0.19%）**；**落地前以 `.optim/final_check.mjs` + 实测文件字节为准，不以推算数报数**；
- 死类残留复查：目标 15 类在 `<style>` 内残留 **0 处**（仅 `title-scroll` 出现在一段 CSS 注释文字里，不影响）；
- 共用规则保留复查：`.btn > svg`、`.readout > b em`、`.setting-state`、`.reward-card` 等全部在位。

---

## 5. 回归（"先跑一次回归证明没打坏东西"）

同一套 `arcane_verify`（仅把"首屏就绪"的 6 s 轮询放宽到 12 s、端口改为随机值，避免与并行会话抢 9444 端口、抢 `.testprofile`；断言标准一字未改），跑基线快照与全量补丁副本：

| 对象 | 结果 |
|---|---|
| 基线 `snapshot_A.html` | **52/52 PASS**（51 功能 + 1 PERF OK） |
| 全量补丁 `p_all.html` | **52/52 PASS**（同一套断言，逐条一致） |

> 说明：直接跑 `tools/arcane_verify.js` 会 100% FATAL（`state is not defined`），**基线也一样**——根因是它固定端口 9444 + 固定 `.testprofile` 目录，与并行会话互相踩，且传入相对路径时 URL 拼成 `file:///.optim/...`。这属于测试夹具问题，与补丁无关；已用 `ARCANE_PROFILE_ROOT` 隔离 + 绝对路径 + 随机端口绕开。

`page_boot_check` 另跑：**BOOT PASS**，`active: object / __roamDebug: object`。

---

## 6. 落地顺序与回滚

1. 先落 **A（titleBg）**：改 2 处、纯新增，风险最低，立刻拿到 4.83 MB。
2. 再落 **B（debug 外置）**：动 3 处（剪 8,111 行 / 插惰性块 / 换调用），落完必须跑 `page_boot_check` + 一次 `arcane_verify`，确认 `__roamDebug` 完整。
3. 最后落 **C（死代码）**：按附录 A 逐条删 CSS，按 C1 表逐个删 JS，删完跑一次回归。
4. 回滚：三块互相独立，A 回滚只需把 `setTitleVisible` 还原并把两个新函数删掉；B 回滚把惰性块内容搬回原位、调用改回 `installDebugApi();`；C 回滚按附录 A 原文补回。

---

## 7. 锚点核对（53 条：2,760,702 B 版本 53/53 = 1；2,773,330 B 版本 52/53）

核对脚本：`.optim/final_check.mjs`（对现场 `index_arcane_v2.html` 逐条计数，**落地前请重跑一次**）
覆盖：`setTitleVisible` 函数体、`stopTitleBackground` 函数体、`function installDebugApi() {`、`installDebugApi();`、`<script>`、**12 个删除项锚点 + 4 个保留项锚点**（保留项只核对存在、不删）、29 条 CSS 整条规则原文、3 处片段原文。

最新版本（2,773,330 B）唯一的失效项：`.readout-floor > b { font-size: var(--fs-xl); … }` 命中 0 —— 已被并行会话删除，落地时跳过即可。

首轮核对有 4 条报"非 1"，均为核对脚本的取文本方式问题，复判后确认实际 = 1：

| 报错项 | 复查结果 |
|---|---|
| `function toastCooldownUntil(` 命中 0 | 它是变量，正确锚点为 `let toastCooldownUntil` → **1** |
| `.title-duo .title-difficulty, .title-duo .` 命中 0 | 该规则选择器跨两行，原始锚点含换行 → **1** |
| `.readout > i.readout-enemy` 命中 2 | 一条是独立整条规则、一条是共用规则里的片段；片段锚点为 `,\n  .readout > i.readout-enemy` → **1** |
| `.setting-row .setting-hint` 命中 2 | 同上，片段锚点为 `, .setting-row .setting-hint` → **1** |

---

## 附录 A：整条删除的 29 条 CSS 规则（原文，逐条命中 = 1）

```css
.readout-floor > b {
    font-size: 30px;
    color: #d9fbff;
    text-shadow: var(--glow-tech);
  }
.readout > i.readout-enemy {
    display: block;
    font-style: normal;
    font-size: 11px;
    line-height: 1.2;
    color: #a9c1e0;
    font-weight: 400;
    letter-spacing: 0.03em;
    white-space: nowrap;
    margin-top: 2px;
  }
.btn-magic {
    border-color: rgba(176, 133, 255, 0.5);
    background: rgba(40, 24, 66, 0.72);
    color: #e6d6ff;
  }
.rules-grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    gap: 22px;
    align-items: stretch;
  }
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
.rule-block { margin-bottom: 18px; }
.rule-block h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 7px;
    font-size: 13px;
    color: #cfe4ff;
    letter-spacing: 0.05em;
  }
.rule-block h3 em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--tech);
    font-size: var(--fs-xs);
    border: 1px solid rgba(62, 230, 255, 0.3);
    border-radius: 3px;
    padding: 0 4px;
  }
.rule-block p, .rule-block li { font-size: 12.5px; line-height: 1.7; color: #b8cce6; margin: 4px 0; }
.rule-block ul { margin: 4px 0; padding-left: 18px; }
.rule-block b { color: #e6f4ff; }
.rule-block kbd {
    font-family: var(--mono);
    font-size: var(--fs-xs);
    border: 1px solid rgba(120, 170, 230, 0.35);
    border-radius: 3px;
    padding: 0 4px;
    color: var(--tech);
    background: rgba(6, 12, 22, 0.8);
  }
.help-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px;
    align-content: start;
  }
.help-grid .is-full { grid-column: 1 / -1; }
.setting-row .setting-hint { font-size: var(--fs-xs); color: var(--text-3); line-height: 1.6; }
.title-duo {
    display: grid;
    grid-template-columns: minmax(0, 1.06fr) minmax(0, 0.94fr);
    gap: 18px;
    align-items: start;
    margin-top: 2px;
  }
.title-duo-col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.title-duo .title-difficulty,
  .title-duo .title-talents { margin-top: 0; }
.title-duo .title-guide { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.title-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-right: 6px;
    scrollbar-width: thin;
    scrollbar-color: rgba(62, 230, 255, 0.34) transparent;
  }
.title-scroll::-webkit-scrollbar { width: 8px; }
.title-scroll::-webkit-scrollbar-thumb {
    border-radius: var(--r-pill);
    background: rgba(62, 230, 255, 0.3);
  }
.title-actions {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    flex: none;
    z-index: 3;
    margin-top: 10px;
    padding: 16px 0 2px;
    border-top: 1px solid rgba(126, 164, 214, 0.18);
    background: linear-gradient(180deg, rgba(8, 13, 24, 0) 0, rgba(7, 11, 20, 0.9) 22px);
  }
.title-foot {
    flex: 1;
    min-width: 220px;
    font-size: var(--fs-sm);
    color: var(--text-3);
    line-height: 1.7;
  }
.title-foot b { color: var(--text-2); }
.reward-card.rarity-relic { --rc: var(--rar-relic); --rc-line: var(--rar-relic-line); }
#titleLayer .title-foot { font-size: var(--fs-sm); color: var(--text-3); }
#titleLayer .title-actions { padding: 16px 0 0; gap: var(--sp-4); }
.readout-floor > b { font-size: var(--fs-xl); color: var(--text-1); }
/* 选取器片段：以下行只需删除其中标出的片段，不要整行删 */
  .btn > svg { width: 14px; height: 14px; display: block; color: rgba(160, 214, 255, 0.9); flex: none; }
  .readout > b em {
  .setting-state { font-family: var(--mono); font-size: var(--fs-xs); color: var(--text-3); }
```

> `.title-scroll` 还有一条注释里提到类名，那只是文字，不影响运行。

---

## 8. 风险与待拍板

1. **主文件正在被并行写入**（4 次读数 +50,455 B）。落地前请确认没有其它会话在写；否则先跑 §7 的 53 条锚点核对。
2. **`tools/ui-consistency-apply.mjs` 是这些 CSS 规则的注入源**（L127/128/137/139/185）。重跑它会把已删规则写回主文件 → 需标记废弃或同步改脚本，否则 C 会被回滚。
3. **4 个审计脚本依赖项已拍板保留**（§C1 表）：`roomRouteScore` / `floorModDistribution` / `onboardStepForFloor` / `captureRunSnapshot` 不删，只删其余 12 项。
4. **7 个 CSS 类不可删**（§C2），与任务书"22 个无引用"冲突，以现场证据为准。
5. **dpr2 内存未实测复现**（`--force-device-scale-factor=2` 在无头环境未生效）；19.28 MB 只能按 2× 面积推算，标注"未测"。
6. `titleBgHash()` 用的是同一张 canvas，释放后其哈希会变；`tools/arcane_u9.js` 只在进游戏前断言 `titleBgStats().running === false`，不影响；若有脚本在进游戏后比对标题画布哈希，需要同步调整。

---

## 9. `init()` 分段实测与候选优化（**只报方案，未落地**）

### 9.1 方法与判据更正

- 探针：`.optim/instrument_init2.mjs` → `init_probe2.html`（init 分段）；`instrument_floor.mjs` → `init_probe3.html`（`generateFloor` 内分段）；对照页 `init_probe4/5/6/7.html` 各只改一个变量。
- 采集：`.optim/seg_run.mjs`，每轮全新 Edge 进程，5 轮取中位/最小/最大。
- **判据更正**：整页首屏（改前 1,449.0 / 改后 1,627.1 ms，轮间跨度 955–1,173 ms）判为**不可分辨**，不再作为验收口径。改用 **`init()` 内部分段耗时**，取 **N ≥ 7 轮的最小值**（最小值比中位更能剔除机器抢占）。
- **上一版分段表标签整体错位一格**（`applyGameBranding 359.7` 实际是 `cacheUi`，`placePlayerAtSpawn 186.7` 实际是 `generateFloor`）。§9.2 已按语句重新配对。

### 9.2 `init()` 分段表（中位 [最小–最大]，ms；5 轮全新进程）

| 分段 | 中位 | 最小–最大 | 说明 |
|---|---|---|---|
| 首次样式计算（`getComputedStyle(body)`） | 15.8 | 14.6–20.5 | 对照页 4；CSS 总重算 ~50–71 ms（CDP） |
| **首次布局（`body.offsetWidth`）** | **346.5** | **295.9–362.9** | 对照页 4；与 bakeScene 无关 |
| 取 canvas/minimap + `cacheUi` | 0.3 + 13.0 | — | 纯 `getElementById`，13.0 含个别抢占 |
| `applyGameBranding` | 0.6 | 0.5–0.8 | 纯 DOM 文本写入 |
| `createInitialState` | 2.5 | 1.7–2.7 | 状态对象构造 |
| `loadAudioSettings` | 0.0 | 0–0.1 | 音频真正初始化在首次交互 |
| `resizeCanvas` | 1.8 | 1.2–12.5 | 主画布 1570×805 |
| **`generateFloor(1)`（整段）** | **239.2** | **150.2–608.8** | 见 9.3 |
| ├ `buildAtmosphere + bakeScene` | **209.6** | **119.6–575.6** | 最大可延后项 |
| └ 其余全部步骤 | 21.3 | 18.3–22.5 | 布局/门/道具/刷怪/连通校验 |
| `placePlayerAtSpawn` | 0.1 | 0–0.1 | 4 行赋值 |
| `bindEvents` | 6.0 | 2.9–7.7 | 事件绑定 |
| `buildRulesContent` / `renderTalents` / `renderDeck` | 1.9 / 2.6 / 2.2 | — | 面板 DOM 写入 |
| `applyQualitySettings` / `syncDifficultyButtons` | 0.3 / 0.1 | — | 开关同步 |
| **`updateHUD`** | **59.8** | **42.9–160.3** | 见 9.3 |
| `drawMinimap` | 0.4 | 0.2–0.4 | 小地图一次重绘 |
| `renderAudioSettings` / `updateTitleStats` | 0.2 / 1.2 | — | — |
| `setTitleVisible` | 0.3 | 0.2–0.3 | 切换标题层 |
| `installDebugApi` | 2.3 | 1.1–3.5 | 装载器 |
| `bindCrashOverlay` / `checkCrashFlagOnBoot` | 0.1 / 0.0 | — | — |
| `requestAnimationFrame(loop)` | 0.0 | 0–0.1 | 首帧不在 init 窗口内 |

**勾稽**：在无抢占的单轮里，分段和 = 总时长。
- 对照页 4（跳过 bakeScene）：`346.5 + 42.7 + 35.7 + 其余 ~34 = 459.5`（总中位 459.5）；
- 原版（含 bakeScene）：`~347 或 0 + 209.6 + 59.8 + 其余 ~65 = 681–741`（总中位 741.3）。

> **一次性大块会"搬家"**：同一台机器上，约 0.35–0.6 s 的大块在不同轮次分别落在"首次布局"或 `bakeScene` 头上（个别轮次因 CPU 抢占落到 `cacheUi`，出现 3.7 s 的假数）。**归因时看"是否与工作内容成正比"，不要看单轮谁最大。** 判定依据：去掉 `bakeScene` 后 GF 从 239.2 → 35.7，大块回落到首次布局 346.5，且五轮极差仅 67 ms → 布局是真实固定成本，bakeScene 是真实可去掉成本。

### 9.3 唯一最大那一段在干什么

**① `generateFloor()` 内的 `buildAtmosphere() + bakeScene()`（中位 209.6 ms，最坏 575.6）**

- `ensureSceneCanvas()` 新建离屏 canvas：`3200 × 2300 × sceneScale`（dpr 上限 1.5）
  - dpr1 = 7.36 MP ≈ **29.4 MB 后备区**；dpr1.5 = 16.4 MP ≈ **65.7 MB**；
- `clearRect(0, 0, 3200, 2300)` 清整张；
- `paintWorldBase()`：整图 `fillRect` + 对角线性渐变 + 92 条网格线（60 px / 180 px）+ 26 个径向渐变污渍 + 每间房地板/墙体/装饰；
- `ensureParallaxTiles()` 再烘焙 3 张可平铺视差贴片；
- 遍历对象 = 5 间房 + 全部走廊 + 世界底图 7.36 MP 像素。
- **标题页完全看不到这些**，是纯"开局前置成本"，**可以延后到点击"开始探索"或 `requestIdleCallback` 预热**。

**② `updateHUD()` 的 59.8 ms（最坏 160.3）**

- 来自 `setHudValue()` 里的 `void element.offsetWidth`：每改一个 HUD 数值就**强制整页重排一次**；
- init 里改多个值 → 多次重排，每次约 10 ms（CSS 清空对照页 7 里该项降到 2.6 ms，证明就是重排）；
- **init 阶段完全可以不做动画**，把这个强制重排关掉。

### 9.4 三个候选优化（预估收益均为实测/对照所得）

| 候选 | 做法 | 实测/预估收益 | 代价与风险 |
|---|---|---|---|
| **A. `bakeScene` 延后** | 标题页不烘焙世界；点"开始探索"时做，`requestIdleCallback` 预热 | **−203.5 ms（中位）**，最坏 −567 ms（GF 239.2→35.7 实测；init 总 741.3→459.5） | 进游戏首帧支付同额；`state.parallax/sceneArt/sceneProps` 需给默认值，`captureFloorSignature()` 若依赖需同步延后 |
| **B. 去掉 HUD 强制重排** | `setHudValue(el, text, animate)`；init 的 `updateHUD` 传 false | **−40.3 ms**（updateHUD 42.7→2.4，对照页 5 实测） | 无；游戏中数值变化的动画保留 |
| **C. 首屏重效果清零** | 标题页禁用 `backdrop-filter` / `filter: blur` / 大面积 `box-shadow` | **实测无效**：首次布局 346.5→375.6（噪声），**不做** | 会掉观感，且无收益 |
| **C′（替代，待验证）** | 规则/天赋/设置面板静态 DOM 改为首次打开时构建 | 全页 1,111 节点，按占比估算 **30–80 ms**，**未实测** | 面板首次打开多一次构建；按留档规则**必须标"待验证"，不许写成收益** |

### 9.5 验收口径（替换"整页首屏"）

| 改动 | 判据段 | 基线（中位 / 最小） | 目标 |
|---|---|---|---|
| A | GF `buildAtmosphere + bakeScene` | 209.6 / 119.6 | ≤ 5 ms（该段不做了） |
| B | `updateHUD` 段 | 42.7 / 38.3 | ≤ 5 ms |
| C′ | 首次强制布局（入口 `offsetWidth`） | 346.5 / 295.9 | ≤ 250 ms（需先做对照实测） |

每项 **N ≥ 7 轮、串行、同机、无并行会话**，取最小值；整页首屏仅作参考，不参与判定。

---

## 10. A + B 已落地（补丁原文 / 副本验证 / 配对实测）

**落地形态**：主文件 `index_arcane_v2.html` 仍只读（并行会话在写）；全部改动写入补丁，验证副本为 `.optim/copy_AB.html`（由 `.optim/apply_patch_AB.mjs` 从 `.optim/snapshot_C.html` = 2,833,891 B 精确替换生成，逐条命中 = 1）。

不做：C（§9.4 已实测证伪）、C′（仅登记"待验证"，不计收益）。

> **本轮新增硬要求已满足**：A / B **各有独立开关**（`PERF.deferBake` / `PERF.hudInitSlim`），且支持 URL 覆盖（`?perfA=0&perfB=1`），单测时不用改文件；两项都做到"改一个 `true`→`false` 即回退"，不需要删代码。见 §10.0。

### 10.0 独立开关（`PERF`，插在 `function generateFloor(` 之前）

```js
/* ============================================================================
   v1.7.1 首屏性能开关（A / B 各自独立，单测时只翻一个）
   ----------------------------------------------------------------------------
   PERF.deferBake    A 开关
                     true  = 标题页不烘焙，点"开始探索"后在黑场里补做（含遮罩 + transitionLock）
                     false = 完全恢复旧行为（启动期立即烘焙，无遮罩、无 transitionLock）
   PERF.hudInitSlim  B 开关
                     true  = 初始化那一次 updateHUD 不重播动画（跳过 4 次 void offsetWidth 重排）
                     false = 恢复旧行为（每次改值都强制重排）
   URL 覆盖（免改文件做单测；0 关、1 开）：index.html?perfA=0&perfB=1
   单行回退：把下表对应项改成 false 即可，不必删代码。
   ========================================================================== */
const PERF = (() => {
  const q = new URLSearchParams(location.search || '');
  const pick = (key, fallback) => (q.has(key) ? q.get(key) !== '0' : fallback);
  return { deferBake: pick('perfA', true), hudInitSlim: pick('perfB', true) };
})();
```

**怎么回退（一行，不用删代码）**

| 想关掉 | 改哪里 | 改成一个字 |
|---|---|---|
| A（延后烘焙） | `PERF.deferBake` | `false` → 启动期立即烘焙，无遮罩、无 `transitionLock` |
| B（init 不重排） | `PERF.hudInitSlim` | `false` → `updateHUD(undefined)`，走原 `setHudValue` 分支 |
| 两个都关（完全回到旧版） | 两处都改 | 等价于未打补丁 |
| 不改文件临时对比 | URL | `?perfA=0&perfB=0` |


### 10.1 A · 首屏延后烘焙

**A-1 `generateFloor`（锚点：`// 环境氛围（管线 / 裂纹 / 尘埃）...` 起 4 行，命中 = 1）**

```js
/* v1.7.1-A：首屏延后烘焙（开关 PERF.deferBake，关掉即恢复旧行为）。
   标题页阶段，"氛围数据 + 离屏烘焙"在屏幕上完全不可见，却占 init 里 generateFloor 的绝大部分。
   这里先记一个待办，等玩家点"开始探索"时在黑场最高点补做（flushPendingSceneBake）。
   换层 / 重开路径 state.mode 不是 'title'，仍走原来的立即烘焙，行为不变。 */
if (PERF.deferBake && state.mode === 'title') {
  state.sceneBakePending = true;
} else {
  state.atmosphere = buildAtmosphere();
  bakeScene();
}
```

**A-2 新增（锚点：`function startGame() {` 之前，命中 = 1）**

```js
let bootBakeVeil = null;

/**
 * v1.7.1-A：注入首屏遮罩样式（只注入一次）
 * 全部用 CSS 的 opacity / transform 动画：这两个属性由合成器驱动，
 * 即使接下来的同步烘焙把主线程占满，过渡仍会继续播 —— 不会退化成"死黑"。
 */
function ensureBootBakeStyle() {
  if (document.getElementById('bootBakeStyle')) return;
  const st = document.createElement('style');
  st.id = 'bootBakeStyle';
  st.textContent = [
    '#bootBakeVeil{position:fixed;inset:0;z-index:93;pointer-events:none;opacity:0;',
    'background:radial-gradient(ellipse at 50% 44%,rgba(40,86,104,.55) 0%,rgba(11,22,32,.94) 46%,#050910 80%);',
    'transition:opacity var(--bb-half,.15s) ease-in;will-change:opacity;}',
    '#bootBakeVeil.is-in{opacity:1;}',
    '#bootBakeVeil.is-out{opacity:0;transition:opacity var(--bb-half,.15s) ease-out;}',
    /* 兜底定格：弱机被抢占、淡入没跑起来时，先强制盖满，避免"点了跟没点一样" */
    '#bootBakeVeil.is-solid{opacity:1;transition:none;}',
    '#bootBakeGlyph{position:absolute;left:50%;top:50%;width:190px;height:190px;margin:-95px 0 0 -95px;',
    'opacity:0;transform:scale(.9);}',
    '#bootBakeVeil.is-in #bootBakeGlyph{animation:bbGlyphIn .42s cubic-bezier(.2,.7,.3,1) .12s forwards;}',
    '#bootBakeGlyph svg{width:100%;height:100%;display:block;transform-origin:50% 50%;}',
    '#bootBakeVeil.is-in #bootBakeGlyph svg{animation:bbSpin 16s linear infinite;}',
    '#bootBakeHint{position:absolute;left:0;right:0;bottom:17%;text-align:center;opacity:0;',
    'font:400 12px/1.7 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;letter-spacing:.20em;',
    'color:rgba(158,206,222,.78);text-shadow:0 0 12px rgba(80,180,210,.35);}',
    '#bootBakeVeil.is-in #bootBakeHint{animation:bbHintIn .30s ease-out .60s forwards;}',
    '@keyframes bbGlyphIn{to{opacity:.92;transform:scale(1);}}',
    '@keyframes bbSpin{to{transform:rotate(360deg);}}',
    '@keyframes bbHintIn{to{opacity:1;}}',
    '@media (prefers-reduced-motion:reduce){',
    '#bootBakeVeil.is-in #bootBakeGlyph{animation:none;opacity:.85;transform:none;}',
    '#bootBakeVeil.is-in #bootBakeGlyph svg{animation:none;}',
    '/* 减少动画时不做渐变，但 0.6 s 阈值照样保留（时长为 0 的延迟动画） */',
    '#bootBakeVeil.is-in #bootBakeHint{animation:bbHintIn 0s ease-out .60s forwards;}}'
  ].join('');
  document.head.appendChild(st);
}

/**
 * 懒创建首屏烘焙专用遮罩（一次性 DOM，不参与任何既有转场）
 * 结构：雾面渐变底 + 低速旋转符阵 + 一行"正在进入"提示（0.6 s 后才淡入）
 * @returns {HTMLElement|null} 遮罩节点
 */
function ensureBootBakeVeil() {
  if (bootBakeVeil) return bootBakeVeil;
  if (!document.body) return null;
  ensureBootBakeStyle();
  const el = document.createElement('div');
  el.id = 'bootBakeVeil';
  el.setAttribute('aria-hidden', 'true');
  const glyph = document.createElement('div');
  glyph.id = 'bootBakeGlyph';
  glyph.innerHTML = '<svg viewBox="0 0 200 200" fill="none" aria-hidden="true">'
    + '<circle cx="100" cy="100" r="86" stroke="rgba(120,214,232,.20)" stroke-width="1"/>'
    + '<circle cx="100" cy="100" r="62" stroke="rgba(120,214,232,.15)" stroke-width="1"/>'
    + '<circle cx="100" cy="100" r="40" stroke="rgba(120,214,232,.11)" stroke-width="1"/>'
    + '<polygon points="100,14 174,143 26,143" stroke="rgba(140,225,240,.34)" stroke-width="1"/>'
    + '<polygon points="100,186 26,57 174,57" stroke="rgba(140,225,240,.34)" stroke-width="1"/>'
    + '<circle cx="100" cy="100" r="5" fill="rgba(150,232,244,.55)"/>'
    + '</svg>';
  const hint = document.createElement('div');
  hint.id = 'bootBakeHint';
  hint.textContent = '正在进入…';
  el.appendChild(glyph);
  el.appendChild(hint);
  document.body.appendChild(el);
  bootBakeVeil = el;
  return el;
}

/**
 * 补做被延后的烘焙：雾面淡入 → 等遮罩盖满 → 同步烘焙 → 淡出露出世界
 * @param {number} [duration] 单程时长（秒）
 * @returns {boolean} 是否执行
 */
function flushPendingSceneBake(duration) {
  if (!state || !state.sceneBakePending) return false;
  state.sceneBakePending = false;
  const d = clamp(Number(duration) || 0.30, 0.10, 1.4);
  const half = d * 0.5;
  const bakeNow = () => {
    /* 黑场到位：此时玩家什么也看不到，同步烘焙被完全遮住 */
    setTitleVisible(false);
    state.atmosphere = buildAtmosphere();
    bakeScene();
  };
  const veil = ensureBootBakeVeil();
  if (!veil) { bakeNow(); return true; }
  state.transitionLock = true;
  veil.style.setProperty('--bb-half', half.toFixed(3) + 's');
  veil.getBoundingClientRect();
  veil.classList.add('is-in');
  /* 等遮罩真正盖满再烘焙 —— 优先 transitionend，另设兜底超时（跳过 transition 时也能继续） */
  let started = false;

  /**
   * 真正开始烘焙并在结束后淡出遮罩
   */
  function startBake() {
    if (started) return;
    started = true;
    veil.removeEventListener('transitionend', onFadeIn);
    /* 弱机兜底：淡入若没跑到全黑（被长任务/抢占卡住），直接定格盖满再烘焙 */
    if (Number(getComputedStyle(veil).opacity) < 0.99) veil.classList.add('is-solid');
    bakeNow();
    veil.classList.remove('is-in', 'is-solid');
    veil.classList.add('is-out');
    setTimeout(() => {
      state.transitionLock = false;
      if (veil && veil.parentNode) veil.parentNode.removeChild(veil);
      bootBakeVeil = null;
    }, half * 1000);
  }

  /**
   * 淡入结束回调（只认 opacity，忽略子元素冒泡上来的其它属性）
   * @param {TransitionEvent} e 过渡事件
   */
  function onFadeIn(e) { if (e.propertyName === 'opacity') startBake(); }

  veil.addEventListener('transitionend', onFadeIn);
  setTimeout(startBake, half * 1000 + 140);
  return true;
}
```

> **为什么不黑屏、为什么不是"死黑"**：底色是径向渐变雾（中心 `rgba(40,86,104,.55)` → 边缘 `#050910`），中间叠一个 190 px 的细描边符阵（三同心圆 + 两个反向三角），以 16 s 一圈低速旋转；全部走 CSS `opacity` / `transform`，由合成器驱动，**主线程被烘焙占满时仍能继续播**。
>
> **>0.6 s 才出提示**：`#bootBakeHint`（"正在进入…"）用 `animation: bbHintIn .30s ease-out .60s forwards` —— 纯 CSS 延迟，不需要 JS 定时器（JS 定时器在烘焙期间根本跑不到）。`prefers-reduced-motion: reduce` 时把时长换成 `0s`，**延迟仍保留 0.6 s**，只是不做渐变。
>
> **为什么要等 `transitionend`**：遮罩盖满之前就烘焙，玩家会看到"半透明雾里定格"，观感像掉帧。实测（未加 transitionend 时）7 轮里有 7 轮在 `opacity 0.51–0.74` 就开始烘焙；加 transitionend 后 7 轮中 6 轮读到 `opacity 1.000` 才烘焙，第 7 轮走了 `is-solid` 兜底（定格盖满）。

> **为什么不用现成的 `playSceneFade`（实测踩过的坑）**：`playSceneFade` 带 `sceneFadeRuntime.token`，而玩家进入出生房时 `revealRoom` 会立刻调用 `playSceneFade(0.18, 'room', null, true)`，把 token 抢走 → 我们的 `atPeak` 永不执行：**烘焙丢失 + `transitionLock` 永不释放（实测点开始后 2.5 s 仍锁死、`sceneCanvas` 为空）**。改用 z-index 93 的独立遮罩后，互不干扰（进房淡入被遮罩盖住，看不到）。

**A-3 `startGame`（锚点：`setTitleVisible(false);` + `updateTitleStats();` 两行，命中 = 1）**

```js
/* v1.7.1-A：标题阶段跳过的烘焙在这里补做；有遮罩时标题也到黑场再收起（开关 PERF.deferBake） */
if (!(PERF.deferBake && flushPendingSceneBake(0.30))) setTitleVisible(false);
updateTitleStats();
```

**A-4 默认值补齐（`createInitialState`，锚点各命中 = 1）**

| 字段 | 烘焙前默认值 | 为什么必须给 |
|---|---|---|
| `parallax` | `enabled:false, theme:'', layers:[], holes:{rooms:0,corridors:0,hidden:0,total:0,rects:[]}, apron:null, apronPatch:null, depth:null, drawMs:0, drawMsAvg:0, clipMs:0` | `drawVoidDepth()` 每帧读；贴片为空自然跳过，不会崩 |
| `sceneProps` | `lights/debris/fans/steam/belts/drips/warm` 七个空数组 | `drawMechProps()` 先判 `props.fans`；缺一个就会被 `forEach` 读到 |
| `sceneArt` | `{ themeId:'mech', floor:0, rooms:{}, totals:{lights:0,debris:0,decor:0} }` | 审计脚本/验收工具在标题页就可能读 |
| `sceneBakePending` | `false` | 只有标题页启动路径置 `true`，其余路径行为不变 |

**签名口径（与任务书一致，但落法不同，理由如下）**：`captureFloorSignature()` **保留原位**。读代码证据：它只遍历 `state.rooms / state.enemies / state.doors / spawn / stair`，**不读 `bakeScene` 的任何产物**；而 `spawnEnemiesForFloor()` 本来就在它之前。若强行挪到黑场里，反而会把"签名"排在 `maybeAutosaveRun('run-start')` 之后 → 存档可能先于签名落盘，才是真正的"按空值算"。**结论：不延后 = 不会出现空签名。**

### 10.2 B · 初始化跳过一次 HUD 动画重排

**B-1 `setHudValue`（锚点：函数 doc 注释 + 函数体，命中 = 1）**

```js
function setHudValue(element, text, animate) {
  if (!element || element.textContent === text) return;
  element.textContent = text;
  /* v1.7.1-B：初始化时 animate=false —— 首屏没有任何人看得到"弹一下"，
     但 void element.offsetWidth 会强制同步重排，初始化一次要白付 4 次。 */
  if (animate === false) {
    element.classList.remove('is-bump', 'is-scan');
    return;
  }
  // ……原逻辑不变（is-scan / is-bump + void element.offsetWidth + 重播类）
}
```

**B-2 `updateHUD(animate)`**：签名加参数，内部 4 处 `setHudValue` 全部透传（`hudFloor` / `hudEnemy` / `hudRecordText` / `minimapFloor`），各命中 = 1。

**B-3 启动期调用**（锚点：`syncDifficultyButtons(); renderDeck(); updateHUD(); drawMinimap();`，命中 = 1）：仅这一处改成

```js
  /* v1.7.1-B：启动这一次没人看动画，跳过 4 次强制重排（开关 PERF.hudInitSlim，关掉即恢复旧行为） */
  updateHUD(PERF.hudInitSlim ? false : undefined);
```

> **状态不是全局开关**：`animate` 只是形参，`undefined` 即走原分支。实测 8/8 轮进游戏后改数值，`#hudRecord` 仍为 `is-scan is-hot`，`animation-duration 0.42s`（贴前 8/8 轮同样结果）→ **游戏中动画未被关掉，没有引入新 bug**。

### 10.3 配对实测（N = 7 有效配对，同进程交替，串行，取最小值）

> 本节数字为**加入过渡视觉（雾面 + 符阵）与 0.6 s 提示之后**的复测，取代早前"纯黑遮罩"版本的读数。

- 环境：Edge `headless=new`，每次全新 profile，CDP 直连；轮间 `about:blank` 释放。
- 机器状态：CPU **18%–76%**，msedge **20–38** 个（其它会话在跑，未等待"CPU 正常"）。
- 有效配对定义：同一轮 pre 与 post **都**跑完且都拿到 `clickToWalk`；超时轮作废、不计入（本轮 9 轮里 2 轮作废）。
- **绝对值一律"不可引用"**；下表只用于**看差值**。

| 指标（ms） | 贴前（快照）min / 中位 | 贴后（副本）min / 中位 | 差值（min） | 证据级别 |
|---|---|---|---|---|
| init 内 `generateFloor` 段 | 65.3 / 138.1 | 20.4 / 23.6 | **−44.9** | 实测（本轮配对） |
| init 内 `buildAtmosphere+bakeScene` 段 | 47.1 / 116.2 | **该段在 init 内不执行** | 结构性移除 | 实测（分支判定） |
| 遮罩内真实烘焙 `bakeNow()` | — | 55.3 / 79.4 | 移到"点开始" | 实测（本轮） |
| init 内 `updateHUD` 段 | 7.2 / 11.1 | **0.6 / 1.2** | **−6.6** | 实测（本轮配对） |
| **体验 ① 文档开始 → 标题可见** | 214.4 / 295.8 | **156.4 / 177.1** | **−58.0** | 实测（本轮配对） |
| **体验 ② 点"开始探索" → 能走** | 21.7 / 51.3 | 404.4 / 511.2 | +382.7（换来了 ①） | 实测（本轮配对） |

**哪些是实测、哪些是推算**

| 结论 | 级别 | 依据 |
|---|---|---|
| ① 标题可见提前 58 ms | **实测** | 7 对有效配对，最小值口径 |
| ② 点开始后多等 382.7 ms（常态 0.40 s；中位 0.51 s） | **实测** | 同上 |
| ② 最坏 1.13～1.31 s | **实测** | 同一批 7 对里的 R5/R9 post（bake 352 / 448 ms，CPU 27–75%） |
| init 内 `generateFloor` −44.9 ms | **实测** | 同上 |
| init 内 `updateHUD` −6.6 ms | **实测** | 同上 |
| 遮罩"盖满后才烘焙"6/7 轮、兜底定格 1/7 轮 | **实测** | `#bootBakeVeil` 的 computed opacity |
| 符阵可见、提示 0.6 s 阈值、reduce 分支 | **实测（单测，非配对轮）** | §10.5 |
| 提示在"最慢那轮"确实会亮 | **推算** | 该轮 bake 448 ms + 淡入 150 ms = 598 ms，**差 2 ms 没触发**；只有 bake > 450 ms 才亮 |
| §9.4 的 "−203.5 ms（中位）" | **推算/旧基线** | 上一轮 5 轮中位；负载不同，**不并入本轮收益** |
| 首次布局 346.5 ms（1,111 节点 + 183 KB CSS） | **实测（旧轮）** | 本轮**未动**：固定成本，属 C / C′ 领域；C 已证伪、C′ 待验证 |

**判读**：

- **A 的 init 判据**：`buildAtmosphere+bakeScene` 在 init 内**已不执行**（结构性移除，不是"测得 0 ms"），该段写 **"未测（不执行）"**；可比替代口径是 `generateFloor` 段 65.3 → 20.4 ms。
- **"延后不能变卡一下"**：② 常态 404 ms ≈ 淡入 150 + 烘焙 55 + 淡出 150 + 收尾；烘焙发生在遮罩 `opacity = 1.000` 时（6/7 轮实测），**屏幕是雾面 + 符阵，不是死黑**。最慢两轮（bake 352/448 ms）同样全程被遮罩盖住。
- **0.6 s 提示的有效区间要说清**：它只在"淡入 150 ms + 烘焙 > 450 ms"时点亮。本轮最慢 448 ms **刚好没亮**；上一轮出现过 bake 552.8 ms（总 1.04 s）的场景，那种情况下会亮（按阈值推算，未在该轮直接采样）。
- **B 判据**：7/7 轮 `updateHUD` ≤ 5 ms（0.6–1.7），**达标**。
- **错误**：贴前/贴后 `window.__errors` 均为空。

### 10.4 锚点核对（诚实记录）

- `final_check.mjs` 对快照与副本各跑一次，**51/53 命中 = 1**；未命中的 2 条与本批改动无关：
  1. `<script>`：文件里命中 4（并行写入后新增了内联脚本）——该条本质是"存在性"伪锚点，不是唯一定位锚点；
  2. 附录 CSS `.readout-floor > b {...}`：命中 0 —— 文档附录声明与当前代码有漂移（代码仍是 `.readout-floor > b {`，但后续声明已改）。
- 本批 **13 条补丁锚点全部命中 = 1**（`apply_patch_AB.mjs` 逐条打印：A-0 / A-1 / A-2 / A-3 / A-4a / A-4b / B-1 / B-2a～e / B-3），符合"命中不唯一就停"。
- 若要把上面 2 条也修成可判定锚点，需要另开一次文档对齐（本批不动，避免把"改代码"和"改检查器"混在一起）。
- **现场漂移提醒（会过期，务必现场复核）**：本批基于 `.optim/snapshot_C.html`（2,833,891 B）。**2026-11-09 07:45 观察**：现场主文件已到 **2,868,107 B**（并行会话仍在写，比快照多 34,216 B；早前观察值为 2,845,375 B，说明还在持续增长）。真正往主文件套补丁前，必须先以最新主文件为源重跑 `node .optim/apply_patch_AB.mjs`：**13 条锚点必须各命中 1 次**才可套用；任一 ≠1 就按新版本重新定位，不要硬套。
- 说明：§10.3 的配对实测跑在**含 `PERF` 开关的 `copy_AB.html`**（`?perfA/perfB` 均不传 → 默认全 true，分支结果与原版一致）；贴前侧为 `snapshot_C.html`，两侧由 `probe_AB.mjs` 现注入同一套分段计时。

### 10.5 开关单测（`.optim/test_switches.mjs`，同进程串行加载 4 种组合）

| `?perfA&perfB` | 标题页 `sceneBakePending` | 标题页 `sceneCanvas` | init 后 `#hudRecord` class | 点开始 → 能走 | 残留遮罩 / 锁 | 报错 |
|---|---|---|---|---|---|---|
| `1&1`（默认） | true | **未建** | `''`（无动画类） | ✅ | 无 / 已释放 | 无 |
| `0&1`（只关 A） | false | **已烘焙** | `''` | ✅ | 无 / 已释放 | 无 |
| `1&0`（只关 B） | true | 未建 | **`is-scan`** | ✅ | 无 / 已释放 | 无 |
| `0&0`（全关＝旧版） | false | 已烘焙 | `is-scan` | ✅ | 无 / 已释放 | 无 |

**结论**：两个开关互不影响、各自可独立开关；关掉后行为与旧版一致（A 关 → 启动即烘焙；B 关 → init 也重播动画类）。

**"游戏内动画还在"复验（默认 `1&1`）**：进游戏后 `state.kills+1; updateHUD()` → `#hudRecord` class 由 `''` 变为 `is-scan is-hot`，`animation-duration 0.42s` → **动画只被 init 那一次跳过，没有被写成全局状态**。

#### 10.5.1 过渡视觉与 0.6 s 提示（单测，2 个媒体分支各 1 次，2026-11-09 重跑）

做法：不触发真实烘焙（避免长任务干扰采样），直接调用 `ensureBootBakeVeil()` + `is-in`，在 350 ms 与 1000 ms 两个时点读 computed style。两次采样都用 `--bb-half: 0.05s`，只为缩短淡入、把时间花在"提示阈值"上。

| 分支 | 350 ms `glyph` | 350 ms `hint` | 1000 ms `glyph` | 1000 ms `hint` | 符阵旋转 | 遮罩底色 |
|---|---|---|---|---|---|---|
| `prefers-reduced-motion: no-preference` | **0.822** | **0** | 0.92 | **1** | `bbSpin` | `radial-gradient(at 50% 44%, rgba(40,86,104,…)` |
| `prefers-reduced-motion: reduce` | 0.85（静态） | **0** | 0.85（静态） | **1** | `none` | 同上 |

**三条结论**

1. **不是死黑**：遮罩底色是径向渐变（中心 `rgba(40,86,104,.55)` 偏青雾，外圈压到 `#050910`），符阵在 350 ms 时已可见（`opacity 0.822`，`no-preference` 下带 `bbSpin` 16 s 慢转），所以"按下开始"后看到的是**雾面 + 符阵在动**，不是黑屏。
2. **0.6 s 阈值两条分支都成立**：`350 ms hint = 0` → 不早出；`1000 ms hint = 1` → 超过 0.6 s 一定亮。`reduce` 下只是把淡入换成 0 s（不做渐变），**延迟没有取消**（这是首版踩坑点，已修）。
3. **提示文案**：`正在进入…`，12 px、`letter-spacing .20em`、低对比度青色——一行小字，不抢戏。

> 限制：本节是**机制单测**，不是真实长烘焙下的采样。真实烘焙阻塞主线程时，CSS 动画由合成器继续跑（`opacity`/`transform` 属合成属性），这也是为什么提示用**纯 CSS `animation-delay`** 而不是 JS `setTimeout`——后者在烘焙期间根本排不上。

### 10.6 回滚

- **一行开关回退**（推荐，见 §10.0）：`PERF.deferBake = false` / `PERF.hudInitSlim = false`，或 URL `?perfA=0&perfB=0`。不用删代码，可随时再打开。
- **代码级回退**：丢弃 `.optim/copy_AB.html`；主文件从未被写入。
- 若只回退 A：删掉 A-1/A-2/A-3（保留 A-0 开关与 A-4 默认值，无害）。
- 若只回退 B：`setHudValue` 第三参数与 `updateHUD(...)` 调用一并回退即可，无数据迁移。
