# 《烬》自适应画质与低端机降级链 · 补丁文档 v1

> 主文件：`index_arcane_v2.html`（本线**未写入任何字节**）
> 补丁全部是「函数级锚点 + 整段替换/插入」，不写行号，可逐段单独回退。
> 测法：`tools/arcane_quality_ablation.js`（同进程交替配对，≥3 轮）

## 0. 口径声明（先读这一段）

1. **CPU 口径** = `update(1/60) + render()` 的 JS 耗时。看到的是「命令录制 + 对象分配」。
2. **RASTER 口径** = 每帧末尾追加一次 1px `getImageData` 强制冲刷。看到的是「像素填充 + 合成」。
   一旦做过一次读回，画布会退化到软件路径，因此该口径**只用于同进程 A/B 对比**。
3. 所有绝对值**不可引用**（无头软件光栅，和玩家真机没有可比性）；本文只报 **A→B 的差值**。
4. `|Δp95| < 2.2 ms` 一律写「不可分辨」。

## 1. 结论摘要

- **唯一同时作用于三类场景的杠杆是分辨率**：`dpr 2 → 1` 让三类场景的 p50 各降 52%–59%（同口径配对，S1 −34.1 ms / S2 −30.45 ms / S3 −36.2 ms）。
- **粒子不是提速手段**：300→150 的边际帧时间约 0.1 ms（不可分辨），只在观感与内存上有差别。中/低档保留粒子上限，是给极端机型兜底，不是指望它救帧率。
- **泛光、迷雾第二遍、视差整层都不进档位**：泛光实测低于分辨力；迷雾第二遍关掉会露出「路的虚影」（玩家此前明确反感）；视差整层要拆掉远景层次（用户明确要求「宁可只压分辨率和粒子」）。
- **降级链必须可回弹**：只降不升会「一路到底」，重开一局还是最差画质。本设计采用**快降慢升 + 双冷却 + 每局回升次数上限**。

## 2. 逐维度消融（「降一半省多少 + 玩家能否看出」）

| 维度 | 「砍一半」的做法 | 口径 / 场景 | Δp50（ms） | Δp95（ms） | 超预算帧 | 玩家能不能看出来 | 入档？ |
|---|---|---|---|---|---|---|---|
| **渲染分辨率** | `dpr 2 → 1`（像素量降到 1/4） | RASTER · S1/S2/S3 | **−34.1 / −30.45 / −36.2** | −52.87 / −32.29 / −47.07 | 三场景均大幅减少 | **能看出「整体软了一点」，但能忍**：1px 描边与远景纹理变柔；HUD 是 DOM，不受影响 | **是（低档）** |
| **渲染分辨率** | `dpr 2 → 1.5`（像素量 56%） | RASTER · S1/S2/S3 | −21.4 / −16.2 / −19.35 | −39.15 / −17.32 / −6.17（S3 噪声） | 减少 | **轻微可辨**：静态截图上能看出，实战移动中不明显 | **是（中档）** |
| 粒子上限 | `300 → 150` | CPU · S3 | −0.1 | +3.99（噪声 ±10） | −5 | **高峰期可辨**：同屏三处特效叠满时密度肉眼可见减半 | **降级链不用它做速度手段**；只保留低档 300→120 作极端机兜底 |
| 迷雾第二遍 | 两遍 → 一遍 | CPU · S3 / S2 | 0 / +0.2 | −9.77 / +4.64（噪声） | +5 / −9 | **可辨**：未探索区域会透出「路的虚影」（玩家此前已明确反感） | **否** |
| 背景泛光 | 整项关 | CPU · S3 / S2 | −0.2 / −0.5 | +9.29 / −19.53（噪声） | −14 / −20 | 几乎不可辨（静态细看才能发现边缘变硬） | **否**：低于分辨力，不省时间就没必要动 |
| 三层视差 + 雾幕 + 地面延伸带 | 整层关 | CPU · S2 | +0.2 | −6.32（噪声） | +5 | **明显可辨**：远景层次整块消失，空洞边缘变平 | **否**：用户要求不为凑档位牺牲层次 |
| 背景层刷新频率 | 隔帧重贴 | 未单测（形态推断） | < 0.1 量级 | — | — | 不可辨 | **否**：场景已预烘焙成一张图，隔帧只省一次 `drawImage` |
| 冲刺残影等渐隐 | 关 | 未测（默认关） | — | — | — | **开着的玩家一眼可辨** | **否**：不参与自动链 |

> 关于 S3 的 p95 尖峰：里程碑 1 里 S3 曾出现 45 ms 级 p95，本轮用「300 粒 vs 150 粒」配对复测时，
> Δp95 落在 ±10 ms 的噪声带内，**不能归因于粒子数量**。更可能的原因是采样方式本身：
> 测试场景每帧都在补足粒子（持续 new 对象），制造了额外 GC；真实战斗的粒子是事件驱动，不会每帧补满。
> 所以本报告**不把粒子列为 S3 的根因**，S3 的卡顿按「分辨率主导 + 偶发 GC」处理。

判读规则：
- 「降一半」= 该维度砍掉 50%（分辨率按像素总量 dpr 2→1 = 降到 1/4；粒子 300→150；迷雾两遍→一遍；泛光/视差是整项关）。
- 「玩家能否看出」按**静态可辨 / 动效中可辨 / 高峰期可辨 / 不可辨**四档给，而不是只看毫秒。

## 3. 三档参数与目标帧时间

| 档位 | 渲染分辨率上限 | 粒子上限 | 迷雾第二遍 | 泛光 / 视差 | 目标帧时间 | 触发降到此档的条件 |
|---|---|---|---|---|---|---|
| 高 | `dprCap 2`（原样） | 300（原样） | 开（原样） | 不动 | 16.7 ms（60fps） | 默认 / 手动选高 |
| 中 | `dprCap 1.5` | 220 | 开 | 不动 | 16.7 ms 目标，允许 p95 ≤ 25 ms | 高档连续 2 次评估掉帧率 ≥ 15% |
| 低 | `dprCap 1` | 120 | 开 | 不动 | 33.3 ms（30fps 可玩） | 中档连续 2 次评估掉帧率 ≥ 28% |

为什么中档是 1.5 而不是 1.25：dpr 1.5 的像素总量是 dpr 2 的 56%，观感上只是「轻微变软」；dpr 1.25 省得不多、却已经开始看得见线宽抖动。

关于粒子：实测「300→150」的边际帧时间只有约 0.1 ms（不可分辨），所以**粒子不是提速手段**。
中/低档仍保留 220/120 的上限，理由只有两个：极端机型减少每帧分配与峰值密度。
如果玩家反馈「打起来变稀」，把中档回调到 300、低档回调到 240 即可，**帧时间结论不受影响（±0.1 ms）**。

## 4. 三档同场景帧时间对照（差值，绝对值不可引用）

测法：`tools/arcane_quality_tiers.js`，1280×720 视口，**一格一页面**（页内不切条件），同进程按
`高→中→低 / 低→中→高` 交替跑 3 轮，每格 30 帧、每帧强制光栅冲刷。

| 场景 | 高档 p50 / p95 | 中档 p50 / p95 | 低档 p50 / p95 | 高档→中档 Δ | 高档→低档 Δ |
|---|---|---|---|---|---|
| S1 开局第一层（5 敌） | 61.25 / 84.78 | 39.85 / 45.63 | 27.15 / 31.91 | p50 **−21.4（−35%）** / p95 −39.15 | p50 **−34.1（−56%）** / p95 −52.87 |
| S2 同屏最多（9 敌） | 58.50 / 72.51 | 42.30 / 55.19 | 28.05 / 40.22 | p50 **−16.2（−28%）** / p95 −17.32 | p50 **−30.45（−52%）** / p95 −32.29 |
| S3 特效最密（9 敌 + 297 粒） | 61.50 / 77.18 | 42.15 / 71.01 | 25.30 / 30.11 | p50 **−19.35（−31%）** / p95 −6.17（噪声） | p50 **−36.2（−59%）** / p95 −47.07 |

读表注意：
1. **绝对值不可引用**：这是无头软件光栅，数值比真机大 5–10 倍；只读同一行的差值。
2. 高档三场景 p50 落在 58.5–61.5 ms 的窄带里 → **瓶颈是共同的填充成本，不是某个场景专属**。
3. 每轮 p50 波动范围：高档 50.4–69.95、中档 36.3–54.45、低档 24.85–30.6；档间差值远大于轮间波动。
4. S3 中档的 p95 只降 6.17 ms：这一格 p95 被读回尖峰主导，**p95 单独看不足以判档**，以 p50 + 轮间稳定性为准。
5. 真机 GPU 的填充占比低于软件光栅，所以「−30% / −55%」应理解为**收益上限**；方向一致，幅度会更小。

## 5. 自动降级链

### 5.1 采样

- 用主循环里已有的 `requestAnimationFrame` 时间戳，滑动窗口 **120 帧**，每 **0.5 s** 评估一次。
- 单帧间隔 > 200 ms（切后台、断帧）直接丢弃，不参与统计。
- 开局 **3 s** 内不评估（首层烘焙 / 贴图上传会制造一次性尖峰，不能当掉帧）。
- 「掉帧」定义：帧间隔 > `median(窗口) × 1.5`，且 > 20 ms。用中位数做基准，是为了让 30Hz 屏不会被误判成「一直掉帧」。

### 5.2 降档（快）

- 高档：掉帧帧占比 ≥ 15%，且**连续 2 次评估**都成立 → 降中档。
- 中档：掉帧帧占比 ≥ 28%，连续 2 次成立 → 降低档。
- 低档：不再降。
- 降档后 **15 s 内不再改档**（冷却）。

### 5.3 升档（慢，必须有回弹）

- 掉帧帧占比 ≤ 3%，且**连续 4 次评估**（约 2 s）都干净 → 升一档。
- 距最近一次降档 ≥ **20 s**，且距最近一次任何改档 ≥ **10 s**。
- **每局最多回升 2 次**，防止在临界负载上反复抖。
- 满足条件也只升一档，下一次升档要重新攒够 4 次干净评估。

### 5.4 重置

- `startGame()` 开局时清空窗口与计数：手动锁定档 → 保持；自动 → 回到「起始档」（默认高）。
  这样**重开一局不会直接坐在最低画质上**。

## 6. 手动三档（覆盖自动 + 存档）

- 设置面板新增一行「画质档位 · 自动 / 高 / 中 / 低」。
- 点「高 / 中 / 低」→ `meta.quality.auto = false`，写入存档，立即按该档重建画布。
- 点「自动」→ `meta.quality.auto = true`，从 `meta.quality.tier`（上次手动档）开始跑降级链。
- 面板文案同时显示「当前实际档」，让玩家看得见自动降到了哪一档。

## 7. 补丁清单（函数级锚点，逐段可回退）

### 7.1 新增配置与工具函数

锚点：`const PERF_CONFIG = {` 这一段**之后**插入：

```js
/* ============================================================
   自适应画质三档（QUALITY_CONFIG）
   ------------------------------------------------------------
   只压两个维度：渲染分辨率上限、粒子硬上限。
   不碰泛光 / 视差 / 迷雾第二遍（实测低于分辨力，或会牺牲层次）。
   enabled=false 时所有函数回退到原行为（dpr 上限 2 / 粒子 300）。
   ============================================================ */
const QUALITY_CONFIG = {
  enabled: true,
  tiers: {
    high: { id: 'high', name: '高', dprCap: 2, particleCap: 300 },
    mid: { id: 'mid', name: '中', dprCap: 1.5, particleCap: 220 },
    low: { id: 'low', name: '低', dprCap: 1, particleCap: 120 }
  },
  /* 自动降级参数（全部可调，改这里不用碰逻辑） */
  windowFrames: 120,        // 滑动窗口帧数
  evalEveryMs: 500,         // 评估间隔
  slowMul: 1.5,             // 帧间隔 > 窗口中位数 × 该倍数 → 掉帧
  slowMinMs: 20,            // 且必须 > 20ms，防噪声
  graceMs: 3000,            // 开局 3 秒不评估
  downRatio: { high: 0.15, mid: 0.28 },
  downChecks: 2,
  upRatio: 0.03,
  upChecks: 4,
  downCooldownMs: 15000,
  upCooldownMs: 10000,
  upAfterDownMs: 20000,
  maxUpsPerRun: 2
};

/* 运行时状态（不进存档，不参与序列化） */
const QUALITY_RUNTIME = {
  frames: [], lastNow: 0, lastEval: 0, badChecks: 0, okChecks: 0,
  lastChangeAt: 0, lastDownAt: 0, ups: 0, runStartAt: 0
};

/**
 * 当前生效档（自动模式由 QUALITY_RUNTIME 推导，手动模式由存档决定）
 * @returns {'high'|'mid'|'low'} 档位 id
 */
function qualityTierId() {
  if (!QUALITY_CONFIG.enabled) return 'high';
  const id = state && state.qualityTier;
  return QUALITY_CONFIG.tiers[id] ? id : 'high';
}

/**
 * 当前档的配置
 * @returns {{id:string,name:string,dprCap:number,particleCap:number}} 档配置
 */
function qualityTierCfg() {
  return QUALITY_CONFIG.tiers[qualityTierId()];
}

/**
 * 渲染分辨率上限（替换原来的 Math.min(devicePixelRatio, 2)）
 * @returns {number} 本次 resize / render 应使用的 dpr
 */
function qualityRenderDpr() {
  const cap = qualityTierCfg().dprCap;
  return Math.min(window.devicePixelRatio || 1, cap);
}

/**
 * 粒子硬上限（与旧性能模式的 0.45 倍率叠加，不互相覆盖）
 * @returns {number} 上限条数
 */
function qualityParticleCap() {
  const base = qualityTierCfg().particleCap;
  return perfParticleScale() < 1 ? Math.round(base * perfParticleScale()) : base;
}

/**
 * 应用一个档位（重建画布 + 刷新面板）
 * @param {'high'|'mid'|'low'} id 档位
 * @param {boolean} persist 是否写入存档（手动切换才写）
 * @returns {void}
 */
function applyQualityTier(id, persist) {
  const next = QUALITY_CONFIG.tiers[id] ? id : 'high';
  state.qualityTier = next;
  if (persist && state.meta && state.meta.quality) {
    state.meta.quality.tier = next;
    saveMeta();
  }
  resizeCanvas();
  renderQualityState();
}

/**
 * 手动切换：自动 / 高 / 中 / 低
 * @param {'auto'|'high'|'mid'|'low'} id 选项
 * @returns {void}
 */
function setQualityChoice(id) {
  if (!state.meta.quality) state.meta.quality = { auto: true, tier: 'high' };
  if (id === 'auto') {
    state.meta.quality.auto = true;
    saveMeta();
    /* 不跳档：从当前实际档开始让降级链接管，避免切回自动时画面突然变糊/变清 */
    applyQualityTier(qualityTierId(), false);
    showToast('画质：自动（' + qualityTierCfg().name + '档起步）', 'success');
    return;
  }
  state.meta.quality.auto = false;
  state.meta.quality.tier = id;
  saveMeta();
  applyQualityTier(id, false);
  showToast('画质：已锁定 ' + qualityTierCfg().name + '档', 'success');
}

/**
 * 开局重置自动链（startGame 内调用）
 * @returns {void}
 */
function qualityOnRunStart() {
  QUALITY_RUNTIME.frames.length = 0;
  QUALITY_RUNTIME.badChecks = 0;
  QUALITY_RUNTIME.okChecks = 0;
  QUALITY_RUNTIME.lastNow = 0;
  QUALITY_RUNTIME.lastEval = 0;
  QUALITY_RUNTIME.lastChangeAt = 0;
  QUALITY_RUNTIME.lastDownAt = 0;
  QUALITY_RUNTIME.ups = 0;
  QUALITY_RUNTIME.runStartAt = performance.now();
  const q = state.meta.quality || { auto: true, tier: 'high' };
  /* 自动：每局从高档起步，把降级链重新跑一遍；手动：直接坐在玩家锁定的档 */
  applyQualityTier(q.auto ? 'high' : q.tier, false);
}

/**
 * 自动降级链（主循环每帧调用，内部自己节流）
 * @param {number} now requestAnimationFrame 时间戳
 * @returns {void}
 */
function qualityTick(now) {
  if (!QUALITY_CONFIG.enabled || !state || !state.meta) return;
  const q = state.meta.quality;
  if (!q || !q.auto) return;                       // 手动锁定 → 完全不自动
  if (state.mode !== 'playing' || crashState.halted) return;
  const R = QUALITY_RUNTIME;
  if (!R.runStartAt) R.runStartAt = now;
  if (now - R.runStartAt < QUALITY_CONFIG.graceMs) return;
  if (!R.lastNow) { R.lastNow = now; return; }
  const dt = now - R.lastNow;
  R.lastNow = now;
  if (dt <= 0 || dt > 200) return;                 // 切后台 / 断帧
  R.frames.push(dt);
  if (R.frames.length > QUALITY_CONFIG.windowFrames) R.frames.shift();
  if (R.frames.length < 60) return;
  if (now - R.lastEval < QUALITY_CONFIG.evalEveryMs) return;
  R.lastEval = now;

  const sorted = R.frames.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const slowMs = Math.max(QUALITY_CONFIG.slowMinMs, median * QUALITY_CONFIG.slowMul);
  const slowRatio = R.frames.filter((v) => v > slowMs).length / R.frames.length;

  const tier = qualityTierId();
  const downAt = QUALITY_CONFIG.downRatio[tier];
  if (downAt != null && slowRatio >= downAt) { R.badChecks += 1; R.okChecks = 0; }
  else { R.badChecks = 0; if (slowRatio <= QUALITY_CONFIG.upRatio) R.okChecks += 1; else R.okChecks = 0; }

  if (now - R.lastChangeAt < QUALITY_CONFIG.downCooldownMs) return;

  if (R.badChecks >= QUALITY_CONFIG.downChecks && tier !== 'low') {
    const next = tier === 'high' ? 'mid' : 'low';
    R.lastChangeAt = now;
    R.lastDownAt = now;
    R.badChecks = 0;
    applyQualityTier(next, false);
    return;
  }

  if (R.okChecks >= QUALITY_CONFIG.upChecks && tier !== 'high'
      && now - R.lastDownAt >= QUALITY_CONFIG.upAfterDownMs
      && now - R.lastChangeAt >= QUALITY_CONFIG.upCooldownMs
      && R.ups < QUALITY_CONFIG.maxUpsPerRun) {
    const next = tier === 'low' ? 'mid' : 'high';
    R.lastChangeAt = now;
    R.okChecks = 0;
    R.ups += 1;
    applyQualityTier(next, false);
  }
}

/**
 * 刷新设置面板的档位按钮与文案
 * @returns {void}
 */
function renderQualityState() {
  const q = (state && state.meta && state.meta.quality) || { auto: true, tier: 'high' };
  const cur = qualityTierId();
  if (ui.qualitySeg) {
    ui.qualitySeg.querySelectorAll('[data-quality]').forEach((btn) => {
      const id = btn.getAttribute('data-quality');
      const on = id === 'auto' ? !!q.auto : (!q.auto && q.tier === id);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  if (ui.qualityStateText) {
    ui.qualityStateText.textContent = (q.auto ? '自动 · 当前 ' : '手动 · ') + qualityTierCfg().name + '档'
      + '（分辨率 ×' + qualityTierCfg().dprCap + ' / 粒子 ' + qualityTierCfg().particleCap + '）';
  }
}
```

### 7.2 存档字段

锚点：`function defaultMeta()` 内的 `performance: { mode: false },` 这一行**之后**插入：

```js
    /* 自适应画质：auto=true 走降级链；tier 是手动锁定档 / 自动起始档 */
    quality: { auto: true, tier: 'high' },
```

锚点：`function normalizeMeta(raw)` 内的 `base.performance = { mode: rawPerf.mode === true };` 这一行**之后**插入：

```js
  const rawQuality = raw.quality && typeof raw.quality === 'object' ? raw.quality : {};
  base.quality = {
    auto: rawQuality.auto !== false,
    tier: QUALITY_CONFIG.tiers[rawQuality.tier] ? rawQuality.tier : 'high'
  };
```

### 7.3 分辨率这一路（两处，缺一不可）

锚点：`function resizeCanvas()` 首行 `const dpr = Math.min(window.devicePixelRatio || 1, 2);` → 改为：

```js
  const dpr = qualityRenderDpr();
```

锚点：`function render()` 首段同样的 `const dpr = Math.min(window.devicePixelRatio || 1, 2);` → 改为：

```js
  const dpr = qualityRenderDpr();
```

> 这两处必须同时改：只改 `resizeCanvas` 会让画布尺寸和绘制变换不一致（画面会被二次缩放）。

### 7.4 粒子硬上限（两处同改）

锚点：两处 `if (state.particles.length > 300) {` 与 `state.particles.splice(0, state.particles.length - 300);` → 改为：

```js
  const cap = qualityParticleCap();
  if (state.particles.length > cap) {
    // 超出上限：把最老的粒子回收进池子（而不是直接丢掉，方便下次复用）
    const dropped = state.particles.splice(0, state.particles.length - cap);
    dropped.forEach(releaseParticle);
  }
```

### 7.5 主循环挂钩

锚点：`function loop(now)` 里的「帧率采样」块（`perfState.frames += 1;` 那一段）**之后**插入：

```js
  // 自适应画质：内部按 windowFrames / evalEveryMs 自行节流
  qualityTick(now);
```

### 7.6 开局重置

锚点：`function startGame()` 内的 `applyPerfMode();` 这一行**之后**插入：

```js
  qualityOnRunStart();
```

### 7.7 设置面板 UI

锚点：设置页 HTML 中 `id="perfToggle"` 所在的 `.setting-row` 整块**之后**插入：

```html
          <div class="setting-row">
            <label id="qualityTierLabel">画质档位</label>
            <div id="qualityTierSeg" role="group" aria-labelledby="qualityTierLabel" style="display:flex;gap:6px">
              <button type="button" class="seg-btn" data-quality="auto" aria-pressed="true">自动</button>
              <button type="button" class="seg-btn" data-quality="high" aria-pressed="false">高</button>
              <button type="button" class="seg-btn" data-quality="mid" aria-pressed="false">中</button>
              <button type="button" class="seg-btn" data-quality="low" aria-pressed="false">低</button>
            </div>
            <span class="setting-state" id="qualityStateText">自动 · 当前 高档</span>
          </div>
```

锚点：CSS 中 `.setting-state { font-family: var(--mono); font-size: var(--fs-xs); color: var(--text-3); }` 这一条**之后**插入：

```css
  .seg-btn { padding: 2px 10px; border-radius: 6px; border: 1px solid rgba(120, 220, 255, .28);
    background: rgba(8, 20, 32, .6); color: #cfe9ff; font: 700 11px/1.6 "Microsoft YaHei UI", sans-serif; cursor: pointer; }
  .seg-btn[aria-pressed="true"] { background: rgba(47, 208, 255, .22); border-color: rgba(47, 208, 255, .6); color: #eaffff; }
```

锚点：`ui.perfToggle = document.getElementById('perfToggle');` 这一行**之后**插入：

```js
  /* 自适应画质三档（自动 / 高 / 中 / 低） */
  ui.qualitySeg = document.getElementById('qualityTierSeg');
  ui.qualityStateText = document.getElementById('qualityStateText');
```

锚点：设置页事件绑定里 `if (ui.perfToggle) {` 这一块**之后**插入：

```js
  if (ui.qualitySeg) {
    ui.qualitySeg.querySelectorAll('[data-quality]').forEach((btn) => {
      btn.addEventListener('click', () => setQualityChoice(btn.getAttribute('data-quality')));
    });
  }
```

### 7.8 启动时应用一次

锚点：已有的 `applyPerfMode();` 调用处（初始化流程里那一次）**之后**插入：

```js
  applyQualityTier((state.meta.quality && state.meta.quality.tier) || 'high', false);
```

> 这一段和 7.6 的差别：7.8 只负责「页面加载后先把档位落到画布上」，7.6 负责「每局开局重置自动链」。

## 8. 回退方式

- 任一 7.x 段落单独删掉即可回退；7.3 的两处必须成对，7.4 的两处必须成对。
- 想把整条链一次性停掉：把 `QUALITY_CONFIG.enabled` 改为 `false`，所有函数回退到「dpr 上限 2 / 粒子 300」，与改造前逐字节等价。

## 9. 验收脚本

- 消融/对照：`node tools/arcane_quality_ablation.js --frames 150 --rounds 3`
- 分段补测：`--only=高档→中档` / `--only=2→1.5` / `--only=粒子上限`
- 产物：`.screenshots/perf/quality-ablation.json`（含每轮的 a/b 与差值，绝对值标注不可引用）
