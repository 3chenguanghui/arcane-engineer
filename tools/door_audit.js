/**
 * P2 门牌核对探针（只读，不改游戏文件）
 * ------------------------------------------------------------
 * 背景：census 里 labelWrongSide 从 16 降到 6，这 6 处全是 labelWrongFromCorridor。
 * 但"判据说它没错"不等于"真的没错"——本探针把每一处单独截图 + 打数据，供人工核对。
 *
 * 做法：
 *   1) 固定种子 NAVCMP，逐层 1–10，复刻 census 的法线判据，收集所有 wrong 门；
 *   2) 对每一处重新生成该层，把相机放到"门 ↔ 目标房中心"的中点、临时把 zoom 降到 0.5，
 *      保证一屏能同时看到门、门牌、目标房间；
 *   3) 在页面上叠一层只用于截图的标注框（红=门、黄=门牌、青=目标房），截完即移除；
 *   4) 输出 door-audit-<tag>.json（含每处的门牌文字、目标房类型、走廊矩形、法线点积）。
 *
 * 用法：node tools/door_audit.js [html路径] [tag]
 * 输出：.screenshots/firstplay/door-audit-<tag>-f{N}-{i}.png + door-audit-<tag>.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html'));
const TAG = process.argv[3] || 'after';
const OUT = path.resolve(__dirname, '..', '.screenshots', 'firstplay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 建连并打开游戏页（与 nav_compare.js 同一套无头 Edge 启动方式）
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
 * 收集指定层里"目标房中心在门内侧"的所有门
 * @param {number} floorNumber 层号
 * @returns {string} 可注入 Runtime.evaluate 的表达式
 */
function collectExpr(floorNumber) {
  return `(function(){
    generateFloor(${floorNumber});
    var normals = { top:[0,-1], bottom:[0,1], left:[-1,0], right:[1,0] };
    var out = [];
    (state.doors || []).forEach(function(d, i){
      if (d.targetRoomId < 0) return;
      var room = state.rooms[d.targetRoomId];
      var from = state.rooms[d.roomId];
      if (!room) return;
      var n = normals[d.side] || [0,1];
      var dot = (room.cx - d.x) * n[0] + (room.cy - d.y) * n[1];
      if (dot > 0) return;
      var vis = doorVisFor(d);
      var corridor = null;
      for (var ci = 0; ci < state.corridorRects.length; ci += 1) {
        var c = state.corridorRects[ci];
        if (d.x < c.x - 4 || d.x > c.x + c.w + 4) continue;
        if (d.y < c.y - 4 || d.y > c.y + c.h + 4) continue;
        var other = c.a === d.roomId ? c.b : (c.b === d.roomId ? c.a : -1);
        corridor = { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h),
          a: c.a, b: c.b, otherEndIsTarget: other === d.targetRoomId };
        if (corridor.otherEndIsTarget) break;
      }
      var typeOf = function(r){
        var t = r && ROOM_TYPE_CONFIG.types[r.type];
        return r ? { type: r.type || null, name: t ? t.name : (r.type || '未知') } : null;
      };
      out.push({ floor: ${floorNumber}, doorIndex: i, doorX: Math.round(d.x), doorY: Math.round(d.y),
        side: d.side, roomId: d.roomId, targetRoomId: d.targetRoomId,
        fromRoom: typeOf(from), targetRoom: typeOf(room),
        targetCx: Math.round(room.cx), targetCy: Math.round(room.cy),
        fromCx: from ? Math.round(from.cx) : null, fromCy: from ? Math.round(from.cy) : null,
        dot: +dot.toFixed(1), distDoorToTargetCenter: Math.round(Math.hypot(room.cx - d.x, room.cy - d.y)),
        plateText: vis ? vis.text : null, plateIcon: vis ? vis.icon : null,
        adjacent: !!(vis && vis.adjacent), locked: !!(vis && vis.locked), revisited: !!(vis && vis.revisited),
        corridor: corridor });
    });
    return out;
  })()`;
}

/**
 * 把玩家放到 from 房心（door 视角）或目标房心（target 视角），叠加标注框后截图
 * ------------------------------------------------------------
 * 不用"降 zoom 一屏装下两间房"的原因：cameraZoom 会让整个世界缩小，
 * 且渲染侧对 cam 有地图边界 clamp，探针设的 mid 点会被夹掉，标注框直接跑出画面。
 * 所以改成两次正常机位：门牌必须 adjacent（玩家在门所属房）才出字，只能进房拍。
 * @param {Object} item collectExpr 里的一条记录
 * @param {string} part 'door' | 'target'
 * @returns {string} 可注入 Runtime.evaluate 的表达式
 */
function frameExpr(item, part) {
  const view = part === 'target'
    ? `var room = state.rooms[d.targetRoomId]; state.player.x = room.cx; state.player.y = room.cy;
       state.currentRoomId = d.targetRoomId;
       if (state.roomEntry) state.roomEntry.lastRoomId = d.targetRoomId;`
    : `/* 站到门内侧 100px（而不是房心）：相机以玩家为目标，门就落在画面中央附近，
         不会被地图边界 clamp 顶到画面外。currentRoomId 仍设为门所属房，保证门牌出字。 */
       var inX = d.side === 'left' ? 100 : (d.side === 'right' ? -100 : 0);
       var inY = d.side === 'top' ? 100 : (d.side === 'bottom' ? -100 : 0);
       state.player.x = d.x + inX; state.player.y = d.y + inY;
       state.currentRoomId = d.roomId;
       if (state.roomEntry) state.roomEntry.lastRoomId = d.roomId;`;
  return `(function(){
    generateFloor(${item.floor});
    if (typeof CAMERA_DISTANCE_CONFIG !== 'undefined') {
      CAMERA_DISTANCE_CONFIG.minZoom = 1; CAMERA_DISTANCE_CONFIG.zoom = 1;
    }
    var d = state.doors[${item.doorIndex}];
    if (!d) return { __err: 'door-missing' };
    /* 无头环境的 rAF 只有 3–4fps，相机 lerp 会在"设位置"和"截图"之间继续漂移，
       导致标注框和画面对不上。把 camLerp 临时拉大，让 cam 每帧立刻贴到目标。 */
    if (typeof GAME_CONFIG !== 'undefined' && !window.__auditCamLerpBackup) {
      window.__auditCamLerpBackup = GAME_CONFIG.camLerp;
      GAME_CONFIG.camLerp = 1000;
    }
    ${view}
    if (typeof snapCamera === 'function') snapCamera();
    var rect = document.getElementById('game').getBoundingClientRect();
    var cv = document.getElementById('game');
    /* canvas 内部像素与 CSS 像素不一定 1:1（无头窗口有边框时 1410×805 vs 内部尺寸），
       标注框必须按 x/y 两轴各自的比例换算，否则越靠边偏得越多。 */
    var kx = (cv && cv.width) ? rect.width / cv.width : 1;
    var ky = (cv && cv.height) ? rect.height / cv.height : 1;
    var zoom = cameraZoom() * kx;
    var zoomY = cameraZoom() * ky;
    /* state.cam 是"视口左上角的世界坐标"（不是中心点）：实测 player(1540,1431) 时
       cam=(835,1029)，1539-835=704≈画面中心，所以这里不能再加 rect.width/2。 */
    var sx = function(x){ return rect.x + (x - state.cam.x) * zoom; };
    var sy = function(y){ return rect.y + (y - state.cam.y) * zoomY; };
    var old = document.getElementById('__auditOverlay');
    if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = '__auditOverlay';
    ov.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:99999;';
    function box(x, y, w, h, color, label){
      var el = document.createElement('div');
      el.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + Math.max(4, w)
        + 'px;height:' + Math.max(4, h) + 'px;border:3px solid ' + color + ';box-sizing:border-box;';
      var tag = document.createElement('div');
      tag.textContent = label;
      tag.style.cssText = 'position:absolute;left:0;top:-20px;white-space:nowrap;font:bold 13px/18px "Microsoft YaHei UI",sans-serif;color:#0b1018;background:' + color + ';padding:0 5px;border-radius:3px;';
      el.appendChild(tag);
      ov.appendChild(el);
    }
    if ('${part}' === 'target') {
      var tr = state.rooms[d.targetRoomId];
      var typeName = ((ROOM_TYPE_CONFIG.types[tr.type] || {}).name || tr.type || '?');
      box(sx(tr.x) + 4, sy(tr.y) + 4, tr.w * zoom - 8, tr.h * zoomY - 8, '#22d3ee', '目标房：“' + typeName + '” #' + d.targetRoomId);
    } else {
      box(sx(d.x) - 30, sy(d.y) - 30, 60, 60, '#ff3b30', '门（' + d.side + '）');
      var ly = d.y - DOOR_VIS_CONFIG.plateTop;
      var shift = doorTextInwardShift(d, 46);
      box(sx(d.x + shift) - 46, sy(ly) - 12, 92, 24, '#ffcc00', '门牌：“' + (doorVisFor(d).text || '') + '”');
    }
    document.body.appendChild(ov);
    return { ok: true, part: '${part}', zoom: zoom, cam: { x: Math.round(state.cam.x), y: Math.round(state.cam.y) },
      player: { x: Math.round(state.player.x), y: Math.round(state.player.y) },
      fromCenter: (function(){ var r = state.rooms[d.roomId]; return r ? { x: Math.round(r.cx), y: Math.round(r.cy) } : null; })(),
      plateText: doorVisFor(d).text, doorSide: d.side,
      fromType: (state.rooms[d.roomId] || {}).type, targetType: (state.rooms[d.targetRoomId] || {}).type };
  })()`;
}

/**
 * 主流程：收集 → 逐处截图 → 落 JSON → 恢复 zoom → 退出
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { edge, ws, send, ev, shot } = await connect();
  const report = { file: FILE, tag: TAG, at: new Date().toISOString(), items: [] };
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
    await sleep(400);
    await ev(`(function(){ state.seedInfo = { active: true, value: 'NAVCMP' }; return state.seedInfo; })()`);
    /* 关掉无头环境的 reduced-motion 命中，保证门牌按正常动画相位绘制 */
    await ev(`(function(){ var m = window.matchMedia; window.matchMedia = function(q){ return { matches:false, media:q, addListener:function(){}, removeListener:function(){}, addEventListener:function(){}, removeEventListener:function(){} }; }; window.__auditMatchMedia = m; return true; })()`);

    const all = [];
    for (let f = 1; f <= 10; f += 1) {
      const rows = await ev(collectExpr(f));
      if (Array.isArray(rows)) all.push(...rows);
    }
    report.count = all.length;
    console.log(`wrong doors = ${all.length}; floors = ${all.map((r) => r.floor).join(',')}`);

    for (let i = 0; i < all.length; i += 1) {
      const item = all[i];
      const base = `door-audit-${TAG}-f${item.floor}-${i + 1}`;
      const shotDoor = `${base}-a.png`;
      const shotTarget = `${base}-b.png`;
      const framedDoor = await ev(frameExpr(item, 'door'));
      if (framedDoor && framedDoor.__err) { item.frameError = framedDoor.__err; report.items.push(item); continue; }
      await sleep(260);
      await shot(shotDoor);
      await ev(`(function(){ var o = document.getElementById('__auditOverlay'); if (o) o.remove(); return true; })()`);
      const framedTarget = await ev(frameExpr(item, 'target'));
      await sleep(260);
      await shot(shotTarget);
      await ev(`(function(){ var o = document.getElementById('__auditOverlay'); if (o) o.remove(); return true; })()`);
      item.shotDoor = shotDoor;
      item.shotTarget = shotTarget;
      item.framed = framedDoor;
      item.framedTarget = framedTarget;
      report.items.push(item);
      console.log(`[${i + 1}/${all.length}] ${base} plate="${framedDoor.plateText}" target=${item.targetRoom && item.targetRoom.name}`);
    }
  } finally {
    try { await ev(`(function(){ if (window.__auditMatchMedia) window.matchMedia = window.__auditMatchMedia; if (window.__auditCamLerpBackup !== undefined) GAME_CONFIG.camLerp = window.__auditCamLerpBackup; return true; })()`); } catch (e) { /* 忽略 */ }
    fs.writeFileSync(path.join(OUT, `door-audit-${TAG}.json`), JSON.stringify(report, null, 2));
    try { ws.close(); } catch (e) { /* 忽略 */ }
    try { killEdge(edge); } catch (e) { /* 忽略 */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
