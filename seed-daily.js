/* ============================================================================
   《烬》· 种子与每日挑战 · 补差模块（P2-3）
   ----------------------------------------------------------------------------
   粘贴位置：主文件 index_arcane_v2.html 最末尾，init(); 之后、脚本结束标签之前。
   设计原则：不重写已有种子实现（每层独立流 (seed,'floor:N') 与 playRngState 读档接回
   都保持原样），本模块只补 7 条差距：
     1) 8 位种子（6 位主体 + 2 位校验）
     2) 校验失败明确拒绝
     3) 随机生成 / 复制本局种子
     4) 每日挑战“首次成绩锁定 + 最佳只展示”
     5) 每日成绩只写每日记录，不写 meta.bestFloor（死亡/成就/结晶照常累计）
     6) 三选一 / 宝箱奖励改走独立选择流；生存房按 (seed, floor, wave) 独立小流
     7) 表现层 rand() 全部改回 Math.random（配合补丁里的 19 处函数内遮蔽）
   关闭方式：SEED8_CONFIG.enabled = false 即回到旧行为。
   ============================================================================ */
(function installSeedDailyPatch() {
  'use strict';

  if (window.__seedDailyPatchInstalled) return;
  window.__seedDailyPatchInstalled = true;

  /* ---------------------------------------------------------------- 配置区 */
  const SEED8_CONFIG = {
    enabled: true,
    baseDigits: 6,          // 主体：6 位数字（000000–999999）
    checkDigits: 2,         // 校验：2 位数字（00–96）
    totalDigits: 8,
    weights: [3, 5, 7, 11, 13, 17], // 每位数字的加权（质数，避免简单错位抵消）
    mod: 97,                // 校验模数：97 是质数，两位校验值分布最均匀
    maxDailyRecords: 400    // 每日记录最多保留 400 天
  };
  const DAILY_CONFIG = {
    enabled: true,
    firstLocked: true       // true = 首次成绩锁定；false = 只记最佳（回退用）
  };
  /* 每日挑战难度基准 ------------------------------------------------------------
     为什么必须钉死：主文件的「教学层 / 老档跳过」判断读的是玩家自己的
     meta.bestFloor（>=5 视为老玩家，跳过教学难度）。这会让高手和新人
     在同一天、同一个种子上打到两个不同的难度，排行榜在数学上不成立。
     这里把每日局的“进度参照”换成按日期派生的固定基准，普通种子局不变。
     baselineFloor = null → 按日期派生 1–4（永远 < skipBestFloor=5，
     即所有玩家统一走同一条难度曲线）；也可以显式写死成某个值。 */
  const DAILY_DIFF_CONFIG = {
    enabled: true,
    baselineFloor: null,   // null = 按日期派生；数字 = 强制钉死
    deriveRange: 4         // 派生范围 1..4（保证低于 ONBOARD_CONFIG.skipBestFloor）
  };
  /* 每日挑战 · 封存规则（裁决：固定普通档 + ascension 0 + 满解锁池）
     目的：让同一天、同一个种子对全服是同一局，排行榜只比操作。
     - ascension 0：永久进阶是难度修正，不同档位不是同一个局
     - 固定普通档：难度档由玩家自选，必须封存
     - 满解锁池：不是清零。所有玩家拿到的卡池一致；新玩家还能在每日里试玩
       未解锁系统，但每日里的“试玩解锁”不会落到账号上（见 unlock 覆盖） */
  const DAILY_SANDBOX_CONFIG = {
    enabled: true,
    ascension: 0,
    difficulty: 'normal',
    fullUnlocks: true
  };

  /* ------------------------------------------------------------ 8 位种子工具 */

  /**
   * 计算 6 位主体的 2 位校验码
   * @param {string} base6 6 位数字字符串
   * @returns {string} 2 位校验码（例："07"）
   */
  function seedChecksum6(base6) {
    let sum = 0;
    for (let i = 0; i < SEED8_CONFIG.baseDigits; i += 1) {
      sum += (Number(base6.charAt(i)) || 0) * SEED8_CONFIG.weights[i];
    }
    return String(sum % SEED8_CONFIG.mod).padStart(SEED8_CONFIG.checkDigits, '0');
  }

  /**
   * 把 6 位主体编码成 8 位完整种子
   * @param {string} base6 6 位数字
   * @returns {string} 8 位数字
   */
  function encodeSeed8(base6) {
    const base = String(base6).padStart(SEED8_CONFIG.baseDigits, '0').slice(0, SEED8_CONFIG.baseDigits);
    return base + seedChecksum6(base);
  }

  /**
   * 随机生成一颗合法 8 位种子（只在“生成种子”这一刻用随机，不进入玩法流）
   * @returns {string} 8 位数字
   */
  function makeRandomSeed8() {
    let base = '';
    for (let i = 0; i < SEED8_CONFIG.baseDigits; i += 1) {
      base += String(Math.floor(Math.random() * 10));
    }
    return encodeSeed8(base);
  }

  /**
   * 校验玩家输入 / 粘贴的种子
   * @param {string} raw 原始输入（允许空格、连字符）
   * @returns {{ok:boolean, value?:string, reason?:string, message?:string}}
   */
  function validateSeed8(raw) {
    if (!SEED8_CONFIG.enabled) return { ok: true, value: String(raw == null ? '' : raw).trim() };
    // 清洗：去掉空白 / 连字符 / 下划线，只留数字
    const text = String(raw == null ? '' : raw).replace(/[\s\-_]/g, '');
    if (text.length !== SEED8_CONFIG.totalDigits || !/^\d{8}$/.test(text)) {
      return { ok: false, reason: 'format', message: '种子必须是 8 位数字（6 位主体 + 2 位校验）' };
    }
    const base = text.slice(0, SEED8_CONFIG.baseDigits);
    const check = text.slice(SEED8_CONFIG.baseDigits);
    if (seedChecksum6(base) !== check) {
      return { ok: false, reason: 'checksum', message: '种子校验失败：请检查是否抄错一位数字' };
    }
    return { ok: true, value: text };
  }

  /**
   * 用本地日期生成每日挑战的 8 位种子（同一天全服一致）
   * 主体取 YYMMDD（例：2026-11-08 → 261108），再补 2 位校验。
   * @param {Date} [date] 指定日期
   * @returns {string} 8 位数字
   */
  function dailySeed8(date) {
    const key = localDateKey(date);      // YYYYMMDD
    return encodeSeed8(key.slice(2));    // YYMMDD + 校验
  }

  /* -------------------------------------------------------------- 每日记录 */

  /**
   * 确保 meta 上有每日记录容器
   * @param {Object} meta 永久存档
   * @returns {Object} 每日记录表（key = YYYYMMDD）
   */
  function ensureDailyStore(meta) {
    if (!meta.dailyRuns || typeof meta.dailyRuns !== 'object') meta.dailyRuns = {};
    return meta.dailyRuns;
  }

  /**
   * 取某天的每日记录（不存在返回 null）
   * @param {string} dateKey YYYYMMDD
   * @returns {Object|null}
   */
  function dailyRecordOf(dateKey) {
    const store = ensureDailyStore(state.meta);
    return store[dateKey] || null;
  }

  /**
   * 当前这局每日挑战对应的日期键（跨午夜时仍记在开局那天）
   * @returns {string} YYYYMMDD
   */
  function currentDailyDateKey() {
    if (state && state.seedInfo && state.seedInfo.dailyDateKey) return state.seedInfo.dailyDateKey;
    return localDateKey();
  }

  /**
   * 今日记录（用真实今天，不看跨夜局）
   * @returns {Object|null}
   */
  function dailyRecordToday() {
    return dailyRecordOf(localDateKey());
  }

  /**
   * 今天是否已完成每日挑战（首次成绩已落下）
   * @returns {boolean}
   */
  function dailyCompletedToday() {
    const rec = dailyRecordToday();
    return !!(rec && rec.first);
  }

  /**
   * 比较两个每日成绩，a 是否优于 b（层数 > 用时短 > 击杀多）
   * @param {Object} a 成绩
   * @param {Object} b 成绩
   * @returns {boolean}
   */
  function dailyScoreBetter(a, b) {
    if (!b) return true;
    if ((a.floor || 0) > (b.floor || 0)) return true;
    if ((a.floor || 0) < (b.floor || 0)) return false;
    if ((a.time || 0) < (b.time || 0)) return true;
    if ((a.time || 0) > (b.time || 0)) return false;
    return (a.kills || 0) > (b.kills || 0);
  }

  /**
   * 建立/获取某天的记录骨架
   * @param {string} dateKey YYYYMMDD
   * @param {string} [seed] 8 位种子
   * @returns {Object} 记录对象
   */
  function dailyRecordEnsure(dateKey, seed) {
    const store = ensureDailyStore(state.meta);
    let rec = store[dateKey];
    if (!rec) {
      rec = { date: dateKey, seed: seed || dailySeed8(), first: null, best: null, attempts: 0, lastAt: 0 };
      store[dateKey] = rec;
    }
    if (seed && !rec.seed) rec.seed = seed;
    return rec;
  }

  /**
   * 开局时累计每日尝试次数（不改成绩）
   * @returns {void}
   */
  function dailyTouchRun() {
    if (!DAILY_CONFIG.enabled || !state || !state.seedInfo || !state.seedInfo.daily) return;
    const rec = dailyRecordEnsure(currentDailyDateKey(), state.seedInfo.value);
    rec.attempts = Math.max(0, Number(rec.attempts) || 0) + 1;
    rec.lastAt = Date.now();
    trimDailyRecords(state.meta);
    saveMeta();
  }

  /**
   * 结算时写入每日成绩：首次锁定，最佳单独更新
   * @param {Object} opts { cleared:boolean }
   * @returns {void}
   */
  function dailyRecordRun(opts) {
    if (!DAILY_CONFIG.enabled || !state || !state.seedInfo || !state.seedInfo.daily) return;
    const o = opts || {};
    const dateKey = currentDailyDateKey();
    const rec = dailyRecordEnsure(dateKey, state.seedInfo.value);
    const score = {
      floor: Math.max(1, Math.floor(Number(state.floor) || 1)),
      time: Math.max(0, Math.round(Number(state.elapsed) || 0)),
      kills: Math.max(0, Math.floor(Number(state.kills) || 0)),
      cleared: !!o.cleared
    };
    // 首次成绩：只写一次，之后重玩不覆盖
    if (!rec.first) {
      rec.first = Object.assign({ at: Date.now() }, score);
    }
    // 最佳成绩：只用于展示，不参与“首次”排名
    if (dailyScoreBetter(score, rec.best)) {
      rec.best = { floor: score.floor, time: score.time, kills: score.kills, cleared: score.cleared };
    }
    rec.lastAt = Date.now();
    trimDailyRecords(state.meta);
    saveMeta();
  }

  /**
   * 修剪每日记录，避免存档无限膨胀
   * @param {Object} meta 永久存档
   * @returns {void}
   */
  function trimDailyRecords(meta) {
    const store = ensureDailyStore(meta);
    const keys = Object.keys(store);
    if (keys.length <= SEED8_CONFIG.maxDailyRecords) return;
    keys.sort((a, b) => (store[b].lastAt || 0) - (store[a].lastAt || 0))
      .slice(SEED8_CONFIG.maxDailyRecords)
      .forEach((key) => { delete store[key]; });
  }

  /* ------------------------------------------------------ 玩法 / 表现层边界 */

  /**
   * 每日局不写普通最佳楼层（每日的层数/用时/击杀只进每日记录）
   * 非每日局照常写，语义与原实现一致。
   * @param {number} value 到达楼层
   * @returns {void}
   */
  function noteBestFloor(value) {
    if (!state || !state.meta) return;
    if (state.seedInfo && state.seedInfo.daily) return; // 每日挑战成绩隔离
    const v = Math.max(0, Math.floor(Number(value) || 0));
    state.meta.bestFloor = Math.max(Number(state.meta.bestFloor) || 0, v);
  }

  /**
   * 表现层专用随机：不推进任何玩法流
   * （补丁把 19 个纯视觉函数的 rand 遮蔽成它）
   * @param {number} min 最小值
   * @param {number} max 最大值
   * @returns {number}
   */
  function fxRange(min, max) {
    return min + Math.random() * (max - min);
  }

  /**
   * 每日挑战的难度基准楼层（同一天全服同一个值）
   * - 显式配置 DAILY_DIFF_CONFIG.baselineFloor 时直接用；
   * - 否则由日期键派生：1 + (YYYYMMDD 数字 % 4)，范围 1–4。
   * 目的：替代玩家自己的 meta.bestFloor，让每日局难度与账号进度无关。
   * @param {string} [dateKey] 日期键，缺省用本局开局日期
   * @returns {number} 基准楼层（≥1）
   */
  function dailyBaselineFloor(dateKey) {
    if (DAILY_DIFF_CONFIG.baselineFloor != null) {
      return Math.max(1, Math.floor(Number(DAILY_DIFF_CONFIG.baselineFloor) || 1));
    }
    const key = String(dateKey || currentDailyDateKey() || '');
    const digits = key.replace(/\D/g, '');
    const n = digits ? Number(digits) : 0;
    const range = Math.max(1, Math.floor(Number(DAILY_DIFF_CONFIG.deriveRange) || 4));
    return 1 + (Math.abs(n) % range);
  }

  /**
   * 难度参照楼层：唯一允许读取“玩家历史最佳”的地方
   * - 每日局：返回按日期派生的基准（完全不读 meta.bestFloor）
   * - 普通局：返回 meta.bestFloor，保持“难度随账号进度增长”
   * 主文件里两处 onboardSkipAll 快照都必须走这里（补丁已替换）。
   * @returns {number}
   */
  function onboardProgressFloor() {
    if (!state) return 1;
    if (DAILY_DIFF_CONFIG.enabled && state.seedInfo && state.seedInfo.daily) {
      return dailyBaselineFloor(state.seedInfo.dailyDateKey);
    }
    return Math.max(1, Number(state.meta && state.meta.bestFloor) || 1);
  }

  /**
   * 三选一 / 宝箱奖励的独立选择流
   * 只有种子局存在 choiceRng；无种子局保持旧的 Math.random 行为。
   * @returns {number} 0–1
   */
  function choiceRandom() {
    if (state && state.choiceRng) return state.choiceRng();
    return Math.random();
  }

  /**
   * 生存房按 (seed, floor, wave) 派生独立小流
   * 同一波的第 k 次随机固定，不受帧率 / 击杀顺序影响。
   * @returns {number} 0–1
   */
  function survivalRandom() {
    if (!state || !state.seedInfo || !state.seedInfo.active || !state.seedInfo.value) {
      return Math.random();
    }
    const wave = (state.survival && state.survival.waves) || 0;
    if (!state._survivalRng
      || state._survivalRngWave !== wave
      || state._survivalRngFloor !== state.floor) {
      state._survivalRng = makeSeedRng(state.seedInfo.value, 'survival:' + state.floor + ':' + wave);
      state._survivalRngWave = wave;
      state._survivalRngFloor = state.floor;
    }
    return state._survivalRng();
  }

  /**
   * E1 预埋：清层额外一次三选一
   * ------------------------------------------------------------
   * 为什么现在就要写：E1（F1 清层额外给一次三选一）落地后会多消耗一次选择随机。
   * 如果它复用共享选择流，后面每一层的三选一都会被整体平移，
   * 到时候分不清是 E1 的问题还是断言的问题。
   * 这里给出推荐实现：额外那次走 (seed,'choice:e1:floor:N') 独立流，
   * 不影响共享 choiceRng 游标，因此“多出的只有这一次选卡”。
   * 主线的 E1 只要把 E1_CONFIG.enabled 打开，断言会自动切到“真实模式”。
   * @param {number} floorNumber 楼层
   * @param {boolean} [force] true = 即使 E1 未启用也执行（断言模拟用）
   * @returns {string|null} "a|b|c"，无法执行时返回 null
   */
  function e1ExtraChoice(floorNumber, force) {
    if (!state || !state.seedInfo || !state.seedInfo.active || !state.seedInfo.value) return null;
    if (!force && !(window.E1_CONFIG && window.E1_CONFIG.enabled)) return null;
    const saved = state.choiceRng;
    let opts = [];
    try {
      // 临时换成“额外选卡”专属流，抽完立刻还原共享游标
      state.choiceRng = makeSeedRng(state.seedInfo.value, 'choice:e1:floor:' + floorNumber);
      opts = buildRewardOptions('skill');
    } finally {
      state.choiceRng = saved;
    }
    return opts.map((o) => (o.key || o.id || o.name)).join('|');
  }

  /**
   * 给历史种子记录打“旧格式”角标
   * 旧记录（daily-YYYYMMDD / 任意文本种子）只读保留但仍是 13 字符，
   * 不加标记玩家会以为数据丢了。这里只在标题页列表的展示层加标记。
   * @returns {void}
   */
  function markLegacySeedChips() {
    if (!ui || !ui.seedRecords) return;
    Array.prototype.forEach.call(ui.seedRecords.querySelectorAll('.seed-rec'), (chip) => {
      if (chip.querySelector('.seed-rec-legacy')) return;
      const token = String(chip.textContent || '').replace(/^今日\s+/, '').split(' · ')[0].trim();
      if (/^\d{8}$/.test(token)) return;
      const badge = document.createElement('i');
      badge.className = 'seed-rec-legacy';
      badge.textContent = '旧格式';
      badge.title = '旧版本种子（只读保留）：不影响新开局，新种子统一为 8 位数字';
      badge.style.cssText = 'margin-left:6px;padding:0 5px;border-radius:6px;font-style:normal;'
        + 'font-size:11px;line-height:16px;border:1px solid rgba(160,170,190,.5);color:#a9b4c8';
      chip.appendChild(badge);
    });
  }

  /* ------------------------------------------------------------ 函数级补差 */

  // 1) 把种子写进 state 时，额外建立“选择流”
  const baseApplySeedToState = applySeedToState;
  applySeedToState = function (seed, opts) {
    baseApplySeedToState(seed, opts);
    if (!state || !state.seedInfo || !state.seedInfo.active) return;
    state.choiceRng = makeSeedRng(String(seed), 'choice');
    if (opts && opts.daily) {
      state.seedInfo.dailyDateKey = localDateKey();
      // 每日封存：固定普通档 + ascension 0（只改本局 state，不动账号 meta）
      if (DAILY_SANDBOX_CONFIG.enabled) {
        state.ascension = DAILY_SANDBOX_CONFIG.ascension;
        state.difficulty = DAILY_SANDBOX_CONFIG.difficulty;
      }
    }
  };

  /**
   * 当前是否处于“每日封存局”
   * 只认 state.seedInfo.daily + active；标题页、普通局一律 false。
   * @returns {boolean}
   */
  function dailySandboxActive() {
    return !!(state && state.seedInfo && state.seedInfo.active
      && state.seedInfo.daily && DAILY_SANDBOX_CONFIG.enabled);
  }

  /* 满解锁池：只改“读取”，不写账号。
     每日里 isUnlocked 恒为 true（所有系统/卡池对所有人一致）；
     而 unlock 在每日里返回 false，避免把试玩解锁永久落到账号上。 */
  const baseIsUnlocked = isUnlocked;
  isUnlocked = function (id) {
    if (dailySandboxActive() && DAILY_SANDBOX_CONFIG.fullUnlocks) return true;
    return baseIsUnlocked.apply(this, arguments);
  };
  const baseUnlock = unlock;
  unlock = function (id, reason) {
    if (dailySandboxActive()) return false;
    return baseUnlock.apply(this, arguments);
  };
  /* refreshUnlocks(true) 会绕过 unlock() 直接写 meta.unlocks（老档补齐），
     每日局必须整段跳过，否则“试玩解锁”会永久落盘。 */
  const baseRefreshUnlocks = refreshUnlocks;
  refreshUnlocks = function (silent) {
    if (dailySandboxActive()) return 0;
    return baseRefreshUnlocks.apply(this, arguments);
  };

  // 2) 每日种子改成 8 位（YYYYMMDD 的 YYMMDD 主体 + 校验）
  dailySeedValue = function () {
    return dailySeed8();
  };

  // 3) 自定义种子只收 8 位；校验失败给出具体原因
  normalizeSeedInput = function (raw) {
    const result = validateSeed8(raw);
    return result.ok ? result.value : null;
  };
  startCustomSeedRun = function () {
    const raw = ui.seedInput ? ui.seedInput.value : '';
    const result = validateSeed8(raw);
    if (!result.ok) {
      showToast(result.message, 'warn');
      if (ui.seedInput) ui.seedInput.focus();
      return;
    }
    startSeedRun(result.value, { custom: true });
  };

  // 4) 开局 / 结算时同步写每日记录
  const baseSeedTouchRun = seedTouchRun;
  seedTouchRun = function () {
    baseSeedTouchRun();
    if (seedActive() && state.seedInfo && state.seedInfo.daily) dailyTouchRun();
  };
  const baseSeedRecordRun = seedRecordRun;
  seedRecordRun = function (opts) {
    baseSeedRecordRun(opts);
    if (seedActive() && state.seedInfo && state.seedInfo.daily) dailyRecordRun(opts || {});
  };

  // 5) 三选一 / 宝箱奖励：唯一硬伤（原为 Math.random）
  pickWeightedOptions = function (pool, count, weightMul) {
    const remain = pool.slice();
    const picked = [];
    /** 计算某张卡的实际抽取权重（基础权重 × 路线倍率 × 候选偏好倍率） */
    const weightOf = (item) => {
      const rarity = RARITY_CONFIG[item.rarity] || RARITY_CONFIG.common;
      return rarity.weight * (weightMul ? (weightMul[rarity.id] || 1) : 1)
        * (Number(item.weightMul) || 1);
    };
    while (picked.length < count && remain.length > 0) {
      const total = remain.reduce((sum, item) => sum + weightOf(item), 0);
      let roll = choiceRandom() * total;   // ← 唯一改动：走选择流
      let index = 0;
      for (; index < remain.length; index += 1) {
        roll -= weightOf(remain[index]);
        if (roll <= 0) break;
      }
      if (index >= remain.length) index = remain.length - 1;
      picked.push(remain.splice(index, 1)[0]);
    }
    return picked;
  };

  // 6) 生存房刷怪：改走 (seed, floor, wave) 独立小流
  spawnSurvivalWave = function (room) {
    const s = state.survival;
    if (!s || !room) return 0;
    const count = Math.min(U11B_CONFIG.waveMax, 1 + (s.waves % 2));
    const type = s.waves >= 2 && survivalRandom() < 0.35 ? 'shooter' : 'wanderer';
    let spawned = 0;
    for (let i = 0; i < count; i += 1) {
      for (let t = 0; t < 12; t += 1) {
        const x = room.x + 18 + survivalRandom() * Math.max(1, room.w - 36);
        const y = room.y + 18 + survivalRandom() * Math.max(1, room.h - 36);
        if (!isWalkableCircle(x, y, 16)) continue;
        if (isWalkBlocked(x, y, 16)) continue;
        if (dist(x, y, state.player.x, state.player.y) < U11B_CONFIG.spawnMinDist) continue;
        spawnEnemy(type, x, y, state.floor, { roomId: room.id });
        spawned += 1;
        break;
      }
    }
    s.waves += 1;
    return spawned;
  };

  // 7) 标题页：今日挑战按钮补“已完成”，并追加一行今日记录
  const baseRenderLongrunTitle = renderLongrunTitle;
  renderLongrunTitle = function () {
    baseRenderLongrunTitle();
    if (!SEED_CONFIG.enabled) return;
    if (ui.btnDailyRun) {
      ui.btnDailyRun.textContent = '今日挑战 · ' + dailySeedValue() + (dailyCompletedToday() ? ' · 已完成' : '');
    }
    const rec = dailyRecordToday();
    if (ui.seedRecords && rec) {
      const chip = document.createElement('span');
      chip.className = 'seed-rec';
      chip.style.cssText = 'border-color:rgba(214,178,110,.55);color:#ead6a8';
      if (rec.first) {
        chip.textContent = '今日首次 · ' + rec.first.floor + ' 层 · '
          + formatRunTime(rec.first.time) + ' · ' + rec.first.kills + ' 击杀'
          + (rec.first.cleared ? ' · 通关' : '');
      } else {
        chip.textContent = '今日挑战进行中 · 尝试 ' + (rec.attempts || 0) + ' 次';
      }
      ui.seedRecords.appendChild(chip);
    }
    // ④：给旧格式记录（daily-YYYYMMDD / 文本种子）补“旧格式”角标
    markLegacySeedChips();
  };

  /**
   * 在结算页底部补一行“今日挑战”（复用现有结算页，不新建面板）
   * @returns {void}
   */
  function injectDailyResultLine() {
    if (!state || !state.seedInfo || !state.seedInfo.daily) return;
    if (!ui || !ui.modal) return;
    const rec = dailyRecordToday();
    if (!rec || !rec.first) return;
    const f = rec.first;
    const line = document.createElement('div');
    line.className = 'result-daily-line';
    line.style.cssText = 'margin:12px auto 0;padding:7px 14px;max-width:520px;'
      + 'border:1px solid rgba(214,178,110,.45);border-radius:9px;'
      + 'font-size:13px;line-height:1.6;color:#ead6a8;text-align:center;'
      + 'background:rgba(214,178,110,.06)';
    line.textContent = '今日挑战 · 首次 ' + f.floor + ' 层 · ' + formatRunTime(f.time)
      + ' · ' + f.kills + ' 击杀' + (f.cleared ? ' · 通关' : '')
      + (rec.best && rec.best.floor > f.floor ? '（今日最佳 ' + rec.best.floor + ' 层）' : '');
    const bottom = ui.modal.querySelector('.result-bottom');
    if (bottom && bottom.parentNode) bottom.parentNode.insertBefore(line, bottom);
    else ui.modal.appendChild(line);
  }

  const baseShowResult = showResult;
  showResult = function () {
    baseShowResult.apply(this, arguments);
    injectDailyResultLine();
  };
  const baseShowVictory = showVictory;
  showVictory = function () {
    baseShowVictory.apply(this, arguments);
    injectDailyResultLine();
  };

  /* ------------------------------------------------------------ 标题页 UI */

  /**
   * 复制文本到剪贴板（file:// 下 navigator.clipboard 可能不可用，带兜底）
   * @param {string} text 待复制文本
   * @returns {boolean} 是否成功
   */
  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* 继续走兜底 */ }
    try {
      const box = document.createElement('textarea');
      box.value = text;
      box.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(box);
      return ok;
    } catch (e2) {
      return false;
    }
  }

  /**
   * 在标题页种子行追加“随机 8 位 / 复制本局种子”两个按钮
   * （不改 HTML，靠运行时插入，避免合并冲突）
   * @returns {void}
   */
  function installSeedUi() {
    if (!SEED_CONFIG.enabled) return;
    if (ui.seedInput) {
      ui.seedInput.maxLength = SEED8_CONFIG.totalDigits;
      ui.seedInput.placeholder = '8 位种子（6 位数字 + 2 位校验）';
      ui.seedInput.addEventListener('input', () => {
        // 只允许数字，最长 8 位
        const digits = String(ui.seedInput.value || '').replace(/\D/g, '')
          .slice(0, SEED8_CONFIG.totalDigits);
        if (digits !== ui.seedInput.value) ui.seedInput.value = digits;
      });
    }
    const anchor = ui.btnSeedStart;
    if (!anchor || !anchor.parentNode) return;
    if (!document.getElementById('btnSeedRandom')) {
      const btnRandom = document.createElement('button');
      btnRandom.type = 'button';
      btnRandom.className = 'btn';
      btnRandom.id = 'btnSeedRandom';
      btnRandom.textContent = '随机 8 位';
      btnRandom.addEventListener('click', () => {
        const seed = makeRandomSeed8();
        if (ui.seedInput) ui.seedInput.value = seed;
        startSeedRun(seed, { custom: true });
      });
      anchor.parentNode.insertBefore(btnRandom, anchor.nextSibling);
    }
    if (!document.getElementById('btnSeedCopy')) {
      const btnCopy = document.createElement('button');
      btnCopy.type = 'button';
      btnCopy.className = 'btn';
      btnCopy.id = 'btnSeedCopy';
      btnCopy.textContent = '复制本局种子';
      btnCopy.addEventListener('click', () => {
        const text = (state && state.seedInfo && state.seedInfo.active && state.seedInfo.value)
          ? state.seedInfo.value
          : dailySeedValue();
        const ok = copyText(text);
        showToast(ok ? '种子已复制 · ' + text : '复制失败，请手动抄下 · ' + text, ok ? 'success' : 'warn');
      });
      anchor.parentNode.insertBefore(btnCopy, anchor.nextSibling);
    }
  }

  /* 暴露到全局：补丁里 19 处函数内遮蔽（const rand = fxRange）、12 处
     noteBestFloor(...)、2 处 onboardProgressFloor() 都是全局作用域调用，
     必须挂在 window 上。 */
  window.fxRange = fxRange;
  window.noteBestFloor = noteBestFloor;
  window.onboardProgressFloor = onboardProgressFloor;

  /* init() 内部才绑定 ui 元素，所以把 UI 注入挂到 init 之后执行 */
  const baseInit = init;
  init = function () {
    baseInit.apply(this, arguments);
    installSeedUi();
    try { renderLongrunTitle(); } catch (e) { /* 标题结构异常时不阻塞启动 */ }
  };

  installSeedUi();
  // 标题页可能已在 init() 里渲染过一轮，这里补刷一次按钮文案
  try { renderLongrunTitle(); } catch (e) { /* 标题结构异常时不阻塞启动 */ }

  /* ------------------------------------------------------------ 调试 / 断言 */
  /* 仅供 tools/seed_repro_assert.js 使用；玩家界面不会碰到。 */

  /**
   * 断言用：按种子重开一局（先退回标题态）
   * 断言会连续跑多局，这里把 meta.bestFloor 钉在“首次调用时的值”，
   * 保证两局面对完全相同的账号进度（否则第一局抬高 bestFloor 会改变第二局血量系数）。
   * @param {string} seed 8 位种子
   * @returns {boolean}
   */
  let debugBestFloorPin = null;
  function debugNewRun(seed) {
    if (!state) return false;
    if (debugBestFloorPin === null) debugBestFloorPin = Number(state.meta.bestFloor) || 0;
    state.meta.bestFloor = debugBestFloorPin;
    state.mode = 'title';
    state.status = 'title';
    return startSeedRun(seed, { custom: true });
  }

  /**
   * 断言用：直接生成指定楼层并返回指纹
   * @param {number} floorNumber 楼层
   * @returns {string} 指纹 JSON
   */
  function debugForceFloor(floorNumber) {
    state.floor = Math.max(1, Math.floor(Number(floorNumber) || 1));
    generateFloor(state.floor);
    return seedSignatureOfRun();
  }

  /**
   * 断言用：连续生成若干次三选一 / 被动选项（只读 state，不应用）
   * @param {string} stage skill / passive
   * @param {number} times 次数
   * @returns {Array<string>} 每次三个选项的字符串
   */
  function debugChoices(stage, times) {
    const out = [];
    const n = Math.max(1, Math.floor(Number(times) || 1));
    for (let i = 0; i < n; i += 1) {
      const options = buildRewardOptions(stage || 'skill');
      out.push(options.map((o) => (o.key || o.id || o.name)).join('|'));
    }
    return out;
  }

  /**
   * 断言用：验证表现层不再推进玩法流
   * @returns {{before:number, after:number, clean:boolean}}
   */
  function debugFxPollution() {
    const before = state.playRng ? state.playRng.state : -1;
    addBurst(state.player.x, state.player.y, '#fff', 12, 120, 0, Math.PI * 2, true);
    spawnPixelShatter(state.player.x, state.player.y, '#fff');
    spawnMagnetFx(state.player.x, state.player.y, '#fff');
    const after = state.playRng ? state.playRng.state : -1;
    return { before: before, after: after, clean: before === after };
  }

  /**
   * 断言用：验证每日“首次锁定”
   * @returns {{firstFloor:number, bestFloor:number, locked:boolean}}
   */
  function debugDailyLockTest() {
    const key = '20990101';
    const store = ensureDailyStore(state.meta);
    delete store[key];
    dailyRecordEnsure(key, encodeSeed8('990101'));
    // 第一次：3 层 / 100 秒 / 10 击杀
    const fake1 = { floor: 3, time: 100, kills: 10, cleared: false };
    const rec = store[key];
    rec.first = Object.assign({ at: 1 }, fake1);
    rec.best = { floor: 3, time: 100, kills: 10, cleared: false };
    // 第二次：5 层 / 300 秒 / 20 击杀（只允许刷新 best）
    const fake2 = { floor: 5, time: 300, kills: 20, cleared: false };
    if (dailyScoreBetter(fake2, rec.best)) {
      rec.best = { floor: 5, time: 300, kills: 20, cleared: false };
    }
    const locked = rec.first.floor === 3 && rec.best.floor === 5;
    return { firstFloor: rec.first.floor, bestFloor: rec.best.floor, locked: locked };
  }

  /**
   * 断言用：设置账号进度（bestFloor），并同步钉子值
   * 用于证明“每日局难度与账号进度无关 / 普通局难度随进度变化”。
   * @param {number} value 目标 bestFloor
   * @returns {number} 写入后的值
   */
  function debugSetBestFloor(value) {
    if (!state || !state.meta) return 0;
    state.meta.bestFloor = Math.max(0, Math.floor(Number(value) || 0));
    debugBestFloorPin = state.meta.bestFloor;
    return state.meta.bestFloor;
  }

  /**
   * 断言用：开一局每日挑战（种子按今天派生）
   * @returns {boolean} 是否成功
   */
  function debugDailyRun() {
    if (!state) return false;
    if (debugBestFloorPin === null) debugBestFloorPin = Number(state.meta.bestFloor) || 0;
    state.mode = 'title';
    state.status = 'title';
    return startSeedRun(dailySeedValue(), { daily: true });
  }

  /**
   * 断言用：读取“难度参照”状态（每日局应为基准值，而非玩家 bestFloor）
   * @returns {Object}
   */
  function debugProbeOnboard() {
    return {
      daily: !!(state.seedInfo && state.seedInfo.daily),
      skipAll: !!onboardSkipAll(),
      progressFloor: onboardProgressFloor(),
      baseline: dailyBaselineFloor(),
      activeFloor1: !!onboardActiveFloor(1),
      bestFloor: Number(state.meta && state.meta.bestFloor) || 0
    };
  }

  window.__seedDebug = {
    config: { SEED8_CONFIG: SEED8_CONFIG, DAILY_CONFIG: DAILY_CONFIG, DAILY_DIFF_CONFIG: DAILY_DIFF_CONFIG },
    makeSeed: makeRandomSeed8,
    validate: validateSeed8,
    checksum: seedChecksum6,
    dailySeed: dailySeed8,
    dailyBaseline: dailyBaselineFloor,
    setBestFloor: debugSetBestFloor,
    dailyRun: debugDailyRun,
    probeOnboard: debugProbeOnboard,
    e1Choice: function (floorNumber) { return e1ExtraChoice(floorNumber, true); },
    e1Mode: function () {
      return (window.E1_CONFIG && window.E1_CONFIG.enabled) ? 'native' : 'simulated';
    },
    legacyBadgeCount: function () {
      return ui && ui.seedRecords ? ui.seedRecords.querySelectorAll('.seed-rec-legacy').length : -1;
    },
    /**
     * 断言用：读取每日封存状态（难度档 / 进阶 / 解锁池 / 账号值）
     * @returns {Object}
     */
    sandbox: function () {
      const m = state.meta || {};
      return {
        active: dailySandboxActive(),
        ascension: Number(state.ascension) || 0,
        difficulty: state.difficulty,
        unlocked: {
          fusion: !!isUnlocked('fusion'),
          device: !!isUnlocked('device'),
          overdrive: !!isUnlocked('overdrive'),
          parallel: !!isUnlocked('parallel')
        },
        metaAscension: Number(m.ascension) || 0,
        metaDifficulty: m.difficulty,
        metaUnlocks: JSON.parse(JSON.stringify(m.unlocks || {}))
      };
    },
    /**
     * 断言用：构造一个指定账号状态（进阶 / 难度档 / 解锁）
     * @param {Object} acc { ascension, difficulty, unlocks }
     * @returns {boolean}
     */
    setAccount: function (acc) {
      if (!state || !state.meta || !acc) return false;
      if (acc.ascension != null) state.meta.ascension = Math.max(0, Math.floor(Number(acc.ascension) || 0));
      if (acc.difficulty) state.meta.difficulty = String(acc.difficulty);
      if (acc.unlocks) {
        state.meta.unlocks = Object.assign(
          { fusion: false, device: false, overdrive: false, parallel: false },
          acc.unlocks
        );
      }
      return true;
    },
    newRun: debugNewRun,
    forceFloor: debugForceFloor,
    signature: seedSignatureOfRun,
    choices: debugChoices,
    fxPollution: debugFxPollution,
    dailyLock: debugDailyLockTest,
    dailyToday: dailyRecordToday,
    dailyCompleted: dailyCompletedToday,
    isoTest: function () {
      if (!state) return { isolated: false };
      const before = Number(state.meta.bestFloor) || 0;
      const prev = state.seedInfo ? state.seedInfo.daily : false;
      state.seedInfo = state.seedInfo || {};
      state.seedInfo.daily = true;
      noteBestFloor(before + 10);
      const after = Number(state.meta.bestFloor) || 0;
      state.seedInfo.daily = prev;
      return { before: before, after: after, isolated: before === after };
    }
  };
})();
