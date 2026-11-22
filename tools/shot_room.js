/**
 * 全屏截图探针：打开游戏 → 开始 → 等 1.8s → 截全页
 * 用法：node tools/shot_room.js <输出png相对路径>
 * 只读：不点任何游戏内按钮、不写存档。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9761;
const FILE = path.resolve(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.resolve(__dirname, '..', process.argv[2] || 'lab/player8/room_now.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 主流程：起浏览器、开局、截一张全页图 */
async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1920,1080', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.text || ''));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  for (let i = 0; i < 120; i += 1) {
    if (await ev("!!document.getElementById('btnStart') && typeof startGame === 'function'")) break;
    await sleep(250);
  }
  await ev("document.getElementById('btnStart').click()");
  await sleep(600);
  /* 选角页：先点第一张角色卡，再点"以此角色开始"（按钮在选卡前是禁用的） */
  await ev("const c=document.querySelector('.char-card'); if(c) c.click();");
  await sleep(300);
  await ev("const b=document.getElementById('btnCharConfirm'); if(b) b.click();");
  await sleep(1800);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  const info = await ev("({room: state.currentRoomId, type: (state.rooms[state.currentRoomId]||{}).type, w: (state.rooms[state.currentRoomId]||{}).w, h: (state.rooms[state.currentRoomId]||{}).h, zoom: CAMERA_DISTANCE_CONFIG.zoom, scale: ROOM_SCALE_CONFIG.scale})");
  console.log('SHOT', OUT, JSON.stringify(info));
  killEdge(edge);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
