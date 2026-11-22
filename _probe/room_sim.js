/* 房间配色相似度（只读）：取 __roamDebug.getState().rooms[].meanRgb，
 * 对同层房间两两算余弦相似度（与报告"配色向量余弦"同口径，向量从青/蓝二维换成 RGB 三维）。
 * 用法：ARCANE_MAIN=<html> node _probe/room_sim.js before|after
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const TAG = process.argv[2] || 'now';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-sim-${TAG}-${Date.now()}`);
const PORT = 9831 + (TAG === 'after' ? 1 : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 启动 headless Edge 并返回 CDP 句柄 */
async function boot() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p));
  spawn(edge, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = l.find((x) => x.type === 'page'); if (target) break; } catch (e) { /* 等待 */ }
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, ev, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } } };
}

/** 进局 */
async function enter(t) {
  const { ev } = t;
  await t.send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  for (let i = 0; i < 80; i += 1) { if (await ev(`(() => { const b = document.getElementById('btnStart'); return !!b && b.getBoundingClientRect().width > 0; })()`)) break; await sleep(150); }
  await ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()`);
  for (let i = 0; i < 60; i += 1) { if (await ev(`(() => !!document.querySelector('.char-card'))()`)) break; await sleep(120); }
  await ev(`(() => { const c = document.querySelector('.char-card'); if (c) c.click(); return true; })()`);
  await sleep(200);
  await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
  for (let i = 0; i < 120; i += 1) {
    const ok = await ev(`(() => { const d = window.__roamDebug; if (!d || !d.getState) return false; return d.getState().mode === 'playing'; })()`);
    if (ok) break;
    await sleep(150);
  }
  await sleep(500);
}

main().catch((e) => { console.error(e); process.exit(1); });

/** 主流程 */
async function main() {
  const t = await boot();
  await enter(t);
  const data = await t.ev(`(() => { const s = window.__roamDebug.getState(); return { floor: s.floor, rooms: (s.rooms || []).map((r) => ({ id: r.id, type: r.type, w: r.w, h: r.h, rgb: r.meanRgb })) }; })()`);
  t.close();
  const rooms = data.rooms.filter((r) => r.rgb && r.rgb.length >= 3);
  const cos = [];
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i].rgb, b = rooms[j].rgb;
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const na = Math.hypot(a[0], a[1], a[2]), nb = Math.hypot(b[0], b[1], b[2]);
      if (na > 0 && nb > 0) cos.push({ a: rooms[i].id, b: rooms[j].id, sim: +(dot / (na * nb)).toFixed(4) });
    }
  }
  /* 只比较尺寸接近的房（同尺寸才谈得上"同一个房间换了碎石"） */
  cos.sort((x, y) => y.sim - x.sim);
  console.log(JSON.stringify({ tag: TAG, file: MAIN, floor: data.floor, rooms: rooms.length, pairs: cos.length, simMax: cos[0] ? cos[0].sim : null, simMin: cos.length ? cos[cos.length - 1].sim : null, top: cos.slice(0, 5) }));
}
