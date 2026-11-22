/**
 * 房间选择 / 楼层徽标 取证探针（改前、改后各跑一次，用同一套操作对照）
 * 用法：node tools/diag_rooms_shots.js before|after
 *
 * 做三件事：
 *   ① 截 HUD 顶部小地图头（"楼层地图 MAP" 右侧那枚楼层徽标）→ 证明 F1/F8 这类前缀来自哪里
 *   ② 出生房按 Q 打开选房浮层 → 截当前候选
 *   ③ 选 1 号房、清空、再按 Q → 截候选，并导 JSON：候选里有没有"已访问/已清"的房
 * 只读：不写存档、不改数值。唯一副作用是把这一局打完，进程退出即丢。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9741;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const TAG = (process.argv[2] || 'run');
const OUTDIR = path.join(ROOT, 'lab', 'player8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 主流程：起无头 Edge → 开局 → 三步取证 → 落盘 */
async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${prepareProfile()}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    const onMsg = (m) => {
      const d = JSON.parse(m.data);
      if (d.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (d.error) rej(new Error(method + ' ' + JSON.stringify(d.error)));
      else res(d.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  /** 截图落盘；clip 为空则整屏 */
  const shot = async (name, clip) => {
    const p = { format: 'png', captureBeyondViewport: false };
    if (clip) p.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 };
    const r = await send('Page.captureScreenshot', p);
    const file = path.join(OUTDIR, `${TAG}_${name}.png`);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('SHOT', file);
    return file;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  for (let i = 0; i < 80; i += 1) {
    if (await ev("!!document.getElementById('btnStart') && typeof startGame === 'function'")) break;
    await sleep(250);
  }
  await ev("(function(){ __charSkipPick = true; __charPickedThisBoot = true;"
    + " if (typeof closeCharSelect === 'function') closeCharSelect(); startGame(); return 1; })()");
  await sleep(1600);

  // ① 楼层徽标：拿小地图头的包围盒，只截这一条
  const headBox = await ev(`(function(){
    var el = document.querySelector('.minimap-head');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width) + 8, height: Math.round(r.height) + 8 };
  })()`);
  const badgeText = await ev("(document.getElementById('minimapFloor')||{}).textContent || null");
  if (headBox) await shot('badge', headBox);

  /* 楼层徽标在深层会不会又变回 F8：临时把 state.floor 拨到 8，等主循环重绘一次再截 */
  const deepBadge = await ev(`(function(){
    var old = state.floor;
    state.floor = 8;
    return { old: old };
  })()`);
  await sleep(500);
  const badgeAt8 = await ev("(document.getElementById('minimapFloor')||{}).textContent || null");
  if (headBox) await shot('badge_floor8', headBox);
  await ev(`(function(){ state.floor = ${1}; return state.floor; })()`);
  await sleep(400);

  // ② 出生房的候选列表
  await ev("(function(){ if (typeof openRoomPicker === 'function') { openRoomPicker(); renderRoomPicker(); } return 1; })()");
  await sleep(350);
  const spawnChoices = await ev(`(function(){
    return nextRoomChoices().map(function(id){
      var r = state.rooms[id] || {};
      return { id: id, type: r.type, visited: !!r.visited, cleared: !!r.cleared, depth: r.depth };
    });
  })()`);
  await shot('picker_spawn');

  // ③ 进 1 号房 → 清空 → 再开候选
  /* 直接用 performRoomTeleport 落地：requestRoomTeleport 还管"本房是否清完 / 门是否锁"，
     探针要的是"玩家确实进过这间房"，所以绕过判定只走落位那一步，并在 JSON 里记下原因。 */
  const teleport = await ev(`(function(){
    var locked = !!(state.rooms[1] || {}).locked;
    var ok = (typeof performRoomTeleport === 'function') ? performRoomTeleport(1, null) : false;
    if (typeof closeRoomPicker === 'function') closeRoomPicker();
    return { ok: ok, lockedBefore: locked, cur: state.currentRoomId };
  })()`);
  await sleep(900);
  await ev(`(function(){
    var roomId = state.currentRoomId;
    var guard = 0;
    (state.enemies || []).forEach(function(e){
      if (e.hp > 0 && e.roomId === roomId) {
        e.spawnGuard = 0;
        if (typeof damageEnemy === 'function') damageEnemy(e, 1e9, 0, {});
      }
    });
    return { roomId: roomId, alive: (state.enemies||[]).filter(function(e){ return e.hp > 0 && e.roomId === roomId; }).length };
  })()`);
  // 等清房结算（有的怪有出场预警 / 死亡演出）
  let clearedInfo = null;
  for (let i = 0; i < 30; i += 1) {
    clearedInfo = await ev(`(function(){
      var room = state.rooms[state.currentRoomId] || {};
      return { roomId: state.currentRoomId, cleared: !!room.cleared,
               alive: (state.enemies||[]).filter(function(e){ return e.hp > 0 && e.roomId === state.currentRoomId; }).length };
    })()`);
    if (clearedInfo.cleared) break;
    await sleep(200);
  }
  await ev("(function(){ if (typeof openRoomPicker === 'function') { openRoomPicker(); renderRoomPicker(); } return 1; })()");
  await sleep(350);
  const afterClearChoices = await ev(`(function(){
    return nextRoomChoices().map(function(id){
      var r = state.rooms[id] || {};
      return { id: id, type: r.type, visited: !!r.visited, cleared: !!r.cleared, depth: r.depth };
    });
  })()`);
  await shot('picker_after_clear');

  // 顺手记录：所有房间的访问标记 + 深度（供"谁写了标记"的追溯）
  const roomState = await ev(`(function(){
    return (state.rooms || []).map(function(r){
      return { id: r.id, type: r.type, visited: !!r.visited, cleared: !!r.cleared, depth: r.depth };
    });
  })()`);

  /* 边界：① 首领房（应返回空清单）② 全层已探索（应退化为回访且打标）——测完原样还原 */
  const boundary = await ev(`(function(){
    var snap = (state.rooms || []).map(function(r){ return { id: r.id, v: !!r.visited, c: !!r.cleared }; });
    var curSave = state.currentRoomId;
    var out = {};
    var boss = (state.rooms || []).filter(function(r){ return r.type === 'boss'; })[0];
    var bossId = boss ? boss.id : -1;
    out.bossId = bossId;
    (state.rooms || []).forEach(function(r){ if (r.id !== bossId) { r.visited = true; r.cleared = true; } });
    state.currentRoomId = bossId;
    out.boss = { choices: nextRoomChoices(), fallback: roomChoiceFallback };
    state.currentRoomId = 2;
    (state.rooms || []).forEach(function(r){ if (r.id !== 2) { r.visited = true; r.cleared = true; } });
    out.exhausted = { choices: nextRoomChoices(), fallback: roomChoiceFallback };
    snap.forEach(function(s){ var r = state.rooms[s.id]; if (r) { r.visited = s.v; r.cleared = s.c; } });
    state.currentRoomId = curSave;
    return out;
  })()`);

  const out = {
    tag: TAG, file: FILE, sizeBytes: fs.statSync(FILE).size,
    badgeText, badgeAt8, deepBadge, spawnChoices, teleport, clearedInfo, afterClearChoices, roomState, boundary,
    depthOfKeys: await ev("Object.keys((state.floorGraph&&state.floorGraph.depthOf)||{}).length"),
  };
  fs.writeFileSync(path.join(OUTDIR, `${TAG}_rooms.json`), JSON.stringify(out, null, 2), 'utf8');
  console.log('badge=', badgeText, '| badge@floor8=', badgeAt8, '| depthOfKeys=', out.depthOfKeys);
  console.log('boundary=', JSON.stringify(boundary));
  console.log('spawnChoices=', JSON.stringify(spawnChoices));
  console.log('afterClear=', JSON.stringify(afterClearChoices));
  try { ws.close(); } catch (e) { /* ignore */ }
  try { edge.kill(); } catch (e) { /* ignore */ }
}

main().catch((e) => { console.error('FAIL', e.message); process.exitCode = 1; });
