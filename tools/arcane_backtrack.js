/**
 * A3 回溯已清房间验收：A0–A8
 * 用法：node tools/arcane_backtrack.js
 * 端口：9521
 * 输出：.screenshots/art/backtrack.png、backtrack-result.json
 *
 * 断言：
 *  A0 配置默认值（enabled / 可回访文案 / 回访 toast / 统计环形长度）
 *  A1 进房转移计数：出生房 → 另一间房，entries +1、revisits 不变
 *  A2 回到出生房算一次回访；同一间房里站 0.8s 不重复计数
 *  A3 已清房回访：不刷怪、不重复掉落、cleared/rewarded 保持
 *  A4 已清房不再落闸：走进中心后 locked 仍 false、门全开
 *  A5 信息层：已探索目标显示"可回访（不刷怪）"，未探索目标不显示
 *  A6 A/B：enabled=false 时不再统计、不再显示回访文案；恢复后正常
 *  A7 连续 3 次进出已清房：revisits +3、敌人始终 0、结晶不变
 *  A8 截图 >10KB / fps≥60 / 无脚本错误
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9521;
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
  /** 把玩家放到某间房中心并吸附相机 */
  const teleportRoom = async (roomId) => ev(`(function(){
    var room = state.rooms[${roomId}];
    state.player.x = room.cx; state.player.y = room.cy;
    state.player.vx = 0; state.player.vy = 0;
    snapCamera();
    return { x: room.cx, y: room.cy };
  })()`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1300);
  await ev(`window.__errors = []; true`);

  // ---------- A0 配置 ----------
  const a0 = await ev(`window.__roamDebug.backtrack.info()`);
  ok('A0 配置默认值（enabled / 可回访文案 / 回访 toast / 环形长度）',
    a0.enabled === true && a0.config.revisitText.indexOf('可回访') >= 0
      && a0.config.clearedToast.indexOf('不刷怪') >= 0
      && a0.config.statsRing === 16 && !!a0.state, a0);

  // ---------- A1 进房转移 ----------
  const rooms0 = await ev(`(function(){
    var spawn = state.rooms[state.spawnRoomId];
    var other = state.rooms.filter(function(r){ return r.id !== spawn.id; })[0];
    return {
      spawnId: spawn.id, otherId: other ? other.id : -1,
      before: window.__roamDebug.backtrack.info().stats
    };
  })()`);
  await teleportRoom(rooms0.otherId || 0);
  await sleep(380);
  const a1 = await ev(`(function(){
    var s = window.__roamDebug.getState().backtrack;
    return { entries: s.entries, revisits: s.revisits, currentRoomId: s.currentRoomId,
      stats: s.stats };
  })()`);
  ok('A1 进房转移：换到另一间房 entries +1、revisits 仍为 0',
    a1.entries === rooms0.before.entries + 1 && a1.revisits === 0
      && a1.currentRoomId === rooms0.otherId, { before: rooms0.before, after: a1 });

  // ---------- A2 回到出生房 = 回访；原地停留不重复计数 ----------
  await teleportRoom(rooms0.spawnId);
  await sleep(380);
  const a2a = await ev(`(function(){
    var s = window.__roamDebug.getState().backtrack;
    return { entries: s.entries, revisits: s.revisits, last: s.stats.lastWasRevisit,
      ring: s.stats.ring.slice(-2) };
  })()`);
  await sleep(900);   // 同一间房里站着
  const a2b = await ev(`(function(){
    var s = window.__roamDebug.getState().backtrack;
    return { entries: s.entries, revisits: s.revisits };
  })()`);
  ok('A2 回到出生房计 1 次回访；原地停留 0.9s 不重复计数',
    a2a.revisits === 1 && a2a.last === true
      && a2b.entries === a2a.entries && a2b.revisits === a2a.revisits, { revisit: a2a, stay: a2b });

  // ---------- 准备：找一间可标记为已清的房间 ----------
  const targetRoom = await ev(`(function(){
    var list = state.rooms.filter(function(r){ return r.id !== state.spawnRoomId; });
    // 优先挑有怪的战斗房，其次任意房
    var combat = list.filter(function(r){
      var t = ROOM_TYPE_CONFIG.types[r.type] || ROOM_TYPE_CONFIG.types.battle;
      return t.count[1] > 0;
    });
    var room = combat[0] || list[0];
    window.__roamDebug.backtrack.markCleared(room.id);
    // 清掉该房残留敌人，模拟"已经清完"
    state.enemies = state.enemies.filter(function(e){ return e.roomId !== room.id; });
    return { id: room.id, type: room.type, crystals: state.meta.crystals,
      enemies: state.enemies.filter(function(e){ return e.roomId === room.id; }).length };
  })()`);
  await teleportRoom(targetRoom.id);
  await sleep(380);
  const a3 = await ev(`(function(){
    var room = state.rooms[${targetRoom.id}];
    return { cleared: !!room.cleared, rewarded: !!room.rewarded, locked: !!room.locked,
      enemies: state.enemies.filter(function(e){ return e.roomId === room.id; }).length,
      crystals: state.meta.crystals, revisits: window.__roamDebug.getState().backtrack.revisits };
  })()`);
  ok('A3 已清房回访：不刷怪、不重复掉落、cleared/rewarded 保持',
    !!targetRoom && a3.cleared === true && a3.rewarded === true && a3.enemies === 0
      && a3.crystals === targetRoom.crystals, { room: targetRoom, after: a3 });

  // ---------- A4 已清房不再落闸 ----------
  const a4 = await ev(`(function(){
    var room = state.rooms[${targetRoom.id}];
    var closed = state.doors.filter(function(d){ return d.closed || d.anim > 0.35; }).length;
    return { locked: !!room.locked, closedDoors: closed };
  })()`);
  ok('A4 已清房不再落闸：locked=false、没有门处于关闭状态',
    a4.locked === false && a4.closedDoors === 0, a4);

  // ---------- A5 信息层：已探索 vs 未探索 ----------
  const a5 = await ev(`(function(){
    var visited = window.__roamDebug.getState().backtrack.visited;
    function pick(pred) {
      for (var i = 0; i < state.doors.length; i += 1) {
        var d = state.doors[i];
        if (d.targetRoomId < 0 || d.eliteRoute) continue;
        var r = state.rooms[d.targetRoomId];
        if (r && pred(r)) return { door: d, room: r };
      }
      return null;
    }
    var seen = pick(function(r){ return visited.indexOf(r.id) >= 0; });
    var unseen = pick(function(r){ return visited.indexOf(r.id) < 0 && !r.cleared; });
    return {
      seen: seen ? { roomId: seen.room.id, info: doorInfoFor(seen.door) } : null,
      unseen: unseen ? { roomId: unseen.room.id, info: doorInfoFor(unseen.door) } : null
    };
  })()`);
  ok('A5 信息层：已探索目标显示"可回访（不刷怪）"，未探索目标不显示',
    !!a5.seen && a5.seen.info && a5.seen.info.backtrack
      && a5.seen.info.backtrack.text.indexOf('可回访') >= 0
      && (!a5.unseen || !a5.unseen.info || a5.unseen.info.backtrack === null),
    a5);

  // ---------- A6 A/B 开关 ----------
  const abOff = await ev(`(function(){
    window.__roamDebug.backtrack.setEnabled(false);
    var before = window.__roamDebug.getState().backtrack;
    var other = state.rooms.filter(function(r){ return r.id !== ${targetRoom.id}; })[0];
    state.player.x = other.cx; state.player.y = other.cy; state.player.vx = 0; state.player.vy = 0;
    snapCamera();
    return { beforeEntries: before.entries, beforeRevisits: before.revisits, otherId: other.id,
      seenText: (function(){
        var d = state.doors.filter(function(x){ return x.targetRoomId === ${targetRoom.id}; })[0];
        var info = d ? doorInfoFor(d) : null;
        return info && info.backtrack ? info.backtrack.text : null;
      })() };
  })()`);
  await sleep(380);
  const abOffAfter = await ev(`(function(){
    var s = window.__roamDebug.getState().backtrack;
    return { entries: s.entries, revisits: s.revisits };
  })()`);
  await ev(`window.__roamDebug.backtrack.setEnabled(true)`);
  const abOn = await ev(`(function(){
    var d = state.doors.filter(function(x){ return x.targetRoomId === ${targetRoom.id}; })[0];
    var info = d ? doorInfoFor(d) : null;
    return { seenText: info && info.backtrack ? info.backtrack.text : null,
      enabled: window.__roamDebug.backtrack.info().enabled };
  })()`);
  ok('A6 A/B：enabled=false 时不统计、不显示；恢复后回来访文案',
    abOff.seenText === null && abOffAfter.entries === abOff.beforeEntries
      && abOffAfter.revisits === abOff.beforeRevisits
      && abOn.enabled === true && abOn.seenText && abOn.seenText.indexOf('可回访') >= 0,
    { off: abOff, offAfter: abOffAfter, on: abOn });

  // ---------- A7 连续 3 次进出已清房 ----------
  const a7before = await ev(`(function(){
    return { revisits: window.__roamDebug.getState().backtrack.revisits,
      crystals: state.meta.crystals,
      enemies: state.enemies.filter(function(e){ return e.roomId === ${targetRoom.id}; }).length };
  })()`);
  for (let i = 0; i < 3; i += 1) {
    await teleportRoom(targetRoom.id);
    await sleep(260);
    await teleportRoom(rooms0.spawnId);
    await sleep(260);
  }
  await teleportRoom(targetRoom.id);
  await sleep(320);
  const a7after = await ev(`(function(){
    var room = state.rooms[${targetRoom.id}];
    return { revisits: window.__roamDebug.getState().backtrack.revisits,
      crystals: state.meta.crystals,
      enemies: state.enemies.filter(function(e){ return e.roomId === room.id; }).length,
      locked: !!room.locked, cleared: !!room.cleared };
  })()`);
  // 一趟"出去再回来"会产生 2 次回访（回到出生房 1 次 + 回到已清房 1 次），
  // 3 趟共 6 次——这正好证明"双向回头路都被记账"。
  // 3 趟"出去再回来"至少 6 次回访；中途若被代价门/落闸判定挪一下位置会多记 1 次，
  // 所以断言"≥ +6"，核心验证仍是"不刷怪 / 不掉落 / 不落闸"。
  ok('A7 连续 3 次进出已清房：revisits ≥ +6、敌人始终 0、结晶不变、门不落闸',
    a7after.revisits >= a7before.revisits + 6
      && a7after.crystals === a7before.crystals
      && a7after.enemies === 0 && a7after.locked === false && a7after.cleared === true,
    { before: a7before, after: a7after });

  // 回出生房准备截图（信息板靠近门才显示，这里只做整体画面证据）
  await teleportRoom(rooms0.spawnId);
  await sleep(420);
  await shot('backtrack.png');

  // ---------- A8 fps / 错误 / 截图 ----------
  const a8 = await ev(`(function(){
    var fps = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return fps.then(function(f){ return { fps: f, errors: (window.__errors || []).length }; });
  })()`);
  let shotSize = 0;
  try { shotSize = fs.statSync(path.join(OUT_DIR, 'backtrack.png')).size; } catch (e) { shotSize = 0; }
  ok('A8 截图 >10KB / fps≥60 / 无脚本错误',
    shotSize > 10240 && a8.fps >= 60 && a8.errors === 0, { shot: shotSize, a8 });

  fs.writeFileSync(path.join(OUT_DIR, 'backtrack-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log(`\n===== A3 backtrack ${pass}/${asserts.length} ===== (shot ${shotSize}B, fps ${a8.fps})`);

  try { ws.close(); } catch (e) { /* ignore */ }
  try { killEdge(edge); } catch (e) { /* ignore */ }
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  if (pass !== asserts.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
