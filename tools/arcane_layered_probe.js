/**
 * D2 + D5 实测探针：20 层房间结构 / 分层深度 / 断言计数
 * ------------------------------------------------------------
 * 用法：node tools/arcane_layered_probe.js [html文件] [输出后缀]
 *       默认跑 index_arcane_v2.html；想对比改前就传 baseline 里的旧件。
 * 端口：9543
 * 输出：.screenshots/art/d5-struct-<后缀>.json
 *
 * 每层输出：
 *   depth:   每个房间的深度（出生 0 / 首领 max）
 *   hops:    出生 → 首领的最短跳数（=2 就说明"两跳能进首领"）
 *   layers:  每层房数（点分格式，如 1.2.2.1）
 *   badEdge: 跨了不止一层的边数（D5 要求恒 0）
 *   offPath: 不在任何"出生→首领"路径上的房间数（= 可以整段跳过的房）
 *   mix:     每层房型（用于核对"同层同类型最多 1 间"）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9543;
const ROOT = path.join(__dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, 'index_arcane_v2.html');
const TAG = process.argv[3] || 'run';
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1280,720', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

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
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  /* 3.2MB 解析 + 新档首局会先弹角色选择，固定等待和点 #btnStart 都不可靠；
     改成轮询 startGame，必要时补 chooseCharacter，最后等 __roamDebug 就绪。 */
  for (let i = 0; i < 60; i += 1) {
    if (await ev(`typeof startGame === 'function'`)) break;
    await sleep(250);
  }
  await ev(`(function(){
    if (state.mode === 'title') {
      startGame();
      if (state.mode === 'title' && typeof chooseCharacter === 'function' && typeof CHARACTER_CONFIG !== 'undefined') {
        chooseCharacter(CHARACTER_CONFIG.ids[0]);
      }
    }
    return state.mode;
  })()`);
  for (let i = 0; i < 60; i += 1) {
    if (await ev(`!!window.__roamDebug`)) break;
    await sleep(250);
  }

  const rows = [];
  for (let f = 1; f <= 20; f += 1) {
    await ev(`(function(){ window.__roamDebug.setFloor(${f}); return state.floor; })()`);
    await sleep(320);
    const row = await ev(`(function(){
      var g = window.__roamDebug.floorGraph();
      var byId = {};
      g.rooms.forEach(function(r){ byId[r.id] = r; });
      var depth = g.depthOf || null;
      // 用邻接表还原无向边（只保留 id 小指向 id 大的，避免重复计数）
      var edges = [];
      g.rooms.forEach(function(r){
        r.neighbors.forEach(function(n){ if (r.id < n) edges.push([r.id, n]); });
      });
      // 1) 跨层边计数（需要 depthOf，基线版本没有）
      var badEdge = 0;
      if (depth) {
        edges.forEach(function(e){
          var a = depth[e[0]], b = depth[e[1]];
          if (a === undefined || b === undefined || Math.abs(a - b) !== 1) badEdge += 1;
        });
      }
      // 2) 出生 → 首领最短跳数（BFS）
      function bfs(from, to) {
        var q = [from], dist = {}; dist[from] = 0;
        while (q.length) {
          var cur = q.shift();
          if (cur === to) return dist[cur];
          var ns = byId[cur] ? byId[cur].neighbors : [];
          for (var i = 0; i < ns.length; i += 1) {
            if (dist[ns[i]] === undefined) { dist[ns[i]] = dist[cur] + 1; q.push(ns[i]); }
          }
        }
        return -1;
      }
      // 3) 有多少房不在"出生→首领"的任意最短路/通路上：
      //    简化口径——能各自被最短路径经过的房间集合（枚举所有最短路径太多，
      //    这里只统计"popcount 深度层"：深度存在且深度 < 首领深度即算在推进线上）
      var offPath = 0;
      var layerCount = {};
      g.rooms.forEach(function(r){
        var d = depth ? depth[r.id] : null;
        if (d === undefined || d === null) { offPath += 1; return; }
        layerCount[d] = (layerCount[d] || 0) + 1;
      });
      var maxDepth = Object.keys(layerCount).reduce(function(a, k){ return Math.max(a, Number(k)); }, 0);
      g.rooms.forEach(function(r){
        var d = depth ? depth[r.id] : null;
        if (d !== undefined && d !== null && d > maxDepth) offPath += 1;
      });
      var layers = Object.keys(layerCount).sort(function(a,b){ return a-b; })
        .map(function(k){ return layerCount[k]; }).join('.');
      return {
        floor: g.floor,
        rooms: g.rooms.length,
        layered: g.layered,
        spawnId: g.spawnId,
        stairId: g.stairId,
        bossDepth: depth ? depth[g.stairId] : null,
        spawnDepth: depth ? depth[g.spawnId] : null,
        bossDepthEqualsMax: depth ? depth[g.stairId] === maxDepth : null,
        spawnDirectToBoss: byId[g.spawnId] ? byId[g.spawnId].neighbors.indexOf(g.stairId) >= 0 : null,
        hops: bfs(g.spawnId, g.stairId),
        edges: edges.length,
        badEdge: badEdge,
        layers: layers || null,
        mix: g.rooms.map(function(r){ return r.type.charAt(0).toUpperCase(); }).join(''),
        types: g.rooms.map(function(r){ return r.type; }),
        depthList: depth ? g.rooms.map(function(r){ return depth[r.id]; }) : null
      };
    })()`);
    rows.push(row);
    console.log('F' + String(f).padStart(2, '0'),
      'rooms=' + row.rooms, 'layered=' + row.layered, 'layers=' + (row.layers || '-'),
      'hops=' + row.hops, 'badEdge=' + row.badEdge, 'bossDepth=' + row.bossDepth,
      'mix=' + row.mix);
  }

  const stats = await ev(`(function(){
    return {
      layered: (typeof LAYERED_STATS !== 'undefined') ? LAYERED_STATS : null,
      roomMix: (typeof ROOM_MIX_STATS !== 'undefined') ? ROOM_MIX_STATS : null,
      errors: (window.__errors || []).slice(0, 10)
    };
  })()`);

  const summary = {
    file: path.basename(FILE),
    tag: TAG,
    generatedAt: new Date().toISOString(),
    rows,
    stats,
    agg: {
      floors: rows.length,
      layeredFloors: rows.filter((r) => r.layered).length,
      hop2orLess: rows.filter((r) => r.hops >= 0 && r.hops <= 2).length,
      hopCounts: rows.reduce((acc, r) => { acc[r.hops] = (acc[r.hops] || 0) + 1; return acc; }, {}),
      badEdges: rows.reduce((a, r) => a + r.badEdge, 0),
      layerShapes: Array.from(new Set(rows.map((r) => r.layers || 'none')))
    }
  };
  const outFile = path.join(OUT_DIR, 'd5-struct-' + TAG + '.json');
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log('\n===== ' + path.basename(FILE) + ' =====');
  console.log('layeredFloors', summary.agg.layeredFloors, '/', summary.agg.floors,
    '| hops分布', JSON.stringify(summary.agg.hopCounts),
    '| 两跳内进首领的层数', summary.agg.hop2orLess,
    '| 跨层边', summary.agg.badEdges,
    '| 层形状', summary.agg.layerShapes.join(' / '));
  console.log('stats', JSON.stringify(stats));
  console.log('OUT', outFile);
  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
