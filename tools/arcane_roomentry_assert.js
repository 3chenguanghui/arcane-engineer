/**
 * R1 门禁回归断言 + 连续帧取证
 * ------------------------------------------------------------
 * 验证"房间进入是一次真实决策"这一批改动：
 *   A. requireConfirm=false（旧行为）：一直走向门 → 自动被带进下一间；
 *   B. requireConfirm=true（新行为）：一直走向门 → 停在门线，房间号不变；
 *      按 E → 放行 → 走进下一间。
 * 产出：.screenshots/roomentry2/ 下的连续帧 + roomentry-assert.json
 * 用法：node tools/arcane_roomentry_assert.js [--seed=261108]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9532;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'roomentry2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析命令行参数
 * @returns {{seed:string}} 种子字符串
 */
function parseArgs() {
  const hit = process.argv.slice(2).find((x) => x.startsWith('--seed='));
  return { seed: hit ? hit.slice(7) : '261108' };
}

/**
 * 启动无头 Edge 并连上 CDP
 * @returns {Promise<Object>} 求值 / 截图 / 关闭
 */
async function boot() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile(PORT);
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(proc); throw new Error('Edge 调试端口未就绪'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  for (let i = 0; i < 120; i += 1) {
    await sleep(250);
    try { if (await ev(`typeof state !== 'undefined'`)) break; } catch (e) { /* 解析中 */ }
  }
  const close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } killEdge(proc); };
  return { ev, shot, close };
}

/**
 * 把玩家摆到"门内侧 220px、与门对齐"的位置，并清空放行窗口
 * @param {Object} h CDP 句柄
 * @param {string} dir 前进方向 right/left/up/down
 * @returns {Promise<Object>} 场景信息
 */
async function resetAtDoor(h, dir) {
  return h.ev(`(function(){
    var sr = state.rooms[state.spawnRoomId];
    var d = (state.doors || []).find(function(x){ return x.roomId === sr.id && x.targetRoomId >= 0; });
    if (!d) return null;
    var back = { right: [-1, 0], left: [1, 0], top: [0, 1], bottom: [0, -1] }[d.side] || [-1, 0];
    /* 起始退距不能写死 220：房内有立柱/长桌时，220px 处可能正好落在障碍后面，
       玩家一按方向键就被挡住（表现为"原地不动/反向外推"）。这里从远到近挑一条
       整条直线都可站的退距（沿线取 9 个采样点），保证真的能走到门线。 */
    var offs = [220, 170, 120, 80, 50];
    var off = offs[offs.length - 1];
    for (var oi = 0; oi < offs.length; oi += 1) {
      var clear = true;
      for (var t = 0.2; t <= 0.91; t += 0.1) {
        var px = d.x + back[0] * offs[oi] * t;
        var py = d.y + back[1] * offs[oi] * t;
        if (!isWalkableCircle(px, py, state.player.radius)) { clear = false; break; }
      }
      if (clear) { off = offs[oi]; break; }
    }
    state.player.x = d.x + back[0] * off;
    state.player.y = d.y + back[1] * off;
    state.player.vx = 0; state.player.vy = 0;
    state.currentRoomId = sr.id;
    state.roomEntry = { lastRoomId: sr.id, armedUntil: 0, armedRoomId: -1 };
    state.mode = 'playing'; state.status = 'playing';
    state.keys.right = false; state.keys.left = false; state.keys.up = false; state.keys.down = false;
    return {
      roomId: sr.id, targetRoomId: d.targetRoomId, side: d.side,
      /* 实际要按的方向键：back 是"从门指向房内"的反方向（玩家站位偏移），
         所以玩家在门的左/右/下/上时，按键要与偏移相反：左→右、右→左、下→上、上→下。 */
      key: back[0] === -1 ? 'right' : back[0] === 1 ? 'left' : back[1] === 1 ? 'up' : 'down',
      door: { x: Math.round(d.x), y: Math.round(d.y) },
      start: { x: Math.round(state.player.x), y: Math.round(state.player.y) },
      dir: d.side,
      doorUnknown: (function(){ var v = doorVisFor(d); return v ? v.unknown : null; })(),
      doorLabel: (function(){ var v = doorVisFor(d); return v ? v.label : null; })()
    };
  })()`);
}

/**
 * 采样一次当前状态
 * @param {Object} h CDP 句柄
 * @returns {Promise<Object>} 房间号 / 位置 / 到门距离 / 是否放行
 */
async function sample(h) {
  return h.ev(`(function(){
    var sr = state.rooms[state.spawnRoomId];
    var d = (state.doors || []).find(function(x){ return x.roomId === sr.id && x.targetRoomId >= 0; });
    var re = state.roomEntry || {};
    return {
      roomId: state.currentRoomId,
      player: { x: Math.round(state.player.x), y: Math.round(state.player.y) },
      distToDoor: d ? Math.round(Math.hypot(d.x - state.player.x, d.y - state.player.y)) : null,
      armed: !!re.armedUntil && state.elapsed < re.armedUntil,
      elapsed: Math.round(state.elapsed * 100) / 100,
      doorInfo: d ? (function(){ var i = doorInfoFor(d); return i ? (i.unknown ? '未知' : i.typeName + '·' + i.riskLabel) : null; })() : null,
      stats: { plates: DOOR_VIS_STATS.plates, unknownPlates: DOOR_VIS_STATS.unknownPlates, hints: DOOR_VIS_STATS.hints, nearLabels: DOOR_INFO_STATS.labels }
    };
  })()`);
}

/**
 * 重载页面并用固定种子重新开局（A/B 两段互不污染：上一段进房会落闸）
 * @param {Object} h CDP 句柄
 * @param {string} seed 种子
 * @returns {Promise<void>}
 */
async function fresh(h, seed) {
  await h.ev(`location.reload(); true`);
  for (let i = 0; i < 120; i += 1) {
    await sleep(250);
    try {
      if (await h.ev(`typeof state !== 'undefined' && typeof ROOM_ENTRY !== 'undefined'`)) break;
    } catch (e) { /* 重载中 */ }
  }
  await h.ev(`window.__roamDebug.p2.startSeed('${seed}')`);
  await sleep(700);
}

async function main() {
  const { seed } = parseArgs();
  const h = await boot();
  const out = { seed, before: [], after: [], steps: {}, checks: [] };
  const check = (name, ok, detail) => {
    out.checks.push({ name, ok: !!ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
  };
  try {
    await fresh(h, seed);

    // ================= A. 旧行为（requireConfirm = false） =================
    await h.ev(`ROOM_ENTRY.requireConfirm = false; true`);
    const scene = await resetAtDoor(h, 'right');
    out.scene = scene;
    check('起始房与门信息可读（房心即可读出房型）', scene && scene.doorUnknown === false, scene && { label: scene.doorLabel });

    /* 按键方向必须由"门所在墙"反算成 keys 的真实键名（up/down/left/right）；
       旧版直接用 d.side（top/bottom），门在上下墙时按的是不存在的 keys.top，玩家原地不动。 */
    const dirKey = scene.key;
    await h.ev(`state.keys.${dirKey} = true; true`);
    const timeline = [0, 300, 700, 1200, 2000];
    let prev = 0;
    for (let i = 0; i < timeline.length; i += 1) {
      await sleep(timeline[i] - prev);
      prev = timeline[i];
      out.before.push(await sample(h));
      await h.shot('10-before-' + String(i).padStart(2, '0') + '-' + timeline[i] + 'ms.png');
    }
    await h.ev(`state.keys.${dirKey} = false; true`);
    const beforeIn = out.before[out.before.length - 1].roomId === scene.targetRoomId;
    check('旧行为：不按 E，2000ms 内自动进入下一间', beforeIn, { roomId: out.before[out.before.length - 1].roomId, target: scene.targetRoomId });
    out.steps.before = { keys: ['朝向门持续移动'], ePresses: 0, autoAdvance: '跨过门线即换房' };

    // ================= B. 新行为（requireConfirm = true，重新开局） =================
    await fresh(h, seed);
    await h.ev(`ROOM_ENTRY.requireConfirm = true; true`);
    /* 先拍"真实房心"（种子 261108 实测 388px），验证房心也能读到简化版 */
    out.center = await h.ev(`(function(){
      var sr = state.rooms[state.spawnRoomId];
      state.player.x = sr.cx; state.player.y = sr.cy;
      state.player.vx = 0; state.player.vy = 0;
      state.currentRoomId = sr.id;
      state.roomEntry = { lastRoomId: sr.id, armedUntil: 0, armedRoomId: -1 };
      return { cx: Math.round(sr.cx), cy: Math.round(sr.cy) };
    })()`);
    await sleep(400);
    await h.shot('18-after-room-center.png');
    out.diag = await h.ev(`(function(){
      var dom = [];
      document.querySelectorAll('body *').forEach(function(el){
        if (el.children.length) return;
        var t = (el.textContent || '').trim();
        if (t.indexOf('进入') < 0) return;
        var r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        dom.push({ tag: el.tagName, id: el.id || '', cls: el.className || '', text: t.slice(0, 20), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
      });
      return { touch: (typeof touchCapable === 'function' ? touchCapable() : null), enterHint: DOOR_VIS_CONFIG.enterHint, domEnter: dom };
    })()`);
    out.centerInfo = await h.ev(`(function(){
      var sr = state.rooms[state.spawnRoomId];
      var d = (state.doors || []).find(function(x){ return x.roomId === sr.id && x.targetRoomId >= 0; });
      var v = d ? doorVisFor(d) : null;
      return {
        distFromCenter: d ? Math.round(Math.hypot(d.x - sr.cx, d.y - sr.cy)) : null,
        unknown: v ? v.unknown : null, label: v ? v.label : null,
        plateLabels: DOOR_VIS_STATS.labels, infoLabels: DOOR_INFO_STATS.labels
      };
    })()`);
    const scene2 = await resetAtDoor(h, 'right');
    out.scene2 = scene2;
    /* B 段重新定位后，用这一段的门重新算键名，避免 A/B 两段的门不同导致按错方向 */
    const dirKey2 = scene2.key;
    await h.ev(`state.keys.${dirKey2} = true; true`);
    // B1：走到被门线挡住
    const b1 = [0, 400, 900, 1600, 2400];
    prev = 0;
    for (let i = 0; i < b1.length; i += 1) {
      await sleep(b1[i] - prev);
      prev = b1[i];
      out.after.push(await sample(h));
      await h.shot('20-after-' + String(i).padStart(2, '0') + '-walk-' + b1[i] + 'ms.png');
    }
    const blocked = out.after[out.after.length - 1];
    check('新行为：一直走向门被挡在门线，房间号不变',
      blocked.roomId === scene2.roomId && blocked.distToDoor >= 12,
      { roomId: blocked.roomId, distToDoor: blocked.distToDoor });

    // B2：按 E → 继续走 → 进入下一间（连拍 4 帧）
    await h.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', bubbles: true })); true`);
    const armed = await sample(h);
    check('按 E 后进入放行窗口', armed.armed === true, { armed: armed.armed });
    const b2 = [150, 400, 900, 1500, 2400];
    prev = 0;
    for (let i = 0; i < b2.length; i += 1) {
      await sleep(b2[i] - prev);
      prev = b2[i];
      out.after.push(await sample(h));
      await h.shot('21-after-' + String(i).padStart(2, '0') + '-enter-' + b2[i] + 'ms.png');
    }
    await h.ev(`state.keys.${dirKey2} = false; true`);
    const entered = out.after[out.after.length - 1];
    check('按 E 后 2400ms 内进入下一间', entered.roomId === scene2.targetRoomId,
      { roomId: entered.roomId, target: scene2.targetRoomId, distToDoor: entered.distToDoor });
    out.steps.after = { keys: ['朝向门持续移动', '停在门线', '按 E 一次'], ePresses: 1, autoAdvance: '窗口 3.0s 内穿过走廊，进房即关窗' };

    // ================= C. 站在门线上不被卷进去（贴门 20px 不动） =================
    const hold = await h.ev(`(function(){
      state.roomEntry = { lastRoomId: state.rooms[state.spawnRoomId].id, armedUntil: 0, armedRoomId: -1 };
      var sr = state.rooms[state.spawnRoomId];
      var d = (state.doors || []).find(function(x){ return x.roomId === sr.id && x.targetRoomId >= 0; });
      var back = { right: [-1, 0], left: [1, 0], top: [0, 1], bottom: [0, -1] }[d.side] || [-1, 0];
      state.player.x = d.x + back[0] * 20;
      state.player.y = d.y + back[1] * 20;
      state.currentRoomId = sr.id;
      state.keys.right = false; state.keys.left = false; state.keys.up = false; state.keys.down = false;
      return true;
    })()`);
    await sleep(700);
    const held = await sample(h);
    check('站在门线上（20px）不会被卷入下一间', hold && held.roomId === scene2.roomId, { roomId: held.roomId, distToDoor: held.distToDoor });

    // ============ D. autoAdvance：按住 E 不放，连续跨门（默认关，这里显式打开） ============
    await fresh(h, seed);
    await h.ev(`ROOM_ENTRY.requireConfirm = true; ROOM_ENTRY.autoAdvance = true; true`);
    // 真实 keydown 一次，全程不 keyup：模拟"按住 E"
    await h.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', bubbles: true })); true`);
    const dScene = await resetAtDoor(h, 'right');
    if (dScene) {
      await h.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', bubbles: true })); true`);
      await h.ev(`state.keys.${dScene.key} = true; true`);
      await sleep(2400);
      await h.ev(`state.keys.${dScene.key} = false; true`);
      const hop1 = await sample(h);
      check('autoAdvance：按住 E 走第一扇门（不再按第二次）进入相邻房',
        hop1.roomId === dScene.targetRoomId, { roomId: hop1.roomId, target: dScene.targetRoomId });

      // 在第二间房里换到"另一扇门"，E 仍然按着，看它是否自动续窗口
      const hop2Scene = await h.ev(`(function(){
        var rid = state.currentRoomId;
        var r = state.rooms[rid];
        if (!r) return null;
        /* 战斗房进门会落闸，第二扇门按设计就是关着的——这里只测"门禁"，
           所以先把这间标成已清并开门，否则测的是落闸而不是按 E 连续跨门 */
        r.cleared = true; r.locked = false;
        (state.doors || []).forEach(function(x){ if (x.roomId === rid) { x.closed = false; x.anim = 0; } });
        var d = (state.doors || []).find(function(x){
          return x.roomId === rid && x.targetRoomId >= 0 && x.targetRoomId !== ${dScene.roomId};
        });
        if (!d) return null;
        /* 摆位按门的朝向走：门在哪面墙，就从那面墙往房内退 off 距离，
           再沿同一根轴走回去——避免"斜着走"串到别的房间 */
        var nx = 0, ny = 0, maxOff = 0, key = 'right';
        if (d.side === 'right') { nx = -1; ny = 0; maxOff = d.x - r.x; key = 'right'; }
        else if (d.side === 'left') { nx = 1; ny = 0; maxOff = r.x + r.w - d.x; key = 'left'; }
        else if (d.side === 'top') { nx = 0; ny = 1; maxOff = r.y + r.h - d.y; key = 'up'; }
        else { nx = 0; ny = -1; maxOff = d.y - r.y; key = 'down'; }
        var off = Math.max(20, Math.min(200, maxOff - 40));
        state.player.x = d.x + nx * off;
        state.player.y = d.y + ny * off;
        state.player.vx = 0; state.player.vy = 0;
        state.keys.right = false; state.keys.left = false; state.keys.up = false; state.keys.down = false;
        return { roomId: rid, targetRoomId: d.targetRoomId, side: d.side, off: Math.round(off), key: key };
      })()`);
      if (hop2Scene) {
        await sleep(300);
        const armed2 = await sample(h);
        await h.ev(`state.keys.${hop2Scene.key} = true; true`);
        await sleep(2400);
        await h.ev(`state.keys.${hop2Scene.key} = false; true`);
        const hop3 = await sample(h);
        /* 走廊不一定正直通向"那扇门的目标房"（可能先串到同排另一间），
           这条只验证"没再按 E 也跨过了门线"，不去赌走廊的几何形状 */
        check('autoAdvance：第二扇门也没再按 E，自动续窗口并跨过门线',
          armed2.armed === true && hop3.roomId !== hop2Scene.roomId,
          { armedWhenHeld: armed2.armed, roomId: hop3.roomId, from: hop2Scene.roomId, target: hop2Scene.targetRoomId, key: hop2Scene.key });
      }
    }
    await h.ev(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'e', code: 'KeyE', bubbles: true })); true`);
    await h.ev(`ROOM_ENTRY.autoAdvance = false; true`);

    out.fps = await h.ev(`(function(){
      return new Promise(function(resolve){
        var n = 0, t0 = performance.now();
        function tick(){ n += 1; if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
          else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
        requestAnimationFrame(tick);
      });
    })()`);
  } finally {
    h.close();
  }
  fs.writeFileSync(path.join(OUT_DIR, 'roomentry-assert.json'), JSON.stringify(out, null, 2));
  console.log('\nfps=' + out.fps + '  截图目录：' + OUT_DIR);
}

main().catch((e) => { console.error(e); process.exit(1); });
