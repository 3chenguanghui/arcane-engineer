/**
 * 虚影取证：同一场景下抓"玩家本体"的放大图（before / after 对照）
 * ------------------------------------------------------------
 * 用法：node tools\arcane_ghost_shot.js <html 路径> <标签>
 *   before = dist\arcane_engineer_v1.0.3\奥术工程师_v1.0.3.html（泛光仍 1.2 倍放大）
 *   after  = index_arcane_v2.html（泛光 1:1 对齐）
 * 做四件事：固定到同一层、清空敌人、把玩家停在房间中央、按玩家屏幕坐标裁 140×140 放大 6 倍。
 * 这样"是否出现第二份更大、半透明的同形身影"可以直接肉眼比对。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9779;
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.screenshots', 'ghost');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const file = path.resolve(process.argv[2] || path.join(ROOT, 'index_arcane_v2.html'));
  const tag = process.argv[3] || 'after';
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,900', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等待浏览器起来 */ }
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1; pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  await sleep(3000);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const p = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(1800);

  await ev(`(() => {
    try { __roamDebug.setFloor(1); } catch (e) {}
    /* 用最大的战斗房：相机能真正居中跟随玩家。
       同时把它标成"已清空 + 已刷过"，防止自动刷怪冒充第二个角色。 */
    const room = (state.rooms || []).filter((r) => r.type === 'battle' || r.type === 'elite')
      .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0] || state.rooms[1];
    room.cleared = true; room.locked = false; room.spawned = true;
    state.currentRoomId = room.id;
    state.player.x = room.cx; state.player.y = room.cy;
    state.player.invuln = 1e9; state.player.hp = state.player.hpMax;
    state.mode = 'playing'; state.status = 'playing';
    state.enemies.length = 0;           // 清场：画面里只剩玩家，便于比对
    state.particles.length = 0;
    state.afterimages.length = 0;
    /* 相机吸附到玩家（render 里的世界变换是 translate(-cam)，cam 为左上角），
       吸附后玩家正好落在画布中心，裁剪坐标不用再推算 cam。 */
    try { snapCamera(); } catch (e) {}
    return { room: room.id };
  })()`);
  await sleep(500);

  const crop = await ev(`(() => {
    const c = document.getElementById('game');
    const size = Math.round(c.width * 0.2);          // 取画布中心 20% 的方框
    const out = document.createElement('canvas');
    out.width = 900; out.height = 900;
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(c, (c.width - size) / 2, (c.height - size) / 2, size, size, 0, 0, 900, 900);
    return out.toDataURL('image/png');
  })()`);
  fs.writeFileSync(path.join(OUT, tag + '-zoom.png'), Buffer.from(crop.split(',')[1], 'base64'));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, tag + '-full.png'), Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ tag, file, out: path.join(OUT, tag + '-zoom.png') }));
  ws.close();
  killEdge(edge);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
