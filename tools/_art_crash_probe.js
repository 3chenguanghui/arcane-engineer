/**
 * 一次性诊断：跳到 F6 首领房，读崩溃标记里的完整错误栈
 * ------------------------------------------------------------
 * 背景：第 2 步截图时 F6 触发了 "TypeError: The provided double value is non-finite"，
 * 但 UI 只显示截断的一行。本脚本直接读 localStorage 里的崩溃标记，
 * 把完整 message 打出来，用于定位是哪一行画布 API 收到了 NaN。
 * 用法：node tools/_art_crash_probe.js
 * @returns {Promise<void>}
 */
const { spawn } = require('child_process');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9693;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口未就绪 */ }
    await sleep(250);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const exceptions = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails);
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __evalError: r.exceptionDetails.text };
    return r.result.value;
  };

  console.log('flag(before) =', JSON.stringify(await ev(`localStorage.getItem('arcane.crash.v1')`)));
  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(900);
  await ev(`(() => { const d = window.__roamDebug; d.setFloor(6); return true; })()`);
  await sleep(1200);
  const pos = await ev(`(() => { const room = state.rooms.find((r) => r.type === 'boss'); state.player.x = room.cx; state.player.y = room.cy; if (typeof snapCamera === 'function') snapCamera(); return { cx: room.cx, cy: room.cy, mode: state.mode, status: state.status }; })()`);
  console.log('pos =', JSON.stringify(pos));
  await sleep(2500);

  console.log('boss =', JSON.stringify(await ev(`state.boss ? { x: state.boss.x, y: state.boss.y, r: state.boss.radius, kind: state.boss.kind, introDone: state.boss.introDone } : null`)));
  console.log('flag(after)  =', JSON.stringify(await ev(`localStorage.getItem('arcane.crash.v1')`)));
  console.log('state =', JSON.stringify(await ev(`({ mode: state.mode, status: state.status, boss: !!state.boss, halted: crashState.halted, msg: crashState.lastMessage })`)));
  console.log('exceptions =', JSON.stringify(exceptions.map((e) => ({
    text: e.text,
    line: e.lineNumber,
    url: e.url,
    exception: e.exception ? { cls: e.exception.className, desc: e.exception.description } : null
  }))));

  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1); });
