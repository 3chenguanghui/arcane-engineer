/**
 * 房间内部差异的空间分布图（定位 depth 层压进房间的形态）
 * ------------------------------------------------------------------
 * 输出 24×18 网格的 meanAbs（每格平均通道差）+ 每格带符号亮度差（正=变亮）
 * 形态判读：
 *   全格均匀非零  → 整层薄雾（haze 没被洞裁掉）
 *   条状非零      → 某个矩形贴片压进来（"路的虚影"）
 *   只边缘非零    → 洞的 padding 不够
 * 同时保存 base / depth_off 两张裁图。
 * 用法：node _probe/depthmap_probe.js [tag]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'dm';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-dm-${TAG}-${process.pid}-${Date.now()}`);
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const PORT = 9500 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 找本机 Edge */
function findEdge() { for (const p of EDGE) if (fs.existsSync(p)) return p; throw new Error('找不到 msedge.exe'); }

/** 启动 headless Edge + CDP */
async function boot() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  spawn(findEdge(), [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', '--hide-scrollbars', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 未就绪 */ }
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
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) params.clip = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.w), height: Math.round(clip.h), scale: 1 };
    const r = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    return name;
  };
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } } };
}

/** 进入游戏并站到战斗房中央 */
async function enterAndStand(t) {
  const { ev } = t;
  await t.send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  for (let i = 0; i < 200; i += 1) {
    if (await ev(`(() => { const b = document.getElementById('btnStart'); return !!(b && b.getBoundingClientRect().width > 0); })()`) === true) break;
    await sleep(150);
  }
  await ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()`);
  for (let i = 0; i < 60; i += 1) {
    if (await ev(`(() => !!document.querySelector('.char-card'))()`) === true) break;
    await sleep(120);
  }
  await ev(`(() => { const c = document.querySelector('.char-card'); if (c) c.click(); return !!c; })()`);
  await sleep(200);
  await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
  for (let i = 0; i < 200; i += 1) {
    const st = await ev(`(() => { const d = window.__roamDebug; if (!d || !d.getState) return null; return { mode: d.getState().mode }; })()`);
    if (st && st.mode === 'playing') break;
    if (i > 0 && i % 40 === 0) await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
    await sleep(200);
  }
  const info = await ev(`(() => {
    const room = (state.rooms || []).find((r) => r.type === 'battle') || state.rooms[1];
    window.__roamDebug.teleport(room.cx, room.cy);
    window.__DMROOM = { x: room.x, y: room.y, w: room.w, h: room.h };
    return { id: room.id, type: room.type, x: room.x, y: room.y, w: room.w, h: room.h };
  })()`);
  await sleep(1600);
  return info;
}

/** 页面内：抓房间内部像素，存到 window.__DM[n] */
const TOOL = `(() => {
  if (window.__DMTOOL) return 'ok';
  const devRect = (r) => {
    const z = cameraZoom();
    const dpr = ctx.canvas.width / (state.viewW || window.innerWidth);
    return { x: (r.x - state.cam.x) * z * dpr, y: (r.y - state.cam.y) * z * dpr, w: r.w * z * dpr, h: r.h * z * dpr };
  };
  window.__DM = {};
  window.__DMTOOL = {
    snap: (name) => {
      const R = window.__DMROOM;
      const d = devRect({ x: R.x + 10, y: R.y + 10, w: R.w - 20, h: R.h - 20 });
      const x = Math.max(0, Math.round(d.x)), y = Math.max(0, Math.round(d.y));
      const w = Math.min(ctx.canvas.width - x, Math.round(d.w)), h = Math.min(ctx.canvas.height - y, Math.round(d.h));
      window.__DM[name] = { x, y, w, h, data: ctx.getImageData(x, y, w, h).data };
      return { name, w, h };
    },
    /** 24×18 网格：meanAbs + 带符号亮度差(base - off，正=base更亮) */
    grid: (a, b, GX, GY) => {
      const A = window.__DM[a], B = window.__DM[b];
      if (!A || !B || A.w !== B.w || A.h !== B.h) return { error: 'mismatch' };
      const abs = [], signed = [];
      for (let gy = 0; gy < GY; gy += 1) {
        const rowA = [], rowS = [];
        for (let gx = 0; gx < GX; gx += 1) {
          const x0 = Math.floor(gx * A.w / GX), x1 = Math.floor((gx + 1) * A.w / GX);
          const y0 = Math.floor(gy * A.h / GY), y1 = Math.floor((gy + 1) * A.h / GY);
          let sum = 0, sumL = 0, n = 0;
          for (let y = y0; y < y1; y += 2) {
            for (let x = x0; x < x1; x += 2) {
              const i = (y * A.w + x) * 4;
              sum += (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2])) / 3;
              const la = A.data[i] * 0.2126 + A.data[i + 1] * 0.7152 + A.data[i + 2] * 0.0722;
              const lb = B.data[i] * 0.2126 + B.data[i + 1] * 0.7152 + B.data[i + 2] * 0.0722;
              sumL += la - lb;
              n += 1;
            }
          }
          rowA.push(+(sum / Math.max(1, n)).toFixed(1));
          rowS.push(+(sumL / Math.max(1, n)).toFixed(1));
        }
        abs.push(rowA); signed.push(rowS);
      }
      return { abs, signed };
    }
  };
  return 'ok';
})()`;

/** 主流程 */
(async () => {
  const t = await boot();
  const log = [];
  const say = (s) => { console.log(s); log.push(s); };
  try {
    const room = await enterAndStand(t);
    say('room=' + JSON.stringify(room));
    say('tool=' + JSON.stringify(await t.ev(TOOL)));
    /* 清场：小怪/弹幕/特效/尘埃都清空，否则 360ms 内的位移会把差异图淹没 */
    const cleared = await t.ev(`(() => {
      const kill = (a) => { if (Array.isArray(a)) a.length = 0; };
      kill(state.enemies); kill(state.projectiles); kill(state.enemyBullets);
      kill(state.effects); kill(state.particles);
      if (state.atmosphere) kill(state.atmosphere.dust);
      if (state.afterimages) kill(state.afterimages);
      return { enemies: (state.enemies || []).length, dust: (state.atmosphere && state.atmosphere.dust || []).length };
    })()`);
    say('cleared=' + JSON.stringify(cleared));
    await sleep(600);
    await t.ev(`(() => window.__DMTOOL.snap('base'))()`);
    const dr = await t.ev(`(() => {
      const z = cameraZoom();
      const dpr = ctx.canvas.width / state.viewW;
      const R = state.rooms[${room.id}];
      const sx = (R.x - state.cam.x) * z * dpr, sy = (R.y - state.cam.y) * z * dpr;
      return { sx: Math.round(sx), sy: Math.round(sy), sw: Math.round(R.w * z * dpr), sh: Math.round(R.h * z * dpr) };
    })()`);
    await t.shot(`dm-${TAG}-base.png`, { x: dr.sx, y: dr.sy, w: dr.sw, h: dr.sh });
    await t.ev(`(() => { window.__K = drawVoidDepth; drawVoidDepth = function () {}; return 1; })()`);
    await sleep(360);
    await t.ev(`(() => window.__DMTOOL.snap('off'))()`);
    await t.shot(`dm-${TAG}-depth_off.png`, { x: dr.sx, y: dr.sy, w: dr.sw, h: dr.sh });
    await t.ev(`(() => { drawVoidDepth = window.__K; return 1; })()`);
    const g = await t.ev(`(() => window.__DMTOOL.grid('base','off',24,18))()`);
    if (g && g.__err) throw new Error(g.__err);
    say('\n[abs 24x18]');
    g.abs.forEach((r) => say('  ' + r.map((v) => String(v).padStart(4)).join('')));
    say('\n[signed 24x18] (正 = 开着视差时更亮)');
    g.signed.forEach((r) => say('  ' + r.map((v) => String(v).padStart(4)).join('')));
    fs.writeFileSync(path.join(OUT, `dm-${TAG}.json`), JSON.stringify({ room, grid: g }, null, 2));
    fs.writeFileSync(path.join(OUT, `dm-${TAG}.log`), log.join('\n'), 'utf8');
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exitCode = 2;
  } finally {
    t.close();
    process.exit(process.exitCode || 0);
  }
})();
