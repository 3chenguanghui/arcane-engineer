/**
 * 「路的虚影」分层定位 v2（直读烘焙底图 + 屏幕，按列/行取亮度剖面）
 * ------------------------------------------------------------------
 * 上一版 ghost_probe 的整层像素差被"整层换色"淹没，无区分度。
 * 这版换口径：不做加法差，直接看**空间结构**——
 *   某一列/某一行在房间内部出现系统性亮度台阶（而不是地砖噪点），就是"带状残留"。
 *
 * 三份剖面同机位对照：
 *   baked  = sceneCanvas（静态底图，含房间/走廊预渲染）
 *   screen = 主画布实际像素（含雾/视差/延伸带/实体）
 *   fog    = fogCanvas（迷雾遮罩）
 * 另外把三份都裁出来存 PNG，肉眼复核。
 *
 * 用法：node _probe/ghost2_probe.js [tag]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'gh2';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-g2-${TAG}-${process.pid}-${Date.now()}`);
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const PORT = 9800 + Math.floor(Math.random() * 90);
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
    return { id: room.id, x: room.x, y: room.y, w: room.w, h: room.h, cx: room.cx, cy: room.cy };
  })()`);
  await sleep(1500);
  return info;
}

/**
 * 页面内：对指定世界矩形取"列均值 / 行均值"亮度剖面
 * @param {string} which baked|screen|fog
 */
const profileExpr = (which, room) => `(() => {
  const R = ${JSON.stringify(room)};
  const z = (typeof cameraZoom === 'function') ? cameraZoom() : 1;
  const dpr = ctx.canvas.width / (state.viewW || window.innerWidth);
  let src, g, scale, ox, oy;
  if ('${which}' === 'baked') { src = sceneCanvas; g = src.getContext('2d'); scale = sceneScale; ox = 0; oy = 0; }
  else if ('${which}' === 'fog') { src = fogCanvas; g = src.getContext('2d'); scale = fogScaleFactor; ox = 0; oy = 0; }
  else { src = ctx.canvas; g = ctx; scale = z * dpr; ox = -state.cam.x * z * dpr; oy = -state.cam.y * z * dpr; }
  /* 世界矩形 → 图像像素矩形（只取房间内部，避开 6px 边缘） */
  const px = (R.x + 6) * scale + ox;
  const py = (R.y + 6) * scale + oy;
  const pw = Math.max(4, (R.w - 12) * scale);
  const ph = Math.max(4, (R.h - 12) * scale);
  const x0 = Math.max(0, Math.round(px)), y0 = Math.max(0, Math.round(py));
  const w = Math.min(src.width - x0, Math.round(pw)), h = Math.min(src.height - y0, Math.round(ph));
  const img = g.getImageData(x0, y0, w, h).data;
  const lum = (i) => img[i] * 0.2126 + img[i + 1] * 0.7152 + img[i + 2] * 0.0722;
  const col = [], row = [];
  const BX = 12, BY = 12;
  for (let bx = 0; bx < w; bx += BX) {
    let s = 0, n = 0;
    for (let y = 0; y < h; y += 3) for (let x = bx; x < Math.min(w, bx + BX); x += 2) { s += lum((y * w + x) * 4); n += 1; }
    col.push(Math.round(s / Math.max(1, n)));
  }
  for (let by = 0; by < h; by += BY) {
    let s = 0, n = 0;
    for (let y = by; y < Math.min(h, by + BY); y += 2) for (let x = 0; x < w; x += 3) { s += lum((y * w + x) * 4); n += 1; }
    row.push(Math.round(s / Math.max(1, n)));
  }
  /* 台阶检测：相邻格均值差 > 6 记一次（地砖纹理一般 <4） */
  const steps = (arr) => { let c = 0, mx = 0; for (let i = 1; i < arr.length; i += 1) { const d = Math.abs(arr[i] - arr[i - 1]); if (d > 6) c += 1; if (d > mx) mx = d; } return { count: c, max: mx }; };
  return {
    which: '${which}', src: { w: src.width, h: src.height }, crop: { x: x0, y: y0, w, h }, scale: +scale.toFixed(3),
    col, row, colSteps: steps(col), rowSteps: steps(row),
    colRange: [Math.min.apply(null, col), Math.max.apply(null, col)],
    rowRange: [Math.min.apply(null, row), Math.max.apply(null, row)]
  };
})()`;

/** 主流程 */
(async () => {
  const t = await boot();
  const log = [];
  const say = (s) => { console.log(s); log.push(s); };
  const all = {};
  try {
    const room = await enterAndStand(t);
    say('room=' + JSON.stringify(room));
    for (const which of ['baked', 'fog', 'screen']) {
      const r = await t.ev(profileExpr(which, room));
      if (r && r.__err) throw new Error(which + ': ' + r.__err);
      all[which] = r;
      say(`\n[${which}] crop=${JSON.stringify(r.crop)} scale=${r.scale}`);
      say(`  colRange=${JSON.stringify(r.colRange)} steps=${JSON.stringify(r.colSteps)}`);
      say(`  col=${JSON.stringify(r.col)}`);
      say(`  rowRange=${JSON.stringify(r.rowRange)} steps=${JSON.stringify(r.rowSteps)}`);
      say(`  row=${JSON.stringify(r.row)}`);
    }
    /* 保存三份裁图：baked / fog 用页面内 toDataURL，screen 用 CDP 屏幕裁切 */
    const dump = await t.ev(`(() => {
      const out = {};
      const cut = (src, g, scale, ox, oy, R) => {
        const c = document.createElement('canvas');
        c.width = Math.round(R.w * scale); c.height = Math.round(R.h * scale);
        c.getContext('2d').drawImage(src, R.x * scale + ox, R.y * scale + oy, R.w * scale, R.h * scale, 0, 0, c.width, c.height);
        return c.toDataURL('image/png');
      };
      const R = ${JSON.stringify(room)};
      out.baked = cut(sceneCanvas, null, sceneScale, 0, 0, R);
      out.fog = cut(fogCanvas, null, fogScaleFactor, 0, 0, R);
      return out;
    })()`);
    if (dump && !dump.__err) {
      fs.writeFileSync(path.join(OUT, `gh2-${TAG}-baked.png`), Buffer.from(dump.baked.split(',')[1], 'base64'));
      fs.writeFileSync(path.join(OUT, `gh2-${TAG}-fog.png`), Buffer.from(dump.fog.split(',')[1], 'base64'));
      say('\n已存 gh2-' + TAG + '-baked.png / -fog.png');
    } else if (dump) {
      say('裁图失败: ' + dump.__err);
    }
    await t.shot(`gh2-${TAG}-screen.png`, { x: 0, y: 0, w: 562, h: 506 });
    fs.writeFileSync(path.join(OUT, `gh2-${TAG}.json`), JSON.stringify(all, null, 2));
    fs.writeFileSync(path.join(OUT, `gh2-${TAG}.log`), log.join('\n'), 'utf8');
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exitCode = 2;
  } finally {
    t.close();
    process.exit(process.exitCode || 0);
  }
})();
