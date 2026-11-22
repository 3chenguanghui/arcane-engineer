/**
 * X-A1 的 206.2 定点复现（只读诊断；不改 verify、不改判据、不改采样窗）
 * ---------------------------------------------------------------------------
 * 目标：证明 verify 那两次红灯里的 max=206.2 来自「开局仪式文案」在淡出阶段的亮度，
 *      而不是死亡崩解粒子。方法分四段：
 *   A. 对齐时间线：按 verify 的真实顺序（enterPlaying → setFloor(6) → 300ms →
 *      20 层扫描 → setFloor(6) → clean+800ms → 关 seam/bloom+600ms）走到 X-A1 采样点，
 *      记下此刻 openingRitual 的 active / t（判断仪式是否必然在场）。
 *   B. 定点找窗口：反复 setFloor(6)，找出「最大未探索房矩形」自然覆盖文案框的布局
 *      （采样窗本身不动，只是选一个它本来就覆盖文案的布局）。
 *   C. 淡出扫描：把仪式 dur 压到 t+0.35 触发淡出，逐帧扫窗内 max/p99，
 *      抓 max 最接近 206.2 的那一帧，记录坐标、RGB、该帧 p99。
 *   D. 归因：关掉 drawOpeningRitual 后读同一坐标，确认归零。
 *
 * 用法：node tools/arcane_xa1_ritual.js [--file=绝对路径]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9581;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.screenshots', 'fog');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析命令行参数
 * @returns {{file:string}} 被测 HTML 绝对路径
 */
function parseArgs() {
  const hit = process.argv.slice(2).find((x) => x.startsWith('--file='));
  return { file: hit ? hit.slice(7) : path.join(ROOT, 'index_arcane_v2.html') };
}

/**
 * 启动无头 Edge 并连上 CDP
 * @param {string} file 被测 HTML 绝对路径
 * @returns {Promise<{ev:Function, close:Function}>} 执行器与关闭函数
 */
async function boot(file) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile(PORT);
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(proc); throw new Error('Edge 调试端口未就绪'); }

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
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  for (let i = 0; i < 120; i += 1) {
    await sleep(250);
    try { if (await ev(`typeof state !== 'undefined' && typeof generateFloor === 'function'`)) break; } catch (e) { /* 解析中 */ }
  }
  const close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } killEdge(proc); };
  return { ev, close };
}

/** 页面内主脚本：时间线对齐 → 定点找窗 → 淡出扫描 → 归因 */
const PAGE_SCRIPT = `(async function(){
  const d = window.__roamDebug;
  const sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  const raf2 = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ r(); }); }); }); };
  const out = { A: null, B: null, C: null, D: null };

  /* 采样矩形换算（与 measure 完全一致：CSS 坐标 × dpr、内缩 26px） */
  const geom = function(m){
    const c = document.getElementById('game');
    const dpr = c.width / window.innerWidth;
    const pad = 26;
    return {
      c: c, dpr: dpr,
      rx: Math.round((m.rect.x + pad) * dpr), ry: Math.round((m.rect.y + pad) * dpr),
      rw: Math.max(1, Math.round((m.rect.w - pad * 2) * dpr)),
      rh: Math.max(1, Math.round((m.rect.h - pad * 2) * dpr))
    };
  };

  /* 全窗扫描：max / p99 / 最亮点坐标与 RGB / 落在 [200,212] 的像素数与坐标 */
  const scan = function(g){
    const data = g.c.getContext('2d').getImageData(g.rx, g.ry, g.rw, g.rh).data;
    const n = g.rw * g.rh;
    const lums = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const j = i * 4;
      lums[i] = data[j]*0.2126 + data[j+1]*0.7152 + data[j+2]*0.0722;
    }
    let max = -1, maxI = 0, band = 0, bandFirst = -1, over12 = 0;
    for (let i = 0; i < n; i += 1) {
      if (lums[i] > max) { max = lums[i]; maxI = i; }
      if (lums[i] > 12) over12 += 1;
      if (lums[i] >= 200 && lums[i] <= 212) { band += 1; if (bandFirst < 0) bandFirst = i; }
    }
    const sorted = Array.prototype.slice.call(lums).sort(function(a,b){ return a - b; });
    const p99v = sorted[Math.min(n - 1, Math.floor(n * 0.99))];
    return {
      n: n,
      max: Math.round(max * 10) / 10,
      maxDev: [g.rx + (maxI % g.rw), g.ry + Math.floor(maxI / g.rw)],
      maxRgb: [data[maxI*4], data[maxI*4+1], data[maxI*4+2]],
      p99: Math.round(p99v * 10) / 10,
      over12: over12,
      in200to212: band,
      in200to212First: bandFirst < 0 ? null : [g.rx + (bandFirst % g.rw), g.ry + Math.floor(bandFirst / g.rw)]
    };
  };

  const pixelAt = function(g, x, y){
    const p = g.c.getContext('2d').getImageData(x, y, 1, 1).data;
    return { rgb: [p[0], p[1], p[2]], l: Math.round((p[0]*0.2126 + p[1]*0.7152 + p[2]*0.0722) * 10) / 10 };
  };

  /* 进入实战：点开始 → 选角 → 确认（与 verify 的 enterPlaying 同路径） */
  const enterPlaying = async function(){
    if (state.mode === 'playing') return state.mode;
    const b = document.getElementById('btnStart');
    if (b) b.click();
    for (let i = 0; i < 30; i += 1) {
      await sleep(100);
      if (state.mode === 'playing') return state.mode;
      const card = document.querySelector('#charGrid .char-card');
      if (card) card.click();
      const cf = document.getElementById('btnCharConfirm');
      if (cf && cf.offsetParent !== null) cf.click();
    }
    return state.mode;
  };

  /* ===== A. 时间线对齐：完全按 verify 的调用顺序走到 X-A1 采样点 ===== */
  const tA0 = performance.now();
  out.enterMode = await enterPlaying();
  const tRitual0 = openingRitual.t;          // 仪式刚起步
  d.xp.setEnabled(false);
  for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
  d.setFloor(6);
  for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
  await sleep(300);
  for (let i = 0; i < 30 && !(state.floor === 6 && state.mode === 'playing'); i += 1) {
    await sleep(100);
    if (state.mode === 'reward') closeRewardFlow(true);
  }
  /* C1-3 那一步：as 1..20 同步扫层（verify 里就是一次同步 ev） */
  for (let f = 1; f <= 20; f += 1) d.setFloor(f);
  d.setFloor(6);
  /* X-A1 的 clean + 两次等待 */
  d.setFloor(6);
  for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
  await sleep(800);
  const cfg0 = d.fogLab.config();
  d.fogLab.setSeam(0); d.fogLab.setBloom(false);
  await sleep(600);
  const mA = d.fogLab.measure();
  out.A = {
    msFromEnterPlayingToMeasure: Math.round(performance.now() - tA0),
    ritualT: Math.round(openingRitual.t * 1000) / 1000,
    ritualActive: openingRitual.active,
    ritualDur: openingRitual.dur,
    tAtStart: tRitual0,
    rect: mA && mA.rect,
    p99: mA && mA.p99, max: mA && mA.max
  };

  /* ===== A2. 采样点当场取证：这个 206.2 到底在哪个像素、哪一层 ===== */
  let a2 = null;
  if (mA && mA.rect) {
    const gA = geom(mA);
    const sA = scan(gA);
    const narrNow = state.narration && state.narration.current ? String(state.narration.current.text).slice(0, 20) : null;
    const at = sA.maxDev;
    const layersA = ['drawOpeningRitual', 'drawNarration', 'drawBossHud', 'drawComboEdge',
      'drawPixelFxScreen', 'drawChallengeBanner', 'drawScreenAtmosphere', 'drawPostFxLayer',
      'drawUnexploredMarkers', 'drawVoidApron', 'drawVoidDepth'];
    const attribA = [];
    for (let i = 0; i < layersA.length; i += 1) {
      const name = layersA[i];
      if (typeof window[name] !== 'function') continue;
      const before = pixelAt(gA, at[0], at[1]);
      const orig = window[name];
      window[name] = function(){};
      await raf2(); await sleep(40);
      const after = pixelAt(gA, at[0], at[1]);
      window[name] = orig;
      await raf2(); await sleep(40);
      attribA.push({ layer: name, before: before.l, after: after.l, rgbAfter: after.rgb });
    }
    a2 = {
      maxDev: at, maxRgb: sA.maxRgb, band: sA.in200to212, bandFirst: sA.in200to212First,
      winRect: mA.rect, narration: narrNow,
      ritual: { active: openingRitual.active, t: Math.round(openingRitual.t * 1000) / 1000 },
      attrib: attribA
    };
  }
  out.A2 = a2;

  /* ===== H. 定点亮源定位：字幕正文（屏幕顶部 y≈cfg.top）的笔画实测亮度 =====
   * 依据：drawNarration 用 rgba(226,240,255, alpha)，alpha 上限 0.86。
   * 该色满覆盖亮度 238.1，乘 0.86 叠加在深色底板上 ≈ 206，正是 verify 的 206.2 签名。 */
  const cvsH = document.getElementById('game');
  const ctxH = cvsH.getContext('2d');
  const lumH = function(r, g, b){ return r * 0.2126 + g * 0.7152 + b * 0.0722; };
  const regionMax = function(x0, y0, x1, y1){
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const data = ctxH.getImageData(x0, y0, w, h).data;
    let mx = -1, mi = 0;
    for (let i = 0; i < w * h; i += 1) {
      const j = i * 4;
      const L = lumH(data[j], data[j + 1], data[j + 2]);
      if (L > mx) { mx = L; mi = i; }
    }
    const j = mi * 4;
    return {
      max: Math.round(mx * 10) / 10,
      coord: [x0 + (mi % w), y0 + Math.floor(mi / w)],
      rgb: [data[j], data[j + 1], data[j + 2]]
    };
  };
  /* 保证字幕处于满亮（alpha=0.86）的驻留段 */
  for (let i = 0; i < 25 && !(state.narration && state.narration.current); i += 1) await sleep(120);
  let h1 = null, h2 = null, h3 = null;
  if (state.narration && state.narration.current) {
    state.narration.time = 0.6;
    await raf2();
    h1 = regionMax(120, 90, 1290, 230);                 // 顶部字幕带的全局最亮像素
    const origN = window.drawNarration;
    window.drawNarration = function(){};
    await raf2(); await sleep(50);
    h2 = regionMax(h1.coord[0], h1.coord[1], h1.coord[0], h1.coord[1]);   // 同点关字幕后
    window.drawNarration = origN;
    await raf2(); await sleep(50);
    h3 = regionMax(h1.coord[0], h1.coord[1], h1.coord[0], h1.coord[1]);   // 恢复后
  }
  out.H = {
    narration: state.narration && state.narration.current ? String(state.narration.current.text) : null,
    top: (typeof NARRATION_CONFIG !== 'undefined' && NARRATION_CONFIG.top) || 150,
    on: h1, off: h2, back: h3,
    /* 理论值：0.86 × L(226,240,255) + 0.14 × L(底板 6,14,24) */
    predicted: Math.round((0.86 * lumH(226, 240, 255) + 0.14 * lumH(6, 14, 24)) * 100) / 100,
    lumaInk: Math.round(lumH(226, 240, 255) * 100) / 100
  };
  return out;

  /* ===== B. 定点找窗：让「最大未探索房矩形」自然覆盖文案框 ===== */
  const vw = state.viewW || window.innerWidth;
  const vh = state.viewH || window.innerHeight;
  const textBox = { x: vw / 2 - 200, y: Math.round(vh * 0.70) - 20, w: 400, h: 44 };
  let found = null;
  for (let k = 0; k < 40 && !found; k += 1) {
    d.setFloor(6);
    for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
    d.fogLab.setSeam(0); d.fogLab.setBloom(false);
    await sleep(320);
    const m = d.fogLab.measure();
    if (!m || !m.rect) continue;
    const r = m.rect;
    const ox = Math.max(0, Math.min(r.x + r.w, textBox.x + textBox.w) - Math.max(r.x, textBox.x));
    const oy = Math.max(0, Math.min(r.y + r.h, textBox.y + textBox.h) - Math.max(r.y, textBox.y));
    if (ox * oy > 4000) found = { m: m, g: geom(m), overlap: ox * oy, tries: k + 1, textBox: textBox };
  }
  out.B = found ? { overlapPx: found.overlap, tries: found.tries, rect: found.m.rect, textBox: textBox } : { note: '40 次布局里没有窗口覆盖文案框', textBox: textBox };

  if (found) {
    const g = found.g;
    /* ===== C. 淡出扫描：dur 压到 t+0.35 → 逐帧抓 max 逼近 206.2 的那一帧 ===== */
    openingRitual.active = true; openingRitual.played = true;
    openingRitual.dur = 60; openingRitual.t = 5;      // 先停在满亮
    await raf2(); await sleep(60);
    const full = scan(g);                             // 满亮基线（应对应 233.9）
    openingRitual.t = Math.max(1.7, openingRitual.t);
    openingRitual.dur = openingRitual.t + 0.35;       // 触发淡出
    const series = [];
    for (let i = 0; i < 30; i += 1) {
      await raf2();
      if (!openingRitual.active) break;
      const s = scan(g);
      const alpha = Math.max(0, (openingRitual.dur - openingRitual.t) / 0.35);
      series.push({ t: Math.round(openingRitual.t * 1000) / 1000, alpha: Math.round(alpha * 1000) / 1000, max: s.max, p99: s.p99, maxDev: s.maxDev, rgb: s.maxRgb, in200to212: s.in200to212 });
    }
    let best = null;
    series.forEach(function(r){ if (!best || Math.abs(r.max - 206.2) < Math.abs(best.max - 206.2)) best = r; });
    out.C = {
      fullAlphaMax: full.max, fullAlphaP99: full.p99, fullIn200to212: full.in200to212, fullMaxRgb: full.maxRgb,
      frames: series.length, best: best,
      seriesTail: series.slice(-6)
    };

    /* ===== D. 归因：关掉仪式后读同一坐标 ===== */
    if (best) {
      openingRitual.active = true; openingRitual.dur = 60; openingRitual.t = 5;
      await raf2(); await sleep(60);
      const on = pixelAt(g, best.maxDev[0], best.maxDev[1]);
      openingRitual.active = false;
      await raf2(); await sleep(60);
      const off = pixelAt(g, best.maxDev[0], best.maxDev[1]);
      openingRitual.active = true; openingRitual.t = 5; openingRitual.dur = 60;
      await raf2(); await sleep(60);
      const back = pixelAt(g, best.maxDev[0], best.maxDev[1]);
      out.D = { coord: best.maxDev, on: on, off: off, back: back, inTextBox: best.maxDev[0] >= textBox.x && best.maxDev[0] <= textBox.x + textBox.w && best.maxDev[1] >= textBox.y && best.maxDev[1] <= textBox.y + textBox.h };
    }
    openingRitual.active = false;
    await raf2();
  }

  /* ===== E. 全屏普查 205–208 亮度像素：按 40px 网格聚类，再逐层归因 ===== */
  const cvs = document.getElementById('game');
  const W = cvs.width, H = cvs.height;
  const imgData = cvs.getContext('2d').getImageData(0, 0, W, H).data;
  const cells = {};
  let hitCount = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const j = (y * W + x) * 4;
      const L = imgData[j] * 0.2126 + imgData[j + 1] * 0.7152 + imgData[j + 2] * 0.0722;
      if (L >= 205 && L <= 208) {
        hitCount += 1;
        const key = Math.floor(x / 40) * 1000 + Math.floor(y / 40);
        if (!cells[key]) cells[key] = { x0: Math.floor(x / 40) * 40, y0: Math.floor(y / 40) * 40, n: 0, rgb: [imgData[j], imgData[j + 1], imgData[j + 2]] };
        cells[key].n += 1;
      }
    }
  }
  const topCells = Object.keys(cells).map(function(k){ return cells[k]; }).sort(function(a,b){ return b.n - a.n; }).slice(0, 6);
  const mE = d.fogLab.measure();
  const rE = mE && mE.rect;
  /* 逐层关：只看 topCells 的像素总数怎么变 */
  const countBand = function(){
    const dd = cvs.getContext('2d').getImageData(0, 0, W, H).data;
    let n = 0;
    topCells.forEach(function(cl){
      for (let y = cl.y0; y < cl.y0 + 40; y += 1) {
        for (let x = cl.x0; x < cl.x0 + 40; x += 1) {
          const j = (y * W + x) * 4;
          const L = dd[j] * 0.2126 + dd[j + 1] * 0.7152 + dd[j + 2] * 0.0722;
          if (L >= 205 && L <= 208) n += 1;
        }
      }
    });
    return n;
  };
  const attrib = [];
  const layers = [
    ['drawOpeningRitual', function(){ var o = window.drawOpeningRitual; window.drawOpeningRitual = function(){}; return function(){ window.drawOpeningRitual = o; }; }],
    ['drawNarration', function(){ var o = window.drawNarration; window.drawNarration = function(){}; return function(){ window.drawNarration = o; }; }],
    ['drawBossHud', function(){ var o = window.drawBossHud; window.drawBossHud = function(){}; return function(){ window.drawBossHud = o; }; }],
    ['drawComboEdge', function(){ var o = window.drawComboEdge; window.drawComboEdge = function(){}; return function(){ window.drawComboEdge = o; }; }],
    ['drawPixelFxScreen', function(){ var o = window.drawPixelFxScreen; window.drawPixelFxScreen = function(){}; return function(){ window.drawPixelFxScreen = o; }; }],
    ['drawChallengeBanner', function(){ var o = window.drawChallengeBanner; window.drawChallengeBanner = function(){}; return function(){ window.drawChallengeBanner = o; }; }],
    ['drawScreenAtmosphere', function(){ var o = window.drawScreenAtmosphere; window.drawScreenAtmosphere = function(){}; return function(){ window.drawScreenAtmosphere = o; }; }],
    ['drawPostFxLayer', function(){ var o = window.drawPostFxLayer; window.drawPostFxLayer = function(){}; return function(){ window.drawPostFxLayer = o; }; }]
  ];
  for (let i = 0; i < layers.length; i += 1) {
    const before = countBand();
    const revert = layers[i][1]();
    await raf2(); await sleep(40);
    const after = countBand();
    revert();
    await raf2(); await sleep(40);
    attrib.push({ layer: layers[i][0], before: before, after: after });
  }
  out.E = {
    canvas: [W, H],
    hitCount: hitCount,
    topCells: topCells,
    windowRect: rE,
    attrib: attrib,
    narration: state.narration && state.narration.current ? String(state.narration.current.text).slice(0, 24) : null,
    ritualNow: { active: openingRitual.active, t: Math.round(openingRitual.t * 100) / 100 },
    mode: state.mode, fxScreen: state.fx && state.fx.screen ? (state.fx.screen.kind || 'on') : null
  };

  /* ===== F. 定点复现 206.2：仪式文案行剖面 + alpha 扫描 + 窗口/文案间距统计 ===== */
  const ctxF = cvs.getContext('2d');
  const lumOf = function(r, g, b){ return r * 0.2126 + g * 0.7152 + b * 0.0722; };
  /* 隔离战斗噪声：清空敌人/粒子/冲击环（只动场景内容，不动仪式层、不动采样窗） */
  if (Array.isArray(state.enemies)) state.enemies.length = 0;
  if (Array.isArray(state.particles)) state.particles.length = 0;
  if (Array.isArray(state.rings)) state.rings.length = 0;
  /* 把仪式冻结在指定 t（dur 拉到极大，保证不会被 update 结束掉） */
  const freezeRitual = function(tt){
    openingRitual.active = true;
    openingRitual.played = true;
    openingRitual.skipped = false;
    openingRitual.dur = 1e6;
    openingRitual.t = tt;
  };
  /* 文案带行剖面：逐行给最大亮度、该点 x、其 RGB、以及 [200,212] 像素数 */
  const bandRow = function(y0, y1, x0, x1){
    const rows = [];
    for (let y = y0; y <= y1; y += 1) {
      const row = ctxF.getImageData(x0, y, x1 - x0 + 1, 1).data;
      let mx = -1, mi = 0, band = 0;
      for (let i = 0; i <= x1 - x0; i += 1) {
        const j = i * 4;
        const L = lumOf(row[j], row[j + 1], row[j + 2]);
        if (L > mx) { mx = L; mi = i; }
        if (L >= 200 && L <= 212) band += 1;
      }
      const j = mi * 4;
      rows.push({ y: y, max: Math.round(mx * 10) / 10, x: x0 + mi, band: band, rgb: [row[j], row[j + 1], row[j + 2]] });
    }
    return rows;
  };
  const bx0 = Math.max(0, Math.round(textBox.x - 90));
  const bx1 = Math.min(W - 1, Math.round(textBox.x + textBox.w + 90));
  const by0 = Math.max(0, Math.round(textBox.y - 40));
  const by1 = Math.min(H - 1, Math.round(textBox.y + textBox.h + 40));

  /* F0：满亮基线（alpha=1）下，先看真实采样窗里有没有亮起来（应仍不含文案） */
  freezeRitual(5);
  await raf2(); await sleep(80);
  const mF0 = d.fogLab.measure();
  const gF0 = mF0 && mF0.rect ? geom(mF0) : null;
  const sF0 = gF0 ? scan(gF0) : null;

  /* F1：满亮时文案带的逐行剖面 —— 用来找「哪一行本来就会落在 205–208」 */
  const rowsFull = bandRow(by0, by1, bx0, bx1);
  const hotFull = rowsFull.filter(function(r){ return r.max >= 180; });
  let bestFull = null;
  rowsFull.forEach(function(r){ if (!bestFull || Math.abs(r.max - 206.2) < Math.abs(bestFull.max - 206.2)) bestFull = r; });

  /* F2：alpha 扫描 —— 把 t 放进淡入段，alpha 从 0.70 扫到 1.00，看 max 怎么落到 206.2 */
  const sweep = [];
  for (let k = 0; k <= 15; k += 1) {
    const a = 0.70 + k * 0.02;
    freezeRitual(a >= 0.999 ? 5 : (0.55 + a * 0.23));
    await raf2(); await sleep(36);
    const rs = bandRow(by0, by1, bx0, bx1);
    let mx = -1, mr = null;
    rs.forEach(function(r){ if (r.max > mx) { mx = r.max; mr = r; } });
    sweep.push({ alpha: Math.round(a * 100) / 100, max: mx, coord: mr ? [mr.x, mr.y] : null, rgb: mr ? mr.rgb : null });
  }
  let bestA = null;
  sweep.forEach(function(r){ if (!bestA || Math.abs(r.max - 206.2) < Math.abs(bestA.max - 206.2)) bestA = r; });

  /* 单点读数（直接读画布，不经过采样窗） */
  const pxAt = function(x, y){
    const p = ctxF.getImageData(x, y, 1, 1).data;
    return { rgb: [p[0], p[1], p[2]], l: Math.round(lumOf(p[0], p[1], p[2]) * 10) / 10 };
  };
  /* F3：在 alpha=bestA 那一档，读同一坐标的 开/关 仪式两次数值（归因） */
  let f3 = null;
  if (bestA && bestA.coord) {
    freezeRitual(bestA.alpha >= 0.999 ? 5 : (0.55 + bestA.alpha * 0.23));
    await raf2(); await sleep(60);
    const on = pxAt(bestA.coord[0], bestA.coord[1]);
    openingRitual.active = false;
    await raf2(); await sleep(60);
    const off = pxAt(bestA.coord[0], bestA.coord[1]);
    freezeRitual(bestA.alpha >= 0.999 ? 5 : (0.55 + bestA.alpha * 0.23));
    await raf2(); await sleep(60);
    const back = pxAt(bestA.coord[0], bestA.coord[1]);
    f3 = { coord: bestA.coord, on: on, off: off, back: back };
  }

  /* F4：40 次布局里，采样窗下沿与文案带顶端的间距分布（解释"覆盖"是否可能发生） */
  let minGap = 1e9, overlapCnt = 0, samples = [];
  for (let k = 0; k < 40; k += 1) {
    d.setFloor(6);
    for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
    d.fogLab.setSeam(0); d.fogLab.setBloom(false);
    await sleep(320);
    const m = d.fogLab.measure();
    if (!m || !m.rect) continue;
    const r = m.rect;
    const xHit = !(r.x + r.w < bx0 || r.x > bx1);          // 横向与文案带相交
    const yHit = !(r.y + r.h < by0 || r.y > by1);          // 纵向与文案带相交
    /* 最近距离：已相交记 0，否则记纵向/横向缺口（越小越接近"覆盖"） */
    const gapX = Math.max(0, Math.max(bx0 - (r.x + r.w), r.x - bx1));
    const gapY = Math.max(0, Math.max(by0 - (r.y + r.h), r.y - by1));
    const sep = Math.max(gapX, gapY);
    if (sep < minGap) minGap = sep;
    if (xHit && yHit) overlapCnt += 1;
    if (samples.length < 6) samples.push({ rect: r, sep: sep, xHit: xHit, yHit: yHit });
  }
  out.F = {
    textBox: textBox, band: { x0: bx0, x1: bx1, y0: by0, y1: by1 },
    f0: { rect: mF0 && mF0.rect, max: sF0 && sF0.max, p99: sF0 && sF0.p99 },
    fullBright: { max: bestFull, hotRowCount: hotFull.length, hotRows: hotFull.slice(0, 8) },
    sweep: sweep,
    bestAlpha: bestA,
    attrib: f3,
    gapStats: { minGap: minGap, overlapCnt: overlapCnt, samples: samples },
    lumaD9C6FF: Math.round(lumOf(0xd9, 0xc6, 0xff) * 100) / 100
  };

  /* 还原采样配置，避免污染页面 */
  SCENE_READ_CONFIG.seamMul = cfg0.seamMul;
  SCENE_READ_CONFIG.gridMul = cfg0.gridMul;
  if (typeof bakeScene === 'function') bakeScene();
  d.fogLab.setBloom(cfg0.bloom);
  return out;
})()`;

/**
 * 主流程：执行页面脚本并打印人读结论
 */
async function main() {
  const args = parseArgs();
  const { ev, close } = await boot(args.file);
  try {
    const out = await ev(PAGE_SCRIPT);
    console.log('enterMode=' + out.enterMode);
    console.log('\n== A. 时间线对齐（按 verify 顺序走到采样点）==');
    console.log(JSON.stringify(out.A, null, 1));
    if (out.A2) {
      console.log('\n== A2. 采样点当场取证（最亮像素坐标/来源）==');
      console.log(JSON.stringify(out.A2, null, 1));
    }
    if (out.H) {
      console.log('\n== H. 字幕笔画实测（顶部 y≈150）==');
      console.log(JSON.stringify(out.H, null, 1));
    }
    if (out.G) {
      console.log('\n== G. 定点复现循环（同一时刻、同一窗口规则，换布局重试）==');
      console.log(JSON.stringify(out.G, null, 1));
    }
    console.log('\n== B. 定点找窗（采样窗不动，只挑它本来就覆盖文案框的布局）==');
    console.log(JSON.stringify(out.B, null, 1));
    if (out.C) {
      console.log('\n== C. 淡出扫描 ==');
      console.log('满亮: max=' + out.C.fullAlphaMax + ' p99=' + out.C.fullAlphaP99 + ' rgb=' + JSON.stringify(out.C.fullMaxRgb) + ' [200,212]像素=' + out.C.fullIn200to212);
      console.log('帧数=' + out.C.frames + '  最接近 206.2 的一帧: ' + JSON.stringify(out.C.best));
      console.log('尾帧: ' + JSON.stringify(out.C.seriesTail));
    }
    if (out.D) {
      console.log('\n== D. 归因（同一坐标，关/开仪式）==');
      console.log(JSON.stringify(out.D, null, 1));
    }
    if (out.E) {
      console.log('\n== E. 全屏 205–208 普查 + 逐层归因 ==');
      console.log('canvas=' + JSON.stringify(out.E.canvas) + ' hitCount=' + out.E.hitCount + ' 采样窗=' + JSON.stringify(out.E.windowRect));
      console.log('topCells=' + JSON.stringify(out.E.topCells));
      console.log('attrib=' + JSON.stringify(out.E.attrib));
    }
    if (out.F) {
      console.log('\n== F. 定点复现 206.2（文案带剖面 + alpha 扫描）==');
      console.log('采样窗(满亮时)=' + JSON.stringify(out.F.f0.rect) + ' max=' + out.F.f0.max + ' p99=' + out.F.f0.p99);
      console.log('满亮 bestRow=' + JSON.stringify(out.F.fullBright.max) + ' 命中行数=' + out.F.fullBright.hotRowCount);
      console.log('alpha 扫描=' + JSON.stringify(out.F.sweep));
      console.log('最接近 206.2 的一档=' + JSON.stringify(out.F.bestAlpha));
      console.log('同点开/关=' + JSON.stringify(out.F.attrib));
      console.log('窗口/文案间距=' + JSON.stringify(out.F.gapStats));
      console.log('L(#d9c6ff)=' + out.F.lumaD9C6FF);
    }
    fs.writeFileSync(path.join(OUT_DIR, 'xa1ritual.json'), JSON.stringify({ file: args.file, out }, null, 2));
    console.log('\n已写入 .screenshots/fog/xa1ritual.json');
  } finally {
    close();
  }
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
