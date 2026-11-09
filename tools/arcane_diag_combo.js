// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// 诊断：一发爆炸炸死 6 只后，逐帧采样 kills / combo / aether / floats
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9733;
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
  // 准备：解锁爆炸新星 + 6 只 hp=1 静止敌人
  await ev("window.__roamDebug.grantTech('field'); window.__roamDebug.fuse(); true");
  await ev(`(function(){
    state.enemies.length = 0; state.projectiles.length = 0; state.floats.length = 0;
    state.cooldowns = {}; state.player.aether = 70; state.player.hp = state.player.hpMax;
    state.combo.count = 0; state.combo.timer = 0; state.kills = 0; state.lastExplosion = null;
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
  console.log('cast 结果：', await ev('window.__roamDebug.cast()'));
  const samples = [];
  for (let i = 0; i < 26; i += 1) {
    await sleep(60);
    const s = await ev(`(function(){
      var st = window.__roamDebug.getState();
      return { t: Math.round(state.elapsed * 100) / 100, kills: st.kills,
               combo: st.combo.count, aether: Math.round(st.aether * 10) / 10,
               enemies: st.enemies, hits: st.lastExplosion ? st.lastExplosion.hits : null,
               floats: state.floats.map(function(f){ return f.text; }).slice(0, 14) };
    })()`);
    samples.push(s);
  }
  samples.forEach((s) => console.log(JSON.stringify(s)));
  ws.close(); killEdge(edge); process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
