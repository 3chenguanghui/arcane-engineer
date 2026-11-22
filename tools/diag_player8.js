/**
 * 玩家八条问题的只读取证探针
 * 用法：node tools/diag_player8.js [被测文件] [输出json]
 * 端口：9739
 *
 * 只读：不改数值、不写存档。开局后把"楼层图 / 选房候选 / 单房怪数 / 房间尺寸与角色占比"
 * 一次性导出来，供诊断报告引用。第 2 条（选过的房间又出现）靠两步证明：
 *   ① 静态：state.floorGraph.depthOf 是否覆盖所有房间（缺深度 == 过滤条件被绕过）
 *   ② 动态：从出生点连续走 3 步，记录每次候选里是否出现"已访问"或"已清"的房
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9739;
const ROOT = path.join(__dirname, '..');
const FILE = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = process.argv[3] ? path.resolve(ROOT, process.argv[3]) : path.join(ROOT, 'lab', 'player8', 'diag.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 主流程：起无头 Edge → 开局 → 导数据 → 落盘 */
async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    const onMsg = (m) => {
      const d = JSON.parse(m.data);
      if (d.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (d.error) rej(new Error(method + ' ' + JSON.stringify(d.error)));
      else res(d.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  for (let i = 0; i < 60; i += 1) {
    if (await ev("!!document.getElementById('btnStart') && typeof startGame === 'function'")) break;
    await sleep(250);
  }
  await ev("(function(){ __charSkipPick = true; __charPickedThisBoot = true;"
    + " if (typeof closeCharSelect === 'function') closeCharSelect(); startGame(); return true; })()");
  await sleep(1200);

  const facts = await ev(`(function(){
    var g = window.__roamDebug.floorGraph();
    var depthOf = g.depthOf || {};
    var rooms = g.rooms || [];
    var undefDepth = rooms.filter(function(r){ return depthOf[r.id] === undefined; }).map(function(r){ return r.id; });
    var zoom = (typeof cameraZoom === 'function') ? cameraZoom() : null;
    var viewW = state.viewW || window.innerWidth;
    var viewH = state.viewH || window.innerHeight;
    var pr = (GAME_CONFIG && GAME_CONFIG.playerRadius) || null;
    var cur = state.rooms[state.currentRoomId] || null;
    var choices = (typeof nextRoomChoices === 'function') ? nextRoomChoices() : null;
    return {
      version: (typeof GAME_VERSION === 'string' ? GAME_VERSION : (typeof version === 'string' ? version : null)),
      floor: state.floor,
      roomsPerFloorCfg: FLOOR_STRUCTURE_CONFIG.roomsPerFloor,
      maxChoicesCfg: ROOM_PICKER_CONFIG.maxChoices,
      view: { w: viewW, h: viewH, zoom: zoom },
      playerRadius: pr,
      roomSize: { minW: GAME_CONFIG.roomMinWidth, maxW: GAME_CONFIG.roomMaxWidth,
                  minH: GAME_CONFIG.roomMinHeight, maxH: GAME_CONFIG.roomMaxHeight },
      current: cur ? { id: cur.id, type: cur.type, w: cur.w, h: cur.h, enemyCount: cur.enemyCount, cleared: !!cur.cleared } : null,
      choices: choices,
      depthOfKeys: Object.keys(depthOf).length,
      undefDepth: undefDepth,
      rooms: rooms.map(function(r){
        var live = (state.enemies || []).filter(function(e){ return e.roomId === r.id && e.hp > 0; }).length;
        return { id: r.id, type: r.type, depth: r.depth, w: r.w, h: r.h,
                 planned: (state.rooms[r.id] && state.rooms[r.id].enemyCount) || null,
                 live: live, cleared: !!r.cleared, neighbors: r.neighbors };
      }),
      // 房间在屏幕上的像素尺寸（世界尺寸 × zoom）
      roomScreenPx: rooms.map(function(r){
        return { id: r.id, type: r.type, wPx: Math.round(r.w * (zoom||1)), hPx: Math.round(r.h * (zoom||1)) };
      }),
      playerDiamPx: Math.round((pr || 0) * 2 * (zoom || 1))
    };
  })()`);

  // 连续走 3 步：每步看候选里有没有"已访问"的房（用图深度 + 访问集判）
  const walk = await ev(`(function(){
    var visited = {}; visited[state.currentRoomId] = true;
    var steps = [];
    for (var i = 0; i < 3; i++) {
      var curId = state.currentRoomId;
      var cur = state.rooms[curId];
      // 只读探针：不真清怪，直接允许离开（clear 标记仅用于本轮内走图）
      if (cur && !cur.cleared) cur.cleared = true;
      var ids = nextRoomChoices();
      var rows = ids.map(function(id){
        var r = state.rooms[id];
        return { id: id, type: r && r.type, depth: r && r.depth,
                 seen: !!visited[id], cleared: !!(r && r.cleared),
                 depthOf: (state.floorGraph.depthOf || {})[id] };
      });
      steps.push({ from: curId, fromDepth: cur && cur.depth, offered: rows });
      var next = ids[0];
      if (next == null) break;
      // 走真流程：直接传送（与 pickRoomFromOverlay 同一条函数）
      if (typeof pickRoomFromOverlay === 'function') pickRoomFromOverlay(next);
      visited[next] = true;
      if (typeof closeRoomPicker === 'function') closeRoomPicker();
    }
    return { steps: steps, visited: Object.keys(visited).map(Number) };
  })()`);
  await sleep(800);

  const after = await ev(`(function(){
    return { currentRoomId: state.currentRoomId,
             currentType: (state.rooms[state.currentRoomId]||{}).type,
             floor: state.floor,
             enemiesAlive: (state.enemies||[]).filter(function(e){return e.hp>0;}).length,
             hudFloorLabel: (document.getElementById('minimapFloor')||{}).textContent || null,
             version: (document.querySelector('meta[name=version]')||{}).content || null };
  })()`);

  const out = { file: FILE, sizeBytes: fs.statSync(FILE).size, facts, walk, after };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE', OUT);
  console.log('floor=', facts.floor, 'rooms=', facts.rooms.length, 'undefDepth=', JSON.stringify(facts.undefDepth));
  console.log('choices@spawn=', JSON.stringify(facts.choices));
  console.log('playerDiamPx=', facts.playerDiamPx, 'roomScreenPx=', JSON.stringify(facts.roomScreenPx.slice(0, 8)));
  walk.steps.forEach(function (s, i) {
    console.log('step' + (i + 1), 'from', s.from, 'depth', s.fromDepth,
      'offered', JSON.stringify(s.offered));
  });
  try { ws.close(); } catch (e) { /* ignore */ }
  try { edge.kill(); } catch (e) { /* ignore */ }
}

main().catch((e) => { console.error('FAIL', e.message); process.exitCode = 1; });
