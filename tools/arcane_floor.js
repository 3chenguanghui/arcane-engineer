/**
 * G1 楼层生成加固验收：A0–A6
 * 用法：node tools/arcane_floor.js
 * 端口：9518
 * 输出：.screenshots/art/floor-gen.png、floor-gen-result.json
 *
 * 断言：
 *  A0 配置默认值（enabled / maxAttempts / 房间数区间 / 种子常数）
 *  A1 连续生成 50 层：全部通过"连通 + 楼梯最远 + 边合法"校验，房间数 4–7
 *  A2 当前真实楼层：楼梯坐标落在最远房间内、楼梯房存在且与出生房不同
 *  A3 房内种子稳定：同一层重复生成，房间种子完全一致（不闪变）
 *  A4 线性兜底：把 maxAttempts 设为 0 时仍能生成合法楼层（不是死局）
 *  A5 真实 generateFloor(3) 成功落地并写入 floorGen 快照
 *  A6 截图 >10KB / fps≥60 / 无脚本错误
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9518;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
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
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1300);

  // ---------- A0 配置默认值 ----------
  const a0 = await ev(`(function(){
    var info = window.__roamDebug.floorGen.info();
    return { config: info.config, last: info.last };
  })()`);
  ok('A0 配置默认值（enabled / maxAttempts=8 / 5 房 / 种子常数）',
    a0.config.enabled === true && a0.config.maxAttempts === 8
      && a0.config.minRooms === 5 && a0.config.maxRooms === 5
      && a0.config.seedMix === 2654435761, a0.config);

  // ---------- A1 连续生成 50 层 ----------
  const a1 = await ev(`window.__roamDebug.floorGen.simulate(50)`);
  ok('A1 连续 50 层：连通 / 楼梯最远 / 边合法全部通过，房间数 =5',
    a1.runs === 50 && a1.bad === 0 && a1.minRooms >= 5 && a1.maxRooms <= 5, a1);

  // ---------- A2 当前真实楼层的楼梯位置 ----------
  const a2 = await ev(`(function(){
    var st = state.stairs;
    var spawn = state.rooms[state.spawnRoomId];
    var stairRoom = state.rooms.find(function(r){
      return st.x >= r.x && st.x <= r.x + r.w && st.y >= r.y && st.y <= r.y + r.h;
    }) || null;
    var farthest = state.rooms.reduce(function(best, r){
      var d = Math.hypot(r.cx - spawn.cx, r.cy - spawn.cy);
      var bd = Math.hypot(best.cx - spawn.cx, best.cy - spawn.cy);
      return d > bd ? r : best;
    }, state.rooms[0]);
    return {
      spawnId: state.spawnRoomId,
      stairRoomId: stairRoom ? stairRoom.id : -1,
      farthestId: farthest.id,
      rooms: state.rooms.length,
      floorGen: window.__roamDebug.getState().floorGen
    };
  })()`);
  ok('A2 楼梯房存在、在楼梯坐标处、且是离出生房最远的房',
    a2.stairRoomId >= 0 && a2.stairRoomId === a2.farthestId
      && a2.stairRoomId !== a2.spawnId && a2.floorGen && a2.floorGen.valid === true, a2);

  // ---------- A3 房内种子稳定 ----------
  const a3 = await ev(`(function(){
    FLOOR_GEN_CONFIG.enabled = true;
    window.__roamDebug.floorGen.simulate(3);
    var first = window.__roamDebug.floorGen.simulate(3).samples.map(function(s){ return s.seed; });
    var second = window.__roamDebug.floorGen.simulate(3).samples.map(function(s){ return s.seed; });
    return { first: first, second: second, same: JSON.stringify(first) === JSON.stringify(second) };
  })()`);
  ok('A3 同层重复生成的房间种子完全一致（房内内容不闪变）',
    a3.same === true && a3.first.length === 3 && a3.first.every(function (s) { return s != null; }), a3);

  // ---------- A4 线性兜底 ----------
  const a4 = await ev(`(function(){
    var saved = FLOOR_GEN_CONFIG.maxAttempts;
    FLOOR_GEN_CONFIG.maxAttempts = 0;   // 强制一次尝试都不做 → 只能走兜底
    var r = window.__roamDebug.floorGen.simulate(1);
    FLOOR_GEN_CONFIG.maxAttempts = saved;
    return r;
  })()`);
  ok('A4 maxAttempts=0 时走线性兜底，仍然生成合法楼层（无死局）',
    a4.bad === 0 && a4.fallbackUsed >= 1 && a4.minRooms >= 4, a4);

  // ---------- A5 真实 generateFloor ----------
  const errBefore = await ev(`(window.__errors || []).length`);
  const a5 = await ev(`(function(){
    generateFloor(3);
    return {
      rooms: state.rooms.length,
      floorGen: state.floorGen,
      stairRoomType: state.rooms.find(function(r){
        var st = state.stairs;
        return st.x >= r.x && st.x <= r.x + r.w && st.y >= r.y && st.y <= r.y + r.h;
      }) ? state.rooms.filter(function(r){ return r.type === 'boss'; }).length : 0,
      graphEdges: state.floorGraph ? state.floorGraph.edges.length : 0
    };
  })()`);
  await sleep(300);
  const errAfter = await ev(`(window.__errors || []).length`);
  ok('A5 真实 generateFloor(3) 成功：有楼梯房（boss）、有图边、floorGen.valid=true、无新增错误',
    a5.rooms >= 4 && a5.floorGen && a5.floorGen.valid === true
      && a5.stairRoomType >= 1 && a5.graphEdges >= a5.rooms - 1
      && errAfter === errBefore, { a5, errBefore, errAfter });

  // 回到第 1 层，避免后续截图是第 3 层的首领房
  await ev(`generateFloor(1)`);
  await sleep(400);
  await shot('floor-gen.png');

  // ---------- A6 fps / 错误 / 截图 ----------
  const a6 = await ev(`(function(){
    var fps = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return fps.then(function(f){
      return { fps: f, errors: (window.__errors || []).length };
    });
  })()`);
  let shotSize = 0;
  try { shotSize = fs.statSync(path.join(OUT_DIR, 'floor-gen.png')).size; } catch (e) { shotSize = 0; }
  ok('A6 截图 >10KB / fps≥60 / 无脚本错误',
    shotSize > 10240 && a6.fps >= 60 && a6.errors === 0, { shot: shotSize, a6 });

  fs.writeFileSync(path.join(OUT_DIR, 'floor-gen-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== G1 floor-gen ' + pass + '/' + asserts.length + ' ===== (shot ' + shotSize + 'B, fps ' + a6.fps + ')');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
