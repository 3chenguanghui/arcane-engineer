# 全局异常兜底补丁 · GLOBAL_GUARD_PATCH

- 状态：补丁就绪（主文件只读，**未落地**）
- 载体：`tools/arcane_guard.js` 中的 `SEGMENT_A / SEGMENT_B / SEGMENT_C / SEGMENT_D`（唯一真源）
- 实测：`node tools/arcane_guard.js` → **17/17 PASS**
- 全局开关：URL 追加 `?guard=off` 可整体停用（B/C/D 调用自动空转，不需改文件）

## 0. 主文件指纹口径（先说明差异）

| 口径 | 字节 | MD5 |
|---|---|---|
| 你给出的 | 2,716,347 B | `539781FE…` |
| 本轮实测（2026-11-08 21:55） | 2,755,687 B | `96C942621E7FBC3ADC9D8FA102BFB7EF` |

主文件在本轮期间被其它线连续写入（2,730,626 → 2,740,252 → 2,749,440 → 2,754,346 → 2,755,687 B）。
因此补丁**全程使用代码锚点、不使用行号**；落地脚本会逐段校验锚点唯一命中，命中数 ≠ 1 直接停手报错。

## 1. 为什么现有兜底仍会白屏（定位结论）

1. 渲染循环的异常在 `loop` 内部被 `try/catch` 吃掉，**不会触发 `window.onerror`**，只走 `noteLoopError → triggerCrash`。
2. 旧 `#crashOverlay` 是静态 DOM，恢复/提示依赖 `showToast`、`saveRunSlot` 等游戏函数；一旦初始化未完成或这些函数自己抛错，面板也一起失效 → 双重白屏。
3. 游戏自带 error 监听把“资源缺失”当普通错误（`event.error` 为空）→ `triggerCrash(undefined)` → 只显示 `unknown`，并把游戏 halt。
4. 存档 JSON 损坏只在标题页留一行提示，没有可见面板、没有解析原因与备份位置。
5. 旧面板没有“刷新页面”“清空存档（说明会丢什么）”，也不能关闭回到标题页。

## 2. 补丁四段

| 段 | 锚点 | 作用 | 单独回滚 |
|---|---|---|---|
| A | `<body>` 之后 | 插入零依赖应急面板 `<script>`（最先注册，启动期异常也能兜） | 删除该 `<script>` 块 |
| B | `triggerCrash` 收尾三行：`writeCrashFlag(info); showCrashOverlay(info); return true;` | 循环内错误上报真实摘要 + 堆栈 + 楼层/槽 | 还原为原三行 |
| C | `loadMeta` 降级提示行：`metaLoadNotice = '存档已损坏…';` | 坏档上报解析错误、原文长度、备份键、不覆盖策略 | 删除插入块 |
| D | `init` 内 `window.addEventListener('error', …)` | 资源缺失分流到应急面板，不再误判成渲染崩溃 | 还原原监听 |

A 段实现要点：

- 面板 DOM 在**捕获时现场创建**并 `appendChild` 到 `body` 末尾；全部内联样式，不读任何静态 DOM/CSS/canvas。
- 面板自身任一步失败 → `window.alert` 显示真实摘要，**绝不静默吞错**；同时 `console.error('[arcane-guard]', …)` 留痕。
- 捕获 `error`（capture=true，才能收到 `<script>/<img>/<link>/<audio>` 加载失败）与 `unhandledrejection`。
- 资源错误会显示标签 + `decodeURI` 后的真实地址，不会出现 `unknown`。

## 3. 面板内容与交互

- “游戏遇到了问题” + 一句人话（已暂停，避免继续损坏进度）。
- 真实错误摘要（最多 320 字）+ 类型（渲染循环/资源加载/未处理异步/存档读取/脚本错误）+ 时间 + 楼层/存档槽。
- “技术细节”可展开：完整堆栈（截断 6000 字）。
- 按钮：`刷新页面`、`复制错误信息`、`读取最近存档（槽 N）`（仅存在可读槽时显示）、`关闭并回到标题页`。
- 清档路径：第一次点“仍然不行 · 清空存档”只展开二次确认，并写明会丢——
  结晶、永久天赋等级、最佳楼层、局数与累计统计、已解锁成就、已读剧情、本局三个存档槽；
  **保留**音量/画质等本机设置与 `*.broken.*` 损坏备份。
- 复制三级兜底：Clipboard API → `execCommand('copy')` → 面板内文本域自动选中并提示 `Ctrl+C`。
- 关闭顺序：`crashState.halted=false` → `returnToTitleFromRun()` → 兜底 `setTitleVisible(true)` → 再不行 `location.reload()`，不会死锁。
- Esc 也可关闭。

## 4. 与旧崩溃面板的兼容策略

- 旧 `#crashOverlay` 保持 `hidden=false`（`tools/arcane_crash.js` 的 C1–C9 判据不变），仅设 `visibility:hidden; pointer-events:none` 视觉让位，避免两个面板叠在一起。
- 关闭应急面板时把旧面板 `hidden=true` 收起。
- “读取最近存档”复用 `crashRestore()`，原有恢复能力不丢。

## 5. 实测结果

`node tools/arcane_guard.js`（只读主文件 → 生成 `.guardtest/` 副本 → 无头 Edge 实测 → 删除副本）

| 用例 | 结果 | 关键证据 |
|---|---|---|
| G0 启动自检 | PASS | `__arcaneGuard` 已注册；无错误；面板未提前出现；旧面板默认隐藏 |
| G1 ①渲染循环抛错 | PASS | 摘要 `Error: simulated crash (debug)`；`第 3 层 · 存档槽 1`；堆栈命中 `loop` |
| G1b 旧机制兼容 | PASS | 旧面板 `hidden=false`、`visibility=hidden` |
| G1c 面板独立性 | PASS | 面板是 `body` 末尾最后一个元素；无 canvas |
| G1d 丢失清单 | PASS | 面板正文含 结晶 / 最佳楼层 / 成就 |
| G2 复制错误信息 | PASS | 复制文本含 类型+摘要+楼层+槽+堆栈；反馈“已选中…Ctrl+C” |
| G3 关闭回标题 | PASS | `mode=title`、`halted=false`、旧面板收起、标题层可见 |
| G4 ②资源缺失 | PASS | 摘要 `资源加载失败：<script> …/__missing_asset_guard_test__.js`，中文路径已解码，无 unknown |
| G4b 不误判崩溃 | PASS | `halted=false`，旧面板保持隐藏 |
| G5 `window` 脚本错误 | PASS | 摘要 `window-onerror-测试` |
| G5b `unhandledrejection` | PASS | 摘要 `guard-rejection-测试` |
| G6 ③存档 JSON 损坏 | PASS | 摘要“存档数据损坏（JSON 解析失败）”；细节含解析错误、14 字符、备份键 |
| G6b 坏档保护 | PASS | 原键仍为 `{broken-json::`；生成 1 个 `*.broken.*`；`metaFallbackClean=true` |
| G6c 坏档不白屏 | PASS | 正常进入标题页，保留原“存档已损坏”提示 |
| G7 清档二次确认 | PASS | 首次点击仅展开确认，写明丢失清单 |
| G7b 清档结果 | PASS | 永久档归零、槽 `null`、音量保留、损坏备份保留、回标题 |
| G8 独立性（删旧面板） | PASS | 移除 `#crashOverlay` 后仍能弹面板并显示真实摘要 |

截图（`.screenshots/art/`）：

- `guard-1-render-loop.png`（故障①）
- `guard-2-resource-missing.png`（故障②）
- `guard-3-save-corrupt.png`（故障③）
- `guard-4-wipe-confirm.png`（清档二次确认）
- `guard-0-independent.png`（删掉旧面板后的独立性）
- `guard-result.json`（断言明细）

## 6. 落地步骤

1. `node tools/arcane_guard.js --emit` → 生成 `.guardtest/index_guard_test.html`（不跑测试）用于 diff 核对。
2. 由有写权限的线按上表 A/B/C/D 四段落主文件。
3. `node tools/arcane_guard.js` 复验 17/17。
4. 主文件落地后建议再跑一次既有 `node tools/arcane_crash.js`（其路径硬编码主文件，未落地前无法验证补丁版本），预期 C1–C9 不变。
5. `.guardtest/` 副本用完即删。

## 7. 已知边界

- A 段会拦截所有 window 级错误，非致命脚本错误也会弹面板；需要整体关闭时用 `?guard=off`。
- 坏档首启即弹面板是有意为之（满足“坏档必须可见”）；关闭后正常进入标题页。
- 清档只删 `meta / run_slots / crash flag` 三键；清档后首次启动会写回一份默认档，属正常行为。
- 未改动 `tools/arcane_crash.js`；若未来彻底下线旧面板，需要同步改它的 C3/C5/C6/C8 选择器。
- 主文件仍被其它线写入，落地前以现场 MD5 为准；锚点不匹配时脚本会直接报错停手。
