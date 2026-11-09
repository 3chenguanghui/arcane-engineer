/* ============================================================================
 * 自适应画质探针 · 三类场景瓶颈定位（2026-11-08）
 * ----------------------------------------------------------------------------
 * 两条口径，分开报、绝不混用：
 *   A. 帧内 CPU：update + render 的 JS 耗时。定位"JS 里谁在花时间"。
 *   B. 光栅同步：render 后对主画布做一次 1px getImageData 强制冲刷，整帧耗时。
 *      注意：一旦做过一次，画布会退化到软件路径，所以每个光栅格子都必须
 *      重新加载页面（本脚本每次 rasterCell 都 reload），且光栅绝对值只在
 *      本机无头环境有效，只用于比较"分辨率缩放"的相对关系。
 *
 * 另外补两个稳定量，避免 p95 被 GC 尖峰带跑：
 *   C. 逐函数微基准：每个 draw 入口单独跑 40 次取中位数。
 *   D. 粒子边际成本：drawEffects 在 0/75/150/225/300 粒子下的单次耗时。
 *
 * 场景：
 *   S1 开局第一层   —— 清档后点开始，真实开局
 *   S2 同屏敌人最多 —— F20 最大战斗房，强制 9 只（关掉 adaptive 降档）
 *   S3 特效最密     —— S2 + 300 粒子持续补满 + 2 个 AoE 区域 + 震屏
 *
 * 用法：node arcane_quality_probe.js [--frames 300] [--dpr 2]
 * ============================================================================ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.ARCANE_PORT || 9791);
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'perf');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 读命令行参数
 * @returns {{frames:number, dpr:number}} 参数
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { frames: 300, dpr: 2, only: 'all' };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--frames') o.frames = Number(a[i + 1]);
    if (a[i] === '--dpr') o.dpr = Number(a[i + 1]);
    if (a[i] === '--only') o.only = a[i + 1];
  }
  return o;
}

/**
 * 分位数（线性插值）
 * @param {number[]} arr 数值
 * @param {number} q 0~1
 * @returns {number} 分位值
 */
function pct(arr, q) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos); const hi = Math.ceil(pos);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

(async () => {
  const args = parseArgs();
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1920,1080', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪（可能 profile 被占用）');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  ws.onclose = () => { console.error('!! WebSocket 关闭（浏览器进程可能崩溃）'); process.exit(2); };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: args.dpr, mobile: false });

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  /**
   * 轮询等待某个表达式为真（页面 2.7MB，冷启动解析时间不稳定）
   * @param {string} expr 页面内表达式
   * @param {number} timeout 超时毫秒
   * @returns {Promise<boolean>} 是否等到
   */
  const waitFor = async (expr, timeout = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const ok = await ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`);
      if (ok) return true;
      await sleep(200);
    }
    return false;
  };

  /**
   * 重新加载 → 清档 → 点开始，并校验真的落在第 1 层
   * @returns {Promise<void>}
   */
  const navAndStart = async () => {
    const url = 'file:///' + FILE.replace(/\\/g, '/');
    await send('Page.navigate', { url });
    const ready1 = await waitFor('typeof state !== "undefined" && document.getElementById("btnStart")', 15000);
    if (!ready1) throw new Error('页面未就绪（state/btnStart 不存在）');
    await ev(`(() => { try { localStorage.clear(); } catch (e) {} return true; })()`);
    await send('Page.navigate', { url });
    const ready2 = await waitFor('typeof state !== "undefined" && document.getElementById("btnStart")', 15000);
    if (!ready2) throw new Error('重载后页面未就绪');
    const b = await ev(`(() => { const el = document.getElementById('btnStart'); if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!b) throw new Error('开始按钮未找到（页面未就绪）');
    // 优先用 DOM click（不依赖布局/坐标），失败再退回鼠标事件
    await ev(`(() => { const el = document.getElementById('btnStart'); if (el) el.click(); return true; })()`);
    await sleep(600);
    let started = await waitFor('state.floor === 1', 5000);
    if (!started) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
      started = await waitFor('state.floor === 1', 8000);
    }
    if (!started) {
      const diag = await ev(`(() => ({ floor: state.floor, mode: state.mode, status: state.status }))()`);
      throw new Error('开局未落在第 1 层：' + JSON.stringify(diag));
    }
  };

  /**
   * 布置场景并返回环境信息
   * @param {'S1'|'S2'|'S3'} kind 场景
   * @returns {Promise<Object>} 环境信息
   */
  const setup = (kind) => {
    if (kind === 'S1') {
      return ev(`(() => {
        ENEMY_BUDGET_CONFIG.adaptive.enabled = false;
        state.mode = 'playing'; state.status = 'playing';
        window.requestAnimationFrame = window.requestAnimationFrame;
        const cur = state.rooms.find((r) => r.id === state.currentRoomId) || {};
        const inRoom = (state.enemies || []).filter((e) => e.roomId === state.currentRoomId).length;
        return { floor: state.floor, roomType: cur.type || 'start', enemies: state.enemies.length, enemiesInRoom: inRoom,
          particles: state.particles.length, canvas: { w: canvas.width, h: canvas.height }, dpr: window.devicePixelRatio };
      })()`);
    }
    return ev(`(() => {
      ENEMY_BUDGET_CONFIG.adaptive.enabled = false;
      if (typeof setPostFxItem === 'function') setPostFxItem('bloom', true);
      __roamDebug.setFloor(20);
      const room = state.rooms.filter((r) => r.type === 'battle' || r.type === 'elite')
        .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0] || state.rooms[0];
      __roamDebug.teleport(room.cx, room.cy);
      __roamDebug.despawnAll();
      const ids = Object.keys(ENEMY_CONFIG).slice(0, 9);
      for (let i = 0; i < 9; i += 1) {
        const a = (Math.PI * 2 * i) / 9;
        __roamDebug.spawnEnemyAt(ids[i], room.cx + Math.cos(a) * 150, room.cy + Math.sin(a) * 150, {});
      }
      state.particles.length = 0;
      state.aoeZones = state.aoeZones || [];
      state.aoeZones.length = 0;
      if ('${kind}' === 'S3') {
        spawnAoeZone({ type: 'field', x: room.cx + 60, y: room.cy, radius: 120, color: '#8fe9ff',
          accent: '#8fe9ff', damage: 0, life: 999, tick: 0, tickInterval: 0.5 });
        spawnAoeZone({ type: 'lavaBand', x: room.cx - 60, y: room.cy, radius: 90, width: 60,
          from: { x: room.cx - 150, y: room.cy - 40 }, to: { x: room.cx + 40, y: room.cy + 60 },
          color: '#ff8a3d', accent: '#ff8a3d', damage: 0, life: 999, tick: 0, tickInterval: 0.5 });
        state.shake.time = 999; state.shake.power = 3.2; state.shake.dur = 1;
      }
      state.mode = 'playing'; state.status = 'playing';
      return { floor: state.floor, roomType: room.type, room: { w: Math.round(room.w), h: Math.round(room.h) },
        enemies: state.enemies.length, particles: state.particles.length,
        canvas: { w: canvas.width, h: canvas.height }, dpr: window.devicePixelRatio };
    })()`);
  };

  /**
   * 帧级统计（CPU 口径）：跑 N 帧，给 p50/p95 与"超 16.7ms 帧数"
   * @param {number} frames 帧数
   * @param {number} pTarget 每帧补满粒子数（0 = 不补）
   * @returns {Promise<Object>} 统计
   */
  const frameStats = (frames, pTarget) => ev(`(() => {
    window.requestAnimationFrame = () => 0;
    const p = state.player;
    const room0 = state.rooms.find((r) => r.id === state.currentRoomId) || state.rooms[0];
    const refine = (n) => { if (n && state.particles.length < n) addBurst(room0.cx, room0.cy, '#8fe9ff', n - state.particles.length, 220, null, Math.PI * 2, true); };
    const out = [];
    for (let i = 0; i < ${frames} + 5; i += 1) {
      p.invuln = 9; p.hp = p.hpMax; p.aether = p.aetherMax;
      state.mode = 'playing'; state.status = 'playing';
      refine(${pTarget});
      const t0 = performance.now();
      update(1 / 60); render();
      const t1 = performance.now();
      if (i >= 5) out.push(t1 - t0);   // 前 5 帧预热丢弃
    }
    return { cpu: out, enemies: state.enemies.length, particles: state.particles.length };
  })()`);

  /**
   * 逐函数微基准：每个入口单独跑 40 次取中位数（不更新世界，避免污染）
   * @param {string} kind 场景
   * @param {number} pTarget 粒子补满数
   * @returns {Promise<Object>} 各函数中位耗时
   */
  const funcBench = async (kind, pTarget) => {
    if (kind === 'S1') await navAndStart();
    await setup(kind);
    return ev(`(() => {
      window.requestAnimationFrame = () => 0;
      const p = state.player;
      const room0 = state.rooms.find((r) => r.id === state.currentRoomId) || state.rooms[0];
      const refine = (n) => { if (n && state.particles.length < n) addBurst(room0.cx, room0.cy, '#8fe9ff', n - state.particles.length, 220, null, Math.PI * 2, true); };
      for (let i = 0; i < 5; i += 1) { p.invuln = 9; p.hp = p.hpMax; refine(${pTarget}); update(1 / 60); render(); }
      const names = ['update', 'drawScene', 'drawVoidDepth', 'drawVoidApron', 'drawFog', 'drawBackgroundBloom',
        'drawAtmosphere', 'drawEnemies', 'drawEffects', 'drawPostFxLayer', 'drawBossHud', 'drawFloatingTexts'];
      const res = {};
      names.forEach((n) => {
        const fn = window[n];
        if (typeof fn !== 'function') return;
        const arr = [];
        for (let i = 0; i < 40; i += 1) {
          p.invuln = 9; p.hp = p.hpMax;
          const s = performance.now();
          if (n === 'update') fn(1 / 60); else fn();
          arr.push(performance.now() - s);
        }
        arr.sort((a, b) => a - b);
        res[n] = +arr[20].toFixed(2);
      });
      return { enemies: state.enemies.length, particles: state.particles.length, fn: res };
    })()`);
  };

  /**
   * 粒子边际：drawEffects 在 0/75/150/225/300 粒子下的单次耗时
   * @param {string} kind 场景
   * @returns {Promise<Object>} 各粒子档位耗时
   */
  const particleScale = async (kind) => {
    await setup(kind);
    return ev(`(() => {
      window.requestAnimationFrame = () => 0;
      const p = state.player;
      const room = state.rooms.find((r) => r.id === state.currentRoomId) || state.rooms[0];
      for (let i = 0; i < 6; i += 1) {
        p.invuln = 9; p.hp = p.hpMax;
        if (state.particles.length < 300) addBurst(room.cx, room.cy, '#8fe9ff', 300 - state.particles.length, 220, null, Math.PI * 2, true);
        update(1 / 60); render();
      }
      const all = state.particles.slice();
      const res = {};
      [0, 75, 150, 225, 300].forEach((n) => {
        state.particles = all.slice(0, Math.min(n, all.length));
        const arr = [];
        for (let i = 0; i < 25; i += 1) { const s = performance.now(); drawEffects(); arr.push(performance.now() - s); }
        arr.sort((a, b) => a - b);
        res[n] = +arr[12].toFixed(3);
      });
      state.particles = all;
      return { totalParticles: all.length, atCount: res };
    })()`);
  };

  /**
   * 光栅同步：新载入页面后再测（getImageData 会把画布打到软件路径，必须每格重载）
   * @param {string} kind 场景
   * @param {number} pTarget 粒子数
   * @returns {Promise<Object>} 光栅统计
   */
  const rasterCell = async (kind, pTarget) => {
    await navAndStart();
    const info = await setup(kind);
    const m = await ev(`(() => {
      window.requestAnimationFrame = () => 0;
      const p = state.player;
      const room0 = state.rooms.find((r) => r.id === state.currentRoomId) || state.rooms[0];
      const refine = (n) => { if (n && state.particles.length < n) addBurst(room0.cx, room0.cy, '#8fe9ff', n - state.particles.length, 220, null, Math.PI * 2, true); };
      const sync = [];
      for (let i = 0; i < 10; i += 1) {
        p.invuln = 9; p.hp = p.hpMax;
        refine(${pTarget});
        const t0 = performance.now();
        update(1 / 60); render();
        try { ctx.getImageData(0, 0, 1, 1); } catch (e) { /* 忽略 */ }
        if (i >= 2) sync.push(performance.now() - t0);   // 前 2 帧预热
      }
      return { sync, canvas: { w: canvas.width, h: canvas.height }, particles: state.particles.length };
    })()`);
    return { info, ...m };
  };

  // --------------------------------------------------------------------------
  const report = { when: new Date().toISOString(), viewport: { w: 1920, h: 1080, dpr: args.dpr }, frames: args.frames,
    note: 'cpu=update+render JS；sync=追加 1px getImageData 冲刷；光栅绝对值仅本机无头有效' };

  await navAndStart();

  console.log('【C. 逐函数微基准（40 次中位数，ms/次）】');
  report.bench = {};
  if (args.only === 'all' || args.only === 'bench') {
    for (const [label, kind, pTarget] of [['S1', 'S1', 0], ['S2', 'S2', 0], ['S3', 'S3', 300]]) {
    const r = await funcBench(kind, pTarget);
    report.bench[label] = r;
    const top = Object.entries(r.fn).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => `${k} ${v}`).join(' / ');
    console.log(`  ${label} 敌${r.enemies} 粒${r.particles} | 前五：${top}`);
    }
  }

  if (args.only === 'all' || args.only === 'bench') {
    console.log('\n【D. 粒子边际（drawEffects 单次，ms）】');
    const ps = await particleScale('S3');
    report.particles = ps;
    console.log('  ' + Object.entries(ps.atCount).map(([n, v]) => `${n}粒 ${v}ms`).join(' | ') + ` （数组实有 ${ps.totalParticles}）`);
  }

  report.frames = {};
  if (args.only === 'all' || args.only === 'frames') {
    console.log('\n【A. 帧级 CPU（' + args.frames + ' 帧）】');
    for (const [label, kind, pTarget] of [['S1 开局第一层', 'S1', 0], ['S2 同屏最多', 'S2', 0], ['S3 特效最密', 'S3', 300]]) {
      if (kind === 'S1') await navAndStart();
      await setup(kind);
      const m = await frameStats(args.frames, pTarget);
      const p50 = +pct(m.cpu, 0.5).toFixed(2);
      const p95 = +pct(m.cpu, 0.95).toFixed(2);
      const over = m.cpu.filter((v) => v > 16.7).length;
      report.frames[label] = { p50, p95, max: +Math.max(...m.cpu).toFixed(2), over16: over, n: m.cpu.length, particles: m.particles, enemies: m.enemies };
      console.log(`  ${label.padEnd(12)} p50 ${p50} ms | p95 ${p95} ms | max ${Math.max(...m.cpu).toFixed(1)} | >16.7ms ${over}/${m.cpu.length} 帧 | 敌 ${m.enemies} 粒 ${m.particles}`);
    }
  }

  report.raster = {};
  /**
   * 增量落盘（浏览器在后续格子崩溃时，已测到的数据不丢）
   * @returns {void}
   */
  const saveReport = () => {
    try {
      fs.writeFileSync(path.join(OUT, `quality-probe-dpr${args.dpr}.json`), JSON.stringify(report, null, 2), 'utf8');
    } catch (e) { /* 忽略 */ }
  };
  if (args.only === 'all' || args.only === 'raster') {
    console.log('\n【B. 光栅同步（每格重载，10 帧，dpr' + args.dpr + '）】');
    for (const [label, kind, pTarget] of [['S1 开局第一层', 'S1', 0], ['S2 同屏最多', 'S2', 0], ['S3 特效最密', 'S3', 300]]) {
      const r = await rasterCell(kind, pTarget);
      const p50 = +pct(r.sync, 0.5).toFixed(2);
      const p95 = +pct(r.sync, 0.95).toFixed(2);
      report.raster[label] = { p50, p95, canvas: r.canvas, particles: r.particles };
      saveReport();
      console.log(`  ${label.padEnd(12)} 画布 ${r.canvas.w}x${r.canvas.h} | p50 ${p50} ms | p95 ${p95} ms | 粒 ${r.particles}`);
    }
  }

  fs.writeFileSync(path.join(OUT, `quality-probe-dpr${args.dpr}.json`), JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n已落盘 .screenshots/perf/quality-probe-dpr${args.dpr}.json`);
  killEdge(edge);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
