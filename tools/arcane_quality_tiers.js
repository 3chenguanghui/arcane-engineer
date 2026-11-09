/* ============================================================================
 * 三档同场景帧时间对照（2026-11-08）
 * ----------------------------------------------------------------------------
 * 为什么另起一个脚本：上一版在同一页面里反复 prep + 切 dpr，实测第 2 轮同一条件会
 * 从 40ms 漂到 320ms（每次 prep 都会新刷 9 只怪 + 2 个 AoE，现场越跑越重）。
 * 这一版改成「一个格子一次全新页面」，页内不再切换任何条件；
 * 仍然在同一个浏览器进程里，按 high→mid→low / low→mid→high 交替跑 3 轮。
 *
 * 口径：RASTER（每帧 1px getImageData 强制冲刷）。绝对值不可引用，只读档间差值。
 * 用法：node arcane_quality_tiers.js [--frames 30] [--rounds 3]
 * ============================================================================ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.ARCANE_PORT || 9793);
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'perf');
const url = 'file:///' + FILE.replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 读参数 */
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { frames: 30, rounds: 3 };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--frames') o.frames = Number(a[i + 1]);
    if (a[i] === '--rounds') o.rounds = Number(a[i + 1]);
  }
  return o;
}

/** 分位数 */
function pct(arr, q) {
  const a = arr.slice().sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos); const hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

/** 压指标 */
function stats(arr) {
  return { p50: +pct(arr, 0.5).toFixed(2), p95: +pct(arr, 0.95).toFixed(2), n: arr.length };
}

(async () => {
  const args = parseArgs();
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1280,720', 'about:blank'
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
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  ws.onclose = () => { console.error('!! WebSocket 关闭'); process.exit(2); };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const waitFor = async (expr, timeout = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const ok = await ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`);
      if (ok) return true;
      await sleep(200);
    }
    return false;
  };

  /* 页面内探针：只做三件事 —— 布置场景、选档、跑帧 */
  const INSTALL = `(() => {
    window.__T = (function () {
      const TIER = {
        high: { dpr: 2,   cap: 300 },
        mid:  { dpr: 1.5, cap: 220 },
        low:  { dpr: 1,   cap: 120 }
      };
      let kind = 'S2';
      let cap = 300;

      /** 覆盖 devicePixelRatio 并重算画布（只在全新页面上调用一次） */
      function setTier(id) {
        const t = TIER[id] || TIER.high;
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: function () { return t.dpr; } });
        cap = t.cap;
        resizeCanvas();
        return { dpr: window.devicePixelRatio, canvas: { w: canvas.width, h: canvas.height } };
      }

      /** 布置场景；每个格子都是全新页面，所以这里只跑一次，不反复刷实体 */
      function prep(k) {
        kind = k;
        ENEMY_BUDGET_CONFIG.adaptive.enabled = false;
        window.requestAnimationFrame = function () { return 0; };
        state.particles.length = 0;
        state.aoeZones = state.aoeZones || [];
        state.aoeZones.length = 0;
        if (k === 'S1') {
          const r1 = state.rooms.filter(function (r) { return r.type === 'battle'; })[0] || state.rooms[0];
          __roamDebug.teleport(r1.cx, r1.cy);
          __roamDebug.despawnAll();
          const ids1 = Object.keys(ENEMY_CONFIG).slice(0, 5);
          for (let i = 0; i < 5; i += 1) {
            const a = (Math.PI * 2 * i) / 5;
            __roamDebug.spawnEnemyAt(ids1[i], r1.cx + Math.cos(a) * 150, r1.cy + Math.sin(a) * 150, {});
          }
          state.shake.time = 0;
          state.mode = 'playing'; state.status = 'playing';
          return { floor: state.floor, roomType: r1.type, enemies: state.enemies.length, room: { w: Math.round(r1.w), h: Math.round(r1.h) } };
        }
        __roamDebug.setFloor(20);
        const room = state.rooms.filter(function (r) { return r.type === 'battle' || r.type === 'elite'; })
          .sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); })[0] || state.rooms[0];
        __roamDebug.teleport(room.cx, room.cy);
        __roamDebug.despawnAll();
        const ids = Object.keys(ENEMY_CONFIG).slice(0, 9);
        for (let i = 0; i < 9; i += 1) {
          const a = (Math.PI * 2 * i) / 9;
          __roamDebug.spawnEnemyAt(ids[i], room.cx + Math.cos(a) * 150, room.cy + Math.sin(a) * 150, {});
        }
        if (k === 'S3') {
          spawnAoeZone({ type: 'field', x: room.cx + 60, y: room.cy, radius: 120, color: '#8fe9ff',
            accent: '#8fe9ff', damage: 0, life: 999, tick: 0, tickInterval: 0.5 });
          spawnAoeZone({ type: 'lavaBand', x: room.cx - 60, y: room.cy, radius: 90, width: 60,
            from: { x: room.cx - 150, y: room.cy - 40 }, to: { x: room.cx + 40, y: room.cy + 60 },
            color: '#ff8a3d', accent: '#ff8a3d', damage: 0, life: 999, tick: 0, tickInterval: 0.5 });
          state.shake.time = 999; state.shake.power = 3.2; state.shake.dur = 1;
        }
        state.mode = 'playing'; state.status = 'playing';
        return { floor: state.floor, roomType: room.type, enemies: state.enemies.length, room: { w: Math.round(room.w), h: Math.round(room.h) } };
      }

      /** 跑 frames 帧（前 6 帧预热丢弃），每帧强制光栅冲刷 */
      function run(frames) {
        const p = state.player;
        const room0 = state.rooms.find(function (r) { return r.id === state.currentRoomId; }) || state.rooms[0];
        const out = [];
        for (let i = 0; i < frames + 6; i += 1) {
          p.invuln = 9; p.hp = p.hpMax; p.aether = p.aetherMax;
          state.mode = 'playing'; state.status = 'playing';
          if (kind === 'S3') {
            if (state.particles.length > cap) state.particles.splice(0, state.particles.length - cap);
            if (state.particles.length < cap) {
              addBurst(room0.cx, room0.cy, '#8fe9ff', cap - state.particles.length, 220, null, Math.PI * 2, true);
            }
          }
          const t0 = performance.now();
          update(1 / 60);
          render();
          try { ctx.getImageData(0, 0, 1, 1); } catch (e) { /* 忽略 */ }
          const t1 = performance.now();
          if (i >= 6) out.push(t1 - t0);
        }
        return { ms: out, particles: state.particles.length, enemies: state.enemies.length, canvas: { w: canvas.width, h: canvas.height } };
      }
      return { prep: prep, tier: setTier, run: run };
    })();
    return true;
  })()`;

  /** 全新页面：清档 → 重载 → 开局 → 装探针 */
  const freshLoad = async () => {
    await send('Page.navigate', { url });
    if (!await waitFor('typeof state !== "undefined" && document.getElementById("btnStart")')) throw new Error('页面未就绪');
    await ev(`(() => { try { localStorage.clear(); } catch (e) {} return true; })()`);
    await send('Page.navigate', { url });
    if (!await waitFor('typeof state !== "undefined" && document.getElementById("btnStart")')) throw new Error('重载后未就绪');
    await ev(`(() => { const el = document.getElementById('btnStart'); if (el) el.click(); return true; })()`);
    if (!await waitFor('state.floor === 1', 8000)) throw new Error('开局失败');
    await ev(INSTALL);
  };

  const SCENES = ['S1', 'S2', 'S3'];
  const TIERS = ['high', 'mid', 'low'];
  const rec = {};
  SCENES.forEach((s) => { rec[s] = { high: [], mid: [], low: [], rounds: [] }; });

  for (let r = 0; r < args.rounds; r += 1) {
    const order = (r % 2 === 0) ? TIERS.slice() : TIERS.slice().reverse();
    const roundRec = {};
    for (const scene of SCENES) {
      roundRec[scene] = {};
      for (const tier of order) {
        await freshLoad();
        const info = await ev(`(() => { const a = __T.prep('${scene}'); const b = __T.tier('${tier}'); const c = __T.run(${args.frames}); return { prep: a, tier: b, run: c }; })()`);
        rec[scene][tier].push(...info.run.ms);
        roundRec[scene][tier] = stats(info.run.ms);
        console.log(`r${r} ${scene} ${tier.padEnd(4)} p50 ${roundRec[scene][tier].p50} p95 ${roundRec[scene][tier].p95}`
          + ` canvas ${info.run.canvas.w}×${info.run.canvas.h} 粒 ${info.run.particles} 敌 ${info.run.enemies}`);
      }
    }
    SCENES.forEach((s) => rec[s].rounds.push(roundRec[s]));
  }

  const out = { when: new Date().toISOString(), viewport: { w: 1280, h: 720 }, framesPerCell: args.frames, rounds: args.rounds,
    note: '一格一页面，同进程 3 轮交替；绝对值不可引用，只读档间差值', scenes: {} };
  SCENES.forEach((s) => {
    const st = { high: stats(rec[s].high), mid: stats(rec[s].mid), low: stats(rec[s].low), rounds: rec[s].rounds };
    st.deltaMid = { p50: +(st.mid.p50 - st.high.p50).toFixed(2), p95: +(st.mid.p95 - st.high.p95).toFixed(2) };
    st.deltaLow = { p50: +(st.low.p50 - st.high.p50).toFixed(2), p95: +(st.low.p95 - st.high.p95).toFixed(2) };
    out.scenes[s] = st;
    console.log(`\n${s}  high p50 ${st.high.p50}/p95 ${st.high.p95} | mid p50 ${st.mid.p50}/p95 ${st.mid.p95}`
      + ` (Δ ${st.deltaMid.p50}/${st.deltaMid.p95}) | low p50 ${st.low.p50}/p95 ${st.low.p95}`
      + ` (Δ ${st.deltaLow.p50}/${st.deltaLow.p95})`);
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'quality-tiers.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n已落盘 .screenshots/perf/quality-tiers.json');
  killEdge(edge);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
