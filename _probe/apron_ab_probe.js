/**
 * 「路的虚影」最终定位：固定机位，单层开关 A/B 像素差 + 环带统计
 * ------------------------------------------------------------------
 * 要点：像素数组**留在页面内**（window.__ABSNAP），只回传统计值，
 * 避免几 MB 的 JSON 来回传输。
 *
 * 三个区域分别统计，避免互相掩盖：
 *   inside  房间内缩 10px（如果这里有条带 → "路压进房间"）
 *   ring    房间外扩 40px 的四条边（如果这里异常亮/暗 → "墙外路面虚影"）
 *
 * 每个开关前先拍"同状态两帧"量化噪声，再判断真实差异是否显著高于噪声。
 * 用法：node _probe/apron_ab_probe.js [tag]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'ab';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-ab-${TAG}-${process.pid}-${Date.now()}`);
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const PORT = 9600 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 找本机 Edge */
function findEdge() { for (const p of EDGE) if (fs.existsSync(p)) return p; throw new Error('找不到 msedge.exe'); }

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
    if (clip) params.clip = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.w), height: Math.round(clip.h), scale: 1 };
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
  const info = await ev(`(() => {
    const room = (state.rooms || []).find((r) => r.type === 'battle') || state.rooms[1];
    window.__roamDebug.teleport(room.cx, room.cy);
    window.__ABROOM = { x: room.x, y: room.y, w: room.w, h: room.h };
    return { id: room.id, type: room.type, x: room.x, y: room.y, w: room.w, h: room.h };
  })()`);
  await sleep(1600);
  return info;
}

/* 页面内工具：抓图存 window.__ABSNAP，比对只回统计 */
const TOOLS = `(() => {
  if (window.__ABTOOLS) return 'ok';
  const dprOf = () => ctx.canvas.width / (state.viewW || window.innerWidth);
  const devRect = (r) => {
    const z = cameraZoom();
    const dpr = dprOf();
    return { x: (r.x - state.cam.x) * z * dpr, y: (r.y - state.cam.y) * z * dpr, w: r.w * z * dpr, h: r.h * z * dpr };
  };
  const grab = (rect) => {
    const d = devRect(rect);
    const x = Math.max(0, Math.round(d.x)), y = Math.max(0, Math.round(d.y));
    const w = Math.min(ctx.canvas.width - x, Math.round(d.w)), h = Math.min(ctx.canvas.height - y, Math.round(d.h));
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h, data: ctx.getImageData(x, y, w, h).data };
  };
  const stats = (a, b) => {
    if (!a || !b) return { error: 'null' };
    if (a.w !== b.w || a.h !== b.h) return { error: 'size', a: [a.w, a.h], b: [b.w, b.h] };
    let sum = 0, mx = 0, over8 = 0, n = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      const m = (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])) / 3;
      sum += m; if (m > mx) mx = m; if (m > 8) over8 += 1; n += 1;
    }
    return { meanAbs: +(sum / Math.max(1, n)).toFixed(3), max: Math.round(mx), over8Pct: +(over8 / Math.max(1, n) * 100).toFixed(2), px: n };
  };
  const R = window.__ABROOM;
  window.__ABSNAP = {};
  window.__ABTOOLS = {
    /** 拍一帧：inside（内缩 10px）+ ring（外扩 40px 的四条边） */
    snap: (name) => {
      const inside = grab({ x: R.x + 10, y: R.y + 10, w: R.w - 20, h: R.h - 20 });
      const ring = [
        grab({ x: R.x - 40, y: R.y - 40, w: R.w + 80, h: 40 }),
        grab({ x: R.x - 40, y: R.y + R.h, w: R.w + 80, h: 40 }),
        grab({ x: R.x - 40, y: R.y, w: 40, h: R.h }),
        grab({ x: R.x + R.w, y: R.y, w: 40, h: R.h })
      ];
      window.__ABSNAP[name] = { inside, ring };
      return { name, inside: inside ? [inside.w, inside.h] : null, ring: ring.map((r) => r ? [r.w, r.h] : null) };
    },
    /** 比对两帧：返回 inside 与四条边的差异统计 */
    cmp: (a, b) => {
      const A = window.__ABSNAP[a], B = window.__ABSNAP[b];
      if (!A || !B) return { error: 'missing' };
      return { inside: stats(A.inside, B.inside), ring: A.ring.map((r, i) => stats(r, B.ring[i])) };
    },
    cam: () => ({ cam: { x: +state.cam.x.toFixed(2), y: +state.cam.y.toFixed(2) }, zoom: +cameraZoom().toFixed(3), dpr: +dprOf().toFixed(3) }),
    roomDev: () => devRect(window.__ABROOM)
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
    say('tools=' + JSON.stringify(await t.ev(TOOLS)));
    say('cam=' + JSON.stringify(await t.ev(`(() => window.__ABTOOLS.cam())()`)));
    say('roomDev=' + JSON.stringify(await t.ev(`(() => window.__ABTOOLS.roomDev())()`)));

    /* 1) 同状态两帧 → 噪声基线 */
    await t.ev(`(() => window.__ABTOOLS.snap('n1'))()`);
    await sleep(280);
    await t.ev(`(() => window.__ABTOOLS.snap('n2'))()`);
    const noise = await t.ev(`(() => window.__ABTOOLS.cmp('n1','n2'))()`);
    say('\n[noise] ' + JSON.stringify(noise));

    /* 2) 单层开关 A/B（inner 统计） */
    const cases = [
      { name: 'apron_off', on: `window.__K = drawVoidApron; drawVoidApron = function () {};`, off: `drawVoidApron = window.__K;` },
      { name: 'depth_off', on: `window.__K = drawVoidDepth; drawVoidDepth = function () {};`, off: `drawVoidDepth = window.__K;` },
      { name: 'fog_off', on: `window.__K = drawFog; drawFog = function () {};`, off: `drawFog = window.__K;` },
      { name: 'secondpass_off', on: `window.__K2 = FOG_CONFIG.secondPass; FOG_CONFIG.secondPass = false;`, off: `FOG_CONFIG.secondPass = window.__K2;` }
    ];
    const results = {};
    for (const c of cases) {
      await t.ev(`(() => window.__ABTOOLS.snap('base'))()`);
      const patched = await t.ev(`(() => { ${c.on} return 1; })()`);
      if (patched && patched.__err) { say('[' + c.name + '] patch err ' + patched.__err); continue; }
      await sleep(340);
      await t.ev(`(() => window.__ABTOOLS.snap('off'))()`);
      await t.ev(`(() => { ${c.off} return 1; })()`);
      const d = await t.ev(`(() => window.__ABTOOLS.cmp('base','off'))()`);
      results[c.name] = d;
      say(`\n[${c.name}] inside=${JSON.stringify(d.inside)}`);
      say(`[${c.name}] ring[上,下,左,右]=${JSON.stringify(d.ring)}`);
      await sleep(220);
    }

    /* 3) 肉眼对照三张（同机位、同分辨率） */
    await t.shot(`ab-${TAG}-normal.png`, { x: 0, y: 0, w: 900, h: 760 });
    await t.ev(`(() => { window.__K = drawVoidApron; drawVoidApron = function () {}; return 1; })()`);
    await sleep(320);
    await t.shot(`ab-${TAG}-apron_off.png`, { x: 0, y: 0, w: 900, h: 760 });
    await t.ev(`(() => { drawVoidApron = window.__K; return 1; })()`);
    await t.ev(`(() => { window.__K = drawVoidDepth; drawVoidDepth = function () {}; return 1; })()`);
    await sleep(320);
    await t.shot(`ab-${TAG}-depth_off.png`, { x: 0, y: 0, w: 900, h: 760 });
    await t.ev(`(() => { drawVoidDepth = window.__K; return 1; })()`);
    say('\n已存 ab-' + TAG + '-normal/apron_off/depth_off.png');
    fs.writeFileSync(path.join(OUT, `ab-${TAG}.json`), JSON.stringify({ room, noise, results }, null, 2));
    fs.writeFileSync(path.join(OUT, `ab-${TAG}.log`), log.join('\n'), 'utf8');
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exitCode = 2;
  } finally {
    t.close();
    process.exit(process.exitCode || 0);
  }
})();
