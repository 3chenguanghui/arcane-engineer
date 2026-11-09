// P7 专项验收：房间 +25% / 相机拉远（可见度 ≥55%、相机不越界、容量系数联动）
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9538;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'p7room');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;

/** 记录一条断言并打印 */
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
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(1000);

  // ---- 1) 配置与几何换算 ----
  const info = await ev('__roamDebug.room.info()');
  check('房间缩放默认开启且为 +25%',
    info.config.enabled === true && info.config.scale === 1.25, info.config);
  const wRatio = info.world.w / info.world.baseW;
  const hRatio = info.world.h / info.world.baseH;
  check('世界尺寸同比 ×1.25（4 列布局比例不变）',
    Math.abs(wRatio - 1.25) < 0.01 && Math.abs(hRatio - 1.25) < 0.01,
    { w: info.world.w, baseW: info.world.baseW, wRatio, h: info.world.h, hRatio });
  check('相机默认拉远（zoom 0.85，可视世界 = 屏幕 / zoom）',
    Math.abs(info.camera.zoom - 0.85) < 0.001
      && Math.abs(info.camera.spanW - info.camera.screenW / 0.85) < 2
      && Math.abs(info.camera.spanH - info.camera.screenH / 0.85) < 2,
    { zoom: info.camera.zoom, spanW: info.camera.spanW, spanH: info.camera.spanH, screen: [info.camera.screenW, info.camera.screenH] });

  // ---- 2) A/B：关掉缩放，统计 3 层平均单房面积 / 敌人数 ----
  // 注意：P7 量的是"房间放大 → 容量联动"这一条轴；G 批教学会主动把前五层敌人 −20%，
  // 两套 A/B 叠加会把容量信号掩盖。这里先关教学，确保两种缩放状态都在同一条难度基线上比较。
  const collect = async (enabled) => {
    return ev(`(() => {
      if (window.__roamDebug.onboard) window.__roamDebug.onboard.set({ enabled: false });
      __roamDebug.room.setCamera({ enabled: ${enabled} });
      __roamDebug.room.set({ enabled: ${enabled} });
      const areas = [];
      const counts = [];
      const muls = [];
      let lastInfo = null;
      for (let f = 1; f <= 3; f += 1) {
        __roamDebug.setFloor(f);
        const st = __roamDebug.room.info();
        lastInfo = st;
        st.rooms.forEach((r) => {
          areas.push(r.area);
          muls.push(r.areaMul);
          if (r.type === 'battle' || r.type === 'elite') counts.push(r.enemies);
        });
      }
      return {
        avgArea: areas.reduce((a, b) => a + b, 0) / areas.length,
        avgEnemies: counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0,
        maxMul: Math.max.apply(null, muls),
        minW: Math.min.apply(null, lastInfo.rooms.map((r) => r.w)),
        world: lastInfo.world
      };
    })()`);
  };
  const off = await collect(false);
  const on = await collect(true);
  // 量完容量轴立刻把教学开关复位，避免影响后续截图/相机断言
  await ev('__roamDebug.onboard.set({ enabled: true })');
  check('A/B：单房平均面积提升 ≥45%（理论 1.5625×）',
    on.avgArea / off.avgArea >= 1.45,
    { offAvg: Math.round(off.avgArea), onAvg: Math.round(on.avgArea), ratio: +(on.avgArea / off.avgArea).toFixed(3) });
  check('放大后房间最小宽度 ≥ 600（480 × 1.25）',
    on.minW >= 600, { minW: on.minW });
  check('容量系数联动：大房间 areaMul ≥ 1.2（敌人容量跟着面积走）',
    on.maxMul >= 1.2, { maxMul: on.maxMul });
  check('A/B：战斗/精英房平均敌人数提升 ≥15%',
    on.avgEnemies / off.avgEnemies >= 1.15,
    { offAvg: +off.avgEnemies.toFixed(2), onAvg: +on.avgEnemies.toFixed(2), ratio: +(on.avgEnemies / off.avgEnemies).toFixed(3) });

  // ---- 3) 相机不越界 + 逐房可见度 ≥55% ----
  await ev(`__roamDebug.room.set({ enabled: true }); __roamDebug.room.setCamera({ enabled: true }); __roamDebug.setFloor(1); true`);
  await sleep(900);
  const bounds = await ev(`(() => {
    const m0 = __roamDebug.room.measure();
    const out = [];
    const rooms = __roamDebug.room.info().rooms;
    const probe = [rooms[0], rooms[rooms.length - 1]];
    probe.forEach((r) => {
      if (!r) return;
      __roamDebug.teleport(r.cx, r.cy);
      const m = __roamDebug.room.measure();
      out.push({ id: r.id, cam: m.cam, inBounds: m.inBounds, zoom: m.zoom,
        visible: (m.rooms.find((x) => x.id === r.id) || {}).visible || 0 });
    });
    return { first: m0, probes: out };
  })()`);
  check('相机始终夹在世界内（不越界）',
    bounds.first.inBounds === true && bounds.probes.every((p) => p.inBounds === true),
    { cam: bounds.probes.map((p) => p.cam) });
  check('站在房间中心时，房间至少 55% 落在镜头内',
    bounds.probes.length > 0 && bounds.probes.every((p) => p.visible >= 0.55),
    bounds.probes);

  // ---- 4) 真场景 before/after 截图（同层最大房间） ----
  const shoot = async (enabled, name) => {
    return ev(`(() => {
      __roamDebug.room.set({ enabled: ${enabled} });
      __roamDebug.room.setCamera({ enabled: ${enabled} });
      __roamDebug.setFloor(1);
      const st = __roamDebug.room.info();
      const big = st.rooms.slice().sort((a, b) => b.area - a.area)[0];
      __roamDebug.teleport(big.cx, big.cy);
      return { room: big, zoom: st.camera.zoom, world: st.world };
    })()`).then(async (r) => { await sleep(900); await shot(name); return r; });
  };
  const before = await shoot(false, 'room-small-close.png');
  const after = await shoot(true, 'room-big-far.png');
  check('before/after 都定位到同层最大房间（截图已拍）',
    before.room.area > 0 && after.room.area > 0,
    { before: { w: before.room.w, h: before.room.h, zoom: before.zoom },
      after: { w: after.room.w, h: after.room.h, zoom: after.zoom } });
  const beforeSize = fs.existsSync(path.join(OUT, 'room-small-close.png')) ? fs.statSync(path.join(OUT, 'room-small-close.png')).size : 0;
  const afterSize = fs.existsSync(path.join(OUT, 'room-big-far.png')) ? fs.statSync(path.join(OUT, 'room-big-far.png')).size : 0;
  check('before/after 截图都已落盘（> 100KB）',
    beforeSize > 100000 && afterSize > 100000, { beforeSize, afterSize });

  const errs = await ev('__roamDebug.errors()');
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'p7-result.json'), JSON.stringify({ pass, total: results.length, results }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
