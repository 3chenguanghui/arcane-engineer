/**
 * 起始房门数分布采样（只读，不改游戏逻辑）
 * ------------------------------------------------------------
 * 目的：回答"玩家开局到底有没有得选"——统计 30 个固定种子、第 1 层，
 * 起始房（出生房）的真实门数、图上度数（树边 / 含回环边），
 * 以及"图度数 ≥2 但门只有 1"的不变量违例数。
 * 用法：node tools/arcane_spawndoors.js [--tag=before|after] [--count=30|100] [--file=绝对路径]
 * 输出：.screenshots/spawndoors/spawndoors-<tag>-<count>.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9563;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.screenshots', 'spawndoors');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 30 个固定种子：含历史断言用过的 261108 / 42 / 20260101 / 9001 等，改前改后同一张表 */
const SEEDS30 = [
  '261108', '42', '7', '20260101', '9001', '555', '31337', '777777',
  '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '144', '233',
  '377', '610', '987', '1597', '2584', '4181', '6765', '10946', '17711', '28657'
];
/* 100 种子：1..100（与 30 种子表独立，只用于扩大样本压置信区间） */
const SEEDS100 = Array.from({ length: 100 }, (_, i) => String(i + 1));

/**
 * 解析命令行参数
 * @returns {{tag:string, count:number, file:string}} 标签 / 种子数 / 被测文件
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const pick = (k, d) => {
    const hit = a.find((x) => x.startsWith('--' + k + '='));
    return hit ? hit.slice(k.length + 3) : d;
  };
  return {
    tag: pick('tag', 'run'),
    count: Number(pick('count', '30')) === 100 ? 100 : 30,
    file: pick('file', path.join(ROOT, 'index_arcane_v2.html'))
  };
}

/**
 * 启动无头 Edge 并连上 CDP，加载指定文件
 * @param {string} file 被测 HTML 绝对路径（主文件或 _backup 副本）
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
 * 汇总一张"门数分布"表
 * @param {Array} rows 每行采样数据
 * @returns {Object} { dist, singleRatio, deg2Door1, fallback }
 */
function summarize(rows) {
  const dist = {};
  rows.forEach((r) => { dist[r.spawnDoors] = (dist[r.spawnDoors] || 0) + 1; });
  const single = rows.filter((r) => r.spawnDoors <= 1).length;
  return {
    dist: dist,
    single: single,
    total: rows.length,
    singleRatio: rows.length ? Math.round((single / rows.length) * 1000) / 10 : 0,
    deg2Door1: rows.filter((r) => r.spawnDegree >= 2 && r.spawnDoors <= 1).length,
    fallback: rows.filter((r) => r.spawnPickMode === 'fallback').length
  };
}

async function main() {
  const { tag, count, file } = parseArgs();
  const seeds = count === 100 ? SEEDS100 : SEEDS30;
  const h = await boot(file);
  let rows = [];
  let pickStats = null;
  try {
    const out = await h.ev(`(function(){
      var seeds = ${JSON.stringify(seeds)};
      var rows = [];
      var pick = (typeof SPAWN_PICK_STATS !== 'undefined') ? SPAWN_PICK_STATS : null;
      if (pick) { pick.deg2 = 0; pick.fallback = 0; pick.last = null; }
      seeds.forEach(function(sd){
        /* 种子局下 generateFloor 用 (seedInfo.value, floor) 重建随机流，
           必须先改 seedInfo 再 setFloor，手写 __rngOverride 会被覆盖。 */
        state.seedInfo = { active: true, value: sd, daily: false, custom: true, startedAt: 0 };
        __rngOverride = null;
        __roamDebug.setFloor(1);
        var spawn = state.rooms[state.spawnRoomId];
        var doors = (state.doors || []).filter(function(d){ return d.targetRoomId >= 0; });
        var spawnDoors = doors.filter(function(d){ return d.roomId === spawn.id; });
        var graph = state.floorGraph || {};
        function deg(list){
          return (list || []).filter(function(e){ return e[0] === spawn.id || e[1] === spawn.id; }).length;
        }
        /* 逐房不变量：图度数 ≥2 但门=1 必须为 0 */
        var bad = 0;
        state.rooms.forEach(function(r){
          var d = (graph.edges || []).filter(function(e){ return e[0] === r.id || e[1] === r.id; }).length;
          var n = doors.filter(function(x){ return x.roomId === r.id; }).length;
          if (d >= 2 && n <= 1) bad += 1;
        });
        /* 0 列全部房间的最终度数 / 门数：用来判断"换选另一个 0 列房能不能拿到 2 门" */
        var col0 = state.rooms.filter(function(r){ return r.col === 0; }).map(function(r){
          return {
            id: r.id,
            degree: (graph.edges || []).filter(function(e){ return e[0] === r.id || e[1] === r.id; }).length,
            treeDegree: (graph.treeEdges || []).filter(function(e){ return e[0] === r.id || e[1] === r.id; }).length,
            doors: doors.filter(function(x){ return x.roomId === r.id; }).length
          };
        });
        rows.push({
          seed: sd,
          rooms: state.rooms.length,
          spawnRoomId: spawn.id,
          spawnCol: spawn.col,
          spawnDoors: spawnDoors.length,
          spawnDegree: deg(graph.edges),
          spawnTreeDegree: deg(graph.treeEdges),
          spawnLoopDegree: deg(graph.loopEdges),
          /* 方案 B 新增：出生房补的回环边（[spawnId, 对端Id] 或 null） */
          spawnLoopEdge: graph.spawnLoopEdge || null,
          spawnLoopEdgeAdded: !!graph.spawnLoopEdge,
          spawnLoopEdgePeer: graph.spawnLoopEdge
            ? (graph.spawnLoopEdge[0] === spawn.id ? graph.spawnLoopEdge[1] : graph.spawnLoopEdge[0])
            : null,
          spawnLoopEdgePeerCol: graph.spawnLoopEdge
            ? ((state.rooms[graph.spawnLoopEdge[0] === spawn.id ? graph.spawnLoopEdge[1] : graph.spawnLoopEdge[0]] || {}).col)
            : null,
          spawnPickMode: pick && pick.last ? pick.last.mode : null,
          spawnPickDegree: pick && pick.last ? pick.last.degree : null,
          deg2Door1: bad,
          col0: col0,
          /* 诊断：每列房间数 + 出生房"未用且同列/相邻列"的候选边数（解释 B 覆盖上限） */
          colCounts: (function(){
            var m = {};
            state.rooms.forEach(function(r){ m[r.col] = (m[r.col] || 0) + 1; });
            return m;
          })(),
          spawnAltCandidates: (graph.candidates || []).filter(function(e){
            var used = (graph.edges || []).some(function(x){
              return (x[0] === e[0] && x[1] === e[1]) || (x[0] === e[1] && x[1] === e[0]);
            });
            if (used) return false;
            if (e[0] !== spawn.id && e[1] !== spawn.id) return false;
            var peer = e[0] === spawn.id ? e[1] : e[0];
            var pr = state.rooms[peer];
            return !!pr && Math.abs(pr.col - spawn.col) <= 1;
          }).length,
          spawnDoorTargets: spawnDoors.map(function(d){ return d.targetRoomId; }),
          spawnTargetTypes: spawnDoors.map(function(d){
            return (state.rooms[d.targetRoomId] || {}).type || null;
          })
        });
      });
      return {
        rows: rows,
        pickStats: pick ? JSON.parse(JSON.stringify(pick)) : null,
        errors: (window.__errors || []).slice(0, 5)
      };
    })()`);
    rows = out.rows;
    pickStats = out.pickStats;
    if (out.errors && out.errors.length) console.error('页面错误：' + JSON.stringify(out.errors));
  } finally {
    h.close();
  }

  const summary = summarize(rows);
  const result = { tag: tag, count: count, file: file, seeds: seeds, summary: summary, pickStats: pickStats, rows: rows };
  fs.writeFileSync(path.join(OUT_DIR, `spawndoors-${tag}-${count}.json`), JSON.stringify(result, null, 2), 'utf8');

  console.log(`== 起始房门数分布（${tag}，${rows.length} 个种子 · 第 1 层）==`);
  console.log('门数分布: ' + Object.keys(summary.dist).sort().map((k) => `${k}门 × ${summary.dist[k]}`).join(' / '));
  console.log(`单门比例: ${summary.single}/${summary.total} = ${summary.singleRatio}%`);
  console.log(`图度≥2但门=1: ${summary.deg2Door1} 例`);
  console.log(`补了回环边: ${rows.filter((r) => r.spawnLoopEdgeAdded).length}/${rows.length}`);
  console.log(`退化分支（0 列无度≥2）: ${summary.fallback}/${summary.total} = ${Math.round((summary.fallback / Math.max(1, summary.total)) * 1000) / 10}%`);
  rows.forEach((r) => {
    console.log(`  ${r.seed.padEnd(9)} 门=${r.spawnDoors} 图度=${r.spawnDegree}(树${r.spawnTreeDegree}+环${r.spawnLoopDegree}) 补边=${r.spawnLoopEdgeAdded ? '对' + r.spawnLoopEdgePeer + '@c' + r.spawnLoopEdgePeerCol : '无'} 房=${r.rooms}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
