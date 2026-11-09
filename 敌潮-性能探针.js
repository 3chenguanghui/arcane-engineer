/**
 * 性能 A/B 探针（只读）：固定机位 drawcall + 战斗峰值 drawcall + p95 帧时间
 * ------------------------------------------------------------
 * 用法：node 敌潮-性能探针.js <被测文件> [楼层...]
 * 例：  node 敌潮-性能探针.js index_arcane_v2.html 6 10
 *
 * 口径（四点，缺一个 A/B 就不可比）：
 *   · drawcall = 每帧 CanvasRenderingContext2D 的绘制调用次数（fillRect/stroke/drawImage/fill/…）
 *   · 帧时间 = requestAnimationFrame 相邻时间戳差（ms）取 p95；另记 render 函数自身 CPU 耗时 p95
 *   · 固定机位 = 玩家钉在目标房间中心、相机立即对齐，等待期间反复重新钉住
 *   · 固定视口 = 强制 1440×900（headless 下 canvas 会随机停在 500×320，drawcall 直接差 20%）
 *   · 同屏数量 = 两版都强制 8 只、同房间同坐标，保证只有代码差异
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { prepareProfile, killEdge } = require('./tools/arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9560;
const FILE = path.resolve(process.argv[2] || path.join(__dirname, 'index_arcane_v2.html'));
const FILE_URL = 'file:///' + FILE.replace(/\\/g, '/');
const FLOORS = process.argv.slice(3).map(Number).filter((n) => n > 0);
if (!FLOORS.length) FLOORS.push(6, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* wait */ }
    await sleep(250);
  }
  if (!target) { killEdge(edge); throw new Error('调试端口未就绪'); }

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
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Page.enable');
  await send('Page.navigate', { url: FILE_URL });

  let ready = false;
  for (let i = 0; i < 80; i += 1) {
    try {
      ready = await ev(`document.readyState === 'complete' && !!document.getElementById('btnStart') && typeof state !== 'undefined'`);
      if (ready) break;
    } catch (e) { /* loading */ }
    await sleep(250);
  }
  if (!ready) throw new Error('页面未就绪');

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const view = await ev(`(() => { resizeCanvas(); return { vw: state.viewW, vh: state.viewH }; })()`);
  console.log('viewport=' + JSON.stringify(view));

  const p = await ev(`(() => { const r = document.getElementById('btnStart').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(1200);

  await ev(`(() => {
    if (window.__perfInstalled) return true;
    window.__perfInstalled = true;
    const proto = CanvasRenderingContext2D.prototype;
    const names = ['fillRect','strokeRect','clearRect','drawImage','fill','stroke','fillText','strokeText','putImageData','drawFocusIfNeeded'];
    window.__ops = 0;
    names.forEach((n) => {
      const orig = proto[n];
      if (!orig) return;
      proto[n] = function () { window.__ops += 1; return orig.apply(this, arguments); };
    });
    window.__perf = { ops: [], dt: [], cpu: [] };
    const origRender = render;
    window.render = function () {
      window.__ops = 0;
      const t0 = performance.now();
      const r = origRender.apply(this, arguments);
      window.__perf.cpu.push(performance.now() - t0);
      window.__perf.ops.push(window.__ops);
      return r;
    };
    const raf = window.requestAnimationFrame.bind(window);
    window.__lastTs = 0;
    window.requestAnimationFrame = function (cb) {
      return raf(function (ts) {
        if (window.__lastTs) window.__perf.dt.push(ts - window.__lastTs);
        window.__lastTs = ts;
        return cb(ts);
      });
    };
    return true;
  })()`);

  const results = [];
  for (const floor of FLOORS) {
    const setup = await ev(`(() => {
      // 固定种子：A/B 两版必须生成同一张楼层布局，否则房间面积/类型不同会让 drawcall 直接失真
      state.seedInfo = { active: true, value: 'perf-fixed', daily: false };
      __roamDebug.enemies.floor(${floor});
      state.difficulty = 'normal';
      const rooms = state.rooms.filter((r) => r.type === 'battle' || r.type === 'elite');
      if (!rooms.length) return { ok: false };
      const room = rooms.sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
      state.player.x = room.cx; state.player.y = room.cy;
      state.player.hp = 99999; state.player.maxHp = 99999;
      updateCamera(0);
      state.enemies = [];              // 先清场，测"固定机位"底噪
      state.rooms.forEach((r) => { if (r.wavePending) r.wavePending = []; });
      return { ok: true, roomId: room.id, room: room.type, planned: room.enemyCount, cx: room.cx, cy: room.cy };
    })()`);
    if (!setup.ok) { results.push({ floor, error: 'no battle room' }); continue; }

    // A. 固定机位（无怪）：每段重新钉住玩家坐标，避免等待期间被物理/复位挪走
    await ev(`(() => {
      state.player.x = ${setup.cx}; state.player.y = ${setup.cy}; state.player.hp = 99999;
      updateCamera(0);
      window.__perf = { ops: [], dt: [], cpu: [] }; window.__lastTs = 0;
      return true;
    })()`);
    await sleep(2200);
    const calm = await ev(`(() => {
      const ops = window.__perf.ops.slice(20);
      const dt = window.__perf.dt.slice(20).sort((a, b) => a - b);
      const cpu = window.__perf.cpu.slice(20).sort((a, b) => a - b);
      const p = dt.length ? dt[Math.min(dt.length - 1, Math.floor(dt.length * 0.95))] : 0;
      return { drawAvg: ops.length ? Math.round(ops.reduce((a, b) => a + b, 0) / ops.length) : 0,
        p95: +p.toFixed(2), frames: ops.length,
        cpuP95: cpu.length ? +cpu[Math.min(cpu.length - 1, Math.floor(cpu.length * 0.95))].toFixed(2) : 0,
        cpuAvg: cpu.length ? +(cpu.reduce((a, b) => a + b, 0) / cpu.length).toFixed(2) : 0 };
    })()`);

    // B. 战斗峰值：强制同屏 8 只（两版完全同数量、同位置）
    const peakInfo = await ev(`(() => {
      const cx = ${setup.cx}, cy = ${setup.cy};
      state.player.x = cx; state.player.y = cy; state.player.hp = 99999; updateCamera(0);
      for (let i = 0; i < 8; i += 1) {
        const a = Math.PI * 2 * (i / 8);
        spawnEnemy('patrol', cx + Math.cos(a) * 120, cy + Math.sin(a) * 120, ${floor}, { roomId: ${setup.roomId} });
      }
      // 生成后强制归位：spawnEnemy 可能因碰撞/墙体把怪挪走，导致 inView 不足，A/B 就不可比
      const ring = state.enemies.slice(-8);
      ring.forEach((e, i) => {
        const a = Math.PI * 2 * (i / ring.length);
        e.x = cx + Math.cos(a) * 110; e.y = cy + Math.sin(a) * 110; e.roomId = ${setup.roomId};
        e.vx = 0; e.vy = 0;
      });
      state.enemies.forEach((e) => { e.hp = 99999; e.maxHp = 99999; });
      const halfW = (state.viewW || 1440) / 2, halfH = (state.viewH || 900) / 2;
      return { spawned: 8,
        inView: state.enemies.filter((e) => Math.abs(e.x - state.player.x) <= halfW && Math.abs(e.y - state.player.y) <= halfH).length,
        px: state.player.x, vw: state.viewW };
    })()`);
    await ev(`(() => {
      state.player.x = ${setup.cx}; state.player.y = ${setup.cy}; state.player.hp = 99999;
      updateCamera(0);
      window.__perf = { ops: [], dt: [], cpu: [] }; window.__lastTs = 0;
      return true;
    })()`);
    await sleep(3200);
    const peak = await ev(`(() => {
      const ops = window.__perf.ops.slice(20);
      const dt = window.__perf.dt.slice(20).sort((a, b) => a - b);
      const cpu = window.__perf.cpu.slice(20).sort((a, b) => a - b);
      const p = dt.length ? dt[Math.min(dt.length - 1, Math.floor(dt.length * 0.95))] : 0;
      return { drawAvg: ops.length ? Math.round(ops.reduce((a, b) => a + b, 0) / ops.length) : 0,
        drawMax: ops.length ? Math.max(...ops) : 0, p95: +p.toFixed(2), frames: ops.length,
        cpuP95: cpu.length ? +cpu[Math.min(cpu.length - 1, Math.floor(cpu.length * 0.95))].toFixed(2) : 0,
        cpuAvg: cpu.length ? +(cpu.reduce((a, b) => a + b, 0) / cpu.length).toFixed(2) : 0 };
    })()`);

    results.push({ floor, roomType: setup.room, planned: setup.planned, calm, peak, peakInfo });
    console.log('F' + floor + ' ' + JSON.stringify(results[results.length - 1]));
  }

  const out = path.join(__dirname, '.seedwork', 'perf_' + path.basename(FILE, '.html') + '.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ file: FILE, results }, null, 2), 'utf8');
  console.log('wrote ' + out);
  ws.close();
  killEdge(edge);
  await sleep(400);
}

main().catch((e) => { console.error(e); process.exit(1); });
