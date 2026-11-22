/**
 * 出生房回环边（方案 B）走廊几何断言（只读，不改游戏逻辑）
 * ------------------------------------------------------------
 * 方案 B 会在 attachLoopRoutes 收尾处给出生房补一条非树边，生成器随后把它
 * 落成 L 形走廊（带 a/b 房间 id）。这里专门验三件事：
 *   1) 穿房：沿新走廊逐点采样，点是否落进"端点房以外任何房间"的内缩矩形；
 *   2) 走廊重叠：新走廊矩形与"这条边以外"的已有走廊矩形的交叠面积/比例；
 *   3) 门洞不重叠：同一房间同一面墙上两扇门的间距是否都 ≥ 30px（collectDoors 的去重阈值）。
 * 用法：node tools/arcane_loopedge_assert.js [--count=30|100] [--file=绝对路径]
 * 输出：.screenshots/loopedge/loopedge-assert.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9564;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.screenshots', 'loopedge');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 与 arcane_spawndoors.js 同一批种子，保证两张表能对上 */
const SEEDS30 = [
  '261108', '42', '7', '20260101', '9001', '555', '31337', '777777',
  '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '144', '233',
  '377', '610', '987', '1597', '2584', '4181', '6765', '10946', '17711', '28657'
];
const SEEDS100 = Array.from({ length: 100 }, (_, i) => String(i + 1));

/**
 * 解析命令行参数
 * @returns {{count:number, file:string}} 种子数 / 被测文件
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const pick = (k, d) => {
    const hit = a.find((x) => x.startsWith('--' + k + '='));
    return hit ? hit.slice(k.length + 3) : d;
  };
  return {
    count: Number(pick('count', '30')) === 100 ? 100 : 30,
    mode: pick('mode', 'edge') === 'all' ? 'all' : 'edge',
    file: pick('file', path.join(ROOT, 'index_arcane_v2.html'))
  };
}

/**
 * 启动无头 Edge 并连上 CDP，加载指定文件
 * @param {string} file 被测 HTML 绝对路径
 * @returns {Promise<{ev:Function, close:Function}>} 探针句柄
 */
async function boot(file) {
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

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  for (let i = 0; i < 120; i += 1) {
    await sleep(250);
    try { if (await ev(`typeof state !== 'undefined'`)) break; } catch (e) { /* 仍在解析 */ }
  }
  const close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } killEdge(proc); };
  return { ev, close };
}

/**
 * 在页面里跑的采样逻辑（字符串注入，避免 Node 端拿不到游戏内部函数）
 * 对每个种子：找出 spawnLoopEdge 对应的走廊矩形，逐点采样验穿房、验重叠、验门距。
 */
const PAGE_SCRIPT = (seeds, mode) => `(function(){
  var seeds = ${JSON.stringify(seeds)};
  var MODE = ${JSON.stringify(mode)};
  var STEP = 10;        // 采样步长（px）
  var PAD = 3;          // 走廊矩形边缘不采样（贴墙像素不算穿房）
  var ROOM_INSET = 8;   // 房间内缩（px）：落进内缩矩形才算"穿房"
  var DOOR_MIN = 30;    // collectDoors 的同墙去重阈值
  var rows = [];
  seeds.forEach(function(sd){
    state.seedInfo = { active: true, value: sd, daily: false, custom: true, startedAt: 0 };
    __rngOverride = null;
    __roamDebug.setFloor(1);
    var graph = state.floorGraph || {};
    var e = graph.spawnLoopEdge || null;
    var rooms = state.rooms || [];
    var rects = state.corridorRects || [];
    var doors = state.doors || [];
    var spawn = rooms[state.spawnRoomId];
    var row = { seed: sd, edge: e, rects: 0, samples: 0, pierce: 0, pierceExamples: [],
                overlapPairs: 0, overlapMaxRatio: 0, overlapHeavy: 0, overlapFull: 0, doorPairsUnder30: 0,
                spawnDoors: 0, rooms: rooms.length, rectList: [], overlapExamples: [] };

    /* 门距：所有房间同面墙两门的最小间距（<30 说明去重失效 / 门洞重叠） */
    var minDoorGap = Infinity;
    rooms.forEach(function(r){
      var list = doors.filter(function(d){ return d.roomId === r.id; });
      for (var i = 0; i < list.length; i += 1) {
        for (var j = i + 1; j < list.length; j += 1) {
          if (list[i].side !== list[j].side) continue;
          var g = Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y);
          if (g < minDoorGap) minDoorGap = g;
          if (g < DOOR_MIN) row.doorPairsUnder30 += 1;
        }
      }
    });
    row.minDoorGap = isFinite(minDoorGap) ? Math.round(minDoorGap * 10) / 10 : null;
    row.spawnDoors = doors.filter(function(d){ return d.roomId === spawn.id; }).length;

    /* 采样分组：edge 模式只看新增边；all 模式看全部走廊，每段用它自己的两端房做豁免 */
    var groups = [];
    if (MODE === 'all') {
      rects.forEach(function(c){ groups.push({ endpoints: [c.a, c.b], list: [c] }); });
    } else {
      if (!e) { rows.push(row); return; }
      var mineEdge = rects.filter(function(c){
        return (c.a === e[0] && c.b === e[1]) || (c.a === e[1] && c.b === e[0]);
      });
      groups.push({ endpoints: e, list: mineEdge });
    }
    var allMine = [];
    groups.forEach(function(g){ allMine = allMine.concat(g.list); });
    row.rects = allMine.length;
    row.rectList = allMine.map(function(c){
      return { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h), horiz: !!c.horiz };
    });

    /* 1) 穿房采样：只看"该段走廊两端房间之外"的房间 */
    groups.forEach(function(g){
      g.list.forEach(function(c){
        for (var x = c.x + PAD; x <= c.x + c.w - PAD; x += STEP) {
          for (var y = c.y + PAD; y <= c.y + c.h - PAD; y += STEP) {
            row.samples += 1;
            for (var k = 0; k < rooms.length; k += 1) {
              var r = rooms[k];
              if (r.id === g.endpoints[0] || r.id === g.endpoints[1]) continue;
              if (x > r.x + ROOM_INSET && x < r.x + r.w - ROOM_INSET &&
                  y > r.y + ROOM_INSET && y < r.y + r.h - ROOM_INSET) {
                row.pierce += 1;
                if (row.pierceExamples.length < 5) {
                  row.pierceExamples.push({ roomId: r.id, x: Math.round(x), y: Math.round(y),
                    rect: { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) } });
                }
                break;
              }
            }
          }
        }
      });
    });

    /* 2) 与"这条边以外"的已有走廊求交叠（仅 edge 模式有意义） */
    if (MODE !== 'all') rects.forEach(function(o){
      if (allMine.indexOf(o) >= 0) return;
      allMine.forEach(function(c){
        var ix = Math.max(0, Math.min(c.x + c.w, o.x + o.w) - Math.max(c.x, o.x));
        var iy = Math.max(0, Math.min(c.y + c.h, o.y + o.h) - Math.max(c.y, o.y));
        var area = ix * iy;
        if (area <= 0) return;
        row.overlapPairs += 1;
        var ratio = area / Math.min(c.w * c.h, o.w * o.h);
        if (ratio > row.overlapMaxRatio) row.overlapMaxRatio = ratio;
        if (ratio >= 0.5) row.overlapHeavy += 1;
        if (ratio >= 0.999) row.overlapFull += 1;
        if (row.overlapExamples.length < 6) {
          row.overlapExamples.push({
            mine: { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h), horiz: !!c.horiz },
            other: { x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.w), h: Math.round(o.h),
                     a: o.a, b: o.b, horiz: !!o.horiz },
            ratio: Math.round(ratio * 1000) / 1000
          });
        }
      });
    });
    row.overlapMaxRatio = Math.round(row.overlapMaxRatio * 1000) / 1000;
    rows.push(row);
  });
  return { rows: rows, errors: (window.__errors || []).slice(0, 5) };
})()`;

async function main() {
  const { count, file, mode } = parseArgs();
  const seeds = count === 100 ? SEEDS100 : SEEDS30;
  const h = await boot(file);
  let rows = [];
  try {
    const out = await h.ev(PAGE_SCRIPT(seeds, mode));
    rows = out.rows;
    if (out.errors && out.errors.length) console.error('页面错误：' + JSON.stringify(out.errors));
  } finally {
    h.close();
  }

  /* edge 模式只看"有补边"的种子；all 模式看全部种子 */
  const withEdge = mode === 'all' ? rows : rows.filter((r) => r.edge);
  const samples = withEdge.reduce((s, r) => s + r.samples, 0);
  const pierce = withEdge.reduce((s, r) => s + r.pierce, 0);
  const overlapPairs = withEdge.reduce((s, r) => s + r.overlapPairs, 0);
  const heavy = withEdge.reduce((s, r) => s + r.overlapHeavy, 0);
  const full = withEdge.reduce((s, r) => s + (r.overlapFull || 0), 0);
  const doorBad = rows.reduce((s, r) => s + r.doorPairsUnder30, 0);
  const noRect = withEdge.filter((r) => r.rects === 0).length;
  const summary = {
    count: count,
    file: file,
    seeds: rows.length,
    seedsWithEdge: withEdge.length,
    edgesWithoutCorridorRect: noRect,
    samples: samples,
    pierce: pierce,
    overlapPairs: overlapPairs,
    overlapHeavy: heavy,
    overlapFullyContained: full,
    overlapMaxRatio: Math.max(0, ...withEdge.map((r) => r.overlapMaxRatio || 0)),
    doorPairsUnder30: doorBad,
    minDoorGap: Math.min(...rows.filter((r) => r.minDoorGap !== null).map((r) => r.minDoorGap)),
    verdict: (pierce === 0 && heavy === 0 && doorBad === 0 && noRect === 0) ? 'PASS' : 'FAIL'
  };

  fs.writeFileSync(path.join(OUT_DIR, 'loopedge-assert.json'), JSON.stringify({ summary: summary, rows: rows }, null, 2), 'utf8');

  console.log(`== 走廊几何断言（${count} 种子 · 第 1 层 · ${mode === 'all' ? '全部走廊' : '新增回环边'}）==`);
  if (mode === 'all') console.log(`参与采样种子: ${withEdge.length}/${summary.seeds}（全部走廊，逐段只豁免自身两端房）`);
  else console.log(`有补边: ${summary.seedsWithEdge}/${summary.seeds}，其中有走廊矩形: ${summary.seedsWithEdge - noRect}`);
  console.log(`采样点数: ${summary.samples}`);
  console.log(`穿房越界: ${summary.pierce} 例`);
  console.log(`与已有走廊交叠: ${summary.overlapPairs} 对（比例≥0.5: ${summary.overlapHeavy}，完全包含: ${summary.overlapFullyContained}），最大交叠比例 ${summary.overlapMaxRatio}`);
  console.log(`同墙门距 <30px: ${summary.doorPairsUnder30} 对，全局最小门距 ${summary.minDoorGap}px`);
  console.log(`VERDICT: ${summary.verdict}`);
  withEdge.forEach((r) => {
    console.log(`  ${String(r.seed).padEnd(6)} 边=${JSON.stringify(r.edge)} 矩形=${r.rects} 采样=${r.samples} 穿房=${r.pierce} 交叠=${r.overlapPairs}(max ${r.overlapMaxRatio}) 出生门=${r.spawnDoors}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
