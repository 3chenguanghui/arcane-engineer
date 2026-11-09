# Tasks · 首屏 A + B 落地

- [x] **T1 锚点核对（前置闸门）**
  对 `.optim/snapshot_C.html` 跑 `.optim/final_check.mjs` 的 53 条锚点（**51/53 = 1**；2 条与本批无关：`<script>` 命中 4 是存在性伪锚点、附录 CSS `.readout-floor > b` 命中 0 是文档漂移，已写入文档 §10.4）；本轮 6 条补丁锚点由 `apply_patch_AB.mjs` 逐条打印，**全部命中 = 1**。

- [x] **T2 生成补丁副本**
  `snapshot_C.html` → `.optim/copy_AB.html`，由 `.optim/apply_patch_AB.mjs` 精确替换 A-1～A-4、B-1～B-3。
  **踩坑修正**：初版用 `playSceneFade`，被 `revealRoom` 的 `0.18s 'room'` 转场抢走 token → 烘焙丢失 + `transitionLock` 锁死；改为 z-index 93 独立遮罩 `#bootBakeVeil`。

- [x] **T3 功能验证（浏览器）**
  标题页：`pending=true`、`sceneCanvas=null`、`parallax/sceneProps(7 数组)/sceneArt` 默认值齐全、`__errors=[]`。
  点"开始探索"后：`mode=playing`、`transitionLock` 已释放、`sceneCanvas` 已烘焙、遮罩已移除、标题已隐藏、地板/装饰正常、`__errors=[]`。

- [x] **T4 分段计时验证（N=8 有效轮，同进程交替，串行，取最小值）**
  结果见补丁文档 §10.3；每轮同时记录 msedge 进程数与 CPU（37%–84%、20–44 个）。R6 pre / R9 post CDP 超时已如实记录。

- [x] **T5 更新补丁文档**
  `PATCH_v1.7.1_FIRSTPAINT.md` 新增 §10：A/B 补丁原文（含命中数）、独立遮罩原因、默认值清单、签名保留证据、两个体验数、配对实测表、锚点诚实记录、回滚。

- [x] **T6 回报**
  A：init 内该段结构性移除（"未测（不执行）"），`generateFloor` 段 min 57.9 → 13.1；B：`updateHUD` min 8.2 → 0.6，8/8 轮 ≤5 达标；体验① 172.9 → 98.7，体验② 29.6 → 326.1（烘焙全落黑场，最坏一轮 1,058.5 仍被遮罩盖住）。

- [x] **T7 独立开关 + 一行回退（父会话追加要求）**
  新增 A-0：`const PERF = { deferBake, hudInitSlim }`，支持 `?perfA=0&perfB=1` URL 覆盖；A-1/A-3 读 `PERF.deferBake`，B-3 读 `PERF.hudInitSlim`。
  `.optim/test_switches.mjs` 串行验 4 种组合：`1&1`（标题页未烘焙、hud 无动画类）/ `0&1`（启动即烘焙）/ `1&0`（hud 有 `is-scan`）/ `0&0`——四种都能点开始走、无残留遮罩、无锁、无报错；默认档进游戏改数值仍 `is-scan is-hot` 0.42s。
  补丁锚点由 6 条增至 **13 条，全部命中 = 1**；文档 §10.0 / §10.5 / §10.6 已写入开关、单测表、一行回退与"实测 vs 推算"标注。

- [x] **T8 黑场不能是死黑（父会话第 4 轮要求 1）**
  `#bootBakeVeil` 改为**径向渐变雾面**（中心 `rgba(40,86,104,.55)`、外圈 `#050910`）+ **品牌符阵 SVG 淡入**（`bbGlyphIn .42s`，之后 `bbSpin 16s linear infinite`）+ 一行 `正在进入…`。
  `prefers-reduced-motion: reduce` 分支：不做渐变/旋转，但保留符阵与提示。
  证据见 §10.5.1：`no-preference` 350 ms `glyph 0.822`、`spin bbSpin`；遮罩底色实测为 `radial-gradient(...)`。

- [x] **T9 超过 0.6 s 出进度提示（父会话第 4 轮要求 2）**
  用**纯 CSS 延迟**而不是 JS 定时器：`#bootBakeVeil.is-in #bootBakeHint{animation:bbHintIn .30s ease-out .60s forwards}`——烘焙阻塞主线程时 JS 定时器排不上，CSS 动画走合成器。
  `reduce` 分支写成 `animation:bbHintIn 0s ease-out .60s forwards`（只去掉渐变，**不取消 0.6 s 延迟**）。
  证据：两分支 `350 ms hint = 0`、`1000 ms hint = 1`（§10.5.1）。

- [x] **T10 同条件复测 ①②并更新文档（父会话第 4 轮要求 3）**
  `probe_AB.mjs` 7 对有效配对（9 轮里 2 轮超时作废），CPU 18%–76%、msedge 20–38：
  ① 214.4 → **156.4**（min）；② 21.7 → **404.4**（min，常态 0.40 s、中位 0.51 s）。
  遮罩内真实烘焙 55.3 ms；7/7 轮背景非纯黑，6/7 轮 `opacity = 1.000` 后才烘焙、1/7 轮由 `is-solid` 兜底。
  §10.3 已整节重写为"加入过渡视觉之后"的读数；§10.5.1 已补视觉证据。

- [ ] **T11 等整合线报"密度复核结束"后再贴（硬闸门，父会话明确要求）**
  **禁止现在向 `index_arcane_v2.html` 写入**。等整合线完成"密度复核 + 标题页四件"后，以**最新主文件**为源重跑 `node .optim/apply_patch_AB.mjs`，**13 条锚点任一 ≠1 就停**并重新定位。
  漂移参考：快照 2,833,891 B → 2026-11-09 07:45 主文件 2,868,107 B（仍在增长，贴前必须现场复核）。

