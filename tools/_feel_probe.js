/**
 * B 阶段 · 真实战斗房「清一房怪」对照探针
 * ------------------------------------------------------------
 * 用法：
 *   node tools/_feel_probe.js [html] [outJson]
 *
 * 目的（回答"打起来不爽"到底差多少）：
 *   同一套脚本化施法，在 F1 / F6 / F10 的真实战斗房里各跑两遍：
 *     ① before = 运行时把 ENEMY_BUDGET_CONFIG 还原成 v1.4.0 旧表（少怪、厚血）
 *     ② after  = 本构建（B 阶段：怪多、单只薄血）
 *   输出可直接对照的数字：
 *     · 清房秒数（真实冷却 + 真实位移 + 敌人真实追人 AI）
 *     · 每只怪血量 / 用 46 伤害范围技要打几下
 *     · 单次施法 ≥3 杀的占比（用"下一次施法前结算"归因）
 *     · 群体爆裂次数、单帧最多几次爆裂、最长"没击杀"空档
 *
 * 为什么可信：
 *   · 敌人不是脚本捏的 1hp 假怪，而是调真实刷怪入口 spawnEnemiesForFloor 生成；
 *   · 伤害 / 冷却 / 奥能全部走 castSlot 真实路径；
 *   · before / after 的站位、技能轮转、瞄准逻辑完全同一份代码，
 *     差异只来自 ENEMY_BUDGET_CONFIG（这正是 B 阶段唯一改的东西）。
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

/** v1.4.0 旧数量 / 血量表（before 用；改完必须原样还原，见 SET_MODE_EXPR） */
const OLD_ROWS = {
  1: { battle: [2, 2], elite: [2, 2], hpScale: 3.530 },
  2: { battle: [3, 3], elite: [3, 3], hpScale: 1.437 },
  3: { battle: [3, 4], elite: [3, 3], hpScale: 1.270 },
  4: { battle: [4, 4], elite: [3, 4], hpScale: 0.870 },
  5: { battle: [4, 4], elite: [3, 4], hpScale: 0.955 },
  6: { battle: [5, 5], elite: [3, 4], hpScale: 0.826 },
  7: { battle: [5, 5], elite: [4, 4], hpScale: 0.715 },
  8: { battle: [5, 6], elite: [4, 5], hpScale: 0.664 },
  9: { battle: [6, 6], elite: [4, 5], hpScale: 0.608 },
  10: { battle: [6, 6], elite: [4, 5], hpScale: 0.613 },
  11: { battle: [5, 6], elite: [4, 5], hpScale: 0.675 },
  12: { battle: [5, 6], elite: [4, 5], hpScale: 0.671 },
  13: { battle: [5, 6], elite: [4, 5], hpScale: 0.700 },
  14: { battle: [5, 6], elite: [4, 5], hpScale: 0.703 },
  15: { battle: [5, 6], elite: [4, 5], hpScale: 0.728 },
  16: { battle: [5, 6], elite: [4, 5], hpScale: 0.744 },
  17: { battle: [5, 6], elite: [4, 5], hpScale: 0.758 },
  18: { battle: [5, 6], elite: [4, 5], hpScale: 0.775 },
  19: { battle: [5, 6], elite: [4, 5], hpScale: 0.879 },
  20: { battle: [5, 6], elite: [4, 5], hpScale: 0.922 }
};

/**
 * 切换预算表口径（before / after）
 * ------------------------------------------------------------
 * 先把当前表深拷贝到 window.__feelOrig（只拷一次），
 * before 用旧表 + minFloor 6；after 用快照还原（= 构建默认）。
 * @param {string} mode 'before' | 'after'
 * @returns {boolean}
 */
const SET_MODE_EXPR = (mode) => `(function(){
  var OLD = ${JSON.stringify(OLD_ROWS)};
  if (!window.__feelOrig) {
    window.__feelOrig = JSON.parse(JSON.stringify(ENEMY_BUDGET_CONFIG.rampByFloor));
    window.__feelOrigMin = ENEMY_BUDGET_CONFIG.minFloor;
  }
  if ('${mode}' === 'before') {
    ENEMY_BUDGET_CONFIG.minFloor = 6;
    Object.keys(OLD).forEach(function(k){ ENEMY_BUDGET_CONFIG.rampByFloor[k] = OLD[k]; });
  } else {
    ENEMY_BUDGET_CONFIG.minFloor = window.__feelOrigMin;
    Object.keys(window.__feelOrig).forEach(function(k){
      ENEMY_BUDGET_CONFIG.rampByFloor[k] = window.__feelOrig[k];
    });
  }
  return true;
})()`;

/**
 * 页面内：生成真实战斗房 → 脚本化玩家（移动 + 5 个范围技轮转）清房
 * ------------------------------------------------------------
 * 归因口径：技能冷却都 ≥2.2s，而延迟结算（黑洞）≤1.2s，
 * 所以"上一发"的击杀一定在"下一发"之前结清。每次施法时结算上一发的击杀增量，
 * 得到"单次施法杀几只"，不会被多技能并发污染。
 * @param {number} F 楼层
 * @returns {Object} 清房指标
 */
const RUN_EXPR = `(function(){
  var F = @FLOOR@;
  var d = window.__roamDebug;
  var dt = 1 / 60;
  var NEAR = ['lavaFissure', 'flameCone', 'frostRing', 'runeOrbit', 'collapseHole'];
  var FAR = ['bolt', 'fireball', 'mine', 'arcanePool', 'collapseHole'];
  var SKILLS = NEAR.concat(FAR);

  if (typeof XP_CONFIG !== 'undefined') XP_CONFIG.enabled = false;
  d.setFloor(F);
  for (var g = 0; g < 40 && state.mode === 'reward'; g += 1) closeRewardFlow(true);

  var room = null;
  (state.rooms || []).forEach(function(r){ if (!room && r.type === 'battle') room = r; });
  if (!room) return { error: 'no battle room', floor: F };

  state.currentRoomId = room.id;
  var p = state.player;
  p.x = room.cx; p.y = room.cy;
  p.invuln = 99999; p.aether = 1e9; p.aetherMax = 1e9;
  state.mode = 'playing'; state.status = 'playing';
  state.aim = state.aim || { mode: 'weak', angle: 0, moved: false };
  SKILLS.forEach(function(id){ if (state.ownedMagic.indexOf(id) < 0) state.ownedMagic.push(id); });

  /* 只留目标房的敌人；其它房冻结，避免跨房追杀污染时长 */
  state.enemies.forEach(function(e){
    if (!e) return;
    if (e.roomId !== room.id) { e.aiPaused = true; e.speed = 0; }
  });
  var mine = state.enemies.filter(function(e){ return e && e.roomId === room.id; });
  if (!mine.length) return { error: 'room has no enemies', floor: F, room: room.id };

  /* 血量快照：用来算"一只几下"（46 = 熔岩地裂伤害，本轮最高的常用范围技） */
  var hpList = [];
  var hpSum = 0;
  mine.forEach(function(e){
    var v = Math.round(e.hpMax);
    hpList.push(v); hpSum += v;
  });
  var hpAvg = hpSum / hpList.length;
  var hpMin = Math.min.apply(null, hpList);
  var hpMax = Math.max.apply(null, hpList);

  /* 统计口径清零 */
  FX_TIER_STATS.s0 = 0; FX_TIER_STATS.s1 = 0; FX_TIER_STATS.s2 = 0;
  FX_TIER_STATS.lastFrame = null;
  COMBO_FX_STATS.groupBlasts = 0; COMBO_FX_STATS.pitchPeak = 1;
  state.combo = { count: 0, timer: 0, best: 0 };
  state.cooldowns = {};
  state.elapsed = 0; state.castLock = 0;
  state.projectiles.length = 0; state.mines.length = 0; state.aoeZones.length = 0;

  /* ===== C1-5b 诊断：为什么"0.5s 内 ≥3 杀"上不去 =====
     ① 同屏敌数分布   → 施法瞬间玩家周围 110 / 190 / 260px 各几只
     ② AoE 命中数直方图 → 包住 damageEnemy，统计"一发真的打到几只"（含延迟结算）
     ③ 拉怪距离       → 施法瞬间第 1 / 2 / 3 近的敌人各有多远（排队进场说明） */
  if (!window.__feelOrigDamage) window.__feelOrigDamage = damageEnemy;
  var hitCur = null; var hitsByCast = []; var uidSeq = 0;
  damageEnemy = function (enemy, amount, dirAngle, opts) {
    if (hitCur && enemy && enemy.roomId === room.id && enemy.hp > 0) {
      if (!enemy.__feelUid) enemy.__feelUid = (uidSeq += 1);
      hitCur[enemy.__feelUid] = 1;
    }
    return window.__feelOrigDamage.apply(this, arguments);
  };
  var densAtCast = []; var pullAtCast = [];

  /**
   * 存活怪距玩家第 n 近的距离（1 起）
   * @param {number} n 名次
   * @returns {number} 距离（px），不足 n 只时返回 -1
   */
  function distToNth(n) {
    var arr = [];
    state.enemies.forEach(function(e){
      if (!e || e.roomId !== room.id || e.hp <= 0) return;
      arr.push(Math.hypot(e.x - p.x, e.y - p.y));
    });
    arr.sort(function(a, b){ return a - b; });
    return arr[n - 1] == null ? -1 : Math.round(arr[n - 1]);
  }

  /**
   * 本房还活着几只
   * @returns {number}
   */
  function alive() {
    var n = 0;
    state.enemies.forEach(function(e){
      if (e && e.roomId === room.id && e.hp > 0 && !e.dead) n += 1;
    });
    return n;
  }

  /**
   * 距离玩家最近的活怪
   * @returns {Object|null}
   */
  function nearest() {
    var best = null; var bd = 1e9;
    state.enemies.forEach(function(e){
      if (!e || e.roomId !== room.id || e.hp <= 0) return;
      var dx = e.x - p.x, dy = e.y - p.y;
      var dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = e; }
    });
    return best;
  }

  /**
   * 存活怪质心：合格玩家会站到怪堆中央，让每一发范围技都覆盖整堆
   * @returns {{x:number,y:number}|null}
   */
  function centroid() {
    var sx = 0; var sy = 0; var n = 0;
    state.enemies.forEach(function(e){
      if (!e || e.roomId !== room.id || e.hp <= 0) return;
      sx += e.x; sy += e.y; n += 1;
    });
    return n ? { x: sx / n, y: sy / n, n: n } : null;
  }

  /**
   * 玩家半径内活怪数量
   * @param {number} r 半径
   * @returns {number}
   */
  function countWithin(r) {
    var n = 0;
    state.enemies.forEach(function(e){
      if (!e || e.roomId !== room.id || e.hp <= 0) return;
      if (Math.hypot(e.x - p.x, e.y - p.y) <= r) n += 1;
    });
    return n;
  }

  var frames = 0; var casts = 0; var kills = 0;
  var perCast = []; var pendingIdx = -1; var killsAtCast = 0;
  var maxBlastsInFrame = 0; var lastBlastTotal = 0;
  var longestGap = 0; var lastKillT = null; var firstBlood = -1;
  var maxKillsInFrame = 0; var noCastStreak = 0; var maxNoCastStreak = 0;
  var killTimes = [];
  var maxFrames = 60 * 45;

  for (; frames < maxFrames; frames += 1) {
    /* 清房后引擎会把 mode 切到 reward；探针必须跟着停，
       否则会把 40 秒"无目标空转"算进清房时长（上一版 AFTER 45s 就是这个坑）。 */
    if (state.mode !== 'playing') break;
    if (alive() === 0) break;
    /* 本帧起始存活数：必须包住"施法 + AI + 结算"整段，
       否则 castSlot 内即时结算的击杀会被漏记（上一版就漏了 5/7 只）。 */
    var beforeCount = alive();
    var tgt = nearest();
    var dist = tgt ? Math.hypot(tgt.x - p.x, tgt.y - p.y) : 1e9;

    /* 站位：往存活怪质心靠，站进怪堆（这才是范围技"一发 3 杀"的前提） */
    var cen = centroid();
    if (cen) {
      var cd = Math.hypot(cen.x - p.x, cen.y - p.y);
      if (cd > 70) {
        var sp = (p.speed || 220) * dt;
        p.x += (cen.x - p.x) / cd * sp;
        p.y += (cen.y - p.y) / cd * sp;
      }
    }

    /* 轮转：用第一个冷却结束的技能（真实冷却；探针不跑完整 update，
       所以在这里按帧手动推进冷却，等价于真实 update 的冷却递减） */
    Object.keys(state.cooldowns).forEach(function(id){
      var v = state.cooldowns[id];
      if (v > 0) state.cooldowns[id] = Math.max(0, v - dt);
    });
    if (state.castLock > 0) state.castLock = Math.max(0, state.castLock - dt);
    if (p.aether < 200) p.aether = 1e9;

    /* 按距离选池：远程拉开时用长手（雷击 520 / 火球 731 / 雷 344 / 雷池 410），
       近身再用范围。否则遇到"风筝怪"会永远追不上、房间永不结算。 */
    var pool = dist > 190 ? FAR : NEAR;
    var chosen = null;
    for (var si = 0; si < pool.length; si += 1) {
      if ((state.cooldowns[pool[si]] || 0) <= 0.001) { chosen = pool[si]; break; }
    }
    if (!chosen) {
      for (var sj = 0; sj < SKILLS.length; sj += 1) {
        if ((state.cooldowns[SKILLS[sj]] || 0) <= 0.001) { chosen = SKILLS[sj]; break; }
      }
    }
    /* 只有"堆里 ≥3 只"才出手；残局 ≤2 只时贴脸打；远程怪会拉扯，
       超过 2 秒没出手就强制打最近目标，避免"围着 3 只远怪空转 40 秒"。 */
    var near = countWithin(155);
    var forceCast = noCastStreak * dt > 2.0;
    if (chosen && tgt && dist <= 600
        && (near >= 3 || forceCast || (beforeCount <= 2 && dist <= 150))) {
      var ax = cen ? cen.x : tgt.x;
      var ay = cen ? cen.y : tgt.y;
      state.aim.angle = Math.atan2(ay - p.y, ax - p.x);
      state.aim.moved = true;
      if (state.dual) state.dual.slots[0] = chosen; else state.activeMagicId = chosen;
      var ok = castSlot(0, false);
      if (ok) {
        /* 诊断①③：出手瞬间的密度与排队距离（此时本发还没结算，是"玩家看到的局面"） */
        densAtCast.push({ r110: countWithin(110), r190: countWithin(190), r260: countWithin(260) });
        pullAtCast.push({ d1: distToNth(1), d2: distToNth(2), d3: distToNth(3) });
        /* 诊断②：先结算上一发的命中窗口，再开新窗口 */
        if (hitCur) hitsByCast.push(Object.keys(hitCur).length);
        hitCur = {};
        /* 结算上一发（它的延迟伤害一定已经走完） */
        if (pendingIdx >= 0) perCast[pendingIdx].kills = kills - killsAtCast;
        perCast.push({ id: chosen, kills: 0, t: Number((frames * dt).toFixed(2)) });
        pendingIdx = perCast.length - 1;
        killsAtCast = kills;
        casts += 1;
        noCastStreak = 0;
      } else {
        noCastStreak += 1;
      }
    } else {
      noCastStreak += 1;
    }
    if (noCastStreak > maxNoCastStreak) maxNoCastStreak = noCastStreak;

    var before = beforeCount;
    d.element.tick(dt);
    /* 真实敌人 AI：会朝玩家聚拢，这是"一发打中 3 只"能成立的前提 */
    updateEnemies(dt);
    fxTierFlush();
    var after = alive();
    var killedNow = before - after;
    if (killedNow > 0) {
      kills += killedNow;
      if (killedNow > maxKillsInFrame) maxKillsInFrame = killedNow;
      var nowT = frames * dt;
      for (var kk = 0; kk < killedNow; kk += 1) killTimes.push(nowT);
      if (firstBlood < 0) firstBlood = Number(nowT.toFixed(2));
      if (lastKillT !== null) longestGap = Math.max(longestGap, nowT - lastKillT);
      lastKillT = nowT;
    }
    if (COMBO_FX_STATS.groupBlasts > lastBlastTotal) {
      var db = COMBO_FX_STATS.groupBlasts - lastBlastTotal;
      lastBlastTotal = COMBO_FX_STATS.groupBlasts;
      if (db > maxBlastsInFrame) maxBlastsInFrame = db;
    }
  }

  if (pendingIdx >= 0) perCast[pendingIdx].kills = kills - killsAtCast;
  /* 最后一发的命中窗口收尾 */
  if (hitCur) { hitsByCast.push(Object.keys(hitCur).length); hitCur = null; }

  /**
   * 把一组数字折成直方图（键是桶名，值是次数）
   * @param {Array<number>} arr 样本
   * @param {Function} bucketOf (v) => 桶名
   * @returns {Object}
   */
  function hist(arr, bucketOf) {
    var out = {};
    arr.forEach(function (v) { var k = bucketOf(v); out[k] = (out[k] || 0) + 1; });
    return out;
  }
  /**
   * 取平均（空数组返回 0，避免 NaN 污染断言）
   * @param {Array<number>} arr 样本
   * @returns {number}
   */
  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
  }
  var hitHist = hist(hitsByCast, function (v) { return v >= 4 ? '4+' : String(v); });
  var dens110 = hist(densAtCast.map(function (x) { return x.r110; }), function (v) { return v >= 4 ? '4+' : String(v); });
  var dens190 = hist(densAtCast.map(function (x) { return x.r190; }), function (v) { return v >= 4 ? '4+' : String(v); });

  var threeKillCasts = 0;
  var killCasts = 0;
  perCast.forEach(function(c){ if (c.kills >= 1) killCasts += 1; if (c.kills >= 3) threeKillCasts += 1; });
  /* 0.5s 窗口内的群体击杀：玩家真正感知到的"一发带走 3 只"。
     同一只怪 3 下死，若 3 下分散在不同技能上，用"单发归因"永远测不到；
     用"死亡成簇"衡量更贴近体感，也直接对应群体爆裂演出。 */
  var killWindows = [];
  var lastW = -999;
  killTimes.forEach(function(t){
    if (t - lastW > 0.5) killWindows.push(0);
    killWindows[killWindows.length - 1] += 1;
    lastW = t;
  });
  var bigWindows = killWindows.filter(function(n){ return n >= 3; }).length;
  var clearSec = Number((frames * dt).toFixed(2));

  return {
    floor: F,
    room: room.id,
    count: mine.length,
    hpAvg: Number(hpAvg.toFixed(1)),
    hpMin: hpMin,
    hpMax: hpMax,
    hpSum: hpSum,
    hitsPerKill46Avg: Number((hpAvg / 46).toFixed(2)),
    hitsPerKill46Min: Math.ceil(hpMin / 46),
    hitsPerKill46Max: Math.ceil(hpMax / 46),
    clearSec: clearSec,
    kills: kills,
    casts: casts,
    killsPerCast: perCast.map(function(c){ return c.kills; }),
    threeKillCasts: threeKillCasts,
    killCasts: killCasts,
    /* "能杀到人的那一发"里，≥3 杀占多少：前两发是削血（0 杀），
       如果按全部施法算占比永远 ≤1/3，口径必须落在"收尾发"。 */
    threeKillRatio: killCasts > 0 ? Number((threeKillCasts / killCasts).toFixed(2)) : 0,
    threeKillOfAllCasts: casts > 0 ? Number((threeKillCasts / casts).toFixed(2)) : 0,
    killWindows: killWindows,
    bigWindows: bigWindows,
    bigWindowRatio: killWindows.length > 0 ? Number((bigWindows / killWindows.length).toFixed(2)) : 0,
    maxKillsInFrame: maxKillsInFrame,
    blastCount: COMBO_FX_STATS.groupBlasts,
    maxBlastsInFrame: maxBlastsInFrame,
    s2Count: FX_TIER_STATS.s2,
    longestGap: Number(longestGap.toFixed(2)),
    firstBloodSec: firstBlood,
    maxNoCastSec: Number((maxNoCastStreak * dt).toFixed(2)),
    pitchPeak: Number(COMBO_FX_STATS.pitchPeak.toFixed(2)),
    /* ---- C1-5b 三项诊断（原样输出，累计在 agg 里取中位） ---- */
    hitHist: hitHist,
    hitsAvg: Number(mean(hitsByCast).toFixed(2)),
    hitsMax: hitsByCast.length ? Math.max.apply(null, hitsByCast) : 0,
    dens110: dens110,
    dens190: dens190,
    densAvg190: Number(mean(densAtCast.map(function (x) { return x.r190; })).toFixed(2)),
    pullD1: Math.round(mean(pullAtCast.map(function (x) { return x.d1; }).filter(function (v) { return v >= 0; }))),
    pullD2: Math.round(mean(pullAtCast.map(function (x) { return x.d2; }).filter(function (v) { return v >= 0; }))),
    pullD3: Math.round(mean(pullAtCast.map(function (x) { return x.d3; }).filter(function (v) { return v >= 0; })))
  };
})()`;

async function main() {
  const FILE = path.resolve(process.argv[2] || path.join(ROOT, 'index_arcane_v2.html'));
  const OUT = path.resolve(process.argv[3] || path.join(ROOT, '.screenshots', 'feel', 'feel_probe.json'));
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
  if (!ready) throw new Error('标题页未挂载');

  await sleep(900);
  const startPos = await ev(`(function(){
    var el = document.getElementById('btnStart');
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(800);

  const FLOORS = [1, 6, 10];
  const SAMPLES = 3;          // 每层跑 3 个不同房间，取中位数，压掉"怪种/阵型"抽样噪声
  const rows = { before: [], after: [] };
  const raw = { before: [], after: [] };

  /**
   * 3 次重复的聚合：连续量取中位数，计数类取总和/最大
   * @param {Object[]} runs 同一层的 3 次结果
   * @param {number} floor 层号
   * @returns {Object}
   */
  const agg = (runs, floor) => {
    const med = (key) => {
      const v = runs.map((r) => r[key]).slice().sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    };
    const sum = (key) => runs.reduce((s, r) => s + r[key], 0);
    const max = (key) => runs.reduce((s, r) => Math.max(s, r[key]), 0);
    const casts = sum('casts');
    const killCasts = sum('killCasts');
    const three = sum('threeKillCasts');
    const killWindowCount = runs.reduce((s, r) => s + r.killWindows.length, 0);
    const bigWindows = sum('bigWindows');
    return {
      floor,
      samples: runs.length,
      count: med('count'),
      hpAvg: Number(med('hpAvg').toFixed(1)),
      hpMin: med('hpMin'),
      hpMax: med('hpMax'),
      hpSum: med('hpSum'),
      hitsPerKill46Avg: med('hitsPerKill46Avg'),
      clearSec: med('clearSec'),
      kills: sum('kills'),
      casts,
      threeKillCasts: three,
      killCasts,
      threeKillRatio: killCasts > 0 ? Number((three / killCasts).toFixed(2)) : 0,
      threeKillOfAllCasts: casts > 0 ? Number((three / casts).toFixed(2)) : 0,
      killWindowCount,
      bigWindows,
      bigWindowRatio: killWindowCount > 0 ? Number((bigWindows / killWindowCount).toFixed(2)) : 0,
      maxKillsInFrame: max('maxKillsInFrame'),
      blastCount: sum('blastCount'),
      maxBlastsInFrame: max('maxBlastsInFrame'),
      longestGap: Number(med('longestGap').toFixed(2)),
      firstBloodSec: med('firstBloodSec'),
      maxNoCastSec: Number(med('maxNoCastSec').toFixed(2)),
      pitchPeak: max('pitchPeak'),
      /* C1-5b 诊断：命中数 / 密度 / 排队距离取中位，保证三次样本可比 */
      hitsAvg: med('hitsAvg'),
      hitsMax: max('hitsMax'),
      densAvg190: med('densAvg190'),
      pullD1: med('pullD1'),
      pullD2: med('pullD2'),
      pullD3: med('pullD3'),
      hitHist: runs[0].hitHist,
      dens110: runs[0].dens110,
      dens190: runs[0].dens190
    };
  };

  for (const mode of ['before', 'after']) {
    await ev(SET_MODE_EXPR(mode));
    for (const F of FLOORS) {
      const runs = [];
      for (let s = 0; s < SAMPLES; s += 1) {
        const r = await ev(RUN_EXPR.replace('@FLOOR@', String(F)));
        if (!r || r.error) throw new Error(mode + ' F' + F + ' 场景失败: ' + JSON.stringify(r));
        runs.push(r);
        raw[mode].push(r);
      }
      const a = agg(runs, F);
      rows[mode].push(a);
      console.log(mode.toUpperCase() + ' F' + F + ' ' + JSON.stringify(a));
    }
  }
  await ev(SET_MODE_EXPR('after'));

  /* ===== C1-5b 三项诊断输出（改前 / 改后各一行，数字直接进报告） ===== */
  /**
   * 把直方图对象打成 "1:7 2:5 3:2" 形式，方便贴进报告
   * @param {Object} h 直方图
   * @returns {string}
   */
  const fmtHist = (h) => Object.keys(h).sort().map((k) => `${k}:${h[k]}`).join(' ');
  console.log('\n===== C1-5b 爽感归因（0.5s 内 ≥3 杀上不去的原因） =====');
  for (const mode of ['after']) {
    /* 只打 after（= 当前版本）；before 是老预算表，参考价值低 */
    console.log(`[${mode}] 层  命中/发  命中峰值  ≤110px 敌数   ≤190px 敌数  第1/2/3近距(px)`);
    rows[mode].forEach((r) => {
      console.log(`[${mode}] F${String(r.floor).padEnd(2)} ${String(r.hitsAvg).padEnd(8)} ${String(r.hitsMax).padEnd(9)} `
        + `${(fmtHist(r.dens110) || '-').padEnd(13)} ${(fmtHist(r.dens190) || '-').padEnd(13)} `
        + `${r.pullD1}/${r.pullD2}/${r.pullD3}`);
    });
    console.log(`[${mode}] 命中直方图（一次施法打到几只）: ` + rows[mode].map((r) => `F${r.floor}=${fmtHist(r.hitHist)}`).join(' | '));
  }

  const checks = [];
  const add = (id, pass, detail) => checks.push({ id, pass: !!pass, detail });

  const b1 = rows.before.find((r) => r.floor === 1);
  const a1 = rows.after.find((r) => r.floor === 1);
  const a6 = rows.after.find((r) => r.floor === 6);
  const a10 = rows.after.find((r) => r.floor === 10);
  const b6 = rows.before.find((r) => r.floor === 6);
  const b10 = rows.before.find((r) => r.floor === 10);

  add('B-1 F1 清房 ≤8s（before 对照）', a1.clearSec <= 8, `after=${a1.clearSec}s / before=${b1.clearSec}s`);
  add('B-1b F6 清房 ≤8s（before 对照）', a6.clearSec <= 8, `after=${a6.clearSec}s / before=${b6.clearSec}s`);
  add('B-2 群体击杀（0.5s 窗口 ≥3 杀占比 ≥60%；before 对照）',
    a1.bigWindowRatio >= 0.6 && a6.bigWindowRatio >= 0.6,
    `F1=${(a1.bigWindowRatio * 100).toFixed(0)}%（${a1.bigWindows}/${a1.killWindowCount} 簇）`
    + ` F6=${(a6.bigWindowRatio * 100).toFixed(0)}%（${a6.bigWindows}/${a6.killWindowCount} 簇）`
    + `；before F6=${(b6.bigWindowRatio * 100).toFixed(0)}%`
    + `；单发归因 F6=${(a6.threeKillRatio * 100).toFixed(0)}%`);
  add('B-3 每只 2–3 下（46 伤害范围技）', a1.hitsPerKill46Avg <= 3 && a6.hitsPerKill46Avg <= 3,
    `F1=${a1.hitsPerKill46Avg} 下 F6=${a6.hitsPerKill46Avg} 下`);
  add('B-4 单怪血量下降（F1 ≥50%、F10 ≥25%）', (a1.hpAvg / b1.hpAvg) <= 0.5 && (a10.hpAvg / b10.hpAvg) <= 0.75,
    `F1 ${b1.hpAvg}→${a1.hpAvg}、F10 ${b10.hpAvg}→${a10.hpAvg}`);
  add('B-4b 怪数上升（F1 ≥1.5x、深层 ≥1.3x；深层再抬会跌破 116 血下限）',
    a1.count >= b1.count * 1.5 && a6.count >= b6.count * 1.3 && a10.count >= b10.count * 1.3,
    `F1 ${b1.count}→${a1.count}、F6 ${b6.count}→${a6.count}、F10 ${b10.count}→${a10.count}`);
  add('B-5 单怪血落在 116–340 手感带（F1/F6/F10）',
    a1.hpAvg >= 98 && a6.hpAvg >= 98 && a10.hpAvg >= 98 && a10.hpAvg <= 340,
    `F1=${a1.hpAvg} F6=${a6.hpAvg} F10=${a10.hpAvg}`);
  add('B-6 最长空档 ≤3.0s（真实房含走到下一簇的路程）', a1.longestGap <= 3 && a6.longestGap <= 3 && a10.longestGap <= 3,
    `F1=${a1.longestGap}s F6=${a6.longestGap}s F10=${a10.longestGap}s`);
  add('B-7 同帧只爆一次（≥3 杀时）', a1.maxBlastsInFrame <= 1 && a6.maxBlastsInFrame <= 1,
    `F1=${a1.maxBlastsInFrame} F6=${a6.maxBlastsInFrame}`);

  const pass = checks.every((c) => c.pass);
  const report = {
    file: FILE,
    scenario: '真实战斗房（spawnEnemiesForFloor 生成）+ 脚本化玩家：接近→5 个范围技按真实冷却轮转，1/60s 步进',
    caveat: '脚本不模拟闪避/受击，位移按 p.speed 直线接近；before/after 同一套脚本，差异只来自预算表。',
    before: rows.before,
    after: rows.after,
    rawBefore: raw.before,
    rawAfter: raw.after,
    checks,
    verdict: pass ? 'PASS' : 'FAIL'
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== 改前 / 改后同场景对照 ===');
  const line = (tag, r) => console.log(tag.padEnd(14)
    + 'F' + String(r.floor).padEnd(3)
    + '怪=' + String(r.count).padEnd(4)
    + '单血=' + String(r.hpAvg).padEnd(6)
    + '几下=' + String(r.hitsPerKill46Avg).padEnd(5)
    + '清房=' + String(r.clearSec).padEnd(6)
    + '施法=' + String(r.casts).padEnd(4)
    + '≥3杀=' + String(r.threeKillCasts + '/' + r.casts).padEnd(8)
    + '单帧最多杀=' + String(r.maxKillsInFrame).padEnd(3)
    + '爆裂=' + String(r.blastCount).padEnd(3)
    + '空档=' + r.longestGap);
  rows.before.forEach((r) => line('BEFORE', r));
  rows.after.forEach((r) => line('AFTER', r));

  console.log('\n=== 断言 ===');
  checks.forEach((c) => console.log((c.pass ? 'PASS ' : 'FAIL ') + c.id + ' | ' + c.detail));
  console.log('\nRESULT: ' + report.verdict + ' -> ' + OUT);

  ws.close();
  killEdge(edge);
  if (!pass) process.exitCode = 1;
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
