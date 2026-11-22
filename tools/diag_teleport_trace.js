/**
 * 只读探针：拦截 currentRoomId 与玩家坐标的写入，抓"谁把它改回去"的调用栈
 * ------------------------------------------------------------
 * 用法：node tools/diag_teleport_trace.js
 * 做法：开局后给 state.currentRoomId 与 state.player.x/y 装 setter，
 *      只记录"跳变 >200px 的坐标写入"和"每一次 currentRoomId 写入"，
 *      然后执行一次 performRoomTeleport，等 900ms 打印完整写入轨迹。
 * 不改游戏逻辑、不写存档。
 */
const { spawn } = require('child_process');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9765;
const FILE = path.resolve(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 主流程 */
async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'
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
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.text || '') + ' ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  for (let i = 0; i < 120; i += 1) {
    if (await ev("!!document.getElementById('btnStart') && typeof startGame === 'function'")) break;
    await sleep(250);
  }
  await ev("document.getElementById('btnStart').click()");
  await sleep(500);
  await ev("const c=document.querySelector('.char-card'); if(c) c.click();");
  await sleep(300);
  await ev("const b=document.getElementById('btnCharConfirm'); if(b) b.click();");
  await sleep(1600);

  /* 装拦截器：记录写入值与调用栈（只保留首 40 帧栈，避免爆内存） */
  const installed = await ev(`(() => {
    window.__TRACE = [];
    const push = (kind, from, to, extra) => {
      if (window.__TRACE.length > 300) return;
      const st = (new Error().stack || '').split('\\n').slice(2, 7).join(' <- ');
      window.__TRACE.push({ kind, from, to, extra, st });
    };
    const cid = state.currentRoomId;
    let cidVal = cid;
    Object.defineProperty(state, 'currentRoomId', {
      configurable: true,
      get() { return cidVal; },
      set(v) { push('currentRoomId', cidVal, v); cidVal = v; }
    });
    const p = state.player;
    let px = p.x, py = p.y;
    Object.defineProperty(p, 'x', {
      configurable: true,
      get() { return px; },
      set(v) { if (Math.abs(v - px) > 200) push('player.x', Math.round(px), Math.round(v)); px = v; }
    });
    Object.defineProperty(p, 'y', {
      configurable: true,
      get() { return py; },
      set(v) { if (Math.abs(v - py) > 200) push('player.y', Math.round(py), Math.round(v)); py = v; }
    });
    return 'installed cid=' + cidVal + ' px=' + Math.round(px) + ' py=' + Math.round(py);
  })()`);
  console.log('I0', installed);

  const call = await ev(`(() => {
    const t = roomNeighbors(state.currentRoomId)[0];
    window.__T = t;
    return 'target=' + t + ' ret=' + performRoomTeleport(t);
  })()`);
  console.log('I1 调用', call);

  await sleep(900);
  const trace = await ev("window.__TRACE");
  console.log('I2 写入轨迹条数', trace.length);
  trace.forEach((r, i) => {
    console.log(`  #${i} ${r.kind} ${r.from} -> ${r.to}${r.extra ? ' ' + r.extra : ''}\n      ${r.st}`);
  });
  console.log('I3 终态', JSON.stringify(await ev(`({ cur: state.currentRoomId, playerRoom: (() => { const rr = roomAt(state.player.x, state.player.y); return rr ? rr.id : -1; })(), px: Math.round(state.player.x), py: Math.round(state.player.y), fadeToken: sceneFadeRuntime.token, stat: ROOM_TELEPORT_STATS.last })`)));

  killEdge(edge);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
