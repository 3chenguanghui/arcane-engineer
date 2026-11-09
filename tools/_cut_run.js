/**
 * v1.3.0 · 端到端 20 层通关复查（一次性探针，用完可删）
 * ------------------------------------------------------------
 * 目标：
 *   1) 从标题页真实点击开局，逐层把所有房间走一遍并清空，直到第 20 层首领结算
 *   2) 记录每层：房间类型、游戏内耗时（秒）、掉血、传送兜底次数、是否超时
 *   3) 统计是否覆盖：换区 / 精英 / 事件 / 虚空裂隙 / 商店 / 宝箱
 *   4) 失败条件：某房 150s 打不完（打不动）、跑图 60s 到不了（卡死）、运行时异常
 *
 * 测试口径（会在报告里注明）：
 *   - 用 1/60 固定步长同步推进 update（等价 60fps 实时的游戏内时间），不走真实墙钟，
 *     这样 20 层能在可接受时间内跑完，且结果可复现。
 *   - 每间房开始前回满血：本测试验证的是"能不能走通/打完"，不是生存平衡；
 *     每间房的掉血仍按真实战斗记录（hpStart − hpMin）。
 *
 * 用法：node tools\_cut_run.js
 * 端口：9594
 * 说明：本文件由 _e2e20.js 复制而来，专供 C0 测量"一局完整时长"。
 *       与 e2e 的唯一实质差别：攻击入口从 weapons.attack() 改为 weapons.cast()（魔法施法）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
let PORT = 9594;   // 实际端口在 boot() 里动态挑选，见 pickFreePort

/**
 * 挑一个空闲的本地调试端口
 * 连不上（fetch 抛错）说明没人监听，即为空闲；全被占则回退 9594
 * @returns {Promise<number>} 端口号
 */
async function pickFreePort() {
  for (let p = 9500; p <= 9560; p += 1) {
    try {
      await fetch(`http://127.0.0.1:${p}/json/version`, { signal: AbortSignal.timeout(400) });
    } catch (error) {
      return p;
    }
  }
  return 9594;
}
/* 预检用：E2E_MAX_FLOOR=3 只跑前 3 层，正式验收不设就用 20 */
const MAX_FLOOR = Number(process.env.E2E_MAX_FLOOR || 20);
const ROOT = path.join(__dirname, '..');
/* CUT_FILE：只读复现用，可指向任意历史包（如 dist\emberfall_v1.6.0\烬_v1.6.0.html）；
   不设时仍跑主文件。 */
const FILE = path.resolve(process.env.CUT_FILE || path.join(ROOT, 'index_arcane_v2.html'));
const OUT = path.join(ROOT, '.screenshots', 'cut');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} [detail] 证据
 * @returns {void}
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + ' · ' + JSON.stringify(detail));
}

/**
 * 启动 Edge 并连接 CDP
 * @param {string} url 地址
 * @param {number} w 宽
 * @param {number} h 高
 * @param {number} dpr 像素比
 * @returns {Promise<Object>} CDP 句柄
 */
async function boot(url, w, h, dpr) {
  /* 每次启动先挑一个空闲调试端口：固定端口会被上一批还没退干净的 Edge 占住，
     新 Edge 绑不上 → 直接报「Edge 未就绪」，这也是批次连跑失败的真实原因。 */
  PORT = await pickFreePort();
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    /* 反节流：无头页会把 setTimeout 钳到 1s，导致"下楼淡出"的转场锁迟迟不释放 */
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--window-size=${w},${h}`, 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等待 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const runtimeErrors = [];
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      runtimeErrors.push((d && d.exception && (d.exception.description || d.exception.value)) || (d && d.text) || 'unknown');
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  /**
   * 发送 CDP 命令
   * @param {string} method 方法
   * @param {Object} [params] 参数
   * @returns {Promise<Object>}
   */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))): resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  /**
   * 页面内执行
   * @param {string} expression JS 表达式
   * @returns {Promise<*>}
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
  await send('Page.navigate', { url });
  await sleep(2600);
  return { ws, send, ev, runtimeErrors, edge };
}

/**
 * 注入页面内的机器人：走门、打怪、捡奖励、按 E 交互
 * @returns {string} 安装表达式
 */
function installBot() {
  return `(() => {
  window.__e2e = (function () {
    var fallback = 0;       /* 总兜底 */
    var fallbackDoor = 0;   /* 门口进不去的兜底（E5 只看这个） */
    var fallbackCombat = 0; /* 战斗够不到的兜底（机器人走位限制，单独报告） */
    /* 保命兜底的血量比例：默认 20%；补跑高难度楼层时可用 E2E_SAFE 提高 */
    var safeFrac = 0.2;
    var bots = {};
    /* C1-5b 测量：换房走路期间的疾跑归因（全部按"帧"累计，秒 = 帧/60）
       sprint    = 实际跑出了疾跑速度（无威胁）
       blockOld  = 旧口径拦下、新口径放行（本次改动的可回收量）
       blockBoth = 新旧口径都拦（血厚且在追，仍不能加速）
       bossLock  = 首领登场期间按设计一律禁跑
       still     = 位移 < 0.5px 的帧（撞墙 / 原地转向，不属于"走路"） */
    var sprintLog = { move: 0, sprint: 0, blockOld: 0, blockBoth: 0, bossLock: 0, still: 0, dist: 0 };
    /* 新口径：目标敌人血量 > 30% 且处于追击状态才拦疾跑（残血 / 脱战 / 隔地形都不拦） */
    function threatNew() {
      var p = state.player;
      for (var i = 0; i < state.enemies.length; i += 1) {
        var e = state.enemies[i];
        if (!e || e.hp <= 0) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) >= GAME_CONFIG.runSprintRange) continue;
        if (e.hp <= (e.hpMax || e.hp) * 0.3) continue;
        if (e.patrol || e.isBoss) continue;
        var era = e.roomId >= 0 ? state.rooms[e.roomId] : null;
        if (!era || !isInsideRoom(era, p.x, p.y, 6)) continue;
        if ((e.recover || 0) > 0 || (e.frozenTime || 0) > 0) continue;
        if (!losOk(e)) continue;
        return true;
      }
      return false;
    }
    /* 视线采样：与游戏 hasAimLineOfSight 同口径，隔墙的怪不算"正在追" */
    function losOk(e) {
      var p = state.player;
      var d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < 26) return true;
      var steps = Math.min(28, Math.max(2, Math.floor(d / 14)));
      for (var k = 1; k < steps; k += 1) {
        var t = k / steps;
        if (!isPointWalkable(p.x + (e.x - p.x) * t, p.y + (e.y - p.y) * t)) return false;
      }
      return true;
    }
    /* 旧口径：runSprintRange 内只要有活敌就拦 */
    function threatOld() {
      var p = state.player;
      for (var i = 0; i < state.enemies.length; i += 1) {
        var e = state.enemies[i];
        if (!e || e.hp <= 0) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < GAME_CONFIG.runSprintRange) return true;
      }
      return false;
    }
    /* 每帧记一笔（在 update 之后调用，用前后坐标差判断实际速度） */
    function noteSprint(px0, py0) {
      var moved = Math.hypot(state.player.x - px0, state.player.y - py0);
      if (moved < 0.5) { sprintLog.still += 1; return; }
      var baseStep = (state.player.speed || GAME_CONFIG.playerSpeed) / 60;
      sprintLog.move += 1;
      sprintLog.dist += moved;
      if (moved > baseStep * 1.4) { sprintLog.sprint += 1; return; }
      var bossLive = !!(state.boss && !state.boss.defeated && state.boss.introDone);
      if (bossLive) { sprintLog.bossLock += 1; return; }
      if (threatOld()) {
        if (threatNew()) sprintLog.blockBoth += 1;
        else sprintLog.blockOld += 1;
      }
    }
    /* 真实承伤计数：包一层 damagePlayer，累加 applied（护盾减免后的实际扣血）。
       这样即便中途补血，也能单独报告"这一间房到底吃了多少伤害"。
       v1.5.4 追加 dmgPeak：记录单次命中的最大扣血（"单波峰值伤害"），
       用于 F7/F20 的伤害曲线复盘。 */
    var dmgLog = 0;
    var dmgPeak = 0;   // 当前房间单次命中扣血峰值（每间房开打时清零）
    (function () {
      if (window.__e2eDmgWrapped || typeof damagePlayer !== 'function') return;
      window.__e2eDmgWrapped = true;
      var orig = window.damagePlayer;
      window.damagePlayer = function () {
        var res = orig.apply(this, arguments);
        if (res && Number(res.applied) > 0) {
          var applied = Number(res.applied);
          dmgLog += applied;
          if (applied > dmgPeak) dmgPeak = applied;
        }
        return res;
      };
    })();
    /* 回满血：测试口径 = 额外 140 点生命（走 mods.hpBonus 这条正规通道，
       这样 reward / 换层时 applyMetaStats 重算 hpMax 仍然是 240，不会把血"夹"回 100 产生假掉血） */
    function healSelf() {
      if (state.mods) state.mods.hpBonus = Math.max(state.mods.hpBonus || 0, 140);
      state.player.hpMax = Math.max(state.player.hpMax, 240);
      state.player.hp = state.player.hpMax;
      state.player.aether = state.player.aetherMax;
    }
    function alive() { return state.enemies.filter(function (e) { return e && e.hp > 0; }); }
    function roomById(id) { return state.rooms.filter(function (r) { return r.id === id; })[0] || null; }
    function roomEnemies(id) { return alive().filter(function (e) { return e.roomId === id; }); }
    function setKeys(l, r, u, d) { state.keys = { left: !!l, right: !!r, up: !!u, down: !!d }; }
    /* 该点能不能站（用游戏自己的碰撞测试，避免机器人往墙里钻） */
    function walkable(x, y) {
      try { return !!__roamDebug.walkableAt(x, y); } catch (e) { return true; }
    }
    /* 绕障转向：先试正方向，被挡就把方向按 ±25°/±50°… 旋转，取第一个前方可站的角度。
       房间里的掩体是凸的，这种"探路式转向"足够绕过，比直线撞墙稳得多。 */
    function steer(tx, ty) {
      var dx = tx - state.player.x, dy = ty - state.player.y;
      if (Math.hypot(dx, dy) < 2) { stop(); return; }
      var base = Math.atan2(dy, dx);
      var offs = [0, 25, -25, 50, -50, 75, -75, 100, -100, 135, -135, 170, -170];
      for (var i = 0; i < offs.length; i += 1) {
        var a = base + offs[i] * Math.PI / 180;
        var cx = Math.cos(a), cy = Math.sin(a);
        if (!walkable(state.player.x + cx * 26, state.player.y + cy * 26)) continue;
        setKeys(cx < -0.25, cx > 0.25, cy < -0.25, cy > 0.25);
        return;
      }
      stop();
    }
    /* 把玩家挪到敌人身边：优先选可站立的落点，避免传送进墙里又被碰撞弹回原位 */
    function placeNear(e) {
      if (!e) return false;
      var tryD = [Math.max(40, reachOf() * 0.8), Math.max(28, reachOf() * 0.5), 20];
      for (var ti = 0; ti < tryD.length; ti += 1) {
        for (var bi = 0; bi < 8; bi += 1) {
          var a = bi * Math.PI / 4;
          var x = e.x + Math.cos(a) * tryD[ti];
          var y = e.y + Math.sin(a) * tryD[ti];
          if (!walkable(x, y)) continue;
          __roamDebug.teleport(x, y);
          return true;
        }
      }
      __roamDebug.teleport(e.x, e.y);
      return true;
    }
    /* 朝向必须走调试口 setAimExact：它会同时写 mouseState 与 rawAngle。
       直接改 state.aim 会被 updateAim 每帧用鼠标角度覆盖，攻击会朝错方向（首轮 64s 只砍死 1 只就是这个原因）。 */
    function face(e) { __roamDebug.setAimExact(Math.atan2(e.y - state.player.y, e.x - state.player.x)); }
    function reachOf() { return (state.weapon && state.weapon.stats && state.weapon.stats.reach) || 100; }
    function stop() { setKeys(false, false, false, false); }
    /* 奖励弹窗：按"真人优先拿能打的范围技"打分选卡，替代无脑首卡 */
    function drain() {
      var n = 0;
      while (state.mode === 'reward' && n < 12) {
        var opts = state.upgradeOptions || [];
        var best = null, bs = -1e9;
        for (var i = 0; i < opts.length; i += 1) {
          var s = rewardScore(opts[i]);
          if (s > bs) { bs = s; best = opts[i]; }
        }
        if (!best) break;
        if (!chooseReward(best.key)) __roamDebug.xp.chooseFirst();
        n += 1;
      }
      return n;
    }
    function nearest(list) {
      var best = null, bd = 1e9;
      for (var i = 0; i < list.length; i += 1) {
        var d = Math.hypot(list[i].x - state.player.x, list[i].y - state.player.y);
        if (d < bd) { bd = d; best = list[i]; }
      }
      return { e: best, d: bd };
    }
    /* 建门图：用于找"当前房 → 目标房"的第一个门 */
    function buildAdj() {
      var adj = {};
      state.doors.forEach(function (d) {
        if (d.targetRoomId == null || d.targetRoomId < 0 || !roomById(d.targetRoomId)) return;
        (adj[d.roomId] = adj[d.roomId] || []).push({ next: d.targetRoomId, door: d });
        (adj[d.targetRoomId] = adj[d.targetRoomId] || []).push({ next: d.roomId, door: d });
      });
      return adj;
    }
    function firstDoor(fromId, toId) {
      if (fromId === toId) return null;
      var adj = window.__e2e.adj;
      if (!adj || !adj[fromId]) return null;
      var seen = {}, prev = {}, q = [fromId];
      seen[fromId] = true;
      var found = null;
      while (q.length) {
        var cur = q.shift();
        var list = adj[cur] || [];
        for (var i = 0; i < list.length; i += 1) {
          var nx = list[i].next;
          if (seen[nx]) continue;
          seen[nx] = true; prev[nx] = { from: cur, edge: list[i] };
          if (nx === toId) { found = nx; q = []; break; }
          q.push(nx);
        }
      }
      if (found == null) return null;
      var node = prev[found], d = node.edge.door;
      while (node && prev[node.from]) { d = prev[node.from].edge.door; node = prev[node.from]; }
      return d;
    }
    /* ---- C0：把机器人从"只按首卡"升级成"会挑卡、会轮转技能"的脚本玩家 ---- */
    /* 出手优先级：先用真实范围技（一发打一片），再用单点/投射补伤害 */
    var SKILL_ORDER = ['lavaFissure', 'frostRing', 'flameCone', 'runeOrbit', 'collapseHole',
      'arcanePool', 'fireball', 'bolt', 'blade', 'mine', 'frost'];
    var RARITY_RANK = { common: 1, rare: 2, epic: 3, legend: 4, mythic: 5 };
    /**
     * 从"已拥有"的魔法里挑一条当前冷却结束的，按 SKILL_ORDER 优先范围技
     * @returns {string|null} 魔法 id
     */
    function pickOwnedSkill() {
      var owned = state.ownedMagic || [];
      for (var i = 0; i < SKILL_ORDER.length; i += 1) {
        var id = SKILL_ORDER[i];
        if (owned.indexOf(id) >= 0 && (state.cooldowns[id] || 0) <= 0.001) return id;
      }
      return null;
    }
    /**
     * 奖励选项打分：真人会更想要能打的范围/高 DPS 魔法，其次融合/科技
     * @param {Object} opt 奖励选项
     * @returns {number} 分数（越大越优先）
     */
    function rewardScore(opt) {
      if (!opt) return -1e9;
      if (opt.kind === 'magic') {
        var m = MAGIC_BY_ID[opt.id];
        var dps = (m && m.damage) ? (m.damage / Math.max(0.3, m.cooldown || 1)) : 0;
        return 100 + dps + (RARITY_RANK[opt.rarity] || 0) * 5;
      }
      if (opt.kind === 'fusion') return 60;
      if (opt.kind === 'tech') return 50;
      if (opt.kind === 'pact') return 40;
      return 10;
    }
    /* 走到某个坐标：带卡死检测，连续 3 次"60 帧无位移"才传送兜底 */
    function walkTo(x, y, maxFrames) {
      var frames = 0, lastX = state.player.x, lastY = state.player.y, still = 0, falls = 0;
      while (frames < maxFrames) {
        drain();
        if (state.mode !== 'playing' || state.status !== 'playing') break;
        var dx = x - state.player.x, dy = y - state.player.y;
        if (Math.hypot(dx, dy) < 22) break;
        steer(x, y);
        var near = nearest(alive().filter(function (e) {
          return Math.hypot(e.x - state.player.x, e.y - state.player.y) < 150;
        }));
        if (near.e) { face(near.e); if (near.d <= reachOf() + (near.e.radius || 14) - 2) __roamDebug.cast(); }
        var px0 = state.player.x, py0 = state.player.y;
        update(1 / 60); frames += 1;
        noteSprint(px0, py0);
        if (frames % 60 === 0) {
          if (Math.abs(state.player.x - lastX) + Math.abs(state.player.y - lastY) < 4) still += 1; else still = 0;
          lastX = state.player.x; lastY = state.player.y;
          if (still >= 3) { __roamDebug.teleport(x, y); update(1 / 60); falls += 1; fallback += 1; still = 0; }
        }
      }
      stop();
      return { frames: frames, fallback: falls };
    }
    /* 清空指定房间：怪死光后还要等 90 帧（虚空裂隙会分批刷怪） */
    function fight(roomId, maxFrames) {
      var frames = 0, quiet = 0, hpStart = state.player.hp, hpMin = state.player.hp, kills0 = state.kills;
      var dmg0 = dmgLog, midHeals = 0, assist = 0;
      dmgPeak = 0;                       // 本间房重新计峰值
      var hpTrail = [];                  // 每秒采一次血量，画"血量曲线"（只对 F7/F20 落盘）
      var dmgTrail = [];                 // v1.5.5：每秒采一次累计承伤，与 hpTrail 并排画"承伤曲线"
      /* C1-5b：进门→接战距离（本房最近活敌的直线距离），用于核对"出生点前移" */
      var enterNear = nearest(roomEnemies(roomId));
      var enterD = enterNear.e ? Math.round(enterNear.d) : -1;
      var enterEnemyD = enterNear.e ? Math.round(Math.hypot(enterNear.e.x - (state.rooms[roomId] ? state.rooms[roomId].cx : enterNear.e.x),
        enterNear.e.y - (state.rooms[roomId] ? state.rooms[roomId].cy : enterNear.e.y))) : -1;
      var lastX = state.player.x, lastY = state.player.y, still = 0, tps = 0;
      var lastHp = -1, stale = 0;
      var atkTries = 0, atkOk = 0;
      var failSample = null, lockFrames = 0;
      var hpSum0 = roomEnemies(roomId).reduce(function (a, e) { return a + Math.max(0, e.hp); }, 0);
      while (frames < maxFrames) {
        drain();
        /* 每秒采一次血量，形成"玩家血量曲线"（v1.5.4 的 F7/F20 伤害复盘用） */
        if (frames % 60 === 0) hpTrail.push({ t: Math.round(frames / 60), hp: Math.round(state.player.hp) });
        if (frames % 60 === 0) dmgTrail.push({ t: Math.round(frames / 60), dmg: Math.round(dmgLog - dmg0) });
        if (state.mode !== 'playing' || state.status !== 'playing') break;
        var es = roomEnemies(roomId);
        if (es.length === 0) { quiet += 1; if (quiet >= 90) break; } else { quiet = 0; }
        var near = nearest(es);
        if (near.e) {
          var ex = near.e.x - state.player.x;
          var ey = near.e.y - state.player.y;
          face(near.e);
          /* 真人打法：轮转"已拥有且冷却好了"的技能，优先范围技；没得打就等冷却 */
          var skillId = pickOwnedSkill();
          if (skillId) { state.activeMagicId = skillId; if (state.dual) state.dual.slots[0] = skillId; }
          if (near.d <= 420) {
            atkTries += 1;
            if (__roamDebug.cast()) atkOk += 1;
            else if (!failSample && !skillId) {
              /* 第一次攻击被拒时抓现场：到底是被转场锁 / 冷却 / 模式 / 空武器里的哪一条挡下 */
              failSample = {
                lock: !!state.transitionLock,
                cd: state.weapon ? state.weapon.cd : -1,
                queued: state.weapon ? state.weapon.queued : -1,
                hasWeapon: !!state.weapon,
                mode: state.mode, status: state.status,
                floor: state.floor, roomNow: state.currentRoomId
              };
            }
          }
          /* 走位：够远就走近，贴太近退半步（模拟真人走位，避免全程贴脸吃接触伤害） */
          if (near.d > 110) steer(near.e.x, near.e.y);
          else if (near.d < 42) setKeys(ex > 5, ex < -5, ey > 5, ey < -5);
          else stop();
          /* 有效伤害进度：敌人血量 3 秒没变化，说明这一刀根本没落到（多半被墙/掩体隔开） */
          var ehp = Math.round(near.e.hp);
          if (ehp === lastHp) stale += 1; else { stale = 0; lastHp = ehp; }
        } else {
          stop();
        }
        /* 保命兜底：血量掉到 safeFrac 以下回满（单独计数，不参与"掉血"口径，报告里单列） */
        if (state.player.hp <= state.player.hpMax * safeFrac) { healSelf(); midHeals += 1; }
        if (state.transitionLock) lockFrames += 1;
        update(1 / 60); frames += 1;
        if (state.player.hp < hpMin) hpMin = state.player.hp;
        if (frames % 60 === 0) {
          if (Math.abs(state.player.x - lastX) + Math.abs(state.player.y - lastY) < 4) still += 1; else still = 0;
          lastX = state.player.x; lastY = state.player.y;
          /* 追不上（2 秒无位移且够不到）→ 贴到敌人身边 */
          if (still >= 2 && near.e && near.d > reachOf()) {
            placeNear(near.e);
            update(1 / 60); tps += 1; assist += 1; fallback += 1; fallbackCombat += 1; still = 0;
          } else if (stale >= 180) {
            /* 打不中（3 秒零有效伤害）→ 贴到可站立的位置重打 */
            var cur = nearest(roomEnemies(roomId));
            if (cur.e) {
              placeNear(cur.e);
              update(1 / 60); tps += 1; assist += 1; fallback += 1; fallbackCombat += 1;
            }
            stale = 0;
          }
        }
      }
      stop();
      /* 现场诊断：超时房要能看出"人站哪、怪在哪、够不够得着" */
      var diag = null;
      try {
        var rest = roomEnemies(roomId);
        var nr = nearest(rest);
        diag = {
          rest: rest.length,
          sameRoom: state.currentRoomId === roomId,
          roomNow: state.currentRoomId,
          d: nr.e ? Math.round(nr.d) : -1,
          reach: Math.round(reachOf()),
          enemyHp: nr.e ? Math.round(nr.e.hp) : -1,
          px: Math.round(state.player.x), py: Math.round(state.player.y),
          ex: nr.e ? Math.round(nr.e.x) : -1, ey: nr.e ? Math.round(nr.e.y) : -1,
          hpSum0: Math.round(hpSum0),
          hpSum1: Math.round(rest.reduce(function (a, e) { return a + Math.max(0, e.hp); }, 0)),
          atkTries: atkTries, atkOk: atkOk,
          enemy: nr.e ? {
            type: nr.e.type, kind: nr.e.kind, hp: Math.round(nr.e.hp),
            hpMax: Math.round(nr.e.hpMax || 0), shieldHp: Math.round(nr.e.shieldHp || 0)
          } : null,
          weapon: __roamDebug.weapons.info()
        };
      } catch (e) { diag = { error: String(e) }; }
      return { frames: frames, hpStart: hpStart, hpMin: hpMin, hpEnd: state.player.hp,
        kills: state.kills - kills0, remaining: roomEnemies(roomId).length, timedOut: frames >= maxFrames,
        fallback: tps, assist: assist, dmg: dmgLog - dmg0, midHeals: midHeals, diag: diag,
        dmgPeak: Math.round(dmgPeak), hpTrail: hpTrail, dmgTrail: dmgTrail,
        failSample: failSample, lockFrames: lockFrames,
        enterD: enterD, enterEnemyD: enterEnemyD,
        spawnShift: (state.rooms[roomId] && state.rooms[roomId].spawnShift)
          ? Math.round(state.rooms[roomId].spawnShift.dist) : 0 };
    }
    return {
      prepare: function () { window.__e2e.adj = buildAdj(); fallback = 0; },
      info: function () {
        /* C1-5b 诊断：清层判定看的是"房间里还有没有活怪"，所以这里把
           可能卡住清层的活怪样本一并带出来（roomId / 坐标 / 是否卡在不可走区），
           避免 E3 只能看到 cleared:false 却不知道卡在哪只怪身上。 */
        var stray = [];
        try {
          for (var si = 0; si < state.enemies.length && stray.length < 6; si += 1) {
            var se = state.enemies[si];
            if (!se || !(se.hp > 0) || !(se.roomId >= 0)) continue;
            stray.push({ room: se.roomId, x: Math.round(se.x), y: Math.round(se.y),
              hp: Math.round(se.hp), kind: se.kind || se.type || '',
              stuck: (typeof isPointWalkable === 'function') ? !isPointWalkable(se.x, se.y) : null });
          }
        } catch (e) { stray.push({ error: String(e) }); }
        return {
          floor: state.floor, mode: state.mode, status: state.status,
          hp: state.player.hp, hpMax: state.player.hpMax, kills: state.kills,
          cleared: !!state.floorCleared, rooms: state.rooms.length,
          roomEnemies: state.enemies.filter(function (e) { return e.roomId >= 0 && e.hp > 0; }).length,
          stray: stray,
          roomTypes: state.rooms.map(function (r) { return r.type; }),
          region: (typeof regionOf === 'function') ? regionOf(state.floor).name : String(state.floor),
          bossRoom: state.rooms.filter(function (r) { return r.type === 'boss'; }).map(function (r) { return r.id; }),
          voidRift: state.voidRift ? { x: state.voidRift.x, y: state.voidRift.y, used: state.voidRift.used } : null
        };
      },
      gotoRoom: function (id, maxFrames) {
        var room = roomById(id);
        if (!room) return { frames: 0, fallback: 0, missing: true };
        var frames = 0, falls = 0, guard = 0;
        /* 每圈：找"当前房 → 目标房"的第一个门 → 走到门 → 再沿门洞方向多走 80px 触发换房 */
        while (frames < (maxFrames || 3600) && guard < 200) {
          guard += 1;
          var lap0 = frames;
          drain();
          if (state.currentRoomId === id) break;
          var cur = roomById(state.currentRoomId);
          var door = firstDoor(state.currentRoomId, id);
          if (!door) {
            /* 无门连通（同层一般不会出现）：直接朝目标房中心走 */
            var s0 = walkTo(room.cx, room.cy, 900);
            frames += s0.frames; falls += s0.fallback;
            break;
          }
          var step = walkTo(door.x, door.y, 600);
          frames += step.frames; falls += step.fallback;
          var dx = door.x - (cur ? cur.cx : state.player.x);
          var dy = door.y - (cur ? cur.cy : state.player.y);
          var len = Math.hypot(dx, dy) || 1;
          var s1 = walkTo(door.x + (dx / len) * 80, door.y + (dy / len) * 80, 240);
          frames += s1.frames; falls += s1.fallback;
          /* 一圈几乎没动：已经贴在门洞上却进不去 → 直接推到门另一侧（记兜底） */
          if (frames - lap0 < 10) {
            __roamDebug.teleport(door.x + (dx / len) * 90, door.y + (dy / len) * 90);
            update(1 / 60); falls += 1; fallback += 1; fallbackDoor += 1;
          }
        }
        stop();
        return { frames: frames, fallback: falls, room: state.currentRoomId };
      },
      gotoPoint: function (x, y, maxFrames) { return walkTo(x, y, maxFrames || 1200); },
      fight: function (roomId, maxFrames) { return fight(roomId, maxFrames || 9000); },
      interact: function () {
        var used = [];
        if (typeof tryEventRoomInteract === 'function' && tryEventRoomInteract()) used.push('event');
        if (typeof tryBossChestInteract === 'function' && tryBossChestInteract()) used.push('chest');
        if (typeof tryVoidRiftInteract === 'function' && tryVoidRiftInteract()) used.push('rift');
        if (typeof trySurvivalInteract === 'function' && trySurvivalInteract()) used.push('survival');
        update(1 / 60);
        return used;
      },
      drain: drain,
      heal: healSelf,
      sprint: function () { return JSON.parse(JSON.stringify(sprintLog)); },
      descend: function () {
        var f0 = state.floor;
        if (typeof __roamDebug.descend === 'function') __roamDebug.descend();
        update(1 / 60);
        return { from: f0, to: state.floor };
      },
      fallback: function () { return fallback; },
      fallbackDoor: function () { return fallbackDoor; },
      fallbackCombat: function () { return fallbackCombat; },
      /* v1.5.5：允许 safeFrac=0（真实血量验收必须能关掉保命兜底） */
      setSafe: function (f) {
        var n = Number(f);
        safeFrac = (n >= 0 && n <= 1) ? n : 0.2;
        return safeFrac;
      }
    };
  })();
  return true;
})()`;
}

/**
 * 等"场景转场锁"解除。
 * playSceneFade 用 setTimeout 释放 state.transitionLock；而本探针的战斗是同步
 * update 循环，同步执行期间定时器不会触发，锁会一直挂着，导致 tryWeaponAttack 全部返回 false。
 * 所以每次跨房 / 下楼后，必须回到真实事件循环等锁释放。
 * @param {Object} h CPD 句柄
 * @param {number} [ms] 最长等待毫秒
 * @returns {Promise<boolean>} 是否已解锁
 */
async function waitUnlock(h, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!(await h.ev(`(() => !!state.transitionLock)()`))) return true;
    await sleep(50);
  }
  /* 等超时：无头定时器仍被节流时，直接放锁（视觉淡出对本探针无意义），并留痕 */
  await h.ev(`(() => { try { state.transitionLock = false; return true; } catch (e) { return false; } })()`);
  console.log('  ! 转场锁等 ' + ms + 'ms 未释放，已强制解锁');
  return false;
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const h = await boot('file:///' + FILE.replace(/\\/g, '/'), 1600, 900, 1);
  try {
    await h.ev(installBot());
    /* C1-6 诊断：前 40 秒记录真实施法 / 击杀（用于核对开篇赠礼到底有没有出手） */
    await h.ev(`(() => {
      window.__c16 = { casts: [], kills: [] };
      var rawCast = castSlot;
      castSlot = function (slot, loud) {
        var id = state.dual ? state.dual.slots[slot] : state.activeMagicId;
        var ok = rawCast(slot, loud);
        var at = state.elapsed || 0;
        if (ok && at <= 40) {
          window.__c16.casts.push({ at: +at.toFixed(2), slot: slot, id: id,
            aether: Math.round(state.player.aether),
            gift: !!(state.openingGift && state.openingGift.active) });
        }
        return ok;
      };
      var rawKill = killEnemy;
      killEnemy = function (e) {
        var at = state.elapsed || 0;
        if (at <= 40) {
          window.__c16.kills.push({ at: +at.toFixed(2), hp: e.hpMax, boss: !!e.isBoss, room: e.roomId });
        }
        return rawKill(e);
      };
      return true;
    })()`);
    /* v1.7.0 三角色：冒烟保持"中性角色"口径（与 v1.6.1 基线同条件）；
       选择页本身由 tools/_char_verify_tmp.js 单独验收 */
    await h.ev('__charPickedThisBoot = true; true');
    // 标题页真实点击开局
    const btn = await h.ev(`(() => { const b = document.getElementById('btnStart'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await h.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
    await h.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
    await sleep(1200);
    // 测试口径：把最大生命抬到 240（E2E_HP 可改），避免 bot 在后期楼层必死导致无法遍历；每房仍记录真实掉血
    const HP = Number(process.env.E2E_HP || 240);
    await h.ev(`(() => { state.mods.hpBonus = Math.max(state.mods.hpBonus || 0, ${HP - 100}); state.player.hpMax = Math.max(state.player.hpMax, ${HP}); state.player.hp = state.player.hpMax; return state.player.hpMax; })()`);
    // 补跑支持：E2E_START_FLOOR=18 直接从第 18 层起跑（用于单次长跑死掉后补完剩余楼层）
    const START_FLOOR = Number(process.env.E2E_START_FLOOR || 1);
    await h.ev(`__e2e.setSafe(${Number(process.env.E2E_SAFE || 0.2)})`);
    if (START_FLOOR > 1) {
      await h.ev(`__roamDebug.setFloor(${START_FLOOR})`);
      await sleep(400);
      await waitUnlock(h);
      console.log('  · 从第 ' + START_FLOOR + ' 层起跑（保命阈值 ' + (process.env.E2E_SAFE || 0.2) + '）');
    }
    /* v1.5.5 快速迭代：E2E_DEEP_AB_ONLY=1 时直接用 deep-snapshot.json 里的 F20 快照，
       注入 localStorage 后恢复，跳过 F1→F19 的长跑。快照由 E2E_DEEP_AB=1 的首跑落盘。 */
    if (process.env.E2E_DEEP_AB_ONLY === '1') {
      const snapPath = path.join(OUT, 'deep-snapshot.json');
      if (!fs.existsSync(snapPath)) throw new Error('缺少 deep-snapshot.json：请先跑一次 E2E_DEEP_AB=1 生成 F20 快照');
      const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      const injected = await h.ev(`(() => {
        localStorage.setItem('arcane_run_slots_v1', ${JSON.stringify(snap.store)});
        var rr = restoreRunFromSlot(1);
        return { restore: rr, floor: state.floor, hp: Math.round(state.player.hp), hpMax: state.player.hpMax,
          aliveEnemies: state.enemies.filter(function (e) { return e && e.hp > 0; }).length };
      })()`);
      if (!injected || !injected.restore || !injected.restore.ok) throw new Error('快照注入失败: ' + JSON.stringify(injected));
      console.log('  · 磁盘快照已恢复：F' + injected.floor + ' · hp ' + injected.hp + '/' + injected.hpMax
        + ' · 活敌 ' + injected.aliveEnemies);
      await sleep(200);
      await waitUnlock(h);
    }

    const floors = [];
    const globalTypes = { elite: 0, event: 0, survival: 0, shop: 0, chest: 0, boss: 0 };
    let usedRift = 0;
    let regions = new Set();
    let totalFrames = 0;
    let deaths = 0;
    let aborted = false;
    /* C1：记录整局真实结晶入账（meta.crystals 只增不减，直接读首尾差值） */
    const crystalsStart = Number(await h.ev(`(() => (state.meta && state.meta.crystals) || 0)()`));

    for (let guard = 0; guard < 26; guard += 1) {
      const before = await h.ev(`__e2e.info()`);
      if (before.mode === 'result' || before.status === 'won') {
        floors.push({ floor: before.floor, finished: true, summary: 'WIN' });
        break;
      }
      await h.ev(`__e2e.prepare()`);
      const info = await h.ev(`__e2e.info()`);
      /* 批次遥测用：每层起跑打一个带时间戳的标记，便于和外部 CPU / Edge 采样对齐分档 */
      console.log('FLOOR-START F' + info.floor + ' ' + new Date().toISOString());
      /* 按难度递增顺序访问：先小房后精英，首领最后 */
      const order = ['start', 'battle', 'elite', 'shop', 'chest', 'event', 'survival', 'boss'];
      const ids = await h.ev(`(() => {
        var out = {};
        state.rooms.forEach(function (r) { (out[r.type] = out[r.type] || []).push(r.id); });
        return out;
      })()`);
      const queue = [];
      order.forEach((t) => { (ids[t] || []).forEach((id) => queue.push({ id, type: t })); });

      /* v1.5.5 C2-1 验收：E2E_DEEP_AB=1 时，在第 20 层开局处存一份快照，再用同一份快照做 A/B。
         A = 关闭深层回血（等价 v1.5.4），B = 开启；两组都关掉"每房回满"与"20% 保命兜底"，
         这样血量曲线才是真实承伤 + 真实回血，而不是被兜底抹平。 */
      if (process.env.E2E_DEEP_AB === '1') {
        const abFloor = Number(process.env.E2E_DEEP_AB_FLOOR || 20);
        /* 打磨轮第 1 项：一轮里跑多组，off=关闭深层回血（基线）/ shield=溢出转护盾 / bank=溢出存蓄能 */
        const modes = String(process.env.E2E_DEEP_MODES || 'off,shield,bank')
          .split(',').map((s) => s.trim()).filter(Boolean);
        if (info.floor === abFloor) {
          /* 整段 A/B 都放在同一个页面表达式里同步跑：
             1) 跨 CDP 往返时，活着的 rAF 可能触发自动存档；死亡结算还会 clearRunSlot。
             2) 读档后把 state.runSlot 置 0，避免 A 组死亡时把刚存的快照槽清掉。 */
          const ab = await h.ev(`(() => {
            function waitUnlock() {
              var n = 0;
              while (state.transitionLock && n < 360) { update(1 / 60); n += 1; }
              return n;
            }
            var Q = ${JSON.stringify(queue)};
            var saved = saveRunSlot(1, 'probe');
            /* 快照原样带出去：下一次可用 E2E_DEEP_AB_ONLY=1 直接注入 localStorage，
               省掉 F1→F20 的长跑（迭代调参从 ~12 分钟降到 ~3 分钟）。 */
            var storeText = localStorage.getItem('arcane_run_slots_v1') || '';
            var MODES = ${JSON.stringify(modes)};
            var rows = [];
            for (var k = 0; k < MODES.length; k += 1) {
              var mode = MODES[k];
              var on = mode !== 'off';
              var rec = { mode: mode, deepHeal: on, restore: null, start: null, segments: [], dead: false };
              var rr = restoreRunFromSlot(1);
              rec.restore = rr;
              if (!rr || !rr.ok) { rows.push(rec); continue; }
              state.runSlot = 0;
              __roamDebug.deepHeal.setEnabled(on);
              if (on && __roamDebug.deepHeal.setOverflow) __roamDebug.deepHeal.setOverflow(mode);
              __e2e.setSafe(0);
              __e2e.prepare();
              waitUnlock();
              rec.start = { floor: state.floor, hp: Math.round(state.player.hp), hpMax: state.player.hpMax };
              for (var i = 0; i < Q.length; i += 1) {
                var item = Q[i];
                if (item.type === 'shop' || item.type === 'start') continue;
                waitUnlock();
                __e2e.gotoRoom(item.id, 3000);
                waitUnlock();
                var f = __e2e.fight(item.id, item.type === 'boss' ? 20000 : 9000);
                if (['event', 'chest', 'survival'].indexOf(item.type) >= 0) {
                  var used = __e2e.interact();
                  if (used && used.length) {
                    waitUnlock();
                    var extra = __e2e.fight(item.id, 9000);
                    f.dmg = (f.dmg || 0) + (extra.dmg || 0);
                    f.hpMin = Math.min(f.hpMin === 0 ? extra.hpMin : f.hpMin, extra.hpMin);
                    f.hpEnd = extra.hpEnd;
                    f.hpTrail = (f.hpTrail || []).concat(extra.hpTrail || []);
                    f.dmgTrail = (f.dmgTrail || []).concat(extra.dmgTrail || []);
                    f.dmgPeak = Math.max(f.dmgPeak || 0, extra.dmgPeak || 0);
                  }
                }
                rec.segments.push({
                  room: item.id, type: item.type, seconds: Number((f.frames / 60).toFixed(2)),
                  hpStart: Math.round(f.hpStart || 0), hpEnd: Math.round(f.hpEnd || 0),
                  hpMin: Math.round(f.hpMin || 0), dmg: Math.round(f.dmg || 0),
                  dmgPeak: Math.round(f.dmgPeak || 0), kills: f.kills || 0,
                  /* 诊断：玩家阵亡时目标还剩多少血 / 还剩几只怪 ——
                     用来判断"是补血不够还是机器人 DPS 不够" */
                  targetHpLeft: (f.diag && f.diag.enemyHp != null) ? f.diag.enemyHp : -1,
                  rest: (f.remaining == null ? -1 : f.remaining),
                  hpTrail: f.hpTrail || [], dmgTrail: f.dmgTrail || [], endStatus: state.status
                });
                if (state.status !== 'playing') break;
              }
              rec.dead = state.status !== 'playing';
              rec.shieldEnd = Math.round(state.player.deepShield || 0);
              rec.bankEnd = Math.round(state.deepHealBank || 0);
              rows.push(rec);
            }
            return { saved: saved, rows: rows, status: state.status, store: storeText };
          })()`);
          if (!ab || !ab.saved || !ab.saved.ok) throw new Error('第 ' + abFloor + ' 层快照保存失败: ' + JSON.stringify(ab && ab.saved));
          fs.writeFileSync(path.join(OUT, 'deep-ab.json'), JSON.stringify({ at: new Date().toISOString(), steps: ab.rows }, null, 2));
          /* 落盘快照原文：E2E_DEEP_AB_ONLY=1 时直接注入 localStorage 复用，不用再跑 F1→F20 */
          fs.writeFileSync(path.join(OUT, 'deep-snapshot.json'), JSON.stringify({ at: new Date().toISOString(), store: ab.store }));
          console.log('\n===== v1.5.5 · F' + abFloor + ' 深层回血 A/B =====');
          ab.rows.forEach((r) => {
            const dmg = (r.segments || []).reduce((a, s) => a + (s.dmg || 0), 0);
            const last = r.segments && r.segments.length ? r.segments[r.segments.length - 1] : null;
            const boss = (r.segments || []).filter((s) => s.type === 'boss');
            const bmin = boss.reduce((a, s) => Math.min(a, s.hpMin), 9999);
            console.log((r.mode === 'off' ? 'A 关闭' : ('B ' + r.mode)) + ' · 读档 ' + JSON.stringify(r.restore)
              + ' · 承伤 ' + dmg + ' · 死亡 ' + r.dead
              + ' · 终点 hp ' + (last ? last.hpEnd : '-') + ' / ' + (r.start ? r.start.hpMax : '-')
              + ' · 首领段最低血 ' + (boss.length ? bmin : '-')
              + ' · 盾 ' + (r.shieldEnd || 0) + ' · 蓄 ' + (r.bankEnd || 0));
          });
          return;
        }
      }

      const floorStartFrames = Number(await h.ev(`(() => state.elapsed)()`));
      const segments = [];
      let doorInteractions = 0;
      let riftUsedOnFloor = false;

      for (const item of queue) {
        // 每房开始回满血（测试口径），记录该房真实掉血
        await h.ev(`__e2e.heal()`);
        await waitUnlock(h);
        // C1-5b：换房走路前的疾跑统计快照（差值 = 本段"到门→进门→到位"的走图归因）
        const sp0 = await h.ev(`__e2e.sprint()`);
        const go = await h.ev(`__e2e.gotoRoom(${item.id}, 3000)`);
        await waitUnlock(h);
        const sp1 = await h.ev(`__e2e.sprint()`);
        const spD = {};
        Object.keys(sp1).forEach((k) => { spD[k] = Number(sp1[k] || 0) - Number(sp0[k] || 0); });
        const segT0 = Number(await h.ev(`(() => state.elapsed)()`));
        const fight = item.type === 'start' || item.type === 'shop' ? { frames: 0, hpStart: 0, hpMin: 0, hpEnd: 0, kills: 0, remaining: 0, dmg: 0, midHeals: 0 }
          : await h.ev(`__e2e.fight(${item.id}, ${item.type === 'boss' ? 30000 : 9000})`);
        let used = [];
        if (['event', 'chest', 'survival'].indexOf(item.type) >= 0) {
          used = await h.ev(`__e2e.interact()`);
          if (used.length) {
            await waitUnlock(h);
            const extra = await h.ev(`__e2e.fight(${item.id}, 9000)`);
            fight.frames += extra.frames;
            fight.hpMin = Math.min(fight.hpMin === 0 ? extra.hpMin : fight.hpMin, extra.hpMin);
            fight.hpEnd = extra.hpEnd;
            fight.kills += extra.kills;
            fight.dmg = (fight.dmg || 0) + (extra.dmg || 0);
            fight.midHeals = (fight.midHeals || 0) + (extra.midHeals || 0);
            fight.assist = (fight.assist || 0) + (extra.assist || 0);
            if (extra.diag) fight.diag = extra.diag;
          }
        }
        /* 虚空裂隙：每局至少用一次 */
        if (!riftUsedOnFloor && info.voidRift && !info.voidRift.used && item.type !== 'boss') {
          const rp = await h.ev(`__e2e.gotoPoint(${info.voidRift.x}, ${info.voidRift.y}, 900)`);
          const rUsed = await h.ev(`__e2e.interact()`);
          if (rUsed.indexOf('rift') >= 0) { usedRift += 1; riftUsedOnFloor = true; doorInteractions += 1; }
          await h.ev(`__e2e.gotoRoom(${item.id}, 900)`);
          await waitUnlock(h);
        }
        const segT1 = Number(await h.ev(`(() => state.elapsed)()`));
        segments.push({
          room: item.id, type: item.type,
          travelFrames: go.frames, travelFallback: go.fallback,
          fightFrames: fight.frames || 0,
          seconds: Number((segT1 - segT0).toFixed(2)),
          hpStart: Math.round(fight.hpStart || 0),
          hpMin: Math.round(fight.hpMin || 0),
          hpLoss: Math.round(Math.max(0, (fight.hpStart || 0) - (fight.hpMin || 0))),
          kills: fight.kills || 0, remaining: fight.remaining || 0,
          dmg: Math.round(fight.dmg || 0), midHeal: fight.midHeals || 0,
          dmgPeak: Math.round(fight.dmgPeak || 0), hpTrail: fight.hpTrail || [],
          assist: fight.assist || 0, diag: fight.diag || null,
          fail: fight.failSample || null, lockFrames: fight.lockFrames || 0,
          timedOut: !!fight.timedOut, interact: used,
          enterD: fight.enterD == null ? -1 : fight.enterD,
          enterEnemyD: fight.enterEnemyD == null ? -1 : fight.enterEnemyD,
          spawnShift: fight.spawnShift || 0,
          walk: spD
        });
        if (item.type === 'elite') globalTypes.elite += 1;
        if (item.type === 'event') globalTypes.event += 1;
        if (item.type === 'survival') globalTypes.survival += 1;
        if (item.type === 'shop') globalTypes.shop += 1;
        if (item.type === 'chest') globalTypes.chest += 1;
        if (item.type === 'boss') globalTypes.boss += 1;
        if (fight.timedOut) aborted = true;
        deadCheck: {
          if ((await h.ev(`(() => state.status)()`)) !== 'playing') { deaths += 1; aborted = true; }
        }
        if (aborted) break;
      }
      /* C1-5b 扫尾：代价门 / 事件波会把怪刷进"非战斗房"。
         实测 F12：spawnPricedWave 在商店房刷了 4 只（roomId=4），而探针把商店
         按 0 秒跳过 → 整层永远清不掉（E3 红，且 stray 里能看到 hp 572 的怪）。
         真实玩家会回头清掉残怪，这里补最多 3 间，时间照常计入本层。 */
      let pre = await h.ev(`__e2e.info()`);
      for (let sweep = 0; sweep < 3 && !pre.cleared; sweep += 1) {
        const foes = await h.ev(`(() => {
          var m = {};
          state.enemies.forEach(function (e) { if (e && e.hp > 0 && e.roomId >= 0) m[e.roomId] = 1; });
          return Object.keys(m).map(Number);
        })()`);
        if (!foes.length) break;
        const rid = foes[0];
        await h.ev(`__e2e.heal()`);
        await waitUnlock(h);
        const s0 = Number(await h.ev(`(() => state.elapsed)()`));
        await h.ev(`__e2e.gotoRoom(${rid}, 3000)`);
        await waitUnlock(h);
        const s1 = Number(await h.ev(`(() => state.elapsed)()`));
        const extraFight = await h.ev(`__e2e.fight(${rid}, 9000)`);
        const s2 = Number(await h.ev(`(() => state.elapsed)()`));
        segments.push({
          room: rid, type: 'sweep', travelFrames: 0, travelFallback: 0,
          fightFrames: extraFight.frames || 0,
          seconds: Number((s2 - s0).toFixed(2)),
          hpStart: Math.round(extraFight.hpStart || 0), hpMin: Math.round(extraFight.hpMin || 0),
          hpLoss: Math.round(Math.max(0, (extraFight.hpStart || 0) - (extraFight.hpMin || 0))),
          kills: extraFight.kills || 0, remaining: extraFight.remaining || 0,
          dmg: Math.round(extraFight.dmg || 0), midHeal: extraFight.midHeals || 0,
          assist: extraFight.assist || 0, diag: extraFight.diag || null, fail: null,
          lockFrames: 0, timedOut: !!extraFight.timedOut, interact: [],
          enterD: -1, enterEnemyD: -1, spawnShift: 0,
          walk: { move: Number((s1 - s0).toFixed(2)), sprint: 0, blockOld: 0, blockBoth: 0, bossLock: 0, still: 0, dist: 0 }
        });
        pre = await h.ev(`__e2e.info()`);
      }
      /* C1-5b：floorCleared 是"首领死亡 + 结算动画"之后才置位，
         立刻采样会读到 false（实测 F13 因此误判 UNCLEARED，但其实已经下楼成功）。
         这里最多等 1.2s，并把等待时长记进 clearedLagMs，避免把采样时序问题当成功能红项。 */
      let after = await h.ev(`__e2e.info()`);
      let clearedLagMs = 0;
      while (!after.cleared && clearedLagMs < 1200) {
        await h.ev(`__e2e.drain()`);
        await sleep(80);
        clearedLagMs += 80;
        after = await h.ev(`__e2e.info()`);
      }
      const elapsed = Number(await h.ev(`(() => state.elapsed)()`));
      floors.push({
        floor: info.floor, region: info.region, roomTypes: info.roomTypes,
        /* C1：本层事件房数量（用于核对 15% 闸门：20 层应约 3 次） */
        eventRooms: (ids.event || []).length,
        roomCount: Object.keys(ids).reduce(function (a, k) { return a + ids[k].length; }, 0),
        seconds: Number((elapsed - floorStartFrames).toFixed(1)),
        cleared: after.cleared, clearedLagMs: clearedLagMs, hp: Math.round(after.hp), hpMax: Math.round(after.hpMax),
        roomEnemies: after.roomEnemies == null ? -1 : after.roomEnemies,
        stray: after.cleared ? undefined : after.stray,
        segments: segments,
        fallbacks: segments.reduce((a, s) => a + s.travelFallback, 0)
      });
      regions.add(info.region);
      totalFrames += (elapsed - floorStartFrames) * 60;
      if (aborted) break;

      if (info.floor >= MAX_FLOOR) {
        // 第 20 层：首领打完即结算，不再下楼
        const fin = await h.ev(`(() => ({ floor: state.floor, status: state.status, mode: state.mode }))()`);
        floors.push({ floor: fin.floor, finished: true, summary: fin.status, mode: fin.mode });
        break;
      }
      await h.ev(`__e2e.drain()`);
      const down = await h.ev(`__e2e.descend()`);
      await h.ev(`__e2e.drain()`);
      await waitUnlock(h, 6000);
      if (down.to <= down.from) {
        floors.push({ floor: info.floor, stuckOnStairs: true, descend: down });
        aborted = true;
        break;
      }
      await sleep(120);
    }

    const shot = await h.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'e2e-end.png'), Buffer.from(shot.data, 'base64'));

    const last = floors[floors.length - 1] || {};
    const maxFloor = Math.max.apply(null, floors.map((f) => f.floor || 0));
    const totalSeconds = floors.reduce((a, f) => a + (f.seconds || 0), 0);
    const minHp = Math.min.apply(null, floors.map((f) => {
      const segMin = (f.segments || []).filter((s) => s.type !== 'shop' && s.type !== 'start').map((s) => s.hpMin);
      return segMin.length ? Math.min.apply(null, segMin) : 999;
    }).concat([999]));
    const timedOutRooms = floors.flatMap((f) => (f.segments || []).filter((s) => s.timedOut).map((s) => s.type + '#' + s.room));
    const fallbacks = floors.reduce((a, f) => a + (f.fallbacks || 0), 0);
    const assists = floors.reduce((a, f) => a + (f.segments || []).reduce((b, s) => b + (s.assist || 0), 0), 0);
    const clearFail = floors.filter((f) => f.segments && !f.cleared).length;

    /* C0：把"到第一场首领"从数据里算出来——按楼层顺序累加每间房的游戏内秒数，
       遇到第一个 boss 房时记下"进门时刻"和"打完时刻" */
    let cumSeconds = 0;
    let firstBossEnter = null;
    let firstBossClear = null;
    let firstBossFloor = null;
    floors.forEach((f) => {
      (f.segments || []).forEach((s) => {
        if (s.type === 'boss' && firstBossEnter === null) {
          firstBossEnter = Number(cumSeconds.toFixed(1));
          firstBossClear = Number((cumSeconds + (s.seconds || 0)).toFixed(1));
          firstBossFloor = f.floor;
        }
        cumSeconds += (s.seconds || 0);
      });
    });
    const bossList = floors.flatMap((f) => (f.segments || [])
      .filter((s) => s.type === 'boss')
      .map((s) => ({ floor: f.floor, fightSeconds: Number((s.fightFrames / 60).toFixed(1)) })));
    ok('E1 从标题页开局并到达第 ' + MAX_FLOOR + ' 层', maxFloor >= MAX_FLOOR, { maxFloor, last: last.summary || null });
    ok('E2 无"打不动的房"（无房间战斗 150s 超时）', timedOutRooms.length === 0, timedOutRooms);
    ok('E3 每层都达成"本层清空"（可下楼）', clearFail === 0, { clearFail, floors: floors.length });
    /* E4 是"整轮 20 层"的覆盖断言：换区、虚空裂隙、商店等天然要跨批才出现。
       批次回归（E2E_BATCH=1）时只记录、不判红，合批后再判；否则 F1–F5 单区必假红。 */
    if (process.env.E2E_BATCH === '1') {
      console.log('NOTE · E4 覆盖留到合批判定 · ' + JSON.stringify({ regions: Array.from(regions), ...globalTypes, usedRift }));
    } else {
      ok('E4 覆盖：换区 / 精英房 / 事件房 / 虚空裂隙 / 商店 / 宝箱',
        regions.size >= 2 && globalTypes.elite > 0 && globalTypes.event > 0 && globalTypes.shop > 0
          && globalTypes.chest > 0 && (usedRift > 0 || globalTypes.survival > 0),
        { regions: Array.from(regions), ...globalTypes, usedRift });
    }
    /* E5 改判据：单次长跑里"门口兜底"按每层 ≤1.2 次计（原来固定 ≤6 次，20 层不成立）。
       这些兜底只在"某一圈几乎零位移、卡在门框上"时触发，是机器人的窄门对齐问题，不是游戏卡死 */
    ok('E5 没有"卡在门口进不去"（门口兜底 ≤ 1.2 次/层）', fallbacks <= Math.max(6, Math.ceil(floors.length * 1.2)), { fallbacks, floors: floors.length });
    ok('E6 无异常、无死亡导致中止', h.runtimeErrors.length === 0 && deaths === 0 && !aborted,
      { errors: h.runtimeErrors.slice(0, 3), deaths, aborted });
    ok('E7 总游戏内耗时记录完整', totalSeconds > 0, { totalSeconds: +totalSeconds.toFixed(1) });

    /* 「意图必须变成逐层校验项」规则（2026-11-08）：75 秒上限以前只在 F20 算过一次，
       量完意图就消失了。现在改为逐层判定，但必须带**采样口径**：
       F1 同一份文件两跑 84.6s / 59.5s（差 25s），单样本判不了红绿。
       因此分层：>90s 单样本即可判红；75–90s 只记录，等 ≥2 次采样取中位再裁定。 */
    const BOSS_SECONDS_LIMIT = 75;
    const BOSS_SECONDS_HARD = 90;
    const hardOver = bossList.filter((b) => b.fightSeconds > BOSS_SECONDS_HARD);
    const pendingConfirm = bossList.filter((b) => b.fightSeconds > BOSS_SECONDS_LIMIT && b.fightSeconds <= BOSS_SECONDS_HARD);
    ok('E8a 逐层首领战硬上限 ≤90s（单样本可判）', hardOver.length === 0,
      { hard: BOSS_SECONDS_HARD, over: hardOver });
    if (pendingConfirm.length) {
      console.log('NOTE · E8b 75–90s 待采样确认（同层 ≥2 次取中位，单样本不作数） · '
        + JSON.stringify(pendingConfirm.map((b) => ({ floor: b.floor, fightSeconds: b.fightSeconds }))));
    }

    const summary = {
      at: new Date().toISOString(),
      maxFloor: maxFloor, totalSeconds: +totalSeconds.toFixed(1),
      /* C1：整局结晶入账 + 事件房覆盖（20 层应 ~3 次） */
      crystalsGained: Number(await h.ev(`(() => (state.meta && state.meta.crystals) || 0)()`)) - crystalsStart,
      eventFloorCount: floors.filter((f) => (f.eventRooms || 0) > 0).length,
      eventRoomTotal: floors.reduce((a, f) => a + (f.eventRooms || 0), 0),
      /* C0 关键结论：到第一场首领的分钟数（进门口 / 打完）与全场分钟数 */
      firstBossFloor, firstBossEnterSeconds: firstBossEnter, firstBossClearSeconds: firstBossClear,
      /* C1-5b 第 5 项：新手前 90 秒爽点（首杀 / 首个 0.5s 三杀发生的秒数，0 = 从未达成） */
      firstKillAt: Number(await h.ev(`(state.firstKillAt || 0)`)) || null,
      firstTripleAt: Number(await h.ev(`(state.firstTripleAt || 0)`)) || null,
      /* C1-6 诊断：赠礼状态 / 收窗后的卡组 / 最近 30 次 AOE 的命中数 */
      openingGift: JSON.parse(await h.ev(`JSON.stringify(state.openingGift || null)`)),
      ownedMagicNow: JSON.parse(await h.ev(`JSON.stringify(state.ownedMagic || [])`)),
      aoeCasts: JSON.parse(await h.ev(`JSON.stringify((state.aoeCasts || []).map(function (c) { return { id: c.id, at: Number((c.at || 0).toFixed(2)), hits: c.hits }; }))`)),
      c16Casts: JSON.parse(await h.ev(`JSON.stringify(window.__c16 ? window.__c16.casts : [])`)),
      c16Kills: JSON.parse(await h.ev(`JSON.stringify(window.__c16 ? window.__c16.kills : [])`)),
      bossFights: bossList,
      minHp: minHp === 999 ? null : minHp,
      timedOutRooms, fallbacks, deaths, usedRift, regions: Array.from(regions),
      combatAssists: assists,
      roomCoverage: globalTypes, floors, checks: asserts,
      pass: asserts.filter((a) => a.pass).length, total: asserts.length
    };
    fs.writeFileSync(path.join(OUT, 'cut-result.json'), JSON.stringify(summary, null, 2));
    console.log('\n===== 20 层分段 =====');
    floors.forEach((f) => {
      if (!f.segments) { console.log('F' + f.floor + ' · ' + (f.summary || (f.stuckOnStairs ? 'STAIRS-STUCK' : 'END'))); return; }
      const roomMin = f.segments.filter((s) => s.type !== 'shop' && s.type !== 'start').map((s) => s.hpMin);
      const dmg = f.segments.reduce((a, s) => a + (s.dmg || 0), 0);
      const mid = f.segments.reduce((a, s) => a + (s.midHeal || 0), 0);
      console.log('F' + f.floor + ' · ' + f.region + ' · ' + (f.seconds || 0).toFixed(1) + 's · 房 ' + f.segments.length
        + ' · 承伤 ' + dmg + ' · 最低 ' + (roomMin.length ? Math.min.apply(null, roomMin) : '-')
        + (mid ? ' · 补血 ' + mid : '')
        + ' · 兜底 ' + (f.fallbacks || 0) + ' · ' + (f.cleared ? 'CLEAR' : 'UNCLEARED'));
    });
    console.log('\n===== C0 时长结论 =====');
    console.log('全场 F1→F' + maxFloor + '：' + (totalSeconds / 60).toFixed(2) + ' 分钟（游戏内 ' + totalSeconds.toFixed(1) + 's）');
    if (firstBossEnter !== null) {
      console.log('第一场首领（F' + firstBossFloor + '）：进门口 ' + firstBossEnter.toFixed(1) + 's = '
        + (firstBossEnter / 60).toFixed(2) + ' 分钟；打完 ' + firstBossClear.toFixed(1) + 's = '
        + (firstBossClear / 60).toFixed(2) + ' 分钟');
    }
    console.log('首领战耗时：' + JSON.stringify(bossList));
    console.log('\nRESULT: ' + (asserts.filter((a) => !a.pass).length === 0 ? 'PASS' : 'FAIL')
      + '  ' + summary.pass + '/' + summary.total);
    if (asserts.filter((a) => !a.pass).length) process.exitCode = 1;
  } finally {
    h.ws.close();
    killEdge(h.edge);
  }
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
