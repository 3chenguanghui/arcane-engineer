/**
 * 只读探针：performRoomTeleport 返回 true 之后，currentRoomId 到底什么时候变、会不会不变
 * ------------------------------------------------------------
 * 用法：node tools/diag_teleport.js
 * 三个用例（改前基线）：
 *   A 单次传送：调用后 0 / 80 / 200 / 400ms 采样 currentRoomId
 *   B 连点两次：同一 tick 内先后传去两间相邻房，400ms 后看最终落在哪
 *   C 转场竞争：传送后立刻发起另一次场景转场（playSceneFade），看房间回调是否被 token 丢掉
 * 只读内存状态，不改存档。
 */
const { spawn } = require('child_process');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9764;
const FILE = path.resolve(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 读当前传送相关状态 */
const SNAP = `(() => ({
  cur: state.currentRoomId,
  playerRoom: (() => { const r = roomAt(state.player.x, state.player.y); return r ? r.id : -1; })(),
  px: Math.round(state.player.x), py: Math.round(state.player.y),
  fade: { active: sceneFadeRuntime.active, token: sceneFadeRuntime.token, mode: sceneFadeRuntime.mode, lastPeak: sceneFadeRuntime.lastPeak },
  stat: ROOM_TELEPORT_STATS.last ? { roomId: ROOM_TELEPORT_STATS.last.roomId, at: ROOM_TELEPORT_STATS.last.at } : null
}))()`;

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

  /* 先看清相邻房与当前状态 */
  const graph = await ev(`(() => {
    const cur = state.currentRoomId;
    const nb = roomNeighbors(cur);
    const pricedId = state.pricedDoors ? state.pricedDoors.paidRoomId : -1;
    return { cur, pricedId, nb, rooms: nb.map((id) => ({ id, type: state.rooms[id].type, priced: id === pricedId, w: state.rooms[id].w, h: state.rooms[id].h })) };
  })()`);
  console.log('G0 图', JSON.stringify(graph));

  /* 用例 A：单次传送——优先选"非代价房"，把"时序"与"代价房退回"分开 */
  const a0 = await ev(SNAP);
  const aCall = await ev(`(() => {
    const nb = roomNeighbors(state.currentRoomId);
    const pricedId = state.pricedDoors ? state.pricedDoors.paidRoomId : -1;
    const t = nb.find((id) => id !== pricedId) != null ? nb.find((id) => id !== pricedId) : nb[0];
    window.__A = t;
    return 'target=' + t + ' type=' + state.rooms[t].type + ' priced=' + (t === pricedId) + ' ret=' + performRoomTeleport(t);
  })()`);
  console.log('A1 调用', aCall, JSON.stringify(await ev(SNAP)));
  await sleep(80);
  console.log('A2 +80ms', JSON.stringify(await ev(SNAP)));
  await sleep(120);
  console.log('A3 +200ms', JSON.stringify(await ev(SNAP)));
  await sleep(200);
  console.log('A4 +400ms', JSON.stringify(await ev(SNAP)), 'from=' + JSON.stringify(a0.cur));

  /* 用例 B：同一 tick 连点两间（模拟双击 / 快速连选） */
  const bCall = await ev(`(() => {
    const nb = roomNeighbors(state.currentRoomId);
    if (nb.length < 2) return 'SKIP 邻居不足';
    const t1 = nb[0], t2 = nb[1];
    const r1 = performRoomTeleport(t1);
    const r2 = performRoomTeleport(t2);
    window.__B = { t1, t2 };
    return 't1=' + t1 + ' ret1=' + r1 + ' / t2=' + t2 + ' ret2=' + r2;
  })()`);
  await sleep(500);
  console.log('B1 连点', bCall);
  console.log('B2 +500ms', JSON.stringify(await ev(SNAP)), 'expectRoom=' + JSON.stringify(graph.cur));

  /* 用例 C：传送后立刻发起另一次场景转场（模拟换层 / 重开的遮罩抢 token）
     目标固定选"非代价房"，避免代价房退回盖住真实结论 */
  const cCall = await ev(`(() => {
    const nb = roomNeighbors(state.currentRoomId);
    const pricedId = state.pricedDoors ? state.pricedDoors.paidRoomId : -1;
    const target = nb.find((id) => id !== pricedId) != null ? nb.find((id) => id !== pricedId) : nb[0];
    const before = state.currentRoomId;
    const ret = performRoomTeleport(target);
    /* 同一 tick 再开一次转场：token +1，房间回调的峰值检查会失败 */
    playSceneFade(0.28, 'descend', function () {}, true);
    return 'before=' + before + ' target=' + target + ' priced=' + (target === pricedId) + ' ret=' + ret;
  })()`);
  await sleep(600);
  console.log('C1 竞争', cCall);
  console.log('C2 +600ms', JSON.stringify(await ev(SNAP)));

  killEdge(edge);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
