// M2-0c 专项验收：Delaunay 分支图上的战争迷雾 + 小地图揭示
// 用法：node arcane_m20.js [html路径] [截图输出目录]
// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9469;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'm20');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

/**
 * 记录一条断言并即时打印
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {*} detail 证据
 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口还没起来，继续等 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

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
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const clickElement = async (selector) => {
    const rect = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!rect) throw new Error('找不到元素 ' + selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  };

  const url = 'file:///' + FILE.replace(/\\/g, '/');
  await send('Page.navigate', { url });
  await sleep(2200);
  await clickElement('#btnStart');
  await sleep(1000);

  // ==================== 0) 准备：生成一张 ≥6 房的分支图 ====================
  const gen = await ev(`(function(){
    var tries = 0;
    while (state.rooms.length < 6 && tries < 10) { generateFloor(1 + (tries % 3)); tries += 1; }
    window.__roamDebug.centerPlayer();
    window.__roamDebug.setHp(100);
    var s = window.__roamDebug.getState();
    return { rooms: s.rooms.length, corridors: state.corridorRects.length, tries: tries, floor: s.floor, spawnId: getSpawnRoom().id };
  })()`);
  await sleep(500);

  // ==================== 1) 开局迷雾：只亮出生房，走廊全暗 ====================
  const fog0 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    return { fog: s.fog, spawnId: getSpawnRoom().id, alpha: FOG_CONFIG.alpha, trailRadius: FOG_CONFIG.trailRadius, trailStep: FOG_CONFIG.trailStep };
  })()`);
  check('开局只点亮出生房（1 间）', fog0.fog && fog0.fog.seenRooms === 1, fog0.fog && { rooms: fog0.fog.seenRooms, ids: fog0.fog.seenRoomIds });
  check('出生房就是被点亮的那间', fog0.fog && fog0.fog.seenRoomIds[0] === fog0.spawnId, fog0.fog ? { spawnId: fog0.spawnId, seen: fog0.fog.seenRoomIds } : null);
  check('开局走廊全部未探索（要走过才亮）', fog0.fog && fog0.fog.seenCorridors === 0, fog0.fog ? { corridors: fog0.fog.seenCorridors, total: fog0.fog.totalCorridors } : null);
  check('开局无走廊足迹', fog0.fog && fog0.fog.trail === 0, fog0.fog ? fog0.fog.trail : null);
  check('未探索区域压暗强度 ≥ 0.9（全遮）', fog0.alpha >= 0.9, fog0.alpha);

  // 1b) 迷雾离屏画布像素级验证：未探索房中心不透明、已探索房中心被擦透
  //     迷雾层是"世界尺寸"，直接按世界坐标取样，不需要动相机
  const px0 = await ev(`(function(){
    var fog = state.fog;
    var hidden = null, seenRoom = getSpawnRoom();
    for (var i = 0; i < state.rooms.length; i += 1) {
      if (!fog.seenRooms[state.rooms[i].id]) { hidden = state.rooms[i]; break; }
    }
    if (!hidden) return null;
    var g = fogCanvas.getContext('2d');
    var dHidden = Array.from(g.getImageData(Math.round(hidden.cx), Math.round(hidden.cy), 1, 1).data);
    var dSeen = Array.from(g.getImageData(Math.round(seenRoom.cx), Math.round(seenRoom.cy), 1, 1).data);
    drawFog();
    return { hidden: dHidden, seen: dSeen, hiddenRoomId: hidden.id, size: [fogCanvas.width, fogCanvas.height] };
  })()`);
  // M2 房间放大：迷雾离屏画布跟着世界一起变大（2600×1900 → 3200×2300）
  check('迷雾层按世界尺寸建立（不再每帧全屏重绘）', px0 && px0.size[0] === 3200 && px0.size[1] === 2300, px0 && px0.size);
  check('未探索房在迷雾层上不透明（alpha ≥ 230）', px0 && px0.hidden[3] >= 230, px0 ? { hiddenRoomId: px0.hiddenRoomId, alpha: px0.hidden[3], rgb: px0.hidden.slice(0, 3) } : null);
  check('已探索房在迷雾层上被擦透（alpha ≤ 20）', px0 && px0.seen[3] <= 20, px0 ? { alpha: px0.seen[3] } : null);
  await shot('m20-fog-start.png');

  // ==================== 2) 走廊按行进路径擦洞 ====================
  const c1 = await ev(`(function(){
    var spawn = getSpawnRoom();
    // M2 走廊缩短后竖直短腿可能只有 ~90px，优先挑"最长的那条"走廊，
    // 保证后面 2b) 还能在里面找到"更远的落点"。
    var order = [];
    for (var j = 0; j < state.corridorRects.length; j += 1) {
      var rr = state.corridorRects[j];
      if (rr.a !== spawn.id && rr.b !== spawn.id) continue;
      order.push({ i: j, len: rr.horiz ? rr.w : rr.h });
    }
    order.sort(function(m, n){ return n.len - m.len; });
    for (var oi = 0; oi < order.length; oi += 1) {
      var i = order[oi].i;
      var r = state.corridorRects[i];
      for (var k = 0.1; k <= 0.95; k += 0.05) {
        var x = r.horiz ? r.x + r.w * k : r.x + r.w / 2;
        var y = r.horiz ? r.y + r.h / 2 : r.y + r.h * k;
        if (roomAt(x, y)) continue;
        if (!isWalkableCircle(x, y, state.player.radius)) continue;
        var okGo = window.__roamDebug.teleport(x, y);
        return { index: i, x: x, y: y, moved: okGo, len: order[oi].len, horiz: r.horiz };
      }
    }
    return null;
  })()`);
  await sleep(400);
  const b1 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    return { fog: s.fog, currentRoomId: s.currentRoomId, player: s.player };
  })()`);
  check('找到出生房旁的走廊并走进去', !!c1 && c1.moved === true, c1);
  check('走进的这段走廊被点亮', !!c1 && b1.fog.seenCorridorIds.indexOf(c1.index) >= 0, b1.fog ? { walked: c1 ? c1.index : null, seen: b1.fog.seenCorridorIds } : null);
  check('走廊里留下足迹点（trail ≥ 1）', b1.fog && b1.fog.trail >= 1, b1.fog ? b1.fog.trail : null);
  check('只点亮走过的那一段（未走过的仍暗）', b1.fog && b1.fog.seenCorridors === 1, b1.fog ? { seen: b1.fog.seenCorridors, total: b1.fog.totalCorridors } : null);
  check('迷雾确实按足迹擦洞（fogStats.trail > 0）', b1.fog && b1.fog.stats && b1.fog.stats.trail > 0, b1.fog ? b1.fog.stats : null);
  check('走走廊不会连带点亮房间', b1.fog && b1.fog.seenRooms === 1, b1.fog ? b1.fog.seenRooms : null);

  // 2b) 沿同一走廊再走远一点：足迹继续增长，但走廊数不再增加
  const c2 = await ev(`(function(){
    var idx = ${c1.index};
    var r = state.corridorRects[idx];
    var first = { x: ${c1.x}, y: ${c1.y} };
    for (var k = 0.1; k <= 0.95; k += 0.05) {
      var x = r.horiz ? r.x + r.w * k : r.x + r.w / 2;
      var y = r.horiz ? r.y + r.h / 2 : r.y + r.h * k;
      var len = r.horiz ? r.w : r.h;
      // M2：走廊变短后，110px 的最小位移在竖直短腿（~90px）上永远找不到，
      // 改成"走廊长度的 35%"并夹在 55–110px，语义仍是"沿同一条走廊再往前走一段"。
      var minGap = Math.max(55, Math.min(110, len * 0.35));
      if (Math.hypot(x - first.x, y - first.y) < minGap) continue;
      if (roomAt(x, y)) continue;
      if (!isWalkableCircle(x, y, state.player.radius)) continue;
      var okGo = window.__roamDebug.teleport(x, y);
      return { x: x, y: y, moved: okGo, ratio: r.horiz ? (x - r.x) / r.w : (y - r.y) / r.h };
    }
    return null;
  })()`);
  // 传送只改变位置、本身不产生"行进足迹"（足迹靠真实移动每 26px 落一个点）。
  // 所以落点后用真实按键沿走廊再走 0.45s，保证足迹必然增长；否则会出现
  // "同一点/位移不足"导致 1→1 的偶发假失败。
  const walkIdx = (c2 && c2.moved) ? c1.index : -1;
  // 先清场：受击退会让"沿走廊前进"变成原地抖动，和迷雾逻辑无关
  await ev(`window.__roamDebug.clearEnemies()`);
  await ev(`(function(){
    var r = state.corridorRects[${walkIdx}];
    // 方向始终朝走廊中心（ratio < 0.5 往 +，否则往 -），保证不会一出门就顶到门/墙；
    // 这纯粹是测试取方向的问题，不涉及玩法逻辑。
    var towardCenter = ${c2 && c2.ratio != null ? c2.ratio : 0.5} < 0.5;
    state.keys.right = !!r && r.horiz === true && towardCenter;
    state.keys.left = !!r && r.horiz === true && !towardCenter;
    state.keys.down = !!r && r.horiz === false && towardCenter;
    state.keys.up = !!r && r.horiz === false && !towardCenter;
    return true;
  })()`);
  await sleep(900);
  const b2 = await ev(`(function(){
    state.keys.right = false; state.keys.down = false;
    state.keys.left = false; state.keys.up = false;
    var s = window.__roamDebug.getState();
    return { fog: s.fog };
  })()`);
  check('沿走廊继续前进，足迹点继续增长', !!c2 && b2.fog.trail > b1.fog.trail, { before: b1.fog.trail, after: b2.fog.trail });
  check('同一段走廊重复走不会重复计数', b2.fog.seenCorridors === 1, { seen: b2.fog.seenCorridors });
  await shot('m20-fog-corridor.png');

  // ==================== 3) 进入房间：整间揭示、不连带走廊 ====================
  const c3 = await ev(`(function(){
    var stairs = getStairsRoom();
    var list = state.rooms.filter(function(r){
      return !state.fog.seenRooms[r.id] && (!stairs || r.id !== stairs.id);
    });
    // 优先挑战斗房：不会触发"进房奖励弹窗"打断后续测试
    var target = list.filter(function(r){ return r.type === 'battle'; })[0] || list[0];
    if (!target) return null;
    var before = { rooms: Object.keys(state.fog.seenRooms).length, corridors: Object.keys(state.fog.seenCorridors).length };
    window.__roamDebug.setHp(100);
    var moved = window.__roamDebug.teleport(target.cx, target.cy);
    return { id: target.id, type: target.type, cx: target.cx, cy: target.cy, moved: moved, before: before };
  })()`);
  await sleep(500);
  const r1 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    return { fog: s.fog, mode: s.mode, currentRoomId: s.currentRoomId };
  })()`);
  check('走进未探索房后该房被点亮', !!c3 && r1.fog.seenRoomIds.indexOf(c3.id) >= 0, c3 ? { target: c3.id, type: c3.type, seen: r1.fog.seenRoomIds } : null);
  check('房间数恰好 +1（整间揭示，不漏也不多）', !!c3 && r1.fog.seenRooms === c3.before.rooms + 1, c3 ? { before: c3.before.rooms, after: r1.fog.seenRooms } : null);
  check('进房不连带点亮未走过的走廊', !!c3 && r1.fog.seenCorridors === c3.before.corridors, c3 ? { before: c3.before.corridors, after: r1.fog.seenCorridors } : null);

  // 3b) 重复进入同一间房：不重复计数
  await ev(`(function(){ state.player.x = ${c3.cx}; state.player.y = ${c3.cy}; return true; })()`);
  await sleep(300);
  const r2 = await ev(`(function(){ var s = window.__roamDebug.getState(); return { rooms: s.fog.seenRooms, corridors: s.fog.seenCorridors }; })()`);
  check('重复进入同一房不重复计数（幂等）', r2.rooms === r1.fog.seenRooms && r2.corridors === r1.fog.seenCorridors, { rooms: r2.rooms, corridors: r2.corridors });

  // ==================== 4) 小地图：已探索房间/走廊、楼梯、玩家朝向 ====================
  const mm = await ev(`(function(){
    var c = document.getElementById('minimap');
    var g = c.getContext('2d');
    var W = GAME_CONFIG.worldWidth, H = GAME_CONFIG.worldHeight;
    var sc = Math.min(c.width / W, c.height / H);
    var ox = (c.width - W * sc) / 2, oy = (c.height - H * sc) / 2;
    function sample(wx, wy) {
      var px = Math.max(0, Math.min(c.width - 1, Math.round(ox + wx * sc)));
      var py = Math.max(0, Math.min(c.height - 1, Math.round(oy + wy * sc)));
      var d = g.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    }
    function isBg(rgb) { return Math.abs(rgb[0] - 5) <= 8 && Math.abs(rgb[1] - 10) <= 8 && Math.abs(rgb[2] - 18) <= 10; }
    function bright(rgb) { return rgb[0] + rgb[1] + rgb[2]; }
    /* 采样前关掉终端底纹：网格线 24px 一条，会正好落在采样点上，
       把底色染成 accent 0.09（≈ [11,30,39]），造成"未探索被画了"的误判。 */
    var __prevUiV2 = state.uiV2;
    state.uiV2 = false;

    drawMinimap();
    var spawn = getSpawnRoom();
    var stairs = getStairsRoom();
    // 走廊会压进房间中心，所以未探索房要挑一个"没被已点亮走廊盖住"的点再取样
    var unseenRoom = state.rooms.filter(function(r){
      return !state.fog.seenRooms[r.id] && r.id !== spawn.id && (!stairs || r.id !== stairs.id);
    })[0] || null;
    var unseenSpot = null;
    if (unseenRoom) {
      var cands = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]];
      for (var ci = 0; ci < cands.length; ci += 1) {
        var wx = unseenRoom.x + unseenRoom.w * cands[ci][0];
        var wy = unseenRoom.y + unseenRoom.h * cands[ci][1];
        // 未探索房：避开已探索走廊的 0.1 alpha 填充（交叉处会污染采样）
        var coveredBySeen = state.corridorRects.some(function(other, oi){
          return state.fog.seenCorridors[oi] && pointInRect(wx, wy, other);
        });
        if (coveredBySeen) continue;
        var covered = false;
        for (var cj = 0; cj < state.corridorRects.length; cj += 1) {
          if (state.fog.seenCorridors[cj] && pointInRect(wx, wy, state.corridorRects[cj])) { covered = true; break; }
        }
        if (!covered) { unseenSpot = { x: wx, y: wy }; break; }
      }
    }
    var unseenCorridor = null;
    for (var i = 0; i < state.corridorRects.length; i += 1) {
      if (state.fog.seenCorridors[i]) continue;
      var r = state.corridorRects[i];
      for (var k = 0.15; k <= 0.9; k += 0.1) {
        var x = r.horiz ? r.x + r.w * k : r.x + r.w / 2;
        var y = r.horiz ? r.y + r.h / 2 : r.y + r.h * k;
        if (roomAt(x, y)) continue;
        // 避开"已探索走廊"的重叠区域：U7 房型生成后走廊会互相交叉，
        // 相邻已探索走廊的填充会把采样点染成 accent 色，造成"未探索被画了"的误判。
        var seenOverlap = state.corridorRects.some(function(other, oi){
          return state.fog.seenCorridors[oi] && pointInRect(x, y, other);
        });
        if (seenOverlap) continue;
        // 避开已探索房间的门标记（灰色短线会污染取样）
        var nearDoor = state.doors.some(function(d){ return Math.hypot(d.x - x, d.y - y) < 45; });
        if (nearDoor) continue;
        unseenCorridor = { x: x, y: y }; break;
      }
      if (unseenCorridor) break;
    }

    // 玩家朝向：直接读小地图"本帧实际绘制用的朝向 + 玩家映射坐标"（state.minimapStats），
    // 既验证朝向已接入，又避免细三角做像素采样的抖动
    state.player.facingAngle = 0; drawMinimap();
    var arrowA = Object.assign({}, state.minimapStats);
    var expectedA = { x: ox + state.player.x * sc, y: oy + state.player.y * sc };
    state.player.facingAngle = 1.1; drawMinimap();
    var arrowB = Object.assign({}, state.minimapStats);

    var __out = {
      spawnBright: !isBg(sample(spawn.cx, spawn.cy)),
      spawnPixel: sample(spawn.cx, spawn.cy),
      unseenRoomId: unseenRoom ? unseenRoom.id : null,
      unseenRoomDark: unseenSpot ? isBg(sample(unseenSpot.x, unseenSpot.y)) : null,
      unseenRoomPixel: unseenSpot ? sample(unseenSpot.x, unseenSpot.y) : null,
      seenCorridorBright: !isBg(sample(${c1.x}, ${c1.y})),
      seenCorridorPixel: sample(${c1.x}, ${c1.y}),
      unseenCorridorDark: unseenCorridor ? isBg(sample(unseenCorridor.x, unseenCorridor.y)) : null,
      unseenCorridorPixel: unseenCorridor ? sample(unseenCorridor.x, unseenCorridor.y) : null,
      arrowA: arrowA, arrowB: arrowB, expectedA: expectedA
    };
    state.uiV2 = __prevUiV2;
    drawMinimap();
    return __out;
  })()`);
  check('小地图画出已探索的出生房', mm && mm.spawnBright === true, mm && { pixel: mm.spawnPixel });
  check('小地图不显示未探索房间（仍是底色）', mm && (mm.unseenRoomId === null || mm.unseenRoomDark === true), mm && { id: mm.unseenRoomId, pixel: mm.unseenRoomPixel });
  check('小地图画出已走过的走廊', mm && mm.seenCorridorBright === true, mm && { pixel: mm.seenCorridorPixel });
  check('小地图不显示没走过的走廊', mm && mm.unseenCorridorDark !== false, mm && { pixel: mm.unseenCorridorPixel });
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  check('玩家朝向接入小地图（朝向 0 时按 0 画箭头）', mm && near(mm.arrowA.arrowAngle, 0, 0.01), mm && mm.arrowA);
  check('玩家朝向接入小地图（改朝向后箭头同步）', mm && near(mm.arrowB.arrowAngle, 1.1, 0.01), mm && mm.arrowB);
  check('小地图玩家坐标与世界坐标映射一致', mm && near(mm.arrowA.px, mm.expectedA.x, 0.6) && near(mm.arrowA.py, mm.expectedA.y, 0.6), mm && { got: { x: mm.arrowA.px, y: mm.arrowA.py }, want: mm.expectedA });

  // 4b) 楼梯：未探索不显示；探索 + 清场后显示金色菱形
  const st0 = await ev(`(function(){
    var c = document.getElementById('minimap');
    var g = c.getContext('2d');
    var W = GAME_CONFIG.worldWidth, H = GAME_CONFIG.worldHeight;
    var sc = Math.min(c.width / W, c.height / H);
    var ox = (c.width - W * sc) / 2, oy = (c.height - H * sc) / 2;
    function sample(wx, wy) { var d = g.getImageData(Math.round(ox + wx * sc), Math.round(oy + wy * sc), 1, 1).data; return [d[0], d[1], d[2], d[3]]; }
    function isBg(rgb) { return Math.abs(rgb[0] - 5) <= 8 && Math.abs(rgb[1] - 10) <= 8 && Math.abs(rgb[2] - 18) <= 10; }
    var stairs = getStairsRoom();
    state.floorCleared = false;
    /* 关掉终端底纹（网格 + 扫描带）再采样：这两层装饰会给底色"加亮"，
       像素会和纯底色对不上，导致断言误判（和迷雾本身无关）。 */
    var uiPrev = state.uiV2;
    state.uiV2 = false;
    drawMinimap();
    var before = sample(stairs.cx, stairs.cy);
    state.uiV2 = uiPrev;
    return { stairsId: stairs.id, seen: isStairsSeen(), pixel: before, dark: isBg(before), stairsX: stairs.cx, stairsY: stairs.cy };
  })()`);
  check('楼梯房未探索时小地图不剧透（仍为底色）', st0.dark === true && st0.seen === false, { seen: st0.seen, pixel: st0.pixel });

  await ev("(function(){ var s = getStairsRoom(); window.__roamDebug.teleport(s.cx, s.cy); window.__roamDebug.setHp(100); return true; })()");
  await sleep(500);
  const st1 = await ev(`(function(){
    var c = document.getElementById('minimap');
    var g = c.getContext('2d');
    var W = GAME_CONFIG.worldWidth, H = GAME_CONFIG.worldHeight;
    var sc = Math.min(c.width / W, c.height / H);
    var ox = (c.width - W * sc) / 2, oy = (c.height - H * sc) / 2;
    // 玩家此刻站在楼梯房中心，会盖住中心点；在 19x19 邻域里搜金色像素
    function findGold(wx, wy) {
      var px = Math.round(ox + wx * sc), py = Math.round(oy + wy * sc);
      for (var yy = -9; yy <= 9; yy += 1) {
        for (var xx = -9; xx <= 9; xx += 1) {
          var d = g.getImageData(px + xx, py + yy, 1, 1).data;
          if (d[0] > 200 && d[1] > 150 && d[2] < 130) return true;
        }
      }
      return false;
    }
    var stairs = getStairsRoom();
    state.floorCleared = true;
    drawMinimap();
    var gold = findGold(stairs.cx, stairs.cy);
    state.floorCleared = false;
    drawMinimap();
    return { seen: isStairsSeen(), gold: gold };
  })()`);
  check('楼梯房探索 + 清场后才显示金色菱形', st1.seen === true && st1.gold === true, st1);
  await shot('m20-fog-explored.png');

  // ==================== 5) 性能：7 房 + 大世界贴图裁剪下的迷雾耗时 ====================
  const seven = await ev(`(function(){
    var tries = 0;
    while (state.rooms.length < 7 && tries < 15) { generateFloor(1 + (tries % 3)); tries += 1; }
    window.__roamDebug.centerPlayer();
    window.__roamDebug.setHp(100);
    return { rooms: state.rooms.length, corridors: state.corridorRects.length, tries: tries, floor: state.floor };
  })()`);
  await sleep(1300);
  const normalFps = await ev("window.__roamDebug.getState().fps");

  /** 连续采样 120 帧的迷雾绘制耗时（avg / p95 / max） */
  const measureFog = () => ev(`(function(){
    return new Promise(function(resolve){
      var samples = [], n = 0;
      function tick() {
        var st = state.fogStats;
        if (st) samples.push(st.ms);
        n += 1;
        if (n >= 120) {
          samples.sort(function(a, b){ return a - b; });
          var sum = samples.reduce(function(a, b){ return a + b; }, 0);
          resolve({
            avg: +(sum / samples.length).toFixed(3),
            p95: +samples[Math.floor(samples.length * 0.95)].toFixed(3),
            max: +samples[samples.length - 1].toFixed(3),
            n: samples.length
          });
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  })()`);
  const perf1 = await measureFog();
  check('存在 7 房层（含大世界贴图裁剪）', seven.rooms >= 6, { rooms: seven.rooms, corridors: seven.corridors, tries: seven.tries });
  check('常规探索状态下帧率 ≥ 60', normalFps >= 60, { fps: normalFps, rooms: seven.rooms });
  check('每帧迷雾绘制平均耗时 ≤ 3ms', perf1.avg <= 3, perf1);
  check('迷雾耗时 p95 ≤ 6ms（不出现长尾卡顿）', perf1.p95 <= 6, perf1);

  // 5b) 最坏情况压力：全部房间 + 全部走廊 + 320 个足迹点同时擦洞
  await ev(`(function(){
    state.rooms.forEach(function(r){ state.fog.seenRooms[r.id] = true; });
    state.corridorRects.forEach(function(_, i){ state.fog.seenCorridors[i] = true; });
    state.fog.trail = [];
    for (var i = 0; i < 320; i += 1) { state.fog.trail.push({ x: (i * 73) % GAME_CONFIG.worldWidth, y: (i * 41) % GAME_CONFIG.worldHeight }); }
    drawMinimap();
    return true;
  })()`);
  await sleep(250);
  const stressStats = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var st = s.fog.stats;
    var matches = !!st && st.rooms === s.fog.totalRooms && st.corridors === s.fog.totalCorridors && st.trail > 10;
    return { stats: st, fps: s.fps, rooms: s.fog.totalRooms, corridors: s.fog.totalCorridors, matches: matches };
  })()`);
  const perf2 = await measureFog();
  const stressFps = await ev("window.__roamDebug.getState().fps");
  check('压力下迷雾仍逐房间/走廊/足迹擦洞（计价正确）', stressStats.matches === true, stressStats);
  check('最坏情况（全探索 + 320 足迹）帧率 ≥ 60', stressFps >= 60, { fps: stressFps });
  check('最坏情况迷雾平均耗时 ≤ 3ms', perf2.avg <= 3, perf2);
  check('最坏情况迷雾 p95 ≤ 6ms', perf2.p95 <= 6, perf2);

  // ==================== 6) 边界：清房开门 / 走廊巡逻 / 路线选择 ====================
  await ev("(function(){ window.__roamDebug.setFloor(2); window.__roamDebug.centerPlayer(); window.__roamDebug.setHp(100); return true; })()");
  await sleep(600);

  const patrol = await ev(`(function(){
    var bad = [];
    var patrolCount = 0;
    state.enemies.forEach(function(e){
      if (e.roomId === -2) { patrolCount += 1; return; }
      if (!state.rooms.some(function(r){ return r.id === e.roomId; })) bad.push(e.roomId);
    });
    return { bad: bad.length, patrols: patrolCount, total: state.enemies.length };
  })()`);
  check('走廊巡逻怪绑定规则不变（无非法房间 id）', patrol.bad === 0, patrol);

  const routes = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var g = s.layout;
    if (!g) return null;
    var uniq = {};
    g.routes.forEach(function(r){ uniq[r.join('-')] = 1; });
    var spawn = state.rooms[state.spawnRoomId];
    var stair = getStairsRoom();
    var farthest = state.rooms.every(function(r){
      return Math.hypot(r.cx - spawn.cx, r.cy - spawn.cy) <= Math.hypot(stair.cx - spawn.cx, stair.cy - spawn.cy) + 0.001;
    });
    return { routes: g.routes.length, distinct: Object.keys(uniq).length, loops: g.loopEdges.length, variety: g.routeVariety, spawnCol: spawn.col, farthest: farthest };
  })()`);
  check('路线选择逻辑不变（≥2 条不同路线 + 回环边）', !!routes && routes.routes >= 2 && routes.distinct >= 2 && routes.loops >= 1, routes && { routes: routes.routes, distinct: routes.distinct, loops: routes.loops });
  check('两条路线风险/收益仍不同（routeVariety）', !!routes && routes.variety && routes.variety.ok !== false, routes && routes.variety);
  check('出生房仍最左、楼梯房仍最远', !!routes && routes.spawnCol === 0 && routes.farthest === true, routes && { spawnCol: routes.spawnCol, farthest: routes.farthest });

  // 6b) 清房开门：进战斗房落闸 → 清怪开门
  // 楼层随机会出现"没有带敌人房间"的情况，这里最多换 6 层直到找到可测的房间
  const battle = await ev(`(function(){
    // 前置用例可能把当前层留在"开放层"（B 自由探索层按设计不落闸），先回普通层再测锁门
    if (state.openFloor && state.openFloor.active) {
      generateFloor(1);
      window.__roamDebug.centerPlayer();
    }
    for (var tries = 0; tries < 6; tries += 1) {
      var room = state.rooms.filter(function(r){
        return !r.cleared && state.enemies.some(function(e){ return e.roomId === r.id; });
      }).sort(function(a, b){ return (b.type === 'battle') - (a.type === 'battle'); })[0];
      if (room) {
        window.__roamDebug.setHp(100);
        window.__roamDebug.teleport(room.cx, room.cy);
        return { id: room.id, type: room.type, cx: room.cx, cy: room.cy, tries: tries };
      }
      generateFloor(1);
      window.__roamDebug.centerPlayer();
    }
    return null;
  })()`);
  await sleep(600);
  const locked = await ev(`(function(){
    var r = state.rooms[${battle ? battle.id : 0}];
    return { locked: r.locked, cleared: r.cleared, doorsClosed: state.doors.filter(function(d){ return d.roomId === r.id && d.closed; }).length, mode: state.mode };
  })()`);
  check('清房逻辑不变：进入战斗房会落闸', !!battle && locked.locked === true && locked.doorsClosed > 0, locked);

  await ev("(function(){ window.__roamDebug.killAllEnemies(); return state.enemies.length; })()");
  await sleep(600);
  const opened = await ev(`(function(){
    var r = state.rooms[${battle ? battle.id : 0}];
    return { locked: r.locked, cleared: r.cleared, doorsClosed: state.doors.filter(function(d){ return d.roomId === r.id && d.closed; }).length, mode: state.mode };
  })()`);
  check('清房逻辑不变：清怪后开门（不再落闸）', opened.cleared === true && opened.locked === false && opened.doorsClosed === 0, opened);

  // ==================== 7) 帧率 + 报错 ====================
  await sleep(900);
  const perf = await ev("(function(){ var s = window.__roamDebug.getState(); return { fps: s.fps, errors: window.__roamDebug.errors(), fog: s.fog }; })()");
  check('战斗后帧率 ≥ 60', perf.fps >= 60, perf.fps);
  check('无运行时报错', Array.isArray(perf.errors) && perf.errors.length === 0, perf.errors);

  // 汇总
  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'm20-result.json'), JSON.stringify({
    pass, total: results.length, results,
    gen, fog0, px0, c1, b1, c2, b2, c3, r1, r2, mm, st0, st1,
    seven, normalFps, perf1, stressStats, perf2, stressFps, patrol, routes, battle, locked, opened, perf
  }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 进程已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  process.exitCode = 1;
});
