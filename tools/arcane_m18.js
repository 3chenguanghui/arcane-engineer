// M2-0 专项验收：分支地图 / 大世界 / 战争迷雾 / 视口裁剪 + 粒子对象池
// 用法：node arcane_m18.js [html路径] [截图输出目录]
// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9467;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'm18');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

/**
 * 记录一条断言并即时打印
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
    } catch (e) { /* 端口还没起来，继续等 */ }
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

  // ==================== 1) 世界尺寸 + 房间数 + 布局图 ====================
  const base = await ev(`(function(){
    var d = window.__roamDebug, s = d.getState();
    return { world: s.world, rooms: s.rooms.length, layout: s.layout, fog: s.fog, mode: s.mode, status: s.status };
  })()`);
  // M2 房间放大：世界随房间一起变大（2600×1900 → 3200×2300），断言同步更新
  check('世界放大到 3200×2300（M2 房间放大同步）', base.world && base.world.w === 3200 && base.world.h === 2300, base.world);
  check('每层 4–7 间房（旧回归约束不变）', base.rooms >= 4 && base.rooms <= 7, base.rooms);
  check('存在地图图结构 floorGraph', !!base.layout && Array.isArray(base.layout.edges), base.layout ? { cols: base.layout.cols.map((c) => c.length), edges: base.layout.edges.length } : null);
  check('房间分列 ≥ 2（不再是单链）', !!base.layout && base.layout.cols.filter((c) => c.length > 0).length >= 2, base.layout ? base.layout.cols.map((c) => c.length) : null);
  check('走廊边数 ≥ 房间数 - 1（保连通）', !!base.layout && base.layout.edges.length >= base.rooms - 1, base.layout ? base.layout.edges.length : null);

  // ==================== 2) 分支度 + BFS 可达性 ====================
  const graph = await ev(`(function(){
    var s = state, g = s.floorGraph;
    if (!g) return null;
    var adj = {}, deg = {};
    g.edges.forEach(function(e){
      (adj[e[0]] = adj[e[0]] || []).push(e[1]);
      (adj[e[1]] = adj[e[1]] || []).push(e[0]);
    });
    Object.keys(adj).forEach(function(k){ deg[k] = adj[k].length; });
    var spawn = getSpawnRoom();
    var seen = {}; seen[spawn.id] = true; var q = [spawn.id];
    while (q.length) {
      var id = q.shift();
      (adj[id] || []).forEach(function(n){ if (!seen[n]) { seen[n] = true; q.push(n); } });
    }
    var stair = s.stairs;
    var stairRoomId = -1;
    s.rooms.forEach(function(r){ if (Math.abs(r.cx - stair.x) < 1 && Math.abs(r.cy - stair.y) < 1) stairRoomId = r.id; });
    var maxDeg = 0;
    Object.keys(deg).forEach(function(k){ if (deg[k] > maxDeg) maxDeg = deg[k]; });
    return {
      reachable: Object.keys(seen).length, total: s.rooms.length,
      stairRoomId: stairRoomId, stairReachable: stairRoomId >= 0 && !!seen[stairRoomId],
      maxDegree: maxDeg, spawnId: spawn.id
    };
  })()`);
  check('从出生房 BFS 可达全部房间', graph && graph.reachable === graph.total, graph);
  check('楼梯房可达（不会把玩家困死）', graph && graph.stairReachable, graph ? { stairRoomId: graph.stairRoomId } : null);
  check('至少一间房有 2 条以上走廊（真分支）', graph && graph.maxDegree >= 2, graph ? { maxDegree: graph.maxDegree } : null);

  // ==================== 3) 战争迷雾：开局只亮出生房 ====================
  const fog0 = await ev(`(function(){
    var d = window.__roamDebug, s = d.getState();
    var canvas = document.getElementById('canvas') || document.querySelector('canvas');
    return { fog: s.fog, spawnId: getSpawnRoom().id, hasFogCanvas: !!fogCanvas && fogCanvas.width > 0 };
  })()`);
  check('开局只点亮出生房（≤2 间）', fog0.fog && fog0.fog.seenRooms <= 2, fog0.fog);
  check('出生房已探索', fog0.fog && fog0.fog.seenRoomIds.indexOf(fog0.spawnId) >= 0, fog0.fog ? fog0.fog.seenRoomIds : null);
  check('开局未走过的走廊保持黑暗（M2-0c 按路径揭示）', fog0.fog && fog0.fog.seenCorridors === 0, fog0.fog ? fog0.fog.seenCorridors : null);
  check('迷雾离屏画布已创建', fog0.hasFogCanvas, fog0.hasFogCanvas);
  await shot('m18-fog-start.png');

  // ==================== 4) 进入未探索房 → 迷雾揭示 ====================
  const unseen = await ev(`(function(){
    var s = state, fog = s.fog;
    var list = s.rooms.filter(function(r){ return !fog.seenRooms[r.id]; });
    if (!list.length) return null;
    var target = list[0];
    window.__roamDebug.teleport(target.cx, target.cy);
    return { id: target.id, cx: target.cx, cy: target.cy, before: { rooms: Object.keys(fog.seenRooms).length, corridors: Object.keys(fog.seenCorridors).length } };
  })()`);
  await sleep(500);
  const fog1 = await ev(`(function(){
    var s = window.__roamDebug.getState();
    return { fog: s.fog, currentRoomId: s.currentRoomId, hp: s.hp };
  })()`);
  check('走进未探索房后该房被点亮', !!unseen && fog1.fog.seenRoomIds.indexOf(unseen.id) >= 0, { target: unseen ? unseen.id : null, seen: fog1.fog.seenRoomIds });
  check('已探索房间数增加', !!unseen && fog1.fog.seenRooms > unseen.before.rooms, unseen ? { before: unseen.before.rooms, after: fog1.fog.seenRooms } : null);
  check('进房只点亮该房，不连带点亮未走过的走廊', !!unseen && fog1.fog.seenCorridors === unseen.before.corridors, unseen ? { before: unseen.before.corridors, after: fog1.fog.seenCorridors } : null);
  await shot('m18-fog-after.png');

  // 回到出生房并补血，避免后续性能测试被战斗干扰
  await ev("(function(){ window.__roamDebug.centerPlayer(); window.__roamDebug.setHp(100); return true; })()");
  await sleep(800);

  // ==================== 5) 视口裁剪：底图只贴镜头附近 ====================
  const patch = await ev(`(function(){
    var s = window.__roamDebug.getState();
    return { patch: s.scenePatch, view: s.view, world: s.world };
  })()`);
  check('静态底图只贴镜头附近（不是整图）', patch.patch && patch.patch.w <= patch.view.w + 60 && patch.patch.h <= patch.view.h + 60, patch);
  check('贴图区域小于世界尺寸', patch.patch && patch.patch.w < patch.world.w, patch.patch);

  // ==================== 6) 粒子视口裁剪 ====================
  await ev("(function(){ addBurst(state.player.x + 1600, state.player.y, '#ffffff', 40, 120, null, null, true); return true; })()");
  await sleep(80);
  const cull = await ev("(function(){ return window.__roamDebug.getState().drawStats; })()");
  check('屏幕外粒子被裁剪（culledParticles > 0）', cull && cull.culledParticles > 0, cull);
  await ev("(function(){ addBurst(state.player.x, state.player.y, '#ffffff', 40, 120, null, null, true); return true; })()");
  await sleep(80);
  const drawn = await ev("(function(){ return window.__roamDebug.getState().drawStats; })()");
  check('屏幕内粒子正常绘制（particles > 0）', drawn && drawn.particles > 0, drawn);

  // ==================== 7) 粒子对象池复用 ====================
  await ev("(function(){ for (var i = 0; i < 20; i += 1) addBurst(state.player.x, state.player.y, '#ffffff', 30, 120, null, null, true); return true; })()");
  await sleep(1200);
  const pool = await ev("(function(){ var s = window.__roamDebug.getState(); return { pool: s.particlePool, live: state.particles.length }; })()");
  check('死亡粒子回收进对象池（pool > 50）', pool && pool.pool > 50, pool);
  check('池子复用后活跃粒子数回落', pool && pool.live < 60, pool);

  // ==================== 8) 帧率 + 报错 ====================
  await sleep(1200);
  const perf = await ev("(function(){ var s = window.__roamDebug.getState(); return { fps: s.fps, errors: window.__roamDebug.errors() }; })()");
  check('帧率 ≥ 60', perf.fps >= 60, perf.fps);
  check('无运行时报错', Array.isArray(perf.errors) && perf.errors.length === 0, perf.errors);

  // 汇总
  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'm18-result.json'), JSON.stringify({ pass, total: results.length, results, base, graph, fog0, fog1, patch, cull, drawn, pool, perf }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 进程已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  process.exitCode = 1;
});
