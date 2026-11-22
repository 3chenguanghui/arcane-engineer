/**
 * 性能口径探针：只报 DOM 变更/秒 与长任务数（帧时间不当证据）
 * 用法：node _probe/perf_probe.js [tag] [seconds]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const TAG = process.argv[2] || 'perf';
const SECS = Number(process.argv[3] || 6);
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-pf-${TAG}-${process.pid}-${Date.now()}`);
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];
const PORT = 9300 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 找本机 Edge */
function findEdge() { for (const p of EDGE) if (fs.existsSync(p)) return p; throw new Error('找不到 msedge.exe'); }

/** 启动 headless Edge + CDP */
async function boot() {
  fs.mkdirSync(PROFILE, { recursive: true });
  spawn(findEdge(), [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
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

/** 进游戏并站到战斗房 */
async function enter(t) {
  const { ev } = t;
  await t.send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  for (let i = 0; i < 200; i += 1) {
    if (await ev(`(() => { const b = document.getElementById('btnStart'); return !!(b && b.getBoundingClientRect().width > 0); })()`) === true) break;
    await sleep(150);
  }
  await ev(`(() => { document.getElementById('btnStart').click(); return 1; })()`);
  for (let i = 0; i < 60; i += 1) { if (await ev(`(() => !!document.querySelector('.char-card'))()`) === true) break; await sleep(120); }
  await ev(`(() => { document.querySelector('.char-card').click(); return 1; })()`);
  await sleep(200);
  await ev(`(() => { document.getElementById('btnCharConfirm').click(); return 1; })()`);
  for (let i = 0; i < 200; i += 1) {
    const st = await ev(`(() => { const d = window.__roamDebug; if (!d || !d.getState) return null; return { mode: d.getState().mode }; })()`);
    if (st && st.mode === 'playing') break;
    if (i > 0 && i % 40 === 0) await ev(`(() => { document.getElementById('btnCharConfirm').click(); return 1; })()`);
    await sleep(200);
  }
  return ev(`(() => { const r = (state.rooms || []).find((x) => x.type === 'battle') || state.rooms[1]; window.__roamDebug.teleport(r.cx, r.cy); return { id: r.id }; })()`);
}

/** 主流程 */
(async () => {
  const t = await boot();
  try {
    const room = await enter(t);
    await sleep(900);
    await t.ev(`(() => {
      window.__PF = { mut: 0, long: [], longMs: 0 };
      window.__PFOBS = new MutationObserver((list) => { window.__PF.mut += list.length; });
      window.__PFOBS.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      if (window.PerformanceObserver) {
        try {
          window.__PFLT = new PerformanceObserver((l) => {
            l.getEntries().forEach((e) => { window.__PF.long.push(Math.round(e.duration)); window.__PF.longMs += e.duration; });
          });
          window.__PFLT.observe({ entryTypes: ['longtask'] });
        } catch (e) { /* 不支持则忽略 */ }
      }
      return 1;
    })()`);
    await sleep(SECS * 1000);
    const r = await t.ev(`(() => {
      window.__PFOBS.disconnect();
      if (window.__PFLT) window.__PFLT.disconnect();
      const p = window.__PF;
      return { seconds: ${SECS}, mutations: p.mut, domPerSec: +(p.mut / ${SECS}).toFixed(1), longTasks: p.long.length, longMs: Math.round(p.longMs), longList: p.long.slice(0, 12), room: ${room.id}, heapMB: (performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null) };
    })()`);
    console.log('[perf] ' + JSON.stringify(r));
    fs.writeFileSync(path.join(ROOT, 'shots', 'audit', `perf-${TAG}.json`), JSON.stringify(r, null, 2));
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exitCode = 2;
  } finally {
    t.close();
    process.exit(process.exitCode || 0);
  }
})();
