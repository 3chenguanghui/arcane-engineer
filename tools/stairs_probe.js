/**
 * 只读探针：复现"清层后地图上楼梯标记不可见"
 * ------------------------------------------------------------
 * 不改主文件，只做三件事：
 *   1) 走真实点击开局（开始 → 选角色 → 确认）
 *   2) 记录清层前的楼梯可见条件（floorCleared / stairs / 楼梯房是否已探索）
 *   3) 用 debug 口 killAllEnemies 触发真实的 killEnemy → checkFloorClear 链，
 *      再读清层后的条件与两张地图（小地图 / 全屏地图）的像素统计
 *
 * 用法：node tools/stairs_probe.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, '.screenshots', 'firstplay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log('[probe] ' + m);

/** 建连并打开游戏页（沿用现有探针的启动参数） */
async function connect() {
  const port = 10980 + Math.floor(Math.random() * 60);
  const profile = prepareProfile();
  const edge = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1440,900', '--force-device-scale-factor=1',
    'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page') || null;
    } catch (e) { /* 等端口 */ }
    if (!target) await sleep(250);
  }
  if (!target) { try { killEdge(edge); } catch (e) { /* 忽略 */ } throw new Error('调试端口未就绪'); }
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
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) params.clip = Object.assign({ scale: 1 }, clip);
    const r = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  return { edge, ws, send, ev, shot };
}

/** 走完整开局流程：点开始 → 选角色 → 确认 */
async function startGame(ev) {
  for (let i = 0; i < 80; i += 1) {
    const ok = await ev(`(function(){ var t=document.getElementById('titleLayer'); return document.readyState==='complete' && typeof state!=='undefined' && !!t && !t.classList.contains('hidden'); })()`);
    if (ok) break;
    await sleep(200);
  }
  await ev(`document.getElementById('btnStart').click()`);
  await sleep(400);
  await ev(`document.querySelector('#charGrid .char-card').click()`);
  await sleep(250);
  await ev(`document.getElementById('btnCharConfirm').click()`);
  for (let i = 0; i < 50; i += 1) { if ((await ev(`state.mode`)) === 'playing') break; await sleep(100); }
  await sleep(800);
}

const STATE_EXPR = `(function(){
  var fog = state.fog || {seenRooms:{}, seenCorridors:{}};
  var stairRoom = null;
  if (state.rooms && state.stairs) {
    var best = Infinity;
    state.rooms.forEach(function(r){
      var d = Math.hypot(r.cx - state.stairs.x, r.cy - state.stairs.y);
      if (d < best) { best = d; stairRoom = r; }
    });
  }
  var roomEnemies = state.enemies.filter(function(e){ return e.roomId >= 0; });
  return {
    mode: state.mode, status: state.status, floor: state.floor,
    floorCleared: !!state.floorCleared,
    stairRoomId: state.stairRoomId,
    stairs: state.stairs ? {x: Math.round(state.stairs.x), y: Math.round(state.stairs.y), active: !!state.stairs.active} : null,
    stairRoom: stairRoom ? {
      id: stairRoom.id, type: stairRoom.type, cleared: !!stairRoom.cleared,
      seen: !!fog.seenRooms[stairRoom.id],
      cx: Math.round(stairRoom.cx), cy: Math.round(stairRoom.cy), w: stairRoom.w, h: stairRoom.h
    } : null,
    rooms: (state.rooms || []).map(function(r){
      return { id: r.id, type: r.type, cleared: !!r.cleared, seen: !!fog.seenRooms[r.id] };
    }),
    enemies: state.enemies.length,
    roomEnemies: roomEnemies.length,
    boss: state.boss ? { roomId: state.boss.roomId, hp: Math.round(state.boss.hp), defeated: !!state.boss.defeated, started: !!state.boss.started } : null,
    isStairsSeen: (typeof isStairsSeen === 'function') ? isStairsSeen() : null,
    openFloor: !!(state.openFloor && state.openFloor.active)
  };
})()`;

/**
 * 统计指定画布上"金色楼梯色"的像素数量与位置范围
 * @param {string} canvasId 画布 id（minimap / mapCanvas）
 * @returns {Object} 统计结果
 */
const PIXEL_EXPR = (canvasId) => `(function(){
  var cv = document.getElementById('${canvasId}');
  if (!cv) return null;
  var g = cv.getContext('2d');
  var img = g.getImageData(0, 0, cv.width, cv.height).data;
  var count = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (var y = 0; y < cv.height; y += 1) {
    for (var x = 0; x < cv.width; x += 1) {
      var i = (y * cv.width + x) * 4;
      var r = img[i], gg = img[i + 1], b = img[i + 2], a = img[i + 3];
      // 金色 #ffc247 附近（宽容度覆盖描边/抗锯齿）
      if (a > 120 && r > 215 && gg > 160 && gg < 225 && b < 130) {
        count += 1;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { canvas: '${canvasId}', w: cv.width, h: cv.height, goldPx: count,
    bbox: count ? {x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1} : null };
})()`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { edge, ws, send, ev, shot } = await connect();
  const out = {};
  try {
    log('打开游戏页');
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    await sleep(2200);
    await startGame(ev);
    log('已进入 playing');

    out.before = await ev(STATE_EXPR);
    log('清层前：' + JSON.stringify({ floorCleared: out.before.floorCleared, stairRoom: out.before.stairRoom, boss: out.before.boss, enemies: out.before.enemies }));
    out.minimapBefore = await ev(PIXEL_EXPR('minimap'));
    out.fullmapBefore = await ev(PIXEL_EXPR('mapCanvas'));
    await ev(`drawMinimap()`);
    await shot('stairs-00-before.png');

    log('killAllEnemies()（内部走 killEnemy → checkFloorClear 真实链）');
    out.killResult = await ev(`(function(){ try { return { left: window.__roamDebug.killAllEnemies() }; } catch (e) { return { err: String(e && e.message || e) }; } })()`);
    await sleep(900);
    out.after = await ev(STATE_EXPR);
    log('清层后：' + JSON.stringify({ floorCleared: out.after.floorCleared, stairRoom: out.after.stairRoom, boss: out.after.boss, isStairsSeen: out.after.isStairsSeen }));
    // 强制重画两张图，再统计金色像素
    await ev(`(function(){ try { drawMinimap(); drawFullMap(); } catch (e) { return String(e); } return true; })()`);
    await sleep(200);
    out.minimapAfter = await ev(PIXEL_EXPR('minimap'));
    out.fullmapAfter = await ev(PIXEL_EXPR('mapCanvas'));
    await shot('stairs-01-after.png');

    // 小地图面板区域截图（右侧栏）
    const box = await ev(`(function(){ var el = document.querySelector('.minimap-panel'); if (!el) return null; var r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)}; })()`);
    if (box) await shot('stairs-02-minimap-panel.png', box);

    // 打开全屏地图并截图
    const opened = await ev(`(function(){ var b = document.getElementById('btnMapDock'); if (b) { b.click(); return true; } return false; })()`);
    await sleep(500);
    const mapBox = await ev(`(function(){ var el = document.getElementById('mapPanel') || document.querySelector('.map-layer'); if (!el) return null; var r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), cls: el.className}; })()`);
    out.mapOpened = opened;
    out.mapBox = mapBox;
    await shot('stairs-03-fullmap.png');
  } finally {
    try { ws.close(); } catch (e) { /* 忽略 */ }
    try { killEdge(edge); } catch (e) { /* 忽略 */ }
  }
  fs.writeFileSync(path.join(OUT, 'stairs-probe.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
