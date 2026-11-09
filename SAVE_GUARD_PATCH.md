# SAVE GUARD · 存档安全修复补丁

> 交付对象：写权线（本文件只给补丁，不改主文件）
> 目标文件：`D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html`
> 代码基线（补丁在该快照上实测；本文行号也取这一份）：
> **2,812,871 字节 / 65,508 行（LF 换行、无 BOM）/ MD5 `8FF34DFF349A161FBBE0E4CD7A5271C8` / mtime 2026-11-08 22:46:02**
>
> **主文件正在被其他线持续修改（实测 22:37:25 → 22:42:36 → 22:46:02 三小时段内变了两次）。** 我在 3 个不同快照上复跑同一套补丁，逐段字节增量完全一致（见 §四），但**行号会漂**——贴补丁请只用函数名/唯一语句做锚点。
> 定位方法：对主文件做单快照读入（一次 ReadAllBytes 同时取字节数与 MD5），只读静态核对 + 抓取真实函数原文。**未开浏览器、未改主文件。**

---

## 一、定位结论（当前代码的实测事实）

### 事实 1 · R1「坏档启动即被覆盖」**已被部分修复**

- 备份逻辑已存在：[loadMeta()](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L17846) 的 `catch` 分支（L17868-L17904）会：
  1. 把原始文本另存为 `arcane_rogue_meta.broken.<毫秒时间戳>`（L17875）；
  2. 置 `metaFallbackClean = true`（L17880）；
  3. 文案改为"存档已损坏，已按默认存档继续（原档已备份，本次不写档）"（L17881）。
- 启动写档已加条件：[L65489](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L65489) `if (!metaFallbackClean) saveMeta();`
- [saveMeta()](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L17914) 首行 `if (metaFallbackClean || metaExternalChanged) return;`（L17915），配额重试也已落地（L17920-L17934）。

**仍然缺的（本次要补的）：**
| 缺口 | 事实 |
|---|---|
| G1 无"写前快照" | 正常写档路径从不留旧副本；磁盘上只有一份当前 meta。新档一旦写坏（半截文本 / 玩家误清档 / 回滚需求），没有任何可用回滚点。 |
| G2 坏档会话无限期只读 | 一旦 `metaFallbackClean=true`，本会话所有永久进度（结晶/天赋/成就）都不落盘，玩家只看到启动时一条 1.6 秒 toast（[L55189-L55191](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L55189-L55191)），继续玩数小时全部白玩，且**没有任何界面告知"现在是只读"**。 |
| G3 备份无上限、无列表 | `.broken.*` 键只增不减，没有数量上限，也没有任何 UI 能列出/导出。 |
| G4 无恢复入口 | 设置页只有"清空存档"（[L6638](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L6638)）。崩溃面板的"读取最近存档"走的是**局内槽**（`crashRestore`），不是 meta 备份。 |

### 事实 2 · R2「多标签页互相覆盖」**只做了事后止损，未做写权**

- 监听器存在：`window.addEventListener('storage', ...)`（[L17940](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L17940)），命中后置 `metaExternalChanged = true` 并 toast。
- 写前拦截存在：`saveMeta()` 首行 `metaExternalChanged` 直接 return。

**仍然缺的（本次要补的）：**
| 缺口 | 事实 |
|---|---|
| G5 不是锁，只是"事后认输" | 两个标签页在事件到达前都可以各写一次；**第一笔覆盖已经发生**，监听器只能在事后停写。没有 owner / 没有心跳 / 没有 TTL。 |
| G6 被抢一方静默丢进度 | 被抢后本页 `saveMeta` 全部静默 return（L17915），界面无任何常驻标识，玩家以为在正常存档。统计意义上仍是"静默覆盖"。 |
| G7 局内槽完全没保护 | 监听器只判断 `GAME_CONFIG.metaKey`，不判断 `arcane_run_slots_v1`。两页都点"继续"同一个槽时，`pagehide` / `visibilitychange` 各自写槽（[L56462](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L56462)），后关页面覆盖先关页面。 |
| G8 锁无失效机制 | 若加锁但无 TTL，前一页崩溃/强杀后锁会永久占住。 |

### 事实 3 · 恢复路径**不存在**

全文件检索 `存档恢复` / `恢复` 相关实现，玩家可用的只有：
- 顶部 toast（1.6 秒，[L38472-L38476](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L38472-L38476)）；
- `__arcaneGuard` 报错面板（只报错，不带回滚）；
- 崩溃面板 `crashRestore`（只回滚局内槽，不动 meta）；
- 设置页"清空存档"（只会删，不能回）。
**没有"列出备份 → 选择 → 回滚"的入口。**

### 事实 4 · 审计文档其余条目的漂移（顺带核实，避免按旧结论改代码）

| 审计条目 | 审计结论 | 当前实测 | 结论 |
|---|---|---|---|
| R3 `motionTrail` / `regionFx` 不在白名单 | 缺失 | 已补：`defaultMeta` L17252-L17253、`normalizeMeta` L17439-L17440 | **已修复，不要再补** |
| R4 配额满静默失败 | 缺失 | 已补：`saveMeta` catch 内删最旧槽重试（L17920-L17934） | **已修复** |
| R5 `saveMeta(meta)` 传参无效 | 存在 | 仍在：[L24557](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L24557) `saveMeta(meta)`，函数声明无参 | 仍在（本次不改，避免扩大范围） |
| R7 槽位版本不符清空 3 槽 | 无备份 | 仍在：`readRunSlotStore` L51803-L51805 直接返回空库 | 仍在（本次不动槽位版本门禁，由写时备份兜底） |
| 版本号 | 1.6.1 | `GAME_CONFIG.version = '1.8.0'`（L6965） | 文档标题已过时，不影响补丁 |

---

## 二、方案设计

三层结构，全部收在一个自包含模块 `SaveGuard` 里，**不改存档字段、不改 schema 版本、不改任何玩法数值**。

```
                    ┌─────────────────────────────┐
  启动 boot()  ───► │ 1) 抢写权锁（localStorage）  │──失败──► 只读模式 + 常驻横幅
                    │    心跳 4s 续期，TTL 15s     │          （停止一切 meta/槽写入）
                    └──────────────┬──────────────┘
                                   │成功
                    ┌──────────────▼──────────────┐
  每次写档    ───► │ 2) 旧档留副本 .bak.<时间戳>  │──配额失败──► 跳过备份，正写继续
                    │    内容相同不重复留，留 3 份 │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
  玩家点恢复  ───► │ 3) 校验 JSON → 当前档存副本  │──► 写回 → 刷新
                    └─────────────────────────────┘
```

### 2.1 写前校验 / 写前快照

- 触发点：`saveMeta()` 真正 `setItem` 之前。
- 内容：读 `localStorage[metaKey]` 的**旧文本**，原样写入 `arcane_rogue_meta.bak.<Date.now()>`。
- 去重：与上次备份的文本完全一致就跳过（避免每次改设置都刷一份）。
- 上限：只留最近 3 份；单份 >512 KB 不备份（正常 meta 实测 3–20 KB，见审计 §6）。
- 配额失败：**备份失败绝不阻断正写**（正写比备份重要），静默跳过。
- 坏档：`.broken.*` 保留最近 5 份，超过的在启动时清理最旧；**启动时永不当场删除最新坏档**。

### 2.2 单标签页写权

- 锁键：`arcane.save.writer.v1`，值 `{owner, exp, at}`。
- 令牌：`sg-<36进制时间>-<随机6位>`，每次打开页面唯一。
- 抢占（无真正 CAS，用"写后回读"定胜负）：
  1. 读锁；若存在 `owner != 自己` 且 `exp > now` → 抢锁失败；
  2. 写入自己的锁，回读；`owner` 是自己 → 成功；被别人覆盖 → 失败。
- 心跳：每 4s 续期到 `now + 15000`。发现锁被他人持有 → 立即降级只读。
- 失效：15s 无心跳视为死锁，其他标签页可接管（解决强杀/崩溃）。
- 失败处置：**只读 + 顶部常驻横幅**（不是 toast）：`只读模式：另一个标签页正在使用存档。本页的永久进度不会保存。`，附 [重试写入] [重新载入] 两个按钮。另一个标签页关掉后点"重试写入"即可原地恢复写权。
- 覆盖范围：`saveMeta()` 与 `writeRunSlotStore()` 两条写路径都受控（G7）。
- 兼容：URL 加 `?saveguard=off` 完全回到 v1.8.0 现有行为（便于 A/B 与出问题回退）。

### 2.3 恢复路径

设置页新增「存档安全 · SAVE GUARD」区（运行时注入 DOM，不改 HTML 结构）：
- 状态：`写权正常 / 只读（不写档）`；
- 备份列表：时间 + 体积 + [恢复到这份]（两次点击确认，3 秒自动复位，与"清空存档"同款交互）；
- 损坏原文列表：时间 + 体积 + [复制原文]（便于玩家手工抢救/发客服）；
- [立即备份当前档]、[刷新列表]；
- 回滚动作：先校验备份是可解析对象（数组/字符串/`null` 一律拒绝）→ 把**当前档**另存 `arcane_rogue_meta.prerestore.<时间戳>`（留 2 份）→ 写回 → 刷新页面。

---

## 三、补丁段（共 6 段，按顺序贴）

> 每段可单独回滚。全部为**插入或整函数替换**，没有行号依赖。
> 字节增量基于 2,814,262 字节基线实测（LF 换行），见 §四汇总表。

### 段 1 · init 里先拿写权（插入 2 行）

**位置**：`init()` 内，`state = createInitialState();` 之前。
**锚点原文（唯一，L65461-L65462）**：

```js
  state = createInitialState();
  // 先进入标题界面：此时不推进世界、不计入局数，等玩家点击“开始探索”
```

**插入内容（放在锚点两行的前面）**：

```js
  /* 存档安全：先抢写权再读档。抢不到 → 只读模式（不写 meta / 不写槽） */
  if (typeof SaveGuard !== 'undefined' && SaveGuard) SaveGuard.boot();
```

### 段 2 · 插入 SaveGuard 模块（大段插入）

**位置**：`init();` 调用之前、锚点 `// 页面脚本在 body 末尾，DOM 已经就绪，可以直接启动` 之前。
**锚点原文（唯一，L65501）**：

```js
// 页面脚本在 body 末尾，DOM 已经就绪，可以直接启动
```

**插入内容**：

<!-- SEG2 -->
```js
/* ============================================================
   SAVE GUARD · 存档安全（写权锁 / 写前快照 / 恢复入口）
   ------------------------------------------------------------
   为什么要有这一层（对应审计 R1/R2 的残留缺口）：
     ① 旧逻辑只有"发现别的标签页写过 → 本页停写"，是事后止损：
        第一笔覆盖已经发生，被停写的一方只有一条 1.6 秒 toast，
        之后继续玩、继续不落盘，等同静默丢档。
     ② 旧逻辑只在"读到坏 JSON"时才备份，正常写档从不留旧副本：
        新档写坏或玩家误清档后没有任何回滚点。
     ③ 玩家没有"回到上一份好档"的入口。
   本模块只做三件事，不改存档字段、不改 schema 版本、不改玩法数值：
     A. 写权锁：同一时刻只有一个标签页能写；抢不到的一律只读 + 常驻横幅。
     B. 写前快照：覆盖前把旧文本留成 arcane_rogue_meta.bak.<时间戳>。
     C. 恢复入口：设置页"存档安全"区列出备份，可一键回滚。
   关闭方式：URL 加 ?saveguard=off（回到 v1.8.0 原有止损行为）。
   ============================================================ */
var SaveGuard = (function () {
  'use strict';

  /** 配置区：所有可调参数集中在此，调参不必翻代码 */
  var CFG = {
    enabled: true,
    lockKey: 'arcane.save.writer.v1',
    lockTtlMs: 15000,                       // 锁过期：超过这个时间没心跳，别人可接管
    heartbeatMs: 4000,                      // 心跳间隔：必须明显小于 TTL
    bakPrefix: 'arcane_rogue_meta.bak.',
    brokenPrefix: 'arcane_rogue_meta.broken.',
    preRestorePrefix: 'arcane_rogue_meta.prerestore.',
    slotBakPrefix: 'arcane_run_slots_v1.bak.',
    maxBak: 3,                              // 正常备份保留份数
    maxBakBytes: 512 * 1024,                // 单份备份体积上限（正常 meta 3–20KB）
    maxBroken: 5,                           // 损坏原文保留份数
    maxPreRestore: 2,                       // 回滚前快照保留份数
    maxSlotBak: 1,                          // 局内槽备份保留份数
    slotBakMaxBytes: 256 * 1024             // 超过这个体积不做槽备份，避免自己把配额吃满
  };

  var token = '';
  var locked = false;
  var readOnly = false;
  var readOnlyReason = '';
  var heartbeatTimer = 0;
  var lastBakText = '';
  var uiReady = false;

  /** 读取 URL 上的 saveguard=off 开关 */
  function disabledByQuery() {
    try { return /[?&]saveguard=off\b/.test(window.location.search); }
    catch (e) { return false; }
  }

  /** 生成一个足够区分标签页的随机令牌 */
  function newToken() {
    return 'sg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /** 安全读 localStorage 文本；隐私模式返回 null */
  function readRaw(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  /** 安全写 localStorage 文本；返回是否成功 */
  function writeRaw(key, text) {
    try { window.localStorage.setItem(key, text); return true; } catch (e) { return false; }
  }

  /** 安全删 localStorage 键 */
  function removeRaw(key) {
    try { window.localStorage.removeItem(key); return true; } catch (e) { return false; }
  }

  /** 读锁对象；内容不合法一律当"无锁" */
  function readLock() {
    var raw = readRaw(CFG.lockKey);
    if (!raw) return null;
    try {
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      return obj;
    } catch (e) { return null; }
  }

  /** 锁是否仍被别人有效持有 */
  function heldByOther() {
    var cur = readLock();
    if (!cur || !cur.owner || cur.owner === token) return false;
    return Number(cur.exp) > Date.now();
  }

  /** 抢占写权：写自己的令牌再回读校验，回读不是自己就说明被别的页抢先 */
  function acquire() {
    if (locked) return true;
    if (heldByOther()) return false;
    var obj = { owner: token, exp: Date.now() + CFG.lockTtlMs, at: Date.now() };
    if (!writeRaw(CFG.lockKey, JSON.stringify(obj))) {
      /* 隐私模式 / 配额满：拿不到锁也不能把单人游戏锁死，退化为单页直写 */
      locked = true;
      return true;
    }
    var check = readLock();
    if (!check || check.owner !== token) return false;
    locked = true;
    return true;
  }

  /** 心跳：续期；发现锁已被别人接管则立刻降级只读 */
  function heartbeat() {
    if (!locked || readOnly) return;
    var cur = readLock();
    if (cur && cur.owner && cur.owner !== token && Number(cur.exp) > Date.now()) {
      locked = false;
      enterReadOnly('另一个标签页刚刚接管了存档写入');
      return;
    }
    writeRaw(CFG.lockKey, JSON.stringify({ owner: token, exp: Date.now() + CFG.lockTtlMs, at: Date.now() }));
  }

  /** 启动心跳 */
  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = window.setInterval(heartbeat, CFG.heartbeatMs);
  }

  /** 停止心跳 */
  function stopHeartbeat() {
    if (heartbeatTimer) { window.clearInterval(heartbeatTimer); heartbeatTimer = 0; }
  }

  /** 释放写权（只释放自己的锁，不删别人的） */
  function release() {
    var cur = readLock();
    if (cur && cur.owner === token) removeRaw(CFG.lockKey);
    locked = false;
    stopHeartbeat();
  }

  /** 按前缀列出键，按时间倒序（键名后缀就是毫秒时间戳） */
  function listByPrefix(prefix) {
    var out = [];
    try {
      for (var i = 0; i < window.localStorage.length; i += 1) {
        var key = window.localStorage.key(i);
        if (!key || key.indexOf(prefix) !== 0) continue;
        var text = readRaw(key) || '';
        out.push({ key: key, at: Number(key.slice(prefix.length)) || 0, chars: text.length, text: text });
      }
    } catch (e) { /* 隐私模式忽略 */ }
    out.sort(function (a, b) { return b.at - a.at; });
    return out;
  }

  /** 只保留最近 max 份，多余的最旧键删掉 */
  function prune(prefix, max) {
    var list = listByPrefix(prefix);
    for (var i = list.length - 1; i >= max; i -= 1) removeRaw(list[i].key);
  }

  /** 写前快照：把磁盘上的旧 meta 留成带时间戳副本；内容没变就不重复留 */
  function backupMetaBeforeWrite() {
    if (readOnly) return false;
    var text = readRaw(GAME_CONFIG.metaKey);
    if (!text || text === lastBakText) return false;
    if (text.length > CFG.maxBakBytes) return false;
    if (!writeRaw(CFG.bakPrefix + Date.now(), text)) return false;   // 备份失败不阻断正写
    lastBakText = text;
    prune(CFG.bakPrefix, CFG.maxBak);
    return true;
  }

  /** 手动留档：跳过"内容相同"去重 */
  function forceBackupMeta() {
    lastBakText = '';
    return backupMetaBeforeWrite();
  }

  /** 局内槽写前快照：体积大的直接跳过，避免备份本身把配额吃满 */
  function backupSlotStoreBeforeWrite(nextLength) {
    if (readOnly) return false;
    if (Number(nextLength) > CFG.slotBakMaxBytes) return false;
    var text = readRaw(SAVE_SLOTS_CONFIG.key);
    if (!text || text.length > CFG.slotBakMaxBytes) return false;
    if (listByPrefix(CFG.slotBakPrefix).length >= CFG.maxSlotBak) return false;
    return writeRaw(CFG.slotBakPrefix + Date.now(), text);
  }

  /** 时间戳 → HH:MM:SS */
  function fmtTime(ms) {
    try {
      var d = new Date(Number(ms) || 0);
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    } catch (e) { return '--:--:--'; }
  }

  /** 进入只读模式：停止一切写档 + 常驻横幅（不重复刷屏） */
  function enterReadOnly(reason) {
    if (readOnly) return;
    readOnly = true;
    readOnlyReason = reason || '另一标签页正在使用存档';
    stopHeartbeat();
    var box = document.getElementById('saveGuardBanner');
    var msg = document.getElementById('saveGuardBannerText');
    if (msg) msg.textContent = '只读模式：' + readOnlyReason + '。本页的永久进度不会保存。';
    if (box) box.style.display = 'flex';
    showToast('已转为只读：' + readOnlyReason, 'warn');
    renderPanel();
  }

  /** 重试拿写权（另一标签页关掉后玩家可原地恢复，不必刷新） */
  function retryLock() {
    if (locked) return true;
    readOnly = false;
    readOnlyReason = '';
    if (acquire()) {
      var box = document.getElementById('saveGuardBanner');
      if (box) box.style.display = 'none';
      startHeartbeat();
      showToast('已重新获得存档写入权', 'success');
      renderPanel();
      return true;
    }
    enterReadOnly('另一个标签页仍在写入存档');
    return false;
  }

  /** 复制文本：优先剪贴板 API，失败退回 textarea + execCommand */
  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* 走兜底 */ }
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:.01;';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      document.body.removeChild(area);
      return ok;
    } catch (e3) { return false; }
  }

  /** 回滚到指定备份：校验 → 当前档留 prerestore → 写回 → 刷新 */
  function restoreBackup(key) {
    if (readOnly) { showToast('只读模式不能回滚存档，请先重新获得写权', 'warn'); return false; }
    var text = readRaw(key);
    if (!text) { showToast('这份备份已不存在', 'warn'); return false; }
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      showToast('这份备份内容已损坏，拒绝回滚（可用"复制原文"手工抢救）', 'warn');
      return false;
    }
    var cur = readRaw(GAME_CONFIG.metaKey);
    if (cur) {
      writeRaw(CFG.preRestorePrefix + Date.now(), cur);
      prune(CFG.preRestorePrefix, CFG.maxPreRestore);
    }
    if (!writeRaw(GAME_CONFIG.metaKey, text)) {
      showToast('回滚写入失败（存储空间不足），当前存档未被改动', 'warn');
      return false;
    }
    showToast('已回滚到 ' + fmtTime(Number(key.slice(CFG.bakPrefix.length))) + ' 的存档，正在重新载入', 'success');
    window.setTimeout(function () { try { window.location.reload(); } catch (e) { /* 忽略 */ } }, 900);
    return true;
  }

  /** 建"存档安全"设置区（只建一次，插在"清空永久存档"之前） */
  function installPanel() {
    if (uiReady) return;
    var panel = document.getElementById('settingsPanel');
    if (!panel) return;
    var anchor = panel.querySelector('.settings-save');
    if (!anchor || !anchor.parentNode) return;
    var box = document.createElement('section');
    box.className = 'settings-box';
    box.id = 'saveGuardSection';
    box.innerHTML = ''
      + '<div class="talent-head"><h3>存档安全 · SAVE GUARD</h3>'
      + '<span class="setting-state" id="sgState">写权正常</span></div>'
      + '<div class="setting-note" id="sgHint">每次覆盖永久存档前，旧档会先留一份带时间戳的副本（最多 '
      + CFG.maxBak + ' 份）。回滚会先备份当前档，再写回所选副本。</div>'
      + '<div id="sgList"></div>'
      + '<div class="setting-row"><label>手动留档</label>'
      + '<button type="button" class="btn" id="sgBackupNow">立即备份当前档</button>'
      + '<button type="button" class="btn" id="sgRefresh">刷新列表</button></div>';
    anchor.parentNode.insertBefore(box, anchor);
    uiReady = true;
    var btnNow = document.getElementById('sgBackupNow');
    if (btnNow) btnNow.addEventListener('click', function () {
      var ok = forceBackupMeta();
      showToast(ok ? '已留档一份当前存档' : '当前存档与最近副本一致，无需重复留档', ok ? 'success' : 'warn');
      renderPanel();
    });
    var btnRefresh = document.getElementById('sgRefresh');
    if (btnRefresh) btnRefresh.addEventListener('click', renderPanel);
    renderPanel();
  }

  /** 渲染备份列表与状态（设置页每次打开都会刷一次） */
  function renderPanel() {
    var list = document.getElementById('sgList');
    var stateEl = document.getElementById('sgState');
    if (stateEl) stateEl.textContent = readOnly ? '只读（不写档）' : (locked ? '写权正常' : '未持锁');
    if (!list) return;
    var baks = listByPrefix(CFG.bakPrefix);
    var brokens = listByPrefix(CFG.brokenPrefix);
    var html = '';
    if (!baks.length) html += '<div class="setting-note">暂无备份：下一次写档前会自动留一份。</div>';
    for (var i = 0; i < baks.length; i += 1) {
      html += '<div class="setting-row"><label>' + fmtTime(baks[i].at) + ' · '
        + (Math.round(baks[i].chars / 102.4) / 10) + ' KB</label>'
        + '<button type="button" class="btn" data-sg-restore="' + baks[i].key + '">恢复到这份</button></div>';
    }
    if (brokens.length) {
      html += '<div class="setting-note">损坏原文（只读留存，可直接复制导出，不参与自动回滚）：</div>';
      for (var j = 0; j < brokens.length; j += 1) {
        html += '<div class="setting-row"><label>' + fmtTime(brokens[j].at) + ' · '
          + (Math.round(brokens[j].chars / 102.4) / 10) + ' KB</label>'
          + '<button type="button" class="btn" data-sg-copy="' + brokens[j].key + '">复制原文</button></div>';
      }
    }
    list.innerHTML = html;
  }

  /** 建顶部只读横幅（默认隐藏，只建一次） */
  function installBanner() {
    if (document.getElementById('saveGuardBanner')) return;
    var box = document.createElement('div');
    box.id = 'saveGuardBanner';
    box.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:9999;'
      + 'display:none;gap:8px;align-items:center;padding:8px 12px;border-radius:10px;'
      + 'background:#3a1f24;border:1px solid #a2454f;color:#ffd9dd;font-size:13px;'
      + 'box-shadow:0 6px 24px rgba(0,0,0,.45);';
    box.innerHTML = '<span id="saveGuardBannerText">只读模式</span>'
      + '<button type="button" class="btn" id="sgRetry">重试写入</button>'
      + '<button type="button" class="btn" id="sgReload">重新载入</button>';
    document.body.appendChild(box);
    var retryBtn = document.getElementById('sgRetry');
    if (retryBtn) retryBtn.addEventListener('click', retryLock);
    var reloadBtn = document.getElementById('sgReload');
    if (reloadBtn) reloadBtn.addEventListener('click', function () { window.location.reload(); });
  }

  /** 绑定设置区按钮与设置页打开时的刷新（事件委托，重渲染不必重绑） */
  function bindEvents() {
    var list = document.getElementById('sgList');
    if (list) {
      list.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var restoreBtn = target.closest('[data-sg-restore]');
        if (restoreBtn) {
          if (restoreBtn.getAttribute('data-armed') !== '1') {
            restoreBtn.setAttribute('data-armed', '1');
            restoreBtn.textContent = '再点一次确认';
            window.setTimeout(function () {
              restoreBtn.setAttribute('data-armed', '0');
              restoreBtn.textContent = '恢复到这份';
            }, 3000);
            return;
          }
          restoreBackup(restoreBtn.getAttribute('data-sg-restore'));
          return;
        }
        var copyBtn = target.closest('[data-sg-copy]');
        if (copyBtn) {
          var text = readRaw(copyBtn.getAttribute('data-sg-copy')) || '';
          var ok = copyText(text);
          showToast(ok ? '损坏原文已复制' : '复制失败：请打开开发者工具手工导出', ok ? 'success' : 'warn');
        }
      });
    }
    var panel = document.getElementById('settingsPanel');
    if (panel && window.MutationObserver) {
      new MutationObserver(renderPanel).observe(panel, {
        attributes: true, attributeFilter: ['class', 'aria-hidden', 'style']
      });
    }
  }

  /** storage 事件：写权锁换人 → 本页降级只读；返回 true 表示已处理 */
  function onStorage(event) {
    if (!event || event.key !== CFG.lockKey) return false;
    var cur = readLock();
    if (cur && cur.owner && cur.owner !== token && Number(cur.exp) > Date.now()) {
      locked = false;
      enterReadOnly('另一个标签页接管了存档写入');
    }
    return true;
  }

  /** 启动：清理超额备份 → 建 UI → 绑定 → 抢写权（失败转只读） */
  function boot() {
    if (disabledByQuery()) { CFG.enabled = false; return; }
    token = newToken();
    installBanner();
    installPanel();
    bindEvents();
    prune(CFG.brokenPrefix, CFG.maxBroken);
    prune(CFG.preRestorePrefix, CFG.maxPreRestore);
    if (!acquire()) { enterReadOnly('另一个标签页正在使用存档'); return; }
    startHeartbeat();
    renderPanel();
    window.addEventListener('pagehide', release);
    /* 从后台切回时若已丢锁（另一页关掉/锁过期），自动补一次写权 */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !readOnly && !locked) retryLock();
    });
  }

  return {
    cfg: CFG,
    boot: boot,
    /** 本页是否允许写档（唯一的写入门禁） */
    canWrite: function () {
      /* 未 boot（token 为空）时一律放行：避免模块半初始化把存写死 */
      if (!CFG.enabled || !token) return true;
      return !readOnly && locked;
    },
    isReadOnly: function () { return readOnly; },
    backupMetaBeforeWrite: backupMetaBeforeWrite,
    backupSlotStoreBeforeWrite: backupSlotStoreBeforeWrite,
    enterReadOnly: enterReadOnly,
    onStorage: onStorage,
    retryLock: retryLock,
    listBackups: function () { return listByPrefix(CFG.bakPrefix); }
  };
})();
```

### 段 3 · 整函数替换 `saveMeta()`（写权门禁 + 写前快照）

**锚点原文（L17914-L17936，整段替换）**：

```js
function saveMeta() {
  if (metaFallbackClean || metaExternalChanged) return;
  const write = () => window.localStorage.setItem(GAME_CONFIG.metaKey, JSON.stringify(state.meta));
  try {
    write();
  } catch (error) {
    try {
      const store = readRunSlotStore();
      const keys = Object.keys(store.slots || {});
      if (keys.length) {
        keys.sort((a, b) => ((store.slots[a] || {}).savedAt || 0) - ((store.slots[b] || {}).savedAt || 0));
        delete store.slots[keys[0]];
        writeRunSlotStore(store);
        write();
        showToast('存储空间不足：已清理最旧的局内存档以保住永久进度', 'warn');
        return;
      }
    } catch (retryError) {
      /* 二次失败走下面统一提示 */
    }
    showToast('存储空间不足：本次永久进度未能保存，请清理浏览器站点数据后重试', 'warn');
  }
}
```

**替换为**：

<!-- SEG3 -->
```js
function saveMeta() {
  if (metaFallbackClean || metaExternalChanged) return;
  /* 存档安全：本页没有写权（另一标签页在写）时一律不写，避免用旧快照覆盖新进度 */
  if (typeof SaveGuard !== 'undefined' && SaveGuard && !SaveGuard.canWrite()) return;
  /* 存档安全：覆盖前先给磁盘上的旧档留一份带时间戳副本（同内容不重复留） */
  try {
    if (typeof SaveGuard !== 'undefined' && SaveGuard) SaveGuard.backupMetaBeforeWrite();
  } catch (bakError) { /* 备份失败不阻断正写 */ }
  const write = () => window.localStorage.setItem(GAME_CONFIG.metaKey, JSON.stringify(state.meta));
  try {
    write();
  } catch (error) {
    try {
      const store = readRunSlotStore();
      const keys = Object.keys(store.slots || {});
      if (keys.length) {
        keys.sort((a, b) => ((store.slots[a] || {}).savedAt || 0) - ((store.slots[b] || {}).savedAt || 0));
        delete store.slots[keys[0]];
        writeRunSlotStore(store);
        write();
        showToast('存储空间不足：已清理最旧的局内存档以保住永久进度', 'warn');
        return;
      }
    } catch (retryError) {
      /* 二次失败走下面统一提示 */
    }
    showToast('存储空间不足：本次永久进度未能保存，请清理浏览器站点数据后重试', 'warn');
  }
}
```

### 段 4 · 整函数替换 `writeRunSlotStore()`（局内槽也受写权控制 + 写前快照）

**锚点原文（L51817-L51824，整段替换）**：

```js
function writeRunSlotStore(store) {
  try {
    localStorage.setItem(SAVE_SLOTS_CONFIG.key, JSON.stringify(store));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error && error.name === 'QuotaExceededError' ? 'quota' : 'write' };
  }
}
```

**替换为**：

<!-- SEG4 -->
```js
function writeRunSlotStore(store) {
  /* 存档安全：没有写权时不写局内槽（两页都点"继续"同一个槽时，只有一页能落盘） */
  if (typeof SaveGuard !== 'undefined' && SaveGuard && !SaveGuard.canWrite()) {
    return { ok: false, error: 'readonly' };
  }
  const text = JSON.stringify(store);
  /* 存档安全：覆盖前留一份旧槽库（体积超限/已有一份时跳过，避免自己吃满配额） */
  try {
    if (typeof SaveGuard !== 'undefined' && SaveGuard) SaveGuard.backupSlotStoreBeforeWrite(text.length);
  } catch (bakError) { /* 备份失败不阻断正写 */ }
  try {
    localStorage.setItem(SAVE_SLOTS_CONFIG.key, text);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error && error.name === 'QuotaExceededError' ? 'quota' : 'write' };
  }
}
```

### 段 5 · `saveRunSlot()` 加只读提示（插入 4 行）

**位置**：`saveRunSlot()` 开头，`if (!SAVE_SLOTS_CONFIG.enabled)` 之后。
**锚点原文（L51907-L51910，唯一）**：

```js
  if (!SAVE_SLOTS_CONFIG.enabled) return { ok: false, error: 'disabled' };
  if (!state || state.mode === 'title' || !state.rooms || !state.rooms.length) {
    return { ok: false, error: 'no-run' };
  }
```

**插入内容（放在第 1 行之后、`if (!state ...` 之前）**：

```js
  /* 存档安全：只读页明确告知"没保存"，而不是让玩家以为存上了 */
  if (typeof SaveGuard !== 'undefined' && SaveGuard && !SaveGuard.canWrite()) {
    showToast('只读模式：另一个标签页正在保存，本页不写存档', 'warn');
    return { ok: false, error: 'readonly' };
  }
```

### 段 6 · 整段替换 `storage` 监听（补上写权锁与只读降级）

**锚点原文（L17938-L17945，整段替换）**：

```js
/* v1.7.0 存档兼容（R2）：另一个标签页写档时，本页立刻停止写 meta。
   监听器只做止损，不做合并——整对象写盘没有修订号，合并属于下一版的结构改动。 */
window.addEventListener('storage', (event) => {
  if (!event || event.key !== GAME_CONFIG.metaKey || !event.newValue) return;
  if (metaExternalChanged) return;
  metaExternalChanged = true;
  showToast('检测到另一标签页更新了存档：本页已停止写入，请刷新后继续', 'warn');
});
```

**替换为**：

<!-- SEG6 -->
```js
/* v1.7.0 存档兼容（R2）：另一个标签页写档时，本页立刻停止写 meta。
   v1.8.0 存档安全：写权锁换人同样降级只读，并把"只读"变成常驻横幅。 */
window.addEventListener('storage', (event) => {
  if (!event) return;
  /* ① 别的标签页写了永久存档：保留原有止损，同时进入只读（不只是弹一条 toast） */
  if (event.key === GAME_CONFIG.metaKey && event.newValue) {
    if (!metaExternalChanged) {
      metaExternalChanged = true;
      showToast('检测到另一标签页更新了存档：本页已停止写入，请刷新后继续', 'warn');
    }
    if (typeof SaveGuard !== 'undefined' && SaveGuard) SaveGuard.enterReadOnly('另一标签页更新了永久存档');
    return;
  }
  /* ② 写权锁换人：本页立刻降级只读（对应 R2 的"同一时刻只有一个写手"） */
  if (typeof SaveGuard !== 'undefined' && SaveGuard) SaveGuard.onStorage(event);
});
```

---

## 四、字节增量汇总（实测）

| 段 | 类型 | 改前字节 | 改后字节 | 增量 |
|---|---|---|---|---|
| 1 · init 拿写权 | 插入 2 行 | 2,812,871 | 2,813,045 | **+174 B** |
| 2 · SaveGuard 模块 | 插入 | 2,813,045 | 2,831,545 | **+18,500 B** |
| 3 · saveMeta | 整函数替换 | 2,831,545 | 2,832,019 | **+474 B** |
| 4 · writeRunSlotStore | 整函数替换 | 2,832,019 | 2,832,579 | **+560 B** |
| 5 · saveRunSlot 只读提示 | 插入 4 行 | 2,832,579 | 2,832,893 | **+314 B** |
| 6 · storage 监听 | 整段替换 | 2,832,893 | 2,833,329 | **+436 B** |
| **合计** | | **2,812,871** | **2,833,329** | **+20,458 B** |

**实测方式（可复现）**：把 6 段按顺序应用到主文件的**工作副本**（`.saveguard/preview.html`），逐段 `Buffer.byteLength(utf8)` 取差；随后抽出 `<script>` 块跑 `node --check` → **SYNTAX OK（2,558,967 字节脚本）**。副本验完已删除，主文件全程未改。
**锚点稳定性**：同一套补丁在 2,814,262 B / 2,823,416 B / 2,812,871 B 三个快照上全部命中锚点（主文件在此期间被其他线改过两次）；定稿版在 2,812,871 B 上复跑两次，六段增量完全一致。

> 增量按 UTF-8 字节计（文件为 LF 换行、无 BOM）。中文字符 3 字节/个，勿用字符数代替字节数。
> 段 3/4/6 是"整函数替换"，增量 = 新函数字节 − 旧函数字节，不是纯插入。

---

## 五、验收演示（可当着用户面做）

### 演示 A · 制造坏档，证明旧档还在（对应 R1）

1. 正常打开游戏 → 玩到有结晶（或先在设置页点「立即备份当前档」）。
2. F12 控制台执行：
   ```js
   const k='arcane_rogue_meta';
   const t=localStorage.getItem(k);
   console.log('原档长度', t.length);
   localStorage.setItem(k, t.slice(0, Math.floor(t.length/2)));   // 人为截断
   ```
3. 刷新页面。
   - **预期**：标题页出现 warn toast「存档已损坏…（原档已备份，本次不写档）」；顶部无只读横幅（坏档降级与写权锁是两件事）。
4. 控制台执行，证明旧档仍在：
   ```js
   Object.keys(localStorage).filter(k=>k.startsWith('arcane_rogue_meta.broken.')).map(k=>[k,localStorage[k].length])
   ```
   - **预期**：至少有 1 个 `arcane_rogue_meta.broken.<时间戳>`，长度 = 截断前的原档长度。
5. 打开设置 → 「存档安全」→ 能看到「损坏原文」一行，点「复制原文」可整段复制出来。
6. 恢复：把备份写回（模拟玩家找回）：
   ```js
   const bk=Object.keys(localStorage).filter(k=>k.startsWith('arcane_rogue_meta.bak.')).sort().pop();
   if (bk) localStorage.setItem('arcane_rogue_meta', localStorage.getItem(bk));
   location.reload();
   ```
   - **预期**：结晶/天赋/成就回到备份时刻。

### 演示 B · 证明写前确实留了上一份好档（对应 G1）

1. 打开游戏 → 设置页点「立即备份当前档」→ 记下列表里出现的时间与体积。
2. 花结晶升 1 级天赋（触发 `saveMeta`）。
3. 再开设置页 → 列表新增一条，内容是升级**之前**的档。
4. 点「恢复到这份」→ 按钮变「再点一次确认」→ 再点 → 页面自动刷新。
   - **预期**：刷新后天赋等级回到升级前，结晶回到花掉前；且多出一个 `arcane_rogue_meta.prerestore.*`（回滚前的当前档），说明回滚本身也可撤销。

### 演示 C · 证明两个标签页不会互相覆盖（对应 R2/G5/G6/G7）

1. 打开标签 A（正常），再打开标签 B（同一文件同一地址）。
2. **预期**：B 顶部常驻红色横幅「只读模式：另一个标签页正在使用存档。本页的永久进度不会保存。」；B 的设置页状态显示「只读（不写档）」。
3. 在 A 花结晶升 1 级天赋 → 关闭 A → 刷新 B。
   - **预期**：B 里天赋等级是**升级后**的（A 的写入没有被 B 覆盖）。
4. 反向验证写权可回收：B 保持打开，回到 A 新开的标签页 C（C 打开时会抢锁失败 → 只读），关闭 B → 在 C 点横幅上的「重试写入」→ 横幅消失，状态变「写权正常」。
5. 局内槽验证：A、B 都点「继续」进同一槽 → 在 B 里走到第 2 层 → 切回 A 再关闭 → 重新打开看槽位楼层。
   - **预期**：B 因无写权不会写槽，槽位时间戳/楼层来自 A（`arcane_run_slots_v1` 只有一份，不再互相踩）。
6. 锁自愈验证：A 打开后强制结束标签页（不触发 pagehide 也无需担心）→ 新开 D → 最多等 15 秒（TTL）→ D 自动拿到写权，或点「重试写入」立即拿到。

### 演示 D · 一键关闭（回退开关）

- 地址后加 `?saveguard=off` 打开：不建横幅、不建设置区、不抢锁，`saveMeta` 行为回到 v1.8.0（只保留原 `metaExternalChanged` 止损）。
- 用于定位"是不是新模块导致的"。

---

## 六、回退方式

| 段 | 回退动作 |
|---|---|
| 1 | 删掉那 2 行注释 + `SaveGuard.boot();` |
| 2 | 删掉整个 `var SaveGuard = (function(){...})();` 块 |
| 3/4/6 | 用本文件的「锚点原文」整段贴回 |
| 5 | 删掉那 4 行 |
| 全局 | URL 加 `?saveguard=off`（无需改代码） |

---

## 七、未验证 / 需要写权线注意的点

1. **字节增量**已在主文件副本上实测（见 §四），但主文件仍在被其他线修改；贴之前请先按函数名复核锚点，增量以实际 diff 为准。
2. **已做的验证**：6 段在副本上全部命中锚点、顺序应用成功、`node --check` 通过（2,558,967 字节脚本无语法错误）。**未做**：浏览器运行期验证（按约束本轮不开浏览器）。
3. **`file://` 下的 storage 事件**：Chrome/Edge 对同一文件 URL 的多标签页共享 localStorage，storage 事件可用；`BroadcastChannel` 在 `file://` 部分版本不可用，因此本方案**只依赖 localStorage + storage 事件**，不依赖 BroadcastChannel。
4. **隐私模式/配额满**：拿不到锁时退化为单页直写（不锁死游戏）；此时多标签页仍靠原 `storage` 止损。这是有意的取舍，避免"无痕模式打不开游戏"。
5. **后台标签页定时器节流**：Chrome 长时间后台会把 4s 心跳拉到 1 分钟级，锁会过期。已用 15s TTL + 回到前台自动重抢 + 手动「重试写入」三条兜底；若实测仍有误判，把 `lockTtlMs` 调到 60000。
6. **不改动**：`normalizeMeta` / `migrateMeta` / schema 版本 / 槽位版本门禁 / 任何数值。R5、R7 维持原状，避免把无关风险混进本轮。
7. **已知边界**：`saveMeta` 的"写前快照"只在内容变化时留一份；如果玩家连续两次写档之间旧档从未落盘（例如页面刚开就写），备份的就是启动时的那份，属预期。
