/**
 * 临时诊断：确认改后页面能否正常开局、房间数是否 8、以及是否抛异常
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
process.env.ARCANE_PROFILE_ROOT = path.join(__dirname, '..', '.testprofile', 'diag-' + Date.now());
const { prepareProfile } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9811;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* waiting */ }
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception || {}).description);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('ERR ' + m.params.args.map((a) => a.value || a.description).join(' '));
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve) => {
    seq += 1; pending.set(seq, resolve); ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result && r.result.exceptionDetails ? 'EX: ' + r.result.exceptionDetails.text : r.result.result.value;
  };
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(4000);
  console.log('typeof startGame =', await ev('typeof startGame'));
  console.log('typeof __roamDebug =', await ev('typeof __roamDebug'));
  console.log('roomsPerFloor =', await ev('typeof FLOOR_STRUCTURE_CONFIG !== "undefined" ? FLOOR_STRUCTURE_CONFIG.roomsPerFloor : "n/a"'));
  console.log('startGame ret =', await ev('(() => { try { window.__charSkipPick = true; window.__charPickedThisBoot = true; startGame(); return "ok"; } catch (e) { return "THROW " + e.message; } })()'));
  await sleep(1200);
  console.log('rooms =', await ev('typeof state !== "undefined" && state.rooms ? state.rooms.map(r => r.type).join(",") : "no state"'));
  console.log('roomCount =', await ev('typeof state !== "undefined" && state.rooms ? state.rooms.length : -1'));
  console.log('mode =', await ev('typeof state !== "undefined" ? state.mode : "n/a"'));
  console.log('logs =', logs.slice(0, 5).join(' | ') || '(none)');
  try { edge.kill(); } catch (e) { /* ignore */ }
})();
