/**
 * 首领战定点诊断（mboss.js）
 * ------------------------------------------------------------
 * 目的：查清"进了首领房、锁定到首领、施法也成功，但首领一滴血不掉"的物理原因。
 * 采集：
 *   1) 当前房矩形 / 角色坐标是否在房内 / 到首领的直线是否被墙挡（los）；
 *   2) 角色周围 8 个方向 isWalkBlocked / isWalkableCircle；
 *   3) 按帧朝首领推进 10 秒，逐秒记录坐标、距离、首领血量、弹道数量。
 * 只读 + 摆位，不改游戏参数。用法：node mobile/tools/mboss.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { prepareProfile, killEdge } = require(path.join(__dirname, '..', '..', 'tools', 'arcane_profile'));

const ROOT = path.join(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'mobile', 'index_arcane_v2_mobile.html');
const OUT_DIR = path.join(ROOT, 'mobile', 'shots', 'boss_' + new Date().toISOString().replace(/\D/g, '').slice(0, 14));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9567;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 启动无头 Edge 并返回最小 CDP 封装 */
async function bootEdge() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files', '--mute-audio',
    '--hide-scrollbars', '--window-size=900,600',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    'about:blank'
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
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/** 主流程：进局 → 传送到首领房 → 几何/碰撞/首帧施法诊断 */
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
    await cdp.ev(`(function(){
      window.requestAnimationFrame = function(){ return 0; };
      window.__pStep = function(sec){ var n=Math.max(1,Math.round(sec*60)); for(var i=0;i<n;i+=1) update(1/60); try{render();}catch(e){} return true; };
      return true;
    })()`);

    /* 直达首领房：直接调 performRoomTeleport（它不做"本房清完"校验，诊断只关心落地后的状态） */
    const g = await cdp.ev(`window.__roamDebug.floorGraph()`);
    const boss = g.rooms.filter((r) => r.type === 'boss')[0] || g.rooms.filter((r) => r.id === g.stairId)[0];
    out.steps.graph = { rooms: g.rooms.length, corridors: g.corridors, doors: g.doors, boss: boss.id, stair: g.stairId };
    log(`[结构] 房${g.rooms.length} 走廊=${g.corridors} 门=${g.doors} 首领房#${boss.id} 首领房矩形=(${boss.cx},${boss.cy})`);
    let cur = await cdp.ev(`state.currentRoomId`);
    const path = [];
    for (let guard = 0; guard < 6 && cur !== boss.id; guard += 1) {
      await cdp.ev(`performRoomTeleport(${boss.id}, null); true`);
      for (let w = 0; w < 10; w += 1) {
        await sleep(180);
        await cdp.ev(`window.__pStep(0.2)`);
        cur = await cdp.ev(`state.currentRoomId`);
        if (cur === boss.id) break;
      }
      path.push(cur);
      if (cur === boss.id) break;
    }
    out.steps.teleports = path;
    log(`[传送] 落房序列=${JSON.stringify(path)} → 当前房#${cur}`);

    await sleep(300);
    const geo = await cdp.ev(`(function(){
      var p = state.player, room = state.rooms[state.currentRoomId];
      var b = state.enemies.filter(function(e){ return state.boss && e.id === state.boss.enemyId; })[0];
      var inRoom = room ? (p.x >= room.x && p.x <= room.x + room.w && p.y >= room.y && p.y <= room.y + room.h) : null;
      var losOk = b ? (typeof los === 'function' ? los(p.x, p.y, b.x, b.y) : null) : null;
      var dirs = [];
      for (var i = 0; i < 8; i += 1) {
        var a = i / 8 * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
        dirs.push({ a: i * 45, blocked: isWalkBlocked(p.x + cx * 40, p.y + cy * 40, p.radius || 12), walk: isWalkableCircle(p.x + cx * 40, p.y + cy * 40, p.radius || 12) });
      }
      return {
        roomId: state.currentRoomId, room: room ? { x: room.x, y: room.y, w: room.w, h: room.h } : null,
        inRoom: inRoom, player: { x: Math.round(p.x), y: Math.round(p.y), r: p.radius },
        boss: b ? { x: Math.round(b.x), y: Math.round(b.y), hp: Math.round(b.hp), roomId: b.roomId, dormant: !!b.dormant, invuln: !!b.invuln } : null,
        dist: b ? Math.round(Math.hypot(b.x - p.x, b.y - p.y)) : null,
        los: losOk, dirs: dirs
      };
    })()`);
    out.steps.geometry = geo;
    log(`[几何] 房#${geo.roomId} 矩形=${JSON.stringify(geo.room)} 角色(${geo.player.x},${geo.player.y}) 在房内=${geo.inRoom}`);
    log(`[几何] 首领=${JSON.stringify(geo.boss)} 距离=${geo.dist}px 直线可见=${geo.los}`);
    log(`[碰撞] 8 方向 40px：${geo.dirs.map((d) => d.a + '°' + (d.blocked ? '挡' : '通') + '/' + (d.walk ? '可站' : '不可站')).join('  ')}`);

    /* 环境读数：证明世界有没有在推进 / 移动输入有没有被游戏读到 / 有没有被冻结态锁住 */
    const env = await cdp.ev(`(function(){
      var p = state.player;
      state.touch.axisX = 1; state.touch.axisY = 0; state.touch.moveId = 1;
      var ev = typeof touchMoveVector === 'function' ? touchMoveVector() : null;
      state.touch.axisX = 0; state.touch.axisY = 0; state.touch.moveId = null;
      var e0 = state.elapsed;
      update(1/60);
      var e1 = state.elapsed;
      return {
        mode: state.mode, status: state.status, modalOpen: !!state.modalOpen,
        paused: !!state.paused, hitStop: state.hitStop, slowMo: state.slowMo,
        fusionSlow: state.fusionSlow, levelSlowT: state.levelSlowT, levelUpDelay: state.levelUpDelay,
        tpTime: p.tpTime, tpFreeze: p.tpFreeze, dashTime: p.dashTime,
        vx: Math.round(p.vx), vy: Math.round(p.vy),
        touchVec: ev, castQueue: (state.castQueue || []).length,
        elapsedDelta: Math.round((e1 - e0) * 1e6) / 1e6,
        walkHere: isWalkableCircle(p.x, p.y, p.radius),
        bossState: state.boss ? { started: !!state.boss.started, introDone: !!state.boss.introDone, defeated: !!state.boss.defeated } : null,
        weapons: (state.meta && state.meta.weapon) || null
      };
    })()`);
    out.steps.env = env;
    log(`[环境] mode=${env.mode} status=${env.status} 弹窗=${env.modalOpen} hitStop=${env.hitStop} slowMo=${env.slowMo} fusionSlow=${env.fusionSlow} levelSlowT=${env.levelSlowT}`);
    log(`[环境] tpTime=${env.tpTime} tpFreeze=${env.tpFreeze} dashTime=${env.dashTime} v=(${env.vx},${env.vy}) 摇杆读到=${JSON.stringify(env.touchVec)} 施法队列=${env.castQueue}`);
    log(`[环境] 单帧 elapsed 增量=${env.elapsedDelta} 脚下可站=${env.walkHere} 首领状态=${JSON.stringify(env.bossState)}`);

    /* 朝首领走 + 施法，逐秒记录 */
    const trace = await cdp.ev(`(function(){
      var p = state.player, b = state.enemies.filter(function(e){ return state.boss && e.id === state.boss.enemyId; })[0];
      var rows = [], okCasts = 0;
      for (var t = 0; t < 10; t += 1) {
        for (var k = 0; k < 30; k += 1) {
          var dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy) || 1;
          if (d > 380) { state.touch.axisX = dx / d; state.touch.axisY = dy / d; state.touch.moveId = 1; }
          else { state.touch.axisX = 0; state.touch.axisY = 0; state.touch.moveId = null; }
          if (d <= 640) { try { if (castPrimary()) okCasts += 1; } catch (e) {} }
          update(1/30);
        }
        rows.push({ t: t + 1, x: Math.round(p.x), y: Math.round(p.y), d: Math.round(Math.hypot(b.x - p.x, b.y - p.y)), hp: Math.round(b.hp), shots: (state.projectiles || []).length, aether: Math.round(p.aether), mode: state.mode, status: state.status, tpFreeze: p.tpFreeze, elapsed: Math.round(state.elapsed * 100) / 100, castQueue: (state.castQueue || []).length, okCasts: okCasts });
      }
      state.touch.axisX = 0; state.touch.axisY = 0; state.touch.moveId = null;
      return rows;
    })()`);
    out.steps.trace = trace;
    trace.forEach((r) => log(`[逐秒 t=${r.t}s] 位置=(${r.x},${r.y}) 距离=${r.d} 首领HP=${r.hp} 弹道=${r.shots} 奥能=${r.aether} 施法成功=${r.okCasts} 队列=${r.castQueue} elapsed=${r.elapsed} mode=${r.mode}/${r.status} tpFreeze=${r.tpFreeze}`));
    await cdp.shot(path.join(OUT_DIR, 'boss.jpg'));
  } finally {
    fs.writeFileSync(path.join(OUT_DIR, 'boss.json'), JSON.stringify(out, null, 2), 'utf8');
    cdp.close();
    console.log('产物：' + OUT_DIR);
  }
}

main().catch((e) => { console.error('诊断失败：' + e.stack); process.exit(1); });
