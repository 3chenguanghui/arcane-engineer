/**
 * 把 v2 补丁（教学事件化 + 死亡归因去假分类）机械应用到主文件副本。
 * 用法：node tools\reviewfix_apply.js <输出文件路径>
 * 原则：每个替换必须命中且只命中 1 次；任何一块失败立刻中止，不写半成品。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'index_arcane_v2.html');
const OUT = process.argv[2] || path.join(ROOT, '.reviewfix', 'index_patched.html');

let src = fs.readFileSync(SRC, 'utf8');
const applied = [];
const ONLY = process.env.RF_ONLY || 'ALL';

/** 是否应用某一块：RF_ONLY=O 只跑教学块，D 只跑归因块，ALL 全跑（默认） */
function enabled(label) {
  if (ONLY === 'ALL') return true;
  return label.indexOf(ONLY) === 0;
}

/** 精确替换：字符串必须唯一，否则报错中止；未选中的块直接跳过 */
function rep(label, from, to) {
  if (!enabled(label)) return;
  const count = src.split(from).length - 1;
  if (count !== 1) {
    throw new Error('[' + label + '] 期望命中 1 次，实际 ' + count + ' 次');
  }
  src = src.replace(from, () => to);
  applied.push(label);
}

/* ============================================================
   A · 教学：CSS
   ============================================================ */
rep('O0-提示位置/跳过样式',
`    right: 18px;
    top: 50%;
    transform: translate(10px, -50%);`,
`    right: 18px;
    top: 64px;
    transform: translate(10px, 0);`);

rep('O0-提示入场位移',
`  .onboard-hint.is-on { opacity: 1; transform: translate(0, -50%); }`,
`  .onboard-hint.is-on { opacity: 1; transform: translate(0, 0); }`);

rep('O0-弹窗内提示行样式',
`  .onboard-hint .ob-verb {
    display: block;
    margin-bottom: 2px;
    font-size: 10.5px;
    color: rgba(255, 210, 120, 0.6);
    letter-spacing: 0.1em;
  }`,
`  .onboard-hint .ob-verb {
    display: block;
    margin-bottom: 2px;
    font-size: 10.5px;
    color: rgba(255, 210, 120, 0.6);
    letter-spacing: 0.1em;
  }
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
  @keyframes ob-modal-fade { to { opacity: 0; } }`);

/* ============================================================
   B · 教学：配置与事件表
   ============================================================ */
rep('O1-配置',
`  hintLifeSec: 6.0,              // 提示停留时间（超时自动收起）`,
`  hintLifeSec: 3.0,              // 事件提示 3 秒自动淡出
  skipKeys: ['Escape', 'Space', ' '],  // 可按键跳过当前提示（不暂停游戏）
  seedOnRuns: 2,                 // runs 已先 +1：首局快照=1，第二局=2`);

rep('O2-事件表',
`/** 五层动词表：hint 必须 ≤ hintMaxChars（验收脚本会逐个断言） */
const ONBOARD_STEPS = [
  { key: 'moveAttack', floor: 1, verb: '移动与开火', hint: 'WASD 移动，左键开火' },
  { key: 'fusion', floor: 2, verb: '融合', hint: '按 F 融合主技能' },
  { key: 'techDash', floor: 3, verb: '装置与冲刺', hint: 'K 装置，Shift 跑' },
  { key: 'route', floor: 4, verb: '路线取舍', hint: '选门：打怪或绕路' },
  { key: 'meta', floor: 5, verb: '元进度', hint: '死亡后结晶升天赋' }
];`,
`/** 首局 5 个事件表：hint 必须 ≤ hintMaxChars（验收脚本会逐个断言）
    触发点跟玩家真实遭遇走，不跟楼层走；floor 字段已删除，序号统一用 n */
const ONBOARD_STEPS = [
  { key: 'firstRoom',    n: 1, verb: '移动', hint: 'WASD 移动，左键开火', delay: 1.2 },
  { key: 'firstChoice',  n: 2, verb: '选牌', hint: '选牌优先凑融合', delay: 0 },
  { key: 'firstElite',   n: 3, verb: '精英', hint: '精英更肉，K 装置', delay: 0 },
  { key: 'lowHp',        n: 4, verb: '低血', hint: '血少就退，Shift 跑', delay: 0 },
  { key: 'firstCrystal', n: 5, verb: '结晶', hint: '结晶留着升天赋', delay: 0 }
];`);

rep('O3-本局状态',
`      progress: {},        // 本局已完成的动词（key → true）
      shownFloor: {},      // 本局已弹过提示的楼层（同层只弹一次）
      hint: null,          // 当前提示 {key, text, t}
      floor: state.floor,
      delay: ONBOARD_CONFIG.hintDelaySec,
      lastPos: null,
      moveAcc: 0,
      moved: false,
      techUsed: false,
      dashUsed: false,
      routeSeen: false,
      lastRoomId: state.currentRoomId,
      startKills: state.kills || 0,
      startFusions: (state.fusions || []).length`,
`      progress: {},        // 本局已完成的事件（key → true）
      shownFloor: {},      // 兼容旧调试口，保留字段但不再用于触发
      hint: null,          // 当前提示 {key, text, verb, t}
      floor: state.floor,
      delay: ONBOARD_CONFIG.hintDelaySec,
      lastPos: null,
      moveAcc: 0,
      moved: false,
      techUsed: false,
      dashUsed: false,
      routeSeen: false,
      lastRoomId: state.currentRoomId,
      startKills: state.kills || 0,
      startFusions: (state.fusions || []).length,
      ev: {},              // 本局已接受的事件（key → true）
      evOrder: [],         // 事件接受顺序（断言用）
      queue: [],           // 有提示在屏时排队
      pending: [],         // delay > 0 的待弹事件
      gap: 0,              // 上一条收起后的 0.5s 间隙
      modalHint: null      // 奖励弹窗内提示行（渲染后即清空）`);

/* ============================================================
   C · 教学：老玩家判定改为开局快照
   ============================================================ */
rep('O4-基线快照与老玩家判定',
`/**
 * 老存档 / 总开关判断：true = 本轮不教、不降难度
 * @returns {boolean}
 */
function onboardSkipAll() {
  if (!ONBOARD_CONFIG.enabled || !state) return true;
  if (state.onboardSkipAll == null) {
    // 快照一次：本轮开始时的历史最佳楼层（若 ≥5 视为老玩家）
    state.onboardSkipAll = Number(state.meta && state.meta.bestFloor) >= ONBOARD_CONFIG.skipBestFloor;
  }
  return !!state.onboardSkipAll;
}`,
`/**
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
}`);

/* ============================================================
   D · 教学：渲染 / 收起 / 记账 / 每帧
   ============================================================ */
rep('O5-提示渲染与排队',
`/**
 * 弹出教学提示（同一条整个存档只出现 1 次）
 * @param {string} key 动词键
 * @returns {boolean} 是否成功弹出
 */
function onboardShowHint(key) {
  if (!ONBOARD_CONFIG.enabled || !state) return false;
  const step = ONBOARD_STEPS.find((item) => item.key === key);
  if (!step) return false;
  const seen = loadOnboardSeen();
  if (seen[key]) return false;
  seen[key] = true;
  saveOnboardSeen(seen);

  const st = onboardState();
  st.hint = { key: key, text: step.hint, t: ONBOARD_CONFIG.hintLifeSec };
  if (ui.onboardHint) {
    ui.onboardHint.innerHTML = '<span class="ob-verb">教学 · ' + step.verb + '</span>' + step.hint;
    ui.onboardHint.classList.add('is-on');
    ui.onboardHint.setAttribute('aria-hidden', 'false');
  }
  // 教学期间塔灵静默：立刻收起正在显示的那一句
  if (ui.spiritLine) ui.spiritLine.classList.remove('is-on');
  return true;
}`,
`/**
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
}`);

rep('O6-收起后间隙',
`  if (onboardPendingToast) {
    const pending = onboardPendingToast;
    onboardPendingToast = null;
    toastNow(pending.message, pending.type);
  } else if (completed) {
    toastNow('教学完成', 'success');
  }
}`,
`  st.gap = 0.5;   // 两条提示之间留半秒，避免贴脸换
  if (onboardPendingToast) {
    const pending = onboardPendingToast;
    onboardPendingToast = null;
    toastNow(pending.message, pending.type);
  } else if (completed) {
    toastNow('教学完成', 'success');
  }
}`);

rep('O7-标记不再受楼层门槛',
`function onboardMark(key) {
  if (!ONBOARD_CONFIG.enabled || !state) return false;
  if (!onboardActiveFloor(state.floor)) return false;
  const st = onboardState();`,
`function onboardMark(key) {
  if (!ONBOARD_CONFIG.enabled || !state) return false;
  const st = onboardState();`);

rep('O8-每帧推进（事件队列）',
`function onboardTick(dt) {
  if (!state) return;
  const st = onboardState();

  // 1) 提示停留计时（即使暂停也按真实时间收，不会卡在屏幕上）
  if (st.hint) {
    st.hint.t -= dt;
    if (st.hint.t <= 0) onboardHideHint(false);
  }

  if (state.mode !== 'playing' || state.status !== 'playing') return;
  if (!onboardActiveFloor(state.floor)) return;

  // 2) 换层：重置本层延迟与移动采样（跨层位移不算"移动证据"）
  if (st.floor !== state.floor) {
    st.floor = state.floor;
    st.delay = ONBOARD_CONFIG.hintDelaySec;
    st.lastPos = null;
    st.moveAcc = 0;
  }

  // 3) 第 1 层：移动证据 + 击杀 ≥3 才算"移动与开火"完成
  if (state.floor === 1) {
    const p = state.player;
    if (st.lastPos) {
      const d = dist(p.x, p.y, st.lastPos.x, st.lastPos.y);
      if (d < 400) st.moveAcc += d;   // 瞬移（调试/换层）不计入
    }
    st.lastPos = { x: p.x, y: p.y };
    if (st.moveAcc >= ONBOARD_CONFIG.moveEvidencePx) st.moved = true;
    if ((state.kills || 0) - st.startKills >= ONBOARD_CONFIG.killEvidence) onboardMark('moveAttack');
  }

  // 4) 第 3 层：K 与 Shift 都按过 → 完成（活着才结算，死亡不记）
  if (state.floor === 3 && st.techUsed && st.dashUsed) onboardMark('techDash');

  // 5) 本层提示：延迟后弹一次；已看过的键直接标记为"本层处理过"
  const step = onboardStepForFloor(state.floor);
  if (step && !st.shownFloor[state.floor] && !st.hint) {
    if (loadOnboardSeen()[step.key]) {
      st.shownFloor[state.floor] = true;
    } else {
      st.delay -= dt;
      if (st.delay <= 0) {
        st.shownFloor[state.floor] = true;
        onboardShowHint(step.key);
      }
    }
  }
}`,
`function onboardTick(dt) {
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
}`);

rep('O9-进房事件与唯一入口',
`function onboardOnRoomEnter(room) {
  if (!state || !ONBOARD_CONFIG.enabled || !room) return false;
  const st = onboardState();
  if (st.lastRoomId === room.id) return false;
  const isFirst = st.lastRoomId == null;
  st.lastRoomId = room.id;
  if (isFirst) return false;
  if (state.floor === 4 && room.type !== 'start') {
    st.routeSeen = true;
    onboardMark('route');
  }
  return true;
}`,
`function onboardOnRoomEnter(room) {
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
}`);

rep('O10-开局重置与基线快照',
`function onboardBeginRun() {
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
  onboardPendingToast = null;
  // 快照本局是否属于"老档跳过"：必须在 bestFloor 被本局刷新之前取值
  state.onboardSkipAll = !!(state.meta && Number(state.meta.bestFloor) >= ONBOARD_CONFIG.skipBestFloor);
  if (ui.onboardHint) {
    ui.onboardHint.classList.remove('is-on');
    ui.onboardHint.setAttribute('aria-hidden', 'true');
  }
}`,
`/**
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
}`);

/* ============================================================
   E · 教学：触发点接线
   ============================================================ */
rep('O11-三选一触发',
`  showRewardStage(stage || 'skill');`,
`  // 第一次技能三选一：提示渲染进弹窗内部（弹窗 z-index 60 会盖住引导条 41，不能抬 z-index）
  if ((stage || 'skill') === 'skill') onboardEvent('firstChoice', true);
  showRewardStage(stage || 'skill');`);

rep('O12-结晶触发',
`function grantRunCrystals(amount, reason) {
  const base = Math.max(0, Math.floor(Number(amount) || 0));
  if (!base) return 0;`,
`function grantRunCrystals(amount, reason) {
  const base = Math.max(0, Math.floor(Number(amount) || 0));
  if (!base) return 0;
  // 第一次结晶入账：首局提示一次
  onboardEvent('firstCrystal');`);

rep('O13-低血触发',
`      state.fx.lowHpFired = true;
      startGlitchBurst(0.7);`,
`      state.fx.lowHpFired = true;
      onboardEvent('lowHp');   // 复用每局一次的 lowHpFired，避免 29%/31% 抖动反复触发
      startGlitchBurst(0.7);`);

rep('O14-弹窗内提示行',
`  const kicker = isPassive`,
`  // 弹窗内的教学提示行：弹窗 z-index 60 会整个盖住引导条（41），
  // 所以三选一这条不能走浮动条，必须在弹窗 HTML 里渲染。
  let obLine = '';
  if (!isPassive && state.onboard && state.onboard.modalHint) {
    obLine = '<div class="ob-modal-line" data-onboard-modal="1">教学 · '
      + state.onboard.modalHint.verb + ' · <b>' + state.onboard.modalHint.text + '</b></div>';
    state.onboard.modalHint = null;
  }
  const kicker = isPassive`);

rep('O14b-弹窗返回值拼接',
`    + '<p class="modal-sub">' + sub + '</p>'`,
`    + '<p class="modal-sub">' + sub + '</p>' + obLine`);

rep('O15-按键跳过',
`function handleKeyDown(event) {
  if (!state) return;`,
`function handleKeyDown(event) {
  if (!state) return;
  // 教学提示可按键跳过（Esc / 空格），只收提示、不暂停游戏
  if (state.onboard && state.onboard.hint
    && ONBOARD_CONFIG.skipKeys.indexOf(event.key) >= 0) {
    onboardHideHint(false);
    event.preventDefault();
    return;
  }`);

/* ============================================================
   F · 教学：三个显示读者 + 调试口
   ============================================================ */
rep('O16-帮助速查序号',
`    + '<h3><em>★</em>前 ' + ONBOARD_STEPS.length + ' 层速查 · 每层先做什么</h3>'
    + '<ul class="quickref">' + ONBOARD_STEPS.map((step) =>
      '<li data-quickref-floor="' + step.floor + '"><b>第 ' + step.floor + ' 层</b> · ' + step.verb`,
`    + '<h3><em>★</em>首局 ' + ONBOARD_STEPS.length + ' 个事件 · 遇到时先做什么</h3>'
    + '<ul class="quickref">' + ONBOARD_STEPS.map((step) =>
      '<li data-quickref-step="' + step.n + '"><b>事件 ' + step.n + '</b> · ' + step.verb`);

rep('O17-设置页回顾',
`  ui.onboardReviewBody.innerHTML = ONBOARD_STEPS.map((step) => (
    '<div class="ob-review-row"><b>第 ' + step.floor + ' 层 · ' + step.verb + '</b>'
    + '<span>' + step.hint + '</span></div>'
  )).join('');`,
`  ui.onboardReviewBody.innerHTML = ONBOARD_STEPS.map((step) => (
    '<div class="ob-review-row"><b>事件 ' + step.n + ' · ' + step.verb + '</b>'
    + '<span>' + step.hint + '</span></div>'
  )).join('');`);

rep('O18-调试 steps 序号',
`          steps: ONBOARD_STEPS.map((step) => ({
            key: step.key,
            floor: step.floor,
            verb: step.verb,
            hint: step.hint,
            chars: Array.from(step.hint).length
          })),`,
`          steps: ONBOARD_STEPS.map((step) => ({
            key: step.key,
            n: step.n,
            verb: step.verb,
            hint: step.hint,
            chars: Array.from(step.hint).length
          })),`);

rep('O19-调试 info 事件字段',
`          seen: loadOnboardSeen(),
          pendingToast: onboardPendingToast ? onboardPendingToast.message : null,
          bestFloor: Number(state.meta && state.meta.bestFloor) || 0`,
`          seen: loadOnboardSeen(),
          ev: Object.assign({}, st.ev || {}),
          evOrder: (st.evOrder || []).slice(),
          queue: (st.queue || []).slice(),
          pending: (st.pending || []).map((item) => ({ key: item.key, t: item.t })),
          modalHint: st.modalHint ? { verb: st.modalHint.verb, text: st.modalHint.text } : null,
          hintT: st.hint ? Number(st.hint.t.toFixed(2)) : null,
          baseline: state.onboardBaseline ? Object.assign({}, state.onboardBaseline) : null,
          returning: onboardReturningPlayer(),
          pendingToast: onboardPendingToast ? onboardPendingToast.message : null,
          bestFloor: Number(state.meta && state.meta.bestFloor) || 0`);

rep('O20-调试 reset 清基线',
`        state.onboard = null;
        state.onboardSkipAll = null;
        onboardBeginRun();`,
`        state.onboard = null;
        state.onboardSkipAll = null;
        state.onboardBaseline = null;
        onboardBeginRun();`);

rep('O21-调试 event/modalLine',
`      mark(key) {
        return { ok: onboardMark(key), info: this.info() };
      },`,
`      mark(key) {
        return { ok: onboardMark(key), info: this.info() };
      },
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
      },`);

rep('O22-showFloor 顺序修复',
`      showFloor(floorNumber) {
        const target = Math.max(1, Math.min(9, Math.floor(Number(floorNumber) || 1)));
        // 先快照"本轮是否老档"：generateFloor 会把 bestFloor 抬到当前层，
        // 若之后再快照，新号传到第 5 层会被误判成老档而跳过教学。
        const skipBefore = !!(state.meta && Number(state.meta.bestFloor) >= ONBOARD_CONFIG.skipBestFloor);
        state.mode = 'playing';
        state.status = 'playing';
        state.floor = target;
        state.onboard = null;
        state.onboardSkipAll = null;
        generateFloor(target);
        onboardEnsureFusionKit(target);
        onboardBeginRun();
        state.onboardSkipAll = skipBefore;
        const st = onboardState();
        st.delay = 0;          // 跳过 1.2s 延迟，立刻弹提示
        onboardTick(0.05);`,
`      showFloor(floorNumber) {
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
        onboardTick(0.05);`);

/* ============================================================
   G · 归因：分类表（删 ground / collapse）
   ============================================================ */
rep('D0-复盘样式',
`  .p1-legend-item i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }`,
`  .p1-legend-item i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
  .p1-summary {
    margin: 10px 0 6px;
    padding: 8px 10px;
    border-left: 3px solid #ff9a5a;
    border-radius: 6px;
    background: rgba(255, 154, 90, 0.10);
    color: #ffe7b8;
    font-size: 13.5px;
    line-height: 1.65;
    text-align: left;
  }
  .p1-spike {
    margin-top: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    background: rgba(255, 92, 122, 0.12);
    color: #ffb7c4;
    font-size: 12px;
    line-height: 1.6;
    text-align: left;
  }`);

rep('D1-分类表与阈值',
`/** 承伤分类 → 显示名 / 色块（顺序即兜底时的优先顺序） */
const P1_CATEGORY_META = {
  boss: { name: '首领', color: '#ff5c7a' },
  melee: { name: '近身', color: '#ff9a5a' },
  ranged: { name: '远程', color: '#ffd166' },
  env: { name: '环境', color: '#a8e6ff' },
  self: { name: '自伤', color: '#b6ff6b' },
  other: { name: '其它', color: '#9fb3c8' }
};
/** 分类 → 死因标签（被围 / 被远程 / …） */
const P1_VERDICT_LABEL = {
  boss: '被首领', melee: '被围', ranged: '被远程',
  env: '被环境', self: '自伤类', other: '未知', unknown: '未知'
};`,
`/** 承伤分类 → 显示名 / 色块（顺序即兜底时的优先顺序）
    只保留真实可达的 5 类 + 兜底：ground 无生产者（全文 hazard 都带 bossKind），已删除；
    collapse 只是玩家技能区类型，从不进 damagePlayer，也删除。 */
const P1_CATEGORY_META = {
  boss: { name: '首领', color: '#ff5c7a' },
  melee: { name: '近战', color: '#ff9a5a' },
  ranged: { name: '远程', color: '#ffd166' },
  env: { name: '环境/陷阱', color: '#a8e6ff' },
  self: { name: '自伤', color: '#b6ff6b' },
  other: { name: '其它', color: '#9fb3c8' }
};
/** 分类 → 死因标签（被围 / 被远程 / …） */
const P1_VERDICT_LABEL = {
  boss: '被首领（含贴身）', melee: '被围', ranged: '被远程',
  env: '被环境', self: '自伤类', other: '未知', unknown: '未知'
};
/**
 * 死亡层骤升规则：该层占比 ≥ 全局 × mul，且该层占比 ≥ minFloorPct、该层伤害 ≥ minFloorDmg
 * 例：全局 50% → 死亡层 ≥100% 才算"突然飙升"；全局 20% → 死亡层 ≥40%。
 */
const P1_SPIKE_RULE = { mul: 2.0, minFloorPct: 25, minFloorDmg: 12 };`);

/* ============================================================
   H · 归因：记账
   ============================================================ */
rep('D2-账目字段',
`  const zero = { boss: 0, melee: 0, ranged: 0, env: 0, self: 0, other: 0 };
  state.p1Ledger = {
    incoming: {
      total: 0, hits: 0,
      byCat: Object.assign({}, zero),
      hitsByCat: Object.assign({}, zero),
      /* 近身来源名 → 次数：用来判定“被围”是“多只怪围上来”还是“一只怪贴到底” */
      meleeNames: {}
    },
    outgoing: { total: 0, byId: {} }
  };`,
`  const zero = { boss: 0, melee: 0, ranged: 0, env: 0, self: 0, other: 0 };
  state.p1Ledger = {
    incoming: {
      total: 0, hits: 0,
      maxHit: 0,
      byCat: Object.assign({}, zero),
      hitsByCat: Object.assign({}, zero),
      maxByCat: Object.assign({}, zero),
      /* 分类 → 来源名 → 累计伤害：回答"哪只怪打得最多" */
      sourceByCat: {},
      /* 楼层 → { total, byCat }：判断死亡层某类占比是否突然飙升 */
      floors: {},
      /* 首领贴身子计数：boss 伤害里混着大量被蹭死的，必须和技能分开 */
      bossContactDmg: 0,
      bossContactHits: 0,
      /* 近身来源名 → 次数：用来判定“被围”是“多只怪围上来”还是“一只怪贴到底” */
      meleeNames: {}
    },
    outgoing: { total: 0, byId: {} }
  };`);

rep('D3-来源映射',
`/**
 * 把伤害来源（cause）映射成复盘分类
 * 规则：带 bossKind 恒为首领；爆炸桶算自伤；地面信号算环境；弹幕/爆发算远程；贴身/冲锋算近身。
 * @param {Object} cause damagePlayer 的 cause 参数
 * @returns {string} boss / melee / ranged / env / self / other
 */
function p1CategoryOf(cause) {
  const kind = (cause && cause.kind) || 'unknown';
  if (cause && cause.bossKind) return 'boss';
  if (kind === 'barrel') return 'self';
  if (kind === 'hazard' || kind === 'sigil' || kind === 'collapse') return 'env';
  if (kind === 'bullet' || kind === 'burst') return 'ranged';
  if (kind === 'contact' || kind === 'charge' || kind === 'selfdestruct') return 'melee';
  return 'other';
}`,
`/**
 * 把伤害来源（cause）映射成复盘分类
 * 规则：带 bossKind 恒为首领；爆炸桶算自伤；符阵算环境；弹幕/爆发算远程；贴身/冲锋/自爆算近战。
 * @param {Object} cause damagePlayer 的 cause 参数
 * @returns {string} boss / melee / ranged / env / self / other
 */
function p1CategoryOf(cause) {
  const kind = (cause && cause.kind) || 'unknown';
  if (cause && cause.bossKind) return 'boss';
  if (kind === 'barrel') return 'self';
  /* hazard 在真实游戏里只出现在首领危险区（必带 bossKind，已被上面截走）。
     这一条是防御性映射：真有不带 bossKind 的 hazard 时算环境，但不是可测路径。
     collapse 没有生产者（只是玩家技能 zone.type），已删除。 */
  if (kind === 'hazard' || kind === 'sigil') return 'env';
  if (kind === 'bullet' || kind === 'burst') return 'ranged';
  if (kind === 'contact' || kind === 'charge' || kind === 'selfdestruct') return 'melee';
  return 'other';
}`);

rep('D4-记账写入',
`  const cat = p1CategoryOf(cause);
  L.incoming.total += v;
  L.incoming.hits += 1;
  L.incoming.byCat[cat] = (L.incoming.byCat[cat] || 0) + v;
  L.incoming.hitsByCat[cat] = (L.incoming.hitsByCat[cat] || 0) + 1;
  if (cat === 'melee' && cause && cause.name) {
    const key = String(cause.name);
    L.incoming.meleeNames[key] = (L.incoming.meleeNames[key] || 0) + 1;
  }
}`,
`  const cat = p1CategoryOf(cause);
  L.incoming.total += v;
  L.incoming.hits += 1;
  L.incoming.byCat[cat] = (L.incoming.byCat[cat] || 0) + v;
  L.incoming.hitsByCat[cat] = (L.incoming.hitsByCat[cat] || 0) + 1;
  if (v > (L.incoming.maxHit || 0)) L.incoming.maxHit = v;
  if (v > (L.incoming.maxByCat[cat] || 0)) L.incoming.maxByCat[cat] = v;

  // 分类 → 来源名累计伤害：用来回答"哪只怪打得最多"
  const srcName = (cause && cause.name) ? String(cause.name) : '未知来源';
  if (!L.incoming.sourceByCat[cat]) L.incoming.sourceByCat[cat] = {};
  L.incoming.sourceByCat[cat][srcName] = (L.incoming.sourceByCat[cat][srcName] || 0) + v;

  // 按层记账：死亡层某类占比突然飙升要单独标出
  const fk = String(state.floor);
  if (!L.incoming.floors[fk]) L.incoming.floors[fk] = { total: 0, byCat: {} };
  L.incoming.floors[fk].total += v;
  L.incoming.floors[fk].byCat[cat] = (L.incoming.floors[fk].byCat[cat] || 0) + v;

  // 首领"贴身"子计数：玩家要知道自己是"没躲开大招"还是"站错位置被蹭死"
  if (cat === 'boss' && cause && cause.kind === 'contact') {
    L.incoming.bossContactDmg = (L.incoming.bossContactDmg || 0) + v;
    L.incoming.bossContactHits = (L.incoming.bossContactHits || 0) + 1;
  }
  if (cat === 'melee' && cause && cause.name) {
    const key = String(cause.name);
    L.incoming.meleeNames[key] = (L.incoming.meleeNames[key] || 0) + 1;
  }
}`);

/* ============================================================
   I · 归因：列表 / 骤升 / 判决 / 渲染
   ============================================================ */
rep('D5-承伤列表',
`function p1IncomingList(ledger) {
  const L = ledger || (state && state.p1Ledger);
  if (!L || !(L.incoming.total > 0)) return [];
  const raw = Object.keys(P1_CATEGORY_META)
    .map((key) => ({ key: key, value: L.incoming.byCat[key] || 0 }))
    .filter((item) => item.value > 0);
  const pctMap = p1PercentMap(raw, L.incoming.total);
  return raw.map((item) => ({
    key: item.key,
    name: P1_CATEGORY_META[item.key].name,
    color: P1_CATEGORY_META[item.key].color,
    value: item.value,
    pct: pctMap[item.key],
    hits: L.incoming.hitsByCat[item.key] || 0
  })).sort((a, b) => b.value - a.value);
}`,
`function p1IncomingList(ledger) {
  const L = ledger || (state && state.p1Ledger);
  if (!L || !(L.incoming.total > 0)) return [];
  const raw = Object.keys(P1_CATEGORY_META)
    .map((key) => ({ key: key, value: L.incoming.byCat[key] || 0 }))
    .filter((item) => item.value > 0);
  const pctMap = p1PercentMap(raw, L.incoming.total);
  const deathFloor = L.incoming.floors[String(state.floor)] || null;
  const contact = p1BossContact(L);
  return raw.map((item) => {
    const top = p1TopSource(L, item.key);
    const floorDmg = deathFloor ? (deathFloor.byCat[item.key] || 0) : 0;
    const floorPct = (deathFloor && deathFloor.total > 0)
      ? Math.round(floorDmg / deathFloor.total * 100)
      : 0;
    return {
      key: item.key,
      name: P1_CATEGORY_META[item.key].name,
      color: P1_CATEGORY_META[item.key].color,
      value: item.value,
      pct: pctMap[item.key],
      hits: L.incoming.hitsByCat[item.key] || 0,
      maxHit: L.incoming.maxByCat[item.key] || 0,
      topName: top.name,
      topDmg: top.dmg,
      deathFloorDmg: floorDmg,
      deathFloorPct: floorPct,
      contact: item.key === 'boss' ? contact : null
    };
  }).sort((a, b) => b.value - a.value);
}`);

rep('D6-新增纯函数',
`/**
 * 汇总账目（结算页与调试口共用）`,
`/**
 * 某分类里累计伤害最高的来源名（"哪只怪打得最多"）
 * @param {Object} ledger 账目
 * @param {string} cat 分类键
 * @returns {{name:string, dmg:number}}
 */
function p1TopSource(ledger, cat) {
  const L = ledger || (state && state.p1Ledger);
  const map = (L && L.incoming && L.incoming.sourceByCat && L.incoming.sourceByCat[cat]) || {};
  let name = '';
  let dmg = 0;
  Object.keys(map).forEach((key) => {
    if (map[key] > dmg) { dmg = map[key]; name = key; }
  });
  return { name: name, dmg: dmg };
}

/**
 * 首领"贴身接触"子计数（占总数比例，分母恒为总承伤）
 * @param {Object} ledger 账目
 * @returns {{dmg:number, hits:number, pct:number}}
 */
function p1BossContact(ledger) {
  const L = ledger || (state && state.p1Ledger);
  const total = L ? (L.incoming.total || 0) : 0;
  const dmg = L ? (L.incoming.bossContactDmg || 0) : 0;
  return {
    dmg: dmg,
    hits: L ? (L.incoming.bossContactHits || 0) : 0,
    pct: total > 0 ? Math.round(dmg / total * 100) : 0
  };
}

/**
 * 死亡层骤升：某类在本层占比 ≥ 全局 ×2，且本层占比 ≥25%、本层伤害 ≥12
 * @param {Object} item p1IncomingList 条目
 * @param {Object} ledger 账目
 * @returns {Object|null} 命中项 { key, name, runPct, floorPct, floorDmg }
 */
function p1SpikeFor(item, ledger) {
  const L = ledger || (state && state.p1Ledger);
  if (!item || !L || !L.incoming.total) return null;
  const rule = P1_SPIKE_RULE;
  const floorPct = item.deathFloorPct || 0;
  const floorDmg = item.deathFloorDmg || 0;
  if (floorDmg < rule.minFloorDmg) return null;
  if (floorPct < rule.minFloorPct) return null;
  if (floorPct < (item.pct || 0) * rule.mul) return null;
  return { key: item.key, name: item.name, runPct: item.pct, floorPct: floorPct, floorDmg: floorDmg };
}

/**
 * 一句话总结（结算页与自检共用同一份文字）
 * 玩家记得住"第 12 层"，记不住"71%" —— 所以楼层必须出现。
 * @param {Object|null} death resolveDeathCause() 返回值
 * @param {Array<Object>} list p1IncomingList 结果
 * @returns {string}
 */
function p1SummaryText(death, list) {
  const top = (list && list.length) ? list[0] : null;
  const killer = (top && top.topName) ? top.topName
    : ((death && death.name) ? death.name
      : ((state.lastHit && state.lastHit.name) || '不明伤害'));
  if (!top) return '你在第 ' + state.floor + ' 层倒下，本局没有记录到承伤。';
  return '你在第 ' + state.floor + ' 层被' + killer + '打死，' + top.name
    + '占 ' + top.pct + '%，其中一次 ' + (top.maxHit || 0) + ' 点。';
}

/**
 * 汇总账目（结算页与调试口共用）`);

rep('D7-判决',
`function p1DeathVerdict(ledger) {
  const L = ledger || (state && state.p1Ledger);
  const total = L ? (L.incoming.total || 0) : 0;
  if (!L || total <= 0) {
    return { tag: 'unknown', label: P1_VERDICT_LABEL.unknown, rule: '本局没有记录到承伤，无法判定死因', quote: null };
  }
  const share = (key) => (L.incoming.byCat[key] || 0) / total;
  const pctText = (key) => Math.round(share(key) * 100);
  const meleeNames = Object.keys(L.incoming.meleeNames || {}).length;
  const meleeHits = L.incoming.hitsByCat.melee || 0;

  if (share('boss') >= 0.40) {
    return {
      tag: 'boss', label: P1_VERDICT_LABEL.boss,
      rule: '首领伤害占 ' + pctText('boss') + '%（阈值 ≥40%）',
      quote: null
    };
  }`,
`function p1DeathVerdict(ledger) {
  const L = ledger || (state && state.p1Ledger);
  const total = L ? (L.incoming.total || 0) : 0;
  if (!L || total <= 0) {
    return { tag: 'unknown', label: P1_VERDICT_LABEL.unknown, rule: '本局没有记录到承伤，无法判定死因', quote: null };
  }
  const share = (key) => (L.incoming.byCat[key] || 0) / total;
  const pctText = (key) => Math.round(share(key) * 100);
  const meleeNames = Object.keys(L.incoming.meleeNames || {}).length;
  const meleeHits = L.incoming.hitsByCat.melee || 0;

  if (share('boss') >= 0.40) {
    const contact = p1BossContact(L);
    const extra = contact.dmg > 0
      ? '；其中贴身接触 ' + contact.dmg + ' 点（占总承伤 ' + contact.pct + '%，' + contact.hits + ' 次）'
      : '';
    return {
      tag: 'boss', label: P1_VERDICT_LABEL.boss,
      rule: '首领伤害占 ' + pctText('boss') + '%（阈值 ≥40%）' + extra,
      quote: null
    };
  }`);

rep('D7b-环境判决文案',
`      rule: '环境伤害占 ' + pctText('env') + '%（阈值 ≥45%，地面危险区 / 符阵 / 塌墙）',`,
`      rule: '环境伤害占 ' + pctText('env') + '%（阈值 ≥45%，符阵 / 陷阱）',`);

rep('D8-图例',
`  const bar = list.map((item) => '<i style="width:' + item.pct + '%;background:' + item.color + '"></i>').join('');
  const legend = list.map((item) => '<span class="p1-legend-item"'
    + ' data-p1-share="' + kind + ':' + item.key + '"'
    + ' data-p1-pct="' + item.pct + '"'
    + ' data-p1-value="' + item.value + '">'
    + '<i style="background:' + item.color + '"></i>'
    + item.name + (item.fusion ? '（融合）' : '') + ' ' + item.pct + '% · ' + item.value + ' 点'
    + '</span>').join('');`,
`  const bar = list.map((item) => '<i style="width:' + item.pct + '%;background:' + item.color + '"></i>').join('');
  const legend = list.map((item) => {
    const safeTop = String(item.topName || '').replace(/"/g, '&quot;');
    const extra = kind === 'in'
      ? ' · 最大 ' + (item.maxHit || 0) + ' 点'
        + (item.topName ? ' · 主凶 ' + item.topName : '')
        + (item.contact && item.contact.dmg > 0
          ? ' · 贴身 ' + item.contact.dmg + ' 点（' + item.contact.pct + '%）' : '')
      : '';
    return '<span class="p1-legend-item"'
      + ' data-p1-share="' + kind + ':' + item.key + '"'
      + ' data-p1-pct="' + item.pct + '"'
      + ' data-p1-max="' + (item.maxHit || 0) + '"'
      + ' data-p1-top="' + safeTop + '"'
      + ' data-p1-value="' + item.value + '">'
      + '<i style="background:' + item.color + '"></i>'
      + item.name + (item.fusion ? '（融合）' : '') + ' ' + item.pct + '% · ' + item.value + ' 点'
      + extra
      + '</span>';
  }).join('');`);

rep('D9-结算页插入总结与骤升',
`  const shares = p1Shares(L);
  const verdict = won ? null : p1DeathVerdict(L);
  const inTotal = shares.incoming.total;`,
`  const shares = p1Shares(L);
  const verdict = won ? null : p1DeathVerdict(L);
  const summary = won ? '' : p1SummaryText(death, shares.incoming.list);
  const spike = won ? null
    : (shares.incoming.list || []).map((item) => p1SpikeFor(item, L)).filter(Boolean)[0] || null;
  const inTotal = shares.incoming.total;`);

rep('D9b-结论层总结',
`  if (verdict) {
    html += '<div class="p1-verdict">'
      + '<div class="p1-verdict-tag">' + verdict.label + '</div>'
      + '<div class="p1-verdict-rule">判定 · ' + verdict.rule + '</div>'
      + (death && death.quote ? '<div class="p1-verdict-quote">“' + death.quote + '”</div>' : '')
      + '</div>';
  }`,
`  if (verdict) {
    html += '<div class="p1-verdict">'
      + '<div class="p1-verdict-tag">' + verdict.label + '</div>'
      + '<div class="p1-verdict-rule">判定 · ' + verdict.rule + '</div>'
      + (death && death.quote ? '<div class="p1-verdict-quote">“' + death.quote + '”</div>' : '')
      + '</div>';
  }
  // 1.5) 一句话总结：先让玩家记住"第几层 / 被谁 / 怎么死的"
  if (summary) {
    html += '<div class="p1-summary" data-p1-summary="1">' + summary + '</div>';
  }`);

rep('D9c-骤升标记',
`    + buildShareBarHtml(shares.incoming.list, 'in', '本局没有记录到承伤')
    + '<div class="p1-evidence-head">复盘 · 你的输出构成（按卡与融合）</div>'`,
`    + buildShareBarHtml(shares.incoming.list, 'in', '本局没有记录到承伤')
    + (spike ? '<div class="p1-spike" data-p1-spike="1">死亡层突然飙升 · '
        + spike.name + ' 本层占 ' + spike.floorPct + '%（全局 ' + spike.runPct + '%），'
        + '本层共吃 ' + spike.floorDmg + ' 点</div>' : '')
    + '<div class="p1-evidence-head">复盘 · 你的输出构成（按卡与融合）</div>'`);

rep('D10-调试 p1 方法',
`      /** 清空本局账目 + 绘制计数（每个场景开始前调用） */`,
`      /** 一句话总结（与结算页调用同一函数） */
      summary() {
        const L = state.p1Ledger;
        return p1SummaryText(state.lastHit, L ? p1IncomingList(L) : []);
      },
      /** 承伤明细（含最大单次 / 主凶 / 死亡层占比） */
      detail() {
        const L = state.p1Ledger;
        return L ? JSON.parse(JSON.stringify(p1IncomingList(L))) : [];
      },
      /** 死亡层骤升项（没有则 null） */
      spike() {
        const L = state.p1Ledger;
        if (!L) return null;
        const hit = p1IncomingList(L).map((item) => p1SpikeFor(item, L)).filter(Boolean);
        return hit.length ? JSON.parse(JSON.stringify(hit[0])) : null;
      },
      /** 分类表（断言 ground 已删除） */
      categories() {
        return Object.keys(P1_CATEGORY_META);
      },
      /** 清空本局账目 + 绘制计数（每个场景开始前调用） */`);

/* ============================================================
   写入
   ============================================================ */
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, src, 'utf8');
console.log('OK 块数=' + applied.length);
console.log('输出：' + OUT);
applied.forEach((label) => console.log('  · ' + label));
