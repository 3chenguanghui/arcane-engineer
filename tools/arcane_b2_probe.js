/**
 * B2（可辨度口径）探针 —— 只读诊断，不改 verify、不改阈值、不改采样窗
 * ---------------------------------------------------------------------------
 * 冻结定义见 docs/断点.md §8.0（冻结时间 2026-11-10 15:39:43 +08:00）：
 *   窗口  = 与 X-A1 完全相同（最大未探索房矩形，CSS×dpr，内缩 26px）
 *   分块  = 12×12 设备像素、非重叠、左上对齐，余数整行整列丢弃
 *   块值  = 块内亮度 L 的算术平均（L = 0.2126R + 0.7152G + 0.0722B）
 *   梯度  = 水平相邻块差 ∪ 垂直相邻块差，全部计入
 *   p95   = 升序排序后取 floor(n × 0.95)
 *   判据  = p95 ≤ 3 判绿；> 3 判红
 *
 * 执行顺序（不可换）：
 *   C1 该红能红（L=8 虚线框）→ C2 该绿能绿（全平 15）→ 两枚都过才跑 54 样本
 *
 * 用法：node tools/arcane_b2_probe.js [--file=绝对路径]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9583;
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

/** 页面内主脚本：进入游戏 → C1 → C2（不过即停）→ 54 样本 */
const PAGE_SCRIPT = `(async function(){
  const d = window.__roamDebug;
  const sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  const raf2 = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ r(); }); }); }); };
  const out = { C1: null, C2: null, pass: null, samples: null };

  /* 与 measure 完全一致的窗口换算（CSS 坐标 × dpr、内缩 26px） */
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

  /* 旧口径 A：窗内 p99（并列保留，不作主判） */
  const scanA = function(g){
    const data = g.c.getContext('2d').getImageData(g.rx, g.ry, g.rw, g.rh).data;
    const n = g.rw * g.rh;
    const lums = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const j = i * 4;
      lums[i] = data[j]*0.2126 + data[j+1]*0.7152 + data[j+2]*0.0722;
    }
    let mx = -1;
    for (let i = 0; i < n; i += 1) if (lums[i] > mx) mx = lums[i];
    const sorted = Array.prototype.slice.call(lums).sort(function(a,b){ return a - b; });
    return { p99: Math.round(sorted[Math.min(n-1, Math.floor(n*0.99))]*10)/10, max: Math.round(mx*10)/10 };
  };

  /* B2（冻结定义的第 1:1 实现） */
  const b2 = function(g){
    const W = 12, H = 12;
    const cols = Math.floor(g.rw / W), rows = Math.floor(g.rh / H);
    const data = g.c.getContext('2d').getImageData(g.rx, g.ry, g.rw, g.rh).data;
    const M = [];
    for (let by = 0; by < rows; by += 1) {
      const row = [];
      for (let bx = 0; bx < cols; bx += 1) {
        let s = 0;
        for (let y = 0; y < H; y += 1) {
          const base = (by*H + y) * g.rw + bx*W;
          for (let x = 0; x < W; x += 1) {
            const j = (base + x) * 4;
            s += data[j]*0.2126 + data[j+1]*0.7152 + data[j+2]*0.0722;
          }
        }
        row.push(s / (W*H));
      }
      M.push(row);
    }
    const gr = [];
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (x + 1 < cols) gr.push(Math.abs(M[y][x+1] - M[y][x]));
        if (y + 1 < rows) gr.push(Math.abs(M[y+1][x] - M[y][x]));
      }
    }
    gr.sort(function(a,b){ return a - b; });
    const idx = Math.min(gr.length - 1, Math.floor(gr.length * 0.95));
    const p95 = gr[idx];
    return {
      cols: cols, rows: rows, n: gr.length,
      p95: Math.round(p95*100)/100,
      max: Math.round(gr[gr.length-1]*100)/100,
      median: Math.round(gr[Math.floor(gr.length*0.5)]*100)/100,
      verdict: p95 > 3 ? 'RED' : 'GREEN'
    };
  };

  /* 进入实战（与 verify 相同入口） */
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

  out.mode = await enterPlaying();
  d.xp.setEnabled(false);
  d.setFloor(6);
  for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) { if (typeof closeRewardFlow === 'function') closeRewardFlow(true); else break; }
  await sleep(900);
  d.fogLab.setSeam(0); d.fogLab.setBloom(false);
  await raf2(); await sleep(400);

  /* ---------- C1：该红能红（L=8 虚线框，加色叠在真实雾面上） ---------- */
  const m1 = d.fogLab.measure();
  if (m1 && m1.rect) {
    const g1 = geom(m1);
    const ctx = g1.c.getContext('2d');
    const aBefore = scanA(g1);
    const bBefore = b2(g1);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgb(8,8,8)';
    ctx.lineWidth = 2;
    if (ctx.setLineDash) ctx.setLineDash([8, 8]);
    ctx.strokeRect(g1.rx + 40, g1.ry + 40, g1.rw - 80, g1.rh - 80);
    ctx.restore();
    const aAfter = scanA(g1);
    const bAfter = b2(g1);
    out.C1 = {
      rect: m1.rect, geom: { rx: g1.rx, ry: g1.ry, rw: g1.rw, rh: g1.rh },
      before: bBefore, after: bAfter, p99Before: aBefore.p99, p99After: aAfter.p99,
      maxBefore: aBefore.max, maxAfter: aAfter.max,
      input: 'L=8 dashed frame, 2px, 8/8, inset 40px, lighter'
    };
  }

  /* ---------- C2：该绿能绿（全平 15） ---------- */
  const m2 = d.fogLab.measure();
  if (m2 && m2.rect) {
    const g2 = geom(m2);
    const ctx2 = g2.c.getContext('2d');
    ctx2.save();
    ctx2.setTransform(1, 0, 0, 1, 0, 0);
    ctx2.globalCompositeOperation = 'source-over';
    ctx2.fillStyle = 'rgb(15,15,15)';
    ctx2.fillRect(g2.rx, g2.ry, g2.rw, g2.rh);
    ctx2.restore();
    const a2 = scanA(g2);
    out.C2 = { rect: m2.rect, flat: b2(g2), p99: a2.p99, max: a2.max, input: 'flat rgb(15,15,15)' };
  }
  await raf2();

  const c1ok = !!(out.C1 && out.C1.after.verdict === 'RED');
  const c2ok = !!(out.C2 && out.C2.flat.verdict === 'GREEN');
  out.pass = { C1: c1ok, C2: c2ok, both: c1ok && c2ok };

  /* ---------- 54 样本：只在两枚对照都过之后才跑 ---------- */
  if (c1ok && c2ok) {
    const rows = [];
    for (let k = 0; k < 54; k += 1) {
      d.setFloor(6);
      for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) { if (typeof closeRewardFlow === 'function') closeRewardFlow(true); else break; }
      await sleep(800);
      d.fogLab.setSeam(0); d.fogLab.setBloom(false);
      await sleep(600);
      const m = d.fogLab.measure();
      if (!m || !m.rect) { rows.push({ k: k, rect: null }); continue; }
      const g = geom(m);
      const b = b2(g);
      const a = scanA(g);
      rows.push({ k: k, rect: m.rect, b2: b, p99: a.p99, max: a.max });
    }
    out.samples = rows;
  }
  return out;
})()`;

/**
 * 主流程：启动 → 执行页面脚本 → 落盘 → 打印摘要
 */
async function main() {
  const { file } = parseArgs();
  const { ev, close } = await boot(file);
  try {
    const out = await ev(PAGE_SCRIPT);
    fs.writeFileSync(path.join(OUT_DIR, 'b2.json'), JSON.stringify(out, null, 1));
    console.log('=== B2 探针 ===');
    console.log('mode=' + out.mode);
    console.log('C1 该红能红: ' + (out.C1 ? JSON.stringify(out.C1.after) : 'null')
      + ' | p99 ' + (out.C1 && out.C1.p99Before) + '→' + (out.C1 && out.C1.p99After)
      + ' | max ' + (out.C1 && out.C1.maxBefore) + '→' + (out.C1 && out.C1.maxAfter));
    console.log('C1 窗=' + (out.C1 ? JSON.stringify(out.C1.rect) : 'null'));
    console.log('C2 该绿能绿: ' + (out.C2 ? JSON.stringify(out.C2.flat) : 'null') + ' | p99 ' + (out.C2 && out.C2.p99));
    console.log('对照结论: ' + JSON.stringify(out.pass));
    if (out.samples) {
      const vals = out.samples.filter((r) => r.b2).map((r) => r.b2.p95);
      const red = out.samples.filter((r) => r.b2 && r.b2.verdict === 'RED').length;
      vals.sort((a, b) => a - b);
      const q = (p) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
      console.log('54 样本 B2: n=' + vals.length + ' min=' + vals[0] + ' 中位=' + q(0.5)
        + ' p95=' + q(0.95) + ' max=' + vals[vals.length - 1] + ' 越线=' + red);
      console.log('同期 A 旧式越线(p99>12)=' + out.samples.filter((r) => r.p99 > 12).length);
    } else {
      console.log('未跑 54 样本（对照未全过 → 依 §8.0 立即停）');
    }
  } finally {
    close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
