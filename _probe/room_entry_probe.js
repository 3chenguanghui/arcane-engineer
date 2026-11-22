/**
 * "还没选房间就被送进去"复现探针（只读，不改主文件）
 * ------------------------------------------------------------------
 * 要回答的三个问题（用户原话）：
 *   1) 什么条件下会"跳进房"？
 *   2) 进房过程有没有输入锁？
 *   3) 有没有"默认选中"的房间？
 *
 * 三组实验（都用游戏自身运行态，不伪造逻辑）：
 *   A. IDLE20：连续 20 次新开局，全程零输入，看角色是否移动 / 是否进房 / 门是否落闸。
 *   B. ENTER_HOLD：模拟"按住回车不放"穿过选角页进入战斗（回车在战斗里是冲刺），
 *      看残留按键是否把角色自动推进房间。
 *   C. DOOR_STEP：把角色放到某间战斗房门口外，按住"进门方向"，
 *      逐帧记录 (a) currentRoomId 翻成该房时角色已进入多少像素，
 *             (b) 门落闸时角色已进入多少像素，
 *             (c) 落闸后反向走能否退出。
 *
 * 用法：node _probe/room_entry_probe.js [tag]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'roomentry';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-re-${TAG}-${process.pid}-${Date.now()}`);
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const PORT = 9700 + Math.floor(Math.random() * 180);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 找本机 Edge */
function findEdge() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 msedge.exe');
}

/** 文件 MD5（大写） */
function md5File(f) {
  return crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex').toUpperCase();
}

/** 启动 headless Edge 并连上 CDP */
async function boot() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  spawn(findEdge(), [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', '--hide-scrollbars', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 未就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  /** 页面内求值 */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return { file: name, bytes: fs.statSync(f).size };
  };
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } } };
}

/** 进入游戏：标题 → 选角色 → 开始 */
async function enterGame(t) {
  const { ev } = t;
  await t.send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  for (let i = 0; i < 200; i += 1) {
    const ok = await ev(`(() => { const b = document.getElementById('btnStart'); return !!(b && b.getBoundingClientRect().width > 0); })()`);
    if (ok === true) break;
    await sleep(150);
  }
  await ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()`);
  for (let i = 0; i < 60; i += 1) {
    if (await ev(`(() => !!document.querySelector('.char-card'))()`) === true) break;
    await sleep(120);
  }
  await ev(`(() => { const c = document.querySelector('.char-card'); if (c) c.click(); return !!c; })()`);
  await sleep(200);
  await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
  for (let i = 0; i < 200; i += 1) {
    const st = await ev(`(() => { const d = window.__roamDebug; if (!d || !d.getState) return null; return { mode: d.getState().mode }; })()`);
    if (st && st.mode === 'playing') return;
    if (i > 0 && i % 40 === 0) {
      await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
    }
    await sleep(200);
  }
  throw new Error('未能进入 playing 模式');
}

/** 在页面里装一个逐帧记录器（记录位置漂移 / 房间切换 / 落闸 / 按键残留） */
const RECORDER_INSTALL = `(() => {
  const R = {
    t0: performance.now(), on: true, frames: 0,
    x0: state.player.x, y0: state.player.y,
    maxMove: 0, room0: state.currentRoomId, roomIds: [state.currentRoomId],
    lockedEver: false, lockedId: null, keysEver: {}, transitionLockEver: false
  };
  window.__RE = R;
  const keyName = (k) => k;
  const sample = () => {
    if (!window.__RE || !window.__RE.on || !state) return;
    const r = window.__RE;
    r.frames += 1;
    const d = Math.hypot(state.player.x - r.x0, state.player.y - r.y0);
    if (d > r.maxMove) r.maxMove = d;
    if (r.roomIds.indexOf(state.currentRoomId) < 0) r.roomIds.push(state.currentRoomId);
    (state.rooms || []).forEach((room) => {
      if (room.locked && !r.lockedEver) { r.lockedEver = true; r.lockedId = room.id; }
    });
    Object.keys(state.keys || {}).forEach((k) => { if (state.keys[k]) r.keysEver[k] = true; });
    if (state.transitionLock) r.transitionLockEver = true;
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  return true;
})()`;

/** 读取并停止记录器 */
const RECORDER_READ = `(() => {
  const r = window.__RE || {};
  if (window.__RE) window.__RE.on = false;
  const rooms = (state.rooms || []).map((room) => ({ id: room.id, type: room.type, locked: !!room.locked, cleared: !!room.cleared }));
  const spawnRoom = state.rooms ? state.rooms.find((x) => x.id === state.spawnRoomId) : null;
  return {
    frames: r.frames, maxMove: +(r.maxMove || 0).toFixed(2),
    room0: r.room0, roomIds: r.roomIds || [], roomChanges: (r.roomIds || []).length - 1,
    lockedEver: !!r.lockedEver, lockedId: r.lockedId,
    keysEver: Object.keys(r.keysEver || {}),
    transitionLockEver: !!r.transitionLockEver,
    mode: state.mode, status: state.status,
    currentRoomId: state.currentRoomId,
    spawnRoomId: state.spawnRoomId,
    spawnType: spawnRoom ? spawnRoom.type : null,
    doorsClosed: (state.doors || []).filter((d) => d.closed).length,
    rooms
  };
})()`;

/** 实验 A：连续 20 次新开局，零输入 */
async function experimentIdle(t, trials) {
  const rows = [];
  for (let i = 0; i < trials; i += 1) {
    const r = await t.ev(`(() => { try { restartRun(); return { ok: true }; } catch (e) { return { err: String(e) }; } })()`);
    if (r && r.err) { rows.push({ i, err: r.err }); continue; }
    await sleep(420);   // 等 generateFloor + 首帧
    await t.ev(RECORDER_INSTALL);
    await sleep(2400);  // 完全不输入
    const read = await t.ev(RECORDER_READ);
    rows.push(Object.assign({ i }, read));
  }
  const ok = rows.filter((r) => !r.err);
  return {
    trials: rows.length,
    ok: ok.length,
    moved: ok.filter((r) => r.maxMove > 1).length,
    maxMovePeak: ok.reduce((m, r) => Math.max(m, r.maxMove || 0), 0),
    roomChanged: ok.filter((r) => r.roomChanges > 0).length,
    locked: ok.filter((r) => r.lockedEver).length,
    keysResidue: ok.filter((r) => (r.keysEver || []).length > 0).length,
    spawnTypes: ok.reduce((acc, r) => { acc[r.spawnType || 'null'] = (acc[r.spawnType || 'null'] || 0) + 1; return acc; }, {}),
    defaultSelected: ok.filter((r) => r.currentRoomId != null && r.currentRoomId >= 0).length,
    room0MinusOne: ok.filter((r) => r.room0 === -1).length,
    rows
  };
}

/** 实验 B：按住回车不放穿过选角页（模拟真实的长按开始） */
async function experimentEnterHold(t) {
  /* 先重开一局，保证角色在出生房中心 */
  await t.ev(`(() => { restartRun(); return true; })()`);
  await sleep(500);
  const before = await t.ev(`(() => ({ x: state.player.x, y: state.player.y, room: state.currentRoomId, mode: state.mode }))()`);
  /* 连续 24 次 repeat 回车（约 1 秒，模拟键盘自动重复） */
  await t.ev(`(() => {
    window.__REH = { dash: 0, ev: 0 };
    for (let i = 0; i < 24; i += 1) {
      setTimeout(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true, bubbles: true, cancelable: true }));
        if (state && state.player && state.player.dashTime > 0) window.__REH.dash += 1;
        window.__REH.ev += 1;
      }, i * 40);
    }
    return true;
  })()`);
  await sleep(1400);
  const after = await t.ev(`(() => ({
    x: state.player.x, y: state.player.y, room: state.currentRoomId,
    moved: +Math.hypot(state.player.x - ${before.x}, state.player.y - ${before.y}).toFixed(2),
    dashHits: (window.__REH && window.__REH.dash) || 0,
    events: (window.__REH && window.__REH.ev) || 0,
    keys: Object.keys(state.keys || {}).filter((k) => state.keys[k])
  }))()`);
  /* 模拟"还按住 W"：直接给一个持续方向键，1.2 秒 */
  await t.ev(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(1200);
  const afterWalk = await t.ev(`(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true, cancelable: true }));
    return { x: state.player.x, y: state.player.y, room: state.currentRoomId, mode: state.mode, status: state.status };
  })()`);
  return { before, after, afterWalk };
}

/** 实验 C：门口按住方向键，量"翻房深度 / 落闸深度 / 能否退出" */
async function experimentDoorStep(t) {
  /* 1) 找一间未清空的战斗房 + 它的一扇门 */
  const pick = await t.ev(`(() => {
    const room = (state.rooms || []).find((r) => r.type === 'battle' && !r.cleared && !r.locked);
    if (!room) return { err: 'no-battle-room' };
    const door = (state.doors || []).find((d) => d.roomId === room.id);
    if (!door) return { err: 'no-door', roomId: room.id };
    return { roomId: room.id, type: room.type, rect: { x: room.x, y: room.y, w: room.w, h: room.h }, door: { side: door.side, x: door.x, y: door.y } };
  })()`);
  if (pick && pick.err === 'no-battle-room') {
    /* 第一层可能只有 start/rest/宝箱；换到第 2 层再找 */
    await t.ev(`(() => { generateFloor(2); return true; })()`);
    await sleep(400);
    return experimentDoorStep(t);
  }
  if (!pick || pick.err) return { err: pick ? pick.err : 'pick-failed' };

  /* 2) 计算门外点 / 进门方向键 */
  const side = pick.door.side;
  const dirKey = side === 'left' ? 'd' : side === 'right' ? 'a' : side === 'top' ? 's' : 'w';
  const outPt = side === 'left' ? { x: pick.door.x - 46, y: pick.door.y }
    : side === 'right' ? { x: pick.door.x + 46, y: pick.door.y }
    : side === 'top' ? { x: pick.door.x, y: pick.door.y - 46 }
    : { x: pick.door.x, y: pick.door.y + 46 };

  const placed = await t.ev(`(() => window.__roamDebug.teleport(${outPt.x}, ${outPt.y}))()`);
  await sleep(260);
  const atStart = await t.ev(`(() => ({ room: state.currentRoomId, x: state.player.x, y: state.player.y, locked: !!((state.rooms[${pick.roomId}] || {}).locked) }))()`);

  /* 3) 按住进门方向，逐帧采样（页面内采样，避免 CDP 往返丢帧） */
  const trace = await t.ev(`(() => {
    const room = state.rooms[${pick.roomId}];
    const side = ${JSON.stringify(side)};
    const depth = () => side === 'left' ? state.player.x - room.x
      : side === 'right' ? (room.x + room.w) - state.player.x
      : side === 'top' ? state.player.y - room.y
      : (room.y + room.h) - state.player.y;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(dirKey)}, code: ${JSON.stringify('Key' + dirKey.toUpperCase())}, bubbles: true, cancelable: true }));
    const rows = [];
    const t0 = performance.now();
    window.__REDone = false;
    window.__RETrace = rows;
    const tick = () => {
      rows.push({
        t: Math.round(performance.now() - t0),
        depth: +depth().toFixed(1),
        cur: state.currentRoomId,
        locked: !!room.locked,
        closedDoors: (state.doors || []).filter((d) => d.roomId === room.id && d.closed).length
      });
      if (room.locked || performance.now() - t0 > 4000) {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(dirKey)}, code: ${JSON.stringify('Key' + dirKey.toUpperCase())}, bubbles: true, cancelable: true }));
        window.__REDone = true;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return { started: true, side, dirKey, roomShortSide: Math.min(room.w, room.h), enterDepthCfg: ROOM_FLOW_CONFIG.enterDepth };
  })()`);
  for (let i = 0; i < 100; i += 1) {
    if (await t.ev(`(() => !!window.__REDone)()`) === true) break;
    await sleep(100);
  }
  const moved = await t.ev(`(() => {
    const room = state.rooms[${pick.roomId}];
    const side = ${JSON.stringify(side)};
    const depth = () => side === 'left' ? state.player.x - room.x
      : side === 'right' ? (room.x + room.w) - state.player.x
      : side === 'top' ? state.player.y - room.y
      : (room.y + room.h) - state.player.y;
    const rows = window.__RETrace || [];
    return { depth: +depth().toFixed(1), cur: state.currentRoomId, locked: !!room.locked,
      closedDoors: (state.doors || []).filter((d) => d.roomId === room.id && d.closed).length,
      rows: rows.slice(-1).concat([]), rowCount: rows.length };
  })()`);

  /* 4) 反向走 1.2 秒，看落闸后能不能退出房间 */
  const backKey = dirKey === 'd' ? 'a' : dirKey === 'a' ? 'd' : dirKey === 's' ? 'w' : 's';
  const back = await t.ev(`(() => {
    const room = state.rooms[${pick.roomId}];
    const side = ${JSON.stringify(side)};
    const depth = () => side === 'left' ? state.player.x - room.x
      : side === 'right' ? (room.x + room.w) - state.player.x
      : side === 'top' ? state.player.y - room.y
      : (room.y + room.h) - state.player.y;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(backKey)}, code: ${JSON.stringify('Key' + backKey.toUpperCase())}, bubbles: true, cancelable: true }));
    window.__REBack = { startDepth: +depth().toFixed(1) };
    setTimeout(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(backKey)}, code: ${JSON.stringify('Key' + backKey.toUpperCase())}, bubbles: true, cancelable: true }));
      window.__REBack.endDepth = +depth().toFixed(1);
      window.__REBack.cur = state.currentRoomId;
      window.__REBack.outside = !(state.currentRoomId === room.id);
      window.__REBack.done = true;
    }, 1200);
    return true;
  })()`);
  for (let i = 0; i < 40; i += 1) {
    if (await t.ev(`(() => !!(window.__REBack && window.__REBack.done))()`) === true) break;
    await sleep(100);
  }
  const backRes = await t.ev(`(() => window.__REBack || null)()`);
  const traceRows = await t.ev(`(() => window.__RETrace || [])()`);

  return { pick, dirKey, outPt, placed, atStart, trace, traceRows, moved, backKey, back: backRes, backScript: back };
}

/** 找一个战斗房的"门内测点"：沿门法线向房内 threshold+offset 像素 */
const DOOR_INNER_POINT = `(roomId, offset) => {
  const room = state.rooms[roomId];
  const door = (state.doors || []).find((d) => d.roomId === roomId);
  const depth = Math.min(room.w, room.h) * ROOM_FLOW_CONFIG.enterDepth;
  const d = depth + offset;
  let x = door.x, y = door.y;
  if (door.side === 'left') x = room.x + d;
  else if (door.side === 'right') x = room.x + room.w - d;
  else if (door.side === 'top') y = room.y + d;
  else y = room.y + room.h - d;
  return { x, y, depth: d, threshold: depth, side: door.side };
}`;

/** 开一层全新的楼（保证还有未锁的战斗房可用作测点） */
async function freshFloor(t) {
  await t.ev(`(() => { try { restartRun(); } catch (e) { return String(e); } return true; })()`);
  await sleep(600);
}

/** 实验 D：站位刚过阈值，立刻反悔 —— 验证 0.3s 反悔窗口能取消落闸并退出 */
async function experimentGraceBack(t) {
  await freshFloor(t);
  const setup = await t.ev(`(() => {
    const room = (state.rooms || []).find((r) => r.type === 'battle' && !r.cleared && !r.locked);
    if (!room) return { err: 'no-battle-room' };
    const door = (state.doors || []).find((d) => d.roomId === room.id);
    if (!door) return { err: 'no-door' };
    const pt = (${DOOR_INNER_POINT})(room.id, 6);
    window.__roamDebug.teleport(pt.x, pt.y);
    return { roomId: room.id, pt, side: pt.side };
  })()`);
  if (setup && setup.err) return setup;
  const roomId = setup.roomId;
  const side = setup.side;
  const outKey = side === 'left' ? 'a' : side === 'right' ? 'd' : side === 'top' ? 'w' : 's';
  await sleep(200);

  const r = await t.ev(`(() => {
    const room = state.rooms[${roomId}];
    const side = ${JSON.stringify(side)};
    const depth = () => side === 'left' ? state.player.x - room.x
      : side === 'right' ? (room.x + room.w) - state.player.x
      : side === 'top' ? state.player.y - room.y
      : (room.y + room.h) - state.player.y;
    const threshold = Math.min(room.w, room.h) * ROOM_FLOW_CONFIG.enterDepth;
    window.__RG = {
      threshold: +threshold.toFixed(1), depth0: +depth().toFixed(1),
      lockDelay: ROOM_FLOW_CONFIG.lockDelay, locked0: !!room.locked,
      t0: performance.now()
    };
    /* 立刻反向离开 */
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(outKey)}, code: ${JSON.stringify('Key' + outKey.toUpperCase())}, bubbles: true, cancelable: true }));
    setTimeout(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(outKey)}, code: ${JSON.stringify('Key' + outKey.toUpperCase())}, bubbles: true, cancelable: true }));
      window.__RG.elapsed = Math.round(performance.now() - window.__RG.t0);
      window.__RG.endDepth = +depth().toFixed(1);
      window.__RG.lockedEnd = !!room.locked;
      window.__RG.doorsClosed = (state.doors || []).filter((dd) => dd.roomId === room.id && dd.closed).length;
      window.__RG.cur = state.currentRoomId;
      window.__RG.outside = state.currentRoomId !== room.id;
      window.__RG.done = true;
    }, 1000);
    return true;
  })()`);
  for (let i = 0; i < 40; i += 1) {
    if (await t.ev(`(() => !!(window.__RG && window.__RG.done))()`) === true) break;
    await sleep(100);
  }
  const res = await t.ev(`(() => window.__RG || null)()`);
  return { roomId, side, outKey, res, started: r };
}

/** 实验 E：站位过阈值后保持不动 —— 验证落闸确实延迟到 lockDelay 左右（不是当帧） */
async function experimentLockDelay(t) {
  await freshFloor(t);
  const setup = await t.ev(`(() => {
    const room = (state.rooms || []).find((r) => r.type === 'battle' && !r.cleared && !r.locked);
    if (!room) return { err: 'no-battle-room' };
    const pt = (${DOOR_INNER_POINT})(room.id, 30);
    window.__roamDebug.teleport(pt.x, pt.y);
    return { roomId: room.id, pt, side: pt.side };
  })()`);
  if (setup && setup.err) return setup;
  await sleep(120);
  const r = await t.ev(`(() => {
    const room = state.rooms[${setup.roomId}];
    const lockDelay = ROOM_FLOW_CONFIG.lockDelay;
    window.__RL = { lockDelay, t0: performance.now(), lockedAt: null, locked0: !!room.locked };
    const tick = () => {
      if (room.locked && window.__RL.lockedAt == null) {
        window.__RL.lockedAt = Math.round(performance.now() - window.__RL.t0);
        window.__RL.doorsClosed = (state.doors || []).filter((d) => d.roomId === room.id && d.closed).length;
        window.__RL.done = true;
        return;
      }
      if (performance.now() - window.__RL.t0 > 2000) { window.__RL.done = true; window.__RL.timeout = true; return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  })()`);
  for (let i = 0; i < 40; i += 1) {
    if (await t.ev(`(() => !!(window.__RL && window.__RL.done))()`) === true) break;
    await sleep(100);
  }
  const res = await t.ev(`(() => window.__RL || null)()`);
  return { roomId: setup.roomId, pt: setup.pt, res, started: r };
}

/** 主流程 */
async function main() {
  const t = await boot();
  const finger = { file: MAIN, bytes: fs.statSync(MAIN).size, md5: md5File(MAIN) };
  console.log('FINGER ' + JSON.stringify(finger));
  await enterGame(t);
  await sleep(900);

  /* 性能口径：DOM 变更/秒 + 长任务（用户指定；帧时间不算） */
  await t.ev(`(() => {
    window.__P = { mut: 0, long: 0, longMs: 0, t0: performance.now() };
    window.__PMO = new MutationObserver((ms) => { window.__P.mut += ms.length; });
    window.__PMO.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    try {
      window.__PPO = new PerformanceObserver((l) => { l.getEntries().forEach((e) => { window.__P.long += 1; window.__P.longMs += e.duration; }); });
      window.__PPO.observe({ entryTypes: ['longtask'] });
    } catch (e) { window.__P.noLongTask = true; }
    return true;
  })()`);

  /* 关键静态事实：进房淡入到底有没有加 transitionLock */
  const codeFacts = await t.ev(`(() => {
    const out = {};
    try {
      out.roomFadeNoLock = true;   // updateRoomLogic 调用 playSceneFade(0.18, 'room', null, true)
      out.lockCfg = { lockDoors: ROOM_FLOW_CONFIG.lockDoors, enterDepth: ROOM_FLOW_CONFIG.enterDepth };
      out.doorBarWidth = ROOM_FLOW_CONFIG.doorBarWidth;
      out.hasSpawnDefault = state.currentRoomId === state.spawnRoomId;
      out.currentRoomId = state.currentRoomId;
      out.spawnRoomId = state.spawnRoomId;
      out.transitionLock = !!state.transitionLock;
      const sp = state.rooms.find((r) => r.id === state.spawnRoomId);
      out.spawnType = sp ? sp.type : null;
      out.roomCount = state.rooms.length;
    } catch (e) { out.err = String(e); }
    return out;
  })()`);
  console.log('FACTS ' + JSON.stringify(codeFacts));

  const LITE = process.argv[3] === 'lite';
  const idle = LITE ? { skipped: true } : await experimentIdle(t, 20);
  console.log('IDLE ' + JSON.stringify({ trials: idle.trials, ok: idle.ok, moved: idle.moved, maxMovePeak: idle.maxMovePeak, roomChanged: idle.roomChanged, locked: idle.locked, keysResidue: idle.keysResidue, spawnTypes: idle.spawnTypes, defaultSelected: idle.defaultSelected, room0MinusOne: idle.room0MinusOne }));

  const enterHold = await experimentEnterHold(t);
  console.log('ENTERHOLD ' + JSON.stringify(enterHold));

  const doorStep = await experimentDoorStep(t);
  console.log('DOORSTEP ' + JSON.stringify({
    pick: doorStep.pick, dirKey: doorStep.dirKey, placed: doorStep.placed, atStart: doorStep.atStart,
    moved: doorStep.moved, back: doorStep.back,
    cfg: doorStep.trace ? { short: doorStep.trace.roomShortSide, enterDepth: doorStep.trace.enterDepthCfg } : null
  }));
  if (doorStep.traceRows && doorStep.traceRows.length) {
    const rows = doorStep.traceRows;
    const firstInRoom = rows.find((r) => r.cur === doorStep.pick.roomId);
    const firstLocked = rows.find((r) => r.locked);
    console.log('DOORSTEP_THRESH ' + JSON.stringify({
      samples: rows.length,
      firstInRoom: firstInRoom || null,
      firstLocked: firstLocked || null,
      last: rows[rows.length - 1] || null,
      cfg: doorStep.trace ? { short: doorStep.trace.roomShortSide, enterDepth: doorStep.trace.enterDepthCfg } : null
    }));
  }

  const grace = await experimentGraceBack(t);
  console.log('GRACE ' + JSON.stringify(grace.res ? {
    threshold: grace.res.threshold, depth0: grace.res.depth0, lockDelay: grace.res.lockDelay,
    locked0: grace.res.locked0, elapsed: grace.res.elapsed, endDepth: grace.res.endDepth,
    lockedEnd: grace.res.lockedEnd, doorsClosed: grace.res.doorsClosed,
    outside: grace.res.outside, cur: grace.res.cur
  } : grace));

  const lockDelay = await experimentLockDelay(t);
  console.log('LOCKDELAY ' + JSON.stringify(lockDelay.res ? {
    lockDelay: lockDelay.res.lockDelay, locked0: lockDelay.res.locked0,
    lockedAt: lockDelay.res.lockedAt, doorsClosed: lockDelay.res.doorsClosed, timeout: !!lockDelay.res.timeout
  } : lockDelay));

  const perf = await t.ev(`(() => {
    const a = window.__P; const sec = (performance.now() - a.t0) / 1000;
    window.__PMO.disconnect(); if (window.__PPO) window.__PPO.disconnect();
    return { seconds: +sec.toFixed(2), mutations: a.mut, mutationsPerSec: +(a.mut / sec).toFixed(1), longTasks: a.long, longTaskMs: +a.longMs.toFixed(1), longtaskSupported: !a.noLongTask };
  })()`);

  await t.shot(`room-entry-${TAG}.png`);
  t.close();

  const out = { tag: TAG, finger, at: new Date().toISOString(), codeFacts, idle, enterHold, doorStep, grace, lockDelay, perf };
  const f = path.join(OUT, `room-entry-${TAG}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.log('PERF ' + JSON.stringify(perf));
  console.log('WROTE ' + f);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
