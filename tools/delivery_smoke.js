/**
 * 交付件冒烟（只对 delivery 里的成品文件跑，不碰主文件）
 * ------------------------------------------------------------
 * 四项验收：
 *   1) 开局：加载交付件 → 点"开始" → 进入 playing
 *   2) 走位：按住 W/D 后玩家坐标发生位移
 *   3) Q 选房 → 点卡片传送 → 换了房，落点离墙 100 左右
 *   4) 按 M 打开全屏地图（state.mode === 'map'）→ 截图
 * 用法：node tools/delivery_smoke.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
process.env.ARCANE_PROFILE_ROOT = path.join(__dirname, '..', '.testprofile', 'smoke-' + Date.now());
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9900 + Math.floor(Math.random() * 99);
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'delivery', '烬-奥术工程师-试玩版.html');
const SHOT_DIR = path.join(ROOT, '.screenshots', 'delivery_smoke');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 启动无头 Edge 并连上 CDP */
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
    '--window-size=1707,930',
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

/** 读基础状态：模式、当前房、玩家坐标、房间数 */
const READ_BASE = `(() => {
  const cur = state.rooms[state.currentRoomId] || null;
  return {
    mode: state.mode,
    file: location.pathname.split('/').pop(),
    currentRoomId: state.currentRoomId,
    roomCount: state.rooms.length,
    player: { x: Math.round(state.player.x), y: Math.round(state.player.y) },
    room: cur ? { id: cur.id, w: cur.w, h: cur.h } : null
  };
})()`;

/** 模拟按键（keydown/keyup 都发，用真实 DOM 事件路径） */
const holdKey = (key, code, ms) => `(async () => {
  const down = new KeyboardEvent('keydown', { key: '${key}', code: '${code}', bubbles: true });
  const up = new KeyboardEvent('keyup', { key: '${key}', code: '${code}', bubbles: true });
  window.dispatchEvent(down);
  await new Promise((r) => setTimeout(r, ${ms}));
  window.dispatchEvent(up);
  await new Promise((r) => setTimeout(r, 150));
  return { x: Math.round(state.player.x), y: Math.round(state.player.y) };
})()`;

/** 打开 Q 选房浮层（冒烟不打架：把当前房标记为已清，才能走传送路径） */
const OPEN_PICKER = `(async () => {
  const cur = state.rooms[state.currentRoomId];
  const forcedClear = !cur.cleared;
  if (forcedClear) cur.cleared = true;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const cards = Array.from(document.querySelectorAll('#roomPickerList button'));
  return {
    open: !!document.querySelector('#roomPicker') && document.querySelector('#roomPicker').style.display !== 'none',
    forcedClear: forcedClear,
    count: cards.length,
    cards: cards.map((c) => c.textContent.replace(/\\s+/g, ' ').trim())
  };
})()`;

/** 点第一张卡片，轮询换房结果并量落点离墙距离 */
const CLICK_CARD = `(async () => {
  const from = state.currentRoomId;
  const all = Array.from(document.querySelectorAll('#roomPickerList button'));
  if (!all.length) return { ok: false, reason: 'no-card' };
  /* 冒烟不打架也不付代价：优先挑"安全侧/普通"的卡，避开"代价：余烬"这种需要资源的门 */
  const card = all.find((c) => !/代价/.test(c.textContent)) || all[0];
  const target = Number(card.dataset.roomId);
  card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    if (state.currentRoomId === target) break;
  }
  await new Promise((r) => setTimeout(r, 400));
  const landed = state.rooms[state.currentRoomId];
  const gap = landed ? Math.min(
    state.player.x - landed.x,
    landed.x + landed.w - state.player.x,
    state.player.y - landed.y,
    landed.y + landed.h - state.player.y
  ) : null;
  return {
    ok: state.currentRoomId === target,
    from: from,
    target: target,
    pickedCard: card.textContent.replace(/\\s+/g, ' ').trim(),
    landed: state.currentRoomId,
    wallGap: gap == null ? null : Math.round(gap * 10) / 10,
    player: { x: Math.round(state.player.x), y: Math.round(state.player.y) }
  };
})()`;

async function main() {
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const { edge, send, evalJs } = await connect();
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1707, height: 930, deviceScaleFactor: 1, mobile: false
    });
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    await sleep(3600);
    await evalJs(START_GAME);
    await sleep(1800);

    const started = await evalJs(READ_BASE);
    console.log('STEP1_START', JSON.stringify({ pass: started.mode === 'playing' && started.roomCount === 6, ...started }));

    const before = started.player;
    await evalJs(holdKey('w', 'KeyW', 500));
    const afterW = await evalJs(holdKey('d', 'KeyD', 500));
    const moved = Math.abs(afterW.x - before.x) + Math.abs(afterW.y - before.y);
    console.log('STEP2_WALK', JSON.stringify({ pass: moved >= 5, before: before, after: afterW, movedPx: moved }));

    const picker = await evalJs(OPEN_PICKER);
    console.log('STEP3A_PICKER', JSON.stringify(picker));
    const tele = await evalJs(CLICK_CARD);
    const gapOk = tele.wallGap != null && tele.wallGap >= 95 && tele.wallGap <= 145;
    console.log('STEP3B_TELEPORT', JSON.stringify({ pass: tele.ok && gapOk, ...tele }));

    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', bubbles: true }))`);
    await sleep(700);
    const mapState = await evalJs(`(() => ({ mode: state.mode }))()`);
    const png = await send('Page.captureScreenshot', { format: 'png' });
    const shot = path.join(SHOT_DIR, 'delivery_fullmap.png');
    fs.writeFileSync(shot, Buffer.from(png.data, 'base64'));
    console.log('STEP4_FULLMAP', JSON.stringify({ pass: mapState.mode === 'map', ...mapState, shot: shot }));
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', bubbles: true }))`);
    await sleep(300);
  } finally {
    killEdge(edge);
  }
}

main().catch((e) => { console.error('SMOKE_FATAL', e); process.exit(1); });
