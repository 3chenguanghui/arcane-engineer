/**
 * 黑雾（战争迷雾）实现量化探针（只读，不改主文件）
 * ------------------------------------------------------------------
 * 要回答：
 *   1) 现在是平面渐变还是体积？
 *   2) 边缘有没有硬边？硬到什么程度（逐像素 alpha 台阶）？
 *   3) 有没有噪点 / 流动（同一位置两次采样是否变化）？
 *   4) 红边/角落是不是直角（矩形擦除）？
 *   5) 每帧迷雾成本（state.fogStats.ms）
 *
 * 做法：直接读战争迷雾离屏画布 fogCanvas 的像素 alpha（0=已揭示，255=纯黑未探索），
 * 在"已揭示房间"的边界上横向逐像素取样，打印台阶；隔 1.2 秒再采一次，看是否流动。
 *
 * 用法：node _probe/fog_probe.js [tag]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'fog';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-fog-${TAG}-${process.pid}-${Date.now()}`);
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
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return { file: name, bytes: fs.statSync(f).size };
  };
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } } };
}

/** 进入游戏 */
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
    if (st && st.mode === 'playing') return;
    if (i > 0 && i % 40 === 0) await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
    await sleep(200);
  }
  throw new Error('未能进入 playing 模式');
}

/** 页面内：沿一条线逐像素取迷雾 alpha */
const SAMPLE_LINE = `(x0, x1, y, step) => {
  const g = fogCanvas.getContext('2d');
  const s = fogScaleFactor;
  const out = [];
  for (let wx = x0; wx <= x1; wx += step) {
    const px = Math.max(0, Math.min(fogCanvas.width - 1, Math.round(wx * s)));
    const py = Math.max(0, Math.min(fogCanvas.height - 1, Math.round(y * s)));
    out.push({ w: Math.round(wx * 10) / 10, a: g.getImageData(px, py, 1, 1).data[3] });
  }
  return out;
}`;

/** 页面内采样：垂直方向（跨上/下边界） */
const SAMPLE_COL = `(y0, y1, x, step) => {
  const g = fogCanvas.getContext('2d');
  const s = fogScaleFactor;
  const out = [];
  for (let wy = y0; wy <= y1; wy += step) {
    const px = Math.max(0, Math.min(fogCanvas.width - 1, Math.round(x * s)));
    const py = Math.max(0, Math.min(fogCanvas.height - 1, Math.round(wy * s)));
    out.push({ w: Math.round(wy * 10) / 10, a: g.getImageData(px, py, 1, 1).data[3] });
  }
  return out;
}`;

/** 主流程 */
async function main() {
  const t = await boot();
  const finger = { file: MAIN, bytes: fs.statSync(MAIN).size, md5: md5File(MAIN) };
  console.log('FINGER ' + JSON.stringify(finger));
  await enterGame(t);
  await sleep(800);

  await t.ev(`(() => {
    window.__P = { mut: 0, long: 0, longMs: 0, t0: performance.now() };
    window.__PMO = new MutationObserver((ms) => { window.__P.mut += ms.length; });
    window.__PMO.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    try {
      window.__PPO = new PerformanceObserver((l) => { l.getEntries().forEach((e) => { window.__P.long += 1; window.__P.longMs += e.duration; }); });
      window.__PPO.observe({ entryTypes: ['longtask'] });
    } catch (e) { window.__P.noLongTask = true; }
    return true;
  })()`);

  /* 1) 配置 + 结构（平面 or 体积：迷雾是一张世界空间的 2D alpha 遮罩，不是体积雾） */
  const cfg = await t.ev(`(() => {
    const src = String(carveFogRect);
    const srcC = String(carveFogCircle);
    const out = { fog: Object.assign({}, FOG_CONFIG), fogScale: fogScaleFactor,
      canvas: { w: fogCanvas.width, h: fogCanvas.height }, world: { w: fogWorldW, h: fogWorldH },
      secondPassCalls: FOG_CONFIG.secondPass ? 2 : 1,
      carve: {
        hasLinearGradient: /createLinearGradient/.test(src),
        hasRadialGradient: /createRadialGradient/.test(src),
        fillRectCalls: (src.match(/fillRect/g) || []).length,
        hasBlurFilter: /filter\\s*=/.test(src),
        eraseLayers: /globalAlpha\\s*=\\s*0\\.25/.test(src) ? 3 : (/createLinearGradient/.test(src) ? 'gradient' : 1)
      },
      prune: { hasNoise: /noise|dither/i.test(src + srcC), hasFlow: /time|performance\\.now/.test(src + srcC) },
      composite: 'destination-out',
      quality: (typeof currentQualityTier === 'function') ? currentQualityTier() : null,
      reducedFog: perfFogScale()
    };
    try { out.stats = state.fogStats; } catch (e) { out.statsErr = String(e); }
    return out;
  })()`);
  console.log('CFG ' + JSON.stringify(cfg));

  /* 2) 揭示一间房（离门远一点的那条边做取样，避免走廊擦洞污染） */
  const geo = await t.ev(`(() => {
    const room = (state.rooms || []).find((r) => r.type !== 'start') || state.rooms[1];
    revealRoom(room);
    const s = fogScaleFactor;
    return { id: room.id, type: room.type, x: room.x, y: room.y, w: room.w, h: room.h, cx: room.cx, cy: room.cy,
      scale: s, roomRect: { x: room.x, y: room.y, w: room.w, h: room.h } };
  })()`);
  await sleep(300);
  console.log('GEO ' + JSON.stringify(geo));

  /* 3) 左边界逐像素 alpha（1px 步长，跨 24px） */
  const leftProfile = await t.ev(`(() => {
    const room = state.rooms[${geo.id}];
    /* 取左边界、纵坐标放在房间 35% 高度处，避开上下门洞 */
    return (${SAMPLE_LINE})(room.x - 18, room.x + 18, room.y + room.h * 0.35, 1);
  })()`);
  /* 4) 上边界逐像素 alpha（垂直方向） */
  const topProfile = await t.ev(`(() => {
    const room = state.rooms[${geo.id}];
    return (${SAMPLE_COL})(room.y - 18, room.y + 18, room.x + room.w * 0.25, 1);
  })()`);
  /* 5) 角落：从左边界 15px 外到边界 6px 内，只在上边 2px 处采样（直角判定） */
  const cornerRow = await t.ev(`(() => {
    const room = state.rooms[${geo.id}];
    return (${SAMPLE_LINE})(room.x - 15, room.x + 6, room.y + 2, 1);
  })()`);
  /* 6) 内部 / 未探索 的平坦度 */
  const flat = await t.ev(`(() => {
    const room = state.rooms[${geo.id}];
    const g = fogCanvas.getContext('2d');
    const s = fogScaleFactor;
    const alphaAt = (wx, wy) => g.getImageData(Math.round(wx * s), Math.round(wy * s), 1, 1).data[3];
    const inside = [];
    for (let i = 0; i < 12; i += 1) inside.push(alphaAt(room.x + room.w * (0.2 + i * 0.05), room.y + room.h * 0.5));
    const outside = [];
    for (let i = 0; i < 12; i += 1) outside.push(alphaAt(room.x - 80 - i * 6, room.y + room.h * 0.5));
    return { inside, outside };
  })()`);

  /* 7) 流动/噪点：隔 1.2 秒再采同一条线 */
  await sleep(1200);
  const leftProfile2 = await t.ev(`(() => {
    const room = state.rooms[${geo.id}];
    return (${SAMPLE_LINE})(room.x - 18, room.x + 18, room.y + room.h * 0.35, 1);
  })()`);
  const temporalMaxDiff = leftProfile.reduce((m, row, i) => {
    const b = leftProfile2[i];
    return Math.max(m, Math.abs(row.a - (b ? b.a : 0)));
  }, 0);

  /* 8) 台阶统计：从 255 → 0 的过程中有几个"跳变 > 20" */
  const steps = [];
  for (let i = 1; i < leftProfile.length; i += 1) {
    const d = leftProfile[i - 1].a - leftProfile[i].a;
    if (Math.abs(d) > 20) steps.push({ at: leftProfile[i].w, from: leftProfile[i - 1].a, to: leftProfile[i].a, delta: -d });
  }
  /* 过渡带宽度：alpha 首次 <250 到最后一次 >5 的距离 */
  const idxs = leftProfile.map((r, i) => ({ i, a: r.a })).filter((r) => r.a < 250 && r.a > 5);
  const bandPx = idxs.length ? (leftProfile[idxs[idxs.length - 1].i].w - leftProfile[idxs[0].i].w) : 0;

  const perf = await t.ev(`(() => {
    const a = window.__P; const sec = (performance.now() - a.t0) / 1000;
    window.__PMO.disconnect(); if (window.__PPO) window.__PPO.disconnect();
    return { seconds: +sec.toFixed(2), mutations: a.mut, mutationsPerSec: +(a.mut / sec).toFixed(1), longTasks: a.long, longTaskMs: +a.longMs.toFixed(1), longtaskSupported: !a.noLongTask, fogStats: state.fogStats };
  })()`);

  await t.shot(`fog-${TAG}.png`);
  t.close();

  console.log('LEFT_PROFILE ' + JSON.stringify(leftProfile.map((r) => r.a)));
  console.log('TOP_PROFILE ' + JSON.stringify(topProfile.map((r) => r.a)));
  console.log('CORNER_ROW ' + JSON.stringify(cornerRow.map((r) => r.a)));
  console.log('FLAT ' + JSON.stringify({ insideMin: Math.min.apply(null, flat.inside), insideMax: Math.max.apply(null, flat.inside), outsideMin: Math.min.apply(null, flat.outside), outsideMax: Math.max.apply(null, flat.outside) }));
  console.log('EDGE ' + JSON.stringify({ steps, stepCount: steps.length, bandPx, temporalMaxDiff }));
  console.log('PERF ' + JSON.stringify(perf));

  const out = { tag: TAG, finger, at: new Date().toISOString(), cfg, geo, leftProfile, topProfile, cornerRow, flat, leftProfile2, temporalMaxDiff, edge: { steps, bandPx }, perf };
  const f = path.join(OUT, `fog-${TAG}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.log('WROTE ' + f);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
