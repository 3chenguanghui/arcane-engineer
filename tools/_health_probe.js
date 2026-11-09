/**
 * 体检前置探针：确认成品包内关键全局接口存在、标题页可开局
 * 用法：node tools\_health_probe.js
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9601;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'dist', 'emberfall_v1.6.0', '烬_v1.6.0.html');
const OUT = path.join(ROOT, '.screenshots', 'health160');
/* 独立 profile：另一条线正在使用 .testprofile/edge，不能共用，否则启动即失败 */
const PROFILE = path.join(ROOT, '.testprofile', 'edge_hb');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动无头 Edge 并连接 CDP
 * @param {number} w 视口宽
 * @param {number} h 视口高
 * @returns {Promise<Object>} CDP 句柄
 */
async function boot(w, h) {
  fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  fs.mkdirSync(PROFILE, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--window-size=${w},${h}`, 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等待 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const runtimeErrors = [];
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      runtimeErrors.push((d && d.exception && (d.exception.description || d.exception.value)) || (d && d.text) || 'unknown');
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2600);
  return { ws, send, ev, runtimeErrors, edge };
}

/**
 * 主流程：打印全局接口与标题页信息
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const h = await boot(1280, 720);
  try {
    const globals = await h.ev(`(() => {
      const names = ['render','update','state','ui','canvas','cameraZoom','isPointWalkable','spawnEnemyNearPlayer','damageEnemy','damagePlayer'];
      const out = {};
      names.forEach(n => { out[n] = (typeof window[n]); });
      out.roam = Object.keys(window.__roamDebug || {}).slice(0, 40);
      out.inner = [innerWidth, innerHeight, devicePixelRatio];
      out.title = { btnStart: !!document.getElementById('btnStart'), btnMapDock: !!document.getElementById('btnMapDock'),
        btnSkillDock: !!document.getElementById('btnSkillDock'), btnSettings: !!document.getElementById('btnSettings'),
        btnRules: !!document.getElementById('btnRules'), btnMute: !!document.getElementById('btnMute') };
      out.hasStartBtnText = (document.getElementById('btnStart') || {}).textContent;
      return out;
    })()`);
    console.log(JSON.stringify(globals, null, 2));
    const shot = await h.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'probe-title-1280x720.png'), Buffer.from(shot.data, 'base64'));
    console.log('errors:', h.runtimeErrors.length, h.runtimeErrors.slice(0, 5));
  } finally {
    h.ws.close();
    try { spawnSync('taskkill', ['/PID', String(h.edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 忽略 */ }
    setTimeout(() => fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }), 400);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
