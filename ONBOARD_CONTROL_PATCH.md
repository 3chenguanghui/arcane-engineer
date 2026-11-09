# 里程碑 4 · 教学可跳过 / 可重看 / 默认不遮挡（补丁）

> 基线：`index_arcane_v2.html` · 2,711,040 B · MD5 `23194ECC5F7733054C4E511476B885C7`
> **只产出补丁，不改主文件。** 应用前现场重读 MD5，流程同 [FIRST_DEATH_PATCH.md](file:///D:/其他/TRAE宝/奥术工程师/FIRST_DEATH_PATCH.md)。
> 锚点全部为函数名/唯一代码行；每块可单独回滚。

## 1. 先修五个已证实的硬伤（不是凭感觉）

| # | 问题 | 代码证据 | 后果 |
|---|---|---|---|
| F1 | **空格会吃掉影步**：`skipKeys` 含 `Space`，keydown 命中后直接 `return` | [46045](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L46045)、[53472-53478](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L53472-L53478) | 提示写着「空格 影步」，玩家第一次按空格却只是关提示，影步没放出来 |
| F2 | **暂停仍扣提示时间**：`onboardTick` 用真实 dt 递减 | [46300-46303](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L46300-L46303) | 按 O 看设置 3 秒，回来提示已消失，正好和「可重看」相反 |
| F3 | **发呆 15 秒永久关掉三步引导**：到 15 秒无条件写 `hintsSeen=1` | [53036-53046](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L53036-L53046) | 新手第一局前 15 秒没动，之后永远不再看到移动/施法/影步 |
| F4 | 弹窗内提示行对比度不足：底色 `rgba(28,20,6,0.55)` 在最亮场景上按 WCAG 算约 **3.3:1** | [1431](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L1431) | 12.5px 正文低于 4.5:1，三选一弹窗里最该读的一行最糊 |
| F5 | 窄屏（≤960px）右上提示会侵入中心 60% 区域 | [1395-1401](file:///D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html#L1395-L1401)：宽 190 + 右 18 | 900px 宽时提示左边缘 692px，中心区右边界 720px，重叠 28px |

补充事实（不是问题）：提示条已 `pointer-events:none`，不吃点击；右上位置在 720p/1080p 都在中心 60% 区域之外，**默认不挡战斗的结论成立，但只对 ≥1024px 宽成立**。

## 2. 补丁（函数级锚点）

### 块 0 · 头信息
```
TARGET_MD5 = 23194ECC5F7733054C4E511476B885C7
顺序：块1 → 块2 → 块3 → 块4 → 块5 → 块6 → 块7。
每块后：node --check 不可用时，用浏览器打开一次看控制台；无红字再下一块。
```

### 块 1 · 配置：只留 Esc + 新增提示偏好
**锚点**（唯一行）：
```
  skipKeys: ['Escape', 'Space', ' '],  // 可按键跳过当前提示（不暂停游戏）
```
替换为：
```
  skipKeys: ['Escape'],          // 里程碑4：只留 Esc；空格必须留给影步
  /* 提示偏好（只控制“是否显示教学”，不改难度、不改敌人数、不写 meta） */
  hintPrefKey: 'arcane_tutorial_ui_v1',
  replayStepMs: 1600,            // 设置页“逐条重看”的步进
```
并在 `weakFloor1` 行之后（`};` 之前）追加：
```
  ,
  /* 里程碑4：重看时的高亮停留（毫秒）；与 replayStepMs 分离，便于单独调速 */
  replayHoldMs: 1200
```

### 块 2 · 提示偏好读写 + 设置页重播工具
**锚点**（`const ONBOARD_STEPS = [` 之前插入，唯一）：
```
const ONBOARD_STEPS = [
```
在其上方插入：
```
/** 教学提示偏好缓存（null = 未读盘） */
let __tutorialHintPref = null;
/** 设置页逐条重看的定时器，关闭设置页必须清掉 */
let onboardReplayTimers = [];

/**
 * 读取“教学提示开关”（默认开；localStorage 损坏 / file:// 受限时按开处理）
 * @returns {boolean} true = 显示提示
 */
function tutorialUiEnabled() {
  if (__tutorialHintPref === null) {
    __tutorialHintPref = true;
    try {
      const raw = window.localStorage.getItem(ONBOARD_CONFIG.hintPrefKey);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed.enabled === 'boolean') __tutorialHintPref = parsed.enabled;
    } catch (error) { /* 隐私模式：按默认开 */ }
  }
  return __tutorialHintPref;
}

/**
 * 切换“教学提示开关”：只影响提示，不影响教学难度 / 敌人数量 / 保底件
 * @param {boolean} on 是否显示
 * @returns {void}
 */
function setTutorialUiEnabled(on) {
  __tutorialHintPref = !!on;
  try {
    window.localStorage.setItem(ONBOARD_CONFIG.hintPrefKey, JSON.stringify({ enabled: !!on }));
  } catch (error) { /* 写失败不阻断游戏 */ }
  if (!on && state && state.onboard) {
    state.onboard.hint = null;
    state.onboard.queue.length = 0;
    state.onboard.pending.length = 0;
    if (ui.onboardHint) {
      ui.onboardHint.classList.remove('is-on');
      ui.onboardHint.setAttribute('aria-hidden', 'true');
    }
  }
}

/**
 * 停掉设置页的重播高亮（重复点击 / 关闭设置页都调用）
 * @returns {void}
 */
function onboardReviewStop() {
  onboardReplayTimers.forEach((id) => clearTimeout(id));
  onboardReplayTimers = [];
  if (!ui.onboardReviewBody) return;
  ui.onboardReviewBody.querySelectorAll('.ob-review-row.is-playing').forEach((row) => {
    row.classList.remove('is-playing');
  });
}

/**
 * 设置页“逐条重看”：在设置页内依次高亮 5 条，不重触发游戏内提示
 * @returns {void}
 */
function onboardReviewPlay() {
  onboardReviewStop();
  if (!ui.onboardReviewBody) return;
  const rows = Array.from(ui.onboardReviewBody.querySelectorAll('.ob-review-row'));
  if (!rows.length) return;
  rows.forEach((row, index) => {
    const at = index * ONBOARD_CONFIG.replayStepMs;
    onboardReplayTimers.push(setTimeout(() => {
      rows.forEach((item) => item.classList.remove('is-playing'));
      row.classList.add('is-playing');
    }, at));
    onboardReplayTimers.push(setTimeout(() => {
      row.classList.remove('is-playing');
    }, at + ONBOARD_CONFIG.replayHoldMs));
  });
}
```

### 块 3 · 关闭提示开关时不再出提示；暂停不扣时
**锚点 3a**（`onboardShowHint` 内，唯一）：
```
  if (!ONBOARD_CONFIG.enabled || !state) return false;
```
替换为：
```
  if (!ONBOARD_CONFIG.enabled || !state || !tutorialUiEnabled()) return false;
```

**锚点 3b**（`onboardTick` 内，唯一）：
```
  // 1) 提示停留计时（即使暂停 / 弹窗也按真实时间收，不会卡在屏幕上）
  if (st.hint) {
    st.hint.t -= dt;
    if (st.hint.t <= 0) onboardHideHint(false);
  } else if (st.gap > 0) {
    st.gap = Math.max(0, st.gap - dt);
  }
```
替换为：
```
  /* 里程碑4：暂停 / 打开面板时不扣提示时间；奖励弹窗内仍正常计时（弹窗本身暂停世界） */
  const hintTick = ((state.mode === 'playing' && state.status === 'playing') || state.mode === 'reward');
  if (st.hint) {
    if (hintTick) st.hint.t -= dt;
    if (st.hint.t <= 0) onboardHideHint(false);
  } else if (st.gap > 0) {
    if (hintTick) st.gap = Math.max(0, st.gap - dt);
  }
```

### 块 4 · 首局三步：Esc 可跳、发呆不再永久关闭
**锚点 4a**（`updateContextHints` 内，唯一）：
```
  // 1) 首局三步：0–5s 移动 / 5–10s 施法 / 10–15s 影步；走完写 meta.hintsSeen（跨局只一次）
  if (!state.meta.hintsSeen) {
    const t = state.elapsed || 0;
    if (t < 5) hint = { key: 'u9-move', text: 'WASD 移动', sub: '方向键同样可用；撞墙会贴着滑行。' };
    else if (t < 10) hint = { key: 'u9-cast', text: '左键 施法', sub: '朝鼠标方向释放主技能，消耗奥能。' };
    else if (t < 15) hint = { key: 'u9-dash', text: '空格 影步', sub: '0.32 秒无敌，能穿过子弹与近战前摇。' };
    else {
      state.meta.hintsSeen = 1;
      saveMeta();
    }
  }
```
替换为：
```
  /* 1) 首局三步：0–5s 移动 / 5–10s 施法 / 10–15s 影步
     里程碑4：① 关闭提示开关时不出、也不写 seen；② 15 秒后若还没击杀，继续提示“走进红点房”，
     直到玩家真的开打（state.kills > 0）才写 seen —— 不再用“到点”惩罚发呆的新手。 */
  if (!state.meta.hintsSeen && tutorialUiEnabled() && !state.u9HintsSkipped) {
    const t = state.elapsed || 0;
    if (t < 5) hint = { key: 'u9-move', text: 'WASD 移动', sub: '方向键同样可用；撞墙会贴着滑行。' };
    else if (t < 10) hint = { key: 'u9-cast', text: '左键 施法', sub: '朝鼠标方向释放主技能，消耗奥能。' };
    else if (t < 15) hint = { key: 'u9-dash', text: '空格 影步', sub: '0.32 秒无敌，能穿过子弹与近战前摇。' };
    else if ((state.kills || 0) <= 0) {
      hint = { key: 'u9-move2', text: 'WASD 移动', sub: '沿走廊走进有红点的房间。' };
    } else {
      state.meta.hintsSeen = 1;
      saveMeta();
    }
  }
```

**锚点 4b**（`handleKeyDown` 内，唯一）：
```
  // 教学提示可按键跳过（Esc / 空格），只收提示、不暂停游戏
  if (state.onboard && state.onboard.hint
    && ONBOARD_CONFIG.skipKeys.indexOf(event.key) >= 0) {
    onboardHideHint(false);
    event.preventDefault();
    return;
  }
```
替换为：
```
  // 里程碑4：Esc 跳过当前教学条（只收提示、不暂停游戏；空格已归还给影步）
  if (state.onboard && state.onboard.hint
    && ONBOARD_CONFIG.skipKeys.indexOf(event.key) >= 0) {
    onboardHideHint(false);
    event.preventDefault();
    return;
  }
```

并在 `if (state.mode === 'playing' && openingRitual.active) skipOpeningRitual();` **之后**插入：
```
  /* 里程碑4：Esc 也可跳过首局三步情境提示（只作用于本局，不写永久 seen） */
  if (event.key === 'Escape' && state.mode === 'playing'
      && (state.elapsed || 0) >= 5
      && !state.meta.hintsSeen && !state.u9HintsSkipped) {
    state.u9HintsSkipped = true;
    event.preventDefault();
    return;
  }
```

### 块 5 · 设置页“开关 + 重看”
**锚点**（整个 `renderOnboardReview`，按当前文本替换）：
```
function renderOnboardReview() {
  if (!ui.onboardReviewBody) return;
  ui.onboardReviewBody.innerHTML = ONBOARD_STEPS.map((step) => (
    '<div class="ob-review-row"><b>事件 ' + step.n + ' · ' + step.verb + '</b>'
    + '<span>' + step.hint + '</span></div>'
  )).join('');
}
```
替换为：
```
function renderOnboardReview() {
  if (!ui.onboardReviewBody) return;
  onboardReviewStop();
  const on = tutorialUiEnabled();
  const head = '<div class="ob-ctl">'
    + '<button type="button" class="ob-ctl-btn" data-tutorial-toggle="1">'
    + (on ? '教学提示：开' : '教学提示：关') + '</button>'
    + '<button type="button" class="ob-ctl-btn" data-tutorial-replay="1">重看（逐条）</button>'
    + '</div>'
    + '<div class="ob-ctl-note">Esc 跳当前 · 关闭只隐藏提示，不改难度</div>';
  const rows = ONBOARD_STEPS.map((step) => (
    '<div class="ob-review-row" data-ob-play="' + step.n + '">'
    + '<b>事件 ' + step.n + ' · ' + step.verb + '</b>'
    + '<span>' + step.hint + '</span></div>'
  )).join('');
  ui.onboardReviewBody.innerHTML = head + rows;
}
```

**锚点**（绑定，唯一）：
```
  // G 批：设置页"回顾教学"（只展示五层动词，不重新触发提示）
  if (ui.btnOnboardReview) ui.btnOnboardReview.addEventListener('click', renderOnboardReview);
```
替换为：
```
  // 里程碑4：回顾教学（开关 + 逐条重看；打开设置页时游戏本身已暂停）
  if (ui.btnOnboardReview) ui.btnOnboardReview.addEventListener('click', renderOnboardReview);
  if (ui.onboardReviewBody) {
    ui.onboardReviewBody.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-tutorial-toggle]');
      if (toggle) {
        setTutorialUiEnabled(!tutorialUiEnabled());
        renderOnboardReview();
        return;
      }
      const replay = event.target.closest('[data-tutorial-replay]');
      if (replay) onboardReviewPlay();
    });
  }
```

**锚点**（`closePanel` 内，唯一）：
```
function closePanel(kind) {
  if (state.mode !== kind) return false;
```
替换为：
```
function closePanel(kind) {
  if (state.mode !== kind) return false;
  if (kind === 'settings') onboardReviewStop();
```

### 块 6 · 样式：窄屏不侵入中心 + 弹窗提示行提高对比
**锚点**（`.onboard-hint` 原块，唯一）：
```
  .onboard-hint {
    position: absolute;
    right: 18px;
    top: 64px;
    transform: translate(10px, 0);
    z-index: 41;
    max-width: 190px;
```
替换为：
```
  .onboard-hint {
    position: absolute;
    right: 18px;
    top: clamp(64px, 10vh, 120px);
    transform: translate(10px, 0);
    z-index: 41;
    max-width: clamp(150px, 16vw, 190px);
```

**锚点**（`.onboard-hint.is-on` 之后，唯一）：
```
  .onboard-hint.is-on { opacity: 1; transform: translate(0, 0); }
```
替换为：
```
  .onboard-hint.is-on { opacity: 1; transform: translate(0, 0); }
  /* ≤960px：右边缘 132px，900px 宽时左边缘 758px，离开中心 60% 区（右边界 720px） */
  @media (max-width: 960px) {
    .onboard-hint { right: 10px; max-width: 132px; font-size: 12.5px; }
  }
```

**锚点**（`.ob-modal-line` 原块，唯一）：
```
    background: rgba(28, 20, 6, 0.55);
    color: #ffe7b8;
    font-size: 12.5px;
```
替换为：
```
    background: rgba(28, 20, 6, 0.78);   /* 里程碑4：最亮场景下对比度 3.3:1 → 约 6.9:1 */
    color: #ffe7b8;
    font-size: 12.5px;
```

**锚点**（紧接 `.setting-note .ob-review-row span` 之后，唯一）：
```
  .setting-note .ob-review-row span { color: rgba(255, 231, 184, 0.62); }
```
替换为：
```
  .setting-note .ob-review-row span { color: rgba(255, 231, 184, 0.62); }
  /* 里程碑4：设置页教学开关 / 重看 */
  .ob-ctl { display: flex; gap: 6px; margin: 2px 0 6px; }
  .ob-ctl-btn {
    flex: 1; padding: 4px 6px; cursor: pointer;
    border: 1px solid rgba(255, 210, 120, 0.35); border-radius: 4px;
    background: rgba(255, 210, 120, 0.08); color: #ffe7b8;
    font-size: 11px; font-family: var(--mono);
  }
  .ob-ctl-btn:hover, .ob-ctl-btn:focus-visible {
    background: rgba(255, 210, 120, 0.18); border-color: rgba(255, 210, 120, 0.6);
  }
  .ob-ctl-note { margin-bottom: 4px; color: rgba(255, 231, 184, 0.55); font-size: 10.5px; }
  .setting-note .ob-review-row.is-playing {
    background: rgba(255, 210, 120, 0.12);
    border-bottom-color: rgba(255, 210, 120, 0.55);
    box-shadow: inset 2px 0 0 #ffd166;
  }
```

### 块 7 · 自检口
在 `onboardReviewPlay` 后追加：
```
/* 验收：控制台读 __tutorialState() */
window.__tutorialState = function () {
  const r = ui.onboardHint ? ui.onboardHint.getBoundingClientRect() : null;
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  const center = { l: vw * 0.2, r: vw * 0.8, t: vh * 0.2, b: vh * 0.8 };
  const intersects = !!(r && r.width > 0
    && r.right > center.l && r.left < center.r
    && r.bottom > center.t && r.top < center.b);
  return {
    enabled: tutorialUiEnabled(),
    hintVisible: onboardHintVisible(),
    hintText: (state.onboard && state.onboard.hint) ? state.onboard.hint.text : '',
    inCenter60: intersects,
    widthPx: r ? Math.round(r.width) : 0
  };
};
```

## 3. 验收（可量化，不靠感觉）

| 断言 | 操作 | 通过条件 |
|---|---|---|
| 空格不再吃影步 | 进第一战斗房触发提示，按空格 | 提示不消失；影步正常触发；`__tutorialState().hintVisible === true` |
| Esc 跳当前 | 提示出现时按 Esc | 提示立即淡出；世界不暂停；再按 Esc 不会关闭游戏 |
| 暂停不扣时 | 提示出现后按 O 停 5 秒再关 | 剩余时间不变；提示仍在（原实现会消失） |
| 发呆不再永久关闭 | 开局 30 秒不动 | `state.meta.hintsSeen === 0`；提示仍在；击杀 1 只后才写 1 |
| 关闭只隐藏教学 | 设置里关提示，进战斗 | 教学条不出现；敌人数/血量/伤害与开提示时完全一致；楼梯/宝箱提示仍在 |
| 重看可用 | 设置里点「重看（逐条）」 | 5 行依次高亮，每行 1.6 秒；关闭设置后定时器停止（无控制台残留） |
| 默认不挡中心 | 1024×768 / 1280×720 / 1920×1080 各截一张 | `__tutorialState().inCenter60 === false` 全部成立 |
| 对比度 | 最亮场景截三选一弹窗 | 提示行 `rgba(28,20,6,0.78)`；采样对比度 ≥4.5:1（按 WCAG 公式，12.5px 正文） |
| 字数 | 逐条数 | 全部 ≤18 字（现有最长 12） |

## 4. 不做的事

- 不把教学条加进画面中心，也不加全屏遮罩；默认就是“右上角、不拦点击”。
- 不新增“下一局重新提示”按钮：设置页内已经可以逐条重看，避免多一个会写存档的入口。
- 不改 `ONBOARD_CONFIG.enabled` 的教学难度逻辑；关提示不等于关降低难度。
