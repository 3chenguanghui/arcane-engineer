# 手机真实版面回归报告（烬 / 奥术工程师）

> 状态：**静态风险清单已就绪，实测数据待补**（浏览器测量窗口尚未开启，遵守"20 分钟内不启动 headless"的约定）

## 0. 口径与版本

| 项 | 值 |
|---|---|
| 主文件 | `index_arcane_v2.html` |
| 测量用快照 | `_mobile_probe_snapshot.html`（由主文件一次性读入内存后落盘，MD5 与主文件逐字节一致） |
| 快照字节 / MD5 | 2,823,416 B / `8A9F190F83E1CE6E023ACB7D8FE270A0`（主文件在测量准备期间被写权线改过一次：2,814,262 B → 2,823,416 B，本报告以快照值锁定） |
| 视口 | 375×667 / 390×844 / 412×915，DPR 3，`mobile=true`，`touch` 模拟 5 点 |
| 尺寸口径 | 全部为 **CSS px**（DPR 只影响截图分辨率 1125×2001 / 1170×2532 / 1236×2745，不影响布局） |
| 安全区口径 | 无头浏览器的 `env(safe-area-inset-*)` 恒为 0，故采用机型模型：375→上20/下0；390→上47/下34；412→上24/下24 |
| 工具 | `tools/mobile_layout_probe.js`（只读，不写主文件；单实例 Edge；JPEG q85；有问题的档才留图） |

## 1. 每项怎么量

| 测量项 | 方法 | 输出字段 |
|---|---|---|
| HUD 是否超出安全区 | 每个 HUD 块 `getBoundingClientRect()`，与机型安全区模型逐边求差；同时记录 `right - innerWidth` / `bottom - innerHeight` 越界值 | `overRight / overLeft / overBottom`，单位 px |
| 是否互相压盖 | 可见块两两求矩形交集；DOM 父子关系跳过（父子不算压盖）；另对容器做"子元素越出父框"扫描 | `overlaps[]`：a、b、交集宽、高、面积 |
| 可点区域是否 <44×44 | 枚举 `button/a/input/[role=button]/[tabindex]/.mini-card/.char-card/.dock-btn`，过滤 `display/visibility/opacity/pointer-events`，取矩形宽高 | `taps.tooSmall[]`：元素名、文本、w、h；并给 `minSide` |
| 文字截断 / 溢出 | 遍历文本节点（Range 实测文本行矩形），对比最近非 inline 父级的**内容盒**右/下边界，>1.5px 记一条；同时记录父级 `overflow-x` 与 `text-overflow` | `textFails[]`：节点名、文本、右溢 px、下溢 px、字号、是否 ellipsis |
| 战斗区被 UI 吃掉多少 | 取所有可见 HUD 块的矩形做**精确并集**（y 扫面带 x 区间合并，非网格量化），再取视口 20%–80% 中心区做同样并集 | `coverage.uiPct / centerPct / byBlockArea` |
| 修复代价 | 不落盘，用注入 `<style>` 的变体量同一套指标：v1 `--fs-xs:12px`；v2 顶栏按钮 44×44 纯图标；v3 手机顶栏重排（品牌自适应 + 读数独占一行） | `runs[].summary.*` 差值 |

> 环境纪律：`envGuard()` 在 CPU ≥ 60% 或已存在 ≥2 个 msedge 时拒绝出数（退出码 3）。进入战斗失败按 **ENV_UNSTABLE** 记录并重试一次，不记为版面 FAIL。

## 2. 静态风险清单（读代码得出，等待实测逐条确认/否决）

| # | 元素 | 样式位置 | 窄屏风险（假设） | 需实测的判据 |
|---|---|---|---|---|
| S1 | `.hud-deck` 骨架 | `index_arcane_v2.html#L657-L660`（`body.hud-compact .hud-deck` 三列 `1fr 1fr 168px`）覆盖 `#L3969`（`@media 760px` 单列）；特异性 0,2,1 > 0,1,0 | 375 下仍为三列：卡组两列各约 69px，6 张密集卡每张仅约 6–7px 宽 | deck 实际列宽、`.mini-card` 宽高、是否 <44 |
| S2 | `.hud-readouts` 双血条 | `#L5220`（width 172px）+ `#L4217`（`.bar-group{width:100%}`）+ `#L4231-L4235`（窄屏改 row） | 两根 100% 血条并排塞进 150px 内宽 → 内容右溢约 150px，压到右侧按钮 | 读数块内容溢出 px、与 actions 的交集 |
| S3 | `.brand` 品牌块 | `#L5201` width 176px；`#L3949` min-width 150px | 占 375 屏宽 47%，且不收缩，挤掉读数与按钮 | brand 实际宽、与 readouts 的交集 |
| S4 | `.hud-actions` 5 按钮 | `#L5203` 高 30px、`#L5261` padding 8px 12px；`#L4197` margin-left:auto | 5 个带文字按钮总宽约 380px > 375−32；高度 30 < 44 | 顶栏内容右溢 px、按钮 w×h 清单 |
| S5 | `header.hud-top` 安全区 | `#L5200` + `#L5290` padding 12/16/16；全文件唯一 `env()` 在 `#L2741`（奖励弹窗） | HUD 完全不吃 safe-area：390 刘海 47px，顶栏内容从 12px 开始 → 压进刘海 35px | 顶栏首个子元素 top 与安全区差值 |
| S6 | 两个 dock 按钮 | `#L697-L698` 54×54；`#btnMapDock`/`#btnSkillDock` `bottom:96px`（`#L736-L737` 附近） | 底部 deck 高度若 >96px，dock 按钮浮在卡组上 | dock 与 deck 交集（宽×高×面积） |
| S7 | `#introHint` 首次提示 | `#L747` top 68px；`#L768-L769` 关闭按钮 22×22；`#L764` 标题 nowrap | 关闭按钮 22×22 点不到；顶栏压盖；375 下 78vw=292px 可能截断标题 | 关闭按钮 w×h、提示条与顶栏/toast 交集、文本溢出 px |
| S8 | `.toast` / `.spirit-line` / `.onboard-hint` | `#L1361` top 104；`#L1391` top 152；`#L1420` top 64 + `#L1441` right 10 / max 132px | 三条浮动信息在 375 上相互贴边；onboard 与顶栏右下按钮压盖 | 两两交集 + 文本溢出 |
| S9 | 卡名/键位小字 | `#L5325` 实测生效：`body.hud-compact .card-row.is-dense .m-name{font-size:var(--fs-xs)}`（覆盖 `#L664` 的 9.5px）；`#L866` m-key 8.5px；`#L854-L861` nowrap+ellipsis | 卡片被压窄后卡名必然省略号截断；m-name 实际取 11px，改 12px 会加重截断 | 截断文本条数、字号分布 |
| S10 | `--fs-xs: 11px` | `#L46`；全文件 `var(--fs-xs)` 出现 **91 处**（不是 88 处） | 可见 11px 文本元素数、改 12px 后的宽度增量 | v1 变体：顶栏越界变化、deck 高度变化、占屏变化 |
| S10b | HUD 紧凑模式默认开启 | `#L57321` `HUD_MODE_CONFIG = { compact: true, minimal: false }` | S1/S2 的紧凑规则是三档手机视口的"真实生效态"，不能用桌面宽度自测 | 测量结果 `hudMode` 字段
| S11 | 小地图/楼层面板 | `#L3972` `.minimap-panel{display:none}`（≤760）；`#L3960` `.floor-panel{display:none}`（≤1120） | 三档视口应全部隐藏；若仍可见即级联失效 | 三档是否 visible=false |
| S12 | 底部侧栏 | `#L3954` deck-side 跨列；`#L3955` fusion min-width 260；`#L3956` skill-pair 300px | 375 单列下两行堆叠，deck 高度抬高，进一步压战斗区 | deck 顶边 y、deck 高度、占屏比 |
| S13 | 超载条 | `.overdrive-bar` bottom 112 / `.dual-bar` bottom 96（`#L4287` 附近） | 与底部 deck 区重叠 | 与 deck 的交集 |
| S14 | 窄屏奖励条 | `#L2741` 已吃安全区；`#L3976-L3979` 奖励条 3 列 | 唯一吃安全区的地方，作为"正确样板"对照 | 弹窗模式下不测，仅记录 |

## 3. 实测结果（待填）

### 3.1 三档基线（v0）

| 视口 | 顶栏右越界 | 压盖对数 | <44px 可点数 | 文字溢出条数 | UI 占屏 | 中心 20–80% 占屏 | 截图 |
|---|---|---|---|---|---|---|---|
| 375×667 | | | | | | | |
| 390×844 | | | | | | | |
| 412×915 | | | | | | | |

### 3.2 变体代价（用于修复方案定价）

| 变体 | 375 顶栏右越界 | 375 顶栏高 | actions 宽 | readouts 宽 | deck 高 | 占屏 | <44px 个数 |
|---|---|---|---|---|---|---|---|
| v0 基线 | | | | | | | |
| v1 `--fs-xs:12px` | | | | | | | |
| v2 顶栏按钮 44×44 图标化 | | | | | | | |
| v3 手机顶栏重排 | | | | | | | |

### 3.3 环境记录

| 项 | 值 |
|---|---|
| 跑前 CPU / msedge 数 | （envGuard 输出） |
| 是否 ENV_UNSTABLE | |
| 实例数 | 1（串行跑完即关） |

## 4. 问题清单（每条：元素 · 视口 · 像素数）

> 只写可复现的量，不写"偏挤/略小"。待实测填入。

| ID | 元素 | 视口 | 现象 | 具体像素 |
|---|---|---|---|---|
| | | | | |

## 5. 修复方案

### 5.1 必须改（影响可玩性/命中率）

| ID | 改动 | 落点（补丁锚点） | 代价（实测） |
|---|---|---|---|
| | | | |

### 5.2 可接受（体验优化，不影响可玩）

| ID | 改动 | 落点 | 代价 |
|---|---|---|---|
| | | | |

### 5.3 不建议做

| 方案 | 原因 |
|---|---|
| 全局把 `--fs-xs` 从 11px 改 12px | 全站生效，实测宽度/高度增量见 3.2 v1；只应作为"必须改"的备选而非首选 |

## 6. 复现命令

```powershell
# 主文件快照（一次性读入内存，保证不撕裂）
$f="D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html"
$b=[System.IO.File]::ReadAllBytes($f)
[System.IO.File]::WriteAllBytes("D:\其他\TRAE宝\奥术工程师\_mobile_probe_snapshot.html",$b)

# 测量（自动做环境守卫；干净窗口才出数）
node "D:\其他\TRAE宝\奥术工程师\tools\mobile_layout_probe.js"
```
