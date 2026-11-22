/**
 * 进入战斗流程诊断（临时探针）：逐步打印标题页 / 选角页 / mode 状态，
 * 用来定位为什么截图停在标题页。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'index_arcane_v2.html');
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-diag-${process.pid}-${Date.now()}`);
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];
const PORT = 9600 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(PROFILE, { recursive: true });
  spawn(EDGE.find((p) => fs.existsSync(p)), [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--allow-file-access-from-files',
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
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1; pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
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
  const snap = async (tag) => {
    const s = await ev(`(() => ({
      mode: (window.state || {}).mode,
      charCards: document.querySelectorAll('.char-card').length,
      charLayer: !!document.querySelector('.charLayer, #charLayer') && getComputedStyle(document.querySelector('.charLayer, #charLayer')).display,
      titleVis: (() => { const el = document.getElementById('titleLayer'); return el ? getComputedStyle(el).display + '/' + getComputedStyle(el).opacity : 'none'; })(),
      armed: window.__charArmed,
      hasGetState: !!(window.__roamDebug && window.__roamDebug.getState),
      err: window.__lastError || ''
    }))()`);
    console.log(tag, JSON.stringify(s));
  };
  await send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  await sleep(2000);
  await snap('boot');
  await ev(`(() => { const b = document.getElementById('btnStart'); b && b.click(); return 1; })()`);
  await sleep(800);
  await snap('after-start');
  await ev(`(() => { const c = document.querySelector('.char-card'); if (c) c.click(); return 1; })()`);
  await sleep(400);
  await snap('after-card');
  await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return 1; })()`);
  await sleep(2500);
  await snap('after-confirm');
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'shots', 'audit', 'enter-diag.png'), Buffer.from(r.data, 'base64'));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(2); });
