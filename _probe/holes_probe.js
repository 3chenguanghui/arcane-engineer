/**
 * 验证"视差挖洞互相重叠 → nonzero 绕组抵消 → 房间里被画上远景"机理
 * ------------------------------------------------------------------
 * drawVoidDepth 用一条 path：外壳顺时针 + 每个洞逆时针，靠 nonzero 规则挖洞。
 * 两个**互相重叠**的逆时针洞叠在一起，绕组变成 -2（仍非零）→ 该重叠区被当作"实心"，
 * 于是视差层 + 雾幕被画进房间内部，形状恰好是走廊矩形的形状 = "路的虚影"。
 *
 * 本探针只读：取当前帧 buildParallaxHoles 的结果，算两两重叠面积，
 * 并对重叠区中心点做一次真实的 winding 测试（把同样的 path 丢给 Path2D + isPointInPath）。
 * 用法：node _probe/holes_probe.js [tag]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'holes';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-hl-${TAG}-${process.pid}-${Date.now()}`);
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const PORT = 9400 + Math.floor(Math.random() * 90);
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
  return { send, ev, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } } };
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
    return { id: room.id, type: room.type, cx: room.cx, cy: room.cy };
  })()`);
  await sleep(1200);
  return info;
}

/** 页面内：重叠分析 + Path2D winding 实测 */
const ANALYZE = `(() => {
  const holes = buildParallaxHoles(state.cam.x, state.cam.y, { x: 0, y: 0 });
  const area = (r) => r.w * r.h;
  const ov = (a, b) => {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const ex = Math.min(a.x + a.w, b.x + b.w), ey = Math.min(a.y + a.h, b.y + b.h);
    return { x, y, w: Math.max(0, ex - x), h: Math.max(0, ey - y) };
  };
  const pairs = [];
  for (let i = 0; i < holes.length; i += 1) {
    for (let j = i + 1; j < holes.length; j += 1) {
      const o = ov(holes[i], holes[j]);
      if (o.w > 4 && o.h > 4) pairs.push({ a: i, b: j, ka: holes[i].kind, kb: holes[j].kind, x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.w), h: Math.round(o.h), px: Math.round(o.w * o.h) });
    }
  }
  /* 用 Path2D 复刻 drawVoidDepth 的 path，测重叠中心点的 winding */
  const test = new Path2D();
  const W = state.viewW || window.innerWidth, H = state.viewH || window.innerHeight;
  test.rect(-40, -40, W + 80, H + 80);
  holes.forEach((r) => {
    test.moveTo(r.x, r.y);
    test.lineTo(r.x, r.y + r.h);
    test.lineTo(r.x + r.w, r.y + r.h);
    test.lineTo(r.x + r.w, r.y);
    test.closePath();
  });
  const ctx2 = document.createElement('canvas').getContext('2d');
  const probe = pairs.map((p) => ({
    pair: p.ka + '×' + p.kb,
    at: [Math.round(p.x + p.w / 2), Math.round(p.y + p.h / 2)],
    /* isPointInPath 默认 nonzero：true = 被当作"实心"，即会被画上视差 */
    inside: ctx2.isPointInPath(test, p.x + p.w / 2, p.y + p.h / 2)
  }));
  /* 每个洞自己的中心点（不该被画） */
  const centers = holes.map((r, i) => ({
    i, kind: r.kind,
    at: [Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2)],
    inside: ctx2.isPointInPath(test, r.x + r.w / 2, r.y + r.h / 2)
  }));
  return {
    view: { W, H },
    holes: holes.map((r, i) => ({ i, kind: r.kind, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })),
    overlapCount: pairs.length,
    overlaps: pairs,
    overlapProbe: probe,
    centerProbe: centers
  };
})()`;

/** 主流程 */
(async () => {
  const t = await boot();
  const log = [];
  const say = (s) => { console.log(s); log.push(s); };
  try {
    const room = await enterAndStand(t);
    say('room=' + JSON.stringify(room));
    const r = await t.ev(ANALYZE);
    if (r && r.__err) throw new Error(r.__err);
    say('view=' + JSON.stringify(r.view));
    say('\nholes:');
    r.holes.forEach((h) => say(`  [${h.i}] ${h.kind} x=${h.x} y=${h.y} w=${h.w} h=${h.h}`));
    say(`\noverlapCount=${r.overlapCount}`);
    r.overlaps.forEach((o) => say(`  ${o.ka}×${o.kb} rect=${o.x},${o.y} ${o.w}x${o.h} px=${o.px}`));
    say('\noverlap centers（inside=true 表示该重叠区会被画上视差 = 房间里的"路的虚影"）:');
    r.overlapProbe.forEach((p) => say(`  ${p.pair} at=${p.at[0]},${p.at[1]} inside=${p.inside}`));
    say('\nhole centers（应当全部 false）:');
    r.centerProbe.forEach((p) => say(`  [${p.i}] ${p.kind} at=${p.at[0]},${p.at[1]} inside=${p.inside}`));
    fs.writeFileSync(path.join(OUT, `holes-${TAG}.json`), JSON.stringify(r, null, 2));
    fs.writeFileSync(path.join(OUT, `holes-${TAG}.log`), log.join('\n'), 'utf8');
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exitCode = 2;
  } finally {
    t.close();
    process.exit(process.exitCode || 0);
  }
})();
