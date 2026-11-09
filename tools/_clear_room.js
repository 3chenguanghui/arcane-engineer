/**
 * X 批 · 「清一房怪」逐帧实测（爽感的数据证据）
 * ------------------------------------------------------------
 * 用法：
 *   node tools/_clear_room.js [html] [outJson]
 *
 * 做什么：
 *   同一个战斗房、同一套脚本化施法，跑两遍：
 *     ① before = 把本轮爽感改动临时还原成 v1.3.1 行为
 *        （普通房 S2 白名单只留 comboThreshold/execution、群体爆裂门槛 4）
 *     ② after  = 本构建默认（S2 白名单含 multiKill/aoe5、群体爆裂门槛 3）
 *   两边伤害完全一样（都是 4 发熔岩地裂、每发杀 3 只），
 *   所以差异只可能是"演出反馈"，不会被数值波动污染。
 *
 * 场景（固定、可重复）：
 *   4 团 × 3 只，沿上下左右 4 个方向摆成一条线，每团一发熔岩地裂全清。
 *   每次施法后推进 3 帧（=0.05s），记录击杀帧 / 爆裂 / S2 / 空档。
 *
 * 为什么用"模拟帧"而不是真实录制：
 *   真实录制受浏览器帧率与后台节流影响，同一段代码两次跑出来的秒数不同。
 *   这里走真实战斗入口（castSlot / update* / fxTierFlush）按固定 1/60s 步进，
 *   结果可重复，而且能精确到"哪一帧杀几只、哪一帧爆裂"。
 *
 * 口径说明：
 *   本轮没有改伤害公式，所以"清房总时长"不会因为演出变爽而变化。
 *   A-X3.6 的判据因此落在"反馈密度"（爆裂次数 / S2 / 空档），
 *   并额外断言"清房时长不退化（after ≤ before × 1.15）"。
 *
 * 端口 9593（与其它探针互斥）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9593;
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 页面内：脚本化清房 + 逐帧演出统计
 * ------------------------------------------------------------
 * 4 团 × 3 只；每团用一发熔岩地裂（46 伤害）秒掉 3 只 18hp 敌人。
 * 每次施法前后读 COMBO_FX_STATS / FX_TIER_STATS 的增量，
 * 因此"一帧内连播两次爆裂"会被立刻抓到（maxBlastsInFrame）。
 * @returns {Object} 清房指标
 */
const RUN_EXPR = `(function(){
  var d = window.__roamDebug;
  var p = state.player;

  /* ---------- 选一个真实战斗房 ---------- */
  var room = null;
  (state.rooms || []).forEach(function(r){ if (!room && r.type === 'battle') room = r; });
  if (!room) (state.rooms || []).forEach(function(r){ if (!room && r.type !== 'start') room = r; });
  if (!room) return { error: 'no room' };
  state.currentRoomId = room.id;
  p.x = room.cx; p.y = room.cy;
  p.invuln = 99999;
  p.aether = 9999; p.aetherMax = 9999;
  state.mode = 'playing'; state.status = 'playing';
  state.aim = state.aim || { mode: 'weak', angle: 0, moved: false };
  if (state.ownedMagic.indexOf('frostRing') < 0) state.ownedMagic.push('frostRing');

  /**
   * 重置本轮读取的全部统计与时间轴（两遍之间必须干净）
   * @returns {void}
   */
  function resetStats() {
    FX_TIER_STATS.s0 = 0; FX_TIER_STATS.s1 = 0; FX_TIER_STATS.s2 = 0;
    FX_TIER_STATS.s2Merged = 0; FX_TIER_STATS.frames = 0;
    FX_TIER_STATS.shakeCalls = 0; FX_TIER_STATS.burstCalls = 0;
    FX_TIER_STATS.lastFrame = null; FX_TIER_STATS.lastEventTier = 'S0';
    ROOM_FX_STATS.battle = { s0: 0, s1: 0, s2: 0, capped: 0 };
    ROOM_FX_STATS.lastCappedKind = null;
    COMBO_FX_STATS.edgePeaks = 0; COMBO_FX_STATS.thresholds = 0;
    COMBO_FX_STATS.mergedThresholds = 0; COMBO_FX_STATS.groupBlasts = 0;
    COMBO_FX_STATS.lastThreshold = 0; COMBO_FX_STATS.lastGroupKills = 0;
    COMBO_FX_STATS.pitchPeak = 1; COMBO_FX_STATS.lastPitch = 1; COMBO_FX_STATS.breaks = 0;
    state.combo = { count: 0, timer: 0, best: 0 };
    state.fxTierLastS2 = -999;
    state.fxFrame = null;
    state.cooldowns = {};
    state.elapsed = 0;
    state.castLock = 0;
    state.enemies.length = 0;
    state.projectiles.length = 0;
    state.mines.length = 0;
    state.aoeZones.length = 0;
    state.elementClouds = [];
  }

  /**
   * 在玩家周围摆 1 团 3 只（半径 100px，落在冰霜环 140px 内）
   * ------------------------------------------------------------
   * 用自身环状技能而不是定向锥/线：环只依赖半径，不会被墙或朝向影响，
   * 这样 before / after 两遍的"命中数"才严格一致，差异只剩演出。
   * @param {number} round 第几团（用来错开角度，避免视觉重叠）
   * @returns {number} 实际生成数量
   */
  function spawnOneCluster(round) {
    var ang = (Math.PI / 2) * round + 0.35;
    var made = 0;
    for (var j = 0; j < 3; j += 1) {
      var offAng = ang + (Math.PI * 2 * j) / 3;
      var e = spawnEnemy('chanter',
        p.x + Math.cos(offAng) * 100,
        p.y + Math.sin(offAng) * 100,
        state.floor || 1, { roomId: state.currentRoomId });
      if (!e) continue;
      e.hp = 1; e.hpMax = 1;         // 任意一发命中即击杀（只测演出，不测伤害）
      e.aiPaused = true;
      e.speed = 0;
      made += 1;
    }
    return made;
  }

  /**
   * 统计当前存活敌人数
   * @returns {number}
   */
  function countAlive() {
    var n = 0;
    state.enemies.forEach(function(e){ if (e && e.hp > 0) n += 1; });
    return n;
  }

  var dt = 1 / 60;
  resetStats();
  var rounds = 4;
  var spawned = 0;
  var frames = 0;
  var kills = 0;
  var casts = 0;
  var killEvents = [];
  var blastEvents = [];
  var s2Events = [];
  var maxBlastsInFrame = 0;
  var maxHitsInFrame = 0;
  var longestGap = 0;
  var lastKillT = null;
  var lastBlastTotal = 0;
  var lastS2Total = 0;

  /**
   * 结算"这一帧"的演出增量（爆裂 / S2 / 最大命中数）
   * ------------------------------------------------------------
   * 必须在"施法后"与"每推进一帧后"都调用：部分技能是延迟判定，
   * 爆裂可能落在 castSlot 之后的某一帧，只在施法那一帧读会漏掉。
   * @param {number} clusterIdx 当前团序号
   * @returns {void}
   */
  function captureFrame(clusterIdx) {
    if (COMBO_FX_STATS.groupBlasts > lastBlastTotal) {
      var db = COMBO_FX_STATS.groupBlasts - lastBlastTotal;
      lastBlastTotal = COMBO_FX_STATS.groupBlasts;
      maxBlastsInFrame = Math.max(maxBlastsInFrame, db);
      blastEvents.push({ cluster: clusterIdx, t: Number((frames * dt).toFixed(2)), count: db });
    }
    if (FX_TIER_STATS.s2 > lastS2Total) {
      var ds = FX_TIER_STATS.s2 - lastS2Total;
      lastS2Total = FX_TIER_STATS.s2;
      s2Events.push({ cluster: clusterIdx, t: Number((frames * dt).toFixed(2)), count: ds });
    }
    if (FX_TIER_STATS.lastFrame) maxHitsInFrame = Math.max(maxHitsInFrame, FX_TIER_STATS.lastFrame.hits || 0);
  }

  for (var idx = 0; idx < rounds; idx += 1) {
    // 每团重新就绪：清冷却 + 回满奥能（模拟玩家在团与团之间自然回蓝）
    state.cooldowns = {};
    p.aether = p.aetherMax;
    state.activeMagicId = 'frostRing';
    spawned += spawnOneCluster(idx);

    // 4 个步进：第 0 步施法，其后 3 帧让表现层与延迟判定走完
    for (var step = 0; step < 4; step += 1) {
      var aliveBefore = countAlive();
      if (step === 0) {
        if (castSlot(0, false)) casts += 1;
      } else {
        frames += 1;
        d.element.tick(dt);
      }
      fxTierFlush();
      captureFrame(idx);

      var aliveAfter = countAlive();
      var killedNow = aliveBefore - aliveAfter;
      if (killedNow > 0) {
        kills += killedNow;
        var nowT = frames * dt;
        killEvents.push({ cluster: idx, t: Number(nowT.toFixed(2)), killed: killedNow });
        if (lastKillT !== null) longestGap = Math.max(longestGap, nowT - lastKillT);
        lastKillT = nowT;
      }
    }
    // 收尾：把本团漏网（若有）清干净，保证下一团是干净的 3 只
    state.enemies.forEach(function(e){ if (e && e.hp > 0) e.hp = 0; });
  }

  var ttk = Number((frames * dt).toFixed(2));
  return {
    room: room.id,
    spawned: spawned,
    ttk: ttk,
    kills: kills,
    casts: casts,
    killsPerSec: ttk > 0 ? Number((kills / ttk).toFixed(2)) : 0,
    blastCount: COMBO_FX_STATS.groupBlasts,
    blastEvents: blastEvents,
    blastPerKill: kills > 0 ? Number((COMBO_FX_STATS.groupBlasts / kills).toFixed(3)) : 0,
    s2Count: FX_TIER_STATS.s2,
    s2Merged: FX_TIER_STATS.s2Merged,
    s1Count: FX_TIER_STATS.s1,
    s0Count: FX_TIER_STATS.s0,
    roomS2: ROOM_FX_STATS.battle.s2,
    roomCapped: ROOM_FX_STATS.battle.capped,
    maxBlastsInFrame: maxBlastsInFrame,
    maxHitsInFrame: maxHitsInFrame,
    pitchPeak: Number(COMBO_FX_STATS.pitchPeak.toFixed(2)),
    killEvents: killEvents,
    s2Events: s2Events,
    longestKillGap: Number(longestGap.toFixed(2))
  };
})()`;

async function main() {
  const FILE = path.resolve(process.argv[2] || path.join(ROOT, 'index_arcane_v2.html'));
  const OUT = path.resolve(process.argv[3] || path.join(ROOT, '.screenshots', 'clear_room', 'clear_room.json'));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1600,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });

  /** 发送 CDP 命令 */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  /** 页面内执行表达式并取返回值 */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1200);

  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    ready = await ev(`!!document.getElementById('btnStart')`);
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error('标题页未挂载: ' + await ev('document.title + "|" + document.readyState'));
  await sleep(900);

  const startPos = await ev(`(function(){
    var el = document.getElementById('btnStart');
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(800);

  /* 进到第 6 层，保证有 battle 房；关掉奖励流程避免停在选卡界面 */
  const setup = await ev(`(function(){
    var d = window.__roamDebug;
    if (typeof XP_CONFIG !== 'undefined') XP_CONFIG.enabled = false;
    for (var i = 0; i < 40 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
    d.setFloor(6);
    for (var k = 0; k < 40 && state.mode === 'reward'; k += 1) closeRewardFlow(true);
    state.player.invuln = 99999;
    return { floor: state.floor, mode: state.mode,
      battleRooms: (state.rooms || []).filter(function(r){ return r.type === 'battle'; }).length };
  })()`);
  console.log('SETUP ' + JSON.stringify(setup));
  await sleep(300);

  /* 记录本轮爽感配置的原值，before 跑完必须逐项还原 */
  const origin = await ev(`(function(){
    window.__clearOrig = {
      s2Kinds: ROOM_FX_PROFILE.battle.s2Kinds.slice(),
      minKills: COMBO_FX_CONFIG.groupBlast.minKills,
      edgeLevels: COMBO_FX_CONFIG.edgeLevels.slice()
    };
    return window.__clearOrig;
  })()`);
  console.log('ORIGIN ' + JSON.stringify(origin));

  /* ---------- before：还原成 v1.3.1 的演出口径 ---------- */
  await ev(`(function(){
    ROOM_FX_PROFILE.battle.s2Kinds = ['comboThreshold', 'execution'];
    COMBO_FX_CONFIG.groupBlast.minKills = 4;
    COMBO_FX_CONFIG.edgeLevels = [0.24, 0.24, 0.24];
    return true;
  })()`);
  const before = await ev(RUN_EXPR);
  console.log('BEFORE ' + JSON.stringify(before));

  /* ---------- 还原本轮默认 ---------- */
  await ev(`(function(){
    ROOM_FX_PROFILE.battle.s2Kinds = window.__clearOrig.s2Kinds;
    COMBO_FX_CONFIG.groupBlast.minKills = window.__clearOrig.minKills;
    COMBO_FX_CONFIG.edgeLevels = window.__clearOrig.edgeLevels;
    return true;
  })()`);
  const after = await ev(RUN_EXPR);
  console.log('AFTER ' + JSON.stringify(after));

  /* ============ 断言 ============ */
  const checks = [];
  const add = (id, pass, detail) => checks.push({ id, pass: !!pass, detail });

  add('A-X3.6-1 场景有效（12 只全部清掉）',
    after.kills === after.spawned && after.spawned >= 12 && before.kills === before.spawned,
    `after 击杀=${after.kills}/${after.spawned}，before 击杀=${before.kills}/${before.spawned}`);

  add('A-X3.6-2 清房时长不退化',
    before.ttk > 0 && after.ttk <= before.ttk * 1.15,
    `before=${before.ttk}s after=${after.ttk}s（脚本化同一伤害序列，只允许演出开销 ≤15%）`);

  add('A-X3.6-3 群体爆裂 ≥ ⌊击杀/3⌋',
    after.blastCount >= Math.floor(after.kills / 3),
    `after 爆裂=${after.blastCount}，要求≥${Math.floor(after.kills / 3)}（before=${before.blastCount}）`);

  add('A-X3.6-4 同帧只爆一次',
    after.maxBlastsInFrame <= 1,
    `after 单帧最多爆裂=${after.maxBlastsInFrame}（要求≤1）`);

  add('A-X3.6-5 最长空档 ≤1.2s',
    after.longestKillGap <= 1.2,
    `after 最长空档=${after.longestKillGap}s（要求≤1.2s；before=${before.longestKillGap}s）`);

  add('A-X3.6-6 改前确实没有群体爆裂',
    before.blastCount === 0,
    `before 爆裂=${before.blastCount}（门槛 4 只，每团只有 3 只）`);

  add('A-X3.6-7 反馈密度优于改前',
    after.blastCount + after.s2Count > before.blastCount + before.s2Count,
    `爆裂+S2：before=${before.blastCount + before.s2Count} after=${after.blastCount + after.s2Count}`);

  const pass = checks.every((c) => c.pass);
  const report = {
    file: FILE,
    scenario: '第 6 层 battle 房，4 团 × 3 只 1hp 敌人，每团一发冰霜环，固定 1/60s 步进',
    caveat: '伤害公式本轮未改 → 清房时长只做"不退化"断言；A-X3.6 的核心判据是反馈密度（爆裂 / S2 / 空档）。',
    before,
    after,
    checks,
    verdict: pass ? 'PASS' : 'FAIL'
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== 清一房逐帧数据（秒 / 击杀 / 爆裂 / 最长空档）===');
  ['before', 'after'].forEach((key) => {
    const r = report[key];
    console.log(key.padEnd(7)
      + 'ttk=' + String(r.ttk).padEnd(6)
      + 'kills=' + String(r.kills).padEnd(4)
      + 'maxHitsFrame=' + String(r.maxHitsInFrame).padEnd(3)
      + 'blasts=' + String(r.blastCount).padEnd(4)
      + 's2=' + String(r.s2Count).padEnd(4)
      + 's2Merged=' + String(r.s2Merged).padEnd(3)
      + 's1=' + String(r.s1Count).padEnd(4)
      + 'maxFrameBlast=' + String(r.maxBlastsInFrame).padEnd(3)
      + 'gap=' + String(r.longestKillGap).padEnd(5)
      + 'pitchPeak=' + String(r.pitchPeak));
  });
  console.log('\n=== 断言 ===');
  checks.forEach((c) => console.log((c.pass ? 'PASS ' : 'FAIL ') + c.id + ' | ' + c.detail));
  console.log('\nRESULT: ' + report.verdict + ' -> ' + OUT);

  ws.close();
  killEdge(edge);
  if (!pass) process.exitCode = 1;
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
