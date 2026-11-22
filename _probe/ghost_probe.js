/**
 * "房间里有路的虚影"定位探针（只读代码路径，只改运行时开关）
 * ------------------------------------------------------------------
 * 方法：站进一间战斗房 → 存一帧基线 → 逐个关层 → 再存一帧 → 在**房间内部区域**
 * 做像素差（device px）。差值最大的那一层，就是"路的虚影"的来源。
 * 同时保存每层的裁切截图，便于肉眼复核。
 *
 * 用法：node _probe/ghost_probe.js [tag]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'ghost';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-gh-${TAG}-${process.pid}-${Date.now()}`);
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const PORT = 9700 + Math.floor(Math.random() * 180);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 找本机 Edge */
function findEdge() { for (const p of EDGE) if (fs.existsSync(p)) return p; throw new Error('找不到 msedge.exe'); }
/** 文件 MD5 */
function md5File(f) { return crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex').toUpperCase(); }

/** 启动 headless Edge 并连上 CDP */
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
    if (clip) {
      /* Page.captureScreenshot 的 clip 字段是 width/height，不是 w/h */
      params.clip = { x: Math.max(0, Math.round(clip.x)), y: Math.max(0, Math.round(clip.y)), width: Math.round(clip.w), height: Math.round(clip.h), scale: 1 };
    }
    const r = await send('Page.captureScreenshot', params);
    const f = path.join(OUT, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return { file: name, bytes: fs.statSync(f).size };
  };
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } } };
}

/** 进入游戏并站到一间战斗房中央 */
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
  /* 找一间战斗房，传送到中心（不用清怪，只看画面） */
  const info = await ev(`(() => {
    const room = (state.rooms || []).find((r) => r.type === 'battle') || state.rooms[1];
    window.__roamDebug.teleport(room.cx, room.cy);
    return { id: room.id, type: room.type, x: room.x, y: room.y, w: room.w, h: room.h, cx: room.cx, cy: room.cy };
  })()`);
  await sleep(1400);   // 等迷雾/相机/浮尘稳定
  const view = await ev(`(() => {
    const z = cameraZoom();
    const dpr = ctx.canvas.width / state.viewW;
    const room = state.rooms[${info.id}];
    const sx = (room.x - state.cam.x) * z * dpr;
    const sy = (room.y - state.cam.y) * z * dpr;
    return { z: +z.toFixed(4), dpr: +dpr.toFixed(4), canvas: { w: ctx.canvas.width, h: ctx.canvas.height },
      viewW: state.viewW, viewH: state.viewH, cam: { x: state.cam.x, y: state.cam.y },
      deviceRect: { x: Math.round(sx), y: Math.round(sy), w: Math.round(room.w * z * dpr), h: Math.round(room.h * z * dpr) },
      cssRect: { x: (room.x - state.cam.x) * z, y: (room.y - state.cam.y) * z, w: room.w * z, h: room.h * z } };
  })()`);
  return { info, view };
}

/** 页面内：把当前画布整帧存进离屏画布 */
const SNAP = `(() => {
  if (!window.__cap) { window.__cap = document.createElement('canvas'); window.__capCtx = window.__cap.getContext('2d', { willReadFrequently: true }); }
  if (window.__cap.width !== ctx.canvas.width) { window.__cap.width = ctx.canvas.width; window.__cap.height = ctx.canvas.height; }
  window.__capCtx.clearRect(0, 0, window.__cap.width, window.__cap.height);
  window.__capCtx.drawImage(ctx.canvas, 0, 0);
  return true;
})()`;

/** 页面内：比较基线 vs 当前帧（房间内部区域，去掉 18px 边缘） */
const DIFF = `(rect, inset) => {
  const g = ctx;   // ctx 本身就是主画布的 2D 上下文
  const x0 = Math.max(0, rect.x + inset), y0 = Math.max(0, rect.y + inset);
  const x1 = Math.min(ctx.canvas.width, rect.x + rect.w - inset), y1 = Math.min(ctx.canvas.height, rect.y + rect.h - inset);
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const a = window.__capCtx.getImageData(x0, y0, w, h).data;
  const b = g.getImageData(x0, y0, w, h).data;
  let sum = 0, maxD = 0, over8 = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    sum += d; n += 1;
    if (d > maxD) maxD = d;
    if (d > 24) over8 += 1;
  }
  return { meanAbs: +(sum / n / 3).toFixed(2), maxAbs: +((maxD / 3)).toFixed(1), pxOver8: over8, pxTotal: n };
}`;

/** 主流程 */
async function main() {
  const t = await boot();
  const finger = { file: MAIN, bytes: fs.statSync(MAIN).size, md5: md5File(MAIN) };
  console.log('FINGER ' + JSON.stringify(finger));
  const st = await enterAndStand(t);
  console.log('ROOM ' + JSON.stringify(st));

  /* 基线截图 + 基线帧 */
  await t.ev(SNAP);
  const shots = [];
  shots.push(await t.shot(`ghost-${TAG}-0-base.png`, st.view.cssRect));
  console.log('BASE ' + JSON.stringify(st.view.deviceRect));

  /* 逐层关闭，每层等一帧后取差 */
  const layers = [
    { name: 'parallax_off', apply: `(() => { PARALLAX_CONFIG.enabled = false; return true; })()` },
    { name: 'secondPass_off', apply: `(() => { FOG_CONFIG.secondPass = false; return true; })()` },
    { name: 'art2_off', apply: `(() => { SCENE_ART2_CONFIG.enabled = false; try { window.__roamDebug.sceneArt2.rebake(); } catch (e) {} return true; })()` },
    { name: 'artDirection_off', apply: `(() => { ART_DIRECTION_CONFIG.enabled = false; try { window.__roamDebug.sceneArt2.rebake(); } catch (e) {} return true; })()` },
    { name: 'sceneArt_off', apply: `(() => { SCENE_ART_CONFIG.enabled = false; try { window.__roamDebug.sceneArt2.rebake(); } catch (e) {} return true; })()` },
    { name: 'fog_off', apply: `(() => { FOG_CONFIG.alpha = 0; return true; })()` }
  ];
  const results = [];
  for (const L of layers) {
    await t.ev(L.apply);
    await sleep(500);
    const d = await t.ev(`(${DIFF})(${JSON.stringify(st.view.deviceRect)}, 18)`);
    const s = await t.shot(`ghost-${TAG}-${L.name}.png`, st.view.cssRect);
    shots.push(s);
    results.push({ layer: L.name, diff: d, shot: s.file });
    console.log('LAYER ' + L.name + ' ' + JSON.stringify(d));
  }

  /* 还原所有开关 */
  await t.ev(`(() => {
    PARALLAX_CONFIG.enabled = true; FOG_CONFIG.secondPass = true; FOG_CONFIG.alpha = 1;
    SCENE_ART2_CONFIG.enabled = true; ART_DIRECTION_CONFIG.enabled = true; SCENE_ART_CONFIG.enabled = true;
    try { window.__roamDebug.sceneArt2.rebake(); } catch (e) {}
    return true;
  })()`);

  const perf = await t.ev(`(() => ({ fogStats: state.fogStats, parallaxMs: state.parallax ? state.parallax.drawMs : null }))()`);
  console.log('PERF ' + JSON.stringify(perf));
  t.close();

  const out = { tag: TAG, finger, at: new Date().toISOString(), room: st, results, shots, perf };
  const f = path.join(OUT, `ghost-${TAG}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.log('WROTE ' + f);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
