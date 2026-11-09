/**
 * B 自由探索层验收：A0–A10
 * 用法：node tools/arcane_openfloor.js
 * 端口：9522
 * 输出：.screenshots/art/openfloor.png、openfloor-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9522;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言并打印证据
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
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
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1300);
  await ev(`window.__errors = []; true`);

  // ---------- A0 配置 ----------
  const a0 = await ev(`window.__roamDebug.openFloor.info()`);
  ok('A0 配置默认值（every=3 / 7–9 房 / 1–2 钥匙 / 三种钥匙房型）',
    a0.enabled === true && a0.config.every === 3 && a0.config.minRooms === 7
      && a0.config.maxRooms === 9 && a0.config.keysMin === 1 && a0.config.keysMax === 2
      && a0.config.keyTypes.join(',') === 'chest,event,elite', a0.config);

  // ---------- A1 哪些层是开放层 ----------
  const a1 = await ev(`(function(){
    var out = {};
    [1, 2, 3, 4, 5, 6].forEach(function(n){
      window.__roamDebug.openFloor.setFloor(n);
      out[n] = { active: !!state.openFloor.active, rooms: state.rooms.length };
    });
    return out;
  })()`);
  ok('A1 第 3/6 层开放，第 1/2/4/5 层不开放',
    a1['3'].active === true && a1['6'].active === true
      && a1['1'].active === false && a1['2'].active === false
      && a1['4'].active === false && a1['5'].active === false, a1);

  // ---------- A2 开放层房间数 ----------
  const a2 = await ev(`(function(){
    window.__roamDebug.openFloor.setFloor(3);
    return { rooms: state.rooms.length, gen: state.floorGen, open: window.__roamDebug.openFloor.info() };
  })()`);
  ok('A2 开放层房间数 7–9（未走线性兜底）',
    a2.rooms >= 7 && a2.rooms <= 9 && a2.open.state.active === true
      && (!a2.gen || a2.gen.fallback === false), a2);

  // ---------- A3 楼梯房 / 钥匙房 ----------
  const a3 = await ev(`(function(){
    var info = window.__roamDebug.openFloor.info();
    var stairRooms = state.rooms.filter(function(r){ return r.id !== state.spawnRoomId && !r.hasKey; });
    var cfg = ROOM_TYPE_CONFIG.types;
    var badType = info.keyRooms.filter(function(k){
      return k.type !== 'chest' && k.type !== 'event' && k.type !== 'elite';
    });
    return { stairType: state.rooms[state.stairs ? (function(){
      for (var i = 0; i < state.rooms.length; i += 1) {
        var r = state.rooms[i];
        if (Math.abs(r.cx - state.stairs.x) < 1 && Math.abs(r.cy - state.stairs.y) < 1) return r.id;
      }
      return -1;
    })() : -1].type,
      keys: info.keyRooms, keysNeeded: info.state.keysNeeded, badType: badType,
      rooms: state.rooms.length, hasBoss: state.rooms.some(function(r){ return r.type === 'boss'; }) };
  })()`);
  ok('A3 楼梯房仍是 boss（首领内容不缺席）；钥匙房 1–2 间且房型 ∈ 宝箱/事件/精英',
    a3.stairType === 'boss' && a3.hasBoss === true
      && a3.keysNeeded >= 1 && a3.keysNeeded <= 2 && a3.keys.length === a3.keysNeeded
      && a3.badType.length === 0, a3);

  // ---------- A4 初始锁楼梯：按 E 被拒 ----------
  const a4 = await ev(`(function(){
    state.player.x = state.stairs.x; state.player.y = state.stairs.y;
    state.player.vx = 0; state.player.vy = 0;
    snapCamera();
    var before = state.floor;
    var result = interactStairs();
    return { before: before, after: state.floor, result: result,
      locked: state.openFloor.stairsLocked,
      toast: (state.toasts && state.toasts.length) ? state.toasts[state.toasts.length - 1].text : null };
  })()`);
  ok('A4 初始楼梯锁：在楼梯旁按 E 被拒，楼层不变',
    a4.locked === true && a4.result === false && a4.before === a4.after, a4);

  // ---------- A5 钥匙齐 → 解锁 ----------
  const a5 = await ev(`(function(){
    var before = window.__roamDebug.openFloor.info();
    window.__roamDebug.openFloor.collectAll();
    var after = window.__roamDebug.openFloor.info();
    return { before: before.state, after: after.state,
      unlocksBefore: before.stats.unlocks, unlocksAfter: after.stats.unlocks };
  })()`);
  ok('A5 收齐钥匙后 stairsLocked=false、keysFound=keysNeeded、unlocks +1',
    a5.after.keysFound === a5.after.keysNeeded && a5.after.stairsLocked === false
      && a5.unlocksAfter === a5.unlocksBefore + 1, a5);

  // ---------- A6 解锁后下楼；到第 4 层恢复普通规则 ----------
  await ev(`(function(){
    state.player.x = state.stairs.x; state.player.y = state.stairs.y;
    state.player.vx = 0; state.player.vy = 0; snapCamera(); return true;
  })()`);
  const a6descend = await ev(`(function(){ return { result: interactStairs(), floor: state.floor }; })()`);
  await sleep(900);
  const a6 = await ev(`(function(){
    return { floor: state.floor, open: window.__roamDebug.openFloor.info(),
      hasBoss: state.rooms.some(function(r){ return r.type === 'boss'; }),
      floorGen: state.floorGen };
  })()`);
  ok('A6 解锁后按 E 成功下楼；第 4 层非开放且恢复 boss 楼梯',
    a6descend.result === true && a6.floor === 4 && a6.open.state.active === false
      && a6.hasBoss === true, { descend: a6descend, after: a6 });

  // ---------- A7 开放层不落闸 ----------
  await ev(`window.__roamDebug.openFloor.setFloor(3)`);
  const a7 = await ev(`(function(){
    var combat = state.rooms.filter(function(r){
      var t = ROOM_TYPE_CONFIG.types[r.type] || ROOM_TYPE_CONFIG.types.battle;
      return t.count[1] > 0 && r.id !== state.spawnRoomId;
    })[0];
    if (!combat) return { room: null };
    state.player.x = combat.cx; state.player.y = combat.cy;
    state.player.vx = 0; state.player.vy = 0;
    snapCamera();
    return { room: { id: combat.id, type: combat.type, w: combat.w, h: combat.h } };
  })()`);
  await sleep(600);
  const a7after = await ev(`(function(){
    var room = state.rooms[${a7.room ? a7.room.id : 0}];
    var closed = state.doors.filter(function(d){ return d.closed || d.anim > 0.35; }).length;
    return { locked: !!room.locked, closedDoors: closed, enemies: state.enemies.filter(function(e){
      return e.roomId === room.id; }).length };
  })()`);
  ok('A7 开放层进入战斗房中心也不落闸（门保持全开）',
    !!a7.room && a7after.locked === false && a7after.closedDoors === 0,
    { room: a7.room, after: a7after });

  // ---------- A8 迷雾：未探索房留黑 ----------
  const a8 = await ev(`(function(){
    window.__roamDebug.openFloor.setFloor(3);
    var seen = Object.keys(state.fog.seenRooms).length;
    var total = state.rooms.length;
    return { seen: seen, total: total, unseen: total - seen,
      fogApi: window.__roamDebug.getState().fog };
  })()`);
  ok('A8 开放层开局至少 1 间房未探索（小地图留黑）',
    a8.total >= 7 && a8.unseen >= 1 && a8.seen >= 1, a8);

  // ---------- A9 钥匙房门板信息 ----------
  const a9 = await ev(`(function(){
    var info = window.__roamDebug.openFloor.info();
    var key = info.keyRooms[0];
    if (!key) return null;
    var room = state.rooms[key.id];
    room.visited = true;   // 模拟已探测
    var door = state.doors.filter(function(d){ return d.targetRoomId === room.id; })[0];
    var dinfo = door ? doorInfoFor(door) : null;
    return { key: key, door: !!door, info: dinfo };
  })()`);
  ok('A9 已探测钥匙房：门板 tip 写成"钥匙 · 必得一把"',
    !!a9 && !!a9.door && !!a9.info && a9.info.keyRoom === true
      && a9.info.tip.indexOf('钥匙') >= 0, a9);

  // ---------- A10 A/B 开关 ----------
  const a10 = await ev(`(function(){
    window.__roamDebug.openFloor.setEnabled(false);
    window.__roamDebug.openFloor.setFloor(3);
    var off = window.__roamDebug.openFloor.info();
    var offRooms = state.rooms.length;
    window.__roamDebug.openFloor.setEnabled(true);
    window.__roamDebug.openFloor.setFloor(3);
    var on = window.__roamDebug.openFloor.info();
    return { off: off.state, offRooms: offRooms, on: on.state };
  })()`);
  ok('A10 A/B：enabled=false 时第 3 层不开放；恢复后重新开放',
    a10.off.active === false && a10.offRooms <= 7 && a10.on.active === true, a10);

  // 截图（开放层 + 楼梯锁提示）
  await ev(`(function(){ state.player.x = state.stairs.x; state.player.y = state.stairs.y;
    snapCamera(); return true; })()`);
  await sleep(500);
  await shot('openfloor.png');

  // ---------- A11 fps / 错误 / 截图 ----------
  const a11 = await ev(`(function(){
    var fps = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return fps.then(function(f){ return { fps: f, errors: (window.__errors || []).length }; });
  })()`);
  let shotSize = 0;
  try { shotSize = fs.statSync(path.join(OUT_DIR, 'openfloor.png')).size; } catch (e) { shotSize = 0; }
  ok('A11 截图 >10KB / fps≥60 / 无脚本错误',
    shotSize > 10240 && a11.fps >= 60 && a11.errors === 0, { shot: shotSize, a11 });

  fs.writeFileSync(path.join(OUT_DIR, 'openfloor-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log(`\n===== B open floor ${pass}/${asserts.length} ===== (shot ${shotSize}B, fps ${a11.fps})`);

  try { ws.close(); } catch (e) { /* ignore */ }
  try { killEdge(edge); } catch (e) { /* ignore */ }
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  if (pass !== asserts.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
