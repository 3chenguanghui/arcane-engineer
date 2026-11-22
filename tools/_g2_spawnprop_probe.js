/**
 * 第二组·症状 10（怪物刷进房间遮挡道具）只读探针
 * ------------------------------------------------------------
 * 目的：量化"刷怪落点压在家具占位区 / 爆炸桶上"的比例，用于修前 / 修后对照。
 * 做法：
 *   1. 无头 Edge 加载被测 HTML（整份单文件，不依赖外部资源）；
 *   2. 逐层 generateFloor(1..30)，每层约 5 间房 → 合计 ≈150 间，跨多种房型；
 *   3. 包一层 spawnEnemy，记录每次刷怪请求的 (x, y, roomId)；
 *   4. 用与 paintRoomPropV2 同一套公式算出每间房的家具占位矩形，
 *      统计落点圆（r=26，与生成时一致）与之相交 / 压在桶上的比例；
 *   5. 若被测版本已带 roomOcclusionRects，则直接用它（修后版本），
 *      否则用脚本内的同公式副本（修前版本没有这个函数）。
 * 只读：不改游戏逻辑、不写存档。
 * 用法：
 *   node tools/_g2_spawnprop_probe.js --file=<html> --out=<json>
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9789;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.screenshots', 'g2');
/* 20 层 × 每层 5 间 = 100 间，正好满足"至少 100 间、跨多个房型"的验收下限。
   不用 30 层的原因见回报：F21 起会触发既有的房型计划唯一性断言（第一组逻辑，本项不碰）。 */
const FLOORS = Array.from({ length: 20 }, (_, i) => i + 1);
const SEED = '261108';
const RADIUS = 26;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析命令行参数
 * @returns {{file:string, out:string}} 被测文件与输出 json 路径
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const pick = (k) => {
    const hit = a.find((x) => x.startsWith('--' + k + '='));
    return hit ? hit.slice(k.length + 3) : null;
  };
  const file = pick('file') || path.join(ROOT, 'index_arcane_v2.html');
  const out = pick('out') || path.join(OUT_DIR, 'spawnprop_after.json');
  /* --guard=0 → 关掉修后的道具避让，模拟"修前"；默认 1（修后） */
  const guard = pick('guard') === '0' ? 0 : 1;
  return { file: path.resolve(file), out: path.resolve(out), guard };
}

/**
 * 启动无头 Edge 并连 CDP，加载被测 HTML
 * @param {string} file 被测文件绝对路径
 * @returns {Promise<{ev:Function, close:Function}>} 探针句柄
 */
async function boot(file) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
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
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
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

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  for (let i = 0; i < 200; i += 1) {
    await sleep(250);
    try {
      if (await ev(`typeof state !== 'undefined' && typeof generateFloor === 'function'`)) break;
    } catch (e) { /* 仍在解析 */ }
  }
  const close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } killEdge(proc); };
  return { ev, close };
}

/**
 * 页面内脚本：逐层生成并统计刷怪落点与家具 / 爆炸桶的重叠
 * @param {number[]} floors 要测的层
 * @param {string} seed 固定种子
 * @param {number} radius 判定半径（与生成时一致）
 * @param {number} guard 1=修后（避让道具）0=修前（只避墙体）
 * @returns {string} 可被 Runtime.evaluate 执行的表达式
 */
const PAGE_SCRIPT = (floors, seed, radius, guard) => `(function(){
  var FLOORS = ${JSON.stringify(floors)};
  var RADIUS = ${radius};
  /* 修前 / 修后对照：guard=0 时关掉 spawnPointClear 里的道具避让 */
  if (typeof SPAWN_PROP_GUARD !== 'undefined') SPAWN_PROP_GUARD.enabled = ${guard ? 'true' : 'false'};
  state.seedInfo = { active: true, value: ${JSON.stringify(seed)}, daily: false, custom: true, startedAt: 0 };
  if (typeof __rngOverride !== 'undefined') __rngOverride = null;

  /** 造矩形 */
  function R(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }

  /**
   * 与 paintRoomPropV2 同公式的家具占位矩形（顶面 + 向下立面）
   * 修前版本没有 roomOcclusionRects，只能在这里复刻一份用于对照。
   * @param {Object} room 房间
   * @returns {Array<{x:number,y:number,w:number,h:number}>} 矩形列表
   */
  function legacyRects(room) {
    var k = 1;
    try { k = roomPropK(room); } catch (e) { /* 老版本无此函数 */ }
    var cx = room.cx, cy = room.cy, out = [];
    var put = function (x, y, w, h) { out.push(R(x, y, w, h)); };
    switch (room.type) {
      case 'shop': {
        var w = 300 * k, h = 34 * k, lift = 58 * k, y = room.y + 230 * k;
        put(cx - w / 2, y, w, h + lift);
        [-1, 1].forEach(function (side) {
          var sx = side < 0 ? room.x + 70 : room.x + room.w - 190 * k;
          put(sx, y - 74 * k, 120 * k, 26 * k + 96 * k);
        });
        put(cx - 84 * k, y - 96 * k, 168 * k, 46 * k + 10 * k);
        break;
      }
      case 'chest': {
        var bw = 108 * k, bh = 40 * k, by = cy - 4 * k;
        put(cx - bw / 2, by - 28 * k, bw, bh * 1.45 + 44 * k + 28 * k);
        break;
      }
      case 'rest': case 'start': {
        var gy = cy + 16 * k;
        put(cx - 46 * k, gy - 64 * k, 92 * k, 124 * k);
        break;
      }
      case 'forge': {
        put(cx - 110 * k, cy - 40 * k, 220 * k, 60 * k + 150 * k);
        put(cx - 22 * k, cy - 236 * k, 44 * k, 40 * k + 140 * k);
        put(cx + 150 * k, cy + 56 * k, 86 * k, 26 * k + 36 * k);
        break;
      }
      case 'survival': {
        put(cx - 56 * k, cy + 8, 112 * k, 40 * k + 30 * k);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
          put(cx + p[0] * room.w * 0.30 - 14 * k, cy + p[1] * room.h * 0.30, 28 * k, 24 * k + 96 * k);
        });
        break;
      }
      case 'curse': {
        put(cx - 60 * k, cy - 16 * k, 120 * k, 36 * k + 150 * k);
        put(cx - 34 * k, cy - 100 * k, 68 * k, 100 * k);
        break;
      }
      case 'vault': {
        put(cx - 34 * k, room.y + 40 * k, 68 * k, 24 * k + 120 * k);
        break;
      }
      default: break;
    }
    return out;
  }

  /** 取房间的家具占位矩形：修后版本自带函数，修前版本走同公式副本 */
  function rectsOf(room) {
    if (typeof roomOcclusionRects === 'function') return roomOcclusionRects(room);
    return legacyRects(room);
  }

  /** 取落点：修后走 pickEnemySpawnPoint；修前（HEAD 没有该函数）只走墙体避让 */
  function pointFor(room, x, y, r) {
    if (typeof pickEnemySpawnPoint === 'function') return pickEnemySpawnPoint(room, x, y, r);
    return nudgeOutOfBlockers(x, y, r);
  }

  /** 圆与矩形（外扩 pad=0）是否相交 */
  function circleHitRect(x, y, r, rect) {
    var nx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
    var ny = Math.max(rect.y, Math.min(y, rect.y + rect.h));
    return (x - nx) * (x - nx) + (y - ny) * (y - ny) < r * r;
  }

  /** 点到矩形的距离（矩形内部为 0），用于诊断生存房落点离祭坛/角柱有多近 */
  function distToRect(x, y, rect) {
    var nx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
    var ny = Math.max(rect.y, Math.min(y, rect.y + rect.h));
    return Math.hypot(x - nx, y - ny);
  }

  /* 包一层 spawnEnemy：记录每次刷怪请求的落点（生成期 + 生存房波次都走这里） */
  var calls = [];
  var origSpawn = spawnEnemy;
  spawnEnemy = function (typeId, x, y, floorNumber, opts) {
    var enemy = origSpawn.apply(null, arguments);
    var o = opts || {};
    calls.push({
      t: typeId,
      x: x,
      y: y,
      r: enemy && enemy.radius ? enemy.radius : 12,
      roomId: o.roomId,
      ok: !!enemy,
      summoned: !!o.summoned,
      phase: window.__probePhase || 'gen'
    });
    return enemy;
  };

  /* 固定随机流：生存房波次落点用 Math.random，换成种子流才能让修前 / 修后同源可比 */
  var seedState = 20261121;
  function seededRandom() {
    seedState = (seedState * 1664525 + 1013904223) >>> 0;
    return seedState / 4294967296;
  }
  var origRandom = Math.random;

  var floorsOut = [];
  var stress = { points: 0, inside: 0 };
  /* 生存房诊断：每间记录占位矩形个数与最近一次落点，确认探针测的是真道具 */
  var survivalDiag = [];
  var tot = { rooms: 0, roomsWithEnemies: 0, spawns: 0, occ: 0, barrel: 0, prop: 0, outShape: 0, survivalSpawns: 0, survivalProp: 0, survivalRooms: 0, survivalMinGap: 9999 };
  var typeStat = {};
  var roomTypeCount = {};

  FLOORS.forEach(function (f) {
    calls = [];
    /* 真实换层流程是先写 state.floor 再 generateFloor（房型权重 / 保底都读 state.floor），
       探针必须照做，否则第 2 层起的精英 / 商店 / 生存房不会出现。 */
    state.floor = f;
    generateFloor(f);
    var barrels = (state.props && state.props.barrels) ? state.props.barrels : [];
    var roomIds = {}, floorSpawns = 0, floorOcc = 0, floorBarrel = 0, floorProp = 0, floorOut = 0;
    (state.rooms || []).forEach(function (room) {
      roomIds[room.id] = room;
      roomTypeCount[room.type] = (roomTypeCount[room.type] || 0) + 1;
    });
    /* 生存房：房内祭坛 + 四角柱是纯视觉道具，波次怪原本只查"可走"。
       这里按真实入口 spawnSurvivalWave 跑 8 波（固定随机流），把落点也纳入统计。 */
    if (typeof spawnSurvivalWave === 'function') {
      Math.random = seededRandom;
      (state.rooms || []).forEach(function (room) {
        if (room.type !== 'survival' || !state.survival || state.survival.roomId !== room.id) return;
        tot.survivalRooms += 1;
        var keep = state.survival;
        state.survival = {
          roomId: room.id,
          altar: keep.altar,
          active: true,
          remain: 60,
          waveTimer: 0,
          waves: 0,
          cleared: false
        };
        window.__probePhase = 'survival';
        for (var w = 0; w < 12; w += 1) {
          try { spawnSurvivalWave(room); } catch (e) { break; }
        }
        window.__probePhase = 'gen';
        state.survival = keep;
        var myRects = rectsOf(room);
        var myCalls = calls.filter(function (c) { return c.phase === 'survival' && c.roomId === room.id; });
        var gap = 9999;
        myCalls.forEach(function (c) {
          myRects.forEach(function (rc) { gap = Math.min(gap, distToRect(c.x, c.y, rc)); });
        });
        survivalDiag.push({
          floor: f,
          room: { x: room.x, y: room.y, w: room.w, h: room.h },
          rects: myRects.length,
          rectsSample: myRects.slice(0, 2),
          spawns: myCalls.length,
          nearestGap: gap === 9999 ? null : Math.round(gap * 10) / 10
        });
      });
      Math.random = origRandom;
    }
    var hitRooms = {};
    calls.forEach(function (c) {
      if (c.roomId == null || c.summoned || !c.ok) return;
      var room = roomIds[c.roomId];
      if (!room) return;
      var cr = c.r || RADIUS;
      var rects = rectsOf(room);
      var occ = rects.some(function (rc) { return circleHitRect(c.x, c.y, cr, rc); });
      var bar = barrels.some(function (b) { return Math.hypot(c.x - b.x, c.y - b.y) < (b.r || 13) + cr; });
      var outShape = false;
      try { outShape = !pointInRoomShape(room, c.x, c.y, 6); } catch (e) { /* 老版本无此函数 */ }
      tot.spawns += 1;
      floorSpawns += 1;
      if (occ) { tot.occ += 1; floorOcc += 1; }
      if (bar) { tot.barrel += 1; floorBarrel += 1; }
      if (occ || bar) { tot.prop += 1; floorProp += 1; }
      if (outShape) { tot.outShape += 1; floorOut += 1; }
      if (c.phase === 'survival') {
        tot.survivalSpawns += 1;
        if (occ || bar) tot.survivalProp += 1;
        rects.forEach(function (rc) {
          tot.survivalMinGap = Math.min(tot.survivalMinGap, distToRect(c.x, c.y, rc));
        });
      }
      hitRooms[c.roomId] = true;
      var st = typeStat[room.type] || (typeStat[room.type] = { spawns: 0, prop: 0 });
      st.spawns += 1;
      if (occ || bar) st.prop += 1;
    });
    tot.rooms += (state.rooms || []).length;
    tot.roomsWithEnemies += Object.keys(hitRooms).length;
    /* 定向压力测试：把期望点故意放在每件家具内部（中心 + 两个 30%/70% 点），
       看 pickEnemySpawnPoint 是否还能把落点留在道具里。
       修前（guard=0）应当几乎全部留下，修后应当全部挪走。 */
    var statsKeep = (typeof SPAWN_STATS !== 'undefined') ? JSON.parse(JSON.stringify(SPAWN_STATS)) : null;
    (state.rooms || []).forEach(function (room) {
      var rects = rectsOf(room);
      rects.forEach(function (rc) {
        [[0.5, 0.5], [0.3, 0.3], [0.7, 0.7]].forEach(function (uv) {
          var s = pointFor(room, rc.x + rc.w * uv[0], rc.y + rc.h * uv[1], RADIUS);
          stress.points += 1;
          var back = rects.some(function (r2) { return circleHitRect(s.x, s.y, RADIUS, r2); })
            || barrels.some(function (b) { return Math.hypot(s.x - b.x, s.y - b.y) < (b.r || 13) + RADIUS; });
          if (back) stress.inside += 1;
        });
      });
    });
    if (statsKeep && typeof SPAWN_STATS !== 'undefined') Object.assign(SPAWN_STATS, statsKeep);
    floorsOut.push({
      floor: f,
      rooms: (state.rooms || []).length,
      spawns: floorSpawns,
      occ: floorOcc,
      barrel: floorBarrel,
      prop: floorProp,
      outShape: floorOut
    });
  });
  spawnEnemy = origSpawn;

  var pct = function (n, d) { return d > 0 ? Math.round((n / d) * 10000) / 100 : 0; };
  Object.keys(typeStat).forEach(function (t) { typeStat[t].pct = pct(typeStat[t].prop, typeStat[t].spawns); });
  return {
    floors: FLOORS.length,
    radius: RADIUS,
    totals: tot,
    ratio: {
      propPct: pct(tot.prop, tot.spawns),
      occPct: pct(tot.occ, tot.spawns),
      barrelPct: pct(tot.barrel, tot.spawns),
      outShapePct: pct(tot.outShape, tot.spawns),
      survivalPct: pct(tot.survivalProp, tot.survivalSpawns)
    },
    byRoomType: typeStat,
    roomTypeCount: roomTypeCount,
    stress: stress,
    survivalDiag: survivalDiag,
    perFloor: floorsOut,
    spawnStats: (typeof SPAWN_STATS !== 'undefined') ? JSON.parse(JSON.stringify(SPAWN_STATS)) : null
  };
})()`;

/**
 * 主流程：起浏览器 → 批量生成 → 打印汇总并落盘
 * @returns {Promise<void>}
 */
async function main() {
  const args = parseArgs();
  const h = await boot(args.file);
  let res = null;
  try {
    res = await h.ev(PAGE_SCRIPT(FLOORS, SEED, RADIUS, args.guard));
  } finally {
    h.close();
  }
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(res, null, 2), 'utf8');

  const t = res.totals;
  console.log('== 落点压制具统计 ==');
  console.log('文件: ' + args.file + ' · guard=' + args.guard);
  console.log('层数 ' + res.floors + ' · 房间 ' + t.rooms + ' · 有怪房间 ' + t.roomsWithEnemies + ' · 刷怪点 ' + t.spawns);
  console.log('落在家具 ' + t.occ + ' / 爆炸桶 ' + t.barrel + ' / 任意道具 ' + t.prop +
    ' → ' + res.ratio.propPct + '%（家具 ' + res.ratio.occPct + '% · 桶 ' + res.ratio.barrelPct + '%）');
  console.log('房型外 ' + t.outShape + ' → ' + res.ratio.outShapePct + '%');
  console.log('其中生存房波次: ' + t.survivalProp + '/' + t.survivalSpawns +
    ' → ' + res.ratio.survivalPct + '% · 生存房 ' + t.survivalRooms +
    ' 间 · 最近间距 ' + (t.survivalMinGap === 9999 ? 'n/a' : t.survivalMinGap.toFixed(1)) + 'px');
  console.log('房型分布: ' + JSON.stringify(res.roomTypeCount));
  console.log('定向压力（期望点放在道具内）: 仍留在道具内 ' + res.stress.inside + '/' + res.stress.points +
    ' → ' + (res.stress.points ? (Math.round((res.stress.inside / res.stress.points) * 10000) / 100) : 0) + '%');
  Object.keys(res.byRoomType).forEach((k) => {
    const s = res.byRoomType[k];
    if (s.prop > 0) console.log('  ' + k + ': ' + s.prop + '/' + s.spawns + ' = ' + s.pct + '%');
  });
  if (res.spawnStats) console.log('SPAWN_STATS: ' + JSON.stringify(res.spawnStats));
  console.log('已写入 ' + args.out);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
