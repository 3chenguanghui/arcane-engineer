// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// 诊断 3：拦截 applyExplosion / damageEnemy 的入参，找出 NaN 的确切来源
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9737;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* wait */ }
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1; pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await ev("document.getElementById('btnStart').click(); true");
  await sleep(900);

  // 打补丁：记录 applyExplosion 入参 + damageEnemy 入参
  await ev(`(function(){
    window.__expLog = [];
    window.__dmgLog = [];
    var origExplode = applyExplosion;
    applyExplosion = function(x, y, radius, damage, color, accent, primary) {
      window.__expLog.push({
        x: x, y: y, radius: radius, damage: damage, damageType: typeof damage,
        color: color, primary: primary ? primary.id : null
      });
      return origExplode(x, y, radius, damage, color, accent, primary);
    };
    var origDamage = damageEnemy;
    damageEnemy = function(enemy, amount, dirAngle) {
      window.__dmgLog.push({
        id: enemy.id, amount: amount, amountType: typeof amount,
        x: enemy.x, y: enemy.y, radius: enemy.radius, hp: enemy.hp
      });
      return origDamage(enemy, amount, dirAngle);
    };
    return true;
  })()`);

  await ev("window.__roamDebug.grantTech('field'); window.__roamDebug.fuse(); true");
  await ev(`(function(){
    state.enemies.length = 0; state.projectiles.length = 0; state.floats.length = 0;
    state.cooldowns = {}; state.player.aether = 70; state.player.hp = state.player.hpMax;
    state.combo.count = 0; state.combo.timer = 0; state.kills = 0; state.lastExplosion = null;
    window.__expLog = []; window.__dmgLog = [];
    var roomId = state.currentRoomId;
    for (var i = 0; i < 6; i += 1) {
      var id = window.__roamDebug.spawnEnemy('assembler', 72 + i * 26, (i % 2 === 0 ? 10 : -10));
      var e = state.enemies.find(function(x){ return x.id === id; });
      if (e) { e.roomId = roomId; e.speed = 0; e.hp = 1; e.hpMax = 1; }
    }
    state.floats.length = 0;
    return state.enemies.length;
  })()`);
  await ev('window.__roamDebug.setMouseAim(0); true');
  await sleep(200);
  await ev('window.__roamDebug.cast(); true');
  await sleep(600);
  console.log('applyExplosion 入参：', JSON.stringify(await ev('window.__expLog'), null, 2));
  console.log('damageEnemy 入参：', JSON.stringify(await ev('window.__dmgLog'), null, 2));
  console.log('投影物：', JSON.stringify(await ev('state.projectiles.map(function(p){return {damage:p.damage, explode:p.explode};})')));
  ws.close(); killEdge(edge); process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
