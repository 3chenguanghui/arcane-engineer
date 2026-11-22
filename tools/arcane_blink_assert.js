/* ============================================================
   瞬移 / 连通性实测断言（端口 9488）
   ------------------------------------------------------------
   用法： node tools/arcane_blink_assert.js

   验的东西（全部走游戏内真实函数，不看图）：
     1) 落点合法性：多楼层 × 多房间 × 16 方向，落点必须能站、且不跨出当前房间
     2) 关门拦截：把房间门闸落下，朝门瞬移不能穿过去
     3) 真实触发：fire() 后的位移 / 体力 / 冷却 / 残影数量
     4) 体力闸门：体力不足时不允许位移
     5) 连通性：出生房 → 首领房，格子 BFS 实测走得通（多个随机种子）
     6) 帧率：残影 + 后处理同时存在时 ≥ 90
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9488;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 三颗互不相同的种子：同一套注入方式，保证"随机若干种子"可复核
const SEEDS = [261108, 884213, 20261110];

/**
 * 生成"导航前注入"的脚本：把 Math.random 换成固定种子的 mulberry32
 * @param {number} seed 种子
 * @returns {string} 注入源码
 */
function injectSource(seed) {
  return `(function () {
    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    var rng = mulberry32(${seed});
    Math.random = function () { return rng(); };
    window.__probeSeed = ${seed};
  })();`;
}

const results = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {*} detail 细节
 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    // 无头页面默认会被判为"后台"从而把 rAF 降到几帧/秒，
    // 位移 / 冷却这类按时间推进的逻辑就测不动了，必须关掉这层节流。
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1440,900', 'about:blank'
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
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const url = 'file:///' + FILE.replace(/\\/g, '/');

  /**
   * 用指定种子的随机流把游戏开到可操作状态
   * @param {number} seed 种子
   */
  const bootWithSeed = async (seed) => {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: injectSource(seed) });
    await send('Page.navigate', { url });
    // 大文件 headless 冷启动可能 10s+，轮询到 state 建立
    for (let i = 0; i < 120; i += 1) {
      await sleep(250);
      const ready = await ev('typeof state !== "undefined"').catch(() => false);
      if (ready) break;
    }
    await sleep(600);
    await ev('window.dispatchEvent(new Event("resize"))');
    await sleep(200);
    const rect = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await sleep(900);
    await ev(`(function(){
      var card = document.querySelector('.char-card');
      if (card) card.click();
      var ok = document.getElementById('btnCharConfirm');
      if (ok) ok.click();
      return true;
    })()`);
    await sleep(1200);
    return ev('window.__roamDebug.getState().mode');
  };

  /**
   * 站到指定房间中心（同时清怪，避免碰撞干扰）
   * @param {number} roomId 房间 id
   */
  const standIn = async (roomId) => ev(`(function(){
    var d = window.__roamDebug;
    var r = d.getState().rooms.filter(function(x){ return x.id === ${roomId}; })[0];
    if (!r) return false;
    d.despawnAll();
    d.setPlayerPos(r.cx, r.cy);
    d.snapCamera();
    return true;
  })()`);

  let fpsReported = null;
  for (const seed of SEEDS) {
    const mode = await bootWithSeed(seed);
    check(`[seed ${seed}] 开局进入 playing`, mode === 'playing', mode);

    // ---------- 1) 连通性：出生房 → 首领房 ----------
    const conn = [];
    for (const f of [1, 2, 3, 4, 5, 6, 7]) {
      await ev(`window.__roamDebug.setFloor(${f})`);
      await sleep(320);
      const r = await ev('window.__roamDebug.connectivityProbe(12)');
      conn.push(r);
    }
    const connBad = conn.filter((r) => !r || !r.ok);
    check(`[seed ${seed}] 7 层出生房→首领房全部连通（格子 BFS）`, connBad.length === 0,
      conn.map((r) => (r ? { f: r.ok, v: r.visited, ms: r.ms } : null)));

    // ---------- 2) 落点合法性扫描 ----------
    let probeTotal = 0;
    let probeOk = 0;
    const violations = [];
    for (const f of [1, 3, 5, 7]) {
      await ev(`window.__roamDebug.setFloor(${f})`);
      await sleep(320);
      const rooms = await ev(`(function(){
        return window.__roamDebug.getState().rooms
          .filter(function(r){ return r.type === 'battle' || r.type === 'spawn' || r.type === 'boss' || r.type === 'elite'; })
          .slice(0, 4).map(function(r){ return r.id; });
      })()`);
      for (const roomId of rooms) {
        if (!(await standIn(roomId))) continue;
        await sleep(200);
        for (let a = 0; a < 360; a += 22.5) {
          const p = await ev(`window.__roamDebug.blink.probe(${a}, 220)`);
          probeTotal += 1;
          if (!p || !p.ok) continue;
          probeOk += 1;
          if (!p.landingWalkable || p.endRoom !== p.startRoom) {
            violations.push({ floor: f, room: roomId, angle: a, p });
          }
        }
      }
    }
    check(`[seed ${seed}] 落点全部合法（可站 + 不跨房间）`,
      violations.length === 0 && probeOk > 0,
      { probed: probeTotal, reachable: probeOk, violations: violations.slice(0, 3) });

    // ---------- 3) 关门拦截 ----------
    await ev('window.__roamDebug.setFloor(3)');
    await sleep(360);
    const doorRoom = await ev(`(function(){
      var d = window.__roamDebug;
      var s = d.getState();
      var doors = d.doorsState();
      var room = s.rooms.filter(function(r){
        return r.type === 'battle' && doors.some(function(x){ return x.roomId === r.id; });
      })[0];
      if (!room) return null;
      d.setDoorsOf(room.id, true);
      d.despawnAll();
      return { id: room.id, doors: doors.filter(function(x){ return x.roomId === room.id; }) };
    })()`);
    if (doorRoom) {
      let doorChecks = 0;
      let doorViolations = 0;
      for (const door of doorRoom.doors) {
        // 从门内侧 70px 处朝门外瞬移。
        // 关门 / 站位 / 探测必须在同一帧里做完：门会在房间清空后自动开闸，跨帧就会测成"门是开的"。
        const inward = door.side === 'top' ? [0, 1] : door.side === 'bottom' ? [0, -1]
          : door.side === 'left' ? [1, 0] : [-1, 0];
        const sx = door.x + inward[0] * 70;
        const sy = door.y + inward[1] * 70;
        const ang = Math.atan2(-inward[1], -inward[0]) * 180 / Math.PI;
        const probe = await ev(`(function(){
          var d = window.__roamDebug;
          d.setDoorsOf(${doorRoom.id}, true);
          d.setPlayerPos(${sx}, ${sy});
          var closed = d.doorsState().filter(function(x){ return x.roomId === ${doorRoom.id}; })
            .every(function(x){ return x.closed; });
          var p = d.blink.probe(${ang}, 220);
          return { closed: closed, p: p };
        })()`);
        doorChecks += 1;
        // 门闸挡住后，落点必须停在门内侧（70 - 门厚 5 - 玩家半径 15 ≈ 50）
        if (!probe.closed) doorViolations += 1;
        else if (probe.p && probe.p.ok && (probe.p.dist > 52 || probe.p.endRoom !== doorRoom.id)) doorViolations += 1;
      }
      check(`[seed ${seed}] 关闸门无法被瞬移穿过（${doorChecks} 扇门）`, doorViolations === 0,
        { doors: doorChecks, violations: doorViolations });
      await ev(`window.__roamDebug.setDoorsOf(${doorRoom.id}, false)`);
    } else {
      check(`[seed ${seed}] 关闸门无法被瞬移穿过`, false, '第 3 层没有带门房间');
    }

    // ---------- 4) 真实触发：位移 / 体力 / 冷却 / 残影 ----------
    await ev('window.__roamDebug.setFloor(1)');
    await sleep(320);
    const fireRes = await ev(`(function(){
      var d = window.__roamDebug;
      var room = d.getState().rooms.filter(function(r){ return r.type === 'battle'; })[0] || d.getState().rooms[0];
      d.despawnAll();
      d.setPlayerPos(room.cx, room.cy);
      d.snapCamera();
      d.blink.reset();
      // 站位完成后再取一次状态：getState() 每次返回快照，提前取会拿到上一处的坐标
      var s = d.getState();
      // 找一个真的有落点的方向
      var dir = null;
      for (var a = 0; a < 360; a += 30) {
        var p = d.blink.probe(a, 220);
        if (p && p.ok && p.dist > 120) { dir = { a: a, p: p }; break; }
      }
      if (!dir) return { error: 'no-direction' };
      var before = { x: s.player.x, y: s.player.y, st: d.blink.state().stamina };
      d.blink.fire(dir.a);
      return { dir: dir.a, before: before, landing: dir.p, roomId: room.id };
    })()`);
    if (fireRes.error) {
      check(`[seed ${seed}] 真实瞬移`, false, fireRes.error);
    } else {
      await sleep(60);
      const mid = await ev('window.__roamDebug.blink.state()');
      // 等落地：无头环境帧率不稳，按游戏内 tpTime 轮询，不按墙钟猜
      let land = null;
      for (let i = 0; i < 240; i += 1) {
        const st = await ev('window.__roamDebug.blink.state()');
        if (st.tpTime === 0 && st.tpFreeze > 0) { land = st; break; }
        await sleep(25);
      }
      if (!land) land = await ev('window.__roamDebug.blink.state()');
      // 等顿帧结束：落地后的滑行距离就是"余势"的客观量
      let settle = null;
      for (let i = 0; i < 160; i += 1) {
        const st = await ev('window.__roamDebug.blink.state()');
        if (st.tpFreeze === 0) { settle = st; break; }
        await sleep(20);
      }
      if (!settle) settle = await ev('window.__roamDebug.blink.state()');
      const ground = await ev(`(function(){
        var d = window.__roamDebug;
        var s = d.getState();
        return {
          x: s.player.x, y: s.player.y,
          walkable: d.walkableAt(s.player.x, s.player.y),
          room: (function(){
            var r = s.rooms.filter(function(x2){
              return s.player.x >= x2.x && s.player.x <= x2.x + x2.w && s.player.y >= x2.y && s.player.y <= x2.y + x2.h;
            })[0];
            return r ? r.id : -1;
          })()
        };
      })()`);
      const moved = Math.hypot(land.x - fireRes.before.x, land.y - fireRes.before.y);
      // 余势总量：从"探测落点"到"最终停稳"的实际滑行距离（不依赖采样时机）
      const slide = Math.hypot(ground.x - fireRes.landing.x, ground.y - fireRes.landing.y);
      const carrySpeed = Math.hypot(land.vx, land.vy);
      const expectDist = fireRes.landing.dist;
      check(`[seed ${seed}] 瞬移位移符合落点（误差 ≤ 18px）`,
        Math.abs(moved - expectDist) <= 18, { moved: Number(moved.toFixed(2)), expect: expectDist, tpTime: land.tpTime });
      check(`[seed ${seed}] 瞬移后站在合法地面且仍在原房间`,
        ground.walkable && ground.room === fireRes.roomId, { walkable: ground.walkable, room: ground.room, origin: fireRes.roomId });
      check(`[seed ${seed}] 瞬移扣除体力 34 且进入冷却`,
        Math.abs((fireRes.before.st - land.stamina) - 34) <= 1 && land.tpCd > 4,
        { before: fireRes.before.st, after: land.stamina, cd: land.tpCd });
      check(`[seed ${seed}] 落地有顿帧 + 位移余势`, land.tpFreeze > 0 && slide >= 5,
        { freeze: land.tpFreeze, slide: Number(slide.toFixed(2)), speedAtLanding: Number(carrySpeed.toFixed(1)) });
      check(`[seed ${seed}] 起手残影 ≥ 3、落地残影 ≥ 3`,
        mid.startGhosts >= 3 && land.landGhosts >= 3,
        { start: mid.startGhosts, land: land.landGhosts });

      // ---------- 5) 体力闸门 ----------
      const gate = await ev(`(function(){
        var d = window.__roamDebug;
        var s = d.getState();
        d.blink.reset();
        d.setStamina(5);
        var before = { x: s.player.x, y: s.player.y };
        var ok = d.blink.fire(0);
        var st = d.getState().player.stamina;
        return { fired: ok, before: before, st: st };
      })()`);
      await sleep(320);
      const gateAfter = await ev('window.__roamDebug.getState().player');
      const gateMoved = Math.hypot(gateAfter.x - gate.before.x, gateAfter.y - gate.before.y);
      check(`[seed ${seed}] 体力不足时瞬移被拒且不位移`,
        gate.fired === false && gateMoved < 1, { fired: gate.fired, moved: Number(gateMoved.toFixed(2)), stamina: gate.st });
    }

    // ---------- 6) 帧率（只在第一颗种子上测）----------
    if (fpsReported === null) {
      await ev('window.__roamDebug.setFloor(5)');
      await sleep(320);
      const fps = await ev('window.__roamDebug.postfx.bench(180)');
      fpsReported = fps;
      check(`[seed ${seed}] 帧率 ≥ 90（残影 + 后处理）`, fps.fps >= 90, fps);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n== ${results.length - failed.length}/${results.length} PASS ==`);
  const outDir = path.join(ROOT, '.screenshots', 'blink');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'blink_assert.json'), JSON.stringify({ results, fps: fpsReported }, null, 2), 'utf8');
  ws.close();
  killEdge(edge);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('ASSERT FAILED:', err);
  process.exit(2);
});
