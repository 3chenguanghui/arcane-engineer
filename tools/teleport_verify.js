/**
 * R2 选房即传送 · 端到端验证探针
 * ------------------------------------------------------------
 * 用真实鼠标事件走一遍完整链路（不是直接调函数），验证：
 *   1) 在出生房点相邻房间地面 → 玩家真的落进那间房（currentRoomId 改变、坐标在房内）；
 *   2) 传送有过程感（sceneFade 走了一次 room 转场，不是硬切）；
 *   3) 落点安全（离墙 ≥ 半径+8、离最近活怪 ≥ 110px，或退到房心）；
 *   4) 本房有活怪时点别的房间 → 被拒（保留"清完才能选"）。
 * 输出：.screenshots/firstplay/teleport-<tag>-select.png
 *       .screenshots/firstplay/teleport-<tag>-arrived.png
 *       .screenshots/firstplay/teleport-<tag>.json
 *
 * 用法：node tools/teleport_verify.js [tag] [html路径]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TAG = process.argv[2] || 'r2';
const FILE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'index_arcane_v2.html'));
const OUT = path.resolve(__dirname, '..', '.screenshots', 'firstplay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 建连（沿用 door_audit.js 的启动参数）
 * @returns {Promise<Object>} CDP 会话
 */
async function connect() {
  let edge = null;
  let target = null;
  for (let attempt = 0; attempt < 5 && !target; attempt += 1) {
    const port = 10760 + Math.floor(Math.random() * 120);
    const profile = prepareProfile();
    edge = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--allow-file-access-from-files', '--window-size=1440,900', '--force-device-scale-factor=1',
      'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 40 && !target; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page') || null;
      } catch (e) { /* 等端口 */ }
      if (!target) await sleep(250);
    }
    if (!target) { try { killEdge(edge); } catch (e) { /* 忽略 */ } await sleep(300); }
  }
  if (!target) throw new Error('调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || '') };
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  /** 在指定 CSS 坐标派发一次真实的左键按下+抬起 */
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  return { edge, ws, send, ev, shot, click };
}

/**
 * 选一个"画布上没被 HUD 盖住"的房间内落点，并换算成屏幕坐标
 * @param {number} roomId 目标房 id
 * @returns {string} 可注入表达式
 */
function pickClickPointExpr(roomId) {
  return `(function(){
    var room = state.rooms[${roomId}];
    if (!room) return { __err: 'no-room' };
    var cv = document.getElementById('game');
    var rect = cv.getBoundingClientRect();
    var kx = rect.width / cv.width, ky = rect.height / cv.height;
    var z = cameraZoom();
    var toScreen = function(wx, wy){
      return { x: rect.x + (wx - state.cam.x) * z * kx, y: rect.y + (wy - state.cam.y) * z * ky };
    };
    var best = null;
    for (var i = 1; i <= 7; i += 1) {
      for (var j = 1; j <= 7; j += 1) {
        var wx = room.x + room.w * i / 8;
        var wy = room.y + room.h * j / 8;
        var p = toScreen(wx, wy);
        if (p.x < 8 || p.y < 8 || p.x > innerWidth - 8 || p.y > innerHeight - 8) continue;
        var el = document.elementFromPoint(p.x, p.y);
        if (!el || el.id !== 'game') continue;
        /* 优先离房间中心近的点（读起来像"点了这间房"） */
        var d = Math.hypot(wx - room.cx, wy - room.cy);
        if (!best || d < best.d) best = { x: Math.round(p.x), y: Math.round(p.y), wx: Math.round(wx), wy: Math.round(wy), d: d };
      }
    }
    return best || { __err: 'no-free-point' };
  })()`;
}

/**
 * 传送结果快照：当前房、玩家坐标、离墙/离怪距离、场景转场记录
 * @returns {string} 可注入表达式
 */
const RESULT_EXPR = `(function(){
  var room = state.rooms[state.currentRoomId];
  var out = { roomId: state.currentRoomId, roomType: room ? room.type : null,
    player: { x: Math.round(state.player.x), y: Math.round(state.player.y) },
    fade: (typeof sceneFadeRuntime !== 'undefined') ? {
      mode: sceneFadeRuntime.lastMode, target: sceneFadeRuntime.lastTarget,
      dur: sceneFadeRuntime.lastDur, peak: sceneFadeRuntime.lastPeak } : null,
    stats: (typeof ROOM_TELEPORT_STATS !== 'undefined') ? ROOM_TELEPORT_STATS : null };
  if (room) {
    out.wallGap = Math.round(Math.min(state.player.x - room.x, room.x + room.w - state.player.x,
      state.player.y - room.y, room.y + room.h - state.player.y));
    out.insideRoom = pointInRect(state.player.x, state.player.y, room);
    var best = Infinity, bestId = null;
    (state.enemies || []).forEach(function(e){
      if (!e || e.dead || e.hp <= 0) return;
      var d = Math.hypot(e.x - state.player.x, e.y - state.player.y);
      if (d < best) { best = d; bestId = e.roomId; }
    });
    out.nearestEnemy = isFinite(best) ? Math.round(best) : null;
    out.nearestEnemyRoom = bestId;
  }
  return out;
})()`;

/**
 * 主流程
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { edge, ws, send, ev, shot, click } = await connect();
  const report = { file: FILE, tag: TAG, at: new Date().toISOString(), checks: {} };
  try {
    await send('Page.navigate', { url: pathToFileURL(FILE).href });
    for (let i = 0; i < 80; i += 1) {
      const ok = await ev(`(function(){ var t=document.getElementById('titleLayer'); return document.readyState==='complete' && typeof state!=='undefined' && !!t && !t.classList.contains('hidden'); })()`);
      if (ok) break;
      await sleep(200);
    }
    await ev(`document.getElementById('btnStart').click()`);
    await sleep(350);
    await ev(`document.querySelector('#charGrid .char-card').click()`);
    await sleep(200);
    await ev(`document.getElementById('btnCharConfirm').click()`);
    for (let i = 0; i < 40; i += 1) { if ((await ev(`state.mode`)) === 'playing') break; await sleep(100); }
    await sleep(500);
    await ev(`(function(){ state.seedInfo = { active: true, value: 'TPVERIFY' }; generateFloor(1); return state.floor; })()`);
    await sleep(500);
    await ev(`(function(){ if (typeof snapCamera === 'function') snapCamera(); return true; })()`);
    await sleep(350);

    /* 1) 找一个与出生房相邻、且当前没锁的房 */
    const pick = await ev(`(function(){
      var cur = state.currentRoomId;
      var cand = [];
      (state.doors || []).forEach(function(d){
        var t = d.roomId === cur ? d.targetRoomId : (d.targetRoomId === cur ? d.roomId : -1);
        if (t < 0 || t === cur) return;
        if (state.rooms[t].locked) return;
        if (cand.indexOf(t) < 0) cand.push(t);
      });
      return { cur: cur, cand: cand, types: cand.map(function(id){ return state.rooms[id].type; }) };
    })()`);
    report.pick = pick;
    const targetId = pick.cand[0];

    await shot(`teleport-${TAG}-select.png`);
    const before = await ev(RESULT_EXPR);
    report.before = before;

    const pt = await ev(pickClickPointExpr(targetId));
    report.clickPoint = pt;
    if (pt.__err) throw new Error('点击点不可用：' + pt.__err);
    await click(pt.x, pt.y);
    await sleep(120);
    const midFade = await ev(`(function(){ return { active: sceneFadeRuntime.active, mode: sceneFadeRuntime.lastMode,
      target: sceneFadeRuntime.lastTarget, dur: sceneFadeRuntime.lastDur, opacity: Number(sceneFadeRuntime.lastPeak||0) }; })()`);
    report.midFade = midFade;
    await sleep(600);
    const after = await ev(RESULT_EXPR);
    report.after = after;
    await shot(`teleport-${TAG}-arrived.png`);

    report.checks.roomChanged = before.roomId !== after.roomId && after.roomId === targetId;
    report.checks.insideRoom = !!after.insideRoom;
    report.checks.wallGapOk = after.wallGap >= 20;
    /* 贴脸判定要用"落地瞬间"的读数：0.6s 后怪已经追到身边，那是 AI 行为不是落点问题 */
    const landStats = (after.stats && after.stats.last) || {};
    report.checks.enemyGapOk = landStats.nearestEnemyAtLanding == null
      || landStats.nearestEnemyAtLanding >= 110;
    report.checks.wallGapAtLandingOk = (landStats.wallGapAtLanding || 0) >= 20;
    report.checks.fadeUsed = !!(midFade && midFade.mode === 'room' && Math.abs(Number(midFade.dur) - 0.28) < 0.01);
    report.checks.teleportCounted = !!(after.stats && after.stats.count >= 1);

    /* 2) 清完才能选：往目标房塞一只活怪，再点另一间房 → 应被拒 */
    const blocked = await ev(`(function(){
      var cur = state.currentRoomId;
      var room = state.rooms[cur];
      var other = -1;
      (state.doors || []).forEach(function(d){
        var t = d.roomId === cur ? d.targetRoomId : (d.targetRoomId === cur ? d.roomId : -1);
        if (t >= 0 && t !== cur && other < 0 && !state.rooms[t].locked) other = t;
      });
      if (other < 0) return { __err: 'no-other-room' };
      state.enemies.push({ x: state.player.x + 40, y: state.player.y + 10, roomId: cur,
        hp: 100, hpMax: 100, radius: 14, dead: false, type: 'runt' });
      var countBefore = ROOM_TELEPORT_STATS.blocked;
      var tr = state.rooms[other];
      /* 复用同一个"找画布空闲点"的算法，避免点到 HUD 面板上 */
      var cv = document.getElementById('game');
      var rect = cv.getBoundingClientRect();
      var kx = rect.width / cv.width, ky = rect.height / cv.height;
      var z = cameraZoom();
      var p = null;
      for (var i = 1; i <= 7 && !p; i += 1) {
        for (var j = 1; j <= 7 && !p; j += 1) {
          var wx = tr.x + tr.w * i / 8, wy = tr.y + tr.h * j / 8;
          var q = { x: rect.x + (wx - state.cam.x) * z * kx, y: rect.y + (wy - state.cam.y) * z * ky };
          if (q.x < 8 || q.y < 8 || q.x > innerWidth - 8 || q.y > innerHeight - 8) continue;
          var el = document.elementFromPoint(q.x, q.y);
          if (!el || el.id !== 'game') continue;
          p = { x: Math.round(q.x), y: Math.round(q.y) };
        }
      }
      if (!p) return { __err: 'no-free-point' };
      return { other: other, p: p, onCanvas: true, blockedBefore: countBefore };
    })()`);
    report.blockedSetup = blocked;
    if (!blocked.__err && blocked.onCanvas) {
      await click(blocked.p.x, blocked.p.y);
      await sleep(400);
      report.blockedAfter = await ev(`(function(){ return { roomId: state.currentRoomId,
        blocked: ROOM_TELEPORT_STATS.blocked, count: ROOM_TELEPORT_STATS.count,
        toast: (document.querySelector('.toast, #toastLayer') || {}).textContent || '' }; })()`);
      report.checks.blockedWhileEnemiesAlive = report.blockedAfter.blocked > blocked.blockedBefore
        && report.blockedAfter.roomId === report.after.roomId;
    }

    report.verdict = ['roomChanged', 'insideRoom', 'wallGapOk', 'wallGapAtLandingOk', 'enemyGapOk',
      'fadeUsed', 'teleportCounted', 'blockedWhileEnemiesAlive']
      .every((k) => report.checks[k] === true) ? 'PASS' : 'FAIL';
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.error = String(error && error.message || error);
    console.error(report.error);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(OUT, `teleport-${TAG}.json`), JSON.stringify(report, null, 2));
    try { ws.close(); } catch (e) { /* 忽略 */ }
    try { killEdge(edge); } catch (e) { /* 忽略 */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
