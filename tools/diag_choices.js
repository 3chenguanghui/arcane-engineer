/**
 * 只读探针：统计"每次开选房浮层能看到几个真实未探索出口"
 * ------------------------------------------------------------
 * 用法：node tools/diag_choices.js [层数上限，默认 10]
 * 做法：直接调用页面里的 buildValidatedFloorLayout(floor) 生成 1..N 层，
 *      对每间房枚举"从哪个邻房进来"，算 fresh = 邻房数 - 1（排掉来路），
 *      再按"第一次到达该房"的入边统计，得到玩家实际会遇到的选择数分布。
 * 不改任何游戏状态、不写存档。
 */
const { spawn } = require('child_process');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9759;
/* 默认测主文件；设 ARCANE_FILE 可指向临时副本（例如先验证 10 房拓扑再改 roomsPerFloor） */
const FILE = process.env.ARCANE_FILE
  ? path.resolve(process.env.ARCANE_FILE)
  : path.resolve(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 主流程：起浏览器 → 逐层生成布局 → 打印出口数分布 */
async function main() {
  const maxFloor = Number(process.argv[2] || 10);
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.text || '') + ' ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  for (let i = 0; i < 120; i += 1) {
    const ok = await ev("typeof buildValidatedFloorLayout === 'function' && typeof GAME_CONFIG === 'object'");
    if (ok) break;
    await sleep(250);
  }
  const result = await ev(`(() => {
    const out = [];
    for (let f = 1; f <= ${maxFloor}; f += 1) {
      const layout = buildValidatedFloorLayout(f);
      const rooms = layout.rooms; const edges = layout.graph.edges || [];
      const deg = {}; const adj = {};
      edges.forEach((e) => {
        (adj[e[0]] = adj[e[0]] || []).push(e[1]);
        (adj[e[1]] = adj[e[1]] || []).push(e[0]);
        deg[e[0]] = (deg[e[0]] || 0) + 1;
        deg[e[1]] = (deg[e[1]] || 0) + 1;
      });
      /* 从出生房 BFS：每个点第一次到达时的"可选数" = 邻房数 - 1（扣掉来路） */
      const first = {}; first[layout.spawnId] = (adj[layout.spawnId] || []).length;
      const seen = {}; seen[layout.spawnId] = true;
      const queue = [layout.spawnId];
      while (queue.length) {
        const cur = queue.shift();
        (adj[cur] || []).forEach((n) => {
          if (seen[n]) return;
          seen[n] = true;
          first[n] = (adj[n] || []).length - 1;
          queue.push(n);
        });
      }
      const choices = rooms.map((r) => first[r.id]).filter((v) => v !== undefined);
      out.push({
        floor: f,
        layered: !!layout.graph.layered,
        fallback: !!layout.fallback,
        valid: !!layout.valid,
        depthKeys: Object.keys(layout.graph.depthOf || {}).length,
        edges: edges.length,
        degrees: rooms.map((r) => deg[r.id] || 0),
        choices: choices,
        minChoices: Math.min.apply(null, choices),
        spawnChoices: first[layout.spawnId]
      });
    }
    return out;
  })()`);
  const all = [];
  result.forEach((row) => {
    all.push.apply(all, row.choices);
    console.log(`F${row.floor} layered=${row.layered} valid=${row.valid} depthKeys=${row.depthKeys} edges=${row.edges} degrees=[${row.degrees.join(',')}] choices=[${row.choices.join(',')}] min=${row.minChoices} spawn=${row.spawnChoices}`);
  });
  const avg = all.reduce((s, v) => s + v, 0) / all.length;
  const dist = {};
  all.forEach((v) => { dist[v] = (dist[v] || 0) + 1; });
  console.log('ALL choices avg=' + avg.toFixed(2) + ' dist=' + JSON.stringify(dist) + ' n=' + all.length);
  console.log('FLOORS_BELOW_2=' + result.filter((r) => r.minChoices < 2).map((r) => r.floor).join(','));
  killEdge(edge);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
