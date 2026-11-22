/**
 * 端到端触控链路验证（工作副本 / 手动定步长驱动 / 真实触摸事件）
 * ============================================================
 * 为什么不依赖无头浏览器 rAF：
 *   无头 Edge 的后台帧率不可信，dt 会被压到极小，游戏时间几乎不走。
 *   本脚本在进入战斗后冻结 requestAnimationFrame，改为直接调用主文件的
 *   update(1/60) 推进游戏时间，每次只推进 0.3–0.9 秒，渲染用 render() 单次刷新。
 *   触摸事件仍是 Input.dispatchTouchEvent（真实触摸），并且每次都读数证明
 *   "摇杆轴真的变了 / 角色真的位移了 / 技能键真的计数了"。
 *
 * 链路：
 *   进战斗 → 摇杆校准（证明输入生效）→ 寻路 + 到门按交互 → 打怪/打首领
 *   → 升级弹窗（自然出现）逐张验命中 → 三选一逐张验（三张都点得到）
 *   → 地图开合 → 走到楼梯 → 触摸交互键下楼 → 第二层 mode==='playing'
 *
 * 用法：node mobile/tools/me2e.js --force              （默认一直跑到第 2 层）
 *       node mobile/tools/me2e.js --force --layers=3   （继续跑到第 3 层，判据同步改成 floor===3）
 * 产物：mobile/shots/run_<时间戳>/  （每次独立目录，不和别的进程互相覆盖）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile_e2e');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9567;
/* 被测页面：默认主副本；--page=<路径> 可指向实验副本（只读，不碰主文件） */
const PAGE_ARG = process.argv.find((a) => a.startsWith('--page='));
const SNAP_FILE = PAGE_ARG ? path.resolve(PAGE_ARG.slice('--page='.length)) : path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html');
const LOCK = path.join(MOBILE_DIR, '.e2e.lock');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 读取 --name=数字 形式的命令行参数 */
function argNum(name, def) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? Number(hit.split('=')[1]) : def;
}
const MAX_CLEAR_SIM = argNum('max', 600);   // 清层阶段允许推进的"游戏内秒数"
const MAX_STAIRS_SIM = argNum('stairs', 180); // 找楼梯阶段允许推进的游戏秒数
/* 目标层：默认 2（上一层已 PASS 的行为），--layers=3 表示继续验到第三层。
   判定线会跟着它走：「afterDescend.floor === TARGET_FLOOR && mode === 'playing'」。 */
const TARGET_FLOOR = Math.max(2, Math.floor(argNum('layers', 2)));
const BOSS_SIM = Math.max(20, Math.floor(argNum('boss', 900)));   // 首领战允许推进的游戏秒数
const DBG_BEATS = process.argv.includes('--beats'); // 逐拍打印（排障用）

/** 进程是否还活着（用于并发锁） */
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

/**
 * 启动无头 Edge 并返回 CDP 封装
 * @returns {Promise<Object>} { send, ev, shot, close }
 */
async function bootEdge() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files', '--mute-audio',
    '--hide-scrollbars', '--window-size=900,600',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  /* 本机经常同时跑着 100+ 个 Edge（其它 agent），冷启动可能要 40~60s，给足 90s */
  for (let i = 0; i < 360; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(edge); throw new Error('Edge 调试端口未就绪'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    const id = seq;
    /* 超时说明：本机常有多个 agent 同时跑渲染/模拟，CPU 打满时渲染主线程会长时间不 ack，
       30s 容易误判。这里放宽到 45s；仍超时就是真的卡死，交由外层捕获并明确报"环境阻塞"。 */
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP 超时：' + method)); }, 45000);
    pending.set(id, (m) => {
      clearTimeout(timer);
      if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  /* 读状态这类"幂等"调用统一重试：环境负载导致的偶发超时不该让整轮 e2e 直接报废 */
  const ev = async (expression) => {
    let lastErr = null;
    for (let k = 0; k < 3; k += 1) {
      try {
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 260));
        return r.result.value;
      } catch (e) {
        lastErr = e;
        if (!/CDP 超时/.test(e.message)) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw lastErr;
  };
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/** 多指触摸：一次性下发若干触点（环境卡顿时重试，仍失败则清空触点并抛 CDP_STALL） */
async function sendPoints(cdp, type, pts) {
  const payload = {
    type,
    touchPoints: pts.map((p) => ({ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1, id: p.id }))
  };
  let lastErr = null;
  for (let k = 0; k < 3; k += 1) {
    try { await cdp.send('Input.dispatchTouchEvent', payload); return; } catch (e) {
      lastErr = e;
      if (!/CDP 超时/.test(e.message)) throw e;
      await sleep(600);
    }
  }
  /* 兜底：清空触点，避免"摇杆半按住/技能键卡住"的残留状态 */
  try { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); } catch (e) { /* ignore */ }
  throw new Error('CDP_STALL' + (lastErr ? '：' + lastErr.message : ''));
}

/** 单指单击（点不到就放弃这一下，不打断整轮） */
async function tap(cdp, x, y, holdMs) {
  try {
    await sendPoints(cdp, 'touchStart', [{ id: 1, x, y }]);
    await sleep(holdMs || 45);
    await sendPoints(cdp, 'touchEnd', []);
  } catch (e) {
    if (!/CDP_STALL/.test(e.message)) throw e;
  }
}

/** 读取矩形中心 */
const RECT_JS = (sel) => `(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();var cs=getComputedStyle(e);return {cx:r.left+r.width/2,cy:r.top+r.height/2,w:r.width,h:r.height,visible:cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0};})()`;
/** 元素矩形 + 是否真的点得到（在视口内且命中测试落在自己身上） */
const HIT_JS = (sel) => `(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();var cx=r.left+r.width/2,cy=r.top+r.height/2;var inView=cx>=0&&cx<=innerWidth&&cy>=0&&cy<=innerHeight;var top=document.elementFromPoint(cx,cy);return {cx:cx,cy:cy,w:r.width,h:r.height,inView:inView,hit:!!(top&&(top===e||e.contains(top))),topTag:top?top.tagName+'.'+(top.className||''):null};})()`;

/** 战斗快照（只读 state） */
const SNAP_JS = `(function () {
  var s = state;
  var best = null, bestD = 1e9;
  for (var i = 0; i < s.enemies.length; i += 1) {
    var e = s.enemies[i];
    if (!e || e.hp <= 0) continue;
    var d = Math.hypot(e.x - s.player.x, e.y - s.player.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  var layer = document.getElementById('modalLayer');
  var cardsNow = document.querySelectorAll('#modal [data-reward-key]');
  return {
    mode: s.mode, floor: s.floor, elapsed: Math.round(s.elapsed * 10) / 10,
    status: s.status || null,
    room: (typeof s.currentRoomId === 'number') ? s.currentRoomId : null,
    bossChest: s.bossChest ? { opened: !!s.bossChest.opened, x: Math.round(s.bossChest.x || 0), y: Math.round(s.bossChest.y || 0) } : null,
    hp: Math.round(s.player.hp), hpMax: Math.round(s.player.hpMax),
    xp: Math.round(s.xp), xpNeed: s.xpNeed, lv: s.xpLevel,
    enemies: s.enemies.filter(function (x) { return x && x.hp > 0; }).length,
    roomEnemies: s.enemies.filter(function (x) { return x && x.hp > 0 && x.roomId >= 0; }).length,
    boss: s.boss ? { defeated: !!s.boss.defeated, started: !!s.boss.started, hp: Math.round(s.boss.hp || 0), max: Math.round(s.boss.hpMax || 0), enemyId: s.boss.enemyId } : null,
    bossPos: (function () {
      if (!s.boss) return null;
      for (var i = 0; i < s.enemies.length; i += 1) {
        var e = s.enemies[i];
        if (e && e.id === s.boss.enemyId && e.hp > 0) {
          return { x: Math.round(e.x), y: Math.round(e.y), hp: Math.round(e.hp), room: e.roomId, d: Math.round(Math.hypot(e.x - s.player.x, e.y - s.player.y)) };
        }
      }
      return null;
    })(),
    aether: Math.round(s.player.aether || 0),
    aetherMax: Math.round(s.player.aetherMax || 0),
    stairs: s.stairs ? { x: Math.round(s.stairs.x), y: Math.round(s.stairs.y), active: !!s.stairs.active } : null,
    px: Math.round(s.player.x), py: Math.round(s.player.y),
    nearest: best ? { x: Math.round(best.x), y: Math.round(best.y), dx: Math.round(best.x - s.player.x), dy: Math.round(best.y - s.player.y), d: Math.round(bestD), hp: Math.round(best.hp) } : null,
    nearestMinion: (function () {
      var pick = null, pd = 1e9;
      for (var i = 0; i < s.enemies.length; i += 1) {
        var e = s.enemies[i];
        if (!e || e.hp <= 0) continue;
        if (s.boss && e.id === s.boss.enemyId) continue;   // 清小怪阶段排除首领
        var d = Math.hypot(e.x - s.player.x, e.y - s.player.y);
        if (d < pd) { pd = d; pick = e; }
      }
      return pick ? { x: Math.round(pick.x), y: Math.round(pick.y), d: Math.round(pd), hp: Math.round(pick.hp), id: pick.id, room: pick.roomId } : null;
    })(),
    /* 400px 内所有门：排障"清完了却出不去"用 */
    doorsNear: (s.doors || []).filter(function (d) {
      return Math.hypot(d.x - s.player.x, d.y - s.player.y) <= 400;
    }).map(function (d) {
      return { side: d.side, x: Math.round(d.x), y: Math.round(d.y), roomId: d.roomId,
        target: d.targetRoomId, closed: !!d.closed, anim: Math.round((d.anim || 0) * 100) / 100,
        d: Math.round(Math.hypot(d.x - s.player.x, d.y - s.player.y)) };
    }),
    /* 房间状态：清没清、锁没锁、中心点 */
    rooms: s.rooms.map(function (r) {
      return { id: r.id, type: r.type, cx: Math.round(r.cx), cy: Math.round(r.cy),
        w: Math.round(r.w), h: Math.round(r.h), cleared: !!r.cleared, locked: !!r.locked };
    }),
    minions: s.enemies.filter(function (e) {
      return e && e.hp > 0 && !(s.boss && e.id === s.boss.enemyId);
    }).map(function (e) {
      return { id: e.id, x: Math.round(e.x), y: Math.round(e.y), hp: Math.round(e.hp),
        room: e.roomId, d: Math.round(Math.hypot(e.x - s.player.x, e.y - s.player.y)) };
    }),
    modalOpen: !!(layer && !layer.classList.contains('hidden') && cardsNow.length > 0),
    modalCards: cardsNow.length,
    modalStage: s.rewardStage || null,
    modalSource: s.rewardSource || null,
    mapOpen: document.getElementById('mapPanel').classList.contains('is-open'),
    cleared: !!s.floorCleared,
    door: (function () {
      if (typeof nearestEntryDoor !== 'function') return null;
      var d = nearestEntryDoor(s.player.x, s.player.y);
      return d ? { x: Math.round(d.x), y: Math.round(d.y), side: d.side, roomId: d.roomId,
        target: d.targetRoomId, d: Math.round(Math.hypot(d.x - s.player.x, d.y - s.player.y)) } : null;
    })()
  };
})()`;

/** 奖励卡：矩形 + 可见条带 + 真实命中（844×390 下卡片会被裁掉下半截） */
const CARDS_JS = `(function () {
  var layer = document.getElementById('modalLayer');
  if (!layer || layer.classList.contains('hidden')) return [];
  var vh = window.innerHeight;
  return Array.prototype.map.call(document.querySelectorAll('#modal [data-reward-key]'), function (el) {
    var r = el.getBoundingClientRect();
    var visTop = Math.max(r.top, 0), visBottom = Math.min(r.bottom, vh);
    var visH = Math.max(0, visBottom - visTop);
    var cx = Math.round(r.left + r.width / 2);
    var tapY = Math.round(visTop + Math.min(Math.max(visH / 2, 12), 60));
    var hitEl = document.elementFromPoint(cx, tapY);
    return {
      key: el.getAttribute('data-reward-key'),
      name: (el.querySelector('.r-name') || {}).textContent || '',
      x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      minSide: Math.round(Math.min(r.width, r.height)), visibleH: Math.round(visH),
      centerY: Math.round(r.top + r.height / 2), tapX: cx, tapY: tapY,
      hit: !!(hitEl && (hitEl === el || el.contains(hitEl))),
      hitTag: hitEl ? (hitEl.tagName + '.' + (hitEl.className || '')) : null
    };
  });
})()`;

/** 奖励弹窗外框（报告"被裁掉多少"） */
const MODAL_BOX_JS = `(function () {
  var layer = document.getElementById('modalLayer');
  if (!layer || layer.classList.contains('hidden')) return null;
  var p = document.getElementById('modal');
  if (!p) return null;
  var r = p.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), viewportH: window.innerHeight, overflowBottom: Math.round(Math.max(0, r.bottom - window.innerHeight)) };
})()`;

/** 定步长驱动 + rAF 冻结 */
const SIM_DEFINE = `(function () {
  window.__mfStep = function (sec) {
    var n = Math.max(1, Math.round(sec * 60));
    for (var i = 0; i < n; i += 1) update(1 / 60);
    try { render(); } catch (e) { /* 渲染失败不影响逻辑 */ }
    return { elapsed: Math.round(state.elapsed * 100) / 100, mode: state.mode, hp: Math.round(state.player.hp) };
  };
  window.__mfRafOff = function () {
    window.requestAnimationFrame = function () { return 0; };
    return true;
  };
  window.__mfInput = function () {
    return {
      touch: { moveId: state.touch.moveId, axisX: Math.round((state.touch.axisX || 0) * 100) / 100, axisY: Math.round((state.touch.axisY || 0) * 100) / 100 },
      arcm: (window.__arcm && window.__arcm.info) ? window.__arcm.info() : null
    };
  };
  return true;
})()`;

/**
 * 页面内导航：直线可达就直线走，否则 BFS（用游戏自带 isWalkBlocked / isWalkableCircle）
 */
const NAV_DEFINE = `(function () {
  window.__mfNav = function (tx, ty, goalR) {
    var s = state, p = s.player;
    var rad = 12;
    var W = GAME_CONFIG.worldWidth, H = GAME_CONFIG.worldHeight;
    function ok(x, y) { return !isWalkBlocked(x, y, rad) && isWalkableCircle(x, y, rad); }
    function los(ax, ay, bx, by) {
      var d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 12));
      for (var i = 1; i <= n; i += 1) {
        var t = i / n;
        if (!ok(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
      }
      return true;
    }
    var gr = goalR || 28;
    var distGoal = Math.hypot(tx - p.x, ty - p.y);
    if (distGoal <= gr) return { x: tx, y: ty, d: Math.round(distGoal), direct: true };
    if (los(p.x, p.y, tx, ty)) return { x: tx, y: ty, d: Math.round(distGoal), direct: true };

    var CELL = 13;
    var sx = Math.round(p.x / CELL), sy = Math.round(p.y / CELL);
    var ex = Math.round(tx / CELL), ey = Math.round(ty / CELL);
    var maxN = Math.ceil(W / CELL) + 2, maxM = Math.ceil(H / CELL) + 2;
    var key = function (a, b) { return a + ',' + b; };
    if (!ok(sx * CELL, sy * CELL)) {
      var found = false;
      for (var rr = 1; rr <= 6 && !found; rr += 1) {
        for (var ox = -rr; ox <= rr && !found; ox += 1) {
          for (var oy = -rr; oy <= rr && !found; oy += 1) {
            if (Math.abs(ox) !== rr && Math.abs(oy) !== rr) continue;
            if (ok((sx + ox) * CELL, (sy + oy) * CELL)) { sx += ox; sy += oy; found = true; }
          }
        }
      }
    }
    var prev = {}, seen = {}, q = [[sx, sy]];
    seen[key(sx, sy)] = 1;
    var best = [sx, sy], bestD = Math.hypot(ex - sx, ey - sy), expansions = 0;
    var dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    while (q.length && expansions < 30000) {
      var cur = q.shift(); expansions += 1;
      var cd = Math.hypot(ex - cur[0], ey - cur[1]);
      if (cd < bestD) { bestD = cd; best = cur; }
      if (cd <= 1) { best = cur; break; }
      for (var i = 0; i < dirs.length; i += 1) {
        var nx = cur[0] + dirs[i][0], ny = cur[1] + dirs[i][1];
        if (nx < 1 || ny < 1 || nx >= maxN - 1 || ny >= maxM - 1) continue;
        var k = key(nx, ny);
        if (seen[k]) continue;
        if (dirs[i][0] !== 0 && dirs[i][1] !== 0) {
          if (!ok((cur[0] + dirs[i][0]) * CELL, cur[1] * CELL)) continue;
          if (!ok(cur[0] * CELL, (cur[1] + dirs[i][1]) * CELL)) continue;
        }
        seen[k] = 1;
        if (!ok(nx * CELL, ny * CELL)) continue;
        prev[k] = cur;
        q.push([nx, ny]);
      }
    }
    var path = [], node = best, guard = 0;
    while (node && guard < 8000) {
      path.push(node);
      node = prev[key(node[0], node[1])]; guard += 1;
    }
    path.reverse();
    if (!path.length) return null;
    /* 只接受「从玩家当前位置能直视到」的航点：否则会朝着墙后的格子推摇杆，
       玩家贴墙原地磨。确实一个都没有（被卡在小口袋里）就判失败，交给脱困逻辑。 */
    var pick = null;
    for (var j = Math.min(path.length - 1, 14); j >= 1; j -= 1) {
      var wx = path[j][0] * CELL, wy = path[j][1] * CELL;
      if (Math.hypot(wx - p.x, wy - p.y) < 40) continue;
      if (los(p.x, p.y, wx, wy)) { pick = path[j]; break; }
    }
    if (!pick) return null;
    var wx2 = pick[0] * CELL, wy2 = pick[1] * CELL;
    /* 关键：航点离玩家太近（<40px）说明 BFS 没走出去（起点卡在墙里），
       返回这种航点会让摇杆推成零位移 → 玩家原地冻结。这里直接判失败。 */
    if (Math.hypot(wx2 - p.x, wy2 - p.y) < 40) return null;
    return { x: wx2, y: wy2, d: Math.round(distGoal), direct: false, nodes: path.length };
  };
  /* 单方向可行性：沿 (dx,dy) 走 dist 像素是否不被墙/门线挡住 */
  window.__mfCanGo = function (dx, dy, dist) {
    var p = state.player;
    var x1 = p.x + dx * dist, y1 = p.y + dy * dist;
    if (isWalkBlocked(x1, y1, 12) || !isWalkableCircle(x1, y1, 12)) return false;
    if (typeof roomEntryBlocksMove === 'function' && roomEntryBlocksMove(p.x, p.y, x1, y1, 12)) return false;
    return true;
  };
  /* 脱困方向：16 个方向里挑一个 40px 内可通行的，优先"离当前朝向更远" */
  window.__mfFreeDir = function () {
    var p = state.player, best = null, bestScore = -1e9;
    for (var i = 0; i < 16; i += 1) {
      var a = i / 16 * Math.PI * 2;
      var dx = Math.cos(a), dy = Math.sin(a);
      var x1 = p.x + dx * 44, y1 = p.y + dy * 44, x2 = p.x + dx * 80, y2 = p.y + dy * 80;
      if (isWalkBlocked(x1, y1, 12) || !isWalkableCircle(x1, y1, 12)) continue;
      if (isWalkBlocked(x2, y2, 12) || !isWalkableCircle(x2, y2, 12)) continue;
      var score = Math.random() * 0.5 + (i % 2 ? 0.25 : 0);   // 轻微随机，避免死循环
      if (score > bestScore) { bestScore = score; best = { x: dx, y: dy }; }
    }
    return best;
  };
  /* 带偏好的脱困方向：在可通行方向里挑"最朝向 (bx,by)"的那个。
     贴墙时用它可以沿墙滑向门/目标，而不是随机抖。 */
  window.__mfFreeDirBias = function (bx, by) {
    var p = state.player;
    var bl = Math.hypot(bx, by) || 1;
    var ux = bx / bl, uy = by / bl, best = null, bestScore = -1e9;
    for (var i = 0; i < 16; i += 1) {
      var a = i / 16 * Math.PI * 2;
      var dx = Math.cos(a), dy = Math.sin(a);
      var x1 = p.x + dx * 40, y1 = p.y + dy * 40, x2 = p.x + dx * 76, y2 = p.y + dy * 76;
      if (isWalkBlocked(x1, y1, 12) || !isWalkableCircle(x1, y1, 12)) continue;
      if (isWalkBlocked(x2, y2, 12) || !isWalkableCircle(x2, y2, 12)) continue;
      var score = dx * ux + dy * uy;      // 越朝向 (bx,by) 分越高
      if (score > bestScore) { bestScore = score; best = { x: dx, y: dy }; }
    }
    return best;
  };

  /* 门禁排障快照：最近门 / 220px 内所有门 / 正东 30px 的三口径碰撞 */
  window.__mfDoorDbg = function () {
    var s = state, p = s.player;
    var near = (s.doors || []).filter(function (d) {
      return Math.hypot(d.x - p.x, d.y - p.y) <= 220;
    }).map(function (d) {
      return { side: d.side, x: Math.round(d.x), y: Math.round(d.y), roomId: d.roomId,
        target: d.targetRoomId, closed: !!d.closed, anim: Math.round((d.anim || 0) * 100) / 100,
        d: Math.round(Math.hypot(d.x - p.x, d.y - p.y)) };
    });
    var nd = (typeof nearestEntryDoor === 'function') ? nearestEntryDoor(p.x, p.y) : null;
    var st = s.roomEntry || null;
    var ex = p.x + 30, ey = p.y;
    return {
      pos: [Math.round(p.x), Math.round(p.y)], room: s.currentRoomId,
      armed: (typeof doorEntryArmed === 'function') ? doorEntryArmed() : null,
      armedLeft: st ? Math.round((st.armedUntil - s.elapsed) * 100) / 100 : null,
      nearest: nd ? { x: Math.round(nd.x), y: Math.round(nd.y), side: nd.side, target: nd.targetRoomId } : null,
      near: near,
      east30: { walkBlocked: isWalkBlocked(ex, ey, 12), walkable: isWalkableCircle(ex, ey, 12),
        doorBlocks: (typeof roomEntryBlocksMove === 'function') ? roomEntryBlocksMove(p.x, p.y, ex, ey, 12) : null }
    };
  };

  /* 视线判定：与主文件 hasAimLineOfSight 同口径（每 12px 采样 isPointWalkable） */
  window.__mfLos = function (ax, ay, bx, by) {
    var d = Math.hypot(bx - ax, by - ay);
    var n = Math.max(2, Math.ceil(d / 12));
    for (var i = 1; i < n; i += 1) {
      var k = i / n;
      if (!isPointWalkable(ax + (bx - ax) * k, ay + (by - ay) * k)) return false;
    }
    return true;
  };
  return true;
})()`;

/**
 * 传送结构专用：房间寻路 / 选房传送 / 房内自动战斗
 * ------------------------------------------------------------
 * v1.8.2 起主文件把"走廊 + 门"换成了传送结构（state.doors / corridorRects 恒空），
 * 角色换房要靠"点相邻房间"（trySelectRoomAt），所以：
 *   __mfNextTo(target)  —— 按 roomNeighbors 做 BFS，返回下一跳房号；
 *   __mfTeleport(id)    —— 直接调用游戏自己的选房入口（和鼠标点击同一路径）；
 *   __mfBot(sec,focus)  —— 房内自动战斗：只打当前房的怪，朝目标走 + 施法，
 *                          每 1/30s 推进一帧，整段在页面里跑完再返回，省掉逐拍 CDP 往返。
 * 说明：__mfBot 只写 state.touch 轴并调用 castPrimary()，不改任何游戏参数。
 */
/* 换房方式：默认走脚本直调（__mfTeleport）；--room=touch 时改为
   「真实触摸点【选房】按钮 → 真实触摸点卡片」，用于验收触屏换房链路。 */
const ROOM_MODE = /--room=touch/.test(process.argv.join(' '));

/* 审计：包一层主文件的换房相关函数，记录被调次数与调用栈，
   用于证明"选房是触摸触发的、脚本没有直调" */
const AUDIT_DEFINE = `(function () {
  window.__roomAudit = { calls: [], taps: 0 };
  ['toggleRoomPicker', 'pickRoomFromOverlay', 'trySelectRoomAt', 'performRoomTeleport'].forEach(function (name) {
    var orig = window[name];
    if (typeof orig !== 'function') { window.__roomAudit.calls.push({ fn: name, missing: true }); return; }
    window[name] = function () {
      var top = '';
      try {
        var lines = String(new Error().stack || '').split('\\n').slice(1, 5);
        top = lines.join(' | ');
      } catch (e) { top = 'stack-unavailable'; }
      window.__roomAudit.calls.push({ fn: name, at: Math.round(state.elapsed * 100) / 100, top: top });
      return orig.apply(this, arguments);
    };
  });
  return true;
})()`;

const BOT_DEFINE = `(function () {
  function curRoomMobs() {
    var cur = state.currentRoomId, list = [];
    (state.enemies || []).forEach(function (e) {
      if (!e || e.dead || e.hp <= 0) return;
      if (e.roomId !== cur) return;
      if (state.boss && e.id === state.boss.enemyId) return;   /* 首领单独由 focus='boss' 处理 */
      list.push(e);
    });
    return list;
  }
  window.__mfNextTo = function (targetId) {
    var cur = state.currentRoomId;
    if (cur === targetId) return { next: null, done: true };
    var seen = {}, q = [[cur, null]];
    seen[cur] = true;
    while (q.length) {
      var item = q.shift(), id = item[0], first = item[1];
      var nb = roomNeighbors(id) || [];
      for (var i = 0; i < nb.length; i += 1) {
        var n = nb[i];
        if (seen[n]) continue;
        seen[n] = true;
        var f = (first == null) ? n : first;
        if (n === targetId) return { next: f, done: false };
        q.push([n, f]);
      }
    }
    return { next: null, done: false, err: 'no-route' };
  };
  window.__mfTeleport = function (roomId) {
    var r = state.rooms[roomId];
    if (!r) return { ok: false, err: 'no-room' };
    var res = resolveRoomTeleport(r.cx, r.cy, state.currentRoomId);
    if (!res) return { ok: false, err: 'not-adjacent' };
    if (res.deny) return { ok: false, err: res.deny };
    var ok = performRoomTeleport(res.targetId, res.door);
    return { ok: !!ok, target: res.targetId };
  };
  window.__mfBot = function (sec, focus) {
    var t0 = 0, dt = 1 / 30, strafe = 1, lastCast = -9;
    var casts = 0, castOk = 0, castErr = null;
    var res = { reason: 'timeout', sim: 0 };
    var modalLayer = document.getElementById('modalLayer');
    function steer(tx, ty) {
      var p = state.player, rad = p.radius || 12;
      var dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
      var ux = dx / d, uy = dy / d;
      if (!isWalkBlocked(p.x + ux * 26, p.y + uy * 26, rad) && isWalkableCircle(p.x + ux * 26, p.y + uy * 26, rad)) return { x: ux, y: uy };
      var best = null, bestScore = -2;
      for (var i = 0; i < 16; i += 1) {
        var a = i / 16 * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
        if (isWalkBlocked(p.x + cx * 34, p.y + cy * 34, rad) || !isWalkableCircle(p.x + cx * 34, p.y + cy * 34, rad)) continue;
        if (isWalkBlocked(p.x + cx * 70, p.y + cy * 70, rad) || !isWalkableCircle(p.x + cx * 70, p.y + cy * 70, rad)) continue;
        var sc = cx * ux + cy * uy;
        if (sc > bestScore) { bestScore = sc; best = { x: cx, y: cy }; }
      }
      return best || { x: ux, y: uy };
    }
    function pickBoss() {
      var b = state.boss;
      if (!b || b.defeated) return null;
      for (var i = 0; i < state.enemies.length; i += 1) {
        var e = state.enemies[i];
        if (e && e.id === b.enemyId && e.hp > 0 && e.roomId === state.currentRoomId) return e;
      }
      return null;
    }
    while (t0 < sec) {
      if (state.mode !== 'playing' || state.status !== 'playing') { res.reason = 'mode-' + state.mode; break; }
      if (modalLayer && !modalLayer.classList.contains('hidden')
        && document.querySelector('#modal [data-reward-key]')) { res.reason = 'modal'; break; }
      if (state.player.hp <= 0) { res.reason = 'dead'; break; }
      if (focus === 'boss') {
        if (!state.boss || state.boss.defeated) { res.reason = 'bossDown'; break; }
      } else if (curRoomMobs().length === 0) { res.reason = 'cleared'; break; }

      var p = state.player, mobs = curRoomMobs(), tgt = null, isBoss = false;
      if (focus === 'boss') {
        var bm = pickBoss(), near = null;
        for (var i = 0; i < mobs.length; i += 1) {
          if (!near || Math.hypot(mobs[i].x - p.x, mobs[i].y - p.y) < Math.hypot(near.x - p.x, near.y - p.y)) near = mobs[i];
        }
        if (near && (!bm || Math.hypot(near.x - p.x, near.y - p.y) < 300)) tgt = near;
        else if (bm) { tgt = bm; isBoss = true; } else tgt = near;
      } else {
        for (var j = 0; j < mobs.length; j += 1) {
          if (!tgt || Math.hypot(mobs[j].x - p.x, mobs[j].y - p.y) < Math.hypot(tgt.x - p.x, tgt.y - p.y)) tgt = mobs[j];
        }
      }
      if (!tgt) { res.reason = (focus === 'boss' && (!state.boss || state.boss.defeated)) ? 'bossDown' : 'cleared'; break; }
      var d = Math.hypot(tgt.x - p.x, tgt.y - p.y);
      var keep = isBoss ? 380 : 250;
      var dir;
      if (d > keep + 60) dir = steer(tgt.x, tgt.y);
      else if (d < keep - 80) dir = steer(p.x - (tgt.x - p.x), p.y - (tgt.y - p.y));
      else {
        var nx = -(tgt.y - p.y) / (d || 1), ny = (tgt.x - p.x) / (d || 1);
        dir = { x: nx * strafe, y: ny * strafe };
        var rad = p.radius || 12;
        if (isWalkBlocked(p.x + dir.x * 34, p.y + dir.y * 34, rad) || !isWalkableCircle(p.x + dir.x * 34, p.y + dir.y * 34, rad)) {
          strafe *= -1;
          dir = { x: nx * strafe, y: ny * strafe };
        }
      }
      state.touch.axisX = dir.x;
      state.touch.axisY = dir.y;
      state.touch.moveId = 1;
      if (d <= 640 && state.elapsed - lastCast > 0.12) {
        try { castOk += castPrimary() ? 1 : 0; } catch (e) { castErr = String(e && e.message || e); }
        casts += 1;
        lastCast = state.elapsed;
      }
      update(dt);
      t0 += dt;
      if (Math.random() < 0.02) strafe *= -1;
    }
    state.touch.axisX = 0;
    state.touch.axisY = 0;
    state.touch.moveId = null;
    try { render(); } catch (e) { /* ignore */ }
    var s = state;
    var room = s.rooms[s.currentRoomId] || null;
    res.sim = Math.round(t0 * 10) / 10;
    res.floor = s.floor;
    res.room = s.currentRoomId;
    res.enemies = s.enemies.filter(function (e) { return e && e.hp > 0; }).length;
    res.roomMobs = curRoomMobs().length;
    res.hp = Math.round(s.player.hp);
    res.hpMax = Math.round(s.player.hpMax);
    res.boss = s.boss ? { defeated: !!s.boss.defeated, hp: Math.round(s.boss.hp || 0), max: Math.round(s.boss.hpMax || 0) } : null;
    var be = null;
    for (var bi = 0; bi < s.enemies.length; bi += 1) {
      if (s.boss && s.enemies[bi].id === s.boss.enemyId) { be = s.enemies[bi]; break; }
    }
    res.bossEnemyHp = be ? Math.round(be.hp) : null;
    res.bossInfo = be ? { x: Math.round(be.x), y: Math.round(be.y), roomId: be.roomId, dist: Math.round(Math.hypot(be.x - s.player.x, be.y - s.player.y)) } : null;
    res.casts = casts;
    res.castOk = castOk;
    res.castErr = castErr;
    res.aether = Math.round(s.player.aether == null ? -1 : s.player.aether);
    res.aim = s.aim ? { mode: s.aim.mode, angle: Math.round(s.aim.angle * 100) / 100, locked: !!s.aim.locked, targetId: s.aim.targetId } : null;
    res.shots = (s.projectiles || []).length;
    res.px = Math.round(s.player.x);
    res.py = Math.round(s.player.y);
    res.cleared = !!(room && room.cleared);
    return res;
  };
  return true;
})()`;

/**
 * 主流程
 */
async function main() {
  /* ---------- 并发保护：同一时刻只能有一个 me2e 在写 shots ---------- */
  if (fs.existsSync(LOCK)) {
    const old = Number(fs.readFileSync(LOCK, 'utf8').trim());
    if (old && pidAlive(old)) {
      console.error(`已有 me2e 在运行（pid=${old}），先等它结束或结束它再跑；本次不启动。`);
      process.exitCode = 4;
      return;
    }
  }
  fs.writeFileSync(LOCK, String(process.pid));

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const RUN_DIR = path.join(MOBILE_DIR, 'shots', `run_${stamp}`);
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const md5 = crypto.createHash('md5').update(fs.readFileSync(SNAP_FILE)).digest('hex').toUpperCase();
  const out = { run: `run_${stamp}`, snapshot: { bytes: fs.statSync(SNAP_FILE).size, md5 }, steps: {}, log: [] };
  const log = (msg) => { console.log(msg); out.log.push(msg); };
  const shot = (name) => cdp.shot(path.join(RUN_DIR, name));

  const cdp = await bootEdge();
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenWidth: 844, screenHeight: 390,
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
    await cdp.send('Page.navigate', { url: 'file:///' + SNAP_FILE.replace(/\\/g, '/') + '?e2e=1' });
    for (let i = 0; i < 120; i += 1) {
      if (await cdp.ev(`document.readyState === 'complete' && typeof state !== 'undefined'`)) break;
      await sleep(200);
    }
    await sleep(900);
    await cdp.ev(`(document.getElementById('btnStart') || {}).click(); true`);
    await sleep(600);
    if (!(await cdp.ev(`state.mode === 'playing'`))) {
      await cdp.ev(`(function(){var c=document.querySelector('.char-card');if(c)c.click();var b=document.getElementById('btnCharConfirm');if(b)b.click();return true;})()`);
    }
    for (let i = 0; i < 80; i += 1) {
      if (await cdp.ev(`state.mode === 'playing'`)) break;
      await sleep(200);
    }
    await sleep(4400);   // 开场仪式（真实时间，此时 rAF 仍在跑）
    await cdp.ev(SIM_DEFINE);
    await cdp.ev(NAV_DEFINE);
    await cdp.ev(BOT_DEFINE);
    await cdp.ev(AUDIT_DEFINE);

    /* ---------- 冻结 rAF，改手动定步长 ---------- */
    await cdp.ev(`window.__mfRafOff()`);
    await sleep(200);
    const e0 = await cdp.ev(`state.elapsed`);
    await sleep(600);
    const e1 = await cdp.ev(`state.elapsed`);
    out.steps.timebase = { elapsedBefore: e0, elapsedAfter: e1, deltaReal: Math.round((e1 - e0) * 1000) / 1000 };
    log(`[时基] 冻结 rAF 后 0.6s 真实时间 → 游戏时间只走了 ${(e1 - e0).toFixed(3)}s（≈0 表示已由脚本接管）`);
    const stepRes = await cdp.ev(`window.__mfStep(0.5)`);
    log(`[时基] __mfStep(0.5) → elapsed=${stepRes.elapsed} mode=${stepRes.mode}`);

    let snap = await cdp.ev(SNAP_JS);
    out.steps.enter = snap;
    log(`[进入] floor=${snap.floor} 敌人=${snap.enemies}(房间守军=${snap.roomEnemies}) 首领=${snap.boss ? snap.boss.hp + '/' + snap.boss.max : '无'} hp=${snap.hp}/${snap.hpMax} lv=${snap.lv} 楼梯=(${snap.stairs.x},${snap.stairs.y}) active=${snap.stairs.active}`);

    const stick = await cdp.ev(RECT_JS('#arcmStick'));
    const fire = await cdp.ev(RECT_JS('[data-act="primary"]'));
    const secondary = await cdp.ev(RECT_JS('[data-act="secondary"]'));
    const descendBtn = await cdp.ev(RECT_JS('[data-act="descend"]'));
    out.steps.geometry = { stick, fire, secondary, descend: descendBtn };
    if (!stick || !fire) throw new Error('摇杆或主技能键不可见');
    if (!descendBtn) throw new Error('交互键不可见');

    /* ---------- 摇杆校准：证明触摸真的落到了摇杆并驱动了角色 ---------- */
    const p0 = await cdp.ev(`({x:state.player.x, y:state.player.y})`);
    await sendPoints(cdp, 'touchStart', [{ id: 1, x: stick.cx, y: stick.cy }]);
    await sleep(60);
    await sendPoints(cdp, 'touchMove', [{ id: 1, x: stick.cx + 38, y: stick.cy }]);
    await sleep(80);
    const inputMid = await cdp.ev(`window.__mfInput()`);
    await cdp.ev(`window.__mfStep(0.6)`);
    await sendPoints(cdp, 'touchEnd', []);
    await sleep(40);
    await cdp.ev(`window.__mfStep(0.1)`);
    const p1 = await cdp.ev(`({x:state.player.x, y:state.player.y})`);
    const moved = Math.round(Math.hypot(p1.x - p0.x, p1.y - p0.y));
    const dirTxt = Math.abs(p1.x - p0.x) > Math.abs(p1.y - p0.y) ? (p1.x > p0.x ? '东' : '西') : (p1.y > p0.y ? '南' : '北');
    out.steps.calibration = { from: p0, to: p1, movedPx: moved, direction: dirTxt, input: inputMid };
    log(`[摇杆校准] 按住向右 0.6s（游戏时间）→ 轴=(${inputMid.touch.axisX},${inputMid.touch.axisY}) moveId=${inputMid.touch.moveId} 位移=${moved}px 方向=${dirTxt} 按键计数=${inputMid.arcm ? inputMid.arcm.presses : 'n/a'}`);
    if (moved < 20) log(`[摇杆校准] ✗ 位移不足 20px，触摸可能没落到摇杆上——后续结论不成立`);
    await shot('e2e_00_battle.jpg');

    /**
     * 单指推动摇杆 + 定步推进（用于赶路）
     * @param {number} dx 方向 x
     * @param {number} dy 方向 y
     * @param {number} simSec 推进的游戏内秒数
     * @returns {Promise<number>} 实际推进秒数
     */
    async function pushStickSim(dx, dy, simSec) {
      const len = Math.hypot(dx, dy) || 1;
      const tx = stick.cx + (dx / len) * 38, ty = stick.cy + (dy / len) * 38;
      try {
        await sendPoints(cdp, 'touchStart', [{ id: 1, x: stick.cx, y: stick.cy }]);
        await sleep(45);
        await sendPoints(cdp, 'touchMove', [{ id: 1, x: tx, y: ty }]);
        await sleep(45);
        await cdp.ev(`window.__mfStep(${simSec})`);
        await sendPoints(cdp, 'touchEnd', []);
        await sleep(20);
        return simSec;
      } catch (e) {
        if (!/CDP_STALL/.test(e.message)) throw e;
        return 0.1;   // 环境阻塞：本拍当没走，外层循环继续
      }
    }

    /**
     * 双指：第一指按住摇杆持续推，第二指点技能键
     * 摇杆一直按住 → axis 连续有效 → rawAngle 一直朝目标（弱辅助瞄准才有准头）
     * @param {number} dx 方向 x
     * @param {number} dy 方向 y
     * @param {number} casts 点几次
     * @param {number} simSec 总推进游戏秒数
     * @returns {Promise<number>} 实际推进秒数
     */
    async function moveAndCastSim(dx, dy, casts, simSec) {
      const len = Math.hypot(dx, dy) || 1;
      const sx = stick.cx + (dx / len) * 38, sy = stick.cy + (dy / len) * 38;
      const per = simSec / Math.max(1, casts);
      await sendPoints(cdp, 'touchStart', [{ id: 1, x: stick.cx, y: stick.cy }]);
      await sleep(45);
      await sendPoints(cdp, 'touchMove', [{ id: 1, x: sx, y: sy }]);
      await sleep(45);
      for (let i = 0; i < casts; i += 1) {
        const btn = (i % 3 === 2 && secondary) ? secondary : fire;
        await sendPoints(cdp, 'touchStart', [{ id: 1, x: sx, y: sy }, { id: 2, x: btn.cx, y: btn.cy }]);
        await sleep(40);
        await sendPoints(cdp, 'touchEnd', [{ id: 1, x: sx, y: sy }]);
        await sleep(15);
        await cdp.ev(`window.__mfStep(${per})`);
        await sendPoints(cdp, 'touchMove', [{ id: 1, x: sx, y: sy }]);
      }
      await sendPoints(cdp, 'touchEnd', []);
      await sleep(20);
      return simSec;
    }

    /**
     * 一个战斗节拍：先「只按摇杆」走位推进，抬起后再单独点一次主技能键
     * ------------------------------------------------------------
     * 为什么不用双指（摇杆 + 技能键同时按）：
     *   CDP 的 touchEnd 只抬起"列表里点名的触点"，双指时如果把摇杆那指抬掉，
     *   摇杆的 pointerup 会把轴清零，后续 __mfStep 里玩家一步都不走
     *   （上一轮实测：离目标 500px 时每拍只位移 0.3px，而目标 1900px 外不施法时能走 12000px）。
     *   现在改成"走 → 抬手 → 点技能 → 再推"，虽然有约 0.12s 不走位，但输入绝对可靠。
     * 前提：辅助瞄准已切到「强辅助」（全向锁定 + 自动转向），施法不依赖摇杆朝向。
     * @param {number} mx 走位单位向量 x
     * @param {number} my 走位单位向量 y
     * @param {number} moveSec 走位推进的游戏秒数
     * @param {boolean} cast 是否在走完之后点一次主技能
     * @returns {Promise<number>} 本拍推进的游戏秒数
     */
    async function comboStep(mx, my, moveSec, cast) {
      let used = 0;
      const M = 38;       // 走位推程（px）：>0.8 轴强度，速度接近满速
      await sendPoints(cdp, 'touchStart', [{ id: 1, x: stick.cx, y: stick.cy }]);
      await sleep(20);
      await sendPoints(cdp, 'touchMove', [{ id: 1, x: stick.cx + mx * M, y: stick.cy + my * M }]);
      await sleep(20);
      await cdp.ev(`window.__mfStep(${moveSec})`); used += moveSec;
      await sendPoints(cdp, 'touchEnd', []);
      await sleep(10);
      if (cast) {
        await tap(cdp, fire.cx, fire.cy, 40);
        await cdp.ev(`window.__mfStep(0.12)`); used += 0.12;
      }
      return used;
    }

    /**
     * 用真实触摸把「辅助瞄准」切到强辅助
     * 路径：右上齿轮 → 设置面板 → 操作页签 → 强辅助 → 关闭
     * 目的：强辅助是全向自动锁定（游戏自带设置项），这样摇杆可以 100% 时间用于走位，
     *       不会被"边走边瞄"的朝向问题拖住。
     * @returns {Promise<Object>} 每一步的命中/结果，便于写进报告
     */
    async function setStrongAim() {
      const steps = {};
      const gear = await cdp.ev(HIT_JS('#btnSettings'));
      if (!gear || !gear.hit) { steps.gear = gear; log('[设置] 齿轮点不到：' + JSON.stringify(gear)); return steps; }
      await tap(cdp, gear.cx, gear.cy, 45);
      await sleep(420);
      steps.open = await cdp.ev(`document.getElementById('settingsPanel').classList.contains('is-open') && state.mode==='settings'`);
      const tab = await cdp.ev(HIT_JS('#settingsTabs [data-settings-tab="control"]'));
      if (tab && tab.hit) { await tap(cdp, tab.cx, tab.cy, 45); await sleep(380); }
      steps.tab = !!tab && !!tab.hit;
      let strong = await cdp.ev(HIT_JS('[data-aim-mode="strong"]'));
      if (strong && !strong.hit) {
        /* 小屏下按钮可能在滚动区外：滚到可视区再重点 */
        await cdp.ev(`(function(){var b=document.querySelector('[data-aim-mode="strong"]');if(b)b.scrollIntoView({block:'center'});return true;})()`);
        await sleep(320);
        strong = await cdp.ev(HIT_JS('[data-aim-mode="strong"]'));
      }
      steps.strongBtn = strong;
      if (strong && strong.hit) {
        await tap(cdp, strong.cx, strong.cy, 50);
        await sleep(300);
      }
      steps.mode = await cdp.ev(`state.aim.mode`);
      steps.label = await cdp.ev(`(document.getElementById('aimStateText')||{}).textContent||''`);
      const close = await cdp.ev(HIT_JS('#settingsClose'));
      if (close && close.hit) { await tap(cdp, close.cx, close.cy, 45); await sleep(380); }
      steps.closed = await cdp.ev(`!document.getElementById('settingsPanel').classList.contains('is-open')`);
      steps.backMode = await cdp.ev(`state.mode`);
      log(`[设置] 齿轮命中=${!!gear.hit} 面板打开=${steps.open} 操作页=${steps.tab} 强辅助按钮命中=${!!(strong && strong.hit)} → aim.mode=${steps.mode}(${steps.label}) 关闭=${steps.closed} 回到=${steps.backMode}`);
      return steps;
    }

    /** 选卡偏好：治疗符 = 续航（拿到后副槽自动填入，按主技能键会顺带回血） */
    const CARD_PREFER = ['治疗符', '符文雷', '冰环', '雷击', '回旋光轮'];
    const CARD_EN = { heal: '治疗符', mine: '符文雷', frost: '冰环', bolt: '雷击', blade: '回旋光轮' };

    /**
     * 处理一次奖励弹窗：记录每张卡的可见条带与真实命中，再点一张
     * @param {string} tag 日志标签
     * @returns {Promise<Object>} { stage, source, cards, picked, closed }
     */
    async function handleReward(tag) {
      await sleep(300);
      const st = await cdp.ev(SNAP_JS);
      const cards = await cdp.ev(CARDS_JS);
      const info = { stage: st.modalStage, source: st.modalSource, cards, picked: null, closed: false };
      if (!cards.length) {
        log(`[奖励·${tag}] 弹窗不可见（stage=${st.modalStage}）`);
        return info;
      }
      log(`[奖励·${tag}] stage=${st.modalStage} source=${st.modalSource} 卡片=${cards.length} 张：`
        + cards.map((c) => `${c.name}(${c.w}x${c.h},可见高=${c.visibleH},命中=${c.hit})`).join(' / '));
      await shot(`e2e_02_reward_${tag}.jpg`);
      let pick = null;
      if (st.modalStage !== 'passive') {
        pick = cards.find((c) => c.name === '治疗符')
          || cards.find((c) => CARD_PREFER.indexOf(c.name) >= 0)
          || cards[0];
      } else {
        pick = cards[0];
      }
      const before = await cdp.ev(`({magic:state.ownedMagic.slice(),tech:state.ownedTech.slice(),slots:state.dual?state.dual.slots.slice():null})`);
      await tap(cdp, pick.tapX, pick.tapY, 50);
      await sleep(320);
      await cdp.ev(`window.__mfStep(0.12)`);
      const after = await cdp.ev(`({magic:state.ownedMagic.slice(),tech:state.ownedTech.slice(),slots:state.dual?state.dual.slots.slice():null,mode:state.mode,open:!document.getElementById('modalLayer').classList.contains('hidden'),stage:state.rewardStage})`);
      info.picked = pick.name;
      info.closed = !after.open;
      info.before = before;
      info.after = after;
      log(`[选卡·${tag}] 点「${pick.name}」@(${pick.tapX},${pick.tapY}) → 弹窗=${after.open ? '仍在(' + after.stage + ')' : '已关'} 魔法=[${after.magic.join(',')}] 副槽=${after.slots ? after.slots[1] : '无'}`);
      if (after.open) {
        const skip = await cdp.ev(RECT_JS('#modal [data-action="skipPassive"]'));
        if (skip && skip.visible) { await tap(cdp, skip.cx, skip.cy, 45); await sleep(280); await cdp.ev(`window.__mfStep(0.1)`); info.closed = !(await cdp.ev(`!document.getElementById('modalLayer').classList.contains('hidden')`)); }
      }
      return info;
    }

    /**
     * 战斗循环（门口感知版）
     * ------------------------------------------------------------
     * 每拍做四件事：
     *   ① 门禁：目标在别的房间、且离门 ≤84px 时，先真实触摸按交互键放行，
     *      再把这一拍的目标改成"门中心"（门线不按 E 就是一道墙，这是上一轮卡死的根因）；
     *   ② 目标：小怪用"粘性 + 迟滞"，只在明显更近（>350px）时才换目标，
     *      避免两个房间距离相近导致玩家在两道门之间来回振荡；
     *   ③ 走位：有视线直走，没视线用 BFS 航点绕墙；航点失效进入"逃逸记忆"连走 3 拍；
     *   ④ 读数：每拍回读真实位移，连续 3 拍不动才记一次卡死（写进 totalMove 便于举证）。
     * @param {Object} o { simSec, focus:'minion'|'boss', tag }
     * @returns {Promise<Object>} { snap, reason, simUsed, totalMove }
     */
    async function battle(o) {
      let simUsed = 0;
      let reasons = 'timeout';
      let s = await cdp.ev(SNAP_JS);
      let lastLog = Date.now();
      let strafe = 1;
      let cur = null;                 // 粘性目标 { id, x, y, room }
      let stuck = 0, stuckTotal = 0;
      let esc = null, escBeats = 0;   // 逃逸方向记忆（连走 3 拍同一方向）
      let totalMove = 0;
      log(`[战斗·${o.tag}·开始] pos=(${s.px},${s.py}) 房#${s.room} 敌人=${s.enemies} 最近=${s.nearestMinion ? s.nearestMinion.d + 'px/房#' + s.nearestMinion.room : '无'} 首领距=${s.bossPos ? s.bossPos.d + 'px/房#' + s.bossPos.room : '无'}`);
      while (simUsed < o.simSec) {
        s = await cdp.ev(SNAP_JS);
        if (Date.now() - lastLog > 8000) {
          lastLog = Date.now();
          log(`  · ${o.tag} 游戏内 ${simUsed.toFixed(1)}s 敌人=${s.enemies} 房#${s.room} 首=${s.boss ? (s.boss.defeated ? '已击败' : s.boss.hp + '/' + s.boss.max + '·' + (s.bossPos ? s.bossPos.d + 'px' : '?')) : '无'}`
            + ` 最近=${s.nearestMinion ? s.nearestMinion.d + 'px/' + s.nearestMinion.hp + 'hp' : '无'} hp=${s.hp}/${s.hpMax} 奥能=${s.aether}/${s.aetherMax} pos=(${s.px},${s.py}) 累计位移=${Math.round(totalMove)}px`);
        }
        if (s.modalOpen) { reasons = 'modal'; break; }
        if (s.hp <= 0) { reasons = 'dead'; break; }
        if (s.mode !== 'playing') { reasons = 'mode-' + s.mode; break; }
        if (o.focus === 'boss' && s.boss && s.boss.defeated) { reasons = 'bossDown'; break; }

        /* ---------- 目标选择（粘性 + 迟滞） ---------- */
        let tgt = null;
        if (o.focus === 'boss') {
          /* 想在打首领：但挡路/贴脸的小怪必须先清（它们会关住房门，也会打断输出） */
          const nearMob = (s.minions || []).reduce((a, m) => (!a || m.d < a.d ? m : a), null);
          tgt = (nearMob && nearMob.d <= 480)
            ? nearMob
            : (s.bossPos ? { id: 'boss', x: s.bossPos.x, y: s.bossPos.y, room: s.bossPos.room } : null);
        } else {
          const list = s.minions || [];
          let near = null;
          for (const m of list) { if (!near || m.d < near.d) near = m; }
          if (!near) tgt = null;
          else if (!cur || cur.id === 'boss') tgt = near;
          else {
            const still = list.find((m) => m.id === cur.id);
            tgt = (still && near.d >= still.d - 350) ? still : near;
          }
        }
        if (!tgt) { await cdp.ev(`window.__mfStep(0.25)`); simUsed += 0.25; continue; }
        cur = tgt;

        /* ---------- ① 门禁：跨房间且贴近门 → 按 E 放行，再"穿过门" ---------- */
        let doorTarget = false;
        const realGoal = { x: tgt.x, y: tgt.y };
        const otherRoom = (tgt.room != null && s.room !== tgt.room);
        /* 触发条件不能只看"目标在别的房间"：第 2 层卡死那次，敌人 189px、门就在 41px 外，
           otherRoom 成立但敌人距离 >84，于是既不按 E 也不穿门，角色一直顶在门线上被推回。
           改成「贴着门 + (跨房 || 上一拍已经卡住)」就解闸。 */
        const doorNear = !!(s.door && s.door.d <= 90);
        if (doorNear && (otherRoom || stuck >= 1)) {
          const armed = await cdp.ev(`(typeof doorEntryArmed === 'function') ? doorEntryArmed() : true`);
          if (!armed) {
            await tap(cdp, descendBtn.cx, descendBtn.cy, 50);
            await cdp.ev(`window.__mfStep(0.12)`); simUsed += 0.12;
            s = await cdp.ev(SNAP_JS);
          }
          if (s.door && s.door.d <= 90) {
            /* 门在竖墙上（left/right）→ 沿 x 穿；在横墙上（top/bottom）→ 沿 y 穿。
               对齐阶段先走到门口中线，对齐后直接走到"门后 80px"，
               只停在门中心会被门禁推回去（上一轮就是这样在门口来回摆）。 */
            const dSide = s.door.side;
            const alongX = (dSide === 'left' || dSide === 'right');
            const offAxis = alongX ? Math.abs(s.py - s.door.y) : Math.abs(s.px - s.door.x);
            if (offAxis > 26) {
              tgt = { id: cur.id, x: s.door.x, y: s.door.y, room: cur.room };
            } else {
              const sx = Math.sign(realGoal.x - s.door.x) || 1;
              const sy = Math.sign(realGoal.y - s.door.y) || 1;
              tgt = alongX
                ? { id: cur.id, x: s.door.x + sx * 80, y: s.door.y, room: cur.room }
                : { id: cur.id, x: s.door.x, y: s.door.y + sy * 80, room: cur.room };
            }
            doorTarget = true;
          }
        }

        const dx = tgt.x - s.px, dy = tgt.y - s.py;
        const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        const lowHp = s.hp < s.hpMax * 0.35;
        const los = doorTarget ? true : await cdp.ev(`window.__mfLos(${s.px},${s.py},${tgt.x},${tgt.y})`);

        let mx = ux, my = uy, moveSec = 0.40;
        const bossMode = (o.focus === 'boss' && cur && cur.id === 'boss');
        if (escBeats > 0 && esc) {
          /* 逃逸记忆：连走 3 拍同一方向，别一拍就被"离目标最近"拉回墙边 */
          mx = esc.x; my = esc.y; moveSec = 0.40; escBeats -= 1;
          if (escBeats === 0) esc = null;
        } else if (!doorTarget && bossMode) {
          /* 首领战专用走位：把"距离"当命来保（首领伤害是永久掉血，没有回血）
             ① 残血或贴脸（<300px）→ 直接后撤
             ② 太远（>560px）→ 靠近到强辅助射程内
             ③ 甜区 300~560px → 垂直绕圈躲弹幕，边绕边轰 */
          if (s.hp < s.hpMax * 0.45 || d < 300) {
            mx = -ux; my = -uy; moveSec = 0.50;
            const okBack = await cdp.ev(`window.__mfCanGo(${mx},${my},46)`);
            if (!okBack) { mx = -uy * strafe; my = ux * strafe; }   // 后路被墙堵 → 换垂直方向
          } else if (d > 560) {
            mx = ux; my = uy; moveSec = 0.45;
          } else {
            mx = -uy * strafe; my = ux * strafe; moveSec = 0.45;
            const okSide = await cdp.ev(`window.__mfCanGo(${mx},${my},46)`);
            if (!okSide) {
              strafe *= -1;
              mx = -uy * strafe; my = ux * strafe;
              const okOther = await cdp.ev(`window.__mfCanGo(${mx},${my},46)`);
              if (!okOther) { mx = -ux; my = -uy; }
            }
            if (Math.random() < 0.12) strafe *= -1;
          }
        } else if (!doorTarget && !lowHp && d <= 330) {
          /* 中距离：绕圈（垂直方向）保持输出又躲弹幕；贴墙就换边 */
          mx = -uy * strafe; my = ux * strafe; moveSec = 0.45;
          const okSide = await cdp.ev(`window.__mfCanGo(${mx},${my},46)`);
          if (!okSide) {
            strafe *= -1;
            mx = -uy * strafe; my = ux * strafe;
            const okOther = await cdp.ev(`window.__mfCanGo(${mx},${my},46)`);
            if (!okOther) { mx = -ux; my = -uy; }   // 两边都贴墙：直接后撤
          }
          if (Math.random() < 0.18) strafe *= -1;
        } else if (!doorTarget && (lowHp || d < 150)) {
          /* 近身 / 残血：直接往后拉 */
          mx = -ux; my = -uy; moveSec = 0.45;
        }
        /* ---------- ③ 没有视线：BFS 绕墙 → 失败则逃逸 ---------- */
        if (!doorTarget && !los && !(bossMode && d <= 620)) {
          const wp = await cdp.ev(`window.__mfNav(${tgt.x},${tgt.y},26)`);
          if (wp) {
            const wdx = wp.x - s.px, wdy = wp.y - s.py, wl = Math.hypot(wdx, wdy) || 1;
            mx = wdx / wl; my = wdy / wl;
          } else {
            /* 寻路失败：优先沿墙滑向目标（贴墙时随机方向只会原地抖） */
            const fd = await cdp.ev(`window.__mfFreeDirBias(${tgt.x - s.px},${tgt.y - s.py})`);
            if (fd) { esc = fd; escBeats = 3; mx = fd.x; my = fd.y; }
          }
          moveSec = 0.45;
        }

        /* 强辅助：只要在 620px 内，朝向会自动锁到目标，走位途中点一下就能命中 */
        const cast = d <= 620;
        const before = { x: s.px, y: s.py };
        let used = 0;
        try {
          used = await comboStep(mx, my, moveSec, cast);
        } catch (e) {
          if (!/CDP_STALL/.test(e.message)) throw e;
          /* 环境卡顿导致触摸下发失败：本拍不算数，读回状态继续（下一个窗口再试） */
          log(`    ! 触摸下发被环境阻塞一次（${e.message.slice(0, 40)}），已清空触点继续`);
          simUsed += 0.2;
          continue;
        }
        simUsed += used;
        const post = await cdp.ev(`({x: state.player.x, y: state.player.y})`);
        const moved = Math.hypot(post.x - before.x, post.y - before.y);
        totalMove += moved;
        if (DBG_BEATS) {
          log(`    ·拍 pos=(${s.px},${s.py})→(${Math.round(post.x)},${Math.round(post.y)}) 房#${s.room} 目标=(${tgt.x},${tgt.y})房#${tgt.room}${doorTarget ? '[门]' : ''}`
            + ` 距=${Math.round(d)} los=${los} 轴=(${mx.toFixed(2)},${my.toFixed(2)}) 位移=${moved.toFixed(1)}px 累计=${Math.round(totalMove)}px`
            + ` 门禁=${JSON.stringify(await cdp.ev('window.__mfDoorDbg()'))}`);
        }

        /* ---------- ④ 真实位移判定卡死 ---------- */
        if (moved < 3) {
          stuck += 1;
          /* 卡死即取证：位置/房间/目标距离/最近门(含 anim)/门禁调试/本拍轴 —— 事后不必再猜 */
          const dbg = await cdp.ev('window.__mfDoorDbg()');
          log(`    ×拍卡住 pos=(${s.px},${s.py}) 房#${s.room} 距目标=${Math.round(d)} 轴=(${mx.toFixed(2)},${my.toFixed(2)})`
            + ` door=${s.door ? `side=${s.door.side} d=${Math.round(s.door.d)} anim=${s.door.anim} closed=${s.door.closed}` : '无'}`
            + ` 门禁=${JSON.stringify(dbg)}`);
          if (stuck >= 3) {
            const fd = await cdp.ev(`window.__mfFreeDirBias(${tgt.x - s.px},${tgt.y - s.py})`);
            if (fd) { esc = fd; escBeats = 3; }
            stuck = 0; stuckTotal += 1;
            if (stuckTotal >= 12) { reasons = 'stuck'; break; }
          }
        } else stuck = 0;
      }
      s = await cdp.ev(SNAP_JS);
      const res = { snap: s, reason: reasons, simUsed: Math.round(simUsed * 10) / 10, totalMove: Math.round(totalMove) };
      log(`[战斗·${o.tag}] 游戏内 ${res.simUsed}s 结束=${reasons} 剩余敌人=${s.enemies}(房间守军=${s.roomEnemies})`
        + ` 首领=${s.boss ? (s.boss.defeated ? '已击败' : s.boss.hp + '/' + s.boss.max) : '无'} hp=${s.hp}/${s.hpMax} xp=${s.xp}/${s.xpNeed} lv=${s.lv} 清层=${s.cleared} 弹窗=${s.modalOpen} 累计位移=${res.totalMove}px`);
      log(`  终点 pos=(${s.px},${s.py}) 房#${s.room} 门=${JSON.stringify(s.doorsNear)}`);
      log(`  房间=${JSON.stringify(s.rooms)}`);
      return res;
    }

    /**
     * 连续战斗：自动处理中途出现的奖励弹窗，直到 pred 成立 / 死亡 / 预算耗尽
     * @param {Object} o { pred, budget, focus, tag }
     * @returns {Promise<Object>} 最后一次 battle 结果
     */
    async function fightUntil(o) {
      let used = 0, last = null, stuckHits = 0;
      while (used < o.budget) {
        const r = await battle({ simSec: Math.min(75, o.budget - used), focus: o.focus, tag: o.tag });
        used += r.simUsed;
        last = r;
        if (r.reason === 'modal') {
          const info = await handleReward(o.tag);
          if (!out.steps.rewards) out.steps.rewards = [];
          out.steps.rewards.push(info);
          continue;
        }
        if (r.reason === 'dead' || r.reason.indexOf('mode-') === 0) break;
        if (r.snap && o.pred(r.snap)) break;
        if (r.reason === 'bossDown') break;
        if (r.reason === 'stuck') { stuckHits += 1; if (stuckHits >= 2) { log(`[战斗·${o.tag}] 连续卡死两次，结束本阶段`); break; } }
      }
      return { reason: last ? last.reason : 'none', snap: last ? last.snap : null, simUsed: Math.round(used * 10) / 10, done: !!(last && last.snap && o.pred(last.snap)) };
    }

    /**
     * 房内自动战斗（页面内跑，少走 CDP 往返）
     * @param {Object} o { focus:'minion'|'boss', budget, tag }
     * @returns {Promise<Object>} { reason, snap, simUsed, done }
     */
    async function autoFight(o) {
      let sim = 0;
      let last = null;
      while (sim < o.budget) {
        const chunk = Math.min(20, o.budget - sim);
        const r = await cdp.ev(`window.__mfBot(${chunk},${JSON.stringify(o.focus)})`);
        sim += r.sim;
        last = r;
        if (r.reason === 'modal') {
          const info = await handleReward(o.tag);
          if (!out.steps.rewards) out.steps.rewards = [];
          out.steps.rewards.push(info);
          continue;
        }
        if (r.reason === 'timeout') continue;
        break;
      }
      const res = {
        reason: last ? last.reason : 'none',
        snap: last,
        simUsed: Math.round(sim * 10) / 10,
        done: !!(last && (o.focus === 'boss' ? last.reason === 'bossDown' : last.reason === 'cleared'))
      };
      log(`[自动战斗·${o.tag}] 游戏内 ${res.simUsed}s 结束=${res.reason} 本房剩余=${last ? last.roomMobs : '?'} 全层剩余=${last ? last.enemies : '?'}`
        + ` 房#${last ? last.room : '?'} hp=${last ? last.hp + '/' + last.hpMax : '?'} 首领=${last && last.boss ? (last.boss.defeated ? '已击败' : last.boss.hp + '/' + last.boss.max) : '无'}`
        + ` 施法=${last ? last.castOk + '/' + last.casts : '?'} 奥能=${last ? last.aether : '?'} 锁定=${last && last.aim ? (last.aim.locked ? last.aim.targetId : '-') : '?'}`
        + ` 弹道=${last ? last.shots : '?'} 首领实体HP=${last ? last.bossEnemyHp : '?'} 位置=${last ? last.px + ',' + last.py : '?'} 首领位置=${last && last.bossInfo ? JSON.stringify(last.bossInfo) : '?'} 施法异常=${last && last.castErr ? last.castErr : '无'}`);
      return res;
    }

    /**
     * 清完当前房后等一拍，把"清房奖励三选一"消化掉
     * @returns {Promise<Object>} 最新快照
     */
    async function settle() {
      await cdp.ev(`window.__mfStep(0.6)`);
      let s = await cdp.ev(SNAP_JS);
      if (s.modalOpen) {
        const info = await handleReward('清房奖励');
        if (!out.steps.rewards) out.steps.rewards = [];
        out.steps.rewards.push(info);
        s = await cdp.ev(SNAP_JS);
      }
      return s;
    }

    /**
     * 沿传送图走到目标房：每间房先清完，再点相邻房传送，逐跳推进
     * @param {number} targetId 目标房号
     * @param {string} tag 日志标记
     * @returns {Promise<Object>} { ok, hops, reason, snap }
     */
    /**
     * 真实触摸换房：点【选房】按钮开浮层 → 点目标房卡片
     * 全程只用 Input.dispatchTouchEvent，不调用任何换房函数；
     * 浮层与卡片的坐标每跳现取，避免渲染变化后坐标过期。
     * @param {number} targetId 目标房号（必须是相邻房）
     * @param {string} tag 日志标记
     * @returns {Promise<Object>} { ok, btn, card, opened, picks, denied, cur }
     */
    async function touchPickRoom(targetId, tag) {
      const btn = await cdp.ev(RECT_JS('[data-act="room"]'));
      if (!btn || !btn.visible) return { ok: false, err: 'no-room-btn' };
      const stat0 = await cdp.ev(`JSON.parse(JSON.stringify(ROOM_PICKER_STATS))`);
      await tap(cdp, btn.cx, btn.cy, 55);
      const opened = await cdp.ev(`roomPickerOpen === true`);
      if (!opened) return { ok: false, err: 'picker-not-open', btn: btn };
      const card = await cdp.ev(`(function(){
        var b = document.querySelector('#roomPickerList button[data-room-id="${targetId}"]');
        if (!b) return null;
        var r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
      })()`);
      if (!card) return { ok: false, err: 'no-card', btn: btn };
      await tap(cdp, card.x, card.y, 55);
      const stat1 = await cdp.ev(`JSON.parse(JSON.stringify(ROOM_PICKER_STATS))`);
      /* 被拒时把 toast 原文和两侧房间的锁/清状态一起带回来，
         否则只能看到 denied+1，分不清是"没清完 / 不相邻 / 目标锁着"。 */
      const denyInfo = await cdp.ev(`(function(){
        var t = document.querySelector('#toast, .toast');
        var cur = state.rooms[state.currentRoomId] || {};
        var tgt = state.rooms[${targetId}] || {};
        return { toast: t ? String(t.textContent || '').trim() : null,
                 cur: { id: state.currentRoomId, cleared: !!cur.cleared, locked: !!cur.locked },
                 tgt: { id: ${targetId}, cleared: !!tgt.cleared, locked: !!tgt.locked },
                 mode: state.mode, status: state.status };
      })()`);
      await cdp.ev(`window.__roomAudit.taps += 1`);
      for (let w = 0; w < 10; w += 1) {
        await sleep(180);
        await cdp.ev(`window.__mfStep(0.2)`);
        if (await cdp.ev(`state.currentRoomId`) === targetId) break;
      }
      const cur = await cdp.ev(`state.currentRoomId`);
      return {
        ok: cur === targetId, mode: 'touch', btn: btn, card: card, opened: opened,
        picks: stat1.picks - stat0.picks, denied: stat1.denied - stat0.denied, cur: cur,
        denyInfo: denyInfo
      };
    }

    async function gotoRoom(targetId, tag) {
      for (let hop = 0; hop < 14; hop += 1) {
        let s = await cdp.ev(SNAP_JS);
        if (s.room === targetId) return { ok: true, hops: hop, snap: s };
        if (s.modalOpen) { await handleReward(tag + '·途中奖励'); continue; }
        const fight = await autoFight({ focus: 'minion', budget: MAX_CLEAR_SIM, tag: `${tag}·清房${s.room}` });
        if (fight.reason === 'dead' || String(fight.reason).indexOf('mode-') === 0) {
          /* 打怪途中弹了升级 / 奖励弹窗时，autoFight 会以 mode-reward 收手。
             这不是"走不到首领房"，而是探针没把弹窗关掉：先点一张卡再继续，
             否则每一层都会在第一次升级处被误判成失败。 */
          if (fight.reason === 'mode-reward') {
            await handleReward(tag + '·途中奖励');
            await settle();
            continue;
          }
          return { ok: false, hops: hop, reason: fight.reason, snap: fight.snap };
        }
        s = await settle();
        if (s.modalOpen) { await handleReward(tag + '·清房奖励'); s = await settle(); }
        const r = await cdp.ev(`window.__mfNextTo(${targetId})`);
        if (!r || r.next == null) { log(`[传送] 无路可走：房#${s.room} → 房#${targetId} ${JSON.stringify(r)}`); return { ok: false, hops: hop, reason: 'no-route', snap: s }; }
        let t;
        if (ROOM_MODE) {
          t = await touchPickRoom(r.next, tag);
          (out.steps.roomTouches = out.steps.roomTouches || []).push({ tag: tag, from: s.room, to: r.next, ok: t.ok, picks: t.picks, denied: t.denied, btn: t.btn, card: t.card });
          log(`[触摸换房] 房#${s.room} → 房#${r.next}（目标房#${targetId}）按钮=(${t.btn ? t.btn.cx + ',' + t.btn.cy : '无'}) 卡片=(${t.card ? t.card.x + ',' + t.card.y : '无'}) 浮层开=${t.opened} picks+${t.picks} denied+${t.denied} 落房=#${t.cur}${t.denyInfo ? ' 现场=' + JSON.stringify(t.denyInfo) : ''}`);
        } else {
          t = await cdp.ev(`window.__mfTeleport(${r.next})`);
          log(`[传送] 房#${s.room} → 房#${r.next}（目标房#${targetId}）${JSON.stringify(t)}`);
        }
        if (!t || !t.ok) { return { ok: false, hops: hop, reason: 'deny:' + (t && (t.err || t.denied)), snap: s }; }
        /* 转场是 CSS 过渡 + setTimeout 真时间驱动（playSceneFade），定步长推不动它：
           必须"真停 + 轻推"交替，直到 currentRoomId 真的换成目标房。 */
        for (let w = 0; w < 10; w += 1) {
          await sleep(180);
          await cdp.ev(`window.__mfStep(0.2)`);
          if (await cdp.ev(`state.currentRoomId`) === r.next) break;
        }
      }
      return { ok: false, hops: 14, reason: 'hop-limit' };
    }

    /* ---------- 阶段 0：用触摸把辅助瞄准切到强辅助（全向自动锁定） ---------- */
    out.steps.aim = await setStrongAim();

    /* ---------- 多层推进：每层都走「清小怪 → 奖励三选一 → 首领 → 楼梯 → 下楼」 ----------
       floor 1 → 2 → … → TARGET_FLOOR；首层多做一次「地图开合」这种一次性检查。
       判定线只认最后一层的 afterDescend.floor === TARGET_FLOOR && mode === 'playing'。 */
    const minionDone = (s) => (s.roomEnemies - ((s.boss && !s.boss.defeated) ? 1 : 0)) <= 0;
    const bossDone = (s) => !!(s.boss && s.boss.defeated);
    out.steps.layers = [];
    let afterDescendFinal = null;

    for (let layer = 1; layer < TARGET_FLOOR; layer += 1) {
      const L = { floor: layer, passive: [] };
      out.steps.layers.push(L);
      const stL = await cdp.ev(SNAP_JS);
      L.entry = { floor: stL.floor, mode: stL.mode, hp: stL.hp, hpMax: stL.hpMax, lv: stL.lv, enemies: stL.enemies, cleared: stL.cleared };
      log(`\n===== 第 ${layer} 层开始（当前 floor=${stL.floor} mode=${stL.mode} hp=${stL.hp}/${stL.hpMax}）→ 目标 floor=${layer + 1} =====`);

      /* ---------- 阶段 1：沿传送图走到首领房（逐房清怪 → 选房传送） ----------
         v1.8.2 没有走廊和门：state.doors / corridorRects 恒空，
         换房只能"点相邻房间"，所以这里按 floorGraph 的邻接表逐跳走。 */
      const g = await cdp.ev(`window.__roamDebug.floorGraph()`);
      const bossRoom = g.rooms.filter((r) => r.type === 'boss')[0] || g.rooms.filter((r) => r.id === g.stairId)[0];
      L.graph = { rooms: g.rooms.length, corridors: g.corridors, doors: g.doors, spawn: g.spawnId, stair: g.stairId, bossRoom: bossRoom ? bossRoom.id : null };
      log(`[L${layer}·结构] 共${g.rooms.length}间 走廊=${g.corridors} 门=${g.doors} 出生房#${g.spawnId} 首领房#${L.graph.bossRoom}`);
      if (!bossRoom) { log(`[L${layer}] 本层找不到首领房，终止多层推进`); break; }
      const go = await gotoRoom(bossRoom.id, `L${layer}`);
      L.gotoBoss = { ok: go.ok, hops: go.hops, reason: go.reason || null };
      if (!go.ok) { log(`[L${layer}] 无法到达首领房（${go.reason}），终止多层推进`); break; }

      const fight1 = await autoFight({ focus: 'minion', budget: MAX_CLEAR_SIM, tag: `L${layer}·清首领房小怪` });
      L.clearMinions = fight1;
      await shot(`e2e_L${layer}_01_minions.jpg`);
      if (fight1.reason === 'dead') { log(`[L${layer}] 清小怪阶段死亡，终止多层推进`); break; }

      /* ---------- 阶段 3：被动三选一，三张卡逐张验命中 ---------- */
    for (let round = 0; round < 3; round += 1) {
      const cur = await cdp.ev(SNAP_JS);
      if (cur.hp <= 0 || cur.mode !== 'playing') { log(`[被动#${round + 1}] 跳过：mode=${cur.mode} hp=${cur.hp}`); break; }
      const opened = await cdp.ev(`(function(){try{openReward('levelup','passive');return true;}catch(e){return String(e);}})()`);
      await sleep(350);
      const cards = await cdp.ev(CARDS_JS);
      if (!cards.length) { L.passive.push({ round: round + 1, opened, note: '未打开' }); log(`[被动#${round + 1}] 未打开：${opened}`); break; }
      await shot(`e2e_L${layer}_04_passive_${round + 1}.jpg`);
      const pick = cards[round % cards.length];
      await tap(cdp, pick.tapX, pick.tapY, 50);
      await sleep(250);
      await cdp.ev(`window.__mfStep(0.1)`);
      const st = await cdp.ev(`({mode:state.mode,open:!document.getElementById('modalLayer').classList.contains('hidden'),stage:state.rewardStage})`);
      L.passive.push({
        round: round + 1, opened: opened === true, panel: await cdp.ev(MODAL_BOX_JS),
        cards: cards.map((c) => ({ name: c.name, w: c.w, h: c.h, minSide: c.minSide, visibleH: c.visibleH, tapY: c.tapY, hit: c.hit })),
        tapped: pick.name, closed: !st.open, mode: st.mode
      });
      log(`[被动#${round + 1}] 卡数=${cards.length} 可见高=${cards[0].visibleH}px 全部命中=${cards.every((c) => c.hit)} 点「${pick.name}」@(${pick.tapX},${pick.tapY}) → 已关=${!st.open} mode=${st.mode}`);
      if (st.open) {
        const skip = await cdp.ev(RECT_JS('#modal [data-action="skipPassive"]'));
        if (skip && skip.visible) { await tap(cdp, skip.cx, skip.cy, 45); await sleep(250); }
      }
    }

    /* ---------- 阶段 4：地图开合（触摸；只在首层做一次，新层沿用同一套 UI） ---------- */
    if (layer === 1) {
      out.steps.map = { opened: false, closed: false };
      const st = await cdp.ev(SNAP_JS);
      if (st.modalOpen || st.mode !== 'playing') {
        out.steps.map.note = `未测：mode=${st.mode} 弹窗=${st.modalOpen}`;
        log(`[地图] 未测（mode=${st.mode} 弹窗=${st.modalOpen}）`);
      } else {
        const mapBtn = await cdp.ev(RECT_JS('#btnMapDock'));
        if (mapBtn && mapBtn.visible) {
          await tap(cdp, mapBtn.cx, mapBtn.cy, 45);
          await sleep(300);
          out.steps.map.opened = await cdp.ev(`document.getElementById('mapPanel').classList.contains('is-open')`);
          await shot('e2e_05_map.jpg');
          const closeBtn = await cdp.ev(RECT_JS('#mapClose'));
          if (closeBtn && closeBtn.visible) { await tap(cdp, closeBtn.cx, closeBtn.cy, 45); await sleep(250); }
          out.steps.map.closed = !(await cdp.ev(`document.getElementById('mapPanel').classList.contains('is-open')`));
          log(`[地图] 触摸地图键 → 打开=${out.steps.map.opened}；触摸关闭 → 已关=${out.steps.map.closed}`);
        } else {
          out.steps.map.note = '地图键不可见';
          log('[地图] 地图键不可见');
        }
      }
    }

    /* ---------- 阶段 5：首领战（已在首领房内；楼梯只在首领被击败后解锁） ---------- */
    const fightBoss = await autoFight({ focus: 'boss', budget: BOSS_SIM, tag: `L${layer}·首领` });
    const sBoss = await cdp.ev(SNAP_JS);
    L.bossFight = { reason: fightBoss.reason, simUsed: fightBoss.simUsed, boss: sBoss.boss, hp: sBoss.hp, hpMax: sBoss.hpMax };
    await shot(`e2e_L${layer}_06_boss.jpg`);
    log(`[L${layer}·首领] 击败=${bossDone(sBoss)} 结束=${fightBoss.reason} 游戏内 ${fightBoss.simUsed}s 首领=${sBoss.boss ? (sBoss.boss.defeated ? '已击败' : sBoss.boss.hp + '/' + sBoss.boss.max) : '无'} hp=${sBoss.hp}/${sBoss.hpMax}`);
    if (!bossDone(sBoss)) { log(`[L${layer}] 首领未击败（${fightBoss.reason}），楼梯不会解锁，终止多层推进`); break; }

    /* ---------- 阶段 6：走楼梯 → 触摸交互键下楼 ---------- */
    let s5 = await cdp.ev(SNAP_JS);
    let simStairs = 0;
    let lastStairD = null;
    let stillBeats = 0;
    let pressCount = 0;                          /* 本层交互键按了几次（报告要的读数） */
    while (simStairs < MAX_STAIRS_SIM) {
      s5 = await cdp.ev(SNAP_JS);
      if (s5.modalOpen) {
        const info = await handleReward('楼梯前');
        if (!out.steps.rewards) out.steps.rewards = [];
        out.steps.rewards.push(info);
        continue;
      }
      if (s5.mode !== 'playing') break;
      if (s5.hp <= 0) break;
      if (!s5.stairs) break;
      if (!s5.stairs.active) {
        log(`[楼梯] 仍未解锁（首领=${s5.boss ? (s5.boss.defeated ? '已击败' : s5.boss.hp + '/' + s5.boss.max) : '无'}）`);
        break;
      }
      const d = Math.hypot(s5.stairs.x - s5.px, s5.stairs.y - s5.py);
      if (d <= 40) break;
      /* 无进展计数：连续多拍距离不变，就把当时的位置/门/房间打出来，别让它默默空转到超时 */
      if (lastStairD !== null && Math.abs(d - lastStairD) < 2) stillBeats += 1; else stillBeats = 0;
      lastStairD = d;
      if (stillBeats === 6 || stillBeats === 24) {
        log(`[楼梯] 无进展 ${stillBeats} 拍：pos=(${s5.px},${s5.py}) 房=${s5.room} 距楼梯=${Math.round(d)} 门=${JSON.stringify(s5.door)}`);
        /* 首次无进展时采一次现场：楼梯周围 200px 的 blocker + 多圈可走性 + 触摸输入 */
        if (!out.steps.stairStuck) {
          const diag = await cdp.ev(`(function(){
            var s = state, p = s.player, st = s.stairs, b = [];
            (s.walkBlockers || []).forEach(function (w) {
              var wx = w.kind === 'circle' ? w.x : w.x + w.w / 2;
              var wy = w.kind === 'circle' ? w.y : w.y + w.h / 2;
              var dd = Math.hypot(wx - st.x, wy - st.y);
              if (dd < 200) b.push({ kind: w.kind, x: Math.round(wx), y: Math.round(wy),
                r: w.r || null, wall: !!w.wall, temp: !!w.tempTerrain, d: Math.round(dd) });
            });
            var ring = [];
            [30, 50, 64, 70, 80].forEach(function (R) {
              var row = '';
              for (var i = 0; i < 8; i += 1) {
                var a = i / 8 * Math.PI * 2;
                var x = st.x + Math.cos(a) * R, y = st.y + Math.sin(a) * R;
                row += (!isWalkBlocked(x, y, 12) && isWalkableCircle(x, y, 12)) ? '1' : '0';
              }
              ring.push(R + ':' + row);
            });
            return { px: Math.round(p.x), py: Math.round(p.y), pr: p.radius, speed: p.speed || null,
              mode: s.mode, touch: JSON.parse(JSON.stringify(s.touch)), stairs: { x: st.x, y: st.y },
              blockers: b, ring: ring };
          })()`);
          out.steps.stairStuck = diag;
          log(`[楼梯诊断] ${JSON.stringify(diag)}`);
        }
      }
      if (stillBeats > 30) { log('[楼梯] 连续 30 拍距离不变，放弃逼近'); break; }
      /* E 键在楼梯附近要同时承担三件事：解门禁、开首领宝箱、下楼。
         所以只要靠近就每拍按一次，不再依赖 s5.door 是否恰好非空。 */
      const nearDoor = s5.door && s5.door.d <= 90;
      if (d < 150 || nearDoor) {
        await tap(cdp, descendBtn.cx, descendBtn.cy, 45);
        pressCount += 1;
        await cdp.ev(`window.__mfStep(0.08)`);
      }
      let gp = await cdp.ev(`window.__mfNav(${s5.stairs.x},${s5.stairs.y},40)`);
      if (!gp) gp = await cdp.ev(`window.__mfFreeDirBias(${s5.stairs.x},${s5.stairs.y})`);
      if (!gp) gp = { x: s5.stairs.x, y: s5.stairs.y };
      simStairs += await pushStickSim(gp.x - s5.px, gp.y - s5.py, 0.35);
    }
    out.steps.stairsApproach = s5;
    await shot(`e2e_L${layer}_06_stairs.jpg`);
    const distStairs = s5.stairs ? Math.round(Math.hypot(s5.stairs.x - s5.px, s5.stairs.y - s5.py)) : -1;
    log(`[楼梯] active=${s5.stairs && s5.stairs.active} 距离=${distStairs} 清层=${s5.cleared} 首领=${s5.boss ? (s5.boss.defeated ? '已击败' : s5.boss.hp + '/' + s5.boss.max) : '无'}`);

    if (descendBtn && descendBtn.visible) {
      let s6 = null;
      /* 交互键 E 的消费顺序是"事件房 → 首领宝箱 → 裂隙 → … → 门禁 → 楼梯"。
         首领刚死时 stairs 旁边会生成首领宝箱，第一次 E 会被宝箱吃掉，
         所以这里必须"按键 → 处理宝箱/奖励弹窗 → 再按键"，直到真正换层。 */
      for (let attempt = 0; attempt < 6; attempt += 1) {
        s6 = await cdp.ev(SNAP_JS);
        if (s6.floor === layer + 1 && s6.mode === 'playing') break;
        if (s6.modalOpen) {
          const info = await handleReward('首领宝箱');
          if (!out.steps.rewards) out.steps.rewards = [];
          out.steps.rewards.push(info);
          continue;
        }
        if (s6.mode !== 'playing') {
          /* 非战斗态：可能是宝箱演出/面板，先尝试把卡选掉，再 ESC 退出 */
          const cards = await cdp.ev(CARDS_JS);
          if (cards.length) {
            const info = await handleReward('宝箱面板');
            if (!out.steps.rewards) out.steps.rewards = [];
            out.steps.rewards.push(info);
            continue;
          }
          await cdp.ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape'}))`);
          await sleep(250);
          s6 = await cdp.ev(SNAP_JS);
          if (s6.mode !== 'playing') { log(`[下楼] 被面板挡住 mode=${s6.mode} status=${s6.status}`); break; }
        }
        await tap(cdp, descendBtn.cx, descendBtn.cy, 50);
        pressCount += 1;
        await sleep(250);
        await cdp.ev(`window.__mfStep(0.9)`);   // 转场 + 新层生成
        s6 = await cdp.ev(SNAP_JS);
        if (s6.floor === layer + 1 && s6.mode === 'playing') break;
        await cdp.ev(`window.__mfStep(0.9)`);
        s6 = await cdp.ev(SNAP_JS);
        if (s6.floor === layer + 1 && s6.mode === 'playing') break;
        await sleep(200);
      }
      L.afterDescend = s6;
      L.interactPresses = pressCount;
      afterDescendFinal = s6;
      await shot(`e2e_L${layer}_07_floor${layer + 1}.jpg`);
      log(`[L${layer}·上楼读数] 楼层=${layer}→${s6.floor} 血量=${s6.hp}/${s6.hpMax} 敌人=${s6.enemies} 楼梯距离=${distStairs}px 清层=${s6.cleared} 下楼=${s6.floor === layer + 1 ? '是' : '否'} 交互键=${pressCount}次`);
      L.reading = { floorFrom: layer, floorTo: s6.floor, hp: s6.hp, hpMax: s6.hpMax, enemies: s6.enemies, stairsDist: distStairs, cleared: s6.cleared, descended: s6.floor === layer + 1, presses: pressCount };
    } else {
      L.afterDescend = null;
      log('[下楼] 交互键不可见');
      break;
    }

    /* 本层没换到下一层就收工：再往下跑只会在同一层里空转 */
    if (!afterDescendFinal || afterDescendFinal.floor !== layer + 1) {
      log(`[L${layer}] 未到达 floor=${layer + 1}（当前 floor=${afterDescendFinal ? afterDescendFinal.floor : 'n/a'}），终止多层推进`);
      break;
    }
    }   // ← 层循环结束

    /* ---------- 判定线 ---------- */
    out.steps.afterDescend = afterDescendFinal;
    /* 换房审计：确认换房入口是被真实触摸触发的（toggleRoomPicker 次数 == 触摸次数），
       且脚本从未走鼠标路径 trySelectRoomAt */
    const audit = await cdp.ev(`JSON.parse(JSON.stringify(window.__roomAudit || null))`).catch(() => null);
    if (audit) {
      const by = {};
      audit.calls.forEach((c) => { by[c.fn] = (by[c.fn] || 0) + 1; });
      out.roomAudit = { by: by, taps: audit.taps, samples: audit.calls.slice(0, 6) };
      log(`[换房审计] ${JSON.stringify(by)} 触摸换房=${audit.taps}次 trySelectRoomAt=${by.trySelectRoomAt || 0}次`);
    }
    const okTouch = !ROOM_MODE || !!(out.roomAudit
      && (out.roomAudit.by.trySelectRoomAt || 0) === 0
      && out.roomAudit.by.toggleRoomPicker === out.roomAudit.taps
      && out.roomAudit.taps >= 2
      && out.roomAudit.by.pickRoomFromOverlay === out.roomAudit.taps);
    const ok = !!(afterDescendFinal && afterDescendFinal.floor === TARGET_FLOOR && afterDescendFinal.mode === 'playing') && okTouch;
    out.verdict = {
      pass: ok,
      rule: `afterDescend.floor === ${TARGET_FLOOR} && afterDescend.mode === "playing"`
        + (ROOM_MODE ? ' && trySelectRoomAt=0 && toggleRoomPicker=pickRoomFromOverlay=taps>=2' : '')
    };
    log(`[判定] ${ok ? 'PASS' : 'FAIL'} —— afterDescend.floor=${afterDescendFinal ? afterDescendFinal.floor : 'n/a'} mode=${afterDescendFinal ? afterDescendFinal.mode : 'n/a'}（目标 floor=${TARGET_FLOOR}）`);

    fs.writeFileSync(path.join(RUN_DIR, 'e2e.json'), JSON.stringify(out, null, 1));
    console.log('结果目录：' + RUN_DIR);
  } catch (err) {
    /* 任何一步崩掉都把已采集的证据落盘，避免"什么都没留下" */
    try {
      out.crash = String((err && err.message) || err);
      out.verdict = out.verdict || { pass: false, rule: `afterDescend.floor === ${TARGET_FLOOR} && afterDescend.mode === "playing"`, reason: 'crash' };
      fs.writeFileSync(path.join(RUN_DIR, 'e2e.json'), JSON.stringify(out, null, 1));
      console.error('运行中断（' + out.crash + '），已写出部分结果：' + path.join(RUN_DIR, 'e2e.json'));
    } catch (e2) { /* ignore */ }
    throw err;
  } finally {
    cdp.close();
    try { fs.unlinkSync(LOCK); } catch (e) { /* ignore */ }
  }
}

main().catch((e) => { try { fs.unlinkSync(LOCK); } catch (e2) { /* ignore */ } console.error(e); process.exitCode = 1; });
