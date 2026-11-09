# 首局教学补丁 · v2（事件化 + 开局快照 + showFloor 顺序）

> **状态：已核销，交写权线，按序落盘。主文件 `index_arcane_v2.html` 冻结中；本文件不含任何对主文件的直接改动。**
> **TARGET_MD5: `62C63B773A093C5F334C8D0563051BBB`**（2,694,263 B / mtime 2026-11-08 19:27:21 / SHA256 `3929CB87…`）。**落盘前比对，不符拒收**（本补丁的自检即基于这份）。
> 机械版：`tools/reviewfix_apply.js`（40 个替换必须各命中 1 次，否则中止）。
> 基准：主文件 62,936 行版本。行号会漂移，**全部按「唯一锚点字符串」定位，不要按行号找**。
> 验证：只在主文件副本上跑（`.reviewfix/index_patched.html`），预览页结果不作数。
> **粘贴顺序：本文件第 1 份**。粘完块 0–19 → 跑 `arcane_syntax` → 跑全量自检（含 `death_parity`）→ 全绿后再粘 `DEATH_REVIEW_PATCH.md`。不要连着粘两份。

## 块索引（20 块，0–19）

| 块 | 位置 | 一句话 | 回退 |
|---|---|---|---|
| 0 | `<style>` `.onboard-hint` | 提示从屏幕垂直居中挪到右上 `top:64px`，加弹窗内提示行样式 | 删新增规则、还原 2 条 transform |
| 1 | `ONBOARD_CONFIG` | 3 秒淡出 + 跳过键 + `seedOnRuns:2` | 删 3 个键 |
| 2 | `ONBOARD_STEPS` | 五层动词表 → 5 个**事件**表，删 `floor` 加 `n` | 整表还原 |
| 3 | `onboardState` | 加 `ev/evOrder/queue/pending/gap/modalHint` | 删 7 个字段 |
| 4 | `onboardSkipAll` 前 | 新增 `onboardSeedSeen` / `onboardReturningPlayer`，改 `onboardSkipAll` 读快照 | 删两函数、还原 `onboardSkipAll` |
| 5 | `onboardShowHint` | 拆出 `onboardRenderHint`（真正渲染才写 seen）+ 排队 | 还原单函数 |
| 6 | `onboardHideHint` | 收起后留 0.5s 间隙 | 删一行 |
| 7 | `onboardMark` | 去掉楼层门槛 | 还原一行 |
| 8 | `onboardTick` | 删「按层弹提示」，改 3 秒/队列/pending/gap | 整段还原 |
| 9 | `onboardOnRoomEnter` | 进房发事件 + 新增唯一入口 `onboardEvent` | 还原 + 删函数 |
| 10 | `onboardBeginRun` | 写**开局基线快照**、reject 非首局、播种 seen | 还原函数 |
| 11 | `openReward` | 三选一 → `onboardEvent('firstChoice', true)` | 删一行 |
| 12 | `grantRunCrystals` | 首次结晶入账 → `firstCrystal` | 删一行 |
| 13 | `damagePlayer` 低血分支 | → `lowHp` | 删一行 |
| 14 | `buildRewardModalHtml` | 弹窗内渲染提示行 | 删 `obLine` 与拼接 |
| 15 | `handleKeyDown` | Esc / 空格跳过提示 | 删该段 |
| 16 | 帮助速查 | `data-quickref-floor`→`-step`，`第 N 层`→`事件 N` | 还原 2 行 |
| 17 | 设置页回顾 | `step.floor`→`step.n`，`第 N 层`→`事件 N` | 还原 2 行 |
| 18 | 调试口 `onboard` | `steps.n` + `info` 事件字段 + `reset` 清基线 + `event/modalLine` | 逐项还原 |
| 19 | `__roamDebug.floor.showFloor` | **顺序修复**：先取 `bestBefore`，显式传基线 | 还原函数 |

---

## 块 0 · 提示位置 + 弹窗内提示行

**锚点 1**（CSS，`.onboard-hint` 内）
```css
    right: 18px;
    top: 50%;
    transform: translate(10px, -50%);
```
改成：
```css
    right: 18px;
    top: 64px;
    transform: translate(10px, 0);
```

**锚点 2**
```css
  .onboard-hint.is-on { opacity: 1; transform: translate(0, -50%); }
```
改成：
```css
  .onboard-hint.is-on { opacity: 1; transform: translate(0, 0); }
```

**锚点 3**：在 `.onboard-hint .ob-verb { … }` 这段规则结束的 `}` 之后插入：
```css
  /* 弹窗内部的提示行：弹窗 z-index 60 会盖住引导条 41，这条只能长在弹窗里 */
  .ob-modal-line {
    margin: 8px auto 0;
    max-width: 520px;
    padding: 5px 10px;
    border: 1px solid rgba(255, 210, 120, 0.4);
    border-radius: 6px;
    background: rgba(28, 20, 6, 0.55);
    color: #ffe7b8;
    font-size: 12.5px;
    line-height: 1.5;
    letter-spacing: 0.04em;
    pointer-events: none;
    animation: ob-modal-fade 0.4s ease 3s forwards;
  }
  @keyframes ob-modal-fade { to { opacity: 0; } }
```
**为什么挪位置**：小地图在右下（`right:18px / bottom:208px`），浮动条原来垂直居中会压住操作区；`top:64px` 在右上角空区，且 `.onboard-hint` 本身已有 `pointer-events:none`，**不挡点击**。
**回退**：删掉 `.ob-modal-line` 与 `@keyframes`；两处 transform 还原。

---

## 块 1 · 配置

**锚点**
```js
  hintLifeSec: 6.0,              // 提示停留时间（超时自动收起）
```
改成：
```js
  hintLifeSec: 3.0,              // 事件提示 3 秒自动淡出
  skipKeys: ['Escape', 'Space', ' '],  // 可按键跳过当前提示（不暂停游戏）
  seedOnRuns: 2,                 // runs 已先 +1：首局快照=1，第二局=2
```
**回退**：删 3 个新键，`hintLifeSec` 还原 6.0。

---

## 块 2 · 事件表（删 `floor`）

**锚点**
```js
/** 五层动词表：hint 必须 ≤ hintMaxChars（验收脚本会逐个断言） */
const ONBOARD_STEPS = [
  { key: 'moveAttack', floor: 1, verb: '移动与开火', hint: 'WASD 移动，左键开火' },
  { key: 'fusion', floor: 2, verb: '融合', hint: '按 F 融合主技能' },
  { key: 'techDash', floor: 3, verb: '装置与冲刺', hint: 'K 装置，Shift 跑' },
  { key: 'route', floor: 4, verb: '路线取舍', hint: '选门：打怪或绕路' },
  { key: 'meta', floor: 5, verb: '元进度', hint: '死亡后结晶升天赋' }
];
```
改成：
```js
/** 首局 5 个事件表：hint 必须 ≤ hintMaxChars（验收脚本会逐个断言）
    触发点跟玩家真实遭遇走，不跟楼层走；floor 字段已删除，序号统一用 n */
const ONBOARD_STEPS = [
  { key: 'firstRoom',    n: 1, verb: '移动', hint: 'WASD 移动，左键开火', delay: 1.2 },
  { key: 'firstChoice',  n: 2, verb: '选牌', hint: '选牌优先凑融合', delay: 0 },
  { key: 'firstElite',   n: 3, verb: '精英', hint: '精英更肉，K 装置', delay: 0 },
  { key: 'lowHp',        n: 4, verb: '低血', hint: '血少就退，Shift 跑', delay: 0 },
  { key: 'firstCrystal', n: 5, verb: '结晶', hint: '结晶留着升天赋', delay: 0 }
];
```
**语义**：旧表是「第 N 层弹什么」，玩家第 4 层没进门就永远看不到「路线取舍」；新表是「第一次遇到这件事时教什么」，5 件事都可能在第 1–2 层内发生。
**回退**：整表还原（注意旧代码里 `onboardStepForFloor` 依赖 `step.floor`，回退时要一起还原块 8/18）。

---

## 块 3 · 本局状态字段

在 `onboardState()` 的初始化对象里，**锚点**：
```js
      startKills: state.kills || 0,
      startFusions: (state.fusions || []).length
```
改成：
```js
      startKills: state.kills || 0,
      startFusions: (state.fusions || []).length,
      ev: {},              // 本局已接受的事件（key → true）
      evOrder: [],         // 事件接受顺序（断言用）
      queue: [],           // 有提示在屏时排队
      pending: [],         // delay > 0 的待弹事件
      gap: 0,              // 上一条收起后的 0.5s 间隙
      modalHint: null      // 奖励弹窗内提示行（渲染后即清空）
```
同时把 `progress` / `shownFloor` 的注释改成「已完成的事件 / 兼容旧调试口」。
**回退**：删 6 个新字段。

---

## 块 4 · 开局基线快照 + 老玩家判定（修 ②）

**锚点**：整个 `onboardSkipAll()` 函数。
```js
function onboardSkipAll() {
  if (!ONBOARD_CONFIG.enabled || !state) return true;
  if (state.onboardSkipAll == null) {
    // 快照一次：本轮开始时的历史最佳楼层（若 ≥5 视为老玩家）
    state.onboardSkipAll = Number(state.meta && state.meta.bestFloor) >= ONBOARD_CONFIG.skipBestFloor;
  }
  return !!state.onboardSkipAll;
}
```
改成（在它前面新增两个函数，`onboardSkipAll` 改为读快照）：
```js
/**
 * 把 5 条事件全部写进 seen（老玩家 / 非首局不再打扰）
 * @returns {void}
 */
function onboardSeedSeen() {
  const seen = loadOnboardSeen();
  ONBOARD_STEPS.forEach((step) => { seen[step.key] = true; });
  saveOnboardSeen(seen);
}

/**
 * 本局是否属于"不需要教学"的玩家（只读开局快照，不读 live 值）
 * ------------------------------------------------------------
 * bestFloor 在进层时就会被刷新：如果每帧读 live 值，新号一进第 5 层就被判成老玩家，
 * 结晶 / 低血 / 精英提示会全部静默，而且老玩家永远复现不了这个 bug。
 * runs 在 startGame / restartRun 里已经先 +1，所以首局快照=1、第二局=2，
 * 阈值必须写 >= 2；写成 >= 1 会把所有老玩家的第一局重新教一遍。
 * @returns {boolean}
 */
function onboardReturningPlayer() {
  if (!ONBOARD_CONFIG.enabled || !state) return true;
  const base = state.onboardBaseline;
  if (!base) return true;
  return (Number(base.runs) || 0) >= ONBOARD_CONFIG.seedOnRuns
    || (Number(base.bestFloor) || 0) >= ONBOARD_CONFIG.skipBestFloor;
}

/**
 * 老存档 / 总开关判断：true = 本轮不教、不降难度
 * @returns {boolean}
 */
function onboardSkipAll() {
  if (!ONBOARD_CONFIG.enabled || !state) return true;
  if (state.onboardSkipAll == null) {
    const base = state.onboardBaseline;
    const best = base
      ? (Number(base.bestFloor) || 0)
      : (Number(state.meta && state.meta.bestFloor) || 0);
    state.onboardSkipAll = best >= ONBOARD_CONFIG.skipBestFloor;
  }
  return !!state.onboardSkipAll;
}
```
**改前/改后**：改前每次调用都读 `state.meta.bestFloor`（live）；改后只读 `state.onboardBaseline`，无基线一律返回 true（拒绝弹）。
**回退**：删两函数，`onboardSkipAll` 还原。

---

## 块 5 · 渲染与排队

**锚点**：整个 `onboardShowHint(key)`（含注释）。替换为：
```js
/**
 * 把一条事件提示真正画到屏幕（只有走到这里才写 seen）
 * @param {Object} step ONBOARD_STEPS 条目
 * @param {boolean} forceModal 是否渲染进奖励弹窗
 * @returns {boolean}
 */
function onboardRenderHint(step, forceModal) {
  const st = onboardState();
  const inModal = !!forceModal || state.mode === 'reward';
  st.hint = { key: step.key, text: step.hint, verb: step.verb, t: ONBOARD_CONFIG.hintLifeSec };
  if (inModal) {
    // 弹窗高 60 层，浮动条在 41 层：三选一必须长在弹窗 HTML 里
    st.modalHint = { verb: step.verb, text: step.hint };
    if (ui.onboardHint) {
      ui.onboardHint.classList.remove('is-on');
      ui.onboardHint.setAttribute('aria-hidden', 'true');
    }
  } else if (ui.onboardHint) {
    ui.onboardHint.innerHTML = '<span class="ob-verb">教学 · ' + step.verb + '</span>' + step.hint;
    ui.onboardHint.classList.add('is-on');
    ui.onboardHint.setAttribute('aria-hidden', 'false');
  }
  // 教学期间塔灵静默：立刻收起正在显示的那一句
  if (ui.spiritLine) ui.spiritLine.classList.remove('is-on');
  const seen = loadOnboardSeen();
  seen[step.key] = true;
  saveOnboardSeen(seen);
  return true;
}

/**
 * 请求显示一条事件提示；有提示在屏时排队，不叠着弹
 * @param {string} key 事件键
 * @param {boolean} forceModal 是否渲染进奖励弹窗
 * @returns {boolean} 是否立刻上屏
 */
function onboardShowHint(key, forceModal) {
  if (!ONBOARD_CONFIG.enabled || !state) return false;
  const step = ONBOARD_STEPS.find((item) => item.key === key);
  if (!step) return false;
  const st = onboardState();
  if (st.ev[key] || loadOnboardSeen()[key]) return false;
  st.ev[key] = true;
  st.evOrder.push(key);
  if (st.hint) {
    st.queue.push({ key: key, forceModal: !!forceModal });
    return false;
  }
  return onboardRenderHint(step, forceModal);
}
```
**关键语义**：改前「先写 seen 再渲染」——排队时就算看过了，后面永远不再弹；改后只在 `onboardRenderHint` 写 seen。
**回退**：还原为原单函数。

---

## 块 6 · 收起后留间隙

**锚点**（`onboardHideHint` 里）：
```js
  if (onboardPendingToast) {
```
改成：
```js
  st.gap = 0.5;   // 两条提示之间留半秒，避免贴脸换
  if (onboardPendingToast) {
```
**回退**：删这一行。

---

## 块 7 · `onboardMark` 去楼层门槛

**锚点**
```js
function onboardMark(key) {
  if (!ONBOARD_CONFIG.enabled || !state) return false;
  if (!onboardActiveFloor(state.floor)) return false;
  const st = onboardState();
```
改成：
```js
function onboardMark(key) {
  if (!ONBOARD_CONFIG.enabled || !state) return false;
  const st = onboardState();
```
**理由**：事件不再绑定前 5 层；低血 / 结晶可以在任意层发生。
**回退**：补回门槛一行。

---

## 块 8 · 每帧推进

**锚点**：整个 `onboardTick(dt)`。替换为：
```js
function onboardTick(dt) {
  if (!state) return;
  // 总开关关闭时不再出队渲染：调试 set({enabled:false}) 之后，队列里残留的提示也不许再弹
  if (!ONBOARD_CONFIG.enabled) return;
  const st = onboardState();

  // 1) 提示停留计时（即使暂停 / 弹窗也按真实时间收，不会卡在屏幕上）
  if (st.hint) {
    st.hint.t -= dt;
    if (st.hint.t <= 0) onboardHideHint(false);
  } else if (st.gap > 0) {
    st.gap = Math.max(0, st.gap - dt);
  }

  // 2) 排队与延迟：先补 pending，再补 queue，保证顺序仍是 evOrder
  for (let i = st.pending.length - 1; i >= 0; i -= 1) {
    const item = st.pending[i];
    item.t -= dt;
    if (item.t <= 0) {
      st.pending.splice(i, 1);
      onboardShowHint(item.key, item.forceModal);
    }
  }
  if (!st.hint && st.gap <= 0 && st.queue.length) {
    const next = st.queue.shift();
    const step = ONBOARD_STEPS.find((item) => item.key === next.key);
    if (step) onboardRenderHint(step, next.forceModal);
  }

  if (state.mode !== 'playing' || state.status !== 'playing') return;

  // 3) 换层只同步参考点：触发点已经跟着事件走，不再按楼层弹提示
  if (st.floor !== state.floor) {
    st.floor = state.floor;
    st.lastPos = null;
    st.moveAcc = 0;
  }

  // 4) 移动证据：只给调试 info 用，不再参与解锁
  const p = state.player;
  if (st.lastPos) {
    const d = dist(p.x, p.y, st.lastPos.x, st.lastPos.y);
    if (d < 400) st.moveAcc += d;   // 瞬移（调试/换层）不计入
  }
  st.lastPos = { x: p.x, y: p.y };
  if (st.moveAcc >= ONBOARD_CONFIG.moveEvidencePx) st.moved = true;
}
```
**删掉了什么**：原第 3 段（第 1 层移动/击杀 → `moveAttack`）、第 4 段（第 3 层 K+Shift → `techDash`）、第 5 段（按楼层 `onboardShowHint`）。
**回退**：整段还原。

---

## 块 9 · 进房事件 + 唯一入口

**锚点**：整个 `onboardOnRoomEnter(room)`。替换为：
```js
function onboardOnRoomEnter(room) {
  if (!state || !ONBOARD_CONFIG.enabled || !room) return false;
  const st = onboardState();
  if (st.lastRoomId === room.id) return false;
  const isFirst = st.lastRoomId == null;
  st.lastRoomId = room.id;
  if (isFirst) return false;
  // 第一次走进非出生房：移动教学
  if (room.type !== 'start') onboardEvent('firstRoom');
  // 精英房：第一次遇到精英
  if (room.type === 'elite') onboardEvent('firstElite');
  return true;
}

/**
 * 事件提示唯一入口：所有触发点都走这里
 * ------------------------------------------------------------
 * - 非 playing / reward 不弹（死亡结算、地图、标题一律吞掉）
 * - 非首局直接 false（老玩家不打扰）
 * - delay > 0 的先进 pending，由 onboardTick 倒计时
 * @param {string} key ONBOARD_STEPS 的 key
 * @param {boolean} forceModal 奖励弹窗内渲染
 * @returns {boolean} 是否接受本次触发
 */
function onboardEvent(key, forceModal) {
  if (!state || !ONBOARD_CONFIG.enabled) return false;
  if (state.mode !== 'playing' && state.mode !== 'reward') return false;
  if (onboardReturningPlayer()) return false;
  const step = ONBOARD_STEPS.find((item) => item.key === key);
  if (!step) return false;
  const st = onboardState();
  if (st.ev[key]) return false;
  if (st.pending.some((item) => item.key === key)) return false;
  const delay = Number(step.delay) || 0;
  if (delay > 0) {
    st.pending.push({ key: key, forceModal: !!forceModal, t: delay });
    return true;
  }
  return onboardShowHint(key, forceModal);
}
```
**回退**：`onboardOnRoomEnter` 还原（含 `routeSeen` 那段），删 `onboardEvent`。

---

## 块 10 · 开局初始化 + 基线快照（修 ③ 的一半）

**锚点**：整个 `onboardBeginRun()`。替换为：
```js
/**
 * 本轮开局初始化引导状态（startGame / restartRun / showFloor 共用）
 * @param {Object} [opts] { bestFloor } 显式基线（showFloor 生成楼层前取的值）
 * @returns {void}
 */
function onboardBeginRun(opts) {
  if (!state) return;
  const st = onboardState();
  st.progress = {};
  st.shownFloor = {};
  st.hint = null;
  st.floor = state.floor;
  st.delay = ONBOARD_CONFIG.hintDelaySec;
  st.lastPos = null;
  st.moveAcc = 0;
  st.moved = false;
  st.techUsed = false;
  st.dashUsed = false;
  st.routeSeen = false;
  st.lastRoomId = state.currentRoomId;
  st.startKills = state.kills || 0;
  st.startFusions = (state.fusions || []).length;
  st.ev = {};
  st.evOrder = [];
  st.queue = [];
  st.pending = [];
  st.gap = 0;
  st.modalHint = null;
  onboardPendingToast = null;

  /* 开局基线快照：本局内 bestFloor / runs 一律读这一份。
     meta.runs 在 startGame / restartRun 里已经先 +1，所以首局=1、第二局=2。
     showFloor 在 generateFloor 之后才调本函数，必须用 opts.bestFloor 传"生成前"的值，
     否则新号一进第 5 层就被判成老档，当场播种 seen，后面所有 event() 恒 false。 */
  const meta = state.meta || {};
  const best = (opts && typeof opts.bestFloor === 'number')
    ? opts.bestFloor
    : (Number(meta.bestFloor) || 0);
  state.onboardBaseline = { runs: Number(meta.runs) || 0, bestFloor: best };
  state.onboardSkipAll = best >= ONBOARD_CONFIG.skipBestFloor;

  if (onboardReturningPlayer()) onboardSeedSeen();
  if (ui.onboardHint) {
    ui.onboardHint.classList.remove('is-on');
    ui.onboardHint.setAttribute('aria-hidden', 'true');
  }
}
```
**改前/改后**：改前用 `state.meta.bestFloor` 现算 `onboardSkipAll`；改后先写基线快照，再由基线推导。
**回退**：整函数还原。

---

## 块 11–13 · 三个触发点接线

**块 11**（`openReward`，锚点 `  showRewardStage(stage || 'skill');`）
```js
  // 第一次技能三选一：提示渲染进弹窗内部（弹窗 z-index 60 会盖住引导条 41，不能抬 z-index）
  if ((stage || 'skill') === 'skill') onboardEvent('firstChoice', true);
  showRewardStage(stage || 'skill');
```
**块 12**（`grantRunCrystals` 开头）
```js
function grantRunCrystals(amount, reason) {
  const base = Math.max(0, Math.floor(Number(amount) || 0));
  if (!base) return 0;
  // 第一次结晶入账：首局提示一次
  onboardEvent('firstCrystal');
```
**块 13**（`damagePlayer` 低血分支）
```js
      state.fx.lowHpFired = true;
      onboardEvent('lowHp');   // 复用每局一次的 lowHpFired，避免 29%/31% 抖动反复触发
      startGlitchBurst(0.7);
```
**回退**：分别删一行（块 12 删两行）。

---

## 块 14 · 弹窗内提示行

**锚点** `  const kicker = isPassive`，在它前面插入：
```js
  // 弹窗内的教学提示行：弹窗 z-index 60 会整个盖住引导条（41），
  // 所以三选一这条不能走浮动条，必须在弹窗 HTML 里渲染。
  let obLine = '';
  if (!isPassive && state.onboard && state.onboard.modalHint) {
    obLine = '<div class="ob-modal-line" data-onboard-modal="1">教学 · '
      + state.onboard.modalHint.verb + ' · <b>' + state.onboard.modalHint.text + '</b></div>';
    state.onboard.modalHint = null;
  }
  const kicker = isPassive
```
**锚点 2**（返回串）：
```js
    + '<p class="modal-sub">' + sub + '</p>'
```
改成：
```js
    + '<p class="modal-sub">' + sub + '</p>' + obLine
```
**回退**：删 `obLine` 段、去掉 `+ obLine`。

---

## 块 15 · 按键跳过

**锚点**
```js
function handleKeyDown(event) {
  if (!state) return;
```
改成：
```js
function handleKeyDown(event) {
  if (!state) return;
  // 教学提示可按键跳过（Esc / 空格），只收提示、不暂停游戏
  if (state.onboard && state.onboard.hint
    && ONBOARD_CONFIG.skipKeys.indexOf(event.key) >= 0) {
    onboardHideHint(false);
    event.preventDefault();
    return;
  }
```
**回退**：删该段。

---

## 块 16 · 帮助速查（⑥ 的读者 1）

**锚点**
```js
    + '<h3><em>★</em>前 ' + ONBOARD_STEPS.length + ' 层速查 · 每层先做什么</h3>'
    + '<ul class="quickref">' + ONBOARD_STEPS.map((step) =>
      '<li data-quickref-floor="' + step.floor + '"><b>第 ' + step.floor + ' 层</b> · ' + step.verb`,
```
改成：
```js
    + '<h3><em>★</em>首局 ' + ONBOARD_STEPS.length + ' 个事件 · 遇到时先做什么</h3>'
    + '<ul class="quickref">' + ONBOARD_STEPS.map((step) =>
      '<li data-quickref-step="' + step.n + '"><b>事件 ' + step.n + '</b> · ' + step.verb`,
```
**不回退会怎样**：`step.floor` 变 `undefined`，帮助页显示「第 undefined 层」。
**回退**：还原两行。

---

## 块 17 · 设置页回顾（⑥ 的读者 2）

**锚点**
```js
  ui.onboardReviewBody.innerHTML = ONBOARD_STEPS.map((step) => (
    '<div class="ob-review-row"><b>第 ' + step.floor + ' 层 · ' + step.verb + '</b>'
    + '<span>' + step.hint + '</span></div>'
  )).join('');
```
改成：
```js
  ui.onboardReviewBody.innerHTML = ONBOARD_STEPS.map((step) => (
    '<div class="ob-review-row"><b>事件 ' + step.n + ' · ' + step.verb + '</b>'
    + '<span>' + step.hint + '</span></div>'
  )).join('');
```
**这正是审查 ⑥ 说的语义错误**：低血可以在任意层触发，写成「第 4 层 · 低血」会让玩家以为只有第 4 层才会低血。
**回退**：还原两行。

---

## 块 18 · 调试口（⑥ 的读者 3 + 自检入口）

三处：

**(a) `steps` 字段**
```js
          steps: ONBOARD_STEPS.map((step) => ({
            key: step.key,
            n: step.n,
            verb: step.verb,
            hint: step.hint,
            chars: Array.from(step.hint).length
          })),
```
（原为 `floor: step.floor`）

**(b) `info()` 增加字段**，锚点：
```js
          seen: loadOnboardSeen(),
          pendingToast: onboardPendingToast ? onboardPendingToast.message : null,
```
改成：
```js
          seen: loadOnboardSeen(),
          ev: Object.assign({}, st.ev || {}),
          evOrder: (st.evOrder || []).slice(),
          queue: (st.queue || []).slice(),
          pending: (st.pending || []).map((item) => ({ key: item.key, t: item.t })),
          modalHint: st.modalHint ? { verb: st.modalHint.verb, text: st.modalHint.text } : null,
          hintT: st.hint ? Number(st.hint.t.toFixed(2)) : null,
          baseline: state.onboardBaseline ? Object.assign({}, state.onboardBaseline) : null,
          returning: onboardReturningPlayer(),
          pendingToast: onboardPendingToast ? onboardPendingToast.message : null,
```

**(c) `reset(clearSeen)` 清基线**
```js
        state.onboard = null;
        state.onboardSkipAll = null;
        state.onboardBaseline = null;
        onboardBeginRun();
```

**(d) 新增 `event` / `modalLine`**（插在 `mark(key)` 之后）
```js
      /** 走统一事件入口：event(key, forceModal) */
      event(key, forceModal) {
        const ok = onboardEvent(String(key || ''), !!forceModal);
        return { ok: ok, info: this.info() };
      },
      /** 读取弹窗内提示行（没有则 null） */
      modalLine() {
        const el = document.querySelector('[data-onboard-modal="1"]');
        return el ? el.textContent : null;
      },
      /** 重建新号调试入口：resetRun({ clearSeen, runs, bestFloor }) */
      resetRun(opts) {
        const o = opts || {};
        if (typeof o.runs === 'number') state.meta.runs = o.runs;
        if (typeof o.bestFloor === 'number') state.meta.bestFloor = o.bestFloor;
        this.reset(o.clearSeen !== false);
        return this.info();
      },
```
**回退**：逐项还原/删除。

---

## 块 19 · `showFloor` 顺序修复（修 ③）

**锚点**：整个 `showFloor(floorNumber)` 前 17 行（到 `onboardTick(0.05);`）。替换为：
```js
      showFloor(floorNumber) {
        const target = Math.max(1, Math.min(9, Math.floor(Number(floorNumber) || 1)));
        /* 先取数值再 generateFloor：它会立刻把 bestFloor 抬到 target。
           如果在 onboardBeginRun 里读 live 值，新号一进第 5 层就被判成老档、
           当场播种 seen，后面所有 event() 恒 false —— 旧测试全走这个入口，
           等于补丁自带一个把测试全部掐死的洞。 */
        const bestBefore = Number(state.meta && state.meta.bestFloor) || 0;
        state.mode = 'playing';
        state.status = 'playing';
        state.floor = target;
        state.onboard = null;
        state.onboardBaseline = { runs: Number(state.meta && state.meta.runs) || 0, bestFloor: bestBefore };
        state.onboardSkipAll = bestBefore >= ONBOARD_CONFIG.skipBestFloor;
        generateFloor(target);
        onboardEnsureFusionKit(target);
        onboardBeginRun({ bestFloor: bestBefore });   // 显式传基线，忽略被抬高的 bestFloor
        state.onboardSkipAll = bestBefore >= ONBOARD_CONFIG.skipBestFloor;
        const st = onboardState();
        st.delay = 0;          // 测试入口不延迟；提示仍要显式 event(key) 才弹
        onboardTick(0.05);
```
**改前/改后**：改前 `generateFloor` 先跑 → `bestFloor` 被抬到 5 → `onboardBeginRun` 读到 5 → `bestFloor` 判定老档 → `onboardSeedSeen()` 播种 → `event()` 恒 false。改后基线用 `bestBefore`（生成前值）。
**回退**：还原函数开头。

---

## 触发点 → 真实生产者对照（自检用）

| 事件 | 真实触发函数 | 入口调用 |
|---|---|---|
| `firstRoom` | `onboardOnRoomEnter(room)`（走进非 start 房） | 函数内 `onboardEvent('firstRoom')` |
| `firstChoice` | `openReward(reason, 'skill')`（升级 / 清房奖励） | `onboardEvent('firstChoice', true)` |
| `firstElite` | `onboardOnRoomEnter`，`room.type === 'elite'` | 函数内 `onboardEvent('firstElite')` |
| `lowHp` | `damagePlayer(...)` 低血分支（`state.fx.lowHpFired` 每局一次） | `onboardEvent('lowHp')` |
| `firstCrystal` | `grantRunCrystals(amount)`（结晶真正入账） | `onboardEvent('firstCrystal')` |

## 复跑命令（冻结期在副本上）

```bat
node tools\reviewfix_apply.js .reviewfix\index_patched_test.html
node tools\arcane_syntax.js .reviewfix\index_patched_test.html
node tools\reviewfix_onboard_test.js
node tools\arcane_onboard.js "D:\其他\TRAE宝\奥术工程师\.reviewfix\index_patched_test.html"
node tools\arcane_playthrough.js "D:\其他\TRAE宝\奥术工程师\.reviewfix\index_patched_test.html"
node tools\arcane_help.js "D:\其他\TRAE宝\奥术工程师\.reviewfix\index_patched_test.html"
```
