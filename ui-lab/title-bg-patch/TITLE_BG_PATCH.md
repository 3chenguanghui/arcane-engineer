# 烬 · 标题页背景接入补丁（方向一：符阵）

> 交给写权线贴。**本补丁只碰背景画布这一层**：不改字标位置、不改按钮、不改难度卡、不改 `#titleCard` 结构（那些属于 B 方案）。
> 本机已在只读主文件的**副本**上落地并验收，主文件 `index_arcane_v2.html` 一个字节都没写。

## 0. 一句话

复用页面里**已有的** `<canvas id="titleBg" class="title-bg">`（HTML/CSS 完全不动），只替换它的运行时：`resizeTitleBg`（dpr 上限 1.5）、`drawTitleBackground`（换画法）、`startTitleBackground`（`?bg=off` 兜底）、`titleBgRuntime`（加 `dpr` 字段与开关常量）。

---

## 1. 基线（**贴前必须回读**）

主文件正被另一条线并发写入：同一路径在 20 分钟内从 `2,812,871 B` 长到 `2,833,891 B`。
所以：**行号仅供定位参考，锚点一律按「函数签名 + 括号配平」整函数替换**；MD5 只作"是否同一版本"的判据。

| 项 | 值（本机落地时的快照，2026-11-08 23:05） |
|---|---|
| 贴前字节 | **2,833,963 B** |
| 贴前 MD5 | **22D28003E947503101476C789FDBB0AC** |
| 贴后字节 | **2,852,390 B** |
| 贴后 MD5 | **55A9AB991243CA88AD2C3E4FE05D255E** |
| 净增量 | **+18,427 B** |
| 其中 payload | 19,079 B（`tbg-sigil.payload.js`，UTF-8） |
| 旧代码净减 | 652 B（`resizeTitleBg` / `drawTitleBackground` / `startTitleBackground` / runtime 四处合计） |
| 锚点命中 | **4 / 4，每处恰好 1 次**（外加 `stopTitleBackground` 校验 1 次，未改） |

> 对比上一版快照：贴前字节从 `2,833,891` 变成了 `2,833,963`、MD5 从 `CA61D8A9…` 变成 `22D28003…`，
> 说明**主文件在两次构建之间又被别的线写过**，但四个函数签名锚点仍然各命中 1 次——这正好验证了"按签名 + 配平"而不是按行号的正确性。

回读核对命令（Windows PowerShell）：

```powershell
$f='D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html'
(Get-Item $f).Length
(Get-FileHash $f -Algorithm MD5).Hash
```

- 若 MD5 与上表一致 → 按本补丁贴，贴完应为 `2,852,390 B / 55A9AB99…`；
- 若 MD5 已不同（B 方案又写过了）→ **增量以现算为准**：`Δ = 19,079 - (被替换四段的旧字节合计)`；四处旧代码各约 0.6 KB，量级稳定在 **+18.3 KB / +18.5 KB**；
- 无论哪种情况，**贴完都要回读字节 + MD5 并与实际贴后值比对**（把实际值记到交付说明里）。

### 1.1 本轮落地快照（2026-11-09，字标 A 已入树后重钉）

上表是 2026-11-08 首次构建时的快照，已经过期。本轮贴盘用的是重钉后的基线：

| 项 | 值（2026-11-09 07:36 落地） |
|---|---|
| 贴前字节 | **2,848,200 B** |
| 贴前 MD5 | **13D9C718FCC7FBC7B9EF5A23F329E0DF** |
| 贴后字节 | **2,866,627 B** |
| 贴后 MD5 | **B7634B786ECFF5DF0B323A7C9DD98F2C** |
| 锚点命中 | **5 / 5，每处恰好 1 次**（`A1_runtime` / `A2_resize` / `A3_draw` / `A4_start` / `A5_stopCheck`） |
| 冒烟 | `node tools\smoke.mjs --force` → **6 / 6 PASS** |

### 1.2 规则：基线随批次前移（**别再踩第三次**）

`apply-titlebg.mjs` 里的 `EXPECT_BEFORE` / `EXPECT_AFTER` 是**构建时快照**，不是永久常量。
只要主文件被别人（或别的批次）改过，它就一定对不上，脚本会以**退出码 3** 拒写——这是保护，不是故障。

**谁负责改**：**每一个"落地后会让主文件字节变化"的批次负责人**。不是背景补丁的负责人，是当批的人。
（字标 A、层级、进场、e6、Q5 任何一批都算。）

**改哪里**：`ui-lab/title-bg-patch/apply-titlebg.mjs` 顶部两行常量：

```js
const EXPECT_BEFORE = { bytes: <本批贴前实测字节>, md5: '<本批贴前实测 MD5>' };
const EXPECT_AFTER  = { bytes: <本批贴后实测字节>, md5: '<本批贴后实测 MD5>' };
```

**什么时候改**：**你的批次写盘成功后，立刻把这两个值改成刚回读到的实际值**，并在上方注释里追加一行
`// 最近一次前移：<日期>，<批次名> 落地后（vX.Y.Z / <贴后 MD5>）`。
改完用 dry-run 复核一次：`node ui-lab/title-bg-patch/apply-titlebg.mjs`。
注意 `A1_runtime` 用的是**贴前**的 runtime 原文，贴过一次后必然 `hits=0`；脚本已用贴后特征串
`TITLE_BG_OFF` 判定"已在树内"，此时输出 `本补丁已在树内…无需二次贴` 且 `EXIT=0` 才是正常态，
不要看到 `A1_runtime: 0` 就以为结构被改。

**什么时候不许改**：dry-run 报退出码 3 时，**先确认主文件的改动是不是你自己刚做的**。
是 → 属于本规则，按上面重钉；不是 → 有并行写者，**停手报人**，不许用 `--force` 硬贴
（`--force` 等于把"贴前确认没人动过文件"这道检查整个关掉，是这套流程里唯一真正危险的动作）。

---

## 2. 层级与覆盖关系（坑在这里）

现状（本机回读的行号，随文件漂移）：

| 元素 | 位置 | z-index | 说明 |
|---|---|---|---|
| `#titleLayer` | 4327 行附近 `background: #03070d;` | — | **父级**。父级背景永远画在子元素之下，不会盖住子 canvas |
| `#titleBg`（canvas） | 4329–4335 / 6688 行 | **0** | 本补丁唯一改动的对象，铺满标题层 |
| `#titleEmblem`（canvas） | 4337–4346 / 6690 行 | **1** | 前景徽记，**不动**，仍由 `drawTitleEmblem(ts)` 每帧画 |
| `.title-card` | 4136 / 6691 行 | **2** | 标题卡与所有按钮，压在两层画布之上 |

历史上的坑（`#titleLayer` 的背景色把两条 radial 整片盖掉）复述结论：

1. **不要**把 `#titleBg` 移到 `#titleLayer` 之外（那样父级 `#03070d` 会整片盖住它）；
2. **不要**给 `.title-bg` / `#titleLayer .title-bg` 加 `background` 或任何不透明填充（那是"盖死 radial"同款写法）；
3. **不要**改 `#titleLayer` 的 `background`（B 方案在用它）；本补丁也不需要改；
4. 不要改 canvas 的 `mix-blend-mode` / `opacity`，当前 CSS 已按"卡片之下"调好。

补丁**不新增** HTML 元素、**不新增** CSS 规则——这是刻意为之：越少动 DOM，越不容易和 B 方案冲突。

---

## 3. 四处锚点（按顺序贴）

### A1 · 运行时对象：加 `?bg=off` 常量与 `dpr` 字段

锚点（当前 54434 行，精确匹配，命中 1 次）：

```js
/** 标题背景运行时：running / frames 供验收读取，stars+diff 只在初始化时生成一次 */
const titleBgRuntime = {
  running: false,
  frames: 0,
  raf: 0,
  w: 0,
  h: 0,
  stars: [],
  dust: []
};
```

替换为：

```js
/** 标题背景运行时：running / frames / dpr 供验收读取；stars+dust 仅旧版背景使用 */
/** ?bg=off：整层背景关闭（画布隐藏、不排队 rAF），用于兜底与 A/B */
const TITLE_BG_OFF = /[?&]bg=off(?:&|$)/.test(location.search);
const titleBgRuntime = {
  running: false,
  frames: 0,
  raf: 0,
  w: 0,
  h: 0,
  dpr: 1,
  stars: [],
  dust: []
};
```

### A2 · `resizeTitleBg`：dpr 上限写死 1.5（整函数替换）

锚点：`function resizeTitleBg() {`（当前 54613 行）。从函数签名到配对 `}` 整段替换为：

```js
/**
 * 同步标题画布尺寸（dpr 上限写死 1.5：高分屏只吃 1.5 倍像素，成本可控、线宽稳定）
 * @returns {HTMLCanvasElement|null} 画布
 */
function resizeTitleBg() {
  const canvas = document.getElementById('titleBg');
  if (!canvas) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(320, canvas.clientWidth || window.innerWidth || 320);
  const h = Math.max(320, canvas.clientHeight || window.innerHeight || 320);
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  titleBgRuntime.w = w;
  titleBgRuntime.h = h;
  titleBgRuntime.dpr = dpr;
  // 前景徽记是同一次 resize 里的另一张画布，一并同步尺寸（否则高 DPI 切换会糊）
  const em = document.getElementById('titleEmblem');
  if (em) {
    const s = Math.max(120, Math.round(Math.min(em.clientWidth, em.clientHeight) || 220));
    if (em.width !== s) em.width = s;
    if (em.height !== s) em.height = s;
    titleEmblemRuntime.w = s;
    titleEmblemRuntime.h = s;
  }
  return canvas;
}
```

> 注意：原来的 canvas 尺寸是 1:1（`canvas.width = clientWidth`）。改成 1.5 倍后，**所有绘制必须走 `dpr` 变换**（A3 已处理）。徽记的尺寸逻辑保持原样，只是被搬进同一函数。

### A3 · `drawTitleBackground`：插入 payload + 整函数替换

锚点：`function drawTitleBackground(ts) {`（当前 54741 行），连同它上面的 `/** 画一帧标题背景… */` 注释一起替换。

**插入方式**：

1. 把 `tbg-sigil.payload.js`（同目录，18,976 B）**全文原样**放在原注释的位置；
2. 紧接着放新函数：

```js
/**
 * 画一帧标题背景：方向一 · 符阵（透视地面符阵 + 缓慢旋转 + 不闭合咒文弧）
 * @param {number} ts requestAnimationFrame 时间戳
 * @returns {void}
 */
function drawTitleBackground(ts) {
  const canvas = document.getElementById('titleBg');
  if (!canvas || TITLE_BG_OFF) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = titleBgRuntime.w || canvas.width;
  const h = titleBgRuntime.h || canvas.height;
  const t = Number(ts || 0) / 1000;

  TBG_SIGIL.draw(ctx, w, h, titleBgRuntime.dpr || 1, t);

  // 前景徽记：与背景共用同一帧时钟，保证两层景深同步转动
  drawTitleEmblem(ts);

  titleBgRuntime.frames += 1;
}
```

payload 的对外接口只有两个：

```js
TBG_SIGIL.draw(ctx, cssW, cssH, dpr, t)  // 画一整帧（内部自己做 setTransform / 恢复）
TBG_SIGIL.isReady()                      // 首帧初始化是否完成（验收用）
```

它自带 `dpr` 变换、尺寸变化重建、贴图/底图懒初始化（**首帧一次性 ≈6.3 ms，之后不再分配**）。

### A4 · `startTitleBackground`：`?bg=off` 不排队 rAF

锚点：`function startTitleBackground() {`（当前 54801 行）。整函数替换为：

```js
/**
 * 启动标题背景（重复调用安全；?bg=off 时直接收摊，不排队 rAF）
 * @returns {void}
 */
function startTitleBackground() {
  const canvas = resizeTitleBg();
  if (!canvas) return;
  if (TITLE_BG_OFF) {
    canvas.style.display = 'none';
    stopTitleBackground();
    return;
  }
  canvas.style.display = '';
  initTitleBackgroundLayers();
  if (titleBgRuntime.running) return;
  titleBgRuntime.running = true;
  titleBgRuntime.raf = requestAnimationFrame(titleBgLoop);
}
```

> `stopTitleBackground()` **不需要改**（当前 54786 行附近已有 `cancelAnimationFrame` + `raf = 0`）；
> `startGame()` 里原有的 `stopTitleBackground()` 调用也**不需要改**——进游戏即停表这条路本来就在，补丁只是把它列进验收项。

---

## 4. 验收（本机实测，均在补丁副本上）

测试环境：无头 Edge（`--headless=new` + SwiftShader），视口 1280×800，`devicePixelRatio = 2`（用来验证限幅），
`prefers-reduced-motion: no-preference`。被测文件：

`D:/其他/TRAE宝/奥术工程师/ui-lab/title-bg-patch/index_arcane_titlebg_preview.html`

| 验收项 | 结果 | 判定 |
|---|---|---|
| 锚点命中 | **4 / 4，各 1 次**（`stopTitleBackground` 另校验 1 次，未改） | PASS |
| dpr 限幅 | CSS 1280 → buffer **1920**（`1.5 × 1280`），`devicePixelRatio=2` 被限到 1.5 | PASS |
| 背景起跑 | `titleBgStats().running = true`，`frames` 持续增长；canvas 采样带非空（`nonzeroPct = 100%`） | PASS |
| **进游戏立刻停 rAF** | 真实流程「开始探索 → 选角色 → 以此角色开始」后：`running=false`，`frames` **4 → 4**（400 ms 后仍 4，完全冻结） | PASS |
| `?bg=off` | `getComputedStyle(titleBg).display = "none"`、`frames = 0`、`running = false`；且 `drawTitleBackground` 首行就 return，静帧路径也不画 | PASS |
| 页面异常 | `pageErrors = []` | PASS |
| 帧成本（1.5 dpr，含前景徽记） | 稳态均值 **1.01 ms / p95 1.7 ms**；徽记 0.10 ms → **背景自身 ≈0.91 ms**；已初始化后的"首帧" 0.9 ms | PASS |
| 冷初始化（贴图图集 + 底图 + 粒子） | 实验室实测 **≈6.3 ms**（热载）；冷 profile 抖动见下 | PASS（≤30 ms） |
| 平均明度 / 标题对比度 | 实盘全帧降采样：**15.7/255（6.2%）**；标题区采样带 **81.6**、更亮格子 0 | PASS |

竖屏余量：方向一竖屏实测 **0.74 / 1.4 ms**（740×1030）；本补丁按 `dpr 1.5` 后最重档（碎环 1.66 / 3.1 ms 量级）仍留一倍以上余量。

性能口径提醒：无头 SwiftShader 的**首次冷载**含浏览器画布首建税（同一份代码热载 6.3 ms，冷 profile 偶发到 40+ ms），
交付口径以"热载 6.3 ms / 稳态 1.06 ms"为准；页面内的 `frames` 在无头环境会被合成器降频（18–45 fps），真机 60 fps 下增量约 **6%** 单帧预算。

---

## 5. 贴前/贴后自查清单（照做）

1. 回读字节 + MD5，与第 1 节比对（或记下当前值）；
2. 按 A1→A4 顺序贴（A3 的 payload 与函数必须成对出现，别只插 payload 不换函数）；
3. 全局搜索一次 `function drawTitleBackground(`，确认**只有一处**；
4. 搜 `TBG_SIGIL.draw(`，确认只有新函数里那一处调用；
5. 打开页面（正常 URL）：标题页应看到地面透视的双层符阵（外刻度环 + 紫青断弧 + 中心漏光），
   标题/按钮/难度卡位置与之前**完全一致**；
6. 打开 `?bg=off`：背景完全消失（只剩标题层底色），标题页功能正常；
7. 点「开始探索 → 选角色 → 以此角色开始」：进战斗后再看 DevTools Performance 或 `titleBgStats()`，
   `running=false`、`raf=0`、`frames` 不再增长；
8. 窗口缩放一次 + 切一次高 DPI 屏，确认不糊、不闪、无水平接缝；
9. 回读最终字节 + MD5，记入交付说明。

---

## 6. 不要做的事（与 B 方案的分界线）

- 不改 `h1.title-wordmark` / `.title-kicker` / `.title-tagline` 的位置、字号、字距；
- 不改任何 `button`、`.btn`、`.difficulty-*`、`.title-stat` 的结构与样式；
- 不改 `#titleLayer` 的 `background`、`z-index`、`mix-blend-mode`；
- 不删旧背景代码（`buildTitleSceneB` / `drawTitleSceneB` / `titleSceneB` / `stars` / `dust` 系列）——
  它们在本补丁后是**死代码**，删掉会把 diff 撑到几千行、和 B 方案大规模重叠；留待后续单独清理；
- `titleBgStats()` 仍会报 `rings / particles / stars / silhouette` 等旧字段（兼容保留），
  新增的验收字段只有 `running / frames / w / h`，**不要**改这个调试对象的结构。

---

## 7. 回滚

按相反顺序还原四处锚点即可（A3 记得把 payload 整块删掉）。若只是临时看效果，不必回滚：`?bg=off` 即可整层关闭。

---

## 8. 附件（同目录）

| 文件 | 说明 |
|---|---|
| `tbg-sigil.payload.js` | A3 插入的 payload（19,079 B，自包含，零外链/零 base64） |
| `index_arcane_titlebg_preview.html` | 已贴好的副本（2,852,390 B / 55A9AB99…），可直接双击对比、也可交给 QA |
| `patch-report.json` | 本次落地的字节 / MD5 / 锚点命中 / payload 体积 |
| `anchors.json` | 四个锚点的机器可读定义（函数名 + 匹配方式 + 预期命中数） |
| `HANDOFF_TO_MERGE.md` | **交给整合线的操作台本**（四件合并顺序、贴前回读 MD5、验收命令） |
| `apply-titlebg.mjs` | 可复现的落地脚本：默认 dry-run 只报预测，`--write` 才写并回读校验 |
| `shots/title-bg-on-1280x800-dpr2.png` | 实盘标题页（1280×800 dpr2，新背景 + B 方案排版） |
| `shots/title-bg-off-1280x800.png` | `?bg=off` 兜底态 |

---

## 9. 面板让位：本轮调参与结论

### 9.1 调好的两个旋钮（最终值）

| 旋钮 | 位置 | 初版 | 建议值 | **最终值** |
|---|---|---|---|---|
| `s1.horizon` | `bg-lab.html` → `computeGeo()` → `s1` | 0.30 | 0.34 | **0.38** |
| 外环 α | `bg-lab.html` → `drawSigil()` 5.3 `floorCircle(S.rOut, 0, 220, …)` | 0.34 | 0.28 | **0.28**（维持） |

**为什么最终是 0.38 而不是 0.34**：`projFloor` 的远点是 `y = h × (horizon + camH × k)`，
`k = 1/(baseZ + rOut) = 1/(1.05 + 0.6048) = 0.604`，代入 1280×800：

- `horizon = 0.34` → 远弧顶 `800 × (0.34 + 0.30×0.604) = 417 px`；难度/天赋面板底边在 `425 px`，**还差 8 px 没出界**；
- `horizon = 0.38` → 远弧顶 `444 px`，越过面板底 **19 px**；外圈大弧（`rOut×1.10`）远点 `436 px`，仍有 **11 px** 余量。

实盘截图（`shots/title-bg-on-1280x800-dpr2.png`，1280×800 @ dpr2）确认：
**难度面板与永久天赋面板内部已无弧线穿过**，面板文字区只剩底图底色与中心漏光。

### 9.2 仍未完全干净的地方（如实记录）

`0.43h` 以下的 UI（`背景动效 / 声音` 开关行、`打开天赋页` 按钮、挑战网格、`天赋/图鉴/存档槽` 行）
**仍有弧线穿过**。原因是几何性的：下半屏 UI 从 `285 px` 一直铺到 `645 px`，
而符阵是"铺在地面上的一整圈"，它的远弧-近弧在屏幕上就从 `444 px` 一直扫到屏外，
中间没有任何一条横向空白带可以躲。可选方向（本补丁**都没有做**，因为超出背景层职责）：

1. **继续下移**（`horizon ≥ 0.50`）：弧带整体压到 540 px 以下，但符阵会只剩屏幕最底部一条窄弧，会失去"地面符阵"的主体感；
2. **UI 背板做实**（推荐，属层级/布局线）：把这几块面板的 `background` 不透明度抬 3–5%，
   弧在背后自然被压没。这是"面板盖住地面"的正确层级关系，**背景层不该反过来给 UI 让位**；
3. 背景层加"UI 安全带"（`0.43h–0.84h` 纵向渐隐）：会同时削掉符阵中段的存在感，不建议在合并版里用。

### 9.3 其它遗留

1. `titleBgStats()` 的旧字段不再有实际含义（`rings=2 / particles=48 / stars=44` 是旧场景留下的）；
2. 竖屏下符阵会被裁到屏幕下半，这是透视设计的预期（近端出画），不是 bug；
3. 冷 profile 的首次画布初始化存在 6–40 ms 抖动（浏览器侧），真机 GPU 下不可复现。
