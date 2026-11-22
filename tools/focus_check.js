/**
 * Q1 界面降噪 · 焦点判定验证
 * ------------------------------------------------------------
 * 验证两件事（都是"这一帧"的读数，不是推理）：
 *   1) 鼠标不在任何相邻房上时，同屏门板细节（DOOR_INFO_STATS.labels）= 0；
 *   2) 鼠标移到相邻房上（= 选中/悬停）时，只有那间房的门板细节展开（labels = 1）。
 * 用法：node tools/focus_check.js [tag]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TAG = process.argv[2] || 'focus';
const FILE = path.resolve(path.join(__dirname, '..', 'index_arcane_v2.html'));
const OUT = path.resolve(__dirname, '..', '.screenshots', 'firstplay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 建连（与其它探针同参数）
 * @returns {Promise<Object>} CDP 会话
 */
async function connect() {
  let edge = null;
  let target = null;
  for (let attempt = 0; attempt < 5 && !target; attempt += 1) {
    const port = 10760 + Math.floor(Math.random() * 120);
    const profile = prepareProfile();
    edge = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--allow-file-access-from-files', '--window-size=1440,900', '--force-device-scale-factor=1',
      'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 40 && !target; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page') || null;
      } catch (e) { /* 等端口 */ }
      if (!target) await sleep(250);
    }
    if (!target) { try { killEdge(edge); } catch (e) { /* 忽略 */ } await sleep(300); }
  }
  if (!target) throw new Error('调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text };
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  return { edge, ws, send, ev, shot };
}

/**
 * 主流程：开局 → 清掉教程浮层 → 量 labels（不悬停 / 悬停相邻房）
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { edge, ws, send, ev, shot } = await connect();
  const report = { at: new Date().toISOString(), checks: {} };
  try {
    await send('Page.navigate', { url: pathToFileURL(FILE).href });
    for (let i = 0; i < 80; i += 1) {
      const ok = await ev(`(function(){ var t=document.getElementById('titleLayer'); return document.readyState==='complete' && typeof state!=='undefined' && !!t && !t.classList.contains('hidden'); })()`);
      if (ok) break;
      await sleep(200);
    }
    await ev(`document.getElementById('btnStart').click()`);
    await sleep(350);
    await ev(`document.querySelector('#charGrid .char-card').click()`);
    await sleep(200);
    await ev(`document.getElementById('btnCharConfirm').click()`);
    for (let i = 0; i < 40; i += 1) { if ((await ev(`state.mode`)) === 'playing') break; await sleep(100); }
    await sleep(500);
    /* 关掉教程浮层，避免它盖住门板（只影响这次测量，不改游戏逻辑） */
    await ev(`(function(){ var t=document.getElementById('tutorial'); if (t) t.style.display='none';
      document.querySelectorAll('.tutorial,.tutorial-layer,#tutLayer').forEach(function(e){ e.style.display='none'; });
      return true; })()`);
    await ev(`(function(){ state.seedInfo = { active: true, value: 'FOCUS' }; generateFloor(1); return state.floor; })()`);
    await sleep(600);

    /* 鼠标放到屏幕角落（不悬停任何房间） */
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 780, button: 'none' });
    await sleep(700);
    report.idle = await ev(`(function(){ return { labels: DOOR_INFO_STATS.labels,
      focus: roomFocusTargetId(), room: state.currentRoomId }; })()`);

    /* 鼠标移到"连接本房的那扇门"上（悬停门 = 展开这扇门的三行细节） */
    const spot = await ev(`(function(){
      var cur = state.currentRoomId;
      var door = null, other = -1;
      (state.doors || []).forEach(function(d){
        var t = d.roomId === cur ? d.targetRoomId : (d.targetRoomId === cur ? d.roomId : -1);
        if (t >= 0 && t !== cur && !door) { door = d; other = t; }
      });
      if (!door) return { __err: 'no-door' };
      var room = state.rooms[cur];
      /* 把玩家挪到门内侧 70px，满足"靠近才显示"的 near 判定（只是测量用） */
      var n = doorInwardNormal(door.side);
      state.player.x = door.x + n[0] * 70;
      state.player.y = door.y + n[1] * 70;
      if (typeof snapCamera === 'function') snapCamera();
      var cv = document.getElementById('game'), rect = cv.getBoundingClientRect();
      var kx = rect.width / cv.width, ky = rect.height / cv.height, z = cameraZoom();
      return { other: other, door: { x: Math.round(door.x), y: Math.round(door.y) },
        playerGap: Math.round(Math.hypot(state.player.x - door.x, state.player.y - door.y)),
        x: Math.round(rect.x + (door.x - state.cam.x) * z * kx),
        y: Math.round(rect.y + (door.y - state.cam.y) * z * ky) };
    })()`);
    report.spot = spot;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spot.x, y: spot.y, button: 'none' });
    await sleep(750);
    report.hover = await ev(`(function(){ return { labels: DOOR_INFO_STATS.labels,
      focus: roomFocusTargetId(), room: state.currentRoomId }; })()`);
    await shot(`focus-${TAG}.png`);

    report.checks.idleNoDetail = report.idle.labels === 0 && report.idle.focus === report.idle.room;
    report.checks.hoverShowsOne = report.hover.labels === 1;
    report.verdict = report.checks.idleNoDetail && report.checks.hoverShowsOne ? 'PASS' : 'FAIL';
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.error = String(error && error.message || error);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    try { ws.close(); } catch (e) { /* 忽略 */ }
    try { killEdge(edge); } catch (e) { /* 忽略 */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
