/**
 * 房间进入流程现状探针（只读，不改游戏逻辑）
 * ------------------------------------------------------------
 * 目的：回答"这一局是怎么被送进第一间房的、有没有选择界面、选择界面能拿到什么信息"。
 * 做法：
 *   1) 用固定种子 261108 开局（__roamDebug.startSeed），截图 t0/250/700/1600/3200ms；
 *   2) 读出起始房、门的数量、每扇门的目标房型、门牌/信息板的可见状态；
 *   3) 逐步把玩家从房心挪到门口 → 走廊 → 下一间房，连拍 4 帧（模拟"选择→进房"）。
 * 用法：node tools/arcane_roomentry_probe.js [--seed=261108]
 * 输出：.screenshots/roomentry/*.png + roomentry-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9531;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'roomentry');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析命令行参数
 * @returns {{seed:string}} 种子字符串
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const pick = (k, d) => {
    const hit = a.find((x) => x.startsWith('--' + k + '='));
    return hit ? hit.slice(k.length + 3) : d;
  };
  const seeds = pick('seeds', '261108,42,7,20260101,9001,555,31337,777777').split(',').map((s) => s.trim()).filter(Boolean);
  const floors = pick('floors', '1,2,3,4,5').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
  return { seed: pick('seed', '261108'), seeds, floors };
}

/**
 * 启动无头 Edge 并连上 CDP
 * @returns {Promise<{ev:Function, send:Function, shot:Function, close:Function}>}
 */
async function boot() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile(PORT);
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(proc); throw new Error('Edge 调试端口未就绪'); }

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
  for (let i = 0; i < 120; i += 1) {
    await sleep(250);
    try { if (await ev(`typeof state !== 'undefined'`)) break; } catch (e) { /* 仍在解析 */ }
  }
  const close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } killEdge(proc); };
  return { ev, send, shot, close };
}

async function main() {
  const { seed, seeds, floors } = parseArgs();
  const h = await boot();
  const out = { seed, frames: [], state: null, doors: [], seq: [] };
  try {
    // ---------- 1) 固定种子开局，抓进入战斗后的前 3.2 秒 ----------
    await h.shot('00-title.png');
    const started = await h.ev(`(function(){
      var r = window.__roamDebug.p2.startSeed('${seed}');
      return { r: r, mode: state.mode, status: state.status, charOpen: __charSelectOpen };
    })()`);
    out.started = started;

    const timeline = [0, 250, 700, 1600, 3200];
    let prev = 0;
    for (let i = 0; i < timeline.length; i += 1) {
      await sleep(timeline[i] - prev);
      prev = timeline[i];
      await h.shot('01-enter-' + String(i).padStart(2, '0') + '-' + timeline[i] + 'ms.png');
      out.frames.push({ at: timeline[i], roomId: await h.ev(`state.currentRoomId`) });
    }

    // ---------- 2) 起始房 + 门 + 信息可见性 ----------
    out.state = await h.ev(`(function(){
      var sr = state.rooms[state.spawnRoomId] || state.rooms[state.currentRoomId];
      var doors = (state.doors || []).filter(function(d){ return d.roomId === sr.id; });
      return {
        floor: state.floor, roomId: sr.id, type: sr.type, shape: roomShapeOf(sr),
        w: Math.round(sr.w), h: Math.round(sr.h),
        player: { x: Math.round(state.player.x), y: Math.round(state.player.y) },
        doorsInRoom: doors.length,
        roomTypes: state.rooms.map(function(r){ return r.type; }),
        doorInfoStats: JSON.parse(JSON.stringify(DOOR_INFO_STATS)),
        doorVisStats: JSON.parse(JSON.stringify(DOOR_VIS_STATS)),
        minRooms: GAME_CONFIG.floorMinRooms, maxRooms: GAME_CONFIG.floorMaxRooms
      };
    })()`);

    out.doors = await h.ev(`(function(){
      var sr = state.rooms[state.spawnRoomId];
      var rows = [];
      (state.doors || []).forEach(function(d){
        if (d.roomId !== sr.id || d.targetRoomId < 0) return;
        var vis = doorVisFor(d);
        var info = doorInfoFor(d);
        rows.push({
          side: d.side,
          x: Math.round(d.x), y: Math.round(d.y),
          distFromPlayer: Math.round(Math.hypot(d.x - state.player.x, d.y - state.player.y)),
          targetRoomId: d.targetRoomId,
          targetType: state.rooms[d.targetRoomId] ? state.rooms[d.targetRoomId].type : null,
          vis: vis ? { label: vis.label, unknown: vis.unknown, state: vis.state } : null,
          info: info ? { typeName: info.typeName, riskLabel: info.riskLabel, tip: info.tip, unknown: info.unknown } : null,
          eliteRoute: !!d.eliteRoute,
          priced: !!(state.rooms[d.targetRoomId] && state.rooms[d.targetRoomId].pricedTag)
        });
      });
      return rows;
    })()`);

    // ---------- 3) 模拟"走向一扇门 → 进走廊 → 进下一间房"连拍 4 帧 ----------
    const route = await h.ev(`(function(){
      var sr = state.rooms[state.spawnRoomId];
      var d = (state.doors || []).find(function(x){ return x.roomId === sr.id && x.targetRoomId >= 0; });
      if (!d) {
        d = (state.doors || []).find(function(x){ return x.targetRoomId >= 0 && x.roomId === state.currentRoomId; });
      }
      if (!d) return null;
      var t = state.rooms[d.targetRoomId];
      /* 门心朝房内的法线：门在墙上，房心方向就是朝内 */
      var nx = sr.cx - d.x, ny = sr.cy - d.y;
      var len = Math.max(1, Math.hypot(nx, ny));
      nx /= len; ny /= len;
      /* 走廊中点：门心再朝外 60px */
      var cx = d.x - nx * 60, cy = d.y - ny * 60;
      return {
        door: { x: Math.round(d.x), y: Math.round(d.y), side: d.side },
        room: { cx: Math.round(sr.cx), cy: Math.round(sr.cy) },
        target: { id: t.id, type: t.type, cx: Math.round(t.cx), cy: Math.round(t.cy) },
        corridor: { x: Math.round(cx), y: Math.round(cy) },
        n: { x: nx, y: ny }
      };
    })()`);
    out.route = route;

    if (route) {
      const stops = [
        { name: '02-a-room-center', x: route.room.cx, y: route.room.cy },
        { name: '02-b-near-door', x: Math.round(route.door.x + route.n.x * 70), y: Math.round(route.door.y + route.n.y * 70) },
        { name: '02-c-in-doorway', x: route.door.x, y: route.door.y },
        { name: '02-d-next-room', x: route.target.cx, y: route.target.cy }
      ];
      for (const s of stops) {
        await h.ev(`(function(){
          state.player.x = ${s.x}; state.player.y = ${s.y};
          state.player.vx = 0; state.player.vy = 0;
          state.mode = 'playing'; state.status = 'playing';
          return true;
        })()`);
        await sleep(170);
        await h.shot(s.name + '.png');
        out.seq.push(await h.ev(`(function(){
          return {
            currentRoomId: state.currentRoomId,
            player: { x: Math.round(state.player.x), y: Math.round(state.player.y) },
            doorInfoStats: JSON.parse(JSON.stringify(DOOR_INFO_STATS)),
            doorVisStats: JSON.parse(JSON.stringify(DOOR_VIS_STATS)),
            toast: (document.querySelector('#toast, .toast') || {}).textContent || ''
          };
        })()`));
      }
    }

    // ---------- 4) 多种子：起始房到底有几扇门（决定"有没有得选"） ----------
    out.layouts = await h.ev(`(function(){
      var seeds = ${JSON.stringify(seeds)};
      var flist = ${JSON.stringify(floors)};
      var rows = [];
      seeds.forEach(function(sd){
        flist.forEach(function(f){
          /* 种子局里 generateFloor 会用 (state.seedInfo.value, floor) 重建随机流，
             所以这里必须改 seedInfo，手写 __rngOverride 会被它覆盖掉。 */
          state.seedInfo = { active: true, value: sd, daily: false, custom: true, startedAt: 0 };
          __rngOverride = null;
          __roamDebug.setFloor(f);
          var spawn = state.rooms.find(function(r){ return r.id === state.spawnRoomId; }) || state.rooms[0];
          var doors = (state.doors || []).filter(function(d){ return d.targetRoomId >= 0; });
          var spawnDoors = doors.filter(function(d){ return d.roomId === spawn.id; });
          /* 图上起始房的度数：和真实门数对比，用来区分"设计上就是叶子房"与"边在、门丢了" */
          var edges = (state.floorGraph && state.floorGraph.edges) || [];
          var spawnDegree = edges.filter(function(e){
            return e[0] === spawn.id || e[1] === spawn.id;
          }).length;
          var spawnNeighbors = edges.filter(function(e){
            return e[0] === spawn.id || e[1] === spawn.id;
          }).map(function(e){ return e[0] === spawn.id ? e[1] : e[0]; });
          var multi = 0;
          state.rooms.forEach(function(r){
            var n = doors.filter(function(d){ return d.roomId === r.id; }).length;
            if (n >= 2) multi += 1;
          });
          rows.push({
            seed: sd, floor: f, rooms: state.rooms.length,
            spawnRoomId: spawn.id, spawnType: spawn.type, spawnShape: roomShapeOf(spawn),
            spawnDoors: spawnDoors.length,
            spawnDegree: spawnDegree,
            spawnNeighbors: spawnNeighbors,
            spawnDoorTargets: spawnDoors.map(function(d){ return d.targetRoomId; }),
            spawnTargetTypes: spawnDoors.map(function(d){
              return (state.rooms[d.targetRoomId] || {}).type || null;
            }),
            roomsWith2PlusDoors: multi,
            pricedDoors: state.pricedDoors ? 1 : 0,
            eliteRoute: state.eliteRoute ? 1 : 0
          });
        });
      });
      return rows;
    })()`);

    // ---------- 5) 帧率基线 ----------
    out.fps = await h.ev(`(function(){
      return new Promise(function(resolve){
        var n = 0, t0 = performance.now();
        function tick(){ n += 1; if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
          else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
        requestAnimationFrame(tick);
      });
    })()`);
    out.errors = await h.ev(`(window.__errors || []).length`);
  } finally {
    h.close();
  }

  fs.writeFileSync(path.join(OUT_DIR, 'roomentry-result.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log('\n截图目录：' + OUT_DIR);
}

main().catch((e) => { console.error(e); process.exit(1); });
