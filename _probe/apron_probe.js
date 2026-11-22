/**
 * 「房间里有路的虚影」直读探针
 * ------------------------------------------------------------------
 * 不猜，直接把烘焙出来的 apronCanvas（地面延伸带）逐像素读出来，
 * 看在**房间矩形内部**还有没有残留：
 *   - insideAlpha：房间内缩 2px 区域内的 alpha 最大值/平均值/超阈值像素数
 *   - colProfile：沿房间中线横切，每 4 世界像素一格的 alpha（找"贯穿整间的宽带"）
 *   - rowProfile：纵向同理
 *   - seam：贴着房间四条边往里 1~3px 的 alpha（找 1px 接缝高光残留）
 *   - overlap：走廊延伸带（走廊矩形外扩 120px）压进房间矩形的区域里，alpha 是否被抠干净
 *
 * 用法：node _probe/apron_probe.js [tag]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'apron';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-ap-${TAG}-${process.pid}-${Date.now()}`);
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const PORT = 9900 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 找本机 Edge 可执行文件 */
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
  return { send, ev, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } } };
}

/** 进入游戏（只到 playing，不必站房） */
async function enterGame(t) {
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
  await sleep(800);
}

/**
 * 页面内执行：读 apronCanvas 在每间房内部的 alpha 残留
 * 注意：apronCanvas 是 0.5 倍分辨率，世界坐标 * scale = 画布像素
 */
const ANALYZE = `(() => {
  const cv = (typeof apronCanvas !== 'undefined') ? apronCanvas : null;
  if (!cv) return { error: 'apronCanvas 不存在' };
  const g = cv.getContext('2d');
  const W = GAME_CONFIG.worldWidth;
  const H = GAME_CONFIG.worldHeight;
  const img = g.getImageData(0, 0, cv.width, cv.height).data;
  const sx = cv.width / W;
  const sy = cv.height / H;
  /** 取世界坐标点 (wx,wy) 的 alpha */
  const A = (wx, wy) => {
    const px = Math.min(cv.width - 1, Math.max(0, Math.round(wx * sx)));
    const py = Math.min(cv.height - 1, Math.max(0, Math.round(wy * sy)));
    return img[(py * cv.width + px) * 4 + 3];
  };
  const rooms = (state.rooms || []).map((r) => {
    /* 1) 内缩 2px 区域：网格扫描 */
    let mx = 0, sum = 0, n = 0, over8 = 0;
    const stepW = Math.max(2, Math.round(r.w / 90));
    const stepH = Math.max(2, Math.round(r.h / 90));
    for (let y = r.y + 2; y <= r.y + r.h - 2; y += stepH) {
      for (let x = r.x + 2; x <= r.x + r.w - 2; x += stepW) {
        const a = A(x, y);
        if (a > mx) mx = a;
        if (a > 8) over8 += 1;
        sum += a; n += 1;
      }
    }
    /* 2) 中线横切 / 纵切（每 4 世界像素一格） */
    const colProfile = [];
    for (let x = r.x + 2; x <= r.x + r.w - 2; x += 4) colProfile.push(A(x, r.cy));
    const rowProfile = [];
    for (let y = r.y + 2; y <= r.y + r.h - 2; y += 4) rowProfile.push(A(r.cx, y));
    /* 3) 四条边往里 1/2/3px */
    const seam = { left: [], right: [], top: [], bottom: [] };
    for (const d of [1, 2, 3]) {
      seam.left.push(A(r.x + d, r.cy));
      seam.right.push(A(r.x + r.w - d, r.cy));
      seam.top.push(A(r.cx, r.y + d));
      seam.bottom.push(A(r.cx, r.y + r.h - d));
    }
    /* 4) 走廊延伸带压进房间的几何区域（走廊矩形外扩 120）里 alpha 最大值 */
    let ovMax = 0, ovN = 0;
    (state.corridorRects || []).forEach((c) => {
      const bx = Math.max(r.x, c.x - 120), by = Math.max(r.y, c.y - 120);
      const ex = Math.min(r.x + r.w, c.x + c.w + 120), ey = Math.min(r.y + r.h, c.y + c.h + 120);
      if (ex - bx < 4 || ey - by < 4) return;
      for (let y = by + 1; y < ey - 1; y += 6) {
        for (let x = bx + 1; x < ex - 1; x += 6) {
          const a = A(x, y);
          if (a > ovMax) ovMax = a;
          if (a > 8) ovN += 1;
        }
      }
    });
    return {
      id: r.id, type: r.type, rect: { x: r.x, y: r.y, w: r.w, h: r.h },
      inside: { max: mx, mean: +(sum / Math.max(1, n)).toFixed(2), over8, samples: n },
      colMax: colProfile.length ? Math.max.apply(null, colProfile) : 0,
      rowMax: rowProfile.length ? Math.max.apply(null, rowProfile) : 0,
      colProfile, rowProfile, seam,
      corridorOverlap: { max: ovMax, over8: ovN }
    };
  });
  return {
    canvas: { w: cv.width, h: cv.height, scale: +(cv.width / W).toFixed(4) },
    apronCfg: { width: PARALLAX_CONFIG.apron.width, alpha: PARALLAX_CONFIG.apron.alpha, clipToFloors: PARALLAX_CONFIG.apron.clipToFloors },
    rooms
  };
})()`;

/** 主流程 */
(async () => {
  const t = await boot();
  const log = [];
  const say = (s) => { console.log(s); log.push(s); };
  try {
    await enterGame(t);
    const r = await t.ev(ANALYZE);
    if (r && r.__err) throw new Error(r.__err);
    if (r && r.error) throw new Error(r.error);
    say('canvas=' + JSON.stringify(r.canvas));
    say('apronCfg=' + JSON.stringify(r.apronCfg));
    r.rooms.forEach((room) => {
      say(`\n[room ${room.id} ${room.type}] rect=${JSON.stringify(room.rect)}`);
      say(`  inside max=${room.inside.max} mean=${room.inside.mean} over8=${room.inside.over8}/${room.inside.samples}`);
      say(`  colMax=${room.colMax} rowMax=${room.rowMax}`);
      say(`  colProfile=${JSON.stringify(room.colProfile)}`);
      say(`  rowProfile=${JSON.stringify(room.rowProfile)}`);
      say(`  seam=${JSON.stringify(room.seam)}`);
      say(`  corridorOverlap=${JSON.stringify(room.corridorOverlap)}`);
    });
    fs.writeFileSync(path.join(OUT, `apron-${TAG}.json`), JSON.stringify(r, null, 2));
    fs.writeFileSync(path.join(OUT, `apron-${TAG}.log`), log.join('\n'), 'utf8');
    console.log('\n写入 shots/audit/apron-' + TAG + '.json');
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exitCode = 2;
  } finally {
    t.close();
    process.exit(process.exitCode || 0);
  }
})();
