/**
 * 选房/传送 整改探针（只读，不改游戏文件）
 * ------------------------------------------------------------
 * 用途：
 *   1) 截"选房界面"现状图（玩家站在出生房，能看到相邻房门牌）；
 *   2) 截"整层俯瞰"图（临时把相机拉远，5 间房同屏），用于核对黑矩形与出入口数量；
 *   3) 导出几何数据：房间矩形/房型、门总数、每间房每面墙的门数、走廊矩形。
 *
 * 用法：node tools/select_probe.js [tag]
 * 输出：.screenshots/firstplay/select-<tag>-view.png / select-<tag>-fit.png / select-<tag>.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = path.resolve(process.argv[3] || path.join(__dirname, '..', 'index_arcane_v2.html'));
const TAG = process.argv[2] || 'before';
const OUT = path.resolve(__dirname, '..', '.screenshots', 'firstplay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 建连并打开游戏页（沿用 door_audit.js 的无头 Edge 启动方式）
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
  return { edge, ws, send, ev, shot };
}

/**
 * 俯视整层：临时拉远相机 + 相机不 lerp，保证 5 间房同屏
 * @returns {string} 可注入表达式
 */
const FIT_EXPR = `(function(){
  if (typeof CAMERA_DISTANCE_CONFIG !== 'undefined') {
    window.__fitBackup = { minZoom: CAMERA_DISTANCE_CONFIG.minZoom, zoom: CAMERA_DISTANCE_CONFIG.zoom, enabled: CAMERA_DISTANCE_CONFIG.enabled };
    CAMERA_DISTANCE_CONFIG.enabled = true;
    CAMERA_DISTANCE_CONFIG.minZoom = 0.34;
    CAMERA_DISTANCE_CONFIG.zoom = 0.38;
  }
  if (typeof GAME_CONFIG !== 'undefined') GAME_CONFIG.camLerp = 1000;
  var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  state.rooms.forEach(function(r){
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  });
  var z = cameraZoom();
  var vw = (state.viewW || window.innerWidth) / z;
  var vh = (state.viewH || window.innerHeight) / z;
  state.player.x = (minX + maxX) / 2;
  state.player.y = (minY + maxY) / 2;
  state.cam.x = state.player.x - vw / 2;
  state.cam.y = state.player.y - vh / 2;
  return { zoom: z, cam: { x: Math.round(state.cam.x), y: Math.round(state.cam.y) },
    bounds: { minX: minX, minY: minY, maxX: maxX, maxY: maxY },
    view: { vw: Math.round(vw), vh: Math.round(vh) },
    fits: (maxX - minX) <= vw && (maxY - minY) <= vh };
})()`;

/**
 * 导出几何：房间、门（按房/按面统计）、走廊
 * @returns {string} 可注入表达式
 */
const GEOM_EXPR = `(function(){
  var sideCount = {};
  var perRoom = {};
  (state.doors || []).forEach(function(d){
    var key = d.roomId + ':' + d.side;
    sideCount[key] = (sideCount[key] || 0) + 1;
    if (!perRoom[d.roomId]) perRoom[d.roomId] = { total: 0, sides: {} };
    perRoom[d.roomId].total += 1;
    perRoom[d.roomId].sides[d.side] = (perRoom[d.roomId].sides[d.side] || 0) + 1;
  });
  var pairKey = {};
  (state.doors || []).forEach(function(d){
    var a = Math.min(d.roomId, d.targetRoomId), b = Math.max(d.roomId, d.targetRoomId);
    if (d.targetRoomId < 0) return;
    pairKey[a + '-' + b] = (pairKey[a + '-' + b] || 0) + 1;
  });
  return {
    floor: state.floor,
    rooms: (state.rooms || []).map(function(r){
      var t = ROOM_TYPE_CONFIG.types[r.type] || {};
      return { id: r.id, type: r.type, name: t.name || r.type,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h),
        cx: Math.round(r.cx), cy: Math.round(r.cy),
        cleared: !!r.cleared, locked: !!r.locked, visited: !!r.visited,
        doors: perRoom[r.id] ? perRoom[r.id].total : 0,
        sides: perRoom[r.id] ? perRoom[r.id].sides : {} };
    }),
    doorCount: (state.doors || []).length,
    doors: (state.doors || []).map(function(d){ return { room: d.roomId, side: d.side,
      x: Math.round(d.x), y: Math.round(d.y), to: d.targetRoomId }; }),
    corridors: (state.corridorRects || []).map(function(c, i){ return { i: i, a: c.a, b: c.b,
      x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h), horiz: !!c.horiz }; }),
    corridorCount: (state.corridorRects || []).length,
    pairs: pairKey,
    /* 连通性自检：从出生房中心按 12px 网格洪水填充（只用引擎自己的 pointWalkable） */
    reachable: (function(){
      var start = state.rooms[state.spawnRoomId] || state.rooms[0];
      var step = 12, seen = {}, list = [[Math.round(start.cx), Math.round(start.cy)]], hit = {};
      var guard = 0;
      while (list.length && guard < 200000) {
        guard += 1;
        var p = list.pop();
        var key = p[0] + ',' + p[1];
        if (seen[key]) continue;
        seen[key] = 1;
        if (!isPointWalkable(p[0], p[1])) continue;
        state.rooms.forEach(function(r){ if (pointInRect(p[0], p[1], r)) hit[r.id] = true; });
        list.push([p[0] + step, p[1]], [p[0] - step, p[1]], [p[0], p[1] + step], [p[0], p[1] - step]);
      }
      return { rooms: Object.keys(hit).map(Number).sort(), blocks: Object.keys(seen).length };
    })(),
    world: { w: GAME_CONFIG.worldWidth, h: GAME_CONFIG.worldHeight }
  };
})()`;

/**
 * 在已渲染画布上找"纯黑矩形"：按 8×8 设备像素分块，块内最大通道 ≤6 视为黑块，
 * 再做连通域合并，输出面积 > 2 万设备像素的黑块包围盒（换算成 CSS 像素）。
 * 用来回答"三块纯黑矩形"是迷雾遮蔽还是绘制缺失。
 * @returns {string} 可注入表达式
 */
const BLACK_EXPR = `(function(){
  var cv = document.getElementById('game');
  var rect = cv.getBoundingClientRect();
  var g = cv.getContext('2d');
  var W = cv.width, H = cv.height;
  var img = g.getImageData(0, 0, W, H).data;
  var B = 8, gw = Math.ceil(W / B), gh = Math.ceil(H / B);
  var black = new Uint8Array(gw * gh);
  for (var by = 0; by < gh; by += 1) {
    for (var bx = 0; bx < gw; bx += 1) {
      var mx = 0;
      for (var y = by * B; y < Math.min(H, by * B + B); y += 1) {
        for (var x = bx * B; x < Math.min(W, bx * B + B); x += 1) {
          var i = (y * W + x) * 4;
          var m = Math.max(img[i], img[i + 1], img[i + 2]);
          if (m > mx) mx = m;
          if (mx > 16) { y = 1e9; break; }
        }
      }
      black[by * gw + bx] = mx <= 16 ? 1 : 0;
    }
  }
  // 简易连通域（4 邻）
  var seen = new Uint8Array(gw * gh), out = [];
  for (var k = 0; k < gw * gh; k += 1) {
    if (!black[k] || seen[k]) continue;
    var stack = [k]; seen[k] = 1;
    var x0 = gw, y0 = gh, x1 = -1, y1 = -1, n = 0;
    while (stack.length) {
      var p = stack.pop(); n += 1;
      var px = p % gw, py = (p - px) / gw;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
      var nb = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
      for (var j = 0; j < 4; j += 1) {
        var nx = nb[j][0], ny = nb[j][1];
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        var q = ny * gw + nx;
        if (!black[q] || seen[q]) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    if (n * B * B < 20000) continue;
    var kx = rect.width / W, ky = rect.height / H;
    out.push({ cssX: Math.round(rect.x + x0 * B * kx), cssY: Math.round(rect.y + y0 * B * ky),
      cssW: Math.round((x1 - x0 + 1) * B * kx), cssH: Math.round((y1 - y0 + 1) * B * ky),
      fill: +(n / ((x1 - x0 + 1) * (y1 - y0 + 1))).toFixed(2) });
  }
  out.sort(function(a, b){ return b.cssW * b.cssH - a.cssW * a.cssH; });
  /* 黑块与"未探索房间"的对应：把黑块中心落到哪个房间矩形里就标出来 */
  out.forEach(function(b){
    var cx = b.cssX + b.cssW / 2, cy = b.cssY + b.cssH / 2;
    var wx = (cx - rect.x) / (rect.width / W) / cameraZoom() + state.cam.x;
    var wy = (cy - rect.y) / (rect.height / H) / cameraZoom() + state.cam.y;
    var room = null;
    state.rooms.forEach(function(r){ if (pointInRect(wx, wy, r)) room = r; });
    if (room) { b.roomId = room.id; b.roomType = room.type; b.roomSeen = !!state.fog.seenRooms[room.id]; }
  });
  return { blocks: out.slice(0, 8), player: { x: Math.round(state.player.x), y: Math.round(state.player.y) } };
})()`;

const MARK_EXPR = `(function(){
  var cv = document.getElementById('game');
  var rect = cv.getBoundingClientRect();
  var kx = rect.width / cv.width, ky = rect.height / cv.height;
  var z = cameraZoom();
  var sx = function(x){ return rect.x + (x - state.cam.x) * z * kx; };
  var sy = function(y){ return rect.y + (y - state.cam.y) * z * ky; };
  var old = document.getElementById('__probeMark'); if (old) old.remove();
  var ov = document.createElement('div');
  ov.id = '__probeMark';
  ov.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99998;';
  function tag(x, y, text, color){
    var el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;white-space:nowrap;'
      + 'font:bold 13px/18px "Microsoft YaHei UI",sans-serif;color:#07121c;background:' + color
      + ';padding:1px 5px;border-radius:3px;';
    ov.appendChild(el);
  }
  state.rooms.forEach(function(r){
    var box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:' + sx(r.x) + 'px;top:' + sy(r.y) + 'px;width:'
      + (r.w * z * kx) + 'px;height:' + (r.h * z * ky) + 'px;border:2px solid #22d3ee;box-sizing:border-box;';
    ov.appendChild(box);
    var seen = !!(state.fog && state.fog.seenRooms[r.id]);
    tag(sx(r.x) + 2, sy(r.y) + 2, '#' + r.id + ' ' + r.type + (seen ? ' 已探索' : ' 未探索'), seen ? '#7dd3fc' : '#f87171');
  });
  document.body.appendChild(ov);
  return { ok: true, cam: { x: Math.round(state.cam.x), y: Math.round(state.cam.y) }, zoom: z };
})()`;

/**
 * 主流程：启动 → 固定种子生成第 1 层 → 截图（近景 / 俯瞰）→ 落 JSON
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { edge, ws, send, ev, shot } = await connect();
  const report = { file: FILE, tag: TAG, at: new Date().toISOString() };
  try {
    await send('Page.navigate', { url: pathToFileURL(FILE).href });
    for (let i = 0; i < 60; i += 1) {
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
    /* 固定种子：保证和用户截图同一层布局可复现 */
    await ev(`(function(){ state.seedInfo = { active: true, value: 'SELPROBE' }; generateFloor(1); return state.floor; })()`);
    await sleep(400);

    report.geom = await ev(GEOM_EXPR);
    await ev(`(function(){ if (typeof snapCamera === 'function') snapCamera(); return true; })()`);
    await sleep(350);
    await shot(`select-${TAG}-view.png`);
    report.black = await ev(BLACK_EXPR);

    /* 关掉迷雾（接管 drawFog 为空函数，不重建迷雾层，避免把已揭示区一起抹掉）
       再拍一张：黑块若被房间地面填满，说明是"未探索纯黑"，不是绘制缺失。 */
    await ev(`(function(){ window.__drawFogBackup = drawFog; drawFog = function(){};
      if (typeof snapCamera === 'function') snapCamera(); return true; })()`);
    await sleep(450);
    await shot(`select-${TAG}-nofog.png`);
    await ev(`(function(){ drawFog = window.__drawFogBackup; return true; })()`);
    await sleep(200);

    report.fit = await ev(FIT_EXPR);
    await sleep(450);
    /* 先叠房间框再拍：这张是"带迷雾"的俯瞰（黑块 = 未探索房） */
    report.marked = await ev(MARK_EXPR);
    await sleep(250);
    await shot(`select-${TAG}-fit-marked.png`);
    /* 同机位关迷雾：用于逐块对照"黑矩形下面到底有没有地面" */
    await ev(`(function(){ drawFog = function(){}; return true; })()`);
    await sleep(350);
    await shot(`select-${TAG}-fit-nofog-marked.png`);
    await ev(`(function(){ drawFog = window.__drawFogBackup;
      var o = document.getElementById('__probeMark'); if (o) o.remove(); return true; })()`);

    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.writeFileSync(path.join(OUT, `select-${TAG}.json`), JSON.stringify(report, null, 2));
    try { ws.close(); } catch (e) { /* 忽略 */ }
    try { killEdge(edge); } catch (e) { /* 忽略 */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
