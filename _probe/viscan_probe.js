/**
 * 视觉疲劳探针（只读不改主文件）
 * ------------------------------------------------------------
 * 口径与 docs/视觉疲劳与房间重复-调研与方案.md 第 1 节一致：
 *   - 取画面中央 60% 区域；
 *   - 色相按 30° 分 12 桶，权重 S×V；
 *   - 报：主色相窗口占比、青+蓝合计、S≥0.30 占比、S<0.10 占比、中位亮度、64px 水平自相关。
 * 另外报：同层两间房的平均色余弦相似度、逐层主题底色（验证色相变体数）。
 * 用法：node _probe/viscan_probe.js before|after
 *       ARCANE_MAIN=<被测 html> 指定版本（A/B 用同一路由）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'before';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-vis-${TAG}-${process.pid}-${Date.now()}`);
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
/* 端口用随机段：上一轮的 Edge 子进程不会自己退出，固定端口会让新探针连到旧页面 */
const PORT = 9600 + Math.floor(Math.random() * 120);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 找本机 Edge */
function findEdge() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 msedge.exe');
}

/** 文件 MD5（大写） */
function md5File(f) {
  return crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex').toUpperCase();
}

/** 启动 headless Edge，返回 CDP 句柄 */
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
  /** 页面内求值 */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  };
  /** 整页截图 */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return { file: name, bytes: fs.statSync(f).size };
  };
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } } };
}

/** 进入游戏：标题 → 真实点卡 → 开始 */
async function enterGame(t) {
  const { ev } = t;
  await t.send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  /* 3MB 单文件解析在负载高的机器上可能超过 12s，这里放宽到 40s */
  for (let i = 0; i < 200; i += 1) {
    const ok = await ev(`(() => { const b = document.getElementById('btnStart'); if (!b) return false; return b.getBoundingClientRect().width > 0; })()`);
    if (ok) break;
    await sleep(150);
  }
  await ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()`);
  for (let i = 0; i < 60; i += 1) {
    if (await ev(`(() => !!document.querySelector('.char-card'))()`)) break;
    await sleep(120);
  }
  await ev(`(() => { const c = document.querySelector('.char-card'); if (c) c.click(); return !!c; })()`);
  await sleep(200);
  await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
  for (let i = 0; i < 200; i += 1) {
    const st = await ev(`(() => { const d = window.__roamDebug; if (!d || !d.getState) return null; const s = d.getState(); return { mode: s.mode }; })()`);
    if (st && st.mode === 'playing') return;
    // 某些机器上确认按钮有淡入动画，点击会被吞掉；每 40 轮补点一次
    if (i > 0 && i % 40 === 0) {
      await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
    }
    await sleep(200);
  }
  /* 没进到 playing 就明确报错，避免把标题页的蓝底当成房间指标 */
  throw new Error('未能进入 playing 模式（探针可能连到了旧页面）');
}

/** 页面内像素扫描（中央 60%，2px 步进） */
const SCAN_FN = `(() => {
  const c = document.getElementById('game');
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const x0 = Math.floor(W * 0.2), y0 = Math.floor(H * 0.2);
  const w = Math.floor(W * 0.6), h = Math.floor(H * 0.6);
  const d = g.getImageData(x0, y0, w, h).data;
  const buckets = new Array(12).fill(0);
  let total = 0, s30 = 0, near = 0, sSum = 0, n = 0;
  const colLum = new Float64Array(w);
  let colCnt = 0;
  const lums = [];
  for (let yy = 0; yy < h; yy += 2) {
    for (let xx = 0; xx < w; xx += 2) {
      const i = ((yy * w + xx) << 2);
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      const v = mx, s = mx === 0 ? 0 : (mx - mn) / mx;
      let hue = 0;
      if (mx !== mn) {
        const dd = mx - mn;
        if (mx === r) hue = 60 * (((gg - b) / dd) % 6);
        else if (mx === gg) hue = 60 * ((b - r) / dd + 2);
        else hue = 60 * ((r - gg) / dd + 4);
      }
      if (hue < 0) hue += 360;
      const wt = s * v;
      total += wt;
      buckets[Math.min(11, Math.floor(hue / 30))] += wt;
      if (s >= 0.30) s30 += 1;
      if (s < 0.10) near += 1;
      sSum += s; n += 1;
      colLum[xx] += v; colCnt += 1;
      if ((xx & 15) === 0 && (yy & 15) === 0) lums.push(v);
    }
  }
  const avgCol = new Float64Array(w);
  for (let xx = 0; xx < w; xx += 1) avgCol[xx] = colLum[xx] / Math.max(1, h / 2);
  /* 64px 水平自相关（皮尔逊） */
  const L = avgCol;
  let m1 = 0, m2 = 0, cnt = 0;
  for (let x = 0; x + 64 < w; x += 1) { m1 += L[x]; m2 += L[x + 64]; cnt += 1; }
  m1 /= cnt; m2 /= cnt;
  let cov = 0, v1 = 0, v2 = 0;
  for (let x = 0; x + 64 < w; x += 1) { const a = L[x] - m1, b2 = L[x + 64] - m2; cov += a * b2; v1 += a * a; v2 += b2 * b2; }
  const auto64 = (v1 > 0 && v2 > 0) ? cov / Math.sqrt(v1 * v2) : 0;
  lums.sort((a, b) => a - b);
  const l50 = lums.length ? lums[Math.floor(lums.length * 0.5)] : 0;
  const top = buckets.indexOf(Math.max.apply(null, buckets));
  return {
    hist: buckets.map((v) => v / total),
    topWin: buckets[top] / total,
    topHue: top * 30 + 15,
    cyanBlue: (buckets[6] + buckets[7]) / total,
    s30: s30 / n,
    near: near / n,
    sMean: sSum / n,
    l50: l50,
    auto64: auto64
  };
})()`;

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** 主流程 */
async function main() {
  const t = await boot();
  const finger = { file: MAIN, bytes: fs.statSync(MAIN).size, md5: md5File(MAIN) };
  console.log('FINGER ' + JSON.stringify(finger));
  await enterGame(t);
  await sleepMs(800);
  const canvasInfo = await t.ev(`(() => { try { return window.__roamDebug.artAudit.canvasInfo(); } catch (e) { return { err: String((e && e.message) || e) }; } })()`);
  console.log('CANVAS ' + JSON.stringify(canvasInfo));
  const lightInfo = await t.ev(`(() => { try { return window.__roamDebug.artAudit.lightProbe(); } catch (e) { return { err: String((e && e.message) || e) }; } })()`);
  console.log('LIGHT ' + JSON.stringify(lightInfo));
  const variants = await t.ev(`(() => { try { return [1,2,3,4,5,6].map((f) => getTheme(f).floorBase); } catch (e) { return null; } })()`);
  /* 第二优先：直接读烘焙底图的逐房间像素统计（同层 5 间房一次取全），
     不依赖"让玩家走出去"，因此房间相似度与纯地面自相关都有确定样本。 */
  const roomStats = await t.ev(`(() => { try { return window.__roamDebug.artAudit.roomStats(); } catch (e) { return { err: String((e && e.message) || e) }; } })()`);
  /* 房间中央实机取景：把角色传送到每间战斗房中心，等迷雾揭示后按同一口径扫屏。
     报告里的 0.507–0.782 与"想吐"判据都来自房间截图，这里对齐这个口径。 */
  const roomShots = [];
  if (Array.isArray(roomStats)) {
    const targets = roomStats.filter((r) => r && r.id != null && r.cx != null).slice(0, 3);
    for (const r of targets) {
      const ok = await t.ev(`(() => { try { return window.__roamDebug.teleport(${r.cx}, ${r.cy}); } catch (e) { return false; } })()`);
      /* 迷雾揭示有动画：420ms 时屏幕仍有一半是黑雾，会把 l50 压低、把 near 抬高，
         属于测量伪影。这里等 1200ms 让房间完全揭开，再按同一口径取 3 帧。 */
      await sleepMs(1200);
      const fr = [];
      for (let k = 0; k < 3; k += 1) { fr.push(await t.ev(SCAN_FN)); await sleepMs(160); }
      roomShots.push({ id: r.id, type: r.type, ok: ok, frames: fr });
    }
  }
  const samples = [];
  const seq = ['d', 'd', 'j', 'd', 'k', 's', 'd', 'w', 'j', 'a', 'd', 'k'];
  for (let i = 0; i < 24; i += 1) {
    const k = seq[i % seq.length];
    await t.ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })); return true; })()`);
    await sleepMs(120);
    await t.ev(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(k)}, bubbles: true })); return true; })()`);
    await sleepMs(120);
    const s = await t.ev(SCAN_FN);
    const st = await t.ev(`(() => { try { const s = window.__roamDebug.getState(); return { floor: s.floor, theme: s.theme }; } catch (e) { return null; } })()`);
    s.floor = st ? st.floor : -1;
    s.theme = st ? st.theme : '?';
    samples.push(s);
    if (i === 8) await t.shot(`vis-${TAG}-roomA.png`);
    if (i === 16) await t.shot(`vis-${TAG}-roomB.png`);
  }
  await t.shot(`vis-${TAG}-end.png`);
  /* 同层两间房的平均色余弦：用两帧最不相似的同层样本近似 */
  t.close();
  const avg = (k) => +(samples.reduce((s, x) => s + x[k], 0) / samples.length).toFixed(4);
  const rng = (k) => [Math.min.apply(null, samples.map((s) => s[k])), Math.max.apply(null, samples.map((s) => s[k]))].map((v) => +v.toFixed(4));
  /* 余弦相似度：以 12 桶色相直方图当向量（两帧之间） */
  const sim = [];
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1].hist;
    const b = samples[i].hist;
    if (!a || !b) continue;
    let dot = 0, na = 0, nb = 0;
    for (let k = 0; k < 12; k += 1) { dot += a[k] * b[k]; na += a[k] * a[k]; nb += b[k] * b[k]; }
    if (na > 0 && nb > 0) sim.push(dot / Math.sqrt(na * nb));
  }
  /* 同层两两房间的配色余弦相似度：用 12 桶色相直方图（S×V 加权），
     与报告 3.5 节 r0 vs r3 = 0.963 / r1 vs r3 = 0.987 是同一口径。
     纯地面自相关直接读每间房中心横条，不含 HUD 与暗角。 */
  const histCos = (a, b) => {
    if (!a || !b) return null;
    let dot = 0, na = 0, nb = 0;
    for (let k = 0; k < a.length; k += 1) { dot += a[k] * b[k]; na += a[k] * a[k]; nb += b[k] * b[k]; }
    return (na > 0 && nb > 0) ? dot / Math.sqrt(na * nb) : null;
  };
  const roomPairs = [];
  if (Array.isArray(roomStats)) {
    for (let i = 0; i < roomStats.length; i += 1) {
      for (let j = i + 1; j < roomStats.length; j += 1) {
        const c = histCos(roomStats[i].hist, roomStats[j].hist);
        if (c !== null) roomPairs.push({ a: roomStats[i].id, b: roomStats[j].id, cos: +c.toFixed(4) });
      }
    }
  }
  const roomCos = roomPairs.map((p) => p.cos);
  const groundAuto = Array.isArray(roomStats) ? roomStats.map((r) => r.auto64) : [];
  /* 房间中央取景聚合：与主口径完全相同的 7 个指标 */
  const aggFrames = (frames) => {
    const flat = (frames || []).filter(Boolean);
    if (!flat.length) return null;
    const keys = ['topWin', 'cyanBlue', 's30', 'near', 'sMean', 'l50', 'auto64'];
    const o = {};
    keys.forEach((k) => { o[k] = +(flat.reduce((s, v) => s + (v[k] || 0), 0) / flat.length).toFixed(4); });
    return o;
  };
  const roomScreen = roomShots.map((r) => ({ id: r.id, type: r.type, ok: r.ok, avg: aggFrames(r.frames) }));
  const inRoomFrames = [];
  roomShots.forEach((r) => { (r.frames || []).forEach((f) => { if (f) inRoomFrames.push(f); }); });
  const inRoomAvg = aggFrames(inRoomFrames);
  const out = {
    tag: TAG, finger, at: new Date().toISOString(), variants,
    roomStats: roomStats || null,
    roomScreen: roomScreen,
    inRoomAvg: inRoomAvg,
    roomSim: {
      pairs: roomPairs,
      min: roomCos.length ? +Math.min.apply(null, roomCos).toFixed(4) : null,
      max: roomCos.length ? +Math.max.apply(null, roomCos).toFixed(4) : null,
      avg: roomCos.length ? +(roomCos.reduce((s, v) => s + v, 0) / roomCos.length).toFixed(4) : null
    },
    groundAuto64: {
      values: groundAuto,
      min: groundAuto.length ? +Math.min.apply(null, groundAuto).toFixed(4) : null,
      max: groundAuto.length ? +Math.max.apply(null, groundAuto).toFixed(4) : null,
      avg: groundAuto.length ? +(groundAuto.reduce((s, v) => s + v, 0) / groundAuto.length).toFixed(4) : null
    },
    variantCount: variants ? new Set(variants).size : null,
    avg: { topWin: avg('topWin'), cyanBlue: avg('cyanBlue'), s30: avg('s30'), near: avg('near'), sMean: avg('sMean'), l50: avg('l50'), auto64: avg('auto64') },
    range: { topWin: rng('topWin'), cyanBlue: rng('cyanBlue'), s30: rng('s30'), near: rng('near'), auto64: rng('auto64'), l50: rng('l50') },
    huePeaks: Array.from(new Set(samples.map((s) => s.topHue))),
    frameCos: { min: +Math.min.apply(null, sim).toFixed(4), max: +Math.max.apply(null, sim).toFixed(4) },
    samples
  };
  const f = path.join(OUT, `vis-${TAG}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    name: 'viscan', tag: TAG, variants, variantCount: out.variantCount,
    avg: out.avg, range: out.range, huePeaks: out.huePeaks, frameCos: out.frameCos,
    roomSim: out.roomSim, groundAuto64: out.groundAuto64,
    inRoomAvg: out.inRoomAvg, roomScreen: out.roomScreen,
    rooms: (out.roomStats || []).map((r) => ({ id: r.id, type: r.type, rgb: r.meanRgb, probes: r.probes, l50: r.l50, s30: r.s30, near: r.near, auto: r.auto64 }))
  }, null, 2));
  console.log('WROTE ' + f);
  /* headless Edge 不会自己退出，之前会让 node 一直挂着；结果落盘后直接收工 */
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
