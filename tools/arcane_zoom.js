// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// 场景细节放大检查：把镜头所在房间放大 2 倍截图，核对地砖/墙体/光照细节
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9688;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'zoom');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = list.find((t) => t.type === 'page'); if (target) break; } catch (e) {}
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => { seq += 1; pending.set(seq, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: seq, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1600);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const shotClip = async (name, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', clip: Object.assign({ scale: 2 }, clip) });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(700);

  for (const floor of [1, 2, 3]) {
    const info = await ev(`(() => {
      const d = window.__roamDebug;
      d.setFloor(${floor});
      const st = d.getState();
      const room = st.spawnRoom;
      d.centerPlayer();
      const cam = d.getState().cam;
      return { room, cam, view: d.getState().view };
    })()`);
    await sleep(500);
    const cam = info.cam;
    const room = info.room;
    await shotClip('zoom_f' + floor + '.png', {
      x: Math.max(0, room.x - cam.x - 30), y: Math.max(0, room.y - cam.y - 30),
      width: Math.min(700, room.w + 60), height: Math.min(520, room.h + 60)
    });
  }
  console.log('done');
  ws.close(); killEdge(edge); process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
