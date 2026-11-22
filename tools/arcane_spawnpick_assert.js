/**
 * 出生房选点改造（第三条路）· 逐层 dump 与差分断言（只读）
 * ------------------------------------------------------------
 * 目的：证明"只改挑哪间房当出生房"时，1..40 层的房间位置 / MST / loopEdges / attempts
 * 是否与改前逐位相同，以及到底哪些字段变了（预期只有 spawnId，实测以本工具为准）。
 * 用法：
 *   node tools/arcane_spawnpick_assert.js --file=<被测html> --out=<dump.json>
 *   node tools/arcane_spawnpick_assert.js --diff=<before.json>,<after.json>
 * 输出：.screenshots/spawnpick/*.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9573;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.screenshots', 'spawnpick');
const FLOORS = 40;
const SEED = '261108';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析命令行参数
 * @returns {{file:string|null, out:string|null, diff:string|null}} 参数
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const pick = (k) => {
    const hit = a.find((x) => x.startsWith('--' + k + '='));
    return hit ? hit.slice(k.length + 3) : null;
  };
  return { file: pick('file'), out: pick('out'), diff: pick('diff'), shapes: a.includes('--shapes'), gate: a.includes('--gate') };
}

/* 与 arcane_spawndoors.js 同一批 30 个种子，保证三张表能对上 */
const SEEDS30 = [
  '261108', '42', '7', '20260101', '9001', '555', '31337', '777777',
  '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '144', '233',
  '377', '610', '987', '1597', '2584', '4181', '6765', '10946', '17711', '28657'
];

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
    try { if (await ev(`typeof state !== 'undefined' && typeof generateFloor === 'function'`)) break; } catch (e) { /* 仍在解析 */ }
  }
  const close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } killEdge(proc); };
  return { ev, close };
}

/**
 * 页面内脚本：固定种子，逐层 generateFloor，抓布局与图结构快照
 * @param {number} floors 层数
 * @param {string} seed 种子
 */
const PAGE_SCRIPT = (floors, seed) => `(function(){
  state.seedInfo = { active: true, value: ${JSON.stringify(seed)}, daily: false, custom: true, startedAt: 0 };
  __rngOverride = null;
  var out = [];
  for (var n = 1; n <= ${floors}; n += 1) {
    generateFloor(n);
    var g = state.floorGraph || {};
    out.push({
      floor: n,
      attempts: state.floorGen && state.floorGen.attempts,
      fallback: state.floorGen && state.floorGen.fallback,
      valid: state.floorGen && state.floorGen.valid,
      rooms: (state.rooms || []).map(function(r){
        return [r.id, r.col, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h), r.seed];
      }),
      treeEdges: (g.treeEdges || []).map(function(e){ return e.slice(); }),
      loopEdges: (g.loopEdges || []).map(function(e){ return e.slice(); }),
      edgeCount: (g.edges || []).length,
      spawnId: state.spawnRoomId,
      stairId: state.stairRoomId
    });
  }
  return out;
})()`;

/**
 * 差分两份 dump：逐层逐字段比对，spawnId/stairId 单列标注
 * @param {Array} before 改前快照
 * @param {Array} after 改后快照
 */
function diffDumps(before, after) {
  const fields = ['attempts', 'fallback', 'valid', 'rooms', 'treeEdges', 'loopEdges', 'edgeCount'];
  const report = { floors: before.length, spawnChanged: [], stairChanged: [], sameExceptSpawn: 0, diffs: {} };
  fields.forEach((f) => { report.diffs[f] = 0; });
  const examples = [];

  before.forEach((b, i) => {
    const a = after[i] || {};
    const spawnMoved = b.spawnId !== a.spawnId;
    const stairMoved = b.stairId !== a.stairId;
    if (spawnMoved) report.spawnChanged.push(b.floor);
    if (stairMoved) report.stairChanged.push(b.floor);
    fields.forEach((f) => {
      const same = JSON.stringify(b[f]) === JSON.stringify(a[f]);
      if (!same) {
        report.diffs[f] += 1;
        if (examples.length < 6) examples.push({ floor: b.floor, field: f, spawnMoved: spawnMoved,
          before: JSON.stringify(b[f]).slice(0, 160), after: JSON.stringify(a[f]).slice(0, 160) });
      }
    });
    const otherSame = fields.every((f) => JSON.stringify(b[f]) === JSON.stringify(a[f]));
    if (otherSame && (spawnMoved || stairMoved)) report.sameExceptSpawn += 1;
  });
  report.examples = examples;
  report.verdict = (Object.values(report.diffs).every((v) => v === 0)) ? 'PASS(除 spawnId/stairId 外逐位相同)' : 'DIFF';
  return report;
}

/**
 * 页面内脚本（--shapes）：验"换出生房后起始房形状没被门数变化搞坏"
 * 指标：形状类型 / 可走面积占房间矩形比例（8px 网格采样 roomShapeGeometry）/ 中心 26px pad 是否可站
 */
const SHAPE_SCRIPT = (seeds) => `(function(){
  var seeds = ${JSON.stringify(seeds)};
  var rows = [];
  seeds.forEach(function(sd){
    state.seedInfo = { active: true, value: sd, daily: false, custom: true, startedAt: 0 };
    __rngOverride = null;
    __roamDebug.setFloor(1);
    var spawn = state.rooms[state.spawnRoomId];
    var geo = roomShapeGeometry(spawn);
    var inside = function(px, py){
      var inRect = geo.rects.some(function(r){ return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; });
      var inCircle = geo.circles.some(function(c){ return Math.hypot(px - c.x, py - c.y) <= c.r; });
      if (!inRect && !inCircle) return false;
      return !geo.blockers.some(function(b){ return b.kind === 'circle'
        ? Math.hypot(px - b.x, py - b.y) < b.r
        : (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h); });
    };
    var total = 0;
    var live = 0;
    for (var x = spawn.x + 4; x <= spawn.x + spawn.w - 4; x += 8) {
      for (var y = spawn.y + 4; y <= spawn.y + spawn.h - 4; y += 8) {
        total += 1;
        if (inside(x, y)) live += 1;
      }
    }
    rows.push({
      seed: sd,
      spawnId: spawn.id,
      col: spawn.col,
      type: spawn.type,
      shape: roomShapeOf(spawn),
      areaRatio: Math.round((live / Math.max(1, total)) * 1000) / 1000,
      centerPad26: isWalkableCircle(spawn.cx, spawn.cy, 26),
      doors: (state.doors || []).filter(function(d){ return d.roomId === spawn.id; }).length
    });
  });
  return rows;
})()`;

/**
 * 页面内脚本（--gate）：15% 事件房闸门"配额该落地却没落地"的统计
 * 固定种子 + 1..20 层，只统计 eventGate=true 的楼层是否真的生成了事件房。
 */
const GATE_SCRIPT = (seeds, floors) => `(function(){
  var seeds = ${JSON.stringify(seeds)};
  var out = [];
  seeds.forEach(function(sd){
    state.seedInfo = { active: true, value: sd, daily: false, custom: true, startedAt: 0 };
    __rngOverride = null;
    for (var f = 1; f <= ${floors}; f += 1) {
      __roamDebug.setFloor(f);
      var want = false;
      try { want = floorHash01(f, EVENT_ROOM_GATE_CONFIG.seedSalt) < EVENT_ROOM_GATE_CONFIG.floorChance; } catch (e) { want = false; }
      if (!want) continue;
      var ev = state.rooms.filter(function(r){ return r.type === 'event' && r.eventGate === true; });
      out.push({ seed: sd, floor: f, placed: ev.length, hasRift: !!state.voidRift, types: state.rooms.map(function(r){ return r.type; }) });
    }
  });
  return out;
})()`;

async function main() {
  const args = parseArgs();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (args.diff) {
    const [bf, af] = args.diff.split(',');
    const before = JSON.parse(fs.readFileSync(bf, 'utf8'));
    const after = JSON.parse(fs.readFileSync(af, 'utf8'));
    const report = diffDumps(before, after);
    fs.writeFileSync(path.join(OUT_DIR, 'diff.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(`== 40 层差分（改前 vs 改后）==`);
    console.log(`出生房变了: ${report.spawnChanged.length}/${report.floors} 层 -> ${report.spawnChanged.join(',')}`);
    console.log(`楼梯房变了: ${report.stairChanged.length}/${report.floors} 层 -> ${report.stairChanged.join(',')}`);
    Object.keys(report.diffs).forEach((f) => console.log(`字段 ${f} 不同: ${report.diffs[f]} 层`));
    report.examples.forEach((e) => console.log(`  L${e.floor} ${e.field}: ${e.before}  ≠  ${e.after}`));
    console.log(`VERDICT: ${report.verdict}`);
    return;
  }

  if (args.gate) {
    const h = await boot(args.file || path.join(ROOT, 'index_arcane_v2.html'));
    let rows = [];
    try {
      rows = await h.ev(GATE_SCRIPT(SEEDS30, 20));
    } finally {
      h.close();
    }
    const empty = rows.filter((r) => r.placed === 0);
    console.log(`== 15% 事件房闸门（30 种子 × 20 层）==`);
    console.log(`闸门命中楼层: ${rows.length}`);
    console.log(`命中但没落地: ${empty.length} 例`);
    console.log(`命中层仍有裂隙: ${rows.filter((r) => r.hasRift).length}/${rows.length}`);
    empty.slice(0, 12).forEach((r) => console.log(`  seed ${r.seed} L${r.floor} types=${JSON.stringify(r.types)}`));
    fs.writeFileSync(path.join(OUT_DIR, `gate-${path.basename(args.file || 'main').replace(/\W+/g, '_')}.json`), JSON.stringify(rows, null, 2), 'utf8');
    return;
  }

  if (args.shapes) {
    const h = await boot(args.file || path.join(ROOT, 'index_arcane_v2.html'));
    let rows = [];
    try {
      rows = await h.ev(SHAPE_SCRIPT(SEEDS30));
    } finally {
      h.close();
    }
    fs.writeFileSync(path.join(OUT_DIR, 'spawn-shapes.json'), JSON.stringify(rows, null, 2), 'utf8');
    const bad = rows.filter((r) => !r.centerPad26 || r.areaRatio < 0.5);
    const byShape = {};
    rows.forEach((r) => { byShape[r.shape] = (byShape[r.shape] || 0) + 1; });
    console.log(`== 起始房形状（30 种子 · 第 1 层）==`);
    console.log(`形状分布: ${JSON.stringify(byShape)}`);
    console.log(`可走面积占比 min/avg: ${Math.min(...rows.map((r) => r.areaRatio))} / ${(rows.reduce((s, r) => s + r.areaRatio, 0) / rows.length).toFixed(3)}`);
    console.log(`中心 26px pad 不可站: ${rows.filter((r) => !r.centerPad26).length} 例`);
    console.log(`异常（pad 不可站或面积<50%）: ${bad.length} 例${bad.length ? ' -> ' + JSON.stringify(bad) : ''}`);
    console.log(`VERDICT: ${bad.length === 0 ? 'PASS' : 'FAIL'}`);
    return;
  }

  if (!args.file) throw new Error('需要 --file= 或 --diff= 或 --shapes');
  const h = await boot(args.file);
  let dump = [];
  try {
    dump = await h.ev(PAGE_SCRIPT(FLOORS, SEED));
  } finally {
    h.close();
  }
  const outPath = args.out || path.join(OUT_DIR, 'dump.json');
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2), 'utf8');
  const noDeg2 = dump.filter((d) => d.rooms.length && d.spawnId === 0).length;
  console.log(`已 dump ${dump.length} 层 -> ${outPath}`);
  console.log(`spawnId=0 的层数（说明出生房仍在第 0 列第一间）: ${noDeg2}`);
  dump.slice(0, 5).forEach((d) => console.log(`  L${d.floor} rooms=${d.rooms.length} spawn=${d.spawnId} stair=${d.stairId} tree=${d.treeEdges.length} loop=${d.loopEdges.length} attempts=${d.attempts}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
