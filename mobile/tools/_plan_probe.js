/**
 * 布局探针：只启动一次无头 Edge，打印首层房间 / 门 / 敌人 / 首领 / 楼梯结构
 * 用途：给 e2e 的战斗策略提供真实数据（不改游戏、不写 shots 目录）
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile_probe');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9571;
const SNAP = path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 启动无头 Edge 并返回极简 CDP */
async function boot() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--mute-audio', '--window-size=900,600',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(edge); throw new Error('未就绪'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1; const id = seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('cdp timeout ' + method)); }, 30000);
    pending.set(id, (m) => { clearTimeout(timer); if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  return { send, ev, close: () => { try { ws.close(); } catch (e) {} killEdge(edge); } };
}

/** 主流程 */
(async () => {
  const cdp = await boot();
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenWidth: 844, screenHeight: 390, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
    await cdp.send('Page.navigate', { url: 'file:///' + SNAP.replace(/\\/g, '/') + '?probe=1' });
    for (let i = 0; i < 120; i += 1) {
      if (await cdp.ev(`document.readyState==='complete' && typeof state!=='undefined'`)) break;
      await sleep(200);
    }
    await sleep(800);
    await cdp.ev(`(document.getElementById('btnStart')||{}).click(); true`);
    await sleep(500);
    await cdp.ev(`(function(){var c=document.querySelector('.char-card');if(c)c.click();var b=document.getElementById('btnCharConfirm');if(b)b.click();return true;})()`);
    for (let i = 0; i < 80; i += 1) { if (await cdp.ev(`state.mode==='playing'`)) break; await sleep(200); }
    await sleep(4200);
    const dump = await cdp.ev(`(function(){
      var s = state;
      return {
        player: {x:Math.round(s.player.x), y:Math.round(s.player.y), hp:s.player.hp, hpMax:s.player.hpMax, aether:Math.round(s.player.aether), aetherMax:s.player.aetherMax, speed:s.player.speed, regen:s.player.regen, radius:s.player.radius},
        magics: s.ownedMagic.slice(),
        dual: s.dual ? {slots:s.dual.slots.slice()} : null,
        tech: s.ownedTech.slice(),
        lv: s.xpLevel, xpNeed: s.xpNeed,
        rooms: s.rooms.map(function(r){return {id:r.id, type:r.type, x:Math.round(r.cx), y:Math.round(r.cy), w:Math.round(r.w), h:Math.round(r.h), visited:!!r.visited, cleared:!!r.cleared, bossKind:r.bossKind||null};}),
        doors: (s.doors||[]).map(function(d){return {x:Math.round(d.x), y:Math.round(d.y), side:d.side, target:d.targetRoomId};}),
        enemies: s.enemies.map(function(e){return {id:e.id, kind:e.kind, hp:Math.round(e.hp), hpMax:Math.round(e.hpMax), x:Math.round(e.x), y:Math.round(e.y), roomId:e.roomId};}),
        boss: s.boss ? {defeated:!!s.boss.defeated, hp:Math.round(s.boss.hp), hpMax:Math.round(s.boss.hpMax), x:Math.round(s.boss.x), y:Math.round(s.boss.y), roomId:s.boss.roomId, damage:s.boss.contactDamage||null} : null,
        stairs: {x:Math.round(s.stairs.x), y:Math.round(s.stairs.y), active:!!s.stairs.active},
        room: s.room ? {id:s.room.id, type:s.room.type} : null,
        openFloor: s.openFloor || null,
        floorCleared: !!s.floorCleared,
        roomEntry: s.roomEntry || null,
        viewW: s.viewW, viewH: s.viewH, zoom: (typeof cameraZoom==='function'?cameraZoom():null)
      };
    })()`);
    console.log(JSON.stringify(dump, null, 1));
  } finally {
    cdp.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
