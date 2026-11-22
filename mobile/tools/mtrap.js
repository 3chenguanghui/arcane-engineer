/**
 * 门前卡点定性探针（mtrap.js）
 * ------------------------------------------------------------
 * 目的：判定"人停在 2 号房右门前 37px、门 closed=false / anim=0 却过不去"
 *       到底是测试脚本的走位问题，还是游戏里真有看不见的碰撞体。
 * 做法（三条互相独立的证据）：
 *   ① 直接调用游戏的碰撞判定函数 roomEntryBlocksMove / doorEntryArmed，
 *      读同一位置下"朝门心 / 垂直于门穿过 / 远离门"三个方向的返回值；
 *   ② 冻结 rAF 后按帧推进：持续朝门心推 1 秒，记录每 0.1 秒的位移与门距，
 *      看距离是否真的一点都不降（真墙才完全不降）；
 *   ③ 换方向绕行 + 真实触摸"交互键"：看点按交互键能不能放行（armedUntil 变不变），
 *      能放行后改走"垂直于门穿过去"能不能真的换房。
 * 注意：探针只读游戏逻辑，唯一的写操作是"把角色摆到门前 + 清掉当前层敌人"
 *       （排除战斗干扰），不改游戏代码、不改主文件。
 * 用法：node mobile/tools/mtrap.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { prepareProfile, killEdge } = require(path.join(__dirname, '..', '..', 'tools', 'arcane_profile'));

const ROOT = path.join(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'mobile', 'index_arcane_v2_mobile.html');
const OUT_DIR = path.join(ROOT, 'mobile', 'shots', 'trap_' + new Date().toISOString().replace(/\D/g, '').slice(0, 14));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9567;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动无头 Edge 并返回最小 CDP 封装
 * @returns {Promise<Object>} { send, ev, shot, close }
 */
async function bootEdge() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files', '--mute-audio',
    '--hide-scrollbars', '--window-size=900,600',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 360; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(edge); throw new Error('Edge 调试端口未就绪'); }
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
    const id = seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP 超时：' + method)); }, 45000);
    pending.set(id, (m) => {
      clearTimeout(timer);
      if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression) => {
    let lastErr = null;
    for (let k = 0; k < 3; k += 1) {
      try {
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
        return r.result.value;
      } catch (e) {
        lastErr = e;
        if (!/CDP 超时/.test(e.message)) throw e;
        await sleep(500);
      }
    }
    throw lastErr;
  };
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/** 单指触摸（失败最多重试 3 次） */
async function sendPoints(cdp, type, pts) {
  const payload = { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1, id: p.id })) };
  let lastErr = null;
  for (let k = 0; k < 3; k += 1) {
    try { await cdp.send('Input.dispatchTouchEvent', payload); return true; } catch (e) {
      lastErr = e;
      await sleep(600);
    }
  }
  console.log('  ! 触摸下发失败：' + (lastErr && lastErr.message));
  return false;
}

/** 点一下（按下 60ms 再抬起） */
async function tap(cdp, x, y) {
  await sendPoints(cdp, 'touchStart', [{ id: 1, x, y }]);
  await sleep(60);
  await sendPoints(cdp, 'touchEnd', []);
}

/** 元素矩形中心 */
const RECT_JS = (sel) => `(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();return {cx:r.left+r.width/2,cy:r.top+r.height/2,w:r.width,h:r.height};})()`;

/** 定步长 + 轴写入 + 只读采样（探针自己的最小工具集） */
const SIM = `(function(){
  window.__tRafOff = function(){ window.requestAnimationFrame = function(){ return 0; }; return true; };
  window.__tStep = function(sec){ var n=Math.max(1,Math.round(sec*60)); for(var i=0;i<n;i+=1) update(1/60); try{render();}catch(e){} return true; };
  window.__tAxis = function(x,y){ state.touch.axisX=x; state.touch.axisY=y; state.touch.moveId=(x||y)?1:null; return true; };
  window.__tPos = function(){ return {x:state.player.x,y:state.player.y,room:state.currentRoomId,mode:state.mode,hp:Math.round(state.player.hp)}; };
  window.__tDoors = function(){ return (state.doors||[]).map(function(d){return {x:d.x,y:d.y,side:d.side,roomId:d.roomId,target:d.targetRoomId,closed:!!d.closed,anim:Math.round((d.anim||0)*100)/100};}); };
  return true;
})()`;

/**
 * 主流程：摆位 → 读碰撞判定 → 按帧推 → 换向 → 真实触摸交互键 → 穿门
 */
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = { page: PAGE, pageBytes: fs.statSync(PAGE).size, steps: {}, log: [] };
  const log = (m) => { console.log(m); out.log.push(m); };
  const cdp = await bootEdge();
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenWidth: 844, screenHeight: 390,
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
    await cdp.send('Page.navigate', { url: 'file:///' + PAGE.replace(/\\/g, '/') + '?e2e=1' });
    for (let i = 0; i < 120; i += 1) {
      if (await cdp.ev(`document.readyState === 'complete' && typeof state !== 'undefined'`)) break;
      await sleep(200);
    }
    await sleep(900);
    await cdp.ev(`(document.getElementById('btnStart') || {}).click(); true`);
    await sleep(600);
    if (!(await cdp.ev(`state.mode === 'playing'`))) {
      await cdp.ev(`(function(){var c=document.querySelector('.char-card');if(c)c.click();var b=document.getElementById('btnCharConfirm');if(b)b.click();return true;})()`);
    }
    for (let i = 0; i < 80; i += 1) {
      if (await cdp.ev(`state.mode === 'playing'`)) break;
      await sleep(200);
    }
    await sleep(4200);
    await cdp.ev(SIM);
    await cdp.ev(`window.__tRafOff()`);
    await sleep(150);
    const boot0 = await cdp.ev(`({ mode: state.mode, status: state.status, floor: state.floor, elapsed: Math.round(state.elapsed*10)/10,
      rooms: (state.rooms||[]).length, corridors: (state.corridorRects||[]).length, doors: (state.doors||[]).length,
      titleHidden: !document.getElementById('titleLayer') || document.getElementById('titleLayer').classList.contains('hidden'),
      charHidden: !document.getElementById('charSelect') || document.getElementById('charSelect').classList.contains('hidden') })`);
    out.steps.boot = boot0;
    log('[启动现场] ' + JSON.stringify(boot0));

    /* ---------- 选一扇当前房间的、开着的门（优先左右侧，几何最接近事故现场） ---------- */
    const pick = await cdp.ev(`(function(){
      var s = state, cur = s.currentRoomId, best = null;
      (s.doors||[]).forEach(function(d){
        if (d.targetRoomId == null || d.targetRoomId < 0) return;
        if (d.closed || (d.anim||0) > 0.35) return;
        var score = (d.roomId === cur ? 0 : 10) + ((d.side === 'left' || d.side === 'right') ? 0 : 5);
        if (!best || score < best.score) best = { score: score, x: d.x, y: d.y, side: d.side, roomId: d.roomId, target: d.targetRoomId };
      });
      return best;
    })()`);
    if (!pick) {
      const all = await cdp.ev(`({ floor: state.floor, cur: state.currentRoomId, mode: state.mode, doors: window.__tDoors ? window.__tDoors() : [] })`);
      log('[选门失败] 现场：' + JSON.stringify(all));
      throw new Error('当前层没有可用的开着的门');
    }
    out.steps.door = pick;
    log(`[选门] ${pick.side} @(${Math.round(pick.x)},${Math.round(pick.y)}) 房#${pick.roomId} → 房#${pick.target}`);

    /* ---------- 摆位：门板中线、沿门轴偏 37px（复刻事故现场），并清场 -------------------------------------------------------------- */
    const place = await cdp.ev(`(function(){
      var d = state.doors.filter(function(x){ return Math.abs(x.x-${pick.x})<0.5 && Math.abs(x.y-${pick.y})<0.5; })[0];
      var room = state.rooms[d.roomId];
      var vertical = (d.side === 'left' || d.side === 'right');   /* 左右门：门板竖直，长轴是 y */
      var sign = 1;
      if (vertical) { if (d.y + 37 > room.y + room.h - 24) sign = -1; } else { if (d.x + 37 > room.x + room.w - 24) sign = -1; }
      var px = vertical ? d.x : d.x + 37 * sign;
      var py = vertical ? d.y + 37 * sign : d.y;
      state.enemies.length = 0;                       /* 只排除战斗干扰，不动任何碰撞逻辑 */
      state.player.x = px; state.player.y = py;
      state.player.vx = 0; state.player.vy = 0;
      state.player.hp = state.player.hpMax;
      state.roomEntry = { lastRoomId: state.currentRoomId, armedUntil: 0, armedRoomId: -1 };
      state.touch.axisX = 0; state.touch.axisY = 0; state.touch.moveId = null;
      return { px: px, py: py, vertical: vertical, radius: state.player.radius, doorBar: ROOM_FLOW_CONFIG.doorBarWidth };
    })()`);
    out.steps.place = place;
    await cdp.ev(`window.__tStep(0.05)`);
    log(`[摆位] 角色(${Math.round(place.px)},${Math.round(place.py)}) 门轴偏移=37px 半径=${place.radius} 门闸宽=${place.doorBar}`);

    /* ---------- 证据①：直接读碰撞判定函数 ---------- */
    const pred = await cdp.ev(`(function(){
      var d = state.doors.filter(function(x){ return Math.abs(x.x-${pick.x})<0.5 && Math.abs(x.y-${pick.y})<0.5; })[0];
      var p = state.player, r = p.radius;
      var vertical = (d.side === 'left' || d.side === 'right');
      /* 朝门心 = 沿长轴把偏移 37 缩到 33（真实按键一帧约 2~4px） */
      var tx = vertical ? p.x : p.x + (d.x > p.x ? 4 : -4);
      var ty = vertical ? p.y + (d.y > p.y ? -4 : 4) : p.y;
      /* 垂直于门穿过 = 沿门的法线往目标房走 4px */
      var nx = vertical ? p.x + (d.targetRoomId === d.roomId ? 4 : (p.x <= d.x ? 4 : -4)) : p.x;
      var ny = vertical ? p.y : p.y + (p.y <= d.y ? 4 : -4);
      /* 远离门 = 沿长轴把偏移 37 放大到 41 */
      var ax = vertical ? p.x : p.x + (p.x > d.x ? 4 : -4);
      var ay = vertical ? p.y + (p.y > d.y ? 4 : -4) : p.y;
      return {
        armed: doorEntryArmed(),
        armedUntil: state.roomEntry ? state.roomEntry.armedUntil : null,
        elapsed: Math.round(state.elapsed*100)/100,
        playerRadius: r, doorBarWidth: ROOM_FLOW_CONFIG.doorBarWidth,
        bandHalfLong: ROOM_FLOW_CONFIG.doorBarWidth*0.5 + r,
        offsetAlongAxis: vertical ? Math.abs(p.y-d.y) : Math.abs(p.x-d.x),
        towardCenter: roomEntryBlocksMove(p.x,p.y,tx,ty,r),
        throughDoor: roomEntryBlocksMove(p.x,p.y,nx,ny,r),
        awayFromDoor: roomEntryBlocksMove(p.x,p.y,ax,ay,r),
        nearestEntryDoor: (function(){ var n = nearestEntryDoor(p.x,p.y); return n ? {x:n.x,y:n.y,side:n.side,target:n.targetRoomId} : null; })()
      };
    })()`);
    out.steps.predicate = pred;
    log(`[证据①·碰撞判定] 已放行=${pred.armed} 门轴偏移=${pred.offsetAlongAxis}px 判定半径选门=${pred.bandHalfLong}px`);
    log(`   朝门心=${pred.towardCenter ? '被挡' : '放行'}  垂直穿门=${pred.throughDoor ? '被挡' : '放行'}  远离门=${pred.awayFromDoor ? '被挡' : '放行'}`);

    /* ---------- 证据②：朝门心按帧推 1 秒，记录 10 个采样点 ---------- */
    const curve = await cdp.ev(`(function(){
      var d = state.doors.filter(function(x){ return Math.abs(x.x-${pick.x})<0.5 && Math.abs(x.y-${pick.y})<0.5; })[0];
      var vertical = (d.side === 'left' || d.side === 'right');
      var samples = [], prev = { x: state.player.x, y: state.player.y };
      for (var i = 0; i < 10; i += 1) {
        state.touch.axisX = vertical ? 0 : (d.x > state.player.x ? 1 : -1);
        state.touch.axisY = vertical ? (d.y > state.player.y ? 1 : -1) : 0;
        state.touch.moveId = 1;
        window.__tStep(0.1);
        var p = state.player;
        samples.push({
          d: Math.round(Math.hypot(p.x-d.x, p.y-d.y)*10)/10,
          moved: Math.round(Math.hypot(p.x-prev.x, p.y-prev.y)*10)/10,
          x: Math.round(p.x), y: Math.round(p.y), room: state.currentRoomId
        });
        prev = { x: p.x, y: p.y };
      }
      state.touch.axisX = 0; state.touch.axisY = 0; state.touch.moveId = null;
      return samples;
    })()`);
    out.steps.pushToCenter = curve;
    log(`[证据②·朝门心推 1s] 门距曲线=${curve.map((s) => s.d).join(' → ')}`);
    log(`    每 0.1s 位移=${curve.map((s) => s.moved).join(' / ')}  总位移=${Math.round(curve.reduce((a, s) => a + s.moved, 0))}px`);

    /* ---------- 证据②续：换方向——垂直于门穿过去 ---------- */
    const through = await cdp.ev(`(function(){
      var d = state.doors.filter(function(x){ return Math.abs(x.x-${pick.x})<0.5 && Math.abs(x.y-${pick.y})<0.5; })[0];
      var vertical = (d.side === 'left' || d.side === 'right');
      var room0 = state.currentRoomId, path = [];
      for (var i = 0; i < 20; i += 1) {
        if (vertical) { state.touch.axisX = (state.player.x <= d.x ? 1 : -1); state.touch.axisY = 0; }
        else { state.touch.axisX = 0; state.touch.axisY = (state.player.y <= d.y ? 1 : -1); }
        state.touch.moveId = 1;
        window.__tStep(0.1);
        path.push({ x: Math.round(state.player.x), y: Math.round(state.player.y), room: state.currentRoomId });
        if (state.currentRoomId !== room0) break;
      }
      state.touch.axisX = 0; state.touch.axisY = 0; state.touch.moveId = null;
      return { roomFrom: room0, roomTo: state.currentRoomId, crossed: state.currentRoomId !== room0, path: path };
    })()`);
    out.steps.throughDoor = through;
    log(`[证据②·垂直穿门] 房间 ${through.roomFrom} → ${through.roomTo}（${through.crossed ? '成功换房' : '未换房'}）走了 ${through.path.length} 拍`);

    /* ---------- 证据③：真实触摸交互键，看是否放行 ---------- */
    const interactBtn = await cdp.ev(RECT_JS('[data-act="descend"]'));
    out.steps.interactBtn = interactBtn;
    let armedByTouch = null;
    if (interactBtn) {
      await cdp.ev(`state.roomEntry.armedUntil = 0; state.player.x = ${place.px}; state.player.y = ${place.py}; window.__tStep(0.02); true`);
      await tap(cdp, interactBtn.cx, interactBtn.cy);
      await sleep(120);
      armedByTouch = await cdp.ev(`({armed: doorEntryArmed(), armedUntil: state.roomEntry ? Math.round(state.roomEntry.armedUntil*100)/100 : null, elapsed: Math.round(state.elapsed*100)/100})`);
    } else {
      armedByTouch = { missing: true };
    }
    out.steps.armedByTouch = armedByTouch;
    log(`[证据③·真实触摸交互键] 按下后 已放行=${armedByTouch.armed} armedUntil=${armedByTouch.armedUntil}`);

    /* ---------- 证据③续：放行后从门前穿过去 ---------- */
    const crossAfterE = await cdp.ev(`(function(){
      var d = state.doors.filter(function(x){ return Math.abs(x.x-${pick.x})<0.5 && Math.abs(x.y-${pick.y})<0.5; })[0];
      var vertical = (d.side === 'left' || d.side === 'right');
      var room0 = state.currentRoomId, path = [];
      for (var i = 0; i < 24; i += 1) {
        if (vertical) { state.touch.axisX = (state.player.x <= d.x ? 1 : -1); state.touch.axisY = 0; }
        else { state.touch.axisX = 0; state.touch.axisY = (state.player.y <= d.y ? 1 : -1); }
        state.touch.moveId = 1;
        window.__tStep(0.1);
        path.push({ x: Math.round(state.player.x), y: Math.round(state.player.y), room: state.currentRoomId });
        if (state.currentRoomId !== room0) break;
      }
      state.touch.axisX = 0; state.touch.axisY = 0; state.touch.moveId = null;
      return { roomFrom: room0, roomTo: state.currentRoomId, crossed: state.currentRoomId !== room0, path: path };
    })()`);
    out.steps.crossAfterE = crossAfterE;
    log(`[证据③·放行后穿门] 房间 ${crossAfterE.roomFrom} → ${crossAfterE.roomTo}（${crossAfterE.crossed ? '成功换房' : '未换房'}）`);

    /* ---------- 结论 ---------- */
    const invisibleWall = pred.throughDoor === true && pred.awayFromDoor === true;
    out.verdict = {
      hasInvisibleCollider: invisibleWall,
      onlyTowardCenterBlocked: pred.towardCenter === true && pred.throughDoor === false,
      reason: invisibleWall ? '三个方向全部被挡 → 存在真实碰撞体'
        : (pred.towardCenter === true ? '只有"朝门心"被挡，垂直穿门放行 → 是门禁规则 + 脚本贴门心走位所致'
          : '未复现卡点')
    };
    log(`[结论] ${out.verdict.reason}`);
  } finally {
    try { await cdp.shot(path.join(OUT_DIR, 'trap.jpg')); } catch (e) { /* ignore */ }
    fs.writeFileSync(path.join(OUT_DIR, 'trap.json'), JSON.stringify(out, null, 2), 'utf8');
    cdp.close();
    console.log('产物：' + OUT_DIR);
  }
}

main().catch((e) => { console.error('探针失败：' + e.stack); process.exit(1); });
