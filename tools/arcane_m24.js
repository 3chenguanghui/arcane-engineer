// M2 房间放大专项验收（房间 ×1.6 / 走廊缩短 / 相机 / 迷雾 / 小地图 / 敌人容量 / 性能）
// 用法：node arcane_m24.js [html路径] [截图输出目录]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9474;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'm24');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

/** 记录一条断言并打印 */
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
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等待端口 */ }
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
  // 把设备像素比固定成 1.5：模拟高分屏玩家的最坏情况（底图按 sceneScale=1.5 烘焙）
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
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

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  await clickElement('#btnStart');
  await sleep(1000);

  // ==================== 1) 生成合法性（4 层抽样） ====================
  const gen = await ev(`(function(){
    var oldAvgW = 365;   // 旧配置 (300+430)/2
    var oldAvgH = 285;   // 旧配置 (240+330)/2
    var oldGap = 450;    // 旧布局"房间墙面之间"的平均空档（实测基线）
    var list = [];
    for (var f = 1; f <= 4; f += 1) {
      window.__roamDebug.setFloor(f);
      var rooms = state.rooms.map(function(r){
        return { id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, cx: r.cx, cy: r.cy, col: r.col, type: r.type };
      });
      var corridors = state.corridorRects.map(function(c){
        return { x: c.x, y: c.y, w: c.w, h: c.h, a: c.a, b: c.b, horiz: c.horiz };
      });
      // a) 房间两两重叠
      var overlaps = 0;
      for (var i = 0; i < rooms.length; i += 1) {
        for (var j = i + 1; j < rooms.length; j += 1) {
          var A = rooms[i], B = rooms[j];
          if (A.x < B.x + B.w && A.x + A.w > B.x && A.y < B.y + B.h && A.y + A.h > B.y) overlaps += 1;
        }
      }
      // b) 走廊穿第三间房（沿走廊长轴细采样，端点所属的两间房不算）
      var crossings = 0;
      corridors.forEach(function(c){
        for (var k = 0; k < rooms.length; k += 1) {
          var r = rooms[k];
          if (r.id === c.a || r.id === c.b) continue;
          var len = Math.max(c.w, c.h);
          var hit = false;
          for (var t = 24; t < len - 24 && !hit; t += 16) {
            var px = c.w >= c.h ? c.x + t : c.x + c.w * 0.5;
            var py = c.w >= c.h ? c.y + c.h * 0.5 : c.y + t;
            if (px > r.x + 8 && px < r.x + r.w - 8 && py > r.y + 8 && py < r.y + r.h - 8) hit = true;
          }
          if (hit) crossings += 1;
        }
      });
      // c) 走廊"墙面之间"的净空：走廊长 − 两端伸进房间的长度
      var hGaps = [], vGaps = [];
      corridors.forEach(function(c){
        if (c.w >= c.h) {
          var aRoom = rooms.filter(function(r){ return r.id === c.a; })[0];
          var bRoom = rooms.filter(function(r){ return r.id === c.b; })[0];
          if (!aRoom || !bRoom) return;
          var ovA = Math.max(0, Math.min(c.x + c.w, aRoom.x + aRoom.w) - Math.max(c.x, aRoom.x));
          var ovB = Math.max(0, Math.min(c.x + c.w, bRoom.x + bRoom.w) - Math.max(c.x, bRoom.x));
          var g = c.w - ovA - ovB;
          if (g > 2) hGaps.push(g);
        } else {
          var aR = rooms.filter(function(r){ return r.id === c.a; })[0];
          var bR = rooms.filter(function(r){ return r.id === c.b; })[0];
          if (!aR || !bR) return;
          var ovC = Math.max(0, Math.min(c.y + c.h, aR.y + aR.h) - Math.max(c.y, aR.y));
          var ovD = Math.max(0, Math.min(c.y + c.h, bR.y + bR.h) - Math.max(c.y, bR.y));
          var g2 = c.h - ovC - ovD;
          if (g2 > 2) vGaps.push(g2);
        }
      });
      var avgW = rooms.reduce(function(s, r){ return s + r.w; }, 0) / rooms.length;
      var avgH = rooms.reduce(function(s, r){ return s + r.h; }, 0) / rooms.length;
      var info = window.__roamDebug.getState();
      list.push({
        floor: info.floor,
        rooms: rooms,
        roomCount: rooms.length,
        overlaps: overlaps,
        crossings: crossings,
        avgW: avgW,
        avgH: avgH,
        ratioW: avgW / oldAvgW,
        ratioH: avgH / oldAvgH,
        hGapAvg: hGaps.length ? hGaps.reduce(function(s, g){ return s + g; }, 0) / hGaps.length : 0,
        vGapAvg: vGaps.length ? vGaps.reduce(function(s, g){ return s + g; }, 0) / vGaps.length : 0,
        hGapMax: hGaps.length ? Math.max.apply(null, hGaps) : 0,
        hGapCount: hGaps.length,
        vGapCount: vGaps.length,
        world: info.world,
        routes: info.layout ? info.layout.routes.length : 0,
        doors: info.doors ? info.doors.length : 0,
        inWorld: rooms.every(function(r){
          return r.x >= 0 && r.y >= 0 && r.x + r.w <= info.world.w && r.y + r.h <= info.world.h;
        })
      });
    }
    return list;
  })()`);

  check('世界尺寸按房间放大同步调整（3200×2300）',
    gen.every((x) => x.world.w === 3200 && x.world.h === 2300), gen.map((x) => x.world));
  // B 自由探索层：第 3/6/9… 层房间数 7–9，其余层仍为 4–7
  check('每层房间数（普通 4–7 / 开放层 7–9）',
    gen.every((x) => (x.floor % 3 === 0
      ? (x.roomCount >= 7 && x.roomCount <= 9)
      : (x.roomCount >= 4 && x.roomCount <= 7))),
    gen.map((x) => [x.floor, x.roomCount]));
  check('房间可用区下限/上限为旧版的 1.6 倍（480–688 × 384–528）',
    gen.every((x) => x.rooms.every((r) => r.w >= 480 && r.w <= 688 && r.h >= 384 && r.h <= 528)),
    gen.map((x) => x.rooms.map((r) => [Math.round(r.w), Math.round(r.h)])));
  check('平均房间宽/高相对旧版接近 1.6 倍（1.35–1.85）',
    gen.every((x) => x.ratioW >= 1.35 && x.ratioW <= 1.85 && x.ratioH >= 1.4 && x.ratioH <= 1.8),
    gen.map((x) => ({ w: Number(x.ratioW.toFixed(3)), h: Number(x.ratioH.toFixed(3)) })));
  check('房间两两不重叠', gen.every((x) => x.overlaps === 0), gen.map((x) => x.overlaps));
  check('房间全部落在世界内', gen.every((x) => x.inWorld), gen.map((x) => x.inWorld));
  check('走廊不穿过第三间房（只允许伸进自己两端）',
    gen.every((x) => x.crossings === 0), gen.map((x) => x.crossings));
  check('水平走廊净空明显缩短（平均 ≤ 270px、单条 ≤ 420px，且 ≥ 40px）',
    gen.every((x) => x.hGapCount > 0 && x.hGapAvg >= 40 && x.hGapAvg <= 270 && x.hGapMax <= 420),
    gen.map((x) => ({ avg: Math.round(x.hGapAvg), max: Math.round(x.hGapMax), n: x.hGapCount })));
  check('竖直走廊净空同样紧凑（平均 ≤ 140px）',
    gen.every((x) => x.vGapCount === 0 || x.vGapAvg <= 140),
    gen.map((x) => ({ avg: Math.round(x.vGapAvg), n: x.vGapCount })));
  check('两条路线 / 门数量正常', gen.every((x) => x.routes >= 2 && x.doors > 0),
    gen.map((x) => ({ routes: x.routes, doors: x.doors })));

  // ==================== 2) 相机：不越界 ====================
  const camEdge = await ev(`(function(){
    var W = GAME_CONFIG.worldWidth, H = GAME_CONFIG.worldHeight;
    var vw = state.viewW, vh = state.viewH;
    return { maxX: W - vw, maxY: H - vh, vw: vw, vh: vh };
  })()`);
  check('视野小于世界（相机边界限制有意义）',
    camEdge.maxX > 0 && camEdge.maxY > 0, camEdge);

  await ev('window.__roamDebug.setPlayerPos(30, 30)');
  await sleep(700);
  const camTL = await ev('({ x: state.cam.x, y: state.cam.y })');
  check('角色贴左上角时相机不越界',
    camTL.x >= -0.5 && camTL.y >= -0.5, camTL);

  await ev(`window.__roamDebug.setPlayerPos(${3200 - 30}, ${2300 - 30})`);
  await sleep(700);
  const camBR = await ev(`({ x: state.cam.x, y: state.cam.y, maxX: ${camEdge.maxX}, maxY: ${camEdge.maxY} })`);
  check('角色贴右下角时相机不越界',
    camBR.x <= camBR.maxX + 0.5 && camBR.y <= camBR.maxY + 0.5, camBR);
  await shot('camera-edge.png');

  // ==================== 3) 相机：死区软跟随（不抖） ====================
  const dead = await ev(`(function(){
    // 选一间"足够宽 + 不在最左/最右列"的房：否则相机被世界边界夹住，死区断言没有意义
    var room = state.rooms.filter(function(r){
      return r.w > 600 && r.x > 700 && r.x + r.w < GAME_CONFIG.worldWidth - 700;
    })[0] || state.rooms[0];
    window.__roamDebug.setPlayerPos(room.cx, room.cy);
    return { cx: room.cx, cy: room.cy, vw: state.viewW, vh: state.viewH, roomW: room.w, roomH: room.h, camX: state.cam.x };
  })()`);
  await sleep(700);
  // 注意：`setPlayerPos` 会顺带 snapCamera（传送语义），测死区要用"直接挪坐标"模拟走两步
  await sleep(500);
  const dead0 = await ev('({ cam: { x: state.cam.x, y: state.cam.y }, dx: state.player.x - (state.cam.x + state.viewW/2) })');
  // 小位移（远小于死区 187px）→ 相机应该几乎不动
  await ev(`(function(){
    state.player.x += ${Math.round(dead.vw * 0.05)};
    state.player.vx = 0; state.player.vy = 0;
  })()`);
  await sleep(600);
  const dead1 = await ev('({ cam: { x: state.cam.x, y: state.cam.y }, dx: state.player.x - (state.cam.x + state.viewW/2) })');
  // 大位移（累计超过死区，但仍在房间内）→ 相机必须跟上，并把玩家拉回死区边缘
  await ev(`(function(){
    state.player.x += ${Math.round(dead.vw * 0.13)};
    state.player.vx = 0; state.player.vy = 0;
  })()`);
  await sleep(900);
  const dead2 = await ev('({ cam: { x: state.cam.x, y: state.cam.y }, dx: state.player.x - (state.cam.x + state.viewW/2), dz: state.viewW * GAME_CONFIG.camDeadZone })');
  check('死区内小幅移动时相机不抖（位移 < 3px）',
    Math.abs(dead1.cam.x - dead0.cam.x) < 3 && Math.abs(dead1.cam.y - dead0.cam.y) < 3,
    { before: dead0.cam, after: dead1.cam, screenDx: Math.round(dead1.dx) });
  check('超出死区后相机跟上，并把玩家保持在死区边缘附近',
    Math.abs(dead2.cam.x - dead1.cam.x) > 20 && Math.abs(dead2.dx) <= dead2.dz + 16,
    { cam: dead2.cam, screenDx: Math.round(dead2.dx), dz: Math.round(dead2.dz) });

  // ==================== 4) 迷雾 / 小地图在新坐标下正确 ====================
  await ev('window.__roamDebug.setFloor(2)');
  await sleep(300);
  const fog0 = await ev('({ seen: Object.keys(state.fog.seenRooms).map(Number), spawn: state.spawnRoomId })');
  const fog1 = await ev(`(function(){
    var room = state.rooms.filter(function(r){ return r.id !== state.spawnRoomId; })[0];
    window.__roamDebug.setPlayerPos(room.cx, room.cy);
    return { id: room.id, cx: Math.round(room.cx), cy: Math.round(room.cy), x: room.x, y: room.y, w: room.w, h: room.h };
  })()`);
  await sleep(600);
  const fog2 = await ev('({ seen: Object.keys(state.fog.seenRooms).map(Number), stats: state.minimapStats, player: {x: state.player.x, y: state.player.y} })');
  check('开局只揭示出生房（迷雾按新坐标工作）',
    fog0.seen.length === 1 && fog0.seen[0] === fog0.spawn, fog0);
  check('走进新房间后该房被揭示',
    fog2.seen.indexOf(fog1.id) !== -1, { room: fog1.id, seen: fog2.seen });
  check('小地图已探索房间数与迷雾一致',
    fog2.stats.seenRooms === fog2.seen.length, { mini: fog2.stats.seenRooms, fog: fog2.seen.length });
  check('小地图箭头朝向与玩家朝向一致',
    await ev(`(function(){
      var st = state.minimapStats;
      var expect = typeof state.player.facingAngle === 'number'
        ? state.player.facingAngle
        : Math.atan2(mouseState.worldY - state.player.y, mouseState.worldX - state.player.x);
      return Math.abs(st.arrowAngle - expect) < 1e-6;
    })()`), { arrow: fog2.stats.arrowAngle });
  await shot('minimap-new-layout.png');

  // ==================== 5) 敌人容量与房间面积匹配 ====================
  const cap = await ev(`(function(){
    var out = [];
    for (var f = 1; f <= 3; f += 1) {
      window.__roamDebug.setFloor(f);
      var rows = state.rooms.map(function(r){
        var n = state.enemies.filter(function(e){ return e.roomId === r.id && e.alive !== false; }).length;
        return { id: r.id, type: r.type, area: Math.round(r.w * r.h), count: n,
                 mul: r.enemyAreaMul == null ? null : Number(r.enemyAreaMul.toFixed(3)),
                 elite: isEliteRouteRoom(r.id) };
      }).filter(function(r){ return r.type !== 'spawn'; });
      out.push(rows);
    }
    return { floors: out, ref: GAME_CONFIG.roomAreaRef };
  })()`);
  const capFlat = cap.floors.flat().filter((r) => r.count > 0);
  check('单房敌人数不超过难度上限 7',
    cap.floors.every((rows) => rows.every((r) => r.count <= 7)),
    cap.floors.map((rows) => rows.map((r) => r.count)));
  check('敌人容量系数严格按面积计算（clamp(面积/266000, 0.85, 1.5)）',
    cap.floors.every((rows) => rows.filter((r) => r.mul != null).every((r) => {
      const expect = Math.max(0.85, Math.min(1.5, r.area / cap.ref));
      return Math.abs(r.mul - expect) < 0.02;
    })),
    cap.floors.map((rows) => rows.filter((r) => r.mul != null).map((r) => [r.area, r.mul])));
  check('同等路线内：面积更大 → 敌人容量系数更高（单调不减）',
    cap.floors.every((rows) => {
      const groups = [rows.filter((r) => !r.elite && r.mul != null), rows.filter((r) => r.elite && r.mul != null)];
      return groups.every((battle) => {
        for (let i = 0; i < battle.length; i += 1) {
          for (let j = i + 1; j < battle.length; j += 1) {
            const A = battle[i], B = battle[j];
            if (A.mul == null || B.mul == null) continue;
            const big = A.area > B.area ? A : B;
            const small = A.area > B.area ? B : A;
            if (big.mul < small.mul) return false;
          }
        }
        return true;
      });
    }),
    cap.floors.map((rows) => rows.filter((r) => r.mul != null).map((r) => [r.area, r.mul, r.elite ? 'E' : 'N'])));
  check('敌人总量没有随房间放大失控（每层 ≤ 7×房间数）',
    cap.floors.every((rows) => rows.reduce((s, r) => s + r.count, 0) <= 7 * rows.length),
    cap.floors.map((rows) => rows.reduce((s, r) => s + r.count, 0)));
  check('战斗房确实有敌人（容量计算生效）', capFlat.length >= 2, capFlat.length);

  // ==================== 6) 秘藏房 / 裂隙在新世界内不越界 ====================
  const extras = await ev(`(function(){
    var out = [];
    for (var f = 1; f <= 3; f += 1) {
      window.__roamDebug.setFloor(f);
      var s = window.__roamDebug.getState();
      var W = GAME_CONFIG.worldWidth, H = GAME_CONFIG.worldHeight;
      var info = { floor: s.floor, hidden: null, rift: null };
      if (state.hiddenRoom) {
        var h = state.hiddenRoom;
        var hit = state.rooms.some(function(r){
          return h.x < r.x + r.w && h.x + h.w > r.x && h.y < r.y + r.h && h.y + h.h > r.y;
        });
        info.hidden = { inWorld: h.x >= 0 && h.y >= 0 && h.x + h.w <= W && h.y + h.h <= H, roomOverlap: hit, host: h.hostId };
      }
      if (state.voidRift) {
        var rf = state.voidRift;
        var room = state.rooms.filter(function(r){ return r.id === rf.sourceId; })[0];
        var inside = !!room && rf.x > room.x && rf.x < room.x + room.w && rf.y > room.y && rf.y < room.y + room.h;
        info.rift = { inWorld: rf.x >= 0 && rf.y >= 0 && rf.x <= W && rf.y <= H, insideRoom: inside, source: rf.sourceId, target: rf.targetId };
      }
      out.push(info);
    }
    return out;
  })()`);
  check('秘藏房落在世界内且不与普通房重叠',
    extras.every((x) => !x.hidden || (x.hidden.inWorld && !x.hidden.roomOverlap)),
    extras.map((x) => x.hidden));
  check('虚空裂隙落在源房间内且在世界内',
    extras.every((x) => !x.rift || (x.rift.inWorld && x.rift.insideRoom)),
    extras.map((x) => x.rift));

  // ==================== 7) 性能（设备像素比 1.5） ====================
  await ev('window.__roamDebug.setFloor(3); window.__roamDebug.centerPlayer(); window.__roamDebug.cast(-1);');
  // 换层会触发一次性场景烘焙（含 A1 新增材质），fps 采样窗口按 1 秒结算；
  // 先等 2600ms 让"烘焙帧"完全移出采样窗口，再测稳态帧率（阈值 100 不放宽）。
  await sleep(2600);
  const fpsSamples = [];
  for (let i = 0; i < 6; i += 1) {
    await sleep(450);
    fpsSamples.push(await ev('({ fps: perfState.fps, scale: sceneScale, scene: state.scenePatch, draw: state.drawStats })'));
  }
  const fpsVals = fpsSamples.map((s) => s.fps).filter((v) => v > 0);
  const fpsMin = Math.min(...fpsVals);
  const fpsAvg = Math.round(fpsVals.reduce((a, b) => a + b, 0) / fpsVals.length);
  const frameMs = +(1000 / fpsAvg).toFixed(2);
  check('帧率 ≥ 100（dpr 1.5 烘焙底图）', fpsVals.length >= 4 && fpsMin >= 100,
    { min: fpsMin, avg: fpsAvg, samples: fpsVals });
  check('每帧耗时 < 10ms', frameMs < 10, { frameMs, fpsAvg });
  check('底图裁剪块与对象池统计正常',
    !!fpsSamples[fpsSamples.length - 1].scene && typeof fpsSamples[fpsSamples.length - 1].draw.particles === 'number',
    { scale: fpsSamples[0].scale, scene: fpsSamples[fpsSamples.length - 1].scene, draw: fpsSamples[fpsSamples.length - 1].draw });

  // ==================== 8) 报错 ====================
  const errors = await ev('window.__roamDebug.errors ? window.__roamDebug.errors() : []');
  check('运行期无 JS 报错', Array.isArray(errors) && errors.length === 0, errors.slice(0, 3));

  fs.writeFileSync(path.join(OUT, 'm24-result.json'),
    JSON.stringify({ results, env: { dpr: 1.5, fps: { min: fpsMin, avg: fpsAvg, frameMs } } }, null, 2));

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${passed}/${results.length}`);
  if (passed !== results.length) process.exitCode = 1;
  killEdge(edge);
}

main().catch((err) => { console.error(err); process.exit(1); });
