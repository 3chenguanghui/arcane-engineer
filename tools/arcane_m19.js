// M2-0b 专项：分支图（Delaunay → MST → 回环边）
// 断言：4–7 房 / 树边 = n-1 / 有回环 / 全连通 / 无孤岛 / 出生房最左 / 楼梯最远 /
//      ≥2 条到楼梯的路线 / 两条路线房间类型不同 / 巡逻怪绑定规则不变
// 用法：node arcane_m19.js [html路径]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9468;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'm19');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

/**
 * 记录一条断言并打印
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
    } catch (e) { /* 端口未就绪，继续等 */ }
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
  await sleep(900);

  // 页内快照函数：读一层地图的图结构并做连通性 / 最远房 / 路线统计
  const SNAPSHOT = `(function(){
    var rooms = state.rooms;
    var g = state.floorGraph;
    var spawn = getSpawnRoom();
    var adj = {};
    rooms.forEach(function(r){ adj[r.id] = []; });
    g.edges.forEach(function(e){ adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); });
    var seen = {}; seen[spawn.id] = true; var q = [spawn.id];
    while (q.length) { var id = q.shift(); adj[id].forEach(function(n){ if (!seen[n]) { seen[n] = true; q.push(n); } }); }
    var stairId = -1;
    rooms.forEach(function(r){ if (Math.abs(r.cx - state.stairs.x) < 1 && Math.abs(r.cy - state.stairs.y) < 1) stairId = r.id; });
    var farthest = rooms.reduce(function(best, r){
      return Math.hypot(r.cx - spawn.cx, r.cy - spawn.cy) > Math.hypot(best.cx - spawn.cx, best.cy - spawn.cy) ? r : best;
    }, rooms[0]);
    return {
      rooms: rooms.length,
      edges: g.edges.length,
      tree: g.treeEdges.length,
      loops: g.loopEdges.length,
      reachable: Object.keys(seen).length,
      isolated: rooms.filter(function(r){ return adj[r.id].length === 0; }).map(function(r){ return r.id; }),
      minDegree: rooms.reduce(function(m, r){ return Math.min(m, adj[r.id].length); }, 99),
      spawnCol: spawn.col,
      spawnId: spawn.id,
      stairId: stairId,
      stairsFarthest: farthest.id === stairId,
      routes: g.routes.length,
      routesDistinct: g.routes.length >= 2 && JSON.stringify(g.routes[0]) !== JSON.stringify(g.routes[1]),
      routeA: g.routes[0] || [],
      routeB: g.routes[1] || [],
      variety: g.routeVariety,
      patrolBad: state.enemies.filter(function(e){ return e.roomId !== -2 && (e.roomId == null || e.roomId < 0 || e.roomId >= rooms.length); }).length,
      floor: state.floor,
      types: rooms.map(function(r){ return r.type; })
    };
  })()`;

  // ==================== 1) 当前层基线 ====================
  const base = await ev(SNAPSHOT);
  check('每层 4–7 间房', base.rooms >= 4 && base.rooms <= 7, base.rooms);
  check('MST 树边 = 房间数-1（生成树成立）', base.tree === base.rooms - 1, { tree: base.tree, rooms: base.rooms });
  check('至少 1 条回环边（不是纯树）', base.loops >= 1, base.loops);
  check('全图连通：出生房可达所有房间', base.reachable === base.rooms, { reachable: base.reachable, rooms: base.rooms });
  check('无孤岛（每个房间 ≥1 条走廊）', base.isolated.length === 0 && base.minDegree >= 1, { isolated: base.isolated, minDegree: base.minDegree });
  check('出生房在第 0 列（最左）', base.spawnCol === 0, base.spawnCol);
  check('楼梯房是离出生房最远的房间', base.stairsFarthest, { spawn: base.spawnId, stair: base.stairId });
  check('到楼梯有 ≥2 条路线', base.routes >= 2, base.routes);
  check('两条路线不是同一条（房间序列不同）', base.routesDistinct, { a: base.routeA, b: base.routeB });
  check('两条路线风险/收益不同（类型组合有差异）', !!(base.variety && base.variety.ok && (
    JSON.stringify(base.variety.typesA) !== JSON.stringify(base.variety.typesB) || base.variety.convertedId >= 0
  )), base.variety);
  check('走廊巡逻怪绑定规则不变', base.patrolBad === 0, { bad: base.patrolBad });
  await shot('m19-branch-start.png');

  // ==================== 2) 连生成 6 层都要满足（抗随机性） ====================
  const samples = await ev(`(function(){
    var list = [];
    for (var n = 0; n < 6; n += 1) {
      // 同步 state.floor：B 开放层按"层数 % 3"判定，不同步会一直按第 1 层算
      state.floor = 1 + (n % 3);
      generateFloor(state.floor);
      list.push(${SNAPSHOT});
    }
    return list;
  })()`);

  // B 自由探索层：第 3/6/9… 层是开放层，房间数 7–9；其余层仍为 4–7
  const roomsOk = samples.every((s) => (s.floor % 3 === 0
    ? (s.rooms >= 7 && s.rooms <= 9)
    : (s.rooms >= 4 && s.rooms <= 7)));
  const treeOk = samples.every((s) => s.tree === s.rooms - 1);
  const loopOk = samples.every((s) => s.loops >= 1);
  const connOk = samples.every((s) => s.reachable === s.rooms);
  const isoOk = samples.every((s) => s.isolated.length === 0);
  const spawnOk = samples.every((s) => s.spawnCol === 0);
  const farOk = samples.every((s) => s.stairsFarthest);
  const routesOk = samples.every((s) => s.routes >= 2 && s.routesDistinct);
  const varietyOk = samples.every((s) => s.variety && s.variety.ok && (
    JSON.stringify(s.variety.typesA) !== JSON.stringify(s.variety.typesB) || s.variety.convertedId >= 0
  ));
  const patrolOk = samples.every((s) => s.patrolBad === 0);

  check('6 层采样：房间数（普通 4–7 / 开放层 7–9）', roomsOk,
    samples.map((s) => [s.floor, s.rooms]));
  check('6 层采样：树边 = n-1', treeOk, samples.map((s) => [s.tree, s.rooms]));
  check('6 层采样：都有回环边', loopOk, samples.map((s) => s.loops));
  check('6 层采样：全部连通', connOk, samples.map((s) => [s.reachable, s.rooms]));
  check('6 层采样：无孤岛', isoOk, samples.map((s) => s.minDegree));
  check('6 层采样：出生房都在第 0 列', spawnOk, samples.map((s) => s.spawnCol));
  check('6 层采样：楼梯房都最远', farOk, samples.map((s) => s.stairsFarthest));
  check('6 层采样：都 ≥2 条路线且不同', routesOk, samples.map((s) => [s.routes, s.routesDistinct]));
  check('6 层采样：两条路线类型组合都不同', varietyOk, samples.map((s) => s.variety && [s.variety.typesA, s.variety.typesB]));
  check('6 层采样：巡逻绑定规则都正常', patrolOk, samples.map((s) => s.patrolBad));

  // 回到正常状态并截图（展示当前层的分支图小地图）
  await ev('(function(){ generateFloor(1); window.__roamDebug.centerPlayer(); return true; })()');
  await sleep(500);
  await shot('m19-branch-after.png');

  // ==================== 3) 帧率 + 报错 ====================
  await sleep(1000);
  const perf = await ev("(function(){ var s = window.__roamDebug.getState(); return { fps: s.fps, errors: window.__roamDebug.errors() }; })()");
  check('帧率 ≥ 60', perf.fps >= 60, perf.fps);
  check('无运行时报错', Array.isArray(perf.errors) && perf.errors.length === 0, perf.errors);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'm19-result.json'), JSON.stringify({
    pass, total: results.length, results, base, samples, perf
  }, null, 2));

  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  process.exitCode = 1;
});
