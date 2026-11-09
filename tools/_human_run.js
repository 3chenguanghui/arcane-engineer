/**
 * v1.5.5 C2-2 · 真人口径三局验收探针
 * ------------------------------------------------------------
 * 和机器人（`_cut_run.js`）的区别：
 *   1) 输入走真实事件链：window 上的 KeyboardEvent、canvas 上的 MouseEvent；
 *      不再直接改 state.keys / 不再调 __roamDebug.cast / 不再 __roamDebug.teleport。
 *   2) 有真人的"不完美"：反应延迟（5–12 帧）、瞄准抖 ±4–14°、每 2–5 秒犹豫停顿
 *      0.15–0.5 秒、进门前迟疑 0.3–0.9 秒、12% 空挥（用旧准星）、目标点偏移 10–35px。
 *   3) 血量口径：统一 240（与历次验收可比），但**整局不回满**、不启用 20% 保命兜底；
 *      只靠休整房 / 治疗符 / 补给 / 深层回血节奏等真实来源回血。
 *   4) 记录每局：死亡层、到达层、总时长、首杀、首三杀、承伤、回复、HP 曲线。
 *
 * 用法：node tools\_human_run.js
 * 端口：9595
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9595;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, '.screenshots', 'human');
const RUNS = Number(process.env.HUMAN_RUNS || 3);
const MAX_FLOOR = Number(process.env.HUMAN_MAX_FLOOR || 20);
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
 * @param {string} url 页面地址
 * @param {number} w 宽
 * @param {number} h 高
 * @returns {Promise<Object>} CDP 句柄
 */
async function boot(url, w, h) {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
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
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = (seq += 1);
    pending.set(id, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  /**
   * 页面内执行
   * @param {string} expression JS 表达式
   * @returns {Promise<*>}
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(2600);
  return { ws, send, ev, runtimeErrors, edge };
}

/**
 * 注入页面内的「真人操作」脚本
 * ------------------------------------------------------------
 * 所有移动/攻击/切卡/交互都通过真实 DOM 事件触发；
 * 只有"读取状态"（state / __roamDebug.walkableAt）是直接读，属于玩家能看到的画面信息。
 * @returns {string} 安装表达式
 */
function installHuman() {
  return `(() => {
  window.__human = (function () {
    var KEYMAP = { left: 'a', right: 'd', up: 'w', down: 's' };
    var keys = { left: false, right: false, up: false, down: false };
    var frame = 0;
    var pauseUntil = 0;
    var rng = 20261108;
    var stats = null;
    var dmgLog = 0, dmgPeak = 0;
    var hpTrail = [], dmgTrail = [];
    var lastHp = null, lastDmg = null;
    var hesitateCount = 0, whiffCount = 0, pauseCount = 0;
    /* 与游戏内同一个稀有度权重（避免引用 _cut_run 里的局部常量） */
    var RARITY_RANK = { common: 1, rare: 2, epic: 3, legend: 4, mythic: 5 };

    /**
     * 线性同余随机（可复现，便于同一局重跑对比）
     * @returns {number} 0–1
     */
    function rand() {
      rng = (rng * 1664525 + 1013904223) % 4294967296;
      return rng / 4294967296;
    }

    /**
     * 真实按键：只在状态变化时发 keydown / keyup
     * @param {boolean} l 左
     * @param {boolean} r 右
     * @param {boolean} u 上
     * @param {boolean} d 下
     * @returns {void}
     */
    function setKeys(l, r, u, d) {
      var want = { left: !!l, right: !!r, up: !!u, down: !!d };
      Object.keys(want).forEach(function (k) {
        if (want[k] === keys[k]) return;
        keys[k] = want[k];
        window.dispatchEvent(new KeyboardEvent(want[k] ? 'keydown' : 'keyup', {
          key: KEYMAP[k], bubbles: true
        }));
      });
    }

    /**
     * 真实点按一个键（keydown + keyup）
     * @param {string} key 键名（'e' / '1'…）
     * @returns {void}
     */
    function tapKey(key) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: key, bubbles: true }));
    }

    /**
     * 把世界坐标换成屏幕坐标（与 updateMouseWorld 同一套相机公式）
     * @param {number} wx 世界 x
     * @param {number} wy 世界 y
     * @returns {{x:number,y:number}} 画布内屏幕坐标
     */
    function screenOf(wx, wy) {
      var z = cameraZoom();
      var rect = canvas.getBoundingClientRect();
      return { x: rect.left + (wx - state.cam.x) * z, y: rect.top + (wy - state.cam.y) * z };
    }

    /**
     * 真实鼠标移动（准星）
     * @param {number} wx 世界 x
     * @param {number} wy 世界 y
     * @returns {void}
     */
    function aimAt(wx, wy) {
      var p = screenOf(wx, wy);
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: p.x, clientY: p.y, bubbles: true
      }));
    }

    /**
     * 真实鼠标左键点一下（AI 的"空挥"= 不更新准星直接用旧值）
     * @param {number} wx 世界 x
     * @param {number} wy 世界 y
     * @param {boolean} whiff 是否空挥（不移动准星）
     * @returns {void}
     */
    function clickAt(wx, wy, whiff) {
      if (!whiff) aimAt(wx, wy);
      var p = screenOf(wx, wy);
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        clientX: p.x, clientY: p.y, button: 0, bubbles: true
      }));
      canvas.dispatchEvent(new MouseEvent('mouseup', {
        clientX: p.x, clientY: p.y, button: 0, bubbles: true
      }));
      if (whiff) whiffCount += 1;
    }

    function stop() { setKeys(false, false, false, false); }
    function aliveEnemies() { return state.enemies.filter(function (e) { return e && e.hp > 0; }); }
    function roomById(id) { return state.rooms.filter(function (r) { return r.id === id; })[0] || null; }
    function roomEnemies(id) { return aliveEnemies().filter(function (e) { return e.roomId === id; }); }
    function nearest(list) {
      var best = null, bd = 1e9;
      for (var i = 0; i < list.length; i += 1) {
        var d = Math.hypot(list[i].x - state.player.x, list[i].y - state.player.y);
        if (d < bd) { bd = d; best = list[i]; }
      }
      return { e: best, d: bd };
    }
    function walkable(x, y) {
      try { return typeof isPointWalkable === 'function' ? !!isPointWalkable(x, y) : true; } catch (e) { return true; }
    }

    /**
     * 探路式转向：正方向被挡就 ±25°/±50°… 找第一个可站方向（真人也会绕墙）
     * @param {number} tx 目标 x
     * @param {number} ty 目标 y
     * @returns {void}
     */
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

    /**
     * 真人式的"犹豫"：每 2–5 秒松手 0.15–0.5 秒
     * @returns {boolean} 本帧是否处于犹豫停顿
     */
    function hesitation() {
      if (frame < pauseUntil) { stop(); return true; }
      if (rand() < 1 / 200) {
        pauseUntil = frame + 9 + Math.floor(rand() * 22);
        pauseCount += 1;
        stop();
        return true;
      }
      return false;
    }

    /**
     * 每秒记一条血量 / 累计承伤，用于还原真实回复
     * @returns {void}
     */
    function sample() {
      if (frame % 60 !== 0) return;
      hpTrail.push({ t: Math.round(frame / 60), hp: Math.round(state.player.hp) });
      dmgTrail.push({ t: Math.round(frame / 60), dmg: Math.round(dmgLog) });
    }

    /* 真实承伤包装：只累加 applied（护盾减免后的实际扣血） */
    (function () {
      if (window.__humanDmgWrapped || typeof damagePlayer !== 'function') return;
      window.__humanDmgWrapped = true;
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

    /* ---- 奖励选择：真人按数字键（按"能打的范围技"打分挑，不无脑首卡） ---- */
    var SKILL_ORDER = ['lavaFissure', 'frostRing', 'flameCone', 'runeOrbit', 'collapseHole',
      'arcanePool', 'fireball', 'bolt', 'blade', 'mine', 'frost'];
    /**
     * 给奖励选项打分
     * @param {Object} opt 选项
     * @returns {number} 分数
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
    /**
     * 选完所有待选奖励（真实按数字键）
     * @returns {void}
     */
    function drainRewards() {
      var n = 0;
      while (state.mode === 'reward' && n < 12) {
        var opts = state.upgradeOptions || [];
        var best = -1, bs = -1e9;
        for (var i = 0; i < opts.length; i += 1) {
          var s = rewardScore(opts[i]);
          if (s > bs) { bs = s; best = i; }
        }
        if (best < 0) break;
        tapKey(String(best + 1));
        update(1 / 60);
        n += 1;
      }
    }

    /**
     * 点击卡组里的魔法卡（真实 UI 点击，等价玩家切卡）
     * @param {string} magicId 魔法 id
     * @returns {boolean} 是否点到
     */
    function pickCard(magicId) {
      var el = document.querySelector('[data-magic-id="' + magicId + '"]');
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    }

    /**
     * 从已拥有魔法里挑一条冷却好了的，按 SKILL_ORDER 优先范围技
     * @returns {string|null} 魔法 id
     */
    function pickSkill() {
      var owned = state.ownedMagic || [];
      for (var i = 0; i < SKILL_ORDER.length; i += 1) {
        var id = SKILL_ORDER[i];
        if (owned.indexOf(id) >= 0 && (state.cooldowns[id] || 0) <= 0.001) return id;
      }
      return null;
    }

    /**
     * 真人式走路：会停、会犹豫、卡住先退半步再走（绝不传送）
     * @param {number} x 目标 x
     * @param {number} y 目标 y
     * @param {number} maxFrames 最多帧
     * @returns {{frames:number,stuck:number}} 结果
     */
    function walkTo(x, y, maxFrames) {
      var frames = 0, lastX = state.player.x, lastY = state.player.y, still = 0, stuck = 0;
      while (frames < maxFrames) {
        drainRewards();
        if (state.mode !== 'playing' || state.status !== 'playing') break;
        var dx = x - state.player.x, dy = y - state.player.y;
        if (Math.hypot(dx, dy) < 22) break;
        if (!hesitation()) steer(x, y);
        sample();
        var px0 = state.player.x, py0 = state.player.y;
        update(1 / 60); frames += 1; frame += 1;
        if (frames % 60 === 0) {
          if (Math.abs(state.player.x - lastX) + Math.abs(state.player.y - lastY) < 4) still += 1; else still = 0;
          lastX = state.player.x; lastY = state.player.y;
          if (still >= 3) {
            /* 真人卡住：反向退 0.5 秒，再重新找路（不传送） */
            stuck += 1; still = 0;
            setKeys(state.player.x > x, state.player.x < x, state.player.y > y, state.player.y < y);
            for (var b = 0; b < 30; b += 1) { update(1 / 60); frame += 1; }
            stop();
          }
        }
      }
      stop();
      return { frames: frames, stuck: stuck };
    }

    /**
     * 建门图（当前房 → 目标房的第一道门）
     * @returns {Object} 邻接表
     */
    function buildAdj() {
      var adj = {};
      state.doors.forEach(function (d) {
        if (d.targetRoomId == null || d.targetRoomId < 0 || !roomById(d.targetRoomId)) return;
        (adj[d.roomId] = adj[d.roomId] || []).push({ next: d.targetRoomId, door: d });
        (adj[d.targetRoomId] = adj[d.targetRoomId] || []).push({ next: d.roomId, door: d });
      });
      return adj;
    }
    /**
     * BFS 找当前房到目标房的第一道门
     * @param {number} fromId 当前房
     * @param {number} toId 目标房
     * @returns {Object|null} 门对象
     */
    function firstDoor(fromId, toId) {
      if (fromId === toId) return null;
      var adj = buildAdj();
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

    /**
     * 走到指定房间（走到门 → 迟疑 0.3–0.9 秒 → 再迈进门）
     * @param {number} id 房间 id
     * @param {number} maxFrames 最多帧
     * @returns {{frames:number,stuck:number,room:number}} 结果
     */
    function gotoRoom(id, maxFrames) {
      var room = roomById(id);
      if (!room) return { frames: 0, stuck: 0, missing: true };
      var frames = 0, stuck = 0, guard = 0;
      while (frames < (maxFrames || 3600) && guard < 200) {
        guard += 1;
        drainRewards();
        if (state.currentRoomId === id) break;
        var cur = roomById(state.currentRoomId);
        var door = firstDoor(state.currentRoomId, id);
        if (!door) {
          var s0 = walkTo(room.cx, room.cy, 1200);
          frames += s0.frames; stuck += s0.stuck;
          break;
        }
        var step = walkTo(door.x, door.y, 900);
        frames += step.frames; stuck += step.stuck;
        /* 真人进门前会犹豫：停 18–54 帧（0.3–0.9 秒） */
        hesitateCount += 1;
        stop();
        var wait = 18 + Math.floor(rand() * 36);
        for (var w = 0; w < wait; w += 1) { update(1 / 60); frames += 1; frame += 1; }
        var dx = door.x - (cur ? cur.cx : state.player.x);
        var dy = door.y - (cur ? cur.cy : state.player.y);
        var len = Math.hypot(dx, dy) || 1;
        var s1 = walkTo(door.x + (dx / len) * 80, door.y + (dy / len) * 80, 300);
        frames += s1.frames; stuck += s1.stuck;
      }
      stop();
      return { frames: frames, stuck: stuck, room: state.currentRoomId };
    }

    /**
     * 清空一个房间（真人节奏：反应延迟 + 抖动准星 + 12% 空挥 + 走位偏移）
     * @param {number} roomId 房间 id
     * @param {number} maxFrames 最多帧
     * @returns {Object} 本房统计
     */
    function fight(roomId, maxFrames) {
      var frames = 0, quiet = 0;
      var hpStart = state.player.hp, hpMin = hpStart, kills0 = state.kills;
      var dmg0 = dmgLog, peak0 = dmgPeak;
      var target = null, react = 0, offX = 0, offY = 0, offT = 0, clickCd = 0, skillCd = 0;
      while (frames < maxFrames) {
        drainRewards();
        sample();
        if (state.mode !== 'playing' || state.status !== 'playing') break;
        var es = roomEnemies(roomId);
        if (es.length === 0) { quiet += 1; if (quiet >= 96) break; } else quiet = 0;
        /* 反应延迟：5–12 帧才重新锁定一次目标（不是每帧完美追踪） */
        if (react <= 0 || !target || target.hp <= 0 || es.indexOf(target) < 0) {
          var found = nearest(es);
          target = found.e; react = 5 + Math.floor(rand() * 8);
        }
        react -= 1;
        if (target) {
          var d = Math.hypot(target.x - state.player.x, target.y - state.player.y);
          /* 走位偏移：每 1–2 秒换一次落点偏移 10–35px */
          if (offT <= 0) {
            var oa = rand() * Math.PI * 2;
            var od = 10 + rand() * 25;
            offX = Math.cos(oa) * od; offY = Math.sin(oa) * od; offT = 60 + Math.floor(rand() * 60);
          }
          offT -= 1;
          /* 切卡：真实点击卡组 UI，只在目标技能冷却好且不是当前卡时切 */
          if (skillCd <= 0) {
            var want = pickSkill();
            if (want && want !== state.activeMagicId) pickCard(want);
            skillCd = 30 + Math.floor(rand() * 30);
          }
          skillCd -= 1;
          /* 瞄准：±4–14° 抖动；12% 空挥用旧准星 */
          var jitter = (rand() * 2 - 1) * (4 + rand() * 10) * Math.PI / 180;
          var ang = Math.atan2(target.y - state.player.y, target.x - state.player.x) + jitter;
          var aimR = Math.min(260, Math.max(40, d));
          var aimX = state.player.x + Math.cos(ang) * aimR + offX;
          var aimY = state.player.y + Math.sin(ang) * aimR + offY;
          if (!hesitation()) {
            if (d > 110) steer(target.x + offX, target.y + offY);
            else if (d < 42) setKeys(state.player.x > target.x, state.player.x < target.x, state.player.y > target.y, state.player.y < target.y);
            else stop();
            if (clickCd <= 0) {
              clickAt(aimX, aimY, rand() < 0.12);
              clickCd = 7 + Math.floor(rand() * 4);
            }
            clickCd -= 1;
          }
        } else {
          stop();
        }
        update(1 / 60); frames += 1; frame += 1;
        if (state.player.hp < hpMin) hpMin = state.player.hp;
      }
      stop();
      return {
        room: roomId, frames: frames, hpStart: Math.round(hpStart), hpMin: Math.round(hpMin),
        hpEnd: Math.round(state.player.hp), kills: state.kills - kills0,
        dmg: Math.round(dmgLog - dmg0), peak: Math.round(dmgPeak - peak0 * 0),
        remaining: roomEnemies(roomId).length
      };
    }

    /**
     * 真人交互：走到房间中心，按 E（0.5 秒一次，最多 6 次），再清掉刷出来的怪
     * @param {number} roomId 房间 id
     * @returns {{used:number,fight:Object|null}} 结果
     */
    function interactRoom(roomId) {
      var room = roomById(roomId);
      if (room) walkTo(room.cx, room.cy, 900);
      var used = 0;
      for (var i = 0; i < 6; i += 1) {
        tapKey('e');
        for (var w = 0; w < 30; w += 1) { update(1 / 60); frame += 1; }
        if (state.mode === 'reward') drainRewards();
        if (state.currentRoomId !== roomId) break;
        if (roomEnemies(roomId).length > 0 || state.transitionLock) break;
        used += 1;
      }
      var f = fight(roomId, 9000);
      return { used: used, fight: f };
    }

    /**
     * 下楼：走到楼梯按 E，直到楼层数字变化
     * @param {number} fromFloor 当前层
     * @returns {boolean} 是否成功下楼
     */
    function descend(fromFloor) {
      if (!state.stairs || !state.stairs.active) return false;
      for (var attempt = 0; attempt < 6; attempt += 1) {
        if (!state.stairs) break;
        walkTo(state.stairs.x, state.stairs.y, 1200);
        tapKey('e');
        for (var w = 0; w < 60; w += 1) { update(1 / 60); frame += 1; }
        if (state.floor !== fromFloor) return true;
        if (state.mode === 'reward') drainRewards();
      }
      return state.floor !== fromFloor;
    }

    /**
     * 跑一层：按 起手/战斗/精英/事件/宝箱/商店/生存/首领 的顺序清房，再下楼
     * @param {number} floorNumber 目标层
     * @returns {Object} 本层统计
     */
    function runFloor(floorNumber) {
      var t0 = state.elapsed || 0;
      var deaths = 0;
      var queueNames = ['start', 'battle', 'elite', 'event', 'chest', 'shop', 'survival', 'boss'];
      var rooms = [];
      var lite = {};
      state.rooms.forEach(function (r) { (lite[r.type] = lite[r.type] || []).push(r.id); });
      var order = [];
      queueNames.forEach(function (t) { (lite[t] || []).forEach(function (id) { order.push({ id: id, type: t }); }); });
      for (var i = 0; i < order.length; i += 1) {
        if (state.mode !== 'playing' || state.status !== 'playing') { deaths = 1; break; }
        var item = order[i];
        if (item.type === 'shop') continue;
        var go = gotoRoom(item.id, 3600);
        var rec = { room: item.id, type: item.type, walkFrames: go.frames || 0, walkStuck: go.stuck || 0 };
        if (item.type === 'start') {
          rec.fight = null;
        } else if (['event', 'chest', 'survival'].indexOf(item.type) >= 0) {
          rec.interact = interactRoom(item.id);
          rec.fight = rec.interact.fight;
        } else {
          rec.fight = fight(item.id, item.type === 'boss' ? 20000 : 9000);
        }
        rec.seconds = Number((((state.elapsed || 0) - t0)).toFixed(2));
        rooms.push(rec);
        if (state.mode !== 'playing' || state.status !== 'playing') { deaths = 1; break; }
      }
      /* 代价门 / 事件波可能把怪刷进非战斗房：真人会回头清，最多 3 间 */
      for (var sweep = 0; sweep < 3 && !deaths; sweep += 1) {
        var foes = {};
        state.enemies.forEach(function (e) { if (e && e.hp > 0 && e.roomId >= 0) foes[e.roomId] = 1; });
        var ids = Object.keys(foes).map(Number);
        if (!ids.length) break;
        gotoRoom(ids[0], 2400);
        fight(ids[0], 9000);
      }
      var floorSeconds = Number((((state.elapsed || 0) - t0)).toFixed(2));
      var result = {
        floor: floorNumber, seconds: floorSeconds,
        rooms: rooms, dead: deaths > 0 || state.status !== 'playing',
        hp: Math.round(state.player.hp), hpMax: state.player.hpMax,
        kills: state.kills, cleared: !!state.floorCleared
      };
      if (result.dead) return result;
      drainRewards();
      var down = descend(floorNumber);
      result.descended = down;
      return result;
    }

    return {
      /**
       * 设定随机种子（让三局的"手抖"不同，但单局可复现）
       * @param {number} s 种子
       * @returns {number} 种子
       */
      seed: function (s) { rng = Number(s) || 20261108; return rng; },
      /**
       * 一局的统计清零（开始新一局前调用）
       * @returns {Object} 初始统计
       */
      begin: function () {
        frame = 0; pauseUntil = 0; dmgLog = 0; dmgPeak = 0;
        hpTrail = []; dmgTrail = []; lastHp = null; lastDmg = null;
        hesitateCount = 0; whiffCount = 0; pauseCount = 0;
        stats = { startedAt: state.elapsed || 0 };
        return stats;
      },
      /**
       * 跑一层并返回统计
       * @param {number} n 层号
       * @returns {Object} 本层统计
       */
      floor: function (n) { return runFloor(n); },
      /**
       * 当前实时统计（死亡时用）
       * @returns {Object} 统计
       */
      info: function () {
        return {
          floor: state.floor, maxFloor: state.maxFloor || state.floor,
          status: state.status, mode: state.mode,
          hp: Math.round(state.player.hp), hpMax: state.player.hpMax,
          kills: state.kills,
          firstKillAt: Number(state.firstKillAt || 0) || null,
          firstTripleAt: Number(state.firstTripleAt || 0) || null,
          totalSeconds: Number((state.elapsed || 0).toFixed(2)),
          dmgTaken: Math.round(dmgLog), dmgPeak: Math.round(dmgPeak),
          hpTrail: hpTrail, dmgTrail: dmgTrail,
          hesitateCount: hesitateCount, whiffCount: whiffCount, pauseCount: pauseCount
        };
      }
    };
  })();
  return true;
})()`;
}

/**
 * 计算真实回复（和 _deep_curve.js 同一公式）
 * @param {Array} hpTrail 每秒血量
 * @param {Array} dmgTrail 每秒累计承伤
 * @returns {number} 实际回复
 */
function healedOf(hpTrail, dmgTrail) {
  const h = hpTrail || [];
  const d = dmgTrail || [];
  let healed = 0;
  let prevHp = null;
  let prevDmg = null;
  for (let i = 0; i < h.length; i += 1) {
    const hp = h[i].hp;
    const dm = (d[i] && d[i].dmg) || 0;
    if (prevHp !== null) {
      const diff = (hp - prevHp) + (dm - prevDmg);
      if (diff > 0) healed += diff;
    }
    prevHp = hp; prevDmg = dm;
  }
  return Math.round(healed);
}

/**
 * 主流程：同一 Edge 会话里连跑三局（每局重载页面、重新点开始）
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const h = await boot('file:///' + FILE.replace(/\\/g, '/'), 1600, 900);
  const runs = [];
  try {
    for (let run = 1; run <= RUNS; run += 1) {
      await h.send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
      await sleep(2600);
      await h.ev(installHuman());
      const btn = await h.ev(`(() => { const b = document.getElementById('btnStart'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await h.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
      await h.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
      await sleep(1200);
      /* 统一验收血量 240（只给血量上限，不给任何回满/兜底） */
      await h.ev(`(() => { state.mods.hpBonus = Math.max(state.mods.hpBonus || 0, 140); state.player.hpMax = Math.max(state.player.hpMax, 240); state.player.hp = state.player.hpMax; return state.player.hpMax; })()`);
      await h.ev(`(() => { __human.seed(${20261108 + run * 7919}); __human.begin(); return true; })()`);
      console.log('\n===== 真人第 ' + run + ' 局 =====');
      const floors = [];
      for (let f = 1; f <= MAX_FLOOR; f += 1) {
        const r = await h.ev(`__human.floor(${f})`);
        floors.push(r);
        console.log('  F' + r.floor + ' · ' + r.seconds + 's · 房 ' + (r.rooms || []).length
          + ' · hp ' + r.hp + '/' + r.hpMax + ' · 杀 ' + r.kills + (r.dead ? ' · 死亡' : (r.descended ? ' · 下楼' : ' · 未下楼')));
        if (r.dead) break;
        /* 没下楼 = 没清空本层（真人走位失败），直接结束本局并如实记录，不刷假楼层 */
        if (!r.descended) { console.log('  ! 本层未清空，结束本局'); break; }
      }
      const info = await h.ev(`__human.info()`);
      const last = floors[floors.length - 1] || null;
      const runRec = {
        run: run,
        maxFloor: Math.max(...floors.map((f) => f.floor), 0),
        deathFloor: (last && last.dead) ? last.floor : null,
        finalFloor: (last && last.dead) ? last.floor : info.floor,
        totalSeconds: info.totalSeconds,
        firstKillAt: info.firstKillAt,
        firstTripleAt: info.firstTripleAt,
        kills: info.kills,
        hpEnd: info.hp, hpMax: info.hpMax,
        dmgTaken: info.dmgTaken, dmgPeak: info.dmgPeak,
        healed: healedOf(info.hpTrail, info.dmgTrail),
        hesitateCount: info.hesitateCount, whiffCount: info.whiffCount, pauseCount: info.pauseCount,
        reachF15: info.floor >= 16,
        floors: floors
      };
      runs.push(runRec);
      console.log('  → 第 ' + run + ' 局：死亡层 ' + (runRec.deathFloor === null ? '未死' : 'F' + runRec.deathFloor)
        + ' · 最远 F' + runRec.maxFloor + ' · 总时长 ' + runRec.totalSeconds + 's'
        + ' · 首杀 ' + (runRec.firstKillAt ? runRec.firstKillAt + 's' : '无')
        + ' · 首三杀 ' + (runRec.firstTripleAt ? runRec.firstTripleAt + 's' : '无'));
    }

    const ok = (name, pass, detail) => {
      asserts.push({ name, pass: !!pass, detail });
      console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + ' · ' + JSON.stringify(detail));
    };
    const reachCount = runs.filter((r) => r.reachF15).length;
    ok('H1 三局都产出了完整记录', runs.length === RUNS && runs.every((r) => r.totalSeconds > 0), { runs: runs.length });
    ok('H2 至少两局看到 F15 之后（最远层 ≥16）', reachCount >= 2, { reachCount, maxFloors: runs.map((r) => r.maxFloor) });
    ok('H3 每局都有首杀时间', runs.every((r) => r.firstKillAt !== null), { firstKill: runs.map((r) => r.firstKillAt) });
    ok('H4 输入确实是"不完美真人"（有停顿 / 空挥 / 犹豫）',
      runs.every((r) => r.pauseCount > 0 && r.whiffCount > 0 && r.hesitateCount > 0),
      { pause: runs.map((r) => r.pauseCount), whiff: runs.map((r) => r.whiffCount), hesitate: runs.map((r) => r.hesitateCount) });
    ok('H5 无运行时异常', h.runtimeErrors.length === 0, { errors: h.runtimeErrors.slice(0, 3) });

    fs.writeFileSync(path.join(OUT, 'human-runs.json'), JSON.stringify({
      at: new Date().toISOString(), runs: runs, checks: asserts,
      pass: asserts.filter((a) => a.pass).length, total: asserts.length
    }, null, 2));
    console.log('\nRESULT: ' + (asserts.every((a) => a.pass) ? 'PASS' : 'FAIL')
      + '  ' + asserts.filter((a) => a.pass).length + '/' + asserts.length);
    if (!asserts.every((a) => a.pass)) process.exitCode = 1;
  } finally {
    h.ws.close();
    killEdge(h.edge);
  }
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
