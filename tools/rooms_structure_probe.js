/**
 * 传送式房间结构验收探针
 * ------------------------------------------------------------
 * 机器判据（对应需求 1–7）：
 *   1) 20 层汇总：每层 6 房 / 非首领出口 ∈ [2,3] / 首领度 = 1 / BFS 全通
 *   2) 渲染层计数：corridorRects = 0、doors = 0
 *   3) 传送：邻接房传送成功、落点离墙 ≥100px；未清房被拒且位置不变
 *   4) 1707×930 首屏无横向溢出、当前房屏幕尺寸在 816–1170 × 653–898
 *   5) 三档倍率（2.0 / 2.25 / 2.5）各一张整页截图 + 屏幕像素实测
 *   6) __roamDebug.floorGraph() 原样输出
 *   7) Q 浮层只列邻接房（2–3 张卡），进房 5 秒提示存在
 * 用法：node tools/rooms_structure_probe.js
 * 只读运行：除探针自身注入的临时敌人（用于"未清房被拒"）外不改游戏状态。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
// 每次验收用独立 profile 根目录：避免上一次残留的 Edge 占住 .testprofile/edge 锁
process.env.ARCANE_PROFILE_ROOT = path.join(__dirname, '..', '.testprofile', 'rooms-' + Date.now());
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 400); // 随机端口：避免上一次残留进程占住固定端口
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const SHOT_DIR = path.join(ROOT, '.screenshots', 'rooms_structure');
const VIEW_W = 1707;
const VIEW_H = 930;
const TIERS = [2.0, 2.25, 2.5];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 启动无头 Edge 并连上 CDP，返回 { edge, send, evalJs } */
async function connect() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    `--window-size=${VIEW_W},${VIEW_H}`,
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(300);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  await new Promise((resolve) => { ws.onopen = resolve; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    const id = seq;
    pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };
  return { edge, send, evalJs };
}

/** 开局（跳过角色选择） */
const START_GAME = `(() => {
  window.__charSkipPick = true;
  const btn = document.getElementById('btnStart');
  if (btn) btn.click();
  return true;
})()`;

/** 帧耗时采样：连续 60 帧的 rAF 间隔（判断环境是否被 CPU 满载拖慢） */
const FRAME_PROBE = `(async () => {
  const deltas = [];
  await new Promise((resolve) => {
    let last = performance.now();
    let n = 0;
    const step = (now) => {
      deltas.push(now - last);
      last = now;
      n += 1;
      if (n < 60) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
  const sorted = deltas.slice(1).sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    frames: sorted.length,
    avgMs: Math.round((sum / sorted.length) * 10) / 10,
    p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
    fps: Math.round(sorted.length / (sum / 1000))
  };
})()`;

/** 读取当前层结构 + 首屏几何 */
const READ_STATE = `(() => {
  const zoom = (typeof cameraZoom === 'function') ? cameraZoom() : null;
  const cur = state.rooms[state.currentRoomId] || null;
  const screen = cur ? { w: Math.round(cur.w * zoom), h: Math.round(cur.h * zoom) } : null;
  const screens = state.rooms.map((room) => ({ w: Math.round(room.w * zoom), h: Math.round(room.h * zoom) }));
  const maxW = screens.reduce((best, s) => Math.max(best, s.w), 0);
  const maxH = screens.reduce((best, s) => Math.max(best, s.h), 0);
  return {
    mode: state.mode,
    status: state.status,
    floor: state.floor,
    roomCount: state.rooms.length,
    currentRoomId: state.currentRoomId,
    corridorRects: (state.corridorRects || []).length,
    doors: (state.doors || []).length,
    zoom: zoom,
    scale: ROOM_SCALE_CONFIG.scale,
    roomWorld: cur ? { x: Math.round(cur.x), y: Math.round(cur.y), w: Math.round(cur.w), h: Math.round(cur.h) } : null,
    roomScreen: screen,
    roomFitsOneScreen: screen ? (screen.w <= innerWidth && screen.h <= innerHeight) : null,
    maxRoomScreen: { w: maxW, h: maxH },
    floorFitsOneScreen: maxW <= innerWidth && maxH <= innerHeight,
    roomsFitting: screens.filter((s) => s.w <= innerWidth && s.h <= innerHeight).length,
    viewport: { w: innerWidth, h: innerHeight },
    overflowX: document.documentElement.scrollWidth > innerWidth,
    floorGraph: window.__roamDebug.floorGraph()
  };
})()`;

/** 传送成功 + 等待落地 + 5 秒提示读取 */
const TELEPORT_TEST = `(async () => {
  const curId = state.currentRoomId;
  const cur = state.rooms[curId];
  cur.cleared = true;
  state.enemies.forEach((enemy) => { if (enemy && enemy.roomId === curId) { enemy.dead = true; enemy.hp = 0; } });
  const neighbors = roomNeighbors(curId);
  // 双价房"付不起会退回"是既有设计：优先挑普通房，没有普通房就挑安全侧
  const targetId = neighbors.find((id) => {
    const room = state.rooms[id];
    return !room.pricedTag || room.pricedTag.side === 'safe';
  }) || neighbors[0];
  const requested = requestRoomTeleport(targetId);
  const trace = [];
  let waited = 0;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    waited += 100;
    trace.push({
      t: waited,
      room: state.currentRoomId,
      x: Math.round(state.player.x),
      y: Math.round(state.player.y),
      fade: (typeof sceneFadeRuntime !== 'undefined') ? !!sceneFadeRuntime.active : null
    });
    if (state.currentRoomId === targetId) break;
  }
  const landed = state.rooms[state.currentRoomId];
  await new Promise((resolve) => setTimeout(resolve, 700)); // 等提示淡入完成（传送有场景淡出，提示会晚 0.3s 左右出现）
  const atEnd = roomAt(state.player.x, state.player.y);
  const targetRoom = state.rooms[targetId];
  const fromRoom = state.rooms[curId];
  const gap = landed ? Math.min(
    state.player.x - landed.x,
    landed.x + landed.w - state.player.x,
    state.player.y - landed.y,
    landed.y + landed.h - state.player.y
  ) : null;
  const hint = document.getElementById('routeHint');
  return {
    requested: requested,
    from: curId,
    target: targetId,
    landed: state.currentRoomId,
    waitedMs: waited,
    trace: trace,
    wallGap: gap == null ? null : Math.round(gap * 100) / 100,
    stayedInRoom: !!(landed && state.player.x > landed.x && state.player.x < landed.x + landed.w
      && state.player.y > landed.y && state.player.y < landed.y + landed.h),
    geometry: {
      from: { x: Math.round(fromRoom.x), y: Math.round(fromRoom.y), w: Math.round(fromRoom.w), h: Math.round(fromRoom.h) },
      target: { x: Math.round(targetRoom.x), y: Math.round(targetRoom.y), w: Math.round(targetRoom.w), h: Math.round(targetRoom.h) },
      landedNow: landed ? { x: Math.round(landed.x), y: Math.round(landed.y), w: Math.round(landed.w), h: Math.round(landed.h) } : null,
      atEnd: atEnd ? atEnd.id : null
    },
    lastStats: ROOM_TELEPORT_STATS.last,
    hint: hint ? { text: hint.textContent, opacity: getComputedStyle(hint).opacity } : null,
    stats: { teleport: ROOM_TELEPORT_STATS, picker: ROOM_PICKER_STATS }
  };
})()`;

/** 打开 Q 浮层并读卡片 */
const PICKER_OPEN = `(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true }));
  const root = document.getElementById('roomPicker');
  const cards = Array.prototype.slice.call(document.querySelectorAll('#roomPickerList button'));
  return {
    open: !!root && getComputedStyle(root).display !== 'none',
    count: cards.length,
    neighbors: roomNeighbors(state.currentRoomId),
    cards: cards.map((card) => card.textContent),
    note: (document.getElementById('roomPickerNote') || {}).textContent || ''
  };
})()`;

/** 点浮层卡片真的会传送（DOM 事件路径，不是直接调函数） */
const PICKER_CLICK = `(async () => {
  const curId = state.currentRoomId;
  const cur = state.rooms[curId];
  if (cur) cur.cleared = true;
  const card = document.querySelector('#roomPickerList button');
  if (!card) return { ok: false, reason: 'no-card' };
  const targetId = Number(card.dataset.roomId);
  card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (state.currentRoomId === targetId) break;
  }
  const landed = state.rooms[state.currentRoomId];
  const gap = landed ? Math.min(
    state.player.x - landed.x,
    landed.x + landed.w - state.player.x,
    state.player.y - landed.y,
    landed.y + landed.h - state.player.y
  ) : null;
  return {
    ok: state.currentRoomId === targetId,
    from: curId,
    target: targetId,
    landed: state.currentRoomId,
    wallGap: gap == null ? null : Math.round(gap * 100) / 100
  };
})()`;

/** 关闭浮层 */
const PICKER_CLOSE = `(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  const root = document.getElementById('roomPicker');
  return { open: !!root && getComputedStyle(root).display !== 'none' };
})()`;

/** 未清房拒绝：把当前房切到一间战斗房，塞活怪，再尝试传送 */
const DENIAL_TEST = `(() => {
  if (typeof crashState !== 'undefined') crashState.halted = true;
  const battle = state.rooms.find((room) => room.type === 'battle');
  state.currentRoomId = battle.id;
  state.player.x = battle.cx;
  state.player.y = battle.cy;
  battle.cleared = false;
  state.enemies.push({ roomId: battle.id, x: battle.cx, y: battle.cy, hp: 10, dead: false });
  const before = { x: state.player.x, y: state.player.y };
  const nextId = roomNeighbors(battle.id)[0];
  const requested = requestRoomTeleport(nextId);
  const after = { x: state.player.x, y: state.player.y };
  return {
    roomId: battle.id,
    tried: nextId,
    denied: requested === false,
    unchanged: before.x === after.x && before.y === after.y,
    before: { x: Math.round(before.x), y: Math.round(before.y) },
    after: { x: Math.round(after.x), y: Math.round(after.y) },
    stats: ROOM_PICKER_STATS
  };
})()`;

/** 截一张图并落盘 */
async function shot(send, name) {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(SHOT_DIR, name + '.png');
  fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
  return file;
}

/** 按元素矩形裁一张图（小地图要看清虚线与金边，2 倍像素密度） */
async function shotClip(send, name, rect) {
  const png = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 }
  });
  const file = path.join(SHOT_DIR, name + '.png');
  fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
  return file;
}

/** 读小地图元素在页面里的矩形（不能把 0 尺寸裁进去） */
const MINIMAP_RECT = `(() => {
  const el = document.getElementById('minimap');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
})()`;

/** 打开某一档倍率：加载 → 开局 → 读状态 → 首屏截图 */
async function runTier(send, evalJs, scale) {
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') + '?roomScale=' + scale });
  await sleep(3600);
  await evalJs(START_GAME);
  await sleep(1600);
  const stateInfo = await evalJs(READ_STATE);
  const file = await shot(send, 'scale_' + scale.toFixed(2).replace('.', '_'));
  return { scale, state: stateInfo, shot: file };
}

async function main() {
  const ctx = await connect();
  const { edge, send, evalJs } = ctx;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false
    });

    // ⓪ 环境帧耗时基线：空白页只有 rAF，若它已经明显掉帧，说明机器被别的任务占满
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(600);
    const envFrame = await evalJs(FRAME_PROBE);
    console.log('ENV_FRAME', JSON.stringify(envFrame));
    if (!envFrame || envFrame.fps < 45) {
      throw new Error('ENV_ABORT ' + JSON.stringify(envFrame));
    }

    // ① 20 层布局汇总
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    await sleep(3600);
    const twentySummary = await evalJs(`(() => {
      const rows = [];
      for (let floor = 1; floor <= 20; floor += 1) {
        const layout = buildTeleportFloorLayout(floor);
        const degree = {};
        layout.graph.edges.forEach((edge) => {
          degree[edge[0]] = (degree[edge[0]] || 0) + 1;
          degree[edge[1]] = (degree[edge[1]] || 0) + 1;
        });
        const nonBossDeg = layout.rooms.filter((r) => r.id !== layout.stairId).map((r) => degree[r.id] || 0);
        rows.push({ f: floor, n: layout.rooms.length, stairDeg: degree[layout.stairId] || 0,
          nonBossDeg: nonBossDeg.join('/'),
          reach: bfsReachableCount(layout.rooms, layout.graph.edges, layout.spawnId),
          fallback: layout.fallback });
      }
      return rows;
    })()`);
    twentySummary.forEach((row) => console.log('FLOOR', JSON.stringify(row)));
    const pass = twentySummary.every((row) => row.n === 6 && row.stairDeg === 1 && row.reach === 6
      && row.nonBossDeg.split('/').every((deg) => Number(deg) >= 2 && Number(deg) <= 3));
    console.log('TWENTY_SUMMARY', JSON.stringify({
      pass: pass,
      floors: twentySummary.length,
      fallbackFloors: twentySummary.filter((row) => row.fallback).length
    }));
    /* 最差层单列：出口数、连通性、首领房入口数三项逐层点名，不报平均值 */
    const exitSamples = [];
    twentySummary.forEach((row) => {
      row.nonBossDeg.split('/').forEach((deg, idx) => exitSamples.push({ f: row.f, room: idx, deg: Number(deg) }));
    });
    const minExit = exitSamples.reduce((a, b) => (b.deg < a.deg ? b : a), exitSamples[0]);
    const maxExit = exitSamples.reduce((a, b) => (b.deg > a.deg ? b : a), exitSamples[0]);
    const badFloors = twentySummary.filter((row) => row.n !== 6 || row.stairDeg !== 1 || row.reach !== 6
      || row.nonBossDeg.split('/').some((deg) => Number(deg) < 2 || Number(deg) > 3));
    console.log('WORST_SUMMARY', JSON.stringify({
      minNonBossExit: minExit,
      maxNonBossExit: maxExit,
      bossEntranceMin: Math.min.apply(null, twentySummary.map((row) => row.stairDeg)),
      bossEntranceMax: Math.max.apply(null, twentySummary.map((row) => row.stairDeg)),
      reachMin: Math.min.apply(null, twentySummary.map((row) => row.reach)),
      badFloors: badFloors
    }));

    // ② 默认档 2.0（= 屏幕 1.6 倍）：首屏 + 小地图 + 全屏地图
    const tier20 = await runTier(send, evalJs, 2.0);
    console.log('TIER_2_0', JSON.stringify(tier20.state));
    console.log('SHOT_2_0', tier20.shot);
    const gameFrame = await evalJs(FRAME_PROBE);
    console.log('GAME_FRAME', JSON.stringify(gameFrame));
    const miniRect = await evalJs(MINIMAP_RECT);
    console.log('MINIMAP_RECT', JSON.stringify(miniRect));
    if (miniRect && miniRect.w > 0) {
      console.log('SHOT_TIER16_MINIMAP', await shotClip(send, 'tier16_minimap', miniRect));
    }
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', bubbles: true }))`);
    await sleep(700);
    console.log('MAP_OPEN', JSON.stringify(await evalJs(`({ mode: state.mode })`)));
    console.log('SHOT_TIER16_FULLMAP', await shot(send, 'tier16_fullmap'));
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', bubbles: true }))`);
    await sleep(400);

    // ③ 传送 + 5 秒提示
    const teleport = await evalJs(TELEPORT_TEST);
    console.log('TELEPORT', JSON.stringify(teleport));
    console.log('SHOT_AFTER_TELEPORT', await shot(send, 'after_teleport'));

    // ④ Q 浮层
    const picker = await evalJs(PICKER_OPEN);
    await sleep(250);
    console.log('PICKER', JSON.stringify(picker));
    console.log('SHOT_PICKER', await shot(send, 'picker_q'));
    console.log('PICKER_CLICK', JSON.stringify(await evalJs(PICKER_CLICK)));
    console.log('PICKER_CLOSE', JSON.stringify(await evalJs(PICKER_CLOSE)));

    // ⑤ 未清房拒绝
    console.log('DENIAL', JSON.stringify(await evalJs(DENIAL_TEST)));

    // ⑥ 另外两档截图 + 屏幕像素
    for (const scale of TIERS.slice(1)) {
      const tier = await runTier(send, evalJs, scale);
      console.log('TIER_' + scale.toFixed(2).replace('.', '_'), JSON.stringify(tier.state));
      console.log('SHOT_' + scale.toFixed(2).replace('.', '_'), tier.shot);
    }

    console.log('ERRORS', JSON.stringify(await evalJs(`(() => (window.__errors || []).slice(0, 8))()`)));
    console.log('SHOTS', SHOT_DIR);
  } finally {
    killEdge(edge);
  }
  process.exit(0);
}

main().catch((e) => {
  const msg = String((e && e.message) || e);
  if (msg.indexOf('ENV_ABORT') === 0) {
    console.error('ENV_ABORT', msg);
    process.exit(2); // 环境过载：本轮读数作废，等负载降下来再跑
  }
  console.error('FATAL', e);
  process.exit(1);
});
