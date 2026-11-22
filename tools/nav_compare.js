/**
 * P2 导航 · 房数/门数普查 + 三刀同机位对照探针（只读）
 * ------------------------------------------------------------
 * 用法：
 *   node tools/nav_compare.js <html路径> <tag> census
 *   node tools/nav_compare.js <html路径> <tag> nav [房间序号]
 *
 * 为什么能"同机位"：generateFloor() 在 seedActive() 为真时，
 * 整层生成挂到 (seed, floor) 这条独立随机流上（见 index_arcane_v2.html 内注释）。
 * 所以探针只要在开局后写 state.seedInfo = {active:true, value:'NAVCMP'}，
 * baseline 与当前文件就会生成逐坐标相同的房间/走廊/门，截图才能一比一。
 *
 * census：固定种子下连生成 1–10 层，报每层 rooms/doors/corridors 与同墙重复门；
 * nav   ：固定种子下生成指定层，产出 门牌 / 小地图 / 全屏地图 / 指北针静止与移动 截图。
 * 输出：.screenshots/firstplay/nav-census-<tag>.json、nav-<tag>-*.png
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html'));
const TAG = process.argv[3] || 'after';
const MODE = process.argv[4] || 'census';
const ROOM_ARG = process.argv[5] != null ? Number(process.argv[5]) : null;
const OUT = path.resolve(__dirname, '..', '.screenshots', 'firstplay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 建连并打开指定文件
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
  const shot = async (name, clip) => {
    /* CDP 的 clip 必须是 double：这里统一取整，任一字段不是有限数字就直接跳过（不猜坐标） */
    let params = { format: 'png' };
    if (clip) {
      const c = { x: Number(clip.x), y: Number(clip.y), width: Number(clip.width), height: Number(clip.height), scale: 1 };
      if (![c.x, c.y, c.width, c.height].every((v) => Number.isFinite(v)) || c.width <= 0 || c.height <= 0) {
        throw new Error('bad-clip ' + name + ' ' + JSON.stringify(clip));
      }
      params.clip = c;
    }
    const r = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  return { edge, ws, send, ev, shot };
}

/**
 * 统计一层里的门/房间结构：门总数、同墙 64px 内重复门、门牌是否指向墙外
 * @returns {string} 可注入 Runtime.evaluate 的表达式
 */
function censusExpr(floorNumber) {
  return `(function(){
    generateFloor(${floorNumber});
    var normals = { top:[0,-1], bottom:[0,1], left:[-1,0], right:[1,0] };
    var wrong = 0, closePairs = 0, pairs = {}, perRoom = {}, wrongByCorridor = 0;
    (state.doors || []).forEach(function(d){
      perRoom[d.roomId] = (perRoom[d.roomId] || 0) + 1;
      var key = d.roomId + ':' + d.side;
      (pairs[key] = pairs[key] || []).push(d);
      if (d.targetRoomId < 0) return;
      var r = state.rooms[d.targetRoomId];
      var n = normals[d.side] || [0,1];
      if (!r || (r.cx - d.x) * n[0] + (r.cy - d.y) * n[1] <= 0) {
        wrong += 1;
        /* 这扇门的标签是否来自"走廊另一端"（是则标签本身没错，只是走廊是斜的） */
        for (var ci = 0; ci < state.corridorRects.length; ci += 1) {
          var c = state.corridorRects[ci];
          if (d.x < c.x - 4 || d.x > c.x + c.w + 4) continue;
          if (d.y < c.y - 4 || d.y > c.y + c.h + 4) continue;
          var other = c.a === d.roomId ? c.b : (c.b === d.roomId ? c.a : -1);
          if (other === d.targetRoomId) { wrongByCorridor += 1; break; }
        }
      }
    });
    Object.keys(pairs).forEach(function(k){
      var a = pairs[k].slice().sort(function(x,y){ return (x.x + x.y) - (y.x + y.y); });
      for (var i = 1; i < a.length; i += 1) {
        if (Math.hypot(a[i].x - a[i-1].x, a[i].y - a[i-1].y) < 64) closePairs += 1;
      }
    });
    var maxPerRoom = 0;
    Object.keys(perRoom).forEach(function(k){ maxPerRoom = Math.max(maxPerRoom, perRoom[k]); });
    return { floor: ${floorNumber}, rooms: state.rooms.length, doors: (state.doors||[]).length,
      corridors: (state.corridorRects||[]).length, sameWallPairs: closePairs,
      labelWrongSide: wrong, labelWrongFromCorridor: wrongByCorridor, maxDoorsInOneRoom: maxPerRoom,
      roomsRect: state.rooms.map(function(r){ return [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)]; }) };
  })()`;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { edge, ws, send, ev, shot } = await connect();
  const report = { file: FILE, tag: TAG, mode: MODE, steps: {} };

  /* hud 模式：按 844×390 横屏实测（必须在 Page.navigate 之前设，媒体查询才会生效） */
  if (MODE === 'hud') {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 1, mobile: false, screenWidth: 844, screenHeight: 390
    });
  }

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
  /* 固定种子：让 baseline 与当前文件生成同一套房间/门 */
  await ev(`(function(){ state.seedInfo = { active: true, value: 'NAVCMP' }; return state.seedInfo; })()`);

  if (MODE === 'cast') {
    /* L 线三条实测：前摇时长/分型、签名环位置、出手时刻、后摇压速 */
    await ev(censusExpr(1));
    await sleep(600);
    report.steps.config = await ev(`(function(){
      return { windup: { fireball: castWindupOf('fireball'), mine: castWindupOf('mine'),
          blade: castWindupOf('blade'), frostRing: castWindupOf('frostRing') },
        shape: { fireball: castShapeOf('fireball'), mine: castShapeOf('mine'),
          frostRing: castShapeOf('frostRing'), bolt: castShapeOf('bolt') },
        recover: CAST_WINDUP_CONFIG.recover };
    })()`);
    /* 三型签名环：直接调用 spawnCastSignet，看环心相对玩家的偏移 */
    report.steps.rings = await ev(`(function(){
      state.enemies = [];
      /* 无头 Edge 默认命中 prefers-reduced-motion；拍照/取样前先关掉，否则只会看到那枚静态环 */
      var origMM = window.matchMedia;
      window.matchMedia = function(q){ return { matches: false, media: q, addListener: function(){}, removeListener: function(){} }; };
      function sample(id) {
        state.rings = [];
        spawnCastSignet({ id: id, rarity: 'common' }, null);
        return state.rings.map(function(r){
          return { dx: Math.round(r.x - state.player.x), dy: Math.round(r.y - state.player.y),
            radius: Math.round(r.radius), grow: Math.round(r.grow), life: Number(r.life.toFixed(2)) };
        });
      }
      var out = { direct: sample('fireball'), point: sample('mine'), ring: sample('frostRing') };
      window.matchMedia = origMM;
      return out;
    })()`);
    /* 真前摇：手动按 1/120s 步进队列（无头浏览器 rAF 会被节流到 3–4fps，不能靠 rAF 计时） */
    report.steps.live = await ev(`(function(){
      state.enemies = [];
      state.rings = [];
      state.player.castRecover = 0;
      state.ownedMagic = Object.keys(MAGIC_BY_ID).slice();
      state.activeMagicId = 'fireball';
      state.cooldowns = {};
      state.castQueue = [];
      var n0 = state.projectiles.length + state.bullets.length;
      var rings0 = state.rings.length;
      var errs = [];
      var oldErr = window.onerror;
      window.onerror = function(msg){ errs.push(String(msg)); };
      var ok = castSlot(0, true);
      var queuedAtPress = state.castQueue.length;
      var t = 0, firedAt = null, projectilesAtFire = -1;
      for (var i = 0; i < 40 && state.castQueue.length; i += 1) {
        updateCastQueue(1 / 120);
        t += 1 / 120;
      }
      if (!state.castQueue.length) {
        firedAt = Number(t.toFixed(3));
        projectilesAtFire = state.projectiles.length + state.bullets.length;
      }
      return { castAccepted: ok, queuedAtPress: queuedAtPress,
        secondsUntilRelease: firedAt, projectilesBefore: n0, projectilesAtRelease: projectilesAtFire,
        ringsAtPress: rings0, ringsAtRelease: state.rings.length, errors: errs,
        recoverAfterRelease: Number((state.player.castRecover || 0).toFixed(3)) };
    })()`);
    /* 后摇代价：同样走 6 帧，比较"无后摇"与"后摇 70ms"的位移（直接调 updatePlayer，脱离 rAF） */
    report.steps.recover = await ev(`(function(){
      var p = state.player;
      var room = state.rooms[0];
      function walk(rec, frames) {
        p.x = room.cx; p.y = room.cy; p.vx = 0; p.vy = 0;
        if (state.keys) state.keys.right = true;
        /* 先空跑 40 帧把速度拉到巡航，再回到起点只量这 frames 帧（玩家施法时通常已经在跑） */
        for (var w = 0; w < 40; w += 1) updatePlayer(1 / 60);
        p.x = room.cx; p.y = room.cy;
        var vBefore = Math.round(Math.abs(p.vx));
        var x0 = p.x;
        for (var i = 0; i < frames; i += 1) { p.castRecover = rec; updatePlayer(1 / 60); }
        if (state.keys) state.keys.right = false;
        return { d: Number((p.x - x0).toFixed(2)), v: vBefore };
      }
      var plain = walk(0, 12);
      var slow = walk(0.07, 12);
      /* 70ms ≈ 4.2 帧：单独量"后摇窗口内"的位移，避免 12 帧里的恢复尾巴把瞬时降幅稀释 */
      var plain70 = walk(0, 4);
      var slow70 = walk(0.07, 4);
      var inst = Number((100 * (1 - slow.d / plain.d)).toFixed(1));
      var inst70 = Number((100 * (1 - slow70.d / plain70.d)).toFixed(1));
      /* 按 0.45s 冷却折算：后摇只占冷却的 70/450，其余时间满速 → 平均降幅 = 瞬时降幅 × 占比 */
      var cdSec = 0.45;
      return { cruiseSpeed: plain.v, pxPer12FramesNormal: plain.d, pxPer12FramesWithRecover: slow.d,
        lossPct: inst, pxPer70msNormal: plain70.d, pxPer70msWithRecover: slow70.d, lossPct70ms: inst70,
        recoverMs: 70, cooldownSec: cdSec,
        avgLossPct: Number((inst70 * 0.07 / cdSec).toFixed(2)) };
    })()`);
  } else if (MODE === 'hud') {
    /* ③ 指北针安全区实测：844×390 横屏，六方位逐一量"与地图/卡组/技能坞"的重叠面积 */
    await ev(censusExpr(1));
    await sleep(300);
    const hud = await ev(`(function(){
      var p = state.player;
      if (state.keys) { state.keys.left = state.keys.right = state.keys.up = state.keys.down = false; }
      p.vx = 0; p.vy = 0;
      if (state.fog) state.fog.seenRooms = {};
      function rectOf(el) {
        if (!el) return null;
        var b = el.getBoundingClientRect();
        return { left: +b.left.toFixed(1), top: +b.top.toFixed(1), right: +b.right.toFixed(1),
          bottom: +b.bottom.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1) };
      }
      function inter(a, b) {
        if (!a || !b) return 0;
        var x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        var y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return (x > 0 && y > 0) ? +(x * y).toFixed(1) : 0;
      }
      var canvas = document.getElementById('game');
      var cr = canvas.getBoundingClientRect();
      var targets = {
        hudDeck: document.querySelector('.hud-deck'),
        btnMapDock: document.getElementById('btnMapDock'),
        btnSkillDock: document.getElementById('btnSkillDock'),
        minimapPanel: document.querySelector('.minimap-panel'),
        mapPanel: document.getElementById('mapPanel')
      };
      var targetRects = {};
      var targetVisible = {};
      /* 只统计"当前真的占屏"的元素：#mapPanel 是隐藏的全屏层，rect 仍是整屏，
         不加可见性判断会把 2996px² 的误报算成重叠。 */
      function styleVisible(el) {
        if (!el) return false;
        var s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.02) return false;
        var b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      }
      Object.keys(targets).forEach(function (k) {
        targetVisible[k] = styleVisible(targets[k]);
        targetRects[k] = targetVisible[k] ? rectOf(targets[k]) : null;
      });
      var orig = state.doors;
      var dirs = [['down', 0, 600], ['down-left', -600, 600], ['down-right', 600, 600],
        ['left', -600, 0], ['right', 600, 0], ['up', 0, -600],
        /* 极端角度：贴近正下方但偏一点，最容易把胶囊推进左右底角 dock（170°/10°/160°/20°） */
        ['left-170', -600, 106], ['right-10', 600, 106],
        ['left-160', -600, 218], ['right-20', 600, 218]];
      var cases = dirs.map(function (d) {
        p.x = state.rooms[0].cx; p.y = state.rooms[0].cy;
        if (typeof snapCamera === 'function') snapCamera();
        state.doors = [{ x: p.x + d[1], y: p.y + d[2], targetRoomId: 9999, roomId: -1, side: 'bottom' }];
        state.compassIdle = 3.2;
        updateEdgeCompass(0.016);
        var el = document.getElementById('edgeCompass');
        var label = document.getElementById('edgeCompassLabel');
        var box = rectOf(el);
        var lbox = rectOf(label);
        var overlap = {};
        var total = 0;
        Object.keys(targetRects).forEach(function (k) {
          overlap[k] = inter(box, targetRects[k]);
          total += overlap[k];
        });
        return { dir: d[0], hidden: el.classList.contains('is-hidden'), box: box, label: lbox,
          overlap: overlap, overlapTotal: +total.toFixed(1),
          insideCanvas: !!(box && box.left >= cr.left - 0.5 && box.right <= cr.right + 0.5
            && box.top >= cr.top - 0.5 && box.bottom <= cr.bottom + 0.5),
          labelClipped: label ? (label.scrollWidth > label.clientWidth + 1) : true,
          labelText: label ? label.textContent : '' };
      });
      state.doors = orig;
      return { viewport: { w: innerWidth, h: innerHeight }, canvas: rectOf(canvas),
        targets: targetRects, visible: targetVisible, cases: cases };
    })()`);
    report.steps.hud = hud;
    await shot(`nav-${TAG}-hud-844x390.png`);
    /* 最靠下的那个方位单独裁一张，方便肉眼核对"胶囊底边在卡组上方、字没被吃掉" */
    const worst = (hud.cases || []).filter((c) => c.box).sort((a, b) => b.box.bottom - a.box.bottom)[0];
    if (worst) {
      report.steps.hudCrop = {
        dir: worst.dir,
        x: Math.max(0, worst.box.left - 30), y: Math.max(0, worst.box.top - 30),
        width: Math.min(300, hud.viewport.w), height: Math.min(160, hud.viewport.h)
      };
      await shot(`nav-${TAG}-hud-crop.png`, report.steps.hudCrop);
    }
  } else if (MODE === 'perf') {
    /* 帧时实测：固定种子进第 3 层（有 3–6 只怪 + 区域怪），采样 300 帧取 p50/p95/p99 */
    await ev(censusExpr(3));
    await sleep(800);
    report.steps.perf = await ev(`new Promise(function(resolve){
      var deltas = [], last = performance.now(), n = 0;
      function tick(now) {
        n += 1;
        if (n > 30) deltas.push(now - last);
        last = now;
        if (n < 330) { requestAnimationFrame(tick); return; }
        deltas.sort(function(a,b){ return a-b; });
        function pick(p){ return Number(deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * p))].toFixed(2)); }
        resolve({ frames: deltas.length, enemies: (state.enemies || []).length,
          p50: pick(0.5), p95: pick(0.95), p99: pick(0.99) });
      }
      requestAnimationFrame(tick);
    })`);
  } else if (MODE === 'census') {
    const rows = [];
    for (let f = 1; f <= 10; f += 1) rows.push(await ev(censusExpr(f)));
    report.steps.rows = rows;
    /* 房间数分布直接由 rows 汇总，便于"改前/改后"逐层对齐 */
    report.steps.summary = {
      rooms: rows.map((r) => r.rooms),
      doors: rows.map((r) => r.doors),
      corridors: rows.map((r) => r.corridors),
      sameWallPairsTotal: rows.reduce((s, r) => s + r.sameWallPairs, 0),
      labelWrongTotal: rows.reduce((s, r) => s + r.labelWrongSide, 0)
    };
  } else {
    /* ---------- nav：门牌 / 小地图 / 全屏地图 / 指北针 ---------- */
    const floorNumber = 1;
    const census = await ev(censusExpr(floorNumber));
    report.steps.census = census;
    const rooms = census.roomsRect || [];
    /* 选焦点房：优先用传入的序号；不传就选"门最多"的那间（同层同种子两边会选到同一间） */
    let focus = ROOM_ARG;
    if (focus == null) {
      const perRoom = await ev(`(function(){ var m={}; (state.doors||[]).forEach(function(d){ m[d.roomId]=(m[d.roomId]||0)+1; }); var best=0,bn=-1; Object.keys(m).forEach(function(k){ if(m[k]>bn){bn=m[k];best=Number(k);} }); return best; })()`);
      focus = typeof perRoom === 'number' ? perRoom : 0;
    }
    report.steps.focusRoom = focus;

    /* 1) 门牌：把相机对到焦点房中心，同一坐标 → 同一机位 */
    report.steps.doorCam = await ev(`(function(){
      state.enemies = [];
      var room = state.rooms[${focus}];
      if (!room) return { err: 'no-room' };
      state.player.x = room.cx; state.player.y = room.cy;
      state.player.vx = 0; state.player.vy = 0;
      state.fog.seenRooms[room.id] = true;
      if (typeof snapCamera === 'function') snapCamera();
      var zoom = cameraZoom();
      var sx = Math.round((room.cx - state.cam.x) * zoom);
      var sy = Math.round((room.cy - state.cam.y) * zoom);
      return { room: { id: room.id, x: Math.round(room.x), y: Math.round(room.y), w: Math.round(room.w), h: Math.round(room.h) },
        zoom: Number(zoom.toFixed(2)), sx: sx, sy: sy,
        doorsInRoom: (state.doors || []).filter(function(d){ return d.roomId === room.id; })
          .map(function(d){ return { side: d.side, x: Math.round(d.x), y: Math.round(d.y), target: d.targetRoomId }; }) };
    })()`);
    await sleep(300);
    if (!report.steps.doorCam.err) {
      const c = report.steps.doorCam;
      const clip = { x: Math.max(0, c.sx - 330), y: Math.max(0, c.sy - 250), width: 660, height: 500 };
      await shot(`nav-${TAG}-doors.png`, clip);
      report.steps.doorCrop = clip;
    }

    /* 2) 小地图：裁剪 #minimap 画布本体（走廊亮度 0.1 → 0.28 看这里） */
    report.steps.minimap = await ev(`(function(){
      var el = document.getElementById('minimap');
      var b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    })()`);
    await shot(`nav-${TAG}-minimap.png`, {
      x: report.steps.minimap.x, y: report.steps.minimap.y,
      width: report.steps.minimap.w, height: report.steps.minimap.h
    });

    /* 3) 全屏地图：点开地图坞，等一帧后裁剪 #mapCanvas */
    await ev(`(function(){ var b=document.getElementById('btnMapDock'); if(b) b.click(); return true; })()`);
    await sleep(600);
    report.steps.mapPanel = await ev(`(function(){
      var p = document.getElementById('mapPanel');
      var c = document.getElementById('mapCanvas');
      var b = c.getBoundingClientRect();
      return { open: p ? !p.classList.contains('is-hidden') && p.getAttribute('aria-hidden') !== 'true' : false,
        x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    })()`);
    if (report.steps.mapPanel.w > 10) {
      await shot(`nav-${TAG}-map.png`, {
        x: report.steps.mapPanel.x, y: report.steps.mapPanel.y,
        width: report.steps.mapPanel.w, height: report.steps.mapPanel.h
      });
    }
    await ev(`(function(){ var b=document.getElementById('mapClose'); if(b) b.click(); return true; })()`);
    await sleep(300);

    /* 4) 指北针：先真静止 3.3s 截"出现"，再按住 D 截"移动时消失" */
    await ev(`(function(){
      var room = state.rooms[${focus}];
      state.player.x = room.cx; state.player.y = room.cy;
      state.player.vx = 0; state.player.vy = 0;
      if (state.keys) { state.keys.left = false; state.keys.right = false; state.keys.up = false; state.keys.down = false; }
      if (typeof snapCamera === 'function') snapCamera();
      return true;
    })()`);
    await sleep(3400);
    report.steps.compassIdle = await ev(`(function(){
      var el = document.getElementById('edgeCompass');
      var b = el.getBoundingClientRect();
      return { hidden: el.classList.contains('is-hidden'),
        label: (document.getElementById('edgeCompassLabel')||{}).textContent || '',
        x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    })()`);
    await shot(`nav-${TAG}-compass-idle.png`);
    /* baseline 还没有 #edgeCompass 这个元素：记 missing，不裁小图（不猜坐标） */
    if (report.steps.compassIdle && report.steps.compassIdle.__err) {
      report.steps.compassIdle = { missingElement: true, note: report.steps.compassIdle.__err };
    }
    report.steps.compassIdleCrop = (!report.steps.compassIdle || report.steps.compassIdle.hidden
      || !Number.isFinite(Number(report.steps.compassIdle.x))) ? null : {
      x: Math.max(0, report.steps.compassIdle.x - 90), y: Math.max(0, report.steps.compassIdle.y - 60),
      width: 260, height: 200
    };
    if (report.steps.compassIdleCrop) await shot(`nav-${TAG}-compass-idle-crop.png`, report.steps.compassIdleCrop);
    await ev(`(function(){ if(state.keys) state.keys.right = true; state.player.vx = 180; return true; })()`);
    await sleep(220);
    report.steps.compassMove = await ev(`(function(){
      var el = document.getElementById('edgeCompass');
      return { hidden: el.classList.contains('is-hidden'), idle: Number((state.compassIdle||0).toFixed(2)) };
    })()`);
    await shot(`nav-${TAG}-compass-move.png`);
    await ev(`(function(){ if(state.keys) state.keys.right = false; return true; })()`);
  }

  fs.writeFileSync(path.join(OUT, `nav-census-${TAG}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.steps, null, 2));

  try { ws.close(); } catch (e) { /* 已关闭 */ }
  killEdge(edge);
}

main().catch((e) => { console.error(e); process.exit(1); });
